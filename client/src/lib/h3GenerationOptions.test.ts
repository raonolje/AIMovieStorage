import { describe, expect, it } from "vitest";
import { h3GuiRunOptions, h3PresetCandidate, H3_REF_PRESET } from "./h3GenerationOptions";
const file = { engine: "minimaxh3" as const, path: "/loras/renamed.safetensors", fileName: "renamed.safetensors", sizeBytes: 123 };
describe("H3 화면 프리셋의 검증 경계", () => {
  it("같은 이름이나 폴더를 호환성 증거로 쓰지 않는다", () => {
    expect(h3PresetCandidate([{ path: file.path, weight: 1 }], [file])).toEqual(file);
    expect(h3GuiRunOptions(true, "diffusers", true, "selection", null, null)).toBeNull();
    expect(h3GuiRunOptions(true, "diffusers", true, "selection", "selection", "fl2va")).toBeNull();
  });
  it("단일 실제 파일·세기 1만 검사 후보로 받는다", () => {
    for (const loras of [[], [{ path: file.path, weight: 0.7 }], [{ path: file.path, weight: 1 }, { path: "other", weight: 1 }]])
      expect(h3PresetCandidate(loras, [file])).toBeNull();
    expect(h3PresetCandidate([{ path: file.path, weight: 1 }], [{ ...file, engine: "wanvideo" }])).toBeNull();
    expect(h3PresetCandidate([{ path: file.path, weight: 1 }], [{ ...file, sizeBytes: 0 }])).toBeNull();
  });
  it("늦게 끝난 이전 파일 검증으로 새 선택을 활성화하지 않는다", () => {
    expect(h3GuiRunOptions(true, "match", true, "new-selection", "old-selection", H3_REF_PRESET)).toBeNull();
  });
  it("일반 기본값을 보존하고 검증된 명시 선택만 match·4회로 묶는다", () => {
    expect(h3GuiRunOptions(false, "match", true, "x", "x", H3_REF_PRESET)).toEqual({});
    expect(h3GuiRunOptions(true, "diffusers", false, "", null, null)).toEqual({ h3_reference_resize_mode: "diffusers" });
    expect(h3GuiRunOptions(true, "match", false, "", null, null)).toEqual({ h3_reference_resize_mode: "match" });
    expect(h3GuiRunOptions(true, "diffusers", true, "x", "x", H3_REF_PRESET)).toEqual({ h3_reference_resize_mode: "match", h3_lora_preset: H3_REF_PRESET, steps: 4 });
  });
});
