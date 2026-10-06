import { describe, expect, it } from "vitest";
import { normalizeComposition } from "./composition";
import { reduceCompositionCommands } from "./compositionControlCommands";
import { controllerEdit, isControllerState, markControllerState } from "./compositionControllerState";

describe("공식 관절 키의 명시적 시간과 편집값", () => {
  const context = { characterIds: ["person"] };
  const initial = () => reduceCompositionCommands(normalizeComposition(), [{ op: "character.place", id: "person" }, { op: "timeline.set", duration: 6 }], context).state;
  it("다른 시간의 연속 키는 앞 트랙의 표본으로 새 값을 덮지 않는다", () => {
    let state = initial();
    const times = [0, .75, 3.5, 4.5, 6], values = [-35, -30, -10, -35, -35];
    for (let i = 0; i < times.length; i++) {
      state = reduceCompositionCommands(state, [{ op: "pose.bone", id: "person", bone: "RightForeArm", rotationDegrees: { x: 0, y: 0, z: values[i] } }], context).state;
      state = reduceCompositionCommands(state, [{ op: "motion_key.add", targetId: "person", channel: "pose", timeSeconds: times[i] }], context).state;
    }
    const keys = state.motionTracks!.find(t => t.channel === "pose")!.keys;
    expect(keys.map(k => k.time)).toEqual(times);
    keys.forEach((k, i) => expect(k.bones!.RightForeArm.z).toBeCloseTo(values[i] * Math.PI / 180));
  });
  it("0회전 키도 앞 값과 구분되며 기존 시각 갱신은 ID·완급과 다른 키를 보존한다", () => {
    let state = initial();
    const put = (time: number, z: number) => {
      state = reduceCompositionCommands(state, [{ op: "pose.bone", id: "person", bone: "RightForeArm", rotationDegrees: { x: 0, y: 0, z } },
        { op: "motion_key.add", targetId: "person", channel: "pose", timeSeconds: time }], context).state;
    };
    put(0, -30); put(3.5, -10);
    const id = state.motionTracks![0].keys[1].id;
    const easing = { p1x: .2, p1y: .1, p2x: .8, p2y: .9 };
    state = reduceCompositionCommands(state, [{ op: "motion_key.easing", targetId: "person", channel: "pose", keyId: id, easing }], context).state;
    put(3.5, 0);
    expect(state.motionTracks![0].keys).toHaveLength(2);
    expect(state.motionTracks![0].keys[1]).toMatchObject({ id, time: 3.5, bones: {}, easing });
    expect(state.motionTracks![0].keys[0].bones!.RightForeArm.z).toBeCloseTo(-Math.PI / 6);
  });
  it("외부 편집 표식은 파일 상태에 추가하지 않고 수동 새 판의 자동키를 막지 않는다", () => {
    const state = initial(); const plain = JSON.stringify(state);
    markControllerState(state); expect(isControllerState(state)).toBe(true);
    expect(JSON.stringify(state)).toBe(plain);
    const manual = { ...state }; expect(isControllerState(manual)).toBe(false);
    controllerEdit(() => expect(isControllerState(manual)).toBe(true));
    expect(isControllerState(manual)).toBe(false);
  });
});
