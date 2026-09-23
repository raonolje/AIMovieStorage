import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "./motionCapture";
import type { MocapSource } from "./mocapStore";
import type { TaskJournalSnapshot } from "./taskQueue";

const port = vi.hoisted(() => ({ run: vi.fn(), capture: vi.fn(), save: vi.fn(), mirror: vi.fn(), invoke: vi.fn(),
  assets: [] as { id: string; name: string; path: string; kind: string }[], files: new Map<string, string>(), exists: true }));
vi.mock("./mediaLibrary", () => ({ assetSrc: (path: string) => path, safeFileName: (name: string) => name,
  saveProjectMediaAsset: port.save, importProjectMediaAsset: vi.fn(), queueMirrorWriteAndConfirm: port.mirror,
  registerMirrorSection: vi.fn(), queueMirrorWrite: vi.fn(), whenAppSettingsReady: async () => {} }));
vi.mock("./projectWrite", () => ({ readProject: (id: string) => id === "p" && port.exists ? { title: "작품" } : null }));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "저장된 작품 폴더" }));
vi.mock("./controlMedia", () => ({ listControlAssets: () => port.assets }));
vi.mock("./localEngines", () => ({ LOCAL_ENGINE_IDS: ["sam3dbody"], LOCAL_ENGINE_CATALOG: { sam3dbody: { name: "SAM", kind: "mocap" } }, runLocal: port.run, stopLocalWorkers: vi.fn() }));
vi.mock("./llm", () => ({ isDesktopApp: () => true }));
vi.mock("./handCapture", () => ({ captureVideoHands: port.capture }));
vi.mock("./motionCapture", () => ({ assembleCapture: (raw: CaptureResult) => raw }));
vi.mock("./motionRepair", () => ({ repairPerson: (person: unknown) => person }));
vi.mock("./llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: port.invoke }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const raw: CaptureResult = { width: 100, height: 100, duration: 1, fps: 30, start: 0, end: 1, engine: "sam3dbody",
  persons: [{ number: 1, samples: Array.from({ length: 35 }, (_, time) => ({ time: time / 30, image: [], world: [] })) }] };
const withHands: CaptureResult = { ...raw, persons: [{ ...raw.persons[0], samples: raw.persons[0].samples.map(sample => ({ ...sample, hands: { left: { image: [], world: [] } } })) }] };
const request = { projectId: "p", assetId: "video", operationId: "capture-1", options: { engine: "sam3dbody", fps: 30, clipStart: 0, clipEnd: 1, hands: true } };
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function prepare() {
  const control = await import("./controlMocap");
  const q = await import("./taskQueue");
  const store = await import("./mocapStore");
  const record = { journal: null as TaskJournalSnapshot | null };
  await q.registerTaskJournal({ read: async () => null, write: async value => { record.journal = JSON.parse(JSON.stringify(value)); } });
  return { control, q, store, record };
}
async function finish(q: Awaited<ReturnType<typeof prepare>>["q"], id: string) {
  await vi.waitFor(() => expect(["done", "failed", "stopped"]).toContain(q.getTask(id)?.status));
  await q.flushTaskJournal();
  return q.getTask(id)!;
}
beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  vi.stubGlobal("localStorage", storage); vi.stubGlobal("window", { localStorage: storage, __TAURI_INTERNALS__: {} });
  vi.stubGlobal("document", { querySelector: () => ({}) });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => ({ text: async () => { const text = port.files.get(path); if (!text) throw new Error("없는 파일"); return text; } })));
  port.exists = true; port.files.clear(); port.assets = [{ id: "video", name: "몸 영상", path: "D:/작품/원본.mp4", kind: "video" }];
  port.run.mockReset().mockResolvedValue({ output: "D:/tmp/capture.json" });
  port.capture.mockReset().mockResolvedValue(withHands);
  port.invoke.mockReset().mockImplementation(async (name: string) => name === "read_motion_capture" ? JSON.stringify(raw) : "D:/tmp/capture.json");
  port.save.mockReset().mockImplementation(async (file: File) => { const path = `D:/작품/result-${port.files.size}.json`; port.files.set(path, await file.text()); return { path }; });
  port.mirror.mockReset().mockResolvedValue(undefined);
});

