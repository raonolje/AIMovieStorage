import { z } from "zod";
import { controlDetailSchema, projectControlValue } from "./controlProjection";
import { EDITION } from "./edition";
import { controlLorasListSchema, listControlLoras } from "./controlLoras";
import { compositionApplyMocapSchema, applyCompositionMocap } from "./compositionMocapControl";
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
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
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
addControlTool("composition_export_video", "Queue the open composition as an MP4 reference video (default 15 seconds, 1920×1080, 24 fps). Requires the matching project/session and expectedRevision. Reuse operationId for retries; inspect the returned task with job_get. Completion requires file and project reference persistence; composition state itself is not committed.", compositionExportVideoSchema, false, enqueueCompositionVideoExport);
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
  "Queue local music generation and attach the resulting track. Missing weights may be downloaded by the engine. Reuse operationId on retries.",
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
addControlTool(
  "composition_apply_mocap",
  "Apply one person from a saved project-local mocap source to a placed character/mannequin. Uses the editor's retargeting, one undo entry and expectedRevision. Optional sourceStartSeconds/durationSeconds trim the original-video interval; timelineStartSeconds sets its destination. Defaults use the saved source. Mirror follows the analyzed result, with no second flip. Selected channels replace keys only within that interval. Returns compact metadata; call composition_commit to save. No arbitrary file paths.",
  compositionApplyMocapSchema,
  false,
  applyCompositionMocap,
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
addControlTool(
  "media_generate",
  "Queue local image/video generation and attach the new result to a target. Reuse operationId on retries; use a new ID only to intentionally generate again. No LLM API call. H3 video references require options.reference_video_range=first5s or full; long references can be expensive. LTX 2.5 structureSource selects a same-project composition reference video as a Canny guide for rendered camera and character outlines; cannot combine with poseSource and does not guarantee exact motion replication. Completion metadata records effective conditioning lengths.",
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
    return await tool.call(request.arguments);
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
