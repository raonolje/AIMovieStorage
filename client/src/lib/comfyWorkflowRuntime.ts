import { invoke } from "@tauri-apps/api/core";
import { workflowRunSchema, workflowInputSelectionSchema, type WorkflowRunInput, type WorkflowInputSelection } from "./workflowRunContract";
export { workflowRunSchema, workflowTargetSchema } from "./workflowRunContract";
export type { WorkflowRunInput, WorkflowInputSelection } from "./workflowRunContract";
import { readProject, writeProjectAndConfirm } from "./projectWrite";
import { projectFolderName } from "./localProjectStore";
import { getMediaLibrarySettings, type ProjectAssetType } from "./mediaLibrary";
import { loadBgmProjects, updateBgmProjectsAndConfirm } from "./bgmProjects";
import { BGM_ROOT } from "./bgmLibrary";
import { prepareVersionedWorkflowAdapterPlan, validateVersionedWorkflowCollectedOutputs, assertNativeWorkflowContractSupport } from "./comfyWorkflowVersioned";
import { environmentFromPreflight, readWorkflowPreflight, workflowEntryForTarget } from "./comfyWorkflowLibrary";
import { getComfyGenerationSettings, type ComfyOutput, type ComfyRunRequest } from "./comfyGeneration";
import { runQueuedComfy } from "./comfyTasks";
import { enqueueTaskOperation, registerTaskRunner, isStopping, whenTaskJournalReady, getTaskByOperationId, type QueueTask } from "./taskQueue";
import type { WorkflowAssetFactV2 as WorkflowAssetFact } from "./comfyWorkflowContractV2";
import { sceneFolderName } from "./projectNames";
import { normalizeLyricsEnd } from "./musicPromptPolicy";
import { workflowSha256 } from "./comfyWorkflowInspection";
import {validateWorkflowReferenceTimebase} from "./workflowReferenceTimebase";
import { uid } from "./projectTypes";
import { appPromptSelection, type AppPromptTarget } from "./appPromptRequest";
import type { ProjectDraft } from "./projectTypes";
import {applyWorkflowVoiceOptions,bindWorkflowVoiceDialogue} from "./workflowVoiceOptions";

export function workflowInputForAppTarget(draft:ProjectDraft,target:AppPromptTarget,projectId:string,operationId:string):WorkflowRunInput {
 const selection=appPromptSelection(draft,target);
 if(!selection.workflowTarget)throw new Error("workflow_role_required");
 const video=target.kind==="cutVideo"||target.kind==="sceneVideo";
 const owner=target.kind==="character"?draft.characters.find(item=>item.id===target.id):target.kind==="background"?draft.backgrounds.find(item=>item.id===target.id):target.kind==="sceneVideo"?draft.scenes.find(item=>item.id===target.sceneId):draft.scenes.find(item=>item.id===target.sceneId)?.cuts.find(item=>item.id===target.cutId);
 if(!owner)throw new Error("workflow_target_missing");
 const fields=owner as {promptKo?:string;promptEn?:string;negativeKo?:string;negativeEn?:string;videoPromptKo?:string;videoPromptEn?:string;storyboardPromptKo?:string;storyboardPromptEn?:string;promptWorkflowInputs?:WorkflowInputSelection;videoWorkflowInputs?:WorkflowInputSelection};
 return workflowRunSchema.parse({projectId,operationId,workflowTarget:selection.workflowTarget,target:{kind:target.kind==="sceneVideo"?"scene":target.kind==="cutImage"||target.kind==="cutVideo"?"cut":target.kind,id:target.kind==="sceneVideo"?target.sceneId:target.kind==="cutImage"||target.kind==="cutVideo"?target.cutId:target.id},prompt:video?fields.videoPromptEn||fields.videoPromptKo||fields.storyboardPromptEn||fields.storyboardPromptKo:fields.promptEn||fields.promptKo,negative:video?undefined:fields.negativeEn||fields.negativeKo,...(video?fields.videoWorkflowInputs:fields.promptWorkflowInputs)});
}
export const WORKFLOW_TASK = "comfy-workflow-generate";
export type WorkflowQueuePayload = { input:WorkflowRunInput; baseUrl:string; baseDirectory:string; projectName:string; workflowSha256:string; requestFingerprint:string };
type Payload = WorkflowQueuePayload;
export async function workflowRequestFingerprint(request:ComfyRunRequest) {
 return workflowSha256(JSON.stringify({kind:request.kind,bindings:request.adapterPlan?.bindings,provenance:request.adapterPlan?.provenance,lyricsTransforms:request.lyricsTransforms??[]}));
}

