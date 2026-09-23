/**
 * 받아 둔 프롬프트를 쌓아 두는 곳.
 *
 * 프롬프트를 두 번 돌렸다는 것은 **무언가를 바꿔서 돌렸다**는 뜻입니다.
 * 레퍼런스를 갈아 끼웠거나, 고른 칸을 바꿨거나, 설명을 고쳤거나.
 * 그런데 지금은 새로 받은 것이 앞의 것을 덮어써서, 먼저 것이 더 나았다는 걸
 * 알아도 되돌릴 방법이 없습니다. 같은 조건을 손으로 다시 맞춰 또 돌려야 하고,
 * 그때 나오는 것은 대개 처음 것과 다릅니다.
 *
 * 그래서 받을 때마다 남깁니다. 돈을 내고 받은 것이라 버릴 이유가 없습니다.
 */

export interface PromptHistoryEntry {
  /**
   * 이 프롬프트를 뽑을 때 골라 두었던 칸들.
   *
   * 프롬프트만 되돌리면 화면의 체크는 마지막에 만지던 그대로 남습니다.
   * 그러면 «보이는 프롬프트» 와 «체크된 칸» 이 서로 다른 것을 가리키고,
   * 그 상태에서 다시 요청하면 되돌린 것과 또 다른 답이 나옵니다.
   */
  blueprint?: string[];
  id: string;
  createdAt: number;
  ko: string;
  en: string;
  negativeKo: string;
  negativeEn: string;
  /**
   * 무슨 조건으로 뽑았는지 한 줄.
   *
   * 목록에 시각만 있으면 «14:03 것» 과 «14:21 것» 중 어느 쪽이 무엇이었는지
   * 기억으로 맞춰야 합니다. 레퍼런스 장수와 고른 칸 수만 적혀 있어도
   * 무엇이 달랐는지 대개 짚입니다.
   */
  note?: string;
  /** 사람이 붙인 이름. «달 두 개 버전» 처럼. */
  label?: string;
}

/** 너무 쌓이면 목록이 무거워집니다. 최근 것만 둡니다. */
const MAX_ENTRIES = 20;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isSamePrompt(a: PromptHistoryEntry, b: Omit<PromptHistoryEntry, "id" | "createdAt">) {
  return (
    a.ko.trim() === b.ko.trim() &&
    a.en.trim() === b.en.trim() &&
    a.negativeKo.trim() === b.negativeKo.trim() &&
    a.negativeEn.trim() === b.negativeEn.trim()
  );
}

/**
 * 새로 받은 것을 맨 앞에 넣습니다.
 *
 * 앞의 것과 **한 글자도 다르지 않으면 넣지 않습니다.** 같은 조건으로 두 번
 * 돌렸는데 같은 답이 온 경우인데, 그걸 두 줄로 쌓으면 목록만 길어지고
 * 무엇이 달랐는지 찾기 어려워집니다.
 */
export function appendPromptHistory(
  history: PromptHistoryEntry[] | undefined,
  next: {
    ko: string;
    en: string;
    negativeKo: string;
    negativeEn: string;
    /** 사람이 붙인 이름. 자동으로는 비워 둡니다 — 조건은 note 로 갑니다. */
    label?: string;
    /**
     * 무슨 조건으로 뽑았는지 한 줄.
     *
     * 시각만 있으면 «14:03 것» 과 «14:21 것» 중 어느 쪽이 무엇이었는지
     * 기억으로 맞춰야 합니다. «실외 · 칸 4개 · 분석 없음 · nbpro» 처럼
     * 조건이 적혀 있으면 무엇이 달랐는지 대개 짚입니다.
     */
    note?: string;
    /** 그때 골라 두었던 칸들. 되돌릴 때 체크도 같이 돌아갑니다. */
    blueprint?: string[];
  },
): PromptHistoryEntry[] {
  const list = history || [];
  const body = {
    ko: next.ko || "",
    en: next.en || "",
    negativeKo: next.negativeKo || "",
    negativeEn: next.negativeEn || "",
  };

  // 빈 답은 남길 것이 없습니다.
  if (!body.ko.trim() && !body.en.trim()) return list;
  if (list[0] && isSamePrompt(list[0], { ...body, note: next.note })) return list;

  return [
    {
      id: makeId(),
      createdAt: Date.now(),
      ...body,
      label: next.label,
      note: next.note,
      blueprint: next.blueprint,
    },
    ...list,
  ].slice(0, MAX_ENTRIES);
}

