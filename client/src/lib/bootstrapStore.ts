import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { expectEmptyProjectSave, getLocalProject } from "@/lib/localProjectStore";
import { onProjectOpened, writeProject } from "@/lib/projectWrite";
import { startProjectGeneration } from "@/lib/batchRun";
import { retargetTasks } from "@/lib/taskQueue";
import type { ProjectDraft } from "@/lib/projectTypes";
import {
  applyBootstrapToDraft,
  summarizeBootstrap,
  type BootstrapApplyOptions,
  type BootstrapOutline,
  type BootstrapResult,
} from "@/lib/projectBootstrap";

/**
 * **AI 일괄 생성 살림** — 창 밖에, 프로젝트마다.
 *
 *
 *
 * # 왜 React 상태로는 안 되는가
 *
 * 일괄 생성 창은 «주제 설정» 단계 안에 삽니다. 캐릭터 단계로 한 발만 옮겨도 그 단계가
 * 통째로 사라지고, 창의 상태 — 돌고 있다는 표시도, TOP 모델로 두 번 받아 온 답도 —
 * 함께 사라졌습니다. 요청 자체는 계속 돌지만 **받을 사람이 없는** 요청이 됩니다.
 * 세 단계에 십 분 가까이 걸리는 일을, 그동안 아무 데도 못 가고 지켜야 했습니다.
 *
 * 그래서 진행도 결과도 여기 둡니다. 창은 들여다보는 구멍일 뿐입니다.
 *
 * # 프로젝트마다 따로
 *
 * 열쇠는 **프로젝트 id** 입니다. 폴더 이름을 쓰면 제목을 고치는 순간 열쇠가 바뀌어 돌던
 * 일이 주인을 잃습니다. 아직 저장 전이면 「새 프로젝트」 하나를 쓰고, 처음 저장되어 id 가
 * 생기면 `adoptBootstrapRun` 이 옮깁니다.
 *
 * # 받은 답은 **자동으로 들어갑니다**
 *
 * 어디에 붓는지는 아래 `deliver` 의 주석을 보세요 — 열려 있으면 화면으로, 닫혀 있으면
 * 프로젝트 파일로. 「비우고 새로」 만 확인을 받습니다.
 *
 * # 왜 두 파일인가
 *
 * 세 왕복을 실제로 도는 절차(줄에 세우기 · LLM 호출 · 중지)는 `bootstrapRun.ts` 에 있습니다.
 * 한 파일에 살림과 절차가 같이 있어 700줄에 다다르자 사용자가 갈라 두라 했습니다(2026-09-18).
 * 이 파일은 **들고 있고, 저장하고, 붓는 것**만 합니다. 돌리기가 이 파일을 쓰고, 이 파일은
 * 돌리기를 모릅니다 — 반대로 import 하면 순환이라 둘 중 하나가 undefined 로 뜹니다.
 */

