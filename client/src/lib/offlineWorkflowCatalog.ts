import catalog from "./workflowEvidence/offline-preset-catalog.json";
import type {WorkflowGraph,WorkflowSelection,WorkflowSource} from "./comfyWorkflowContract";
import type {WorkflowEditorDraft} from "./workflowEditor";
import {readEditableApiGraph} from "./workflowEditor";
export interface OfflineWorkflowCandidate{id:string;modelRuleId:string;operation:string;outputKind:string;referenceCount:number;graphSha256:string;executionSelectable:false;actualGenerationRegistration:"not-run";status:"experimental-blocked";blockers:string[];source:WorkflowSource;selection:WorkflowSelection;limitations:string[];graph:WorkflowGraph}
export const offlineWorkflowCandidates=catalog.presets as unknown as OfflineWorkflowCandidate[];
export const OFFLINE_CATALOG_CAPTURED_AT=catalog.capturedAtUtc;
export function offlineWorkflowDraft(id:string,workflowPath:string,projectId?:string):{draft:WorkflowEditorDraft;graph:WorkflowGraph;expectedGraphSha256:string;blockers:string[]}{
 const candidate=offlineWorkflowCandidates.find(item=>item.id===id);
 if(!candidate||candidate.executionSelectable!==false||candidate.actualGenerationRegistration!=="not-run")throw new Error("workflow_offline_candidate_invalid");
 const graph=readEditableApiGraph(JSON.stringify(candidate.graph));
 return {draft:{source:{...structuredClone(candidate.source),presetId:id,workflowId:projectId?id+"-"+projectId:id,workflowPath,limitations:structuredClone(candidate.limitations),evidence:[]},selection:structuredClone(candidate.selection)},graph,expectedGraphSha256:candidate.graphSha256,blockers:[...candidate.blockers]};
}
const BLOCKER_LABELS:Record<string,string>={
 "loaded-core-source-attestation-unknown":"실행 중 로드된 core 소스 증명이 없습니다.",
 "cached-node-schema-requires-current-preflight":"현재 서버의 노드 스키마를 다시 검사해야 합니다.",
 "actual-generation-and-registration-not-run":"실제 생성·수집·등록은 미검증입니다.",
 "trusted-project-weight-authorization-required":"프로젝트의 정확한 가중치 파일 허가 기록이 필요합니다.",
 "trusted-project-exact-H3-authorization-required":"프로젝트의 정확한 H3 변형과 전체 파일 SHA 허가 기록이 필요합니다.",
 "custom-node-not-approved":"설치된 custom 노드를 검토·허용하지 않았습니다.",
 "installed-Qwen-TTS-missing-tokenizer-or-model-auto-download-not-fail-closed":"TTS 로더의 누락 파일 자동 다운로드·원격 fallback을 차단하지 못했습니다.",
 "implicit-model-loader-not-representable-by-frozen-pure-loader-role":"암묵적인 모델 로더가 현재 명시 loader 역할 계약에 맞지 않습니다."
};
export const offlineWorkflowBlockerLabel=(code:string)=>BLOCKER_LABELS[code]??code;
