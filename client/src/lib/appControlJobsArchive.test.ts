import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlToolResult } from "./appControlRegistry";
import type { QueueTask } from "./taskQueue";

const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
vi.mock("./llm", () => ({ isDesktopApp: () => false }));
vi.mock("./llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
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

describe("완료 목록과 개별 작업 조회의 일치", () => {
  it("화면 완료 목록을 비워도 공식 목록에 보관된 완료 결과와 프로젝트 필터가 남는다", async () => {
    const q = await import("./taskQueue");
    const { dispatchAppControl } = await import("./appControlRegistry");
    await q.registerTaskJournal({ read: async () => null, write: async () => {} });
    q.registerTaskRunner("fixture", async () => ({ paths: ["작품/후보.png"] }));
    const ids = [];
    for (const projectId of ["p", "other"]) {
      const accepted = await q.enqueueTaskOperation({ lane: "media", projectId, projectTitle: "작품", label: "후보",
        kind: "fixture", operationId: projectId, payload: { prompt: "내부 요청" } });
      ids.push(accepted.jobId); await tick(); await q.flushTaskJournal();
    }
    q.clearFinishedTasks(); await q.flushTaskJournal();
    expect(q.listTasks()).toHaveLength(0);
    const call = (name: string, args: unknown) => dispatchAppControl("tools/call", {name, arguments: args}) as Promise<ControlToolResult>;
    const individual = await call("job_get", {jobId: ids[0]});
    expect(individual.structuredContent).toMatchObject({id: ids[0], status: "done"});
    const listed = await call("jobs_list", {projectId: "p", status: "done"});
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toEqual({jobs: [individual.structuredContent]});
    expect(JSON.stringify(listed)).not.toContain("내부 요청");
    expect((await call("jobs_list", {status: "running"})).structuredContent).toEqual({jobs: []});
    expect((await call("jobs_list", {status: "waiting"})).structuredContent).toEqual({jobs: []});
  });
  it("화면의 60개 보관 범위 밖 완료도 조회하고 ID 중복은 개별 조회와 같은 상태로 합친다", async () => {
    const q = await import("./taskQueue");
    const records: QueueTask[] = Array.from({length: 65}, (_,i) => ({id: `j${i}`, operationId: `op${i}`, lane: "media", projectId: "p",
      projectTitle: "작품", label: "후보", kind: "fixture", payload: {}, status: "done", queuedAt: i, finishedAt: i+1, result: {paths: [`p/${i}.png`]}}));
    const stale = {...records[64], status: "failed" as const, error: "옛 상태"};
    const initial = {version: 1 as const, tasks: records.slice(-60), operations: [...records.slice(0,-1), stale]};
    await q.registerTaskJournal({read: async () => initial, write: async () => {}});
    const done = await q.listPersistedTasks({status: "done", projectId: "p"});
    expect(done).toHaveLength(65);
    expect(new Set(done.map(j => j.id)).size).toBe(65);
    expect(await q.listPersistedTasks({status: "failed"})).toEqual([]);
    for (const item of done) expect(item).toEqual(await q.getPersistedTask(item.id));
    expect(initial.operations.at(-1)?.status).toBe("failed");
    done[0].result!.paths![0] = "호출자 변경";
    expect((await q.getPersistedTask(done[0].id))?.result?.paths).not.toEqual(["호출자 변경"]);
  });
});