export function savedWorkflowInputs(projectId:string,target:WorkflowRunInput["target"],outputKind:string):WorkflowInputSelection {
 if(target.kind==="bgm")return workflowInputSelectionSchema.parse(loadBgmProjects().find(p=>p.id===projectId)?.tracks.find(t=>t.id===target.id)?.promptWorkflowInputs??{});
 const draft=readProject(projectId),owner=target.kind==="character"||target.kind==="voice"?draft?.characters.find(p=>p.id===target.id):target.kind==="background"?draft?.backgrounds.find(p=>p.id===target.id):target.kind==="scene"?draft?.scenes.find(p=>p.id===target.id):draft?.scenes.flatMap(p=>p.cuts).find(p=>p.id===target.id);
 const field=target.kind==="voice"?"voiceWorkflowInputs":outputKind==="video"?"videoWorkflowInputs":"promptWorkflowInputs";
 return workflowInputSelectionSchema.parse((owner as Record<string,unknown>|undefined)?.[field]??{});
}
export async function saveWorkflowInputs(projectId:string,target:WorkflowRunInput["target"],workflowTarget:WorkflowRunInput["workflowTarget"],outputKind:string,raw:WorkflowInputSelection) {
 const inputs=workflowInputSelectionSchema.parse(raw);
 const verify=(current:unknown)=>{if(JSON.stringify(current)!==JSON.stringify(workflowTarget))throw new Error("workflow_selection_changed: 역할이 바뀌었습니다. 입력을 새 역할에서 다시 확인하세요.");};
 if(target.kind==="bgm")return updateBgmProjectsAndConfirm(projects=>projects.map(project=>project.id!==projectId?project:{...project,tracks:project.tracks.map(track=>{if(track.id!==target.id)return track;verify(track.promptWorkflow);return {...track,promptWorkflowInputs:inputs};})}));
 const field=target.kind==="voice"?"voiceWorkflowInputs":outputKind==="video"?"videoWorkflowInputs":"promptWorkflowInputs";
 const result=await writeProjectAndConfirm(projectId,draft=>{
   let found=false;const update=(owner:{id:string})=>{if(owner.id!==target.id)return owner;found=true;const value=owner as Record<string,unknown>;verify(target.kind==="voice"?value.voiceWorkflow??draft.workflowTargets?.voice:outputKind==="video"?value.videoPromptWorkflow??draft.workflowTargets?.video:value.promptWorkflow??draft.workflowTargets?.image);return {...owner,[field]:inputs};};
   const next={...draft,characters:draft.characters.map(owner=>["character","voice"].includes(target.kind)?update(owner) as typeof owner:owner),backgrounds:draft.backgrounds.map(owner=>target.kind==="background"?update(owner) as typeof owner:owner),scenes:draft.scenes.map(scene=>target.kind==="scene"?update(scene) as typeof scene:target.kind==="cut"?{...scene,cuts:scene.cuts.map(cut=>update(cut) as typeof cut)}:scene)};
   if(!found)throw new Error("workflow_target_missing");return next;
 });
 if(!result.persisted)throw new Error("workflow_inputs_save_failed");
}

