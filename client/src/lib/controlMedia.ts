import { z } from "zod";
import {
  LOCAL_ENGINE_IDS,
  LOCAL_ENGINE_CATALOG,
  listLocalEngines,
  type LocalEngineId,
} from "./localEngines";
import { runLocalToProject } from "./localOutput";
import {
  UPSCALE_ENGINE_IDS,
  listEngines,
  upscaleFileToNew,
  type UpscaleEngineId,
} from "./upscale";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { projectFolderName } from "./localProjectStore";
import {
  assetSrc,
  loadImageForCanvas,
  type ProjectAssetType,
} from "./mediaLibrary";
import { sceneFolderName } from "./projectNames";
import {
  uid,
  type ProjectDraft,
  type GeneratedImageAsset,
} from "./projectTypes";
import {
  enqueueTaskOperation,
  isStopping,
  registerTaskRunner,
  setTaskResult,
} from "./taskQueue";

const id = z.string().min(1).max(200);
export const mediaTargetSchema = z
  .object({ kind: z.enum(["character", "background", "cut"]), id })
  .strict();
const optionsSchema = z
  .object({
    prompt: z.string().min(1).max(32000),
    negative: z.string().max(32000).optional(),
    width: z.number().int().min(64).max(4096).optional(),
    height: z.number().int().min(64).max(4096).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    steps: z.number().int().min(1).max(100).optional(),
    guidance: z.number().min(0).max(30).optional(),
    seconds: z.number().min(1).max(60).optional(),
    fps: z.number().int().min(1).max(60).optional(),
    precision: z.enum(["auto", "bf16", "int8", "int4"]).optional(),
  })
  .strict();
// 발견 규격에도 실제 지원 갈래만 표시합니다. 음악·모캡은 별도 작업 계약이 필요합니다.
const GENERATION_ENGINE_IDS = LOCAL_ENGINE_IDS.filter(id =>
  LOCAL_ENGINE_CATALOG[id].kind === "image" || LOCAL_ENGINE_CATALOG[id].kind === "video",
);
export const generateMediaSchema = z
  .object({
    projectId: id,
    target: mediaTargetSchema,
    engine: z.enum(GENERATION_ENGINE_IDS as [LocalEngineId, ...LocalEngineId[]]),
    operationId: id,
    options: optionsSchema,
    imageAssetId: id.optional(),
    motionMaskAssetId: id.optional(),
    referenceAssetIds: z.array(id).max(12).optional(),
  })
  .strict();
export const upscaleMediaSchema = z
  .object({
    projectId: id,
    assetId: id,
    operationId: id,
    engine: z.enum(
      UPSCALE_ENGINE_IDS as [UpscaleEngineId, ...UpscaleEngineId[]],
    ),
    targetSize: z.union([
      z.literal(2048),
      z.literal(4096),
      z.literal(6144),
      z.literal(8192),
    ]),
  })
  .strict();

