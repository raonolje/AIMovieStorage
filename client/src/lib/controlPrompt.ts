import { z } from "zod";
import { blueprintForSpace } from "@/lib/blueprint";
import { appPromptRequest } from "@/lib/appPromptRequest";
import { appPromptTargetSchema, getProjectSnapshot, ProjectControlError } from "@/lib/projectControl";
import { toLlmImage } from "@/lib/llm";
import { assetSrc, deleteProjectMediaFile, saveProjectMediaAsset } from "@/lib/mediaLibrary";
import { isUnfoldTemplateReference, unfoldTemplateWanted } from "@/lib/promptPayloads";
import { buildPromptRequestText } from "@/lib/promptRequest";
import { readProject, writeProjectAndConfirm } from "@/lib/projectWrite";
import { uid } from "@/lib/projectTypes";
import { buildUnfoldTemplate } from "@/lib/unfoldPrompt";

export const promptPrepareSchema = z.object({
  projectId: z.string().min(1).max(200),
  expectedRevision: z.string().min(1).max(200),
  target: appPromptTargetSchema,
}).strict();

/** 전개도 틀도 카드 버튼처럼 요청 전에 만들고 저장합니다. */
async function ensureBackgroundTemplate(projectId: string, id: string, expectedRevision: string): Promise<string> {
  const draft = readProject(projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const background = draft.backgrounds.find((item) => item.id === id);
  if (!background) throw new ProjectControlError("target_not_found", "장소를 찾지 못했습니다.");
  const blueprint = blueprintForSpace(background.blueprint, background.spaceKind || "exterior");
  const wanted = unfoldTemplateWanted(blueprint, background.panoramaSpace);
  if (!wanted || background.references.some((item) => item.label === wanted.label && item.filePath)) return expectedRevision;

  const { canvas } = buildUnfoldTemplate(wanted.box, 2160, true, wanted.horizon);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("전개도 틀 그림을 만들지 못했습니다.");
  const file = new File([blob], "전개도 틀.png", { type: "image/png" });
  const saved = await saveProjectMediaAsset(file, {
    projectName: draft.title, assetType: "background-reference", ownerName: background.name,
  });
  if (!saved) throw new Error("전개도 틀을 프로젝트 폴더에 저장하지 못했습니다.");
  let committed = false;
  const old = background.references.find((item) => isUnfoldTemplateReference(item) && !item.isParentReference && !item.sharedFile);
  try {
    const newest = await getProjectSnapshot(projectId, "summary");
    if (newest.revision !== expectedRevision)
      throw new ProjectControlError("revision_conflict", "전개도 틀을 만드는 동안 프로젝트가 바뀌었습니다. 다시 읽어 주세요.", { actualRevision: newest.revision });

    const replacement = {
      id: old?.id || uid(), name: saved.name, thumb: assetSrc(saved.path) || "",
      file: null, filePath: saved.path, label: wanted.label,
    };
    let conflicted = false;
    const outcome = await writeProjectAndConfirm(projectId, (current) => {
      const latest = current.backgrounds.find((item) => item.id === id);
      if (!latest || JSON.stringify(latest) !== JSON.stringify(background)) {
        conflicted = true;
        return {};
      }
      const references = old
        ? latest.references.map((item) => item.id === old.id ? replacement : item)
        : [...latest.references, replacement];
      return { backgrounds: current.backgrounds.map((item) => item.id === id ? { ...item, references } : item) };
    });
    if (conflicted) throw new ProjectControlError("revision_conflict", "전개도 틀을 저장하기 전에 장소 카드가 바뀌었습니다. 다시 읽어 주세요.");
    if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "전개도 틀의 프로젝트 저장에 실패했습니다.");
    committed = true;
  } finally {
    // 저장 충돌·실패 뒤 새 틀 파일만 남으면 폴더 동기화에서 되살아납니다.
    if (!committed) await deleteProjectMediaFile(draft.title, saved.path).catch(() => undefined);
  }
  if (old?.filePath && old.filePath !== saved.path)
    await deleteProjectMediaFile(draft.title, old.filePath).catch(() => undefined);
  return (await getProjectSnapshot(projectId, "summary")).revision;
}

/** 앱 API·LLM 요청문 창과 같은 요청을 Codex/Claude에 돌려줍니다. 그림도 API와 같은 순서입니다. */
export async function prepareControlPrompt(raw: unknown) {
  const request = promptPrepareSchema.parse(raw);
  const before = await getProjectSnapshot(request.projectId, "summary");
  if (before.revision !== request.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 다시 읽어 주세요.", { actualRevision: before.revision });
  const revision = request.target.kind === "background"
    ? await ensureBackgroundTemplate(request.projectId, request.target.id, before.revision)
    : before.revision;
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const options = appPromptRequest(draft, request.target);
  const sources = (options.images ?? []).slice(0, 4);
  const parts = await buildPromptRequestText(options, sources.length);
  const prompt = [parts.fixed, parts.fresh].filter(Boolean).join("\n\n---\n\n");
  const images = await Promise.all(sources.map((source) => toLlmImage(source)));
  const latest = await getProjectSnapshot(request.projectId, "summary");
  if (latest.revision !== revision)
    throw new ProjectControlError("revision_conflict", "요청문을 준비하는 동안 프로젝트가 바뀌었습니다. 새 판으로 다시 요청해 주세요.", { actualRevision: latest.revision });
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({
        projectId: request.projectId, revision, target: request.target,
        request: prompt,
        apply: "project_update의 prompt.apply에 ko/en/negativeKo/negativeEn을 넣으세요. 적용 전 revision이 바뀌었다면 요청문부터 다시 읽으세요.",
      }) },
      ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mediaType })),
    ],
    structuredContent: { projectId: request.projectId, revision, target: request.target, request: prompt, imageCount: images.length },
  };
}
