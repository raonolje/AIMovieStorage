import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MocapSource } from "./mocapStore";
import { newProjectDraft, newScene, newCut } from "./projectTypes";
import { normalizeComposition, type CompositionState } from "./composition";
import { addMannequinIn } from "./compositionEdit";
import type { CaptureResult } from "./motionCapture";
import { createRetargetRig, retargetPerson } from "./motionRetarget";
import * as shared from "./capturedMotionApply";
import { applyCompositionMocap } from "./compositionMocapControl";
import { getCompositionSession, getCompositionChanges, listCompositionSessions, observeCompositionSession,
  registerCompositionSession, undoComposition, redoComposition, type CompositionSessionPort } from "./compositionControl";

const external = vi.hoisted(() => ({ sources: [] as MocapSource[], load: vi.fn(), exists: true }));
vi.mock("./mocapStore", () => ({
  mocapSourcesOf: (folder: string) => folder === "작품 폴더" ? external.sources : [],
  loadMocapResult: external.load,
}));
vi.mock("./mediaLibrary", () => ({ whenAppSettingsReady: async () => {} }));
vi.mock("./localProjectStore", () => ({ projectFolderName: (id: string) => id === "p" ? "작품 폴더" : "다른 폴더" }));
vi.mock("./projectWrite", () => ({ readProject: (id: string) => external.exists && ["p", "other"].includes(id)
  ? { ...newProjectDraft(), title: "작품", scenes: [{ ...newScene(), cuts: [{ ...newCut(1), id: "cut" }] }] } : null }));

let template: THREE.Group;
const cleanups: (() => void)[] = [];
beforeAll(async () => {
  const data = readFileSync(new URL("../../public/models/male.glb", import.meta.url));
  template = (await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "")).scene;
});

function capture(): CaptureResult {
  const coords: Record<number, number[]> = {
    0: [0, -1.68, -0.12], 2: [0.04, -1.72, -0.09], 5: [-0.04, -1.72, -0.09],
    7: [0.08, -1.68, 0], 8: [-0.08, -1.68, 0], 11: [0.2, -1.4, 0], 12: [-0.2, -1.4, 0],
    13: [0.35, -1.05, -0.05], 14: [-0.35, -1.05, -0.05], 15: [0.4, -0.75, -0.1], 16: [-0.4, -0.75, -0.1],
    23: [0.12, -0.9, 0], 24: [-0.12, -0.9, 0], 25: [0.12, -0.5, -0.03], 26: [-0.12, -0.5, -0.03],
    27: [0.12, -0.08, 0], 28: [-0.12, -0.08, 0], 29: [0.12, -0.04, 0.04], 30: [-0.12, -0.04, 0.04],
    31: [0.12, -0.04, -0.12], 32: [-0.12, -0.04, -0.12],
  };
  return { width: 640, height: 480, fps: 2, start: 1, end: 3, duration: 4, engine: "sam3dbody", mirrored: true,
    persons: [{ number: 2, samples: [1, 1.5, 2, 2.5, 3].map(time => {
      const world = Array.from({ length: 33 }, (_, i) => {
        const [x, y, z] = coords[i] ?? [0.01 * (i % 3), -1.6, -0.04]; return { x, y, z, v: 1 };
      });
      return { time, world, image: world.map(p => ({ ...p, x: 0.5 + p.x * 0.3, y: 0.9 + p.y * 0.4 })),
        root: { x: time / 10, y: 0, z: 0 } };
    }) }] };
}

beforeEach(() => {
  external.exists = true;
  const result = capture();
  external.sources = [{ id: "source", name: "춤", path: "D:/작품/춤.mp4", resultPath: "D:/작품/춤.json",
    raw: result, result, start: 4, status: "done", smoothing: "normal", footPlant: false,
    formation: true, mirror: false } as MocapSource];
  external.load.mockReset().mockImplementation(async () => external.sources[0]?.raw ?? null);
  vi.spyOn(shared, "loadCaptureRetargetRig").mockImplementation(async () => createRetargetRig(template));
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });

function fixture() {
  let state = addMannequinIn(normalizeComposition(), "male", "target");
  const past: CompositionState[] = [], future: CompositionState[] = [];
  const identity = { projectName: "작품 폴더", cutId: "cut" };
  const port: CompositionSessionPort = {
    read: () => ({ state, canUndo: past.length > 0, canRedo: future.length > 0, context: { characterIds: [] } }),
    apply: update => { const next = update(state); past.push(state); state = next; future.length = 0; },
    undo: () => { future.push(state); state = past.pop()!; }, redo: () => { past.push(state); state = future.pop()!; },
    capture: vi.fn(async () => ({ guide: "", plate: "" })), commit: vi.fn(async () => ({})),
  };
  const close = registerCompositionSession(identity, port); cleanups.push(close);
  return { state: () => state, initial: state, past, port, close,
    sessionId: listCompositionSessions().at(-1)!.sessionId,
    manual: () => { port.apply(current => ({ ...current, camera: { ...current.camera, fovDegrees: 55 } })); observeCompositionSession(identity); },
  };
}
function request(sessionId: string) {
  return { projectId: "p", sessionId, expectedRevision: 0, sourceId: "source", personNumber: 2, characterId: "target" };
}
const withoutIds = (state: CompositionState) => state.motionTracks?.map(track => ({ ...track, id: undefined,
  keys: track.keys.map(key => ({ ...key, id: undefined })) }));