export interface ControlAsset {
  id: string;
  path: string;
  name: string;
  kind: "image" | "video" | "audio" | "other";
  target?: z.infer<typeof mediaTargetSchema>;
}
function mediaKind(path: string): ControlAsset["kind"] {
  if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(path)) return "image";
  if (/\.(mp4|webm|mov)$/i.test(path)) return "video";
  if (/\.(wav|mp3|ogg|flac)$/i.test(path)) return "audio";
  return "other";
}
export function listControlAssets(projectId: string): ControlAsset[] {
  const draft = readProject(projectId);
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  const assets = new Map<string, ControlAsset>();
  const visit = (
    value: unknown,
    target?: ControlAsset["target"],
    key = "draft",
  ) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, target, `${key}/${i}`));
      return;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.filePath === "string") {
      const assetId = typeof entry.id === "string" ? entry.id : key;
      assets.set(assetId, {
        id: assetId,
        path: entry.filePath,
        name: String(entry.name || assetId),
        kind: mediaKind(entry.filePath),
        target,
      });
    }
    for (const field of [
      "guideImagePath",
      "plateImagePath",
      "refVideoPath",
      "coverPath",
    ]) {
      if (typeof entry[field] === "string") {
        const assetId = `${String(entry.id || key)}:${field}`;
        assets.set(assetId, {
          id: assetId,
          path: entry[field],
          name: field,
          kind: mediaKind(entry[field]),
          target,
        });
      }
    }
    for (const [field, child] of Object.entries(entry))
      if (child && typeof child === "object" && field !== "file")
        visit(child, target, `${key}/${field}`);
  };
  draft.characters.forEach((item) =>
    visit(item, { kind: "character", id: item.id }),
  );
  draft.backgrounds.forEach((item) =>
    visit(item, { kind: "background", id: item.id }),
  );
  draft.scenes.forEach((scene) =>
    scene.cuts.forEach((cut) => visit(cut, { kind: "cut", id: cut.id })),
  );
  visit(draft.sharedAssets);
  return [...assets.values()];
}
function assetOf(
  projectId: string,
  assetId: string,
  kind?: ControlAsset["kind"],
): ControlAsset {
  const asset = listControlAssets(projectId).find(
    (item) => item.id === assetId,
  );
  if (!asset || (kind && asset.kind !== kind))
    throw new Error("현재 프로젝트에서 요청한 종류의 에셋을 찾지 못했습니다.");
  return asset;
}
function targetOf(
  draft: ProjectDraft,
  target: z.infer<typeof mediaTargetSchema>,
) {
  if (target.kind === "character" || target.kind === "background") {
    const item = (
      target.kind === "character" ? draft.characters : draft.backgrounds
    ).find((item) => item.id === target.id);
    if (!item) throw new Error("결과를 붙일 대상을 찾지 못했습니다.");
    return {
      ownerName: item.name,
      stem: item.name,
      assetType: `${target.kind}-generated` as ProjectAssetType,
    };
  }
  for (const [index, scene] of draft.scenes.entries()) {
    const cut = scene.cuts.find((cut) => cut.id === target.id);
    if (cut)
      return {
        ownerName: sceneFolderName(scene.title, index),
        stem: `컷_${cut.order}`,
        assetType: "scene-cut" as ProjectAssetType,
      };
  }
  throw new Error("결과를 붙일 컷을 찾지 못했습니다.");
}
async function attach(
  projectId: string,
  target: z.infer<typeof mediaTargetSchema>,
  path: string,
  name: string,
  video = false,
) {
  const assetId = uid();
  const asset: GeneratedImageAsset = {
    id: assetId,
    name,
    filePath: path,
    thumb: assetSrc(path),
    file: null,
  };
  const outcome = await writeProjectAndConfirm(projectId, (current) => {
    targetOf(current, target);
    if (target.kind === "cut")
      return {
        ...current,
        scenes: current.scenes.map((scene) => ({
          ...scene,
          cuts: scene.cuts.map((cut) =>
            cut.id !== target.id
              ? cut
              : video
                ? {
                    ...cut,
                    videos: [
                      ...cut.videos,
                      { id: assetId, name, filePath: path },
                    ],
                  }
                : { ...cut, images: [...cut.images, asset] },
          ),
        })),
      };
    if (target.kind === "character")
      return {
        ...current,
        characters: current.characters.map((item) =>
          item.id !== target.id
            ? item
            : { ...item, generatedImages: [...item.generatedImages, asset] },
        ),
      };
    return {
      ...current,
      backgrounds: current.backgrounds.map((item) =>
        item.id !== target.id
          ? item
          : { ...item, generatedImages: [...item.generatedImages, asset] },
      ),
    };
  });
  if (!outcome.persisted)
    throw new Error(
      `결과 파일은 만들었지만 프로젝트 저장을 확인하지 못했습니다: ${outcome.why}`,
    );
  return assetId;
}

