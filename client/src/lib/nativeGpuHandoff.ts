import { z } from "zod";
import { mediaTargetSchema } from "./controlMediaTargetSchema";
const id=z.string().min(1).max(200);
export const nativeGpuHandoffSchema=z.object({
  producerSafeBoundaryConfirmed:z.literal(true), requestId:id, projectId:id, target:mediaTargetSchema,
}).strict().describe("Explicit producer GPU handoff for this one native A2V request. IDs and target must match this request; fresh idle queues, official cache release, exclusive GPU lock and memory checks are required. Does not grant persistent execution permission. Reusing operationId returns the existing job; a changed request is rejected.");
export function validateNativeGpuHandoff(input:{operationId:string;projectId:string;target:{kind:string;id:string};options:{ltx_a2v?:string};nativeGpuHandoff?:z.infer<typeof nativeGpuHandoffSchema>}) {
  const a=input.nativeGpuHandoff;
  if(!a)return;
  if(input.options.ltx_a2v!=="experimental")throw Error("gpu_handoff_native_only");
  if(a.requestId!==input.operationId||a.projectId!==input.projectId)throw Error("gpu_handoff_request_mismatch");
  if(a.target.kind!=="cut"||a.target.kind!==input.target.kind||a.target.id!==input.target.id)throw Error("gpu_handoff_target_mismatch");
}
