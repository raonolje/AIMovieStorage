import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlToolResult } from "./appControlRegistry";

// 조종기 등록부와 작업 줄은 실제 코드로 잇고, 네이티브·GPU 호출만 막습니다.
const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
vi.mock("./llm", () => ({ isDesktopApp: () => false }));
vi.mock("./llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(done => setTimeout(done, 0));
beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("window", {});
  native.mockReset().mockRejectedValue(new Error("이 시험은 네이티브 작업을 실행하지 않습니다."));
});
afterEach(() => { expect(native).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("MCP 상태 조회와 작업 기록의 실제 연결", () => {
  it("렌더 진행률이 뒤이어 저장되어도 job_get·jobs_list는 선택한 기록까지만 기다린다", async () => {
    const q = await import("./taskQueue");
    const { dispatchAppControl } = await import("./appControlRegistry");
    const first = gate(), later = gate(), end = gate();
    let hold = false, writes = 0;
    let report!: (change: { progress: number }) => void;
    await q.registerTaskJournal({ read: async () => null, write: async () => {
      if (hold) { writes += 1; await (writes === 1 ? first : later).promise; }
    } });
    q.registerTaskRunner("test.render", async (_payload, progress) => { report = progress; await end.promise; return { paths: ["작품/영상.mp4"] }; });
    const accepted = await q.enqueueTaskOperation({ lane: "media", projectId: "p", projectTitle: "작품", label: "영상",
      kind: "test.render", operationId: "render", payload: { prompt: "내부 요청" } });
    await tick(); await q.flushTaskJournal();
    hold = true;
    report({ progress: 0.1 }); await tick();
    const call = (name: string, args: unknown) => dispatchAppControl("tools/call", { name, arguments: args }) as Promise<ControlToolResult>;
    let getDone = false, listDone = false;
    const get = call("job_get", { jobId: accepted.jobId }).then(value => { getDone = true; return value; });
    const list = call("jobs_list", { projectId: "p", status: "running" }).then(value => { listDone = true; return value; });
    await tick();
    report({ progress: 0.8 }); end.resolve(); await tick();
    expect(q.getTask(accepted.jobId)?.status).toBe("done");
    first.resolve();
    await vi.waitFor(() => expect([getDone, listDone]).toEqual([true, true]));
    const response = await get;
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ status: "running", progress: 0.1 });
    expect(response.structuredContent).not.toHaveProperty("result");
    expect(JSON.stringify(response)).not.toContain("내부 요청");
    expect((await list).structuredContent).toMatchObject({ jobs: [{ status: "running", progress: 0.1 }] });
    later.resolve();
    expect((await call("job_get", { jobId: accepted.jobId })).structuredContent).toMatchObject({ status: "done", result: { paths: ["작품/영상.mp4"] } });
  });

  it("취소 응답은 취소 요청이 디스크에 남은 뒤 반환하고 후속 완료로 덮지 않는다", async () => {
    const q = await import("./taskQueue");
    const { dispatchAppControl } = await import("./appControlRegistry");
    const cancelWrite = gate(), end = gate();
    let hold = false;
    await q.registerTaskJournal({ read: async () => null, write: async () => { if (hold) await cancelWrite.promise; } });
    q.registerTaskRunner("test.render", async () => { await end.promise; return { paths: ["작품/영상.mp4"] }; });
    const accepted = await q.enqueueTaskOperation({ lane: "media", projectId: "p", projectTitle: "작품", label: "영상",
      kind: "test.render", operationId: "cancel-render", payload: {} });
    await tick(); await q.flushTaskJournal();
    hold = true;
    let replied = false;
    const cancelling = dispatchAppControl("tools/call", { name: "job_cancel", arguments: { jobId: accepted.jobId } })
      .then(value => { replied = true; return value as ControlToolResult; });
    await tick();
    expect(replied).toBe(false);
    expect(q.isStopping(accepted.jobId)).toBe(true);
    cancelWrite.resolve();
    expect((await cancelling).structuredContent).toMatchObject({ status: "running", cancelRequestedAt: expect.any(Number) });
    end.resolve(); await tick();
    const final = await dispatchAppControl("tools/call", { name: "job_get", arguments: { jobId: accepted.jobId } }) as ControlToolResult;
    expect(final.structuredContent).toMatchObject({ status: "stopped", cancelRequestedAt: expect.any(Number), result: { paths: ["작품/영상.mp4"] } });
  });
});
