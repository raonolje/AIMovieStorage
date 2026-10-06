import {z} from "zod";
import {invoke} from "@tauri-apps/api/core";
import {listControlAssets,controlMediaTarget} from "./controlMedia";
import {readProject} from "./projectWrite";
import {getProjectSnapshot,ProjectControlError} from "./projectControl";
import {projectFolderName} from "./localProjectStore";
import {saveProjectMediaAsset,releaseEmptyProjectAsset,safeFileName} from "./mediaLibrary";
import {enqueueTaskOperation,registerTaskRunner,isStopping,setTaskResult,getTaskByOperationId,whenTaskJournalReady} from "./taskQueue";
const id=z.string().min(1).max(200),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const protectedEditSchema=z.object({projectId:id,expectedRevision:id,operationId:id,target:z.object({kind:z.literal("cut"),id}).strict(),mode:z.enum(["compose","erase-text"]),sourceImageAssetId:id,selectionMaskAssetId:id,protectionMaskAssetId:id,replacementImageAssetId:id.optional(),sourceSha256:sha,selectionSha256:sha,protectionSha256:sha,replacementSha256:sha.optional(),width:z.number().int().min(16).max(8192),height:z.number().int().min(16).max(8192),maskCoordinates:z.discriminatedUnion("space",[z.object({space:z.literal("native")}).strict(),z.object({space:z.literal("crop"),x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).strict()]),requiredText:z.enum(["내 시간","한국사"]).optional()}).strict();
export function validateProtectedEdit(input:z.infer<typeof protectedEditSchema>){
  if(input.width*input.height>20_000_000)throw new Error("unsupported_budget: 원본 2천만 픽셀 이내로 작업하세요.");
  const c=input.maskCoordinates;if(c.space==="crop"&&(c.x+c.width>input.width||c.y+c.height>input.height))throw new Error("crop_mapping_out_of_bounds");
  if(!!input.replacementImageAssetId!==!!input.replacementSha256)throw new Error("replacement_hash_required");
  if(input.mode==="compose"&&(!input.replacementImageAssetId||input.requiredText!==undefined))throw new Error("compose_requires_replacement_no_text_declaration");
  if(input.mode==="erase-text"&&!!input.replacementImageAssetId!==!!input.requiredText)throw new Error("exact_text_requires_declared_rgba_layer");
}
export function protectedEditStatus(){return invoke<{ready:boolean;blockers:string[];gpuUsed:false}>("protected_edit_status");}
async function validate(raw:unknown){
  const input=protectedEditSchema.parse(raw);validateProtectedEdit(input);const draft=readProject(input.projectId);if(!draft)throw new Error("프로젝트를 찾지 못했습니다.");
  const target=controlMediaTarget(draft,input.target);if((await getProjectSnapshot(input.projectId,"summary")).revision!==input.expectedRevision)throw new ProjectControlError("revision_conflict","프로젝트가 바뀌었습니다. 최신 revision으로 다시 요청하세요.");
  const assets=listControlAssets(input.projectId),owned=(assetId:string)=>{const a=assets.find(x=>x.id===assetId&&x.kind==="image");if(!a)throw new Error("invalid_asset: 같은 프로젝트 이미지 ID가 필요합니다.");return a;};
  return {input,draft,target,source:owned(input.sourceImageAssetId),selection:owned(input.selectionMaskAssetId),protection:owned(input.protectionMaskAssetId),replacement:input.replacementImageAssetId?owned(input.replacementImageAssetId):undefined};
}
export async function enqueueProtectedEdit(raw:unknown){
  const parsed=protectedEditSchema.parse(raw);validateProtectedEdit(parsed);await whenTaskJournalReady();const previous=getTaskByOperationId(parsed.operationId);
  if(previous){if(previous.kind!=="control.protected-edit"||JSON.stringify(previous.payload)!==JSON.stringify(parsed))throw new Error("operation_conflict");return enqueueTaskOperation({lane:"cpu",kind:previous.kind,projectId:previous.projectId,projectTitle:previous.projectTitle,label:previous.label,operationId:parsed.operationId,payload:previous.payload});}
  const {input,draft}=await validate(raw);const status=await protectedEditStatus();if(!status.ready)throw new Error("protected_edit_not_ready: "+status.blockers.join(", "));
  return enqueueTaskOperation({lane:"cpu",kind:"control.protected-edit",projectId:input.projectId,projectTitle:draft.title,label:"보호 마스크 CPU 편집",operationId:input.operationId,payload:input});
}
registerTaskRunner("control.protected-edit",async(raw,report,task)=>{
  if(isStopping(task.id))return;const {input,draft,target,source,selection,protection,replacement}=await validate(raw);
  const projectName=projectFolderName(input.projectId,draft.title),stem=safeFileName(target.stem)+"_보호편집";
  const reserved=await saveProjectMediaAsset(new File([new Uint8Array(0)],stem+".png",{type:"image/png"}),{projectName,assetType:target.assetType,ownerName:target.ownerName,stem});if(!reserved?.path)throw new Error("결과 자리를 마련하지 못했습니다.");
  try{if(isStopping(task.id))return;report({step:"원본 좌표·선택·보호 영역을 확인하고 CPU로 편집합니다"});
    const made=await invoke<{output:string;meta:Record<string,unknown>}>("protected_edit_run",{outputPath:reserved.path,request:{...input,sourceImage:source.path,selectionMask:selection.path,protectionMask:protection.path,...(replacement?{replacementImage:replacement.path}:{})}});
    const result={paths:[made.output],data:{meta:made.meta,attached:false,registrationRequired:true,cancelled:isStopping(task.id),qualityApproved:false,primaryChanged:false}};setTaskResult(task.id,result);return result;
  }finally{await releaseEmptyProjectAsset(projectName,reserved.path).catch(()=>undefined);}
});
