import { describe, expect, it } from "vitest";
import { localControlCapabilities, validateLocalControlOptions } from "@/lib/localControlCapabilities";

const pose = { kind: "pose", frames: ["pose1.png", "pose2.png"], fps: 24, weight: 0 };
describe("로컬 동작 제어 입력", () => {
  it("H3 영상 참조와 LTX 포즈 제어를 구분한다", () => {
    expect(localControlCapabilities("minimaxh3")).toMatchObject({ poseFrames: false, referenceVideo: true });
    expect(localControlCapabilities("ltx25")).toMatchObject({ poseFrames: true, referenceVideo: false, poseMethod: "ic-lora" });
  });
  it.each(["wanvideo", "minimaxh3", "qwenimage", "unknown"])("%s에 남은 포즈를 무시하지 않고 거절한다", (engine) => {
    expect(validateLocalControlOptions(engine, { control: pose })).toMatchObject({ ok: false, code: "unsupported_control" });
  });
  it("세기 0과 원본 fps를 포함한 LTX 요청은 보존한다", () => {
    expect(validateLocalControlOptions("ltx25", { control: pose })).toEqual({ ok: true });
    expect(pose.weight).toBe(0);
  });
  it.each([{}, [], { ...pose, frames: [] }, { ...pose, frames: [null] }, { ...pose, frames: [" "] }, { ...pose, kind: "depth" }, { ...pose, fps: 0 }, { ...pose, weight: NaN }, { ...pose, weight: 2 }])("잘못된 동작 입력을 시작 전에 거절한다", (control) => {
    expect(validateLocalControlOptions("ltx25", { control })).toMatchObject({ ok: false, code: "invalid_control" });
  });
  it("포즈 없는 기존 요청은 그대로 허용한다", () => {
    expect(validateLocalControlOptions("wanvideo", {})).toEqual({ ok: true });
  });
  it("LTX 윤곽 입력의 범위·세기와 포즈 동시 선택을 검증한다", () => {
    const structure_control = { kind: "canny", path: "camera.mp4", sourceStartSeconds: 6, durationSeconds: 5, weight: 0 };
    expect(localControlCapabilities("ltx25").structureVideo).toBe(true);
    expect(validateLocalControlOptions("ltx25", { structure_control, seconds: 5 })).toEqual({ ok: true });
    expect(validateLocalControlOptions("wanvideo", { structure_control })).toMatchObject({ ok: false, code: "unsupported_control" });
    expect(validateLocalControlOptions("ltx25", { structure_control, control: pose })).toMatchObject({ ok: false, code: "unsupported_control" });
    for (const extra of [{ weight: 1.1 }, { durationSeconds: 0 }, { sourceStartSeconds: -1 }, { thresholds: { low: 200, high: 92 } }]) {
      expect(validateLocalControlOptions("ltx25", { structure_control: { ...structure_control, ...extra } })).toMatchObject({ ok: false, code: "invalid_control" });
    }
    expect(validateLocalControlOptions("ltx25", { structure_control, seconds: 6 })).toMatchObject({ ok: false, code: "invalid_control" });
  });
  it("영상 참조를 모션 컨트롤인 것처럼 Wan/LTX에 넘기지 않는다", () => {
    const references = [{ kind: "video", path: "dance.mp4" }];
    expect(validateLocalControlOptions("ltx25", { references })).toMatchObject({ ok: false, code: "unsupported_reference" });
    expect(validateLocalControlOptions("minimaxh3", { references })).toMatchObject({ ok: false, code: "invalid_reference_range" });
    expect(validateLocalControlOptions("minimaxh3", { references, reference_video_range: "full" })).toEqual({ ok: true });
  });
  it("H3 영상만 명시적으로 구간을 선택하며 그림 참조에는 적용하지 않는다", () => {
    const references = [{ kind: "video", path: "dance.mp4" }];
    for (const reference_video_range of ["first5s", "full"]) {
      expect(validateLocalControlOptions("minimaxh3", { references, reference_video_range })).toEqual({ ok: true });
      expect(validateLocalControlOptions("minimaxh3", { reference_video_range })).toMatchObject({ ok: false, code: "invalid_reference_range" });
      expect(validateLocalControlOptions("wanvideo", { reference_video_range })).toMatchObject({ ok: false, code: "invalid_reference_range" });
    }
    expect(validateLocalControlOptions("minimaxh3", { references: [{ kind: "image" }] })).toEqual({ ok: true });
    expect(validateLocalControlOptions("minimaxh3", { references, reference_video_range: "unknown" })).toMatchObject({ ok: false, code: "invalid_reference_range" });
  });
});
