/**
 * 안내가 대신 눌러도 되는 것은 보기 탭과 접힌 판뿐입니다.
 * `data-tour-open`에는 방·구도·곡 생성도 있으므로, 앵커가 없다는 이유만으로 누르면
 * 튜토리얼을 읽는 동안 작품이 바뀝니다. 보기 전환도 종류를 명시한 것만 허용합니다.
 */
export function revealTutorialView(
  scope: ParentNode,
  anchor: string,
  clicked: Set<HTMLElement>,
  targetVisible: boolean,
): boolean {
  if (clicked.size >= 4) return false;
  const candidates = scope.querySelectorAll<HTMLElement>(`[data-tour-switch~="${anchor}"]`);
  for (const candidate of candidates) {
    if (clicked.has(candidate) || !tutorialElementVisible(candidate)) continue;
    if (candidate.hasAttribute("disabled") || candidate.getAttribute("aria-disabled") === "true") continue;
    const kind = candidate.getAttribute("data-tour-switch-kind");
    const tab = kind === "tab";
    // 이미 펼친 접이식은 다시 누르면 닫힙니다. 내용이 비어 앵커가 없어도 그대로 둡니다.
    const expand = kind === "expand" && !targetVisible && candidate.getAttribute("aria-expanded") === "false";
    if (!tab && !expand) continue;
    clicked.add(candidate);
    candidate.click();
    return true;
  }
  return false;
}

export function tutorialElementVisible(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 || box.height > 0;
}

/** 없는 자료를 만드는 단추도 여기서 가리키되, 실행은 사용자의 실제 클릭에 맡깁니다. */
export function tutorialDoors(scope: ParentNode, anchor: string): HTMLElement[] {
  return [
    ...scope.querySelectorAll<HTMLElement>(`[data-tour-switch~="${anchor}"]`),
    ...scope.querySelectorAll<HTMLElement>(`[data-tour-open~="${anchor}"]`),
  ].filter(tutorialElementVisible);
}
