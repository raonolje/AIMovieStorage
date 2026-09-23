import { afterEach, describe, expect, it, vi } from "vitest";
import { attachHandsAtTime, captureHandFrames, captureVideoHands, detectHandsWithBodyRegions, handRegionsAtTime, mapHandRegionDetection, type HandDetection } from "./handCapture";
import { LM, type CapturePoint, type CaptureResult, type CaptureSample } from "./motionCapture";

const p = (x: number, y = 0.5): CapturePoint => ({ x, y, z: 0, v: 0.9 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function sample(left: number, right: number, time = 0): CaptureSample {
  const image = Array.from({ length: 33 }, () => p(0.5));
  image[LM.leftWrist] = p(left); image[LM.rightWrist] = p(right);
  image[LM.leftElbow] = p(left, 0.4); image[LM.rightElbow] = p(right, 0.4);
  image[LM.leftShoulder] = p(left, 0.3); image[LM.rightShoulder] = p(right, 0.3);
  return { time, image, world: image.map(point => ({ ...point })) };
}
function body(...samples: CaptureSample[]): CaptureResult {
  return { width: 100, height: 100, duration: 1, fps: 30, start: 0, end: 1, engine: "sam3dbody", persons: samples.map((value, index) => ({ number: index + 1, samples: [value] })) };
}
function hands(...xs: number[]): HandDetection {
  return {
    landmarks: xs.map(x => Array.from({ length: 21 }, (_, i) => ({ x, y: 0.5 - i / 1000, z: -i / 1000 }))),
    worldLandmarks: xs.map(() => Array.from({ length: 21 }, (_, i) => ({ x: 0.01 + i / 1000, y: -i / 1000, z: -i / 2000 }))),
    // 일부러 전부 반대 라벨을 줍니다. 손목의 실제 위치가 좌우·사람을 정해야 합니다.
    handedness: xs.map(() => [{ categoryName: "Right", score: 0.99 }]),
  };
}

describe("몸 분석에 손 21점을 붙이기", () => {
  it("원본과 거울 좌표에서 같은 손 구역을 자르며 화면 경계와 낮은 신뢰도를 지킨다", () => {
    const raw = body(sample(0.01, 0.99)); raw.width = 3840; raw.height = 2160;
    const normal = handRegionsAtTime(raw, 0, false), mirrored = handRegionsAtTime(raw, 0, true);
    expect(normal).toHaveLength(2);
    normal.forEach((region, index) => {
      expect(region.x).toBeGreaterThanOrEqual(0); expect(region.x + region.size).toBeLessThanOrEqual(raw.width);
      expect(region.y).toBeGreaterThanOrEqual(0); expect(region.y + region.size).toBeLessThanOrEqual(raw.height);
      expect(region.x + mirrored[index].x + region.size).toBeCloseTo(raw.width);
      expect(region.size).toBe(mirrored[index].size);
    });
    raw.persons[0].samples[0].image[LM.leftElbow].v = 0.3;
    raw.persons[0].samples[0].image[LM.rightWrist].x = NaN;
    expect(handRegionsAtTime(raw, 0, false)).toEqual([]);
  });

  it("손 ROI의 image x/y/z만 원본 비율로 돌리고 world 미터 단위는 보존한다", () => {
    const detection = hands(0.25);
    const region = { target: "0:0:left", x: 100, y: 200, size: 400, width: 2000, height: 1000 };
    const mapped = mapHandRegionDetection(detection, region);
    expect(mapped.landmarks[0][0]).toMatchObject({ x: 0.1, y: 0.4 });
    expect(mapped.landmarks[0][0].z).toBeCloseTo(0);
    expect(mapped.landmarks[0][20].z).toBeCloseTo(-0.004);
    expect(mapped.worldLandmarks).toBe(detection.worldLandmarks);
    detection.landmarks[0][0].x = -0.1;
    const outside = mapHandRegionDetection(detection, region);
    const raw = body(sample(outside.landmarks[0][0].x, 0.8));
    raw.persons[0].samples[0].image[LM.leftWrist].y = outside.landmarks[0][0].y;
    expect(attachHandsAtTime(raw, 0, outside, false)).toBe(raw);
  });

  it.each([false, true])("전체 화면에서 놓친 작은 손은 몸 ROI로 보완한다 (반전=%s)", async mirrored => {
    const raw = body(sample(0.2, 0.8)); raw.width = 3840; raw.height = 2160; raw.mirrored = mirrored;
    const frame = { width: 3840, height: 2160 } as HTMLCanvasElement;
    const regions = handRegionsAtTime(raw, 0, mirrored);
    let rect: number[] = [], cropIndex = 0;
    const drawImage = vi.fn((_frame, ...args: number[]) => { rect = args; });
    const crop = { width: 384, height: 384, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement;
    const detector = { close: vi.fn(), detect: vi.fn((canvas: HTMLCanvasElement) => {
      if (canvas === frame) return hands();
      const sourceX = mirrored ? 1 - [0.2, 0.8][cropIndex] : [0.2, 0.8][cropIndex];
      const detection = hands((sourceX * frame.width - rect[0]) / rect[2]);
      for (const point of detection.landmarks[0]) point.y = (0.5 * frame.height - rect[1]) / rect[3];
      expect(rect.slice(0, 4)).toEqual([regions[cropIndex].x, regions[cropIndex].y, regions[cropIndex].size, regions[cropIndex].size]);
      cropIndex++; return detection;
    }) };
    const result = await captureHandFrames(raw, async (time, bodyFrame) => detectHandsWithBodyRegions(detector, frame, crop, bodyFrame, time, mirrored));
    expect(detector.detect).toHaveBeenCalledTimes(3);
    expect(result.persons[0].samples[0].hands?.left?.image[0].x).toBeCloseTo(0.2);
    expect(result.persons[0].samples[0].hands?.right?.image[0].x).toBeCloseTo(0.8);
    expect(result.handTracking).toMatchObject({ frames: 1, roiCount: 2, detectorCalls: 3, detectedHands: 2, validHands: 2, appliedHands: 2, roiAppliedHands: 2, unchangedFrames: 0 });
    expect(raw.persons[0].samples[0].hands).toBeUndefined();
  });

  it("ROI가 옆 사람의 손이나 같은 손을 다시 검출해도 임자를 바꾸거나 중복 적용하지 않는다", async () => {
    const raw = body(sample(0.2, 0.8), sample(0.45, 0.95));
    const detection = hands(0.2, 0.2, 0.2, 0.5);
    detection.roiTargets = ["0:0:left", "0:0:right", "1:0:left", "1:0:right"];
    const result = await captureHandFrames(raw, async () => detection);
    expect(result.handTracking?.appliedHands).toBe(1);
    expect(result.persons[0].samples[0].hands?.right).toBeUndefined();
    expect(result.persons[1].samples[0].hands).toBeUndefined();
  });

  it("전체 화면에서 이미 배정한 손에는 ROI 검출을 중복 실행하지 않는다", () => {
    const raw = body(sample(0.2, 0.8)); raw.width = 1920; raw.height = 1080;
    const frame = { width: 1920, height: 1080 } as HTMLCanvasElement;
    const drawImage = vi.fn();
    const crop = { width: 384, height: 384, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement;
    const detector = { close: vi.fn(), detect: vi.fn(canvas => canvas === frame ? hands(0.2) : hands()) };
    const result = detectHandsWithBodyRegions(detector, frame, crop, raw, 0, false);
    expect(result.roiCount).toBe(1); expect(detector.detect).toHaveBeenCalledTimes(2);
    const region = handRegionsAtTime(raw, 0, false).find(region => region.target.endsWith(":right"))!;
    expect(drawImage.mock.calls[0].slice(1, 5)).toEqual([region.x, region.y, region.size, region.size]);
  });

  it("추가 검출이 0이면 기존 손을 보존하고 적용 0·변화 없는 장수를 기록한다", async () => {
    const raw = body(sample(0.2, 0.8));
    const existing = { image: Array.from({ length: 21 }, () => p(0.2)), world: Array.from({ length: 21 }, () => p(0.01)) };
    raw.persons[0].samples[0].hands = { left: existing };
    const result = await captureHandFrames(raw, async () => hands());
    expect(result.persons).toBe(raw.persons);
    expect(result.persons[0].samples[0].hands?.left).toBe(existing);
    expect(result.handTracking).toMatchObject({ detectedHands: 0, validHands: 0, appliedHands: 0, unchangedFrames: 1 });
    expect(raw.handTracking).toBeUndefined();
  });

  it("좌우 라벨이 뒤집혀도 여러 사람의 손목으로 정확히 나눈다", () => {
    const raw = body(sample(0.1, 0.3), sample(0.65, 0.85));
    const saved = JSON.stringify(raw);
    const next = attachHandsAtTime(raw, 0, hands(0.85, 0.1, 0.65, 0.3), false);
    expect(next.persons.map(person => [person.samples[0].hands?.left?.image[0].x, person.samples[0].hands?.right?.image[0].x])).toEqual([[0.1, 0.3], [0.65, 0.85]]);
    expect(JSON.stringify(raw)).toBe(saved);
    expect(next.persons[0].samples[0].image).toBe(raw.persons[0].samples[0].image);
  });

  it("반전된 몸과 같은 좌표계로 image·world x를 변환한다", () => {
    const next = attachHandsAtTime(body(sample(0.8, 0.3)), 0, hands(0.2), true);
    expect(next.persons[0].samples[0].hands?.left?.image[0].x).toBeCloseTo(0.8);
    expect(next.persons[0].samples[0].hands?.left?.world[0].x).toBe(-0.01);
    expect(next.persons[0].samples[0].hands?.right).toBeUndefined();
  });

  it("SDK가 미제공 visibility를 0으로 채워도 유효한 21점을 가림으로 버리지 않는다", () => {
    const detection = hands(0.2);
    for (const list of [...detection.landmarks, ...detection.worldLandmarks])
      for (const point of list) point.visibility = 0;
    const next = attachHandsAtTime(body(sample(0.2, 0.8)), 0, detection, false);
    expect(next.persons[0].samples[0].hands?.left?.world.map(point => point.v)).toEqual(Array(21).fill(0.9));
    detection.landmarks[0][20].x = -0.1;
    const outside = attachHandsAtTime(body(sample(0.2, 0.8)), 0, detection, false);
    expect(outside.persons[0].samples[0].hands?.left?.world[20].v).toBe(0.3);
  });

  it("겹친 손목·가려진 손목·멀리 있는 검출을 기존 SAM 손으로 덮지 않는다", () => {
    const existing = { image: Array.from({ length: 21 }, () => p(0.5)), world: Array.from({ length: 21 }, () => p(0.1)) };
    const s = sample(0.49, 0.51); s.hands = { left: existing };
    const raw = body(s);
    expect(attachHandsAtTime(raw, 0, hands(0.5), false)).toBe(raw);
    s.image[LM.leftWrist].v = 0;
    expect(attachHandsAtTime(raw, 0, hands(0.1), false)).toBe(raw);
    expect(raw.persons[0].samples[0].hands?.left).toBe(existing);
  });

  it("21점이 아니거나 NaN이 있으면 적용하지 않는다", () => {
    const raw = body(sample(0.2, 0.8)), malformed = hands(0.2);
    malformed.worldLandmarks[0][5].x = NaN;
    expect(attachHandsAtTime(raw, 0, malformed, false)).toBe(raw);
    malformed.worldLandmarks[0] = [];
    expect(attachHandsAtTime(raw, 0, malformed, false)).toBe(raw);
  });

  it("화면 밖 신뢰도 0.3 손목에는 새 손을 배정하지 않는다", () => {
    const s = sample(0.2, 0.8); s.image[LM.leftWrist].v = 0.3;
    const raw = body(s);
    expect(attachHandsAtTime(raw, 0, hands(0.2), false)).toBe(raw);
  });

  it("몸 분석의 시각만 한 번씩 검출하고 누락된 프레임의 손은 유지한다", async () => {
    const raw = body(sample(0.2, 0.8));
    const existing = { image: Array.from({ length: 21 }, () => p(0.2)), world: Array.from({ length: 21 }, () => p(0.01)) };
    raw.persons[0].samples.push({ ...sample(0.2, 0.8, 0.1), hands: { left: existing } });
    raw.persons.push({ number: 2, samples: [sample(0.5, 0.95, 0.1)] });
    const detect = vi.fn(async time => time === 0 ? hands(0.2) : hands());
    const result = await captureHandFrames(raw, detect);
    expect(detect.mock.calls.map(call => call[0])).toEqual([0, 0.1]);
    expect(result.persons[0].samples[0].hands?.left?.image).toHaveLength(21);
    expect(result.persons[0].samples[1].hands?.left).toBe(existing);
    expect(raw.persons[0].samples[0].hands).toBeUndefined();
  });

  it("취소 후 부분 결과를 성공으로 반환하지 않는다", async () => {
    const controller = new AbortController();
    await expect(captureHandFrames(body(sample(0.2, 0.8)), async () => {
      controller.abort(); return hands(0.2);
    }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(["blob:existing", "asset://fixtures/video.mp4"])("%s 영상 열기를 취소하면 소유한 자원만 정리한다", async url => {
    const controller = new AbortController();
    const video = new EventTarget();
    Object.assign(video, { load: vi.fn(), removeAttribute: vi.fn() });
    Object.defineProperty(video, "src", { set: () => controller.abort() });
    vi.stubGlobal("document", { createElement: () => video });
    const fetcher = vi.fn(async () => ({ blob: async () => new Blob(["시험 영상"]) }));
    vi.stubGlobal("fetch", fetcher);
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:created");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await expect(captureVideoHands(url, body(sample(0.2, 0.8)), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    if (url.startsWith("blob:")) {
      expect(fetcher).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled();
    } else {
      expect(fetcher).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith("blob:created");
    }
  });
});
