import { appPromptRequest, applyAppPromptResult } from "./appPromptRequest";
import { assertPromptSnapshot } from "./promptModelSelection";
import { toast } from "sonner";
import { onBootstrapAdopted, onBootstrapDelivered, patchRun } from "./bootstrapStore";
import { startProjectGeneration } from "./batchRun";
import { summarizeBootstrap, type BootstrapResult } from "./projectBootstrap";
import { cancelLlmJob, isLlmCancel, requestPromptFromLlm } from "./promptRequest";
import { readProject, writeProject } from "./projectWrite";
import { enqueueTasks, isStopping, pendingTasksOf, projectIdOfTask, registerTaskRunner, stopTask, withResumableLlm, type NewTask } from "./taskQueue";
import type { Cut, ProjectDraft, Scene } from "./projectTypes";

/**
 * **AI 일괄 생성 4단계 — 카드마다 프롬프트를 자세히 쓰기.**
 *
 *
 *
 * # 왜 4단계인가
 *
 * 세 왕복(`bootstrapRun.ts`)은 3단계에서 **컷 예순 개의 프롬프트를 한 답(2만 토큰)에** 받습니다 — 컷마다
 * 한 문단이 고작이고, 사람을 묘사하지 말라고까지 시킵니다. 인물·장소 시트는 아예 LLM 없이 규칙으로
 * 조립합니다(`projectBootstrap.buildCharacter`). 그러니 어제 요청 문구(`cut-prompt.md`·`character-sheet.md`)를
 * 아무리 풍부하게 고쳐도 일괄 생성의 글에는 **한 글자도 닿지 않았습니다.** 문구를 더 써서 될 일이 아닙니다.
 *
 * 여기서는 붓고 난 초안의 카드마다 **카드 단추(「프롬프트 작성」)와 같은 재료·같은 요청**을 따로 보냅니다
 * (`lib/promptPayloads.ts` — 한 벌, 규칙 1). 인물 → 장소 → 컷(그림, 영상) 차례입니다. 컷 영상은 새 요청
 * (`cut-video-prompt`)이라 규칙 뼈대 위에 상황·환경·동작을 채웁니다.
 *
 * # 줄에 세웁니다
 *
 * 카드 수만큼의 LLM 왕복이라 한 작업(`bootstrap`)에 넣지 않고 카드마다 **한 일씩** 줄(`llm` 레인)에 섭니다 —
 * 앱을 껐다 켜도 남은 카드부터 이어집니다(재료는 프로젝트에서 그때 읽습니다). 「중지」 는 줄에 남은 카드를 빼고
 * **돌고 있는 요청도 끊습니다**(`stopBootstrapPrompts`) — 요금이 카드 수만큼 드는 일이라 한 장을 더 기다려 주지
 * 않습니다. 실패하거나 끊긴 카드는 **규칙 조립 프롬프트를 그대로 둡니다** — 빈 칸을 남기지 않습니다.
 *
 * 저장 전 프로젝트(«새 프로젝트»)는 붓자마자 첫 자동 저장이 열쇠를 바꿉니다 — 줄은 `retargetTasks` 가 고쳐 쓰고,
 * 이미 도는 일은 `projectIdOfTask` 로 **지금** 열쇠를 다시 읽습니다. 안 그러면 남은 카드가 전부 «아직 저장 전인
 * 프로젝트» 로 실패하고 4단계가 영영 안 닫혔습니다(2026-09-22 검토).
 *
 * «넣고 바로 뽑기» 는 마지막 카드가 끝난 뒤에 세웁니다 — 시트 뽑기(media)와 프롬프트 쓰기(llm)는 다른 줄이라,
 * 붓자마자 세우면 아직 규칙 조립뿐인 글로 그림이 먼저 나옵니다.
 */

export const BOOTSTRAP_PROMPT_TASK = "bootstrapPrompt";

/** 이 일이 채울 카드. 컷은 그림·영상 두 칸이라 일이 둘입니다. */
type PromptTarget =
  | { kind: "character"; id: string }
  | { kind: "background"; id: string }
  | { kind: "cutImage"; sceneId: string; cutId: string }
  | { kind: "cutVideo"; sceneId: string; cutId: string };

