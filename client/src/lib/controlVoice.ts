import { z } from "zod";
import { deleteProjectMediaFile } from "./mediaLibrary";
import { applyVoiceChange, extractVoiceFromPrimary, voiceSource, withPrimaryVoice } from "./characterVoice";
import { projectFolderName } from "./localProjectStore";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { enqueueTaskOperation, isStopping, registerTaskRunner, setTaskResult } from "./taskQueue";
import { generateCharacterVoice, VOICE_CATEGORIES, VOICE_LANGUAGES, VOICE_MODELS, VOICE_SPEAKERS } from "./voiceGeneration";
import { installLocalEngine, listLocalEngines } from "./localEngines";

export async function listControlVoiceModels() {
  const engine = (await listLocalEngines()).find((item) => item.id === "qwentts");
  return { engine: engine ?? null, models: VOICE_MODELS, categories: VOICE_CATEGORIES,
    speakers: VOICE_SPEAKERS, languages: VOICE_LANGUAGES,
    note: "VoiceDesign는 목소리 특징을 자유롭게 설계합니다. CustomVoice는 지정한 고정 화자의 연기 톤을 조절합니다. 한국어 고정 화자의 모국어는 Sohee입니다." };
}
export const voiceEngineInstallSchema = z.object({ operationId: z.string().min(1).max(300) }).strict();
export async function enqueueControlVoiceEngineInstall(raw: unknown) {
  const input = voiceEngineInstallSchema.parse(raw);
  return enqueueTaskOperation({ lane: "media", kind: "control.voice.install",
    projectId: "settings", projectTitle: "로컬 모델", label: "Qwen3-TTS 설치",
    operationId: input.operationId, payload: input });
}
registerTaskRunner("control.voice.install", async (_raw, report, task) => {
  if (isStopping(task.id)) return;
  await installLocalEngine("qwentts", (event) => report({ step: event.message || event.stage }));
  return { data: { engine: "qwentts", installed: true } };
});

const id = z.string().min(1).max(300);
export const voiceExtractSchema = z.object({
  projectId: id, expectedRevision: id, operationId: id,
  characterId: id, sourceCutId: id, sourceVideoId: id,
  startSeconds: z.number().finite().min(0), endSeconds: z.number().finite().positive(),
}).strict();
export const voiceSelectSchema = z.object({
  projectId: id, expectedRevision: id, characterId: id, referenceId: id,
}).strict();
export const voiceGenerateSchema = z.object({
  projectId: id, expectedRevision: id, operationId: id, characterId: id,
  dialogue: z.string().trim().min(1).max(1000),
  traits: z.string().trim().min(1).max(500),
  category: z.enum(VOICE_CATEGORIES), model: z.enum(VOICE_MODELS),
  speaker: z.enum(VOICE_SPEAKERS).optional(),
  language: z.enum(VOICE_LANGUAGES).default("Korean"),
}).strict();

