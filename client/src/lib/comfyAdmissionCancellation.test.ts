import { beforeEach, expect, it, vi } from "vitest";
import type { ComfyRunRequest } from "./comfyGeneration";
const state=vi.hoisted(()=>({stopped:false,invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:state.invoke}));
vi.mock("@/lib/llm",()=>({isDesktopApp:()=>true}));
vi.mock("@/lib/mediaLibrary",()=>({getMediaLibrarySettings:()=>({baseDirectory:"C:/cpu-only"}),registerMirrorSection:vi.fn(),queueMirrorWrite:vi.fn(),queueMirrorWriteAndConfirm:vi.fn()}));
import {runComfyToProject} from "./comfyGeneration";
const request=():ComfyRunRequest=>({kind:"video",prompt:"CPU only",baseDirectory:"C:/cpu-only",projectName:"CPU",assetType:"scene-video",ownerName:"CPU",stem:"CPU",workflowSha256:"a".repeat(64),settings:{baseUrl:"http://127.0.0.1:8190",image:{workflowPath:"",mappings:[],outputNodeIds:[]},video:{workflowPath:"",mappings:[],outputNodeIds:[]},audio:{workflowPath:"",mappings:[],outputNodeIds:[]}},shouldStop:()=>state.stopped,
 adapterPlan:{config:{workflowPath:"C:/cpu-only/workflow.api.json",mappings:[],outputNodeIds:["9"]},references:[],bindings:[],provenance:{workflowSha256:"a".repeat(64),manifestSha256:"b".repeat(64),promptTarget:{kind:"workflow",workflowId:"cpu",workflowSha256:"a".repeat(64),roleId:"primary",modelRuleId:"cpu"},assets:[],values:{},verification:{static:"passed",installedRequirements:"passed",actualGenerationRegistration:"not-run",executionAdmission:"required",checkedAtUtc:"2026-10-07T00:00:00Z"},weightAuthorizations:[]}},workflowManifest:{} as ComfyRunRequest["workflowManifest"]});
beforeEach(()=>{state.stopped=false;state.invoke.mockReset();state.invoke.mockImplementation(async(command:string)=>{
 if(command==="comfy_inspect_generation_workflow")return {sha256:"a".repeat(64),nodes:[]};
 if(command==="comfy_admit_generation")return {admissionToken:"cpu-only-token"};
 if(command==="comfy_revoke_generation_admission")return {revoked:true,serverJobCancelled:false};
 if(command==="comfy_submit_generation")return {promptId:"cpu-only-job"};
 if(command==="comfy_generation_status")return {state:"completed",promptId:"cpu-only-job"};
 if(command==="comfy_collect_generation")return [{path:"C:/cpu-only/CPU/take.mp4",name:"take",kind:"video",nodeId:"9"}];
 throw new Error(command);
});});
it("처음부터 취소한 작업은 검사·admission·제출을 호출하지 않습니다",async()=>{state.stopped=true;await expect(runComfyToProject(request())).rejects.toThrow("중지");expect(state.invoke).not.toHaveBeenCalled();});
it("검사 중 취소하면 admission을 취득하지 않습니다",async()=>{state.invoke.mockImplementation(async()=>{state.stopped=true;return {sha256:"a".repeat(64),nodes:[]};});await expect(runComfyToProject(request())).rejects.toThrow("중지");expect(state.invoke.mock.calls.map(c=>c[0])).toEqual(["comfy_inspect_generation_workflow"]);});
it("admission 중 취소하면 해당 토큰만 폐기하고 제출하지 않습니다",async()=>{const original=state.invoke.getMockImplementation()!;state.invoke.mockImplementation(async(command:string,args:unknown)=>{const result=await original(command,args);if(command==="comfy_admit_generation")state.stopped=true;return result;});await expect(runComfyToProject(request())).rejects.toThrow("중지");expect(state.invoke.mock.calls.map(c=>c[0])).toEqual(["comfy_inspect_generation_workflow","comfy_admit_generation","comfy_revoke_generation_admission"]);expect(state.invoke.mock.calls[2][1]).toEqual({admissionToken:"cpu-only-token"});});
it("제출 전 journal 기록 중 취소하면 취소된 단계를 기록합니다",async()=>{const cancelled=vi.fn(async()=>{});await expect(runComfyToProject({...request(),onSubmitting:async()=>{state.stopped=true;},onSubmissionCancelled:cancelled})).rejects.toThrow("중지");expect(cancelled).toHaveBeenCalledOnce();expect(state.invoke.mock.calls.some(c=>c[0]==="comfy_submit_generation")).toBe(false);});
it("제출 응답이 끊기면 토큰을 재사용하거나 자동 재전송하지 않습니다",async()=>{const original=state.invoke.getMockImplementation()!;state.invoke.mockImplementation(async(command:string,args:unknown)=>{if(command==="comfy_submit_generation")throw Error("unknown submission");return original(command,args);});await expect(runComfyToProject(request())).rejects.toThrow("unknown submission");expect(state.invoke.mock.calls.filter(c=>c[0]==="comfy_submit_generation")).toHaveLength(1);expect(state.invoke.mock.calls.some(c=>c[0]==="comfy_revoke_generation_admission")).toBe(false);});
it("제출 후 취소하면 promptId를 기록하고 status·수집을 호출하지 않습니다",async()=>{const submitted=vi.fn(async(id:string)=>{expect(id).toBe("cpu-only-job");state.stopped=true;});await expect(runComfyToProject({...request(),onSubmitted:submitted})).rejects.toThrow("중지");expect(submitted).toHaveBeenCalledOnce();expect(state.invoke.mock.calls.map(c=>c[0])).toEqual(["comfy_inspect_generation_workflow","comfy_admit_generation","comfy_submit_generation"]);});
it("수집 중 취소하면 파일 기록을 보존하고 등록 단계로 완료를 전달하지 않습니다",async()=>{const collected=vi.fn(async()=>{state.stopped=true;});await expect(runComfyToProject({...request(),onCollected:collected})).rejects.toThrow("중지");expect(collected).toHaveBeenCalledOnce();});
