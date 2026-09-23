import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llmActivity", () => ({ abandonLlmResumes: vi.fn() }));

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const job = { lane: "media" as const, projectId: "p", projectTitle: "작품", kind: "fixture", label: "그림", payload: { prompt: "바다" }, operationId: "op-1" };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memory());
  vi.stubGlobal("window", {});
});

function journal() {
  let saved: unknown = null;
  return {
    read: async () => saved,
    write: async (value: unknown) => { saved = JSON.parse(JSON.stringify(value)); },
    current: () => saved,
  };
}

describe("외부 작업 기록", () => {
  it("설치본은 앱 기록을 읽기 전 옛 웹뷰 대기열을 실행하지 않는다", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    localStorage.setItem("frameforge.taskQueue", JSON.stringify([{ ...job, operationId: undefined, id: "old", status: "waiting", queuedAt: 1 }]));
    const q = await import("@/lib/taskQueue");
    const run = vi.fn(async () => {});
    q.registerTaskRunner("fixture", run);
    await tick();
    expect(run).not.toHaveBeenCalled();
    await q.registerTaskJournal({ read: async () => ({ version: 1, tasks: [], operations: [] }), write: async () => {} });
    expect(q.listTasks()).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("읽을 수 없는 앱 기록을 빈 기록으로 덮지 않고 실행을 막는다", async () => {
    const q = await import("@/lib/taskQueue");
    const write = vi.fn(async () => {});
    await expect(q.registerTaskJournal({ read: async () => ({ version: 999 }), write })).rejects.toThrow("저장 형식");
    expect(write).not.toHaveBeenCalled();
    expect(q.getTaskJournalError()).toContain("저장 형식");
  });

  it("한 묶음의 같은 중복 열쇠도 한 번만 등록한다", async () => {
    const q = await import("@/lib/taskQueue");
    expect(q.enqueueTasks([{ ...job, dedupe: "same" }, { ...job, dedupe: "same" }])).toBe(1);
  });

  it("파일 기록이 완료되기 전에는 접수 성공도 실행도 하지 않는다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal();
    const gate = deferred();
    let block = false;
    await q.registerTaskJournal({ read: disk.read, write: async (value) => { if (block) await gate.promise; await disk.write(value); } });
    const run = vi.fn(async () => ({ paths: ["p/image.png"] }));
    q.registerTaskRunner("fixture", run);
    block = true;
    let acknowledged = false;
    const requested = q.enqueueTaskOperation(job).then((value) => { acknowledged = true; return value; });
    await tick();
    expect(acknowledged).toBe(false);
    expect(run).not.toHaveBeenCalled();
    gate.resolve();
    const accepted = await requested;
    await tick();
    await q.flushTaskJournal();
    expect(run).toHaveBeenCalledTimes(1);
    expect(q.getTask(accepted.jobId)?.result?.paths).toEqual(["p/image.png"]);
  });

  it("기록을 기다리는 중 끝난 작업도 완료 결과가 파일에 쓰일 때까지 응답을 늦춘다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal();
    const first = deferred(), completion = deferred(), runnerEnd = deferred();
    let hold = false, writes = 0;
    let report!: (change: { step: string }) => void;
    await q.registerTaskJournal({ read: disk.read, write: async (value) => {
      if (hold) { writes += 1; await (writes === 1 ? first : completion).promise; }
      await disk.write(value);
    } });
    q.registerTaskRunner("fixture", async (_payload, progress) => {
      report = progress;
      await runnerEnd.promise;
      return { paths: ["p/완료.png"] };
    });
    const accepted = await q.enqueueTaskOperation(job);
    await tick(); await q.flushTaskJournal();
    hold = true;
    report({ step: "아직 생성 중" });
    await tick();
    let flushed = false;
    const reading = q.flushTaskJournal().then(() => { flushed = true; });
    await tick();
    runnerEnd.resolve(); await tick();
    first.resolve(); await tick();
    expect(q.getTask(accepted.jobId)?.status).toBe("done");
    expect(disk.current()).toMatchObject({ tasks: [expect.objectContaining({ status: "running" })] });
    expect(flushed).toBe(false);
    completion.resolve(); await reading;
    expect(disk.current()).toMatchObject({ tasks: [expect.objectContaining({ status: "done", result: { paths: ["p/완료.png"] } })] });
  });

  it("끝난 목록을 비우고 앱을 다시 열어도 같은 명령은 같은 결과를 준다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal();
    await q.registerTaskJournal(disk);
    const run = vi.fn(async () => ({ assetIds: ["a-1"], paths: ["p/image.png"] }));
    q.registerTaskRunner("fixture", run);
    const first = await q.enqueueTaskOperation(job);
    await tick();
    q.clearFinishedTasks();
    await q.flushTaskJournal();
    vi.resetModules();
    vi.stubGlobal("localStorage", memory());
    const restarted = await import("@/lib/taskQueue");
    await restarted.registerTaskJournal(disk);
    const rerun = vi.fn(async () => {});
    restarted.registerTaskRunner("fixture", rerun);
    const repeated = await restarted.enqueueTaskOperation(job);
    expect(repeated).toEqual({ jobId: first.jobId, reused: true });
    expect(restarted.getTask(first.jobId)?.result?.assetIds).toEqual(["a-1"]);
    expect(rerun).not.toHaveBeenCalled();
  });

  it("같은 명령 열쇠에 다른 내용을 보내면 거절한다", async () => {
    const q = await import("@/lib/taskQueue");
    await q.registerTaskJournal(journal());
    await q.enqueueTaskOperation(job);
    await expect(q.enqueueTaskOperation({ ...job, payload: { prompt: "숲" } })).rejects.toThrow("다른 내용");
    expect(q.listTasks()).toHaveLength(1);
  });

  it("기록 실패를 호출자에게 알리고 생성하지 않으며 같은 열쇠로 복구한다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal();
    let fail = false;
    await q.registerTaskJournal({ read: disk.read, write: async (value) => { if (fail) throw new Error("권한 없음"); await disk.write(value); } });
    const run = vi.fn(async () => {});
    q.registerTaskRunner("fixture", run);
    fail = true;
    await expect(q.enqueueTaskOperation(job)).rejects.toThrow("권한 없음");
    expect(run).not.toHaveBeenCalled();
    const id = q.listTasks()[0].id;
    fail = false;
    expect(await q.enqueueTaskOperation(job)).toEqual({ jobId: id, reused: true });
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("실행 중 중지 요청은 재시작 후에도 남아 다시 생성하지 않는다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal();
    await q.registerTaskJournal(disk);
    q.registerTaskRunner("fixture", async () => new Promise<void>(() => {}));
    const accepted = await q.enqueueTaskOperation(job);
    await tick();
    q.stopTask(accepted.jobId);
    await q.flushTaskJournal();
    vi.resetModules();
    const restarted = await import("@/lib/taskQueue");
    await restarted.registerTaskJournal(disk);
    const run = vi.fn(async () => {});
    restarted.registerTaskRunner("fixture", run);
    await tick();
    expect(restarted.getTask(accepted.jobId)?.status).toBe("stopped");
    expect(run).not.toHaveBeenCalled();
  });

  it("외부 생성이 중단되면 결과 확인 전 자동 재실행하지 않는다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal();
    await q.registerTaskJournal(disk);
    q.registerTaskRunner("fixture", async () => new Promise<void>(() => {}));
    const accepted = await q.enqueueTaskOperation(job);
    await tick();
    await q.flushTaskJournal();
    vi.resetModules();
    const restarted = await import("@/lib/taskQueue");
    await restarted.registerTaskJournal(disk);
    const run = vi.fn(async () => {});
    restarted.registerTaskRunner("fixture", run);
    expect(restarted.getTask(accepted.jobId)?.status).toBe("failed");
    expect(restarted.getTask(accepted.jobId)?.error).toContain("결과를 확인");
    expect(run).not.toHaveBeenCalled();
  });

  it("조회한 작업을 고쳐도 실제 입력과 결과는 변하지 않는다", async () => {
    const q = await import("@/lib/taskQueue");
    await q.registerTaskJournal(journal());
    const accepted = await q.enqueueTaskOperation(job);
    const copy = q.getTask(accepted.jobId)!;
    (copy.payload as { prompt: string }).prompt = "바꿈";
    expect(q.getTask(accepted.jobId)?.payload).toEqual({ prompt: "바다" });
  });
});
