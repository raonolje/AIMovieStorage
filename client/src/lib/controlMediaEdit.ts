import {z} from "zod";
import {invoke} from "@tauri-apps/api/core";
import {listControlAssets,controlMediaTarget} from "./controlMedia";
import {readProject} from "./projectWrite";
import {getProjectSnapshot,ProjectControlError} from "./projectControl";
import {projectFolderName} from "./localProjectStore";
import {saveProjectMediaAsset,releaseEmptyProjectAsset,safeFileName} from "./mediaLibrary";
import {enqueueTaskOperation,registerTaskRunner,isStopping,setTaskResult,getTaskByOperationId,whenTaskJournalReady} from "./taskQueue";
const id=z.string().min(1).max(200),sha=z.string().regex(/^[a-f0-9]{64}$/);
const source={sourceVideoAssetId:id,sourceCutId:id,sourceSha256:sha,sourceFrames:z.number().int().positive().max(6000)};
const segment=z.discriminatedUnion("kind",[
  z.object({...source,kind:z.literal("clip"),startFrame:z.number().int().nonnegative(),endFrameExclusive:z.number().int().positive()}).strict(),
  z.object({...source,kind:z.literal("hold"),frame:z.number().int().nonnegative(),frames:z.number().int().positive().max(6000),frameRgbSha256:sha,reviewDeclaration:z.literal("explicitly-reviewed-frame")}).strict(),
]);
export const mediaEditSchema=z.object({projectId:id,expectedRevision:id,operationId:id,target:z.object({kind:z.literal("cut"),id}).strict(),width:z.number().int().min(16).max(8192),height:z.number().int().min(16).max(8192),fps:z.object({numerator:z.number().int().positive().max(60000),denominator:z.number().int().positive().max(100000)}).strict(),segments:z.array(segment).min(1).max(32),expectedOutputFrames:z.number().int().positive().max(6000),audioPolicy:z.enum(["omit","clip-and-silence"]).default("clip-and-silence"),outputCodec:z.literal("h264-rgb-lossless").default("h264-rgb-lossless")}).strict();
export const mediaEditProbeSchema=z.object({projectId:id,sourceVideoAssetId:id,sourceCutId:id,selectedFrames:z.array(z.number().int().nonnegative().max(5999)).max(32).default([])}).strict();
export function validateMediaEdit(input:z.infer<typeof mediaEditSchema>){
  if(input.width%2||input.height%2||input.fps.numerator/input.fps.denominator>60)throw new Error("unsupported_video_spec");
  let total=0;const lastEnd=new Map<string,number>();
  input.segments.forEach((s,index)=>{
    if(s.kind==="clip"){
      if(s.endFrameExclusive<=s.startFrame||s.endFrameExclusive>s.sourceFrames)throw new Error("invalid_clip_interval");
      if(s.startFrame<(lastEnd.get(s.sourceSha256)??0))throw new Error("overlap_or_reverse_not_supported");
      lastEnd.set(s.sourceSha256,s.endFrameExclusive);total+=s.endFrameExclusive-s.startFrame;
    }else{
      const previous=input.segments[index-1];
      if(previous?.kind!=="clip"||previous.sourceVideoAssetId!==s.sourceVideoAssetId||s.frame!==previous.endFrameExclusive-1||s.sourceSha256!==previous.sourceSha256)throw new Error("hold_must_reference_previous_clip_last_frame");
      total+=s.frames;
    }
  });
  if(total!==input.expectedOutputFrames)throw new Error("expected_output_frames_mismatch");
  if(total>6000||input.width*input.height*total>150_000_000)throw new Error("cpu_frame_budget_exceeded");
}
function ownedVideo(projectId:string,assetId:string,cutId:string){
  const source=listControlAssets(projectId).find(a=>a.id===assetId&&a.kind==="video");
  if(!source||source.target?.kind!=="cut"||source.target.id!==cutId)throw new Error("invalid_asset_cut_association: 같은 프로젝트 컷의 영상 ID가 필요합니다.");
  return source;
}
export function mediaEditStatus(){return invoke<{ready:boolean;blockers:string[];gpuUsed:false}>("media_edit_status");}
export async function probeMediaEdit(raw:unknown){
  const input=mediaEditProbeSchema.parse(raw);const snapshot=await getProjectSnapshot(input.projectId,"summary");const source=ownedVideo(input.projectId,input.sourceVideoAssetId,input.sourceCutId);
  const result=await invoke<Record<string,unknown>>("media_edit_probe",{request:{operation:"probe",sourceVideo:source.path,selectedFrames:input.selectedFrames}});
  if((await getProjectSnapshot(input.projectId,"summary")).revision!==snapshot.revision)throw new ProjectControlError("revision_conflict","검사 중 프로젝트가 바뀌었습니다. 최신 상태에서 다시 읽으세요.");
  return {...result,projectId:input.projectId,sourceVideoAssetId:source.id,sourceCutId:input.sourceCutId,revision:snapshot.revision};
}
async function validate(raw:unknown){
  const input=mediaEditSchema.parse(raw);validateMediaEdit(input);const draft=readProject(input.projectId);if(!draft)throw new Error("프로젝트를 찾지 못했습니다.");const target=controlMediaTarget(draft,input.target);
  if((await getProjectSnapshot(input.projectId,"summary")).revision!==input.expectedRevision)throw new ProjectControlError("revision_conflict","최신 revision으로 편집을 요청하세요.");
  const segments=input.segments.map(s=>({...s,sourceVideo:ownedVideo(input.projectId,s.sourceVideoAssetId,s.sourceCutId).path}));
  return {input,draft,target,segments};
}
export async function enqueueMediaEdit(raw:unknown){
  const parsed=mediaEditSchema.parse(raw);validateMediaEdit(parsed);await whenTaskJournalReady();const previous=getTaskByOperationId(parsed.operationId);
  if(previous){if(previous.kind!=="control.media-edit"||JSON.stringify(previous.payload)!==JSON.stringify(parsed))throw new Error("operation_conflict");return enqueueTaskOperation({lane:"cpu",kind:previous.kind,projectId:previous.projectId,projectTitle:previous.projectTitle,label:previous.label,operationId:parsed.operationId,payload:previous.payload});}
  const {input,draft}=await validate(parsed);const status=await mediaEditStatus();if(!status.ready)throw new Error("media_edit_not_ready: "+status.blockers.join(", "));
  return enqueueTaskOperation({lane:"cpu",kind:"control.media-edit",projectId:input.projectId,projectTitle:draft.title,label:"원본 구간 연결·프레임 홀드",operationId:input.operationId,payload:input});
}
registerTaskRunner("control.media-edit",async(raw,report,task)=>{
  if(isStopping(task.id))return;const {input,draft,target,segments}=await validate(raw);
  const projectName=projectFolderName(input.projectId,draft.title),stem=safeFileName(target.stem)+"_구간편집";
  const reserved=await saveProjectMediaAsset(new File([new Uint8Array(0)],stem+".mp4",{type:"video/mp4"}),{projectName,assetType:"scene-video",ownerName:target.ownerName,stem});if(!reserved?.path)throw new Error("파생 영상 자리를 만들지 못했습니다.");
  try{if(isStopping(task.id))return;report({step:"원본 프레임·오디오 경계를 CPU로 검증하고 연결합니다"});
    const made=await invoke<{output:string;meta:Record<string,unknown>}>("media_edit_run",{outputPath:reserved.path,request:{...input,segments}});
    const result={paths:[made.output],data:{meta:made.meta,attached:false,registrationRequired:true,registrationTool:"media_register",registrationMakePrimary:false,cancelled:isStopping(task.id),qualityApproved:false,primaryChanged:false}};setTaskResult(task.id,result);return result;
  }finally{await releaseEmptyProjectAsset(projectName,reserved.path).catch(()=>undefined);}
});
