import { describe, expect, it } from "vitest";
import { normalizeComposition, type MotionTrack, type Vector3Value } from "./composition";
import { addMannequinIn, applyCapturedMotionIn, evaluatePoseTrack } from "./compositionEdit";

const id = "finger-keys";
const zero = { x: 0, y: 0, z: 0 };
const angle = (z: number): Vector3Value => ({ x: 0, y: 0, z });
type Bones = Record<string, Vector3Value>;
const key = (time: number, bones: Bones) => ({ id: `old-${time}`, time, value: zero, bones });
const frame = (time: number, bones: Bones) => ({ time, position: zero, rotation: zero, bones });
function apply(keys: MotionTrack["keys"], frames: ReturnType<typeof frame>[]) {
  const state = addMannequinIn(normalizeComposition(), "male", id);
  const old: MotionTrack = { id: "old", targetId: id, channel: "pose", keys };
  const initial = { ...state, motionTracks: [old] };
  const changed = applyCapturedMotionIn(initial, [{ characterId: id, frames }], { position: false, rotation: false, pose: true });
  return { old, changed: changed.motionTracks![0] };
}

describe("손 미검출 구간의 수동 타임라인 키 보존", () => {
  it("캡처 사이의 손 동작을 지키며 그 시각의 몸은 새 캡처에서 보간한다", () => {
    const keys = [key(0, { LeftHandIndex2: angle(0) }), key(0.05, { LeftHandIndex2: angle(1.2) }), key(0.1, { LeftHandIndex2: angle(0) })];
    const { old, changed } = apply(keys, [frame(0, { LeftArm: angle(0.2) }), frame(0.1, { LeftArm: angle(0.6) })]);
    expect(changed.keys.map((item) => item.time)).toEqual([0, 0.05, 0.1]);
    const middle = evaluatePoseTrack(changed, 0.05)!;
    expect(middle.LeftHandIndex2.z).toBeCloseTo(1.2);
    expect(middle.LeftArm.z).toBeCloseTo(0.4);
    expect(old.keys).toBe(keys);
    expect(old.keys[1].bones?.LeftHandIndex2.z).toBe(1.2);
  });

  it("기존 손 항목이 없는 0도 키도 지켜 손을 다시 펴는 순간이 사라지지 않는다", () => {
    const { changed } = apply([
      key(0, { LeftHandIndex2: angle(1) }), key(0.05, {}), key(0.1, { LeftHandIndex2: angle(1) }),
    ], [frame(0, {}), frame(0.1, {})]);
    expect(changed.keys.map((item) => item.time)).toContain(0.05);
    expect(evaluatePoseTrack(changed, 0.05)?.LeftHandIndex2).toBeUndefined();
  });

  it("미검출 엄지의 키를 추가해도 검출한 검지는 새 값으로 유지한다", () => {
    const { changed } = apply([
      key(0, { LeftHandIndex2: angle(0.9), RightHandThumb2: angle(0) }),
      key(0.05, { LeftHandIndex2: angle(1.2), RightHandThumb2: angle(0.8) }),
      key(0.1, { LeftHandIndex2: angle(0.9), RightHandThumb2: angle(0) }),
    ], [frame(0, { LeftHandIndex2: angle(0.2) }), frame(0.1, { LeftHandIndex2: angle(0.4) })]);
    const middle = evaluatePoseTrack(changed, 0.05)!;
    expect(middle.RightHandThumb2.z).toBeCloseTo(0.8);
    expect(middle.LeftHandIndex2.z).toBeCloseTo(0.3);
  });

  it("검출한 0도는 미검출과 구분해 기존 굽힘을 덮는다", () => {
    const { changed } = apply([
      key(0, { LeftHandIndex2: angle(0.9) }), key(0.05, { LeftHandIndex2: angle(1.2) }), key(0.1, { LeftHandIndex2: angle(0.9) }),
    ], [frame(0, { LeftHandIndex2: angle(0) }), frame(0.1, { LeftHandIndex2: angle(0) })]);
    expect(changed.keys.map((item) => item.time)).toEqual([0, 0.1]);
    expect(evaluatePoseTrack(changed, 0)?.LeftHandIndex2.z).toBe(0);
    expect(evaluatePoseTrack(changed, 0.05)?.LeftHandIndex2?.z ?? 0).toBe(0);
  });

  it("한쪽 장에서 빠진 마디를 0도로 보간해 기존 손 동작을 지우지 않는다", () => {
    const { changed } = apply([
      key(0, { LeftHandIndex2: angle(0.7) }), key(0.05, { LeftHandIndex2: angle(1) }), key(0.1, { LeftHandIndex2: angle(0.7) }),
    ], [frame(0, { LeftHandIndex2: angle(0.2) }), frame(0.1, {})]);
    expect(evaluatePoseTrack(changed, 0)?.LeftHandIndex2.z).toBeCloseTo(0.2);
    expect(evaluatePoseTrack(changed, 0.05)?.LeftHandIndex2.z).toBeCloseTo(1);
    expect(evaluatePoseTrack(changed, 0.1)?.LeftHandIndex2.z).toBeCloseTo(0.7);
  });

  it("적용 구간 바로 바깥의 키는 원래 객체 그대로 남긴다", () => {
    const before = key(0.9995, { LeftHandIndex2: angle(0.4) });
    const after = key(1.1005, { LeftHandIndex2: angle(0.8) });
    const { changed } = apply([before, key(1.05, { LeftHandIndex2: angle(1) }), after], [frame(1, {}), frame(1.1, {})]);
    expect(changed.keys[0]).toBe(before);
    expect(changed.keys.at(-1)).toBe(after);
  });
});
