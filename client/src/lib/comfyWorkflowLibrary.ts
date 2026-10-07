import { anyWorkflowManifestSchema, buildVersionedComfyWorkflowManifest } from "./comfyWorkflowVersioned";
import { workflowSelectionV2Schema, type WorkflowSelectionV2, type AnyComfyWorkflowManifest } from "./comfyWorkflowContractV2";
import { invoke } from "@tauri-apps/api/core";
import { queueMirrorWriteAndConfirm, registerMirrorSection } from "./mediaLibrary";
import { getComfyGenerationSettings } from "./comfyGeneration";
import { STANDARD_WORKFLOW_NODE_REVIEWS, WORKFLOW_POLICY_VERSION } from "./comfyWorkflowInspection";
import { workflowSelectionSchema, workflowSourceSchema, workflowWeightAuthorizationSchema, type WorkflowEnvironment, type WorkflowIssue, type WorkflowSelection, type WorkflowSource } from "./comfyWorkflowContract";
import {workflowRegistryForPreflight,verifyWorkflowCatalogSchema} from "./workflowOwnedReview";
import music3Facts from "./workflowEvidence/music3-exact-weight-facts.json";
import type { WorkflowPromptTarget } from "./promptModelSelection";
import {validateVoiceOptionBindings,type VoiceOptionBindings} from "./workflowVoiceOptions";
import {readEditableApiGraph} from "./workflowEditor";
import {isLocalWorkflowPath,workflowSha256} from "./comfyWorkflowInspection";

