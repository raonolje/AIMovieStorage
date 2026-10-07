import { z } from "zod";
import { workflowScalarSchema } from "./comfyWorkflowContract";
import { workflowVoiceOptionsSchema } from "./workflowVoiceOptions";
const id=z.string().min(1).max(200);
export const workflowTargetSchema=z.object({kind:z.literal("workflow"),workflowId:id,workflowSha256:z.string().regex(/^[a-f0-9]{64}$/),roleId:id,modelRuleId:id}).strict();
export const workflowInputSelectionSchema=z.object({
 referenceGroups:z.record(id,z.array(id).max(64)).default({}),assets:z.record(id,id).default({}),
 values:z.record(id,workflowScalarSchema).default({}),rolePrompts:z.record(id,z.object({positive:z.string().min(1).max(32000),negative:z.string().max(32000).optional()}).strict()).default({}),
}).strict();
export const workflowRunSchema=workflowInputSelectionSchema.extend({projectId:id,operationId:id,target:z.object({kind:z.enum(["character","background","cut","scene","bgm","voice"]),id}).strict(),workflowTarget:workflowTargetSchema,prompt:z.string().trim().min(1).max(32000),negative:z.string().max(32000).optional(),voiceOptions:workflowVoiceOptionsSchema.optional(),voiceDialogue:z.string().min(1).max(32000).optional()}).strict();
export type WorkflowRunInput=z.infer<typeof workflowRunSchema>;
export type WorkflowInputSelection=z.infer<typeof workflowInputSelectionSchema>;
