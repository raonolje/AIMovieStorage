import { waitVideoFrameEvent } from "./videoFrameWait";

/**
 * 영상 → 사람별 관절 좌표(모션 캡처).
 *
 *
 *
 * # MediaPipe Pose Landmarker 를 쓰는 까닭
 *
 * 앱 안(웹뷰)에서 GPU 로 돌고, 한 화면의 여러 사람을 한 번에 잡고(`numPoses`), 사람마다 **미터 단위 3D 좌표**
 * (골반 가운데가 원점인 world landmarks)를 줍니다. 파이썬·서버 없이 설치본 그대로 돌아야 해서 이것으로 정했습니다
 * (Apache 2.0 — 모델·wasm 을 앱에 넣어도 됩니다).
 *
 * 이 파일은 «좌표 뽑기·사람 이어 붙이기·떨림 줄이기» 까지입니다. 캐릭터 관절 회전으로 바꾸는 일은 `motionRetarget.ts`.
 */

/** 한 점. 이미지 좌표는 0~1(가로·세로), world 는 미터(골반 가운데 원점, x 오른쪽·y 아래·z 카메라 쪽이 −). */
export interface CapturePoint {
  x: number;
  y: number;
  z: number;
  /** 보이는 정도 0~1. 가려진 손목 같은 것은 낮습니다. */
  v: number;
}

/** 손목 + 엄지부터 새끼까지 각 네 점. MediaPipe Hand Landmarker의 21점 순서입니다. */
export interface CaptureHand {
  image: CapturePoint[];
  /** 몸과 같은 축입니다. 원점은 검출기마다 달라 방향 차이만 리타깃에 씁니다. */
  world: CapturePoint[];
}
export interface CaptureHands { left?: CaptureHand; right?: CaptureHand }

/** 한 사람의 한 순간. */
export interface CaptureSample {
  /** 영상 안의 초. */
  time: number;
  /** 33점 — 이미지 좌표. */
  image: CapturePoint[];
  /** 33점 — 미터 좌표. */
  world: CapturePoint[];
  /** 손을 실제로 찾은 쪽만 있습니다. 33점 몸 좌표로 손가락을 지어내지 않습니다. */
  hands?: CaptureHands;
  /**
   * 엔진이 직접 복원한 **실제 이동 자리**(미터, 첫 장 카메라 좌표: x 오른쪽 · y 아래 · z 멀어지는 쪽).
   * GVHMR 처럼 카메라가 움직여도 땅 위 경로를 푸는 엔진만 줍니다. 있으면 리타깃이 화면 속 자리로 짐작하지 않고 이것을 씁니다.
   */
  root?: { x: number; y: number; z: number };
}

/** 영상 속 한 사람(끝까지 이어 붙인 것). */
export interface CapturedPerson {
  /** 화면에 보이는 번호 1, 2, 3… — 처음 나올 때의 **왼쪽부터** 매깁니다. */
  number: number;
  samples: CaptureSample[];
  /** 튐 보정 결과(`repairPerson`) — 고친 관절 수·통째로 메운 장 수. 아직 안 했으면 없음. */
  repaired?: { joints: number; frames: number; swaps: number };
}

/** 손 검출 성공과 기존 손 데이터 보존을 구분하는 추가 추적 기록입니다. */
export interface HandTrackingDiagnostics {
  method: "whole-frame+body-roi";
  frames: number;
  detectorCalls: number;
  roiCount: number;
  detectedHands: number;
  validHands: number;
  appliedHands: number;
  roiAppliedHands: number;
  unchangedFrames: number;
}

export interface CaptureResult {
  width: number;
  height: number;
  duration: number;
  /** 뽑은 간격(초에 몇 장). */
  fps: number;
  /** 분석한 구간(영상 안의 초). */
  start: number;
  end: number;
  /** 뽑은 검출기 id — `mediapipe` 또는 로컬 엔진 id. */
  engine: string;
  /** 분석 때 적용한 좌우 반전. 나중에 손만 다시 읽을 때 같은 좌표계를 씁니다. */
  mirrored?: boolean;
  handTracking?: HandTrackingDiagnostics;
  persons: CapturedPerson[];
}

/** MediaPipe 점 번호(33점 체계). */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** 겹쳐 그리기용 뼈 줄. */
export const CAPTURE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32], [15, 19], [16, 20], [0, 7], [0, 8],
];

