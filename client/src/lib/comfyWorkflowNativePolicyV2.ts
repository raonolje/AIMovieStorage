import { z } from "zod";
import { isLocalWorkflowPath, isSafeRelativeWorkflowName, workflowSha256 } from "./comfyWorkflowInspection";
import { workflowSelectionSchema } from "./comfyWorkflowContract";
import { workflowSelectionV2Schema, type WorkflowSelectionV2 } from "./comfyWorkflowContractV2";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({ relativePath: z.string().min(1).max(4000), sha256: sha, bytes: z.number().int().positive() }).strict();
const bundle = z.object({ registeredBundleId: z.string().min(1).max(200), role: z.enum(["diffusers-model", "tts-model", "tts-tokenizer"]),
  exactRealPath: z.string().min(1).max(4000), treeSha256: sha, files: z.array(fileSchema).min(1).max(2048) }).strict();
const classes = z.enum(["SDNQSampler", "FB_Qwen3TTSCustomVoice", "FB_Qwen3TTSVoiceDesign", "FB_Qwen3TTSVoiceClone"]);
export const nativeLocalOnlyPolicyV2Schema = z.object({ schemaVersion: z.literal(2), policyVersion: z.literal("native-local-only-v1"),
  policyId: z.string().min(1).max(200), projectId: z.string().min(1).max(200), modelRuleId: z.string().min(1).max(200),
  nodeId: z.string().min(1).max(200), classType: classes, pythonModule: z.string().min(1).max(400), nodeSourceSha256: sha,
  exactPackageVersion: z.string().min(1).max(200), workflowSha256: sha, v1SelectionSha256: sha,
  bundles: z.array(bundle).min(1).max(2),
  requiredEnforcement: z.object({ missingAsset: z.literal("fail-before-model-load"), download: z.literal("forbidden"),
    remoteFallback: z.literal("forbidden"), externalNetwork: z.literal("deny"), arbitraryPaths: z.literal("forbidden"),
    modelDirectoryWrites: z.literal("deny"), trustRemoteCode: z.literal(false), loras: z.literal("disabled"), credentials: z.literal("preserve-no-export"), nativeGuardSha256: sha }).strict(),
}).strict();
export type NativeLocalOnlyPolicyV2 = z.infer<typeof nativeLocalOnlyPolicyV2Schema>;
// Native IPC must create these facts from its own project policy/model registry and enforced controller process.
// Uploaded graph, user JSON, disk file presence, cache inspection and UI booleans must never populate this parameter.
export const nativeLocalOnlyFactsV2Schema = z.object({ source: z.literal("trusted-native-controller-ipc"), projectId: z.string().min(1),
  policyId: z.string().min(1), policySha256: sha, workflowSha256: sha, v1SelectionSha256: sha, bindingSha256: sha, requestNonce: z.string().min(16).max(200),
  checkedAtUtc: z.string().datetime(), authority: z.literal("controller-owned-enforced-process"),
  guard: z.object({ version: z.literal("native-local-only-v1"), reviewedBinarySha256: sha,
    outboundNetwork: z.literal("denied"), missingAsset: z.literal("fail-before-model-load"), remoteFallback: z.literal("denied"),
    directoryWrites: z.literal("denied"), arbitraryPaths: z.literal("denied"), trustRemoteCode: z.literal(false),
    openHandlesPinnedUntilSubmit: z.literal(true), fileIdentityRecheck: z.literal("before-submit"), credentialsExported: z.literal(false) }).strict(),
  node: z.object({ classType: classes, pythonModule: z.string(), sourceSha256: sha, packageVersion: z.string(),
    loadedSourceAttested: z.literal(true) }).strict(),
  bundles: z.array(bundle.extend({ projectId: z.string(), licensing: z.object({ state: z.literal("allowed"),
    provenance: z.enum(["exact-public-license-review", "exact-project-user-reported-authorization"]), recordId: z.string().min(1),
    scopeTreeSha256: sha }).strict() }).strict()).min(1).max(2),
}).strict();
export type NativeLocalOnlyFactsV2 = z.infer<typeof nativeLocalOnlyFactsV2Schema>;
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
export async function nativeLocalPolicySha256(policy: NativeLocalOnlyPolicyV2): Promise<string> { return workflowSha256(JSON.stringify(stable(nativeLocalOnlyPolicyV2Schema.parse(policy)))); }
export async function localModelTreeSha256(files: NativeLocalOnlyPolicyV2["bundles"][number]["files"]): Promise<string> {
  return workflowSha256(JSON.stringify(files.slice().sort((a, b) => a.relativePath.localeCompare(b.relativePath)).map(f => ({ relativePath: f.relativePath, sha256: f.sha256, bytes: f.bytes }))));
}
export async function inspectNativeLocalOnlyPolicyV2(input: { policy: unknown; text: string; selectionEnvelope: WorkflowSelectionV2;
  nativeFacts?: unknown; requestNonce: string; inputBindingSha256: string; nowUtc: string }): Promise<{ policySatisfied: boolean; executionAdmission: false; issues: string[] }> {
  const issues: string[] = [], parsed = nativeLocalOnlyPolicyV2Schema.safeParse(input.policy);
  if (!parsed.success) return { policySatisfied: false, executionAdmission: false, issues: ["native_policy_invalid"] };
  const policy = parsed.data, envelope = workflowSelectionV2Schema.parse(input.selectionEnvelope);
  try { if (await workflowSha256(envelope.originalV1SelectionJson) !== envelope.originalV1SelectionSha256
    || envelope.migration.legacySelectionSha256 !== envelope.originalV1SelectionSha256
    || JSON.stringify(stable(workflowSelectionSchema.parse(JSON.parse(envelope.originalV1SelectionJson)))) !== JSON.stringify(stable(envelope.base))) issues.push("native_selection_envelope_mismatch"); }
  catch { issues.push("native_selection_envelope_mismatch"); }
  if (!/^[a-f0-9]{64}$/.test(input.inputBindingSha256)) issues.push("native_binding_hash_required");
  if (await workflowSha256(input.text) !== policy.workflowSha256 || envelope.originalV1SelectionSha256 !== policy.v1SelectionSha256) issues.push("native_policy_workflow_selection_mismatch");
  if (envelope.base.promptRoles.find(r => r.id === envelope.base.selectedPromptRoleId)?.modelRuleId !== policy.modelRuleId) issues.push("native_policy_model_role_mismatch");
  let graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>; try { graph = JSON.parse(input.text); } catch { return { policySatisfied: false, executionAdmission: false, issues: ["invalid_json"] }; }
  const node = graph[policy.nodeId]; if (!node || node.class_type !== policy.classType) issues.push("native_policy_node_mismatch");
  for (const b of policy.bundles) {
    if (!isLocalWorkflowPath(b.exactRealPath) || /[%{}]/.test(b.exactRealPath)) issues.push("native_policy_unsafe_directory");
    if (new Set(b.files.map(f => f.relativePath.toLowerCase())).size !== b.files.length) issues.push("native_policy_duplicate_file");
    for (const f of b.files) if (!isSafeRelativeWorkflowName(f.relativePath) || !/\.(?:safetensors|json|txt|model)$/i.test(f.relativePath)
      || /(?:^|\/)(?:\.env|\.git|\.hf_token|token|credentials)(?:$|\/|\.)/i.test(f.relativePath)) issues.push("native_policy_unsafe_model_file");
    if (await localModelTreeSha256(b.files) !== b.treeSha256) issues.push("native_policy_tree_mismatch");
  }
  if (policy.classType === "SDNQSampler") {
    const models = policy.bundles.filter(b => b.role === "diffusers-model"), values = node?.inputs ?? {};
    if (models.length !== 1 || policy.bundles.length !== 1 || values.model_selection !== "[Custom Path]" || values.custom_model_path !== models[0]?.exactRealPath
      || values.auto_download !== false || values.num_frames !== 1 || values.use_quantized_matmul !== false || values.use_xformers !== false) issues.push("native_sdnq_fixed_local_inputs_required");
    for (let i = 1; i <= 5; i++) { const prefix = i === 1 ? "lora" : "lora" + i;
      if (values[prefix + "_selection"] !== "[None]" || values[prefix + "_custom_path"] !== "" || values[prefix + "_strength"] !== 0) issues.push("native_sdnq_loras_not_disabled"); }
  } else {
    const required = policy.classType === "FB_Qwen3TTSCustomVoice" ? "Qwen3-TTS-12Hz-1.7B-CustomVoice" : policy.classType === "FB_Qwen3TTSVoiceDesign" ? "Qwen3-TTS-12Hz-1.7B-VoiceDesign" : "Qwen3-TTS-12Hz-1.7B-Base";
    const models = policy.bundles.filter(b => b.role === "tts-model"), tokenizers = policy.bundles.filter(b => b.role === "tts-tokenizer");
    if (node?.inputs.model_choice !== "1.7B" || models.length !== 1 || tokenizers.length !== 1 || policy.bundles.length !== 2
      || models[0]?.exactRealPath.replace(/\\/g, "/").split("/").pop() !== required
      || tokenizers[0]?.exactRealPath.replace(/\\/g, "/").split("/").pop() !== "Qwen3-TTS-Tokenizer-12Hz") issues.push("native_tts_exact_model_tokenizer_required");
  }
  const facts = nativeLocalOnlyFactsV2Schema.safeParse(input.nativeFacts);
  if (!facts.success) issues.push("native_enforcement_evidence_missing");
  else { const proof = facts.data;
    if (proof.policySha256 !== await nativeLocalPolicySha256(policy) || proof.policyId !== policy.policyId || proof.projectId !== policy.projectId
      || proof.workflowSha256 !== policy.workflowSha256 || proof.v1SelectionSha256 !== policy.v1SelectionSha256 || proof.bindingSha256 !== input.inputBindingSha256 || proof.requestNonce !== input.requestNonce) issues.push("native_enforcement_receipt_mismatch");
    const age = Date.parse(input.nowUtc) - Date.parse(proof.checkedAtUtc); if (!Number.isFinite(age) || age < 0 || age > 30000) issues.push("native_enforcement_receipt_stale");
    if (proof.guard.reviewedBinarySha256 !== policy.requiredEnforcement.nativeGuardSha256) issues.push("native_guard_source_mismatch");
    if (proof.node.classType !== policy.classType || proof.node.pythonModule !== policy.pythonModule || proof.node.sourceSha256 !== policy.nodeSourceSha256 || proof.node.packageVersion !== policy.exactPackageVersion) issues.push("native_node_source_version_mismatch");
    if (proof.bundles.length !== policy.bundles.length) issues.push("native_model_bundle_count_mismatch");
    for (const b of policy.bundles) { const actual = proof.bundles.find(f => f.registeredBundleId === b.registeredBundleId);
      if (!actual || actual.projectId !== policy.projectId || actual.role !== b.role || actual.exactRealPath !== b.exactRealPath || actual.treeSha256 !== b.treeSha256
        || JSON.stringify(stable(actual.files)) !== JSON.stringify(stable(b.files)) || actual.licensing.scopeTreeSha256 !== b.treeSha256) issues.push("native_model_bundle_or_license_mismatch"); }
  }
  return { policySatisfied: issues.length === 0, executionAdmission: false, issues };
}
