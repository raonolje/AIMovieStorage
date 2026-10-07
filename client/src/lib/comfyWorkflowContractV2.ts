import { z } from "zod";
import { workflowManifestSchema, workflowSelectionSchema, type ComfyWorkflowManifest, type WorkflowSelection, type WorkflowAssetFact, type WorkflowBindingRequest } from "./comfyWorkflowContract";

export const WORKFLOW_V2_POLICY_VERSION = "workflow-contract-v2.0-exact-variants" as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const autogrow = z.object({ kind: z.literal("autogrow"), nodeId: z.string().min(1).max(200),
  inputGroup: z.enum(["ref_images", "ref_videos", "ref_video_audios", "ref_audios"]),
  referenceGroupId: z.string().min(1).max(200), component: z.enum(["image", "video-frames", "video-audio", "audio-reference"]),
  count: z.number().int().min(1).max(9), }).strict();
const numericUnion = z.object({ kind: z.literal("numeric-union"), nodeId: z.string().min(1).max(200),
  input: z.literal("frame_rate"), members: z.tuple([z.literal("FLOAT"), z.literal("INT")]), }).strict();
export const workflowExtensionV2Schema = z.discriminatedUnion("kind", [autogrow, numericUnion]);
export type WorkflowExtensionV2 = z.infer<typeof workflowExtensionV2Schema>;
export const workflowSelectionV2Schema = z.object({ schemaVersion: z.literal(2), base: workflowSelectionSchema,
  originalV1SelectionJson: z.string().min(2).max(256000), originalV1SelectionSha256: sha,
  migration: z.object({ fromSchemaVersion: z.literal(1), serializer: z.literal("exact-json-text-sha256"), legacySelectionSha256: sha }).strict(),
  reviewedVariantId: z.string().min(1).max(200).optional(), extensions: z.array(workflowExtensionV2Schema).max(32), }).strict();
export type WorkflowSelectionV2 = z.infer<typeof workflowSelectionV2Schema>;
export const workflowManifestV2Schema = workflowManifestSchema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(2), policyVersion: z.literal(WORKFLOW_V2_POLICY_VERSION),
  selectionEnvelope: workflowSelectionV2Schema,
  // These are the ORIGINAL live input/output schema fingerprints, not flattened or relabelled schema evidence.
  rawNodeRequirements: workflowManifestSchema.shape.nodeRequirements,
  extensionsSha256: sha,
}).strict();
export type ComfyWorkflowManifestV2 = z.infer<typeof workflowManifestV2Schema>;
export type AnyComfyWorkflowManifest = ComfyWorkflowManifest | ComfyWorkflowManifestV2;
export type LegacyWorkflowSelection = WorkflowSelection;
export interface WorkflowAssetFactV2 extends WorkflowAssetFact { frameCount?: number; audioTracks?: number }
export interface WorkflowBindingRequestV2 extends WorkflowBindingRequest {
  assets?: Record<string, WorkflowAssetFactV2>; referenceGroups?: Record<string, WorkflowAssetFactV2[]>;
}