export interface BootstrapInput {
  source: string;
  hint: string;
  counts: { characters: string; backgrounds: string; scenes: string };
  mode: BootstrapApplyOptions["mode"];
  /**
   * 넣고 **이미지·영상까지 바로 뽑을까.**
   *
   *
   *
   * 프로젝트마다 기억합니다 — 이 작품은 늘 뽑고, 저 작품은 글만 받는다가 갈리니까요.
   */
  thenGenerate?: boolean;
  /**
   * 넣은 뒤 **카드마다 프롬프트를 LLM 으로 따로 쓸까**(4단계). 안 적으면 씁니다.
   *
   *
   *
   * 3단계는 컷 예순 개의 프롬프트를 **한 답**에 받아 컷마다 한 문단이 고작이고, 인물·장소 시트는 규칙
   * 조립뿐입니다. 4단계가 카드 단추(「프롬프트 작성」)와 **같은 요청**을 카드마다 보냅니다 — 요금과
   * 시간이 카드 수만큼 드니 끌 수 있게 둡니다. 프로젝트마다 기억합니다(`thenGenerate` 와 같은 까닭).
   */
  richPrompts?: boolean;
  /**
   * 「비우고 새로」 를 **미리 확인받았는가.**
   *
   *
   * 받은 뒤에 «적용» 을 기다리면, 답이 다 나왔는데 사람이 그 자리에 없어서 아무 일도
   * 안 일어납니다(실제로 「영상이랑 이미지 안 뽑는데?」 의 원인이었습니다). 그래서 지우는
   * 일에 대한 확인은 **만들기를 누를 때** 받고, 받은 답은 늘 저절로 들어갑니다.
   */
  replaceOk?: boolean;
  /**
   * 함께 올린 **그림·영상**과 「이걸 어떻게 쓰라」 는 말.
   *
   * 예로 든 것이 **댄스 커버**입니다 — 춤 영상을 올리고 「이 동작
   * 그대로, 캐릭터와 배경만 바꿔」.
   *
   * 글만으로는 「이 춤」 을 말할 수 없습니다. 그림은 모델에게 **그대로 보여 주고**,
   * 영상은 보여 줄 수 없으니 **무엇을 참조할지 적은 말**과 파일 경로를 함께 싣습니다 —
   * 경로가 있어야 나중에 모캡·영상 레퍼런스로 이어집니다.
   */
  refs?: BootstrapRef[];
  /**
   * 글을 뽑아 온 **원본 문서**(`<프로젝트>/DOCU/…`).
   *
   * , 「PDF는 프로젝트 폴더 안에 DOCU 폴더 만들어서 넣자」.
   *
   * 뽑아낸 글은 위 `source` 에 들어가고 프로젝트 파일과 함께 저장됩니다. 그래도 **원본은
   * 남겨 둡니다** — 쪽번호가 섞였거나 표가 무너졌을 때 다시 열어 봐야 하고, 「무엇으로
   * 만든 작품인가」 를 나중에 되짚는 길이 그것뿐입니다.
   */
  docs?: BootstrapDoc[];
}

/** 일괄 생성에 넣은 문서 한 개. */
export interface BootstrapDoc {
  id: string;
  /** 프로젝트 폴더에 저장된 경로(`<프로젝트>/DOCU/…`). */
  path: string;
  /** 화면에 보일 이름(확장자까지 — 무슨 갈래인지가 보여야 합니다). */
  name: string;
  /** 뽑아낸 글자 수. 「제대로 읽혔나」 를 한눈에 보는 값입니다. */
  chars: number;
  /** PDF 면 쪽 수. */
  pages?: number;
}

export interface BootstrapRef {
  id: string;
  /** 프로젝트 폴더에 저장된 경로. */
  path: string;
  /** 화면에 보일 이름(확장자 없이). */
  name: string;
  kind: "image" | "video";
  /** 「이 영상의 안무를 그대로」 처럼, 무엇을 어떻게 쓸지. */
  note: string;
}

/**
 * 올린 파일의 **이름표** — `ref_img_1` · `ref_mov_2`.
 *
 *
 *
 * 왜 필요한가 — 파일을 여러 장 올리면 「캐릭터는 어떤 그림이고 동작은 어떤 영상인지」
 * 를 가리킬 말이 없습니다. 파일 이름으로 부르면 한글·공백·확장자가 섞여 LLM 이 자주
 * 놓칩니다. **짧고 규칙적인 이름표**를 앱이 붙여 주고, 사람은 시나리오에 그 이름을
 * 그대로 적으면 됩니다 — 「ref_img_1 의 얼굴로, ref_mov_1 의 안무를 그대로」.
 *
 * 번호는 **갈래 안에서** 셉니다. 그림만 셋이면 img_1·2·3 이고, 영상이 섞여도
 * 그림 번호는 그대로입니다 — 하나를 지웠을 때 덜 흔들립니다.
 */
