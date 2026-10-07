import { z } from "zod";
import { workflowManifestSchema, workflowSelectionSchema, workflowSourceSchema, workflowWeightAuthorizationSchema,
  type ComfyWorkflowManifest, type WorkflowEnvironment, type WorkflowGraph, type WorkflowInspection,
  type WorkflowIssue, type WorkflowNodeReview, type WorkflowSelection, type WorkflowSource } from "./comfyWorkflowContract";

export const STANDARD_WORKFLOW_SOURCE_PINS: Record<string, string> = {
  nodes: "34a483b59eed6bc407e74cd860cba7cae542f494fdff29bb15138369f78387a7",
  "comfy_extras.nodes_mask": "08171f430ddd9a327cec92293ac25fd1bc39d5c9079187a51463fb42d2a9d65b",
  "comfy_extras.nodes_hunyuan": "b32ae8c9a357ababc8ddbc544fdae542b3c8965ad892536f4a2da9fbeaac9f8f",
  "comfy_extras.nodes_wan": "dcd8b81d1225d84e8b0c6743675d59772449899018e9f50bb27267dbb8962002",
  "comfy_extras.nodes_video": "5879633287808ba2dac6753bcbc90acf8d73c72e8df1d0a9755a4ab70e712a0d",
  "comfy_extras.nodes_audio": "f3b386680319b45115f42af565f1e6006c758f5a9efc8d0bf22a7fe4995d00b6",
};
const core = (fields: Omit<WorkflowNodeReview, "pythonModule" | "reviewId" | "sourceSha256"> = {}): WorkflowNodeReview => ({ pythonModule: "nodes", sourceSha256: STANDARD_WORKFLOW_SOURCE_PINS.nodes, reviewId: "core-0.36.0-cpu-review-v1", ...fields });
const extra = (module: string, fields: Omit<WorkflowNodeReview, "pythonModule" | "reviewId" | "sourceSha256"> = {}): WorkflowNodeReview => ({ ...core(fields), pythonModule: `comfy_extras.${module}`, sourceSha256: STANDARD_WORKFLOW_SOURCE_PINS[`comfy_extras.${module}`] });
// 설치 여부는 안전성 검토가 아닙니다. 코드·다운로드·외부 API 노드는 이 목록에 넣지 않습니다.
export const STANDARD_WORKFLOW_NODE_REVIEWS: Record<string, WorkflowNodeReview> = {
  CheckpointLoaderSimple: core({ assets: { ckpt_name: { category: "checkpoints", kind: "model", promptModel: true } } }),
  UNETLoader: core({ assets: { unet_name: { category: "diffusion_models", kind: "model", promptModel: true } } }),
  CLIPLoader: core({ assets: { clip_name: { category: "text_encoders", kind: "model" } } }),
  DualCLIPLoader: core({ assets: { clip_name1: { category: "text_encoders", kind: "model" }, clip_name2: { category: "text_encoders", kind: "model" } } }),
  VAELoader: core({ assets: { vae_name: { category: "vae", kind: "model" } } }),
  LoraLoader: core({ assets: { lora_name: { category: "loras", kind: "lora" } } }),
  LoraLoaderModelOnly: core({ assets: { lora_name: { category: "loras", kind: "lora" } } }),
  CLIPTextEncode: core(), KSampler: core(), KSamplerAdvanced: core(), VAEDecode: core(), EmptyLatentImage: core(),
  LoadImage: core({ uploads: { image: "image" } }), ImageScale: core(),
  ImageToMask: extra("nodes_mask"), MaskToImage: extra("nodes_mask"), ImageCompositeMasked: extra("nodes_mask"),
  EmptyHunyuanLatentVideo: extra("nodes_hunyuan"),
  WanImageToVideo: extra("nodes_wan"), WanFirstLastFrameToVideo: extra("nodes_wan"), Wan22ImageToVideoLatent: extra("nodes_wan"),
  LoadVideo: extra("nodes_video", { uploads: { file: "video" } }),
  LoadAudio: extra("nodes_audio", { uploads: { audio: "audio" } }),
  CreateVideo: extra("nodes_video"), GetVideoComponents: extra("nodes_video"), SaveVideo: extra("nodes_video", { outputKind: "video" }),
  SaveImage: core({ outputKind: "image" }), SaveAudio: extra("nodes_audio", { outputKind: "audio" }), SaveAudioAdvanced: extra("nodes_audio", { outputKind: "audio" }),
};
export const WORKFLOW_POLICY_VERSION = "standard-core-0.36.0-v1";
const nodeSchema = z.object({ class_type: z.string().min(1).max(200), inputs: z.record(z.string(), z.unknown()), _meta: z.object({ title: z.string().max(2000).optional() }).passthrough().optional() }).strict();
const graphSchema = z.record(z.string(), nodeSchema);
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
export const isWorkflowLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && Number.isInteger(v[1]) && v[1] >= 0;
export const isWorkflowScalar = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
export const fieldKey = (nodeId: string, input: string) => `${nodeId}.${input}`;
export function isSafeRelativeWorkflowName(name: string): boolean {
  return Boolean(name) && !/[\u0000-\u001f:]/.test(name) && !name.startsWith("/") && !name.startsWith("\\")
    && name.replace(/\\/g, "/").split("/").every(part => part !== "." && part !== ".." && part.length > 0
      && !/[. ]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}
export function isLocalWorkflowPath(value: string): boolean {
  return !/^[a-z]+:\/\//i.test(value) && !value.startsWith("\\\\") && !value.startsWith("//")
    && (/^[a-z]:[\\/]/i.test(value) || value.startsWith("/")) && !/[\u0000-\u001f]/.test(value)
    && !value.replace(/\\/g, "/").split("/").includes("..");
}
export const workflowMediaKind = (semantic: string): "image" | "video" | "audio" | undefined => {
  if (["firstFrame", "endFrame", "identityImage", "sourceImage", "maskImage", "poseImage", "depthImage"].includes(semantic)) return "image";
  if (["sourceVideo", "maskVideo", "poseVideo", "depthVideo", "cameraGuide"].includes(semantic)) return "video";
  if (semantic === "audio" || semantic === "voiceReference") return "audio";
};

export const isH3WorkflowAssetName = (name: string): boolean => /minimax[_ -]?h3|(?:^|[\\/_-])h3(?:[._/-]|$)|taeh3/i.test(name);
export function workflowWeightAdmission(environment: WorkflowEnvironment, category: string, name: unknown) {
  const weight = environment.weights.find(w => w.category === category && w.name === name);
  const authorization = weight?.sha256 && environment.projectId ? environment.weightAuthorizations?.find(raw => {
    const parsed = workflowWeightAuthorizationSchema.safeParse(raw); if (!parsed.success) return false;
    const record = parsed.data;
    return record.projectId === environment.projectId && record.category === category && record.name === name && record.sha256 === weight.sha256
      && (!isH3WorkflowAssetName(String(name)) || record.modelRuleId === "minimaxh3");
  }) : undefined;
  const publicLicense = weight?.license ?? "unknown";
  const restricted = typeof name === "string" && isH3WorkflowAssetName(name);
  const license = authorization ? "allowed" as const : restricted ? "blocked" as const : publicLicense;
  return { weight, publicLicense, license, authorization };
}

// 새 SaveVideo의 동적 입력도 선택한 갈래의 입력만 허용합니다.
export function workflowInputSpecs(schema: WorkflowEnvironment["catalog"][string], inputs: Record<string, unknown>): { fields: Record<string, unknown[]>; required: Set<string> } {
  const fields: Record<string, unknown[]> = {}; const required = new Set<string>();
  function add(groups: typeof schema.input, prefix = "") {
    for (const group of ["required", "optional"] as const) for (const [name, spec] of Object.entries(groups[group] ?? {})) {
      const key = prefix + name; fields[key] = spec; if (group === "required") required.add(key);
      if (spec[0] === "COMFY_DYNAMICCOMBO_V3") {
        const options = (spec[1] as { options?: { key: string; inputs?: typeof schema.input }[] } | undefined)?.options;
        const selected = options?.find(option => option.key === inputs[key]);
        if (selected?.inputs) add(selected.inputs, key + ".");
      }
    }
  }
  add(schema.input); return { fields, required };
}
export function validateWorkflowScalar(value: unknown, spec: unknown[] | undefined): boolean {
  if (!spec || !isWorkflowScalar(value)) return false;
  const [type, raw] = spec; const options = (raw ?? {}) as { min?: number; max?: number; forceInput?: boolean; options?: unknown[] };
  if (options.forceInput) return false;
  if (Array.isArray(type)) return type.includes(value);
  if (type === "COMBO") return options.options?.includes(value) ?? false;
  if (type === "COMFY_DYNAMICCOMBO_V3") return options.options?.some(option => typeof option === "object" && option !== null && (option as { key?: unknown }).key === value) ?? false;
  if (type === "STRING") return typeof value === "string" && value.length <= 32000;
  if (type === "BOOLEAN") return typeof value === "boolean";
  if (type !== "INT" && type !== "FLOAT") return false;
  return typeof value === "number" && (type !== "INT" || Number.isSafeInteger(value)) && (options.min === undefined || value >= options.min) && (options.max === undefined || value <= options.max);
}
function ancestors(graph: WorkflowGraph, ids: string[]): Set<string> {
  const seen = new Set<string>(); const pending = [...ids];
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id);
    for (const value of Object.values(graph[id]?.inputs ?? {})) if (isWorkflowLink(value)) pending.push(value[0]); }
  return seen;
}
export function inspectComfyWorkflow(text: string, environment: WorkflowEnvironment, rawSelection?: WorkflowSelection, outputKind: "image" | "video" | "audio" = "video"): WorkflowInspection {
  const report: WorkflowInspection = { format: "invalid", issues: [], requiredNodes: [], requiredWeights: [] };
  const issue = (code: string, message: string, nodeId?: string, input?: string) => report.issues.push({ code, message, nodeId, input });
  if (!/^[a-f0-9]{40}$/.test(environment.coreCommit) || !environment.pythonVersion || !environment.torchVersion || !environment.reviewVersion || !environment.comfyVersion)
    issue("environment_version_missing", "코어 commit·Python·Torch·검토 정책 버전이 필요합니다.");
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024) { issue("workflow_too_large", "워크플로 JSON은 8MB 이하여야 합니다."); return report; }
  let raw: unknown; try { raw = JSON.parse(text); } catch { issue("invalid_json", "워크플로 JSON을 읽지 못했습니다."); return report; }
  if (raw && typeof raw === "object" && (Array.isArray((raw as { nodes?: unknown }).nodes) || Array.isArray((raw as { links?: unknown }).links))) {
    report.format = "ui"; issue("api_export_required", "일반 UI 워크플로입니다. ComfyUI에서 API 형식으로 내보내세요. 자동 변환하지 않습니다."); return report;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.entries(raw).some(([id, node]) =>
    unsafeKeys.has(id) || (node && typeof node === "object" && "inputs" in node && node.inputs && typeof node.inputs === "object"
      && Object.keys(node.inputs).some(key => unsafeKeys.has(key))))) {
    issue("unsafe_key", "Reserved object keys are forbidden."); return report;
  }
  const parsed = graphSchema.safeParse(raw);
  if (!parsed.success || !Object.keys(parsed.data).length || Object.keys(parsed.data).length > 2000) { issue("invalid_api_graph", "각 노드에 class_type과 inputs가 있는 API 그래프가 필요합니다."); return report; }
  report.format = "api"; report.graph = parsed.data;
  const graph = parsed.data;
  const authorizedH3Weight = Object.values(graph).some(node => Object.entries(environment.reviewedNodes[node.class_type]?.assets ?? {}).some(([name, asset]) =>
    typeof node.inputs[name] === "string" && isH3WorkflowAssetName(node.inputs[name] as string)
      && Boolean(workflowWeightAdmission(environment, asset.category, node.inputs[name]).authorization)));
  const selectionResult = rawSelection ? workflowSelectionSchema.safeParse(rawSelection) : undefined;
  if (selectionResult && !selectionResult.success) issue("invalid_selection", "입력 역할·프롬프트 역할·출력 설정을 확인하세요.");
  const selection = selectionResult?.success ? selectionResult.data : undefined;
  const effective = Object.fromEntries(Object.entries(graph).map(([id, node]) => [id, { ...node, inputs: { ...node.inputs } }])) as WorkflowGraph;
  for (const slot of selection?.slots ?? []) if (slot.defaultValue !== undefined && effective[slot.nodeId] && isWorkflowScalar(effective[slot.nodeId].inputs[slot.input])) effective[slot.nodeId].inputs[slot.input] = slot.defaultValue;
  for (const [id, node] of Object.entries(effective)) {
    if (unsafeKeys.has(id) || Object.keys(node.inputs).some(k => unsafeKeys.has(k))) issue("unsafe_key", "예약된 객체 키는 사용할 수 없습니다.", id);
    const schema = environment.catalog[node.class_type]; const review = environment.reviewedNodes[node.class_type];
    const reviewed = Boolean(review && review.pythonModule === schema?.python_module && review.reviewId && review.sourceSha256
      && environment.nodeSourceHashes[review.pythonModule] === review.sourceSha256);
    report.requiredNodes.push({ nodeId: id, classType: node.class_type, installed: Boolean(schema), reviewed,
      pythonModule: schema?.python_module, reviewId: reviewed ? review.reviewId : undefined });
    if (!schema) issue("missing_node", `서버에 없는 노드입니다: ${node.class_type}`, id);
    if (!reviewed) issue("unreviewed_node", `검토 목록에 없는 노드입니다: ${node.class_type}`, id);
    if (/minimax.*h3|h3.*minimax/i.test(node.class_type) && !authorizedH3Weight) issue("license_blocked_h3", "프로젝트별 사용 허가와 정확한 H3 파일 해시가 필요합니다.", id);
    if (schema?.api_node) issue("external_api_node", "외부 전송·유료 API 노드는 실행할 수 없습니다.", id);
    if (!schema || !reviewed) continue;
    const specs = workflowInputSpecs(schema, node.inputs);
    for (const name of specs.required) if (!(name in node.inputs)) issue("missing_required_input", `필수 입력이 없습니다: ${name}`, id, name);
    for (const [name, value] of Object.entries(node.inputs)) {
      const spec = specs.fields[name];
      if (!spec) { issue("unknown_input", `서버 규격에 없는 입력입니다: ${name}`, id, name); continue; }
      if (isWorkflowLink(value)) {
        const from = effective[value[0]]; const output = from && environment.catalog[from.class_type]?.output[value[1]];
        if (!from || !output) issue("dangling_link", "존재하지 않는 노드 또는 출력 번호입니다.", id, name);
        else if (spec[0] !== "*" && output !== "*" && output !== spec[0]) issue("link_type_mismatch", `연결 형식이 다릅니다: ${output} → ${String(spec[0])}`, id, name);
      } else if (review.uploads?.[name]) {
        if (typeof value !== "string" || !isSafeRelativeWorkflowName(value)) issue("unsafe_media_path", "참조 입력은 업로드 파일명이어야 합니다. URL·절대경로는 사용할 수 없습니다.", id, name);
      } else if (!validateWorkflowScalar(value, spec)) issue("invalid_input_value", `입력 형식·범위·선택값을 확인하세요: ${name}`, id, name);
      if (name === "filename_prefix" && (typeof value !== "string" || !isSafeRelativeWorkflowName(value) || /[%{}]/.test(value))) issue("unsafe_output_prefix", "결과 이름에 URL·절대경로·상위 폴더를 사용할 수 없습니다.", id, name);
      const asset = review.assets?.[name];
      if (asset) {
        const { weight, license, publicLicense, authorization } = workflowWeightAdmission(environment, asset.category, value);
        const installed = typeof value === "string" && isSafeRelativeWorkflowName(value) && validateWorkflowScalar(value, spec) && Boolean(weight);
        report.requiredWeights.push({ nodeId: id, input: name, ...asset, name: typeof value === "string" ? value : "", installed, license, publicLicense, authorization, sha256: weight?.sha256 });
        if (!installed) issue("missing_weight", `ComfyUI에 설치된 ${asset.kind === "lora" ? "LoRA" : "가중치"} 파일명을 선택하세요.`, id, name);
        if (license !== "allowed") issue("weight_license_unverified", "가중치의 사용 허가가 확인되지 않았습니다.", id, name);
        if (typeof value === "string" && isH3WorkflowAssetName(value) && !authorization) issue("license_blocked_h3", "프로젝트별 사용 허가와 정확한 H3 파일 해시가 필요합니다.", id, name);
      }
    }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(id: string) { if (visited.has(id)) return; if (visiting.has(id)) { issue("graph_cycle", "순환 연결이 있습니다.", id); return; }
    visiting.add(id); for (const value of Object.values(graph[id]?.inputs ?? {})) if (isWorkflowLink(value) && graph[value[0]]) visit(value[0]); visiting.delete(id); visited.add(id); }
  for (const id of Object.keys(graph)) visit(id);
  if (!selection) { issue("mapping_required", "의미별 입력·프롬프트 역할·영상 출력 노드를 지정하세요."); return report; }
  const active = ancestors(graph, selection.outputNodeIds);
  const slotIds = new Set<string>(); const targets = new Set<string>(); const roleSlots = new Set<string>();
  for (const slot of selection.slots) {
    const key = fieldKey(slot.nodeId, slot.input); const node = graph[slot.nodeId]; const review = node && environment.reviewedNodes[node.class_type];
    if (slotIds.has(slot.id) || targets.has(key)) issue("duplicate_mapping", "슬롯 이름 또는 입력 대상이 중복됐습니다.", slot.nodeId, slot.input);
    slotIds.add(slot.id); targets.add(key);
    if (!node || !isWorkflowScalar(node.inputs[slot.input])) issue("binding_target_not_scalar", "슬롯은 기존 스칼라 입력에만 연결할 수 있습니다. 노드 연결은 덮어쓸 수 없습니다.", slot.nodeId, slot.input);
    if (!active.has(slot.nodeId)) issue("inactive_binding", "선택한 결과로 이어지지 않는 입력입니다.", slot.nodeId, slot.input);
    const mediaKind = workflowMediaKind(slot.semantic);
    if (mediaKind && (review?.uploads?.[slot.input] !== mediaKind || !slot.required || slot.defaultValue !== undefined)) issue("invalid_media_slot", "참조는 같은 갈래의 업로드 입력에 필수 슬롯으로 연결하세요. 선택 입력은 검토된 별도 변형이 필요합니다.", slot.nodeId, slot.input);
    if (slot.semantic.startsWith("mask") && !slot.maskConvention) issue("mask_convention_required", "마스크의 흰색·알파 규약을 지정하세요.", slot.nodeId, slot.input);
    if (["poseVideo", "depthVideo", "maskVideo", "cameraGuide", "audio"].includes(slot.semantic) && !slot.alignment) issue("alignment_required", "영상·오디오 조건의 시간축 정렬 방식을 지정하세요.", slot.nodeId, slot.input);
    if (slot.semantic === "loraName" && review?.assets?.[slot.input]?.kind !== "lora") issue("invalid_lora_slot", "LoRA 이름은 검토된 LoRA 로더의 파일명 입력에 연결하세요.", slot.nodeId, slot.input);
    if (slot.semantic === "loraModelStrength" && (!review?.assets?.lora_name || slot.input !== "strength_model")) issue("invalid_lora_slot", "모델 강도는 LoRA 로더의 strength_model에 연결하세요.", slot.nodeId, slot.input);
    if (slot.semantic === "loraClipStrength" && (!review?.assets?.lora_name || slot.input !== "strength_clip")) issue("invalid_lora_slot", "텍스트 강도는 LoRA 로더의 strength_clip에 연결하세요.", slot.nodeId, slot.input);
    if (!mediaKind && review?.uploads?.[slot.input]) issue("untyped_media_binding", "파일 입력은 참조 역할로 지정해야 합니다.", slot.nodeId, slot.input);
    if (review?.assets?.[slot.input] && slot.semantic !== "loraName") issue("model_override_forbidden", "모델 로더 파일은 그래프에 고정합니다. LoRA 파일명만 명시적으로 바꿀 수 있습니다.", slot.nodeId, slot.input);
  }
  for (const [id, node] of Object.entries(graph)) for (const name of Object.keys(environment.reviewedNodes[node.class_type]?.uploads ?? {}))
    if (name in node.inputs && !targets.has(fieldKey(id, name))) issue("unmapped_media_input", "그래프의 파일 입력을 참조 슬롯에 연결하세요.", id, name);
  const roleIds = new Set<string>(); const loaderIds = new Set<string>();
  for (const role of selection.promptRoles) {
    if (roleIds.has(role.id)) issue("duplicate_prompt_role", "프롬프트 역할이 중복됐습니다."); roleIds.add(role.id);
    if (role.negativeSupport !== "supported" && role.negativeSlotIds.length) issue("negative_unsupported", "부정 프롬프트가 적용되지 않는 역할에는 부정 입력을 연결할 수 없습니다.");
    for (const [semantic, ids] of [["positive", role.positiveSlotIds], ["negative", role.negativeSlotIds]] as const) for (const id of ids) {
      const slot = selection.slots.find(s => s.id === id);
      if (!slot || slot.semantic !== semantic || !slot.required || roleSlots.has(id)) issue("invalid_prompt_slot", "프롬프트 역할마다 고유한 필수 입력을 지정하세요.");
      roleSlots.add(id);
      const node = slot && graph[slot.nodeId]; const spec = node && environment.catalog[node.class_type] && workflowInputSpecs(environment.catalog[node.class_type], effective[slot!.nodeId].inputs).fields[slot!.input];
      if (spec?.[0] !== "STRING") issue("prompt_requires_string", "프롬프트는 문자열 입력이어야 합니다.");
    }
    for (const id of role.loaderNodeIds) {
      const node = graph[id]; const review = node && environment.reviewedNodes[node.class_type];
      if (!node || !Object.values(review?.assets ?? {}).some(a => a.promptModel) || !active.has(id)) issue("invalid_prompt_model", "프롬프트 역할에 실제 출력으로 이어지는 모델 로더를 지정하세요.", id);
      loaderIds.add(id);
    }
  }
  for (const slot of selection.slots) if (["positive", "negative"].includes(slot.semantic) && !roleSlots.has(slot.id)) issue("unassigned_prompt_slot", "프롬프트 입력의 역할을 명시하세요.", slot.nodeId, slot.input);
  for (const [id, node] of Object.entries(graph)) if (Object.values(environment.reviewedNodes[node.class_type]?.assets ?? {}).some(a => a.promptModel) && !loaderIds.has(id)) issue("prompt_model_ambiguous", "모든 모델 로더의 프롬프트 역할을 명시하세요. 임의로 하나를 선택하지 않습니다.", id);
  if (!roleIds.has(selection.selectedPromptRoleId)) issue("prompt_role_required", "사용할 프롬프트 역할을 명시적으로 선택하세요.");
  if (new Set(selection.outputNodeIds).size !== selection.outputNodeIds.length) issue("duplicate_output", "결과 노드가 중복됐습니다.");
  for (const id of selection.outputNodeIds) { const node = graph[id]; if (!node || !environment.catalog[node.class_type]?.output_node || environment.reviewedNodes[node.class_type]?.outputKind !== outputKind) issue("media_output_required", `검토된 ${outputKind} 저장 노드를 선택하세요.`, id); }
  const groupIds = new Set<string>(); const groupedSlots = new Set<string>();
  for (const group of selection.referenceGroups) {
    if (groupIds.has(group.id)) issue("duplicate_reference_group", "참조 그룹이 중복됐습니다."); groupIds.add(group.id);
    if (group.strategy !== "fixed-slots") issue("list_input_unsupported", "목록 입력은 기존 실행 어댑터가 지원하지 않습니다. 검토된 고정 입력 변형을 선택하세요.");
    if (group.minItems !== group.maxItems || group.maxItems !== group.slotIds.length) issue("reference_variant_required", "참조 개수에 맞춰 검토된 0/1/2/N 변형을 선택하세요. 고정 그래프의 입력은 생략·복제하지 않습니다.");
    for (const id of group.slotIds) { const slot = selection.slots.find(s => s.id === id);
      if (!slot || slot.semantic !== group.role || workflowMediaKind(slot.semantic) !== group.mediaKind || groupedSlots.has(id)) issue("invalid_reference_group", "그룹의 참조 갈래·역할·슬롯 순서를 확인하세요."); groupedSlots.add(id); }
  }
  return report;
}
export async function workflowSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function workflowNodeSchemaSha256(schema: WorkflowEnvironment["catalog"][string], review: WorkflowNodeReview): Promise<string> {
  const inputs = JSON.parse(JSON.stringify(schema.input)) as typeof schema.input;
  for (const group of ["required", "optional"] as const) for (const [name, spec] of Object.entries(inputs[group] ?? {})) {
    if (review.assets?.[name] || review.uploads?.[name]) {
      if (Array.isArray(spec[0])) spec[0] = [review.assets?.[name] ? "INSTALLED_WEIGHT_NAME" : "UPLOADED_MEDIA_NAME"];
      const options = spec[1] as { options?: unknown } | undefined; if (options && spec[0] === "COMBO") options.options = ["DYNAMIC_CATALOG_NAME"];
    }
  }
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return workflowSha256(JSON.stringify(stable({ input: inputs, inputOrder: schema.input_order, inputIsList: Boolean(schema.input_is_list || schema.is_input_list),
    output: schema.output, outputName: schema.output_name, outputIsList: schema.output_is_list, outputMatchtypes: schema.output_matchtypes,
    pythonModule: schema.python_module, outputNode: Boolean(schema.output_node), apiNode: Boolean(schema.api_node) })));
}
export async function buildComfyWorkflowManifest(input: { text: string; source: WorkflowSource; selection: WorkflowSelection; environment: WorkflowEnvironment; checkedAtUtc: string }): Promise<{ inspection: WorkflowInspection; manifest?: ComfyWorkflowManifest }> {
  const source = workflowSourceSchema.parse(input.source); const selection = workflowSelectionSchema.parse(input.selection);
  const inspection = inspectComfyWorkflow(input.text, input.environment, selection, source.outputKind);
  if (!isLocalWorkflowPath(source.workflowPath) || !/\.json$/i.test(source.workflowPath)) inspection.issues.push({ code: "local_workflow_reference_required", message: "사용자가 고른 로컬 JSON 파일의 보존된 참조가 필요합니다. URL·공유 경로는 사용할 수 없습니다." });
  if (inspection.issues.length) return { inspection };
  const sha256 = await workflowSha256(input.text); const role = selection.promptRoles.find(r => r.id === selection.selectedPromptRoleId)!;
  const weightAuthorizations = inspection.requiredWeights.flatMap(w => w.authorization ? [w.authorization] : []).filter((a, index, items) => items.findIndex(b => b.category === a.category && b.name === a.name && b.sha256 === a.sha256) === index);
  const manifest = workflowManifestSchema.parse({ ...source, schemaVersion: 1, workflowSha256: sha256, format: "api", selection,
    ...(input.environment.projectId ? { projectId: input.environment.projectId } : {}), weightAuthorizations,
    promptTarget: { kind: "workflow", workflowId: source.workflowId, workflowSha256: sha256, roleId: role.id, modelRuleId: role.modelRuleId },
    environment: { comfyVersion: input.environment.comfyVersion, reviewVersion: input.environment.reviewVersion, coreCommit: input.environment.coreCommit, pythonVersion: input.environment.pythonVersion, torchVersion: input.environment.torchVersion, customNodeVersions: input.environment.customNodeVersions },
    nodeRequirements: await Promise.all(inspection.requiredNodes.map(async n => ({ nodeId: n.nodeId, classType: n.classType, pythonModule: n.pythonModule!, reviewId: n.reviewId!, sourceSha256: input.environment.reviewedNodes[n.classType].sourceSha256, schemaSha256: await workflowNodeSchemaSha256(input.environment.catalog[n.classType], input.environment.reviewedNodes[n.classType]) }))),
    weightRequirements: inspection.requiredWeights.map(w => ({ nodeId: w.nodeId, input: w.input, category: w.category, kind: w.kind, name: w.name, license: w.license, publicLicense: w.publicLicense, authorization: w.authorization, sha256: w.sha256 })),
    verification: { static: "passed", installedRequirements: "passed", actualGenerationRegistration: "not-run", executionAdmission: "required", checkedAtUtc: input.checkedAtUtc },
  });
  return { inspection, manifest };
}
export function assertWorkflowInspection(inspection: WorkflowInspection): asserts inspection is WorkflowInspection & { graph: WorkflowGraph } {
  if (inspection.issues.length || !inspection.graph) throw new Error(inspection.issues.map((i: WorkflowIssue) => `${i.code}: ${i.message}`).join("\n") || "워크플로 검사가 끝나지 않았습니다.");
}
