import type { Vector3Value } from "@/lib/composition";
import { lerp, lerpVector, segmentAt } from "@/lib/keyframes";

/**
 * 카메라 무빙 모델.
 *
 * 두 단계로 나눕니다.
 * - 샷 프리셋: 카메라가 "어디서 어디로" 가는가 (공간)
 * - 모션 커브: "어떻게" 가는가 (시간)
 *
 * 같은 달리 인이라도 커브가 리니어면 기계적이고, 이즈아웃이면 부드럽게 멈춥니다.
 * 분리해두면 조합이 곱셈으로 늘어납니다.
 */

// ─────────────────────────────────────────────────────────────
// 모션 커브 (시간)
// ─────────────────────────────────────────────────────────────

/**
 * 애프터이펙트 속도 그래프와 같은 3차 베지어 이징.
 * (0,0) 과 (1,1) 을 잇는 곡선의 제어점 두 개만 저장합니다.
 */
export interface EasingCurve {
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
}

export const EASING_PRESETS: {
  id: string;
  label: string;
  hint: string;
  curve: EasingCurve;
  /** 프롬프트에 그대로 들어갈 영어 말. 속도 곡선을 생성기에 전할 유일한 길입니다. */
  en: string;
  /** 같은 말의 한국어. 화면과 블렌더 안내문에 씁니다. */
  enKo: string;
}[] = [
  {
    id: "linear",
    label: "리니어",
    hint: "일정한 속도. 기계적이고 인위적인 느낌",
    curve: { p1x: 0, p1y: 0, p2x: 1, p2y: 1 },
    en: "at a constant speed",
    enKo: "등속",
  },
  {
    id: "easeInOut",
    label: "이즈 인·아웃",
    hint: "천천히 시작해 천천히 멈춤. 가장 무난한 기본값",
    curve: { p1x: 0.42, p1y: 0, p2x: 0.58, p2y: 1 },
    en: "easing in and easing out",
    enKo: "부드럽게 시작해 부드럽게 멈춤",
  },
  {
    id: "easeOut",
    label: "이즈 아웃",
    hint: "빠르게 출발해 부드럽게 정지",
    curve: { p1x: 0, p1y: 0, p2x: 0.4, p2y: 1 },
    en: "starting fast and easing to a stop",
    enKo: "빠르게 출발해 부드럽게 정지",
  },
  {
    id: "easeIn",
    label: "이즈 인",
    hint: "천천히 출발해 가속하며 끝",
    curve: { p1x: 0.6, p1y: 0, p2x: 1, p2y: 1 },
    en: "starting slowly and accelerating",
    enKo: "천천히 출발해 가속",
  },
  {
    id: "slowStart",
    label: "슬로우 스타트",
    hint: "한참 머물다 후반에 확 움직임",
    curve: { p1x: 0.85, p1y: 0.02, p2x: 1, p2y: 1 },
    en: "almost still at first, then moving in the final beat",
    enKo: "한참 머물다 후반에 확",
  },
  {
    id: "snapStop",
    label: "급가속 후 정지",
    hint: "빠르게 치고 나가 급히 멈춤. 긴장감",
    curve: { p1x: 0.02, p1y: 0.7, p2x: 0.2, p2y: 1 },
    en: "snapping into motion and stopping hard",
    enKo: "급가속 후 급정지",
  },
  {
    id: "anticipate",
    label: "예비 동작",
    hint: "살짝 뒤로 뺐다가 나아감",
    curve: { p1x: 0.6, p1y: -0.28, p2x: 0.4, p2y: 1 },
    en: "pulling back slightly before it moves",
    enKo: "살짝 뒤로 뺐다가",
  },
  {
    id: "overshoot",
    label: "오버슛",
    hint: "목표를 지나쳤다가 되돌아와 안착",
    curve: { p1x: 0.34, p1y: 1.4, p2x: 0.64, p2y: 1 },
    en: "overshooting slightly, then settling",
    enKo: "지나쳤다가 되돌아와 안착",
  },
];

export const DEFAULT_EASING = EASING_PRESETS[1].curve;

/**
 * 3차 베지어 이징을 t(0~1)에 대해 계산합니다.
 *
 * 베지어는 x·y 가 모두 매개변수 s 의 함수라, "시간 x 일 때의 진행률 y"를 얻으려면
 * x(s) = t 가 되는 s 를 먼저 찾아야 합니다. 뉴턴법으로 몇 번 좁히고,
 * 수렴이 나쁜 구간은 이분법으로 보정합니다(브라우저 CSS 이징과 같은 방식).
 */
export function evaluateEasing(curve: EasingCurve, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;

  const bezier = (a: number, b: number, s: number) => {
    const inv = 1 - s;
    return 3 * inv * inv * s * a + 3 * inv * s * s * b + s * s * s;
  };
  const slope = (a: number, b: number, s: number) => {
    const inv = 1 - s;
    return 3 * inv * inv * a + 6 * inv * s * (b - a) + 3 * s * s * (1 - b);
  };

  let s = clamped;
  for (let i = 0; i < 8; i += 1) {
    const x = bezier(curve.p1x, curve.p2x, s) - clamped;
    if (Math.abs(x) < 1e-5) break;
    const d = slope(curve.p1x, curve.p2x, s);
    if (Math.abs(d) < 1e-6) break;
    s -= x / d;
  }
  if (s < 0 || s > 1) {
    let low = 0;
    let high = 1;
    s = clamped;
    for (let i = 0; i < 24; i += 1) {
      const x = bezier(curve.p1x, curve.p2x, s);
      if (Math.abs(x - clamped) < 1e-5) break;
      if (x < clamped) low = s;
      else high = s;
      s = (low + high) / 2;
    }
  }
  return bezier(curve.p1y, curve.p2y, s);
}

/** 그래프 미리보기용 샘플. */
export function sampleEasing(curve: EasingCurve, steps = 48) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return { t, value: evaluateEasing(curve, t) };
  });
}

