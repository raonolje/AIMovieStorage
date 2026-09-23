import { Box3, type Object3D } from "three";
import type { Vector3Value } from "@/lib/composition";

/**
 * 앵커가 씬의 현재 경계를 읽으므로 몸의 이동·자세를 먼저 맞춰야 합니다. 영상만
 * 카메라를 먼저 풀면 첫 프레임은 편집하던 시각을, 그다음은 직전 프레임을 봅니다.
 */
export function applyMotionThenCameraAt(
  time: number,
  applyMotion: (time: number) => void,
  applyCamera: (time: number) => void,
): void {
  applyMotion(time);
  applyCamera(time);
}

/** 인물·소품의 월드 경계를 써서 전경 확대나 묶음 변환 뒤에도 같은 시선점을 잡습니다. */
export function objectBoundsAnchor(node: Object3D, ratio: number): Vector3Value | null {
  const box = new Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  return {
    x: (box.min.x + box.max.x) / 2,
    y: box.min.y + (box.max.y - box.min.y) * ratio,
    z: (box.min.z + box.max.z) / 2,
  };
}
