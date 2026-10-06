import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), enqueue: vi.fn(), refresh: vi.fn(), stopping: false,
  runner: undefined as undefined | ((raw: unknown, report: ReturnType<typeof vi.fn>, task: { id: string }) => Promise<unknown>), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: state.listen }));
vi.mock("./localLoras", () => ({ refreshLoraFiles: state.refresh }));
vi.mock("./localEngines", () => ({ LOCAL_ENGINE_IDS: ["ltx25"] }));
vi.mock("./taskQueue", () => ({ enqueueTaskOperation: state.enqueue, isStopping: () => state.stopping,
  registerTaskRunner: (_: string, runner: typeof state.runner) => { state.runner = runner; } }));
const input = { operationId: "download-1", engine: "ltx25", repo: "Lightricks/LTX-2.5", file: "loras/ltx-2.5-22b-distilled-lora-450-bf16.safetensors" };
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); state.stopping = false; state.listen.mockResolvedValue(state.unlisten); state.refresh.mockResolvedValue([]); });
afterEach(() => { vi.useRealTimers(); });
describe("공식 로라 다운로드 조종기", () => {
  it("임의 제공자·경로·비밀값·모델·잘못된 해시를 큐에 넣기 전에 거절한다", async () => {
    const api = await import("./controlLoraDownload");
    for (const change of [{ repo: "evil/LTX-2.5" }, { file: "../token" }, { file: input.file + "?token=x" }, { engine: "minimaxh3" },
      { token: "secret" }, { url: "https://evil.example" }, { expectedSha256: "bad" }, { operationId: " " }])
      await expect(api.enqueueControlLoraDownload({ ...input, ...change })).rejects.toThrow();
    expect(state.enqueue).not.toHaveBeenCalled(); expect(state.invoke).not.toHaveBeenCalled();
  });
  it("같은 operationId와 순수 입력을 기존 작업줄에 보낸다", async () => {
    const api = await import("./controlLoraDownload"); state.enqueue.mockResolvedValue({ jobId: "job-1" });
    expect(await api.enqueueControlLoraDownload(input)).toEqual({ jobId: "job-1" });
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ operationId: input.operationId, lane: "media", payload: input }));
  });
  it("완료된 파일 정보를 돌려주되 설치·생성 가능으로 판정하지 않는다", async () => {
    await import("./controlLoraDownload");
    const data = { engine: "ltx25", fileName: input.file.split("/").pop(), sizeBytes: 8899889568, sha256: "a".repeat(64), expectedSha256Verified: false, reused: true };
    state.invoke.mockResolvedValue(data); const report = vi.fn();
    const result = await state.runner!(input, report, { id: "task-1" });
    expect(state.invoke).toHaveBeenCalledWith("lora_download_control", { engine: input.engine, repo: input.repo, file: input.file, transferId: "task-1", expectedSha256: null });
    expect(result).toEqual({ data: { ...data, modelInstalled: false, generationEnabled: false } });
    expect(state.refresh).toHaveBeenCalledOnce(); expect(state.unlisten).toHaveBeenCalledOnce();
  });
  it("다른 파일의 진행을 섞지 않고 실제 진행만 작업 상태로 전달한다", async () => {
    await import("./controlLoraDownload"); state.invoke.mockResolvedValue({}); const report = vi.fn();
    await state.runner!(input, report, { id: "task" });
    const listener = state.listen.mock.calls[0][1];
    listener({ payload: { engine: "wanvideo", file: "other", percent: 40, message: "다른 작업" } }); expect(report).not.toHaveBeenCalled();
    listener({ payload: { engine: input.engine, file: input.file.split("/").pop(), percent: 40, message: "실제 진행" } });
    expect(report).toHaveBeenCalledWith({ progress: 0.4, step: "실제 진행" });
  });
  it("서버가 진행을 보내지 않아도 취소하고 리스너를 정리한다", async () => {
    vi.useFakeTimers(); await import("./controlLoraDownload");
    let fail!: (e: Error) => void;
    state.invoke.mockImplementation((name: string) => name === "lora_download_control" ? new Promise((_, reject) => { fail = reject; }) : Promise.resolve(true));
    const pending = state.runner!(input, vi.fn(), { id: "task" });
    const outcome = expect(pending).rejects.toThrow("멈췄습니다");
    await vi.advanceTimersByTimeAsync(0); state.stopping = true; await vi.advanceTimersByTimeAsync(200);
    expect(state.invoke).toHaveBeenCalledWith("lora_download_cancel", { transferId: "task" });
    fail(new Error("멈췄습니다")); await outcome;
    expect(state.unlisten).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("401을 재시도하거나 빈 완료로 바꾸지 않는다", async () => {
    await import("./controlLoraDownload"); state.invoke.mockRejectedValue(new Error("HTTP 401: 접근 거부"));
    await expect(state.runner!(input, vi.fn(), { id: "task" })).rejects.toThrow("HTTP 401");
    expect(state.invoke).toHaveBeenCalledOnce(); expect(state.refresh).not.toHaveBeenCalled(); expect(state.unlisten).toHaveBeenCalledOnce();
  });
  it("실행 전 취소는 다운로드 서비스를 호출하지 않는다", async () => {
    await import("./controlLoraDownload"); state.stopping = true;
    await state.runner!(input, vi.fn(), { id: "task" }); expect(state.invoke).not.toHaveBeenCalled(); expect(state.listen).not.toHaveBeenCalled();
  });
});
