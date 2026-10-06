import { describe, expect, it } from "vitest";
import { kimodoBvhToCapture } from "./kimodoBvh";

const names = ["Head", "LeftEye", "RightEye", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm",
  "LeftHand", "RightHand", "LeftHandMiddleEnd", "RightHandMiddleEnd", "LeftHandThumbEnd",
  "RightHandThumbEnd", "LeftLeg", "RightLeg", "LeftShin", "RightShin", "LeftFoot",
  "RightFoot", "LeftToeBase", "RightToeBase"];
function fixture() {
  const joints = names.map(name => `JOINT ${name}\n{\nOFFSET 10 30 0\nCHANNELS 3 Zrotation Yrotation Xrotation\n}`).join("\n");
  const row = Array(12 + names.length * 3).fill("0").join(" ");
  return `HIERARCHY\nROOT Root\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\nJOINT Hips\n{\nOFFSET 0 100 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n${joints}\n}\n}\nMOTION\nFrames: 2\nFrame Time: 0.033333\n${row}\n${row}\n`;
}

describe("KIMODO SOMA BVH 변환", () => {
  it("센티미터 관절과 30fps 두 장을 기존 모캡 형식의 미터 좌표로 변환한다", () => {
    const result = kimodoBvhToCapture(fixture());
    expect(result.engine).toBe("kimodo-soma-bvh");
    expect(result.persons[0].samples).toHaveLength(2);
    expect(result.persons[0].samples[0].world).toHaveLength(33);
    expect(result.persons[0].samples[0].world[11].x).toBeCloseTo(0.1);
    expect(result.fps).toBeCloseTo(30, 2);
  });
  it("SOMA가 아닌 뼈대와 잘못된 프레임 간격을 거절한다", () => {
    expect(() => kimodoBvhToCapture(fixture().replace("LeftArm", "Unknown"))).toThrow(/관절/);
    expect(() => kimodoBvhToCapture(fixture().replace("Frame Time: 0.033333", "Frame Time: 0"))).toThrow(/프레임/);
  });
});
