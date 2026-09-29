import { invoke } from "@tauri-apps/api/core";
import { fileStem, getMediaLibrarySettings } from "./mediaLibrary";
import type { Character, CharacterVoiceReference, Cut, ProjectDraft, Scene } from "./projectTypes";

/** 한 인물의 음성 기준은 하나만 활성화합니다. 이전 추출본은 비교용으로 남깁니다. */
export function primaryVoice(character: Character): CharacterVoiceReference | undefined {
  return character.voiceReferences?.find((item) => item.isPrimary);
}

/** 다른 인물의 말이 섞인 영상에서는 화자를 추측하지 않고 지정 구간만 추출합니다. */
export function voiceSource(draft: ProjectDraft, characterId: string, sourceCutId: string, sourceVideoId: string) {
  const character = draft.characters.find((item) => item.id === characterId);
  const scene = draft.scenes.find((item) => item.cuts.some((cut) => cut.id === sourceCutId));
  const cut = scene?.cuts.find((item) => item.id === sourceCutId);
  const video = cut?.videos.find((item) => item.id === sourceVideoId);
  if (!character || !cut || !video?.isPrimary || !video.filePath || !cut.characterIds.includes(characterId))
    throw new Error("해당 인물이 등장하는 컷의 대표 영상을 먼저 선택하세요.");
  return { character, cut, video };
}

export async function extractVoiceFromPrimary(input: {
  draft: ProjectDraft; characterId: string; sourceCutId: string; sourceVideoId: string;
  startSeconds: number; endSeconds: number;
  operationId?: string;
  projectName: string;
}): Promise<CharacterVoiceReference> {
  const { character } = voiceSource(input.draft, input.characterId, input.sourceCutId, input.sourceVideoId);
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds)
    || input.startSeconds < 0 || input.endSeconds - input.startSeconds < 2 || input.endSeconds - input.startSeconds > 30)
    throw new Error("한 인물의 대사 시작·끝 구간을 2~30초로 지정하세요.");
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!baseDirectory) throw new Error("먼저 프로젝트 저장 폴더를 지정하세요.");
  const { video } = voiceSource(input.draft, input.characterId, input.sourceCutId, input.sourceVideoId);
  const path = await invoke<string>("extract_character_voice", {
    baseDirectory, projectName: input.projectName, characterName: character.name,
    sourcePath: video.filePath, startSeconds: input.startSeconds, endSeconds: input.endSeconds,
  });
  return {
    id: crypto.randomUUID(), operationId: input.operationId, filePath: path, sourceVideoId: video.id,
    sourceCutId: input.sourceCutId, startSeconds: input.startSeconds,
    endSeconds: input.endSeconds, isPrimary: true,
  };
}

export function withPrimaryVoice(character: Character, reference: CharacterVoiceReference): Character {
  return { ...character, voiceReferences: [
    ...(character.voiceReferences || []).map((item) => ({ ...item, isPrimary: false })),
    reference,
  ] };
}

/** 음성 대표가 바뀌면 이미 저장된 컷 프롬프트의 @연결도 같은 변경에서 갱신합니다. */
export function applyVoiceChange(draft: ProjectDraft, characterId: string,
  update: (current: Character) => Partial<Character>): Pick<ProjectDraft, "characters" | "scenes"> {
  const characters = draft.characters.map((item) => item.id === characterId ? { ...item, ...update(item) } : item);
  const scenes = draft.scenes.map((scene) => ({ ...scene, cuts: scene.cuts.map((cut) => {
    if (!cut.characterIds.includes(characterId)) return cut;
    return { ...cut,
      videoPromptKo: cut.videoPromptKo?.trim() ? ensureVoicePrompt(cut.videoPromptKo, { cut, scenes: draft.scenes, characters, lang: "ko" }) : cut.videoPromptKo,
      videoPromptEn: cut.videoPromptEn?.trim() ? ensureVoicePrompt(cut.videoPromptEn, { cut, scenes: draft.scenes, characters, lang: "en" }) : cut.videoPromptEn,
    };
  }) }));
  return { characters, scenes };
}

export function isFirstAppearance(scenes: readonly Scene[], cut: Cut, characterId: string): boolean {
  for (const scene of scenes) for (const item of scene.cuts) {
    if (item.id === cut.id) return item.characterIds.includes(characterId);
    if (item.characterIds.includes(characterId)) return false;
  }
  return false;
}

export function cutVoiceReferences(cut: Cut, characters: readonly Character[]): string[] {
  return [...new Set(characters.filter((item) => cut.characterIds.includes(item.id))
    .map((item) => primaryVoice(item)?.filePath).filter((path): path is string => Boolean(path)))];
}

export function voicePromptLines(input: {
  cut: Cut; scenes?: readonly Scene[]; characters: readonly Character[]; lang: "ko" | "en";
}): string[] {
  const ko = input.lang === "ko";
  return input.characters.filter((item) => input.cut.characterIds.includes(item.id)).flatMap((character) => {
    const voice = primaryVoice(character);
    const tag = voice ? `@${fileStem(voice.filePath)}` : "";
    const first = input.scenes ? isFirstAppearance(input.scenes, input.cut, character.id) : false;
    const description = first ? (ko ? character.voiceDescription : character.voiceDescriptionEn || character.voiceDescription)?.trim() : "";
    const lines: string[] = [];
    if (voice) lines.push(ko
      ? `${character.name}의 대사는 ${tag}의 목소리·발음·말투를 기준으로 연기하세요. 다른 인물의 목소리와 섞지 마세요.`
      : `Use ${tag} as the voice, pronunciation and speaking-style reference for ${character.name}'s dialogue; do not mix it with another character's voice.`);
    if (description) lines.push(ko
      ? `${character.name} 첫 등장 목소리 특징: ${description}`
      : `${character.name}'s voice characteristics at first appearance: ${description}`);
    return lines;
  });
}

/** LLM 답이 음성 @태그를 빠뜨려도 앱이 만든 필수 연결문은 보존합니다. */
export function ensureVoicePrompt(text: string, input: Parameters<typeof voicePromptLines>[0]): string {
  // 이미지 @재연결이 인물 이름을 @시트명으로 바꿔도 이전 음성 줄을 알아보고 교체합니다.
  const managedVoiceLine = (line: string) =>
    (line.includes("의 대사는 @") && line.includes("의 목소리·발음·말투를 기준으로 연기하세요."))
    || (line.startsWith("Use @") && line.includes("as the voice, pronunciation and speaking-style reference for "))
    || line.includes(" 첫 등장 목소리 특징:")
    || line.includes("'s voice characteristics at first appearance:");
  const body = text.split(/\r?\n/).filter((line) => !managedVoiceLine(line))
    .join("\n").trim();
  const lines = voicePromptLines(input);
  return [body, lines.join("\n")].filter(Boolean).join("\n\n");
}