/**
 * **속도 그래프** 샘플 — 애프터이펙트의 «Speed Graph» 와 같은 그림입니다.
 *
 *
 *
 * # 왜 모양이 아예 다른가
 *
 * 지금까지 그리던 것은 «진행률»(값) 곡선이었습니다 — 0 에서 1 로 올라가는 S 자요.
 * 속도 그래프는 그 곡선의 **기울기**(미분)입니다. 이즈 인·아웃이면 진행률은 S 자지만
 * 기울기는 «0 에서 올라갔다 다시 0 으로» 라서 **포물선**이 됩니다. 애프터이펙트가
 * 이쪽을 기본으로 보여 주는 까닭은, 사람이 실제로 느끼는 것이 «지금 얼마나 왔는가» 가
 * 아니라 «지금 얼마나 빠른가» 라서입니다.
 *
 * # 단위 — 1 이 등속입니다
 *
 * 전체 거리를 전체 시간으로 나눈 값(평균 속도)을 1 로 둡니다. 그래서 곡선이 1 위에
 * 있으면 «평균보다 빠른 구간», 아래면 느린 구간입니다. 실제 미터·도 단위로 두면
 * 클립마다 눈금이 달라져 모양을 견줄 수가 없습니다.
 *
 * 끝점(t=0, t=1)에서는 미분이 0/0 이 될 수 있어(이즈 인·아웃), 한 칸 안쪽의
 * 차분으로 잽니다 — 그래서 곡선이 양 끝에서 0 에 닿는 포물선으로 그려집니다.
 */
export function sampleEasingSpeed(curve: EasingCurve, steps = 48) {
  const h = 1 / steps;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const a = Math.max(0, t - h / 2);
    const b = Math.min(1, t + h / 2);
    const speed =
      (evaluateEasing(curve, b) - evaluateEasing(curve, a)) / (b - a);
    return { t, speed };
  });
}

/**
 * 속도 그래프의 **손잡이 두 개** — 애프터이펙트와 같은 뜻입니다.
 *
 * 3차 베지어에서 출발 속도는 `p1y / p1x`, 도착 속도는 `(1 − p2y) / (1 − p2x)` 입니다
 * (t→0, t→1 극한). 애프터이펙트의 속도 그래프에서 손잡이를 위아래로 끄는 것이 바로
 * 이 두 값을 바꾸는 일이고, 좌우로 끄는 것이 «영향(influence)» 곧 `p1x`·`p2x` 입니다.
 *
 * x 가 0 이면 속도가 무한이라 아주 작은 값으로 막습니다.
 */
export function easingSpeedHandles(curve: EasingCurve) {
  const guard = (value: number) => Math.max(0.0001, value);
  return {
    out: { t: curve.p1x, speed: curve.p1y / guard(curve.p1x) },
    in: { t: curve.p2x, speed: (1 - curve.p2y) / guard(1 - curve.p2x) },
  };
}

/** 속도 손잡이를 옮긴 결과를 다시 베지어 제어점으로 되돌립니다. */
export function easingFromSpeedHandle(
  curve: EasingCurve,
  which: "out" | "in",
  next: { t: number; speed: number },
): EasingCurve {
  const t = Math.min(1, Math.max(0, next.t));
  const speed = Math.max(0, next.speed);
  if (which === "out") return { ...curve, p1x: t, p1y: speed * t };
  return { ...curve, p2x: t, p2y: 1 - speed * (1 - t) };
}

// ─────────────────────────────────────────────────────────────
// 샷 프리셋 (공간)
// ─────────────────────────────────────────────────────────────

/**
 * 회전 축.
 * 실무에서 "카메라가 무엇을 중심으로 도는가"가 샷의 인상을 크게 바꿉니다.
 * - y : 수평 공전(오빗). 인물 주위를 도는 가장 흔한 형태
 * - x : 수직 공전. 위아래로 넘어가며 도는 형태
 * - xy : 나선. 돌면서 높이도 함께 변함
 */
export type OrbitAxis = "x" | "y" | "xy";

export type ShotKind =
  /** 앵커를 향해 다가가거나 멀어짐 */
  | "dolly"
  /** 앵커를 중심으로 공전 */
  | "orbit"
  /** 카메라 위치 고정, 바라보는 방향만 회전 */
  | "pan"
  /** 좌우·상하로 평행 이동 */
  | "truck"
  /** 높이만 변경 */
  | "crane"
  /** 화각(초점거리) 변경 */
  | "zoom"
  /** 위치·타깃 모두 고정. 손떨림만 */
  | "static"
  /**
   * 찍어 둔 카메라 자세들을 이어서 지나갑니다 — 프리셋으로 안 되는 무빙.
   *
   * 프리셋은 «앵커를 중심으로 몇 도» 처럼 한 가지 규칙뿐이라, 책상을 돌아 창가로
   * 빠지는 식의 길은 만들 수 없습니다. 자유 클립은 `keys` 에 **절대 자세**를 담고 그 사이를
   * 이어 갑니다.
   */
  | "free";

export interface ShotPreset {
  id: string;
  label: string;
  group: string;
  kind: ShotKind;
  /** 이동량. dolly=거리(m), orbit/pan=각도(도), truck/crane=거리(m), zoom=배율 */
  amount: number;
  axis?: OrbitAxis;
  /** 기본 이징 프리셋 id */
  easing?: string;
  /** 기본 길이(초) */
  duration?: number;
  /** 목록에서 감춥니다. 옛 저장본이 가리키는 프리셋을 살려 두는 자리입니다. */
  hidden?: boolean;
  hint: string;
  /**
   * **프롬프트에 그대로 들어갈 영어 문장.**
   *
   * 여태는 `${preset.id} camera move` 로 나갔습니다 — 그러니까 생성기한테
   * 「push-in-slow camera move」 나 「orbit-vertical camera move」 를 보내고 있었습니다.
   * 그건 우리 내부 이름이지 촬영 용어가 아닙니다. 모델이 못 알아듣고 대충 흔듭니다.
   *
   * 부호로 방향이 갈리는 무빙은 둘로 적습니다(`plus` 는 양수, `minus` 는 음수).
   * 한쪽만 적으면 양쪽에 같은 문장을 씁니다.
   */
  en: { plus: string; minus?: string };
}

/**
 * 사라진 프리셋 id → 지금 id.
 *
 *
 *
 * 맞습니다. 이동량을 직접 적게 된 뒤로 «달리 인» 과 «달리 아웃» 은 부호 하나 차이일
 * 뿐이라 목록만 두 배로 길어집니다. 합치되, **클립마다 `amount` 를 이미 들고 있으므로**
 * 옛 저장본은 id 만 옮기면 움직임이 그대로 살아납니다.
 */
export const SHOT_ALIASES: Record<string, string> = {
  "dolly-in": "dolly",
  "dolly-out": "dolly",
  "orbit-quarter": "orbit",
  "orbit-half": "orbit",
  "orbit-full": "orbit",
  "pan-left": "pan",
  "pan-right": "pan",
  "tilt-up": "tilt",
  "tilt-down": "tilt",
  "truck-left": "truck",
  "truck-right": "truck",
  "crane-up": "crane",
  "crane-down": "crane",
  "zoom-in": "zoom",
  "zoom-out": "zoom",
};

