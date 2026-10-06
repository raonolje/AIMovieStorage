import { describe, expect, it } from "vitest";
import { validateNativeA2V } from "./nativeA2V";
const base = {engine:"ltx25", audioAssetId:"audio", audioStartSeconds:0.25, audioDurationSeconds:1, imageAssetId:"first", endImageAssetId:"end", options:{prompt:"A sphere moves",ltx_a2v:"experimental" as const,width:384,height:256,fps:24,seed:0}};
describe("작업별 checkpoint 읽기 정책",()=>{
  it("두 명시적 선택을 허용하고 숨은 자동 모드를 거부한다",()=>{
    for(const backend of ["mmap","pread"]) expect(validateNativeA2V({...base,options:{...base.options,ltx_a2v_offload:"disk",ltx_a2v_checkpoint_read_backend:backend}})).toBe(true);
    for(const backend of [true,null,"auto",1]) expect(()=>validateNativeA2V({...base,options:{...base.options,ltx_a2v_offload:"disk",ltx_a2v_checkpoint_read_backend:backend}})).toThrow("unsupported_options");
    expect(()=>validateNativeA2V({...base,options:{...base.options,ltx_a2v_checkpoint_read_backend:"mmap"}})).toThrow("disk");
    expect(()=>validateNativeA2V({engine:"wanvideo",options:{ltx_a2v_checkpoint_read_backend:"pread"}})).toThrow("invalid_request");
  });
});
describe("원음 조건 생성의 명시적 경계",()=>{
  it("명시적 disk 선택과 항상 로컬 실행 계약을 연결한다",()=>{
    expect(validateNativeA2V({...base,options:{...base.options,ltx_a2v_offload:"disk",ltx_a2v_checkpoint_read_backend:"pread",local_files_only:true}})).toBe(true);
    for(const mode of ["none","fp8",true])expect(()=>validateNativeA2V({...base,options:{...base.options,ltx_a2v_offload:mode}})).toThrow("unsupported_options");
    expect(()=>validateNativeA2V({...base,options:{...base.options,local_files_only:false}})).toThrow("오프라인");
    expect(()=>validateNativeA2V({engine:"ltx25",options:{ltx_a2v_offload:"disk"}})).toThrow("명시적");
  });
  it("기존 LTX 요청은 기존 경로로 남긴다",()=>expect(validateNativeA2V({engine:"ltx25",options:{prompt:"scene",seconds:5}})).toBe(false));
  it("원음·선택구간·시작끝 입력을 받는다",()=>expect(validateNativeA2V(base)).toBe(true));
  it("다른 모델의 남은 원음 선택을 버리지 않는다",()=>expect(()=>validateNativeA2V({...base,engine:"wanvideo"})).toThrow("model_unsupported"));
  it("명시적 A2V 선택 없이 소리를 넘길 수 없다",()=>expect(()=>validateNativeA2V({...base,options:{prompt:"scene"}})).toThrow("invalid_request"));
  it("프레임 입력·추가 제어와 일정의 모호한 조합을 막는다",()=>{
    expect(()=>validateNativeA2V({...base,imageAssetId:undefined})).toThrow("시작 그림");
    for(const x of [{loras:[{}]},{poseSource:{}},{structureSource:{}},{referenceAssetIds:["ref"]},{motionMaskAssetId:"mask"}]) expect(()=>validateNativeA2V({...base,...x})).toThrow("unsupported_control");
    expect(()=>validateNativeA2V({...base,options:{...base.options,seconds:5}})).toThrow("unsupported_options");
    expect(()=>validateNativeA2V({...base,options:{...base.options,width:400}})).toThrow("64의 배수");
  });
});

it("native disk 생략에 숨은 느린 기본값을 적용하지 않는다",()=>{ expect(()=>validateNativeA2V({...base,options:{...base.options,ltx_a2v_offload:"disk"}})).toThrow("명시적으로"); });
