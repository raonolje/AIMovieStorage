import { describe, expect, it } from "vitest";
import { newProjectDraft, newScene } from "./projectTypes";
import { assertCurrentScenePrompt, currentCutPromptState } from "./sceneEditorPromptSnapshot";
import { assertPromptSnapshot, promptStamp, resolvePromptSelection } from "./promptModelSelection";

describe("숨겨진 씬의 비동기 프롬프트 최신 상태", () => {
  it("controller가 숨겨진 컷의 모델·수동 본문을 바꾸면 낡은 응답을 거절합니다", () => {
    const draft = newProjectDraft(); draft.scenes=[newScene(), newScene()];
    const cut=draft.scenes[0].cuts[0]; cut.promptModel="flux2"; cut.promptKo="기존 한글"; cut.promptEn="old";
    const before=currentCutPromptState(draft, cut.id, "magnific");
    const changed={...draft, scenes:draft.scenes.map(scene=>({...scene,cuts:scene.cuts.map(item=>item.id===cut.id?{...item,promptModel:"nano-banana-2.1",promptKo:"수동 수정",promptEn:"manual edit"}:item)}))};
    const after=currentCutPromptState(changed, cut.id, "magnific");
    expect(()=>assertPromptSnapshot(promptStamp(before.imageSelection),promptStamp(after.imageSelection))).toThrow();
    expect(()=>assertPromptSnapshot([cut.promptKo,cut.promptEn],[after.cut.promptKo,after.cut.promptEn])).toThrow();
    expect(after.cut.promptKo).toBe("수동 수정");
  });
  it("batch의 프로젝트 기본 모델 변경도 숨겨진 컷에 적용됩니다", () => {
    const draft=newProjectDraft(); draft.scenes=[newScene()]; draft.magnific={imageModel:"flux2"};
    const id=draft.scenes[0].cuts[0].id;
    const before=currentCutPromptState(draft,id,"magnific");
    draft.magnific.imageModel="nano-banana-2.1";
    expect(()=>assertPromptSnapshot(promptStamp(before.imageSelection),promptStamp(currentCutPromptState(draft,id,"magnific").imageSelection))).toThrow();
  });
  it("삭제된 컷·씬에는 늦은 답을 다시 붙이지 않습니다", () => {
    const draft=newProjectDraft(); draft.scenes=[];
    expect(()=>currentCutPromptState(draft,"deleted","magnific")).toThrow("삭제");
    expect(()=>assertCurrentScenePrompt(draft,"deleted","",[undefined,undefined])).toThrow("삭제");
  });
  it("숨겨진 씬 스토리보드의 수동 수정도 보존하고 그대로인 대상은 허용합니다", () => {
    const draft=newProjectDraft(); const scene=newScene(); draft.scenes=[scene];
    const stamp=promptStamp(resolvePromptSelection("video",{project:draft}));
    expect(()=>assertCurrentScenePrompt(draft,scene.id,stamp,[undefined,undefined])).not.toThrow();
    scene.storyboardPromptKo="직접 쓴 문장";
    expect(()=>assertCurrentScenePrompt(draft,scene.id,stamp,[undefined,undefined])).toThrow();
  });
});