interface BootstrapPromptPayload {
  project: string;
  target: PromptTarget;
  /** 화면의 진행 문구 — 「서진우 · 시트」 「컷 3 · 영상」. */
  what: string;
  /** 몇 번째 / 전체. 창의 「4/4 … (n/N)」 이 이걸 읽습니다. */
  order: number;
  total: number;
  /** 다 쓰고 나서 이미지·영상까지 뽑을까 — 마지막 일이 세웁니다. */
  thenGenerate: boolean;
}

/** 이 일에 «뽑을 사람이 아직 없어 규칙 조립만 된 카드» 표시. `projectBootstrap` 의 이력 조건이 이 글자로 시작합니다. */
const RULE_MADE = "AI 일괄 생성 · 규칙 조립";

/** 도는 요청의 API 기록 id — 「중지」 가 이걸로 끊습니다. 저장할 값이 아니라 여기 둡니다. */
const jobs = new Map<string, { project: string; jobId: string }>();

/**
 * 방금 부은 초안에서 **이번 답이 만든 카드**만 골라 줄에 세웁니다.
 *
 * «덧붙이기» 에서 이미 있던 카드는 건드리지 않습니다 — 사람이 다듬어 둔 프롬프트를 일괄 생성이 덮어쓰면
 * 안 됩니다. 이름으로는 못 가립니다 — `summarizeBootstrap` 의 이름 목록에는 이미 있어 다시 만들지 않은 카드도
 * 들어 있습니다. 그래서 카드 자체를 봅니다: 이력 맨 앞이 «규칙 조립» 이고 **두 칸이 그 이력과 글자 그대로 같을
 * 때만** 이번 답이 만든 채로 손 안 댄 카드입니다. 손으로 고치면 `promptKo`·`promptEn` 만 바뀌고 이력은 그대로라,
 * 이력 표시만 보면 사람이 다듬은 카드를 덧붙이기 재실행이 덮어썼습니다(2026-09-22 검토).
 * 씬은 이번 답의 씬이 늘 맨 뒤에 붙으므로 그 수만큼 뒤에서 셉니다.
 */
export function enqueueBootstrapPrompts(
  project: string,
  draft: ProjectDraft,
  result: BootstrapResult,
  thenGenerate: boolean,
): number {
  const made = summarizeBootstrap(result, { characters: [], backgrounds: [] });
  const fresh = (card: { promptKo?: string; promptEn?: string; promptHistory?: { ko: string; en: string; note?: string }[] }) => {
    const head = card.promptHistory?.[0];
    return Boolean(
      head && (head.note || "").startsWith(RULE_MADE) && (card.promptKo || "") === head.ko && (card.promptEn || "") === head.en,
    );
  };
  const characters = draft.characters.filter((item) => made.characterNames.includes(item.name) && fresh(item));
  const backgrounds = draft.backgrounds.filter((item) => made.backgroundNames.includes(item.name) && fresh(item));
  const sceneCount = result.details.scenes.length;
  const scenes = sceneCount ? draft.scenes.slice(-sceneCount) : [];

  const targets: { target: PromptTarget; what: string }[] = [
    ...characters.map((item) => ({ target: { kind: "character" as const, id: item.id }, what: `${item.name || "인물"} · 시트` })),
    ...backgrounds.map((item) => ({ target: { kind: "background" as const, id: item.id }, what: `${item.name || "장소"} · 시트` })),
    ...scenes.flatMap((scene) =>
      scene.cuts.flatMap((cut) => [
        { target: { kind: "cutImage" as const, sceneId: scene.id, cutId: cut.id }, what: `${cutLabelOf(draft, scene, cut)} · 그림` },
        { target: { kind: "cutVideo" as const, sceneId: scene.id, cutId: cut.id }, what: `${cutLabelOf(draft, scene, cut)} · 영상` },
      ]),
    ),
  ];
  if (!targets.length) return 0;

  const title = draft.title || "이름 없는 작품";
  const jobsToQueue: NewTask[] = targets.map(({ target, what }, order) => ({
    lane: "llm",
    kind: BOOTSTRAP_PROMPT_TASK,
    projectId: project,
    projectTitle: title,
    label: `AI 일괄 생성 · 4/4 프롬프트 · ${what}`,
    // 같은 카드를 두 번 세우지 않습니다 — 「만들기」 를 다시 눌러도 카드 하나에 한 번.
    dedupe: `${project}:bootstrapPrompt:${targetKey(target)}`,
    payload: { project, target, what, order, total: targets.length, thenGenerate } satisfies BootstrapPromptPayload,
  }));
  const count = enqueueTasks(jobsToQueue);
  if (count) {
    patchRun(project, () => ({ stage: 4, queued: false, prompts: { done: 0, total: count } }));
    toast.message(`${title} — 카드 ${count}개의 프롬프트를 자세히 쓰는 중입니다.`, {
      description: "인물 → 장소 → 컷(그림·영상) 차례로 카드마다 따로 받습니다. 위쪽 «작업» 단추에서 진행을 봅니다.",
      duration: 10000,
    });
  }
  return count;
}

