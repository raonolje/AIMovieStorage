import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { newProjectDraft, newScene, newCut, type ProjectDraft } from "./projectTypes";
import { normalizeComposition, type CompositionState } from "./composition";
import type { ControlToolResult } from "./appControlRegistry";
import type { CompositionSessionPort } from "./compositionControl";

// 등록부·입력 규격·실제 리비전 판정은 그대로 둡니다. 디스크·GPU·작업 실행만 격리합니다.
const state = vi.hoisted(() => ({
  projects: new Map<string, { id: string; draft: ProjectDraft }>(),
  writes: vi.fn(), enqueue: vi.fn(), run: vi.fn(), native: vi.fn(),
  tasks: [] as Record<string, unknown>[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.native }));
vi.mock("@/lib/llm", () => ({ isDesktopApp: () => false }));
vi.mock("@/lib/localOutput", () => ({ runLocalToProject: state.run }));
vi.mock("@/lib/mediaLibrary", () => ({
  assetSrc: (path: string) => `asset:${path}`,
  loadImageForCanvas: vi.fn(), safeFileName: (value: string) => value,
  isVideoFile: (path?: string | null) => /\.(mp4|webm|mov|mkv|avi|m4v)(?:[?#].*)?$/i.test(path ?? ""),
  registerMirrorSection: vi.fn(), queueMirrorWriteAndConfirm: async () => {}, whenAppSettingsReady: async () => {},
}));
vi.mock("@/lib/taskQueue", () => ({
  registerTaskRunner: vi.fn(), enqueueTaskOperation: state.enqueue,
  isStopping: () => false, setTaskResult: vi.fn(),
  listTasks: () => state.tasks, getTask: (id: string) => state.tasks.find(task => task.id === id),
  listPersistedTasks: async () => state.tasks, getPersistedTask: async (id: string) => state.tasks.find(task => task.id === id),
  stopTask: vi.fn(), flushTaskJournal: async () => {},
  whenTaskJournalReady: async () => {}, getTaskByOperationId: () => null,
}));
vi.mock("@/lib/localProjectStore", () => ({
  loadProjects: async () => [...state.projects.values()],
  listLocalProjects: () => [...state.projects.values()].map(item => ({ id: item.id, title: item.draft.title })),
  getLocalProject: (id: string) => state.projects.get(id) ?? null,
  projectFolderName: () => "시험 작품",
  saveLocalProjectAndConfirm: async (draft: ProjectDraft, id: string) => {
    state.writes();
    const project = { id, draft };
    state.projects.set(id, project);
    return { project, outcome: "written" };
  },
}));
vi.mock("@/lib/projectWrite", () => ({
  readProject: (id: string) => state.projects.get(id)?.draft ?? null,
  writeProjectAndConfirm: async (id: string, update: (current: ProjectDraft) => Partial<ProjectDraft>) => {
    state.writes();
    const project = state.projects.get(id)!;
    project.draft = { ...project.draft, ...update(project.draft) };
    return { draft: project.draft, persisted: true, outcome: "written" };
  },
}));

const cleanups: (() => void)[] = [];
const current = () => state.projects.get("p")!.draft;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_EDITION", "public");
  state.projects.clear(); state.tasks = [];
  state.native.mockRejectedValue(new Error("이 시험에서는 네이티브 명령을 실행하지 않습니다."));
  state.run.mockRejectedValue(new Error("이 시험에서는 GPU를 실행하지 않습니다."));
  state.enqueue.mockResolvedValue({ jobId: "queued", reused: false });
  state.projects.set("p", { id: "p", draft: {
    ...newProjectDraft(), title: "시험 작품",
    scenes: [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "c", images: [
      { id: "image", filePath: "project/이미지.png", name: "이미지", thumb: "", file: null },
    ] }] }],
  } });
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.unstubAllEnvs();
  expect(state.run).not.toHaveBeenCalled();
  expect(state.native).not.toHaveBeenCalled();
});