export function refTag(refs: BootstrapRef[], id: string): string {
  const item = refs.find((entry) => entry.id === id);
  if (!item) return "";
  const sameKind = refs.filter((entry) => entry.kind === item.kind);
  const order = sameKind.findIndex((entry) => entry.id === id) + 1;
  return `@ref_${item.kind === "video" ? "mov" : "img"}_${order}`;
}

/**
 * 글에서 **제대로 연결된 이름표**를 찾습니다.
 *
 * 우리 앱은 그림을 `@이름` 으로 부릅니다(마그니픽 규칙) — 자동 생성만 다른
 * 표기를 쓰면 배울 것이 둘이 됩니다. 그래서 여기도 `@` 를 붙입니다.
 *
 * **연결된 것만** 돌려줍니다. 사람이 `@ref_img_9` 라고 적었는데 그런 파일이 없으면
 * 그건 연결이 아닙니다 — 색이 안 바뀌어야 «잘못 적었다» 를 알아챕니다.
 */
export function linkedTags(text: string, refs: BootstrapRef[]): string[] {
  const known = new Set(refs.map((item) => refTag(refs, item.id)));
  const found = text.match(/@ref_(?:img|mov)_\d+/g) ?? [];
  return [...new Set(found.filter((tag) => known.has(tag)))];
}

/** 글에 적혔지만 **가리키는 파일이 없는** 이름표. 잘못 적은 것을 알려 주는 데 씁니다. */
export function brokenTags(text: string, refs: BootstrapRef[]): string[] {
  const known = new Set(refs.map((item) => refTag(refs, item.id)));
  const found = text.match(/@ref_(?:img|mov)_\d+/g) ?? [];
  return [...new Set(found.filter((tag) => !known.has(tag)))];
}

/** 지난 답 한 벌. 「api 로 받은 데이터」 라 버리지 않습니다. */
export interface BootstrapPast {
  id: string;
  createdAt: number;
  /** 목록에 적을 한 줄 — 「캐릭터 2 · 배경 1 · 장면 4 · 컷 20」. */
  note: string;
  /** 사람이 붙인 이름. */
  label?: string;
  /** 무엇으로 받았는지 — 시나리오 첫 줄. 미리보기에 씁니다. */
  source: string;
  result: BootstrapResult;
}

export interface BootstrapRun {
  input: BootstrapInput;
  /**
   * 0 이면 쉬는 중. 1·2·3 은 몇 번째 왕복인가. 4 는 **카드마다 프롬프트를 쓰는 중**(2026-09-22) —
   * 이때는 한 요청이 아니라 카드 수만큼의 작업이 줄에 서 있고, 몇 개째인지는 `prompts` 가 셉니다.
   */
  stage: 0 | 1 | 2 | 3 | 4;
  /**
   * 4단계 진행 — `done` 은 **지금 도는 카드 앞에 선 카드 수**(0부터), `total` 은 전체. 창은 +1 해서 «n번째 쓰는 중»
   * 으로 적습니다(첫 카드가 도는 동안 「0/12」 로 보이면 멈춘 줄 압니다). 4단계가 아니면 비어 있습니다.
   */
  prompts?: { done: number; total: number } | null;
  /**
   * 1단계로 받아 둔 작품 정보. **2단계가 실패해도 버리지 않습니다** — 이미 값을 치른
   * 답이라, 버리면 처음부터 두 번 결제해야 합니다.
   */
  outline: BootstrapOutline | null;
  result: BootstrapResult | null;
  /** 마지막으로 답이 도착한 시각. 창이 그새 닫혀 있었는지 가리는 데 씁니다. */
  doneAt: number | null;
  /** 초안에 부은 시각. 차 있으면 그 답은 이미 들어간 것이라 다시 붓지 않습니다. */
  appliedAt: number | null;
  /** 자동으로 붓지 못한 까닭. 화면이 그대로 사람에게 보여 줍니다. */
  held: string | null;
  error: string | null;
  /** 줄에 서서 차례를 기다리는 중인가. 도는 것(`stage`)과 다릅니다. */
  queued?: boolean;
  /** 줄에 세운 작업의 id — «중지» 가 이걸로 줄에서 뺍니다. */
  taskId?: string | null;
  /**
   * 지난 답들. 돈을 내고 받은 것이라 덮어쓰고 버리지 않습니다.
   *
   * 프롬프트 카드가
   * 오래전부터 하던 일과 같습니다(`promptHistory`) — 두 번 돌렸다는 것은 무언가를
   * 바꿔서 돌렸다는 뜻이고, 앞의 것이 더 나았을 때 돌아갈 길이 있어야 합니다.
   */
  history?: BootstrapPast[];
}

