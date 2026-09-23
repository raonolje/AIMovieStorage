import { LM, type CapturePoint, type CaptureResult, type CaptureSample } from "./motionCapture";

type Point = { x: number; y: number; z: number; visibility?: number };
export interface HandDetection {
  landmarks: Point[][];
  worldLandmarks: Point[][];
  handedness?: { categoryName: string; score: number }[][];
}
export interface HandDetector { detect: (frame: HTMLCanvasElement) => HandDetection; close: () => void; }
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
type HandSide = "left" | "right";
const sides: HandSide[] = ["left", "right"];
const finite21 = (points: Point[] | undefined): points is Point[] => Boolean(points?.length === 21 && points.every(p => [p.x, p.y, p.z].every(Number.isFinite)));
const abortIfNeeded = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("취소", "AbortError"); };

/** 손목과 몸 좌표로 임자를 고릅니다. 셀카 여부가 불분명한 handedness 이름으로 좌우를 바꾸지 않습니다. */
export function attachHandsAtTime(raw: CaptureResult, time: number, detection: HandDetection, mirrored: boolean): CaptureResult {
  const aspect = raw.width / Math.max(1, raw.height);
  const distance = (a: CapturePoint, b: CapturePoint) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const slots: { person: number; sample: number; side: HandSide; wrist: CapturePoint; radius: number }[] = [];
  raw.persons.forEach((person, personIndex) => person.samples.forEach((sample, sampleIndex) => {
    if (Math.abs(sample.time - time) > 1e-5) return;
    const leftShoulder = sample.image[LM.leftShoulder], rightShoulder = sample.image[LM.rightShoulder];
    const shoulder = leftShoulder && rightShoulder ? distance(leftShoulder, rightShoulder) : 0.1;
    for (const side of sides) {
      const wrist = sample.image[side === "left" ? LM.leftWrist : LM.rightWrist];
      const elbow = sample.image[side === "left" ? LM.leftElbow : LM.rightElbow];
      if (!wrist || wrist.v <= 0.3 || ![wrist.x, wrist.y].every(Number.isFinite)) continue;
      const forearm = elbow && elbow.v >= 0.3 ? distance(elbow, wrist) : shoulder * 0.5;
      slots.push({ person: personIndex, sample: sampleIndex, side, wrist, radius: Math.min(0.18, Math.max(0.035, shoulder * 0.45, forearm * 0.65)) });
    }
  }));
  const candidates = detection.landmarks.flatMap((image, index) => {
    const world = detection.worldLandmarks[index];
    if (!finite21(image) || !finite21(world)) return [];
    // 검출기에는 관절별 가림 신뢰도가 없습니다. 화면 안/밖의 보수적 표지만 씁니다.
    // Hand Landmarker의 visibility는 미제공인데 SDK가 0으로 채워 돌려주기도 합니다.
    // 이를 실제 가림으로 읽으면 검출한 21점 전부가 리타깃에서 빠집니다.
    const points = image.map(p => ({ x: mirrored ? 1 - p.x : p.x, y: p.y, z: p.z, v: p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? 0.9 : 0.3 }));
    const worldPoints = world.map((p, i) => ({ x: mirrored ? -p.x : p.x, y: p.y, z: p.z, v: points[i].v }));
    const ranked = slots.map(slot => ({ slot, distance: distance(points[0], slot.wrist) })).filter(item => item.distance <= item.slot.radius).sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (!best) return [];
    // 팔을 교차하거나 두 사람이 겹치면 라벨로 추측하지 않고 기존 손 데이터를 남깁니다.
    if (ranked[1] && ranked[1].distance - best.distance < best.slot.radius * 0.2) return [];
    return [{ ...best, hand: { image: points, world: worldPoints } }];
  }).sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return raw;
  const applied = new Map<string, Partial<NonNullable<CaptureSample["hands"]>>>();
  const occupied = new Set<string>();
  for (const { slot, hand } of candidates) {
    const key = `${slot.person}:${slot.sample}`, handKey = `${key}:${slot.side}`;
    if (occupied.has(handKey)) continue;
    occupied.add(handKey);
    applied.set(key, { ...applied.get(key), [slot.side]: hand });
  }
  return { ...raw, persons: raw.persons.map((person, personIndex) => ({ ...person, samples: person.samples.map((sample, sampleIndex) => {
    const hands = applied.get(`${personIndex}:${sampleIndex}`);
    return hands ? { ...sample, hands: { ...sample.hands, ...hands } } : sample;
  }) })) };
}

