import { invoke } from "@tauri-apps/api/core";
import { workflowSourceSchema, workflowSelectionSchema } from "./comfyWorkflowContract";
import { workflowSelectionV2Schema } from "./comfyWorkflowContractV2";
import { normalizeWorkflowEditorDraft, type WorkflowEditorDraft } from "./workflowEditor";
import { isLocalWorkflowPath, isSafeRelativeWorkflowName } from "./comfyWorkflowInspection";

export type WorkflowIndexEntry={id:string;model:string;operation:string;referenceCount:number;graphSha256:string;versions:Partial<Record<"v1"|"v2",string>>};
export type WorkflowFileImport={kind:"registration";draft:WorkflowEditorDraft;registrationPath:string}|{kind:"index";root:string;entries:WorkflowIndexEntry[]};
export function workflowFileDirectory(path:string){if(!isLocalWorkflowPath(path))throw new Error("workflow_import_local_path_required");return path.replace(/\\/g,"/").split("/").slice(0,-1).join("/");}
export function parseWorkflowRegistrationFile(text:string,registrationPath:string):WorkflowEditorDraft {
 if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error("workflow_registration_file_too_large");
 const raw=JSON.parse(text) as Record<string,unknown>;
 if(!raw||typeof raw!=="object"||!raw.source||!raw.selection)throw new Error("workflow_registration_entry_required: source와 selection을 포함한 app-registration-entry.json을 선택하세요. API graph는 API JSON 고르기로 여세요.");
 const source=workflowSourceSchema.parse(raw.source),selection=workflowSelectionSchema.parse(raw.selection);
 if(!isLocalWorkflowPath(source.workflowPath))throw new Error("workflow_import_graph_local_path_required");workflowFileDirectory(registrationPath);
 const selectionEnvelope=raw.selectionEnvelope===undefined?undefined:workflowSelectionV2Schema.parse(raw.selectionEnvelope);
 const role=selection.promptRoles.find(role=>role.id===selection.selectedPromptRoleId);
 if(!role || source.promptProfile!==role.modelRuleId || JSON.stringify([...new Set(selection.promptRoles.map(r=>r.modelRuleId))])!==JSON.stringify(source.modelIds))throw new Error("workflow_registration_source_model_mismatch");
 // 파일의 manifest·허가·실행 표시를 채택하지 않고 역할 원문만 새 검사 입력으로 보존합니다.
 return normalizeWorkflowEditorDraft({source,selection,selectionEnvelope,...(raw.voiceOptionBindings?{voiceOptionBindings:raw.voiceOptionBindings as WorkflowEditorDraft["voiceOptionBindings"]}:{})});
}
export function parseWorkflowImportFile(text:string,filePath:string):WorkflowFileImport {
 if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error("workflow_registration_file_too_large");
 const raw=JSON.parse(text) as Record<string,unknown>;
 if(raw&&typeof raw==="object"&&Array.isArray(raw.entries)&&!raw.source){
  if(raw.entries.length>2000)throw new Error("workflow_index_too_many_entries");
  const entries=raw.entries.map((value:unknown)=>{
   const e=value as Record<string,unknown>,paths=e.relativeAppRegistrationEntries as Record<string,unknown>|undefined;
   if(!e||typeof e.id!=="string"||!/^[a-f0-9]{64}$/.test(String(e.graphSha256))||!paths)throw new Error("workflow_index_invalid_entry");
   const versions:WorkflowIndexEntry["versions"]={};
   for(const version of ["v1","v2"] as const){const relative=paths[version];if(relative===null||relative===undefined)continue;if(typeof relative!=="string"||!isSafeRelativeWorkflowName(relative)||relative.includes("\\")||!relative.toLowerCase().endsWith(".json"))throw new Error("workflow_index_unsafe_entry_path");versions[version]=relative;}
   return {id:e.id,model:String(e.model??e.modelRuleId??""),operation:String(e.operation??""),referenceCount:Number(e.referenceCount??0),graphSha256:String(e.graphSha256),versions};
  });
  return {kind:"index",root:workflowFileDirectory(filePath),entries};
 }
 return {kind:"registration",draft:parseWorkflowRegistrationFile(text,filePath),registrationPath:filePath};
}
export async function chooseWorkflowRegistrationFile(directory:string):Promise<WorkflowFileImport|null>{
 const picked=await invoke<{path:string;contents:string}|null>("choose_text_file",{directory,extension:"json"});
 return picked?parseWorkflowImportFile(picked.contents,picked.path):null;
}
export async function readWorkflowIndexRegistration(root:string,entry:WorkflowIndexEntry,version:"v1"|"v2"){
 const relative=entry.versions[version];if(!relative||!isLocalWorkflowPath(root)||!isSafeRelativeWorkflowName(relative))throw new Error("workflow_index_explicit_entry_required");
 const text=await invoke<string>("comfy_workflow_read_library_entry",{root,relativePath:relative});
 const draft=parseWorkflowRegistrationFile(text,`${root}/${relative}`);
 if((version==="v2")!==Boolean(draft.selectionEnvelope))throw new Error("workflow_index_contract_version_mismatch");
 return {draft,expectedGraphSha256:entry.graphSha256};
}
