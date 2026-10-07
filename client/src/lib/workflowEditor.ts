import {workflowSourceSchema,workflowSelectionSchema,workflowSemanticSchema,type WorkflowGraph,type WorkflowSource,type WorkflowSelection} from "./comfyWorkflowContract";
import {validateVoiceOptionBindings,type VoiceOptionBindings} from "./workflowVoiceOptions";
import {workflowSelectionV2Schema,type WorkflowSelectionV2} from "./comfyWorkflowContractV2";

export interface WorkflowEditorDraft{source:WorkflowSource;selection:WorkflowSelection;selectionEnvelope?:WorkflowSelectionV2;voiceOptionBindings?:VoiceOptionBindings}
export const WORKFLOW_SEMANTICS=workflowSemanticSchema.options;
export function readEditableApiGraph(text:string):WorkflowGraph{
 const raw=JSON.parse(text) as Record<string,unknown>;
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Array.isArray(raw.nodes)||!Object.keys(raw).length||Object.keys(raw).length>2000)throw new Error("workflow_api_export_required: Comfy에서 API 형식으로 내보낸 JSON을 선택하세요.");
 for(const [id,value] of Object.entries(raw)){const node=value as WorkflowGraph[string];if(!/^[a-z0-9_-]{1,200}$/i.test(id)||!node||typeof node.class_type!=="string"||!node.inputs||typeof node.inputs!=="object"||Array.isArray(node.inputs))throw new Error("workflow_invalid_api_graph");}
 return raw as WorkflowGraph;
}
export function editableWorkflowFields(graph:WorkflowGraph){
 return Object.entries(graph).flatMap(([nodeId,node])=>Object.keys(node.inputs).filter(input=>!/password|credential|authorization|api.?key|token|secret/i.test(input)).map(input=>({nodeId,input,classType:node.class_type,label:`${nodeId} · ${node.class_type} · ${input}`})));
}
/** 모델·역할·출력은 자동 추측하지 않고 사용자 선택 전까지 검사 불가능한 초안으로 둡니다. */
export function newWorkflowEditorDraft(text:string,workflowPath:string):WorkflowEditorDraft{
 readEditableApiGraph(text);
 const title=workflowPath.replace(/\\/g,"/").split("/").pop()?.replace(/\.json$/i,"")||"workflow";
 return {source:{workflowId:`workflow-${crypto.randomUUID()}`,workflowPath,title,sourceVersion:"사용자 편집 초안",modelIds:[],outputKind:"" as WorkflowSource["outputKind"],operation:"" as WorkflowSource["operation"],promptProfile:"",limitations:[],evidence:[]},selection:{slots:[],promptRoles:[],selectedPromptRoleId:"",outputNodeIds:[],referenceGroups:[]}};
}
export function normalizeWorkflowEditorDraft(draft:WorkflowEditorDraft):WorkflowEditorDraft{
 const selection=workflowSelectionSchema.parse(draft.selection);
 const selected=selection.promptRoles.find(role=>role.id===selection.selectedPromptRoleId);
 if(!selected)throw new Error("workflow_prompt_role_required: 프롬프트 역할을 직접 선택하세요.");
 const source=workflowSourceSchema.parse({...draft.source,modelIds:[...new Set(selection.promptRoles.map(role=>role.modelRuleId))],promptProfile:selected.modelRuleId});
 const voiceOptionBindings=draft.voiceOptionBindings?validateVoiceOptionBindings({selection,voiceOptionBindings:draft.voiceOptionBindings}):undefined;
 if(voiceOptionBindings&&source.operation!=="tts")throw new Error("workflow_voice_binding_operation_mismatch");
 const selectionEnvelope=draft.selectionEnvelope?workflowSelectionV2Schema.parse(draft.selectionEnvelope):undefined;
 if(selectionEnvelope&&(JSON.stringify(selectionEnvelope.base)!==JSON.stringify(selection)||JSON.stringify(workflowSelectionSchema.parse(JSON.parse(selectionEnvelope.originalV1SelectionJson)))!==JSON.stringify(selectionEnvelope.base)))throw new Error("v2_registration_selection_mismatch: 보존한 V2 역할과 편집한 선택이 다릅니다. 계약을 명시적으로 다시 검사하세요.");
 return {source,selection,selectionEnvelope,voiceOptionBindings};
}

/** 같은 의미·미디어의 미연결 슬롯만 그룹화합니다. 혼합 참조를 이미지로 추측하지 않습니다. */
export function fixedWorkflowReferenceGroups(selection:WorkflowSelection){
 const assigned=new Set(selection.referenceGroups.flatMap(group=>group.slotIds));
 const media:Partial<Record<WorkflowSelection["slots"][number]["semantic"],"image"|"video"|"audio">>={identityImage:"image",sourceImage:"image",firstFrame:"image",endFrame:"image",maskImage:"image",poseImage:"image",depthImage:"image",cameraGuide:"video",sourceVideo:"video",maskVideo:"video",poseVideo:"video",depthVideo:"video",audio:"audio",voiceReference:"audio"};
 const groups=new Map<WorkflowSelection["slots"][number]["semantic"],WorkflowSelection["slots"]>();
 for(const slot of selection.slots){if(!media[slot.semantic]||assigned.has(slot.id))continue;const list=groups.get(slot.semantic)??[];list.push(slot);groups.set(slot.semantic,list);}
 return [...groups].map(([semantic,slots])=>({id:`references-${semantic}-${selection.referenceGroups.length+1}`,role:semantic,mediaKind:media[slots[0].semantic]!,minItems:slots.length,maxItems:slots.length,slotIds:slots.map(slot=>slot.id),strategy:"fixed-slots" as const,order:"explicit" as const,identity:semantic==="identityImage"?(slots.length===1?"single" as const:"multiple" as const):"none" as const}));
}