/** 저장본의 프리셋 id 를 지금 쓰는 id 로. 모르는 id 는 그대로 둡니다. */
export const resolveShotId = (id: string) => SHOT_ALIASES[id] ?? id;

/**
 * 이 갈래가 **앵커(기준점)를 쓰는가.**
 *
 *
 *
 * 맞습니다 — 오빗·달리는 «무엇을 중심으로» 가 움직임의 전부라 앵커가 없으면 뜻이 안
 * 서지만, 팬·틸트는 제자리에서 고개만 돌리고 트럭·크레인은 시선을 유지한 채 미끄러집니다.
 * 앵커를 옮겨도 그림이 안 바뀌는데 앵커 단추가 똑같이 보이면 「왜 안 먹지」 가 됩니다.
 *
 * 줌은 화각만 바꾸므로 역시 앵커와 무관합니다. 자유 경로는 찍어 둔 자리를 그대로 따라
 * 가므로 지금은 앵커를 안 봅니다.
 */
export const shotUsesAnchor = (kind?: ShotKind) =>
  kind === "orbit" || kind === "dolly";

export const SHOT_PRESETS: ShotPreset[] = [
  // ── 전진·후퇴 ──────────────────────────────
  {
    id: "dolly",
    label: "달리",
    group: "전진·후퇴",
    kind: "dolly",
    amount: -2.5,
    easing: "easeInOut",
    duration: 4,
    hint: "앵커 쪽으로 다가가거나(음수) 물러납니다(양수). 감정 고조·상황 드러내기",
    en: { plus: "dolly back away from the subject", minus: "dolly in toward the subject" },
  },
  {
    id: "push-in-slow",
    label: "슬로우 푸시인",
    group: "전진·후퇴",
    kind: "dolly",
    amount: -1.2,
    easing: "slowStart",
    duration: 6,
    hint: "거의 눈치채지 못할 만큼 서서히 조여듭니다",
    en: { plus: "an almost imperceptible slow push-in on the subject" },
  },
  {
    id: "snap-push",
    label: "스냅 푸시인",
    group: "전진·후퇴",
    kind: "dolly",
    amount: -1.8,
    easing: "snapStop",
    duration: 1.2,
    hint: "확 치고 들어가 급정지. 충격·강조",
    en: { plus: "a fast snap push-in that stops hard on the subject" },
  },
  {
    id: "pull-reveal",
    label: "풀백 리빌",
    group: "전진·후퇴",
    kind: "dolly",
    amount: 6,
    easing: "easeOut",
    duration: 6,
    hint: "크게 빠지며 전경을 드러냅니다",
    en: { plus: "a wide pull-back that reveals the surroundings" },
  },

  // ── 공전 ──────────────────────────────────
  {
    id: "orbit",
    label: "오빗",
    group: "공전",
    kind: "orbit",
    amount: 90,
    axis: "y",
    easing: "easeInOut",
    duration: 5,
    hint: "앵커를 중심으로 수평으로 돕니다. 90이면 4분의 1 바퀴, 음수는 반대 방향",
    en: { plus: "orbit clockwise around the subject", minus: "orbit counter-clockwise around the subject" },
  },
  {
    id: "orbit-slow-arc",
    label: "느린 아크",
    group: "공전",
    kind: "orbit",
    amount: 35,
    axis: "y",
    easing: "easeInOut",
    duration: 6,
    hint: "살짝만 도는 미세한 호. 은근한 긴장",
    en: { plus: "a slow arcing orbit around the subject" },
  },
  {
    id: "orbit-vertical",
    label: "수직 공전",
    group: "공전",
    kind: "orbit",
    amount: 55,
    axis: "x",
    easing: "easeInOut",
    duration: 5,
    hint: "위아래로 넘어가며 돕니다",
    en: { plus: "a vertical orbit rising over the subject", minus: "a vertical orbit dropping under the subject" },
  },
  {
    id: "orbit-spiral",
    label: "나선 공전",
    group: "공전",
    kind: "orbit",
    amount: 200,
    axis: "xy",
    easing: "easeInOut",
    duration: 8,
    hint: "돌면서 높이도 함께 변하는 나선",
    en: { plus: "a spiralling orbit that rises as it circles the subject" },
  },
  {
    id: "bullet-time",
    label: "불릿타임",
    group: "공전",
    kind: "orbit",
    amount: 140,
    axis: "y",
    easing: "snapStop",
    duration: 2.5,
    hint: "시간이 멈춘 듯한 순간을 빠르게 돌아봅니다",
    en: { plus: "a bullet-time sweep around the frozen subject" },
  },

  // ── 회전 (제자리) ──────────────────────────
  {
    id: "pan",
    label: "팬",
    group: "제자리 회전",
    kind: "pan",
    amount: -45,
    axis: "y",
    easing: "easeInOut",
    duration: 4,
    hint: "제자리에서 좌우로 시선을 돌립니다. 음수가 왼쪽",
    en: { plus: "pan right", minus: "pan left" },
  },
  {
    id: "whip-pan",
    label: "휩 팬",
    group: "제자리 회전",
    kind: "pan",
    amount: 110,
    axis: "y",
    easing: "snapStop",
    duration: 0.7,
    hint: "빠르게 휘두르는 전환용 팬",
    en: { plus: "a whip pan to the right", minus: "a whip pan to the left" },
  },
  {
    id: "tilt",
    label: "틸트",
    group: "제자리 회전",
    kind: "pan",
    amount: 30,
    axis: "x",
    easing: "easeInOut",
    duration: 4,
    hint: "제자리에서 위아래로 시선을 돌립니다. 양수가 위",
    en: { plus: "tilt up", minus: "tilt down" },
  },

  // ── 평행 이동 ─────────────────────────────
  {
    id: "truck",
    label: "트럭",
    group: "평행 이동",
    kind: "truck",
    amount: -3,
    easing: "easeInOut",
    duration: 5,
    hint: "시선을 유지한 채 좌우로 미끄러집니다. 음수가 왼쪽",
    en: { plus: "truck right, holding the view direction", minus: "truck left, holding the view direction" },
  },
  {
    id: "crane",
    label: "크레인",
    group: "평행 이동",
    kind: "crane",
    amount: 2.5,
    easing: "easeInOut",
    duration: 5,
    hint: "시선을 유지한 채 위아래로 뜹니다. 양수가 위",
    en: { plus: "crane up, holding the view direction", minus: "crane down, holding the view direction" },
  },

  // ── 화각 ──────────────────────────────────
  {
    id: "zoom",
    label: "줌",
    group: "화각",
    kind: "zoom",
    amount: 0.55,
    easing: "easeInOut",
    duration: 4,
    hint: "화각만 바꿉니다. 1보다 작으면 당기고(줌 인) 크면 넓힙니다",
    en: { plus: "zoom out, widening the field of view without moving the camera", minus: "zoom in without moving the camera" },
  },
  {
    id: "dolly-zoom",
    label: "달리 줌 (버티고)",
    group: "화각",
    kind: "zoom",
    amount: 0.5,
    easing: "easeInOut",
    duration: 4,
    hint: "당기면서 물러나 배경만 밀려나는 효과. 별도로 달리 아웃과 겹쳐 쓰세요",
    en: { plus: "a dolly zoom (vertigo effect) — the background compresses while the subject stays the same size" },
  },

  // ── 자유 ──────────────────────────────────
  {
    id: "free",
    label: "자유 경로",
    group: "자유",
    kind: "free",
    amount: 0,
    easing: "easeInOut",
    duration: 4,
    hint: "카메라를 옮겨 가며 «여기» 를 찍어 길을 만듭니다. 프리셋으로 안 되는 무빙에",
    en: { plus: "the camera follows a set path through the space" },
  },

  // ── 고정 ──────────────────────────────────
  {
    id: "locked",
    label: "고정 샷",
    group: "고정",
    kind: "static",
    amount: 0,
    easing: "linear",
    duration: 4,
    /*
       맞습니다 — 무빙을
      **안 넣는 것**이 곧 고정이라, 목록에 두면 「아무것도 안 하는 클립」 을 고르게 됩니다.
      그래도 지우지는 않습니다: 예전에 이걸 깐 저장본이 클립을 통째로 잃으면 안 되니까요.
    */
    hidden: true,
    hint: "완전히 고정. 인물 움직임만 보여줄 때",
    en: { plus: "locked-off static camera, no camera movement, tripod" },
  },
];