function destination(input:Pick<WorkflowRunInput,"projectId"|"target"|"workflowTarget">) {
  if (input.target.kind === "bgm") {
    const project=loadBgmProjects().find(item=>item.id===input.projectId);
    const track=project?.tracks.find(item=>item.id===input.target.id);
    if (!project || !track) throw new Error("workflow_bgm_target_missing");
    return {projectName:BGM_ROOT,projectTitle:project.name,assetType:"bgm-track" as ProjectAssetType,ownerName:project.name,stem:track.name||"곡",instrumental:track.instrumental};
  }
  const project=readProject(input.projectId);
  if (!project) throw new Error("workflow_project_missing");
  const owner=input.target.kind==="character"||input.target.kind==="voice" ? project.characters.find(item=>item.id===input.target.id)
    : input.target.kind==="background" ? project.backgrounds.find(item=>item.id===input.target.id)
    : input.target.kind==="scene" ? project.scenes.find(item=>item.id===input.target.id) : project.scenes.flatMap(scene=>scene.cuts).find(item=>item.id===input.target.id);
  if (!owner) throw new Error("workflow_target_missing");
  const ownerName="name" in owner ? owner.name : owner.title;
  const sceneIndex=project.scenes.findIndex(scene=>scene.id===input.target.id||scene.cuts.some(cut=>cut.id===input.target.id));
  const scene=project.scenes[sceneIndex];
  const folder=scene ? sceneFolderName(scene.title,sceneIndex) : ownerName||"결과";
  const assetType:ProjectAssetType=input.target.kind==="voice" ? "character-voice" : input.target.kind==="character" ? "character-generated" : input.target.kind==="background" ? "background-generated" : workflowEntryForTarget(input.workflowTarget).source.outputKind==="video" ? "scene-video" : "scene-cut";
  return {projectName:projectFolderName(input.projectId,project.title),projectTitle:project.title,assetType,ownerName:scene ? folder : ownerName||"결과",stem:ownerName||"결과",instrumental:undefined};
}

/** 외부 요청에서 path/decodable을 받지 않습니다. 등록된 ID를 먼저 풀고 네이티브 CPU 사실을 읽습니다. */
async function registeredAssetFact(input:Pick<WorkflowRunInput,"projectId"|"target"|"workflowTarget">, assetId:string, place:ReturnType<typeof destination>):Promise<WorkflowAssetFact> {
  let asset:{id:string;path:string;kind:string}|undefined;
  let identityId:string|undefined;
  if (input.target.kind==="bgm") {
    const project=loadBgmProjects().find(item=>item.id===input.projectId)!;
    for (const track of project.tracks) for (const [index,path] of track.resultPaths.entries()) if (`${track.id}:result:${index}`===assetId) asset={id:assetId,path,kind:"audio"};
  } else {
    const {listControlAssets}=await import("./controlMedia");
    const found=listControlAssets(input.projectId).find(item=>item.id===assetId);
    if(found&&found.kind!=="other") {asset=found; if(found.target?.kind==="character")identityId=found.target.id;}
  }
  if(!asset)throw new Error("workflow_registered_reference_missing: 같은 프로젝트에 등록된 참조 ID를 선택하세요.");
  const fact=await invoke<WorkflowAssetFact>("comfy_workflow_asset_fact",{projectId:input.projectId,assetId,baseDirectory:getMediaLibrarySettings().baseDirectory,projectName:place.projectName,path:asset.path,kind:asset.kind});
  if(identityId&&fact.identityId!==identityId)throw new Error("workflow_registered_identity_changed: 저장된 인물 등록과 네이티브 파일 기록이 다릅니다.");
  return fact;
}

/** 준비 의존 작업 전 사용자 참조의 등록·전체 파일 사실을 고정합니다. 제출·업로드하지 않습니다. */
export async function workflowReferenceSnapshot(input:Pick<WorkflowRunInput,"projectId"|"target"|"workflowTarget"|"assets"|"referenceGroups">){
 const place=destination(input),facts:Record<string,WorkflowAssetFact>={};
 for(const id of new Set([...Object.values(input.assets),...Object.values(input.referenceGroups).flat()]))facts[id]=await registeredAssetFact(input,id,place);
 return facts;
}

