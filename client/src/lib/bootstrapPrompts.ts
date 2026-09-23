import { toast } from "sonner";
import { getTargetPlatform } from "@/components/PlatformSelect";
import { blueprintForSpace, type SpaceKind } from "@/lib/blueprint";
import { onBootstrapAdopted, onBootstrapDelivered, patchRun } from "@/lib/bootstrapStore";
import { startProjectGeneration } from "@/lib/batchRun";
import { buildCutPrompt } from "@/lib/cutPrompt";
import { buildCutVideoPrompt } from "@/lib/cutVideoPrompt";
import { summarizeCompositionCamera } from "@/lib/composition";
import { projectContextOf } from "@/lib/projectContext";
import { summarizeBootstrap, type BootstrapResult } from "@/lib/projectBootstrap";
import { cancelLlmJob, isLlmCancel, requestPromptFromLlm } from "@/lib/promptRequest";
import { relinkPromptText } from "@/lib/promptLinks";
import { readProject, writeProject } from "@/lib/projectWrite";
import {
  enqueueTasks,
  isStopping,
  pendingTasksOf,
  projectIdOfTask,
  registerTaskRunner,
  stopTask,
  withResumableLlm,
  type NewTask,
} from "@/lib/taskQueue";
import {
  backgroundCardDescription,
  characterBasics,
  cutLinkInput,
  cutLinkPaths,
  cutPromptNote,
  cutRequestPayload,
  cutVideoRequestPayload,
  cutVideoSkeletonInput,
  identityMarksOf,
  sheetReferenceSources,
  sheetReferenceTags,
  sheetRequestPayload,
  sheetRunConditions,
  templateMentionOf,
  withCutPromptResult,
  withPromptResult,
  withUnfoldFrame,
} from "@/lib/promptPayloads";
import type { Background, Character, Cut, ProjectDraft, Scene } from "@/lib/projectTypes";
import { cutVideoLinkInput } from "@/lib/cutVideoReferences";

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
const HOW = "AI 일괄 생성 · 프롬프트 작성";

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
    finishIfLast(keyNow(), payload.thenGenerate, task.id);
  }
});

/**
 * 내가 마지막이면 4단계를 닫습니다. 마지막인지는 **줄**에서 셉니다 — 실패·중지로 끝난 일도 «남은 일» 이
 * 아니므로, 어떻게 끝났든 마지막 하나가 닫습니다.
 */
function finishIfLast(project: string, thenGenerate: boolean, myId: string) {
  const remaining = pendingTasksOf(project, BOOTSTRAP_PROMPT_TASK).filter((task) => task.id !== myId);
  if (remaining.length) return;
  patchRun(project, () => ({ stage: 0, prompts: null }));
  // 중지로 끝난 판에서는 뽑기를 세우지 않습니다 — 사람이 멈춘 것을 이어 돌리면 안 됩니다.
  if (!thenGenerate || isStopping(myId)) return;
  const draft = readProject(project);
  if (draft) startProjectGeneration(project, draft);
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

  if (target.kind === "character" || target.kind === "background") {
    await writeSheet(project, draft, target, where, request);
    return;
  }
  await writeCut(project, draft, target, where, request);
}

/** 이어 받기와 «중지» 손잡이가 붙은 요청 — `writeOne` 이 만들어 시트·컷 쪽에 건넵니다. */
type PromptRequest = (options: Parameters<typeof requestPromptFromLlm>[0]) => ReturnType<typeof requestPromptFromLlm>;

