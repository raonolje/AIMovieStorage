import { workflowManifestSchema, workflowSelectionSchema, workflowSourceSchema,
  type ComfyWorkflowManifest, type WorkflowAssetFact, type WorkflowBindingRequest, type WorkflowEnvironment,
  type WorkflowGraph, type WorkflowInspection, type WorkflowSelection, type WorkflowSource } from "./comfyWorkflowContract";
import { buildComfyWorkflowManifest, inspectComfyWorkflow, isLocalWorkflowPath, isWorkflowLink, workflowNodeSchemaSha256, workflowSha256 } from "./comfyWorkflowInspection";
import { inspectComfyWorkflowV2Core } from "./comfyWorkflowV2Core";
import { workflowManifestV2Schema, workflowSelectionV2Schema, WORKFLOW_V2_POLICY_VERSION,
  type ComfyWorkflowManifestV2, type WorkflowSelectionV2, type WorkflowExtensionV2, type WorkflowAssetFactV2 } from "./comfyWorkflowContractV2";
import { V2_REVIEWED_VARIANTS, V2_SCHEMA_SOURCE_PINS } from "./comfyWorkflowV2ReviewedVariants";

const fail = (code: string): never => { throw new Error(code); };
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
export async function migrateWorkflowSelectionV1ToV2(selection: WorkflowSelection, options: { originalV1SelectionJson?: string; expectedLegacySha256?: string; reviewedVariantId?: string } = {}): Promise<WorkflowSelectionV2> {
  const originalV1SelectionJson = options.originalV1SelectionJson ?? JSON.stringify(selection);
  const base = workflowSelectionSchema.parse(selection), legacy = workflowSelectionSchema.parse(JSON.parse(originalV1SelectionJson));
  if (!same(base, legacy)) fail("v2_migration_selection_mismatch");
  const originalV1SelectionSha256 = await workflowSha256(originalV1SelectionJson);
  if (options.expectedLegacySha256 && options.expectedLegacySha256 !== originalV1SelectionSha256) fail("v2_legacy_selection_hash_mismatch");
  const reviewed = options.reviewedVariantId ? V2_REVIEWED_VARIANTS.find(r => r.id === options.reviewedVariantId) : undefined;
  if (options.reviewedVariantId && !reviewed) fail("v2_variant_not_reviewed");
  if (reviewed && await workflowSha256(JSON.stringify(stable(base))) !== reviewed.selectionMaterialSha256) fail("v2_variant_selection_mismatch");
  return workflowSelectionV2Schema.parse({ schemaVersion: 2, base, originalV1SelectionJson, originalV1SelectionSha256,
    migration: { fromSchemaVersion: 1, serializer: "exact-json-text-sha256", legacySelectionSha256: originalV1SelectionSha256 },
    ...(reviewed ? { reviewedVariantId: reviewed.id } : {}), extensions: reviewed ? reviewed.extensions : [] });
}
async function validateEnvelope(raw: WorkflowSelectionV2) {
  const envelope = workflowSelectionV2Schema.parse(raw);
  if (await workflowSha256(envelope.originalV1SelectionJson) !== envelope.originalV1SelectionSha256
    || envelope.migration.legacySelectionSha256 !== envelope.originalV1SelectionSha256
    || !same(workflowSelectionSchema.parse(JSON.parse(envelope.originalV1SelectionJson)), envelope.base)) fail("v2_selection_envelope_changed");
  return envelope;
}
function traceReference(graph: WorkflowGraph, slot: WorkflowSelection["slots"][number], component: WorkflowExtensionV2 & { kind: "autogrow" }, value: unknown, index: number): boolean {
  const direct = isWorkflowLink(value) && value[0] === slot.nodeId && value[1] === 0;
  if (component.component === "image") return direct && slot.semantic === "identityImage" && graph[slot.nodeId]?.class_type === "LoadImage" && slot.input === "image";
  if (component.component === "audio-reference") return direct && slot.semantic === "audio" && graph[slot.nodeId]?.class_type === "LoadAudio" && slot.input === "audio";
  if (!isWorkflowLink(value) || value[1] !== (component.component === "video-frames" ? 0 : 1)) return false;
  const components = graph[value[0]];
  return slot.semantic === "sourceVideo" && slot.input === "file" && graph[slot.nodeId]?.class_type === "LoadVideo"
    && components?.class_type === "GetVideoComponents" && same(components.inputs.video, [slot.nodeId, 0]) && index >= 0;
}
async function context(text: string, environment: WorkflowEnvironment, raw: WorkflowSelectionV2, kind: "image" | "video" | "audio") {
  const envelope = await validateEnvelope(raw), legacy = inspectComfyWorkflow(text, environment, envelope.base, kind);
  if (!legacy.graph) return { envelope, legacy, referenceAudio: new Set<string>(), extensionIssues: [] as WorkflowInspection["issues"] };
  const extensionIssues: WorkflowInspection["issues"] = [], referenceAudio = new Set<string>();
  const issue = (code: string, nodeId?: string, input?: string) => extensionIssues.push({ code, message: code, nodeId, input });
  if (!envelope.extensions.length) { if (envelope.reviewedVariantId) issue("v2_empty_variant_extensions"); return { envelope, legacy, referenceAudio, extensionIssues }; }
  const variant = V2_REVIEWED_VARIANTS.find(r => r.id === envelope.reviewedVariantId);
  if (!variant || await workflowSha256(text) !== variant.workflowSha256 || await workflowSha256(JSON.stringify(stable(envelope.base))) !== variant.selectionMaterialSha256
    || !same(envelope.extensions, variant.extensions) || envelope.base.promptRoles.length !== 1 || envelope.base.promptRoles[0].modelRuleId !== variant.modelRuleId) issue("v2_exact_variant_mismatch");
  const covered = new Set<string>();
  for (const ext of envelope.extensions) {
    const node = legacy.graph[ext.nodeId], schema = node && environment.catalog[node.class_type], review = node && environment.reviewedNodes[node.class_type];
    const pin = node && V2_SCHEMA_SOURCE_PINS[node.class_type as keyof typeof V2_SCHEMA_SOURCE_PINS];
    if (!pin || !schema || !review || environment.comfyVersion !== pin.comfyVersion || schema.python_module !== pin.pythonModule
      || review.pythonModule !== pin.pythonModule || review.sourceSha256 !== pin.sourceSha256 || environment.nodeSourceHashes[pin.pythonModule] !== pin.sourceSha256
      || await workflowNodeSchemaSha256(schema, review) !== pin.schemaSha256) { issue("v2_extension_source_schema_mismatch", ext.nodeId); continue; }
    if (ext.kind === "numeric-union") {
      if (node.class_type !== "LTXVEmptyLatentAudio" || schema.input.required?.[ext.input]?.[0] !== "FLOAT,INT") issue("v2_numeric_union_not_reviewed", ext.nodeId, ext.input);
      covered.add(ext.nodeId + "." + ext.input); continue;
    }
    if (node.class_type !== "MiniMaxH3ReferenceToVideo") { issue("v2_autogrow_class_forbidden", ext.nodeId); continue; }
    const spec = schema.input.optional?.[ext.inputGroup], template = (spec?.[1] as { template?: { prefix?: string; min?: number; max?: number } })?.template;
    const group = envelope.base.referenceGroups.find(g => g.id === ext.referenceGroupId);
    if (spec?.[0] !== "COMFY_AUTOGROW_V3" || !template || !group || group.strategy !== "fixed-slots" || group.order !== "explicit"
      || group.minItems !== ext.count || group.maxItems !== ext.count || group.slotIds.length !== ext.count || ext.count > template.max! || template.min !== 0) { issue("v2_reference_variant_mismatch", ext.nodeId, ext.inputGroup); continue; }
    const expected = Array.from({ length: ext.count }, (_, i) => ext.inputGroup + "." + template.prefix + i);
    const actual = Object.keys(node.inputs).filter(k => k === ext.inputGroup || k.startsWith(ext.inputGroup + "."));
    if (!same(actual.slice().sort(), expected.slice().sort())) issue("v2_autogrow_count_or_namespace", ext.nodeId, ext.inputGroup);
    group.slotIds.forEach((id, i) => { const slot = envelope.base.slots.find(s => s.id === id);
      if (!slot || !traceReference(legacy.graph!, slot, ext, node.inputs[expected[i]], i)) issue("v2_reference_role_or_order", ext.nodeId, expected[i]);
      if (slot && ext.component === "audio-reference") referenceAudio.add(slot.id);
    });
    expected.forEach(k => covered.add(ext.nodeId + "." + k));
  }
  for (const [id, node] of Object.entries(legacy.graph)) for (const [key] of Object.entries(node.inputs)) {
    if ((key.startsWith("ref_") && key.includes(".") || environment.catalog[node.class_type]?.input.required?.[key]?.[0] === "FLOAT,INT") && !covered.has(id + "." + key)) issue("v2_extension_not_declared", id, key);
  }
  return { envelope, legacy, referenceAudio, extensionIssues };
}
export async function inspectComfyWorkflowV2(input: { text: string; environment: WorkflowEnvironment; selectionEnvelope: WorkflowSelectionV2; outputKind?: "image" | "video" | "audio" }): Promise<WorkflowInspection> {
  const kind = input.outputKind ?? "video", ctx = await context(input.text, input.environment, input.selectionEnvelope, kind);
  if (!ctx.envelope.extensions.length || !ctx.legacy.graph || ctx.extensionIssues.length) return { ...ctx.legacy, issues: [...ctx.legacy.issues, ...ctx.extensionIssues] };
  return inspectComfyWorkflowV2Core(input.text, input.environment, ctx.envelope.base, kind, ctx.referenceAudio);
}
export async function buildComfyWorkflowManifestV2(input: { text: string; source: WorkflowSource; selectionEnvelope: WorkflowSelectionV2; environment: WorkflowEnvironment; checkedAtUtc: string }): Promise<{ inspection: WorkflowInspection; manifest?: ComfyWorkflowManifestV2 }> {
  const source = workflowSourceSchema.parse(input.source), envelope = await validateEnvelope(input.selectionEnvelope);
  const inspection = await inspectComfyWorkflowV2({ ...input, outputKind: source.outputKind });
  if (inspection.issues.length || !inspection.graph) return { inspection };
  // Use V1 construction only when no schema extension is requested. Original V1 behavior remains unchanged.
  let legacy: ComfyWorkflowManifest | undefined;
  if (!envelope.extensions.length) legacy = (await buildComfyWorkflowManifest({ ...input, selection: envelope.base })).manifest;
  const requirements = await Promise.all(inspection.requiredNodes.map(async n => ({ nodeId: n.nodeId, classType: n.classType, pythonModule: n.pythonModule!, reviewId: n.reviewId!, sourceSha256: input.environment.reviewedNodes[n.classType].sourceSha256,
    schemaSha256: await workflowNodeSchemaSha256(input.environment.catalog[n.classType], input.environment.reviewedNodes[n.classType]) })));
  if (!legacy) {
    // Keep exact graph/selection and real raw-schema fingerprints. No fabricated/flattened environment catalog.
    if (!isLocalWorkflowPath(source.workflowPath) || !/\.json$/i.test(source.workflowPath)) return { inspection: { ...inspection, issues: [{ code: "local_workflow_reference_required", message: "local_workflow_reference_required" }] } };
    const workflowSha = await workflowSha256(input.text), role = envelope.base.promptRoles.find(r => r.id === envelope.base.selectedPromptRoleId)!;
    const weightAuthorizations = inspection.requiredWeights.flatMap(w => w.authorization ? [w.authorization] : []).filter((a, i, all) => all.findIndex(b => b.category === a.category && b.name === a.name && b.sha256 === a.sha256) === i);
    legacy = workflowManifestSchema.parse({ ...source, schemaVersion: 1, workflowSha256: workflowSha, format: "api", selection: envelope.base,
      ...(input.environment.projectId ? { projectId: input.environment.projectId } : {}), weightAuthorizations,
      promptTarget: { kind: "workflow", workflowId: source.workflowId, workflowSha256: workflowSha, roleId: role.id, modelRuleId: role.modelRuleId },
      environment: { comfyVersion: input.environment.comfyVersion, reviewVersion: input.environment.reviewVersion, coreCommit: input.environment.coreCommit, pythonVersion: input.environment.pythonVersion, torchVersion: input.environment.torchVersion, customNodeVersions: input.environment.customNodeVersions },
      nodeRequirements: requirements, weightRequirements: inspection.requiredWeights.map(w => ({ nodeId: w.nodeId, input: w.input, category: w.category, kind: w.kind, name: w.name, license: w.license, publicLicense: w.publicLicense, authorization: w.authorization, sha256: w.sha256 })),
      verification: { static: "passed", installedRequirements: "passed", actualGenerationRegistration: "not-run", executionAdmission: "required", checkedAtUtc: input.checkedAtUtc } });
  }
  const manifest = workflowManifestV2Schema.parse({ ...legacy, schemaVersion: 2, policyVersion: WORKFLOW_V2_POLICY_VERSION, selectionEnvelope: envelope,
    rawNodeRequirements: requirements, extensionsSha256: await workflowSha256(JSON.stringify(stable(envelope.extensions))) });
  return { inspection, manifest };
}
export function toV1OutputManifest(raw: ComfyWorkflowManifestV2): ComfyWorkflowManifest {
  const m = workflowManifestV2Schema.parse(raw), { policyVersion, selectionEnvelope, rawNodeRequirements, extensionsSha256, ...base } = m;
  return workflowManifestSchema.parse({ ...base, schemaVersion: 1 });
}
export async function inspectBoundComfyWorkflowV2(input: { originalText: string; boundText: string; environment: WorkflowEnvironment; manifest: ComfyWorkflowManifestV2; runtimeSelection: WorkflowSelection }): Promise<WorkflowInspection> {
  const manifest = workflowManifestV2Schema.parse(input.manifest), ctx = await context(input.originalText, input.environment, manifest.selectionEnvelope, manifest.outputKind);
  if (ctx.extensionIssues.length || !ctx.legacy.graph) return { ...ctx.legacy, issues: [...ctx.legacy.issues, ...ctx.extensionIssues] };
  const bound = JSON.parse(input.boundText) as WorkflowGraph, slots = manifest.selection.slots, mutable = new Set(slots.map(s => s.nodeId + "." + s.input));
  if (!same(Object.keys(bound).sort(), Object.keys(ctx.legacy.graph).sort())) fail("v2_bound_graph_nodes_changed");
  for (const [id, node] of Object.entries(ctx.legacy.graph)) { const next = bound[id];
    if (!next || next.class_type !== node.class_type || !same(Object.keys(next.inputs).sort(), Object.keys(node.inputs).sort()) || !same(next._meta, node._meta)) fail("v2_bound_graph_structure_changed");
    for (const [key, value] of Object.entries(node.inputs)) if ((!mutable.has(id + "." + key) || isWorkflowLink(value)) && !same(value, next.inputs[key])) fail("v2_fixed_input_changed");
  }
  const removeDefaults = (s: WorkflowSelection) => ({ ...s, slots: s.slots.map(({ defaultValue, ...rest }) => rest) });
  if (!same(removeDefaults(input.runtimeSelection), removeDefaults(manifest.selection))) fail("v2_bound_selection_changed");
  return ctx.envelope.extensions.length ? inspectComfyWorkflowV2Core(input.boundText, input.environment, input.runtimeSelection, manifest.outputKind, ctx.referenceAudio)
    : inspectComfyWorkflow(input.boundText, input.environment, input.runtimeSelection, manifest.outputKind);
}
export function validateWorkflowV2BindingInputs(manifest: ComfyWorkflowManifestV2, environment: WorkflowEnvironment, request: WorkflowBindingRequest): void {
  const variant = V2_REVIEWED_VARIANTS.find(r => r.id === manifest.selectionEnvelope.reviewedVariantId); if (!variant) return;
  const contract = variant.inputContract as { fps?: number; frames?: { min: number; max: number; gridBase: number; gridStep: number }; canvas?: { width?: number; height?: number; multiple: number }; sameValues?: readonly (readonly string[])[]; referenceVideo?: { fps: number; minFrames: number; maxFrames: number; gridBase: number; gridStep: number; requiresAudioTrack: boolean } | null };
  const values = Object.fromEntries(manifest.selection.slots.filter(s => !["positive", "negative"].includes(s.semantic)).map(s => [s.id, request.values?.[s.id] ?? s.defaultValue]));
  for (const ids of contract.sameValues ?? []) if (new Set(ids.map(id => values[id])).size !== 1) fail("v2_coupled_temporal_values");
  for (const slot of manifest.selection.slots) { const value = Number(values[slot.id]);
    if (slot.semantic === "fps" && contract.fps && value !== contract.fps) fail("v2_fixed_fps");
    if (slot.semantic === "frameCount" && contract.frames) { const c = contract.frames; if (!Number.isSafeInteger(value) || value < c.min || value > c.max || (value - c.gridBase) % c.gridStep) fail("v2_frame_grid"); }
    if (["width", "height"].includes(slot.semantic) && contract.canvas) { const fixed = slot.semantic === "width" ? contract.canvas.width : contract.canvas.height; if (!Number.isSafeInteger(value) || value <= 0 || value % contract.canvas.multiple || fixed && fixed !== value) fail("v2_canvas_grid"); }
  }
  for (const group of manifest.selection.referenceGroups) { const items = request.referenceGroups?.[group.id] ?? group.slotIds.map(id => request.assets?.[id]).filter((a): a is WorkflowAssetFact => !!a);
    if (items.length !== group.maxItems || new Set(items.map(a => a.assetId)).size !== items.length) fail("v2_reference_count_or_replication");
    if (group.mediaKind === "video" && contract.referenceVideo) for (const asset of items) { const c = contract.referenceVideo, frames = (asset as WorkflowAssetFactV2).frameCount!;
      if (asset.fps !== c.fps || !Number.isSafeInteger(frames) || frames < c.minFrames || frames > c.maxFrames || (frames - c.gridBase) % c.gridStep
        || !Number.isFinite(asset.durationSeconds) || Math.abs(asset.durationSeconds! - frames / c.fps) > 1 / c.fps) fail("v2_reference_video_grid");
      if (c.requiresAudioTrack && (!Number.isSafeInteger((asset as WorkflowAssetFactV2).audioTracks) || (asset as WorkflowAssetFactV2).audioTracks! < 1)) fail("v2_reference_video_audio_missing");
    }
    if (variant.id.startsWith("ltx25") && ["firstFrame", "endFrame"].includes(group.role)) for (const asset of items) {
      if (asset.width! * Number(values.height) !== asset.height! * Number(values.width)) fail("v2_keyframe_aspect_requires_registered_preprocessing");
    }
  }
  // Exact raw fingerprints are rebuilt by prepare/build; no disk commit promotion or new license grant is performed here.
  if (environment.projectId && environment.projectId !== request.projectId) fail("authorization_project_mismatch");
}
