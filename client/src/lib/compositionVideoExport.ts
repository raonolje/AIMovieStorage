import { t } from "./i18n";
import { z } from "zod";
import { CompositionControlError, exportCompositionVideo, getCompositionSession } from "./compositionControl";
import { projectFolderName } from "./localProjectStore";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { enqueueTaskOperation, getTaskByOperationId, isStopping, registerTaskRunner, setTaskResult, stopTask, whenTaskJournalReady } from "./taskQueue";
import type { Cut, ProjectDraft } from "./projectTypes";
import type { SavedReferenceVideo } from "./referenceVideoExport";

const id = z.string().min(1).max(200);
const dimension = z.number().int().min(64).max(4096).multipleOf(2);
export const compositionExportVideoSchema = z.object({
  projectId: id,
  sessionId: z.string().min(1).max(300),
  expectedRevision: z.number().int().nonnegative(),
  operationId: id,
  duration: z.number().positive().max(600).default(15),
  width: dimension.default(1920),
  height: dimension.default(1080),
  fps: z.number().int().min(1).max(60).default(24),
}).strict();
type Request = z.infer<typeof compositionExportVideoSchema>;
const payloadSchema = z.object({ request: compositionExportVideoSchema,
  projectName: z.string(), cutId: id, previousPath: z.string().nullable(), previousSeconds: z.number().nullable(),
}).strict();
type Payload = z.infer<typeof payloadSchema>;
const KIND = "control.composition-video";

function cutOf(project: ProjectDraft, cutId: string): Cut {
  const cut = project.scenes.flatMap(scene => scene.cuts).find(item => item.id === cutId);
  if (!cut) throw new CompositionControlError("cut_not_found", t("영상을 붙일 컷이 삭제되었습니다."));
  return cut;
}
function validateSession(request: Request) {
  const project = readProject(request.projectId);
  if (!project) throw new Error(t("프로젝트를 찾지 못했습니다."));
  const session = getCompositionSession(request.sessionId);
  if (session.revision !== request.expectedRevision) throw new CompositionControlError("revision_conflict", t("구도가 바뀌었습니다. 최신 판을 읽고 다시 요청해 주세요."));
  if (projectFolderName(request.projectId, project.title) !== session.projectName)
    throw new CompositionControlError("project_mismatch", t("구도 창과 내보낼 프로젝트가 다릅니다."));
  return { project, session, cut: cutOf(project, session.cutId) };
}

export async function enqueueCompositionVideoExport(raw: unknown) {
  const request = compositionExportVideoSchema.parse(raw);
  await whenTaskJournalReady();
  const previous = getTaskByOperationId(request.operationId);
  if (previous) {
    const payload = payloadSchema.safeParse(previous.payload);
    if (previous.kind !== KIND || !payload.success || JSON.stringify(payload.data.request) !== JSON.stringify(request))
      throw new Error(t("같은 작업 요청 열쇠에 다른 내용이 들어왔습니다."));
    // 완료 뒤 판이 바뀌거나 창이 닫혔어도 중복 렌더를 만들지 않고 원래 작업을 돌려줍니다.
    return enqueueTaskOperation({ lane: "media", kind: KIND, projectId: previous.projectId,
      projectTitle: previous.projectTitle, label: previous.label, operationId: request.operationId, payload: previous.payload });
  }
  const { project, session, cut } = validateSession(request);
  const payload: Payload = { request, projectName: session.projectName, cutId: session.cutId,
    previousPath: cut.refVideoPath ?? null, previousSeconds: cut.refVideoSeconds ?? null };
  return enqueueTaskOperation({ lane: "media", kind: KIND, projectId: request.projectId,
    projectTitle: project.title, label: t("외부 조종 · 컷 {order} 레퍼런스 영상", { order: cut.order }),
    operationId: request.operationId, payload });
}

/** 외부에서 파일 경로를 받지 않고 열린 구도와 저장된 작품의 관계만 확인합니다. */
function assertProject(payload: Payload, video?: SavedReferenceVideo) {
  const project = readProject(payload.request.projectId);
  if (!project || projectFolderName(payload.request.projectId, project.title) !== payload.projectName)
    throw new Error(t("렌더 도중 프로젝트가 바뀌었습니다. 만든 파일은 작업 결과 경로에서 확인해 주세요."));
  const cut = cutOf(project, payload.cutId);
  const sameOriginal = (cut.refVideoPath ?? null) === payload.previousPath && (cut.refVideoSeconds ?? null) === payload.previousSeconds;
  const alreadyAttached = video && cut.refVideoPath === video.path && cut.refVideoSeconds === video.seconds;
  if (!sameOriginal && !alreadyAttached) throw new Error(t("렌더 도중 컷의 레퍼런스 영상 선택이 바뀌어 덮어쓰지 않았습니다."));
}

registerTaskRunner(KIND, async (raw, report, task) => {
  const payload = payloadSchema.parse(raw);
  const { request } = payload;
  validateSession(request);
  assertProject(payload);
  const controller = new AbortController();
  const checkCancel = () => { if (isStopping(task.id)) controller.abort(); };
  const timer = setInterval(checkCancel, 100);
  const options = { width: request.width, height: request.height, duration: request.duration, fps: request.fps };
  try {
    checkCancel();
    const result = await exportCompositionVideo({ sessionId: request.sessionId, expectedRevision: request.expectedRevision }, options, {
      signal: controller.signal,
      assertCurrent: () => { checkCancel(); assertProject(payload); },
      onProgress: (done, total) => report({ progress: done / Math.max(1, total) * 0.95, step: t("{done} / {total} 프레임", { done, total }) }),
      onFileSaved: video => setTaskResult(task.id, { paths: [video.path], data: { ...video, persisted: false } }),
    }, async video => {
      checkCancel();
      if (controller.signal.aborted) throw new DOMException(t("영상 만들기를 취소했습니다."), "AbortError");
      assertProject(payload, video);
      report({ progress: 0.98, step: t("레퍼런스 영상 경로를 프로젝트에 저장하는 중") });
      const outcome = await writeProjectAndConfirm(request.projectId, current => {
        assertProject(payload, video);
        const cut = cutOf(current, payload.cutId);
        const unchanged = (cut.refVideoPath ?? null) === payload.previousPath && (cut.refVideoSeconds ?? null) === payload.previousSeconds;
        const attached = cut.refVideoPath === video.path && cut.refVideoSeconds === video.seconds;
        if (!unchanged && !attached)
          throw new Error(t("저장 직전에 레퍼런스 영상 선택이 바뀌었습니다."));
        return { ...current, scenes: current.scenes.map(scene => ({ ...scene, cuts: scene.cuts.map(item =>
          item.id === payload.cutId ? { ...item, refVideoPath: video.path, refVideoSeconds: video.seconds } : item) })) };
      });
      if (!outcome.persisted) throw new Error(t("영상 파일은 만들었지만 프로젝트 저장을 확인하지 못했습니다: {why}", { why: outcome.why ?? outcome.outcome }));
    });
    return { paths: [result.path], assetIds: [`${payload.cutId}:refVideoPath`], data: result };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") stopTask(task.id);
    throw error;
  } finally { clearInterval(timer); }
});
