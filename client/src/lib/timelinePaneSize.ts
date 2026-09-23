/** 화면 배치는 작품 데이터가 아니므로 기존 타임라인 접힘 설정과 같은 저장소에 따로 기억합니다. */
export const TIMELINE_PANE_HEIGHT_KEY = "frameforge.timelineHeight";
export const DEFAULT_TIMELINE_PANE_HEIGHT = 280;
export interface TimelinePaneBounds { min: number; max: number }

export function timelinePaneBounds(stageHeight: number): TimelinePaneBounds {
  const height = Number.isFinite(stageHeight) && stageHeight > 0 ? stageHeight : 720;
  // 긴 트랙이 구도 전체를 덮지 않게 위쪽 화면을 남깁니다. 작은 창에서는 최소 높이도 줄여야 밖으로 밀리지 않습니다.
  const max = Math.max(1, Math.floor(Math.min(height * 0.6, Math.max(48, height - 220))));
  return { min: Math.min(160, max), max };
}

export function clampTimelinePaneHeight(height: number, bounds: TimelinePaneBounds): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min,
    Number.isFinite(height) ? height : DEFAULT_TIMELINE_PANE_HEIGHT)));
}

export function draggedTimelinePaneHeight(startHeight: number, startY: number, currentY: number, bounds: TimelinePaneBounds) {
  // 판은 아래에 붙어 있으므로 위로 끌수록 커집니다.
  return clampTimelinePaneHeight(startHeight + startY - currentY, bounds);
}

export function keyedTimelinePaneHeight(height: number, key: string, bounds: TimelinePaneBounds, shift = false): number | null {
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  const step = shift ? 50 : 20;
  if (key === "ArrowUp") return clampTimelinePaneHeight(height + step, bounds);
  if (key === "ArrowDown") return clampTimelinePaneHeight(height - step, bounds);
  return null;
}

export function readTimelinePaneHeight(): number {
  try {
    const raw = window.localStorage.getItem(TIMELINE_PANE_HEIGHT_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 10000 ? value : DEFAULT_TIMELINE_PANE_HEIGHT;
  } catch { return DEFAULT_TIMELINE_PANE_HEIGHT; }
}

export function rememberTimelinePaneHeight(height: number): void {
  try { window.localStorage.setItem(TIMELINE_PANE_HEIGHT_KEY, String(height)); }
  catch { /* 저장소가 막혀도 현재 창에서는 높이를 조절할 수 있습니다. */ }
}
