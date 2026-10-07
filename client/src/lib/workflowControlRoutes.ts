import { z } from "zod";
import { workflowGenerateControlSchema, enqueueControlRegisteredWorkflow } from "./controlComfyWorkflow";
import { workflowEntryForTarget } from "./comfyWorkflowLibrary";
import { listControlAssets } from "./controlMedia";
import { reuseRegisteredWorkflow } from "./comfyWorkflowRuntime";

const id=z.string().min(1).max(200);
export const explicitComfyGenerateSchema=workflowGenerateControlSchema.extend({kind:z.enum(["image","video"]).optional()});
export async function enqueueExplicitComfy(raw:unknown){
 const {kind,...input}=explicitComfyGenerateSchema.parse(raw);const {expectedRevision:_,...generationInput}=input;const reused=await reuseRegisteredWorkflow(generationInput);if(reused)return reused;const entry=workflowEntryForTarget(input.workflowTarget);
 if(entry.source.outputKind==="audio"||kind&&entry.source.outputKind!==kind)throw new Error("workflow_output_target_mismatch: 이미지·영상 역할을 선택하세요.");
 return enqueueControlRegisteredWorkflow(input);
}
export const explicitMaskedComposeSchema=workflowGenerateControlSchema.extend({baseAssetId:id,replacementAssetId:id,maskAssetId:id,baseSlotId:id,replacementSlotId:id,maskSlotId:id});
export async function enqueueExplicitMaskedCompose(raw:unknown){
 const {baseAssetId,replacementAssetId,maskAssetId,baseSlotId,replacementSlotId,maskSlotId,...input}=explicitMaskedComposeSchema.parse(raw);
 if(new Set([baseAssetId,replacementAssetId,maskAssetId]).size!==3||new Set([baseSlotId,replacementSlotId,maskSlotId]).size!==3)throw new Error("workflow_mask_inputs_must_be_distinct");
 const entry=workflowEntryForTarget(input.workflowTarget);
 if(entry.source.outputKind!=="image"||!["composite","image-edit","inpaint"].includes(entry.source.operation))throw new Error("workflow_mask_operation_required: 검사한 이미지 편집·마스크 역할을 선택하세요.");
 const requireSlot=(id:string,semantic:string)=>{if(!entry.selection.slots.some(slot=>slot.id===id&&slot.semantic===semantic))throw new Error(`workflow_mask_slot_mismatch: ${id}/${semantic}`);};
 requireSlot(baseSlotId,"sourceImage");requireSlot(replacementSlotId,"sourceImage");requireSlot(maskSlotId,"maskImage");
 const registered=listControlAssets(input.projectId);
 for(const assetId of [baseAssetId,replacementAssetId,maskAssetId])if(registered.find(asset=>asset.id===assetId)?.kind!=="image")throw new Error("workflow_registered_reference_missing: 같은 프로젝트의 이미지 자산을 선택하세요.");
 const assets={...input.assets};
 for(const [slotId,assetId] of [[baseSlotId,baseAssetId],[replacementSlotId,replacementAssetId],[maskSlotId,maskAssetId]]){
  if(assets[slotId]&&assets[slotId]!==assetId)throw new Error("workflow_mask_input_conflict");assets[slotId]=assetId;
 }
 return enqueueControlRegisteredWorkflow({...input,assets});
}
