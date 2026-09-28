import { cutTogglesEnglish } from "@/lib/cutStyle";

/**
 * **알아서 켜 주는 실사 기본값.**
 *
 *
 *
 * # 왜 필요한가
 *
 * 오늘 «질감 · 실사» 칸 열두 개를 만들었습니다. 그런데 그건 **아는 사람만 켭니다.**
 * 모공·캐치라이트·필름 그레인이 왜 필요한지 모르면 그 칸은 영영 꺼진 채로 남고,
 * 얼굴은 계속 플라스틱으로 나옵니다. 칸을 만든 것으로 일이 끝나지 않습니다.
 *
 * # 무엇을 기준으로 정하는가
 *
 * **앱이 이미 아는 것만** 씁니다. 사람에게 더 묻지 않습니다.
 *
 * · 작품 스타일 칩 — 실사인가 애니인가. 애니에 모공을 넣으면 망칩니다.
 * · 사람이 나오는가 — 인물이 없으면 피부·눈 지시가 헛돕니다.
 * · 얼굴이 큰가 — 풀샷에서 속눈썹을 지시해 봐야 그릴 자리가 없습니다.
 *
 * # 사람이 정한 것이 늘 이깁니다
 *
 * 손으로 켜고 끈 것은 건드리지 않습니다. 자동은 **사람이 아무 말도 안 한 칸**만 채웁니다.
 * 그래야 「분명 껐는데 또 들어간다」 가 안 생깁니다.
 */

/** 실사 계열 스타일. 이 중 하나라도 켜져 있으면 실사로 봅니다. */
const LIVE_ACTION = [
  "사실적 실사",
  "시네마틱 필름",
  "다큐멘터리",
  "빈티지/레트로",
  "흑백",
];

/** 그림 계열. 하나라도 있으면 **실사 기본값을 넣지 않습니다.** */
const DRAWN = ["2D 애니메이션", "3D 애니메이션", "스톱모션", "미니멀"];

/** 필름 결이 어울리는 스타일 — 그레인·헤일레이션까지 얹습니다. */
const FILMIC = ["시네마틱 필름", "빈티지/레트로", "흑백"];

export interface AutoRealismInput {
  /** 작품 스타일 칩(`STYLE_OPTIONS` 의 값). */
  styles: string[];
  /** 이 컷·시트에 사람이 나오는가. */
  hasPeople: boolean;
  /**
   * 얼굴이 화면에서 큰가.
   *
   * 클로즈업·바스트면 눈과 피부를 지시할 자리가 있습니다. 풀샷이면 없습니다 —
   * 거기서 속눈썹을 적어 봐야 그릴 픽셀이 없고, 말만 길어져 다른 지시를 밀어냅니다.
   */
  closeUp?: boolean;
  /** 사람이 손으로 켠 토글 id. 여기 있는 것은 자동이 건드리지 않습니다. */
  manual?: string[];
}

export interface AutoRealism {
  /** 자동으로 켠 토글 id. 화면에 «자동» 으로 보여 주면 됩니다. */
  ids: string[];
  /** 프롬프트에 붙일 영어 한 줄. 빈 글자면 붙일 것이 없다는 뜻입니다. */
  en: string;
  /** 왜 이렇게 골랐는지 한 줄. 화면에 그대로 띄울 수 있게 한국어로. */
  why: string;
}

/**
 * 이 작품·이 컷에 **자동으로 켤 질감 칸**을 고릅니다.
 *
 * 아무것도 안 켜는 경우가 정상입니다 — 애니 작품이거나 사람이 안 나오면 그렇습니다.
 */
export function autoRealism(input: AutoRealismInput): AutoRealism {
  const styles = input.styles ?? [];
  const manual = new Set(input.manual ?? []);

  if (styles.some((style) => DRAWN.includes(style)))
    return { ids: [], en: "", why: "그림 계열 작품이라 실사 질감을 넣지 않습니다." };

  const live = styles.some((style) => LIVE_ACTION.includes(style));
  // 스타일을 아직 안 고른 작품도 실사로 봅니다 — 대부분이 실사이고, 애니면 칩이 있습니다.
  if (!live && styles.length)
    return { ids: [], en: "", why: "실사 계열 스타일이 아니라 넣지 않습니다." };

  const wanted: string[] = [];
  const reasons: string[] = [];

  if (input.hasPeople) {
    // 피부는 «밀랍 얼굴» 을 가장 크게 되돌립니다. 사람이 나오면 늘 넣습니다.
    wanted.push("skin-pores", "no-retouch");
    reasons.push("사람이 나와서 피부 질감");
    if (input.closeUp) {
      // 얼굴이 클 때만. 풀샷에서는 그릴 자리가 없습니다.
      wanted.push("eye-catchlight", "skin-flaws", "hair-strands");
      reasons.push("얼굴이 커서 눈·잡티·잔머리까지");
    }
  }

  if (styles.some((style) => FILMIC.includes(style))) {
    wanted.push("film-grain");
    reasons.push("필름 결 스타일이라 그레인");
  }

  const ids = wanted.filter((id) => !manual.has(id));
  return {
    ids,
    en: cutTogglesEnglish(ids),
    why: ids.length
      ? `자동으로 켰습니다 — ${reasons.join(" · ")}. 질감 칸에서 끄면 그쪽이 이깁니다.`
      : "자동으로 켤 것이 없습니다.",
  };
}

/**
 * 샷 크기 글자에서 **얼굴이 큰가**를 읽습니다.
 *
 * 구도잡기가 «클로즈업»·«바스트 샷» 같은 말을 이미 만들어 둡니다. 그걸 그대로 봅니다 —
 * 사람에게 또 고르라고 하지 않으려는 것입니다.
 */
export function isCloseUp(shot: string | null | undefined): boolean {
  if (!shot) return false;
  return /클로즈|바스트|얼굴|close|medium close|bust/i.test(shot);
}
