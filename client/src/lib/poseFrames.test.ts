import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/mediaLibrary", () => ({ safeFileName: (name: string) => name, saveProjectMediaAsset: vi.fn() }));
import { saveProjectMediaAsset } from "@/lib/mediaLibrary";
import { assembleCapture, type CaptureResult } from "./motionCapture";
import { bakePoseFrames, captureToBody18, drawPoseFrame, type PoseLandmark } from "./poseFrames";

function landmarks(): PoseLandmark[] {
  return Array.from({ length: 33 }, (_, index) => ({ x: index / 40, y: (index + 1) / 40, v: 1 }));
}

function recordingContext() {
  const ellipses: { args: number[]; color: string }[] = [];
  const dots: { args: number[]; color: string }[] = [];
  const ctx = {
    fillStyle: "", fillRect: vi.fn(), beginPath: vi.fn(), fill: vi.fn(),
    ellipse(...args: number[]) { ellipses.push({ args, color: this.fillStyle }); },
    arc(...args: number[]) { dots.push({ args, color: this.fillStyle }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ellipses, dots };
}

describe("저장된 33점 → DWPose 몸 18점", () => {
  it("좌우 관절과 눈·귀를 몸 18점의 의미 순서로 옮긴다", () => {
    const input = landmarks();
    const body = captureToBody18(input);
    const original = [0, null, 12, 14, 16, 11, 13, 15, 24, 26, 28, 23, 25, 27, 5, 2, 8, 7];
    expect(body).toHaveLength(18);
    original.forEach((source, index) => {
      if (source !== null) expect(body[index]).toEqual({ x: input[source].x, y: input[source].y, confidence: 1 });
    });
    expect(body[1]).toEqual({ x: (input[11].x + input[12].x) / 2, y: (input[11].y + input[12].y) / 2, confidence: 1 });
    expect(input).toEqual(landmarks());
  });

  it("한 어깨가 가려지면 목을 추측하지 않고 해당 연결도 없앤다", () => {
    const input = landmarks();
    input[11].v = 0.3;
    input[11].visibility = 1;
    const body = captureToBody18(input);
    expect(body[1]).toBeNull();
    expect(body[5]).toBeNull();
    expect(body[2]).not.toBeNull();
    const { ctx, dots, ellipses } = recordingContext();
    drawPoseFrame(ctx, { width: 400, height: 400 }, input);
    expect(dots).toHaveLength(16);
    expect(ellipses).toHaveLength(11);
  });

  it("없는 점·비정상 좌표·비정상 신뢰도는 그리지 않는다", () => {
    const input: Array<PoseLandmark | null | undefined> = landmarks();
    input[0] = undefined;
    input[5] = { x: NaN, y: 0.5, v: 1 };
    input[8] = { x: 0.5, y: Infinity, v: 1 };
    input[2] = { x: 0.5, y: 0.5, v: NaN };
    input[7] = null;
    const body = captureToBody18(input);
    [0, 14, 15, 16, 17].forEach((index) => expect(body[index]).toBeNull());
    expect(() => drawPoseFrame(recordingContext().ctx, { width: 512, height: 512 }, [])).not.toThrow();
  });

  it("이전 visibility 입력도 읽되 저장 형식 v가 있으면 우선한다", () => {
    const input = landmarks();
    input[0] = { x: 0.5, y: 0.5, visibility: 0.2 };
    expect(captureToBody18(input)[0]).toBeNull();
    input[0] = { x: 0.5, y: 0.5, v: 0.9, visibility: 0.2 };
    expect(captureToBody18(input)[0]?.confidence).toBe(0.9);
  });

  it("17개 몸 연결과 18개 관절에 공식 RGB 순서를 쓰고 여분 손발 점은 추가하지 않는다", () => {
    const { ctx, ellipses, dots } = recordingContext();
    drawPoseFrame(ctx, { width: 400, height: 400 }, landmarks());
    expect(ellipses).toHaveLength(17);
    expect(dots).toHaveLength(18);
    expect(dots.map((dot) => dot.color)).toEqual([
      "#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#aaff00", "#55ff00",
      "#00ff00", "#00ff55", "#00ffaa", "#00ffff", "#00aaff", "#0055ff",
      "#0000ff", "#5500ff", "#aa00ff", "#ff00ff", "#ff00aa", "#ff0055",
    ]);
    // 첫 선은 목–오른 어깨. 다음은 목–왼 어깨이며 원본처럼 선의 밝기는 60%입니다.
    expect(ellipses[0].color).toBe("#990000");
    expect(ellipses[1].color).toBe("#993300");
    expect(ellipses[0].args.slice(0, 2)).toEqual([117.5, 127.5]);
    expect(ellipses[1].args.slice(0, 2)).toEqual([112.5, 122.5]);
    expect(dots[1].args[0]).toBeCloseTo(115);
    expect(dots[1].args.slice(1, 3)).toEqual([125, 4]);
  });

  it("거울 출력은 좌표만 뒤집고 신체 부위의 색은 보존한다", () => {
    const normal = recordingContext(), mirrored = recordingContext();
    drawPoseFrame(normal.ctx, { width: 400, height: 300 }, landmarks());
    drawPoseFrame(mirrored.ctx, { width: 400, height: 300 }, landmarks(), true);
    normal.dots.forEach((dot, index) => {
      expect(mirrored.dots[index].args[0]).toBeCloseTo(400 - dot.args[0]);
      expect(mirrored.dots[index].args[1]).toBe(dot.args[1]);
      expect(mirrored.dots[index].color).toBe(dot.color);
    });
  });
});

function capture(): CaptureResult {
  return { width: 400, height: 300, duration: 20, fps: 30, start: 0, end: 20,
    engine: "sam3dbody", mirrored: false, persons: [{ number: 1,
      samples: Array.from({ length: 600 }, (_, index) => ({
        time: index / 30,
        image: landmarks().map(point => ({ ...point, x: index / 3000, z: 0, v: 1 })),
        world: [],
      })),
    }] };
}

describe("포즈 굽기의 원본 시간과 반전", () => {
  let canvas: ReturnType<typeof recordingContext>;
  beforeEach(() => {
    canvas = recordingContext();
    vi.mocked(saveProjectMediaAsset).mockReset().mockResolvedValue({ path: "pose.png" } as Awaited<ReturnType<typeof saveProjectMediaAsset>>);
    vi.stubGlobal("document", { createElement: () => ({
      width: 0, height: 0, getContext: () => canvas.ctx,
      toBlob: (done: (blob: Blob) => void) => done(new Blob(["frame"], { type: "image/png" })),
    }) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const input = () => ({ projectName: "작품", ownerName: "동작", personNumber: 1,
    result: capture(), size: { width: 400, height: 300 } });

  it("30fps 분석의 6–11초를 출력24fps로 구워 원본0초를 보내지 않는다", async () => {
    const data = input();
    const before = JSON.stringify(data.result);
    const frames = await bakePoseFrames({ ...data, sourceStartSeconds: 6, durationSeconds: 5, fps: 24 });
    expect(frames).toMatchObject({ fps: 24, seconds: 5, sourceStartSeconds: 6, sourceEndSeconds: 11 });
    expect(frames.frames).toHaveLength(120);
    expect(canvas.dots[0].args[0]).toBeCloseTo(24);
    expect(canvas.dots[119 * 18].args[0]).toBeCloseTo(329 / 3000 * 400);
    expect(JSON.stringify(data.result)).toBe(before);
  });

  it.each([
    { range: {}, start: 2, end: 8, count: 12 },
    { range: { sourceStartSeconds: 6 }, start: 6, end: 8, count: 4 },
    { range: { durationSeconds: 2 }, start: 2, end: 4, count: 4 },
  ])("생략한 범위의 기존 규약을 지킨다: $start–$end", async ({ range, start, end, count }) => {
    const data = input(); data.result.start = 2; data.result.end = 8;
    const frames = await bakePoseFrames({ ...data, ...range, fps: 2 });
    expect(frames).toMatchObject({ sourceStartSeconds: start, sourceEndSeconds: end, seconds: end - start, fps: 2 });
    expect(frames.frames).toHaveLength(count);
    expect(canvas.dots[0].args[0]).toBeCloseTo(start * 4);
  });

  it.each([
    { sourceStartSeconds: -1 }, { sourceStartSeconds: 20 }, { sourceStartSeconds: NaN },
    { durationSeconds: 0 }, { durationSeconds: -1 }, { durationSeconds: Infinity },
    { sourceStartSeconds: 18, durationSeconds: 3 },
    { fps: 0 }, { fps: -1 }, { fps: NaN }, { fps: Infinity },
  ])("범위와 FPS가 틀리면 프레임 저장 전에 거절한다: %j", async (options) => {
    await expect(bakePoseFrames({ ...input(), ...options })).rejects.toThrow();
    expect(saveProjectMediaAsset).not.toHaveBeenCalled();
  });

  it("선택 시작보다 앞의 가까운 표본을 가져오지 않고 검출 없는 구간은 거절한다", async () => {
    const data = input();
    data.result.persons[0].samples = [5.99, 6.2, 6.5, 7].map(time => ({ time,
      image: landmarks().map(point => ({ ...point, x: time - 6, z: 0, v: 1 })), world: [] }));
    await bakePoseFrames({ ...data, sourceStartSeconds: 6, durationSeconds: 1, fps: 2 });
    expect(canvas.dots[0].args[0]).toBeCloseTo(80);
    expect(canvas.dots[18].args[0]).toBeCloseTo(200);
    vi.mocked(saveProjectMediaAsset).mockClear();
    await expect(bakePoseFrames({ ...data, sourceStartSeconds: 8, durationSeconds: 1 })).rejects.toThrow("표본");
    expect(saveProjectMediaAsset).not.toHaveBeenCalled();
  });

  it("원본 시작 시각을 분석 시작에 더하지 않고 분석 밖의 시각은 거절한다", async () => {
    const data = input(); data.result.start = 6; data.result.end = 11;
    await expect(bakePoseFrames({ ...data, sourceStartSeconds: 0, durationSeconds: 5 })).rejects.toThrow("분석 구간");
    expect(saveProjectMediaAsset).not.toHaveBeenCalled();
  });

  it("JSON 분석에서 이미 좌표·좌우 부위를 반전했다면 굽기에서 다시 뒤집지 않는다", async () => {
    const points = landmarks();
    const result = assembleCapture({ width: 400, height: 300, duration: 1, fps: 4, start: 0, end: 1,
      engine: "sam3dbody", mirror: true,
      frames: [0, 0.25, 0.5, 0.75].map(t => ({ t, people: [{
        image: points.map(p => [p.x, p.y, 1]), world: points.map(p => [p.x, p.y, 0, 1]), score: 1,
      }] })),
    });
    expect(result.mirrored).toBe(true);
    expect(result.persons[0].samples[0].image[12].x).toBeCloseTo(1 - points[11].x);
    await bakePoseFrames({ ...input(), result });
    expect(canvas.dots[2].args[0]).toBeCloseTo((1 - points[11].x) * 400);
    expect(canvas.dots[2].color).toBe("#ffaa00");
  });

  it("반전 표식이 없는 옛 분석 좌표도 source 설정으로 추측해 바꾸지 않는다", async () => {
    const data = input(); delete data.result.mirrored;
    data.result.persons[0].samples[0].image[0].x = 0.8;
    await bakePoseFrames({ ...data, durationSeconds: 0.05, fps: 20 });
    expect(canvas.dots[0].args[0]).toBe(320);
  });
});
