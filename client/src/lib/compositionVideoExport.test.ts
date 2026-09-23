import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, newScene, newCut, type ProjectDraft } from "./projectTypes";
import { normalizeComposition } from "./composition";
import type { QueueTask, TaskResult } from "./taskQueue";
import type { CompositionSessionPort } from "./compositionControl";
import type { SavedReferenceVideo } from "./referenceVideoExport";

type Runner = (payload: unknown, report: (value: unknown) => void, task: QueueTask) => Promise<TaskResult>;
const mock = vi.hoisted(() => ({
  project: null as ProjectDraft | null, tasks: new Map<string, QueueTask>(), runner: null as Runner | null,
  beforeWrite: null as (() => void) | null, ack: null as Promise<void> | null, persisted: true,
  write: vi.fn(), result: vi.fn(), stopping: false, stop: vi.fn(),
}));
vi.mock("./localProjectStore", () => ({ projectFolderName: (id: string, title: string) => `${id}-${title}` }));
vi.mock("./projectWrite", () => ({
  readProject: (id: string) => id === "p" ? mock.project : null,
  writeProjectAndConfirm: async (_id: string, updater: (current: ProjectDraft) => ProjectDraft) => {
    mock.write(); mock.beforeWrite?.();
    mock.project = updater(mock.project!);
    await mock.ack;
    return { draft: mock.project, persisted: mock.persisted, outcome: mock.persisted ? "written" : "error" };
  },
}));
vi.mock("./taskQueue", () => ({
  whenTaskJournalReady: async () => {}, getTaskByOperationId: (id: string) => mock.tasks.get(id),
  registerTaskRunner: (_kind: string, runner: Runner) => { mock.runner = runner; },
  enqueueTaskOperation: async (input: QueueTask) => {
    const prior = mock.tasks.get(input.operationId!);
    if (prior) return { jobId: prior.id, reused: true };
    const task = { ...input, id: "job", status: "waiting", queuedAt: 0 } as QueueTask;
    mock.tasks.set(input.operationId!, task);
    return { jobId: task.id, reused: false };
  },
  isStopping: () => mock.stopping, setTaskResult: mock.result, stopTask: mock.stop,
}));
import { enqueueCompositionVideoExport, compositionExportVideoSchema } from "./compositionVideoExport";
import { getCompositionSession, listCompositionSessions, registerCompositionSession } from "./compositionControl";

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks(); mock.tasks.clear(); mock.beforeWrite = null; mock.ack = null; mock.persisted = true; mock.stopping = false;
  mock.project = { ...newProjectDraft(), title: "작품", scenes: [{ ...newScene(), cuts: [{ ...newCut(1), id: "cut" }] }] };
});
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
const video: SavedReferenceVideo = { path: "project/ref.mp4", seconds: 15, duration: 15, width: 1920, height: 1080, fps: 24, frameCount: 360, codec: "avc1" };
function fixture(projectName = "p-작품") {
  let state = normalizeComposition();
  const exportVideo = vi.fn<NonNullable<CompositionSessionPort["exportVideo"]>>(async (_options, controls) => {
    controls.assertCurrent?.(); controls.onProgress?.(360, 360); controls.onFileSaved?.(video); return video;
  });
  const port: CompositionSessionPort = {
    read: () => ({ state, canUndo: false, canRedo: false, context: { characterIds: [] } }),
    apply: fn => { state = fn(state); }, undo: vi.fn(), redo: vi.fn(),
    capture: vi.fn(), commit: vi.fn(), exportVideo,
  };
  const close = registerCompositionSession({ projectName, cutId: "cut" }, port);
  cleanups.push(close);
  const sessionId = listCompositionSessions().at(-1)!.sessionId;
  return { close, exportVideo, sessionId,
    manual: () => { state = { ...state, camera: { ...state.camera, fovDegrees: 61 } }; },
    request: { projectId: "p", sessionId, expectedRevision: 0, operationId: "op" },
  };
}
async function run() {
  const task = mock.tasks.get("op")!;
  return mock.runner!(task.payload, vi.fn(), task);
}

