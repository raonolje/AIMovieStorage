import type { CompositionState } from "./composition";
import { applyRetargetedCaptureIn } from "./capturedMotionApply";
import type { RetargetFrame } from "./motionRetarget";
import { fitDancePhrase, type DancePhrase } from "./musicChoreographyTiming";

/** Reuses the exact pose-key path used by the editor's mocap dialog and the controller. */
export function applyDanceChoreographyIn(
  state: CompositionState,
  characterIds: string[],
  frames: RetargetFrame[],
  phrases: DancePhrase[],
  source: { id: string; name: string },
) {
  if (!characterIds.length || new Set(characterIds).size !== characterIds.length ||
      characterIds.some(id => !state.characters.some(character => character.characterId === id)))
    throw new Error("구도에 배치된 서로 다른 캐릭터를 선택하세요.");
  const fitted = fitDancePhrase(frames, phrases);
  if (fitted.length * characterIds.length > 18000)
    throw new Error("군무 자세 키가 총 18,000개를 넘습니다. 구간이나 인물 수를 나눠 적용하세요.");
  return applyRetargetedCaptureIn(state, characterIds.map(characterId => ({ characterId, frames: fitted })), {
    timelineStart: 0, captureStart: 0, formation: false,
    channels: { position: false, rotation: false, pose: true }, source,
  });
}
