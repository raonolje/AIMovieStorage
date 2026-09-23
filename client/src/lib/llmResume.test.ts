import { describe, expect, it } from "vitest";

/*
  **앱을 껐다 켰을 때** API 기록과 작업 줄이 어떻게 되살아나는가 —

  두 저장소 모듈은 불러오는 순간 localStorage 를 읽으므로, 앱이 닫힐 때의 모습을 먼저 가짜 localStorage 에
  넣어 두고 그 뒤에 동적으로 불러옵니다. node 에는 window 가 없어 `window` 도 이 파일 안에서만 흉내 냅니다.
*/
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
Object.assign(globalThis, { window: globalThis, localStorage: fakeStorage });

// 앱이 닫힐 때 — 도중이던 요청 셋: 응답 id 가 있고 줄에도 남은 것 · 응답 id 는 있는데 줄에 없는 것 · id 없는 것.
store.set(
  "ai-video-storage.llm-activity.v1",
  JSON.stringify([
    { id: "j-kept", task: "cutVideoPrompt", label: "컷 3 · 영상", status: "running", startedAt: 1, responseId: "resp_kept" },
    { id: "j-orphan", task: "cutVideoPrompt", label: "컷 4 · 영상", status: "running", startedAt: 1, responseId: "resp_orphan" },
    { id: "j-plain", task: "cutPrompt", label: "카드 단추", status: "running", startedAt: 1 },
    { id: "j-done", task: "cutPrompt", label: "끝난 것", status: "done", startedAt: 1, finishedAt: 2 },
  ]),
);
const task = (over: Record<string, unknown>) => ({
  lane: "llm",
  projectId: "p",
  projectTitle: "작품",
  kind: "bootstrapPrompt",
  status: "running",
  queuedAt: 1,
  startedAt: 1,
  payload: {},
  ...over,
});
store.set(
  "frameforge.taskQueue",
  JSON.stringify([
    task({ id: "t-kept", label: "컷 3 · 영상", llmResponseId: "resp_kept", llmResumeStep: "prompt" }),
    task({ id: "t-fresh", label: "컷 5 · 그림" }),
  ]),
);

const activity = await import("@/lib/llmActivity");
const queue = await import("@/lib/taskQueue");

const job = (id: string) => activity.currentLlmJobs().find((item) => item.id === id);

describe("앱을 껐다 켰을 때", () => {
  it("API 기록 — 응답 id 가 있으면 «이어 받는 중», 없으면 예전처럼 끊김으로 되살아난다", () => {
    expect(job("j-kept")).toMatchObject({ status: "resuming", responseId: "resp_kept" });
    expect(job("j-kept")?.error).toBeUndefined();
    expect(job("j-orphan")).toMatchObject({ status: "resuming" });
    expect(job("j-plain")).toMatchObject({ status: "failed", error: "앱이 닫혀 결과를 받지 못했습니다." });
    expect(job("j-done")).toMatchObject({ status: "done" });
  });

  it("작업 줄 — 돌던 일은 다시 대기로, 이어 받을 열쇠가 있는 것만 「이어 받는 중」 이라고 적는다", () => {
    queue.resumeTaskQueue();
    const pending = queue.pendingTasksOf("p", "bootstrapPrompt");
    expect(pending.find((item) => item.id === "t-kept")).toMatchObject({
      status: "waiting",
      step: "앱이 닫혀 — 이어 받는 중",
      llmResponseId: "resp_kept",
      llmResumeStep: "prompt",
    });
    expect(pending.find((item) => item.id === "t-fresh")).toMatchObject({
      status: "waiting",
      step: "앱이 닫혀 처음부터 다시 합니다",
    });
    expect(pending.find((item) => item.id === "t-fresh")?.llmResponseId).toBeUndefined();
  });

  it("줄이 진실 — 받을 일이 줄에 없는 «이어 받는 중» 은 끊김으로, 줄에 있는 것은 그대로", () => {
    expect(job("j-orphan")).toMatchObject({ status: "failed" });
    expect(job("j-orphan")?.error).toContain("이어 받을 일이 줄에 없습니다");
    expect(job("j-kept")).toMatchObject({ status: "resuming" });
  });

  it("이어 받기가 시작되면 그 줄을 그대로 살려 쓴다 — 새 줄을 만들지 않고 «이어 받음» 표시를 단다", () => {
    const id = activity.startLlmJob("cutVideoPrompt", "컷 3 · 영상 — 작품", "resp_kept");
    expect(id).toBe("j-kept");
    expect(job("j-kept")).toMatchObject({ status: "running", resumed: true, label: "컷 3 · 영상 — 작품" });
    activity.finishLlmJob(id);
    expect(job("j-kept")).toMatchObject({ status: "done", resumed: true });
  });

  it("살릴 줄이 없으면 새 줄을 만들되 이어 받은 것으로 적는다", () => {
    const id = activity.startLlmJob("cutVideoPrompt", "다른 것", "resp_unknown");
    expect(id).not.toBe("j-kept");
    expect(job(id)).toMatchObject({ status: "running", resumed: true, responseId: "resp_unknown" });
    // 서버에 그 답이 없어 처음부터 다시 보내면 «이어 받음» 표시는 거둔다.
    activity.noteLlmResumeFallback(id);
    expect(job(id)?.resumed).toBe(false);
    expect(job(id)?.responseId).toBeUndefined();
  });
});
