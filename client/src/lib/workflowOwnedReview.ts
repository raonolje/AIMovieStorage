import desktop039 from "./workflowEvidence/reviewed-node-registry-v039-minimal.json";
import ownedMusic3 from "./workflowEvidence/reviewed-node-registry-v039-owned-music3.json";
import { workflowNodeSchemaSha256 } from "./comfyWorkflowInspection";
import type { WorkflowEnvironment, WorkflowNodeReview } from "./comfyWorkflowContract";

type Registry={reviewVersion:string;reviewedNodes:Record<string,WorkflowNodeReview>;schemaFingerprints:Record<string,string>};
type Facts={systemStats:{system:Record<string,unknown>};sourceEvidence?:string;coreCommit?:string;baseUrl?:string;ownedAttestation?:unknown};
/** The Desktop custom-extended schema is not the managed no-custom schema. */
export function workflowRegistryForPreflight(facts:Facts):Registry|undefined {
 if(facts.sourceEvidence!=="owned-child-attestation")return String(facts.systemStats.system.comfyui_version)==="0.39.0"?desktop039 as Registry:undefined;
 const proof=facts.ownedAttestation as Record<string,unknown>|undefined;
 if(proof?.identityContractVersion!==2||!Number.isInteger(proof.serverPid)||Number(proof.serverPid)<=0||proof.pid!==proof.serverPid||proof.baseUrl!==facts.baseUrl||proof.coreCommit!==facts.coreCommit )
  throw new Error("workflow_owned_review_identity_required");
 const review=proof.review as (Registry&{diskCoreCommit:string;comfyVersion:string})|undefined;
 if(review){if(typeof proof.registrySha256!=="string"||! /^[a-f0-9]{64}$/.test(proof.registrySha256)||!Array.isArray(proof.reviewedPresetIds)||!proof.reviewedPresetIds.length||review.diskCoreCommit!==facts.coreCommit||review.comfyVersion!==String(facts.systemStats.system.comfyui_version)||typeof review.reviewVersion!=="string"||!review.reviewedNodes||!review.schemaFingerprints)throw new Error("workflow_owned_registry_review_required");
  const source=proof.nodeSourceHashes as Record<string,string>|undefined;for(const node of Object.values(review.reviewedNodes)){if(source?.[node.pythonModule]!==node.sourceSha256)throw new Error("workflow_owned_registry_source_mismatch");}return review;
 }
 // Legacy observations can inspect their former exact review; native admission requires the packaged registry proof.
 if(facts.coreCommit!==ownedMusic3.diskCoreCommit)throw new Error("workflow_owned_registry_review_required");return ownedMusic3 as Registry;
}
export async function verifyWorkflowCatalogSchema(registry:Registry|undefined,catalog:WorkflowEnvironment["catalog"],types:string[]) {
 if(!registry)return;
 for(const type of new Set(types)){
  const review=registry.reviewedNodes[type],schema=catalog[type],expected=registry.schemaFingerprints[type];
  if(review&&schema&&expected&&await workflowNodeSchemaSha256(schema,review)!==expected)
   throw new Error(`workflow_reviewed_schema_mismatch: ${type}. 같은 버전에서도 재검토가 필요합니다.`);
 }
}
