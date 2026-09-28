import { z } from "zod";
import { readProject } from "./projectWrite";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { projectFolderName } from "./localProjectStore";
import { getMediaLibrarySettings } from "./mediaLibrary";
import { attachControlMediaResult, controlMediaTarget, listControlAssets, mediaTargetSchema } from "./controlMedia";
import { checkComfy } from "./upscale";
import {
  getComfyGenerationSettings, inspectComfyGenerationWorkflow, prepareComfyBindings,
  type ComfyGenerationSettings, type ComfyKind, type ComfyReference,
} from "./comfyGeneration";
import { runQueuedComfy } from "./comfyTasks";
import { enqueueTaskOperation, getTaskByOperationId, isStopping, registerTaskRunner, whenTaskJournalReady } from "./taskQueue";

const id = z.string().min(1).max(200);
export const comfyWorkflowSchema = z.object({ kind: z.enum(["image", "video"]) }).strict();
export const comfyGenerateSchema = z.object({
  projectId: id,
  target: mediaTargetSchema,
  expectedRevision: id,
  operationId: id,
  kind: z.enum(["image", "video"]),
  prompt: z.string().min(1).max(32000),
  negative: z.string().max(32000).optional(),
  referenceAssetIds: z.array(id).max(16).default([]),
  values: z.record(z.string().min(1).max(200), z.union([
    z.string().max(32000), z.number().finite(), z.boolean(),
  ])).default({}).describe("Only nodeId.input fields explicitly configured as value mappings may be overridden."),
}).strict();
type Input = z.infer<typeof comfyGenerateSchema>;
type Payload = { input: Input; settings: ComfyGenerationSettings; references: ComfyReference[]; workflowSha256: string; baseDirectory: string; projectFolder: string };

const storageKey = (path: string) => path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
function assertDestination(input: Input, baseDirectory: string, projectFolder: string, title: string) {
  if (!baseDirectory || storageKey(getMediaLibrarySettings().baseDirectory) !== storageKey(baseDirectory))
    throw new Error("ComfyUI 작업을 접수한 뒤 저장 폴더가 바뀌었습니다. 원래 저장 폴더로 돌아와 결과를 이어받으세요.");
  if (!projectFolder || projectFolderName(input.projectId, title) !== projectFolder)
    throw new Error("ComfyUI 작업을 접수한 뒤 프로젝트 위치가 바뀌었습니다. 원래 프로젝트를 확인하세요.");
}

