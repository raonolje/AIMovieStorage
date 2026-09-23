import { z } from "zod";
import { validateLocalControlOptions } from "./localControlCapabilities";
import { structureSourceSchema } from "./localStructureControl";
import { controlLoraSelectionSchema, resolveControlLoras } from "./controlLoras";
import { withLoraTriggers } from "./localLoras";
import { mocapSourcesOf, loadMocapResult } from "./mocapStore";
import { bakePoseFrames } from "./poseFrames";
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
  isVideoFile,
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
    ltx_quality: z.enum(["single", "two-stage"]).optional().describe("LTX 2.5 only. Default single preserves the current 8-step path. two-stage generates at half the requested final width/height, spatially upsamples 2x, then refines 3 steps with LoRAs/references disabled. Final dimensions align to 128 pixels with Union, otherwise 64; actual sizes and 8+3 steps are returned in meta.two_stage. FPS/frame count are unchanged."),
    guidance: z.number().min(0).max(30).optional(),
    seconds: z.number().min(1).max(60).optional(),
    fps: z.number().int().min(1).max(60).optional(),
    reference_video_range: z.enum(["first5s", "full"]).optional().describe("Required for H3 video reference assets: first5s decodes at most the first 5 seconds; full preserves the whole source input. H3 still limits conditioning to the generated duration. Completion meta.reference_videos records actual decoded and conditioning lengths."),
    h3_reference_resize_mode: z.enum(["diffusers", "match"]).optional().describe("H3 Ref2VA only: diffusers keeps the original 2048-pixel image short edge; match caps image area to the output canvas without upscaling, then aligns to 32 pixels. Video timing is unchanged."),
    h3_lora_preset: z.literal("lightx2v-ref2va-4step-v0.1").optional().describe("Explicit verified Ref2VA v0.1 Turbo only: one LoRA, weight 1, steps omitted or 4. Worker verifies the artifact SHA before model loading; uses 5 scheduler grid points for 4 evaluations, shifts 12/3 and match image resizing. Listing a file is not proof of compatibility."),
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
    loras: controlLoraSelectionSchema.optional().describe("Select explicit IDs from loras_list for this engine. Omitted/empty means no LoRA; UI defaults are not implicitly enabled. Arbitrary paths are not accepted. Files are rechecked immediately before generation."),
    structureSource: structureSourceSchema.optional().describe("LTX 2.5 Union Canny guide from a video asset in this project. Uses absolute source time and resamples to output FPS without time stretching or end padding. Cannot combine with poseSource. durationSeconds is required and must cover options.seconds; source bounds are checked before model load."),
    poseSource: z.object({
      sourceId: id,
      personNumber: z.number().int().positive(),
      weight: z.number().min(0).max(1.5).default(1),
      sourceStartSeconds: z.number().nonnegative().optional().describe("Absolute time in the original video. Defaults to the saved analysis start; must remain within its range."),
      durationSeconds: z.number().positive().optional().describe("Source interval duration. Defaults to the remaining analysis range, NOT options.seconds. For a 5-second output matching source 6–11 seconds, set sourceStartSeconds=6 and durationSeconds=5. Out-of-range intervals are rejected, never clamped."),
    }).strict().optional().describe("Uses the stored person's already-transformed coordinates without mirroring again. Omitting both time fields preserves the full saved analysis range."),
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
  if (isVideoFile(path)) return "video";
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
  const referenceAssets = input.referenceAssetIds?.map((assetId) => assetOf(input.projectId, assetId));
  referenceAssets?.forEach((asset) => {
    if (asset.kind === "other")
      throw new Error("이 에셋은 생성 레퍼런스로 쓸 수 없습니다.");
  });
  if (input.options.h3_reference_resize_mode !== undefined || input.options.h3_lora_preset !== undefined) {
    if (input.engine !== "minimaxh3" || !referenceAssets?.some(asset => asset.kind === "image" || asset.kind === "video"))
      throw new Error("H3 참조 전처리와 터보 프리셋은 그림 또는 영상 레퍼런스가 있는 Ref2VA에서만 사용할 수 있습니다.");
    if (input.options.h3_lora_preset && (input.loras?.length !== 1 || input.loras[0].weight !== 1
      || (input.options.steps !== undefined && input.options.steps !== 4)
      || (input.options.h3_reference_resize_mode !== undefined && input.options.h3_reference_resize_mode !== "match")))
      throw new Error("H3 Ref2VA 터보 프리셋은 로라 한 개·세기 1·steps 생략 또는 4·match 전처리가 필요합니다.");
  }
  if (input.options.ltx_quality !== undefined && input.engine !== "ltx25")
    throw new Error("LTX 품질 선택은 LTX 2.5에서만 사용할 수 있습니다.");
  const controlCheck = validateLocalControlOptions(input.engine, {
    ...(input.poseSource ? { control: { kind: "pose", frames: ["형식 확인"], fps: input.options.fps ?? 24 } } : {}),
    ...(input.structureSource ? { structure_control: (() => {
      const { assetId, ...settings } = input.structureSource;
      return { ...settings, path: assetOf(input.projectId, assetId, "video").path };
    })() } : {}),
    seconds: input.options.seconds,
    references: referenceAssets,
    reference_video_range: input.options.reference_video_range,
  });
  if (!controlCheck.ok) throw new Error(controlCheck.message);
  if (input.poseSource) {
    const source = mocapSourcesOf(projectFolderName(input.projectId, draft.title)).find(item => item.id === input.poseSource!.sourceId);
    if (!source?.resultPath) throw new Error("현재 프로젝트에 저장된 모캡 분석 결과가 없습니다.");
  }
  return { input, draft };
}
export async function enqueueControlGeneration(raw: unknown) {
  const { input, draft } = validateGeneration(raw);
  await resolveControlLoras(input.engine, input.loras);
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
  let control;
  let poseSource: Record<string, unknown> | undefined;
  const structureControl = input.structureSource ? (() => {
    const { assetId, ...settings } = input.structureSource;
    return { ...settings, path: assetOf(input.projectId, assetId, "video").path };
  })() : undefined;
  if (input.poseSource) {
    const folder = projectFolderName(input.projectId, draft.title);
    const source = mocapSourcesOf(folder).find(item => item.id === input.poseSource!.sourceId)!;
    const result = await loadMocapResult(folder, source);
    if (!result) throw new Error("모캡 분석 결과를 읽지 못했습니다.");
    const frames = await bakePoseFrames({ projectName: folder, ownerName: source.name, result,
      personNumber: input.poseSource.personNumber, fps: input.options.fps ?? 24,
      sourceStartSeconds: input.poseSource.sourceStartSeconds, durationSeconds: input.poseSource.durationSeconds,
      size: { width: input.options.width ?? 1280, height: input.options.height ?? 704 },
      onProgress: (done, total) => report({ step: `동작 기준 굽기 ${done}/${total}` }),
    });
    if (isStopping(task.id)) return { data: { attached: false, cancelled: true } };
    control = { kind: "pose" as const, frames: frames.frames, fps: frames.fps, weight: input.poseSource.weight };
    poseSource = { sourceId: source.id, personNumber: input.poseSource.personNumber,
      sourceStartSeconds: frames.sourceStartSeconds, sourceEndSeconds: frames.sourceEndSeconds,
      durationSeconds: frames.seconds, fps: frames.fps, frameCount: frames.frames.length,
      mirrored: result.mirrored, sampling: "nearest-in-range" };
    setTaskResult(task.id, { data: { poseSource } });
  }
  // 기다리는 동안 삭제/교체된 파일을 캐시된 경로로 실행하지 않습니다.
  const loras = await resolveControlLoras(input.engine, input.loras);
  if (isStopping(task.id)) return { data: { attached: false, cancelled: true } };
  const made = await runLocalToProject({
    engine: input.engine,
    kind,
    extension: kind === "image" ? "png" : "mp4",
    projectName: projectFolderName(input.projectId, draft.title),
    ...target,
    assetType: kind === "video" ? "scene-video" : target.assetType,
    opts: {
      ...input.options,
      prompt: withLoraTriggers(input.options.prompt, loras),
      loras,
      control,
      structure_control: structureControl,
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
  const controlSources = { ...(poseSource ? { poseSource } : {}), ...(input.structureSource ? { structureSource: input.structureSource } : {}), ...(input.loras ? { loras: input.loras } : {}) };
  setTaskResult(task.id, { paths: [made.path], data: { ...controlSources, meta: made.meta } });
  if (isStopping(task.id))
    return { paths: [made.path], data: { attached: false, cancelled: true, ...controlSources } };
  const assetId = await attach(
    input.projectId,
    input.target,
    made.path,
    made.name,
    kind === "video",
  );
  return { paths: [made.path], assetIds: [assetId], data: { attached: true, seconds: made.seconds, meta: made.meta, ...controlSources } };
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
