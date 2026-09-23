import { ArrayBufferTarget, Muxer } from "mp4-muxer";

/**
 * 레퍼런스 영상 인코딩.
 *
 * 화면에 보이는 것을 그대로 녹화하는 방식(MediaRecorder + captureStream)은
 * 벽시계 기준으로 타임스탬프를 찍습니다. 렌더가 한 프레임이라도 늦으면
 * 그만큼 영상이 늘어나거나 프레임이 빠집니다.
 *
 * 여기서는 반대로 갑니다. 프레임을 하나씩 직접 그려서 정확한 타임스탬프와 함께
 * 인코더에 밀어 넣습니다. 렌더가 느려도 결과물의 길이와 프레임 수는 항상 정확합니다.
 * 대신 실시간보다 오래 걸릴 수 있어 진행률을 돌려줍니다.
 */
export interface ReferenceVideoOptions {
  width: number;
  height: number;
  fps: number;
  /** 초 단위 길이 */
  duration: number;
  /**
   * 해당 시각의 화면을 그리고 결과가 담긴 캔버스를 돌려줍니다.
   *
   * **기다릴 수 있습니다.** 배경에 건 영상은 되감기가 끝나야 그 프레임이 올라와서, 그리는 쪽이
   * 먼저 기다린 뒤 그려야 합니다 — 안 기다리면 배경만 한 프레임씩 밀린 영상이 나옵니다.
   */
  drawFrame: (time: number, index: number) => HTMLCanvasElement | Promise<HTMLCanvasElement>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ReferenceVideoResult {
  blob: Blob;
  frameCount: number;
  codec: string;
}

/**
 * 나눠 뽑기의 **조각 경계**. 길이로 나누든(5·10·15·30초·1·2분) 노래 구간으로 나누든 여기서 한 꼴이 됩니다.
 *
 * ,
 * 「AI 영상은 기본 14초 단위니까, 연장하는 건 비용이 크게 뛰니까」.
 *
 * 경계는 **프레임 번호**로 셉니다. 초를 더해 가며 자르면 조각마다 한 프레임씩 밀리거나 겹쳐서, 이어 붙였을 때
 * 통째로 뽑은 것과 길이가 달라집니다. 조각 k 의 i 번째 프레임 = 전체의 k×조각프레임+i 번째입니다.
 *
 * 훅이 아니라 여기 둔 이유는 **이 계산만 따로 검증**하기 위해서입니다(3D 화면 없이 돌려 볼 수 있어야 합니다).
 */
export function splitParts(
  /** 조각 길이(초) 또는 자를 시각들(초, 노래 구간 경계). null 이면 통째로 한 조각. */
  splitSeconds: number | number[] | null,
  totalFrames: number,
  fps: number,
): { firstFrame: number; frames: number }[] {
  const total = Math.max(1, Math.round(totalFrames));
  const parts: { firstFrame: number; frames: number }[] = [];
  if (Array.isArray(splitSeconds)) {
    // 노래 구간 경계 — 0 과 끝을 넣고, 타임라인 밖은 버립니다(노래가 타임라인보다 길 수 있습니다).
    const edges = [...new Set([0, ...splitSeconds.map((value) => Math.round(value * fps)), total])]
      .filter((frame) => frame >= 0 && frame <= total)
      .sort((a, b) => a - b);
    parts.push(
      ...edges
        .slice(1)
        .map((edge, index) => ({ firstFrame: edges[index], frames: edge - edges[index] }))
        .filter((part) => part.frames > 0),
    );
  } else if (splitSeconds) {
    const partFrames = Math.max(1, Math.round(splitSeconds * fps));
    parts.push(
      ...Array.from({ length: Math.ceil(total / partFrames) }, (_, index) => {
        const firstFrame = index * partFrames;
        return { firstFrame, frames: Math.min(partFrames, total - firstFrame) };
      }),
    );
  }
  if (!parts.length) parts.push({ firstFrame: 0, frames: total });
  return parts;
}

/** WebCodecs 는 최신 브라우저·WebView 에서만 씁니다. */
export function isReferenceVideoSupported() {
  return typeof window !== "undefined" && typeof (window as { VideoEncoder?: unknown }).VideoEncoder === "function";
}

/**
 * 호환성 넓은 순서가 아니라 화질 좋은 순서입니다.
 * High 프로필이 안 되는 환경에서만 아래로 내려갑니다.
 */
const CODEC_CANDIDATES = ["avc1.640033", "avc1.640028", "avc1.4d0028", "avc1.42001f"];

async function pickCodec(width: number, height: number, fps: number, bitrate: number) {
  for (const codec of CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate });
      if (support.supported) return codec;
    } catch {
      // 이 코덱 문자열을 모르는 환경입니다. 다음 후보로 넘어갑니다.
    }
  }
  return null;
}

