import { describe, expect, it } from "vitest";
import { applyVoiceChange, cutVoiceReferences, ensureVoicePrompt, isFirstAppearance, voicePromptLines, voiceSource, withPrimaryVoice } from "./characterVoice";
import { newCharacter, newCut, newProjectDraft, newScene } from "./projectTypes";

describe("character voice reference", () => {
  it("extracts only from the chosen primary video of a cut containing that character", () => {
    const actor = { ...newCharacter(), id: "actor", name: "서아" };
    const cut = { ...newCut(1), id: "cut", characterIds: ["actor"], videos: [
      { id: "old", name: "old", filePath: "C:/project/old.mp4" },
      { id: "selected", name: "selected", filePath: "C:/project/selected.mp4", isPrimary: true },
    ] };
    const draft = { ...newProjectDraft(), characters: [actor], scenes: [{ ...newScene(), cuts: [cut] }] };
    expect(() => voiceSource(draft, "actor", "cut", "old")).toThrow("대표 영상을 먼저");
    expect(voiceSource(draft, "actor", "cut", "selected").video.filePath).toBe("C:/project/selected.mp4");
  });

  it("uses the character's selected WAV alongside visual references and announces first-appearance voice characteristics", () => {
    const actor = withPrimaryVoice({ ...newCharacter(), id: "actor", name: "서아",
      voiceDescription: "낮고 차분한 중저음", voiceDescriptionEn: "a calm low mid-range voice" }, {
      id: "voice-1", filePath: "C:/project/character/서아/voice/서아_voice_001.wav",
      sourceCutId: "first", sourceVideoId: "video", startSeconds: 2, endSeconds: 5, isPrimary: true,
    });
    const first = { ...newCut(1), id: "first", characterIds: ["actor"] };
    const second = { ...newCut(2), id: "second", characterIds: ["actor"] };
    const scenes = [{ ...newScene(), cuts: [first, second] }];
    expect(isFirstAppearance(scenes, first, "actor")).toBe(true);
    expect(isFirstAppearance(scenes, second, "actor")).toBe(false);
    expect(cutVoiceReferences(first, [actor])).toEqual(["C:/project/character/서아/voice/서아_voice_001.wav"]);
    expect(voicePromptLines({ cut: first, scenes, characters: [actor], lang: "ko" }).join(" "))
      .toContain("@서아_voice_001");
    expect(voicePromptLines({ cut: first, scenes, characters: [actor], lang: "en" }).join(" "))
      .toContain("a calm low mid-range voice");
    expect(voicePromptLines({ cut: second, scenes, characters: [actor], lang: "ko" }).join(" "))
      .not.toContain("낮고 차분한 중저음");
    const draft = { ...newProjectDraft(), characters: [actor], scenes: [{ ...scenes[0], cuts: [
      { ...first, videoPromptKo: "무대에서 인사한다\n\n서아의 대사는 @서아_voice_old의 목소리·발음·말투를 기준으로 연기하세요. 다른 인물의 목소리와 섞지 마세요." }, second,
    ] }] };
    const changed = applyVoiceChange(draft, "actor", (current) => ({ voiceReferences: current.voiceReferences?.map((item) => ({ ...item, isPrimary: true })) }));
    expect(changed.scenes[0].cuts[0].videoPromptKo).toContain("@서아_voice_001");
    expect(changed.scenes[0].cuts[0].videoPromptKo).not.toContain("@서아_voice_old");
    const relinked = "Use @서아_voice_old as the voice, pronunciation and speaking-style reference for @서아_001's dialogue; do not mix it with another character's voice.";
    const refreshed = ensureVoicePrompt(relinked, { cut: first, scenes, characters: [actor], lang: "en" });
    expect(refreshed).not.toContain("@서아_voice_old");
    expect(refreshed.match(/as the voice, pronunciation and speaking-style reference/g)).toHaveLength(1);
  });
});
