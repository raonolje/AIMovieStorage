import { z } from "zod";
import { t } from "./i18n";
import { uid } from "./projectTypes";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { readProject } from "./projectWrite";
import { projectFolderName } from "./localProjectStore";
import { getMediaLibrarySettings } from "./mediaLibrary";
import { summarizeCompositionCamera } from "./composition";
import { targetModelOf } from "./modelRules";
import { cutVideoSecondsOf } from "./cutVideoPrompt";
import { magnificCutVideoReferences } from "./cutVideoReferences";
import {
  gatherStoredCutMagnificRefs,
  buildCutImageMagnificPrompt,
  buildCutVideoMagnificPrompt,
} from "./cutMagnificCompose";
import {
  composeInMagnific,
  validateMagnificComposition,
  MAGNIFIC_IMAGE_MODEL,
  MAGNIFIC_VIDEO_MODEL,
  type MagnificComposeInput,
} from "./magnificCompose";
import { mediaTypeOfPath } from "./magnificVideoInputs";
import {
  enqueueTaskOperation,
  getTask,
  getTaskByOperationId,
  isStopping,
  markTaskExternalEffectStarted,
  registerTaskRunner,
  saveTaskExternalCheckpoint,
  whenTaskJournalReady,
} from "./taskQueue";

const id = z.string().min(1).max(200);
export const magnificComposePreviewSchema = z
  .object({
    projectId: id,
    sceneId: id,
    cutId: id,
    expectedRevision: z.string().min(1).max(200),
    kind: z.enum(["image", "video"]),
    language: z.enum(["ko", "en"]).default("en"),
    prompt: z.string().trim().min(1).max(32_000).optional(),
    promptMode: z.enum(["guided", "exact"]).default("guided"),
    videoResolution: z.enum(["720p", "1080p"]).default("1080p"),
  })
  .strict();
export const magnificComposeExecuteSchema = z
  .object({
    projectId: id,
    expectedRevision: z.string().min(1).max(200),
    previewId: id,
    operationId: id,
  })
  .strict();
type PreviewRequest = z.infer<typeof magnificComposePreviewSchema>;
type ExecuteRequest = z.infer<typeof magnificComposeExecuteSchema>;
type Plan = Omit<MagnificComposeInput, "onStatus" | "beforeCompose">;
interface Preview {
  request: PreviewRequest;
  plan: Plan;
  projectTitle: string;
  projectFolder: string;
  baseDirectory: string;
  expiresAt: number;
}
interface Payload extends Preview {
  requestExecution: ExecuteRequest;
}
const previews = new Map<string, Preview>();
const KIND = "control.magnific-compose";
const PREVIEW_TTL = 10 * 60_000;

function fail(code: string, message: string, details?: unknown): never {
  throw new ProjectControlError(code, t(message), details);
}
async function current(projectId: string, expectedRevision: string) {
  // 요약 조회는 revision만 확인하는 용도입니다. 수백 MB의 모캡 전체 사본을 만들지 않습니다.
  const snapshot = await getProjectSnapshot(projectId, "summary");
  if (snapshot.revision !== expectedRevision)
    fail(
      "revision_conflict",
      "그 사이 프로젝트가 바뀌었습니다. 최신 상태로 Magnific 구성 미리보기를 다시 요청해 주세요.",
      { actualRevision: snapshot.revision },
    );
  const draft = readProject(projectId);
  if (!draft) fail("project_not_found", "프로젝트를 찾지 못했습니다.");
  return draft;
}

/** 외부 호출에는 경로 입력을 열지 않고, 저장된 이 작품의 참조만 허용합니다. */
function checkPaths(paths: string[], base: string, folder: string) {
  const normalized = (path: string) =>
    path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const root = `${normalized(base)}/${normalized(folder)}/`;
  const names = new Set<string>();
  for (const path of paths) {
    const safe = normalized(path);
    if (
      !safe.startsWith(root) ||
      safe.split("/").some((part) => part === ".." || part === ".")
    )
      fail(
        "reference_outside_project",
        "현재 프로젝트 폴더 밖의 참조는 자동 구성으로 보내지 않습니다. 이 작품에 파일을 등록한 뒤 다시 요청해 주세요.",
      );
    const name = safe
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, "")
      .replace(/ #\d+$/, "");
    if (names.has(name))
      fail(
        "ambiguous_reference",
        "레퍼런스 파일 이름이 겹칩니다. 확장자를 뺀 이름을 다르게 저장한 뒤 다시 요청해 주세요.",
      );
    names.add(name);
  }
}