/** 좌우를 바꿀 때 짝이 되는 점. 0(코)처럼 가운데 점은 자기 자신. */
const MIRROR_INDEX = (() => {
  const map = Array.from({ length: 33 }, (_, i) => i);
  const pairs: [number, number][] = [
    [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20],
    [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
  ];
  for (const [a, b] of pairs) {
    map[a] = b;
    map[b] = a;
  }
  return map;
})();

/** 검출기 한 번의 결과에서 쓰는 모양만 — `PoseLandmarkerResult` 를 여기서 import 하지 않아 이 파일은 wasm 없이도 읽힙니다. */
export interface PoseDetection {
  landmarks: { x: number; y: number; z: number; visibility?: number }[][];
  worldLandmarks: { x: number; y: number; z: number; visibility?: number }[][];
}

/** 사람 상자(픽셀). */
export interface PersonBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

/**
 * 검출기 두 개 — **사람 찾기**(상자)와 **한 사람의 관절**.
 *
 * # 한 번에 여러 명을 뽑지 않고 «사람마다 잘라서» 보는 까닭
 *
 * 관절 모델에 화면 전체를 주고 여러 명을 달라고 하면(`numPoses`), 여섯 명이 서 있는 480p 댄스 영상에서 장마다 거의 **한 명**만
 * 나왔습니다(2026-09-16 실측, 300 장 중 2명 이상은 40 장). 모델이 화면을 224 픽셀로 줄여 보니 멀리 선 사람은 70 픽셀도 안
 * 됩니다. 그래서 사람 찾기 모델로 상자를 먼저 얻고, 상자마다 넉넉히 잘라 **크게 키운 한 사람 그림**으로 관절을 봅니다.
 * 관절 모델은 장마다 따로(IMAGE 모드) 돌립니다 — 이어 붙이기는 이 파일이 합니다.
 */
export interface PoseDetector {
  people: (frame: HTMLCanvasElement) => PersonBox[];
  pose: (crop: HTMLCanvasElement) => PoseDetection;
}

/** 잘라 볼 한 사람 그림의 한 변(픽셀). 관절 모델 입력(256)보다 조금 크게 — 줄일 때 뭉개지지 않게. */
const CROP_SIZE = 320;

const seekTo = (video: HTMLVideoElement, time: number, signal?: AbortSignal) =>
  // 같은 자리로 seek 하면 `seeked` 가 안 오는 브라우저가 있어 바로 돌아갑니다.
  Math.abs(video.currentTime - time) < 1e-4 ? Promise.resolve() :
    waitVideoFrameEvent(video, "seeked", () => { video.currentTime = time; }, signal);

const toPoints = (list: { x: number; y: number; z: number; visibility?: number }[]): CapturePoint[] =>
  list.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 }));

/** 사람 이어 붙이기에 쓰는 몸 크기·자리(이미지 좌표, 가로는 화면비를 곱해 세로와 같은 눈금). */
function bodyAnchor(image: CapturePoint[], aspect: number) {
  const hx = ((image[LM.leftHip].x + image[LM.rightHip].x) / 2) * aspect;
  const hy = (image[LM.leftHip].y + image[LM.rightHip].y) / 2;
  const sx = ((image[LM.leftShoulder].x + image[LM.rightShoulder].x) / 2) * aspect;
  const sy = (image[LM.leftShoulder].y + image[LM.rightShoulder].y) / 2;
  const torso = Math.max(0.02, Math.hypot(sx - hx, sy - hy));
  return { x: (hx + sx) / 2, y: (hy + sy) / 2, torso };
}

/** 잘라 볼 정사각 자리(픽셀). */
interface Region {
  x: number;
  y: number;
  side: number;
}

/** 앞 장에서 본 사람의 관절이 차지한 자리 → 이번 장에 잘라 볼 자리. 팔을 뻗고 발을 차도 들어오게 넉넉히. */
function regionFromPoints(image: CapturePoint[], width: number, height: number, grow = 1.5): Region {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of image) {
    if (point.v < 0.3) continue;
    minX = Math.min(minX, point.x * width);
    maxX = Math.max(maxX, point.x * width);
    minY = Math.min(minY, point.y * height);
    maxY = Math.max(maxY, point.y * height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, side: Math.max(width, height) };
  const side = Math.max(maxX - minX, maxY - minY) * grow;
  return { x: (minX + maxX) / 2 - side / 2, y: (minY + maxY) / 2 - side / 2, side };
}

function overlap(a: Region, b: Region) {
  const x = Math.max(0, Math.min(a.x + a.side, b.x + b.side) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.side, b.y + b.side) - Math.max(a.y, b.y));
  return (x * y) / Math.min(a.side * a.side, b.side * b.side);
}

interface Track {
  samples: CaptureSample[];
  lastTime: number;
  anchor: { x: number; y: number; torso: number };
  velocity: { x: number; y: number };
  /** 옷 색(몸통·허벅지 평균 RGB 0~1) — 천천히 따라 바뀝니다. */
  look: number[];
  /** 처음 잡혔을 때의 옷 색 — 끊긴 조각을 다시 이을 때 앞 조각의 끝 색과 견줍니다. */
  firstLook: number[];
}

