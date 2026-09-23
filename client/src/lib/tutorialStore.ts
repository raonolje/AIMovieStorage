import { useSyncExternalStore } from "react";
import { FULL_TUTORIAL, tutorialById, type TutorialPage, type TutorialRoute } from "@/tutorials";
import { HOLDS_ENTITY_CARD } from "@/lib/tutorialPanels";

/**
 * **튜토리얼 살림** — 켜짐 · 본 것 · 지금 따라가는 걸음.
 *
 *
 *
 * # 왜 React 상태가 아니라 모듈인가
 *
 * 안내 창(`TutorialOverlay`)은 앱 뿌리에 하나, 여는 단추는 위 띠(`TutorialMenu`)와 설정 화면 두 곳,
 * 단계를 옮겨 달라는 부탁은 프로젝트 껍데기(`NewProjectPage`)가 받습니다. 넷이 같은 것을 봐야 하므로
 * 상태는 화면 밖 한 곳에 두고 `useSyncExternalStore` 로 구독합니다 — 언어(`i18n.ts`)와 같은 꼴입니다.
 *
 * # 무엇을 저장하나
 *
 * `enabled` · `seen` · `active` 전부 localStorage 에 씁니다. 따라가던 걸음을 앱을 껐다 켜도 이어 가게 —
 * 한 바퀴는 서른 몇 걸음이라 도중에 창을 닫는 일이 흔합니다.
 *
 * 처음 켤 때 한 바퀴가 저절로 뜨는 것은 «본 적 없음» 을 보고 정합니다. 닫거나 끝내면 «봤음» 이 되어
 * 다시는 저절로 뜨지 않습니다 — 매번 뜨면 끄게 되고, 끄면 막혔을 때도 못 씁니다.
 */

export interface TutorialRun {
  tutorialId: string;
  stepIndex: number;
}

export interface TutorialState {
  /** 설정의 스위치. 꺼져 있으면 위 띠의 단추도, 안내 창도 안 뜹니다. */
  enabled: boolean;
  /** 끝까지 봤거나 닫은 튜토리얼의 id. */
  seen: Record<string, true>;
  /** 지금 따라가는 걸음. 없으면 안내 창이 안 뜹니다. */
  active: TutorialRun | null;
}

/** 다른 옵션과 같은 관례(`ai-video-storage.<이름>.v1`). */
export const TUTORIAL_STORAGE_KEY = "ai-video-storage.tutorials.v1";

interface Saved {
  enabled?: boolean;
  seen?: string[];
  active?: TutorialRun | null;
}

const FRESH: TutorialState = { enabled: true, seen: {}, active: null };

/** 저장소는 없을 수 있습니다(단위 시험·막힌 웹뷰). 예외를 내면 앱이 첫 화면에서 죽으므로 조용히 `null`. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 저장된 걸음이 지금 자료에 있는지 확인해서 받습니다. 튜토리얼을 고쳐 걸음이 줄었거나 id 가 바뀐 채
 * 옛 저장본을 읽으면, 없는 걸음을 가리켜 빈 카드가 뜨거나 아예 안 뜹니다.
 */
function settleRun(run: unknown): TutorialRun | null {
  if (!run || typeof run !== "object") return null;
  const { tutorialId, stepIndex } = run as Partial<TutorialRun>;
  if (typeof tutorialId !== "string") return null;
  const tutorial = tutorialById(tutorialId);
  if (!tutorial || !tutorial.steps.length) return null;
  const index = typeof stepIndex === "number" && Number.isFinite(stepIndex) ? Math.floor(stepIndex) : 0;
  return { tutorialId, stepIndex: Math.max(0, Math.min(tutorial.steps.length - 1, index)) };
}

function read(): TutorialState {
  try {
    const raw = storage()?.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return FRESH;
    const parsed = JSON.parse(raw) as Saved;
    const seen: Record<string, true> = {};
    for (const id of Array.isArray(parsed.seen) ? parsed.seen : []) {
      if (typeof id === "string") seen[id] = true;
    }
    return { enabled: parsed.enabled !== false, seen, active: settleRun(parsed.active) };
  } catch {
    return FRESH;
  }
}

let state: TutorialState = read();
const listeners = new Set<() => void>();

function persist() {
  try {
    const plain: Saved = { enabled: state.enabled, seen: Object.keys(state.seen), active: state.active };
    storage()?.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(plain));
  } catch {
    // 저장이 막혀도 이번 실행 동안은 바뀐 대로 씁니다.
  }
}