describe("외부 모션 캡처 조종", () => {
  it("손을 새로 적용하지 못한 작업은 기존 손 수와 구분해 unchanged 및 진단을 저장한다", async () => {
    const { control, q, store } = await prepare();
    const body = await control.enqueueControlMocap(request); await finish(q, body.jobId);
    const sourceId = store.mocapSourcesOf("저장된 작품 폴더")[0].id;
    port.capture.mockResolvedValue({ ...withHands, handTracking: { method: "whole-frame+body-roi", frames: 35, detectorCalls: 105,
      roiCount: 70, detectedHands: 0, validHands: 0, appliedHands: 0, roiAppliedHands: 0, unchangedFrames: 35 } });
    const hands = await control.enqueueControlMocapHands({ projectId: "p", sourceId, operationId: "hands-no-change" });
    const done = await finish(q, hands.jobId);
    expect(done.status).toBe("done");
    expect(done.result?.data).toMatchObject({ handSampleCount: 35, handsOutcome: "unchanged",
      handTracking: { appliedHands: 0, unchangedFrames: 35 }, message: "추가로 적용한 손이 없습니다. 기존 손 데이터를 유지했습니다." });
    const source = store.mocapSourcesOf("저장된 작품 폴더")[0];
    expect(source.message).toContain("기존 손 데이터를 유지");
    const summary = await control.getControlMocapResult({ projectId: "p", sourceId });
    expect(summary.capture.handTracking).toMatchObject({ appliedHands: 0, roiCount: 70 });
  });

  it("등록 영상의 몸 분석을 UI와 같은 큐에 넣고 JSON·목록 저장 뒤 완료하며 재전송은 같은 작업입니다", async () => {
    const { control, q, store } = await prepare();
    const accepted = await control.enqueueControlMocap(request);
    const done = await finish(q, accepted.jobId);
    expect(done.status).toBe("done");
    expect(port.run).toHaveBeenCalledTimes(1);
    expect(port.run.mock.calls[0][2]).toMatchObject({ video: "D:/작품/원본.mp4", fps: 30, start: 0, end: 1, hands: true });
    expect(done.result).toMatchObject({ paths: ["D:/작품/result-0.json"], data: { persisted: true, personCount: 1, sampleCount: 35 } });
    const source = store.mocapSourcesOf("저장된 작품 폴더")[0];
    expect(source.completedOperation).toEqual({ id: "capture-1", kind: "body" });
    expect(port.mirror).toHaveBeenCalled();
    expect(await control.enqueueControlMocap(request)).toEqual({ jobId: accepted.jobId, reused: true });
    expect(port.run).toHaveBeenCalledTimes(1);
    expect(store.mocapSourcesOf("저장된 작품 폴더")).toHaveLength(1);
    await expect(control.enqueueControlMocap({ ...request, options: { ...request.options, fps: 15 } })).rejects.toThrow("다른 내용");
  });

  it("임의 경로·다른 프로젝트·등록되지 않은 원본·잘못된 구간·없는 엔진은 GPU 실행 전에 거절합니다", async () => {
    const { control, q } = await prepare();
    for (const input of [
      { ...request, path: "D:/외부/영상.mp4" }, { ...request, projectId: "other" },
      { ...request, assetId: "missing" }, { projectId: "p", sourceId: "other", operationId: "x", options: request.options },
      { ...request, options: { ...request.options, clipEnd: 0.2, clipStart: 1 } },
      { ...request, options: { ...request.options, engine: "missing" } },
      { ...request, sourceId: "extra" },
    ]) await expect(control.enqueueControlMocap(input)).rejects.toThrow();
    port.assets[0].path = "https://example.invalid/video.mp4";
    await expect(control.enqueueControlMocap(request)).rejects.toThrow("로컬 원본");
    expect(port.run).not.toHaveBeenCalled(); expect(q.listTasks()).toEqual([]);
  });

  it("실행을 기다리는 동안 원본 등록이 사라지면 재검증에서 실패합니다", async () => {
    const { control, q } = await prepare();
    const wait = gate<void>();
    q.registerTaskRunner("block", async () => wait.promise);
    await q.enqueueTaskOperation({ lane: "media", kind: "block", projectId: "p", projectTitle: "작품", label: "대기", operationId: "block", payload: {} });
    const accepted = await control.enqueueControlMocap(request);
    port.assets = []; wait.resolve();
    expect((await finish(q, accepted.jobId)).status).toBe("failed");
    expect(port.run).not.toHaveBeenCalled();
  });

  it("목록 파일 저장을 기다리는 동안 완료하지 않고 실패하면 결과를 붙이지 않습니다", async () => {
    const { control, q, store } = await prepare();
    const saving = gate<void>(); port.mirror.mockResolvedValueOnce(undefined).mockReturnValueOnce(saving.promise);
    const accepted = await control.enqueueControlMocap(request);
    await vi.waitFor(() => expect(port.mirror).toHaveBeenCalledTimes(2));
    expect(q.getTask(accepted.jobId)?.status).toBe("running");
    saving.resolve(); expect((await finish(q, accepted.jobId)).status).toBe("done");
    const source = store.mocapSourcesOf("저장된 작품 폴더")[0];
    port.mirror.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("목록 저장 실패"));
    const failed = await control.enqueueControlMocap({ projectId: "p", sourceId: source.id, operationId: "fail", options: request.options });
    expect((await finish(q, failed.jobId)).status).toBe("failed");
    expect(store.mocapSourcesOf("저장된 작품 폴더")[0].resultPath).toBe(source.resultPath);
  });

  it("손 추적은 같은 몸 표본과 저장 경로 계약을 쓰고 결과는 사람별로 나눠 읽습니다", async () => {
    const { control, q, store } = await prepare();
    const body = await control.enqueueControlMocap(request); await finish(q, body.jobId);
    const sourceId = store.mocapSourcesOf("저장된 작품 폴더")[0].id;
    const hands = await control.enqueueControlMocapHands({ projectId: "p", sourceId, operationId: "hands" });
    expect((await finish(q, hands.jobId)).result?.data).toMatchObject({ sourceId, handSampleCount: 35 });
    expect(port.run).toHaveBeenCalledTimes(1); expect(port.capture).toHaveBeenCalledTimes(1);
    const summary = await control.getControlMocapResult({ projectId: "p", sourceId });
    expect(summary).not.toHaveProperty("samples"); expect(summary.persons[0]).toMatchObject({ sampleCount: 35, handSamples: 35 });
    const page = await control.getControlMocapResult({ projectId: "p", sourceId, personNumber: 1 });
    expect(page.samples).toHaveLength(30); expect(page.nextOffset).toBe(30);
    expect((await control.getControlMocapResult({ projectId: "p", sourceId, personNumber: 1, offset: 30 })).samples).toHaveLength(5);
  });

  it("job_cancel은 실제 손 검출에 abort를 전달하고 UI 취소도 stopped로 기록합니다", async () => {
    const { control, q, store } = await prepare();
    const body = await control.enqueueControlMocap(request); await finish(q, body.jobId);
    const source = store.mocapSourcesOf("저장된 작품 폴더")[0];
    port.capture.mockImplementation((_url, _raw, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("취소", "AbortError")))));
    const hands = await control.enqueueControlMocapHands({ projectId: "p", sourceId: source.id, operationId: "cancel-hands" });
    await vi.waitFor(() => expect(port.capture).toHaveBeenCalledTimes(1));
    q.stopTask(hands.jobId); expect((await finish(q, hands.jobId)).status).toBe("stopped");
    expect(store.mocapSourcesOf("저장된 작품 폴더")[0].resultPath).toBe(source.resultPath);
    const again = await control.enqueueControlMocapHands({ projectId: "p", sourceId: source.id, operationId: "ui-cancel" });
    await vi.waitFor(() => expect(port.capture).toHaveBeenCalledTimes(2));
    store.cancelMocap("저장된 작품 폴더", source.id);
    expect((await finish(q, again.jobId)).status).toBe("stopped");
  });

  it("결과·목록 저장 후 완료 기록 전 재시작하여 다시 실행해도 같은 분석을 복제하지 않습니다", async () => {
    const { control, q, record } = await prepare();
    const accepted = await control.enqueueControlMocap(request); await finish(q, accepted.jobId);
    const journal = record.journal!;
    for (const task of [...journal.tasks, ...journal.operations]) if (task.id === accepted.jobId) {
      task.status = "running"; delete task.result; delete task.finishedAt;
    }
    vi.resetModules(); port.run.mockClear();
    await import("./controlMocap");
    const restarted = await import("./taskQueue");
    await restarted.registerTaskJournal({ read: async () => journal, write: async () => {} });
    // 외부 작업의 앱 종료 복원은 자동 재실행하지 않는 기존 정책을 지킵니다.
    expect(restarted.getTask(accepted.jobId)?.status).toBe("failed");
    restarted.retryTask(accepted.jobId);
    const done = await finish(restarted, accepted.jobId);
    expect(done.status, done.error).toBe("done"); expect(done.result?.paths).toEqual(["D:/작품/result-0.json"]);
    expect(port.run).not.toHaveBeenCalled();
  });
});
