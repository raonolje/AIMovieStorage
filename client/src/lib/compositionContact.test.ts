import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { measureRenderedContact, pointToRenderedBox } from "./compositionContact";

describe("렌더 geometry에서 손끝 점과 박스 표면 측정", () => {
  it("바닥 원점 보정과 실제 scale을 사용하고 점 내부 침투는 음수 거리로 보고한다", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const root = new THREE.Group(); root.position.y = 1.035; root.scale.set(.024, .003, .016);
    mesh.position.y = .5; root.add(mesh); root.updateMatrixWorld(true);
    const outside = pointToRenderedBox(new THREE.Vector3(0, 1.04, 0), mesh, new THREE.Matrix4());
    expect(outside.signedGapMeters).toBeCloseTo(.002, 9);
    expect(outside.closestSurfacePointMeters.y).toBeCloseTo(1.038, 9);
    const inside = pointToRenderedBox(new THREE.Vector3(0, 1.0365, 0), mesh, new THREE.Matrix4());
    expect(inside.pointInsideBox).toBe(true); expect(inside.signedGapMeters).toBeCloseTo(-.0015, 9);
  });
  it("회전·비균등 스케일·부모 변환 뒤 거리와 표면 법선을 실제 삼각형에서 측정한다", () => {
    const parent = new THREE.Group(); parent.scale.set(2, 3, 4); parent.position.set(5, 2, -1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); mesh.rotation.z = .6; parent.add(mesh); parent.updateMatrixWorld(true);
    const surface = new THREE.Vector3(.5, 0, 0).applyMatrix4(mesh.matrixWorld);
    const normal = new THREE.Vector3(1, 0, 0).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
    const point = surface.clone().addScaledVector(normal, .2);
    const result = pointToRenderedBox(point, mesh, new THREE.Matrix4());
    expect(result.signedGapMeters).toBeCloseTo(.2, 8);
    expect(new THREE.Vector3(result.closestSurfacePointMeters.x, result.closestSurfacePointMeters.y, result.closestSurfacePointMeters.z).distanceTo(surface)).toBeLessThan(1e-8);
  });
  it("표시 zoom을 양쪽 좌표에서 제거하며 끝 본 누락·비박스 표면은 근사하지 않는다", () => {
    const foreground = new THREE.Group(); foreground.scale.setScalar(3);
    const rig = new THREE.Group(); const bone = new THREE.Bone(); bone.name = "mixamorig:RightHandIndex4"; bone.position.set(0, 2, 0); rig.add(bone);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); foreground.add(rig, box);
    const request = { characterId: "p", timeSeconds: 0, side: "Right" as const, finger: "Index" as const, objectIds: ["box"] };
    const result = measureRenderedContact(foreground, rig, new Map([["box", box]]), request);
    expect(result.probe.positionMeters.y).toBe(2); expect(result.probe.renderedWorldPosition.y).toBe(6);
    expect(result.surfaces[0].signedGapMeters).toBeCloseTo(1.5);
    expect(result.skinContactVerified).toBe(false);
    expect(() => measureRenderedContact(foreground, new THREE.Group(), new Map([["box", box]]), request)).toThrow("bone_not_found");
    const sphere = new THREE.Mesh(new THREE.SphereGeometry()); foreground.add(sphere);
    expect(() => measureRenderedContact(foreground, rig, new Map([["box", sphere]]), request)).toThrow("unsupported_surface");
  });
});