const targetKey = (target: PromptTarget) =>
  target.kind === "character" || target.kind === "background"
    ? `${target.kind}:${target.id}`
    : `${target.kind}:${target.cutId}`;

/**
 * 컷을 부르는 이름 — 「씬 제목 · 컷 n」. 줄의 이름표·진행 문구·요청 이름표가 같은 것을 씁니다.
 * `cut.order` 는 씬 안의 번호라 그것만 적으면 「컷 3」 이 씬마다 하나씩 예순 개 줄에 섭니다 — 어느 씬인지 없이는
 * 옆 판에서 「지금 어디쯤인가」 를 못 봅니다. 제목이 빈 씬은 순번으로.
 */
const cutLabelOf = (draft: ProjectDraft, scene: Scene, cut: Cut) =>
  `${scene.title || `씬 ${draft.scenes.indexOf(scene) + 1}`} · 컷 ${cut.order}`;

/** 「중지」 — 이 프로젝트의 4단계 일을 줄에서 빼고, 돌고 있는 요청은 끊습니다. */
export async function stopBootstrapPrompts(project: string) {
  pendingTasksOf(project, BOOTSTRAP_PROMPT_TASK).forEach((task) => stopTask(task.id));
  for (const [taskId, job] of jobs) {
    if (job.project !== project) continue;
    jobs.delete(taskId);
    await cancelLlmJob(job.jobId);
  }
}

/*
  열쇠가 바뀌면(«새 프로젝트» → 저장된 id) 돌고 있는 요청의 주인도 새 열쇠로 — 안 옮기면 「중지」 가 새 열쇠로 찾다
  못 끊습니다. 줄의 일은 살림이 `retargetTasks` 로 옮기고, 이 맵은 여기 있어 훅으로 받습니다(`bootstrapRun` 과 같은 모양).
*/
onBootstrapAdopted((from, to) => {
  for (const [taskId, job] of jobs) if (job.project === from) jobs.set(taskId, { ...job, project: to });
});

/*
  붓고 나면(`bootstrapStore.deliver`) 이 훅이 불립니다. 참을 돌려주면 «넣고 바로 뽑기» 는 우리가 맡습니다.
  살림이 이 파일을 import 하면 순환이라(이 파일이 살림을 씁니다) 훅으로 겁니다 — `onBootstrapAdopted` 와 같은 모양.
*/
onBootstrapDelivered((project, draft, result, input) => {
  if (input.richPrompts === false) return false;
  return enqueueBootstrapPrompts(project, draft, result, Boolean(input.thenGenerate)) > 0;
});

