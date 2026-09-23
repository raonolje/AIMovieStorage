import { describe, expect, it } from "vitest";
import { newCut } from "./projectTypes";
import { cutVideoLinkInput, magnificCutVideoReferences } from "./cutVideoReferences";
import { relinkPromptText } from "./promptLinks";

describe("Magnific 컷 영상 참조", () => {
  const cut = { ...newCut(1), refVideoPath: "camera.mp4", images: [
    { id: "old", name: "이전 그림", filePath: "old.png" },
    { id: "group", name: "다섯 인물", filePath: "group.png", isPrimary: true },
  ] };

  it("군무 영상과 대표 그룹 그림, 기존 시트·구도·배경을 빠뜨리지 않고 5개로 보낸다", () => {
    const imageReferences = ["person.png", "guide.png", "background.png"];
    expect(magnificCutVideoReferences(cut, imageReferences, true))
      .toEqual(["camera.mp4", "group.png", "person.png", "guide.png", "background.png"]);
    expect(imageReferences).toEqual(["person.png", "guide.png", "background.png"]);
    expect(cut.images).toHaveLength(2);
  });

  it("대표 그림이 기존 목록에 있으면 한 번만 보내며 영상 토글을 끄면 영상만 뺀다", () => {
    expect(magnificCutVideoReferences(cut, ["group.png", "guide.png", "guide.png"], false))
      .toEqual(["group.png", "guide.png"]);
  });

  it("파일 없는 대표 그림이나 움직임 마스크를 임의로 레퍼런스로 보내지 않는다", () => {
    expect(magnificCutVideoReferences({ ...cut, images: [{ id: "unsaved", name: "아직 저장 전" }] }, ["guide.png"], false))
      .toEqual(["guide.png"]);
    expect(magnificCutVideoReferences({ ...cut, images: [{ id: "mask", name: "군무_움직임_001", filePath: "군무_움직임_001.png", isPrimary: true }] }, [], false))
      .toEqual([]);
  });

  it("저장·다시 잇기·전송의 영상 꼬리는 대표 그림을 표시하고 없는 시트는 선택 사항으로 구분한다", () => {
    const imageLink = { people: [{ name: "Seoah", paths: ["seoah.png"] },
      ...["Mina", "Yuna", "Harin", "Jiyu"].map(name => ({ name, paths: [] as string[] }))] };
    const before = JSON.stringify(imageLink);
    const old = "User-directed camera cuts and expressions.\n\nNot yet generated: Mina / Yuna / Harin / Jiyu";
    const videoInput = cutVideoLinkInput(cut, imageLink);
    const sent = relinkPromptText(old, videoInput, "en");
    expect(sent).toContain("Reference images: representative image @group");
    expect(sent).toContain("Optional individual sheets not attached: Mina / Yuna / Harin / Jiyu");
    expect(sent).not.toContain("Not yet generated:");
    expect(sent).not.toContain("@Mina");
    expect(sent).toContain("User-directed camera cuts and expressions.");
    expect(relinkPromptText(sent, videoInput, "en")).toBe(sent);
    expect(relinkPromptText(old, imageLink, "en")).toContain("Not yet generated:");
    expect(JSON.stringify(imageLink)).toBe(before);
    const removed = relinkPromptText(sent, cutVideoLinkInput({ ...cut, images: [] }, imageLink), "en");
    expect(removed).not.toContain("Optional individual sheets");
    expect(removed).not.toContain("representative image");
    expect(removed).toContain("Not yet generated: Mina / Yuna / Harin / Jiyu");
  });
});
