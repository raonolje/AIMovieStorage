import { safeFileName, saveProjectMediaAsset } from "@/lib/mediaLibrary";
import type { CapturedPerson, CaptureResult } from "@/lib/motionCapture";
import { t } from "@/lib/i18n";

/**
 * 저장된 모캡 33점을 DWPose/OpenPose 몸 18점 그림으로 변환합니다.
 * 손 21점·얼굴 세부점은 몸 관절에서 복원할 수 없어 이 그림에 추가하지 않습니다.
 * 형식을 맞추는 것과 특정 모델/포즈 로라의 호환성·동작 추적 품질은 별도 검증입니다.
 * 근거: docs/pose-body18-validation.md — 원본 관절 순서·목 중점·색 규약을 함께 기록합니다.
 */
export interface PoseFrameSize {
  width: number;
  height: number;
}

export interface PoseLandmark {
  x: number;
  y: number;
  /** 앱의 저장 형식은 v입니다. visibility만 읽으면 가려진 관절까지 연결됩니다. */
  v?: number;
  visibility?: number;
}

export interface Body18Point {
  x: number;
  y: number;
  confidence: number;
}

/** DWPose draw_bodypose의 18가지 RGB 색. 관절 번호와 선 번호에 각각 적용합니다. */
export const BODY18_COLORS = [
  "#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#aaff00", "#55ff00",
  "#00ff00", "#00ff55", "#00ffaa", "#00ffff", "#00aaff", "#0055ff",
  "#0000ff", "#5500ff", "#aa00ff", "#ff00ff", "#ff00aa", "#ff0055",
] as const;

/** 원본 limbSeq의 첫 17개만 그립니다. 마지막 두 어깨–귀 선은 원본도 그리지 않습니다. */
export const BODY18_CONNECTIONS = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9],
  [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16],
  [0, 15], [15, 17],
] as const;

const VISIBLE_ENOUGH = 0.3;

/** 몸 18점 순서: 코·목·오른팔·왼팔·오른다리·왼다리·양 눈·양 귀. */
export function captureToBody18(points: ReadonlyArray<PoseLandmark | null | undefined>): Array<Body18Point | null> {
  const read = (index: number): Body18Point | null => {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const confidence = point.v ?? point.visibility ?? 1;
    if (!Number.isFinite(confidence) || confidence <= VISIBLE_ENOUGH) return null;
    return { x: point.x, y: point.y, confidence };
  };
  const leftShoulder = read(11);
  const rightShoulder = read(12);
  // 원본 DWPose처럼 양 어깨가 모두 보일 때만 목 중점을 만듭니다. 한쪽을 추측하지 않습니다.
  const neck = leftShoulder && rightShoulder ? {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    confidence: Math.min(leftShoulder.confidence, rightShoulder.confidence),
  } : null;
  return [read(0), neck, rightShoulder, read(14), read(16), leftShoulder, read(13), read(15),
    read(24), read(26), read(28), read(23), read(25), read(27), read(5), read(2), read(8), read(7)];
}

/** 원본은 선을 그린 뒤 0.6배로 어둡게 합니다. 관절은 원색이라 관절과 선을 구분할 수 있습니다. */
function limbColor(color: string): string {
  return `#${[1, 3, 5].map((start) => Math.floor(parseInt(color.slice(start, start + 2), 16) * 0.6).toString(16).padStart(2, "0")).join("")}`;
}

/** mirror는 화면 좌표만 뒤집습니다. 좌우 신체 부위의 번호·색은 바꾸지 않습니다. */
export function drawPoseFrame(
  ctx: CanvasRenderingContext2D,
  size: PoseFrameSize,
  points: ReadonlyArray<PoseLandmark | null | undefined>,
  mirror = false,
) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size.width, size.height);
  const body = captureToBody18(points);
  const toX = (x: number) => (mirror ? 1 - x : x) * size.width;
  const toY = (y: number) => y * size.height;

  // DWPose는 반두께 4px인 타원형 선 다음에 반지름 4px 관절을 그립니다.
  // Canvas와 OpenCV의 가장자리 래스터화는 다르지만 순서·연결·RGB 규약은 같습니다.
  BODY18_CONNECTIONS.forEach(([a, b], index) => {
    const from = body[a];
    const to = body[b];
    if (!from || !to) return;
    const x1 = toX(from.x), y1 = toY(from.y), x2 = toX(to.x), y2 = toY(to.y);
    ctx.fillStyle = limbColor(BODY18_COLORS[index]);
    ctx.beginPath();
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.hypot(x2 - x1, y2 - y1) / 2, 4, Math.atan2(y2 - y1, x2 - x1), 0, Math.PI * 2);
    ctx.fill();
  });
  body.forEach((point, index) => {
    if (!point) return;
    ctx.fillStyle = BODY18_COLORS[index];
    ctx.beginPath();
    ctx.arc(toX(point.x), toY(point.y), 4, 0, Math.PI * 2);
    ctx.fill();
  });
}
/** 이 사람이 그 시각에 어디 있었나. 가장 가까운 장을 씁니다. */
function sampleAt(person: CapturedPerson, time: number) {
  return person.samples.reduce(
    (best, sample) =>
      Math.abs(sample.time - time) < Math.abs(best.time - time) ? sample : best,
    person.samples[0],
  );
}

