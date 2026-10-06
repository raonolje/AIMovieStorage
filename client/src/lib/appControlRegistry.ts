import { aacPreviewSchema, aacPreviewStatus, enqueueAacPreview } from "./controlAacPreview";
import { mediaEditSchema, mediaEditProbeSchema, mediaEditStatus, probeMediaEdit, enqueueMediaEdit } from "./controlMediaEdit";
import { planarOverlaySchema, enqueuePlanarOverlay, planarOverlayStatus } from "./controlPlanarOverlay";
import { protectedEditSchema, enqueueProtectedEdit, protectedEditStatus } from "./controlProtectedEdit";
import { nativeA2VStatus } from "./nativeA2V";
import { maintenanceStatus, prepareMaintenance, abortMaintenance, quitMaintenance, beginControlMutation } from "./maintenance";
import { assertMaintenanceWritable } from "./maintenanceGate";
import { z } from "zod";
import { promptPrepareSchema, prepareControlPrompt } from "./controlPrompt";
import { promptStatusSchema, promptHistoryReadSchema, getProjectPromptStatus, getProjectPromptHistory } from "./controlPromptStatus";
import { supplementalPromptPrepareSchema, prepareSupplementalPrompt } from "./controlSupplementalPrompt";
import { naturalPromptPrepareSchema, prepareNaturalPrompt } from "./controlNaturalPrompt";
import { controlCreationOptions } from "./controlCreationOptions";
import { storyboardBakeSchema, bakeControlStoryboard } from "./controlStoryboard";
import { bootstrapInputSchema, bootstrapInputReadSchema, bootstrapReferenceRegisterSchema, bootstrapReferenceUpdateSchema, bootstrapDocumentImportSchema, bootstrapPrepareSchema, bootstrapApplySchema, bootstrapPromptTargetsSchema, getBootstrapInput, updateBootstrapInput, registerBootstrapReference, updateBootstrapReference, importBootstrapDocument, prepareBootstrapPrompt, applyBootstrapResult, getBootstrapPromptTargets } from "./controlBootstrap";
import { mediaRegisterSchema, assetSetPrimarySchema, registerControlMedia, setControlAssetPrimary } from "./controlAssetRegistration";
import { voiceExtractSchema, voiceSelectSchema, voiceGenerateSchema, voiceEngineInstallSchema, extractControlVoice, selectControlVoice, enqueueControlVoiceGeneration, listControlVoiceModels, enqueueControlVoiceEngineInstall } from "./controlVoice";
import { magnificComposePreviewSchema, magnificSheetComposePreviewSchema, magnificComposeExecuteSchema, magnificComposeBatchExecuteSchema, magnificResultsListSchema, magnificResultRegisterSchema, previewControlMagnific, previewControlMagnificSheet, enqueueControlMagnific, enqueueControlMagnificBatch, listControlMagnificResults, registerControlMagnificResult } from "./controlMagnific";
import { comfyWorkflowSchema, comfyGenerateSchema, comfyMaskedComposeSchema, getControlComfyStatus, getControlComfyWorkflow, enqueueControlComfy, enqueueControlComfyMasked } from "./controlComfy";
import { comfySettingsSetSchema, getControlComfySettings, setControlComfySettings } from "./controlComfySettings";
import { controlDetailSchema, projectControlValue } from "./controlProjection";
import { EDITION } from "./edition";
import { controlModelDownloadSchema, enqueueControlModelDownload, controlModelInspectSchema, inspectControlModel } from "./controlModelDownload";
import { controlLoraDownloadSchema, enqueueControlLoraDownload } from "./controlLoraDownload";
import { controlLorasListSchema, listControlLoras } from "./controlLoras";
import { compositionApplyMocapSchema, applyCompositionMocap } from "./compositionMocapControl";
import { compositionApplyDanceSchema, applyCompositionDance } from "./compositionDanceControl";
import { kimodoImportSchema, importControlKimodo, kimodoInstallSchema, installControlKimodo, kimodoGenerateSchema, generateControlKimodo } from "./controlKimodo";
import { compositionMusicUseSchema, compositionMusicAnalyzeSchema, useCompositionBgm, analyzeCompositionMusic } from "./compositionMusicControl";
import { motionCleanupPrepareSchema, motionCleanupApplySchema, prepareCompositionMotionCleanup, applyCompositionMotionCleanup } from "./compositionMotionCleanupControl";
import { compositionMusicImportSchema, compositionGlbImportSchema, importCompositionMusic, importCompositionGlb } from "./compositionImportControl";
import { compositionBackgroundImportSchema, importCompositionBackground } from "./compositionBackgroundControl";
import { backgroundUnfoldSchema, unfoldBackgroundImage } from "./controlBackgroundUnfold";
import { sheetBakeSchema, bakeControlSheet } from "./controlSheet";
import { compositionExportVideoSchema, enqueueCompositionVideoExport } from "./compositionVideoExport";
import {
  mocapListSchema, mocapAnalyzeSchema, mocapHandsSchema, mocapResultSchema,
  listControlMocap, enqueueControlMocap, enqueueControlMocapHands, getControlMocapResult,
} from "./controlMocap";
import {
  listCompositionTargets,
  listCompositionSessions,
  getCompositionSession,
  openComposition,
  applyCompositionCommands,
  undoComposition,
  redoComposition,
  captureComposition,
  commitComposition,
  getCompositionChanges,
  compositionOpenRequestSchema,
  compositionSessionRequestSchema,
  compositionApplyRequestSchema,
  compositionChangesRequestSchema,
  COMPOSITION_COMMANDS,
  compositionMeasureContactSchema,
  measureCompositionContact,
} from "./compositionControl";
import { getTask, stopTask, getPersistedTask, listPersistedTasks } from "./taskQueue";
import {
  controlEngineCatalog,
  listControlAssets,
  previewControlAsset,
  generateMediaSchema,
  upscaleMediaSchema,
  enqueueControlGeneration,
  enqueueControlUpscale,
} from "./controlMedia";
import {
  listProjectsControl,
  getProjectSnapshot,
  getProjectChanges,
  createProjectControl,
  updateProjectControl,
  openProjectControl,
  projectReadSchema,
  projectChangesSchema,
  projectCreateSchema,
  projectUpdateSchema,
  cutGuideVideoClearSchema,
  clearCutGuideVideo,
} from "./projectControl";
import {
  listBgmControl,
  getBgmSnapshot,
  getBgmChanges,
  createBgmControl,
  updateBgmControl,
  enqueueControlBgm,
  bgmReadSchema,
  bgmChangesSchema,
  bgmCreateSchema,
  bgmUpdateSchema,
  bgmGenerateSchema,
  bgmPromptPrepareSchema,
  prepareBgmPrompt,
} from "./controlBgm";

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
export interface ControlToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}
export interface AppControlTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
  call: (input: unknown) => Promise<ControlToolResult>;
}
export const controlTools: AppControlTool[] = [];
export function result(value: unknown): ControlToolResult {
  const text = JSON.stringify(value);
  // 같은 자료가 text와 structuredContent에 함께 실립니다. 전체 상태가 큰 경우
  // 네이티브 전송을 중간에서 자르기 전에 작은 명시 오류와 재조회 방법을 돌려줍니다.
  if (text.length > 4 * 1024 * 1024 || new TextEncoder().encode(text).length > 4 * 1024 * 1024) {
    const current = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const outcome = Object.fromEntries(["projectId", "sessionId", "revision", "persisted", "persistedLatest"]
      .filter(key => ["string", "number", "boolean"].includes(typeof current[key])).map(key => [key, current[key]]));
    throw Object.assign(new Error("응답 자료가 너무 큽니다. detail: summary로 다시 조회하세요. 편집 명령은 이미 적용됐을 수 있으므로 같은 편집을 바로 반복하지 마세요."),
      { code: "response_too_large", details: { ...outcome, retryDetail: "summary", responseLimitBytes: 4 * 1024 * 1024 } });
  }
  return {
    content: [{ type: "text", text }],
    structuredContent:
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { value },
  };
}
export function imageBlock(dataUrl: string): McpContent {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(
    dataUrl,
  );
  if (!match) throw new Error("지원하지 않는 미리보기 형식입니다.");
  return { type: "image", mimeType: match[1], data: match[2] };
}
function mcpObjectSchema(name: string, schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  if (generated.type === "object") return generated;
  const branches = generated.anyOf;
  if (generated.type === undefined && Array.isArray(branches) && branches.length > 0 &&
      branches.every((branch: unknown) => branch !== null && typeof branch === "object" &&
        "type" in branch && branch.type === "object")) {
    // MCP 도구 입력은 최상위 object여야 합니다. union의 anyOf 조건은 그대로 둡니다.
    return { type: "object", ...generated };
  }
  throw new Error(`조종 명령 ${name}의 입력 규격은 최상위 object여야 합니다.`);
}
export function addControlTool<T>(
  name: string,
  description: string,
  schema: z.ZodType<T>,
  readOnly: boolean,
  handler: (input: T) => unknown | Promise<unknown>,
  rawResult = false,
  openWorld = false,
) {
  if (controlTools.some((tool) => tool.name === name))
    throw new Error(`중복된 조종 명령: ${name}`);
  controlTools.push({
    name,
    description,
    inputSchema: mcpObjectSchema(name, schema),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      openWorldHint: openWorld,
    },
    call: async (raw) => {
      const data = schema.parse(raw ?? {});
      const value = await handler(data);
      return rawResult ? (value as ControlToolResult) : result(value);
    },
  });
}
const empty = z.object({}).strict();
addControlTool("prompt_prepare", "Read the exact current AIMovieStorage prompt request used by its API button, including selected blueprint panels, project context, model/platform/common rules and up to four matching reference images. For six-face backgrounds it first saves the app's layout template. Use the returned revision with project_update prompt.apply; regenerate this request after any manual edit. Works from Codex or Claude without an app LLM API call.", promptPrepareSchema, false, prepareControlPrompt, true);
addControlTool("project_prompt_status", "List every character, background, scene storyboard, cut image and cut video prompt slot with Korean/English presence, history count and last source note. Paginate large projects; missingOnly filters empty ready slots. Use this to continue all app prompts across chats before prompt_prepare and project_update prompt.apply.", promptStatusSchema, true, getProjectPromptStatus);
addControlTool("project_prompt_history", "List prior versions of one character, background, scene storyboard, cut image or cut video prompt. Pass entryId to read its full Korean/English and negative text. Read the latest revision before applying a prior version; this never edits the project.", promptHistoryReadSchema, true, getProjectPromptHistory);
addControlTool("prompt_prepare_extra", "Read the app's character profile, character/background reference analysis, first-reference, or anchored background-faces prompt request. Uses the same data builders as the app UI and returns the matching images and project revision. Apply the JSON using project_update as instructed, checking revision again before writing.", supplementalPromptPrepareSchema, true, prepareSupplementalPrompt, true);
addControlTool("natural_prompt_prepare", "Build the app's exact '프롬프트 말로' request for saved character/background descriptions, scene summaries, and cut description/acting/background motion/VFX. Returns the current revision and corresponding project_update fields. No LLM API call.", naturalPromptPrepareSchema, true, prepareNaturalPrompt);
addControlTool("storyboard_bake", "Bake a scene storyboard from the same primary cut images or saved composition guides and image marks as the app button. Saves the image and its bilingual rule-built video prompt in the project. Requires current project revision; inspect its output before prompt_prepare sceneVideo.", storyboardBakeSchema, false, bakeControlStoryboard);
addControlTool("background_unfold", "Cut a registered background's finished cross-unfold image into six room faces using the app's auto-detection, edge and safety checks, and face-set file naming. If auto-detection misses a real cross-unfold, provide the editor's normalized x[5]/y[4] grid lines; safety checks still apply. Registers all six faces and marks the source as processed only after project persistence. Does not accept arbitrary file paths or bypass unsafe-boundary warnings.", backgroundUnfoldSchema, false, unfoldBackgroundImage);
addControlTool("sheet_bake", "Render a character or background composite sheet using the app's saved shared layout, owner-specific image fills, profile table and same composeSheet renderer as the UI. Save it into the project media folder and register an editable sheet snapshot. First use project_update sheet.layout.upsert and sheet.fill with a current revision. Reuse operationId after a lost response; this creates a new sheet and never replaces or deletes an existing one.", sheetBakeSchema, false, bakeControlSheet);
addControlTool("bootstrap_input_update", "Set the app's AI batch creation source, hint, requested counts and append/replace mode. Existing uploaded reference files remain attached. Does not call an LLM or alter project cards.", bootstrapInputSchema, false, updateBootstrapInput);
addControlTool("bootstrap_input_get", "Read the current AI batch creation input, reference tags and imported document list so another Codex/Claude chat can continue. Use detail=full for the complete source text.", bootstrapInputReadSchema, true, getBootstrapInput);
addControlTool("bootstrap_reference_register", "Copy a local image or video into the project's AI batch creation references, assign the app's @ref_img_N or @ref_mov_N tag, and store how it must be used. Reuse operationId after a lost response. It does not edit scene cards.", bootstrapReferenceRegisterSchema, false, registerBootstrapReference);
addControlTool("bootstrap_reference_update", "Change how an AI batch reference is used or remove it from this batch input. Removing a reference does not delete its project file, as in the app UI.", bootstrapReferenceUpdateSchema, false, updateBootstrapReference);
addControlTool("bootstrap_document_import", "Copy a PDF, DOCX or text screenplay/planning document to the project's DOCU folder, extract text with the app's document reader, and append it to the batch source with its filename. Reuse operationId after a lost response; inspect bootstrap_input_get before generating.", bootstrapDocumentImportSchema, false, importBootstrapDocument);
addControlTool("bootstrap_prompt_prepare", "Build the app's exact three-stage AI batch creation request (outline, details, shots). For details provide the previous outline; for shots provide outline and details. Returns current input fingerprint and matching uploaded reference images. Do not substitute a generic request.", bootstrapPrepareSchema, true, prepareBootstrapPrompt, true);
addControlTool("bootstrap_apply", "Parse three batch-creation answers with the same app parsers, resolve characters/backgrounds by name, construct shot compositions and persist once. Requires current project revision, matching input fingerprint and stable operationId. Replace mode requires explicit confirmedReplace and preserves cards with images.", bootstrapApplySchema, false, applyBootstrapResult);
addControlTool("bootstrap_prompt_targets", "Read the persisted fourth-stage worklist created by bootstrap_apply. Shows which character, background and cut image/video prompts still need the app's exact prompt_prepare → project_update prompt.apply flow. Use after batch creation and when resuming in another chat; do not silently leave drafts as final prompts.", bootstrapPromptTargetsSchema, true, getBootstrapPromptTargets);
addControlTool("creation_options", "List the app's current local, Magnific desktop composition and configured ComfyUI image/video choices. Before generation, ask the user which image/video model and route to use unless already specified or the user delegated the choice ('알아서 해'). Reuse the answer for this project; read project selections again after edits. Magnific composition alone does not generate.", z.object({ projectId: z.string().min(1).max(200).optional() }).strict(), true, input => controlCreationOptions(input.projectId));
addControlTool("media_register", "Copy a local image/video into a project target, or a WAV into a character voice reference. WAV copies preserve the source and return a same-project audio asset ID for native A2V; default nonprimary, imported source metadata, no new TTS or claim of lip-sync. Native A2V checks stereo PCM16 before inference. Image/video imports save source prompt and provenance. Only a complete Korean/English prompt pair also updates the card prompt and history; a single-language prompt remains on the asset. Requires latest revision and stable operationId. makePrimary selects the representative.", mediaRegisterSchema, false, registerControlMedia);
addControlTool("asset_set_primary", "Select the representative image or video in a project character, background or cut after reading its latest revision.", assetSetPrimarySchema, false, setControlAssetPrimary);
addControlTool("voice_extract", "Extract one named character's spoken time range from a cut's selected representative video into that character's local voice folder. Choose a range containing only this speaker; the app cannot infer speakers from a mixed soundtrack. Saves a primary WAV reference for subsequent Seedance compositions. Read project_get for current revision and reuse operationId after a lost response.", voiceExtractSchema, false, extractControlVoice);
addControlTool("voice_models_list", "List the installed Qwen3-TTS local engine and the character-voice model, speaker, acting-category, voice-gender, age-range and language choices. Read before voice_generate. This call does not download weights.", z.object({}).strict(), true, listControlVoiceModels);
addControlTool("voice_engine_install", "Queue installation of the Apache-2.0 Qwen3-TTS local engine into the app's isolated environment. Downloads Python packages; selected voice-model weights download on first voice_generate. Reuse operationId after a lost response and inspect job_get. Only Windows/NVIDIA local runtime is supported.", voiceEngineInstallSchema, false, enqueueControlVoiceEngineInstall, false, true);
addControlTool("voice_generate", "Generate a character voice WAV locally with Qwen3-TTS before the first video. Choose free voice design or a preset voice model, dialogue, spoken performance category (including singer or idol stage speech), gender, age range, traits and language. Singer/idol styles do not synthesize singing; preset speakers may retain their fixed timbre. The app saves the WAV under the character's voice folder and links the selected reference as @filename in Seedance prompts and compositions. Requires current project revision and stable operationId; inspect job_get. Install qwentts in Settings first; the selected model downloads weights on first use.", voiceGenerateSchema, false, enqueueControlVoiceGeneration, false, true);
addControlTool("voice_select", "Select one saved character voice WAV as the primary audio reference used with character images in later cut video composition. Requires current project revision.", voiceSelectSchema, false, selectControlVoice);
addControlTool("magnific_compose_preview", "Preview a saved cut's Magnific desktop composition, including its exact prompt, references and video settings. Read project_get first and supply expectedRevision. Does not upload or generate. Preview expires after ten minutes; unsaved guide captures must be saved first.", magnificComposePreviewSchema, true, previewControlMagnific);
addControlTool("magnific_sheet_compose_preview", "Preview a character or background card's image composition through the app's Magnific 구성 button. Uses its saved prompt, selected model, reference images and background aspect ratio. Read project_get first and supply expectedRevision. Does not upload or generate.", magnificSheetComposePreviewSchema, true, previewControlMagnificSheet);
addControlTool("magnific_compose", "Queue an inspected Magnific desktop composition using previewId and expectedRevision. Uploads references and configures the generator; NEVER presses Generate or spends generation credits. Requires a signed-in desktop board. Reuse operationId; check job_get. A disconnected partial upload is not automatically repeated.", magnificComposeExecuteSchema, false, enqueueControlMagnific, false, true);
addControlTool("magnific_compose_batch", "Queue 1-20 inspected IMAGE composition previews in order on the same Magnific canvas. Each image preview defaults to four generations in one generator node; count 1-4 can be set in its preview request. Set runAfterCompose=true to select and run each newly composed generator in order, only when Magnific visibly shows 2K and the unlimited/infinity icon. Existing nodes are never selected for execution. This submits work but does not wait for provider output or import it; inspect job_get and Magnific before registering results. Reuse operationId, especially after a partial failure.", magnificComposeBatchExecuteSchema, false, enqueueControlMagnificBatch, false, true);
addControlTool("magnific_results_list", "List completed Magnific creations for review after a canvas run. Does not generate or download. Choose a creation identifier before importing an approved image.", magnificResultsListSchema, true, listControlMagnificResults, false, true);
addControlTool("magnific_result_register", "Download one explicitly selected completed Magnific image creation by identifier and register it on a project character, background, or cut using the app's media_register path. Supply current project revision, stable operationId, stored prompt text, and makePrimary only for the approved representative. Never regenerates an image.", magnificResultRegisterSchema, false, registerControlMagnificResult, false, true);
addControlTool("comfy_status", "Check the configured external ComfyUI connection and which image/video workflows are registered. Does not submit a workflow.", empty, true, getControlComfyStatus, false, true);
addControlTool("comfy_settings_get", "Read the current Comfy settings revision and configuration summary without exposing workflow paths or values. Read before comfy_settings_set.", empty, true, getControlComfySettings);
addControlTool("comfy_settings_set", "Validate an API-format workflow and save one image/video configuration through the app settings store with disk confirmation. Requires current revision from comfy_settings_get. Only localhost HTTP connections are accepted. Preserves the other workflow; does not submit generation.", comfySettingsSetSchema, false, setControlComfySettings);
addControlTool("comfy_workflow_get", "Read configured workflow input mappings, allowed override keys and reference order without exposing the raw graph or local paths. Configure the API-format workflow in app Settings first.", comfyWorkflowSchema, true, getControlComfyWorkflow);
  addControlTool("comfy_generate", "Queue the configured ComfyUI image/video workflow and attach all selected output files to a project target. Requires expectedRevision from project_get; video targets must be cuts. References accept same-project asset IDs only. Workflow nodes may use paid providers. Reuse operationId; inspect job_get. Cancellation stops waiting, not the external server job.", comfyGenerateSchema, false, enqueueControlComfy, false, true);
  addControlTool("comfy_masked_compose", "Composite a replacement image onto a base image only where the mask is white; black pixels preserve the base. All three inputs must be distinct image assets in the same project with matching dimensions. Uses local ComfyUI built-in image nodes, no generation model or paid provider. Attaches the result to the target. Requires project_get revision and stable operationId; inspect job_get.", comfyMaskedComposeSchema, false, enqueueControlComfyMasked, false, true);
