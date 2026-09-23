import type { LocalEngineId } from "@/lib/localEngines";
// 꼬리 줄을 가르는 규칙은 한 곳(`promptLinks`)에만 둡니다 — 머리말 글자가 거기 있습니다.
import { splitLinkTail } from "@/lib/promptLinks";

/**
 * 앱의 프롬프트를 **로컬 모델이 알아듣는 말로** 고쳐 보냅니다.
 *
 * 뒤쪽을 골랐습니다.
 *
 * 앞쪽(모델마다 프롬프트를 따로 쓰기)으로 가면 카드마다 프롬프트가 두 벌이 되고, 한쪽만
 * 고치는 날이 옵니다. **적어 둔 프롬프트는 하나**로 두고, 보내는 순간에만 고칩니다.
 *
 * # 무엇을 고치는가
 *
 * 우리 프롬프트는 «마그니픽에 올린다» 를 전제로 쓰였습니다. 로컬 모델에는 그 전제가
 * 통째로 없습니다.
 *
 * - `@파일이름` 칩 — 마그니픽 캔버스의 그림을 가리키는 말입니다. 로컬에는 그 캔버스가
 * 없어서 글자 그대로 남으면 모델이 «앳 표시가 있는 간판» 같은 것을 그립니다.
 * - 미드저니 매개변수(`--ar 16:9`, `--no text`) — 로컬은 크기를 설정으로 받습니다.
 * `--no` 뒤의 말은 버리지 않고 **네거티브로 옮깁니다.**
 * - 「첨부한 시트를 보고」 같은 문장 — 붙일 것이 없습니다. 다만 문장을 통째로 지우면
 * 인물 설명까지 날아가므로, **칩만 걷어내고 말은 남깁니다.**
 *
 * # 어느 칸을 보내는가
 *
 * **영문 칸이 먼저입니다.** 오픈 가중치 모델의 텍스트 인코더는 영어로 학습돼 있어,
 * 한글을 그대로 넣으면 장르·재질 같은 말을 거의 못 알아듣습니다. 영문 칸이 비었을 때만
 * 한글로 물러섭니다(아무것도 안 보내는 것보다는 낫습니다).
 */

/** 그림 모델이 늘 빼야 하는 것. SD 계열 관례를 그대로 씁니다. */
const BASE_NEGATIVE =
  "lowres, worst quality, jpeg artifacts, blurry, bad anatomy, deformed hands, extra fingers, watermark, text, signature, logo";

/**
 * 네거티브 칸을 쓰는 엔진인가.
 *
 * 미니맥스 H3 는 `negative_prompt` 입력 자체가 없습니다. 여기서 쓰는 Krea 2 Turbo 와
 * Z-Image Turbo 는 guidance 0 으로 생성하므로 네거티브를 보내지 않습니다.
 * 워커도 같은 모델별 제약을 지킵니다 — MCP 요청은 이 튜닝 함수를 거치지 않기 때문입니다.
 */
const USES_NEGATIVE: Record<LocalEngineId, boolean> = {
  minimaxh3: false,
  minimaxmusic: false,
  qwenimage: true,
  zimage: false,
  // Krea 2 Turbo 도 guidance 0 증류판이라 네거티브가 아무 일도 하지 않습니다.
  krea2: false,
  anima: true,
  wanvideo: true,
  ltx25: true,
  acestep: false,
  // 모션 캡처는 프롬프트를 쓰지 않습니다(표를 채우려고 적어 둘 뿐).
  sam3dbody: false,
  nlf: false,
  gvhmr: false,
};

/**
 * 마그니픽 `@파일이름` 칩을 걷어냅니다. 말은 남기고 앳 표시와 **번호 꼬리**를 뗍니다.
 *
 * 예전 정규식은 공백에서 멈춰서 「@서진우 (니시무라 진)_001」 이 「서진우 (니시무라 진)_001」 로
 * 남았습니다 — 로컬 모델에는 그 파일이 없으니 글자 그대로 읽어 «_001» 까지 그리려 듭니다.
 * 파일 이름은 «이름_번호» 또는 «이름_변형_번호» 라 이름에 공백·괄호가 있어도 번호로 끝납니다.
 */
function stripMentions(text: string): string {
  return text.replace(/@([^\s,.·]+(?:[^\n@,.]*?_\d{3,})?)/g, (_, raw: string) =>
    String(raw)
      .replace(/_\d{3,}$/, "")
      .replace(/_/g, " ")
      .trim(),
  );
}

/**
 * 미드저니 매개변수를 떼어 내고, `--no` 뒤의 말은 네거티브로 돌려줍니다.
 *
 * `--ar 2:3`·`--s 250`·`--v 6` 은 로컬에서 의미가 없습니다(크기는 설정으로 받습니다).
 * 남겨 두면 모델이 그 글자를 화면에 써 버리는 일이 실제로 있습니다.
 */