export async function prepareRegisteredWorkflow(input:WorkflowRunInput):Promise<ComfyRunRequest> {
  const entry=workflowEntryForTarget(input.workflowTarget),place=destination(input),settings=getComfyGenerationSettings();
  const current=selectedWorkflowForTarget(input,entry.source.outputKind);
  if(current&&JSON.stringify(current)!==JSON.stringify(input.workflowTarget))throw new Error("workflow_selection_changed: 현재 선택 역할과 접수한 workflow가 다릅니다. 사용자 문장은 보존했으며 새 선택으로 다시 요청하세요.");
  const expectedKind=input.target.kind==="bgm"||input.target.kind==="voice"?"audio":input.target.kind==="character"||input.target.kind==="background"?"image":input.target.kind==="scene"?"video":entry.source.outputKind;
  if(input.target.kind==="cut" && entry.source.outputKind==="audio" || entry.source.outputKind!==expectedKind || (input.target.kind==="voice" && entry.source.operation!=="tts") || (input.target.kind==="bgm"&&entry.source.operation!=="music-generation")) throw new Error("workflow_output_target_mismatch");
  const preflight=await readWorkflowPreflight(entry.source.workflowPath);
  assertNativeWorkflowContractSupport(entry.manifest,preflight.supportedWorkflowContractVersions);
  if(preflight.sha256!==entry.manifest.workflowSha256)throw new Error("workflow_changed: JSON을 다시 검사하세요.");
  const facts=new Map<string,WorkflowAssetFact>();
  for(const assetId of new Set([...Object.values(input.assets),...Object.values(input.referenceGroups).flat()]))facts.set(assetId,await registeredAssetFact(input,assetId,place));
  if((input.voiceOptions||input.voiceDialogue!==undefined)&&input.target.kind!=="voice")throw new Error("workflow_voice_options_target_mismatch");
  const voice=input.target.kind==="voice"?bindWorkflowVoiceDialogue(entry,input.voiceDialogue??input.prompt,input.voiceOptions??{},input.values):undefined;
  const values=input.voiceOptions?applyWorkflowVoiceOptions(entry,input.voiceOptions,voice?.values??input.values):voice?.values??{...input.values};
  const track=input.target.kind==="bgm"?loadBgmProjects().find(project=>project.id===input.projectId)?.tracks.find(track=>track.id===input.target.id):undefined;
  if(track&&Number(track.durationSeconds)>0)for(const slot of entry.selection.slots.filter(slot=>slot.semantic==="durationSeconds"))if(values[slot.id]===undefined)values[slot.id]=Number(track.durationSeconds);
  const lyricsTransforms:unknown[]=[];
  if(track)for(const slot of entry.selection.slots.filter(slot=>slot.semantic==="lyrics")) {
    if(place.instrumental && String(values[slot.id]??"").trim())throw new Error("workflow_instrumental_lyrics_forbidden: BGM 가사 입력을 비우세요.");
    const original=place.instrumental?"":normalizeLyricsEnd(String(values[slot.id]??track.lyricsKo??track.lyrics??""));
    const modelInput=place.instrumental&&input.workflowTarget.modelRuleId==="minimaxmusic3"?"[Instrumental]":original;
    values[slot.id]=modelInput;lyricsTransforms.push({slotId:slot.id,userLiteralRule:place.instrumental?"no-lyrics":"one-terminal-literal-[end]",original,modelInput,transformation:original===modelInput?"none":"minimaxmusic3-instrumental-conditioning",controlGuaranteed:false});
  }
  const adapterPlan=await prepareVersionedWorkflowAdapterPlan({text:preflight.text,manifest:entry.manifest,environment:environmentFromPreflight(preflight,input.projectId,input.workflowTarget.modelRuleId),request:{projectId:input.projectId,prompt:voice?.prompt??input.prompt,negative:input.negative,values,rolePrompts:input.rolePrompts,
    assets:Object.fromEntries(Object.entries(input.assets).map(([slot,id])=>[slot,facts.get(id)!])),referenceGroups:Object.fromEntries(Object.entries(input.referenceGroups).map(([group,ids])=>[group,ids.map(id=>facts.get(id)!)]))}});
  validateWorkflowReferenceTimebase({graph:JSON.parse(preflight.text),selection:entry.manifest.selection,bindings:adapterPlan.bindings,values:adapterPlan.provenance.values,assets:Object.fromEntries(adapterPlan.provenance.assets.map(asset=>[asset.slotId,facts.get(asset.assetId)!]))});
  const effectivePlan={...adapterPlan,provenance:{...adapterPlan.provenance,rolePrompts:structuredClone(input.rolePrompts)}};
  return {kind:entry.source.outputKind,prompt:voice?.prompt??input.prompt,negative:input.negative,settings,adapterPlan:effectivePlan,workflowManifest:entry.manifest,lyricsTransforms,workflowSha256:entry.manifest.workflowSha256,workflowConfig:adapterPlan.config,baseDirectory:getMediaLibrarySettings().baseDirectory,...place};
}

