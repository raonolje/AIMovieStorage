import { targetModels } from "./modelRules";
import { isEngineIncluded } from "./edition";
import type { ProjectDraft } from "./projectTypes";

/** 로컬 선택값과 가이드 ID를 한 곳에서 연결해 경로마다 다른 모델로 작성되는 일을 막습니다. */
export const LOCAL_PROMPT_MODELS = {
  qwenimage: "image", zimage: "image", krea2: "image", anima: "image",
  minimaxh3: "video", wanvideo: "video", ltx25: "video",
  minimaxmusic: "music", acestep: "music",
} as const;
const ALIASES: Record<string, string> = {
  nbpro: "nano-banana", seedance25: "seedance-2.5", seedance20: "seedance-2.0",
  kling: "kling-3.0", veo: "veo-3.1", sora: "sora-2",
  suno: "suno-v6", "local-minimax": "minimaxmusic", "local-acestep": "acestep",
};
export function canonicalPromptModel(id?: string | null): string | undefined {
  if (!id) return undefined;
  if (isLocalPromptModel(id)) return id;
  return ALIASES[id] ?? [...targetModels("image"), ...targetModels("video")].find(model => model.id === id || model.magnific === id || model.providerModelId === id || model.label === id || model.aliases?.includes(id))?.id ?? id;
}
export function isLocalPromptModel(id?: string): id is keyof typeof LOCAL_PROMPT_MODELS {
  return Boolean(id && id in LOCAL_PROMPT_MODELS);
}
export type WorkflowPromptTarget = { kind: "workflow"; workflowId: string; workflowSha256: string; roleId: string; modelRuleId: string };
export type PromptSelection = { modelId?: string; platformId?: string; route: string; selectedId?: string; workflowTarget?: WorkflowPromptTarget; error?:string };
export function resolvePromptSelection(kind: "image" | "video", input: {
  model?: string; engine?: string; workflowTarget?: WorkflowPromptTarget; project?: Pick<ProjectDraft, "batchEngines" | "magnific" | "workflowTargets"> | null; platform?: string;
}): PromptSelection {
  const engine = input.engine || input.project?.batchEngines?.[kind];
  const workflowTarget = input.workflowTarget ?? (engine === "comfy" ? input.project?.workflowTargets?.[kind] : undefined);
  if (workflowTarget) return { modelId: canonicalPromptModel(workflowTarget.modelRuleId), platformId: "comfyui", route: "comfy", selectedId: workflowTarget.workflowId, workflowTarget };
  if (engine === "comfy") return { route:"comfy", platformId:"comfyui" };
  const local = engine && engine !== "magnific" && engine !== "magnific-mcp" ? engine : undefined;
  const selected = local || input.model || input.project?.magnific?.[kind === "image" ? "imageModel" : "videoModel"];
  const modelId = canonicalPromptModel(selected);
  if (local && (!isLocalPromptModel(local) || LOCAL_PROMPT_MODELS[local] !== kind || !isEngineIncluded(local)))
    return {route:local,modelId,selectedId:selected,platformId:"local",error:`선택한 ${kind === "image" ? "이미지" : "영상"} 엔진을 사용할 수 없습니다: ${local}. 모델을 다시 선택하세요.`};
  if (isLocalPromptModel(modelId)) {
    if (LOCAL_PROMPT_MODELS[modelId] !== kind || !isEngineIncluded(modelId)) return {route:modelId,modelId,selectedId:selected,platformId:"local",error:`선택한 모델의 종류 또는 배포판이 맞지 않습니다: ${modelId}`};
    return { modelId, selectedId: selected, route: modelId, platformId: "local" };
  }
  const known = [...targetModels("image"), ...targetModels("video")].find(model => model.id === modelId);
  if (known && known.kind !== kind)
    return {route:engine||"magnific",modelId,selectedId:selected,error:`선택한 모델은 ${kind === "image" ? "이미지" : "영상"} 모델이 아닙니다: ${selected}`};
  // 빈 값은 «모델 미선택»으로 남깁니다. 알 수 없는 ID를 첫 모델로 바꾸지 않습니다.
  return { modelId, selectedId: selected, route: engine || "magnific", platformId: input.platform };
}
export function promptStamp(selection: Pick<PromptSelection, "modelId" | "platformId" | "route" | "workflowTarget" | "selectedId">): string {
  return JSON.stringify([selection.modelId ?? null, selection.route, selection.platformId ?? null,selection.selectedId??null, ...(selection.workflowTarget ? [selection.workflowTarget] : [])]);
}
export function promptStaleMessage(saved: string | undefined, selection: PromptSelection, filled: boolean): string {
  if(selection.error)return selection.error;
  if(selection.route==="comfy"&&!selection.workflowTarget)return "workflow와 명시 프롬프트 역할을 먼저 선택하세요. 기존 문장은 유지됩니다.";
  if (!filled) return "";
  if (!saved) return "작성 모델 기록이 없습니다. 현재 모델로 재작성하려면 프롬프트 작성을 누르세요. 기존 문장은 유지됩니다.";
  return saved === promptStamp(selection) ? "" : "선택 모델이 작성 당시와 다릅니다. 기존 문장은 유지됩니다. 재작성하면 현재 모델을 반영합니다.";
}
export function assertPromptSelection(selection:PromptSelection):void {if(selection.error)throw new Error(selection.error);}
export function assertPromptSnapshot(before: unknown, current: unknown): void {
  if (JSON.stringify(before) !== JSON.stringify(current)) throw new Error("작성 중 모델 또는 프롬프트가 바뀌었습니다. 현재 문장을 보존했습니다. 다시 작성해 주세요.");
}
export function promptResultForModel<T extends { negativeKo?: string; negativeEn?: string }>(result: T, modelId?: string): T {
  return ["zimage", "krea2", "minimaxh3", "nano-banana-2.1"].includes(canonicalPromptModel(modelId) ?? "") ? { ...result, negativeKo: "", negativeEn: "" } : result;
}