// ─────────────────────────────────────────────────────────────
// 카메라 무빙 상태
// ─────────────────────────────────────────────────────────────

export interface CameraMove {
  /**
   * 클립 하나를 가리키는 이름표. 타임라인에서 고르고 끌고 지우는 데 씁니다.
   *
   * 배열 인덱스를 쓰지 않는 까닭: 클립을 시간순으로 정렬해 그리므로, 앞 클립을 끌어
   * 옮기는 순간 인덱스가 바뀌어 «지금 고른 것» 이 다른 클립으로 튑니다.
   */
  id: string;
  /** 사용할 샷 프리셋 id */
  shotId: string;
  /** 마스터 타임라인에서 시작 시각(초) */
  startTime: number;
  duration: number;
  amount: number;
  axis: OrbitAxis;
  easing: EasingCurve;
  /** 회전·달리의 기준점. 3D 에 표시합니다. */
  anchor: Vector3Value;
  /**
   * 앵커를 **따라다니게 할 대상**(인물·소품 id). 있으면 `anchor` 대신 그 대상의 그때 자리를 씁니다.
   *
   * 걸어가는 사람을 돌며 찍으려면 축이 같이 가야 하고, 지나가는 사람을 한자리에서
   * 보려면 축이 서 있어야 합니다 — 둘 다 쓰입니다.
   */
  anchorTargetId?: string;
  /** 대상의 어느 높이에 붙을지(0 = 발밑, 1 = 정수리). `anchorTargetId` 가 있을 때만 씁니다. */
  anchorRatio?: number;
  /**
   * **어느 클립의 앵커를 따라갈지.** 있으면 그 클립의 앵커 설정(대상·높이)을 그대로 씁니다.
   *
   *
   *
   * 예전에는 «전부 첫 클립을 따른다»(`lockAnchors`) 하나뿐이었습니다. 그러면 두 사람을
   * 번갈아 잡는 컷을 만들 수가 없습니다 — 달리 인은 A 를 돌고 오빗은 B 를 도는 것이
   * 오히려 흔한 짜임이라, **클립마다** 따를 상대를 고르게 둡니다.
   *
   * 고리가 생기면(A→B→A) 따라가다 무한히 도는 것을 `resolveAnchorSource` 가 막습니다.
   */
  anchorFromId?: string;
  /**
   * 이 클립이 **출발할 저장 구도**(`CameraShot.id`). 없으면 앞 클립이 끝난 자세에서 이어집니다.
   *
   *
   *
   * 이 값이 있으면 그 시각에 **컷이 바뀝니다** — 앞 클립이 남긴 자세를 버리고 저장해 둔
   * 구도로 순간 이동한 뒤 거기서 무빙이 시작됩니다. 한 타임라인 안에서 «카메라 1 → 카메라 2»
   * 처럼 여러 대를 쓰는 셈입니다.
   */
  cameraShotId?: string;
  /** 앵커를 화면에 표시할지 */
  showAnchor: boolean;
  /** 앵커를 계속 바라볼지. 끄면 시선 방향이 고정됩니다. */
  lookAtAnchor: boolean;
  /** 손떨림 세기(0이면 없음) */
  handheld: number;
  /**
   * 프리셋 클립의 **이동량 키프레임**. 클립 시작부터의 초와 그때의 값(도·미터·배율).
   *
   *
   *
   * 비어 있으면 예전대로 «0 에서 `amount` 까지» 입니다 — 손대지 않은 클립이 갑자기 다르게
   * 움직이면 안 됩니다. 키가 하나라도 있으면 그 목록이 이동량을 정합니다.
   */
  amountKeys?: AmountKey[];
  /**
   * 자유 무빙(`kind: "free"`)이 지나갈 자세들. 클립 시작부터의 초로 잽니다.
   *
   * 프리셋 클립에는 없습니다 — 있어도 안 봅니다. 자유 클립인데 비어 있으면 카메라가
   * 그대로 멈춰 있습니다(앞 클립이 남긴 자세 그대로).
   */
  keys?: CameraKeyframe[];
  /**
   * 이 클립을 **잠시 끄기**. 켜면 카메라가 이 클립을 건너뜁니다.
   *
   *
   * 지우는 것과 달리 값이 남아, 껐다 켜며 견줄 수 있습니다.
   */
  muted?: boolean;
}