function splitMidjourneyParams(text: string): { body: string; no: string } {
  const no: string[] = [];
  const body = text
    .replace(/--no\s+([^-\n]+)/g, (_, list: string) => {
      no.push(String(list).trim());
      return " ";
    })
    .replace(/--\w+(\s+[^\s-][^\s]*)?/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { body, no: no.join(", ") };
}

/** 「Negative prompt:」 줄이 본문에 박혀 온 경우 갈라냅니다(스테이블 디퓨전식 답). */
function splitNegativeLine(text: string): { body: string; negative: string } {
  const matched = text.match(/^\s*negative\s*prompt\s*:\s*(.+)$/im);
  if (!matched) return { body: text, negative: "" };
  return {
    body: text.replace(matched[0], "").trim(),
    negative: matched[1].trim(),
  };
}

export interface LocalPromptInput {
  ko?: string;
  en?: string;
  negativeKo?: string;
  negativeEn?: string;
}

export interface TunedPrompt {
  prompt: string;
  negative: string;
  /** 한글 칸으로 물러섰는가. 화면에서 한 줄로 알려 줍니다. */
  usedKorean: boolean;
  /** 이 프롬프트의 대략적인 토큰 수. 한도를 넘는지 보려는 것이라 정확할 필요는 없습니다. */
  tokens: number;
  /** 이 엔진이 한 번에 읽는 토큰 수. */
  budget: number;
  /** 한도를 넘어 **뒤쪽이 잘릴** 상태인가. */
  overflow: boolean;
  /** 한 장에 그리라고 적힌 칸 수(「panel 3 - …」). 시트 프롬프트인지 가리는 값. */
  panels: number;
}

/**
 * 이 엔진이 **한 번에 읽는 토큰 수**.
 *
 * 텍스트 인코더가 정한 값이고, 넘긴 말은 조용히 버려집니다 — 우리 프롬프트는 상황·환경·인물·구도·빛을
 * 다 적어 길고 **칸 배치 지시가 맨 뒤**에 있어서, 넘치면 정확히 그 부분이 날아갑니다(2026-09-22).
 * 파이썬 쪽(`_image.py`)도 같은 값을 받아 씁니다 — 두 곳에 다른 숫자를 적으면 한쪽만 맞습니다.
 */
export function localTokenBudget(engine: LocalEngineId): number {
  // Qwen-Image 는 자체 인코더로 1024 까지 받습니다. FLUX 계열(Krea·Z-Image·Anima)은 T5 512 가 상한입니다.
  if (engine === "qwenimage") return 1024;
  if (engine === "minimaxh3" || engine === "wanvideo" || engine === "ltx25") return 512;
  return 512;
}

/** 대략적인 토큰 수. 영어는 낱말 하나에 1.3 토큰쯤이고, 한글은 글자당 1 을 넘습니다. */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const hangul = (text.match(/[가-힣]/g) || []).length;
  return Math.round(words * 1.3 + hangul * 0.6);
}

/** 한 장 안에 몇 칸을 그리라고 적혀 있는가 — 「panel 7 - …」·「칸 7 —」 를 셉니다. */
export function countPanels(text: string): number {
  const en = new Set((text.match(/\bpanel\s+(\d+)/gi) || []).map((hit) => hit.toLowerCase()));
  const ko = new Set((text.match(/칸\s*(\d+)/g) || []));
  return Math.max(en.size, ko.size);
}

/**
 * **전신을 시켰는데 허벅지에서 잘리는 것**을 고칩니다.
 *
 * 2026-09-22 실측(Qwen-Image, 같은 씨앗으로 칸 넉 장): 「full body」·「head to toe in frame」 을
 * 넣었는데 넉 장 모두 허벅지에서 잘리고 발이 한 번도 안 나왔습니다. 모델이 중간샷 쪽으로 쏠려
 * 있어서 한 마디로는 안 밀립니다. **무엇이 프레임 안에 있어야 하는지 사물로 짚어 주면** 그제야
 * 머리부터 신발까지 들어왔습니다(같은 프롬프트에 아래 한 구절만 더해 다시 뽑아 확인).
 *
 * 그래서 전신을 뜻하는 말이 있으면 그 구절을 한 번 덧댑니다. 이미 «신발/발» 을 짚어 두었으면
 * 그대로 둡니다 — 두 번 적는다고 더 넓어지지는 않고 글자 수만 먹습니다.
 */
/** 그림을 그리는 엔진. 영상·음악·모캡은 전신 프레이밍이 뜻이 다르거나 없습니다. */
const IMAGE_ENGINES = new Set<LocalEngineId>(["qwenimage", "zimage", "krea2"]);