/** 상태는 통째로 갈아 끼웁니다 — `useSyncExternalStore` 가 «같은 객체» 로 바뀜을 판단하기 때문입니다. */
function commit(next: TutorialState) {
  state = next;
  persist();
  for (const listener of listeners) listener();
}

export function getTutorialState(): TutorialState {
  return state;
}

export function subscribeTutorials(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 켜짐 · 본 것 · 지금 걸음. 바뀌면 다시 그립니다. */
export function useTutorial(): TutorialState {
  return useSyncExternalStore(subscribeTutorials, getTutorialState, getTutorialState);
}

/**
 * 지금 걸음이 가리키는 자리 이름. 따라가는 것이 없으면 `null`.
 *
 * 창이 **스스로 닫을 때를 알려면** 이것이 필요합니다 — 「내가 품은 자리 중에 지금 걸음의 것이
 * 없다」 면 이 창은 이 걸음에 쓸모가 없습니다(`DialogContent` 의 `tutorialHolds`).
 */
export function useCurrentTutorialAnchor(): string | null {
  const { active } = useTutorial();
  if (!active) return null;
  const tutorial = tutorialById(active.tutorialId);
  return tutorial?.steps[active.stepIndex]?.anchor ?? null;
}

export function setTutorialsEnabled(enabled: boolean) {
  if (enabled === state.enabled) return;
  // 끄면 따라가던 걸음도 접습니다 — 꺼 놓았는데 안내 창만 남아 있으면 «껐는데 왜 뜨나» 가 됩니다.
  commit({ ...state, enabled, active: enabled ? state.active : null });
}

/**
 * **튜토리얼이 설 자리를 함께 마련합니다.**
 *
 *
 * 「튜토리얼 버튼 누르면 연습용 예시 작품을 만들어야지」.
 *
 * 걸음 여럿은 «내용이 있어야 생기는» 자리를 가리킵니다 — 뽑은 그림이 없으면 가위가 없습니다. 그
 * 준비를 설정 화면의 단추 하나에 맡겨 두었더니, 갓 깐 사람은 그 단추를 볼 일이 없었습니다.
 * 그래서 **튜토리얼을 여는 순간** 마련합니다.
 *
 * 실패해도 조용합니다 — 갓 깐 직후에는 기본 저장 폴더가 아직 없어 만들 수 없습니다. 그때는 한 바퀴가
 * 폴더를 정하는 걸음을 지난 뒤, 프로젝트가 필요한 걸음에서 다시 시도합니다(`TutorialOverlay`).
 * 그래서 기회가 두 번입니다.
 *
 * 붙여 넣기(import)를 미루는 까닭 — 이 파일은 앱이 켜질 때 바로 읽히는데, 예시 작품 만드는 쪽은
 * 파일 살림과 미디어까지 끌고 옵니다. 튜토리얼을 열지 않는 사람에게까지 지울 이유가 없습니다.
 */
function prepareSampleProject() {
  void import("@/lib/tutorialSample")
    .then((module) => module.ensureTutorialSample())
    .catch(() => {
      // 폴더가 아직 없거나 데스크톱이 아닙니다. 다음 기회에.
    });
}

export function startTutorial(id: string) {
  const tutorial = tutorialById(id);
  if (!tutorial || !tutorial.steps.length) return;
  prepareSampleProject();
  commit({ ...state, active: { tutorialId: id, stepIndex: 0 } });
}

function withSeen(id: string): Record<string, true> {
  return state.seen[id] ? state.seen : { ...state.seen, [id]: true };
}

/**
 * 닫기 = 건너뛰기 = 끝. 셋 다 «봤음» 으로 적습니다.
 *
 * 도중에 닫은 것도 «봤음» 인 까닭 — 처음 켤 때 저절로 뜨는 한 바퀴를 닫았는데 다음에 또 뜨면
 * 사람은 스위치를 끄고, 그러면 막혔을 때 볼 페이지 튜토리얼까지 함께 사라집니다.
 */
export function closeTutorial() {
  if (!state.active) return;
  commit({ ...state, seen: withSeen(state.active.tutorialId), active: null });
}

export function nextStep() {
  const run = state.active;
  if (!run) return;
  const tutorial = tutorialById(run.tutorialId);
  if (!tutorial) {
    commit({ ...state, active: null });
    return;
  }
  if (run.stepIndex >= tutorial.steps.length - 1) {
    closeTutorial();
    return;
  }
  commit({ ...state, active: { ...run, stepIndex: run.stepIndex + 1 } });
}

export function prevStep() {
  const run = state.active;
  if (!run || run.stepIndex === 0) return;
  commit({ ...state, active: { ...run, stepIndex: run.stepIndex - 1 } });
}

/**
 * 설정의 «처음부터 다시 보기». 본 기록을 비우고 한 바퀴를 바로 시작합니다.
 * 스위치가 꺼져 있었으면 켭니다 — 다시 보겠다는 뜻이니까요.
 */
export function resetTutorials() {
  prepareSampleProject();
  commit({ enabled: true, seen: {}, active: { tutorialId: FULL_TUTORIAL.id, stepIndex: 0 } });
}

/** 앱을 켤 때 한 번 — 켜져 있고, 한 바퀴를 본 적이 없고, 따라가던 것이 없을 때만 한 바퀴를 띄웁니다. */
export function autoStartTutorial() {
  if (!state.enabled || state.active || state.seen[FULL_TUTORIAL.id]) return;
  startTutorial(FULL_TUTORIAL.id);
}

/* ── 어느 화면에 있는가 ──────────────────────────────────────────────────────── */

/**
 * 프로젝트 껍데기의 네 단계(1~4) ↔ 튜토리얼 화면 이름. **한 벌** — `NewProjectPage` 가 «지금 단계» 를
 * 알릴 때와 안내 창이 «그 단계로 가 달라» 고 할 때 같은 표를 씁니다. 두 벌이면 한쪽만 고쳐져
 * 안내가 엉뚱한 단계를 엽니다.
 */
export const PROJECT_STEP_PAGES: readonly TutorialPage[] = ["basics", "characters", "scenes", "finish"];

export function projectStepToPage(step: number): TutorialPage | null {
  return PROJECT_STEP_PAGES[step - 1] ?? null;
}

export function projectPageToStep(page: TutorialPage): number | null {
  const index = PROJECT_STEP_PAGES.indexOf(page);
  return index < 0 ? null : index + 1;
}

/** `/new-project` 도 `/project/:id` 도 같은 껍데기입니다 — 제목을 적어 저장되기 전에는 앞 주소에 있습니다. */
export function isProjectLocation(location: string): boolean {
  return location === "/new-project" || location.startsWith("/project/");
}

export function routeMatches(route: TutorialRoute, location: string): boolean {
  return route === "/project/:id" ? isProjectLocation(location) : location === route;
}

/**
 * 주소와 (껍데기가 알려 준) 단계로 «지금 화면» 을 정합니다. 튜토리얼 목록이 이걸로 «이 화면의 것» 만
 * 고릅니다.
 *
 * 구도잡기 창은 주소가 없습니다 — 대신 창이 열리는 동안 스스로 `planner` 라고 알립니다
 * (`CompositionPlanner`). * 창이 닫혀 있는데 목록에 구도잡기 갈래가 늘어서 있으면 눌러도 가리킬 자리가 없습니다.
 */
export function pageForLocation(location: string, reported: TutorialPage | null): TutorialPage | null {
  if (location === "/") return "projects";
  if (location === "/settings") return "settings";
  if (location === "/bgm") return "bgm";
  if (isProjectLocation(location)) return reported ?? "basics";
  return null;
}

let reportedPage: TutorialPage | null = null;
const pageListeners = new Set<() => void>();

function subscribePage(listener: () => void): () => void {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
}

function getReportedPage(): TutorialPage | null {
  return reportedPage;
}

/**
 * 지금 알려져 있는 화면. 겹쳐 뜨는 창(구도잡기)이 **덮기 전의 것을 기억해 두었다가 닫을 때
 * 되돌리려고** 씁니다 — 그냥 `null` 로 되돌리면 프로젝트 껍데기의 단계 보고가 다시 오지 않아
 * («단계가 안 바뀌었으니») 창을 닫은 뒤 목록이 텅 빕니다.
 */
export function currentTutorialPage(): TutorialPage | null {
  return reportedPage;
}

/** 프로젝트 껍데기가 «지금 이 단계» 를 알립니다. 화면을 떠나면 `null`. */
export function reportTutorialPage(page: TutorialPage | null) {
  if (page === reportedPage) return;
  reportedPage = page;
  for (const listener of pageListeners) listener();
}

export function useReportedTutorialPage(): TutorialPage | null {
  return useSyncExternalStore(subscribePage, getReportedPage, getReportedPage);
}

/* ── 「그 단계를 열어 줘」 ────────────────────────────────────────────────────── */

/**
 * 안내 창은 앱 뿌리에 살아서 프로젝트 껍데기의 단계 상태를 직접 못 만집니다. 창 이벤트로 부탁하고
 * 껍데기가 듣습니다. 이름을 여기 한 곳에 두어 보내는 쪽과 듣는 쪽이 어긋나지 않게 합니다.
 */
export const TUTORIAL_PAGE_EVENT = "tutorial:page";

/* ── 인물 카드 창을 걸음에 맞춰 열고 닫기 ───────────────────────────────────── */

/**
 * 캐릭터 걸음은 **두 층**에 걸쳐 있습니다 — 인물 카드 창 «안»(레퍼런스·분석·프롬프트·뽑은 그림·가위)과
 * 그 아래 «패널»(인물 패널·캐릭터 추가·시트 제작·변형). 사람이 손으로 맞춰 열고 닫아야 했더니
 * 창이 덮고 있으면 패널의 자리를
 * 못 가리키고, 창이 닫혀 있으면 창 안의 자리를 못 가리킵니다.
 *
 * 규칙은 **앵커 이름에 이미 있습니다.** `card-…` 는 카드 안의 것이고, 아래 넷은 창 밖의 것입니다.
 * 그래서 걸음마다 따로 적지 않고 여기 한 곳에서 읽습니다(규칙 1 — 같은 규칙을 두 벌 적지 않기).
 */
const OUTSIDE_THE_CARD = new Set([
  "character-panel",
  "characters-add",
  "character-sheet-compose",
  "character-variation",
]);

export type TutorialCardWant = "open" | "closed";

const INSIDE_THE_CARD = new Set(HOLDS_ENTITY_CARD.split(/\s+/).filter(Boolean));

export function cardWantFor(anchor: string | undefined): TutorialCardWant | null {
  if (!anchor) return null;
  /*
    **이름 앞머리로 짐작하지 않습니다.** 예전에는 `card-…` 로 시작하면 열고 나머지는 두었는데,
    가위 창(`cropper-…`)과 그림 위 아이콘(`image-actions`)처럼 **다른 이름으로 생긴 자리**가
    카드 안에 있을 때마다 새어 나갔습니다. 이제 카드가 «내가 품었다» 고
    적어 둔 목록 그대로 봅니다 — 새 자리를 그 목록에 넣으면 여기도 저절로 맞습니다.
  */
  if (INSIDE_THE_CARD.has(anchor)) return "open";
  return OUTSIDE_THE_CARD.has(anchor) ? "closed" : null;
}

export const TUTORIAL_CARD_EVENT = "tutorial:card";

/** 「인물 카드 창을 열어 줘 / 닫아 줘」 — `StepCharacters` 가 듣습니다. */
export function requestTutorialCard(want: TutorialCardWant) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TutorialCardWant>(TUTORIAL_CARD_EVENT, { detail: want }));
}

