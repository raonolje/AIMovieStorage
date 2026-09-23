import { safeFileName, saveProjectMediaAsset } from "@/lib/mediaLibrary";
import { CAPTURE_CONNECTIONS, type CapturedPerson, type CaptureResult } from "@/lib/motionCapture";

/**
 * **모캡 → 포즈 프레임** — 컨트롤넷이 읽는 뼈 그림을 굽습니다.
 *
 *
 *
 * 맞습니다. 다만 컨트롤넷에 넘길 것은 **원본 영상이 아니라 뼈 그림**입니다. 원본을 그대로
 * 주면 모델이 그 사람의 얼굴·옷까지 따라 그려서, 「캐릭터만 바꾼 댄스 커버」 가 아니라
 * 「원본을 조금 흐린 것」 이 나옵니다.
 *
 * # 왜 검은 바탕에 색 선인가
 *
 * OpenPose 계열 컨트롤넷은 **선의 색으로 어느 뼈인지**를 읽습니다. 모두 흰 선으로 그리면
 * 팔과 다리를 구분하지 못해 사지가 뒤엉킵니다. 그래서 OpenPose 의 색 차례를 그대로 씁니다.
 *
 * 바탕은 **완전한 검정**입니다 — 컨트롤넷은 밝은 획만 신호로 봅니다. 회색 바탕을 주면
 * 그 회색도 「무언가 있다」 로 읽힙니다.
 *
 * # 사람 하나만 굽습니다
 *
 * 여럿을 한 장에 그리면 모델이 누가 누구인지 몰라 팔다리를 섞습니다. 댄스 커버처럼
 * 「이 사람의 동작」 을 옮길 때는 **그 사람만** 굽는 것이 맞습니다.
 */

/** 그림 하나를 만들 때 쓸 크기. 컨트롤넷은 생성 크기와 같아야 제일 잘 맞습니다. */
export interface PoseFrameSize {
  width: number;
  height: number;
}

/**
 * OpenPose 의 뼈 색 — **차례가 뜻입니다.**
 *
 * `CAPTURE_CONNECTIONS` 의 줄 차례와 짝을 맞춥니다. 원래 OpenPose 는 18점(COCO)인데
 * 미디어파이프는 33점이라 점 번호가 다릅니다. 색은 «몸통·오른팔·왼팔·오른다리·왼다리»
 * 라는 **덩어리**만 맞으면 컨트롤넷이 알아봅니다 — 한 뼈씩 정확히 맞출 필요는 없습니다.
 */
const BONE_COLORS: string[] = [
  "#ff0000", // 어깨 (11-12) — 몸통
  "#ff5500", // 오른 위팔
  "#ffaa00", // 오른 아래팔
  "#aaff00", // 왼 위팔
  "#55ff00", // 왼 아래팔
  "#00ff00", // 오른 옆구리
  "#00ff55", // 왼 옆구리
  "#00ffaa", // 골반
  "#00aaff", // 오른 허벅지
  "#0055ff", // 오른 정강이
  "#0000ff", // 오른 발
  "#5500ff", // 왼 허벅지
  "#aa00ff", // 왼 정강이
  "#ff00aa", // 왼 발
  "#ff0055", // 오른손
  "#ff00ff", // 왼손
  "#aa5500", // 오른 귀
  "#55aa00", // 왼 귀
];

/** 점 색 — 관절은 뼈보다 밝게. 컨트롤넷이 이음매를 또렷이 읽습니다. */
const JOINT_COLOR = "#ffffff";

/** 안 보이는 점은 안 그립니다. 가려진 팔을 이으면 없는 자세가 만들어집니다. */
const VISIBLE_ENOUGH = 0.3;

/**
 * 한 사람의 한 순간을 뼈 그림으로.
 *
 * @param mirror 분석할 때 좌우를 뒤집었으면 되돌려 그립니다 — 그림은 **원본 화면 자리**여야
 * 나중에 배경과 겹칠 때 어긋나지 않습니다.
 */
export function drawPoseFrame(
  ctx: CanvasRenderingContext2D,
  size: PoseFrameSize,
  points: { x: number; y: number; visibility?: number }[],
  mirror = false,
) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size.width, size.height);

  const toX = (x: number) => (mirror ? 1 - x : x) * size.width;
  const toY = (y: number) => y * size.height;
  const seen = (index: number) => (points[index]?.visibility ?? 1) >= VISIBLE_ENOUGH;

  // 선이 먼저, 점이 나중 — 점이 이음매를 덮어야 관절이 또렷합니다.
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, Math.round(size.height / 90));
  CAPTURE_CONNECTIONS.forEach(([a, b], index) => {
    if (!seen(a) || !seen(b)) return;
    ctx.strokeStyle = BONE_COLORS[index % BONE_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(toX(points[a].x), toY(points[a].y));
    ctx.lineTo(toX(points[b].x), toY(points[b].y));
    ctx.stroke();
  });

  ctx.fillStyle = JOINT_COLOR;
  const dot = Math.max(2, Math.round(size.height / 160));
  points.forEach((point, index) => {
    if (!seen(index)) return;
    ctx.beginPath();
    ctx.arc(toX(point.x), toY(point.y), dot, 0, Math.PI * 2);
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
 * @param mirror 분석할 때 좌우를 뒤집었는가.
 */
export async function bakePoseFrames(input: {
  projectName: string;
  /** 폴더 주인 — 그 모캡 영상 이름(규칙 5). */
  ownerName: string;
  result: CaptureResult;
  /** 몇 번 사람인가. `CapturedPerson.number`. */
  personNumber: number;
  mirror?: boolean;
  /** 뽑을 크기. 생성할 크기와 같게 주는 것이 가장 잘 맞습니다. */
  size?: PoseFrameSize;
  /** 초당 몇 장. 안 주면 분석할 때의 간격 그대로. */
  fps?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<PoseFrameSet> {
  const person = input.result.persons.find((item) => item.number === input.personNumber);
  if (!person?.samples.length) throw new Error("그 사람의 분석 결과가 없습니다.");

  /*
    크기는 **32의 배수**로 맞춥니다. 영상 모델은 대개 그렇게 요구하고, 컨트롤넷 그림이
    생성 크기와 한 칸이라도 다르면 늘려 맞추다가 뼈가 어긋납니다.
  */
  const round32 = (value: number) => Math.max(32, Math.round(value / 32) * 32);
  const size = input.size ?? {
    width: round32(input.result.width),
    height: round32(input.result.height),
  };

  const fps = input.fps ?? input.result.fps;
  const seconds = Math.max(0, input.result.end - input.result.start);
  const count = Math.max(1, Math.round(seconds * fps));

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("그림을 그릴 자리를 만들지 못했습니다.");

  const frames: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = input.result.start + index / fps;
    drawPoseFrame(ctx, size, sampleAt(person, time).image, input.mirror);
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

  return { frames, fps, seconds, width: size.width, height: size.height };
}