export interface PoseFrameSet {
  /** 구운 프레임들의 경로. **차례가 곧 시간**입니다. */
  frames: string[];
  fps: number;
  seconds: number;
  width: number;
  height: number;
  /** 원본 영상의 반열린 구간 [시작, 끝). 출력 첫 장은 이 시작 시각입니다. */
  sourceStartSeconds: number;
  sourceEndSeconds: number;
}

/**
 * 모캡 결과 한 사람을 **프레임 그림 여러 장**으로 굽습니다.
 *
 * # 왜 영상이 아니라 그림 여러 장인가
 *
 * 브라우저에서 영상으로 묶으려면 `MediaRecorder` 를 써야 하는데, 그러면 webm 으로
 * 다시 압축됩니다. 압축이 선을 뭉개면 컨트롤넷이 읽는 신호가 흐려집니다. 그림은 **그린
 * 그대로** 남고, 파이썬 쪽에서 읽어 이어 붙이면 됩니다.
 *
 * 분석 좌표에는 이미 반전과 좌우 관절 교환이 적용되어 있습니다. 여기서 다시 뒤집지 않습니다.
 */
export async function bakePoseFrames(input: {
  projectName: string;
  /** 폴더 주인 — 그 모캡 영상 이름(규칙 5). */
  ownerName: string;
  result: CaptureResult;
  /** 몇 번 사람인가. `CapturedPerson.number`. */
  personNumber: number;
  /** 생략하면 분석 시작. 생성 영상의 seconds 옵션과는 별개의 원본 시각입니다. */
  sourceStartSeconds?: number;
  /** 생략하면 선택 시작부터 분석 끝까지. 범위를 벗어나면 줄이지 않고 거절합니다. */
  durationSeconds?: number;
  /** 뽑을 크기. 생성할 크기와 같게 주는 것이 가장 잘 맞습니다. */
  size?: PoseFrameSize;
  /** 초당 몇 장. 안 주면 분석할 때의 간격 그대로. */
  fps?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<PoseFrameSet> {
  const person = input.result.persons.find((item) => item.number === input.personNumber);
  if (!person?.samples.length) throw new Error("그 사람의 분석 결과가 없습니다.");

  const { start, end } = input.result;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
    throw new Error(t("모캡 분석의 시간 범위가 올바르지 않습니다."));
  const sourceStartSeconds = input.sourceStartSeconds ?? start;
  if (!Number.isFinite(sourceStartSeconds) || sourceStartSeconds < start || sourceStartSeconds >= end)
    throw new Error(t("포즈 시작 시각은 모캡 분석 구간 안에 있어야 합니다."));
  if (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0))
    throw new Error(t("포즈 구간 길이는 0보다 큰 유한한 초여야 합니다."));
  const sourceEndSeconds = input.durationSeconds === undefined ? end : sourceStartSeconds + input.durationSeconds;
  if (!Number.isFinite(sourceEndSeconds) || sourceEndSeconds > end || sourceEndSeconds <= sourceStartSeconds)
    throw new Error(t("포즈 구간이 모캡 분석 범위를 벗어났습니다."));
  const fps = input.fps ?? input.result.fps;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(t("포즈 출력 FPS는 0보다 큰 유한한 수여야 합니다."));
  const seconds = sourceEndSeconds - sourceStartSeconds;
  const count = Math.max(1, Math.round(seconds * fps));
  if (!Number.isSafeInteger(count)) throw new Error(t("포즈 프레임 수가 올바르지 않습니다."));
  // 검출 공백의 가장 가까운 점을 고르더라도 선택한 구간 밖의 동작은 가져오지 않습니다.
  const selectedPerson = { ...person, samples: person.samples.filter(sample =>
    Number.isFinite(sample.time) && sample.time >= sourceStartSeconds && sample.time < sourceEndSeconds,
  ) };
  if (!selectedPerson.samples.length) throw new Error(t("선택한 구간에 그 사람의 모캡 표본이 없습니다."));

  /*
    크기는 **32의 배수**로 맞춥니다. 영상 모델은 대개 그렇게 요구하고, 컨트롤넷 그림이
    생성 크기와 한 칸이라도 다르면 늘려 맞추다가 뼈가 어긋납니다.
  */
  const round32 = (value: number) => Math.max(32, Math.round(value / 32) * 32);
  const size = input.size ?? {
    width: round32(input.result.width),
    height: round32(input.result.height),
  };

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("그림을 그릴 자리를 만들지 못했습니다.");

  const frames: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = sourceStartSeconds + index / fps;
    drawPoseFrame(ctx, size, sampleAt(selectedPerson, time).image);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("뼈 그림을 굽지 못했습니다.");
    /*
      이름에 **번호를 채워** 둡니다(`_0001`). 파이썬이 폴더를 읽어 이어 붙일 때 이름
      차례가 곧 시간 차례라야 합니다 — `_10` 이 `_2` 보다 앞에 오면 춤이 뒤죽박죽입니다.
    */
    const stem = `${safeFileName(input.ownerName)}_포즈${input.personNumber}_${String(index + 1).padStart(4, "0")}`;
    const saved = await saveProjectMediaAsset(new File([blob], `${stem}.png`, { type: "image/png" }), {
      projectName: input.projectName,
      assetType: "mocap-video",
      ownerName: input.ownerName,
      stem,
    });
    if (!saved?.path) throw new Error("뼈 그림을 폴더에 놓지 못했습니다.");
    frames.push(saved.path);
    input.onProgress?.(index + 1, count);
  }

  return { frames, fps, seconds, width: size.width, height: size.height, sourceStartSeconds, sourceEndSeconds };
}
