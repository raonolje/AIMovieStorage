import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { normalizeComposition } from "./composition";
import { compositionCommandSchema, reduceCompositionCommands } from "./compositionControlCommands";
import { objectSurfaceParameters } from "./compositionSurfaceMaterial";

const context = { characterIds: [], imageIds: [] };
function fixture() {
  return normalizeComposition({ objects: [{ id: "chip", label: "칩", kind: "box", visible: true,
    position: {x: -.5714, y: 1.02, z: .6204}, rotation: {x: 0, y: 0, z: 0},
    scale: {x: .024, y: .003, z: .016}, color: "#555555" }],
    timeline: {duration: 6, fps: 24},
    motionTracks: [{id: "motion", targetId: "chip", positionKeys: [
      {id: "start", time: 0, value: {x: -.5714, y: 1.02, z: .6204}},
      {id: "end", time: 6, value: {x: -.5714, y: 1.02, z: .8004}},
    ]}],
  });
}
describe("형상을 보존하는 소품 재질", () => {
  it("공식 명령이 재질 두 값만 변경하고 카메라·동선·접촉 형상을 보존한다", () => {
    const before = fixture();
    const snapshot = JSON.stringify(before);
    const {state} = reduceCompositionCommands(before, [{op: "object.material", id: "chip", material: {roughness: .24, metalness: .8}}], context);
    expect(before).toEqual(JSON.parse(snapshot));
    const expected = structuredClone(before);
    expected.objects[0].surfaceMaterial = {roughness: .24, metalness: .8};
    expect(state).toEqual(expected);
    expect(normalizeComposition(JSON.parse(JSON.stringify(state))).objects[0].surfaceMaterial).toEqual(expected.objects[0].surfaceMaterial);
    const camera = new THREE.PerspectiveCamera(45, 16/9, .01, 100);
    camera.position.set(-.57, 1.1, 1.0); camera.lookAt(-.57, 1.02, .62); camera.updateMatrixWorld();
    function geometry(item: typeof before.objects[0]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(objectSurfaceParameters(item, {roughness: .7, metalness: .05})));
      mesh.position.set(item.position.x, item.position.y + item.scale.y / 2, item.position.z);
      mesh.scale.set(item.scale.x, item.scale.y, item.scale.z); mesh.updateMatrixWorld();
      const bounds = new THREE.Box3().setFromObject(mesh);
      return {matrix: mesh.matrixWorld.toArray(), bounds: [bounds.min.toArray(), bounds.max.toArray()],
        corners: Array.from({length: 8}, (_,i) => new THREE.Vector3(i&1?.5:-.5, i&2?.5:-.5, i&4?.5:-.5).applyMatrix4(mesh.matrixWorld).project(camera).toArray())};
    }
    expect(geometry(state.objects[0])).toEqual(geometry(before.objects[0]));
    const {state: cleared} = reduceCompositionCommands(state, [{op: "object.material", id: "chip", material: null}], context);
    expect(cleared.objects[0].surfaceMaterial).toBeUndefined();
  });
  it("범위 밖 재질과 형상을 함께 바꾸는 입력을 거부한다", () => {
    for (const material of [{roughness: -1, metalness: 0}, {roughness: .5, metalness: 2}, {roughness: NaN, metalness: .1}]) {
      expect(compositionCommandSchema.safeParse({op: "object.material", id: "chip", material}).success).toBe(false);
    }
    expect(compositionCommandSchema.safeParse({op: "object.material", id: "chip", material: null, scale: {x: 2, y: 2, z: 2}}).success).toBe(false);
    for (const kind of ["light", "swapped"] as const) {
      const state = fixture();
      if (kind === "light") state.objects[0].kind = "light";
      else state.objects[0].swapRef = {kind: "asset", id: "asset", name: "교체"};
      expect(() => reduceCompositionCommands(state, [{op: "object.material", id: "chip", material: {roughness: .5, metalness: 0}}], context)).toThrow();
    }
  });
  it("옛 저장본과 손상된 재질은 기존 기본값으로 렌더한다", () => {
    const defaults = {roughness: .7, metalness: .05};
    expect(objectSurfaceParameters({}, defaults)).toEqual(defaults);
    expect(objectSurfaceParameters({surfaceMaterial: {roughness: Infinity, metalness: .5}}, defaults)).toEqual(defaults);
    expect(objectSurfaceParameters({surfaceMaterial: {roughness: .2, metalness: .8}}, defaults)).toEqual({roughness: .2, metalness: .8});
  });
});