export const EMPTY_RUN: BootstrapRun = {
  input: {
    source: "",
    hint: "",
    counts: { characters: "", backgrounds: "", scenes: "" },
    mode: "append",
    thenGenerate: false,
    refs: [],
    docs: [],
  },
  stage: 0,
  outline: null,
  result: null,
  doneAt: null,
  appliedAt: null,
  held: null,
  error: null,
  queued: false,
  taskId: null,
  history: [],
};

const STORAGE_KEY = "frameforge.bootstrapRuns";
/** 몇 프로젝트까지 들고 있을까. 답이 수십 KB 라 무한정 쌓으면 localStorage 가 찹니다. */
const KEEP = 6;
/** 프로젝트마다 지난 답을 몇 벌까지 들고 있을까. 한 벌이 수십 KB 입니다. */
const KEEP_PAST = 5;

let store: Record<string, BootstrapRun> = {};
const listeners = new Set<() => void>();
/*
  열쇠가 바뀔 때(`adoptBootstrapRun`) 함께 옮겨야 할 것을 «돌리기» 가 여기 걸어 둡니다.

  돌고 있는 요청의 id 는 돌리기(`bootstrapRun.ts`) 만 쓰고 지웁니다 — 저장할 값도 아니고
  살림이 LLM 요청 id 를 알 까닭도 없습니다. 그렇다고 살림이 돌리기를 import 하면
  순환입니다(돌리기가 살림을 씁니다). 그래서 돌리기가 켜질 때 훅을 걸고, 살림은 열쇠가
  바뀌면 그 훅만 부릅니다. 돌리기는 `main.tsx` 가 앱을 켤 때 통째로 불러오므로, 첫 저장이
  일어나기 전에 늘 걸려 있습니다.
*/
let adoptHooks: Array<(from: string, to: string) => void> = [];
export function onBootstrapAdopted(hook: (from: string, to: string) => void) {
  adoptHooks = [...adoptHooks, hook];
}

/*
  **부은 뒤에 이어 할 일**(4단계 — 카드마다 프롬프트 쓰기, `bootstrapPrompts.ts`)도 같은 모양의 훅입니다.
  살림이 4단계를 import 하면 4단계가 살림을 쓰므로 순환입니다. 훅이 참을 돌려주면 «넣고 바로 뽑기» 는 그쪽이
  프롬프트를 다 쓴 뒤에 맡습니다 — 시트를 뽑는 줄(media)과 프롬프트를 쓰는 줄(llm)은 따로 돌아서, 여기서 바로
  뽑기를 세우면 아직 규칙 조립뿐인 프롬프트로 그림이 먼저 뽑힙니다.
*/
export type BootstrapDeliveredHook = (
  project: string,
  draft: ProjectDraft,
  result: BootstrapResult,
  input: BootstrapInput,
) => boolean;
let deliveredHooks: BootstrapDeliveredHook[] = [];
export function onBootstrapDelivered(hook: BootstrapDeliveredHook) {
  deliveredHooks = [...deliveredHooks, hook];
}

