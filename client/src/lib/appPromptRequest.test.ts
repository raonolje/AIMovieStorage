import { describe, expect, it } from "vitest";
import { appPromptRequest, applyAppPromptResult } from "./appPromptRequest";
import { newCut, newProjectDraft, newScene } from "./projectTypes";

describe("앞 컷 영상의 API·조종기 프롬프트 연결", () => {
  it("같은 요청 자료를 보내고 한영 결과와 이력에 실제 @파일 태그를 저장한다", () => {
    const first = { ...newCut(1), id: "first", videos: [{
      id: "movie", name: "앞 영상", filePath: "C:/project/앞 영상.mp4",
      endFramePath: "C:/project/앞 영상_마지막프레임.png", isPrimary: true,
    }] };
    const second = { ...newCut(2), id: "second", cutContinuity: "continue" as const };
    const scene = { ...newScene(), id: "scene", cuts: [first, second] };
    const draft = { ...newProjectDraft(), title: "시험", scenes: [scene] };
    const target = { kind: "cutVideo" as const, sceneId: "scene", cutId: "second" };
    const request = appPromptRequest(draft, target);
    expect((request.data as { previousCut: { video: string; endFrame: string } }).previousCut)
      .toMatchObject({ video: "@앞 영상", endFrame: "@앞 영상_마지막프레임" });
    const updated = applyAppPromptResult(draft, target, {
      ko: "앞 컷에서 인물이 문으로 걸어간다.", en: "The actor walks through the door.",
      negativeKo: "", negativeEn: "",
    });
    const cut = updated.scenes[0].cuts[1];
    expect(cut.videoPromptKo).toContain("앞 컷 연결: 대표영상 @앞 영상 / 마지막 프레임·이 컷 첫 프레임 @앞 영상_마지막프레임");
    expect(cut.videoPromptEn).toContain("Previous shot continuity: selected video @앞 영상 / final frame / this shot's first frame @앞 영상_마지막프레임");
    expect(cut.videoPromptHistory?.length).toBeGreaterThan(0);
  });
});
