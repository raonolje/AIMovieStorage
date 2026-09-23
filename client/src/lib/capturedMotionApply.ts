import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MODEL_URLS, modelTemplates } from "@/components/composition/viewport/sceneHelpers";
import type { CompositionState } from "./composition";
import { applyCapturedMotionIn } from "./compositionEdit";
import { createRetargetRig, placeCapturedMotion, type RetargetFrame } from "./motionRetarget";
import { mannequinBody } from "./rig";

/** 화면과 조종기가 같은 내장 몸 모델을 기준으로 관절을 계산합니다. 외부 모델 경로는 받지 않습니다. */
export async function loadCaptureRetargetRig(gender?: string) {
  const url = MODEL_URLS[mannequinBody(gender)];
  let template = modelTemplates.get(url);
  if (!template) {
    template = (await new GLTFLoader().loadAsync(url)).scene;
    modelTemplates.set(url, template);
  }
  return createRetargetRig(template);
}

/** 적용 직전 인물의 자리·방향과 기존 키를 기준으로 계산해야 화면 편집과 다른 결과가 나오지 않습니다. */
export function applyRetargetedCaptureIn(
  current: CompositionState,
  jobs: { characterId: string; frames: RetargetFrame[] }[],
  options: {
    timelineStart: number;
    captureStart: number;
    formation: boolean;
    channels: { position: boolean; rotation: boolean; pose: boolean };
    source: { id: string; name: string };
  },
) {
  const placed = placeCapturedMotion(jobs.map(job => {
    const character = current.characters.find(item => item.characterId === job.characterId);
    return { ...job, position: character?.position ?? { x: 0, y: 0, z: 0 },
      rotation: character?.rotation ?? { x: 0, y: 0, z: 0 } };
  }), { start: options.timelineStart, captureStart: options.captureStart, formation: options.formation });
  return applyCapturedMotionIn(current, placed, options.channels, options.source);
}