/*
  구독자에게 나눠 줄 **같은 객체**를 들고 있어야 합니다. `useSyncExternalStore` 는 값이
  달라지면 다시 그리는데, 매번 새 객체를 만들면 영원히 다시 그립니다(모캡 살림과 같은 함정).
*/
function emit() {
  listeners.forEach((listener) => listener());
  /*
    저장은 **늦춰서** 합니다. 시나리오를 붙여넣고 타자를 치는 동안 글자마다 답 전체를
    JSON 으로 굽게 되는데, 3단계 답은 수십 KB 라 그대로 두면 입력이 끊깁니다.
  */
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save() {
  saveTimer = null;
  try {
    const entries = Object.entries(store)
      .filter(([, run]) => run.result || run.input.source.trim())
      .sort((a, b) => (b[1].doneAt ?? 0) - (a[1].doneAt ?? 0))
      .slice(0, KEEP)
      // 돌고 있던 표시는 저장하지 않습니다 — 앱을 껐다 켜면 그 요청은 이미 없습니다.
      // (4단계의 셈도 같이 — 줄에 남은 일이 다시 돌면서 제 셈을 다시 적습니다.)
      .map(([key, run]) => [key, { ...run, stage: 0 as const, prompts: null, queued: false }] as const);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 저장이 막혀도(사생활 모드·용량) 이번 세션 동안은 그대로 씁니다.
  }
}

let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) store = { ...(JSON.parse(raw) as Record<string, BootstrapRun>) };
  } catch {
    store = {};
  }
}

/*
  ── 아래 runOf · patchRun · deliver 는 «돌리기»(`bootstrapRun.ts`) 가 쓰라고 내보냅니다 ──
  이 셋만 내보냅니다. 저장·구독·히스토리는 창과 화면이 쓰는 것이라 위의 창 쪽 함수로만
  만집니다. 돌리기가 살림을 부르고, 살림은 돌리기를 모릅니다.
*/
export function runOf(project: string): BootstrapRun {
  load();
  return store[project] ?? EMPTY_RUN;
}

/** 지금 값을 받아 다음 값을 만듭니다 — 창이 입력을 만지는 동안 답이 도착해도 서로 안 지웁니다. */
export function patchRun(project: string, patch: (current: BootstrapRun) => Partial<BootstrapRun>) {
  const current = runOf(project);
  store = { ...store, [project]: { ...current, ...patch(current) } };
  emit();
}

export function useBootstrapRun(project: string): BootstrapRun {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => runOf(project),
    () => EMPTY_RUN,
  );
}

export function setBootstrapInput(project: string, patch: Partial<BootstrapInput>) {
  patchRun(project, (current) => ({ input: { ...current.input, ...patch } }));
}

/** 창에서 사람이 «적용» 을 눌렀을 때 — 부은 것은 창이지만 표시는 살림이 합니다. */
export function markBootstrapApplied(project: string) {
  patchRun(project, () => ({ appliedAt: Date.now(), held: null }));
}

/**
 * 새 프로젝트가 처음 저장되어 **열쇠가 바뀌었을 때** 돌던 일을 옮깁니다.
 *
 * 저장 전에는 열쇠가 「새 프로젝트」 하나뿐입니다. 제목을 적는 순간 자동 저장이 돌아
 * id 가 생기는데, 그때 옮겨 주지 않으면 돌고 있던 답이 주인 없는 자리에 떨어집니다.
 */
export function adoptBootstrapRun(from: string, to: string) {
  load();
  const run = store[from];
  if (!run || from === to || store[to]?.result) return;
  const { [from]: _gone, ...rest } = store;
  store = { ...rest, [to]: run };
  /*
    **줄에 선 일도 새 열쇠로.** 세 왕복(`bootstrap`)이 아직 차례를 기다리거나, 4단계(`bootstrapPrompt`)가 카드마다
    줄에 서 있는 채로 열쇠가 바뀝니다 — 살림만 옮기고 줄을 두면 그 일들이 전부 «아직 저장 전인 프로젝트» 로
    실패했습니다(2026-09-22 검토). 열쇠를 바꾸는 곳이 여기 하나라 옮기는 것도 여기서 한 번에(`retargetTasks`).
  */
  retargetTasks(from, to);
  // 돌고 있는 요청 id 도 새 열쇠로 — 맵은 돌리기가 들고 있어 훅으로 부탁합니다.
  adoptHooks.forEach((hook) => hook(from, to));
  emit();
  // 옮기자마자 부을 곳이 생겼을 수 있습니다 — 저장되기 전에 끝난 답이 그렇습니다.
  deliver(to, true);
}