async function call(name: string, args?: unknown) {
  const { dispatchAppControl } = await import("./appControlRegistry");
  return await dispatchAppControl("tools/call", { name, arguments: args }) as ControlToolResult;
}
function expectFailure(response: ControlToolResult, code: string) {
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toMatchObject({ code });
  const first = response.content[0];
  expect(first.type).toBe("text");
  if (first.type === "text") expect(JSON.parse(first.text)).toEqual(response.structuredContent);
}
async function listedTools() {
  const api = await import("./appControlRegistry");
  return await api.dispatchAppControl("tools/list", {}) as { tools: Array<Omit<import("./appControlRegistry").AppControlTool, "call">> };
}
async function compositionFixture() {
  const api = await import("./compositionControl");
  let composition = normalizeComposition();
  const apply = vi.fn((update: (current: CompositionState) => CompositionState) => { composition = update(composition); });
  const capture = vi.fn(async () => ({ guide: "data:image/png;base64,Zw==", plate: "data:image/jpeg;base64,cA==" }));
  const commit = vi.fn(async () => ({ persisted: true }));
  const port: CompositionSessionPort = {
    read: () => ({ state: composition, canUndo: false, canRedo: false, context: { characterIds: [], imageIds: [] } }),
    apply, capture, commit, undo: vi.fn(), redo: vi.fn(),
  };
  cleanups.push(api.registerCompositionSession({ projectName: "시험 작품", cutId: "c" }, port));
  const sessionId = api.listCompositionSessions().at(-1)!.sessionId;
  return { sessionId, apply, capture, commit, current: () => composition, manual: () => {
    composition = { ...composition, camera: { ...composition.camera, fovDegrees: 61 } };
  } };
}

