/**
 * **창(모달) 한 벌의 치수.**
 *
 *
 *
 * 여태 창마다 제 나름의 크기를 적고 있었습니다 — `max-w-sm`, `md`, `2xl`, `3xl`, `5xl`,
 * `6xl` 에 바깥 여백도 `p-6` 과 `p-8` 이 섞였습니다. 창을 오갈 때마다 화면이 들썩이고,
 * 새 창을 만들 때 무엇을 따라야 하는지도 알 수 없었습니다.
 *
 * 그래서 **세 치수**로 줄입니다. 창의 성격이 치수를 정합니다.
 *
 * - `small` — 묻고 답하는 창(확인, 한 줄 입력). 글이 몇 줄뿐입니다.
 * - `medium` — **글을 쓰는 창**(요청문, 일괄 생성). 읽기 좋은 폭이 기준입니다.
 * - `large` — **그림·타임라인**이 드는 창. 넓을수록 일이 쉬워집니다.
 *
 * 색과 테두리도 여기 한 곳입니다(규칙 2 — 디자인은 한 기준으로 통일).
 */

export type ModalSize = "small" | "medium" | "large";

const WIDTH: Record<ModalSize, string> = {
  small: "max-w-md",
  medium: "max-w-3xl",
  large: "max-w-6xl",
};

/** 화면을 덮는 바탕. `z-` 는 창마다 다르므로 **부르는 쪽이 붙입니다**(쌓는 순서가 다릅니다). */
export const MODAL_BACKDROP = "fixed inset-0 flex items-center justify-center p-6";

export const MODAL_BACKDROP_STYLE = { background: "oklch(0 0 0 / 72%)" } as const;

/** 창 몸통. 세로는 늘 화면을 넘지 않고, 안쪽에서 스크롤합니다. */
export function modalCard(size: ModalSize = "medium"): string {
  return `flex max-h-full w-full ${WIDTH[size]} flex-col rounded-xl`;
}

export const MODAL_CARD_STYLE = {
  background: "oklch(0.15 0.01 265)",
  border: "1px solid oklch(1 0 0 / 10%)",
} as const;