/*
  ── 받은 답을 **자동으로 붓습니다** ─────────────────────────────────────

  

  어려웠던 것은 «어디에 부을 것인가» 였습니다 — 그 답은 `lib/projectWrite.ts` 에 있습니다
  (열려 있으면 화면으로, 닫혀 있으면 프로젝트 파일로).

  **«비우고 새로» 만은 자동으로 붓지 않습니다.** 카드와 장면이 목록에서 빠지는 일이라,
  이 저장소의 규칙상 되돌릴 수 없는 조작은 무엇이 지워지는지 먼저 말하고 확인을 받아야
  합니다(CLAUDE.md). 그때는 답을 들고 기다리고, 창을 열면 «적용» 이 확인을 띄웁니다.
*/

/*
  화면이 열리면 기다리던 답이 있는지 봅니다 — 저장 전이라 파일에 못 쓰고 들고 있던 것이
  여기로 옵니다. 붓는 통로 자체는 `lib/projectWrite.ts` 하나를 «한 번에 뽑기» 와 함께
  씁니다(공통 규칙 1).
*/
onProjectOpened((project) => deliver(project));

/**
 * @param announce 방금 끝난 일인가. 참이면 못 부은 까닭을 알림으로도 말합니다 —
 * 화면을 열 때마다(`registerBootstrapTarget`) 같은 알림이 뜨면 잔소리가 됩니다.
 */
/** 지난 답 목록에 쌓습니다. 같은 답이 두 줄로 쌓이지 않게 맨 앞과 견줍니다. */
function keepPast(project: string, result: BootstrapResult, input: BootstrapInput) {
  const made = summarizeBootstrap(result, { characters: [], backgrounds: [] });
  const note = [
    `캐릭터 ${made.characterNames.length}`,
    `배경 ${made.backgroundNames.length}`,
    `장면 ${made.sceneTitles.length}`,
    made.cutCount ? `컷 ${made.cutCount}` : "",
    made.shotCount ? `구도 ${made.shotCount}` : "",
    input.mode === "replace" ? "비우고 새로" : "덧붙이기",
  ]
    .filter(Boolean)
    .join(" · ");
  patchRun(project, (current) => {
    const list = current.history ?? [];
    if (list[0]?.note === note && list[0]?.source === input.source.trim()) return {};
    return {
      history: [
        {
          id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
          createdAt: Date.now(),
          note,
          source: input.source.trim(),
          result,
        },
        ...list,
      ].slice(0, KEEP_PAST),
    };
  });
}

/**
 * 지난 답을 **다시 넣습니다.** 「아까 그 판이 더 나았다」 의 길입니다.
 *
 * 늘 «덧붙이기» 로 넣습니다 — 되돌리기가 카드를 지우는 일이 되면 안 됩니다.
 */
export function restoreBootstrap(project: string, historyId: string) {
  const run = runOf(project);
  const past = (run.history ?? []).find((item) => item.id === historyId);
  if (!past) return;
  const made = summarizeBootstrap(past.result, { characters: [], backgrounds: [] });
  // 알림은 **저장 결말을 본 뒤** — 닫힌 작품이면 거절될 수 있습니다(2026-09-21 두 창 사고).
  // 까닭은 `writeProject` 가 준 것 그대로 — 여기서 단정하면 파일 쓰기 실패일 때 틀립니다.
  void writeProject(project, (current) =>
    applyBootstrapToDraft(current, past.result, { mode: "append" }),
  ).then((wrote) => {
    if (!wrote.draft) {
      toast.error("지난 답을 넣지 못했습니다.", { description: wrote.why });
      return;
    }
    toast.success(
      `지난 답을 다시 넣었습니다 — 캐릭터 ${made.characterNames.length} · 배경 ${made.backgroundNames.length} · 장면 ${made.sceneTitles.length}.`,
      { description: "이미 있는 이름은 새로 만들지 않고 원래 카드를 가리킵니다.", duration: 10000 },
    );
  });
}