/** 한 장에서 찾은 한 사람. 검출기가 무엇이든(앱 안 MediaPipe·로컬 엔진) 이 모양으로 이어 붙이기에 들어갑니다. */
export interface FrameDetection {
  image: CapturePoint[];
  world: CapturePoint[];
  hands?: CaptureHands;
  /** 0~1. 같은 사람을 두 번 잡았을 때 어느 쪽을 남길지. */
  score: number;
  /** 옷 색 여섯 숫자(`lookOf`). 모르면 빈 배열 — 그때는 자리만으로 잇습니다. */
  look: number[];
  /** 따라가던 몇 번째 사람의 앞 장 자리를 잘라 본 결과인가(앱 안 검출기만). */
  from?: number | null;
  /** 엔진이 준 실제 이동 자리(`CaptureSample.root`). */
  root?: { x: number; y: number; z: number };
}

/**
 * **옷 색** — 몸통(어깨~골반)과 허벅지(골반~무릎) 사각의 평균 색 여섯 숫자.
 *
 * 커플 춤처럼 두 사람이 몸통 하나 거리로 붙어 돌면 자리만으로는 누가 누군지 못 가려, 여자의 번호가 남자에게 넘어갔습니다
 * (2026-09-16 실측, 19 초). 초록 원피스와 회색 조끼는 색이 확 달라 이것 하나로 대부분 갈립니다.
 * 로컬 엔진(파이썬)도 같은 식으로 재서 보냅니다(`resources/local/engines/_mocap.py` 의 `look_of`).
 */
function lookOf(
  image: CapturePoint[],
  source: HTMLCanvasElement,
  sampler: CanvasRenderingContext2D,
  mirror: boolean,
) {
  const out: number[] = [];
  const box = (indices: number[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const index of indices) {
      const x = (mirror ? 1 - image[index].x : image[index].x) * source.width;
      const y = image[index].y * source.height;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    // 가장자리(팔·배경)가 섞이지 않게 안쪽 60 % 만.
    const w = Math.max(2, (maxX - minX) * 0.6);
    const h = Math.max(2, (maxY - minY) * 0.6);
    sampler.drawImage(source, (minX + maxX) / 2 - w / 2, (minY + maxY) / 2 - h / 2, w, h, 0, 0, 4, 4);
    const data = sampler.getImageData(0, 0, 4, 4).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 64; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    out.push(r / 16 / 255, g / 16 / 255, b / 16 / 255);
  };
  box([LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]);
  box([LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee]);
  return out;
}

/** 옷 색 거리. 한쪽이라도 모르면 0(자리만으로 판단). */
const lookDistance = (a: number[], b: number[]) =>
  a.length && a.length === b.length ? Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length) : 0;

/**
 * **사람 이어 붙이기** — 장마다 찾은 사람들을 «같은 사람» 끼리 잇고, 끊긴 조각을 다시 이어 번호를 매깁니다.
 *
 * 앱 안 검출기와 로컬 엔진(SAM 3D Body·NLF·GVHMR)이 **같은 것**을 씁니다. 엔진마다 잇기를 따로 두면 «커플의 번호가 넘어가는»
 * 고장을 한쪽만 고치게 됩니다.
 *
 * 잇는 기준은 앞 장 골반·가슴 자리(+속도)에서 몸통 길이로 잰 거리, 몸 크기 변화, 옷 색. 자기 자리를 잘라 본 결과(`from`)는 조금 더
 * 가깝게 칩니다. 1 초 넘게 안 보인 사람은 끝난 것으로 봅니다.
 */
export class PersonTracker {
  private active: Track[] = [];
  private finished: Track[] = [];

  constructor(private readonly aspect: number) {}