/** 프리셋 클립의 이동량 한 점 — «이 시각에 몇 도(또는 몇 m)». */
export interface AmountKey {
  id: string;
  /** 클립 시작부터의 초. */
  time: number;
  /** 그때의 이동량. 오빗·팬은 도, 달리·트럭은 미터, 줌은 배율입니다. */
  amount: number;
  /** 이 키에서 **다음 키까지**의 완급. 없으면 클립의 곡선을 씁니다. */
  easing?: EasingCurve;
}

/** 자유 무빙의 키가 정하는 갈래 — 자리 · 바라보는 곳 · 줌. */
export type CameraKeyChannel = "position" | "target" | "fov";
export const CAMERA_KEY_CHANNELS: CameraKeyChannel[] = [
  "position",
  "target",
  "fov",
];

/** 자유 무빙의 한 점 — «이 시각에 카메라가 여기 있었다». */
export interface CameraKeyframe {
  id: string;
  /** 클립 시작부터의 초. 0 이면 클립이 시작하는 순간입니다. */
  time: number;
  pose: CameraPose;
  /**
   * 이 키가 **정하는 갈래**. 없으면 셋 다입니다(옛 저장본).
   *
   * 한 키가 셋을 다 담으면 «자리만 옮기고 싶은데 시선까지 그때 값으로
   * 굳는» 일이 납니다 — 인물 트랙을 속성별로 나눈 것과 똑같은 까닭입니다.
   */
  channels?: CameraKeyChannel[];
  /**
   * 이 키에서 **다음 키까지**의 완급. 없으면 클립의 곡선을 씁니다.
   *
   *
   *
   * 곡선을 클립에 하나만 두면 «구간마다 다른 리듬» 을 만들 수가 없습니다. 애프터이펙트도
   * 곡선은 **키와 키 사이**에 붙습니다 — 앞 키가 «여기서부터 다음까지 어떻게» 를 들고
   * 있는 편이 자연스럽습니다(마지막 키는 뒤가 없으니 안 씁니다).
   */
  easing?: EasingCurve;
}

/** 이 키가 그 갈래를 정하는가. 갈래를 안 적은 옛 키는 셋 다 정합니다. */
export const keyDefines = (key: CameraKeyframe, channel: CameraKeyChannel) =>
  !key.channels || key.channels.includes(channel);

/** 클립 이름표. 시간·난수를 섞어 같은 프레임에 둘을 만들어도 안 겹칩니다. */
let moveSeq = 0;
export function cameraMoveId(): string {
  moveSeq += 1;
  return `mv${Date.now().toString(36)}${moveSeq.toString(36)}`;
}

export function createCameraMove(shotId = "dolly-in"): CameraMove {
  const preset =
    SHOT_PRESETS.find((item) => item.id === shotId) || SHOT_PRESETS[0];
  const easing =
    EASING_PRESETS.find((item) => item.id === preset.easing)?.curve ||
    DEFAULT_EASING;
  return {
    id: cameraMoveId(),
    shotId: preset.id,
    startTime: 0,
    duration: preset.duration ?? 4,
    amount: preset.amount,
    axis: preset.axis ?? "y",
    easing: { ...easing },
    anchor: { x: 0, y: 1.1, z: 0 },
    showAnchor: true,
    /*
      ── 앵커를 계속 바라볼지는 **갈래마다 다릅니다** ────────────────────
      를 고치면서 드러난 것.

      · **오빗**은 켜야 합니다. 안 켜면 도는 동안 피사체가 화면 밖으로 휩쓸립니다 —
        «중심을 보며 돈다» 가 오빗의 정의라서요.
      · **달리·트럭·크레인·줌**은 꺼야 합니다. 이들은 평행 이동·화각이라 잡아 둔 구도를
        지키는 것이 맞습니다. 켜 두면 클립이 시작하는 순간 앵커가 화면 한가운데로 튀어와,
        애써 잡은 삼분할 구도가 무너집니다.
      · 팬·틸트는 시선 자체가 결과라 이 값을 안 봅니다.

      이미 저장된 클립은 자기 값을 들고 있어 안 바뀝니다 — 새로 놓는 것부터입니다.
    */
    lookAtAnchor: preset.kind === "orbit",
    handheld: 0,
  };
}

export interface CameraPose {
  position: Vector3Value;
  target: Vector3Value;
  /** 화각 배율. 1 이 기본입니다. */
  fovScale: number;
}

/**
 * 찍어 둔 자세들 사이를 이어 갑니다.
 *
 * 구간마다 이징을 겁니다 — 전체에 한 번만 걸면 키를 셋 이상 찍었을 때 가운데 구간이
 * 등속이 되어, 「천천히 다가갔다가 훅 도는」 리듬을 못 만듭니다.
 *
 * 첫 키 앞과 마지막 키 뒤에서는 그 키의 자세로 **머뭅니다**(`segmentAt` 이 그렇게 줍니다).
 * 클립 시작을 꼭 0초 키로 잡지 않아도 되게 하려는 것입니다.
 */
export function evaluateFreeKeys(
  keys: CameraKeyframe[],
  localTime: number,
  easing: EasingCurve,
  /** 그 갈래에 키가 하나도 없을 때 쓸 자세. 대개 앞 클립이 남긴 것입니다. */
  base?: CameraPose,
): CameraPose | null {
  if (!keys.length) return null;
  /*
    **갈래마다 따로 이어 갑니다.** 자리 키만 찍어 둔 구간에서는 시선과 줌이 그대로
    있어야 합니다 — 셋을 한 덩어리로 이으면 자리를 옮길 때마다 시선이 함께 끌려가서,
    「여기서 저기로 걸어가며 같은 데를 본다」 를 만들 수가 없습니다.
  */
  const pick = <T>(
    channel: CameraKeyChannel,
    read: (pose: CameraPose) => T,
    blend: (a: T, b: T, t: number) => T,
    fallback: T,
  ): T => {
    const own = keys.filter((key) => keyDefines(key, channel));
    if (!own.length) return fallback;
    const segment = segmentAt(own, localTime);
    if (!segment) return fallback;
    const { from, to } = segment;
    if (from === to) return read(from.pose);
    // 구간의 완급은 **앞 키**가 들고 있습니다. 없으면 클립 곡선.
    return blend(
      read(from.pose),
      read(to.pose),
      evaluateEasing(from.easing ?? easing, segment.t),
    );
  };
  const fallback = base ?? keys[0].pose;
  return {
    position: pick(
      "position",
      (p) => p.position,
      lerpVector,
      fallback.position,
    ),
    target: pick("target", (p) => p.target, lerpVector, fallback.target),
    fovScale: pick("fov", (p) => p.fovScale, lerp, fallback.fovScale),
  };
}

