import { z } from "zod";
import { getProjectSnapshot, ProjectControlError } from "./projectControl";
import { inspectAndRegisterWorkflow, listWorkflowLibrary } from "./comfyWorkflowLibrary";
import { workflowSelectionSchema, workflowSourceSchema } from "./comfyWorkflowContract";
import { enqueueRegisteredWorkflow, reuseRegisteredWorkflow, workflowRunSchema } from "./comfyWorkflowRuntime";
import { voiceOptionBindingsSchema } from "./workflowVoiceOptions";
import { workflowSelectionV2Schema } from "./comfyWorkflowContractV2";
import {workflowProjectAuthorizationSchema} from "./workflowProjectAuthorization";
export const workflowAuthorizationControlSchema=workflowProjectAuthorizationSchema.extend({expectedRevision:z.string().min(1).max(200)}).strict();
export async function recordControlWorkflowAuthorization(raw:unknown){const {expectedRevision,...input}=workflowAuthorizationControlSchema.parse(raw);const current=(await import("./bgmProjects")).loadBgmProjects().some(project=>project.id===input.projectId)?await(await import("./controlBgm")).getBgmSnapshot(input.projectId):await getProjectSnapshot(input.projectId,"summary");if(current.revision!==expectedRevision)throw new ProjectControlError("revision_conflict","허가 기록 대상 프로젝트의 최신 판을 확인하세요.",{actualRevision:current.revision});return {recorded:await(await import("./comfyWorkflowLibrary")).recordWorkflowUserAuthorization(input),kind:"user-reported",independentLicenseVerification:false};}

export const workflowRegisterSchema=z.object({projectId:z.string().min(1).max(200).optional(),source:workflowSourceSchema,selection:workflowSelectionSchema,selectionEnvelope:workflowSelectionV2Schema.optional(),voiceOptionBindings:voiceOptionBindingsSchema.optional()}).strict();
export const workflowGenerateControlSchema=workflowRunSchema.extend({expectedRevision:z.string().min(1).max(200)});
export function listControlWorkflowLibrary() {
 return listWorkflowLibrary().map(entry=>({source:entry.source,selection:entry.selection,selectionEnvelope:entry.selectionEnvelope,voiceOptionBindings:entry.voiceOptionBindings,workflowSha256:entry.workflowSha256,manifest:entry.manifest,issues:entry.issues,checkedAtUtc:entry.checkedAtUtc,revisionId:entry.revisionId,originWorkflowId:entry.originWorkflowId,originalWorkflowPath:entry.originalWorkflowPath,projectScope:entry.projectScope,actualGenerationRegistration:entry.manifest?.verification.actualGenerationRegistration??"not-run"}));
}
export async function registerControlWorkflow(raw:unknown) {return inspectAndRegisterWorkflow(workflowRegisterSchema.parse(raw));}
export async function enqueueControlRegisteredWorkflow(raw:unknown) {
 const {expectedRevision,...input}=workflowGenerateControlSchema.parse(raw);
 const reused=await reuseRegisteredWorkflow(input);if(reused)return reused;
 const current=input.target.kind==="bgm"?await (await import("./controlBgm")).getBgmSnapshot(input.projectId):await getProjectSnapshot(input.projectId,"summary");
 if(current.revision!==expectedRevision)throw new ProjectControlError("revision_conflict","프로젝트가 바뀌었습니다. 최신 판을 읽고 다시 요청하세요.",{actualRevision:current.revision});
 return enqueueRegisteredWorkflow(input);
}