describe("구도에 저장된 모캡 적용", () => {
  it("실제 GLB 리타깃·UI 공통 적용과 같은 세 채널을 만들고 한 번에 undo/redo한다", async () => {
    const f = fixture();
    const response = await applyCompositionMocap(request(f.sessionId));
    const source = external.sources[0], result = source.result!;
    const frames = retargetPerson(createRetargetRig(template), result.persons[0], result, { smoothing: source.smoothing, footPlant: false });
    const ui = shared.applyRetargetedCaptureIn(f.initial, [{ characterId: "target", frames }], {
      timelineStart: 4, captureStart: 1, formation: true, channels: { position: true, rotation: true, pose: true }, source,
    });
    expect(withoutIds(f.state())).toEqual(withoutIds(ui));
    expect(f.state().motionTracks).toHaveLength(3);
    expect(f.state().motionTracks?.every(track => track.sourceId === "source" && track.keys.length === 5)).toBe(true);
    expect(response).toMatchObject({ revision: 1, applied: true, result: { sampleCount: 5, firstKeySeconds: 4, lastKeySeconds: 6, mirroredDuringAnalysis: true, persisted: false } });
    expect(response).not.toHaveProperty("state");
    expect(f.past).toHaveLength(1);
    expect(getCompositionChanges({ sessionId: f.sessionId, sinceRevision: 0 }).changes[0].source).toBe("controller");
    expect(f.port.commit).not.toHaveBeenCalled(); expect(f.port.capture).not.toHaveBeenCalled();
    await undoComposition({ sessionId: f.sessionId, expectedRevision: 1 }); expect(f.state()).toBe(f.initial);
    await redoComposition({ sessionId: f.sessionId, expectedRevision: 2 }); expect(f.state().motionTracks).toHaveLength(3);
  });

  it("원본 구간과 타임라인 시작을 명시하고 선택한 관절 채널만 적용한다", async () => {
    const f = fixture();
    const response = await applyCompositionMocap({ ...request(f.sessionId), sourceStartSeconds: 1.5,
      durationSeconds: 1, timelineStartSeconds: 10, channels: { position: false, rotation: false, pose: true } });
    expect(response.result).toMatchObject({ sampleCount: 3, firstKeySeconds: 10, lastKeySeconds: 11 });
    expect(f.state().motionTracks?.map(track => track.channel)).toEqual(["pose"]);
    expect(f.state().motionTracks?.[0].keys.map(key => key.time)).toEqual([10, 10.5, 11]);
  });

  it("경로·다른 프로젝트·없는 원본·없는 인물·잘못된 구간은 적용 전에 거절한다", async () => {
    const f = fixture(), base = request(f.sessionId);
    for (const extra of [{ path: "D:/secret.json" }, { projectId: "other" }, { sourceId: "other" },
      { personNumber: 9 }, { characterId: "missing" }, { sourceStartSeconds: 0 }, { durationSeconds: 9 },
      { channels: { position: false, rotation: false, pose: false } }])
      await expect(applyCompositionMocap({ ...base, ...extra })).rejects.toThrow();
    external.sources[0].resultPath = "https://example.invalid/capture.json";
    await expect(applyCompositionMocap(base)).rejects.toMatchObject({ code: "capture_not_saved" });
    expect(f.state()).toBe(f.initial); expect(f.past).toHaveLength(0);
    expect(shared.loadCaptureRetargetRig).not.toHaveBeenCalled();
  });

  it("오래된 revision은 결과 파일을 읽기 전 거절한다", async () => {
    const f = fixture(); f.manual();
    await expect(applyCompositionMocap(request(f.sessionId))).rejects.toMatchObject({ code: "revision_conflict" });
    expect(external.load).not.toHaveBeenCalled();
  });

  it("리그 준비 중 수동 변경은 보존하고 모캡만 취소한다", async () => {
    const f = fixture(); let finish!: (rig: ReturnType<typeof createRetargetRig>) => void;
    vi.mocked(shared.loadCaptureRetargetRig).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = applyCompositionMocap(request(f.sessionId));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.manual(); finish(createRetargetRig(template));
    await expect(pending).rejects.toMatchObject({ code: "revision_conflict" });
    expect(f.state().camera.fovDegrees).toBe(55); expect(f.state().motionTracks).toEqual([]); expect(f.past).toHaveLength(1);
    expect(getCompositionSession(f.sessionId).busy).toBe(false);
  });

  it("준비 중 모캡 결과가 교체되면 history에 넣지 않는다", async () => {
    const f = fixture(); let finish!: (rig: ReturnType<typeof createRetargetRig>) => void;
    vi.mocked(shared.loadCaptureRetargetRig).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = applyCompositionMocap(request(f.sessionId));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    external.sources[0] = { ...external.sources[0], result: capture() };
    finish(createRetargetRig(template));
    await expect(pending).rejects.toMatchObject({ code: "source_changed" });
    expect(f.past).toHaveLength(0);
    f.close(); await expect(applyCompositionMocap(request(f.sessionId))).rejects.toMatchObject({ code: "session_closed" });
  });

  it("리그 준비 중 편집창이 닫히면 계산 결과를 적용하지 않는다", async () => {
    const f = fixture(); let finish!: (rig: ReturnType<typeof createRetargetRig>) => void;
    vi.mocked(shared.loadCaptureRetargetRig).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = applyCompositionMocap(request(f.sessionId));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.close(); finish(createRetargetRig(template));
    await expect(pending).rejects.toMatchObject({ code: "session_closed" });
    expect(f.state()).toBe(f.initial); expect(f.past).toHaveLength(0);
  });

  it("깨진 관절 좌표는 리타깃 전에 거절한다", async () => {
    const f = fixture(); external.sources[0].result!.persons[0].samples[0].world[0].x = NaN;
    await expect(applyCompositionMocap(request(f.sessionId))).rejects.toMatchObject({ code: "invalid_capture" });
    expect(shared.loadCaptureRetargetRig).not.toHaveBeenCalled(); expect(f.past).toHaveLength(0);
  });
});
