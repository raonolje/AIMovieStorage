import type { CompositionState } from "./composition";
import { readCompositionIntoCut } from "./cutCompositionSync";
import type { Cut, ProjectDraft } from "./projectTypes";

/** 상태 저장과 캡처 저장이 같은 컷 갱신을 써야 한쪽에서 구도만 빠지지 않습니다. */
export function cutCompositionPatch(
  current: ProjectDraft,
  cutId: string,
  composition: CompositionState,
  captures: Pick<Partial<Cut>, "guideImage" | "guideImagePath" | "plateImage" | "plateImagePath"> = {},
): Partial<ProjectDraft> {
  const cut = current.scenes.flatMap((scene) => scene.cuts).find((item) => item.id === cutId);
  if (!cut) throw new Error("저장하는 동안 컷이 삭제되어 구도를 붙이지 못했습니다.");
  const { patch } = readCompositionIntoCut(composition, { cut, characters: current.characters, backgrounds: current.backgrounds });
  return {
    scenes: current.scenes.map((scene) => ({ ...scene, cuts: scene.cuts.map((item) => item.id === cutId ? { ...item, ...patch, ...captures, composition } : item) })),
  };
}
