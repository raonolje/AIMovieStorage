import { describe, expect, it } from "vitest";
import { newCharacter, newProjectDraft } from "@/lib/projectTypes";
import { applyBootstrapToDraft, parseBootstrapDetails, parseBootstrapOutline, parseBootstrapShots } from "@/lib/projectBootstrap";

const existing = () => ({
  ...newProjectDraft(),
  characters: [{
    ...newCharacter(), id: "actor-1", name: "서진우 (형사)",
    generatedImages: [{ id: "sheet-1", name: "서진우_시트_001", thumb: "", file: null,
      filePath: "C:/작품/서진우/서진우_시트_001.png", isPrimary: true, isCompositeSheet: true }],
  }],
});

const outline = parseBootstrapOutline({ title: "국호", characters: [{ name: "서진우 (형사)" }] });

describe("AI 일괄 생성의 컷 인물 연결", () => {
  it("2단계 등장인물 칸이 빠져도 3단계 구도 인물을 컷과 @시트에 잇는다", () => {
    const details = parseBootstrapDetails({ scenes: [{ title: "광장", cuts: [{ title: "명단", description: "서진우가 명단을 연다" }] }] });
    const shots = parseBootstrapShots({ scenes: [{ title: "광장", cuts: [{ order: 1, people: [{ name: "서진우", x: 0, z: 0, facing: 0 }], promptKo: "서진우가 명단을 연다", promptEn: "Seo Jinwoo opens the list" }] }] });
    const applied = applyBootstrapToDraft(existing(), { outline, details, shots }, { mode: "append" });
    const cut = applied.scenes?.[0].cuts[0];
    expect(cut?.characterIds).toEqual(["actor-1"]);
    expect(cut?.promptKo).toContain("@서진우_시트_001");
    expect(cut?.videoPromptKo).toContain("@서진우_시트_001");
  });

  it("구도 결과도 없으면 컷 본문의 인물 이름으로 잇되, 명시적인 빈 목록은 존중한다", () => {
    const details = parseBootstrapDetails({ scenes: [{ title: "광장", characters: ["서진우"], cuts: [
      { title: "명단", description: "서진우가 명단을 연다" },
      { title: "빈 광장", description: "서진우가 떠난 뒤 빈 광장", characters: [] },
    ] }] });
    const cuts = applyBootstrapToDraft(existing(), { outline, details }, { mode: "append" }).scenes?.[0].cuts;
    expect(cuts?.[0].characterIds).toEqual(["actor-1"]);
    expect(cuts?.[1].characterIds).toEqual([]);
  });

  it("3단계 구도가 인물 없음이라고 답한 컷에는 떠난 사람의 이름이 설명에 있어도 선택하지 않는다", () => {
    const details = parseBootstrapDetails({ scenes: [{ title: "광장", characters: ["서진우"], cuts: [
      { title: "빈 광장", description: "서진우가 떠난 뒤 빈 광장" },
    ] }] });
    const shots = parseBootstrapShots({ scenes: [{ title: "광장", cuts: [{ order: 1, people: [] }] }] });
    const cut = applyBootstrapToDraft(existing(), { outline, details, shots }, { mode: "append" }).scenes?.[0].cuts[0];
    expect(cut?.characterIds).toEqual([]);
  });
});