function selectedWorkflowForTarget(input:WorkflowRunInput,outputKind:string){
 if(input.target.kind==="bgm")return loadBgmProjects().find(project=>project.id===input.projectId)?.tracks.find(track=>track.id===input.target.id)?.promptWorkflow;
 const draft=readProject(input.projectId);if(!draft)return undefined;
 const owner=input.target.kind==="character"||input.target.kind==="voice"?draft.characters.find(item=>item.id===input.target.id):input.target.kind==="background"?draft.backgrounds.find(item=>item.id===input.target.id):input.target.kind==="scene"?draft.scenes.find(item=>item.id===input.target.id):draft.scenes.flatMap(scene=>scene.cuts).find(item=>item.id===input.target.id);
 const fields=owner as {voiceWorkflow?:WorkflowRunInput["workflowTarget"];videoPromptWorkflow?:WorkflowRunInput["workflowTarget"];promptWorkflow?:WorkflowRunInput["workflowTarget"]}|undefined;
 return input.target.kind==="voice"?fields?.voiceWorkflow??draft.workflowTargets?.voice:outputKind==="video"?fields?.videoPromptWorkflow??draft.workflowTargets?.video:fields?.promptWorkflow??draft.workflowTargets?.image;
}

async function registerResults(input:WorkflowRunInput,files:ComfyOutput[],promptId:string) {
  const provenance=(file:ComfyOutput)=>({promptId,workflowTarget:input.workflowTarget,sha256:file.sha256,bytes:file.bytes,mediaFacts:file.mediaFacts,execution:file.provenance});
  if(input.target.kind==="bgm") {
    await updateBgmProjectsAndConfirm(projects=>{
      const owner=projects.find(item=>item.id===input.projectId);
      if(!owner?.tracks.some(item=>item.id===input.target.id))throw new Error("workflow_bgm_registration_target_missing");
      return projects.map(project=>project.id!==input.projectId?project:{...project,tracks:project.tracks.map(track=>track.id!==input.target.id?track:{...track,resultPaths:[...new Set([...track.resultPaths,...files.map(file=>file.path)])],workflowResults:{...track.workflowResults,...Object.fromEntries(files.map(file=>[file.path,provenance(file)]))}})});
    });return;
  }
  const outcome=await writeProjectAndConfirm(input.projectId,current=>{
    const add=<T extends {id:string;filePath?:string}>(items:T[],make:(file:ComfyOutput)=>T)=>[...items,...files.filter(file=>!items.some(item=>item.filePath===file.path)).map(make)];
    const image=(file:ComfyOutput)=>({id:uid(),filePath:file.path,name:file.name,thumb:"",file:null,workflowProvenance:provenance(file)});
    let found=false;
    const result={...current,characters:current.characters.map(person=>{
      if(person.id!==input.target.id||!["character","voice"].includes(input.target.kind))return person;found=true;
      return input.target.kind==="voice"?{...person,voiceReferences:add(person.voiceReferences??[],file=>({id:uid(),operationId:input.operationId,filePath:file.path,source:"generated" as const,dialogue:input.voiceDialogue??input.prompt,...input.voiceOptions,model:input.workflowTarget.modelRuleId,isPrimary:!(person.voiceReferences??[]).length,workflowProvenance:provenance(file)}))}:{...person,generatedImages:add(person.generatedImages,image)};
    }),backgrounds:current.backgrounds.map(place=>{if(input.target.kind!=="background"||place.id!==input.target.id)return place;found=true;return {...place,generatedImages:add(place.generatedImages,image)};}),scenes:current.scenes.map(scene=>{
      if(input.target.kind==="scene"&&scene.id===input.target.id){found=true;return {...scene,videos:add(scene.videos??[],file=>({id:uid(),filePath:file.path,name:file.name,workflowProvenance:provenance(file)}))};}
      return {...scene,cuts:scene.cuts.map(cut=>{if(input.target.kind!=="cut"||cut.id!==input.target.id)return cut;found=true;return files[0]?.kind==="video"?{...cut,videos:add(cut.videos,file=>({id:uid(),filePath:file.path,name:file.name,workflowProvenance:provenance(file)}))}:{...cut,images:add(cut.images,image)};})};
    })};
    if(!found)throw new Error("workflow_registration_target_missing: 수집 파일은 보존했습니다.");return result;
  });
  if(!outcome.persisted)throw new Error(`workflow_registration_failed: ${outcome.why}. 수집 파일과 작업 번호를 보존했습니다.`);
}