export async function previewControlMagnific(raw: unknown) {
  const request = magnificComposePreviewSchema.parse(raw);
  if (request.promptMode === "exact" && !request.prompt)
    fail(
      "prompt_required",
      "본문 그대로 보내기는 prompt를 직접 지정해야 합니다. 저장된 글을 자동으로 대신 쓰지 않습니다.",
    );
  const draft = await current(request.projectId, request.expectedRevision);
  const scene = draft.scenes.find((item) => item.id === request.sceneId);
  const cut = scene?.cuts.find((item) => item.id === request.cutId);
  if (!scene || !cut)
    fail("cut_not_found", "이 프로젝트와 장면에서 컷을 찾지 못했습니다.");
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!baseDirectory)
    fail(
      "storage_not_ready",
      "데스크톱 앱에서 저장 폴더를 정한 뒤에 쓸 수 있습니다.",
    );
  const projectFolder = projectFolderName(request.projectId, draft.title);
  const useComposition =
    cut.useComposition !== false &&
    Boolean(cut.composition || cut.guideImage || cut.guideImagePath);
  const useRefVideo = cut.useRefVideo !== false && Boolean(cut.refVideoPath);
  // 미리보기에서 data URL을 파일로 쓰거나 구도 저장을 실행하면 read-only 계약이 깨집니다.
  if (
    useComposition &&
    ((!cut.guideImagePath && (request.kind === "image" || cut.guideImage)) ||
      (!cut.plateImagePath && cut.plateImage))
  )
    fail(
      "capture_not_saved",
      "구도 캡처가 파일로 저장되지 않았습니다. 구도잡기에서 저장한 뒤 미리보기를 다시 요청해 주세요.",
    );
  const background = draft.backgrounds.find(
    (item) => item.id === cut.backgroundId,
  );
  const refs = gatherStoredCutMagnificRefs({
    cut,
    characters: draft.characters,
    backgrounds: draft.backgrounds,
    sharedAssets: draft.sharedAssets,
    background,
    guidePath: useComposition ? cut.guideImagePath : undefined,
    platePath: useComposition ? cut.plateImagePath : undefined,
  });
  const stored =
    request.kind === "video"
      ? request.language === "ko"
        ? cut.videoPromptKo
        : cut.videoPromptEn
      : request.language === "ko"
        ? cut.promptKo
        : cut.promptEn;
  const prompt = request.prompt ?? stored ?? "";
  if (!prompt.trim())
    fail(
      "prompt_missing",
      "보낼 프롬프트가 없습니다. 컷의 프롬프트를 작성하거나 요청에 본문을 넣어 주세요.",
    );
  const model =
    request.kind === "video" ? draft.magnific?.videoModel : undefined;
  const nativeModel =
    request.kind === "video"
      ? (targetModelOf(model)?.magnific ??
        (!model ? MAGNIFIC_VIDEO_MODEL : undefined))
      : MAGNIFIC_IMAGE_MODEL;
  if (
    request.kind === "video" &&
    nativeModel !== "seedance-2-5-pro" &&
    nativeModel !== "bytedance-seedance-pro-2.5"
  )
    fail(
      "unsupported_model",
      "Magnific 데스크톱 영상 자동 구성은 확인된 Seedance 2.5만 지원합니다. 프로젝트의 영상 모델을 확인해 주세요.",
    );
  const seconds = request.kind === "video" ? cutVideoSecondsOf(cut) : undefined;
  const plan: Plan = {
    kind: request.kind,
    prompt:
      request.promptMode === "exact"
        ? prompt
        : request.kind === "video"
          ? buildCutVideoMagnificPrompt({
              cut,
              characters: draft.characters,
              background,
              summary: summarizeCompositionCamera(cut.composition, {
                heightsCm: Object.fromEntries(
                  draft.characters.map((item) => [
                    item.id,
                    item.heightCm ?? 170,
                  ]),
                ),
              }),
              useComposition,
              useRefVideo,
              videoSeconds: seconds!,
              prompt,
              lang: request.language,
              refs,
            })
          : buildCutImageMagnificPrompt(prompt, request.language, refs),
    referencePaths:
      request.kind === "video"
        ? magnificCutVideoReferences(cut, refs.references, useRefVideo)
        : refs.references,
    owner: { kind: "cut", name: `컷 ${cut.order}`, cutId: cut.id },
    model: nativeModel,
    requestedVideoModel: request.kind === "video" ? model : undefined,
    seconds,
    // 기존 컷 카드의 구성과 같은 기본값입니다. 프로젝트의 별도 MCP 설정을 몰래 섞지 않습니다.
    aspectRatio: "16:9",
    videoResolution: request.videoResolution,
    count: 1,
  };
  checkPaths(plan.referencePaths, baseDirectory, projectFolder);
  await validateMagnificComposition(plan);
  await current(request.projectId, request.expectedRevision);
  for (const [key, item] of previews)
    if (item.expiresAt < Date.now()) previews.delete(key);
  while (previews.size >= 20) previews.delete(previews.keys().next().value!);
  const previewId = uid();
  const preview: Preview = {
    request,
    plan,
    projectTitle: draft.title,
    projectFolder,
    baseDirectory,
    expiresAt: Date.now() + PREVIEW_TTL,
  };
  previews.set(previewId, preview);
  return {
    previewId,
    projectId: request.projectId,
    sceneId: scene.id,
    cutId: cut.id,
    revision: request.expectedRevision,
    expiresAt: preview.expiresAt,
    kind: request.kind,
    promptMode: request.promptMode,
    prompt: plan.prompt,
    promptCharacters: Array.from(plan.prompt).length,
    promptWords: plan.prompt.trim()
      ? plan.prompt.trim().split(/\s+/u).length
      : 0,
    metrics: {
      characterCountMethod: "unicode_code_points",
      wordCountMethod: "whitespace_tokens",
      utf8Bytes: new TextEncoder().encode(plan.prompt).length,
    },
    model: plan.model,
    seconds: plan.seconds,
    resolution: request.kind === "video" ? plan.videoResolution : undefined,
    aspectRatio: plan.aspectRatio,
    references: plan.referencePaths.map((path) => ({
      name: path.split(/[\\/]/).pop(),
      tag: refs.tagOf(path),
      type: mediaTypeOfPath(path),
    })),
    paidGeneration: false,
    limitations: [
      "Magnific 데스크톱의 로그인된 보드와 앱에서 연 디버그 연결이 필요합니다. 실행 때 연결을 확인합니다.",
      "저장된 컷 참조를 업로드하고 생성기를 구성합니다. 생성 버튼은 누르지 않습니다.",
      "영상 자동 구성은 Seedance 2.5만 지원합니다. 이미지 구성은 기존 기본 모델을 사용합니다.",
      "구성 시작 뒤 취소하거나 연결이 끊기면 이미 올라간 노드는 자동으로 되돌리지 않습니다. 보드를 확인하세요.",
      "이전 프롬프트 본문은 자동으로 다시 쓰지 않습니다. 새 카메라 참조 규칙은 영상 프롬프트를 다시 만들어 적용하세요.",
    ].map((message) => t(message)),
  };
}

