import { targetModels } from "./modelRules";
import { readProject } from "./projectWrite";
import { controlEngineCatalog } from "./controlMedia";
import { getControlComfyStatus } from "./controlComfy";

/** 대화 상대가 앱의 실제 생성 경로를 고르게 합니다. 비용·품질은 측정 없이 추정하지 않습니다. */
export async function controlCreationOptions(projectId?: string) {
  const draft = projectId ? readProject(projectId) : null;
  if (projectId && !draft) throw new Error("프로젝트를 찾지 못했습니다.");
  const [local, comfy] = await Promise.all([controlEngineCatalog(), getControlComfyStatus()]);
  return {
    projectId: projectId ?? null,
    selected: draft ? {
      imageModelByCharacter: draft.characters.map(item => ({ id: item.id, model: item.promptModel })),
      imageModelByBackground: draft.backgrounds.map(item => ({ id: item.id, model: item.promptModel })),
      videoModel: draft.magnific?.videoModel ?? null,
    } : null,
    routes: {
      local: local.local,
      magnificDesktopImage: targetModels("image").filter(item => item.magnific),
      magnificDesktopVideo: targetModels("video").filter(item => item.magnific === "seedance-2-5-pro"),
      comfy: comfy.workflows,
    },
    guidance: {
      ask: "모델 또는 생성 경로를 지정하지 않았다면 이미지/영상 각각 어떤 모델과 경로(로컬, 앱의 Magnific 구성, 설정된 ComfyUI)를 쓸지 사용자에게 한 번 물으세요. 이미 답했으면 반복하지 마세요.",
      delegated: "사용자가 '알아서 해'라고 맡겼으면 현재 프로젝트 선택값과 사용 가능한 경로를 보고 결정해 사용 모델·경로를 보고하세요.",
      magnific: "앱의 Magnific 구성은 생성기를 보드에 올리지만 Generate를 누르지 않습니다. 구성 완료를 결과 영상·이미지 생성 완료로 보고하지 마세요.",
    },
  };
}
