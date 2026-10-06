import { nativeGpuHandoffSchema, validateNativeGpuHandoff } from "./nativeGpuHandoff";
import { nativeA2VSelection, nativeA2VStatus, validateNativeA2V } from "./nativeA2V";
import { z } from "zod";
import { continuityPromptLine, relinkContinuityTags, resolveCutContinuity } from "./cutContinuity";
import { mediaTargetSchema } from "./controlMediaTargetSchema";
export { mediaTargetSchema } from "./controlMediaTargetSchema";
import { relinkCharacterBlueprintPrompts } from "./characterBlueprintPrompt";
import { localControlCapabilities, validateLocalControlOptions } from "./localControlCapabilities";
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
  getTaskByOperationId,
  listPersistedTasks,
  isStopping,
  registerTaskRunner,
  setTaskResult,
} from "./taskQueue";

const id = z.string().min(1).max(200);
const optionsSchema = z
  .object({
    prompt: z.string().min(1).max(32000),
    negative: z.string().max(32000).optional(),
    width: z.number().int().min(64).max(4096).optional(),
    height: z.number().int().min(64).max(4096).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    steps: z.number().int().min(1).max(100).optional(),
    local_files_only: z.literal(true).optional().describe("Local generation always prohibits model downloads. Missing local model files fail. This flag cannot be set false."),
    ltx_a2v: nativeA2VSelection.optional(),
    ltx_a2v_offload: z.enum(["cpu", "disk"]).optional().describe("Native A2V only. cpu keeps legacy all-block CPU pinning; disk uses installed official two-slot disk streaming for Gemma and transformer. Slower repeated local reads, no new weights or software. Does not change dialogue or frame timing. Actual RAM peak must be measured."),
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
    nativeGpuHandoff: nativeGpuHandoffSchema.optional(),
    options: optionsSchema,
    audioAssetId: id.optional().describe("Same-project stereo PCM16 WAV for native A2V only; not a reference list or generated sound."),
    audioStartSeconds: z.number().finite().nonnegative().optional().describe("Absolute offset in original WAV; nearest sample, default 0."),
    audioDurationSeconds: z.number().finite().positive().max(40).optional().describe("Selected original audio length. Clamp at EOF; visible frames=ceil(actual sample duration * fps), generation frames=next 8n+1 at least visible frames. End image conditions visible frame ceil(duration*fps)-1 before silent temporal padding. Final lossless ALAC audio retains selected samples; last video packet shortened to original sample duration."),
    imageAssetId: id.optional(),
    endImageAssetId: id.optional().describe("LTX 2.5 / Wan I2V A14B: same-project image used as a model last-frame condition (LTX latent index=-1; Wan last_image), not a pasted final frame. Requires an explicit first image or continue-cut first frame. Motion mask cannot be combined. Endpoint conditioning does not guarantee intermediate contact or motion."),
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
  if (/\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(path)) return "image";
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
    // 타임라인 음악은 filePath 대신 path를 저장합니다. 새 가져오기 서비스를 만들지 않고
    // 이미 저장된 프로젝트의 음원을 조종기가 고를 수 있어야 원음 조건 경로가 완성됩니다.
    if (typeof entry.path === "string" && mediaKind(entry.path) === "audio") {
      const assetId = `${key}:audio`;
      assets.set(assetId, { id: assetId, path: entry.path, name: String(entry.name || assetId), kind: "audio", target });
    }
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
      "endFramePath",
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
    scene.cuts.forEach((cut) => visit(cut, { kind: "cut", id: cut.id }, `cut/${cut.id}`)),
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
export function controlMediaTarget(
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
export async function attachControlMediaResult(
  projectId: string,
  target: z.infer<typeof mediaTargetSchema>,
  path: string,
  name: string,
  video = false,
  prompts?: { promptKo?: string; promptEn?: string },
) {
  let assetId: string = uid();
  const asset: GeneratedImageAsset = {
    id: assetId,
    name,
    filePath: path,
    thumb: assetSrc(path),
    file: null,
    ...(prompts ? { promptKo: prompts.promptKo, promptEn: prompts.promptEn } : {}),
  };
  const outcome = await writeProjectAndConfirm(projectId, (current) => {
    controlMediaTarget(current, target);
    // 외부 생성 완료 뒤 앱이 재시작되어도 같은 결과 파일을 두 번 등록하지 않습니다.
    const currentAssets: { id: string; filePath?: string }[] = target.kind === "cut"
      ? current.scenes.flatMap(scene => scene.cuts).filter(cut => cut.id === target.id)
          .flatMap(cut => video ? cut.videos.map(item => ({ id: item.id, filePath: item.filePath })) : cut.images.map(item => ({ id: item.id, filePath: item.filePath })))
      : (target.kind === "character" ? current.characters : current.backgrounds)
          .filter(item => item.id === target.id).flatMap(item => item.generatedImages);
    const existing = currentAssets.find(item => item.filePath === path);
    if (existing) { assetId = existing.id; return current; }
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
  validateNativeGpuHandoff(input);
  const draft = readProject(input.projectId);
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  const nativeA2V = validateNativeA2V(input);
  if (nativeA2V) assetOf(input.projectId, input.audioAssetId!, "audio");
  controlMediaTarget(draft, input.target);
  const engine = LOCAL_ENGINE_CATALOG[input.engine];
  if (engine.kind !== "image" && engine.kind !== "video")
    throw new Error("이 명령은 이미지와 영상 엔진용입니다.");
  if (engine.kind === "video" && input.target.kind !== "cut")
    throw new Error("영상 결과는 컷에 붙입니다.");
  const continuity = !nativeA2V && engine.kind === "video" && input.target.kind === "cut"
    ? (() => { const scene = draft.scenes.find(item => item.cuts.some(cut => cut.id === input.target.id));
      const cut = scene?.cuts.find(item => item.id === input.target.id);
      return scene && cut ? resolveCutContinuity(scene, cut) : null; })()
    : null;
  if (input.endImageAssetId) assetOf(input.projectId, input.endImageAssetId, "image");
  if (input.imageAssetId) assetOf(input.projectId, input.imageAssetId, "image");
  if (engine.kind === "image" && input.imageAssetId)
    throw new Error("이 로컬 그림 엔진은 기존 이미지 편집을 지원하지 않습니다. 인물 얼굴을 유지하려면 참조 편집 결과를 등록해 주세요.");
  if (input.motionMaskAssetId)
    assetOf(input.projectId, input.motionMaskAssetId, "image");
  const referenceAssets = input.referenceAssetIds?.map((assetId) => assetOf(input.projectId, assetId)) || [];
  const referenceVideoRange = input.options.reference_video_range ?? (continuity && input.engine === "minimaxh3" ? "full" : undefined);
  if (continuity && input.engine === "minimaxh3") {
    if (!referenceAssets.some(asset => asset.path === continuity.videoPath))
      referenceAssets.unshift(assetOf(input.projectId, continuity.video.id, "video"));
    if (continuity.mode === "continue" && continuity.endFramePath && !referenceAssets.some(asset => asset.path === continuity.endFramePath))
      referenceAssets.splice(1, 0, assetOf(input.projectId, `${continuity.video.id}:endFramePath`, "image"));
  }
  if (referenceAssets.length > 12) throw new Error("앞 컷 연결을 포함한 레퍼런스는 최대 12개입니다. 다른 참조를 줄여 주세요.");
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
    image: (continuity?.mode === "continue" ? continuity.endFramePath : undefined) ?? (input.imageAssetId ? assetOf(input.projectId, input.imageAssetId, "image").path : undefined),
    end_image: input.endImageAssetId ? assetOf(input.projectId, input.endImageAssetId, "image").path : undefined,
    motion_mask: input.motionMaskAssetId,
    ...(input.poseSource ? { control: { kind: "pose", frames: ["형식 확인"], fps: input.options.fps ?? 24 } } : {}),
    ...(input.structureSource ? { structure_control: (() => {
      const { assetId, ...settings } = input.structureSource;
      return { ...settings, path: assetOf(input.projectId, assetId, "video").path };
    })() } : {}),
    seconds: input.options.seconds,
    references: referenceAssets,
    reference_video_range: referenceVideoRange,
  });
  if (!controlCheck.ok) throw new Error(controlCheck.message);
  if (input.poseSource) {
    const source = mocapSourcesOf(projectFolderName(input.projectId, draft.title)).find(item => item.id === input.poseSource!.sourceId);
    if (!source?.resultPath) throw new Error("현재 프로젝트에 저장된 모캡 분석 결과가 없습니다.");
  }
  return { input, draft, continuity, referenceAssets, referenceVideoRange, nativeA2V };
}
export async function enqueueControlGeneration(raw: unknown) {
  const { input, draft, nativeA2V } = validateGeneration(raw);
  if (nativeA2V) { const status = await nativeA2VStatus(); const blockers=status.blockers.filter(b=>!(input.nativeGpuHandoff && b==="separate_gpu_handoff_required")); if (blockers.length) throw new Error("native_not_ready: " + blockers.join(", ")); }
  if (input.nativeGpuHandoff && !getTaskByOperationId(input.operationId)) {
    const active=(await listPersistedTasks()).filter(t=>t.status==="running"||t.status==="waiting");
    if (active.length) throw new Error("gpu_handoff_app_not_idle");
  }
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
  const { input, draft, continuity, referenceAssets, referenceVideoRange } = validateGeneration(raw);
  if(input.nativeGpuHandoff && (await listPersistedTasks()).some(t=>t.id!==task.id && (t.status==="running"||t.status==="waiting"))) throw new Error("gpu_handoff_app_not_idle");
  const target = controlMediaTarget(draft, input.target);
  const kind = LOCAL_ENGINE_CATALOG[input.engine].kind;
  if (kind !== "image" && kind !== "video")
    throw new Error("지원하지 않는 생성 종류입니다.");
  // 조종기가 카드 프롬프트와 별도의 생성 문장을 보낼 수 있습니다. 인물 시트의 칸이
  // 실제 워커 입력에서 빠지면 화면에 9칸이 선택돼 있어도 한 장짜리 초상이 나옵니다.
  const character = input.target.kind === "character"
    ? draft.characters.find((item) => item.id === input.target.id) : undefined;
  const sheetPrompt = character
    ? relinkCharacterBlueprintPrompts({ ...character, promptEn: input.options.prompt }).promptEn
    : input.options.prompt;
  const generationPrompt = continuity
    ? `${continuityPromptLine(continuity, "en")}\n\n${relinkContinuityTags(sheetPrompt, continuity.sourceCut, continuity.video)}` : sheetPrompt;
  const references = referenceAssets
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
  const comfyBaseUrl = input.nativeGpuHandoff ? (await import("./comfyGeneration")).getComfyGenerationSettings().baseUrl : undefined;
  const made = await runLocalToProject({
    engine: input.engine,
    kind,
    extension: kind === "image" ? "png" : "mp4",
    projectName: projectFolderName(input.projectId, draft.title),
    ...target,
    assetType: kind === "video" ? "scene-video" : target.assetType,
    opts: {
      ...input.options,
      ...(input.nativeGpuHandoff ? { native_gpu_handoff: { operationId:input.operationId, projectId:input.projectId, target:input.target, approval:input.nativeGpuHandoff, comfyBaseUrl } } : {}),
      ...(input.options.ltx_a2v ? { audio_path: assetOf(input.projectId, input.audioAssetId!, "audio").path, audio_start_seconds: input.audioStartSeconds ?? 0, audio_duration_seconds: input.audioDurationSeconds } : {}),
      ...(referenceVideoRange ? { reference_video_range: referenceVideoRange } : {}),
      prompt: withLoraTriggers(generationPrompt, loras),
      negative: input.options.negative ?? character?.negativeEn,
      loras,
      control,
      structure_control: structureControl,
      references,
      image: (continuity?.mode === "continue" ? continuity.endFramePath : undefined) ?? (input.imageAssetId
        ? assetOf(input.projectId, input.imageAssetId, "image").path
        : undefined),
      end_image: input.endImageAssetId ? assetOf(input.projectId, input.endImageAssetId, "image").path : undefined,
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
  const assetId = await attachControlMediaResult(
    input.projectId,
    input.target,
    made.path,
    made.name,
    kind === "video",
    character ? { promptKo: character.promptKo, promptEn: withLoraTriggers(sheetPrompt, loras) } : undefined,
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
  const assetId = await attachControlMediaResult(
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
  return { local: (await listLocalEngines()).map(engine => ({ ...engine, controls: localControlCapabilities(engine.id), generationNetworkPolicy: "local-only" as const, generationDownloadsAllowed: false })), upscale: await listEngines() };
}