async function validateCurrent(payload: Payload) {
  const draft = await current(
    payload.request.projectId,
    payload.request.expectedRevision,
  );
  if (
    getMediaLibrarySettings().baseDirectory.trim() !== payload.baseDirectory ||
    projectFolderName(payload.request.projectId, draft.title) !==
      payload.projectFolder
  )
    fail(
      "storage_changed",
      "저장 폴더가 바뀌었습니다. Magnific 구성 미리보기를 다시 요청해 주세요.",
    );
  checkPaths(
    payload.plan.referencePaths,
    payload.baseDirectory,
    payload.projectFolder,
  );
}

export async function enqueueControlMagnific(raw: unknown) {
  const request = magnificComposeExecuteSchema.parse(raw);
  await whenTaskJournalReady();
  const previous = getTaskByOperationId(request.operationId);
  if (previous) {
    const payload = previous.payload as Payload;
    if (
      previous.kind !== KIND ||
      JSON.stringify(payload?.requestExecution) !== JSON.stringify(request)
    )
      fail(
        "operation_conflict",
        "같은 작업 요청 열쇠에 다른 내용이 들어왔습니다.",
      );
    return enqueueTaskOperation({
      lane: "media",
      kind: KIND,
      projectId: previous.projectId,
      projectTitle: previous.projectTitle,
      label: previous.label,
      operationId: request.operationId,
      payload: previous.payload,
    });
  }
  const preview = previews.get(request.previewId);
  if (!preview || preview.expiresAt < Date.now())
    fail(
      "preview_expired",
      "Magnific 구성 미리보기가 만료되었습니다. 미리보기를 다시 요청해 주세요.",
    );
  if (
    preview.request.projectId !== request.projectId ||
    preview.request.expectedRevision !== request.expectedRevision
  )
    fail(
      "preview_mismatch",
      "미리보기의 프로젝트나 판이 실행 요청과 다릅니다.",
    );
  const payload: Payload = { ...preview, requestExecution: request };
  await validateCurrent(payload);
  return enqueueTaskOperation({
    lane: "media",
    kind: KIND,
    projectId: request.projectId,
    projectTitle: preview.projectTitle,
    label: t("외부 조종 · Magnific 구성"),
    operationId: request.operationId,
    payload,
  });
}

