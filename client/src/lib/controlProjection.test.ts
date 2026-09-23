import { describe, expect, it } from "vitest";
import { projectControlValue } from "./controlProjection";

describe("조종기 요약 응답", () => {
  it("작은 카메라 키는 유지하고 큰 동작 키만 명시적으로 생략한다", () => {
    const camera = [{ id: "move", customKeys: [{ id: "camera-key", time: 3, pose: { fov: 45 } }] }];
    const input = { cameraMoves: camera, motionTracks: [{ id: "pose", keys: Array.from({ length: 1983 }, (_, time) => ({ id: `p-${time}`, time: time / 30 })) }] };
    const output = projectControlValue(input, "summary");
    expect(output.value.cameraMoves[0].customKeys).toEqual(camera[0].customKeys);
    expect(output.value.motionTracks[0]).toMatchObject({ id: "pose", keys: [], keyCount: 1983, keyTimeRange: [0, 1982 / 30] });
    expect(output.projection.omitted).toContainEqual({ path: "/motionTracks/0/keys", reason: "keyframes", count: 1983, firstTime: 0, lastTime: 1982 / 30 });
    expect(input.motionTracks[0].keys).toHaveLength(1983);
  });
  it("큰 글·중첩 배열도 요약 예산 안에 두며 생략 여부를 알린다", () => {
    const input = { items: Array.from({ length: 300 }, () => ({ note: "가\"".repeat(10_000) })) };
    const output = projectControlValue(input, "summary");
    expect(new TextEncoder().encode(JSON.stringify(output)).length).toBeLessThan(1_000_000);
    expect(output.projection.truncated).toBe(true);
    expect(output.projection.omitted).toContainEqual(expect.objectContaining({ path: "/items", count: 300 }));
  });
});