const FULL_BODY = /\b(full[- ]body|full[- ]length|head to toe|전신)\b/i;
const ALREADY_FRAMED = /\b(feet|boots|shoes|footwear|발끝|신발)\b/i;
const FRAMING_FIX =
  "the entire body from the top of the head down to the shoes is inside the frame, " +
  "both feet fully visible, small figure in a tall frame";

function fixFullBodyFraming(text: string): string {
  if (!FULL_BODY.test(text) || ALREADY_FRAMED.test(text)) return text;
  const tail = text.trimEnd();
  const joiner = /[.,;]$/.test(tail) ? " " : ", ";
  return `${tail}${joiner}${FRAMING_FIX}`;
}

/** 적어 둔 프롬프트를 이 엔진이 알아듣는 꼴로 고칩니다. */
export function tuneForLocal(
  engine: LocalEngineId,
  input: LocalPromptInput,
): TunedPrompt {
  /*
    꼬리 줄(«참고 그림: …»·«아직 그림 없음: …»)부터 뗍니다. 그 줄의 @태그는 마그니픽에 올린 그림의
    이름이라 여기서는 가리킬 것이 없고, 앳만 벗기면 «Reference images: layout 씬1 컷1 구도 / …» 가
    본문으로 남아 모델이 그 글자를 그립니다. 「영상 프롬프트」·「프롬프트 작성」 이 늘 꼬리를 달게
    되면서 드러났습니다(2026-09-21 점검). 가르는 규칙은 `splitLinkTail` 한 벌.
  */
  const en = splitLinkTail(input.en || "").body.trim();
  const ko = splitLinkTail(input.ko || "").body.trim();
  const usedKorean = !en && Boolean(ko);
  const source = en || ko;

  const withoutLine = splitNegativeLine(stripMentions(source));
  const params = splitMidjourneyParams(withoutLine.body);

  const negativeSource = usedKorean
    ? input.negativeKo || input.negativeEn
    : input.negativeEn || input.negativeKo;

  const negative = USES_NEGATIVE[engine]
    ? [
        stripMentions((negativeSource || "").trim()),
        withoutLine.negative,
        params.no,
        BASE_NEGATIVE,
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ")
    : "";

  // 그림 엔진에만 — 영상·음악은 전신 프레이밍이 뜻이 다르거나 없습니다.
  const body = IMAGE_ENGINES.has(engine) ? fixFullBodyFraming(params.body) : params.body;

  const budget = localTokenBudget(engine);
  const tokens = estimateTokens(body);
  return {
    prompt: body,
    negative,
    usedKorean,
    tokens,
    budget,
    overflow: tokens > budget,
    panels: countPanels(params.body),
  };
}

/**
 * 엔진이 요구하는 **크기의 눈금**(px).
 *
 * 미니맥스 H3 는 32 의 배수라야 합니다 — 안 맞으면 거절합니다. 나머지는 8 이면 됩니다.
 * 두 곳에 적으면 어긋나므로 여기 한 표가 진실입니다.
 */
const SIZE_STEP: Record<LocalEngineId, number> = {
  minimaxh3: 32,
  minimaxmusic: 8,
  qwenimage: 8,
  zimage: 8,
  krea2: 8,
  anima: 8,
  wanvideo: 8,
  // LTX 2.5 는 가로·세로가 **32의 배수**라야 합니다(모델 카드).
  ltx25: 32,
  acestep: 8,
  sam3dbody: 8,
  nlf: 8,
  gvhmr: 8,
};

/**
 * 긴 변 기본값.
 *
 * H3 는 짧은 변 768 이 학습 canvas 이고(16:9 면 긴 변 1344), 960×544 는 1344×768 보다
 * 스텝당 2.3배 빠릅니다. 한 편에 수십 분이 걸리는 쪽이라 **작은 쪽**을 기본으로 둡니다 —
 * 마음에 들면 크게 다시 뽑으면 되지만, 처음부터 크게 잡으면 한 번 보는 데 너무 오래 걸립니다.
 */
export function localLongEdge(engine: LocalEngineId): number {
  if (engine === "minimaxh3") return 960;
  if (engine === "wanvideo") return 1280;
  return 1536;
}

/**
 * 화면 비율에서 실제 픽셀로.
 *
 * 눈금을 안 맞추면 DiT·VAE 가 가장자리를 잘라내거나 아예 거절합니다.
 */
export function localSize(
  engine: LocalEngineId,
  aspect: string,
  longEdge?: number,
): { width: number; height: number } {
  const matched = aspect.match(/(\d+)\s*[:x]\s*(\d+)/);
  const w = matched ? Number(matched[1]) : 16;
  const h = matched ? Number(matched[2]) : 9;
  const step = SIZE_STEP[engine];
  const long = longEdge ?? localLongEdge(engine);
  const snap = (value: number) => Math.max(step, Math.round(value / step) * step);
  return w >= h
    ? { width: snap(long), height: snap((long * h) / w) }
    : { width: snap((long * w) / h), height: snap(long) };
}
