// Separate additive V2 adapter. Existing V1 adapter remains byte-identical.
import { workflowSourceSchema,
  type WorkflowAdapterPlan, type WorkflowAssetFact, 
  type WorkflowEnvironment, type WorkflowScalar } from "./comfyWorkflowContract";
import { assertWorkflowInspection, isLocalWorkflowPath, workflowWeightAdmission, workflowMediaKind, workflowSha256 } from "./comfyWorkflowInspection";
import { validateWorkflowScalar, workflowInputSpecs } from "./comfyWorkflowV2Core";
import { workflowManifestV2Schema, type ComfyWorkflowManifestV2, type WorkflowBindingRequestV2 } from "./comfyWorkflowContractV2";
import { buildComfyWorkflowManifestV2, inspectBoundComfyWorkflowV2, validateWorkflowV2BindingInputs, toV1OutputManifest } from "./comfyWorkflowInspectionV2";
import { identifyWorkflowOutputs as identifyV1, validateWorkflowCollectedOutputs as validateCollectedV1 } from "./comfyWorkflowBinding";

function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
const extensions = { image: ["png", "jpg", "jpeg", "webp", "gif"], video: ["mp4", "mov", "webm", "mkv"], audio: ["wav", "mp3", "flac", "ogg", "m4a"] };
function validateAsset(asset: WorkflowAssetFact, projectId: string, kind: WorkflowAssetFact["kind"]) {
  if (asset.projectId !== projectId || !asset.assetId) fail("reference_project_mismatch", "같은 프로젝트의 등록된 참조만 사용할 수 있습니다.");
  if (asset.kind !== kind || !isLocalWorkflowPath(asset.path) || !extensions[kind].includes(asset.path.split(".").pop()!.toLowerCase())) fail("invalid_reference_kind", "참조의 갈래·로컬 파일 경로를 확인하세요.");
  if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !asset.decodable) fail("reference_not_verified", "참조의 파일 해시·크기·디코딩 검사가 필요합니다.");
  if (kind !== "audio" && (!asset.width || !asset.height || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width < 1 || asset.height < 1)) fail("reference_shape_missing", "참조의 실제 해상도를 확인하세요.");
  if (kind !== "image" && (!Number.isFinite(asset.durationSeconds) || asset.durationSeconds! <= 0)) fail("reference_duration_missing", "참조의 실제 재생 길이를 확인하세요.");
  if (kind === "video" && (!Number.isFinite(asset.fps) || asset.fps! <= 0)) fail("reference_fps_missing", "참조 영상의 실제 프레임률을 확인하세요.");
}
export async function prepareWorkflowAdapterPlanV2(input: { text: string; manifest: ComfyWorkflowManifestV2; environment: WorkflowEnvironment; request: WorkflowBindingRequestV2 }): Promise<WorkflowAdapterPlan> {
  const manifest = workflowManifestV2Schema.parse(input.manifest); const request = input.request;
  if ((manifest.projectId && manifest.projectId !== request.projectId) || (input.environment.projectId && input.environment.projectId !== request.projectId)) fail("authorization_project_mismatch", "프로젝트별 사용 허가는 다른 프로젝트에서 사용할 수 없습니다.");
  if (!request.projectId || !request.prompt.trim() || request.prompt.length > 32000 || (request.negative?.length ?? 0) > 32000) fail("invalid_prompt", "프로젝트와 프롬프트 본문을 확인하세요.");
  if (await workflowSha256(input.text) !== manifest.workflowSha256) fail("workflow_changed", "검사한 뒤 워크플로 파일이 바뀌었습니다.");
  const rebuilt = await buildComfyWorkflowManifestV2({ text: input.text, source: workflowSourceSchema.strip().parse(manifest), selectionEnvelope: manifest.selectionEnvelope, environment: input.environment, checkedAtUtc: manifest.verification.checkedAtUtc });
  assertWorkflowInspection(rebuilt.inspection);
  if (JSON.stringify(rebuilt.manifest) !== JSON.stringify(manifest)) fail("manifest_changed", "manifest 또는 설치 노드·가중치·허가가 바뀌었습니다. 다시 검사하세요.");
  validateWorkflowV2BindingInputs(manifest, input.environment, request);
  const graph = rebuilt.inspection.graph; const assets = { ...request.assets }; const slots = manifest.selection.slots;
  for (const [groupId, items] of Object.entries(request.referenceGroups ?? {})) {
    const group = manifest.selection.referenceGroups.find(g => g.id === groupId);
    if (!group) fail("unknown_reference_group", "등록되지 않은 참조 그룹입니다.");
    if (items.length < group.minItems || items.length > group.maxItems || items.length !== group.slotIds.length) fail("reference_count_mismatch", "참조 개수에 맞는 검토된 변형을 선택하세요. 초과 입력은 생략하지 않습니다.");
    if (group.identity !== "none" && items.some(a => !a.identityId)) fail("reference_identity_required", "인물 참조의 정체성 ID를 명시하세요.");
    if (group.identity === "single" && new Set(items.map(a => a.identityId)).size > 1) fail("reference_identity_mismatch", "한 인물 그룹에 서로 다른 인물이 들어 있습니다.");
    items.forEach((asset, index) => { const id = group.slotIds[index]; if (assets[id]) fail("duplicate_reference", "같은 참조 슬롯에 개별 입력과 그룹 입력이 겹쳤습니다."); assets[id] = asset; });
  }
  for (const id of Object.keys(assets)) if (!slots.some(s => s.id === id && workflowMediaKind(s.semantic))) fail("unused_reference", "워크플로에 연결되지 않은 참조가 있습니다.");
  for (const id of Object.keys(request.values ?? {})) if (!slots.some(s => s.id === id && !workflowMediaKind(s.semantic) && !["positive", "negative"].includes(s.semantic))) fail("unknown_value", "등록되지 않은 값 또는 프롬프트 입력을 덮어쓸 수 없습니다.");
  for (const id of Object.keys(request.rolePrompts ?? {})) if (!manifest.selection.promptRoles.some(r => r.id === id) || id === manifest.promptTarget.roleId) fail("unknown_prompt_role", "등록되지 않은 역할 또는 선택 역할의 중복 프롬프트입니다.");
  const roleValues: Record<string, string> = {};
  for (const role of manifest.selection.promptRoles) {
    const prompt = role.id === manifest.promptTarget.roleId ? { positive: request.prompt, negative: request.negative } : request.rolePrompts?.[role.id];
    if (!prompt?.positive.trim() || prompt.positive.length > 32000) fail("prompt_role_missing", "모든 프롬프트 역할의 본문을 명시하세요.");
    if (prompt.negative && (role.negativeSupport !== "supported" || !role.negativeSlotIds.length)) fail("negative_not_consumed", "이 역할은 부정 프롬프트를 적용하지 않습니다. 묵시적으로 무시하지 않습니다.");
    if ((prompt.negative?.length ?? 0) > 32000) fail("invalid_prompt", "부정 프롬프트가 너무 깁니다.");
    for (const id of role.positiveSlotIds) roleValues[id] = prompt.positive;
    for (const id of role.negativeSlotIds) roleValues[id] = prompt.negative ?? "";
  }
  const selectedRole = manifest.selection.promptRoles.find(r => r.id === manifest.promptTarget.roleId)!;
  const references: WorkflowAdapterPlan["references"] = []; const bindings: WorkflowAdapterPlan["bindings"] = [];
  const mappings: WorkflowAdapterPlan["config"]["mappings"] = []; const scalarValues: Record<string, WorkflowScalar> = {};
  const indices = { image: 0, video: 0, audio: 0 };
  const effectiveInputs = Object.fromEntries(Object.entries(graph).map(([id, node]) => [id, { ...node.inputs }]));
  for (const slot of slots) {
    const mediaKind = workflowMediaKind(slot.semantic);
    if (mediaKind) {
      const asset = assets[slot.id]; if (!asset) fail("required_reference_missing", `필수 참조가 없습니다: ${slot.id}`);
      validateAsset(asset, request.projectId, mediaKind);
      if (slot.semantic.startsWith("mask") && asset.maskConvention !== slot.maskConvention) fail("mask_convention_mismatch", "마스크의 흰색·알파 규약이 다릅니다.");
      references.push({ kind: mediaKind, path: asset.path });
      bindings.push({ nodeId: slot.nodeId, input: slot.input, filePath: asset.path });
      mappings.push({ nodeId: slot.nodeId, input: slot.input, source: "reference", referenceKind: mediaKind, referenceIndex: indices[mediaKind]++ });
      continue;
    }
    const supplied = roleValues[slot.id] ?? request.values?.[slot.id];
    const value = supplied ?? slot.defaultValue ?? (slot.required ? undefined : graph[slot.nodeId].inputs[slot.input]);
    if (value === undefined) fail("required_value_missing", `필수 입력이 없습니다: ${slot.id}`);
    const node = graph[slot.nodeId]; const schema = input.environment.catalog[node.class_type];
    effectiveInputs[slot.nodeId][slot.input] = value;
    if (!validateWorkflowScalar(value, workflowInputSpecs(schema, effectiveInputs[slot.nodeId]).fields[slot.input])) fail("binding_type_mismatch", "입력 자료형·범위·선택값을 확인하세요.");
    const weight = input.environment.reviewedNodes[node.class_type].assets?.[slot.input];
    if (weight && workflowWeightAdmission(input.environment, weight.category, value).license !== "allowed") fail("lora_not_installed_or_licensed", "LoRA는 ComfyUI에 설치되고 허가된 파일명만 사용합니다.");
    scalarValues[slot.id] = value as WorkflowScalar;
    bindings.push({ nodeId: slot.nodeId, input: slot.input, value: value as WorkflowScalar });
    mappings.push({ nodeId: slot.nodeId, input: slot.input,
      source: selectedRole.positiveSlotIds.includes(slot.id) ? "prompt" : selectedRole.negativeSlotIds.includes(slot.id) ? "negative" : "value",
      value: value as WorkflowScalar });
  }
  const first = slots.find(s => ["firstFrame", "sourceImage", "sourceVideo"].includes(s.semantic)); const base = first && assets[first.id];
  const numeric = (semantic: string) => { const slot = slots.find(s => s.semantic === semantic); if (slot) return Number(scalarValues[slot.id]);
    const fields = semantic === "fps" ? ["fps"] : semantic === "frameCount" ? ["length", "num_frames"] : [semantic];
    const values = Object.values(effectiveInputs).flatMap(inputs => fields.filter(f => typeof inputs[f] === "number").map(f => Number(inputs[f])));
    return values.length && values.every(v => v === values[0]) ? values[0] : undefined; };
  const fps = numeric("fps"); const frameCount = numeric("frameCount"); const duration = numeric("durationSeconds") ?? (fps && frameCount ? frameCount / fps : undefined);
  for (const slot of slots.filter(s => workflowMediaKind(s.semantic))) {
    const asset = assets[slot.id];
    if (slot.semantic.startsWith("mask") && (!base || asset.width !== base.width || asset.height !== base.height)) fail("mask_shape_mismatch", "마스크와 원본의 실제 해상도가 같아야 합니다.");
    if (slot.alignment === "exact") {
      if (asset.kind === "video" && (!fps || Math.abs(asset.fps! - fps) > 0.001)) fail("reference_timebase_mismatch", "조건 영상의 프레임률이 출력과 다릅니다.");
      if (asset.kind !== "image" && (!duration || Math.abs(asset.durationSeconds! - duration) > (fps ? 1 / fps : 0.02))) fail("reference_duration_mismatch", "조건 자료의 실제 길이가 출력 시간축과 다릅니다.");
    }
  }
  const runtimeGraph = Object.fromEntries(Object.entries(graph).map(([id, node]) => [id, { ...node, inputs: effectiveInputs[id] }]));
  assertWorkflowInspection(await inspectBoundComfyWorkflowV2({ originalText: input.text, boundText: JSON.stringify(runtimeGraph), environment: input.environment, manifest, runtimeSelection: {
    ...manifest.selection, slots: slots.map(slot => ({ ...slot, defaultValue: scalarValues[slot.id] ?? slot.defaultValue })),
  } }));
  return { config: { workflowPath: manifest.workflowPath, mappings, outputNodeIds: [...manifest.selection.outputNodeIds] }, references, bindings,
    provenance: { workflowSha256: manifest.workflowSha256, manifestSha256: await workflowSha256(JSON.stringify(manifest)), promptTarget: manifest.promptTarget,
      assets: slots.filter(s => workflowMediaKind(s.semantic)).map(s => ({ slotId: s.id, assetId: assets[s.id].assetId, sha256: assets[s.id].sha256 })),
      values: scalarValues, verification: manifest.verification, projectId: manifest.projectId, weightAuthorizations: manifest.weightAuthorizations } };
}

export function identifyWorkflowOutputsV2(manifest: ComfyWorkflowManifestV2, history: unknown, promptId: string) { return identifyV1(toV1OutputManifest(manifest), history, promptId); }
export function validateWorkflowCollectedOutputsV2(manifest: ComfyWorkflowManifestV2, facts: (WorkflowAssetFact & { nodeId: string; audioTracks?: number })[], options: { projectId: string; requireAudioTrack?: boolean }) { return validateCollectedV1(toV1OutputManifest(manifest), facts, options); }