/** 결정론적 의사난수. 같은 시각이면 같은 흔들림이 나와 렌더가 재현됩니다. */
function noise(seed: number) {
  const value = Math.sin(seed * 127.1) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

/**
 * 시각 t(초)에서의 카메라 자세를 계산합니다.
 *
 * @param base 무빙 시작 시점의 카메라(구도잡기에서 잡아둔 값)
 * @param move 적용할 무빙
 * @param time 마스터 타임라인 시각(초)
 */
export function evaluateCameraMove(
  base: CameraPose,
  move: CameraMove,
  time: number,
): CameraPose {
  const local = (time - move.startTime) / Math.max(move.duration, 0.0001);
  const progress = evaluateEasing(move.easing, Math.min(1, Math.max(0, local)));

  /*
    이동량은 «0 → amount» 가 기본이지만, 키를 찍어 두었으면 그 목록이 정합니다.
    구간마다 같은 완급 곡선이 걸립니다 — 클립 하나가 한 가지 리듬을 갖게 하려는 것입니다.
  */
  const amountAt = (() => {
    const keys = move.amountKeys ?? [];
    if (!keys.length) return move.amount * progress;
    const localTime = Math.min(
      Math.max(0, time - move.startTime),
      Math.max(move.duration, 0),
    );
    const segment = segmentAt(keys, localTime);
    if (!segment) return move.amount * progress;
    const { from, to } = segment;
    if (from === to) return from.amount;
    const t = evaluateEasing(move.easing, segment.t);
    return from.amount + (to.amount - from.amount) * t;
  })();
  /*
    **여기서도 별칭을 풉니다.** 정규화가 옛 id 를 옮겨 주지만, 정규화를 안 거친 값이
    한 군데라도 들어오면 프리셋을 못 찾아 `static` 이 되어 **카메라가 조용히 멈춥니다** —
    「예전 컷을 열었더니 무빙이 안 먹는다」 가 되고, 값은 멀쩡해 보여서 원인을 짚기가
    아주 어렵습니다. 한 줄로 막아 둡니다.
  */
  const preset = SHOT_PRESETS.find(
    (item) => item.id === resolveShotId(move.shotId),
  );
  const kind = preset?.kind ?? "static";

  /*
    자유 클립은 «규칙» 이 아니라 «찍어 둔 자리» 라, 앵커·이동량·축을 아예 안 봅니다.
    키가 하나도 없으면 앞 클립이 남긴 자세 그대로 둡니다 — 자유 클립을 막 만들었을 때
    카메라가 원점으로 튀지 않게 하려는 것입니다.
  */
  if (kind === "free") {
    const localTime = Math.min(
      Math.max(0, time - move.startTime),
      Math.max(move.duration, 0),
    );
    return (
      evaluateFreeKeys(move.keys ?? [], localTime, move.easing, base) ?? base
    );
  }

  const anchor = move.anchor;
  const position = { ...base.position };
  const target = move.lookAtAnchor ? { ...anchor } : { ...base.target };
  let fovScale = base.fovScale;

  const toAnchor = {
    x: base.position.x - anchor.x,
    y: base.position.y - anchor.y,
    z: base.position.z - anchor.z,
  };

  if (kind === "dolly") {
    // 앵커를 향한 방향으로 amount 만큼 이동합니다(음수면 접근).
    const length = Math.hypot(toAnchor.x, toAnchor.y, toAnchor.z) || 1;
    const unit = {
      x: toAnchor.x / length,
      y: toAnchor.y / length,
      z: toAnchor.z / length,
    };
    const distance = amountAt;
    position.x = base.position.x + unit.x * distance;
    position.y = base.position.y + unit.y * distance;
    position.z = base.position.z + unit.z * distance;
    /*
      ── 앵커를 안 볼 때는 **시선점도 같이 옮깁니다** ────────────────────
      

      달리는 **평행 이동**입니다. 자리만 옮기고 시선점을 한자리에 못 박아 두면, 다가갈수록
      그 점을 보려고 카메라가 고개를 돌립니다 — 「돈다」 는 것이 바로 그것입니다. 자리와
      시선점을 같은 만큼 옮겨야 바라보는 **방향**이 유지되고, 구도 그대로 피사체만
      커집니다.

      트럭·크레인은 이미 이렇게 하고 있었는데(바로 아래) 달리만 빠져 있었습니다.
      «앵커를 계속 바라보기» 를 켰을 때는 예전대로 앵커가 화면 한가운데로 옵니다.
    */
    if (!move.lookAtAnchor) {
      target.x = base.target.x + unit.x * distance;
      target.y = base.target.y + unit.y * distance;
      target.z = base.target.z + unit.z * distance;
    }
  } else if (kind === "orbit") {
    const angle = (amountAt * Math.PI) / 180;
    const useY = move.axis === "y" || move.axis === "xy";
    const useX = move.axis === "x" || move.axis === "xy";
    // 나선일 때 두 축을 같은 각도로 돌리면 과해서, 수직 성분은 절반만 씁니다.
    const verticalAngle = move.axis === "xy" ? angle * 0.5 : angle;

    let { x, y, z } = toAnchor;
    if (useY) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = x * cos - z * sin;
      const nz = x * sin + z * cos;
      x = nx;
      z = nz;
    }
    if (useX) {
      const cos = Math.cos(verticalAngle);
      const sin = Math.sin(verticalAngle);
      const ny = y * cos - z * sin;
      const nz = y * sin + z * cos;
      y = ny;
      z = nz;
    }
    position.x = anchor.x + x;
    position.y = anchor.y + y;
    position.z = anchor.z + z;
  } else if (kind === "pan") {
    // 위치는 고정하고 타깃만 회전시킵니다.
    const angle = (amountAt * Math.PI) / 180;
    const toTarget = {
      x: base.target.x - base.position.x,
      y: base.target.y - base.position.y,
      z: base.target.z - base.position.z,
    };
    let { x, y, z } = toTarget;
    if (move.axis === "y" || move.axis === "xy") {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = x * cos - z * sin;
      const nz = x * sin + z * cos;
      x = nx;
      z = nz;
    }
    if (move.axis === "x" || move.axis === "xy") {
      const horizontal = Math.hypot(x, z) || 1;
      y += Math.tan(angle) * horizontal;
    }
    target.x = base.position.x + x;
    target.y = base.position.y + y;
    target.z = base.position.z + z;
  } else if (kind === "truck") {
    // 시선 방향에 수직인 좌우 축으로 평행 이동합니다.
    const forward = {
      x: base.target.x - base.position.x,
      z: base.target.z - base.position.z,
    };
    const length = Math.hypot(forward.x, forward.z) || 1;
    const right = { x: forward.z / length, z: -forward.x / length };
    const distance = amountAt;
    position.x = base.position.x + right.x * distance;
    position.z = base.position.z + right.z * distance;
    if (!move.lookAtAnchor) {
      target.x = base.target.x + right.x * distance;
      target.z = base.target.z + right.z * distance;
    }
  } else if (kind === "crane") {
    const distance = amountAt;
    position.y = base.position.y + distance;
    if (!move.lookAtAnchor) target.y = base.target.y + distance;
  } else if (kind === "zoom") {
    fovScale =
      base.fovScale *
      (move.amountKeys?.length ? amountAt : 1 + (move.amount - 1) * progress);
  }

  if (move.handheld > 0) {
    // 시각을 시드로 써서 프레임마다 같은 값이 나오게 합니다.
    const amplitude = move.handheld * 0.06;
    position.x += noise(time * 3.1) * amplitude;
    position.y += noise(time * 2.7 + 11) * amplitude;
    position.z += noise(time * 3.7 + 23) * amplitude;
    target.x += noise(time * 2.3 + 41) * amplitude * 0.6;
    target.y += noise(time * 2.9 + 57) * amplitude * 0.6;
  }

  return { position, target, fovScale };
}

