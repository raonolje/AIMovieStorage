import { z } from "zod";
import { getTargetPlatform } from "@/components/PlatformSelect";
import { projectContextOf } from "@/lib/projectContext";
import { assetSrc } from "@/lib/mediaLibrary";
import { characterBasics, backgroundCardDescription, sheetReferenceSources, sheetReferenceTags } from "@/lib/promptPayloads";
import { buildPromptRequestText, type LlmRequestOptions } from "@/lib/promptRequest";
import { toLlmImage } from "@/lib/llm";
import { readProject } from "@/lib/projectWrite";
import { getProjectSnapshot, ProjectControlError } from "@/lib/projectControl";
import { characterProfileRequestData, referenceAnalysisRequestData, firstReferenceRequestData, backgroundFacesRequestData } from "@/lib/supplementalPromptPayload";

const id = z.string().min(1).max(200);
export const supplementalPromptPrepareSchema = z.object({
  projectId: id, expectedRevision: id,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("characterProfile"), id }).strict(),
    z.object({ kind: z.literal("characterAnalysis"), id }).strict(),
    z.object({ kind: z.literal("backgroundAnalysis"), id }).strict(),
    z.object({ kind: z.literal("characterFirstReference"), id }).strict(),
    z.object({ kind: z.literal("backgroundFirstReference"), id }).strict(),
    z.object({ kind: z.literal("backgroundFaces"), id }).strict(),
  ]),
}).strict();

/** API 버튼과 같은 payload 함수 및 동일한 요청문 조립기를 사용합니다. */
export async function prepareSupplementalPrompt(raw: unknown) {
  const request = supplementalPromptPrepareSchema.parse(raw);
  const before = await getProjectSnapshot(request.projectId, "summary");
  if (before.revision !== request.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 다시 읽어 주세요.", { actualRevision: before.revision });
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const { kind, id: targetId } = request.target;
  const character = draft.characters.find((item) => item.id === targetId);
  const background = draft.backgrounds.find((item) => item.id === targetId);
  const isCharacter = kind.startsWith("character");
  const entity = isCharacter ? character : background;
  if (!entity) throw new ProjectControlError("target_not_found", "프롬프트를 작성할 카드를 찾지 못했습니다.");
  const project = projectContextOf(draft)?.facts ?? null;
  const platformId = getTargetPlatform();
  const base: Pick<LlmRequestOptions, "task" | "template" | "modelId" | "platformId" | "data" | "images"> = {
    task: "characterProfile", template: "character-profile", platformId,
    data: null, images: [],
  };
  if (kind === "characterProfile" && character) {
    base.data = characterProfileRequestData({
      project, projectName: draft.title,
      basics: { name: character.name, role: character.role, gender: character.gender, heightCm: character.heightCm, description: character.description },
      profile: character.profile,
    });
    base.images = sheetReferenceSources(character.references).slice(0, 2);
  } else if (kind === "characterAnalysis" || kind === "backgroundAnalysis") {
    base.task = kind === "characterAnalysis" ? "characterAnalysis" : "backgroundAnalysis";
    base.template = kind === "characterAnalysis" ? "character-analysis" : "background-analysis";
    base.images = sheetReferenceSources(entity.references);
    if (!base.images.length) throw new ProjectControlError("missing_reference", "분석할 레퍼런스 이미지가 없습니다.");
    base.data = referenceAnalysisRequestData({
      project, name: entity.name,
      description: kind === "characterAnalysis" ? character!.description : backgroundCardDescription(background!),
      references: sheetReferenceTags(entity.references, platformId),
    });
  } else if (kind === "characterFirstReference" || kind === "backgroundFirstReference") {
    base.task = "firstReference";
    base.template = "first-reference";
    base.data = firstReferenceRequestData({
      project, kind: isCharacter ? "character" : "background", name: entity.name,
      description: isCharacter ? character!.description : backgroundCardDescription(background!),
      basics: character ? characterBasics(character).basics : null,
      analysis: entity.analysis, spaceKind: background?.spaceKind,
      firstReferenceModel: entity.firstReferenceModel,
    });
    base.modelId = (base.data as { modelId: string }).modelId;
  } else if (kind === "backgroundFaces" && background) {
    base.task = "backgroundSheet";
    base.template = "background-faces";
    base.modelId = background.promptModel;
    const markSource = background.generatedImages.find((image) => image.id === background.faceMarkSourceId) || background.generatedImages[0];
    const marks = markSource?.filePath ? draft.imageMarks?.[markSource.filePath] || [] : [];
    base.data = backgroundFacesRequestData(project, background, marks);
    const image = markSource && (assetSrc(markSource.filePath) || markSource.thumb);
    if (!image) throw new ProjectControlError("missing_reference", "6면 프롬프트의 기준 그림을 먼저 등록하세요.");
    base.images = image ? [image] : [];
  }
  const sources = (base.images ?? []).slice(0, 4);
  const imageCount = kind === "backgroundFaces" ? 1 : sources.length;
  const parts = await buildPromptRequestText(base as LlmRequestOptions, imageCount);
  const prompt = [parts.fixed, parts.fresh].filter(Boolean).join("\n\n---\n\n");
  const images = await Promise.all(sources.map((source) => toLlmImage(source)));
  const latest = await getProjectSnapshot(request.projectId, "summary");
  if (latest.revision !== before.revision)
    throw new ProjectControlError("revision_conflict", "요청문을 준비하는 동안 프로젝트가 바뀌었습니다. 새 판으로 다시 요청해 주세요.", { actualRevision: latest.revision });
  const apply = kind === "characterProfile" ? "project_update character.profile의 fields에 받은 프로필 항목을 넣으세요."
    : kind.endsWith("Analysis") ? "project_update의 해당 카드 .update fields에 analysis와 analysisEn을 넣으세요."
      : kind.endsWith("FirstReference") ? "project_update의 해당 카드 .update fields에 firstReferencePromptKo와 firstReferencePromptEn을 함께 넣으세요."
        : "project_update prompt.apply의 background 대상에 ko/en/negativeKo/negativeEn을 넣으세요.";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ projectId: request.projectId, revision: before.revision, target: request.target, request: prompt, apply }) },
      ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mediaType }))],
    structuredContent: { projectId: request.projectId, revision: before.revision, target: request.target, request: prompt, imageCount: images.length, apply },
  };
}
