import { describe, expect, it } from "vitest";
import { newCut, newScene } from "./projectTypes";
import { continuityPromptLine, relinkContinuityTags, resolveCutContinuity } from "./cutContinuity";
import { cutVideoLinkInput, magnificCutVideoReferences } from "./cutVideoReferences";
import { relinkPromptText } from "./promptLinks";

describe("앞 컷 대표영상 연결", () => {
  const source = () => ({ ...newCut(1), id: "a", videos: [
    { id: "old", name: "옛영상", filePath: "옛영상.mp4", endFramePath: "옛영상_마지막프레임.png" },
    { id: "chosen", name: "선택영상", filePath: "선택영상.mp4", endFramePath: "선택영상_마지막프레임.png", isPrimary: true },
  ] });
  const next = () => ({ ...newCut(2), id: "b", cutContinuity: "continue" as const });

  it("대표 선택 전과 마지막 프레임 누락 시 이어 찍기를 막는다", () => {
    const a = source(); const b = next(); const scene = { ...newScene(), cuts: [a, b] };
    a.videos[1].isPrimary = false;
    expect(() => resolveCutContinuity(scene, b)).toThrow("대표영상을 먼저 선택");
    a.videos[1].isPrimary = true;
    a.videos[1].endFramePath = undefined;
    expect(() => resolveCutContinuity(scene, b)).toThrow("마지막 프레임");
  });

  it("같은 공간·새 구도는 앞 영상만 연결하고 컷 순서가 바뀌면 새 앞 컷을 읽는다", () => {
    const a = source(); const b = { ...next(), cutContinuity: "same-space-new-angle" as const };
    const scene = { ...newScene(), cuts: [a, b] };
    a.videos[1].endFramePath = undefined;
    expect(resolveCutContinuity(scene, b)?.videoPath).toBe("선택영상.mp4");
    expect(continuityPromptLine(resolveCutContinuity(scene, b)!, "en")).toContain("new camera angle");
    expect(magnificCutVideoReferences(b, [], false, false, resolveCutContinuity(scene, b))).toEqual(["선택영상.mp4"]);
    scene.cuts.reverse();
    expect(() => resolveCutContinuity(scene, b)).toThrow("두 번째 컷");
  });

  it("영상·끝 프레임을 업로드 참조와 한영 프롬프트에 각각 @로 잇고 다시 이어도 중복되지 않는다", () => {
    const a = source(); const b = next(); const scene = { ...newScene(), cuts: [a, b] };
    const link = resolveCutContinuity(scene, b)!;
    expect(magnificCutVideoReferences(b, ["배경.png"], false, false, link))
      .toEqual(["선택영상.mp4", "선택영상_마지막프레임.png", "배경.png"]);
    expect(continuityPromptLine(link, "ko")).toContain("@선택영상_마지막프레임");
    const input = cutVideoLinkInput(b, { people: [] }, link);
    const saved = relinkPromptText("Continue the action.", input, "en");
    expect(saved).toContain("Previous shot continuity: selected video @선택영상");
    expect(saved).toContain("@선택영상_마지막프레임");
    expect(relinkPromptText(saved, input, "en")).toBe(saved);
    expect(relinkContinuityTags("Follow @옛영상.", a, link.video)).toBe("Follow @선택영상.");
    expect(relinkContinuityTags("Start at @옛영상_마지막프레임 after @옛영상.", a, link.video))
      .toBe("Start at @선택영상_마지막프레임 after @선택영상.");
  });
});
