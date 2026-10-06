import { describe, expect, it } from "vitest";
import { localControlCapabilities, validateLocalControlOptions } from "./localControlCapabilities";

describe("끝 프레임 입력", () => {
  it("확인한 LTX 경로만 표시하며 모델 전환 시 남은 입력을 거절한다", () => {
    expect(localControlCapabilities("ltx25").endFrame).toBe(true);
    expect(localControlCapabilities("wanvideo").endFrame).toBe(true);
    expect(validateLocalControlOptions("wanvideo", { image: "start.png", end_image: "end.png" })).toEqual({ ok: true });
    for (const engine of ["minimaxh3", "qwenimage"]) {
      expect(localControlCapabilities(engine).endFrame).toBe(false);
      expect(validateLocalControlOptions(engine, { image: "start.png", end_image: "end.png" }))
        .toMatchObject({ ok: false, code: "model_unsupported" });
    }
  });
  it("시작 이미지가 필요하며 결과를 덮는 마스크와 함께 보내지 않는다", () => {
    expect(validateLocalControlOptions("ltx25", { end_image: "end.png" })).toMatchObject({ ok: false });
    expect(validateLocalControlOptions("ltx25", { image: "start.png", end_image: "end.png", motion_mask: "mask.png" }))
      .toMatchObject({ ok: false });
    expect(validateLocalControlOptions("ltx25", { image: "start.png", end_image: "end.png" })).toEqual({ ok: true });
  });
});