export function renameBootstrapPast(project: string, historyId: string, label: string) {
  patchRun(project, (current) => ({
    history: (current.history ?? []).map((item) => (item.id === historyId ? { ...item, label } : item)),
  }));
}

export function removeBootstrapPast(project: string, historyId: string) {
  patchRun(project, (current) => ({
    history: (current.history ?? []).filter((item) => item.id !== historyId),
  }));
}

/**
 * @param announce 방금 끝난 일인가. 참이면 못 부은 까닭을 알림으로도 말합니다 —
 * 화면을 열 때마다 같은 알림이 뜨면 잔소리가 됩니다.
 */
/**
 * 지금 붓는 중인 작품.
 *
 * 붓기가 저장 결말을 기다리는 동안(닫힌 작품은 파일 쓰기가 줄에 섭니다) `deliver` 가 다시
 * 불릴 수 있습니다 — 그 사이 화면을 열면 `onProjectOpened` 가 부릅니다. `appliedAt` 은 결말을
 * 본 뒤에야 찍히므로 그것만으로는 못 막고, 두 번 부으면 씬은 이름으로 안 걸러져 **두 벌**이
 * 됩니다. 예전에는 동기라 이 틈이 없었습니다.
 *
 * 여기서 버린 «열렸다» 는 잃지 않습니다 — 그 사이 열린 화면은 부은 판을 이미 들고 있고,
 * `writeProject` 가 결말을 낼 때 그것을 «들어갔다» 로 돌려줍니다(2026-09-22 검토: 예전에는 닫힌
 * 길이 실패하면 화면이 열려 있는데도 「열면 들어갑니다」 만 남아, 닫았다 열 때 두 벌이 됐습니다).
 */
const delivering = new Set<string>();

