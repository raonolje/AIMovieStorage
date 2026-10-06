import * as THREE from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import type { CapturePoint, CaptureResult } from "./motionCapture";

/** SOMA joint names from Kimodo's 77-joint BVH export, mapped to MediaPipe's body landmarks. */
const JOINTS: Record<number, string> = {
  0: "Head", 2: "LeftEye", 5: "RightEye", 7: "LeftEye", 8: "RightEye",
  11: "LeftShoulder", 12: "RightShoulder", 13: "LeftForeArm", 14: "RightForeArm",
  15: "LeftHand", 16: "RightHand", 17: "LeftHandMiddleEnd", 18: "RightHandMiddleEnd",
  19: "LeftHandMiddleEnd", 20: "RightHandMiddleEnd", 21: "LeftHandThumbEnd", 22: "RightHandThumbEnd",
  23: "LeftLeg", 24: "RightLeg", 25: "LeftShin", 26: "RightShin",
  27: "LeftFoot", 28: "RightFoot", 29: "LeftFoot", 30: "RightFoot",
  31: "LeftToeBase", 32: "RightToeBase",
};
const REQUIRED = ["Hips", "Head", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm",
  "LeftHand", "RightHand", "LeftLeg", "RightLeg", "LeftShin", "RightShin",
  "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"];

/**
 * Convert an official Kimodo SOMA BVH to the app's normal 33-point mocap result.
 * Kimodo exports BVH offsets in centimeters; the app retargeter expects meters.
 * This is a lossy body-pose bridge. Hand-finger tracking is deliberately absent.
 */
export function kimodoBvhToCapture(text: string): CaptureResult {
  if (text.length > 80_000_000) throw new Error("BVH 파일이 너무 큽니다.");
  const frameTime = Number(/Frame Time:\s*([\d.eE+-]+)/i.exec(text)?.[1]);
  if (!Number.isFinite(frameTime) || frameTime <= 0 || frameTime > 1)
    throw new Error("BVH 프레임 간격이 올바르지 않습니다.");
  const parsed = new BVHLoader().parse(text);
  const bones = new Map(parsed.skeleton.bones.map(bone => [bone.name, bone]));
  if (REQUIRED.some(name => !bones.has(name))) throw new Error("KIMODO SOMA BVH의 필수 관절이 없습니다.");
  const root = new THREE.Group();
  root.add(parsed.skeleton.bones[0]);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(parsed.clip).play();
  const count = Math.round(parsed.clip.duration / frameTime) + 1;
  if (count < 2 || count > 18000) throw new Error("BVH는 2~18,000프레임이어야 합니다.");
  const position = (name: string) => bones.get(name)!.getWorldPosition(new THREE.Vector3()).multiplyScalar(0.01);
  const samples: CaptureResult["persons"][number]["samples"] = [];
  let firstHip: THREE.Vector3 | null = null;
  for (let index = 0; index < count; index++) {
    mixer.setTime(Math.min(parsed.clip.duration, index * frameTime));
    root.updateMatrixWorld(true);
    const hip = position("Hips");
    firstHip ??= hip.clone();
    const world: CapturePoint[] = Array.from({ length: 33 }, (_, landmark) => {
      const joint = JOINTS[landmark] ?? "Head";
      const point = position(bones.has(joint) ? joint : joint.endsWith("End") ? joint.replace(/End$/, "") : "Head").sub(hip);
      return { x: point.x, y: -point.y, z: -point.z, v: JOINTS[landmark] ? 1 : 0.5 };
    });
    // MediaPipe's face landmarks are not part of SOMA. Keep a small, stable face frame.
    for (const landmark of [1, 3, 4, 6, 9, 10]) world[landmark] = { ...world[0],
      x: world[0].x + (landmark % 2 ? 0.035 : -0.035), v: 0.3 };
    const image = world.map(point => ({ ...point,
      x: Math.max(0, Math.min(1, 0.5 + point.x / 2)),
      y: Math.max(0, Math.min(1, 0.55 + point.y / 2)) }));
    samples.push({ time: Math.round(index * frameTime * 10000) / 10000, image, world,
      root: { x: hip.x - firstHip.x, y: firstHip.y - hip.y, z: firstHip.z - hip.z } });
  }
  const duration = samples[samples.length - 1].time;
  return { width: 640, height: 480, duration, fps: 1 / frameTime,
    start: 0, end: duration, engine: "kimodo-soma-bvh", persons: [{ number: 1, samples }] };
}
