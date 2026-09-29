import { normalizeProfile, type CharacterProfile } from "@/lib/characterProfile";
import { describeMarksForLlm, type DrawableMark } from "@/lib/imageMarkDraw";
import { modelLabel, normalizeImageModelId } from "@/lib/promptLibrary";
import type { Background } from "@/lib/projectTypes";

/** API 버튼, 요청문 창, Codex/Claude 조종기가 동일한 데이터를 싣습니다. */
export function characterProfileRequestData(input: {
  project: unknown; projectName?: string;
  basics: { name?: string; role?: string; gender?: string; heightCm?: number; description?: string };
  profile?: Partial<CharacterProfile> | null;
}) {
  return { project: input.project, projectName: input.projectName, basics: input.basics, current: normalizeProfile(input.profile) };
}

export function referenceAnalysisRequestData(input: {
  project: unknown; name: string; description: string; references: unknown[];
}) {
  return { project: input.project, name: input.name, description: input.description, references: input.references };
}

export function firstReferenceRequestData(input: {
  project: unknown; kind: string; name: string; description: string;
  basics: string[] | null; analysis?: string | null; spaceKind?: string | null;
  firstReferenceModel?: string;
}) {
  const modelId = normalizeImageModelId(input.firstReferenceModel);
  return {
    project: input.project, kind: input.kind, name: input.name,
    description: input.description, basics: input.basics,
    analysis: input.analysis || null, spaceKind: input.spaceKind ?? null,
    modelId, modelLabel: modelLabel(modelId),
  };
}

export function backgroundFacesRequestData(project: unknown, background: Background, marks: (DrawableMark & { note?: string })[]) {
  return {
    project, name: background.name, location: background.location,
    description: background.description, analysis: background.analysis || null,
    spaceKind: background.spaceKind || "exterior", requiredAspects: background.blueprint,
    marks: describeMarksForLlm(marks),
  };
}
