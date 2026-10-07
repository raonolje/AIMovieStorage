import { z } from "zod";
import { checkComfy } from "./upscale";
import { getComfyGenerationSettings, inspectComfyGenerationWorkflow, type ComfyKind } from "./comfyGeneration";
import { explicitComfyGenerateSchema, explicitMaskedComposeSchema, enqueueExplicitComfy, enqueueExplicitMaskedCompose } from "./workflowControlRoutes";
import { registerTaskRunner } from "./taskQueue";
export const comfyWorkflowSchema=z.object({kind:z.enum(["image","video"])}).strict();
export const comfyGenerateSchema=explicitComfyGenerateSchema;
export const comfyMaskedComposeSchema=explicitMaskedComposeSchema;
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

export async function enqueueControlComfy(raw:unknown){return enqueueExplicitComfy(raw);}
export async function enqueueControlComfyMasked(raw:unknown){return enqueueExplicitMaskedCompose(raw);}
// 이전 작업을 전역 mapping으로 재발주하면 모델과 참조가 달라질 수 있어 이력은 남기고 차단합니다.
registerTaskRunner("control.comfy",async()=>{throw new Error("workflow_legacy_task_requires_explicit_role: 이전 작업 기록은 보존했습니다. workflow 역할과 입력을 확인해 새 요청으로 접수하세요.");});
