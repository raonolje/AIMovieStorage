import { z } from "zod";

export const workflowScalarSchema = z.union([z.string().max(32000), z.number().finite(), z.boolean()]);
export type WorkflowScalar = z.infer<typeof workflowScalarSchema>;
const fieldSchema = z.object({ nodeId: z.string().min(1).max(200), input: z.string().min(1).max(200) }).strict();
export type WorkflowField = z.infer<typeof fieldSchema>;
export const workflowSemanticSchema = z.enum(["positive", "negative", "firstFrame", "endFrame", "identityImage", "sourceImage", "sourceVideo", "maskImage", "maskVideo", "poseImage", "poseVideo", "depthImage", "depthVideo", "cameraGuide", "audio", "voiceReference", "text", "language", "voiceProfile", "seed", "width", "height", "fps", "frameCount", "loraName", "loraModelStrength", "loraClipStrength", "lyrics", "musicStyle", "durationSeconds", "value"]);
export type WorkflowSemantic = z.infer<typeof workflowSemanticSchema>;
export const workflowSlotSchema = fieldSchema.extend({
  id: z.string().min(1).max(200), semantic: workflowSemanticSchema, required: z.boolean(),
  defaultValue: workflowScalarSchema.optional(),
  maskConvention: z.enum(["white-edit", "alpha-inverted"]).optional(),
  alignment: z.enum(["exact", "resample-in-workflow"]).optional(),
}).strict();
export type WorkflowSlot = z.infer<typeof workflowSlotSchema>;
export const workflowPromptRoleSchema = z.object({
  id: z.string().min(1).max(200), modelRuleId: z.string().min(1).max(200),
  loaderNodeIds: z.array(z.string().min(1).max(200)).min(1).max(64),
  positiveSlotIds: z.array(z.string().min(1).max(200)).min(1).max(64),
  negativeSlotIds: z.array(z.string().min(1).max(200)).max(64),
  negativeSupport: z.enum(["supported", "ignored", "unsupported"]),
}).strict();
export type WorkflowPromptRole = z.infer<typeof workflowPromptRoleSchema>;
export const workflowReferenceGroupSchema = z.object({
  id: z.string().min(1).max(200), role: workflowSemanticSchema,
  mediaKind: z.enum(["image", "video", "audio"]),
  minItems: z.number().int().min(0).max(64), maxItems: z.number().int().min(0).max(64),
  slotIds: z.array(z.string().min(1).max(200)).max(64),
  strategy: z.enum(["fixed-slots", "list-input"]), order: z.literal("explicit"),
  identity: z.enum(["none", "single", "multiple"]),
}).strict();
export type WorkflowReferenceGroup = z.infer<typeof workflowReferenceGroupSchema>;
export const workflowSelectionSchema = z.object({
  slots: z.array(workflowSlotSchema).min(1).max(256),
  promptRoles: z.array(workflowPromptRoleSchema).min(1).max(32),
  selectedPromptRoleId: z.string().min(1).max(200),
  outputNodeIds: z.array(z.string().min(1).max(200)).min(1).max(64),
  referenceGroups: z.array(workflowReferenceGroupSchema).max(64).default([]),
}).strict();
export type WorkflowSelection = z.infer<typeof workflowSelectionSchema>;
export const workflowSourceSchema = z.object({
  workflowId: z.string().min(1).max(200), workflowPath: z.string().min(1).max(4000),
  title: z.string().min(1).max(200), sourceVersion: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(2000).optional(), presetId: z.string().min(1).max(200).optional(),
  modelIds: z.array(z.string().min(1).max(200)).max(64),
  outputKind: z.enum(["image", "video", "audio"]).default("video"),
  operation: z.enum(["text-to-image", "image-edit", "text-to-video", "image-to-video", "first-last-frame", "identity-reference", "face-replace", "character-replace", "motion-control", "inpaint", "audio-to-video", "music-generation", "tts", "composite"]),
  promptProfile: z.string().min(1).max(200), limitations: z.array(z.string().max(2000)).max(64),
  evidence: z.array(z.object({ title: z.string().min(1).max(200), url: z.string().url().max(2000), version: z.string().max(200) }).strict()).max(32),
}).strict();
export type WorkflowSource = z.infer<typeof workflowSourceSchema>;
export type WorkflowMediaKind = "image" | "video" | "audio";
export interface WorkflowNodeSchema {
  input: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]>; hidden?: Record<string, unknown> };
  output: string[]; python_module: string; output_node?: boolean; api_node?: boolean;
  input_order?: Record<string, string[]>; input_is_list?: boolean; is_input_list?: boolean;
  output_name?: string[]; output_is_list?: boolean[]; output_matchtypes?: unknown;
}
export type WorkflowNodeCatalog = Record<string, WorkflowNodeSchema>;
export interface WorkflowNodeReview {
  pythonModule: string; reviewId: string;
  sourceSha256: string;
  assets?: Record<string, { category: string; kind: "model" | "lora"; promptModel?: boolean }>;
  uploads?: Record<string, WorkflowMediaKind>;
  outputKind?: WorkflowMediaKind;
}
export const workflowWeightAuthorizationSchema = z.object({
  kind: z.literal("user-reported"), projectId: z.string().min(1).max(200),
  modelRuleId: z.string().min(1).max(200), category: z.string().min(1).max(200),
  name: z.string().min(1).max(4000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: z.string().min(1).max(4000), sourceThreadId: z.string().min(1).max(200),
  reportedAtUtc: z.string().datetime(),
}).strict();
export type WorkflowWeightAuthorization = z.infer<typeof workflowWeightAuthorizationSchema>;
export interface WorkflowEnvironment {
  comfyVersion: string; reviewVersion: string; catalog: WorkflowNodeCatalog;
  coreCommit: string; pythonVersion: string; torchVersion: string;
  customNodeVersions: Record<string, string>; nodeSourceHashes: Record<string, string>;
  reviewedNodes: Record<string, WorkflowNodeReview>;
  weights: { category: string; name: string; license: "allowed" | "blocked" | "unknown"; sha256?: string }[];
  projectId?: string; weightAuthorizations?: WorkflowWeightAuthorization[];
}
export interface WorkflowIssue { code: string; message: string; nodeId?: string; input?: string }
export type WorkflowGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;
export interface WorkflowInspection {
  format: "api" | "ui" | "invalid"; graph?: WorkflowGraph; issues: WorkflowIssue[];
  requiredNodes: { nodeId: string; classType: string; installed: boolean; reviewed: boolean; pythonModule?: string; reviewId?: string }[];
  requiredWeights: { nodeId: string; input: string; category: string; kind: "model" | "lora"; name: string; installed: boolean; license: "allowed" | "blocked" | "unknown"; publicLicense: "allowed" | "blocked" | "unknown"; authorization?: WorkflowWeightAuthorization; sha256?: string }[];
}
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const workflowManifestSchema = workflowSourceSchema.extend({
  schemaVersion: z.literal(1), workflowSha256: shaSchema, format: z.literal("api"),
  projectId: z.string().min(1).max(200).optional(),
  weightAuthorizations: z.array(workflowWeightAuthorizationSchema).max(256).default([]),
  selection: workflowSelectionSchema,
  promptTarget: z.object({ kind: z.literal("workflow"), workflowId: z.string(), workflowSha256: shaSchema, roleId: z.string(), modelRuleId: z.string() }).strict(),
  environment: z.object({ comfyVersion: z.string().min(1), reviewVersion: z.string().min(1), coreCommit: z.string().regex(/^[a-f0-9]{40}$/), pythonVersion: z.string().min(1), torchVersion: z.string().min(1), customNodeVersions: z.record(z.string(), z.string().min(1)) }).strict(),
  nodeRequirements: z.array(z.object({ nodeId: z.string(), classType: z.string(), pythonModule: z.string(), reviewId: z.string(), sourceSha256: shaSchema, schemaSha256: shaSchema }).strict()),
  weightRequirements: z.array(z.object({ nodeId: z.string(), input: z.string(), category: z.string(), kind: z.enum(["model", "lora"]), name: z.string(), license: z.literal("allowed"), publicLicense: z.enum(["allowed", "blocked", "unknown"]), authorization: workflowWeightAuthorizationSchema.optional(), sha256: shaSchema.optional() }).strict()),
  verification: z.object({ static: z.literal("passed"), installedRequirements: z.literal("passed"), actualGenerationRegistration: z.literal("not-run"), executionAdmission: z.literal("required"), checkedAtUtc: z.string().datetime() }).strict(),
}).strict();
export type ComfyWorkflowManifest = z.infer<typeof workflowManifestSchema>;
export interface WorkflowAssetFact {
  assetId: string; projectId: string; kind: WorkflowMediaKind; path: string; sha256: string;
  bytes: number; decodable: boolean; width?: number; height?: number; fps?: number; durationSeconds?: number;
  maskConvention?: "white-edit" | "alpha-inverted";
  identityId?: string;
}
export interface WorkflowBindingRequest {
  projectId: string; prompt: string; negative?: string;
  rolePrompts?: Record<string, { positive: string; negative?: string }>;
  assets?: Record<string, WorkflowAssetFact>; values?: Record<string, WorkflowScalar>;
  referenceGroups?: Record<string, WorkflowAssetFact[]>;
}
export interface WorkflowAdapterPlan {
  config: { workflowPath: string; mappings: { nodeId: string; input: string; source: "prompt" | "negative" | "reference" | "value"; referenceKind?: WorkflowMediaKind; referenceIndex?: number; value?: WorkflowScalar }[]; outputNodeIds: string[] };
  references: { kind: WorkflowMediaKind; path: string }[];
  bindings: { nodeId: string; input: string; value?: WorkflowScalar; filePath?: string }[];
  provenance: { workflowSha256: string; manifestSha256: string; promptTarget: ComfyWorkflowManifest["promptTarget"]; assets: { slotId: string; assetId: string; sha256: string }[]; values: Record<string, WorkflowScalar>; verification: ComfyWorkflowManifest["verification"]; projectId?: string; weightAuthorizations: WorkflowWeightAuthorization[] };
}
