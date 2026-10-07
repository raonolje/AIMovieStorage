import { describe, expect, it, vi } from "vitest";
import { cutVideoLinkInput, magnificCutVideoReferences } from "./cutVideoReferences";
import { withPrimaryVoice, voicePromptLines } from "./characterVoice";
import { newCharacter, newCut } from "./projectTypes";

const run = vi.hoisted(() => vi.fn());
vi.mock("./localOutput", () => ({ runLocalToProject: run }));

describe("첫 영상 전 로컬 캐릭터 목소리", () => {
  it("조종기가 명시 workflow를 요구하고 미지정 옵션은 모델에 몰래 추가하지 않는다", async () => {
    const { voiceGenerateSchema } = await import("./controlVoice");
    const base = { projectId: "project", expectedRevision: "revision", operationId: "voice-1",
      characterId: "character", dialogue: "안녕하세요.", traits: "밝은 목소리", category: "singer", model: "design",workflowTarget:{kind:"workflow",workflowId:"voice",workflowSha256:"a".repeat(64),roleId:"speech",modelRuleId:"qwentts"} };
    expect(voiceGenerateSchema.parse(base)).not.toHaveProperty("gender");
    expect(voiceGenerateSchema.parse(base)).not.toHaveProperty("ageRange");
    const {workflowTarget:_,...legacy}=base;expect(voiceGenerateSchema.safeParse(legacy).success).toBe(false);
    expect(voiceGenerateSchema.parse({ ...base, category: "idol", gender: "female", ageRange: "twenties" }))
      .toMatchObject({ category: "idol", gender: "female", ageRange: "twenties" });
    expect(voiceGenerateSchema.safeParse({ ...base, ageRange: "child" }).success).toBe(false);
  });

  it("카드와 조종기가 쓰는 생성 경로로 캐릭터 voice 폴더에 저장하고 첫 컷의 오디오·@태그에 연결한다", async () => {
    const { generateCharacterVoice, voiceInstruction } = await import("./voiceGeneration");
    const path = "C:/Project/character/서아/voice/서아_목소리_로컬_001.wav";
    run.mockResolvedValueOnce({ path, name: "서아_목소리_로컬_001", seconds: 4, meta: {} });
    const reference = await generateCharacterVoice({ projectName: "Project", characterName: "서아",
      dialogue: "여기 있었구나.", category: "idol", gender: "female", ageRange: "twenties", traits: "낮은 중저음, 반가운 연기",
      model: "design", language: "Korean" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ engine: "qwentts", kind: "audio",
      assetType: "character-voice", ownerName: "서아",
      opts: expect.objectContaining({ prompt: "여기 있었구나.", voice_model: "design",
        voice_instruct: expect.stringContaining("여성 목소리, 20대, 낮은 중저음, 반가운 연기") }) }));
    expect(reference).toMatchObject({ category: "idol", gender: "female", ageRange: "twenties" });
    const actor = withPrimaryVoice({ ...newCharacter(), id: "actor", name: "서아" }, reference);
    const cut = { ...newCut(1), characterIds: ["actor"] };
    expect(magnificCutVideoReferences(cut, [], false, false, null, [actor])).toContain(path);
    expect(cutVideoLinkInput(cut, {}, null, [actor]).voiceReferencePaths).toContain(path);
    expect(voicePromptLines({ cut, characters: [actor], lang: "en" }).join(" ")).toContain("@서아_목소리_로컬_001");
    expect(voiceInstruction("idol", "맑고 활기차게", "Korean", "female", "twenties"))
      .toContain("여성 목소리, 20대, 맑고 활기차게");
    expect(voiceInstruction("singer", "resonant", "English", "male", "thirties"))
      .toContain("a masculine voice, an adult in their thirties, resonant");
  });
});
