/** 씬 선택과 페이지 묶음 탐색은 분리합니다. 번호는 현재 순서, 선택 저장은 씬 ID입니다. */
export const SCENES_PER_PAGE = 5;
export function scenePageForIndex(index: number): number {
  return Math.floor(Math.max(0, index) / SCENES_PER_PAGE);
}
export function scenePageBounds(sceneCount: number, requestedPage: number) {
  const count = Math.max(0, Math.trunc(sceneCount));
  const pages = Math.ceil(count / SCENES_PER_PAGE);
  const page = Math.min(Math.max(0, Math.trunc(requestedPage)), Math.max(0, pages - 1));
  const start = page * SCENES_PER_PAGE;
  return { page, pages, start, end: Math.min(start + SCENES_PER_PAGE, count), hasPrevious: page > 0, hasNext: page + 1 < pages };
}
