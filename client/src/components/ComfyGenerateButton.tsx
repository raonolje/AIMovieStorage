import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Workflow, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { isDesktopApp } from "@/lib/llm";
import { listLocalProjects } from "@/lib/localProjectStore";
import { listControlAssets } from "@/lib/controlMedia";
import { listWorkflowLibrary } from "@/lib/comfyWorkflowLibrary";
import { enqueueRegisteredWorkflow, savedWorkflowInputs, saveWorkflowInputs, type WorkflowRunInput } from "@/lib/comfyWorkflowRuntime";
import { loadBgmProjects } from "@/lib/bgmProjects";
import { stopTask, useTaskQueue } from "@/lib/taskQueue";
import type { ComfyKind, ComfyReference } from "@/lib/comfyGeneration";
import type { ProjectAssetType } from "@/lib/mediaLibrary";
import type { LocalPromptInput } from "@/lib/localPrompt";
import type { WorkflowPromptTarget } from "@/lib/promptModelSelection";
import type { WorkflowScalar } from "@/lib/comfyWorkflowContract";
import type { WorkflowVoiceOptions } from "@/lib/workflowVoiceOptions";

export default function ComfyGenerateButton(props:{
 kind:ComfyKind;prompt:LocalPromptInput;references?:ComfyReference[];firstFrame?:string;
 projectName:string;projectId?:string;assetType:ProjectAssetType;ownerName:string;stem:string;
 target?:WorkflowRunInput["target"];workflowTarget?:WorkflowPromptTarget;values?:Record<string,WorkflowScalar>;
 voiceOptions?:WorkflowVoiceOptions;
 onDone:(path:string,name:string)=>void;
}) {
 const t=useT(),[jobId,setJobId]=useState<string>(),[accepting,setAccepting]=useState(false);
 const [groups,setGroups]=useState<Record<string,string[]>>({}),[assets,setAssets]=useState<Record<string,string>>({}),[values,setValues]=useState<Record<string,WorkflowScalar>>({}),[roles,setRoles]=useState<WorkflowRunInput["rolePrompts"]>({});
 const jobs=useTaskQueue(),task=jobs.find(job=>job.id===jobId),busy=accepting||task?.status==="waiting"||task?.status==="running";
 const entry=listWorkflowLibrary().find(item=>item.source.workflowId===props.workflowTarget?.workflowId && (item.workflowSha256??item.manifest?.workflowSha256)===props.workflowTarget?.workflowSha256 && (item.manifest?.promptTarget.roleId??item.selection.selectedPromptRoleId)===props.workflowTarget?.roleId && item.selection.promptRoles.some(role=>role.id===props.workflowTarget?.roleId&&role.modelRuleId===props.workflowTarget?.modelRuleId));
 const projects=listLocalProjects().filter(project=>project.folder===props.projectName);
 const projectId=props.projectId??(projects.length===1?projects[0].id:undefined);
 let registered:ReturnType<typeof listControlAssets>=[];
 try { if(projectId&&props.target?.kind!=="bgm")registered=listControlAssets(projectId);else if(projectId)registered=loadBgmProjects().find(p=>p.id===projectId)?.tracks.flatMap(track=>track.resultPaths.map((path,index)=>({id:`${track.id}:result:${index}`,path,kind:"audio" as const,name:`${track.name} ${index+1}`}))) as typeof registered??[]; } catch { /* 저장 전 카드는 실행하지 않습니다. */ }
 const selectionKey=JSON.stringify(props.workflowTarget);
 useEffect(()=>{const stored=projectId&&props.target?savedWorkflowInputs(projectId,props.target,props.kind):{referenceGroups:{},assets:{},values:{},rolePrompts:{}};setGroups(stored.referenceGroups);setAssets(stored.assets);setValues(stored.values);setRoles(stored.rolePrompts);},[selectionKey,projectId,props.target?.id,props.kind]);
 if(!isDesktopApp())return null;
 const run=async()=>{
  if(busy)return;setAccepting(true);
  try {
   if(!projectId||!props.target||!props.workflowTarget)throw new Error(t("저장한 대상과 명시 workflow 역할이 필요합니다."));
   await saveWorkflowInputs(projectId,props.target,props.workflowTarget,props.kind,{referenceGroups:groups,assets,values,rolePrompts:roles});
   const result=await enqueueRegisteredWorkflow({projectId,target:props.target,workflowTarget:props.workflowTarget,operationId:'comfy-ui-'+crypto.randomUUID(),prompt:props.prompt.en?.trim()||props.prompt.ko?.trim()||"",negative:props.prompt.negativeEn||props.prompt.negativeKo||"",referenceGroups:groups,assets,values:{...props.values,...values},rolePrompts:roles,voiceOptions:props.voiceOptions,...(props.target.kind==="voice"?{voiceDialogue:props.prompt.en||props.prompt.ko||""}:{})});
   setJobId(result.jobId);toast.success(t("Comfy 생성을 작업 내역에 등록했습니다."));
  }catch(error){toast.error(String(error));}finally{setAccepting(false);}
 };
 const grouped=new Set(entry?.selection.referenceGroups.flatMap(group=>group.slotIds));
 const referenceSlots=entry?.selection.slots.filter(slot=>/^(firstFrame|endFrame|identityImage|sourceImage|sourceVideo|maskImage|maskVideo|poseImage|poseVideo|depthImage|depthVideo|cameraGuide|audio|voiceReference)$/.test(slot.semantic)&&!grouped.has(slot.id))??[];
 const choose=(kind:string,value:string,onChange:(value:string)=>void)=><select value={value} onChange={event=>onChange(event.target.value)} disabled={busy} className="max-w-[260px] rounded bg-black/30 p-1"><option value="">{t("등록 참조 선택")}</option>{registered.filter(asset=>asset.kind===kind).map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>;
 return <div className="inline-flex flex-wrap items-center gap-2 text-[10px]" data-tour="card-comfy-generate">
  {entry&&<details className="w-full rounded border border-white/10 p-2"><summary>{t("workflow 역할별 입력·참조·LoRA")}</summary>
   <button disabled={busy||!projectId||!props.target||!props.workflowTarget} onClick={()=>void saveWorkflowInputs(projectId!,props.target!,props.workflowTarget!,props.kind,{referenceGroups:groups,assets,values,rolePrompts:roles}).then(()=>toast.success(t("일괄 생성과 조종기도 사용할 입력을 저장했습니다."))).catch(error=>toast.error(String(error)))}>{t("입력 저장")}</button>
   <p className="my-2 text-white/60">{t("각 역할에 등록 참조를 순서대로 선택하세요. min/max에 맞는 고정 variant가 필요하며 초과·누락을 생략하지 않습니다. 설치 LoRA의 파일명·강도만 검사합니다.")}</p>
   {entry.selection.referenceGroups.map(group=><div key={group.id} className="my-2 space-y-1"><p>{group.id} · {group.role} · {group.minItems}–{group.maxItems} · {group.identity} · {group.strategy}</p>
    {(groups[group.id]??[]).map((assetId,index)=><div key={index} className="flex gap-1"><span>{index+1}</span>{choose(group.mediaKind,assetId,value=>setGroups(current=>({...current,[group.id]:(current[group.id]??[]).map((id,i)=>i===index?value:id)})))}<button disabled={busy} onClick={()=>setGroups(current=>({...current,[group.id]:(current[group.id]??[]).filter((_,i)=>i!==index)}))}>{t("목록에서 빼기")}</button></div>)}
    <button disabled={busy||(groups[group.id]?.length??0)>=group.maxItems} onClick={()=>setGroups(current=>({...current,[group.id]:[...(current[group.id]??[]),""]}))}>{t("참조 추가")}</button>
   </div>)}
   {referenceSlots.map(slot=><label className="my-2 flex gap-2" key={slot.id}>{slot.semantic} / {slot.id}{choose(/Image$|Frame$/.test(slot.semantic)?"image":slot.semantic==="audio"||slot.semantic==="voiceReference"?"audio":"video",assets[slot.id]??"",value=>setAssets(current=>({...current,[slot.id]:value})))}</label>)}
   {entry.selection.slots.filter(slot=>!["positive","negative","lyrics"].includes(slot.semantic)&&!referenceSlots.includes(slot)&&!grouped.has(slot.id)&&!(/Image$|Video$|Frame$/.test(slot.semantic))&&!['audio','voiceReference','cameraGuide'].includes(slot.semantic)).map(slot=><label className="my-2 flex gap-2" key={slot.id}>{slot.semantic} / {slot.id}<input disabled={busy} value={String(values[slot.id]??props.values?.[slot.id]??slot.defaultValue??"")} onChange={event=>setValues(current=>({...current,[slot.id]:typeof slot.defaultValue==="number"||['seed','width','height','fps','frameCount','durationSeconds','loraModelStrength','loraClipStrength'].includes(slot.semantic)?Number(event.target.value):typeof slot.defaultValue==="boolean"?event.target.value==="true":event.target.value}))} className="min-w-0 rounded bg-black/30 p-1"/></label>)}
   {entry.selection.promptRoles.filter(role=>role.id!==props.workflowTarget?.roleId).map(role=><label className="my-2 block" key={role.id}>{role.id} / {role.modelRuleId}<textarea disabled={busy} value={roles[role.id]?.positive??""} onChange={event=>setRoles(current=>({...current,[role.id]:{...current[role.id],positive:event.target.value}}))} className="w-full rounded bg-black/30 p-1"/></label>)}
  </details>}
  <button disabled={busy||!entry?.manifest||!projectId||!props.target||entry.selection.slots.some(slot=>slot.semantic==="maskVideo")} title={t("모든 검사를 통과한 명시 workflow로 생성·수집·등록합니다. 초안·미지원 maskVideo는 실행을 차단합니다.")} onClick={()=>void run()} className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1.5 text-emerald-200 disabled:opacity-40">{busy?<Loader2 className="h-3 w-3 animate-spin"/>:<Workflow className="h-3 w-3"/>}{t(busy?"Comfy 처리 중":"컴피로 뽑기")}</button>
  {entry?.selection.slots.some(slot=>slot.semantic==="maskVideo")&&<span className="text-amber-200">{t("maskVideo는 전체 CPU mask 규약 검사 미지원으로 등록·실행을 차단합니다.")}</span>}
  {entry&&!entry.manifest&&<span className="text-amber-200">{t("초안·실행 차단 / 검사 사유는 설정의 workflow 라이브러리에서 확인")}</span>}
  {props.workflowTarget&&!entry&&<span className="text-amber-200">{t("선택한 workflow 버전·hash·역할이 보존 기록과 다릅니다. 기존 문장은 유지되며 다시 선택해야 합니다.")}</span>}
  {task&&<span>{task.step||task.status} · {task.id}</span>}
  {busy&&task&&<button onClick={()=>stopTask(task.id)}>{t("대기 중지 (서버 작업 유지)")}</button>}
  {task?.status==="failed"&&<span className="text-red-300">{task.error}</span>}
 </div>;
}
