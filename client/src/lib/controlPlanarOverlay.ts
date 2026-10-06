import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { listControlAssets, controlMediaTarget } from "./controlMedia";
import { readProject } from "./projectWrite";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { projectFolderName } from "./localProjectStore";
import { saveProjectMediaAsset, releaseEmptyProjectAsset, safeFileName } from "./mediaLibrary";
import { enqueueTaskOperation, registerTaskRunner, isStopping, setTaskResult, getTaskByOperationId, whenTaskJournalReady } from "./taskQueue";

const id=z.string().min(1).max(200),sha=z.string().regex(/^[a-f0-9]{64}$/);
const point=z.tuple([z.number().finite().nonnegative(),z.number().finite().nonnegative()]);
export const planarOverlaySchema=z.object({
  projectId:id,expectedRevision:id,operationId:id,target:z.object({kind:z.literal("cut"),id}).strict(),
  sourceVideoAssetId:id,replacementAssetId:id,sourceSha256:sha,replacementSha256:sha,
  width:z.number().int().min(16).max(8192),height:z.number().int().min(16).max(8192),
  fps:z.number().finite().positive().max(60),frames:z.number().int().positive().max(6000),
  coordinates:z.array(z.object({frame:z.number().int().nonnegative(),timeSeconds:z.number().finite().nonnegative().optional(),quad:z.tuple([point,point,point,point])}).strict()).min(1).max(6000),
  contentMode:z.enum(["non-text","exact-text"]),requiredText:z.literal("한국사").optional(),
}).strict();
export async function planarOverlayStatus(){return invoke<{ready:boolean;blockers:string[];gpuUsed:false}>("planar_overlay_status");}

export function validatePlanarCoordinates(input:z.infer<typeof planarOverlaySchema>){
  if(input.width%2||input.height%2)throw new Error("invalid_request: MP4 크기는 짝수여야 합니다.");
  if(input.width*input.height*input.frames>150_000_000)throw new Error("unsupported_budget: CPU 작업은 총 1.5억 픽셀 이내로 지정하세요.");
  if(input.coordinates.length!==input.frames)throw new Error("missing_quad: 모든 프레임 좌표가 필요합니다.");
  input.coordinates.forEach((item,index)=>{
    if(item.frame!==index||item.timeSeconds!==undefined&&Math.abs(item.timeSeconds-index/input.fps)>1e-6)throw new Error("frame_index_mismatch: 원본 순서·시각을 유지하세요.");
    const q=item.quad;
    if(q.some(([x,y])=>x>input.width-1||y>input.height-1))throw new Error("invalid_quad: 화면 밖 좌표입니다.");
    let area=0;
    for(let i=0;i<4;i++){
      const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];
      if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=0)throw new Error("invalid_quad: TL/TR/BR/BL 순서·교차·퇴화를 확인하세요.");
      area+=a[0]*b[1]-b[0]*a[1];
    }
    if(area/2<64||area/2>input.width*input.height*.95)throw new Error("invalid_quad: 평면 면적 범위가 맞지 않습니다.");
  });
  if(input.contentMode==="non-text"&&input.requiredText!==undefined||input.contentMode==="exact-text"&&input.requiredText!=="한국사")throw new Error("invalid_content: 비문자 화면과 한국사 표지 입력을 구분하세요.");
  if(input.target.id==="guho-cut-03-02"&&input.requiredText!=="한국사")throw new Error("invalid_content: S03 교과서 표지에는 정확히 한국사가 필요합니다.");
}

async function validate(raw:unknown,checkRevision=true){
  const input=planarOverlaySchema.parse(raw);validatePlanarCoordinates(input);
  const draft=readProject(input.projectId);if(!draft)throw new Error("프로젝트를 찾지 못했습니다.");
  const target=controlMediaTarget(draft,input.target);
  if(checkRevision&&(await getProjectSnapshot(input.projectId,"summary")).revision!==input.expectedRevision)throw new ProjectControlError("revision_conflict","프로젝트가 바뀌었습니다. 최신 revision으로 다시 요청하세요.");
  const assets=listControlAssets(input.projectId),source=assets.find(x=>x.id===input.sourceVideoAssetId&&x.kind==="video"),replacement=assets.find(x=>x.id===input.replacementAssetId&&x.kind==="image");
  if(!source||!replacement)throw new Error("invalid_asset: 같은 프로젝트의 영상·화면 그림을 골라 주세요.");
  return {input,draft,target,source,replacement};
}
export async function enqueuePlanarOverlay(raw:unknown){
  const parsed=planarOverlaySchema.parse(raw);validatePlanarCoordinates(parsed);await whenTaskJournalReady();
  const previous=getTaskByOperationId(parsed.operationId);
  if(previous){
    if(previous.kind!=="control.planar-overlay"||JSON.stringify(previous.payload)!==JSON.stringify(parsed))throw new Error("operation_conflict: 같은 작업 ID에 다른 입력을 보낼 수 없습니다.");
    return enqueueTaskOperation({lane:"cpu",kind:previous.kind,projectId:previous.projectId,projectTitle:previous.projectTitle,label:previous.label,operationId:parsed.operationId,payload:previous.payload});
  }
  const {input,draft}=await validate(raw);const status=await planarOverlayStatus();if(!status.ready)throw new Error("planar_not_ready: "+status.blockers.join(", "));
  return enqueueTaskOperation({lane:"cpu",kind:"control.planar-overlay",projectId:input.projectId,projectTitle:draft.title,label:"화면 평면 합성",operationId:input.operationId,payload:input});
}

registerTaskRunner("control.planar-overlay",async(raw,report,task)=>{
  if(isStopping(task.id))return;
  const {input,draft,target,source,replacement}=await validate(raw);
  const projectName=projectFolderName(input.projectId,draft.title),stem=safeFileName(target.stem)+"_화면합성";
  const reserved=await saveProjectMediaAsset(new File([new Uint8Array(0)],stem+".mp4",{type:"video/mp4"}),{projectName,assetType:"scene-video",ownerName:target.ownerName,stem});
  if(!reserved?.path)throw new Error("결과 자리를 만들지 못했습니다.");
  try{
    if(isStopping(task.id))return;
    report({step:"원본 해시·프레임·좌표를 확인하고 CPU로 합성합니다"});
    const made=await invoke<{output:string;meta:Record<string,unknown>}>("planar_overlay_run",{outputPath:reserved.path,request:{...input,sourceVideo:source.path,replacementImage:replacement.path}});
    setTaskResult(task.id,{paths:[made.output],data:{meta:made.meta,attached:false,qualityApproved:false}});
    // 작업 중 바뀐 프로젝트에 파생본을 자동 연결하지 않습니다. 품질 검수 전에는 공식 등록도 별도입니다.
    return {paths:[made.output],data:{meta:made.meta,attached:false,registrationRequired:true,cancelled:isStopping(task.id),qualityApproved:false,primaryChanged:false}};
  }finally{await releaseEmptyProjectAsset(projectName,reserved.path).catch(()=>undefined);}
});