/** 모델·WASM은 앱에 포함된 파일만 읽습니다. 분석 버튼을 누르기 전에는 검출기를 만들지 않습니다. */
export async function createHandDetector(): Promise<HandDetector> {
  const [{ HandLandmarker }, { default: wasmLoaderPath }, { default: wasmBinaryPath }] = await Promise.all([
    import("@mediapipe/tasks-vision"), import("@mediapipe/tasks-vision/vision_wasm_internal.js?url"), import("@mediapipe/tasks-vision/vision_wasm_internal.wasm?url"),
  ]);
  const model = await fetch("/models/hand_landmarker.task");
  if (!model.ok || model.headers.get("content-type")?.includes("text/html")) throw new Error("손 추적 모델이 설치본에 없습니다. hand_landmarker.task가 포함된 판으로 업데이트해 주세요.");
  const bytes = new Uint8Array(await model.arrayBuffer());
  const build = (delegate: "GPU" | "CPU") => HandLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetBuffer: bytes, delegate }, runningMode: "IMAGE", numHands: 20,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5,
  });
  let modelInstance;
  try { modelInstance = await build("GPU"); }
  catch { modelInstance = await build("CPU"); }
  return { detect: frame => modelInstance.detect(frame), close: () => modelInstance.close() };
}

function waitVideo(video: HTMLVideoElement, event: "loadeddata" | "seeked", action: () => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", failed); signal?.removeEventListener("abort", cancelled); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("영상 프레임을 읽지 못했습니다. 코덱과 파일 상태를 확인해 주세요.")); };
    const cancelled = () => { cleanup(); reject(new DOMException("취소", "AbortError")); };
    timer = setTimeout(failed, 20_000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) { cancelled(); return; }
    try { action(); } catch (error) { cleanup(); reject(error); }
  });
}

/** 몸을 분석했던 정확한 시각만 다시 읽습니다. 검출되지 않은 손/프레임은 원래 값을 보존합니다. */
export async function captureHandFrames(raw: CaptureResult, detectAt: (time: number) => Promise<HandDetection>, options: { mirrored?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<CaptureResult> {
  const frames = new Map<number, { person: number; sample: number }[]>();
  raw.persons.forEach((person, personIndex) => person.samples.forEach((sample, sampleIndex) => {
    if (Number.isFinite(sample.time)) frames.set(sample.time, [...(frames.get(sample.time) ?? []), { person: personIndex, sample: sampleIndex }]);
  }));
  const times = [...frames.keys()].sort((a, b) => a - b);
  let result = raw;
  for (const [index, time] of times.entries()) {
    abortIfNeeded(options.signal);
    const detection = await detectAt(time);
    abortIfNeeded(options.signal);
    // 긴 영상의 모든 프레임을 매번 복사하지 않고 지금 시각에 있는 사람들만 배정합니다.
    const entries = frames.get(time)!;
    const frame = { ...raw, persons: entries.map(entry => ({ ...raw.persons[entry.person], samples: [raw.persons[entry.person].samples[entry.sample]] })) };
    const attached = attachHandsAtTime(frame, time, detection, options.mirrored ?? raw.mirrored ?? false);
    if (attached !== frame) {
      if (result === raw) result = { ...raw, persons: raw.persons.map(person => ({ ...person, samples: [...person.samples] })) };
      entries.forEach((entry, personIndex) => { result.persons[entry.person].samples[entry.sample] = attached.persons[personIndex].samples[0]; });
    }
    options.onProgress?.(index + 1, times.length);
    if (index % 5 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return result;
}

/** 미리보기와 별도 영상 요소를 써서 사용자의 스크럽이 분석 시각을 바꾸지 않게 합니다. */
export async function captureVideoHands(url: string, raw: CaptureResult, options: { mirrored?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<CaptureResult> {
  // 이미 읽어 둔 blob은 복제하지 않습니다. 긴 영상 한 벌을 RAM에 더 올릴 필요가 없습니다.
  const ownedUrl = url.startsWith("blob:") ? null : URL.createObjectURL(await (await fetch(url, { signal: options.signal })).blob());
  const blobUrl = ownedUrl ?? url;
  if (options.signal?.aborted) { if (ownedUrl) URL.revokeObjectURL(ownedUrl); abortIfNeeded(options.signal); }
  abortIfNeeded(options.signal);
  const video = document.createElement("video");
  let detector: HandDetector | undefined;
  try {
    video.muted = true; video.playsInline = true; video.preload = "auto";
    await waitVideo(video, "loadeddata", () => { video.src = blobUrl; }, options.signal);
    detector = await createHandDetector();
    const frame = document.createElement("canvas");
    frame.width = video.videoWidth; frame.height = video.videoHeight;
    const context = frame.getContext("2d");
    if (!context) throw new Error("손 추적용 영상 캔버스를 만들지 못했습니다.");
    return await captureHandFrames(raw, async time => {
      if (Math.abs(video.currentTime - time) > 1e-4) await waitVideo(video, "seeked", () => { video.currentTime = time; }, options.signal);
      abortIfNeeded(options.signal);
      context.drawImage(video, 0, 0, frame.width, frame.height);
      return detector!.detect(frame);
    }, options);
  } finally {
    detector?.close(); video.removeAttribute("src"); video.load(); if (ownedUrl) URL.revokeObjectURL(ownedUrl);
  }
}
