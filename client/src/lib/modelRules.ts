/**
 * **모델별·버전별 프롬프트 규칙표.**
 *
 *
 *
 * # 왜 문서가 아니라 표인가
 *
 * 규칙은 이미 `prompts/models/*.md` 에 글로 적혀 있습니다. 그런데 글은 **사람과
 * LLM 만** 읽습니다. 우리 앱이 규칙 없이 조립하는 길(`buildCutVideoPrompt`)과
 * API 로 보내는 길은 그 글을 못 읽습니다. 그래서 «기계가 쓰는 사실»만 여기 표로
 * 두고, 문서는 «왜 그런가» 를 맡습니다. **둘이 어긋나면 이 표가 사실입니다.**
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
    audio: "always",
    dialogue: {
      syntax: "colon",
      example: `The detective says: Of all the offices in this town, you had to walk into mine.`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "field",
    maxSeconds: 8,
    bestSeconds: 8,
    camera: "front",
    quirks: [
      "대사를 **자막으로 태워 넣습니다.** 지워지지 않습니다 — 자막이 프레임에 구워진 영상으로 배웠기 때문입니다.",
      "오디오를 **끌 수 없습니다.**",
      "네거티브 칸에 「no」·「don't」 를 쓰면 안 됩니다. 원치 않는 것을 **명사로만** 나열합니다.",
      "네거티브 칸은 Vertex AI 에만 있습니다. Gemini API 에는 없습니다.",
      "입력 상한이 약 1,024 토큰이라 **꼬리에 둔 대사가 먼저 잘립니다.**",
      "타임스탬프로 구간을 나눌 수 있습니다 — 구간마다 `Emotion:` 과 `SFX:` 를 한 줄씩.",
    ],
  },
  {
    id: "veo-3",
    label: "Veo 3",
    family: "veo",
    version: "3",
    kind: "video",
    doc: false,
    audio: "always",
    dialogue: { syntax: "quoted", korean: "spoken", maxSpeakers: 2 },
    negative: "field",
    maxSeconds: 8,
    camera: "front",
    quirks: ["3.1 과 같은 자막 문제. 타임스탬프 구간 나누기는 3.1 쪽이 낫습니다."],
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
      "공식 권고가 **「8초 한 번보다 4초 두 개를 이어 붙이는 쪽이 낫다」** 입니다.",
      "한 생성에 인물 **둘 이하**를 권합니다.",
      "자막을 피하는 법은 공식 문서가 **전혀 다루지 않습니다.**",
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
      "**한국어를 한국어로 잘 말합니다**(실사용으로 확인). 2.6 문서의 「중국어·영어만」 제약을 여기 옮기지 마세요.",
      "**연기가 과장됩니다.** 톤 라벨은 하나만, 강도 말(`slight`·`subtle`)을 앞에 붙이고, 그래도 과하면 감정 이름을 빼세요.",
      "화자가 바뀌는 자리에 `Immediately, as the speaker switches` 를 안 넣으면 **한 사람이 계속 말합니다.**",
      "라벨은 고유하게. 대명사나 비슷한 다른 말로 부르면 화자가 섞입니다.",
      "API 에는 네거티브 칸이 없습니다(옛 판에만 있습니다). 본문에 부정문으로 넣습니다.",
    ],
  },
  {
    id: "kling-2.6",
    label: "Kling 2.6",
    family: "kling",
    version: "2.6",
    kind: "video",
    doc: false,
    audio: "optional",
    dialogue: {
      syntax: "labeled",
      example: `[Black-suited Agent, raspy, deep voice]: "Don't move."`,
      korean: "translated",
      maxSpeakers: 2,
    },
    negative: "inline",
    maxSeconds: 15,
    bestSeconds: 10,
    camera: "back",
    quirks: [
      "**한국어를 영어로 번역해서 발음합니다.** 소리로 내는 언어는 중국어·영어뿐입니다(공식).",
      "3.0 과 대사 문법은 같습니다 — 다른 것은 언어뿐입니다.",
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
    doc: false,
    audio: "optional",
    dialogue: {
      syntax: "tagged",
      example: `The woman (S1) says: <d>[Korean] 다음 역에서 내려요.</d>`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "inline",
    maxSeconds: 15,
    bestSeconds: 10,
    camera: "either",
    quirks: [
      "`<d>` 안에는 **언어 태그와 대사 원문만** 넣습니다. 연출·행동·음색은 전부 밖에.",
      "대사의 단어와 문장부호를 **한 글자도 바꾸지 마세요**(공식).",
      "**호흡·웃음·헐떡임은 화면 묘사가 아니라 소리 칸**(`overall_soundscape`)에 적습니다.",
      "입을 안 움직이게 하려면 `while his lips remain completely closed` 를 붙입니다 — 보이스오버의 공식 방법.",
      "길이는 5~15초 사이로 스냅됩니다(프레임 수가 17n+5).",
    ],
  },
  {
    id: "hailuo-2.3",
    label: "Hailuo 02 · 2.3",
    family: "minimax",
    version: "2.3",
    kind: "video",
    doc: false,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "inline",
    maxSeconds: 10,
    camera: "bracket",
    quirks: [
      "**무음입니다.**",
      "카메라를 대괄호로 적습니다 — `[Push in]`, `[Pan left,Pedestal up]`. 한 괄호에 **최대 세 개**.",
    ],
  },

  // ── Alibaba Wan ───────────────────────────────────────────────────────
  {
    id: "wan-2.5",
    label: "Wan 2.5 이상",
    family: "wan",
    version: "2.5",
    kind: "video",
    doc: false,
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
      "공식 공식이 있습니다 — **대사 + 감정 + 톤 + 속도 + 음색 + 억양**을 한 문자열로.",
      "다인물 규칙은 Kling 과 같습니다(라벨 고유·행동 먼저·톤 분리·`Immediately,` 로 순서 고정).",
      "가중치가 비공개라 **API 로만** 씁니다.",
    ],
  },
  {
    id: "wan-2.2",
    label: "Wan 2.2",
    family: "wan",
    version: "2.2",
    kind: "video",
    doc: false,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "field",
    maxSeconds: 5,
    camera: "either",
    quirks: [
      "**소리를 안 만듭니다.** 우리 앱에 탑재된 로컬 판이 이것입니다.",
      "립싱크 판(S2V)은 소리를 **입력으로 받습니다** — 음성을 따로 준비해야 합니다.",
    ],
  },

  // ── Lightricks LTX ────────────────────────────────────────────────────
  {
    id: "ltx-2.5",
    label: "LTX 2.5",
    family: "ltx",
    version: "2.5",
    kind: "video",
    doc: false,
    audio: "optional",
    dialogue: {
      syntax: "segmented",
      example: `He speaks in a slow, weary voice, "I never told you this..." He pauses and looks at his hands, then continues, "but I almost left."`,
      korean: "spoken",
      maxSpeakers: 2,
    },
    negative: "inline",
    maxSeconds: 10,
    camera: "either",
    quirks: [
      "**한 문장을 통째로 따옴표에 넣으면 낭독이 됩니다.** 구 → 연기 지시 → 구 로 끊으세요.",
      "시선을 바꾸는 지시는 **구와 구 사이에만** 먹습니다. 말하는 도중에는 무시됩니다.",
      "**오디오 지시는 프롬프트 맨 끝에** 둡니다(다른 모델과 반대입니다).",
      "한 비트에 지시 셋을 넣으면 연기가 경련처럼 됩니다.",
      "립싱크가 필요하면 **컷을 나누지 말고 단일 연속 테이크**로.",
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
      "기호로 갈라 적습니다 — 대사 `{}` · 효과음 `<>` · 음악 `（）` · 자막 `【】`.",
      "컷마다 **정수 초 구간**을 붙입니다 — `Shot 1 (0-3s):`.",
      "**칸을 빠뜨리면 정해진 방식으로 망가집니다** — 장소가 막연하면 컷마다 딴 곳, 카메라를 안 적으면 그 컷이 실패, 첫 프레임·블로킹이 없으면 동작을 시작하지 못합니다.",
      "인물 자리를 **화면 백분율**로 못 박을 수 있습니다 — `THE WOMAN 화면 왼쪽, x 42%, y 44%`.",
      "좌우 방향이 컷마다 뒤집히면 다중 컷이 통째로 흐트러집니다.",
      "공식이 **「자막을 100% 없애는 것은 불가능」** 이라고 인정합니다.",
      "중국어와 영어를 섞지 마세요(고유명사 제외).",
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
    dialogue: { syntax: "braced", korean: "spoken", maxSpeakers: 2 },
    negative: "inline",
    maxSeconds: 12,
    camera: "either",
    quirks: ["2.5 와 같은 기호를 쓰되 **초 구간 표기가 없습니다.**"],
  },

  // ── Runway ────────────────────────────────────────────────────────────
  {
    id: "runway-gen4.5",
    label: "Runway Gen-4.5",
    family: "runway",
    version: "4.5",
    kind: "video",
    doc: false,
    audio: "none",
    dialogue: { syntax: "none", korean: "unsupported" },
    negative: "unsupported",
    maxSeconds: 10,
    camera: "front",
    quirks: [
      "**소리를 안 만듭니다.** 대사 문법 자체가 없습니다.",
      "**부정문이 통하지 않습니다.** `not blurry` 가 아니라 `sharp focus` 로, `No camera movement` 가 아니라 `Locked camera. The camera remains still.` 로 적습니다.",
      "**JSON 으로 적어도 소용없습니다** — 생성 모델이 형식을 무시합니다(공식 FAQ).",
      "넣은 그림에 이미 있는 것을 다시 묘사하지 마세요. 인물은 `the subject` 처럼 일반 지칭으로.",
      "표정 비트를 초로 찍을 수 있습니다 — `[00:03 through 00:04] black eyes squint`.",
    ],
  },
];

/**
 * **품질 수식어** — 정보를 주지 않으면서 «예쁜 쪽» 편향만 강화하는 말들.
 *
 *
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
  if (!text) return null;
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
 *
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
    (matchModelRule(id) ? all.find((item) => item.id === matchModelRule(id)!.id) ?? null : null)
  );
}

/**
 * 영상 모델 id → 규칙 id. 우리 id(`seedance-2.5`)와 마그니픽 슬러그(`seedance-2-5-pro`) 둘 다 옵니다 —
 * 예전 작품은 MCP 로 고른 슬러그를 저장하고 있어서요. 되짚는 규칙은 여기 한 벌입니다.
 */
export function videoRuleIdOf(videoModel?: string | null): string | undefined {
  return targetModelOf(videoModel ?? undefined)?.id ?? matchModelRule(videoModel)?.id;
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
