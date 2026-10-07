import type { ProjectDraft } from "./projectTypes";
import { t } from "./i18n";
import { assertPromptSnapshot, promptStamp, resolvePromptSelection } from "./promptModelSelection";

/** 숨겨진 씬의 응답도 부모가 지금 들고 있는 초안을 검사합니다. 마지막 마운트의 ref는 낡을 수 있습니다. */
export function currentCutPromptState(draft: ProjectDraft, cutId: string, platform: string) {
  const cut = draft.scenes.flatMap(scene => scene.cuts).find(item => item.id === cutId);
  if (!cut) throw new Error(t("요청한 컷이 삭제되어 프롬프트를 적용하지 않았습니다."));
  return {
    cut,
    imageSelection: resolvePromptSelection("image", { workflowTarget: cut.promptWorkflow, model: cut.promptModel || draft.magnific?.imageModel, engine: cut.promptEngine, project: draft, platform }),
    videoSelection: resolvePromptSelection("video", { workflowTarget: cut.videoPromptWorkflow, model: cut.videoPromptModel || draft.magnific?.videoModel, engine: cut.videoPromptEngine, project: draft, platform }),
  };
}

export function assertCurrentScenePrompt(draft: ProjectDraft, sceneId: string, expectedStamp: string, texts: [string | undefined, string | undefined]) {
  const scene = draft.scenes.find(item => item.id === sceneId);
  if (!scene) throw new Error(t("요청한 장면이 삭제되어 프롬프트를 적용하지 않았습니다."));
  const selection = resolvePromptSelection("video", { workflowTarget: scene.videoPromptWorkflow, model: scene.videoPromptModel, engine: scene.videoPromptEngine, project: draft });
  assertPromptSnapshot(expectedStamp, promptStamp(selection));
  assertPromptSnapshot(texts, [scene.storyboardPromptKo, scene.storyboardPromptEn]);
}