export async function enqueueControlVoiceGeneration(raw: unknown) {
  const input = voiceGenerateSchema.parse(raw);
  const draft = readProject(input.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const character = draft.characters.find((item) => item.id === input.characterId);
  if (!character) throw new ProjectControlError("character_not_found", "캐릭터를 찾지 못했습니다.");
  if (input.model !== "design" && !input.speaker)
    throw new ProjectControlError("speaker_required", "고정 화자 모델의 화자를 선택하세요.");
  const engine = (await listLocalEngines()).find((item) => item.id === "qwentts");
  if (!engine?.installed)
    throw new ProjectControlError("engine_not_installed", "설정 → 로컬 모델에서 Qwen3-TTS를 먼저 설치하세요.");
  const before = await getProjectSnapshot(input.projectId, "summary");
  if (before.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 새 판을 읽고 다시 요청하세요.", { actualRevision: before.revision });
  return enqueueTaskOperation({ lane: "media", kind: "control.voice.generate",
    projectId: input.projectId, projectTitle: draft.title, label: `외부 조종 · ${character.name} 목소리`,
    operationId: input.operationId, payload: input });
}

registerTaskRunner("control.voice.generate", async (raw, report, task) => {
  if (isStopping(task.id)) return;
  const input = voiceGenerateSchema.parse(raw);
  const draft = readProject(input.projectId);
  const character = draft?.characters.find((item) => item.id === input.characterId);
  if (!draft || !character) throw new Error("목소리를 붙일 캐릭터를 찾지 못했습니다.");
  const existing = character.voiceReferences?.find((item) => item.operationId === input.operationId);
  if (existing) return { paths: [existing.filePath], data: { reference: existing, attached: true } };
  const projectName = projectFolderName(input.projectId, draft.title);
  const beforeReferences = JSON.stringify(character.voiceReferences || []);
  const saved = task.result?.data?.reference as Awaited<ReturnType<typeof generateCharacterVoice>> | undefined;
  const reference = saved ?? await generateCharacterVoice({
    projectName, characterName: character.name, dialogue: input.dialogue, traits: input.traits,
    category: input.category, model: input.model, speaker: input.speaker, language: input.language,
    operationId: input.operationId, onProgress: (step) => report({ step }),
  });
  setTaskResult(task.id, { paths: [reference.filePath], data: { reference, attached: false } });
  if (isStopping(task.id)) return { paths: [reference.filePath], data: { reference, attached: false, cancelled: true } };
  const outcome = await writeProjectAndConfirm(input.projectId, (current) => {
    const owner = current.characters.find((item) => item.id === input.characterId);
    if (!owner) return {};
    if (owner.voiceReferences?.some((item) => item.operationId === input.operationId)) return {};
    const unchanged = JSON.stringify(owner.voiceReferences || []) === beforeReferences;
    return applyVoiceChange(current, owner.id, (item) => ({
      ...(unchanged ? withPrimaryVoice(item, reference) : {
        ...item, voiceReferences: [...(item.voiceReferences || []), { ...reference, isPrimary: false }],
      }),
      voiceDescription: item.voiceDescription?.trim() || `${input.traits} (${input.category})`,
    }));
  });
  if (!outcome.persisted) throw new Error(outcome.why || "생성 음성을 프로젝트에 저장하지 못했습니다.");
  return { paths: [reference.filePath], data: { reference, attached: true } };
});

export async function extractControlVoice(raw: unknown) {
  const input = voiceExtractSchema.parse(raw);
  const draft = readProject(input.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const character = draft.characters.find((item) => item.id === input.characterId);
  if (!character) throw new ProjectControlError("character_not_found", "캐릭터를 찾지 못했습니다.");
  const previous = character.voiceReferences?.find((item) => item.operationId === input.operationId);
  if (previous) {
    if (previous.sourceCutId !== input.sourceCutId || previous.sourceVideoId !== input.sourceVideoId
      || previous.startSeconds !== input.startSeconds || previous.endSeconds !== input.endSeconds)
      throw new ProjectControlError("operation_conflict", "같은 작업 ID에 다른 인물 음성 구간을 지정했습니다.");
    return { reference: previous, reused: true, persisted: true };
  }
  voiceSource(draft, input.characterId, input.sourceCutId, input.sourceVideoId);
  if (input.endSeconds - input.startSeconds < 2 || input.endSeconds - input.startSeconds > 30)
    throw new ProjectControlError("invalid_range", "한 인물의 대사 구간을 2~30초로 지정하세요.");
  const before = await getProjectSnapshot(input.projectId, "summary");
  if (before.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 새 판을 읽고 다시 요청하세요.", { actualRevision: before.revision });
  const projectName = projectFolderName(input.projectId, draft.title);
  const reference = await extractVoiceFromPrimary({
    draft, projectName, characterId: input.characterId,
    sourceCutId: input.sourceCutId, sourceVideoId: input.sourceVideoId,
    startSeconds: input.startSeconds, endSeconds: input.endSeconds, operationId: input.operationId,
  });
  let committed = false;
  try {
    const latest = await getProjectSnapshot(input.projectId, "summary");
    if (latest.revision !== input.expectedRevision)
      throw new ProjectControlError("revision_conflict", "음성을 추출하는 동안 프로젝트가 바뀌었습니다. 새 판에서 다시 요청하세요.", { actualRevision: latest.revision });
    let conflicted = false;
    const outcome = await writeProjectAndConfirm(input.projectId, (current) => {
      const owner = current.characters.find((item) => item.id === input.characterId);
      if (!owner || JSON.stringify(owner.voiceReferences || []) !== JSON.stringify(character.voiceReferences || [])) {
        conflicted = true; return {};
      }
      return applyVoiceChange(current, owner.id, (item) => withPrimaryVoice(item, reference));
    });
    if (conflicted) throw new ProjectControlError("revision_conflict", "캐릭터 음성이 변경되었습니다. 새 판을 확인하세요.");
    if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "음성 레퍼런스를 저장하지 못했습니다.");
    committed = true;
    return { reference, reused: false, persisted: true, revision: (await getProjectSnapshot(input.projectId, "summary")).revision };
  } finally {
    if (!committed) await deleteProjectMediaFile(projectName, reference.filePath).catch(() => undefined);
  }
}

export async function selectControlVoice(raw: unknown) {
  const input = voiceSelectSchema.parse(raw);
  const before = await getProjectSnapshot(input.projectId, "summary");
  if (before.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 새 판을 읽고 다시 요청하세요.", { actualRevision: before.revision });
  const draft = readProject(input.projectId);
  const character = draft?.characters.find((item) => item.id === input.characterId);
  if (!character?.voiceReferences?.some((item) => item.id === input.referenceId))
    throw new ProjectControlError("reference_not_found", "캐릭터의 저장된 음성 ID를 고르세요.");
  const outcome = await writeProjectAndConfirm(input.projectId, (current) => applyVoiceChange(current, input.characterId,
    (item) => ({ voiceReferences: item.voiceReferences?.map((reference) => ({ ...reference, isPrimary: reference.id === input.referenceId })) })));
  if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "음성 대표를 저장하지 못했습니다.");
  return { persisted: true, revision: (await getProjectSnapshot(input.projectId, "summary")).revision };
}
