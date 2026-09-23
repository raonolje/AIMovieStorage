import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { createCameraMove, evaluateCameraMoves, type CameraMove, type CameraPose } from "@/lib/cameraMoves";
import { evaluateMotionTrack } from "@/lib/compositionEdit/timeline";
import type { MotionTrack } from "@/lib/composition";
import { applyMotionThenCameraAt, objectBoundsAnchor } from "./timelineFrame";

const base: CameraPose = { position: { x: 0, y: 1.4, z: 8 }, target: { x: 0, y: 1.4, z: 0 }, fovScale: 1 };
const following: CameraMove = { ...createCameraMove("static"), id: "follow", duration: 10, anchorTargetId: "actor", anchorRatio: 0.73, lookAtAnchor: true };
const motion: MotionTrack = {
  id: "move", targetId: "actor", channel: "position",
  keys: [{ id: "a", time: 0, value: { x: 0, y: 0, z: 0 } }, { id: "b", time: 10, value: { x: 20, y: -1, z: 0 } }],
};
function scene(move = following) {
  const actor = new Group();
  const body = new Mesh(new BoxGeometry(0.6, 1.8, 0.4), new MeshBasicMaterial());
  body.position.y = 0.9;
  actor.add(body);
  const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 100);
  let pose = base;
  const applyMotion = (time: number) => {
    const at = evaluateMotionTrack(motion, time)!;
    actor.position.set(at.x, at.y, at.z);
  };
  const applyCamera = (time: number) => {
    pose = evaluateCameraMoves(base, [move], time, current => current.anchorTargetId ? objectBoundsAnchor(actor, current.anchorRatio ?? 0.73) : null);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.fov = 42 * pose.fovScale;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };
  return { actor, camera, applyMotion, applyCamera, pose: () => pose,
    frame: (time: number) => applyMotionThenCameraAt(time, applyMotion, applyCamera),
    dispose: () => { body.geometry.dispose(); body.material.dispose(); },
  };
}

describe("움직이는 앵커의 같은 시각 평가", () => {
  it("기존 영상 순서는 첫 프레임의 시선점을 4m, 다음 24fps 프레임도 1/12m 뒤에 둔다", () => {
    const preview = scene();
    const oldVideo = scene();
    try {
      preview.frame(2);
      // 수정 전 drawAt의 순서를 그대로 재현합니다. WebGL이나 GPU는 쓰지 않습니다.
      oldVideo.applyCamera(2);
      oldVideo.applyMotion(2);
      expect(preview.pose().target.x - oldVideo.pose().target.x).toBeCloseTo(4, 9);
      const direction = (item: ReturnType<typeof scene>) => item.camera.getWorldDirection(new Vector3());
      expect(direction(preview).angleTo(direction(oldVideo))).toBeGreaterThan(0.4);
      const next = 2 + 1 / 24;
      preview.frame(next);
      oldVideo.applyCamera(next);
      oldVideo.applyMotion(next);
      expect(preview.pose().target.x - oldVideo.pose().target.x).toBeCloseTo(1 / 12, 9);
    } finally { preview.dispose(); oldVideo.dispose(); }
  });

  it("직접 탐색·역방향 탐색·연속 렌더 모두 미리보기와 같은 위치·시선·화각을 만든다", () => {
    const preview = scene();
    const capture = scene();
    try {
      // 내보내기를 누를 때 보던 시각이 달라도 결과가 그 이전 상태에 의존하지 않습니다.
      capture.applyMotion(9);
      for (const time of [2, 2 + 1 / 24, 7, 1, 1]) {
        preview.frame(time);
        capture.frame(time);
        expect(capture.pose()).toEqual(preview.pose());
        expect(capture.camera.matrixWorld.elements).toEqual(preview.camera.matrixWorld.elements);
        expect(capture.camera.projectionMatrix.elements).toEqual(preview.camera.projectionMatrix.elements);
        expect(capture.pose().target.x).toBeCloseTo(2 * time, 9);
        const anchor = objectBoundsAnchor(capture.actor, 0.73)!;
        const projected = new Vector3(anchor.x, anchor.y, anchor.z).project(capture.camera);
        expect(projected.x).toBeCloseTo(0, 9);
        expect(projected.y).toBeCloseTo(0, 9);
      }
    } finally { preview.dispose(); capture.dispose(); }
  });

  it("월드 경계는 움직인 부모 묶음과 전경 배율을 반영한다", () => {
    const item = scene();
    try {
      const parent = new Group();
      parent.position.set(10, 3, -2);
      parent.scale.setScalar(2);
      parent.add(item.actor);
      parent.updateMatrixWorld(true);
      item.frame(2);
      expect(item.pose().target.x).toBeCloseTo(18, 9);
      expect(item.pose().target.z).toBeCloseTo(-2, 9);
      expect(objectBoundsAnchor(new Group(), 0.73)).toBeNull();
    } finally { item.dispose(); }
  });

  it("앵커 없는 절대 카메라 키의 기존 결과는 순서 변경으로 달라지지 않는다", () => {
    const move: CameraMove = { ...following, shotId: "free", anchorTargetId: undefined, keys: [
      { id: "c0", time: 0, pose: base },
      { id: "c1", time: 10, pose: { position: { x: 3, y: 2, z: 5 }, target: { x: 1, y: 1, z: 0 }, fovScale: 0.8 } },
    ] };
    const current = scene(move);
    const old = scene(move);
    try {
      for (const time of [2, 7, 1]) {
        old.applyCamera(time);
        old.applyMotion(time);
        current.frame(time);
        expect(current.pose()).toEqual(old.pose());
        expect(current.camera.matrixWorld.elements).toEqual(old.camera.matrixWorld.elements);
        expect(current.camera.fov).toBe(old.camera.fov);
      }
    } finally { current.dispose(); old.dispose(); }
  });
});