addControlTool("cut_guide_video_clear", "Clear only a cut's selected guide video path and duration, preserving all files and other fields. Read project_get for the current full-state revision first. Saves through the official project update path and confirms persistence.", cutGuideVideoClearSchema, false, clearCutGuideVideo);
addControlTool("composition_measure_contact", "Read a rendered finger-end bone point and exact point-to-box surface distances at one timeline time. Uses the same evaluated rig, geometry and transforms as the video renderer; display zoom is removed for composition meters. Reports signed gap and point-inside-box, not skin or whole-hand collision. Only single BoxGeometry objects are supported; missing end bones, swapped models and other shapes fail explicitly. Requires current composition revision. Restores display time; writes no state, keys, files or project.", compositionMeasureContactSchema, true, measureCompositionContact);
addControlTool("composition_export_video", "Queue the open composition as an MP4 (default 15 seconds, 1920×1080, 24 fps). Set applyAsReference=false for diagnostic exports: saves the file without changing the cut's guide reference or project fields; assetIds is empty. Default true preserves normal reference attachment. Requires matching project/session and expectedRevision. Reuse operationId for retries; inspect job_get and referenceApplied. Composition state itself is not committed.", compositionExportVideoSchema, false, enqueueCompositionVideoExport);
const id = z.string().min(1).max(300);
addControlTool("mocap_sources_list", "List project-local motion capture sources and included body-analysis engines.", mocapListSchema, true, input => listControlMocap(input.projectId));
addControlTool("mocap_analyze", "Queue body motion capture from a video asset or mocap source already registered in this project. Reuse operationId on retries. No arbitrary path input. Missing model weights may be downloaded.", mocapAnalyzeSchema, false, enqueueControlMocap, false, true);
addControlTool("mocap_track_hands", "Queue MediaPipe hand tracking on a saved body capture. Preserves body samples and existing hands where none are detected. Reuse operationId; job_cancel and the mocap UI cancel the same operation.", mocapHandsSchema, false, enqueueControlMocapHands);
addControlTool("mocap_result", "Read saved motion capture metadata. Set personNumber to retrieve up to 30 joint samples per page; omitted personNumber returns summary only.", mocapResultSchema, true, getControlMocapResult);
addControlTool(
  "bgm_projects_list",
  "List music projects separately from video projects.",
  empty,
  true,
  listBgmControl,
);
addControlTool(
  "bgm_get",
  "Read current music project, track IDs and revision.",
  bgmReadSchema,
  true,
  (input) => getBgmSnapshot(input.projectId),
);
addControlTool("bgm_prompt_prepare", "Build the exact BGM style-and-lyrics request used by the app API button for this saved track. Read bgm_get first, then use bgm_update with the returned revision. No app LLM API call is made.", bgmPromptPrepareSchema, true, prepareBgmPrompt);
addControlTool(
  "bgm_create",
  "Create a music project and confirm settings-file persistence. Reuse operationId on retries.",
  bgmCreateSchema,
  false,
  createBgmControl,
);
addControlTool(
  "bgm_update",
  "Edit track prompts, lyrics and music project fields without an LLM API call. Preserve manual changes with expectedRevision.",
  bgmUpdateSchema,
  false,
  updateBgmControl,
);
addControlTool(
  "bgm_changes",
  "Read music changes since a revision, including manual UI edits.",
  bgmChangesSchema,
  true,
  getBgmChanges,
);
addControlTool(
  "bgm_generate",
  "Queue local music generation and attach the resulting track. ACE-Step accepts optional seed (-1=random), steps (1..200), guidance (0..30); other music engines reject these options. Applied values are returned in job result data.generation. Missing weights may be downloaded by the engine. Reuse operationId on retries.",
  bgmGenerateSchema,
  false,
  enqueueControlBgm,
  false,
  true,
);
addControlTool(
  "bgm_wait_changes",
  "Wait up to 20 seconds for music project changes.",
  bgmChangesSchema.extend({
    timeoutMs: z.number().int().min(0).max(20000).default(15000),
  }),
  true,
  async ({ timeoutMs, ...input }) => {
    const until = Date.now() + timeoutMs;
    while (true) {
      const changes = await getBgmChanges(input);
      if (changes.revision !== input.sinceRevision || Date.now() >= until)
        return changes;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  },
);
addControlTool(
  "projects_list",
  "List saved projects and stable IDs.",
  empty,
  true,
  listProjectsControl,
);
addControlTool(
  "project_get",
  "Read the current live draft and full-state revision, including unsaved manual changes. detail defaults to summary: large keyframes and inline media are omitted with explicit counts/ranges. Small camera keys and stable IDs remain. Use full only for small projects.",
  projectReadSchema,
  true,
  (input) => getProjectSnapshot(input.projectId, input.detail),
);
addControlTool(
  "project_create",
  "Create and persist a project without calling an LLM API. Reuse operationId if a response is lost.",
  projectCreateSchema,
  false,
  createProjectControl,
);
addControlTool(
  "project_update",
  "Apply a typed batch of story, character, background, scene and cut edits. Uses full current editor state and waits for persistence. Stale revisions are rejected. Result detail defaults to summary; omitted fields are never written back.",
  projectUpdateSchema,
  false,
  updateProjectControl,
);
addControlTool(
  "project_open",
  "Navigate the app to a saved project.",
  projectReadSchema,
  false,
  (input) => openProjectControl(input.projectId),
);
addControlTool(
  "project_changes",
  "Read manual/controller changes since the last observed revision. Entries use stable entity IDs; history reset requires a fresh snapshot.",
  projectChangesSchema,
  true,
  getProjectChanges,
);
addControlTool(
  "project_wait_changes",
  "Wait up to 20 seconds for a project change, then return changed fields and latest revision.",
  projectChangesSchema.extend({
    timeoutMs: z.number().int().min(0).max(20000).default(15000),
  }),
  true,
  async ({ timeoutMs, ...input }) => {
    const until = Date.now() + timeoutMs;
    while (true) {
      const changes = await getProjectChanges(input);
      if (changes.revision !== input.sinceRevision || Date.now() >= until)
        return changes;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  },
);
addControlTool(
  "app_status",
  "Inspect app edition, supported operations and current composition sessions. Read state before any change.",
  empty,
  true,
  () => ({
    edition: EDITION,
    apiVersion: 1,
    compositionCommands: COMPOSITION_COMMANDS,
    sessions: listCompositionSessions(),
    targets: listCompositionTargets(),
    collaboration: {
      revisionRequired: true,
      changesIncludeUserEdits: true,
      waitTool: "composition_wait_changes",
    },
  }),
);
addControlTool(
  "composition_list",
  "List mounted cut targets and open composition editors.",
  empty,
  true,
  () => ({
    targets: listCompositionTargets(),
    sessions: listCompositionSessions(),
  }),
);
addControlTool(
  "composition_open",
  "Open a cut composition in the currently mounted project scene page. Use IDs from composition_list.",
  compositionOpenRequestSchema,
  false,
  openComposition,
);
addControlTool(
  "composition_get",
  "Read live composition, stable entity IDs, available assets, units and full-state revision. detail defaults to summary with explicit omitted keyframe counts/ranges; small camera keys remain. Use full only for small compositions.",
  z.object({ sessionId: id, detail: controlDetailSchema }).strict(),
  true,
  (input) => getCompositionSession(input.sessionId, input.detail),
);
addControlTool(
  "composition_apply",
  "Apply a validated batch using the same undo history as the editor. expectedRevision prevents overwriting manual edits. Commands use meters, degrees and seconds as named.",
  compositionApplyRequestSchema,
  false,
  applyCompositionCommands,
);
addControlTool("composition_music_use", "Place a registered BGM track on the open composition timeline. The app reads its actual duration. Ask whether to match the whole timeline to the music and pass fitTimeline accordingly; omit it to keep current length. Commit to save.", compositionMusicUseSchema, false, useCompositionBgm);
addControlTool("composition_music_import", "Copy a local audio file to the BGM folder and place it on the timeline. Ask whether to match the whole timeline to the music and pass fitTimeline accordingly; omit it to keep current length. Commit to save.", compositionMusicImportSchema, false, importCompositionMusic);
addControlTool("composition_music_analyze", "Analyze the current composition's music for beat times and BPM using the same operation as the editor. Review confidence and correct the first downbeat via music.update before music.split_detected_bars; commit to persist.", compositionMusicAnalyzeSchema, false, analyzeCompositionMusic);
addControlTool("mocap_import_kimodo", "Import an existing Kimodo-SOMA BVH file into this project's mocap library. The app validates and converts its motion to the same saved joint data used by the editor. Generate with Kimodo-SOMA-RP-v1.1 --bvh --bvh_standard_tpose; this tool does not run or install the model.", kimodoImportSchema, false, importControlKimodo);
addControlTool("kimodo_install", "Install the isolated KIMODO Python/CUDA environment using the same installer as Settings. Model weights download on first generation. Requires network; gated Llama access requires the user's Hugging Face token. Reuse operationId and inspect job_get.", kimodoInstallSchema, false, installControlKimodo, false, true);
addControlTool("kimodo_generate", "Generate a SOMA v1.1 dance/motion phrase locally and register original BVH, converted motion and prompt/settings in the project. This is text-to-motion, not audio-conditioned dance. Choose RP or SEED explicitly, then composition_apply_dance fits it to music sections while preserving placement and camera. Requires installed KIMODO and approved HF access. Reuse operationId and inspect job_get.", kimodoGenerateSchema, false, generateControlKimodo, false, true);
addControlTool("composition_glb_import", "Copy a local GLB/GLTF into this project's composition folder and create an animation track in the open composition. Inspect the returned track ID, edit it with glb.update, then composition_commit.", compositionGlbImportSchema, false, importCompositionGlb);
addControlTool("composition_background_import", "Copy a local image or HDRI into this composition's project folder. Panoramas go to the app's panorama directory; an existing background of the same kind and name is selected instead of copied again. Read the returned ID, use room.face or room.panorama as needed, then composition_commit.", compositionBackgroundImportSchema, false, importCompositionBackground);
addControlTool("composition_motion_cleanup_prepare", "Build the exact motion-cleanup AI system and prompt used by the editor for one placed character. Requires dense motion capture keys and a current composition revision. No app LLM API call.", motionCleanupPrepareSchema, true, prepareCompositionMotionCleanup);
addControlTool("composition_motion_cleanup_apply", "Apply automatic or Codex/Claude motion-cleanup decisions through the editor's same smoothing algorithm and undo history. Unknown issue IDs are ignored and unanswered issues use the app's automatic fallback.", motionCleanupApplySchema, false, applyCompositionMotionCleanup);
addControlTool(
  "composition_apply_mocap",
  "Apply one person from a saved project-local mocap source to a placed character/mannequin. Uses the editor's retargeting, one undo entry and expectedRevision. Optional sourceStartSeconds/durationSeconds trim the original-video interval; timelineStartSeconds sets its destination. Defaults use the saved source. Mirror follows the analyzed result, with no second flip. Selected channels replace keys only within that interval. Returns compact metadata; call composition_commit to save. No arbitrary file paths.",
  compositionApplyMocapSchema,
  false,
  applyCompositionMocap,
);
addControlTool(
  "composition_apply_dance",
  "Repeat one saved project-local mocap person's motion across selected music sections for 1-12 placed characters. Pose keys only: each character keeps its placed position, camera and manually authored paths. Read the song sections and source first, then use expectedRevision and composition_commit. No arbitrary paths or model generation.",
  compositionApplyDanceSchema,
  false,
  applyCompositionDance,
);
addControlTool(
  "composition_undo",
  "Undo one editor history entry, including manual edits. Inspect the latest revision first.",
  compositionSessionRequestSchema,
  false,
  undoComposition,
);
addControlTool(
  "composition_redo",
  "Redo one editor history entry.",
  compositionSessionRequestSchema,
  false,
  redoComposition,
);
addControlTool(
  "composition_capture",
  "Render current guide and background plate. Returns images for visual inspection and their revision.",
  compositionSessionRequestSchema,
  true,
  async (input) => {
    const captured = await captureComposition(input);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            sessionId: captured.sessionId,
            revision: captured.revision,
            images: ["guide", "plate"],
          }),
        },
        imageBlock(captured.guide),
        imageBlock(captured.plate),
      ],
    };
  },
  true,
);
addControlTool(
  "composition_commit",
  "Capture and persist current composition to its project. Inspect persistedLatest; a newer manual edit may remain unsaved.",
  compositionSessionRequestSchema,
  false,
  commitComposition,
);
addControlTool(
  "composition_changes",
  "Read changes since a revision, including manual UI edits, old/new values and source. Re-read snapshot if fullSnapshotRequired.",
  compositionChangesRequestSchema,
  true,
  getCompositionChanges,
);
addControlTool(
  "composition_wait_changes",
  "Wait up to 20 seconds for manual or controller changes; returns immediately when revision changes. Chat client decides whether to continue watching.",
  compositionChangesRequestSchema.extend({
    timeoutMs: z.number().int().min(0).max(20000).default(15000),
  }),
  true,
  async ({ timeoutMs, ...input }) => {
    const until = Date.now() + timeoutMs;
    while (true) {
      const changes = getCompositionChanges(input);
      if (changes.revision !== input.sinceRevision || Date.now() >= until)
        return changes;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  },
);
addControlTool(
  "engines_list",
  "List only engines included in this edition and their install/hardware requirements.",
  empty,
  true,
  controlEngineCatalog,
);
addControlTool("model_component_inspect", "Read bounded public native safetensors metadata and tensor key/shape descriptors from the approved official repository using registered internal authentication. No weight body is downloaded, no auth is returned, no compatibility verdict is implied.", controlModelInspectSchema, true, inspectControlModel, false, true);
addControlTool("model_component_download", "Download one approved native LTX-2.5 model component through the existing model service and registered internal authentication. Serial download lane runs independently of GPU generation. Use operationId, job_get and job_cancel. Completion verifies official checksum and file structure, not native compatibility or generation quality.", controlModelDownloadSchema, false, enqueueControlModelDownload, false, true);
addControlTool("lora_download", "승인된 공식 LTX-2.5 distilled LoRA 하나를 앱의 등록 인증과 기존 다운로드 서비스로 받습니다. operationId 재사용, job_get 상태 조회, job_cancel 취소를 사용하세요. 토큰 조회·새 인증·GPU 생성·모델 설치 완료 판정은 하지 않습니다.", controlLoraDownloadSchema, false, enqueueControlLoraDownload, false, true);
addControlTool(
  "loras_list",
  "List actual downloaded safetensors LoRAs from engines included in this build. Returns opaque stable IDs, engine, name and size; no local paths. Folder membership is not verified base-model or workflow compatibility. Use IDs with media_generate.loras; no upload, download or arbitrary-path access.",
  controlLorasListSchema,
  true,
  listControlLoras,
);
addControlTool(
  "assets_list",
  "List project asset IDs and file locations; use IDs as media inputs.",
  z.object({ projectId: id }).strict(),
  true,
  (input) => ({ assets: listControlAssets(input.projectId) }),
);
addControlTool(
  "asset_preview",
  "Read an existing image asset as a bounded preview.",
  z.object({ projectId: id, assetId: id }).strict(),
  true,
  async (input) => {
    const preview = await previewControlAsset(input.projectId, input.assetId);
    return {
      content: [
        { type: "text", text: JSON.stringify({ assetId: preview.assetId }) },
        imageBlock(preview.image),
      ],
    };
  },
  true,
);
addControlTool("native_a2v_status", "Read experimental native A2V setup readiness and execution blockers. No inference, download, cache release, or production/lip-sync approval. OOM is a normal failed job; no force termination. Cancellation during native inference waits for the isolated process to finish, then does not attach a result.", z.object({}).strict(), true, nativeA2VStatus);
addControlTool(
  "media_generate",
  "Queue local image/video generation and attach the new result to a target. Explicit engine=ltx25 + options.ltx_a2v=experimental selects isolated native A2V with audioAssetId/audioStartSeconds/audioDurationSeconds and optional first/end images. options.ltx_a2v_checkpoint_read_backend=mmap or pread explicitly selects payload reading for a native disk job; pread can be much slower, both modes retain transient mappings, resources are checked without automatic switching, and requested/resolved policy is recorded. Native disk jobs require an explicit backend, with no hidden slow default; legacy CPU policy is preserved; full GPU peak remains unverified. options.ltx_a2v_offload=disk explicitly selects the installed official lower-RAM disk streaming for both text encoder and transformer; cpu retains legacy CPU pinning. No downloads, source duration change or production/lip-sync guarantee. Only stereo PCM16 WAV is supported; stages condition on original audio, master preserves selected PCM as lossless ALAC. It is GPU-QA-unverified, not exact lip-sync or general production approval. Other LTX requests generate their own audio and preserve validated float32 WAV plus AAC MP4; generated audio is not a supplied transcript/dialogue condition or verified lip-sync. Ordinary installed Wan produces frames only, with no generated speech/audio support. Reuse operationId on retries; use a new ID only to intentionally generate again. No LLM API call. H3 video references require options.reference_video_range=first5s or full; long references can be expensive. LTX 2.5 structureSource selects a same-project composition reference video as a Canny guide for rendered camera and character outlines; cannot combine with poseSource and does not guarantee exact motion replication. Completion metadata records effective conditioning lengths.",
  generateMediaSchema,
  false,
  enqueueControlGeneration,
  false,
  true,
);
addControlTool(
  "media_upscale",
  "Queue an included upscaler and attach a new image. Original file remains. Reuse operationId on retries.",
  upscaleMediaSchema,
  false,
  enqueueControlUpscale,
  false,
  true,
);
addControlTool(
  "jobs_list",
  "List durably saved job status and results. Reads wait only for the bounded journal write captured by the request, not later progress; poll again for newer status. GPU cancellation is cooperative.",
  z
    .object({
      projectId: id.optional(),
      status: z
        .enum(["waiting", "running", "done", "failed", "stopped"])
        .optional(),
    })
    .strict(),
  true,
  async (input) => {
    return { jobs: (await listPersistedTasks(input)).map(publicTask) };
  },
);
addControlTool(
  "job_get",
  "Read one durably saved job including output paths and attachment outcome. Reads wait only for the bounded journal write captured by the request, not later progress; poll again for newer status.",
  z.object({ jobId: id }).strict(),
  true,
  async (input) => {
    const task = await getPersistedTask(input.jobId);
    if (!task) throw new Error("작업을 찾지 못했습니다.");
    return publicTask(task);
  },
);
addControlTool(
  "job_cancel",
  "Persist a cooperative cancellation request. A running GPU call can finish before it stops; check job_get for produced files.",
  z.object({ jobId: id }).strict(),
  false,
  async (input) => {
    const task = getTask(input.jobId);
    if (!task) throw new Error("작업을 찾지 못했습니다.");
    stopTask(input.jobId);
    return publicTask((await getPersistedTask(input.jobId))!);
  },
);
function publicTask(task: NonNullable<ReturnType<typeof getTask>>) {
  const {
    payload: _payload,
    requestFingerprint: _fingerprint,
    llmResponseId: _llmResponseId,
    ...safe
  } = task;
  return safe;
}

export async function dispatchAppControl(
  method: string,
  params: unknown,
): Promise<unknown> {
  if (method === "tools/list")
    return { tools: controlTools.map(({ call: _call, ...tool }) => tool) };
  if (method !== "tools/call")
    throw new Error("알 수 없는 조종기 메서드입니다.");
  try {
    const request = z
      .object({ name: z.string(), arguments: z.unknown().optional() })
      .passthrough()
      .parse(params);
    const tool = controlTools.find((tool) => tool.name === request.name);
    if (!tool) throw new Error("이 판에 없는 조종 명령입니다.");
    const lifecycle = request.name.startsWith("maintenance_");
    const mutating = !tool.annotations.readOnlyHint && !lifecycle;
    if (mutating) assertMaintenanceWritable();
    const finish = mutating ? beginControlMutation() : () => {};
    try { return await tool.call(request.arguments); } finally { finish(); }
  } catch (error) {
    const coded = error as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    const projectedDetails = projectControlValue(coded.details ?? null, "summary");
    const failure = {
      code:
        typeof coded.code === "string"
          ? coded.code
          : error instanceof z.ZodError
            ? "invalid_request"
            : "operation_failed",
      message: error instanceof Error ? error.message : String(error),
      details: projectedDetails.value,
      ...(projectedDetails.projection.truncated ? { detailsProjection: projectedDetails.projection } : {}),
    };
    return { ...result(failure), isError: true };
  }
}

addControlTool("planar_overlay_status", "Read configured CPU planar-overlay readiness. No GPU, download, restart or model changes.", z.object({}).strict(), true, planarOverlayStatus);
addControlTool("media_planar_overlay", "Queue CPU-only per-frame homography for same-project video and RGBA replacement raster. Requires source/replacement SHA256, exact dimensions/fps/frame count and TL/TR/BR/BL coordinates for every frame. Preserves CFR PTS and zero-alpha RGB pixels in lossless frames; H264 recompression is not bit-exact outside mask. Fixed 4px safe inset, no tracking/interpolation/retiming or audio fabrication; original audio streams copied. Non-text tablet screen or declared exact 한국사 cover raster; glyphs and seams still require human QA. Returns a nonprimary derivative without automatic registration or prompt/representative edits. Register only after actual review using media_register with current revision and makePrimary=false. Cancellation waits for CPU process completion; no force termination.", planarOverlaySchema, false, enqueuePlanarOverlay);

addControlTool("protected_edit_status", "Read existing CPU protected-edit tool readiness. No model, inference, segmentation, registration or cache release.", z.object({}).strict(), true, protectedEditStatus);
addControlTool("media_local_edit", "Queue native-size CPU compose or narrow glyph cleanup with explicit same-project selection and protection masks, asset hashes and native/crop mapping. Protection always wins; preserve source RGB outside admitted alpha. Exact text requires a supplied declared RGBA layer (내 시간 or 한국사); reject any clipping by protection, no OCR/glyph guarantee. Reuse existing media_register or comfy_masked_compose only after review and separate authorization. No semantic segmentation, new models, GPU, automatic registration/primary or retiming.", protectedEditSchema, false, enqueueProtectedEdit);

addControlTool("media_edit_status", "Read configured existing CPU media-edit readiness; no GPU, downloads, cache release, installation or restart.", z.object({}).strict(), true, mediaEditStatus);
addControlTool("media_edit_probe", "Read same-project cut-associated video SHA256, exact CFR frame count/rational fps/timebase, audio metadata and selected decoded RGB frame hashes. No visual-review or clean-background verdict. Used to bind explicit holds to a reviewed last source frame.", mediaEditProbeSchema, true, probeMediaEdit);
addControlTool("media_edit", "Queue CPU frame-accurate half-open clip intervals, ordered concatenation and explicit holds of the immediately preceding clip last frame. Require source IDs/cut associations/SHA256/frame counts/latest revision, exact output frame count and rational fixed FPS. No resize, speed change, reverse, overlap/loop, painting or new generation. Holds require caller review declaration and exact decoded RGB frame hash; this is not automatic clean-background approval. Audio defaults to clip-and-silence preserving decoded PCM at the source sample rate and mono/stereo channels; omit explicitly mutes. Mixed sample rates/channel layouts fail instead of implicit resampling. Holds/missing audio receive declared silence; unaligned sample boundaries fail. Lossless RGB H264 and ALAC preserve decoded frames/PCM, compressed source packets are not copied; playback compatibility and seams still need QA. Original files and project prompts/primary preserved. Nonprimary registration is separate via existing media_register with current revision and makePrimary=false. Same operationId/payload is idempotent, changed input conflicts. Cancellation waits for CPU completion without force termination.", mediaEditSchema, false, enqueueMediaEdit);

addControlTool("maintenance_status", "정상 종료 준비 상태를 조회합니다. 다른 프로세스 종료나 설치 가능 여부를 보증하지 않습니다.", empty, true, maintenanceStatus);
addControlTool("maintenance_prepare", "제작 안전 경계 확인 후 새 변경을 막고 전체 앱 작업과 저장을 확인합니다. 30초 준비 토큰을 발급하며 불확실하면 실패합니다.", z.object({ producerSafeBoundaryConfirmed: z.literal(true) }).strict(), false, prepareMaintenance);
addControlTool("maintenance_abort", "정상 종료 준비를 취소하고 새 작업을 다시 허용합니다.", empty, false, abortMaintenance);
addControlTool("maintenance_quit", "유효한 준비 토큰으로 GUI의 저장·유휴 확인 후 정상 종료를 요청합니다. 같은 세션에 연결된 새 MCP 전달기도 응답을 마친 뒤 스스로 닫습니다. 이전 버전·다른 세션의 종료나 설치 잠금 해제는 보증하지 않습니다.", z.object({ token: z.string().min(1) }).strict(), false, quitMaintenance);

addControlTool("aac_preview_status", "Read existing CPU AAC preview readiness; no downloads, GPU, settings changes or quality verdict.", z.object({}).strict(), true, aacPreviewStatus);
addControlTool("media_preview_export", "Queue a separate H264 stream-copy + AAC192k lossy playback derivative from a same-project cut ALAC master. Requires SHA256, latest revision and stable operationId; verifies exact video packets/decoded frames/PTS and audio track duration/encoder delay/tail padding. Preserves master, primary, prompts and voices. No GPU or external transfer. Cancellation waits for CPU completion. Register nonprimary using media_register with previewJobId from the completed job; provenance persists master ID/SHA and explicit lossy audio. Actual playback/listening remain unverified.", aacPreviewSchema, false, enqueueAacPreview);
