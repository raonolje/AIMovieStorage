import { describe, expect, it } from "vitest";
import { NANO_BANANA_21, validateNanoBanana21Options, assertNanoBanana21MagnificMapping } from "./nanoBanana21Profile";
import { canonicalPromptModel, promptStamp, promptStaleMessage, promptResultForModel } from "./promptModelSelection";
import { targetModelOf } from "./modelRules";
import { appPromptRequest } from "./appPromptRequest";
import { IMAGE_ONLY_MODELS, magnificModelOf } from "./promptLibrary";
import { validateMagnificComposition } from "./magnificCompose";
import { buildPromptRequestText } from "./promptRequest";
import { newProjectDraft, newCharacter, newBackground, newCut, newScene } from "./projectTypes";

describe("Nano Banana 2.1 별도 provider 프로필", () => {
  it("구2/Pro 연결과 구 alias를 2.1로 승격하지 않는다", () => {
    for (const old of ["nano-banana", "nbpro", "Nano Banana Pro", "imagen-nano-banana-2"]) expect(canonicalPromptModel(old)).toBe("nano-banana");
    for (const id of [NANO_BANANA_21.id, NANO_BANANA_21.providerModelId, NANO_BANANA_21.label, NANO_BANANA_21.magnificSlug, NANO_BANANA_21.magnificName]) {
      expect(canonicalPromptModel(id)).toBe(NANO_BANANA_21.id);
      expect(targetModelOf(id)?.magnific).toBe(NANO_BANANA_21.magnificSlug);
      expect(magnificModelOf(id)).toBe(NANO_BANANA_21.magnificSlug);
    }
    expect(targetModelOf(NANO_BANANA_21.providerModelId)).toMatchObject({id:NANO_BANANA_21.id,magnific:NANO_BANANA_21.magnificSlug});
    expect(IMAGE_ONLY_MODELS.find(model => model.id===NANO_BANANA_21.id)?.magnific).toBe(NANO_BANANA_21.magnificSlug);
    expect(canonicalPromptModel("imagen-nano-banana-2-flash")).toBe("imagen-nano-banana-2-flash");
  });
  it("해상도와 thinking의 2.1 기본값을 사용한다", () => {
    expect(validateNanoBanana21Options()).toMatchObject({imageSize:"1K",thinkingLevel:"medium"});
    expect(validateNanoBanana21Options({imageSize:"4K",thinkingLevel:"minimal"})).toMatchObject({imageSize:"4K",thinkingLevel:"minimal"});
  });
  it.each(["512px", "0.5K", "8K"])("지원되지 않은 해상도 %s를 자동 대체하지 않는다", imageSize => {
    expect(() => validateNanoBanana21Options({imageSize})).toThrow("nano_banana_21_image_size");
  });
  it("audio와 잘못된 thinking을 차단한다", () => {
    expect(() => validateNanoBanana21Options({audioInput:true})).toThrow("audio_unsupported");
    expect(() => validateNanoBanana21Options({audioOutput:true})).toThrow("audio_unsupported");
    expect(() => validateNanoBanana21Options({thinkingLevel:"low"})).toThrow("thinking_level");
  });
  it("총14개는 검증하되 4캐릭터 fidelity를 등장 인원 금지로 바꾸지 않는다", () => {
    const characters=Array.from({length:6},(_,i)=>({role:`member-${i}`,kind:"character" as const}));
    expect(validateNanoBanana21Options({references:characters}).warnings).toHaveLength(1);
    const objects=Array.from({length:14},(_,i)=>({role:`object-${i}`,kind:"object" as const}));
    expect(validateNanoBanana21Options({references:objects}).references).toHaveLength(14);
    expect(validateNanoBanana21Options({references:objects}).warnings).toHaveLength(1);
    expect(()=>validateNanoBanana21Options({references:[...objects,{kind:"style"}]})).toThrow("reference_limit");
  });
  it("확인한 2.1 slug만 구성하고 누락·Pro 대체를 업로드 전에 거부한다", async () => {
    expect(()=>assertNanoBanana21MagnificMapping(NANO_BANANA_21.providerModelId,NANO_BANANA_21.magnificSlug)).not.toThrow();
    await expect(validateMagnificComposition({kind:"image",prompt:"그룹 초상",referencePaths:[],requestedImageModel:NANO_BANANA_21.id,model:NANO_BANANA_21.magnificSlug})).resolves.toBeUndefined();
    await expect(validateMagnificComposition({kind:"image",prompt:"그룹 초상",referencePaths:[],requestedImageModel:NANO_BANANA_21.id,model:"imagen-nano-banana-2"})).rejects.toThrow("mapping_mismatch");
    await expect(validateMagnificComposition({kind:"image",prompt:"그룹 초상",referencePaths:[],requestedImageModel:NANO_BANANA_21.id})).rejects.toThrow("기본 모델로 바꾸지");
    await expect(validateMagnificComposition({kind:"image",prompt:"그룹 초상",referencePaths:[],model:NANO_BANANA_21.providerModelId})).rejects.toThrow("mapping_mismatch");
    await expect(validateMagnificComposition({kind:"image",prompt:"그룹 초상",referencePaths:[],requestedImageModel:"unknown-image-v9"})).rejects.toThrow("기본 모델로 바꾸지");
  });
  it.each(["character", "background", "cutImage"] as const)("버튼·AI일괄·조종기 공통 %s 요청에 별도 guide를 전달한다", async kind => {
    const draft={...newProjectDraft(),characters:[{...newCharacter(),id:"c",promptModel:undefined}],backgrounds:[{...newBackground(),id:"b",promptModel:undefined}],scenes:[{...newScene(),id:"s",cuts:[{...newCut(1),id:"cut",promptKo:"수동 원문"}]}],batchEngines:{image:"magnific" as const},magnific:{imageModel:NANO_BANANA_21.providerModelId}};
    const target=kind==="cutImage"?{kind,sceneId:"s",cutId:"cut"}:{kind,id:kind==="character"?"c":"b"};
    const request=appPromptRequest(draft,target);
    expect(request.modelId).toBe(NANO_BANANA_21.id);
    const parts=await buildPromptRequestText(request);
    expect(parts.fixed).toContain(NANO_BANANA_21.providerModelId);
    expect(parts.fixed).toContain("medium");expect(parts.fixed).toContain("1K");expect(parts.fixed).toContain("verified-authenticated-catalog");expect(parts.fixed).toContain(NANO_BANANA_21.magnificSlug);
    expect(draft.scenes[0].cuts[0].promptKo).toBe("수동 원문");
  });
  it("구 모델 작성 stamp와 2.1 재작성 선택을 구분하고 native negative를 만들지 않는다", () => {
    const old={modelId:"nano-banana",route:"magnific"},next={modelId:NANO_BANANA_21.id,route:"magnific"};
    expect(promptStamp(old)).not.toBe(promptStamp(next));expect(promptStaleMessage(promptStamp(old),next,true)).toContain("유지");
    expect(promptResultForModel({negativeKo:"제거",negativeEn:"remove"},NANO_BANANA_21.providerModelId)).toEqual({negativeKo:"",negativeEn:""});
  });
});