registerTaskRunner(BOOTSTRAP_PROMPT_TASK, async (raw, report, task) => {
  const payload = raw as BootstrapPromptPayload;
  const { order, total } = payload;
  /*
    열쇠는 **줄에서 그때그때** 읽습니다. 손에 든 `task`·`payload` 는 시작할 때의 사본이라, LLM 답을 기다리는
    몇십 초 사이에 첫 자동 저장이 열쇠를 바꾸면(`adoptBootstrapRun` → `retargetTasks`) 옛 열쇠를 들고 있습니다.
    옛 열쇠로 읽고 쓰면 «아직 저장 전인 프로젝트» 로 실패했습니다(2026-09-22 검토).
  */
  const keyNow = () => projectIdOfTask(task.id) ?? payload.project;
  /*
    진행은 두 군데에 — 살림(창이 읽는 것)과 작업 줄(옆 판이 읽는 것). 앱을 껐다 켜면 살림의 4단계
    표시는 지워져 있으므로(`bootstrapStore.save`) 일이 돌 때마다 다시 적습니다. `done` 은 이 앞에 선 카드 수.
  */
  patchRun(keyNow(), () => ({ stage: 4, queued: false, prompts: { done: order, total } }));
  report({ progress: order / total, step: `${order + 1}/${total} ${payload.what}` });
  try {
    if (isStopping(task.id)) return;
    await writeOne(payload, keyNow, task.id, task.projectTitle);
  } catch (error) {
    // 중지는 실패가 아닙니다 — 규칙 조립 프롬프트가 그대로 남습니다.
    if (isLlmCancel(error)) return;
    throw error;
  } finally {
    jobs.delete(task.id);
    await finishIfLast(keyNow(), payload.thenGenerate, task.id);
  }
});

/**
 * 내가 마지막이면 4단계를 닫습니다. 마지막인지는 **줄**에서 셉니다 — 실패·중지로 끝난 일도 «남은 일» 이
 * 아니므로, 어떻게 끝났든 마지막 하나가 닫습니다.
 */
async function finishIfLast(project: string, thenGenerate: boolean, myId: string) {
  const remaining = pendingTasksOf(project, BOOTSTRAP_PROMPT_TASK).filter((task) => task.id !== myId);
  if (remaining.length) return;
  patchRun(project, () => ({ stage: 0, prompts: null }));
  // 중지로 끝난 판에서는 뽑기를 세우지 않습니다 — 사람이 멈춘 것을 이어 돌리면 안 됩니다.
  if (!thenGenerate || isStopping(myId)) return;
  const draft = readProject(project);
  if (draft) await startProjectGeneration(project, draft);
}

/**
 * 한 카드를 씁니다 — 카드 단추와 같은 요청, 같은 넣기. `project` 는 부를 때마다 **지금** 열쇠를 줍니다.
 *
 * 왕복은 `withResumableLlm` 으로 감쌉니다 — 답을 기다리다 앱이 닫혀도 응답 id 가 줄에 남아, 다시 켜면 처음부터
 * 보내지 않고 그 답을 묻습니다().
 * 일 하나에 왕복 하나라 걸음 이름은 늘 «prompt» 입니다.
 */
async function writeOne(payload: BootstrapPromptPayload, project: () => string, taskId: string, projectTitle: string) {
  const { target } = payload;
  const draft = readProject(project());
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  const where = projectTitle ? ` — ${projectTitle}` : "";
  const started = (jobId: string) => jobs.set(taskId, { project: project(), jobId });
  const request = (options: Parameters<typeof requestPromptFromLlm>[0]) =>
    withResumableLlm(taskId, "prompt", (llm) => requestPromptFromLlm({ ...options, ...llm, onStarted: started }));

  const options = appPromptRequest(draft, target);
  const result = await request({ ...options, label: `AI 일괄 생성 · 4/4 · ${payload.what}${where}` });
  const wrote = await writeProject(project(), current => {
    // 재시작한 배치도 실행 시점의 선택을 읽고, 응답 대기 중 변경된 모델·수동 문장은 지킵니다.
    assertPromptSnapshot(options, appPromptRequest(current, target));
    const beforeOwner = target.kind === "character" ? draft.characters.find(x=>x.id===target.id)
      : target.kind === "background" ? draft.backgrounds.find(x=>x.id===target.id)
      : draft.scenes.find(x=>x.id===target.sceneId)?.cuts.find(x=>x.id===target.cutId);
    const nowOwner = target.kind === "character" ? current.characters.find(x=>x.id===target.id)
      : target.kind === "background" ? current.backgrounds.find(x=>x.id===target.id)
      : current.scenes.find(x=>x.id===target.sceneId)?.cuts.find(x=>x.id===target.cutId);
    assertPromptSnapshot(beforeOwner, nowOwner);
    return applyAppPromptResult(current, target, result);
  });
  if (!wrote.draft) throw new Error(`프롬프트를 저장하지 못했습니다: ${wrote.why}`);
}
