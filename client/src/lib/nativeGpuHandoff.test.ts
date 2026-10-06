import {describe,it,expect} from "vitest";
import {nativeGpuHandoffSchema,validateNativeGpuHandoff} from "./nativeGpuHandoff";
const input=()=>({operationId:"op",projectId:"p",target:{kind:"cut" as const,id:"c"},options:{ltx_a2v:"experimental"},nativeGpuHandoff:{requestId:"op",projectId:"p",target:{kind:"cut" as const,id:"c"},producerSafeBoundaryConfirmed:true as const}});
describe("one native request handoff",()=>{
 it("requires explicit confirmation and rejects arbitrary authorization fields",()=>{expect(nativeGpuHandoffSchema.safeParse({...input().nativeGpuHandoff,producerSafeBoundaryConfirmed:false}).success).toBe(false);expect(nativeGpuHandoffSchema.safeParse({...input().nativeGpuHandoff,gpu_execution_authorized:true}).success).toBe(false);});
 it("binds operation, project and target",()=>{expect(()=>validateNativeGpuHandoff(input())).not.toThrow();for(const field of ["requestId","projectId"]as const){const x=input();x.nativeGpuHandoff[field]="wrong";expect(()=>validateNativeGpuHandoff(x)).toThrow("mismatch");}const x=input();x.nativeGpuHandoff.target.id="wrong";expect(()=>validateNativeGpuHandoff(x)).toThrow("target_mismatch");});
 it("rejects nonnative approval",()=>{const x=input();x.options.ltx_a2v="";expect(()=>validateNativeGpuHandoff(x)).toThrow("native_only");});
});