/**
 * 카메라 무빙을 사람이 읽는 말로 옮깁니다.
 *
 * 컷 프롬프트와 블렌더 지시문이 같은 문장을 씁니다. 구도잡기에서 정한
 * 무빙을 두 곳에서 따로 서술하면 조금씩 달라지고, 그러면 어느 쪽이
 * 맞는지 알 수 없게 됩니다.
 *
 * 사고로 잃어 쓰임새에서 역산해 다시 쓴 함수입니다.
 */
/**
 * 속도 곡선을 **말로** 옮깁니다.
 *
 * 3D 미리보기는 곡선을 제대로
 * 먹고 있었는데(`evaluateCameraMove`), **프롬프트에는 곡선이 한 글자도 안 실려 있었습니다.**
 * 그러니 앱에서 아무리 «급가속 후 정지» 로 맞춰 놔도 밖에서 뽑은 영상은 등속이었습니다.
 *
 * 프리셋과 똑같으면 그 이름을, 손으로 주물러 놓았으면 **양 끝 속도**로 지어 말합니다.
 */
export function describeEasing(curve: EasingCurve | null | undefined) {
  if (!curve) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
  const same = EASING_PRESETS.find(
    (item) =>
      near(item.curve.p1x, curve.p1x) &&
      near(item.curve.p1y, curve.p1y) &&
      near(item.curve.p2x, curve.p2x) &&
      near(item.curve.p2y, curve.p2y),
  );
  if (same) return { en: same.en, ko: same.enKo };
  // 손으로 만진 곡선 — 출발·도착 속도(1 이 등속)로 읽습니다.
  const { out, in: arrive } = easingSpeedHandles(curve);
  const word = (speed: number) =>
    speed < 0.35 ? ["slow", "느리게"] : speed > 1.6 ? ["fast", "빠르게"] : ["steady", "고르게"];
  const [startEn, startKo] = word(out.speed);
  const [endEn, endKo] = word(arrive.speed);
  if (startEn === endEn && startEn === "steady")
    return { en: "at a constant speed", ko: "등속" };
  return {
    en: `starting ${startEn} and finishing ${endEn}`,
    ko: `${startKo} 출발해 ${endKo} 도착`,
  };
}

export function describeCameraMove(move: CameraMove | null | undefined) {
  if (!move) return null;
  const preset = SHOT_PRESETS.find((item) => item.id === move.shotId);
  if (!preset) return null;

  // 공전과 패닝만 각도로 셉니다. 나머지는 거리입니다.
  const unit = preset.kind === "orbit" || preset.kind === "pan" ? "도" : "m";
  const size = Math.abs(move.amount ?? preset.amount);
  const shake =
    move.handheld > 0.01 ? `, 손떨림 ${Math.round(move.handheld * 100)}%` : "";
  const look = move.lookAtAnchor
    ? ", 기준점을 계속 바라봄"
    : ", 시선 방향 고정";

  /*
    영어 문장은 **촬영 용어**로 씁니다().
    여태는 `${preset.id} camera move` 였습니다 — 「snap-push camera move」 같은 우리
    내부 이름을 그대로 보내고 있었습니다. 생성기가 못 알아듣고 제멋대로 흔듭니다.

    순서도 가이드를 따릅니다 — **무빙과 방향 · 속도와 길이 · 대상** 순.
  */
  const amount = move.amount ?? preset.amount;
  /*
    방향은 **부호**로 갈립니다 — 다만 줌만 다릅니다. 줌의 이동량은 «배율» 이라 1 보다
    작으면 당기고(줌 인) 크면 넓힙니다. 부호로 읽으면 줌 인을 늘 «줌 아웃» 이라고
    적어 보내게 됩니다.
  */
  const backwards = preset.kind === "zoom" ? amount < 1 : amount < 0;
  const phrase = backwards ? (preset.en.minus ?? preset.en.plus) : preset.en.plus;
  // 각도는 숫자가 그대로 통합니다(「180도 오빗」). 거리는 «얼마나 큰 움직임인가» 로 바꿉니다 —
  // 「2.5미터 달리」 는 모델에게 아무 뜻이 없지만 「steady」·「long」 은 속도로 읽힙니다.
  const scale =
    unit === "도"
      ? `${size} degrees`
      : // 줌은 «배율» 이라 미터 잣대가 안 맞습니다. 0.55 는 «1.8배 당김» 입니다.
        preset.kind === "zoom"
        ? `about ${Math.round((1 / Math.max(0.01, size)) * 10) / 10}x`
        : // 자유 경로는 찍어 둔 자리를 따라가므로 «얼마나» 가 없습니다.
          preset.kind === "free"
          ? ""
          : size < 1.5
            ? "a small move"
            : size < 4
              ? "a steady move"
              : "a long move";
  const speed =
    preset.kind === "static"
      ? ""
      : `,${scale ? ` ${scale}` : ""} over ${move.duration} seconds`;
  /*
    **속도 곡선을 말로 실어 보냅니다.** 3D 미리보기는 곡선을 제대로 먹고 있었는데 프롬프트에는 곡선이 한
    글자도 안 실려 있었습니다 — 앱에서 «급가속 후 정지» 로 맞춰도 밖에서 뽑으면 등속.
  */
  const curve = preset.kind === "static" ? null : describeEasing(move.easing);

  return {
    ko: `${preset.label} (${size}${unit}, ${move.duration}초${curve ? `, ${curve.ko}` : ""}${look}${shake})`,
    en: `${phrase}${speed}${curve ? `, ${curve.en}` : ""}${
      move.lookAtAnchor ? ", keeping the subject centred in frame" : ""
    }${
      move.handheld > 0.01
        ? ", subtle handheld shake"
        : // 고정 샷은 이미 «움직이지 않는다» 고 적었습니다. 덧붙이면 말만 길어집니다.
          preset.kind === "static"
          ? ""
          : ", smooth and stable"
    }`,
    preset,
  };
}

