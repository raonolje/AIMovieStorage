import {z} from "zod";
import {invoke} from "@tauri-apps/api/core";
const id=z.string().min(1).max(200),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const workflowAuthorizationFileSchema=z.object({category:id,name:z.string().min(1).max(500),sha256:sha}).strict();
export const workflowAuthorizationStatementSchema=z.object({kind:z.literal("user-reported"),evidence:z.string().min(1).max(4000).refine(text=>text.trim().length>0,"명시한 사용자 진술이 필요합니다."),sourceThreadId:id,reportedAtUtc:z.string().datetime()}).strict();
export const workflowProjectAuthorizationSchema=z.object({projectId:id,presetId:id,modelRuleId:id,registrySha256:sha,files:z.array(workflowAuthorizationFileSchema).min(1).max(256),statement:workflowAuthorizationStatementSchema}).strict();
export const workflowAuthorizationOptionsSchema=z.object({registrySha256:sha,presets:z.array(z.object({id,modelRuleId:id,files:z.array(workflowAuthorizationFileSchema)}).strict())}).strict();
/** App-packaged readonly options; imported entry/INDEX and caller license booleans cannot supply these facts. */
export async function readWorkflowAuthorizationOptions(){return workflowAuthorizationOptionsSchema.parse(await invoke("comfy_workflow_authorization_options"));}