describe("MCP 구도 영상 내보내기의 세션·큐·저장 계약", () => {
  it("15초 1080p 24fps가 기본이고 임의 경로·홀수 해상도·무한 길이를 거부한다", () => {
    const request = fixture().request;
    expect(compositionExportVideoSchema.parse(request)).toMatchObject({ duration: 15, width: 1920, height: 1080, fps: 24 });
    for (const fields of [{ path: "C:/outside.mp4" }, { width: 1919 }, { duration: Infinity }, { fps: 0 }])
      expect(compositionExportVideoSchema.safeParse({ ...request, ...fields }).success).toBe(false);
  });

  it("다른 작품·오래된 판은 접수 전에 막고 세션 닫힌 뒤 재요청은 원래 작업을 준다", async () => {
    const wrong = fixture("다른 작품");
    await expect(enqueueCompositionVideoExport(wrong.request)).rejects.toMatchObject({ code: "project_mismatch" });
    const f = fixture(); f.manual();
    await expect(enqueueCompositionVideoExport(f.request)).rejects.toMatchObject({ code: "revision_conflict" });
    const request = { ...f.request, expectedRevision: 1 };
    expect(await enqueueCompositionVideoExport(request)).toEqual({ jobId: "job", reused: false });
    f.close();
    expect(await enqueueCompositionVideoExport(request)).toEqual({ jobId: "job", reused: true });
    await expect(enqueueCompositionVideoExport({ ...request, fps: 30 })).rejects.toThrow("다른 내용");
    expect(f.exportVideo).not.toHaveBeenCalled();
  });

  it("파일 생성 후 실제 저장 ack를 기다리고 그 사이 바꾼 다른 프로젝트 필드를 보존한다", async () => {
    const f = fixture(); await enqueueCompositionVideoExport(f.request);
    let ack!: () => void;
    mock.ack = new Promise<void>(resolve => { ack = resolve; });
    mock.beforeWrite = () => { mock.project = { ...mock.project!, logline: "사람의 새 줄거리" }; };
    let done = false;
    const pending = run().then(value => { done = true; return value; });
    await vi.waitFor(() => expect(mock.write).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    expect(mock.result).toHaveBeenCalledWith("job", expect.objectContaining({ data: expect.objectContaining({ persisted: false }) }));
    ack();
    const result = await pending;
    expect(result.data).toMatchObject({ persisted: true, compositionSaved: false, sourceRevision: 0, frameCount: 360 });
    expect(mock.project!.logline).toBe("사람의 새 줄거리");
    expect(mock.project!.scenes[0].cuts[0]).toMatchObject({ refVideoPath: video.path, refVideoSeconds: 15 });
    expect(getCompositionSession(f.sessionId).busy).toBe(false);
  });

  it("렌더 중 수동 구도 변경은 파일 부착을 막고 바뀐 구도는 그대로 둔다", async () => {
    const f = fixture(); await enqueueCompositionVideoExport(f.request);
    f.exportVideo.mockImplementation(async (_options, controls) => { f.manual(); controls.assertCurrent?.(); return video; });
    await expect(run()).rejects.toMatchObject({ code: "revision_conflict" });
    expect(mock.write).not.toHaveBeenCalled();
    expect(getCompositionSession(f.sessionId).state.camera.fovDegrees).toBe(61);
    expect(getCompositionSession(f.sessionId).busy).toBe(false);
  });

  it("줄에서 기다리는 동안 닫힌 세션은 렌더를 시작하지 않는다", async () => {
    const f = fixture(); await enqueueCompositionVideoExport(f.request);
    f.close();
    await expect(run()).rejects.toMatchObject({ code: "session_closed" });
    expect(f.exportVideo).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
  });

  it("파일 저장 중 세션이 닫히면 경로를 남기고 컷에 붙이지 않는다", async () => {
    const f = fixture(); await enqueueCompositionVideoExport(f.request);
    f.exportVideo.mockImplementation(async (_options, controls) => {
      controls.onFileSaved?.(video); f.close(); return video;
    });
    await expect(run()).rejects.toMatchObject({ code: "session_closed" });
    expect(mock.result).toHaveBeenCalledWith("job", expect.objectContaining({ paths: [video.path] }));
    expect(mock.write).not.toHaveBeenCalled();
  });

  it("저장 직전 사람이 레퍼런스를 고르면 덮어쓰지 않고 만든 파일 경로는 남긴다", async () => {
    const f = fixture(); await enqueueCompositionVideoExport(f.request);
    mock.beforeWrite = () => { mock.project!.scenes[0].cuts[0].refVideoPath = "manual.mp4"; };
    await expect(run()).rejects.toThrow("레퍼런스 영상 선택");
    expect(mock.project!.scenes[0].cuts[0].refVideoPath).toBe("manual.mp4");
    expect(mock.result).toHaveBeenCalledWith("job", expect.objectContaining({ paths: [video.path] }));
  });

  it("저장 실패와 취소는 완료로 돌려주지 않는다", async () => {
    const f = fixture(); await enqueueCompositionVideoExport(f.request);
    mock.persisted = false;
    await expect(run()).rejects.toThrow("프로젝트 저장을 확인하지 못했습니다");
    mock.project!.scenes[0].cuts[0].refVideoPath = undefined;
    mock.project!.scenes[0].cuts[0].refVideoSeconds = undefined;
    mock.stopping = true;
    await expect(run()).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.stop).toHaveBeenCalledWith("job");
  });
});
