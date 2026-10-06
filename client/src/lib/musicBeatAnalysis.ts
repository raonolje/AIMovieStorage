export interface MusicBeatAnalysis {
  bpm: number;
  /** 음원 자체의 시각입니다. 타임라인 시각은 music.offset을 빼서 구합니다. */
  beats: number[];
  /** 0~1. 낮으면 박자를 확정하지 말고 사람이 확인해야 합니다. */
  confidence: number;
}

const ANALYSIS_RATE = 100;
const MIN_BPM = 60;
const MAX_BPM = 200;

/** 가벼운 국소 에너지 분석. 생성된 음악도 같은 계산으로 다루고 원본 파일은 바꾸지 않습니다. */
export function analyzeMusicSamples(channels: readonly Float32Array[], sampleRate: number): MusicBeatAnalysis {
  if (!channels.length || sampleRate <= 0 || !Number.isFinite(sampleRate)) throw new Error("음원 표본을 읽을 수 없습니다.");
  const length = Math.min(...channels.map(channel => channel.length));
  const hop = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
  const count = Math.floor(length / hop);
  if (count < ANALYSIS_RATE * 2) throw new Error("박자를 분석하려면 2초 이상의 음원이 필요합니다.");

  const energy = new Float64Array(count);
  for (let frame = 0; frame < count; frame++) {
    let sum = 0;
    for (let at = frame * hop; at < (frame + 1) * hop; at++) {
      // Stereo tracks can contain phase-inverted channels; summing first would erase real drums.
      for (const channel of channels) sum += channel[at] * channel[at] / channels.length;
    }
    energy[frame] = Math.sqrt(sum / hop);
  }

  const novelty = new Float64Array(count);
  for (let i = 1; i < count; i++) {
    const previous = Math.max(energy[i - 1], energy[Math.max(0, i - 2)]);
    novelty[i] = Math.max(0, Math.log1p(energy[i] * 100) - Math.log1p(previous * 100));
  }
  // 짧은 충격음 하나가 여러 분석 칸에 걸쳐도 한 박으로 셉니다.
  const onset = new Float64Array(count);
  for (let i = 0; i < count; i++) onset[i] = Math.max(novelty[i], novelty[Math.min(count - 1, i + 1)]);

  let bestLag = 0;
  let bestScore = -Infinity;
  const minLag = Math.round(60 * ANALYSIS_RATE / MAX_BPM);
  const maxLag = Math.round(60 * ANALYSIS_RATE / MIN_BPM);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = lag; i < count; i++) score += onset[i] * onset[i - lag];
    // 2배/절반 빠르기의 해석이 비슷할 때만 일반적인 춤 템포에 약하게 우선권을 줍니다.
    score *= 1 - Math.abs(120 - 60 * ANALYSIS_RATE / lag) / 1200;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore <= 1e-7) throw new Error("뚜렷한 박자를 찾지 못했습니다. BPM을 직접 입력하세요.");

  let phase = 0;
  let phaseScore = -Infinity;
  for (let candidate = 0; candidate < bestLag; candidate++) {
    let score = 0;
    for (let at = candidate; at < count; at += bestLag) {
      for (let delta = -2; delta <= 2; delta++) score += onset[Math.max(0, Math.min(count - 1, at + delta))] / (1 + Math.abs(delta));
    }
    if (score > phaseScore) { phaseScore = score; phase = candidate; }
  }
  const beats: number[] = [];
  const strongest = onset.reduce((max, value) => Math.max(max, value), 0);
  const firstAudible = onset.findIndex(value => value >= strongest * 0.15);
  for (let at = phase; at < count; at += bestLag) {
    if (at + 2 < firstAudible) continue;
    beats.push(Math.round(at / ANALYSIS_RATE * 1000) / 1000);
  }
  const total = onset.reduce((sum, value) => sum + value, 0);
  const confidence = Math.max(0, Math.min(1, phaseScore / Math.max(1e-9, total) * 2));
  return { bpm: Math.round(60 * ANALYSIS_RATE / bestLag * 10) / 10, beats, confidence };
}