/** H.264 는 가로세로가 짝수여야 합니다. */
function toEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** 숨겨진 WebView에서 rAF가 멈춰도 외부 조종 작업이 영원히 대기하지 않게 합니다. */
function yieldEncoder() {
  return new Promise<void>(resolve => {
    let frame: number | undefined;
    const done = () => {
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      resolve();
    };
    const timer = setTimeout(done, 16);
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(done);
  });
}

/** flush가 긴 환경에서도 취소가 큐를 붙잡지 않게 하고 finally에서 인코더를 닫습니다. */
function finishEncoding(pending: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("취소했습니다.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export async function renderReferenceVideo(options: ReferenceVideoOptions): Promise<ReferenceVideoResult> {
  if (!isReferenceVideoSupported()) {
    throw new Error("이 환경에서는 영상 인코딩(WebCodecs)을 쓸 수 없습니다.");
  }

  const width = toEven(options.width);
  const height = toEven(options.height);
  const fps = Math.max(1, Math.round(options.fps));
  const frameCount = Math.max(1, Math.round(options.duration * fps));

  // 참고용 영상이라 과하게 큰 파일은 필요 없지만, 카메라가 크게 움직이면
  // 비트레이트가 낮을 때 블록이 심하게 보입니다. 해상도·프레임률에 비례해 잡습니다.
  const bitrate = Math.min(40_000_000, Math.max(2_000_000, Math.round(width * height * fps * 0.09)));

  const codec = await pickCodec(width, height, fps, bitrate);
  if (!codec) throw new Error("이 환경에서 쓸 수 있는 H.264 인코더를 찾지 못했습니다.");

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: fps },
    // 파일을 다 만든 뒤 헤더를 앞으로 옮깁니다. 어디서든 바로 재생됩니다.
    fastStart: "in-memory",
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: error => { encodeError = error instanceof Error ? error : new Error(String(error)); },
  });
  encoder.configure({ codec, width, height, framerate: fps, bitrate, latencyMode: "quality" });

  const microsecondsPerFrame = 1_000_000 / fps;
  // 2초마다 키프레임. 편집 프로그램에서 스크럽할 때 반응이 빨라집니다.
  const keyFrameInterval = fps * 2;

  try {
    for (let index = 0; index < frameCount; index += 1) {
      if (options.signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
      if (encodeError) throw encodeError;

      const canvas = await options.drawFrame(index / fps, index);
      if (options.signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(index * microsecondsPerFrame),
        duration: Math.round(microsecondsPerFrame),
      });
      try { encoder.encode(frame, { keyFrame: index % keyFrameInterval === 0 }); }
      finally { frame.close(); }

      // 인코더가 밀리면 메모리에 프레임이 쌓입니다. 큐가 길어지면 잠깐 기다립니다.
      while (encoder.encodeQueueSize > 8) {
        await new Promise(resolve => setTimeout(resolve, 4));
        if (options.signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
        if (encodeError) throw encodeError;
      }

      options.onProgress?.(index + 1, frameCount);
      // 화면이 완전히 얼어붙지 않도록 몇 프레임마다 한 번씩 넘겨줍니다.
      if (index % 3 === 0) await yieldEncoder();
    }

    await finishEncoding(encoder.flush(), options.signal);
    if (options.signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
    if (encodeError) throw encodeError;
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: "video/mp4" }), frameCount, codec };
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}
