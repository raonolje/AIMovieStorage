import type {QueueTask} from "./taskQueue";

/** 전체 payload에는 graph나 개인 값이 있을 수 있어 표시할 결과 항목만 고릅니다. */
export function workflowTaskReceipt(task:QueueTask){
 const payload=task.payload as Record<string,unknown>|undefined;
 const snapshot=(payload?.workflowPayload??payload) as Record<string,unknown>|undefined;
 const checkpoint=task.externalCheckpoint,data=task.result?.data;
 if(checkpoint?.provider!=="comfyui"&&!snapshot?.workflowSha256&&!data?.workflowTarget&&!task.kind.startsWith("control.comfy")&&task.kind!=="comfy-workflow-generate")return undefined;
 const files=Array.isArray(checkpoint?.files)?checkpoint.files as {path?:unknown}[]:[];
 const paths=[...new Set([...(task.result?.paths??[]),...files.map(file=>file.path).filter((value):value is string=>typeof value==="string")])];
 const promptId=typeof data?.promptId==="string"?data.promptId:typeof checkpoint?.promptId==="string"?checkpoint.promptId:undefined;
 const phase=typeof checkpoint?.phase==="string"?checkpoint.phase:"waiting";
 const first=paths[0],separator=first?Math.max(first.lastIndexOf("/"),first.lastIndexOf("\\")):-1,folder=first&&separator>=0?first.slice(0,separator)||first.slice(0,1):undefined;
 const selected=snapshot?.input as {workflowTarget?:{workflowId?:string;roleId?:string;modelRuleId?:string}}|undefined;
 return {promptId,paths,folder,phase,workflowTarget:selected?.workflowTarget??data?.workflowTarget,baseUrl:typeof snapshot?.baseUrl==="string"?snapshot.baseUrl:undefined,
  registration:data?.attached===true?"registered":paths.length?"collected-unregistered":"unconfirmed",cancelled:Boolean(task.cancelRequestedAt||data?.cancelled||task.status==="stopped"),resubmissionBlocked:phase==="submitting"&&!promptId,error:task.error};
}
