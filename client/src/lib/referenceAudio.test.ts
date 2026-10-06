import { describe, expect, it } from "vitest";
import { audioReferenceWindow, referenceAudioWav } from "./referenceAudio";

describe("구도 영상과 음원 조각의 공유 시계", () => {
  it("15초 조각마다 노래 오프셋과 프레임 경계를 함께 적용한다", () => {
    expect(audioReferenceWindow(0, 360, 24, 7.5)).toEqual({ start: 7.5, duration: 15 });
    expect(audioReferenceWindow(360, 360, 24, 7.5)).toEqual({ start: 22.5, duration: 15 });
    expect(audioReferenceWindow(720, 117, 24, 7.5)).toEqual({ start: 37.5, duration: 117 / 24 });
    expect(audioReferenceWindow(0, 360, 24, 0, 5)).toEqual({ start: -5, duration: 15 });
  });

  it("별도 레퍼런스 WAV가 길이·채널·표본을 보존한다", async () => {
    const left = new Float32Array([0, 1, -1]);
    const right = new Float32Array([0.5, -0.5, 0]);
    const blob = referenceAudioWav({ numberOfChannels: 2, length: 3, sampleRate: 48_000,
      getChannelData: index => index === 0 ? left : right } as AudioBuffer);
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(44 + 3 * 2 * 2);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });
});