function configured(kind: ComfyKind) {
  const settings = getComfyGenerationSettings();
  if (!settings[kind].workflowPath) throw new Error("설정에서 ComfyUI 생성 워크플로를 먼저 고르세요.");
  return settings;
}
export async function getControlComfyStatus() {
  const settings = getComfyGenerationSettings();
  const workflows = Object.fromEntries((["image", "video"] as const).map(kind => [kind, {
    configured: Boolean(settings[kind].workflowPath), mappings: settings[kind].mappings.length,
  }]));
  try { return { connected: true, summary: await checkComfy(settings.baseUrl), workflows }; }
  catch (error) { return { connected: false, message: String(error instanceof Error ? error.message : error), workflows }; }
}
export async function getControlComfyWorkflow(raw: unknown) {
  const { kind } = comfyWorkflowSchema.parse(raw);
  const settings = configured(kind);
  const info = await inspectComfyGenerationWorkflow(settings[kind].workflowPath);
  return {
    kind, nodeCount: info.nodes.length, outputNodeIds: settings[kind].outputNodeIds,
    // 전체 그래프에는 개인 경로·API 키가 들어 있을 수 있으므로 연결된 입력 규격만 공개합니다.
    mappings: settings[kind].mappings.map(mapping => {
      const node = info.nodes.find(node => node.id === mapping.nodeId);
      const field = node?.inputs.find(field => field.name === mapping.input);
      return {
        nodeId: mapping.nodeId, input: mapping.input, source: mapping.source,
        classType: node?.classType, valueType: typeof field?.value,
        referenceKind: mapping.source === "reference" ? mapping.referenceKind ?? "image" : undefined,
        referenceIndex: mapping.source === "reference" ? mapping.referenceIndex ?? 0 : undefined,
        overrideKey: mapping.source === "value" ? `${mapping.nodeId}.${mapping.input}` : undefined,
        valid: Boolean(field),
      };
    }),
    limitations: ["워크플로의 노드와 모델을 사용합니다. 유료 API 노드의 요금도 해당 제공자를 따릅니다.",
      "취소는 앱의 대기를 중지합니다. ComfyUI 서버 작업은 계속될 수 있습니다."],
  };
}
function resolveReferences(input: Input): ComfyReference[] {
  const assets = listControlAssets(input.projectId);
  return input.referenceAssetIds.map(assetId => {
    const asset = assets.find(item => item.id === assetId);
    if (!asset || asset.kind === "other") throw new Error("현재 프로젝트에서 생성 레퍼런스를 찾지 못했습니다.");
    return { kind: asset.kind, path: asset.path };
  });
}
async function requireRevision(input: Input) {
  const snapshot = await getProjectSnapshot(input.projectId, "summary");
  if (snapshot.revision !== input.expectedRevision)
    throw new ProjectControlError("revision_conflict", "그 사이 프로젝트가 바뀌었습니다. 최신 상태를 읽은 뒤 생성 요청을 다시 보내세요.",
      { actualRevision: snapshot.revision, expectedRevision: input.expectedRevision });
}
export async function enqueueControlComfy(raw: unknown) {
  const input = comfyGenerateSchema.parse(raw);
  await whenTaskJournalReady();
  const previous = getTaskByOperationId(input.operationId);
  if (previous) {
    const payload = previous.payload as Payload;
    if (previous.kind !== "control.comfy" || JSON.stringify(payload.input) !== JSON.stringify(input))
      throw new Error("같은 작업 요청 열쇠에 다른 내용이 들어왔습니다.");
    return enqueueTaskOperation({ lane: "media", kind: "control.comfy", projectId: input.projectId,
      projectTitle: previous.projectTitle, label: previous.label, operationId: input.operationId, payload });
  }
  await requireRevision(input);
  const draft = readProject(input.projectId);
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!baseDirectory) throw new Error("프로젝트 저장 폴더를 먼저 설정하세요.");
  const projectFolder = projectFolderName(input.projectId, draft.title);
  controlMediaTarget(draft, input.target);
  if (input.kind === "video" && input.target.kind !== "cut") throw new Error("영상 결과는 컷에 붙입니다.");
  const settings = configured(input.kind);
  const references = resolveReferences(input);
  const info = await inspectComfyGenerationWorkflow(settings[input.kind].workflowPath);
  prepareComfyBindings(settings[input.kind], info, { ...input, references });
  await requireRevision(input);
  assertDestination(input, baseDirectory, projectFolder, draft.title);
  return enqueueTaskOperation({
    lane: "media", kind: "control.comfy", projectId: input.projectId, projectTitle: draft.title,
    label: `ComfyUI · ${input.kind === "image" ? "이미지" : "영상"}`,
    operationId: input.operationId, payload: { input, settings, references, workflowSha256: info.sha256, baseDirectory, projectFolder } satisfies Payload,
  });
}

registerTaskRunner("control.comfy", async (raw, report, task) => {
  const payload = raw as Payload;
  const input = comfyGenerateSchema.parse(payload.input);
  if (isStopping(task.id)) return;
  const draft = readProject(input.projectId);
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  assertDestination(input, payload.baseDirectory, payload.projectFolder, draft.title);
  const target = controlMediaTarget(draft, input.target);
  // 큐에서 기다리는 동안 참조가 교체되면 다른 파일을 몰래 올리지 않습니다.
  if (!task.externalCheckpoint && JSON.stringify(resolveReferences(input)) !== JSON.stringify(payload.references))
    throw new Error("대기 중 레퍼런스가 바뀌었습니다. 최신 상태로 생성 요청을 다시 보내세요.");
  const made = await runQueuedComfy({
    ...input, settings: payload.settings, references: payload.references, workflowSha256: payload.workflowSha256,
    projectName: payload.projectFolder, baseDirectory: payload.baseDirectory,
    assetType: input.kind === "video" ? "scene-video" : target.assetType,
    ownerName: target.ownerName, stem: target.stem,
  }, report, task);
  const paths = made.files.map(file => file.path);
  if (isStopping(task.id)) return { paths, data: { promptId: made.promptId, attached: false } };
  const latest = readProject(input.projectId);
  if (!latest) throw new Error("프로젝트를 찾지 못했습니다.");
  assertDestination(input, payload.baseDirectory, payload.projectFolder, latest.title);
  const assetIds: string[] = [];
  for (const file of made.files) assetIds.push(await attachControlMediaResult(
    input.projectId, input.target, file.path, file.name, file.kind === "video",
  ));
  return { paths, assetIds, data: { promptId: made.promptId, attached: true } };
});