export async function executeRegisteredWorkflow(input:WorkflowRunInput,report:(change:{step?:string;progress?:number})=>void,task:QueueTask) {
  report({step:"워크플로·환경·등록 참조 재검사"});
  const request=await prepareRegisteredWorkflow(input);
  const payload=task.payload as Partial<Payload>;
  if(payload.workflowSha256 && payload.workflowSha256!==input.workflowTarget.workflowSha256)throw new Error("workflow_queued_hash_changed: 접수한 workflow와 현재 선택이 다릅니다. 새 작업으로 요청하세요.");
  if(payload.input && JSON.stringify(workflowRunSchema.parse(payload.input))!==JSON.stringify(workflowRunSchema.parse(input)))throw new Error("workflow_queued_inputs_changed: 접수한 역할·본문·참조 입력이 바뀌었습니다. 기존 작업을 새 입력으로 제출하지 않습니다.");
  if(payload.baseUrl && payload.baseUrl!==request.settings?.baseUrl || payload.baseDirectory&&payload.baseDirectory!==request.baseDirectory || payload.projectName&&payload.projectName!==request.projectName)throw new Error("workflow_destination_or_endpoint_changed: 원래 요청의 서버와 저장 위치를 확인하세요.");
  if(!payload.requestFingerprint || payload.requestFingerprint!==await workflowRequestFingerprint(request))throw new Error("workflow_queued_inputs_changed: 접수한 가사·역할·참조·입력이 바뀌었습니다. 원래 입력을 복원하거나 새 작업을 요청하세요. 기존 작업은 다시 제출하지 않습니다.");
  const made=await runQueuedComfy(request,report,task);
  validateVersionedWorkflowCollectedOutputs(workflowEntryForTarget(input.workflowTarget).manifest,made.files.map(file=>({...(file.mediaFacts??{}),assetId:file.path,projectId:input.projectId,path:file.path,kind:file.kind,nodeId:file.nodeId,sha256:file.sha256??"",bytes:file.bytes??0,decodable:file.mediaFacts?.decodable===true})),{projectId:input.projectId});
  if(isStopping(task.id))return {paths:made.files.map(file=>file.path),data:{promptId:made.promptId,attached:false,cancelled:true}};
  report({step:"수집 파일을 원래 대상에 등록하는 중"});
  await registerResults(input,made.files,made.promptId);
  return {paths:made.files.map(file=>file.path),data:{promptId:made.promptId,files:made.files,attached:true,workflowTarget:input.workflowTarget,baseUrl:request.settings?.baseUrl}};
}
export async function prepareWorkflowQueuePayload(raw:unknown):Promise<WorkflowQueuePayload> {
  const input=workflowRunSchema.parse(raw),request=await prepareRegisteredWorkflow(input);
  return {input:structuredClone(input),baseUrl:request.settings!.baseUrl,baseDirectory:request.baseDirectory!,projectName:request.projectName,workflowSha256:input.workflowTarget.workflowSha256,requestFingerprint:await workflowRequestFingerprint(request)};
}
export async function enqueueRegisteredWorkflow(raw:unknown) {
  const reused=await reuseRegisteredWorkflow(raw);if(reused)return reused;
  const payload=await prepareWorkflowQueuePayload(raw),input=payload.input,place=destination(input);
  return enqueueTaskOperation({kind:WORKFLOW_TASK,lane:"media",projectId:input.target.kind==="bgm"?`bgm:${input.projectId}`:input.projectId,projectTitle:place.projectTitle,label:`Comfy · ${place.stem}`,operationId:input.operationId,payload});
}
/** 응답 유실 재전송은 현재 환경이나 편집을 새 제출에 적용하지 않고 원래 영수증을 반환합니다. */
export async function reuseRegisteredWorkflow(raw:unknown){
 const input=workflowRunSchema.parse(raw);await whenTaskJournalReady();const previous=getTaskByOperationId(input.operationId);
 if(!previous)return undefined;
 const saved=previous.payload as Partial<WorkflowQueuePayload>;
 if(previous.kind!==WORKFLOW_TASK||!saved.input||JSON.stringify(workflowRunSchema.parse(saved.input))!==JSON.stringify(input))throw new Error("같은 작업 요청 열쇠에 다른 내용이 들어왔습니다.");
 return enqueueTaskOperation({kind:previous.kind,lane:previous.lane,projectId:previous.projectId,projectTitle:previous.projectTitle,label:previous.label,operationId:input.operationId,payload:previous.payload});
}
registerTaskRunner(WORKFLOW_TASK,(payload,report,task)=>executeRegisteredWorkflow(workflowRunSchema.parse((payload as Payload).input),report,task));
