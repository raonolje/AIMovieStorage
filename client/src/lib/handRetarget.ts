import * as THREE from "three";
import type { Vector3Value } from "@/lib/composition";
import type { CaptureHands } from "@/lib/motionCapture";
import { boneOf, rotateFingerInHandFrame, setLiveBonePose } from "@/lib/rig";

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
export const CAPTURE_FINGER_BONES = ["Left", "Right"].flatMap((side) =>
  FINGERS.flatMap((finger) => [1, 2, 3].map((joint) => `${side}Hand${finger}${joint}`)),
);
const up = new THREE.Vector3(0, 1, 0);
const at = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
const angles = (q: THREE.Quaternion): Vector3Value => {
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return { x: e.x, y: e.y, z: e.z };
};
function palmBasis(across: THREE.Vector3, forward: THREE.Vector3) {
  if (across.lengthSq() < 1e-10 || forward.lengthSq() < 1e-10) return null;
  const y = forward.clone().normalize();
  const x = across.clone().addScaledVector(y, -across.dot(y));
  if (x.lengthSq() < 1e-10) return null;
  x.normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)),
  );
}

/**
 * 실제 21점 → 손목·손가락 3마디 회전. 몸의 yaw를 빼고, 기존 타임라인이 읽는 손 좌표계로 기록합니다.
 * 검출기의 손 원점(골반/손 중심)이 달라도 두 점의 방향만 써서 결과가 같습니다.
 * 안 보이는 마디·끝 본이 없는 리그는 생략합니다. 적용 단계가 그 구간의 기존 손 값을 유지합니다.
 */
export function retargetHands(
  model: THREE.Object3D,
  body: Record<string, Vector3Value>,
  hands: CaptureHands | undefined,
  yaw: number,
): Record<string, Vector3Value> {
  if (!hands?.left && !hands?.right) return body;
  setLiveBonePose(model, body);
  const output = { ...body };
  for (const side of ["left", "right"] as const) {
    const capture = hands[side];
    if (!capture || capture.world.length !== 21) continue;
    const prefix = side === "left" ? "Left" : "Right";
    const valid = (i: number) => {
      const p = capture.world[i];
      return p && p.v > 0.3 && [p.x, p.y, p.z].every(Number.isFinite);
    };
    const points = capture.world.map((p) => new THREE.Vector3(p.x, -p.y, -p.z).applyAxisAngle(up, -yaw));
    const hand = boneOf(model, `${prefix}Hand`);
    const index = boneOf(model, `${prefix}HandIndex1`);
    const middle = boneOf(model, `${prefix}HandMiddle1`);
    const pinky = boneOf(model, `${prefix}HandPinky1`);
    if (!hand) continue;
    // 손목 한 축만 맞추면 손바닥이 뒤집힐 수 있어 손바닥의 두 축을 함께 맞춥니다.
    if (index && middle && pinky && [0, 5, 9, 17].every(valid)) {
      const rest = palmBasis(at(index).sub(at(pinky)), at(middle).sub(at(hand)));
      const target = palmBasis(points[5].clone().sub(points[17]), points[9].clone().sub(points[0]));
      const preset = hand.userData.presetQuaternion as THREE.Quaternion | undefined;
      if (rest && target && preset) {
        const world = target.multiply(rest.invert()).multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
        const parent = hand.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
        hand.quaternion.copy(parent.invert().multiply(world));
        model.updateMatrixWorld(true);
        output[`${prefix}Hand`] = angles(preset.clone().invert().multiply(hand.quaternion));
      }
    }
    for (let finger = 0; finger < FINGERS.length; finger += 1) {
      for (let joint = 1; joint <= 3; joint += 1) {
        const point = 1 + finger * 4 + joint - 1;
        if (!valid(point) || !valid(point + 1)) continue;
        const name = `${prefix}Hand${FINGERS[finger]}${joint}`;
        const bone = boneOf(model, name);
        const child = boneOf(model, `${prefix}Hand${FINGERS[finger]}${joint + 1}`);
        const handFrame = bone?.userData.presetHandQuaternion as THREE.Quaternion | undefined;
        if (!bone || !child || !handFrame) continue;
        const from = at(child).sub(at(bone));
        const to = points[point + 1].clone().sub(points[point]);
        if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
        const swing = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
        const delta = handFrame.clone().invert().multiply(swing).multiply(handFrame);
        const value = angles(delta);
        // 재생과 같은 부모→자식 순서로, 앞 마디를 굽힌 뒤 다음 마디의 방향을 계산합니다.
        rotateFingerInHandFrame(model, bone, handFrame, value);
        output[name] = value;
      }
    }
  }
  return output;
}