/**
 * 컷도 같은 사정입니다 — 접힌 컷 카드는 머리줄(«구도잡기» · «구도 불러오기»)만 보입니다.
 * 그 아래 `cut-…` 자리들은 펴야 생깁니다. 접혀 있어도 보이는 둘은 뺍니다.
 */
const CUT_HEADER = new Set(["cut-open-planner", "cut-import-composition"]);

export function cutWantFor(anchor: string | undefined): "open" | null {
  if (!anchor || !anchor.startsWith("cut-")) return null;
  return CUT_HEADER.has(anchor) ? null : "open";
}

export const TUTORIAL_CUT_EVENT = "tutorial:cut";

/** 「컷 하나를 펴 줘」 — `StepScenes` 가 듣고, 없으면 장면과 컷을 만들어 폅니다. */
export function requestTutorialCut() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TUTORIAL_CUT_EVENT));
}

export function requestTutorialPage(page: TutorialPage) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TutorialPage>(TUTORIAL_PAGE_EVENT, { detail: page }));
}

export function onTutorialPageRequest(listener: (page: TutorialPage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TutorialPage>).detail;
    if (typeof detail === "string") listener(detail);
  };
  window.addEventListener(TUTORIAL_PAGE_EVENT, handler);
  return () => window.removeEventListener(TUTORIAL_PAGE_EVENT, handler);
}
