import type {WorkflowAssetFact,WorkflowGraph,WorkflowSelection} from "./comfyWorkflowContract";

export interface WorkflowTimebaseInput {
 graph:WorkflowGraph;
 selection:Pick<WorkflowSelection,"slots">;
 values:Record<string,unknown>;
 bindings:readonly {nodeId:string;input:string;value?:unknown;filePath?:string}[];
}
function fail(reason:string,semantic:string):never {throw new Error(`workflow_reference_timebase_${reason}:${semantic}`);}

/** A check of already inspected graph + actual adapter bindings, never a graph/model inference or an admission grant. */
export function resolveWorkflowReferenceTimebase(input:WorkflowTimebaseInput) {
 const effective=Object.fromEntries(Object.entries(input.graph).map(([id,node])=>[id,{...node.inputs}]));
 const fields=new Set<string>();
 for(const binding of input.bindings) {
  const slot=input.selection.slots.find(s=>s.nodeId===binding.nodeId&&s.input===binding.input),key=JSON.stringify([binding.nodeId,binding.input]);
  if(!slot||fields.has(key)||!effective[binding.nodeId]||!Object.hasOwn(effective[binding.nodeId],binding.input))fail("binding_invalid","bindings");
  fields.add(key);
  if(binding.filePath!==undefined)continue;
  if(binding.value===undefined||input.values[slot.id]!==binding.value)fail("binding_invalid",slot.id);
  effective[binding.nodeId][binding.input]=binding.value;
 }
 const number=(semantic:"fps"|"frameCount"|"durationSeconds")=>{
  const slots=input.selection.slots.filter(slot=>slot.semantic===semantic);
  let candidates:unknown[];
  if(slots.length) {
   candidates=slots.map(slot=>{
    const bindings=input.bindings.filter(binding=>binding.nodeId===slot.nodeId&&binding.input===slot.input);
    if(bindings.length!==1||bindings[0].filePath!==undefined||bindings[0].value===undefined||input.values[slot.id]!==bindings[0].value)fail("binding_invalid",semantic);
    return bindings[0].value;
   });
  } else {
   const names=semantic==="frameCount"?["length","num_frames"]:[semantic];
   candidates=Object.values(effective).flatMap(inputs=>names.filter(name=>Object.hasOwn(inputs,name)).map(name=>inputs[name]));
  }
  if(!candidates.length)return undefined;
  if(candidates.some(value=>typeof value!=="number"||!Number.isFinite(value)||value<=0||(semantic==="frameCount"&&!Number.isSafeInteger(value))))fail("invalid",semantic);
  const values=candidates as number[];if(values.some(value=>value!==values[0]))fail("ambiguous",semantic);
  return values[0];
 };
 // Explicit semantic slots take precedence. Fixed graph aliases are used only when there is no such slot.
 const fps=number("fps"),frameCount=number("frameCount"),direct=number("durationSeconds");
 const derived=fps!==undefined&&frameCount!==undefined?frameCount/fps:undefined;
 if(derived!==undefined&&(!Number.isFinite(derived)||derived<=0))fail("invalid","durationSeconds");
 if(direct!==undefined&&derived!==undefined&&Math.abs(direct-derived)>1e-9*Math.max(1,Math.abs(direct),Math.abs(derived)))fail("conflict","durationSeconds");
 return {fps,frameCount,durationSeconds:direct??derived};
}

/** App UI/controller/batch boundary adds strict conflict checks without modifying the frozen owner adapters. */
export function validateWorkflowReferenceTimebase(input:WorkflowTimebaseInput&{assets:Record<string,WorkflowAssetFact>}) {
 const exact=input.selection.slots.filter(slot=>slot.alignment==="exact"&&["sourceVideo","poseVideo","depthVideo","cameraGuide","audio","voiceReference"].includes(slot.semantic));
 if(!exact.length)return;
 const time=resolveWorkflowReferenceTimebase(input);
 for(const slot of exact) {
  const asset=input.assets[slot.id];if(!asset)throw new Error("workflow_reference_fact_missing");
  if(asset.kind==="video"&&(time.fps===undefined||!Number.isFinite(asset.fps)||asset.fps!<=0||Math.abs(asset.fps!-time.fps)>0.001))throw new Error("workflow_reference_timebase_mismatch");
  if(time.durationSeconds===undefined||!Number.isFinite(asset.durationSeconds)||asset.durationSeconds!<=0||Math.abs(asset.durationSeconds!-time.durationSeconds)>(time.fps===undefined?0.02:1/time.fps))throw new Error("workflow_reference_duration_mismatch");
 }
}
