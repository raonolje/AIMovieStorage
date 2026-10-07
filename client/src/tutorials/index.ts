import { COMFY_WORKFLOW_TUTORIAL } from "./comfy";
/*
  튜토리얼 목록의 입구.

  세 갈래를 한 배열로 모아 두고, 화면 쪽은 «지금 화면의 것» 만 `tutorialsFor` 로 받습니다.
  앵커 목록(`ALL_ANCHORS`)을 여기서 내는 까닭 — 화면에 `data-tour` 를 다는 쪽이 어떤 이름을
  달아야 하는지 코드로 확인할 수 있어야 합니다. 문서(ANCHORS.md)만 있으면 표와 자료가
  조용히 어긋나고, 테스트가 그 둘을 견줍니다.
*/

import { FULL_TUTORIAL } from "./full";
import { PAGE_TUTORIALS } from "./pages";
import { PLANNER_TUTORIALS } from "./planner";
import type { Tutorial, TutorialAdvance, TutorialPage, TutorialStep } from "./types";

export type { Tutorial, TutorialAdvance, TutorialKind, TutorialPage, TutorialRoute, TutorialStep } from "./types";
export { FULL_TUTORIAL } from "./full";
export { PAGE_TUTORIALS } from "./pages";
export { PLANNER_TUTORIALS } from "./planner";

/** 전부 — 한 바퀴 하나, 페이지별, 구도잡기 갈래 순서입니다. */
export const TUTORIALS: Tutorial[] = [FULL_TUTORIAL, ...PAGE_TUTORIALS, COMFY_WORKFLOW_TUTORIAL, ...PLANNER_TUTORIALS];

/**
 * 이 화면에서 «막혔을 때» 보여 줄 것.
 *
 * 한 바퀴는 어느 화면에서도 목록에 넣지 않습니다 — 그것은 처음 한 번 따라가는 것이지
 * 막힌 데를 찾는 자료가 아닙니다. 구도잡기 갈래는 `planner` 에서만 나옵니다.
 */
export function tutorialsFor(page: TutorialPage): Tutorial[] {
  return TUTORIALS.filter(
    (tutorial) =>
      tutorial.kind !== "full" &&
      (tutorial.page === page || (tutorial.pages ?? []).includes(page)),
  );
}

export function tutorialById(id: string): Tutorial | undefined {
  return TUTORIALS.find((tutorial) => tutorial.id === id);
}

/** 모든 걸음을 한 줄로 — «어디까지 봤나» 를 셀 때 씁니다. */
export function allSteps(): TutorialStep[] {
  return TUTORIALS.flatMap((tutorial) => tutorial.steps);
}

/** 걸음이 가리키는 `data-tour` 이름 전부. 중복 없이, 이름순. */
export const ALL_ANCHORS: string[] = Array.from(
  new Set(allSteps().map((step) => step.anchor).filter((anchor): anchor is string => Boolean(anchor))),
).sort();

/**
 * 이 걸음을 **무엇으로 넘길까** — 적어 둔 것이 먼저, 없으면 「해 볼 것」 문구로 짐작합니다.
 *
 * 걸음이 210개라 하나하나 적는 대신 문구에서 읽습니다. 「…을 누르세요」 는 누르면 넘어가고,
 * 「…을 적으세요」 는 글자가 들어가면 넘어갑니다. 가리킬 자리(앵커)가 없으면 시킬 수도 없으니
 * 설명 걸음으로 봅니다.
 */
/**
 * **눌렀다가는 진짜로 일이 벌어지는 자리.** 여기서는 «누르면 다음으로» 를 걸지 않습니다.
 *
 * «구성» 은 마그니픽 데스크톱을 띄워
 * 캔버스에 생성기를 놓습니다. 튜토리얼을 보려던 사람에게 밖의 프로그램이 열리고 크레딧이 나가는
 * 일이 생깁니다. 「프롬프트 작성」·「이미지 분석」·「일괄 생성」 은 API 요금이 나가고,
 * 「레퍼런스 영상 만들기」·「스토리보드 만들기」 는 몇 분씩 돕니다.
 *
 * 그래서 이 자리들은 **설명만 하고 «다음» 으로 넘깁니다.** 눌러 보고 싶으면 눌러도 되지만,
 * 누르지 않으면 못 넘어가게 막지는 않습니다. 목록을 여기 한 벌로 두는 까닭은 규칙 1 입니다 —
 * 걸음마다 `advanceOn: "manual"` 을 적으면 새 걸음에서 빠뜨립니다.
 */
const COSTLY_ANCHORS = new Set([
  // 밖으로 나갑니다 — 마그니픽 데스크톱
  "card-compose",
  // API 요금
  "card-analysis",
  "card-prompt-write",
  "card-first-reference",
  "cut-prompt-write",
  "cut-video-prompt",
  "basics-bootstrap",
  "bootstrap-run",
  "bgm-write",
  // 이 컴퓨터에서 몇 분씩 돕니다
  "card-local-generate",
  "bgm-local-generate",
  "scene-storyboard-make",
  "scene-storyboard",
  "env-room-make-image",
  "timeline-render-run",
  "finish-batch",
  "mocap-analyze",
  "mocap-apply",
  // 굽는 데 오래 걸리고 6000×6000 파일이 남습니다
  "character-sheet-compose",
]);

export function stepAdvanceMode(step: TutorialStep): TutorialAdvance {
  if (step.advanceOn) return step.advanceOn;
  if (!step.anchor) return "manual";
  if (COSTLY_ANCHORS.has(step.anchor)) return "manual";
  const said = step.action || "";
  if (/적으|적어|입력|붙여넣|쓰세요|치세요/.test(said)) return "input";
  if (/누르|눌러|여세요|열어|고르|켜세요|끄세요|선택/.test(said)) return "click";
  return "manual";
}