/** 인물·장소 시트 — `usePromptCard.runPrompt` 와 같은 재료(`sheetRequestPayload`)·같은 넣기(`withPromptResult`). */
async function writeSheet(
  project: () => string,
  draft: ProjectDraft,
  target: Extract<PromptTarget, { kind: "character" | "background" }>,
  where: string,
  request: PromptRequest,
) {
  const isCharacter = target.kind === "character";
  const entity: Character | Background | undefined = isCharacter
    ? draft.characters.find((item) => item.id === target.id)
    : draft.backgrounds.find((item) => item.id === target.id);
  if (!entity) throw new Error(isCharacter ? "그 인물 카드를 찾지 못했습니다." : "그 장소 카드를 찾지 못했습니다.");

  const name = entity.name || "이름 없음";
  const platform = getTargetPlatform();
  const references = entity.references || [];
  /*
    카드가 보내는 것과 **같은 값**을 같은 자리에서 — 배경은 옛 칩을 실내·실외로 읽고(`blueprintForSpace`),
    앵커와 전개도 틀 태그는 배경일 때만, 기본 정보는 인물일 때만. 인물 카드의 설명은 `description` 그대로,
    장소 카드는 «위치 — 설명» 한 줄(`backgroundCardDescription`).
  */
  const spaceKind: SpaceKind | undefined = isCharacter ? undefined : (entity as Background).spaceKind || "exterior";
  const blueprint = isCharacter ? entity.blueprint : blueprintForSpace(entity.blueprint, spaceKind);
  const basics = isCharacter ? characterBasics(entity as Character) : { basics: undefined, basicsEn: undefined };
  const kind = isCharacter ? "character" : "background";

  const result = await request({
    label: `AI 일괄 생성 · 4/4 프롬프트 · ${name} · 시트${where}`,
    deliveredTo: `${name} · 프롬프트 네 칸에 넣음`,
    task: isCharacter ? "characterSheet" : "backgroundSheet",
    template: isCharacter ? "character-sheet" : "background-sheet",
    modelId: entity.promptModel,
    platformId: platform,
    data: sheetRequestPayload({
      kind,
      name: entity.name,
      description: isCharacter ? (entity as Character).description : backgroundCardDescription(entity as Background),
      projectFacts: projectContextOf(draft)?.facts ?? null,
      entity,
      blueprint,
      spaceKind,
      basics: basics.basics,
      basicsEn: basics.basicsEn,
      identityMarks: identityMarksOf(kind, references, draft.imageMarks || {}),
      templateMention: kind === "background" ? templateMentionOf(references, platform) : null,
      references: sheetReferenceTags(references, platform),
    }),
    images: sheetReferenceSources(references),
  });

  /*
    전개도 칩이면 답은 «장소 묘사» 라 카드와 **같은 틀 끼우기**(`withUnfoldFrame`, 규칙 1)를 지납니다 — 안 지나면
    카드에서는 완결 프롬프트가, 일괄 생성에서는 틀 문장 없는 장소 묘사가 들어갑니다. 예외 하나: 카드는 요청 전에
    방 크기의 «전개도 틀» 그림을 레퍼런스에 넣는데(`usePromptCard.ensureUnfoldTemplate` — 캔버스로 그려 폴더에
    저장하는 화면 쪽 일), 여기서는 그리지 않고 **카드에 이미 있는 레퍼런스**로만 끼웁니다. 틀이 없으면 틀 태그 없이
    칸·카메라 문장만 서고, 그 카드에서 「프롬프트 작성」 을 한 번 누르면 틀이 들어갑니다.
  */
  const framed = withUnfoldFrame(result, { kind, blueprint, entity, references, platform });
  const note = sheetRunConditions({
    kind,
    blueprint,
    spaceKind,
    referenceCount: references.length,
    hasAnalysis: Boolean(entity.analysis?.trim()),
    model: entity.promptModel,
    extra: HOW,
  });
  // 값이 아니라 함수로 — 기다리는 사이 사람이 만진 칸을 지우지 않습니다(CLAUDE.md).
  const wrote = await writeProject(project(), (current) =>
    isCharacter
      ? {
          characters: current.characters.map((item) =>
            item.id === target.id ? { ...item, ...withPromptResult(item, framed, note) } : item,
          ),
        }
      : {
          backgrounds: current.backgrounds.map((item) =>
            item.id === target.id ? { ...item, ...withPromptResult(item, framed, note) } : item,
          ),
        },
  );
  if (!wrote.draft) throw new Error(`${name} 카드에 못 넣었습니다 — ${wrote.why}`);
}