export function deliver(project: string, announce = false) {
  const run = runOf(project);
  const result = run.result;
  if (!result || run.appliedAt || run.stage !== 0 || delivering.has(project)) return;

  const hold = (why: string) => {
    patchRun(project, () => ({ held: why }));
    if (announce) toast.message("받아 두었습니다 — 넣으려면 확인이 필요합니다.", { description: why, duration: 12000 });
  };

  const mode = run.input.mode;
  /*
    「비우고 새로」 는 **만들기를 누를 때** 확인을 받습니다(`replaceOk`). 그 확인 없이
    여기까지 온 답은 붓지 않습니다 — 카드와 장면이 목록에서 빠지는 일이라, 무엇이
    지워지는지 먼저 말하고 확인을 받아야 합니다(CLAUDE.md).
  */
  if (mode === "replace" && !run.input.replaceOk) {
    hold("«비우고 새로» 는 카드와 장면이 목록에서 빠지는 일이라 확인이 필요합니다 — 창을 열고 «만들기» 를 다시 눌러 주세요.");
    return;
  }

  const made = summarizeBootstrap(result, { characters: [], backgrounds: [] });
  /*
    비우기로 했는데 **들어갈 것이 하나도 없는** 답. 그대로 부으면 목록이 전부 0 이 되고,
    자동 저장이 「내용이 있었는데 전부 사라졌다」 로 조용히 막혀 화면과 파일이 어긋납니다.
  */
  if (
    mode === "replace" &&
    !made.characterNames.length &&
    !made.backgroundNames.length &&
    !made.sceneTitles.length
  ) {
    hold("만들어진 캐릭터·배경·장면이 하나도 없는 답입니다 — 이대로 비우면 화면이 텅 빕니다. «이미 있는 것에 덧붙이기» 로 바꾸거나 다시 만들어 보세요.");
    return;
  }

  /*
    다른 프로젝트를 보고 있을 때 들어갈 수 있으니 **어느 작품인지** 를 함께 말합니다.
    「캐릭터 4 · 배경 3 을 넣었습니다」 만 뜨면 어디에 들어간 것인지 알 수 없습니다.
  */
  const title = getLocalProject(project)?.title || made.title || "";
  const done = () => {
    patchRun(project, () => ({ appliedAt: Date.now(), held: null }));
    keepPast(project, result, run.input);
    toast.success(
      `${title ? `${title} — ` : ""}캐릭터 ${made.characterNames.length} · 배경 ${made.backgroundNames.length} · 장면 ${made.sceneTitles.length} 을 넣었습니다.`,
      {
        description:
          (made.shotCount ? `컷 ${made.shotCount}개에 구도와 키 이미지 프롬프트까지 들어갔습니다. ` : "") +
          (mode === "replace"
            ? "그림이 붙은 카드는 남겼습니다."
            : "이미 있는 이름은 새로 만들지 않고 원래 카드를 가리킵니다."),
        duration: 12000,
      },
    );
  };

  /*
    값이 아니라 함수로 — 기다리는 동안 사람이 만진 칸을 지우지 않습니다(CLAUDE.md).

    ── 넣고 **바로 뽑기** ────────────────────────────────────────────────
    

    줄에 세울 초안은 **방금 넣은 그것**이어야 합니다 — `writeProject` 가 돌려주는 «실제로
    저장된 판». 같은 함수를 한 번 더 돌려 얻으면 컷 id 가 새로 만들어져, 뽑은 그림이 어느
    컷에도 안 붙습니다.

    ── 왜 `done()` 이 결말 뒤인가 ──────────────────────────────────────────
    2026-09-21 검토: 닫힌 작품에 부을 때 저장이 «다른 창이 먼저 썼다» 로 거절돼도 예전에는
    곧바로 `appliedAt` 을 찍었습니다. 그러면 답은 파일에 없는데 «넣었다» 가 되어 **다시는 안
    부어집니다** — 세 왕복 십 분짜리 답이 영영 사라졌습니다. 지금은 저장 결말을 본 뒤에만
    찍고, 못 넣었으면 들고 있다가(`hold`) 창을 열 때 다시 붓습니다.

    갱신 함수는 다시 돌려도 됩니다 — `expectEmptyProjectSave` 는 켜기만 하는 깃발이라 두 번
    켜도 같고, `applyBootstrapToDraft` 는 받은 초안을 안 건드립니다.
  */
  delivering.add(project);
  void writeProject(project, (current) => {
    /*
      비우는 저장 한 번은 미리 허락해 둡니다 — 사람이 «비우고 넣기» 를 고른 저장인데
      자동 저장이 조용히 막으면, 화면은 비었는데 파일에 옛 내용이 남습니다.
    */
    if (mode === "replace" && (current.characters.length || current.backgrounds.length || current.scenes.length))
      expectEmptyProjectSave();
    return applyBootstrapToDraft(current, result, { mode });
  })
    .then((wrote) => {
      if (!wrote.draft) {
        // 까닭은 저장 통로가 준 것 그대로(`WriteOutcome.why`). 못 넣은 답은 어디에도 없으니 열 때 다시 붓습니다.
        hold(`${wrote.why} 그 프로젝트를 열면 바로 들어갑니다.`);
        return;
      }
      done();
      /*
        4단계(카드마다 프롬프트 쓰기)가 이어받으면 «바로 뽑기» 도 그쪽이 맡습니다 — 프롬프트가 다 써진
        뒤에 뽑아야 규칙 조립뿐인 글로 시트가 먼저 나오지 않습니다. 훅이 아무것도 안 세웠으면 여태처럼.
        `some` 이라 훅이 하나 참을 주면 나머지는 안 부릅니다 — 지금은 하나뿐입니다.
      */
      const handedOver = deliveredHooks.some((hook) => hook(project, wrote.draft, result, run.input));
      if (!handedOver && run.input.thenGenerate) startProjectGeneration(project, wrote.draft);
    })
    .finally(() => delivering.delete(project));
}
