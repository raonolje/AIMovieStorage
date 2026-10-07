/**
 * **모델별·버전별 프롬프트 규칙표.**
 *
 * # 왜 문서가 아니라 표인가
 *
 * 규칙은 이미 `prompts/models/*.md` 에 글로 적혀 있습니다. 그런데 글은 **사람과
 * LLM 만** 읽습니다. 우리 앱이 규칙 없이 조립하는 길(`buildCutVideoPrompt`)과
 * API 로 보내는 길은 그 글을 못 읽습니다. 그래서 «기계가 쓰는 사실»만 여기 표로
 * 두고, 문서는 «왜 그런가» 를 맡습니다. 문서의 확인일·endpoint 경계를 함께 검토하며 이 표만으로 실제 지원을 보장하지 않습니다.
 *
 * # 버전을 왜 나누는가
 *
 * 2026-09-18 에 제가 실제로 저지른 잘못입니다 — Kling **2.6** 공식 문서의 제약
 * (「중국어·영어만 소리로 낸다」)을 **3.0** 문서에 그대로 옮겨 적었습니다. 사용자가
 * 바로잡았습니다: 「클링 한국어 잘해… 다만 연기가 좀 과장될 뿐이야」. 같은 이름의
 * 모델이라도 **판이 다르면 다른 모델**입니다. 한 칸에 뭉뚱그리면 이런 사고가 납니다.
 *
 * # 공통 규칙은 여기 없습니다
 *
 * 「앞쪽이 무겁다」·「한 컷에 연기 하나」·「감정 이름만 적지 마라」처럼 **모든 모델에
 * 통하는 것**은 `prompts/techniques/` 에 있습니다. 여기는 **모델마다 갈리는 것만**
 * 적습니다. 공통 규칙을 여기 베껴 두면 모델을 하나 더할 때마다 같은 말을 또 적게 되고,
 * 고칠 때 한 곳을 빠뜨립니다(앱 규칙 1 과 같은 이유).
 */

/** 소리를 만드는가. `always` 는 **끌 수 없다**는 뜻입니다(Veo). */
export type AudioSupport = "none" | "optional" | "always";

/**
 * 대사를 적는 **모양**. 모델마다 이것 하나가 제일 크게 갈립니다.
 *
 * · `none` 대사 문법이 없습니다. 적어도 소리가 안 납니다.
 * · `quoted` 따옴표 + 서술절. `"문장," he murmured.`
 * · `colon` 따옴표 대신 콜론. 자막이 덜 박힙니다(Veo 커뮤니티 발견).
 * · `labeled` 대괄호 화자 라벨. `[인물, 톤]: "문장"`
 * · `block` 본문 뒤 별도 대사 블록. `Dialogue:` → `- 화자: "문장"`
 * · `tagged` 화자 ID 와 태그. `(S1) … <d>[Korean] 문장</d>` (MiniMax-H3)
 * · `braced` 중괄호로 대사만 감쌉니다. `the woman says {I told you already}` (Seedance)
 * · `segmented` 구 단위로 끊어 연기 지시를 사이사이에.
 *
 * `tagged` 와 `braced` 를 가른 까닭: 둘 다 «감싼다» 지만 감싸는 것이 달라서, 한 갈래로
 * 두면 조립하는 쪽이 어느 모양으로 적어야 할지 알 수가 없습니다. Seedance 에 `<d>` 를
 * 보내면 태그가 글자로 화면에 그려집니다.
 */
export type DialogueSyntax =
  | "none"
  | "quoted"
  | "colon"
  | "labeled"
  | "block"
  | "tagged"
  | "braced"
  | "segmented";

/** 금지 사항을 어디에 적는가. */
export type NegativeSupport =
  /** 따로 네거티브 칸이 있습니다. */
  | "field"
  /** 칸이 없어 본문에 적습니다. */
  | "inline"
  /** 부정문 자체가 안 통합니다 — 원하는 것을 긍정으로 적어야 합니다. */
  | "unsupported";

