import { assetSrc } from "./mediaLibrary";
import { analyzeMusicSamples, type MusicBeatAnalysis } from "./musicBeatAnalysis";
export { analyzeMusicSamples } from "./musicBeatAnalysis";

/** UI와 조종기가 같은 파일 디코더·분석기를 사용합니다. */
export async function analyzeMusicFile(path: string, signal?: AbortSignal): Promise<MusicBeatAnalysis> {
  const src = assetSrc(path);
  if (!src) throw new Error("음원 파일을 열 수 없습니다.");
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error("음원 파일을 읽을 수 없습니다.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    if (signal?.aborted) throw new DOMException("취소했습니다.", "AbortError");
    return analyzeMusicSamples(Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)), decoded.sampleRate);
  } finally { await context.close(); }
}
