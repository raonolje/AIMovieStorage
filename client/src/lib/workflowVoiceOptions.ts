import { z } from "zod";
import { VOICE_AGE_RANGES, VOICE_CATEGORIES, VOICE_GENDERS, VOICE_LANGUAGES, VOICE_MODELS, VOICE_SPEAKERS, voiceInstruction } from "./voiceGeneration";
import type { WorkflowSelection, WorkflowScalar } from "./comfyWorkflowContract";

export const workflowVoiceOptionsSchema=z.object({model:z.enum(VOICE_MODELS).optional(),speaker:z.enum(VOICE_SPEAKERS).optional(),language:z.enum(VOICE_LANGUAGES).optional(),category:z.enum(VOICE_CATEGORIES).optional(),gender:z.enum(VOICE_GENDERS).optional(),ageRange:z.enum(VOICE_AGE_RANGES).optional(),traits:z.string().trim().max(500).optional()}).strict();
export type WorkflowVoiceOptions=z.infer<typeof workflowVoiceOptionsSchema>;
export const voiceOptionBindingsSchema=z.object({model:z.string().min(1).max(200).optional(),speaker:z.string().min(1).max(200).optional(),category:z.string().min(1).max(200).optional(),gender:z.string().min(1).max(200).optional(),ageRange:z.string().min(1).max(200).optional(),traits:z.string().min(1).max(200).optional(),actingProfile:z.string().min(1).max(200).optional()}).strict();
export type VoiceOptionBindings=z.infer<typeof voiceOptionBindingsSchema>;
export type VoiceWorkflowContract={selection:WorkflowSelection;voiceOptionBindings?:VoiceOptionBindings};
export const VOICE_OPTION_LABELS:Record<keyof WorkflowVoiceOptions,string>={model:"모델 옵션",speaker:"고정 화자",language:"대사 언어",category:"연기 분야",gender:"목소리 성별",ageRange:"목소리 나이대",traits:"음색·연기 톤"};

export function validateVoiceOptionBindings(contract:VoiceWorkflowContract){
 const bindings=voiceOptionBindingsSchema.parse(contract.voiceOptionBindings??{}),seen=new Set<string>();
 for(const [option,id] of Object.entries(bindings)){
  const allowed=option==="actingProfile"?["voiceProfile"]:option==="speaker"?["value","voiceProfile"]:["value"];
  if(seen.has(id)||!contract.selection.slots.some(slot=>slot.id===id&&allowed.includes(slot.semantic)))throw new Error(`workflow_voice_binding_invalid: ${option}/${id}. 추가 옵션은 각각 명시 의미 슬롯에 연결하세요.`);
  seen.add(id);
 }
 return bindings;
}
export function voiceWorkflowSupport(contract:VoiceWorkflowContract):Set<keyof WorkflowVoiceOptions>{
 const bindings=validateVoiceOptionBindings(contract),support=new Set<keyof WorkflowVoiceOptions>(Object.keys(bindings).filter(key=>key!=="actingProfile") as (keyof WorkflowVoiceOptions)[]);
 if(contract.selection.slots.some(slot=>slot.semantic==="language"))support.add("language");
 if(bindings.actingProfile||contract.selection.slots.some(slot=>slot.semantic==="text"))for(const key of ["category","gender","ageRange","traits"] as const)support.add(key);
 return support;
}
/** 옵션을 노드 이름으로 추측하면 무시되거나 다른 입력을 바꾸므로 등록한 의미만 사용합니다. */
export function applyWorkflowVoiceOptions(contract:VoiceWorkflowContract,raw:WorkflowVoiceOptions,original:Record<string,WorkflowScalar>){
 const options=workflowVoiceOptionsSchema.parse(raw),bindings=validateVoiceOptionBindings(contract),support=voiceWorkflowSupport(contract),values={...original};
 for(const key of Object.keys(options) as (keyof WorkflowVoiceOptions)[])if(options[key]!==undefined&&!support.has(key))throw new Error(`workflow_voice_option_unsupported: ${VOICE_OPTION_LABELS[key]}. 이 역할에는 연결된 의미 슬롯이 없습니다.`);
 const set=(id:string,value:WorkflowScalar)=>{if(values[id]!==undefined&&values[id]!==value)throw new Error(`workflow_option_conflict: ${id}. 화면 옵션과 직접 입력이 다릅니다.`);values[id]=value;};
 for(const [key,id] of Object.entries(bindings)) {if(key==="actingProfile")continue;const value=options[key as keyof WorkflowVoiceOptions];if(value!==undefined)set(id,value);}
 if(options.language!==undefined)for(const slot of contract.selection.slots.filter(slot=>slot.semantic==="language"))set(slot.id,options.language);
 if([options.category,options.gender,options.ageRange,options.traits].some(value=>value!==undefined)){
  const instruction=voiceInstruction(options.category??"actor",options.traits??"",options.language??"Korean",options.gender??"unspecified",options.ageRange??"unspecified");
  if(bindings.actingProfile)set(bindings.actingProfile,instruction);
 }
 return values;
}

/** text 슬롯이 선언되면 대사는 그대로 text로, positive 역할에는 연기 지시를 전달합니다. */
export function bindWorkflowVoiceDialogue(contract:VoiceWorkflowContract,dialogue:string,options:WorkflowVoiceOptions,original:Record<string,WorkflowScalar>){
 const body=contract.selection.slots.filter(slot=>slot.semantic==="text"),values={...original};
 if(!body.length)return {prompt:dialogue,values};
 for(const slot of body){if(values[slot.id]!==undefined&&values[slot.id]!==dialogue)throw new Error(`workflow_option_conflict: ${slot.id}. 대사 본문과 직접 값이 다릅니다.`);values[slot.id]=dialogue;}
 return {prompt:voiceInstruction(options.category??"actor",options.traits??"",options.language??"Korean",options.gender??"unspecified",options.ageRange??"unspecified"),values};
}