describe("MCP 도구 등록부와 실제 호출의 계약", () => {
  it("큰 전체 응답은 명시적으로 거절하고 기본 요약·수정 결과는 같은 ID와 리비전을 돌려준다", async () => {
    current().scenes[0].cuts[0].guideImage = `data:image/png;base64,${"A".repeat(5 * 1024 * 1024)}`;
    const summary = await call("project_get", { projectId: "p" });
    expect(summary.isError).not.toBe(true);
    expect(summary.structuredContent).toMatchObject({ projectId: "p", projection: { detail: "summary", truncated: true }, draft: { scenes: [{ id: "s", cuts: [{ id: "c", guideImage: "" }] }] } });
    expect(JSON.stringify(summary).length).toBeLessThan(50_000);
    const full = await call("project_get", { projectId: "p", detail: "full" });
    expectFailure(full, "response_too_large");
    expect(full.structuredContent?.details).toMatchObject({ projectId: "p", revision: summary.structuredContent!.revision, retryDetail: "summary" });
    const update = await call("project_update", { projectId: "p", expectedRevision: summary.structuredContent!.revision, commands: [{ type: "project.update", fields: { title: "새 제목" } }] });
    expect(update.isError).not.toBe(true);
    expect(update.structuredContent).toMatchObject({ persisted: true, projection: { detail: "summary" }, draft: { title: "새 제목" } });
    expect(current().scenes[0].cuts[0].guideImage.length).toBeGreaterThan(5 * 1024 * 1024);
  });

  it("공개한 JSON 규격은 실제 프로젝트·구도·생성 검증 규격이며 함수는 전송하지 않는다", async () => {
    const { tools } = await listedTools();
    const project = await import("./projectControl");
    const composition = await import("./compositionControl");
    const media = await import("./controlMedia");
    const mocap = await import("./controlMocap");
    const applyMocap = await import("./compositionMocapControl");
    const exportVideo = await import("./compositionVideoExport");
    for (const [name, schema] of [
      ["project_create", project.projectCreateSchema], ["project_update", project.projectUpdateSchema],
      ["composition_apply", composition.compositionApplyRequestSchema], ["composition_commit", composition.compositionSessionRequestSchema],
      ["media_generate", media.generateMediaSchema], ["media_upscale", media.upscaleMediaSchema],
      ["mocap_analyze", mocap.mocapAnalyzeSchema], ["mocap_track_hands", mocap.mocapHandsSchema],
      ["mocap_result", mocap.mocapResultSchema],
      ["composition_apply_mocap", applyMocap.compositionApplyMocapSchema],
      ["composition_export_video", exportVideo.compositionExportVideoSchema],
    ] as const) {
      expect(tools.find(tool => tool.name === name)?.inputSchema).toEqual(z.toJSONSchema(schema));
    }
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    expect(JSON.parse(JSON.stringify(tools))).toEqual(tools);
    expect(tools.every(tool => !("call" in tool))).toBe(true);
    expect(tools.find(tool => tool.name === "project_update")?.inputSchema.required).toContain("expectedRevision");
    expect(tools.find(tool => tool.name === "composition_apply")?.inputSchema.required).toContain("expectedRevision");
  });

  it("리비전 없는 쓰기와 잘못된 입력 형식은 실행 전에 명시적 오류로 돌려준다", async () => {
    const f = await compositionFixture();
    for (const [name, args] of [
      ["project_update", { projectId: "p", commands: [{ type: "project.update", fields: { title: "덮기" } }] }],
      ["project_update", { projectId: "p", expectedRevision: 0, commands: [] }],
      ["composition_apply", { sessionId: f.sessionId, commands: [{ op: "camera.set", fovDegrees: 70 }] }],
      ["composition_undo", { sessionId: f.sessionId }],
      ["composition_redo", { sessionId: f.sessionId }],
      ["composition_commit", { sessionId: f.sessionId }],
      ["composition_export_video", { projectId: "p", sessionId: f.sessionId, operationId: "op" }],
      ["composition_apply", { sessionId: f.sessionId, expectedRevision: 0, commands: [{ op: "camera.set", fovDegrees: 900 }] }],
    ] as const) expectFailure(await call(name, args), "invalid_request");
    expect(current().title).toBe("시험 작품");
    expect(state.writes).not.toHaveBeenCalled();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it("사람이 바꾼 프로젝트를 오래된 요청이 덮지 못하고 충돌 코드를 보존한다", async () => {
    const read = await call("project_get", { projectId: "p" });
    const revision = read.structuredContent!.revision;
    current().title = "사람의 새 제목";
    const rejected = await call("project_update", { projectId: "p", expectedRevision: revision, commands: [{ type: "project.update", fields: { title: "오래된 제목" } }] });
    expectFailure(rejected, "revision_conflict");
    expect(current().title).toBe("사람의 새 제목");
    expect(state.writes).not.toHaveBeenCalled();
    const changes = await call("project_changes", { projectId: "p", sinceRevision: revision });
    expect(changes.structuredContent?.changes).toContainEqual(expect.objectContaining({ source: "app", path: "/title", after: "사람의 새 제목" }));
  });

  it("구도 리비전 충돌도 MCP 경계에서 성공으로 바뀌지 않는다", async () => {
    const f = await compositionFixture();
    f.manual();
    const rejected = await call("composition_apply", { sessionId: f.sessionId, expectedRevision: 0, commands: [{ op: "camera.set", fovDegrees: 70 }] });
    expectFailure(rejected, "revision_conflict");
    expect(rejected.structuredContent?.details).toMatchObject({ expectedRevision: 0, actualRevision: 1 });
    expect(f.current().camera.fovDegrees).toBe(61);
    expect(f.apply).not.toHaveBeenCalled();
  });

  it("가이드와 배경판은 네이티브 MCP 이미지 블록으로 전달하며 외부 주소는 거절한다", async () => {
    const f = await compositionFixture();
    const preview = await call("composition_capture", { sessionId: f.sessionId, expectedRevision: 0 });
    expect(preview.isError).not.toBe(true);
    expect(preview.content.slice(1)).toEqual([
      { type: "image", mimeType: "image/png", data: "Zw==" },
      { type: "image", mimeType: "image/jpeg", data: "cA==" },
    ]);
    const info = preview.content[0];
    expect(info.type === "text" && JSON.parse(info.text)).toMatchObject({ sessionId: f.sessionId, revision: 0, images: ["guide", "plate"] });
    f.capture.mockResolvedValue({ guide: "https://example.invalid/guide.png", plate: "data:image/png;base64,cA==" });
    expectFailure(await call("composition_capture", { sessionId: f.sessionId, expectedRevision: 0 }), "operation_failed");
    expect(f.commit).not.toHaveBeenCalled();
  });

  it("알 수 없는 도구·원격 코드·임의 파일 경로는 실행이나 생성 대기열에 도달하지 않는다", async () => {
    const { tools } = await listedTools();
    for (const name of ["eval", "exec", "shell", "read_file", "write_file", "http_request"]) {
      expect(tools.some(tool => tool.name === name)).toBe(false);
      expectFailure(await call(name, { code: "process.exit()", path: "C:/outside.txt", url: "https://example.invalid" }), "operation_failed");
    }
    const f = await compositionFixture();
    expectFailure(await call("composition_apply", { sessionId: f.sessionId, expectedRevision: 0, commands: [{ op: "eval", code: "alert(1)" }] }), "invalid_request");
    const generate = { projectId: "p", target: { kind: "cut", id: "c" }, engine: "qwenimage", operationId: "attempt", options: { prompt: "장면" } };
    expectFailure(await call("media_generate", { ...generate, options: { ...generate.options, image: "C:/outside.png" } }), "invalid_request");
    expectFailure(await call("media_upscale", { projectId: "p", assetId: "image", engine: "seedvr2", operationId: "up", targetSize: 2048, path: "C:/outside.png" }), "invalid_request");
    expectFailure(await call("asset_preview", { projectId: "p", assetId: "image", path: "C:/outside.png" }), "invalid_request");
    expectFailure(await call("mocap_analyze", { projectId: "p", assetId: "video", operationId: "body", options: { engine: "mediapipe" }, path: "C:/outside.mp4" }), "invalid_request");
    expectFailure(await call("mocap_track_hands", { projectId: "p", sourceId: "body", operationId: "hand", path: "C:/outside.mp4" }), "invalid_request");
    expectFailure(await call("mocap_result", { projectId: "p", sourceId: "body", limit: 31 }), "invalid_request");
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(f.apply).not.toHaveBeenCalled();
  });

  it("공개판의 실제 엔진 목록으로 규격을 만들고 제외 엔진 직접 호출도 거절한다", async () => {
    const { tools } = await listedTools();
    const { excludedEnginesIn } = await import("./edition");
    const { LOCAL_ENGINE_IDS, LOCAL_ENGINE_CATALOG } = await import("./localEngines");
    const { UPSCALE_ENGINE_IDS } = await import("./upscale");
    const enumOf = (name: string) => (tools.find(tool => tool.name === name)!.inputSchema.properties as Record<string, { enum: string[] }>).engine.enum;
    expect(enumOf("media_generate")).toEqual(LOCAL_ENGINE_IDS.filter(id => ["image", "video"].includes(LOCAL_ENGINE_CATALOG[id].kind)));
    expect(enumOf("media_upscale")).toEqual(UPSCALE_ENGINE_IDS);
    expect(enumOf("media_generate")).toContain("qwenimage");
    expect(enumOf("media_upscale")).toContain("seedvr2");
    for (const engine of LOCAL_ENGINE_IDS.filter(id => ["music", "mocap"].includes(LOCAL_ENGINE_CATALOG[id].kind))) {
      expect(enumOf("media_generate")).not.toContain(engine);
      expectFailure(await call("media_generate", { projectId: "p", target: { kind: "cut", id: "c" }, engine, operationId: "unsupported-kind", options: { prompt: "장면" } }), "invalid_request");
    }
    for (const engine of excludedEnginesIn("public")) {
      expect(enumOf("media_generate")).not.toContain(engine);
      expect(enumOf("media_upscale")).not.toContain(engine);
      expectFailure(await call("media_generate", { projectId: "p", target: { kind: "cut", id: "c" }, engine, operationId: "excluded", options: { prompt: "장면" } }), "invalid_request");
      expectFailure(await call("media_upscale", { projectId: "p", assetId: "image", engine, operationId: "excluded-up", targetSize: 2048 }), "invalid_request");
    }
    expect(state.enqueue).not.toHaveBeenCalled();
    // 같은 실제 모듈을 비공개판으로 다시 읽으면 원본 엔진은 여전히 남아 있습니다.
    vi.resetModules(); vi.stubEnv("VITE_EDITION", "private");
    await listedTools();
    const available = [...(await import("./localEngines")).LOCAL_ENGINE_IDS, ...(await import("./upscale")).UPSCALE_ENGINE_IDS];
    for (const engine of excludedEnginesIn("public")) expect(available).toContain(engine);
  });

  it("변경 기다리기는 제한 시간을 검증하고 바뀐 상태를 즉시 반환한다", async () => {
    const f = await compositionFixture();
    expectFailure(await call("composition_wait_changes", { sessionId: f.sessionId, sinceRevision: 0, timeoutMs: 20001 }), "invalid_request");
    f.manual();
    const changed = await call("composition_wait_changes", { sessionId: f.sessionId, sinceRevision: 0, timeoutMs: 0 });
    expect(changed.structuredContent).toMatchObject({ revision: 1, fullSnapshotRequired: false, changes: [expect.objectContaining({ source: "editor" })] });
  });

  it("작업 조회는 결과를 보존하면서 내부 요청 본문과 재개 식별자를 노출하지 않는다", async () => {
    state.tasks = [{ id: "j", status: "done", result: { paths: ["project/result.png"] }, payload: { secret: "private-input" }, requestFingerprint: "fingerprint", llmResponseId: "resume-id" }];
    for (const response of [await call("jobs_list"), await call("job_get", { jobId: "j" })]) {
      expect(response.isError).not.toBe(true);
      const wire = JSON.stringify(response);
      expect(wire).toContain("project/result.png");
      for (const field of ["private-input", "requestFingerprint", "llmResponseId"]) expect(wire).not.toContain(field);
    }
  });
});
