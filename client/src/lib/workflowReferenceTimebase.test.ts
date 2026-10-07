import {expect,it} from "vitest";
import cases from "./__fixtures__/workflow-timebase-cases.json";
import {resolveWorkflowReferenceTimebase,validateWorkflowReferenceTimebase,type WorkflowTimebaseInput} from "./workflowReferenceTimebase";
import type {WorkflowAssetFact} from "./comfyWorkflowContract";

it.each(cases.cases)("TS/native 공유 시간축 규칙: $id",raw=>{
 const input=raw as unknown as WorkflowTimebaseInput;
 if(raw.error)expect(()=>resolveWorkflowReferenceTimebase(input)).toThrow(raw.error);
 else {const time=resolveWorkflowReferenceTimebase(input);expect({fps:time.fps??null,frameCount:time.frameCount??null,durationSeconds:time.durationSeconds??null}).toEqual(raw.expected);}
});
const asset:WorkflowAssetFact={assetId:"cpu-ref",projectId:"cpu-project",path:"C:/cpu-only/ref.mp4",kind:"video",bytes:100,sha256:"a".repeat(64),decodable:true,width:256,height:256,fps:24,durationSeconds:1.5};
function fixed(video=true){return {graph:{a:{class_type:"CPU-only",inputs:video?{fps:24,length:36}:{durationSeconds:1.5}}},selection:{slots:[{id:"ref",semantic:video?"cameraGuide" as const:"voiceReference" as const,nodeId:"a",input:"file",required:true,alignment:"exact" as const}]},values:{},bindings:[],assets:{ref:{...asset,...(!video?{kind:"audio" as const,path:"C:/cpu-only/ref.wav"}:{})}}};}
it("고정 영상 시간축과 고정 오디오 길이를 같은 앱 경계에서 검사합니다",()=>{expect(()=>validateWorkflowReferenceTimebase(fixed())).not.toThrow();expect(()=>validateWorkflowReferenceTimebase(fixed(false))).not.toThrow();});
it.each(["fps","duration","missing-fps","missing-duration","nonfinite","zero"])("불일치·누락·invalid 참조 시간축 차단: %s",reason=>{
 const input=fixed();if(reason==="fps")input.assets.ref.fps=30;if(reason==="duration")input.assets.ref.durationSeconds=2;if(reason==="missing-fps")delete (input.graph.a.inputs as Record<string,unknown>).fps;if(reason==="missing-duration")delete (input.graph.a.inputs as Record<string,unknown>).length;if(reason==="nonfinite")input.assets.ref.durationSeconds=Number.NaN;if(reason==="zero")input.assets.ref.durationSeconds=0;
 expect(()=>validateWorkflowReferenceTimebase(input)).toThrow(/mismatch/);
});
it("NaN·Infinity·계산 overflow를 정상 graph 숫자로 채택하지 않습니다",()=>{
 for(const fps of [Number.NaN,Number.POSITIVE_INFINITY,Number.MIN_VALUE])expect(()=>resolveWorkflowReferenceTimebase({graph:{a:{class_type:"CPU-only",inputs:{fps,length:36}}},selection:{slots:[]},values:{},bindings:[]})).toThrow("reference_timebase_invalid");
});
