import { assetSrc } from "./mediaLibrary";
import type { CompositionMusic } from "./composition";

const SAMPLE_RATE = 48_000;

/** 영상 조각의 시작 프레임을 노래 시각으로 옮깁니다. 프레임 경계만 써서 누적 오차를 피합니다. */
export function audioReferenceWindow(firstFrame: number, frames: number, fps: number, offset = 0) {
  return { start: firstFrame / fps + offset, duration: frames / fps };
}

/** 타임라인에 실제로 들리는 구간을 같은 길이의 PCM으로 렌더합니다. 빈 구간은 무음입니다. */
export async function renderReferenceAudio(music: CompositionMusic, firstFrame: number, frames: number, fps: number, signal?: AbortSignal): Promise<AudioBuffer> {
  if (signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
  const src = assetSrc(music.path);
  if (!src) throw new Error("구도잡기 음원 파일을 열 수 없습니다. 음원을 다시 연결하세요.");
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error("구도잡기 음원 파일을 읽지 못했습니다.");
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(await response.arrayBuffer()); }
  finally { await context.close(); }
  if (signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
  const { start, duration } = audioReferenceWindow(firstFrame, frames, fps, music.offset ?? 0);
  const offline = new OfflineAudioContext(Math.min(2, Math.max(1, decoded.numberOfChannels)), Math.max(1, Math.round(duration * SAMPLE_RATE)), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  const delay = Math.max(0, -start);
  if (start < decoded.duration && delay < duration)
    source.start(delay, Math.max(0, start), Math.min(duration - delay, decoded.duration - Math.max(0, start)));
  const audio = await offline.startRendering();
  if (signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
  return audio;
}

/** Magnific에 영상과 별도로 물릴, 그 영상과 길이·시작점이 같은 WAV. */
export function referenceAudioWav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const write = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, frames * channels * 2, true);
  const samples = Array.from({ length: channels }, (_, index) => audio.getChannelData(index));
  let at = 44;
  for (let frame = 0; frame < frames; frame++) for (const channel of samples) {
    const value = Math.max(-1, Math.min(1, channel[frame]));
    view.setInt16(at, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
    at += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}
