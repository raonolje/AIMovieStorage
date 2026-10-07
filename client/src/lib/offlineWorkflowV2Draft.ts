import envelopes from "./workflowEvidence/offline-v2-selection-envelopes.json";
import { workflowSelectionV2Schema } from "./comfyWorkflowContractV2";
import { offlineWorkflowDraft } from "./offlineWorkflowCatalog";

export function hasOfflineWorkflowV2Draft(id:string) { return envelopes.entries.some(entry=>entry.id===id); }
/** 명시적으로 고른 계약만 보며 원래 V1 문자열과 graph를 재작성하지 않습니다. */
export function offlineWorkflowV2Draft(id:string,workflowPath:string,projectId?:string) {
 const entry=envelopes.entries.find(entry=>entry.id===id);
 if(!entry)throw new Error("v2_variant_not_reviewed");
 const result=offlineWorkflowDraft(id,workflowPath,projectId);
 const selectionEnvelope=workflowSelectionV2Schema.parse(entry.selectionEnvelope);
 return {...result,draft:{...result.draft,selection:structuredClone(selectionEnvelope.base),selectionEnvelope}};
}
