import { z } from "zod";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { deleteProjectMediaFile, fileStem, safeFileName, saveProjectMediaAsset } from "./mediaLibrary";
import { sceneFolderName } from "./projectNames";
import { buildStoryboardVideoPrompt, composeStoryboard, storyboardCells } from "./storyboardSheet";
import { storyboardLockNames, storyboardSwaps } from "./storyboardPromptRequest";
import { withStoryboardPrompt } from "./storyboardPromptHistory";

export const storyboardBakeSchema = z.object({
  projectId: z.string().min(1).max(200),
  sceneId: z.string().min(1).max(200),
  expectedRevision: z.string().min(1).max(200),
}).strict();

/** 화면의 «스토리보드 만들기»와 같은 컷·표시·교체 참조를 구워 프로젝트에 저장합니다. */
export async function bakeControlStoryboard(raw: unknown) {
  const request = storyboardBakeSchema.parse(raw);
  const before = await getProjectSnapshot(request.projectId, "summary");
  if (before.revision !== request.expectedRevision)
    throw new ProjectControlError("revision_conflict", "프로젝트가 바뀌었습니다. 새 판을 읽어 주세요.", { actualRevision: before.revision });
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const index = draft.scenes.findIndex((item) => item.id === request.sceneId);
  const scene = draft.scenes[index];
  if (!scene) throw new ProjectControlError("target_not_found", "장면을 찾지 못했습니다.");
  const cells = storyboardCells(scene, draft.imageMarks || {});
  if (!cells.length) throw new ProjectControlError("missing_images", "대표 컷 그림이나 저장된 구도 그림이 하나 이상 필요합니다.");
  const title = sceneFolderName(scene.title, index);
  const { blob } = await composeStoryboard(scene, { imageMarks: draft.imageMarks, aspect: draft.aspect?.image || "16:9" });
  const file = new File([blob], `${safeFileName(title)}_스토리보드.png`, { type: "image/png" });
  const saved = await saveProjectMediaAsset(file, { projectName: draft.title, assetType: "scene-cut", ownerName: title, stem: `${safeFileName(title)}_스토리보드` });
  if (!saved?.path) throw new ProjectControlError("save_failed", "스토리보드 그림을 프로젝트 폴더에 저장하지 못했습니다.");
  let committed = false;
  try {
    const latest = await getProjectSnapshot(request.projectId, "summary");
    if (latest.revision !== request.expectedRevision)
      throw new ProjectControlError("revision_conflict", "스토리보드를 만드는 동안 프로젝트가 바뀌었습니다.", { actualRevision: latest.revision });
    const swaps = storyboardSwaps(cells, draft.characters, draft.backgrounds);
    const prompt = buildStoryboardVideoPrompt({ sceneTitle: scene.title, sceneSummary: scene.summary, cells,
      sheetTag: `@${fileStem(saved.path)}`, swaps, aspect: draft.aspect?.video,
      lockNames: storyboardLockNames(scene, draft.characters) });
    let conflicted = false;
    const outcome = await writeProjectAndConfirm(request.projectId, (current) => {
      const now = current.scenes.find((item) => item.id === request.sceneId);
      if (!now || JSON.stringify(now) !== JSON.stringify(scene)) { conflicted = true; return {}; }
      return { scenes: current.scenes.map((item) => item.id === request.sceneId ? {
        ...item, storyboardPath: saved.path, storyboardAt: new Date().toISOString(),
        ...withStoryboardPrompt(item, prompt, "스토리보드 · 규칙 조립"),
      } : item) };
    });
    if (conflicted) throw new ProjectControlError("revision_conflict", "저장 직전 장면이 바뀌었습니다. 다시 읽어 주세요.");
    if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "스토리보드 저장에 실패했습니다.");
    committed = true;
    const after = await getProjectSnapshot(request.projectId, "summary");
    return { projectId: request.projectId, sceneId: request.sceneId, revision: after.revision,
      storyboardPath: saved.path, cellCount: cells.length, seconds: prompt.seconds, persisted: true };
  } finally {
    if (!committed) await deleteProjectMediaFile(draft.title, saved.path).catch(() => undefined);
  }
}
