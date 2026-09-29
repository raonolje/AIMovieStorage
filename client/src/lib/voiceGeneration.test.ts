import { describe, expect, it, vi } from "vitest";
import { cutVideoLinkInput, magnificCutVideoReferences } from "./cutVideoReferences";
import { withPrimaryVoice, voicePromptLines } from "./characterVoice";
import { newCharacter, newCut } from "./projectTypes";

const run = vi.hoisted(() => vi.fn());
vi.mock("./localOutput", () => ({ runLocalToProject: run }));

describe("첫 영상 전 로컬 캐릭터 목소리", () => {
  it("카드와 조종기가 쓰는 생성 경로로 캐릭터 voice 폴더에 저장하고 첫 컷의 오디오·@태그에 연결한다", async () => {
    const { generateCharacterVoice } = await import("./voiceGeneration");
    const path = "C:/Project/character/서아/voice/서아_목소리_로컬_001.wav";
    run.mockResolvedValueOnce({ path, name: "서아_목소리_로컬_001", seconds: 4, meta: {} });
    const reference = await generateCharacterVoice({ projectName: "Project", characterName: "서아",
      dialogue: "여기 있었구나.", category: "actor", traits: "낮은 중저음, 반가운 연기",
      model: "design", language: "Korean" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ engine: "qwentts", kind: "audio",
      assetType: "character-voice", ownerName: "서아",
      opts: expect.objectContaining({ prompt: "여기 있었구나.", voice_model: "design",
        voice_instruct: expect.stringContaining("낮은 중저음, 반가운 연기") }) }));
    const actor = withPrimaryVoice({ ...newCharacter(), id: "actor", name: "서아" }, reference);
    const cut = { ...newCut(1), characterIds: ["actor"] };
    expect(magnificCutVideoReferences(cut, [], false, false, null, [actor])).toContain(path);
    expect(cutVideoLinkInput(cut, {}, null, [actor]).voiceReferencePaths).toContain(path);
    expect(voicePromptLines({ cut, characters: [actor], lang: "en" }).join(" ")).toContain("@서아_목소리_로컬_001");
  });
});
