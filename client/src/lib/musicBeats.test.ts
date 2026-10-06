import { describe, expect, it } from "vitest";
import { analyzeMusicSamples } from "./musicBeats";

describe("음원 박자 초안", () => {
  it("2초 뒤 시작하는 120 BPM 클릭을 음원 시각으로 돌려준다", () => {
    const rate = 8_000;
    const samples = new Float32Array(rate * 12);
    for (let beat = 0; beat < 20; beat++) {
      const first = Math.round((2 + beat * 0.5) * rate);
      for (let i = 0; i < 180; i++) samples[first + i] = Math.exp(-i / 35) * (i % 2 ? -1 : 1);
    }
    const found = analyzeMusicSamples([samples], rate);
    expect(found.bpm).toBeGreaterThan(116);
    expect(found.bpm).toBeLessThan(124);
    expect(found.beats.some(beat => Math.abs(beat - 2) < 0.08)).toBe(true);
    expect(found.beats[0]).toBeGreaterThan(1.9);
    const inverted = Float32Array.from(samples, value => -value);
    expect(analyzeMusicSamples([samples, inverted], rate).bpm).toBe(found.bpm);
  });

  it("무음에는 임의 박자를 지어내지 않는다", () => {
    expect(() => analyzeMusicSamples([new Float32Array(8_000 * 4)], 8_000)).toThrow(/박자/);
  });

  it.each([90, 150])("%i BPM을 120 BPM으로 뭉개지 않는다", bpm => {
    const rate = 8_000;
    const samples = new Float32Array(rate * 12);
    for (let beat = 0; beat < 14; beat++) {
      const first = Math.round((1 + beat * 60 / bpm) * rate);
      for (let i = 0; i < 160; i++) samples[first + i] = Math.exp(-i / 30);
    }
    expect(analyzeMusicSamples([samples], rate).bpm).toBeCloseTo(bpm, 0);
  });
});
