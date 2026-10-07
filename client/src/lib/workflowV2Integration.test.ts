import {expect,it} from "vitest";
import {offlineWorkflowV2Draft,hasOfflineWorkflowV2Draft} from "./offlineWorkflowV2Draft";
import {normalizeWorkflowEditorDraft} from "./workflowEditor";
import {workflowRegisterSchema} from "./controlComfyWorkflow";
import {workflowSha256} from "./comfyWorkflowInspection";
import envelopes from "./workflowEvidence/offline-v2-selection-envelopes.json";

it("검토된 8개 후보의 V2 계약과 원래 V1 원문 SHA를 보존합니다",async()=>{
 expect(envelopes.entries).toHaveLength(8);
 for(const entry of envelopes.entries){expect(hasOfflineWorkflowV2Draft(entry.id)).toBe(true);const {draft}=offlineWorkflowV2Draft(entry.id,"C:/cpu-only/exact.api.json","cpu-project");expect(draft.selectionEnvelope.originalV1SelectionJson).toBe(entry.selectionEnvelope.originalV1SelectionJson);expect(await workflowSha256(draft.selectionEnvelope.originalV1SelectionJson)).toBe(draft.selectionEnvelope.originalV1SelectionSha256);const normalized=normalizeWorkflowEditorDraft(draft);expect(normalized.selectionEnvelope).toEqual(draft.selectionEnvelope);expect(workflowRegisterSchema.parse({...normalized,projectId:"cpu-project"}).selectionEnvelope).toEqual(draft.selectionEnvelope);}
});
it("V2 역할 편집이 원래 선택과 다르면 몰래 버전·원문을 덮어쓰지 않습니다",()=>{const {draft}=offlineWorkflowV2Draft("h3-ref2va-2-identity","C:/cpu-only/exact.api.json");const original=draft.selectionEnvelope.originalV1SelectionJson;const edited=structuredClone(draft);edited.selection.slots[0].defaultValue="사용자가 쓴 문장";expect(()=>normalizeWorkflowEditorDraft(edited)).toThrow("v2_registration_selection_mismatch");expect(draft.selectionEnvelope.originalV1SelectionJson).toBe(original);});
it("V2가 없는 Music3 후보는 자동 마이그레이션하지 않습니다",()=>{expect(hasOfflineWorkflowV2Draft("music3-instrumental")).toBe(false);expect(()=>offlineWorkflowV2Draft("music3-instrumental","C:/cpu-only/exact.api.json")).toThrow("v2_variant_not_reviewed");});
