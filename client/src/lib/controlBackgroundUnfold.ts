import { z } from "zod";
import { assetSrc, deleteProjectMediaFile, loadImageForCanvas } from "./mediaLibrary";
import { projectFolderName } from "./localProjectStore";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { backgroundColorOf, assessCrossFaces, measureCrossFaces, cutCrossFaces, looksLikeCrossUnfold } from "./crossUnfold";
import { saveFaceSet } from "./faceSetSave";
import { faceFileToken } from "./faceSets";
import { withFaceSetSize } from "./pngMeta";
import { autoEquirectOf } from "@/components/project/useAutoUnfold";
import { uid } from "./projectTypes";
import { sameImmutableJson } from "./immutableJson";

const id = z.string().min(1).max(300);
const crossLines = z.object({
  x: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  y: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
}).strict().refine((lines) => [lines.x, lines.y].every((axis) => axis.every((value, index) => index === 0 || value - axis[index - 1] >= 0.02)),
  "전개도 경계선은 왼쪽/위쪽부터 순서대로 두고 칸을 최소 2% 이상 확보하세요.");
export const backgroundUnfoldSchema = z.object({
  projectId: id, expectedRevision: id, backgroundId: id, imageId: id,
  /** 자동 판정이 놓친 전개도는 화면의 수동 경계선과 같은 정규화 좌표를 지정합니다. */
  lines: crossLines.optional(),
}).strict();

/** UI 자동 커팅과 같은 판정·안전 검사·세트 저장을 대화 조종기에서도 명시적으로 실행합니다. */
export async function unfoldBackgroundImage(raw: unknown) {
  const request = backgroundUnfoldSchema.parse(raw);
  const before = await getProjectSnapshot(request.projectId, "summary");
  if (before.revision !== request.expectedRevision)
    throw new ProjectControlError("revision_conflict", "장소가 바뀌었습니다. 최신 프로젝트를 읽어 주세요.", { actualRevision: before.revision });
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const background = draft.backgrounds.find((item) => item.id === request.backgroundId);
  const source = background?.generatedImages.find((item) => item.id === request.imageId);
  if (!background || !source?.filePath) throw new ProjectControlError("target_not_found", "저장된 장소 전개도 이미지를 찾지 못했습니다.");
  if (source.unfoldedAt) {
    const existing = background.generatedImages.filter((item) => item.faceSet && item.face);
    return { projectId: request.projectId, revision: before.revision, alreadyUnfolded: true,
      faceSets: [...new Set(existing.map((item) => item.faceSet))] };
  }
  const image = await loadImageForCanvas(assetSrc(source.filePath) || source.thumb);
  const lines = request.lines ?? looksLikeCrossUnfold(image);
  if (!lines) throw new ProjectControlError("not_cross_unfold", "이 이미지는 완성된 십자 전개도로 판정되지 않았습니다. 앱의 전개도 편집 화면에서 경계를 확인하세요.");
  const backgroundColor = backgroundColorOf(image);
  const plan = autoEquirectOf(background.blueprint, background.spaceKind,
    background.panoramaSpace, background.exteriorSpace, null, background.promptEn || background.promptKo);
  const faces = cutCrossFaces(image, lines, { background: backgroundColor, targetSize: plan?.stamp });
  if (faces.length !== 6) throw new ProjectControlError("incomplete_faces", "전개도의 여섯 면을 모두 자르지 못했습니다.");
  const inspection = assessCrossFaces(measureCrossFaces(faces, backgroundColor), plan?.stamp);
  if (!inspection.safe) throw new ProjectControlError("unsafe_unfold", "전개도 경계를 확인해야 합니다. 원본은 그대로 두었습니다.", { issues: inspection.issues });

  const files: Array<{ file: File; face: (typeof faces)[number]["face"] }> = [];
  for (const cut of faces) {
    const png = await new Promise<Blob | null>((resolve) => cut.canvas.toBlob(resolve, "image/png"));
    if (!png) throw new ProjectControlError("image_encode_failed", "여섯 면 그림을 PNG로 만들지 못했습니다.");
    const blob = plan?.stamp ? await withFaceSetSize(png, plan.stamp) : png;
    files.push({ file: new File([blob], `${faceFileToken(cut.face, background.spaceKind)}.png`, { type: "image/png" }), face: cut.face });
  }
  const projectName = projectFolderName(request.projectId, draft.title);
  const saved = await saveFaceSet({ files, projectName, assetType: "background-generated", ownerName: background.name,
    prefix: plan?.outer ? `${background.name}_외벽` : background.name, spaceKind: background.spaceKind });
  let committed = false;
  try {
    if (saved.saved.length !== 6 || saved.setIds.length !== 1 || saved.stoppedBecause)
      throw new ProjectControlError("face_set_incomplete", "6면을 한 세트로 저장하지 못했습니다.", { saved: saved.saved.length, reason: saved.stoppedBecause });
    const latest = await getProjectSnapshot(request.projectId, "summary");
    if (latest.revision !== request.expectedRevision)
      throw new ProjectControlError("revision_conflict", "6면을 자르는 동안 프로젝트가 바뀌었습니다.", { actualRevision: latest.revision });
    let conflicted = false;
    const outcome = await writeProjectAndConfirm(request.projectId, (current) => {
      if (!sameImmutableJson(current, draft)) { conflicted = true; return {}; }
      const stamp = new Date().toISOString();
      const added = saved.saved.map((item) => ({ id: uid(), name: item.name, thumb: item.thumb ?? "", file: null,
        filePath: item.path, face: item.face, faceSet: item.faceSet,
        ...(plan?.stamp ? { faceSetSize: plan.stamp } : {}) }));
      return { backgrounds: current.backgrounds.map((item) => item.id !== background.id ? item : {
        ...item, generatedImages: [...item.generatedImages.map((asset) => asset.id === source.id ? { ...asset, unfoldedAt: stamp } : asset), ...added],
      }) };
    });
    if (conflicted) throw new ProjectControlError("revision_conflict", "6면 저장 직전 프로젝트가 바뀌었습니다.");
    if (!outcome.persisted) {
      // 화면에는 이미 적용됐는데 디스크 확인만 실패한 경우, 등록된 얼굴 파일을 지우면 이미지가 깨집니다.
      committed = Boolean(outcome.draft);
      throw new ProjectControlError("save_failed", outcome.why || "6면 세트를 프로젝트에 등록하지 못했습니다.",
        { applied: committed, retry: committed ? "project_get으로 최신 상태를 확인한 뒤 저장을 다시 시도하세요." : "같은 이미지를 다시 실행할 수 있습니다." });
    }
    committed = true;
    const confirmed = await getProjectSnapshot(request.projectId, "summary");
    return { projectId: request.projectId, revision: confirmed.revision, faceSet: saved.setIds[0],
      faces: saved.saved.map((item) => ({ face: item.face, path: item.path })), persisted: true };
  } finally {
    if (!committed) await Promise.all(saved.saved.map((item) => deleteProjectMediaFile(projectName, item.path).catch(() => undefined)));
  }
}