/** 클립이 끝나는 시각(초). */
export function moveEnd(move: CameraMove): number {
  return move.startTime + Math.max(0, move.duration);
}

/** 시간순. 같은 시각이면 넣은 차례(이름표)로 갈라 안정적으로 정렬합니다. */
export function sortedMoves(moves: CameraMove[]): CameraMove[] {
  return [...moves].sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  );
}

/**
 * 여러 클립을 **이어 붙여** 시각 t 의 카메라를 계산합니다.
 *
 *
 *
 * 규칙은 하나입니다 — **다음 클립의 출발 자세는 앞 클립이 끝난 자세**입니다. 그래서
 * 달리로 다가간 뒤 팬을 걸면 다가간 자리에서 돌고, 클립 사이가 비어 있으면 그 자세로
 * 머뭅니다. 각 클립을 «처음 구도» 기준으로 따로 계산해 더하면 두 무빙이 서로를 지웁니다.
 *
 * 겹치는 클립은 **시간순으로 차례차례** 먹입니다(레이어 합성이 아닙니다). 한 컷에 두
 * 무빙을 겹쳐 걸면 생성기가 둘 다 놓치므로, 겹침을 «동시에» 로 해석할 까닭이 없습니다.
 */
export function evaluateCameraMoves(
  base: CameraPose,
  moves: CameraMove[],
  time: number,
  /**
   * 대상에 붙은 앵커를 그때 자리로 풀어 주는 함수. 안 넘기면 적어 둔 `anchor` 를 씁니다.
   * 3D 를 아는 쪽(뷰포트)만 인물이 «지금 어디 있는지» 를 압니다.
   */
  resolveAnchor?: (move: CameraMove, time: number) => Vector3Value | null,
  /**
   * 저장해 둔 구도를 자세로 풀어 주는 함수. 클립에 `cameraShotId` 가 있으면 그 시각에
   * **컷이 바뀝니다** — 앞 클립이 남긴 자세를 버리고 여기서 다시 출발합니다.
   */
  resolveShot?: (shotId: string) => CameraPose | null,
): CameraPose {
  let pose = base;
  for (const move of sortedMoves(moves)) {
    if (time <= move.startTime) break;
    // 꺼 둔 클립은 **없는 것처럼** 지나갑니다 — 자세를 안 바꾸고 다음으로 넘어갑니다.
    if (move.muted) continue;
    const at = Math.min(time, moveEnd(move));
    /*
      «출발 카메라» 가 걸린 클립은 이어받지 않고 **갈아탑니다**. 이어받으면 카메라 2 를
      골라 둬도 카메라 1 이 끝난 자리에서 시작해, 저장해 둔 구도가 아무 뜻이 없어집니다.
    */
    const jump = move.cameraShotId ? resolveShot?.(move.cameraShotId) : null;
    if (jump) pose = jump;
    const anchor = resolveAnchor?.(move, at) ?? null;
    // 이미 지난 클립은 «끝난 자세» 로, 지금 도는 클립은 그 시각으로.
    pose = evaluateCameraMove(pose, anchor ? { ...move, anchor } : move, at);
  }
  return pose;
}

/**
 * 이 클립의 앵커 설정을 **실제로 정하는 클립**을 찾습니다.
 *
 * `anchorFromId` 를 따라 올라가되, 고리(A→B→A)나 너무 깊은 사슬에서 멈춥니다. 사람이
 * 실수로 서로를 가리키게 만들 수 있는 값이라, 여기서 막지 않으면 프레임마다 무한히 돕니다.
 */
export function resolveAnchorSource(
  move: CameraMove,
  moves: CameraMove[],
): CameraMove {
  const seen = new Set<string>([move.id]);
  let current = move;
  while (current.anchorFromId && !seen.has(current.anchorFromId)) {
    const next = moves.find((item) => item.id === current.anchorFromId);
    if (!next) break;
    seen.add(next.id);
    current = next;
  }
  return current;
}

/** 클립 전체가 끝나는 시각(초). 타임라인 길이를 정할 때 씁니다. */
export function cameraMovesEnd(moves: CameraMove[]): number {
  return moves.reduce((longest, move) => Math.max(longest, moveEnd(move)), 0);
}

/**
 * 이어 붙인 클립들을 «0~2초 달리 인 → 2~3초 팬 좌» 처럼 한 줄로 적습니다.
 *
 * 클립이 하나면 예전과 같은 문장입니다(시각 표시만 붙습니다). 생성기에 넘길 때 시각이
 * 있어야 «언제 무엇이» 가 서는데, 한 덩어리 문장에 시각이 없으면 순서가 뒤섞입니다.
 */
export function describeCameraMoves(moves: CameraMove[] | null | undefined) {
  const list = sortedMoves(moves ?? []);
  const parts = list
    .map((move) => {
      const one = describeCameraMove(move);
      if (!one) return null;
      const from = Math.round(move.startTime * 10) / 10;
      const to = Math.round(moveEnd(move) * 10) / 10;
      return {
        ko: `${from}~${to}초 ${one.ko}`,
        en: `${from}-${to}s ${one.en}`,
      };
    })
    .filter((part): part is { ko: string; en: string } => Boolean(part));
  if (!parts.length) return null;
  return {
    ko: parts.map((part) => part.ko).join(" → "),
    en: parts.map((part) => part.en).join(", then "),
  };
}