/** 대기열에서 되살린 입력도 새 요청과 같은 관문을 지납니다. */
function validateGeneration(raw: unknown) {
  const input = generateMediaSchema.parse(raw);
  const draft = readProject(input.projectId);
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  targetOf(draft, input.target);
  const engine = LOCAL_ENGINE_CATALOG[input.engine];
  if (engine.kind !== "image" && engine.kind !== "video")
    throw new Error("이 명령은 이미지와 영상 엔진용입니다.");
  if (engine.kind === "video" && input.target.kind !== "cut")
    throw new Error("영상 결과는 컷에 붙입니다.");
  if (input.imageAssetId) assetOf(input.projectId, input.imageAssetId, "image");
  if (input.motionMaskAssetId)
    assetOf(input.projectId, input.motionMaskAssetId, "image");
  input.referenceAssetIds?.forEach((assetId) => {
    if (assetOf(input.projectId, assetId).kind === "other")
      throw new Error("이 에셋은 생성 레퍼런스로 쓸 수 없습니다.");
  });
  return { input, draft };
}
export async function enqueueControlGeneration(raw: unknown) {
  const { input, draft } = validateGeneration(raw);
  return enqueueTaskOperation({
    lane: "media",
    kind: "control.generate",
    projectId: input.projectId,
    projectTitle: draft.title,
    label: `외부 조종 · ${input.target.kind}`,
    operationId: input.operationId,
    payload: input,
  });
}
function validateUpscale(raw: unknown) {
  const input = upscaleMediaSchema.parse(raw);
  const asset = assetOf(input.projectId, input.assetId, "image");
  if (!asset.target) throw new Error("이 에셋은 결과를 붙일 대상이 없습니다.");
  return { input, asset };
}
export async function enqueueControlUpscale(raw: unknown) {
  const { input } = validateUpscale(raw);
  return enqueueTaskOperation({
    lane: "media",
    kind: "control.upscale",
    projectId: input.projectId,
    projectTitle: readProject(input.projectId)!.title,
    label: `외부 조종 · 업스케일`,
    operationId: input.operationId,
    payload: input,
  });
}
registerTaskRunner("control.generate", async (raw, report, task) => {
  if (isStopping(task.id)) return;
  const { input, draft } = validateGeneration(raw);
  const target = targetOf(draft, input.target);
  const kind = LOCAL_ENGINE_CATALOG[input.engine].kind;
  if (kind !== "image" && kind !== "video")
    throw new Error("지원하지 않는 생성 종류입니다.");
  const references = input.referenceAssetIds
    ?.map((id) => assetOf(input.projectId, id))
    .map((asset) => {
      if (asset.kind === "other")
        throw new Error("이 에셋은 생성 레퍼런스로 쓸 수 없습니다.");
      return { kind: asset.kind, path: asset.path };
    });
  const made = await runLocalToProject({
    engine: input.engine,
    kind,
    extension: kind === "image" ? "png" : "mp4",
    projectName: projectFolderName(input.projectId, draft.title),
    ...target,
    assetType: kind === "video" ? "scene-video" : target.assetType,
    opts: {
      ...input.options,
      references,
      image: input.imageAssetId
        ? assetOf(input.projectId, input.imageAssetId, "image").path
        : undefined,
      motion_mask: input.motionMaskAssetId
        ? assetOf(input.projectId, input.motionMaskAssetId, "image").path
        : undefined,
    },
    onProgress: (step) => report({ step }),
  });
  // 붙이기가 실패하거나 취소되어도 만들어진 파일의 위치를 잃지 않습니다.
  setTaskResult(task.id, { paths: [made.path] });
  if (isStopping(task.id))
    return { paths: [made.path], data: { attached: false, cancelled: true } };
  const assetId = await attach(
    input.projectId,
    input.target,
    made.path,
    made.name,
    kind === "video",
  );
  return { paths: [made.path], assetIds: [assetId], data: { attached: true } };
});
registerTaskRunner("control.upscale", async (raw, report, task) => {
  if (isStopping(task.id)) return;
  const { input, asset } = validateUpscale(raw);
  if (!asset.target) throw new Error("결과를 붙일 대상이 없습니다.");
  const result = await upscaleFileToNew(asset.path, `${asset.name}_업스케일`, {
    engine: input.engine,
    targetSize: input.targetSize,
    onProgress: (step) => report({ step }),
  });
  setTaskResult(task.id, { paths: [result.path] });
  if (isStopping(task.id))
    return { paths: [result.path], data: { attached: false, cancelled: true } };
  const assetId = await attach(
    input.projectId,
    asset.target,
    result.path,
    `${asset.name}_업스케일`,
  );
  return {
    paths: [result.path],
    assetIds: [assetId],
    data: { attached: true },
  };
});

export async function previewControlAsset(projectId: string, assetId: string) {
  const asset = assetOf(projectId, assetId, "image");
  const loaded = await loadImageForCanvas(assetSrc(asset.path));
  const scale = Math.min(1, 1280 / Math.max(loaded.width, loaded.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(loaded.width * scale));
  canvas.height = Math.max(1, Math.round(loaded.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("미리보기를 만들지 못했습니다.");
  context.drawImage(loaded, 0, 0, canvas.width, canvas.height);
  return { assetId, image: canvas.toDataURL("image/jpeg", 0.85) };
}
export async function controlEngineCatalog() {
  return { local: await listLocalEngines(), upscale: await listEngines() };
}
