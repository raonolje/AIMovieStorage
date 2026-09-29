import { z } from "zod";
import { PANORAMA_DIR, assetSrc, deleteProjectMediaFile, importProjectMediaAsset } from "./mediaLibrary";
import { addCustomBackgroundIn, selectCustomBackgroundIn } from "./compositionEdit";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";
import { uid } from "./projectTypes";

export const compositionBackgroundImportSchema = compositionSessionRequestSchema.extend({
  sourcePath: z.string().min(1).max(4000), kind: z.enum(["background", "panorama", "hdri"]),
}).strict();

/** 화면의 직접 배경 추가처럼 같은 이름·갈래는 다시 복사하지 않고 기존 항목을 고릅니다. */
export async function importCompositionBackground(raw: unknown) {
  const request = compositionBackgroundImportSchema.parse(raw);
  const extension = request.sourcePath.split(/[\\/]/).pop()?.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
  const image = [".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(extension);
  if (request.kind === "hdri" ? ![".hdr", ".exr"].includes(extension) : !image)
    throw new CompositionControlError("unsupported_media", "배경 종류와 그림 파일의 확장자가 맞지 않습니다.");
  const fileName = request.sourcePath.split(/[\\/]/).pop()!;
  const wanted = fileName.replace(/\.[^.]+$/, "");
  let copiedPath: string | undefined;
  let projectName: string | undefined;
  try {
    return await applyCompositionMutation({ sessionId: request.sessionId, expectedRevision: request.expectedRevision,
      detail: request.detail }, async ({ state, identity }) => {
      const existing = state.customBackgrounds.find((item) => item.kind === request.kind && item.name === wanted);
      if (existing) return { state: selectCustomBackgroundIn(state, request.kind, existing.id),
        result: { id: existing.id, path: existing.filePath, reused: true } };
      projectName = identity.projectName;
      const saved = await importProjectMediaAsset(request.sourcePath, { projectName,
        assetType: "background-generated", ownerName: identity.sceneTitle || "구도 배경",
        subdir: request.kind === "panorama" ? PANORAMA_DIR : undefined });
      if (!saved) throw new CompositionControlError("import_unavailable", "프로젝트 저장 폴더를 확인하세요.");
      copiedPath = saved.path;
      const url = assetSrc(saved.path);
      const entry = { id: uid(), name: wanted, thumb: url, filePath: saved.path,
        kind: request.kind, fileName, sourceUrl: request.kind === "hdri" ? url : undefined };
      return { state: addCustomBackgroundIn(state, entry), result: { id: entry.id, path: saved.path, reused: false } };
    });
  } catch (error) {
    // 화면 확인 실패는 이미 구도에 적용된 상태일 수 있으므로 원본을 지우지 않습니다.
    const applied = error instanceof CompositionControlError && error.code === "edit_confirmation_failed"
      && Boolean((error.details as { applied?: boolean } | undefined)?.applied);
    if (copiedPath && projectName && !applied)
      await deleteProjectMediaFile(projectName, copiedPath).catch(() => undefined);
    throw error;
  }
}
