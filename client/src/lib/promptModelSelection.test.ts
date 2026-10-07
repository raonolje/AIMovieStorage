import { describe, expect, it } from "vitest";
import { appPromptRequest, applyAppPromptResult } from "./appPromptRequest";
import { canonicalPromptModel, promptStamp, promptStaleMessage, resolvePromptSelection, assertPromptSnapshot } from "./promptModelSelection";
import { newCharacter, newBackground, newCut, newProjectDraft, newScene } from "./projectTypes";
import { matchModelRule,targetModels,targetModelOf,videoRuleIdOf } from "./modelRules";
import { buildPromptRequestText } from "./promptRequest";

describe("선택 모델 전달과 수동 프롬프트 보호", () => {
  const project = () => ({ ...newProjectDraft(), title: "선택 검사", characters: [{...newCharacter(), id:"c"}], backgrounds:[{...newBackground(),id:"b"}],
    scenes:[{...newScene(), id:"s",storyboardPath:"C:/project/board.png",cuts:[{...newCut(1),id:"cut",promptKo:"수동 문장"}]}], batchEngines:{image:"qwenimage" as const,video:"wanvideo" as const} });
  const targets = [{kind:"character",id:"c"},{kind:"background",id:"b"},{kind:"cutImage",sceneId:"s",cutId:"cut"},{kind:"cutVideo",sceneId:"s",cutId:"cut"},{kind:"sceneVideo",sceneId:"s"}] as const;
  it.each(targets)("UI/일괄/조종기 공통 요청 $kind에 모델을 전한다", target => {
    const draft=project(), request=appPromptRequest(draft,target);
    const model = target.kind==="cutVideo"||target.kind==="sceneVideo" ? "wanvideo":"qwenimage";
    expect(request.modelId).toBe(model);
    expect(request.platformId).toBe("local");
    expect(request.data).toMatchObject({generationTarget:{modelId:model,route:model}});
  });
  it("컷별 명시 엔진이 프로젝트 엔진보다 우선하며 음악 MiniMax는 영상 가이드가 아니다", () => {
    const draft=project();draft.scenes[0].cuts[0].promptEngine="zimage";
    expect(appPromptRequest(draft,targets[2]).modelId).toBe("zimage");
    expect(canonicalPromptModel("local-minimax")).toBe("minimaxmusic");
    expect(matchModelRule("minimaxmusic")).toBeNull();
    expect(canonicalPromptModel("unknown-future-v8")).toBe("unknown-future-v8");
    expect(resolvePromptSelection("video",{model:"unknown-future-v8"}).modelId).toBe("unknown-future-v8");
  });
  it("모델 선택 변경은 기존 문장을 보존하고 재작성 결과에 새 기록을 남긴다", () => {
    const draft=project(), old=appPromptRequest(draft,targets[2]);
    draft.scenes[0].cuts[0].promptEngine="zimage";
    expect(draft.scenes[0].cuts[0].promptKo).toBe("수동 문장");
    const selection=resolvePromptSelection("image",{engine:"zimage"});
    expect(promptStaleMessage(promptStamp((old.data as {generationTarget:typeof selection}).generationTarget),selection,true)).toContain("유지");
    const next=applyAppPromptResult(draft,targets[2],{ko:"새 문장",en:"new",negativeKo:"금지",negativeEn:"bad"});
    expect(next.scenes[0].cuts[0].negativeEn).toBe("");
    expect(next.scenes[0].cuts[0].promptModelStamp).toBe(promptStamp(selection));
    expect(()=>assertPromptSnapshot(old,appPromptRequest(draft,targets[2]))).toThrow("보존");
  });
  it("알 수 없는 명시 엔진/종류는 fallback으로 숨기지 않는다",()=>{
    expect(resolvePromptSelection("image",{engine:"gone-model"})).toMatchObject({route:"gone-model",error:expect.any(String)});
    expect(resolvePromptSelection("video",{engine:"qwenimage"})).toMatchObject({route:"qwenimage",error:expect.any(String)});
  });
  it("로컬 전용 가이드와 출처 확인일이 실제 요청문에 들어간다",async()=>{
    const request=appPromptRequest(project(),targets[2]);
    const parts=await buildPromptRequestText(request);
    expect(parts.fixed).toContain("qwenimage");expect(parts.fixed).toContain("https://");expect(parts.fixed).toContain("2026-10");
    expect(parts.fixed).toContain("20B");
  });
  it.each([...targetModels("image"),...targetModels("video")])("등록 모델 $id의 ID·확인 slug·label은 같은 가이드를 대상으로 한다",model=>{
    for(const id of [model.id,model.label,...(model.magnific?[model.magnific]:[])])expect(resolvePromptSelection(model.kind,{model:id}).modelId).toBe(model.id);
  });
  it("새 버전과 WanAnimate를 이름 유사성으로 기존 생성기나 규칙에 내려 보내지 않는다",()=>{
    for(const id of ["Kling 9.0","Veo 9.0 Fast","WanAnimate","wan-9.0","MiniMax Music 9"]){
      expect(targetModelOf(id)).toBeNull();expect(videoRuleIdOf(id)).toBe(id);expect(canonicalPromptModel(id)).toBe(id);
    }
  });
  it("프로젝트 default와 다른 컷·씬 선택은 각 요청과 영상 뼈대에 그대로 전달된다",()=>{
    const draft=project();draft.batchEngines={image:"magnific",video:"magnific"};draft.magnific={imageModel:"nano-banana",videoModel:"veo-3.1"};
    draft.scenes[0].cuts[0].videoPromptModel="kling-2.6";draft.scenes[0].videoPromptModel="sora-2";
    const cut=appPromptRequest(draft,targets[3]),scene=appPromptRequest(draft,targets[4]);expect(cut.modelId).toBe("kling-2.6");expect(scene.modelId).toBe("sora-2");expect(JSON.stringify(cut.data)).toContain("kling-2.6");
  });
});
