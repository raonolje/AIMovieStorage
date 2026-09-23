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

  it("느린 디스크에서도 1659프레임 진행률을 쓰기 중 하나와 최신 대기 하나로 합친다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal(), gate = deferred(), end = deferred();
    let hold = false, writes = 0;
    let report!: (change: { progress: number; step: string }) => void;
    await q.registerTaskJournal({ read: disk.read, write: async value => {
      if (hold) { writes += 1; await gate.promise; }
      await disk.write(value);
    } });
    q.registerTaskRunner("fixture", async (_payload, progress) => { report = progress; await end.promise; });
    const accepted = await q.enqueueTaskOperation(job);
    await tick(); await q.flushTaskJournal();
    hold = true;
    report({ progress: 1 / 1659, step: "1 / 1659" });
    await tick();
    for (let frame = 2; frame <= 1659; frame += 1) report({ progress: frame / 1659, step: `${frame} / 1659` });
    expect(q.getTask(accepted.jobId)?.step).toBe("1659 / 1659");
    gate.resolve();
    await q.flushTaskJournal();
    hold = false; end.resolve(); await tick(); await q.flushTaskJournal();
    expect(writes).toBe(2);
    expect(disk.current()).toMatchObject({ tasks: [expect.objectContaining({ status: "done" })] });
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

  it("조회는 뒤에 붙은 완료 쓰기를 기다리지 않고 자신이 기다린 저장 상태만 돌려준다", async () => {
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
    let read = false;
    const reading = q.getPersistedTask(accepted.jobId).then(value => { read = true; return value; });
    await tick();
    runnerEnd.resolve(); await tick();
    first.resolve(); await tick();
    expect(q.getTask(accepted.jobId)?.status).toBe("done");
    expect(disk.current()).toMatchObject({ tasks: [expect.objectContaining({ status: "running" })] });
    expect(read).toBe(true);
    expect(await reading).toMatchObject({ status: "running", step: "아직 생성 중" });
    let finishedRead = false;
    const latest = q.getPersistedTask(accepted.jobId).then(value => { finishedRead = true; return value; });
    await tick();
    expect(finishedRead).toBe(false);
    completion.resolve();
    expect(await latest).toMatchObject({ status: "done", result: { paths: ["p/완료.png"] } });
    expect(disk.current()).toMatchObject({ tasks: [expect.objectContaining({ status: "done", result: { paths: ["p/완료.png"] } })] });
  });

  it("다른 작업이 계속 진행해도 조회를 받은 뒤 붙은 쓰기를 따라 기다리지 않는다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal(), firstWrite = deferred(), laterWrite = deferred(), rendering = deferred();
    let hold = false, writes = 0;
    let report!: (change: { progress: number }) => void;
    await q.registerTaskJournal({ read: disk.read, write: async value => {
      if (hold) { writes += 1; await (writes === 1 ? firstWrite : laterWrite).promise; }
      await disk.write(value);
    } });
    q.registerTaskRunner("fixture", async (_payload, progress) => {
      report = progress;
      if (q.listTasks().some(task => task.operationId === "render")) await rendering.promise;
      return { paths: ["p/완료.png"] };
    });
    const done = await q.enqueueTaskOperation(job);
    await tick(); await q.flushTaskJournal();
    const queued = await q.enqueueTaskOperation({ ...job, operationId: "render" });
    await tick(); await q.flushTaskJournal();
    hold = true;
    report({ progress: 0.1 }); await tick();
    const readingDone = q.getPersistedTask(done.jobId);
    const readingList = q.listPersistedTasks({ status: "running" });
    await tick();
    for (let frame = 2; frame <= 100; frame += 1) report({ progress: frame / 100 });
    firstWrite.resolve();
    expect(await readingDone).toMatchObject({ id: done.jobId, status: "done", result: { paths: ["p/완료.png"] } });
    expect(await readingList).toMatchObject([{ id: queued.jobId, status: "running", progress: 0.1 }]);
    expect(q.getTask(queued.jobId)?.progress).toBe(1);
    expect(disk.current()).toMatchObject({ tasks: expect.arrayContaining([expect.objectContaining({ id: queued.jobId, progress: 0.1 })]) });
    laterWrite.resolve(); await q.flushTaskJournal();
    hold = false; rendering.resolve(); await tick(); await q.flushTaskJournal();
  });

  it("완료 기록 쓰기 실패를 조회 성공으로 숨기지 않고 재시도 뒤 같은 작업 결과를 읽는다", async () => {
    const q = await import("@/lib/taskQueue");
    const disk = journal(), end = deferred();
    let fail = false;
    await q.registerTaskJournal({ read: disk.read, write: async value => {
      if (fail) throw new Error("디스크 쓰기 실패");
      await disk.write(value);
    } });
    q.registerTaskRunner("fixture", async () => { await end.promise; return { paths: ["p/완료.png"] }; });
    const accepted = await q.enqueueTaskOperation(job);
    await tick(); await q.flushTaskJournal();
    fail = true; end.resolve(); await tick();
    expect(q.getTask(accepted.jobId)?.status).toBe("done");
    await expect(q.getPersistedTask(accepted.jobId)).rejects.toThrow("디스크 쓰기 실패");
    await expect(q.listPersistedTasks()).rejects.toThrow("디스크 쓰기 실패");
    fail = false;
    expect(await q.enqueueTaskOperation(job)).toEqual({ ...accepted, reused: true });
    const saved = (await q.getPersistedTask(accepted.jobId))!;
    expect(saved).toMatchObject({ status: "done", result: { paths: ["p/완료.png"] } });
    saved.result!.paths![0] = "호출자 편집";
    expect((await q.getPersistedTask(accepted.jobId))?.result?.paths).toEqual(["p/완료.png"]);
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
    const byOperation = restarted.getTaskByOperationId("op-1");
    expect(byOperation?.id).toBe(first.jobId);
    byOperation!.result!.paths![0] = "호출자 편집";
    expect(restarted.getTaskByOperationId("op-1")?.result?.paths).toEqual(["p/image.png"]);
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
