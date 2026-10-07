import { z } from "zod";
import { workflowManifestSchema, workflowSelectionSchema, type WorkflowEnvironment, type WorkflowSelection, type WorkflowSource, type WorkflowAssetFact } from "./comfyWorkflowContract";
import { buildComfyWorkflowManifest } from "./comfyWorkflowInspection";
import { prepareWorkflowAdapterPlan, identifyWorkflowOutputs, validateWorkflowCollectedOutputs } from "./comfyWorkflowBinding";
import { workflowManifestV2Schema, type AnyComfyWorkflowManifest, type WorkflowSelectionV2, type WorkflowBindingRequestV2 } from "./comfyWorkflowContractV2";
import { buildComfyWorkflowManifestV2 } from "./comfyWorkflowInspectionV2";
import { prepareWorkflowAdapterPlanV2, identifyWorkflowOutputsV2, validateWorkflowCollectedOutputsV2 } from "./comfyWorkflowBindingV2";

export const anyWorkflowManifestSchema = z.union([workflowManifestSchema, workflowManifestV2Schema]);
export function parseVersionedWorkflowManifest(raw: unknown): AnyComfyWorkflowManifest { return anyWorkflowManifestSchema.parse(raw); }
export function assertNativeWorkflowContractSupport(raw: AnyComfyWorkflowManifest, trustedNativeSupportedVersions?: readonly number[]): void {
  const manifest = parseVersionedWorkflowManifest(raw);
  if (!(trustedNativeSupportedVersions ?? [1]).includes(manifest.schemaVersion)) throw new Error("workflow_native_contract_version_unsupported");
}
export async function buildVersionedComfyWorkflowManifest(input: { text: string; source: WorkflowSource; selection: WorkflowSelection;
  selectionEnvelope?: WorkflowSelectionV2; environment: WorkflowEnvironment; checkedAtUtc: string }) {
  if (!input.selectionEnvelope) return buildComfyWorkflowManifest(input);
  if (JSON.stringify(workflowSelectionSchema.parse(input.selection)) !== JSON.stringify(input.selectionEnvelope.base)) throw new Error("v2_registration_selection_mismatch");
  return buildComfyWorkflowManifestV2({ ...input, selectionEnvelope: input.selectionEnvelope });
}
export async function prepareVersionedWorkflowAdapterPlan(input: { text: string; manifest: AnyComfyWorkflowManifest; environment: WorkflowEnvironment; request: WorkflowBindingRequestV2 }) {
  const manifest = parseVersionedWorkflowManifest(input.manifest);
  return manifest.schemaVersion === 1 ? prepareWorkflowAdapterPlan({ ...input, manifest }) : prepareWorkflowAdapterPlanV2({ ...input, manifest });
}
export function identifyVersionedWorkflowOutputs(raw: AnyComfyWorkflowManifest, history: unknown, promptId: string) {
  const manifest = parseVersionedWorkflowManifest(raw); return manifest.schemaVersion === 1 ? identifyWorkflowOutputs(manifest, history, promptId) : identifyWorkflowOutputsV2(manifest, history, promptId);
}
export function validateVersionedWorkflowCollectedOutputs(raw: AnyComfyWorkflowManifest, facts: (WorkflowAssetFact & { nodeId: string; audioTracks?: number })[], options: { projectId: string; requireAudioTrack?: boolean }) {
  const manifest = parseVersionedWorkflowManifest(raw); if (manifest.schemaVersion === 1) validateWorkflowCollectedOutputs(manifest, facts, options); else validateWorkflowCollectedOutputsV2(manifest, facts, options);
}