/** 컷 그림·영상 — `CutCard.runCutPrompt`·`runVideoPrompt` 와 같은 재료·같은 넣기(@태그 잇기까지). */
async function writeCut(
  project: () => string,
  draft: ProjectDraft,
  target: Extract<PromptTarget, { kind: "cutImage" | "cutVideo" }>,
  where: string,
  request: PromptRequest,
) {
  const found = findCut(draft, target.sceneId, target.cutId);
  if (!found) throw new Error("그 컷을 찾지 못했습니다.");
  const { scene, cut } = found;
  const context = projectContextOf(draft);
  const cutCharacters = draft.characters.filter((item) => cut.characterIds.includes(item.id));
  const background = draft.backgrounds.find((item) => item.id === cut.backgroundId);
  const summary = summarizeCompositionCamera(cut.composition, { heightsCm: heightsOf(draft) });
  // 컷 카드의 두 스위치와 같은 판정 — 구도를 켠 컷만 카메라·자리를 글에 싣습니다.
  const useComposition = usesComposition(cut);
  const useRefVideo = cut.useRefVideo !== false && Boolean(cut.refVideoPath);
  const platform = getTargetPlatform();
  const label = cutLabelOf(draft, scene, cut);

  if (target.kind === "cutImage") {
    const result = await request({
      label: `AI 일괄 생성 · 4/4 프롬프트 · ${label} · 그림${where}`,
      deliveredTo: `${label} · 프롬프트 네 칸에 넣음`,
      task: "cutPrompt",
      template: "cut-prompt",
      platformId: platform,
      techniques: cut.techniques || [],
      data: cutRequestPayload({
        projectFacts: context?.facts ?? null,
        sceneSummary: scene.summary,
        cut,
        cutCharacters,
        background,
        summary,
        useComposition,
        facts: buildCutPrompt({ cut, characters: cutCharacters, background, context }).facts,
      }),
      images: cut.guideImage ? [cut.guideImage] : [],
    });
    /*
      새 글에도 @태그를 **바로** 잇습니다 — 컷 카드의 `keepPrompt` 와 같은 재료(`cutLinkInput`). 일괄 생성
      직후에는 시트가 아직 없어 «아직 그림 없음» 줄이 사람과 장소의 자리를 잡습니다 — 나중에 그림이 오면
      「@ 다시 잇기」 가 그 자리를 태그로 바꿉니다.
    */
    const wrote = await writeProject(project(), (current) =>
      patchCutIn(current, target.sceneId, target.cutId, (now) => {
        const link = linkInputOf(current, now);
        const linked = { ko: relinkPromptText(result.ko, link, "ko"), en: relinkPromptText(result.en, link, "en") };
        const note = cutPromptNote({
          how: HOW,
          useComposition: usesComposition(now),
          hasComposition: summarizeCompositionCamera(now.composition, { heightsCm: heightsOf(current) }).hasComposition,
          tags: now.styleTags || [],
          techniques: now.techniques || [],
          peopleCount: current.characters.filter((item) => now.characterIds.includes(item.id)).length,
        });
        return withCutPromptResult(now, result, linked, HOW, note);
      }),
    );
    if (!wrote.draft) throw new Error(`${label} 에 못 넣었습니다 — ${wrote.why}`);
    return;
  }

  // ── 영상 — 규칙 뼈대 위에 LLM 이 상황·환경·동작을 채웁니다(컷 카드의 「프롬프트 작성」(영상) 과 같은 길).
  const skeletonInput = cutVideoSkeletonInput({
    cut,
    characters: draft.characters,
    cutCharacters,
    background,
    context,
    useComposition,
    useRefVideo,
    aspect: draft.aspect?.video || draft.aspect?.image,
    videoModel: draft.magnific?.videoModel,
  });
  const skeleton = buildCutVideoPrompt(skeletonInput);
  const result = await request({
    label: `AI 일괄 생성 · 4/4 프롬프트 · ${label} · 영상${where}`,
    deliveredTo: `${label} · 영상 프롬프트 두 칸에 넣음`,
    task: "cutVideoPrompt",
    template: "cut-video-prompt",
    modelId: skeletonInput.modelId,
    platformId: platform,
    techniques: cut.techniques || [],
    data: cutVideoRequestPayload({
      skeleton,
      skeletonInput,
      projectFacts: context?.facts ?? null,
      sceneSummary: scene.summary,
      cut,
      cutCharacters,
      background,
      summary,
      useComposition,
    }),
  });
  const wrote = await writeProject(project(), (current) =>
    patchCutIn(current, target.sceneId, target.cutId, (now) => {
      const link = cutVideoLinkInput(now, linkInputOf(current, now));
      return {
        videoPromptKo: relinkPromptText(result.ko, link, "ko"),
        videoPromptEn: relinkPromptText(result.en, link, "en"),
      };
    }),
  );
  if (!wrote.draft) throw new Error(`${label} 영상 칸에 못 넣었습니다 — ${wrote.why}`);
}

// ── 잔손 ──────────────────────────────────────────────────────────────────────

function findCut(draft: ProjectDraft, sceneId: string, cutId: string) {
  const scene = draft.scenes.find((item) => item.id === sceneId);
  const cut = scene?.cuts.find((item) => item.id === cutId);
  return scene && cut ? { scene, cut } : null;
}

/** 인물 키(cm) 표 — 카메라 거리로 샷 크기를 재는 잣대(컷 카드와 같은 기본값 170). */
const heightsOf = (draft: ProjectDraft) =>
  Object.fromEntries(draft.characters.map((item) => [item.id, item.heightCm ?? 170]));

/** 컷 카드의 «구도 쓰기» 스위치와 같은 판정. */
const usesComposition = (cut: Cut) =>
  cut.useComposition !== false && Boolean(cut.composition || cut.guideImage || cut.guideImagePath);

/** @태그 잇기 재료 — **지금 초안**(갱신 함수 안의 `current`)으로 짓습니다. 캡처는 새로 만들지 않습니다. */
function linkInputOf(current: ProjectDraft, cut: Cut) {
  const background = current.backgrounds.find((item) => item.id === cut.backgroundId);
  const useComposition = usesComposition(cut);
  return cutLinkInput({
    cut,
    characters: current.characters,
    background,
    summary: summarizeCompositionCamera(cut.composition, { heightsCm: heightsOf(current) }),
    useComposition,
    ...cutLinkPaths(cut, background, useComposition),
  });
}

/** 컷 하나를 «지금 값을 받아» 고칩니다 — 씬·컷 트리 안에서. */
function patchCutIn(
  current: ProjectDraft,
  sceneId: string,
  cutId: string,
  update: (cut: Cut) => Partial<Cut>,
): Partial<ProjectDraft> {
  return {
    scenes: current.scenes.map((scene) =>
      scene.id !== sceneId
        ? scene
        : { ...scene, cuts: scene.cuts.map((cut) => (cut.id === cutId ? { ...cut, ...update(cut) } : cut)) },
    ),
  };
}