/**
 * 무슨 조건으로 뽑았는지 한 줄로 적습니다.
 *
 * 값이 없는 항목은 통째로 뺍니다 — "레퍼런스 0장" 같은 줄은 정보가 아니라 잡음입니다.
 */
export function describeRunConditions(parts: {
  referenceCount?: number;
  /**
   * 고른 항목을 사람이 읽는 말로.
   *
   * 예전에는 «칸 4개» 였습니다. 그런데 그 숫자로는 조감도로 뽑았는지 항공뷰로
   * 뽑았는지 알 수 없어서, 지난 프롬프트를 골라 쓸 수가 없었습니다.
   * blueprint.ts 의 summarizeBlueprint 가 «조감도, 방향 표시» 처럼 만들어 줍니다.
   */
  aspects?: string;
  panelCount?: number;
  /**
   * 분석을 깔고 뽑았는지. **안 주면 그 항목을 통째로 뺍니다.**
   *
   * 분석 자체의 이력에도 이 함수를 쓰는데, 거기서 «분석 없음» 이 찍히면
   * 분석을 받아 놓고 없다고 적는 꼴이 됩니다. 프롬프트 쪽은 늘 참·거짓을 넘깁니다.
   */
  hasAnalysis?: boolean;
  model?: string;
  platform?: string;
  extra?: string;
}) {
  return [
    parts.extra,
    // 「칸 4개」 가 아니라 «조감도, 방향 표시» 처럼. 그래야 지난 판을 골라 쓸 수 있습니다. (지시 343)
    parts.aspects,
    parts.referenceCount ? `레퍼런스 ${parts.referenceCount}장` : "",
    parts.panelCount && !parts.aspects ? `칸 ${parts.panelCount}개` : "",
    parts.hasAnalysis === undefined ? "" : parts.hasAnalysis ? "분석 있음" : "분석 없음",
    parts.model,
    parts.platform,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 이름이 하나 더 있는 이유.
 *
 * 컷 프롬프트 쪽에도 `PromptHistoryEntry` 라는 다른 타입이 있어서 이름이
 * 부딪혔습니다. 그때 이쪽을 `SavedPromptEntry` 로 바꿨는데, 옛 이름을 쓰는
 * 곳이 아직 남아 있어 둘 다 둡니다.
 */
export type SavedPromptEntry = PromptHistoryEntry;

/**
 * 받아 둔 분석.
 *
 * 프롬프트는 쌓이는데 분석은 쌓이지 않았습니다. 재분석을 누르거나 요청문으로
 * 받은 답을 붙여넣으면 앞의 분석이 **그 자리에서 덮여 사라졌습니다.** 분석도
 * 그림 넉 장을 올려 돈을 내고 받는 것이고, 그 위에 손으로 고친 문장까지
 * 얹혀 있습니다.
 * (2026-09-08). 그래서 프롬프트와 같은 방식으로, 받을 때마다 남깁니다.
 */
export interface SavedAnalysisEntry {
  id: string;
  createdAt: number;
  /** 분석 본문. 화면 칸에 들어가는 글 그대로입니다. */
  text: string;
  /** 무슨 조건으로 받았는지 한 줄. «레퍼런스 3장 · claude-haiku-4-5» 나 «붙여넣기». */
  note?: string;
  /** 사람이 붙인 이름. */
  label?: string;
}

/**
 * 새로 받은 분석을 맨 앞에 넣습니다.
 *
 * 프롬프트와 같은 규칙입니다 — 빈 글은 남기지 않고, 앞의 것과 한 글자도
 * 다르지 않으면 넣지 않습니다. 같은 답이 두 줄로 쌓이면 무엇이 달랐는지
 * 찾기만 어려워집니다.
 *
 * **손으로 고칠 때는 부르지 마세요.** 글자 하나마다 한 줄씩 쌓여 스무 개가
 * 순식간에 찹니다. API 로 받았거나 붙여넣었을 때만 부릅니다.
 */
export function appendAnalysisHistory(
  history: SavedAnalysisEntry[] | undefined,
  next: { text: string; note?: string; label?: string },
): SavedAnalysisEntry[] {
  const list = history || [];
  const text = next.text || "";
  if (!text.trim()) return list;
  if (list[0] && list[0].text.trim() === text.trim()) return list;

  return [
    {
      id: makeId(),
      createdAt: Date.now(),
      text,
      note: next.note,
      label: next.label,
    },
    ...list,
  ].slice(0, MAX_ENTRIES);
}
