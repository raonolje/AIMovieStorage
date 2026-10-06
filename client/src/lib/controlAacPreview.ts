import {z} from "zod";
import {invoke} from "@tauri-apps/api/core";
import {listControlAssets,controlMediaTarget} from "./controlMedia";
import {readProject} from "./projectWrite";
import {getProjectSnapshot,ProjectControlError} from "./projectControl";
import {projectFolderName} from "./localProjectStore";
import {saveProjectMediaAsset,releaseEmptyProjectAsset,safeFileName} from "./mediaLibrary";
import {enqueueTaskOperation,registerTaskRunner,isStopping,setTaskResult,getTaskByOperationId,whenTaskJournalReady} from "./taskQueue";
const id=z.string().min(1).max(200);
export const aacPreviewSchema=z.object({projectId:id,expectedRevision:id,operationId:id,sourceVideoAssetId:id,sourceCutId:id,sourceSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function aacPreviewStatus(){return invoke<{ready:boolean;blockers:string[];gpuUsed:false}>("aac_preview_status");}
async function validate(raw:unknown){
  const input=aacPreviewSchema.parse(raw),draft=readProject(input.projectId);if(!draft)throw new Error("project_not_found");
  const target=controlMediaTarget(draft,{kind:"cut",id:input.sourceCutId});
  const source=listControlAssets(input.projectId).find(a=>a.id===input.sourceVideoAssetId&&a.kind==="video"&&a.target?.kind==="cut"&&a.target.id===input.sourceCutId);
  if(!source)throw new Error("invalid_asset_cut_association");
  if((await getProjectSnapshot(input.projectId,"summary")).revision!==input.expectedRevision)throw new ProjectControlError("revision_conflict","최신 프로젝트 revision이 필요합니다.");
  return {input,draft,target,source};
}
export async function enqueueAacPreview(raw:unknown){
  const parsed=aacPreviewSchema.parse(raw);await whenTaskJournalReady();const previous=getTaskByOperationId(parsed.operationId);
  if(previous){if(previous.kind!=="control.aac-preview"||JSON.stringify(previous.payload)!==JSON.stringify(parsed))throw new Error("operation_conflict");return enqueueTaskOperation({lane:"cpu",kind:previous.kind,projectId:previous.projectId,projectTitle:previous.projectTitle,label:previous.label,operationId:parsed.operationId,payload:previous.payload});}
  const {input,draft}=await validate(parsed),status=await aacPreviewStatus();if(!status.ready)throw new Error("aac_preview_not_ready: "+status.blockers.join(", "));
  return enqueueTaskOperation({lane:"cpu",kind:"control.aac-preview",projectId:input.projectId,projectTitle:draft.title,label:"AAC 미리보기 내보내기",operationId:input.operationId,payload:input});
}
registerTaskRunner("control.aac-preview",async(raw,report,task)=>{
  if(isStopping(task.id))return;const {input,draft,target,source}=await validate(raw);
  const projectName=projectFolderName(input.projectId,draft.title),stem=safeFileName(target.stem)+"_AAC미리보기";
  const reserved=await saveProjectMediaAsset(new File([new Uint8Array(0)],stem+".mp4",{type:"video/mp4"}),{projectName,assetType:"scene-video",ownerName:target.ownerName,stem});if(!reserved?.path)throw new Error("output_reservation_failed");
  try{
    if(isStopping(task.id))return;report({step:"영상 패킷 보존 · CPU AAC 압축 및 타임스탬프 검사"});
    const made=await invoke<{output:string;meta:Record<string,unknown>}>("aac_preview_run",{outputPath:reserved.path,request:{sourceVideo:source.path,sourceSha256:input.sourceSha256}});
    const result={paths:[made.output],data:{meta:made.meta,masterAssetId:source.id,masterSha256:input.sourceSha256,sourceCutId:input.sourceCutId,lossyAudio:true,attached:false,registrationRequired:true,registrationTool:"media_register",registrationPreviewJobId:task.id,registrationMakePrimary:false,cancelled:isStopping(task.id),qualityApproved:false,primaryChanged:false}};setTaskResult(task.id,result);return result;
  }finally{await releaseEmptyProjectAsset(projectName,reserved.path).catch(()=>undefined);}
});
