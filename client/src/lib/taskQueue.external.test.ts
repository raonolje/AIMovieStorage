import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
const tick = () => new Promise<void>((done) => setTimeout(done, 0));
const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
};
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", memory());
});

describe("외부 부수 효과의 영속 시작·진행 기록", () => {
  it("시작 ack는 파일 쓰기를 기다리며 checkpoint와 시작 표시는 재시작·수동 재시도에도 보존된다", async () => {
    let q = await import("./taskQueue");
    let saved: unknown = null;
    let release!: () => void;
    let hold = false;
    await q.registerTaskJournal({
      read: async () => saved as never,
      write: async (snapshot) => {
        if (hold)
          await new Promise<void>((done) => {
            release = done;
          });
        saved = JSON.parse(JSON.stringify(snapshot));
      },
    });
    const job = await q.enqueueTaskOperation({
      lane: "media",
      projectId: "p",
      projectTitle: "작품",
      label: "외부 구성",
      kind: "test.external",
      operationId: "once",
      payload: { source: "reviewed" },
    });
    hold = true;
    let acknowledged = false;
    const mark = q.markTaskExternalEffectStarted(job.jobId).then(() => {
      acknowledged = true;
    });
    await tick();
    expect(acknowledged).toBe(false);
    hold = false;
    release();
    await mark;
    const checkpoint = {
      phase: "submitted",
      promptId: "external-id",
      outputs: ["등록할 파일"],
    };
    await q.saveTaskExternalCheckpoint(job.jobId, checkpoint);
    checkpoint.outputs.push("호출자 수정");
    q.stopTask(job.jobId);
    await q.flushTaskJournal();
    vi.resetModules();
    q = await import("./taskQueue");
    await q.registerTaskJournal({
      read: async () => saved as never,
      write: async (snapshot) => {
        saved = JSON.parse(JSON.stringify(snapshot));
      },
    });
    q.retryTask(job.jobId);
    await q.flushTaskJournal();
    const task = q.getTask(job.jobId)!;
    expect(task.externalEffectStartedAt).toBeGreaterThan(0);
    expect(task.externalCheckpoint).toEqual({
      phase: "submitted",
      promptId: "external-id",
      outputs: ["등록할 파일"],
    });
    expect(task.payload).toEqual({ source: "reviewed" });
    expect((await q.getPersistedTask(job.jobId))?.externalCheckpoint).toEqual(
      task.externalCheckpoint,
    );
  });

  it("시작 기록 쓰기 실패는 호출자에게 전파되어 실제 외부 호출로 진행할 수 없다", async () => {
    const q = await import("./taskQueue");
    let fail = false;
    await q.registerTaskJournal({
      read: async () => null,
      write: async () => {
        if (fail) throw new Error("시험 디스크 오류");
      },
    });
    const job = await q.enqueueTaskOperation({
      lane: "media",
      projectId: "p",
      projectTitle: "작품",
      label: "외부 구성",
      kind: "test.external",
      operationId: "fail",
      payload: {},
    });
    fail = true;
    const external = vi.fn();
    await expect(
      q.markTaskExternalEffectStarted(job.jobId).then(external),
    ).rejects.toThrow("시험 디스크 오류");
    expect(external).not.toHaveBeenCalled();
  });
});
