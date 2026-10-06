import { describe, expect, it } from "vitest";
import { fitDancePhrase } from "./musicChoreographyTiming";
import type { RetargetFrame } from "./motionRetarget";

const frame = (time: number): RetargetFrame => ({ time, root: { x: 0, y: 0, z: 0 }, yaw: 0, bones: {} });

describe("음악 구간에 동작 배치", () => {
  it("한 동작을 두 구간에 맞추고 시간·원본 키를 보존한다", () => {
    const source = [frame(2), frame(2.5), frame(3)];
    const placed = fitDancePhrase(source, [{ start: 8, end: 10 }, { start: 12, end: 15 }]);
    expect(placed.map(item => item.time)).toEqual([8, 8.5, 9, 9.5, 10, 12, 12.5, 13, 13.5, 14, 14.5, 15]);
    expect(source.map(item => item.time)).toEqual([2, 2.5, 3]);
  });

  it("겹치는 구간과 길이가 없는 동작을 거절한다", () => {
    expect(() => fitDancePhrase([frame(1), frame(1)], [{ start: 0, end: 4 }])).toThrow();
    expect(() => fitDancePhrase([frame(0), frame(2), frame(1)], [{ start: 0, end: 4 }])).toThrow();
    expect(() => fitDancePhrase([frame(0), frame(1)], [{ start: 0, end: 2 }, { start: 1, end: 3 }])).toThrow();
  });
});
