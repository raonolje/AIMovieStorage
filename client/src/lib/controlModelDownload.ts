import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enqueueTaskOperation, isStopping, registerTaskRunner } from "./taskQueue";
export const controlModelDownloadSchema = z.object({operationId:z.string().trim().min(1).max(300),engine:z.literal("ltx25"),repo:z.literal("Lightricks/LTX-2.5"),component:z.enum(["transformer","text_encoder","video_vae","audio_vae","spatial_upsampler"])}).strict();
export async function enqueueControlModelDownload(raw:unknown){const input=controlModelDownloadSchema.parse(raw);return enqueueTaskOperation({lane:"download",kind:"control.model.download",projectId:"settings",projectTitle:"Native models",label:"LTX-2.5 "+input.component,operationId:input.operationId,payload:input});}
interface Progress {transferId:string;component:string;percent:number|null;message?:string}
registerTaskRunner("control.model.download",async(raw,report,task)=>{
    const input=controlModelDownloadSchema.parse(raw);if(isStopping(task.id))return;
    const unlisten=await listen<Progress>("model-download-progress",({payload})=>{if(payload.transferId!==task.id || payload.component!==input.component)return;report({step:payload.message||"Native model download",progress:payload.percent===null?undefined:Math.min(1,Math.max(0,payload.percent/100))});});
    let timer:ReturnType<typeof setInterval>|undefined;let sent=false;
    try{if(isStopping(task.id))return;const pending=invoke<Record<string,unknown>>("model_component_download",{engine:input.engine,repo:input.repo,component:input.component,transferId:task.id});
        timer=setInterval(()=>{if(isStopping(task.id)&&!sent){sent=true;void invoke<boolean>("model_component_download_cancel",{transferId:task.id}).then(found=>{if(!found)sent=false;}).catch(()=>{sent=false;});}},200);
        return {data:{...await pending,modelInstalled:false,generationEnabled:false}};
    }finally{if(timer!==undefined)clearInterval(timer);unlisten();}
});

export const controlModelInspectSchema=controlModelDownloadSchema.omit({operationId:true});
export async function inspectControlModel(raw:unknown){return invoke("model_component_inspect",controlModelInspectSchema.parse(raw));}