export interface ModelRule {
  /** `prompts/models/<id>.md` 와 같은 id. 문서가 없으면 `doc: false`. */
  id: string;
  label: string;
  /** 같은 계열 묶음. 버전이 달라도 계열은 같습니다. */
  family: string;
  version: string;
  kind: "video" | "image";
  /** `prompts/models/` 에 같은 id 의 문서가 있는가. */
  doc: boolean;
  audio: AudioSupport;
  dialogue: {
    syntax: DialogueSyntax;
    /** 그 모양의 본보기 한 줄. 영어로 적습니다 — 프롬프트에 그대로 들어갈 모양이라서요. */
    example?: string;
    /**
     * 한국어 대사를 어떻게 다루는가.
     * · `spoken` 한국어로 말합니다.
     * · `translated` 영어로 번역해서 발음합니다.
     * · `unsupported` 소리를 안 만듭니다.
     */
    korean: "spoken" | "translated" | "unsupported";
    /** 한 번에 권장되는 화자 수. 넘기면 성능이 떨어집니다. */
    maxSpeakers?: number;
  };
  negative: NegativeSupport;
  /** 한 번에 뽑히는 최대 길이(초). */
  maxSeconds: number;
  /** 대사·노래가 든 컷에 권장되는 길이(초). */
  bestSeconds?: number;
  /**
   * 카메라 지시를 어디에 두는가.
   * · `front` 앞쪽(Veo 계열이 더 잘 따릅니다)
   * · `back` 맨 뒤(장면을 먼저 세우고 그 안을 움직이라는 Kling 안내)
   * · `bracket` 대괄호에 따로 — `[Push in]`
   * · `either` 어느 쪽이든. 흩뿌리지만 않으면 됩니다.
   */
  camera: "front" | "back" | "bracket" | "either";
  /** 이 모델에서만 겪는 것. 한 줄씩, 한국어로. */
  quirks: string[];
}

/**
 * **버전까지 적은 규칙표.**
 *
 * 새 판이 나오면 **줄을 고치지 말고 새로 더하세요.** 옛 판을 쓰는 사람이 있고,
 * 무엇보다 «이 판은 이랬다» 가 남아야 위의 Kling 사고가 다시 안 납니다.
 */
