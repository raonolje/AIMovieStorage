import * as THREE from "three";
import { boneOf } from "./rig";

export interface CompositionContactInput {
  timeSeconds: number; characterId: string; side: "Left" | "Right";
  finger: "Thumb" | "Index" | "Middle" | "Ring" | "Pinky"; objectIds: string[];
}
const value = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/** 실제 렌더 geometry의 삼각형에서 거리를 구합니다. 회전·비균등 스케일·그룹 변환도 행렬로 반영합니다. */
export function pointToRenderedBox(pointMeters: THREE.Vector3, mesh: THREE.Mesh, compositionFromWorld: THREE.Matrix4) {
  if (mesh.geometry.type !== "BoxGeometry") throw new Error("unsupported_surface: 현재 측정은 실제 박스 geometry에만 지원합니다.");
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox!;
  const matrix = compositionFromWorld.clone().multiply(mesh.matrixWorld);
  if (Math.abs(matrix.determinant()) < 1e-14) throw new Error("invalid_surface: 크기가 0인 표면은 측정할 수 없습니다.");
  const local = pointMeters.clone().applyMatrix4(matrix.clone().invert());
  const inside = bounds.containsPoint(local);
  const position = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const triangle = new THREE.Triangle(), nearest = new THREE.Vector3();
  let distanceSq = Infinity, closest = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    for (const [j, v] of [[0, triangle.a], [1, triangle.b], [2, triangle.c]] as const)
      v.fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(matrix);
    triangle.closestPointToPoint(pointMeters, nearest);
    const d = nearest.distanceToSquared(pointMeters);
    if (d < distanceSq) { distanceSq = d; closest.copy(nearest); triangle.getNormal(normal); }
  }
  const distance = Math.sqrt(distanceSq);
  return { signedGapMeters: inside ? -distance : distance, distanceMeters: distance,
    pointInsideBox: inside && distance > 1e-9, closestSurfacePointMeters: value(closest), surfaceNormal: value(normal),
    geometry: { type: mesh.geometry.type, localMin: value(bounds.min), localMax: value(bounds.max),
      compositionMatrix: matrix.toArray() } };
}

/** 끝 본의 원점은 해부학적 피부 표면이 아닙니다. 점의 박스 침투와 손 피부 충돌은 구분합니다. */
export function measureRenderedContact(foreground: THREE.Object3D, rig: THREE.Object3D,
  objects: Map<string, THREE.Object3D>, input: CompositionContactInput) {
  foreground.updateWorldMatrix(true, true);
  const boneName = `${input.side}Hand${input.finger}4`;
  const bone = boneOf(rig, boneName);
  if (!bone) throw new Error("bone_not_found: 이 모델에 요청한 손끝 끝 본이 없습니다. 임의 길이로 추정하지 않습니다.");
  const rendered = bone.getWorldPosition(new THREE.Vector3());
  // foregroundZoom은 화면 표시 배율입니다. 이를 제거한 구도 좌표계의 미터로 표면과 점을 함께 비교합니다.
  const compositionFromWorld = foreground.matrixWorld.clone().invert();
  const point = rendered.clone().applyMatrix4(compositionFromWorld);
  const parentPoint = bone.parent?.getWorldPosition(new THREE.Vector3()).applyMatrix4(compositionFromWorld);
  const segmentDirection = parentPoint ? point.clone().sub(parentPoint).normalize() : null;
  const surfaces = input.objectIds.map(id => {
    const root = objects.get(id);
    if (!root) throw new Error("object_not_ready: 대상 소품이 렌더 씬에 준비되지 않았습니다.");
    const meshes: THREE.Mesh[] = [];
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node.userData.helper) return;
      for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent)
        if (!parent.visible || parent.userData.helper) return;
      meshes.push(node);
    });
    if (meshes.length !== 1 || meshes[0].geometry.type !== "BoxGeometry")
      throw new Error("unsupported_surface: 단일 박스 렌더 표면만 측정합니다. 시트·교체 모델·곡면은 근사하지 않습니다.");
    return { objectId: id, ...pointToRenderedBox(point, meshes[0], compositionFromWorld) };
  });
  return { timeSeconds: input.timeSeconds, units: "meters", coordinateSpace: "composition-world (foreground display zoom removed)",
    probe: { characterId: input.characterId, bone: bone.name, kind: "skeletal-finger-endpoint", positionMeters: value(point),
      parentJointPositionMeters: parentPoint ? value(parentPoint) : null,
      lastSegmentDirection: segmentDirection ? value(segmentDirection) : null,
      renderedWorldPosition: value(rendered) }, surfaces, skinContactVerified: false, wholeHandPenetrationVerified: false };
}