export interface WorkflowLibraryEntry { source: WorkflowSource; selection: WorkflowSelection; selectionEnvelope?:WorkflowSelectionV2; voiceOptionBindings?:VoiceOptionBindings; workflowSha256?: string; manifest?: AnyComfyWorkflowManifest; issues: WorkflowIssue[]; checkedAtUtc: string;revisionId?:string;originWorkflowId?:string;originalWorkflowPath?:string;projectScope?:string }
export interface WorkflowPreflight { text: string; sha256: string; catalog: WorkflowEnvironment["catalog"]; systemStats: { system: Record<string, unknown> }; catalogFingerprint: string; nodeSourceHashes?: Record<string,string>; coreCommit?: string; diskCoreCommit?: string; sourceEvidence?: string; baseUrl?: string; verifiedWeights?:WorkflowEnvironment["weights"];ownedAttestation?:unknown;supportedWorkflowContractVersions?:number[];queueRunning: number; queuePending: number }
const KEY="ai-video-storage.comfy-workflow-library.v1", SECTION="comfy-workflow-library";
const listeners=new Set<()=>void>();
export const subscribeWorkflowLibrary=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function listWorkflowLibrary(): WorkflowLibraryEntry[] {
  if(typeof window==="undefined")return [];
  try { const entries=JSON.parse(window.localStorage.getItem(KEY)??"[]"); return Array.isArray(entries) ? entries.filter(entry=>workflowSourceSchema.safeParse(entry?.source).success && workflowSelectionSchema.safeParse(entry?.selection).success).map((entry:WorkflowLibraryEntry)=>{
    const parsed=anyWorkflowManifestSchema.safeParse(entry.manifest),manifest=parsed.success?parsed.data:undefined;
    const rawEnvelope=entry.selectionEnvelope??(manifest?.schemaVersion===2?manifest.selectionEnvelope:undefined);
    const envelope=rawEnvelope?workflowSelectionV2Schema.safeParse(rawEnvelope):undefined;
    if(envelope&&!envelope.success)return {...entry,manifest:undefined,issues:[...(entry.issues??[]),{code:"workflow_stored_v2_envelope_invalid",message:"보존된 V2 계약을 다시 검사하세요. V1으로 자동 전환하지 않습니다."}]};
    return {...entry,selectionEnvelope:envelope?.success?envelope.data:undefined,manifest};
  }) : []; } catch{return [];}
}
function publish(entries:WorkflowLibraryEntry[]){window.localStorage.setItem(KEY,JSON.stringify(entries));listeners.forEach(listener=>listener());}
registerMirrorSection(SECTION,{read:listWorkflowLibrary,write(value){if(Array.isArray(value))publish(value as WorkflowLibraryEntry[]);}});
/** 설치·라이선스 proof가 없는 weight를 allowed로 추론하지 않습니다. 검토 자료가 배포되기 전까지 빈 registry로 차단합니다. */
export const REVIEWED_WORKFLOW_WEIGHTS: WorkflowEnvironment["weights"]=[];
const AUTH_KEY="ai-video-storage.workflow-project-authorizations.v1",AUTH_SECTION="workflow-project-authorizations";
function trustedAuthorizations(){try{return workflowWeightAuthorizationSchema.array().parse(JSON.parse(window.localStorage.getItem(AUTH_KEY)??"[]"));}catch{return [];}}
registerMirrorSection(AUTH_SECTION,{read:trustedAuthorizations,write(value){const parsed=workflowWeightAuthorizationSchema.array().safeParse(value);if(parsed.success)window.localStorage.setItem(AUTH_KEY,JSON.stringify(parsed.data));}});
/** 기존 사용자 진술을 UI가 선택한 저장된 project에 한정합니다. graph/계약 JSON의 허가 기록은 채택하지 않습니다. */
export async function recordWorkflowUserAuthorization(raw:unknown){
 const request=structuredClone(raw);
 const next=authorizationQueue.then(()=>recordWorkflowUserAuthorizationNow(request));
 authorizationQueue=next.then(()=>undefined,()=>undefined);return next;
}
let authorizationQueue:Promise<void>=Promise.resolve();
async function recordWorkflowUserAuthorizationNow(raw:unknown){
 const {workflowProjectAuthorizationSchema,readWorkflowAuthorizationOptions}=await import("./workflowProjectAuthorization");
 const input=workflowProjectAuthorizationSchema.parse(raw);
 const [{readProject},{loadBgmProjects}]=await Promise.all([import("./projectWrite"),import("./bgmProjects")]);
 if(!readProject(input.projectId)&&!loadBgmProjects().some(project=>project.id===input.projectId))throw new Error("workflow_trusted_project_required");
 const options=await readWorkflowAuthorizationOptions(),preset=options.presets.find(p=>p.id===input.presetId);
 const key=(file:{category:string;name:string;sha256:string})=>JSON.stringify([file.category,file.name,file.sha256]);
 const requested=input.files.map(key),expected=preset?.files.map(key)??[];
 if(input.registrySha256!==options.registrySha256||!preset||preset.modelRuleId!==input.modelRuleId||new Set(requested).size!==requested.length||requested.length!==expected.length||requested.some(file=>!expected.includes(file)))throw new Error("workflow_authorization_exact_packaged_scope_required");
 const grants=preset.files.map(file=>workflowWeightAuthorizationSchema.parse({...input.statement,...file,projectId:input.projectId,modelRuleId:preset.modelRuleId}));
 const before=trustedAuthorizations(),next=[...before.filter(grant=>!(grant.projectId===input.projectId&&grant.modelRuleId===input.modelRuleId&&expected.includes(key(grant)))),...grants];
 if(grants.every(grant=>before.some(old=>JSON.stringify(old)===JSON.stringify(grant))))return grants;
 await queueMirrorWriteAndConfirm(AUTH_SECTION,next);window.localStorage.setItem(AUTH_KEY,JSON.stringify(next));return grants;
}
export async function recordMusic3UserAuthorization(projectId:string){
 const [{readProject},{loadBgmProjects}]=await Promise.all([import("./projectWrite"),import("./bgmProjects")]);
 if(!readProject(projectId)&&!loadBgmProjects().some(project=>project.id===projectId))throw new Error("workflow_trusted_project_required");
 const reportedAtUtc=new Date().toISOString();
 const grants=music3Facts.files.map(file=>workflowWeightAuthorizationSchema.parse({kind:"user-reported",projectId,modelRuleId:"minimaxmusic3",category:file.category,name:file.name,sha256:file.sha256,
  evidence:"사용자가 선택한 이 프로젝트에서 exact MiniMax Music3 가중치의 사용 허가를 보유한다고 기록했습니다. 공개 라이선스와 독립 법률 검증은 별도입니다.",sourceThreadId:"local-user-record",reportedAtUtc}));
 const {readWorkflowAuthorizationOptions}=await import("./workflowProjectAuthorization");const options=await readWorkflowAuthorizationOptions(),preset=options.presets.find(p=>p.modelRuleId==="minimaxmusic3"&&p.files.length===grants.length&&p.files.every(file=>grants.some(g=>g.category===file.category&&g.name===file.name&&g.sha256===file.sha256)));
 if(!preset)throw new Error("workflow_music3_packaged_scope_missing");
 return recordWorkflowUserAuthorization({projectId,presetId:preset.id,modelRuleId:preset.modelRuleId,registrySha256:options.registrySha256,files:preset.files,statement:{kind:"user-reported",evidence:grants[0].evidence,sourceThreadId:grants[0].sourceThreadId,reportedAtUtc}});
}
export function environmentFromPreflight(preflight:WorkflowPreflight,projectId?:string,modelRuleId?:string): WorkflowEnvironment {
  const system=preflight.systemStats.system;
  const registry=workflowRegistryForPreflight(preflight),sourceVerified=["reported-commit-matches-disk","owned-child-attestation"].includes(preflight.sourceEvidence??"");
  return {comfyVersion:String(system.comfyui_version??""),coreCommit:preflight.coreCommit??"",pythonVersion:String(system.python_version??""),torchVersion:String(system.pytorch_version??""),
    reviewVersion:registry?.reviewVersion??WORKFLOW_POLICY_VERSION,customNodeVersions:{},nodeSourceHashes:sourceVerified?preflight.nodeSourceHashes??{}:{},catalog:preflight.catalog,reviewedNodes:registry?.reviewedNodes??STANDARD_WORKFLOW_NODE_REVIEWS,weights:sourceVerified?preflight.verifiedWeights??REVIEWED_WORKFLOW_WEIGHTS:[],projectId,weightAuthorizations:projectId?trustedAuthorizations().filter(grant=>grant.projectId===projectId&&(!modelRuleId||grant.modelRuleId===modelRuleId)):[]};
}
export async function readWorkflowPreflight(workflowPath:string):Promise<WorkflowPreflight>{
  const settings=getComfyGenerationSettings();
  return invoke("comfy_workflow_preflight",{baseUrl:settings.baseUrl,workflowPath,installationRoot:settings.installationRoot??null});
}
/** UI와 조종기 등록은 같은 검사 엔진을 사용하며 등록 자체는 큐/업로드/다운로드를 실행하지 않습니다. */
export async function inspectAndRegisterWorkflow(raw:{source:WorkflowSource;selection:WorkflowSelection;selectionEnvelope?:WorkflowSelectionV2;projectId?:string;voiceOptionBindings?:VoiceOptionBindings}):Promise<WorkflowLibraryEntry>{
  const request=structuredClone(raw);
  const next=registrationQueue.then(()=>registerWorkflowRevision(request));
  registrationQueue=next.then(()=>undefined,()=>undefined);return next;
}
let registrationQueue:Promise<void>=Promise.resolve();
async function registerWorkflowRevision(raw:Parameters<typeof inspectAndRegisterWorkflow>[0]):Promise<WorkflowLibraryEntry>{
  const originalSource=workflowSourceSchema.parse(raw.source),selection=workflowSelectionSchema.parse(raw.selection),checkedAtUtc=new Date().toISOString();
  const voiceOptionBindings=raw.voiceOptionBindings?validateVoiceOptionBindings({selection,voiceOptionBindings:raw.voiceOptionBindings}):undefined;
  if(voiceOptionBindings&&originalSource.operation!=="tts")throw new Error("workflow_voice_binding_operation_mismatch");
  const preflight=await readWorkflowPreflight(originalSource.workflowPath);
  const graph=readEditableApiGraph(preflight.text);
  if(await workflowSha256(preflight.text)!==preflight.sha256)throw new Error("workflow_preflight_graph_hash_mismatch");
  const extraIssues:WorkflowIssue[]=[];
  if(new Set(selection.promptRoles.map(role=>role.modelRuleId)).size>1)extraIssues.push({code:"workflow_mixed_model_roles_unsupported",message:"같은 모델의 여러 역할 본문은 전달합니다. 역할마다 다른 모델의 shared weight 허가·loader 연결은 별도 native 검토 정책이 필요하여 현재 실행 manifest를 만들지 않습니다."});
  if(selection.slots.some(slot=>slot.semantic==="maskVideo"))extraIssues.push({code:"workflow_mask_video_unsupported",message:"영상 mask의 전체 CPU 규약 검증은 현재 미지원입니다. 요청자가 지정한 규약을 파일 사실로 채택하지 않으며 실행 manifest를 만들지 않습니다."});
  try{await verifyWorkflowCatalogSchema(workflowRegistryForPreflight(preflight),preflight.catalog,Object.values(graph).map(node=>node.class_type));}catch(error){extraIssues.push({code:"workflow_catalog_schema_changed",message:String(error)});}
  const selectionEnvelope=raw.selectionEnvelope?workflowSelectionV2Schema.parse(raw.selectionEnvelope):undefined;
  const before=listWorkflowLibrary(),existing=before.find(item=>item.source.workflowId===originalSource.workflowId);
  const scope=existing?.projectScope??existing?.manifest?.projectId;
  if(scope&&scope!==raw.projectId)throw new Error("workflow_id_used_by_another_project: 프로젝트별 workflow ID를 구분하세요.");
  const revisionId=crypto.randomUUID(),originWorkflowId=existing?.originWorkflowId??originalSource.workflowId;
  const snapshot=await invoke<{snapshotPath:string;sha256:string;revisionId:string}>("comfy_workflow_store_revision",{workflowPath:originalSource.workflowPath,expectedSha256:preflight.sha256,revisionId});
  if(!snapshot||!isLocalWorkflowPath(snapshot.snapshotPath)||snapshot.sha256!==preflight.sha256||snapshot.revisionId!==revisionId)throw new Error("workflow_snapshot_native_proof_invalid");
  const source={...originalSource,workflowId:existing?`${originWorkflowId.slice(0,140)}:${revisionId}`:originalSource.workflowId,workflowPath:snapshot.snapshotPath};
  const result=await buildVersionedComfyWorkflowManifest({text:preflight.text,source,selection,selectionEnvelope,environment:environmentFromPreflight(preflight,raw.projectId,source.promptProfile),checkedAtUtc});
  const originalWorkflowPath=existing&&originalSource.workflowPath===existing.source.workflowPath?existing.originalWorkflowPath??originalSource.workflowPath:originalSource.workflowPath;
  const entry={source,selection,selectionEnvelope,voiceOptionBindings,workflowSha256:preflight.sha256,manifest:extraIssues.length?undefined:result.manifest,issues:[...result.inspection.issues,...extraIssues],checkedAtUtc,revisionId,originWorkflowId,originalWorkflowPath,projectScope:raw.projectId};
  const next=[...before,entry];
  await queueMirrorWriteAndConfirm(SECTION,next);publish(next);return entry;
}
export function workflowEntryForTarget(target:WorkflowPromptTarget):WorkflowLibraryEntry&{manifest:AnyComfyWorkflowManifest}{
  const entry=listWorkflowLibrary().find(item=>item.source.workflowId===target.workflowId && (item.workflowSha256??item.manifest?.workflowSha256)===target.workflowSha256);
  if(!entry&&listWorkflowLibrary().some(item=>item.source.workflowId===target.workflowId))throw new Error("workflow_target_stale: 선택한 graph hash와 보존된 버전이 다릅니다. 문장은 보존되며 다시 선택해야 합니다.");
  if(!entry?.manifest)throw new Error("workflow_not_admitted: 정적/설치/라이선스 검사를 통과한 workflow가 없습니다. 라이브 enum 등록과 검토 소스 버전을 확인하세요. 생성 검증된 preset은 아직 없습니다.");
  if(entry.selection.promptRoles.some(role=>role.id===target.roleId&&role.modelRuleId===target.modelRuleId)&&entry.manifest.promptTarget.roleId!==target.roleId)throw new Error("workflow_role_revision_required: 등록한 주 역할만 실행 target으로 선택할 수 있습니다. 다른 역할은 명시적으로 새 revision을 검사·등록하세요. 보존한 V2 원문은 바꾸지 않습니다.");
  if(JSON.stringify(entry.manifest.promptTarget)!==JSON.stringify(target))throw new Error("workflow_target_stale: workflow hash 또는 명시 프롬프트 역할이 바뀌었습니다. 다시 선택하고 작성하세요.");
  return entry as WorkflowLibraryEntry&{manifest:AnyComfyWorkflowManifest};
}

