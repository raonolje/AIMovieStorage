import type { RetargetFrame } from "./motionRetarget";

export interface DancePhrase { start: number; end: number }

/** Repeat a short phrase near its native tempo; fit whole cycles to the saved song sections. */
export function fitDancePhrase(frames: RetargetFrame[], phrases: DancePhrase[]): RetargetFrame[] {
  if (frames.length < 2 || phrases.length === 0) throw new Error("동작 표본과 노래 구간이 필요합니다.");
  const first = frames[0].time;
  const length = frames[frames.length - 1].time - first;
  if (!Number.isFinite(length) || length <= 0 || frames.some((frame, index) =>
    !Number.isFinite(frame.time) || (index > 0 && frame.time <= frames[index - 1].time)) || phrases.some(item =>
    !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start))
    throw new Error("동작 또는 노래 구간의 시각이 올바르지 않습니다.");
  const ordered = [...phrases].sort((a, b) => a.start - b.start);
  if (ordered.some((item, index) => index > 0 && item.start < ordered[index - 1].end - 1e-4))
    throw new Error("노래 구간이 겹칩니다.");
  const result: RetargetFrame[] = [];
  for (const phrase of ordered) {
    const sectionLength = phrase.end - phrase.start;
    const cycles = Math.max(1, Math.round(sectionLength / length));
    if (result.length + frames.length * cycles > 18000)
      throw new Error("동작 키가 18,000개를 넘습니다. 구간을 나눠 적용하세요.");
    const cycleLength = sectionLength / cycles;
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (const frame of frames) {
        const time = Math.round((phrase.start + cycle * cycleLength +
          (frame.time - first) / length * cycleLength) * 10000) / 10000;
        // At a loop seam the next first pose replaces the previous last pose.
        if (result.length && time === result[result.length - 1].time) result.pop();
        if (result.length && time < result[result.length - 1].time) continue;
        result.push({ ...frame, time });
      }
    }
  }
  return result;
}
