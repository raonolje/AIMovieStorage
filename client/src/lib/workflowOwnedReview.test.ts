import {expect,it} from "vitest";
import owned from "./workflowEvidence/reviewed-node-registry-v039-owned-music3.json";
import desktop from "./workflowEvidence/reviewed-node-registry-v039-minimal.json";
import builtin from "./workflowTestFixtures/owned-core039-KSampler.json";
import {workflowRegistryForPreflight,verifyWorkflowCatalogSchema} from "./workflowOwnedReview";
import {workflowNodeSchemaSha256} from "./comfyWorkflowInspection";
import type {WorkflowEnvironment,WorkflowNodeReview} from "./comfyWorkflowContract";

const facts=()=>({systemStats:{system:{comfyui_version:"0.39.0"}},sourceEvidence:"owned-child-attestation",coreCommit:owned.diskCoreCommit,baseUrl:"http://127.0.0.1:8190",ownedAttestation:{identityContractVersion:2,pid:42,serverPid:42,baseUrl:"http://127.0.0.1:8190",coreCommit:owned.diskCoreCommit}});
it("selects the separate builtin review only with frozen owned identity",()=>{
 expect(workflowRegistryForPreflight(facts())?.reviewVersion).toBe(owned.reviewVersion);
 expect(Object.keys(workflowRegistryForPreflight(facts())!.reviewedNodes)).toHaveLength(9);
 expect(workflowRegistryForPreflight({...facts(),sourceEvidence:"runtime-source-unverified",ownedAttestation:undefined})?.reviewVersion).toBe(desktop.reviewVersion);
 expect(()=>workflowRegistryForPreflight({...facts(),ownedAttestation:undefined})).toThrow("workflow_owned_review_identity_required");
 expect(()=>workflowRegistryForPreflight({...facts(),baseUrl:"http://127.0.0.1:8189"})).toThrow("workflow_owned_review_identity_required");
});
it("pins the actual builtin schema independently of Desktop custom enum additions",async()=>{
 const schema=builtin as unknown as WorkflowEnvironment["catalog"][string];
 expect(await workflowNodeSchemaSha256(schema,owned.reviewedNodes.KSampler as WorkflowNodeReview)).toBe(owned.schemaFingerprints.KSampler);
 expect(owned.schemaFingerprints.KSampler).not.toBe(desktop.schemaFingerprints.KSampler);
 await expect(verifyWorkflowCatalogSchema(workflowRegistryForPreflight(facts()),{KSampler:schema},["KSampler"])).resolves.toBeUndefined();
});
it("rejects custom or future sampler additions without refreshing a pin",async()=>{
 const schema=structuredClone(builtin);
 schema.input.required.sampler_name[0]=[...(builtin.input.required.sampler_name[0] as string[]),"unreviewed_sampler"];
 await expect(verifyWorkflowCatalogSchema(workflowRegistryForPreflight(facts()),{KSampler:schema as unknown as WorkflowEnvironment["catalog"][string]},["KSampler"])).rejects.toThrow("workflow_reviewed_schema_mismatch");
 expect(owned.schemaFingerprints.KSampler).toBe("404692e16535b157ab865b3c7bc2a808c8e718e1741a059fcd368c0cbcb6f84d");
});
it("uses native packaged reviews for a different builtin model and core without Music3 version switching",()=>{
 const review={reviewVersion:"CPU packaged registry",diskCoreCommit:"d".repeat(40),comfyVersion:"CPU future core",reviewedNodes:{CpuBuiltin:{pythonModule:"nodes",reviewId:"CPU review",sourceSha256:"a".repeat(64)}},schemaFingerprints:{CpuBuiltin:"b".repeat(64)}};
 const value={...facts(),coreCommit:review.diskCoreCommit,systemStats:{system:{comfyui_version:review.comfyVersion}},ownedAttestation:{...facts().ownedAttestation,coreCommit:review.diskCoreCommit,registrySha256:"c".repeat(64),reviewedPresetIds:["cpu-builtin-preset"],nodeSourceHashes:{nodes:"a".repeat(64)},review}};
 expect(workflowRegistryForPreflight(value)).toEqual(review);
 expect(()=>workflowRegistryForPreflight({...value,ownedAttestation:{...value.ownedAttestation,registrySha256:"wrong"}})).toThrow("registry_review_required");
 expect(()=>workflowRegistryForPreflight({...value,ownedAttestation:{...value.ownedAttestation,nodeSourceHashes:{nodes:"changed"}}})).toThrow("registry_source_mismatch");
});