export const MODEL_RULES: ModelRule[] = [
  // ── Google Veo ────────────────────────────────────────────────────────
  {
    id: "veo-3.1",
    label: "Veo 3.1",
    family: "veo",
    version: "3.1",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "quoted",
      example: `The detective says: Of all the offices in this town, you had to walk into mine.`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "field",
    maxSeconds: 8,
    bestSeconds: 8,
    camera: "front",
    quirks: [
      "공식 Gemini preview와 Vertex 001 endpoint의 기능·참조·길이 제한은 별개입니다. 선택 endpoint에서 확인하세요.",
      "피사체·행동·카메라·구도·환경·조명·음향을 명확히 쓰며 대사는 따옴표와 화자·언어로 구분합니다.",
      "자막·음성·참조 일관성은 프롬프트만으로 보장하지 않습니다. generateAudio와 negativePrompt 지원은 endpoint 계약을 따릅니다."
],
  },
  {
    id: "veo-3",
    label: "Veo 3",
    family: "veo",
    version: "3",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: { syntax: "quoted", korean: "spoken", maxSpeakers: 2 },
    negative: "field",
    maxSeconds: 8,
    camera: "front",
    quirks: [
      "공식 Veo 3는 deprecated 상태입니다. 지원 중인 실제 relay/endpoint를 확인하고 Veo 3.1 기능을 자동 적용하지 마세요."
],
  },

  // ── OpenAI Sora ───────────────────────────────────────────────────────
  {
    id: "sora-2",
    label: "Sora 2",
    family: "sora",
    version: "2",
    kind: "video",
    doc: true,
    audio: "always",
    dialogue: {
      syntax: "block",
      example: `Dialogue:\n- Detective: "You're lying."`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "inline",
    maxSeconds: 12,
    bestSeconds: 4,
    camera: "either",
    quirks: [
      "공식 Sora 2/Videos API는 2026-09-24 종료되었습니다. 보관 가이드이며 현재 사용 가능한 공식 경로로 제안하지 않습니다.",
      "다른 relay의 지원은 별도 확인이 필요하며 폐지된 공식 endpoint 지원을 보장하지 않습니다."
],
  },

  // ── Kuaishou Kling ────────────────────────────────────────────────────
  {
    id: "kling-3.0",
    label: "Kling 3.0",
    family: "kling",
    version: "3.0",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "labeled",
      example: `[형사, 낮고 눌린 목소리]: "이제 그만하죠."`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "inline",
    maxSeconds: 15,
    bestSeconds: 10,
    camera: "back",
    quirks: [
      "공식 native audio 언어에 중국어·영어·일본어·한국어·스페인어가 포함됩니다.",
      "화자 이름과 음색·말하는 순서를 안정적으로 구분하고 연기 강도를 구체적으로 제한합니다.",
      "First/last frame·Elements·MultiShot·motion control은 해당 endpoint와 mode의 입력 계약을 따릅니다.",
      "negative_prompt는 버전과 endpoint에 따라 다릅니다. 실제 연결되지 않은 별도 입력을 만들어내지 마세요."
],
  },
  {
    id: "kling-2.6",
    label: "Kling 2.6",
    family: "kling",
    version: "2.6",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "labeled",
      example: `[Black-suited Agent, raspy, deep voice]: "Don't move."`,
      korean: "translated",
      maxSpeakers: 2,
    },
    negative: "field",
    maxSeconds: 10,
    bestSeconds: 10,
    camera: "back",
    quirks: [
      "공식 native audio 언어는 중국어·영어입니다. 한국어 음성을 보장하지 않습니다.",
      "Kling 3.0의 다국어/Elements 계약을 자동 적용하지 않습니다."
],
  },
  {
    id: "kling-2.5",
    label: "Kling 2.5 이하",
    family: "kling",
    version: "2.5",
    kind: "video",
    doc: false,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "field",
    maxSeconds: 10,
    camera: "back",
    quirks: [
      "**무음입니다.** 대사를 적어도 입만 움직이거나 무시됩니다.",
      "립싱크는 별도 기능으로 붙입니다. 얼굴이 여럿이면 골라서 입힐 수 있습니다.",
    ],
  },

  // ── MiniMax ───────────────────────────────────────────────────────────
  {
    id: "minimax-h3",
    label: "MiniMax-H3",
    family: "minimax",
    version: "H3",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "tagged",
      example: `The woman (S1) says: <d>[Korean] 다음 역에서 내려요.</d>`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "unsupported",
    maxSeconds: 15,
    bestSeconds: 10,
    camera: "either",
    quirks: [
      "H3의 대사·오디오 계약과 Hailuo 2.3의 무음 영상 계약은 별개입니다. 선택 모델과 loader를 확인하세요.",
      "H3 대사 태그와 한국어 원문을 보존하며 음색·행동·음향을 구분합니다.",
      "별도 negative 입력을 지원한다고 가정하지 않습니다. Comfy graph에 연결된 역할의 negativeSupport를 우선합니다."
],
  },
  {
    id: "hailuo-2.3",
    label: "Hailuo 02 · 2.3",
    family: "minimax",
    version: "2.3",
    kind: "video",
    doc: true,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "unsupported",
    maxSeconds: 10,
    camera: "bracket",
    quirks: [
      "무음 모델입니다. positive prompt 최대 2,000자이며 negative_prompt가 없습니다.",
      "카메라를 대괄호로 적고 한 괄호에 최대 세 움직임을 둡니다.",
      "First/last frame은 Hailuo 02의 별도 입력이며 Hailuo 2.3 I2V의 first image 지원과 혼동하지 마세요."
],
  },

  // ── Alibaba Wan ───────────────────────────────────────────────────────
  {
    id: "wan-2.5",
    label: "Wan 2.5 이상",
    family: "wan",
    version: "2.5",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "quoted",
      example: `He says, "Study hard," in a relaxed tone, at a moderate speed, with a clear voice.`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "field",
    maxSeconds: 10,
    camera: "either",
    quirks: [
      "Hosted preview의 positive 최대 1,500자와 negative 입력을 구분하며 5/10초·첫 이미지·audio_url은 해당 endpoint에서 확인합니다.",
      "R2V·끝 프레임·로컬 Wan 2.2 기능을 이 endpoint에 자동 적용하지 않습니다."
],
  },
  {
    id: "wan-2.2",
    label: "Wan 2.2",
    family: "wan",
    version: "2.2",
    kind: "video",
    doc: true,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "field",
    maxSeconds: 5,
    camera: "either",
    quirks: [
      "표준 T2V/I2V는 무음입니다. 로컬 Animate·S2V·hosted KF2V는 별도 graph와 모델입니다.",
      "Hosted positive 800자와 로컬 Comfy 입력 한도는 별개입니다. negative는 실제 conditioning 역할에 연결된 경우에 적용합니다."
],
  },

  // ── Lightricks LTX ────────────────────────────────────────────────────
  {
    id: "ltx-2.5",
    label: "LTX 2.5",
    family: "ltx",
    version: "2.5",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "segmented",
      example: `He speaks in a slow, weary voice, "I never told you this..." He pauses and looks at his hands, then continues, "but I almost left."`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "unsupported",
    maxSeconds: 10,
    camera: "either",
    quirks: [
      "현재 시제의 시간순 4~8문장으로 피사체·동작·카메라·종료 자세를 씁니다.",
      "Hosted API는 별도 negative 입력이 없지만 local Comfy graph는 negative conditioning을 연결할 수 있습니다.",
      "First/last·A2V·자동 길이·audio mute는 선택 endpoint/graph의 입력 계약을 따릅니다."
],
  },

  // ── ByteDance Seedance ────────────────────────────────────────────────
  {
    id: "seedance-2.5",
    label: "Seedance 2.5",
    family: "seedance",
    version: "2.5",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: {
      syntax: "braced",
      example: `Shot 1 (0-3s): the woman says {I told you already}.`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "inline",
    /*
      **30초입니다.** 규칙표에 15 로 적혀 있었는데 같은 앱의 모델 문서는 30 이라고
      말하고 있었습니다(2026-09-21 점검). 2.5 는 «짧은 클립» 모델이 아니라 30초짜리
      한 편을 쓰는 모델이라, 15 로 두면 컷 길이 안내와 프롬프트가 통째로 어긋납니다.
    */
    maxSeconds: 30,
    bestSeconds: 10,
    camera: "either",
    quirks: [
      "Shot 번호와 정수 초 구간을 사용합니다. 대사 {}·효과음 <>·음악 ()·자막 〖〗를 구분합니다.",
      "비중국어 대사의 언어를 명시하고 2~3개 안정된 외형 특징과 참조 역할을 일관되게 유지합니다.",
      "제공자의 이미지30/영상10/오디오10 입력 지원이 Magnific에서도 지원된다는 뜻은 아닙니다."
],
  },
  {
    id: "seedance-2.0",
    label: "Seedance 2.0",
    family: "seedance",
    version: "2.0",
    kind: "video",
    doc: true,
    audio: "optional",
    dialogue: { syntax: "quoted", korean: "spoken", maxSpeakers: 2 },
    negative: "inline",
    maxSeconds: 15,
    camera: "either",
    quirks: [
      "Shot 번호를 사용하며 타임스탬프나 2.5의 기호 계약을 자동 적용하지 않습니다.",
      "참조 역할과 2~3개 안정된 외형 특징을 구분합니다. 제공자 9이미지/3영상/3오디오 한도가 Magnific 한도는 아닙니다."
],
  },

  // ── Runway ────────────────────────────────────────────────────────────
  {
    id: "runway-gen4.5",
    label: "Runway Gen-4.5",
    family: "runway",
    version: "4.5",
    kind: "video",
    doc: true,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "unsupported",
    maxSeconds: 10,
    camera: "front",
    quirks: [
      "I2V는 첫 이미지의 외형을 반복하기보다 피사체·환경·카메라의 동작을 긍정으로 적습니다.",
      "Native 끝 프레임·오디오·negative 입력은 확인되지 않았습니다. 별도 edit/motion 경로와 혼동하지 마세요."
],
  },
];

/**
 * **품질 수식어** — 정보를 주지 않으면서 «예쁜 쪽» 편향만 강화하는 말들.
 *
 * 요즘 상용 모델은 **수천 장의 극히 매력적인 이미지로 추가 미세조정**해서 나옵니다
 * (Meta 의 Emu 논문). 그래서 가만두면 늘 광고 사진이 나옵니다. 여기에 「8k」·
 * 「masterpiece」 를 또 얹으면 **바로 그 편향을 더 밉니다.**
 *
 * `masterpiece, best quality` 는 원래 **애니 태그 체계**에서 온 말이라 실사 모델에는
 * 맞지도 않습니다. 「무조건 나빠진다」 를 통제 실험으로 잰 연구는 없습니다 — 정확히는
 * **아무 정보도 주지 않으면서 이미 기울어진 쪽으로 더 민다** 입니다.
 */
const FILLER_WORDS = [
  "8k",
  "4k",
  "ultra realistic",
  "ultra-realistic",
  "hyperrealistic",
  "hyper realistic",
  "hyperdetailed",
  "hyper detailed",
  "ultra detailed",
  "masterpiece",
  "best quality",
  "award winning",
  "award-winning",
  "photorealistic",
  "highly detailed",
];

/** 이 말 대신 무엇을 적으면 되는가. «구체적인 촬영 상황» 이 늘 답입니다. */
const FILLER_INSTEAD =
  "대신 촬영 상황을 구체로 적으세요 — 렌즈(`50mm`)·필름(`fine grain, subtle halation`)·피부(`visible pores, fine peach fuzz`)·광원(`north-facing window on camera left`).";

/**
 * 프롬프트에서 **뺄 말**을 찾아 줍니다.
 *
 * 지우지는 않습니다 — 사람이 일부러 넣었을 수 있으니 **알려만 주고** 판단은 맡깁니다.
 */
export function findFillerWords(prompt: string): { words: string[]; hint: string } | null {
  const text = prompt.toLowerCase();
  const found = FILLER_WORDS.filter((word) => text.includes(word));
  if (!found.length) return null;
  return {
    words: found,
    hint: `${found.join(" · ")} 은(는) 정보를 주지 않고 «예쁜 쪽» 편향만 강화합니다. ${FILLER_INSTEAD}`,
  };
}

/** id 로 찾습니다. 모르는 id 면 null. */
export function modelRuleOf(id: string | null | undefined): ModelRule | null {
  if (!id) return null;
  return MODEL_RULES.find((item) => item.id === id) ?? null;
}

/**
 * **모델 이름으로 규칙을 찾습니다.**
 *
 * 마그니픽은 제 나름의 이름을 씁니다(`Kling 2.5`, `Veo 3.1 Fast` …). 그 이름을
 * 우리 id 로 미리 다 짝지어 둘 수는 없습니다 — 새 모델이 계속 생기니까요. 그래서
 * **계열 낱말과 판 번호로 알아봅니다.** 못 알아보면 `null` 이고, 그때는 어느 모델에나
 * 통하는 모양으로 짓습니다(여태 하던 그대로).
 */
export function matchModelRule(text: string | null | undefined): ModelRule | null {
  if (!text || /music|acestep|suno/i.test(text)) return null;
  /*
    **판 번호의 점과 하이픈을 같게 봅니다.**

    2026-09-21 실측에서 `seedance-2-5-pro`(마그니픽 슬러그)가 **Seedance 2.0 으로**
    되짚혔습니다 — `has("2.5")` 가 `2-5` 를 못 봤기 때문입니다. 슬러그는 점을 못 쓰니
    하이픈으로 적는데, 그걸 모르면 MCP 로 고른 옛 값이 전부 낮은 판으로 떨어집니다.
  */
  const name = text.toLowerCase().replace(/(\d)-(\d)/g, "$1.$2");
  const has = (...words: string[]) => words.some((word) => name.includes(word));
  const pick = (id: string) => modelRuleOf(id);

  if (has("veo")) return pick(has("3.1") ? "veo-3.1" : "veo-3");
  if (has("sora")) return pick("sora-2");
  if (has("kling", "클링")) {
    if (has("3.")) return pick("kling-3.0");
    if (has("2.6")) return pick("kling-2.6");
    // 2.5·2.1·1.x 는 규칙이 같습니다 — 한 줄로 묶어 두었습니다.
    if (has("2.", "1.")) return pick("kling-2.5");
    return pick("kling-3.0");
  }
  // 「H3」 와 「Hailuo 02」 는 같은 집 모델인데 소리를 만드는지가 다릅니다.
  if (has("h3", "hailuo 3", "minimax 3")) return pick("minimax-h3");
  if (has("hailuo", "minimax")) return pick("hailuo-2.3");
  if (has("wan")) return pick(has("2.2", "2.1") ? "wan-2.2" : "wan-2.5");
  if (has("ltx")) return pick("ltx-2.5");
  if (has("seedance")) return pick(has("2.5") ? "seedance-2.5" : "seedance-2.0");
  if (has("runway", "gen-4", "gen4")) return pick("runway-gen4.5");
  return null;
}

/** 같은 계열의 판들을 새 판부터. 「이 판은 이랬다」를 견주는 데 씁니다. */
export function versionsOf(family: string): ModelRule[] {
  return MODEL_RULES.filter((item) => item.family === family);
}

/**
 * 이 모델에 **대사를 적어도 소리가 나는가.**
 *
 * 안 나는 모델에 대사를 보내면 자막으로 박히거나 그냥 버려집니다. 그때는 대사를
 * 빼고 입 모양·표정만 남겨야 합니다.
 */
export function speaksDialogue(rule: ModelRule | null): boolean {
  return Boolean(rule && rule.audio !== "none" && rule.dialogue.syntax !== "none");
}

/**
 * 금지 사항을 **어디에 어떻게** 적을지 한 줄로 답합니다.
 *
 * 부정문이 안 통하는 모델(Runway)에 「~하지 마세요」 를 보내면 오히려 그것이
 * 나옵니다. 그래서 조립하는 쪽이 이 값을 보고 갈라야 합니다.
 */
export function negativeStyleOf(rule: ModelRule | null): {
  where: NegativeSupport;
  hint: string;
} {
  const where = rule?.negative ?? "inline";
  const hint =
    where === "field"
      ? "네거티브 칸에 **명사만** 나열합니다. 「no」·「don't」 는 쓰지 마세요."
      : where === "unsupported"
        ? "부정문이 통하지 않습니다. **원하는 것을 긍정으로** 적으세요."
        : "네거티브 칸이 없습니다. 본문 끝에 부정문으로 붙입니다.";
  return { where, hint };
}

/**
 * 이 길이가 그 모델에서 **한 번에 나오는가.**
 *
 * 넘치면 잘리거나 배속으로 돌아갑니다. 조립하는 쪽이 미리 알려 줄 수 있게
 * 「몇 초까지」와 「권장 길이」를 함께 돌려줍니다.
 */
export function fitSeconds(
  rule: ModelRule | null,
  seconds: number,
): { ok: boolean; max: number; best?: number; note?: string } {
  if (!rule) return { ok: true, max: seconds };
  const ok = seconds <= rule.maxSeconds;
  return {
    ok,
    max: rule.maxSeconds,
    best: rule.bestSeconds,
    note: ok
      ? undefined
      : `${rule.label} 은(는) 한 번에 ${rule.maxSeconds}초까지입니다. ${seconds.toFixed(1)}초는 나눠 뽑아야 합니다.`,
  };
}

/**
 * 영문 프롬프트에 **한국어가 섞였는지** 봅니다.
 *
 * 규칙으로 조립하는 길은 **번역을 못 합니다.** 사람이 한국어로 적어 둔 컷 제목·설명·
 * 대사·VFX 가 영문 칸에도 그대로 들어갑니다. 지워 버리면 영문 프롬프트가 알맹이를
 * 잃으므로 **버리지 않고 알려만 줍니다** — 어느 쪽을 고를지는 사람이 정합니다.
 *
 * 영문에 한국어가 섞이면 생성기가 그 부분만 통째로 무시합니다. 운이 나쁘면 글자를
 * 그림에 그려 넣습니다. 태그(`@냥이_001`)와 인물 이름은 **일부러 남긴 것**이라
 * 여기서 세지 않습니다.
 */
export function koreanInEnglish(en: string): { chunks: string[]; hint: string } | null {
  // 태그와 그 뒤에 붙은 조사는 일부러 둔 것입니다 — 빼고 봅니다.
  const cleaned = en.replace(/@[^\s,.]+/g, " ");
  const found = cleaned.match(/[가-힣][가-힣\s]{3,}/g);
  if (!found) return null;
  const chunks = [...new Set(found.map((item) => item.trim()))].filter((item) => item.length > 3);
  if (!chunks.length) return null;
  return {
    chunks: chunks.slice(0, 5),
    hint:
      "영문 프롬프트에 한국어가 섞였습니다. 생성기가 그 부분을 통째로 무시하거나 글자로 그려 넣습니다. " +
      "«프롬프트 받기» 로 다시 지으면 영어로 옮겨 적습니다 — 규칙 조립은 번역을 못 합니다.",
  };
}

/**
 * **이 작품을 무슨 모델로 뽑는가** — 고르개에 세울 목록.
 *
 * , 「컷, 씬에서도… 영상의 경우 모델이 선택이 되어야 요청할 때 해당 모델로
 * 프롬프트를 받지? 이미지도 마찬가지」, 「구성 버튼 누르면 앞에서 정한 모델이 선택되어서
 * 마그니픽에서 구성되어야하고」.
 *
 * # 왜 이 표가 필요한가
 *
 * 모델별 규칙(`MODEL_RULES`)도, 모델 문서(`prompts/models/*.md`)도, 대사 문법
 * (`dialogueShape`)도 **모두 «모델 id» 하나를 받으면 동작합니다.** 그런데 그 id 를
 * **정하는 자리가 없었습니다.** 마그니픽 MCP 에 연결했을 때만 고를 수 있었고, 「차려 놓기」
 * 로 쓰면 아무도 안 골라서 — 2026-09-21 화면 실측 — 컷 예순두 개의 영상 프롬프트가
 * 전부 **모델 모양 없이** 만들어졌습니다. 애써 적어 둔 규칙이 통째로 잠자고 있었습니다.
 *
 * 그래서 **연결 여부와 상관없이** 고를 수 있는 목록을 여기 둡니다.
 *
 * # 마그니픽 슬러그는 아는 것만 적습니다
 *
 * 「구성」 으로 마그니픽 생성기를 차려 줄 때 그 모델을 골라 두려면 마그니픽이 쓰는
 * 슬러그가 필요합니다. **모르는 것을 짐작해 적으면 «그런 모델 없음» 으로 구성이 통째로
 * 실패합니다.** 그래서 확인한 것만 적고, 없으면 마그니픽 기본값으로 두고 사람에게
 * 「거기서 직접 고르세요」 라고 말합니다. MCP 에 연결하면 진짜 목록이 오므로 그때는
 * 그쪽이 이깁니다.
 */
export interface TargetModel {
  providerModelId?: string;
  aliases?: readonly string[];
  guideOnly?: boolean;
  /** `MODEL_RULES` 의 id 이자 `prompts/models/<id>.md` 의 이름. */
  id: string;
  label: string;
  kind: "image" | "video";
  /** 마그니픽이 쓰는 슬러그. 확인한 것만 있습니다. */
  magnific?: string;
  /** 규칙과 문서가 다 있는가. 없으면 프롬프트가 «어느 모델에나 통하는 모양» 으로 갑니다. */
  guided: boolean;
}

const IMAGE_TARGETS: TargetModel[] = [
  { id: "nano-banana", label: "Nano Banana Pro", kind: "image", magnific: "imagen-nano-banana-2", guided: true },
  { id: "nano-banana-2.1", label: "Nano Banana 2.1", aliases: ["Google Nano Banana 2.1"], kind: "image", providerModelId: "gemini-nano-banana-2.1", magnific: "imagen-nano-banana-2-1", guided: true },
  { id: "gpt-image", label: "GPT 2.5 Image", kind: "image", magnific: "gpt-2", guided: true },
  // 미드저니는 디스코드로만 돌아서 «구성» 으로 못 보냅니다 — 프롬프트만 복사해 갑니다.
  { id: "midjourney", label: "Midjourney", kind: "image", guided: true },
];

/** 마그니픽에서 확인한 슬러그. 나머지는 비워 둡니다 — 짐작해 적으면 구성이 실패합니다. */
const KNOWN_MAGNIFIC: Record<string, string> = {
  "seedance-2.5": "seedance-2-5-pro",
};

export function targetModels(kind: "image" | "video"): TargetModel[] {
  if (kind === "image") return IMAGE_TARGETS;
  return MODEL_RULES.filter((rule) => rule.kind === "video").map((rule) => ({
    id: rule.id,
    label: rule.label,
    kind: "video" as const,
    magnific: KNOWN_MAGNIFIC[rule.id],
    guided: rule.doc,
  }));
}

/** 고른 모델 하나. 못 찾으면 null — 그때는 어느 모델에나 통하는 모양으로 짓습니다. */
export function targetModelOf(id?: string | null): TargetModel | null {
  if (!id) return null;
  const all = [...targetModels("video"), ...targetModels("image")];
  /*
    세 가지 꼴을 다 받습니다 — 우리 id(`seedance-2.5`), **마그니픽 슬러그**
    (`seedance-2-5-pro`·`imagen-nano-banana-2`), 그리고 사람이 적은 이름.
    슬러그는 MCP 로 골라 둔 **옛 작품**에 저장돼 있어서, 못 받으면 그 작품들이
    모델을 통째로 잃습니다.
  */
  return (
    all.find((item) => item.id === id) ??
      all.find((item) => item.magnific === id) ??
      all.find((item) => item.providerModelId === id) ??
    all.find((item) => item.label === id || item.aliases?.includes(id)) ?? null
  );
}

/**
 * 영상 모델 id → 규칙 id. 우리 id(`seedance-2.5`)와 마그니픽 슬러그(`seedance-2-5-pro`) 둘 다 옵니다 —
 * 예전 작품은 MCP 로 고른 슬러그를 저장하고 있어서요. 되짚는 규칙은 여기 한 벌입니다.
 */
export function videoRuleIdOf(videoModel?: string | null): string | undefined {
  const local: Record<string, string> = { minimaxh3: "minimax-h3", wanvideo: "wan-2.2", ltx25: "ltx-2.5" };
  return videoModel && local[videoModel] ? local[videoModel] : targetModelOf(videoModel ?? undefined)?.id ?? videoModel ?? undefined;
}

/**
 * 고른 영상 모델이 **한 번에 뽑는 상한(초)**.
 *
 * 여태 일괄 생성 2단계는 모델을 모른 채 「1~10초」 로 못 박혀 있었습니다 — 규칙 표에는
 * 30초가 적혀 있는데 요청에 실리지 않았습니다. 모델을 모르면 null — 요청 문구가 10초로 봅니다.
 */
export function videoClipLimitOf(videoModel?: string | null): { label: string; maxSeconds: number } | null {
  const rule = modelRuleOf(videoRuleIdOf(videoModel));
  return rule ? { label: rule.label, maxSeconds: rule.maxSeconds } : null;
}
