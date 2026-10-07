import {appPromptSelection} from "./appPromptRequest";
import {promptStamp} from "./promptModelSelection";
import {workflowEntryForTarget} from "./comfyWorkflowLibrary";
import {workflowSha256} from "./comfyWorkflowInspection";
import {workflowInputSelectionSchema,type WorkflowInputSelection,type WorkflowRunInput} from "./workflowRunContract";
import {prepareWorkflowQueuePayload,workflowReferenceSnapshot,type WorkflowQueuePayload} from "./comfyWorkflowRuntime";
import {getMediaLibrarySettings} from "./mediaLibrary";
import {getTask,listTasks,saveTaskExternalCheckpoint,type QueueTask} from "./taskQueue";
import {heroImageOf} from "./cutVideoPrompt";
import type {ProjectDraft,Scene} from "./projectTypes";

export type SceneWorkflowPreparation={schemaVersion:1;token:string;projectId:string;sceneId:string;projectName:string;baseDirectory:string;baseUrl:string;workflowTarget:WorkflowRunInput["workflowTarget"];manifestSha256:string;selectionStamp:string;sourceJson:string;inputs:WorkflowInputSelection;referenceFactsSha256:string;originalPrompt:{videoEn:string;videoKo:string;boardEn:string;boardKo:string;boardPath:string};operationId:string;firstFrameSlot?:{id:string;groupId?:string}};
export type ScenePreparationReceipt={token:string;sceneId:string;storyboardPath:string;storyboardPromptEn:string;storyboardPromptKo:string;firstFrameAssetId?:string};
function sourceJson(scene:Scene){const value=structuredClone(scene) as unknown as Record<string,unknown>;delete value.videos;delete value.storyboardPath;delete value.storyboardAt;value.storyboardPromptEn=value.storyboardPromptEn??"";value.storyboardPromptKo=value.storyboardPromptKo??"";for(const cut of value.cuts as Record<string,unknown>[]){delete cut.images;}return JSON.stringify(value);}
export async function freezeSceneWorkflowPreparation(draft:ProjectDraft,scene:Scene,projectId:string,projectName:string,baseUrl:string):Promise<SceneWorkflowPreparation>{
 const selection=appPromptSelection(draft,{kind:"sceneVideo",sceneId:scene.id});if(!selection.workflowTarget)throw new Error("workflow_role_required");const entry=workflowEntryForTarget(selection.workflowTarget);if((entry.projectScope??entry.manifest.projectId)&& (entry.projectScope??entry.manifest.projectId)!==projectId)throw new Error("workflow_authorization_project_mismatch");const scenePrompt=scene as Scene&{videoPromptEn?:string;videoPromptKo?:string};
 const inputs=workflowInputSelectionSchema.parse(scene.videoWorkflowInputs??{}),frames=entry.selection.slots.filter(s=>s.semantic==="firstFrame"),frame=frames.length===1?frames[0]:undefined,group=frame?entry.selection.referenceGroups.find(g=>g.slotIds.includes(frame.id)):undefined;
 const firstFrameSlot=frame&&!(inputs.assets[frame.id]||(group&&inputs.referenceGroups[group.id]?.length))&&(!group||group.slotIds.length===1)?{id:frame.id,...(group?{groupId:group.id}:{})}:undefined;
 const facts=await workflowReferenceSnapshot({projectId,target:{kind:"scene",id:scene.id},workflowTarget:selection.workflowTarget,...inputs});
 return {schemaVersion:1,token:crypto.randomUUID(),projectId,sceneId:scene.id,projectName,baseDirectory:getMediaLibrarySettings().baseDirectory.trim(),baseUrl,workflowTarget:structuredClone(selection.workflowTarget),manifestSha256:await workflowSha256(JSON.stringify(entry.manifest)),selectionStamp:promptStamp(selection),sourceJson:sourceJson(scene),inputs:structuredClone(inputs),referenceFactsSha256:await workflowSha256(JSON.stringify(facts)),originalPrompt:{videoEn:scenePrompt.videoPromptEn??"",videoKo:scenePrompt.videoPromptKo??"",boardEn:scene.storyboardPromptEn??"",boardKo:scene.storyboardPromptKo??"",boardPath:scene.storyboardPath??""},operationId:`batch-${crypto.randomUUID()}`,firstFrameSlot};
}
export function assertScenePreparationSource(prep:SceneWorkflowPreparation,draft:ProjectDraft,receipt?:ScenePreparationReceipt){
 const scene=draft.scenes.find(s=>s.id===prep.sceneId);if(!scene)throw new Error("workflow_preparation_target_missing");const copy=structuredClone(scene);
 if(!receipt&&(scene.storyboardPath??"")!==prep.originalPrompt.boardPath)throw new Error("workflow_preparation_inputs_changed");
 if(receipt){if(receipt.token!==prep.token||receipt.sceneId!==prep.sceneId||scene.storyboardPath!==receipt.storyboardPath||scene.storyboardPromptEn!==receipt.storyboardPromptEn||scene.storyboardPromptKo!==receipt.storyboardPromptKo||(prep.firstFrameSlot&&scene.cuts.map(c=>heroImageOf(c)).find(image=>image?.filePath)?.id!==receipt.firstFrameAssetId))throw new Error("workflow_preparation_result_changed");copy.storyboardPromptEn=prep.originalPrompt.boardEn;copy.storyboardPromptKo=prep.originalPrompt.boardKo;}
 if(sourceJson(copy)!==prep.sourceJson||JSON.stringify(workflowInputSelectionSchema.parse(scene.videoWorkflowInputs??{}))!==JSON.stringify(prep.inputs)||promptStamp(appPromptSelection(draft,{kind:"sceneVideo",sceneId:prep.sceneId}))!==prep.selectionStamp)throw new Error("workflow_preparation_inputs_changed: 대기 중 역할·본문·참조·scalar 또는 장면 입력이 바뀌었습니다. 새 작업으로 요청하세요.");
 return scene;
}
export function scenePreparationReceipt(prep:SceneWorkflowPreparation,scene:Scene):ScenePreparationReceipt {
 const first=scene.cuts.map(c=>heroImageOf(c)).find(image=>image?.filePath);
 return {token:prep.token,sceneId:scene.id,storyboardPath:scene.storyboardPath!,storyboardPromptEn:scene.storyboardPromptEn!,storyboardPromptKo:scene.storyboardPromptKo!,firstFrameAssetId:first?.id};
}
export async function finalizeSceneWorkflowPreparation(prep:SceneWorkflowPreparation,draft:ProjectDraft,task:QueueTask):Promise<WorkflowQueuePayload>{
 const checkpoint=getTask(task.id)?.externalCheckpoint,previous=checkpoint?.preparedWorkflowPayload as WorkflowQueuePayload|undefined;
 const receipt=(previous?checkpoint?.scenePreparationReceipt:listTasks({projectId:prep.projectId}).find(t=>t.kind==="sceneBoard"&&t.status==="done"&&(t.payload as {workflowPreparation?:SceneWorkflowPreparation})?.workflowPreparation?.token===prep.token)?.result?.data?.scenePreparationReceipt) as ScenePreparationReceipt|undefined;
 if(!receipt)throw new Error("workflow_preparation_not_confirmed: 앞 스토리보드 작업의 저장 확인 결과가 필요합니다.");assertScenePreparationSource(prep,draft,receipt);
 const entry=workflowEntryForTarget(prep.workflowTarget);if(await workflowSha256(JSON.stringify(entry.manifest))!==prep.manifestSha256)throw new Error("workflow_preparation_manifest_changed");
 const facts=await workflowReferenceSnapshot({projectId:prep.projectId,target:{kind:"scene",id:prep.sceneId},workflowTarget:prep.workflowTarget,...prep.inputs});if(await workflowSha256(JSON.stringify(facts))!==prep.referenceFactsSha256)throw new Error("workflow_preparation_reference_changed");
 if(previous)return previous;
 const inputs=structuredClone(prep.inputs);if(prep.firstFrameSlot){if(!receipt.firstFrameAssetId)throw new Error("workflow_prepared_first_frame_missing");if(prep.firstFrameSlot.groupId)inputs.referenceGroups[prep.firstFrameSlot.groupId]=[receipt.firstFrameAssetId];else inputs.assets[prep.firstFrameSlot.id]=receipt.firstFrameAssetId;}
 const prompt=prep.originalPrompt.videoEn||prep.originalPrompt.videoKo||receipt.storyboardPromptEn||receipt.storyboardPromptKo;
 const payload=await prepareWorkflowQueuePayload({projectId:prep.projectId,target:{kind:"scene",id:prep.sceneId},workflowTarget:prep.workflowTarget,operationId:prep.operationId,prompt,...inputs});
 if(payload.baseUrl!==prep.baseUrl||payload.baseDirectory!==prep.baseDirectory||payload.projectName!==prep.projectName)throw new Error("workflow_preparation_destination_changed");
 await saveTaskExternalCheckpoint(task.id,{...checkpoint,provider:"comfyui",phase:"prepared",preparedWorkflowPayload:payload,scenePreparationReceipt:receipt});return payload;
}
