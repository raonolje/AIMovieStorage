import { z } from "zod";
import { collectSheetSources } from "@/components/sheet/sheetSources";
import { composeSheet, layoutToPx, normalizeSheetSize, sheetProfileBasics } from "./sheetCompose";
import { deleteProjectMediaFile, saveProjectMediaAsset } from "./mediaLibrary";
import { projectFolderName } from "./localProjectStore";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { sameImmutableJson } from "./immutableJson";
import { uid, type Background, type Character, type ProjectDraft } from "./projectTypes";

const id = z.string().min(1).max(300);
export const sheetBakeSchema = z.object({ projectId: id, expectedRevision: id,
  owner: z.object({ kind: z.enum(["character", "background"]), id }).strict(),
  layoutId: id, operationId: id, label: z.string().trim().min(1).max(300).optional() }).strict();

function ownerOf(draft: ProjectDraft, kind: "character" | "background", ownerId: string): Character | Background | undefined {
  return (kind === "character" ? draft.characters : draft.backgrounds).find((item) => item.id === ownerId);
}

/** 앱 시트 창의 배치도·채우기·합성·폴더 저장 경로를 그대로 거치는 대화 조종 명령. */
export async function bakeControlSheet(raw: unknown) {
  const request = sheetBakeSchema.parse(raw);
  const before = await getProjectSnapshot(request.projectId, "summary");
  const draft = readProject(request.projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다.");
  const owner = ownerOf(draft, request.owner.kind, request.owner.id);
  if (!owner) throw new ProjectControlError("target_not_found", "캐릭터 또는 장소를 찾지 못했습니다.");
  const duplicateElsewhere = [...draft.characters, ...draft.backgrounds].some((item) => item.id !== owner.id
    && item.generatedImages.some((image) => image.importOperationId === request.operationId));
  if (duplicateElsewhere) throw new ProjectControlError("operation_conflict", "같은 작업 열쇠가 다른 카드에서 쓰였습니다.");
  const repeated = owner.generatedImages.find((image) => image.importOperationId === request.operationId);
  if (repeated) {
    if (repeated.importSourcePath !== `sheet:${request.layoutId}`)
      throw new ProjectControlError("operation_conflict", "같은 작업 열쇠에 다른 시트 배치도가 지정됐습니다.");
    // 앞선 호출이 화면에는 적용됐지만 project.json 확인만 실패했을 수 있습니다.
    // 중복 합성은 하지 않고 현재 판의 저장 확인을 다시 실행합니다.
    const confirmation = await writeProjectAndConfirm(request.projectId, () => ({}));
    if (!confirmation.persisted) throw new ProjectControlError("save_failed",
      confirmation.why || "시트가 화면에는 있지만 파일 저장을 확인하지 못했습니다.", { applied: true });
    return { projectId: request.projectId, revision: before.revision, imageId: repeated.id,
      path: repeated.filePath, reused: true, persisted: true };
  }
  if (before.revision !== request.expectedRevision)
    throw new ProjectControlError("revision_conflict", "시트 재료가 바뀌었습니다. 최신 프로젝트를 읽어 주세요.", { actualRevision: before.revision });
  const savedLayout = draft.sheetLayouts?.find((item) => item.id === request.layoutId);
  if (!savedLayout) throw new ProjectControlError("target_not_found", "시트 배치도를 찾지 못했습니다.");
  const layout = layoutToPx(savedLayout);
  const size = normalizeSheetSize(layout.size);
  const images = collectSheetSources(owner, draft.sharedAssets);
  const available = new Set(images.map((image) => image.id));
  const fills = owner.sheetFills?.[layout.id] ?? {};
  const placements = layout.placements.map((slot) => ({ ...slot,
    ...(slot.kind === "profile" ? {} : { imageId: fills[slot.id] }) }));
  if (!placements.length || !placements.some((slot) => slot.kind === "profile" || slot.imageId))
    throw new ProjectControlError("empty_sheet", "시트에 그릴 프로필이나 이미지가 없습니다.");
  if (placements.some((slot) => slot.imageId && !available.has(slot.imageId)))
    throw new ProjectControlError("invalid_reference", "시트 칸에 등록되지 않은 이미지가 연결돼 있습니다.");
  const basics = request.owner.kind === "character"
    ? sheetProfileBasics((owner as Character).profile, { name: owner.name, role: (owner as Character).role,
      heightCm: (owner as Character).heightCm, gender: (owner as Character).gender })
    : [{ label: "장소", value: owner.name }, { label: "위치", value: (owner as Background).location }].filter((line) => line.value);
  const blob = await composeSheet({ placements, images, size, captions: layout.captions,
    profile: request.owner.kind === "character" ? (owner as Character).profile : undefined, basics });
  const projectName = projectFolderName(request.projectId, draft.title);
  const stem = `${owner.name}_시트`;
  const file = new File([blob], `${stem}.png`, { type: "image/png" });
  const saved = await saveProjectMediaAsset(file, { projectName,
    assetType: request.owner.kind === "character" ? "character-generated" : "background-generated",
    ownerName: owner.name, stem });
  if (!saved?.path) throw new ProjectControlError("save_failed", "시트 파일을 프로젝트 폴더에 저장하지 못했습니다.");
  let applied = false;
  try {
    const latest = await getProjectSnapshot(request.projectId, "summary");
    if (latest.revision !== request.expectedRevision)
      throw new ProjectControlError("revision_conflict", "시트를 굽는 동안 프로젝트가 바뀌었습니다.", { actualRevision: latest.revision });
    const imageId = uid();
    const image = { id: imageId, name: saved.name, thumb: "", file: null, filePath: saved.path,
      importOperationId: request.operationId, importSourcePath: `sheet:${request.layoutId}`,
      sheetType: request.owner.kind, isCompositeSheet: true,
      sheetLabel: request.label || layout.name,
      sheet: { layoutId: layout.id, layoutName: layout.name, size, placements,
        captions: layout.captions, coords: "px" as const } };
    let conflicted = false;
    const outcome = await writeProjectAndConfirm(request.projectId, (current) => {
      if (!sameImmutableJson(current, draft)) { conflicted = true; return {}; }
      const key = request.owner.kind === "character" ? "characters" : "backgrounds";
      const entries = current[key];
      return { [key]: entries.map((entry) => entry.id === owner.id
        ? { ...entry, generatedImages: [...entry.generatedImages, image] } : entry) };
    });
    if (conflicted) throw new ProjectControlError("revision_conflict", "시트 저장 직전 프로젝트가 바뀌었습니다.");
    applied = Boolean(outcome.draft);
    if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "시트를 프로젝트에 등록하지 못했습니다.",
      { applied, retry: applied ? "project_get으로 저장 상태를 확인하세요." : "같은 operationId로 재시도하세요." });
    const confirmed = await getProjectSnapshot(request.projectId, "summary");
    return { projectId: request.projectId, revision: confirmed.revision, imageId,
      path: saved.path, reused: false, persisted: true, size };
  } finally {
    if (!applied) await deleteProjectMediaFile(projectName, saved.path).catch(() => undefined);
  }
}