registerTaskRunner(KIND, async (raw, report, task) => {
  const payload = raw as Payload;
  const saved = getTask(task.id)!;
  if (saved.externalCheckpoint?.phase === "completed")
    return { data: saved.externalCheckpoint };
  if (saved.externalEffectStartedAt)
    fail(
      "external_result_unknown",
      typeof saved.externalCheckpoint?.message === "string"
        ? saved.externalCheckpoint.message
        : "Magnific 구성의 완료 여부를 확인하지 못했습니다. 자동으로 다시 올리지 않습니다. 보드를 확인하고 새 미리보기와 작업 요청 열쇠로 요청해 주세요.",
    );
  await validateCurrent(payload);
  let message: string;
  try {
    message = await composeInMagnific({
      ...payload.plan,
      onStatus: (step) => report({ step }),
      beforeCompose: async () => {
        if (isStopping(task.id))
          throw new Error(t("Magnific 구성을 시작하기 전에 취소했습니다."));
        await validateCurrent(payload);
        await markTaskExternalEffectStarted(task.id);
        // 시작 기록을 디스크에 쓰는 동안 들어온 편집도 전송 전에 확인합니다.
        await validateCurrent(payload);
        if (isStopping(task.id))
          throw new Error(t("Magnific 구성을 시작하기 전에 취소했습니다."));
      },
    });
  } catch (error) {
    if (getTask(task.id)?.externalEffectStartedAt) {
      // 업로드가 일부라도 끝났을 수 있습니다. 자동 재시도나 완료로 단정하지 않습니다.
      const explanation = t(
        "Magnific 구성의 완료 여부를 확인하지 못했습니다. 자동으로 다시 올리지 않습니다. 보드를 확인하고 새 미리보기와 작업 요청 열쇠로 요청해 주세요.",
      );
      // 부분 업로드 가능성 때문에 자동 재시도는 막되, 실제 native 오류를 지우지는 않습니다.
      // 이 원인이 없으면 화면 DOM의 가시 노드 수와 저장된 보드 수가 어긋난 경우를 진단할 수 없습니다.
      const cause = (error instanceof Error ? error.message : String(error))
        .replace(/Bearer\s+\S+/gi, "Bearer [숨김]")
        .replace(/https?:\/\/\S+/g, "[외부 주소]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      const message = cause ? `${explanation} 원인: ${cause}` : explanation;
      await saveTaskExternalCheckpoint(task.id, {
        phase: "unknown",
        paidGeneration: false,
        message,
      }).catch(() => undefined);
      throw new ProjectControlError("external_result_unknown", message);
    }
    throw error;
  }
  const result = {
    phase: "completed",
    message,
    paidGeneration: false,
    projectId: payload.request.projectId,
    cutId: payload.request.cutId,
    sourceRevision: payload.request.expectedRevision,
  };
  await saveTaskExternalCheckpoint(task.id, result);
  return { data: result };
});