  /** 1 초 넘게 못 본 사람을 끝냅니다. 이번 장을 보기 **전에** 부릅니다 — 끝난 사람의 자리는 잘라 보지 않게. */
  retire(time: number) {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      if (time - this.active[i].lastTime > 1.0) this.finished.push(...this.active.splice(i, 1));
    }
  }

  /** 따라가는 사람들의 앞 장 관절(순서 = `FrameDetection.from` 번호). */
  lastImages() {
    return this.active.map((track) => track.samples[track.samples.length - 1].image);
  }

  update(time: number, found: FrameDetection[]) {
    const anchorOf = (image: CapturePoint[]) => bodyAnchor(image, this.aspect);
    // 같은 사람을 두 자리에서 잡았으면(붙어 선 커플) 점수 높은 쪽만.
    const sorted = found.map((item) => ({ ...item, anchor: anchorOf(item.image) })).sort((a, b) => b.score - a.score);
    const detections: typeof sorted = [];
    for (const item of sorted) {
      const duplicate = detections.some(
        (other) =>
          Math.hypot(item.anchor.x - other.anchor.x, item.anchor.y - other.anchor.y) <
          Math.min(item.anchor.torso, other.anchor.torso) * 0.35,
      );
      if (!duplicate) detections.push(item);
    }

    const pairs: { track: number; detection: number; cost: number }[] = [];
    this.active.forEach((track, ti) => {
      const gap = time - track.lastTime;
      const px = track.anchor.x + track.velocity.x * gap;
      const py = track.anchor.y + track.velocity.y * gap;
      detections.forEach((detection, di) => {
        const scale = Math.max(track.anchor.torso, detection.anchor.torso);
        const distance = Math.hypot(detection.anchor.x - px, detection.anchor.y - py) / scale;
        const sizeChange = Math.abs(Math.log(detection.anchor.torso / track.anchor.torso));
        const own = detection.from === ti ? -0.25 : 0;
        // 옷 색 차이 0.1(밝기 10 %)이 몸통 반 개 거리만큼 — 붙어 선 두 사람을 가르는 쪽은 대개 이것입니다.
        const look = lookDistance(detection.look, track.look) * 5;
        pairs.push({ track: ti, detection: di, cost: distance + sizeChange * 0.5 + own + look });
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);
    const usedTracks = new Set<number>();
    const usedDetections = new Set<number>();
    for (const pair of pairs) {
      if (pair.cost > 1.2) break;
      if (usedTracks.has(pair.track) || usedDetections.has(pair.detection)) continue;
      usedTracks.add(pair.track);
      usedDetections.add(pair.detection);
      const track = this.active[pair.track];
      const detection = detections[pair.detection];
      const gap = Math.max(1e-3, time - track.lastTime);
      track.velocity = {
        x: track.velocity.x * 0.5 + ((detection.anchor.x - track.anchor.x) / gap) * 0.5,
        y: track.velocity.y * 0.5 + ((detection.anchor.y - track.anchor.y) / gap) * 0.5,
      };
      track.anchor = detection.anchor;
      if (detection.look.length === track.look.length)
        track.look = track.look.map((value, i) => value * 0.9 + detection.look[i] * 0.1);
      track.lastTime = time;
      track.samples.push({ time, image: detection.image, world: detection.world, root: detection.root, hands: detection.hands });
    }
    detections.forEach((detection, di) => {
      // 따라가던 자리에서 나온 결과가 짝을 못 찾았으면 새 사람으로 세우지 않습니다 — 대개 옆 사람을 잘못 본 것입니다.
      if (usedDetections.has(di) || (detection.from !== null && detection.from !== undefined)) return;
      this.active.push({
        samples: [{ time, image: detection.image, world: detection.world, root: detection.root, hands: detection.hands }],
        lastTime: time,
        anchor: detection.anchor,
        velocity: { x: 0, y: 0 },
        look: detection.look,
        firstLook: detection.look,
      });
    });
  }

  /**
   * 끝 — 끊긴 조각을 잇고 번호를 매깁니다.
   *
   * 잠깐 잡혔다 사라진 것(겹친 사람을 한 번 잘못 본 것 등)은 뺍니다 — 1 초 미만이거나 영상의 5 % 미만.
   * 번호는 **처음 나온 자리의 왼쪽부터**. 사람이 화면에서 보는 순서와 같아야 «1번은 A» 를 헷갈리지 않습니다.
   */
  finish(fps: number, span: number): CapturedPerson[] {
    const all = [...this.finished, ...this.active];
    this.active = [];
    this.finished = [];
    stitchTracks(all, this.aspect);
    const step = 1 / fps;
    return all
      .filter((track) => {
        const covered = track.samples.length * step;
        return covered >= Math.min(1, span * 0.5) && covered >= span * 0.05;
      })
      .map((track) => {
        const head = track.samples.slice(0, Math.max(1, Math.round(fps)));
        const x = head.reduce((sum, s) => sum + (s.image[LM.leftHip].x + s.image[LM.rightHip].x) / 2, 0) / head.length;
        return { track, x };
      })
      .sort((a, b) => a.x - b.x)
      .map((item, i) => ({ number: i + 1, samples: item.track.samples }));
  }
}

/**
 * **끊긴 조각 다시 잇기** — 한 사람이 빠르게 돌거나 잠깐 가려져 번호가 4→5→3 으로 바뀐 것을 하나로.
 *
 * 2026-09-16 실측(케이팝 커버 댄스, 초당 30 장): 오른쪽 댄서 한 명이 10 초 동안 세 번호로 쪼개졌습니다. 장 사이 잇기는 1 초를
 * 넘게 못 보면 끝내야 옆 사람에게 넘어가지 않는데, 그러면 빠른 동작 한 번에 끊깁니다. 그래서 다 뽑은 뒤에 **앞 조각이 끝난
 * 뒤 2.5 초 안에 시작한 조각**을, 자리(떨어진 시간만큼 넉넉히)와 옷 색이 맞으면 잇습니다. 시간이 겹치는 조각은 잇지 않습니다.
 */
function stitchTracks(tracks: Track[], aspect: number) {
  for (;;) {
    let best: { a: Track; b: Track; cost: number } | null = null;
    for (const a of tracks) {
      const end = a.samples[a.samples.length - 1];
      const anchorA = bodyAnchor(end.image, aspect);
      for (const b of tracks) {
        if (a === b) continue;
        const begin = b.samples[0];
        const gap = begin.time - end.time;
        if (gap <= 0 || gap > 2.5) continue;
        const anchorB = bodyAnchor(begin.image, aspect);
        const distance = Math.hypot(anchorA.x - anchorB.x, anchorA.y - anchorB.y) / Math.max(anchorA.torso, anchorB.torso);
        const allowed = 1 + gap * 2;
        const look = lookDistance(a.look, b.firstLook);
        if (distance > allowed || look > 0.12) continue;
        const cost = distance / allowed + look * 5;
        if (!best || cost < best.cost) best = { a, b, cost };
      }
    }
    if (!best) return;
    best.a.samples.push(...best.b.samples);
    best.a.look = best.b.look;
    best.a.lastTime = best.b.lastTime;
    tracks.splice(tracks.indexOf(best.b), 1);
  }
}

/** 구간 [start, end) 을 초당 fps 장으로 나눈 시각들(만분의 일 초 반올림 — 1/30 초는 0.05 초 눈금에 안 맞습니다). */
export function sampleTimes(start: number, end: number, fps: number) {
  const times: number[] = [];
  for (let index = 0; ; index += 1) {
    const time = Math.round((start + index / fps) * 1e4) / 1e4;
    if (time > end - 1e-3) break;
    times.push(time);
  }
  return times;
}

/**
 * 영상을 일정 간격으로 넘기며 사람마다 관절 좌표를 뽑습니다 — **앱 안 검출기(MediaPipe)** 길.
 *
 * # 재생이 아니라 한 장씩 넘기는(seek) 까닭
 *
 * 재생하며 뽑으면 검출이 느린 순간 프레임을 건너뛰어 키 간격이 들쭉날쭉해지고, 컴퓨터마다 결과가 달라집니다.
 * 한 장씩 넘기면 느려도 **정확히 같은 시각들**에서 뽑혀, 초당 30 장이면 정확히 1/30 초마다 키가 섭니다.
 *
 * # «앞 장의 그 사람 자리» 를 먼저 봅니다
 *
 * 사람 찾기만 믿으면 커플처럼 붙어 선 두 사람 중 하나를 자주 놓치고, 그 틈에 번호가 옆 사람에게 넘어갔습니다(실측: 구경하던
 * 사람의 번호가 춤추는 남자에게 넘어감). 그래서 장마다 **이미 따라가는 사람의 앞 장 자리를 잘라** 먼저 보고(그 사람이 가운데라
 * 겹쳐 서도 그 사람을 잡습니다), 사람 찾기 상자는 그 자리들과 겹치지 않는 **새 사람**에만 씁니다.
 */
export async function captureVideo(
  video: HTMLVideoElement,
  detector: PoseDetector,
  options: {
    /** 초당 몇 장. 영상의 원래 프레임 수보다 크게 주면 같은 장을 두 번 봅니다. */
    fps: number;
    start?: number;
    end?: number;
    mirror?: boolean;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<CaptureResult> {
  const width = video.videoWidth || 1;
  const height = video.videoHeight || 1;
  const aspect = width / height;
  const duration = video.duration || 0;
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(duration, options.end ?? duration);
  const times = sampleTimes(start, end, options.fps);

  /*
    검출기에는 영상 요소가 아니라 **캔버스에 옮겨 그린 장**을 줍니다. 영상 요소를 바로 주면 GPU 쪽이 seek 뒤의 새 장을 못 받아
    첫 장만 되풀이해 검출하는 일이 있었습니다(2026-09-16 실측 — 모든 장의 좌표가 소수 셋째 자리까지 같았음).
  */
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const frameContext = frame.getContext("2d");
  const crop = document.createElement("canvas");
  crop.width = CROP_SIZE;
  crop.height = CROP_SIZE;
  const cropContext = crop.getContext("2d");
  const sample = document.createElement("canvas");
  sample.width = 4;
  sample.height = 4;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!frameContext || !cropContext || !sampleContext) throw new Error("캔버스를 만들 수 없습니다.");

  const poseIn = (region: Region): FrameDetection | null => {
    cropContext.fillStyle = "#000";
    cropContext.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    // 영상 밖으로 나간 부분은 검은 바탕으로 남습니다(drawImage 가 원본 밖을 잘라 비율대로 옮김).
    cropContext.drawImage(frame, region.x, region.y, region.side, region.side, 0, 0, CROP_SIZE, CROP_SIZE);
    const result = detector.pose(crop);
    const list = result.landmarks[0];
    if (!list) return null;
    let image = list.map((p) => ({
      x: (region.x + p.x * region.side) / width,
      y: (region.y + p.y * region.side) / height,
      z: p.z,
      v: p.visibility ?? 1,
    }));
    let world = toPoints(result.worldLandmarks[0] ?? list);
    if (options.mirror) {
      // 거울 영상(연습실 거울 촬영 등): 화면을 뒤집고 왼쪽·오른쪽 점을 바꿉니다.
      image = MIRROR_INDEX.map((j) => ({ ...image[j], x: 1 - image[j].x }));
      world = MIRROR_INDEX.map((j) => ({ ...world[j], x: -world[j].x }));
    }
    const score = image.reduce((sum, p) => sum + p.v, 0) / image.length;
    /*
      어깨·골반 넷 중 하나라도 거의 안 보이면 버립니다. 손에 든 카메라로 흔들리며 찍은 영상에서 번진 사람·나무를 사람으로 보고
      **누운 자세**를 내놓은 일이 있었습니다(2026-09-16 실측). 몸통이 안 보이는 장은 키를 비워 두는 편이 앞뒤 키 사이를 잇는
      보간보다 훨씬 나쁩니다.
    */
    const torsoSeen = Math.min(
      image[LM.leftShoulder].v,
      image[LM.rightShoulder].v,
      image[LM.leftHip].v,
      image[LM.rightHip].v,
    );
    if (score < 0.4 || torsoSeen < 0.35) return null;
    return { image, world, score, look: lookOf(image, frame, sampleContext, Boolean(options.mirror)) };
  };

  /*
    한 자리를 **크기를 바꿔 한두 번 더** 봅니다. 뒤돌거나 몸이 옆 사람과 겹친 장은 관절 모델이 그 크기의 그림에서만 못 잡는
    일이 많았습니다(2026-09-16 실측: 같은 장이 1.4 배 자르기에선 실패, 1.8 배에선 성공). 처음 결과가 넉넉히 확실하면 더 보지 않아
    대부분의 장은 한 번으로 끝납니다.
  */
  const poseAround = (region: Region) => {
    let best = poseIn(region);
    if (best && best.score >= 0.65) return best;
    for (const scale of [1.3, 0.8]) {
      const side = region.side * scale;
      const retry = poseIn({ x: region.x + region.side / 2 - side / 2, y: region.y + region.side / 2 - side / 2, side });
      if (retry && (!best || retry.score > best.score)) best = retry;
      if (best && best.score >= 0.65) break;
    }
    return best;
  };

  const tracker = new PersonTracker(aspect);
  for (const [index, time] of times.entries()) {
    if (options.signal?.aborted) throw new DOMException("취소", "AbortError");
    await seekTo(video, time, options.signal);
    frameContext.drawImage(video, 0, 0, width, height);
    tracker.retire(time);

    // ── 1) 따라가던 사람의 앞 장 자리 ── (거울이면 좌표를 되돌려 원본 화면 자리로)
    const found: FrameDetection[] = [];
    const tracked: Region[] = [];
    tracker.lastImages().forEach((last, trackIndex) => {
      const image = options.mirror ? MIRROR_INDEX.map((j) => ({ ...last[j], x: 1 - last[j].x })) : last;
      const region = regionFromPoints(image, width, height);
      const result = poseAround(region);
      // 못 잡은 자리는 «따라가는 자리» 로 치지 않습니다 — 그래야 사람 찾기 상자가 그 사람을 다시 볼 수 있습니다.
      if (result) {
        tracked.push(region);
        found.push({ ...result, from: trackIndex });
      }
    });
    // ── 2) 새 사람: 따라가는 자리와 겹치지 않는 상자만 ──
    for (const box of detector.people(frame)) {
      const side = Math.max(box.width, box.height) * 1.4;
      const region = { x: box.x + box.width / 2 - side / 2, y: box.y + box.height / 2 - side / 2, side };
      if (tracked.some((other) => overlap(region, other) > 0.5)) continue;
      const result = poseAround(region);
      if (result) found.push({ ...result, from: null });
    }
    tracker.update(time, found);
    options.onProgress?.(index + 1, times.length);
  }

  return {
    width,
    height,
    duration,
    fps: options.fps,
    start,
    end,
    engine: "mediapipe",
    mirrored: Boolean(options.mirror),
    persons: tracker.finish(options.fps, Math.max(1 / options.fps, end - start)),
  };
}

/**
 * **로컬 엔진이 뽑은 결과 파일**(JSON)을 사람별 캡처로 — 장마다 찾은 사람들을 앱 안 검출기와 같은 잇기로 엮습니다.
 *
 * 파일 모양(`resources/local/engines/_mocap.py` 의 `write_result`)
 *
 * { "width", "height", "duration", "fps", "start", "end", "engine",
 * "frames": [ { "t": 초, "people": [ { "image": [[x,y,v]×33], "world": [[x,y,z,v]×33], "score", "look": [6] } ] } ] }
 *
 * 점은 MediaPipe 33점 순서로 맞춰 보냅니다 — 뒤의 떨림 보정·리타깃이 한 벌이라야 엔진을 늘려도 캐릭터 쪽을 안 고칩니다.
 * 미터 좌표는 골반 가운데 원점, x 오른쪽·y 아래·z 카메라에서 멀어지는 쪽(MediaPipe 와 같은 방향).
 */
export function assembleCapture(file: {
  width: number;
  height: number;
  duration: number;
  fps: number;
  start?: number;
  end?: number;
  engine?: string;
  mirror?: boolean;
  frames: {
    t: number;
    people: {
      image: number[][]; world: number[][]; score?: number; look?: number[]; root?: number[];
      hands?: { left?: { image: number[][]; world: number[][] }; right?: { image: number[][]; world: number[][] } };
    }[];
  }[];
}): CaptureResult {
  const aspect = file.width / Math.max(1, file.height);
  const tracker = new PersonTracker(aspect);
  const toImage = (rows: number[][]) => rows.map(([x, y, v]) => ({ x, y, z: 0, v: v ?? 1 }));
  const toWorld = (rows: number[][]) => rows.map(([x, y, z, v]) => ({ x, y, z, v: v ?? 1 }));
  const readHand = (raw: { image: number[][]; world: number[][] } | undefined): CaptureHand | undefined => {
    if (!raw || raw.image?.length !== 21 || raw.world?.length !== 21) return undefined;
    if (!raw.image.every((p) => p.length >= 2 && p.slice(0, 3).every(Number.isFinite)) ||
        !raw.world.every((p) => p.length >= 3 && p.slice(0, 4).every(Number.isFinite))) return undefined;
    const image = toImage(raw.image);
    const world = toWorld(raw.world);
    return file.mirror ? {
      image: image.map((p) => ({ ...p, x: 1 - p.x })),
      world: world.map((p) => ({ ...p, x: -p.x })),
    } : { image, world };
  };
  for (const frame of file.frames) {
    tracker.retire(frame.t);
    tracker.update(
      frame.t,
      frame.people
        .filter((person) => person.image?.length === 33 && person.world?.length === 33)
        .map((person) => {
          let image = toImage(person.image);
          let world = toWorld(person.world);
          if (file.mirror) {
            image = MIRROR_INDEX.map((j) => ({ ...image[j], x: 1 - image[j].x }));
            world = MIRROR_INDEX.map((j) => ({ ...world[j], x: -world[j].x }));
          }
          const root = person.root?.length === 3 ? { x: person.root[0] * (file.mirror ? -1 : 1), y: person.root[1], z: person.root[2] } : undefined;
          const left = readHand(file.mirror ? person.hands?.right : person.hands?.left);
          const right = readHand(file.mirror ? person.hands?.left : person.hands?.right);
          const hands = left || right ? { left, right } : undefined;
          return { image, world, root, hands, score: person.score ?? 1, look: person.look ?? [], from: null };
        }),
    );
  }
  const start = file.start ?? 0;
  const end = file.end ?? file.duration;
  return {
    width: file.width,
    height: file.height,
    duration: file.duration,
    fps: file.fps,
    start,
    end,
    engine: file.engine ?? "",
    mirrored: Boolean(file.mirror),
    persons: tracker.finish(file.fps, Math.max(1 / file.fps, end - start)),
  };
}

/**
 * 떨림 줄이기의 세기. 숫자는 One Euro 필터의 (가장 낮은 차단 주파수 Hz, 속도 민감도).
 * 보통 = 2026-09-16 케이팝 커버 댄스 실측으로 고른 값(아래 `smoothSamples` 주석).
 */
export const SMOOTHING_PRESETS = {
  light: { minCutoff: 2, beta: 15 },
  normal: { minCutoff: 1, beta: 10 },
  strong: { minCutoff: 0.5, beta: 5 },
} as const;
export type SmoothingLevel = keyof typeof SMOOTHING_PRESETS;

/** 한 방향 One Euro — 느리면 세게, 빠르면 약하게 거릅니다. 보이지 않는 점은 앞 값에 가깝게 붙잡습니다. */
function oneEuro(times: number[], values: number[], weights: number[], minCutoff: number, beta: number) {
  const out: number[] = [];
  let previous = 0;
  let previousSpeed = 0;
  const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  for (let i = 0; i < values.length; i += 1) {
    if (i === 0) {
      previous = values[0];
      out.push(previous);
      continue;
    }
    const dt = Math.max(1e-3, times[i] - times[i - 1]);
    const raw = previous + (values[i] - previous) * weights[i];
    const speed = previousSpeed + alpha(1, dt) * ((raw - previous) / dt - previousSpeed);
    const next = previous + alpha(minCutoff + beta * Math.abs(speed), dt) * (raw - previous);
    out.push(next);
    previous = next;
    previousSpeed = speed;
  }
  return out;
}

/**
 * 떨림 줄이기 — 점·좌표마다 **앞뒤로 한 번씩 One Euro 필터**를 걸어 평균합니다(한쪽으로만 걸면 움직임이 늦게 따라옵니다).
 *
 * 검출은 장마다 따로라 가만히 선 사람의 손목도 초당 100~400 픽셀씩 떱니다. 처음엔 가우스 평균(0.06 초)을 썼는데, 떨림을 누르는
 * 만큼 **빠른 동작의 끝이 뭉개졌습니다** — 2026-09-16 케이팝 커버 댄스 실측(초당 30 장, 손목·발목 이동 속도 상위 2 %):
 *
 * | 방식 | 가만히 앉은 사람 | 춤추는 사람 |
 * | 거르지 않음 | 108 / 96 | 3186 / 3699 |
 * | 가우스 0.04 초 | 50 / 177 | 1007 / 1010 |
 * | One Euro (1 Hz, 10) ← | 41 / 105 | 1571 / 1616 |
 *
 * One Euro 는 느린 움직임은 세게, 빠른 움직임은 약하게 걸러서 떨림은 가우스만큼 누르고 빠른 동작은 1.5 배 더 살립니다.
 * 보이는 정도(v)가 낮은 점은 앞 값에 붙잡아, 몸 뒤로 숨은 손이 엉뚱한 자리로 튀지 않게 합니다. 0.2 초 넘게 비는 곳은 따로 거릅니다.
 */
export function smoothSamples(samples: CaptureSample[], level: SmoothingLevel = "normal"): CaptureSample[] {
  if (samples.length < 3) return samples;
  const { minCutoff, beta } = SMOOTHING_PRESETS[level];
  // 0.2 초 넘게 빈 곳에서 끊어 조각마다 거릅니다.
  const pieces: CaptureSample[][] = [];
  for (const sample of samples) {
    const last = pieces[pieces.length - 1];
    if (!last || sample.time - last[last.length - 1].time > 0.2) pieces.push([sample]);
    else last.push(sample);
  }
  const filter = (piece: CaptureSample[], pick: (s: CaptureSample) => CapturePoint[]) => {
    const times = piece.map((s) => s.time);
    const count = pick(piece[0]).length;
    const columns: CapturePoint[][] = piece.map(() => []);
    for (let j = 0; j < count; j += 1) {
      const weights = piece.map((s) => Math.min(1, Math.max(0.1, pick(s)[j].v * 1.4)));
      const axes = (["x", "y", "z"] as const).map((axis) => {
        const values = piece.map((s) => pick(s)[j][axis]);
        const forward = oneEuro(times, values, weights, minCutoff, beta);
        const backward = oneEuro(
          times.map((t) => -t).reverse(),
          [...values].reverse(),
          [...weights].reverse(),
          minCutoff,
          beta,
        ).reverse();
        return forward.map((value, i) => (value + backward[i]) / 2);
      });
      piece.forEach((s, i) => columns[i].push({ x: axes[0][i], y: axes[1][i], z: axes[2][i], v: pick(s)[j].v }));
    }
    return columns;
  };
  return pieces.flatMap((piece) => {
    const image = filter(piece, (s) => s.image);
    const world = filter(piece, (s) => s.world);
    const output = piece.map((sample, i) => ({ ...sample, image: image[i], world: world[i], hands: sample.hands ? { ...sample.hands } : undefined }));
    // 손은 미검출 구간을 넘어 섞지 않습니다. 몸만 보이는 장에 손 데이터를 만들어 넣지 않습니다.
    for (const side of ["left", "right"] as const) {
      let start = 0;
      while (start < piece.length) {
        if (!piece[start].hands?.[side]) { start += 1; continue; }
        let end = start + 1;
        while (end < piece.length && piece[end].hands?.[side]) end += 1;
        const run = piece.slice(start, end);
        const images = filter(run, (s) => s.hands![side]!.image);
        const worlds = filter(run, (s) => s.hands![side]!.world);
        for (let i = start; i < end; i += 1) output[i].hands![side] = { image: images[i - start], world: worlds[i - start] };
        start = end;
      }
    }
    return output;
  });
}

/** 그 시각에 가장 가까운 장(겹쳐 그리기·번호 표시용). 0.3 초 안에 없으면 null. */
export function sampleNear(person: CapturedPerson, time: number): CaptureSample | null {
  let best: CaptureSample | null = null;
  for (const sample of person.samples) {
    if (!best || Math.abs(sample.time - time) < Math.abs(best.time - time)) best = sample;
  }
  return best && Math.abs(best.time - time) <= 0.3 ? best : null;
}
