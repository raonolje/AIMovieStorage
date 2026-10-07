import { describe, expect, it } from "vitest";
import { assertMagnificMcpImageInputs, assertMagnificMcpImageReferenceCount } from "./magnificImageInputs";
import { validateNanoBanana21Options } from "./nanoBanana21Profile";
const mode="imagen-nano-banana-2-1";
describe("Magnific 이미지 MCP 확인 스키마",()=>{
  it("provider14와 connector12를 별개로 검증한다",()=>{
    expect(validateNanoBanana21Options({references:Array.from({length:14},()=>({kind:"other"}))}).references).toHaveLength(14);
    expect(()=>assertMagnificMcpImageReferenceCount(12)).not.toThrow();
    expect(()=>assertMagnificMcpImageReferenceCount(13)).toThrow("reference_limit");
  });
  it("명시2.1과 확인된 옵션/creation 참조를 보존한다",()=>{
    const args={mode,resolution:"2k",aspectRatio:"16:9",count:4,references:[{type:"image",identifier:"creation-example"}]};
    const before=JSON.stringify(args);expect(()=>assertMagnificMcpImageInputs(args)).not.toThrow();expect(JSON.stringify(args)).toBe(before);
  });
  it("connector 기본값과 thinking을 provider에서 상속하지 않는다",()=>{
    expect(()=>assertMagnificMcpImageInputs({mode})).not.toThrow();
    expect(()=>assertMagnificMcpImageInputs({mode,thinkingLevel:"medium"})).toThrow("thinking_unconfirmed");
    expect(()=>assertMagnificMcpImageInputs({mode,resolution:"1K"})).toThrow("magnific_resolution");
  });
  it("BrandKit 자동 모델 교체와 잘못된 mode를 거부한다",()=>{
    expect(()=>assertMagnificMcpImageInputs({mode,brandKitId:"existing-kit"})).toThrow("model_switch");
    expect(()=>assertMagnificMcpImageInputs({mode:"gemini-nano-banana-2.1"})).toThrow("mapping_mismatch");
  });
  it("참조 식별자/역할과 count를 임의 변환하지 않는다",()=>{
    expect(()=>assertMagnificMcpImageInputs({mode,references:[{type:"image",url:"file.png"}]})).toThrow("identifier_required");
    expect(()=>assertMagnificMcpImageInputs({mode,references:[{type:"locations",identifier:"123"}]})).toThrow("type_unsupported");
    expect(()=>assertMagnificMcpImageInputs({mode,count:9})).toThrow("image_count");
    expect(()=>assertMagnificMcpImageInputs({mode,aspectRatio:"auto"})).toThrow("aspect_ratio");
  });
});
