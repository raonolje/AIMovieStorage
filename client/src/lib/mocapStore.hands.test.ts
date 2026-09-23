import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "./motionCapture";
import type { MocapSource } from "./mocapStore";

const port = vi.hoisted(() => ({ capture: vi.fn(), save: vi.fn(), import: vi.fn(), run: vi.fn(), invoke: vi.fn(), mirror: vi.fn(), register: vi.fn(), queue: vi.fn() }));
vi.mock("./handCapture", () => ({ captureVideoHands: port.capture }));
vi.mock("./mediaLibrary", () => ({ assetSrc: (path: string) => path, safeFileName: (name: string) => name, saveProjectMediaAsset: port.save, importProjectMediaAsset: port.import, queueMirrorWriteAndConfirm: port.mirror, registerMirrorSection: port.register, queueMirrorWrite: port.queue }));
vi.mock("./llm", () => ({ isDesktopApp: () => true }));
vi.mock("./motionRepair", () => ({ repairPerson: (person: unknown) => person }));
vi.mock("./localEngines", () => ({ runLocal: port.run, stopLocalWorkers: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: port.invoke }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const original: CaptureResult = { width: 100, height: 100, duration: 1, fps: 30, start: 0, end: 1, engine: "sam3dbody", mirrored: true, persons: [{ number: 1, samples: [] }] };
const updated: CaptureResult = { ...original, persons: [{ number: 1, samples: [{ time: 0, image: [], world: [], hands: { left: { image: [], world: [] } } }] }] };
function source(id = "s"): MocapSource { return {
  id, name: "시험 영상", path: "/fixtures/video.mp4", previewUrl: "/fixtures/video.mp4", blobUrl: null, duration: 1,
  engine: "sam3dbody", fps: 30, mirror: false, clipStart: 0, clipEnd: 1, status: "done", percent: 100, message: "",
  raw: original, repair: "off", smoothing: "normal", result: original, resultPath: "/fixtures/old.json", start: 0, assign: {}, formation: true, analyzedAt: null,
}; }
beforeEach(() => {
  vi.resetModules();
  port.capture.mockReset().mockResolvedValue(updated);
  port.save.mockReset().mockResolvedValue({ path: "/fixtures/new.json" });
  port.import.mockReset().mockResolvedValue({ path: "/fixtures/imported.mp4" });
  port.run.mockReset(); port.invoke.mockReset().mockResolvedValue("/fixtures/output.json");
  port.mirror.mockReset().mockResolvedValue(undefined); port.register.mockReset(); port.queue.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  vi.stubGlobal("document", { querySelector: () => ({}) });
});

describe("손 추가 추적의 작업 줄과 결과 저장", () => {
  it("영상 저장 실패나 미설정은 경로 없는 성공으로 삼키지 않는다", async () => {
    const store = await import("./mocapStore");
    const file = new File(["video"], "sample.mp4");
    port.save.mockRejectedValueOnce(new Error("저장 실패"));
    await expect(store.saveMocapVideo("작품", file)).rejects.toThrow("저장 실패");
    port.save.mockResolvedValueOnce(null);
    await expect(store.saveMocapVideo("작품", file)).rejects.toThrow("저장 폴더");
    port.import.mockRejectedValueOnce(new Error("복사 실패"));
    await expect(store.importMocapVideo("작품", "/original/video.mp4")).rejects.toThrow("복사 실패");
    port.import.mockResolvedValueOnce(null);
    await expect(store.importMocapVideo("작품", "/original/video.mp4")).rejects.toThrow("저장 폴더");
    expect(store.mocapSourcesOf("작품")).toEqual([]);
  });

  it("영상 가져오기는 저장 완료를 기다리고 복사된 경로를 반환한다", async () => {
    const store = await import("./mocapStore");
    const wait = gate<{ path: string }>(); port.save.mockReturnValue(wait.promise);
    let completed = false;
    const saving = store.saveMocapVideo("작품", new File(["v"], "sample.mp4")).then(path => { completed = true; return path; });
    await tick(); expect(completed).toBe(false);
    wait.resolve({ path: "/project/copied.mp4" });
    await expect(saving).resolves.toBe("/project/copied.mp4");
  });
  it("실제 결과 파일 완료를 기다린 뒤 기존 몸 분석과 함께 반영한다", async () => {
    const save = gate<{ path: string }>(); port.save.mockReturnValue(save.promise);
    const store = await import("./mocapStore"); store.addMocapSource("작품", source());
    store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(port.save).toHaveBeenCalledTimes(1));
    expect(store.mocapSourcesOf("작품")[0].raw).toBe(original);
    expect(store.mocapSourcesOf("작품")[0].status).toBe("running");
    expect(port.capture.mock.calls[0][2].mirrored).toBe(true);
    const savedJson = JSON.parse(await (port.save.mock.calls[0][0] as File).text());
    expect(savedJson).toEqual(updated);
    save.resolve({ path: "/fixtures/new.json" });
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("done"));
    expect(store.mocapSourcesOf("작품")[0]).toMatchObject({ raw: updated, resultPath: "/fixtures/new.json" });
  });

  it("같은 영상은 두 번 돌리지 않고 다음 영상은 이전 작업 뒤에 실행한다", async () => {
    const capture = gate<CaptureResult>(); port.capture.mockReturnValueOnce(capture.promise);
    const store = await import("./mocapStore"); store.addMocapSource("작품", source()); store.addMocapSource("작품", source("second"));
    store.enqueueMocap("작품", "s", "hands"); store.enqueueMocap("작품", "s", "hands"); store.enqueueMocap("작품", "second", "hands");
    await tick();
    expect(port.capture).toHaveBeenCalledTimes(1);
    expect(store.mocapSourcesOf("작품")[1].status).toBe("queued");
    capture.resolve(updated);
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품").every(value => value.status === "done")).toBe(true));
    expect(port.capture).toHaveBeenCalledTimes(2);
  });

  it("새 결과 파일 저장에 실패하면 이전 분석을 지키고 실패로 남긴다", async () => {
    port.save.mockRejectedValue(new Error("쓰기 실패"));
    const store = await import("./mocapStore"); store.addMocapSource("작품", source()); store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("error"));
    expect(store.mocapSourcesOf("작품")[0]).toMatchObject({ raw: original, resultPath: "/fixtures/old.json" });
  });

  it("목록 파일의 저장 완료까지 running이며 실패하면 이전 결과로 남긴다", async () => {
    let reject!: (error: Error) => void;
    port.mirror.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const store = await import("./mocapStore"); store.addMocapSource("작품", source()); store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(port.mirror).toHaveBeenCalledTimes(1));
    expect(store.mocapSourcesOf("작품")[0].status).toBe("running");
    reject(new Error("앱 데이터 파일 쓰기 실패"));
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("error"));
    expect(store.mocapSourcesOf("작품")[0]).toMatchObject({ raw: original, resultPath: "/fixtures/old.json" });
  });

  it("localStorage가 꽉 차도 새 origin에서 앱 데이터 파일의 새 결과 경로를 복원한다", async () => {
    let file: unknown;
    port.mirror.mockImplementation(async (_section, value) => { file = JSON.parse(JSON.stringify(value)); });
    const store = await import("./mocapStore"); store.addMocapSource("작품", source());
    window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("done"));
    vi.resetModules();
    port.register.mockImplementation((_section, spec) => spec.write(file));
    // 새 origin은 브라우저 저장소가 비어 있습니다. 읽어 온 거울 값은 메모리에서도 사용할 수 있어야 합니다.
    window.localStorage.getItem = () => null;
    const restarted = await import("./mocapStore");
    expect(restarted.mocapSourcesOf("작품")[0]).toMatchObject({ resultPath: "/fixtures/new.json", path: "/fixtures/video.mp4", raw: null });
  });

  it("한 작품을 고쳐도 아직 열지 않은 다른 작품의 모캡 목록은 남는다", async () => {
    const { raw: _raw, result: _result, blobUrl: _blob, ...saved } = source("unopened");
    window.localStorage.setItem("ai-video-storage.mocap.v1", JSON.stringify({ "다른 작품": [saved] }));
    const store = await import("./mocapStore"); store.addMocapSource("작품", source());
    const lastSaved = port.queue.mock.calls.at(-1)![1];
    expect(lastSaved["다른 작품"][0].id).toBe("unopened");
    expect(store.mocapSourcesOf("다른 작품")[0].id).toBe("unopened");
  });

  it("아직 열지 않은 작품에 영상을 바로 추가해도 기존 영상을 삭제표로 바꾸지 않는다", async () => {
    const { raw: _raw, result: _result, blobUrl: _blob, ...saved } = source("existing");
    window.localStorage.setItem("ai-video-storage.mocap.v1", JSON.stringify({ "작품": [saved] }));
    const store = await import("./mocapStore"); store.addMocapSource("작품", source("new"));
    expect(store.mocapSourcesOf("작품").map(item => item.id)).toEqual(["existing", "new"]);
    expect(port.queue.mock.calls.at(-1)![1]["작품"].some((item: { deleted?: boolean }) => item.deleted)).toBe(false);
  });

  it("다른 origin의 옛 목록과 합쳐도 삭제한 영상이 되살아나지 않는다", async () => {
    const store = await import("./mocapStore"); store.addMocapSource("작품", source());
    const old = JSON.parse(JSON.stringify(port.queue.mock.calls.at(-1)![1]));
    store.removeMocapSource("작품", "s");
    const removed = port.queue.mock.calls.at(-1)![1];
    const spec = port.register.mock.calls[0][1];
    spec.write(spec.merge(old, removed));
    expect(store.mocapSourcesOf("작품")).toEqual([]);
    expect(spec.merge(old, removed)["작품"][0].deleted).toBe(true);
  });

  it("취소를 늦게 받은 검출기가 결과를 돌려줘도 파일을 쓰거나 반영하지 않는다", async () => {
    const capture = gate<CaptureResult>(); port.capture.mockReturnValue(capture.promise);
    const store = await import("./mocapStore"); store.addMocapSource("작품", source()); store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(port.capture).toHaveBeenCalledTimes(1));
    store.cancelMocap("작품", "s"); capture.resolve(updated); await tick();
    expect(port.save).not.toHaveBeenCalled();
    expect(store.mocapSourcesOf("작품")[0]).toMatchObject({ status: "idle", raw: original, resultPath: "/fixtures/old.json" });
  });

  it("외부 완료 대기는 UI 큐를 함께 쓰며 차례가 오기 전 취소도 즉시 거절됩니다", async () => {
    const capture = gate<CaptureResult>(); port.capture.mockReturnValueOnce(capture.promise);
    const store = await import("./mocapStore");
    store.addMocapSource("작품", source()); store.addMocapSource("작품", source("waiting"));
    store.enqueueMocap("작품", "s", "hands");
    const abort = new AbortController();
    const waiting = store.enqueueMocapAndWait("작품", "waiting", "hands", { operationId: "queued-hand", signal: abort.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await rejected;
    expect(store.mocapSourcesOf("작품")[1].status).toBe("idle");
    capture.resolve(updated);
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("done"));
    expect(port.capture).toHaveBeenCalledTimes(1);
  });

  it("나중에 UI에서 재분석하면 앞선 외부 요청의 완료 표를 새 결과에 잘못 붙이지 않습니다", async () => {
    const store = await import("./mocapStore"); store.addMocapSource("작품", source());
    await store.enqueueMocapAndWait("작품", "s", "hands", { operationId: "external" });
    expect(store.mocapSourcesOf("작품")[0].completedOperation).toEqual({ id: "external", kind: "hands" });
    store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("done"));
    expect(store.mocapSourcesOf("작품")[0].completedOperation).toBeUndefined();
  });

  it("설치본에서 원본이 임시 blob뿐이면 복원 가능한 저장인 척하지 않는다", async () => {
    const store = await import("./mocapStore");
    store.addMocapSource("작품", { ...source(), path: null, blobUrl: "blob:temporary" });
    store.enqueueMocap("작품", "s", "hands");
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("error"));
    expect(port.capture).not.toHaveBeenCalled();
    expect(store.mocapSourcesOf("작품")[0].message).toContain("원본 영상을 먼저 파일로 저장");
  });

  it("내장 몸 분석의 영상 열기 중 취소도 작업 대기를 끝내고 영상 자원을 정리합니다", async () => {
    const abort = new AbortController();
    const video = new EventTarget();
    const load = vi.fn(), remove = vi.fn();
    Object.assign(video, { load, removeAttribute: remove });
    Object.defineProperty(video, "src", { set: () => abort.abort() });
    vi.stubGlobal("document", { querySelector: () => ({}), createElement: () => video });
    const store = await import("./mocapStore");
    store.addMocapSource("작품", { ...source(), engine: "mediapipe", blobUrl: "blob:existing" });
    await expect(store.enqueueMocapAndWait("작품", "s", "body", { operationId: "body-cancel", signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(store.mocapSourcesOf("작품")[0].status).toBe("idle");
    expect(remove).toHaveBeenCalledWith("src"); expect(load).toHaveBeenCalledTimes(1);
    expect(port.save).not.toHaveBeenCalled(); expect(port.run).not.toHaveBeenCalled();
  });

  it.each([undefined, false])("SAM 손 옵션 %s를 실제 워커 요청에 전달한다", async hands => {
    port.run.mockRejectedValue(new Error("가짜 워커 종료"));
    const store = await import("./mocapStore"); store.addMocapSource("작품", { ...source(), hands }); store.enqueueMocap("작품", "s");
    await vi.waitFor(() => expect(store.mocapSourcesOf("작품")[0].status).toBe("error"));
    expect(port.run.mock.calls[0][2].hands).toBe(hands !== false);
  });
});