/** 초안은 문장 작성에만 쓸 수 있습니다. 생성 승인과 구별하며 역할은 사용자가 명시합니다. */
export function workflowPromptContext(target: WorkflowPromptTarget) {
  const entry = listWorkflowLibrary().find(item => item.source.workflowId === target.workflowId && (item.workflowSha256??item.manifest?.workflowSha256)===target.workflowSha256);
  const role = entry?.selection.promptRoles.find(item => item.id === target.roleId);
  if (!entry || !role || (entry.workflowSha256 ?? entry.manifest?.workflowSha256) !== target.workflowSha256 || role.modelRuleId !== target.modelRuleId)
    throw new Error("workflow_prompt_target_stale: 보관된 graph hash와 명시 프롬프트 역할을 다시 선택하세요. 기존 문장은 유지됩니다.");
  if(role.id!==(entry.manifest?.promptTarget.roleId??entry.selection.selectedPromptRoleId))throw new Error("workflow_role_revision_required: 등록한 주 역할만 작성 target으로 선택합니다. 다른 역할은 새 revision으로 명시 검사·등록하세요.");
  return { source:entry.source, role, slots:entry.selection.slots, referenceGroups:entry.selection.referenceGroups, executionState:entry.manifest ? "static-installed-only" : "draft-blocked", issues:entry.issues };
}
