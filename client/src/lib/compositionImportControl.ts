import { z } from "zod";
import { importMusicToBgm, BGM_ROOT } from "./bgmLibrary";
import { measureAudioSeconds } from "./audioDuration";
import { addGlbTrackIn, createGlbTrack, setMusicIn, setTimelineIn } from "./compositionEdit";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";
import { assetSrc, deleteProjectMediaFile, importProjectMediaAsset } from "./mediaLibrary";

const input = compositionSessionRequestSchema.extend({ sourcePath: z.string().min(1).max(4000) }).strict();
export const compositionMusicImportSchema = input.extend({ fitTimeline: z.boolean().optional() }).strict();
export const compositionGlbImportSchema = input;

// 화면 확인만 실패한 경우 편집은 이미 들어가 있습니다. 여기서 복사본을 지우면 트랙이 깨집니다.
function appliedBeforeError(error: unknown): boolean {
  return error instanceof CompositionControlError && error.code === "edit_confirmation_failed"
    && Boolean((error.details as { applied?: boolean } | undefined)?.applied);
}

/** 화면의 파일 가져오기와 같은 BGM 폴더에 복사한 뒤 실제 길이를 재서 올립니다. */
export async function importCompositionMusic(raw: unknown) {
  const request = compositionMusicImportSchema.parse(raw);
  if (!/\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(request.sourcePath))
    throw new CompositionControlError("unsupported_media", "지원하는 음원 파일을 지정하세요.");
  let copiedPath: string | undefined;
  try {
    return await applyCompositionMutation({ sessionId: request.sessionId, expectedRevision: request.expectedRevision, detail: request.detail }, async ({ state, identity }) => {
      const copied = await importMusicToBgm(request.sourcePath, { projectName: identity.projectName,
        sceneTitle: identity.sceneTitle, cutOrder: identity.cutOrder });
      if (!copied) throw new CompositionControlError("import_unavailable", "앱의 BGM 저장 폴더를 확인하세요.");
      copiedPath = copied.path;
      const seconds = await measureAudioSeconds(copied.path);
      const withMusic = setMusicIn(state, { path: copied.path, name: copied.name, seconds, startTime: 0, sections: [] });
      return { state: request.fitTimeline ? setTimelineIn(withMusic, { duration: Math.round(seconds * 10) / 10 }) : withMusic,
        result: { path: copied.path, name: copied.name, seconds, fitTimeline: request.fitTimeline === true } };
    });
  } catch (error) {
    if (copiedPath && !appliedBeforeError(error)) await deleteProjectMediaFile(BGM_ROOT, copiedPath).catch(() => undefined);
    throw error;
  }
}

/** 앱과 같은 프로젝트 composition 폴더에 GLB를 복사해 타임라인 트랙으로 만듭니다. */
export async function importCompositionGlb(raw: unknown) {
  const request = compositionGlbImportSchema.parse(raw);
  if (!/\.(glb|gltf)$/i.test(request.sourcePath))
    throw new CompositionControlError("unsupported_media", "GLB 또는 GLTF 파일을 지정하세요.");
  let copiedPath: string | undefined;
  let projectName: string | undefined;
  try {
    return await applyCompositionMutation({ sessionId: request.sessionId, expectedRevision: request.expectedRevision, detail: request.detail }, async ({ state, identity }) => {
      projectName = identity.projectName;
      const fileName = request.sourcePath.split(/[\\/]/).pop() || "Animation.glb";
      const copied = await importProjectMediaAsset(request.sourcePath, { projectName: identity.projectName,
        assetType: "composition-glb", ownerName: fileName.replace(/\.[^.]+$/, "") });
      if (!copied) throw new CompositionControlError("import_unavailable", "앱의 프로젝트 저장 폴더를 확인하세요.");
      copiedPath = copied.path;
      const track = { ...createGlbTrack(fileName, assetSrc(copied.path)), filePath: copied.path };
      return { state: addGlbTrackIn(state, track), result: { trackId: track.id, path: copied.path } };
    });
  } catch (error) {
    if (copiedPath && projectName && !appliedBeforeError(error))
      await deleteProjectMediaFile(projectName, copiedPath).catch(() => undefined);
    throw error;
  }
}
