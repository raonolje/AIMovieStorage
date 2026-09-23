import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { retargetHands, CAPTURE_FINGER_BONES } from "./handRetarget";
import { createRetargetRig } from "./motionRetarget";
import { boneOf, setLiveBonePose } from "./rig";
import { assembleCapture, smoothSamples, type CaptureHands } from "./motionCapture";
import { repairPerson } from "./motionRepair";
import { normalizeComposition, type Vector3Value } from "./composition";
import { addMannequinIn, applyCapturedMotionIn, evaluatePoseTrack } from "./compositionEdit";

let template: THREE.Object3D;
beforeAll(async () => {
  const file = readFileSync(new URL("../../public/models/male.glb", import.meta.url));
  template = (await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "")).scene;
});
const fingers = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
const at = (model: THREE.Object3D, name: string) => boneOf(model, name)!.getWorldPosition(new THREE.Vector3());
function captureHands(model: THREE.Object3D, yaw = 0): CaptureHands {
  const result: CaptureHands = {};
  for (const [side, prefix] of [["left", "Left"], ["right", "Right"]] as const) {
    const names = [`${prefix}Hand`, ...fingers.flatMap((finger) => [1, 2, 3, 4].map((j) => `${prefix}Hand${finger}${j}`))];
    const world = names.map((name) => {
      const p = at(model, name).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      return { x: p.x, y: -p.y, z: -p.z, v: 1 };
    });
    result[side] = { world, image: world.map((p) => ({ ...p, x: 0.5 + p.x * 0.1, y: 0.5 + p.y * 0.1 })) };
  }
  return result;
}
const body = { LeftArm: { x: 0.4, y: 0.2, z: -0.3 }, RightArm: { x: -0.2, y: 0.3, z: 0.4 } };

describe("실제 GLB 손가락 → 검출 좌표 → 타임라인 회전 → 실제 GLB", () => {
  it.each([0, 0.45, 1.0])("펴기·굽힘 %s: 양손 30마디 방향을 재생에서도 재현한다", (curl) => {
    const source = createRetargetRig(template).model;
    const pose: Record<string, Vector3Value> = { ...body, LeftHand: { x: 0.5, y: 0.2, z: -0.3 }, RightHand: { x: -0.4, y: -0.1, z: 0.2 } };
    for (const [i, name] of CAPTURE_FINGER_BONES.entries()) pose[name] = { x: curl * 0.07, y: curl * (i % 3) * 0.12, z: curl * (name.startsWith("Left") ? -1 : 1) };
    setLiveBonePose(source, pose);
    const rig = createRetargetRig(template);
    const solved = retargetHands(rig.model, body, captureHands(source, 0.7), 0.7);
    expect(CAPTURE_FINGER_BONES.filter((name) => name in solved)).toHaveLength(30);
    const replay = createRetargetRig(template).model;
    // 파일 저장/기존 키 병합으로 순서가 바뀌어도 같은 자세여야 합니다.
    setLiveBonePose(replay, Object.fromEntries(Object.entries(solved).reverse()));
    for (const name of CAPTURE_FINGER_BONES) {
      const child = name.slice(0, -1) + (Number(name.at(-1)) + 1);
      const wanted = at(source, child).sub(at(source, name)).normalize();
      const actual = at(replay, child).sub(at(replay, name)).normalize();
      expect(actual.distanceTo(wanted), name).toBeLessThan(0.0001);
    }
  });

  it("손 원점을 옮겨도 같고, 미검출·낮은 신뢰도 마디는 생성하지 않는다", () => {
    const original = captureHands(createRetargetRig(template).model);
    const shifted = structuredClone(original);
    for (const hand of Object.values(shifted)) for (const p of hand.world) { p.x += 20; p.y -= 7; p.z += 12; }
    const a = retargetHands(createRetargetRig(template).model, body, original, 0);
    const b = retargetHands(createRetargetRig(template).model, body, shifted, 0);
    for (const name of CAPTURE_FINGER_BONES) for (const axis of ["x", "y", "z"] as const) expect(b[name][axis]).toBeCloseTo(a[name][axis], 7);
    delete shifted.right;
    shifted.left!.world[7].v = 0.3;
    const partial = retargetHands(createRetargetRig(template).model, body, shifted, 0);
    expect(partial.LeftHandIndex2).toBeUndefined();
    expect(partial.RightHandThumb1).toBeUndefined();
    expect(retargetHands(createRetargetRig(template).model, body, undefined, 0)).toBe(body);
  });
});

function fileFixture() {
  const hands = captureHands(createRetargetRig(template).model);
  const pack = (hand: NonNullable<CaptureHands["left"]>) => ({ image: hand.image.map((p) => [p.x, p.y, p.v]), world: hand.world.map((p) => [p.x, p.y, p.z, p.v]) });
  const image = Array.from({ length: 33 }, (_, i) => [0.45 + (i % 2) * 0.1, i < 13 ? 0.3 : 0.6, 1]);
  const world = image.map(([x, y]) => [x, y, 0, 1]);
  return { width: 640, height: 480, duration: 0.5, fps: 10, frames: Array.from({ length: 5 }, (_, i) => ({ t: i / 10, people: [{ image, world, root: [2, 3, 4], hands: { left: pack(hands.left!), right: pack(hands.right!) } }] })) };
}
describe("손 데이터 손실 방지", () => {
  it("워커 JSON·사람 추적·튐 보정·평활화가 모두 양손 21점을 보존한다", () => {
    const result = assembleCapture(fileFixture());
    const repaired = repairPerson(result.persons[0], "normal");
    expect(repaired.samples[0].hands?.left?.world).toHaveLength(21);
    const smooth = smoothSamples(repaired.samples);
    expect(smooth).toHaveLength(5);
    expect(smooth[0].hands?.right?.world).toHaveLength(21);
    expect(JSON.parse(JSON.stringify(smooth))[0].hands.left.world).toHaveLength(21);
  });
  it("좌우 반전은 손 이름과 X만 뒤집고 손가락 순서는 보존한다", () => {
    const file = fileFixture();
    const raw = assembleCapture(file).persons[0].samples[0];
    const flipped = assembleCapture({ ...file, mirror: true });
    expect(flipped.mirrored).toBe(true);
    const sample = flipped.persons[0].samples[0];
    expect(sample.root?.x).toBe(-2);
    for (let i = 0; i < 21; i += 1) {
      expect(sample.hands!.left!.world[i].x).toBe(-raw.hands!.right!.world[i].x);
      expect(sample.hands!.left!.image[i].x).toBe(1 - raw.hands!.right!.image[i].x);
    }
  });
  it("깨진 손만 버리며 미검출 장을 평활화가 메우지 않는다", () => {
    const file = fileFixture();
    file.frames[2].people[0].hands = structuredClone(file.frames[2].people[0].hands);
    file.frames[2].people[0].hands.left.world[3][0] = Number.NaN;
    const samples = assembleCapture(file).persons[0].samples;
    expect(samples[2].hands?.left).toBeUndefined();
    expect(samples[2].hands?.right?.world).toHaveLength(21);
    expect(smoothSamples(samples)[2].hands?.left).toBeUndefined();
  });
  it("몸이 한 장 뒤집혀 복원된 장의 손은 추정 자세에 섞지 않는다", () => {
    const person = assembleCapture(fileFixture()).persons[0];
    for (const [left, right] of [[11, 12], [23, 24]]) {
      [person.samples[2].world[left], person.samples[2].world[right]] = [person.samples[2].world[right], person.samples[2].world[left]];
    }
    const repaired = repairPerson(person);
    expect(repaired.repaired!.frames).toBeGreaterThan(0);
    expect(repaired.samples.find((s) => s.time === 0.2)?.hands).toBeUndefined();
    expect(person.samples[2].hands?.left?.world).toHaveLength(21);
  });
  it("손을 못 읽은 장의 기존 손 키는 유지하고 검출한 마디만 바꾼다", () => {
    const id = "hand-test";
    const added = addMannequinIn(normalizeComposition(), "male", id);
    const previous = { LeftHandIndex2: { x: 0, y: 0, z: 0.6 }, RightHandThumb2: { x: 0, y: 0.3, z: 0 } };
    const initial = { ...added, motionTracks: [{ id: "old", targetId: id, channel: "pose" as const, keys: [{ id: "old1", time: 0, value: { x: 0, y: 0, z: 0 }, bones: previous }] }] };
    const changed = applyCapturedMotionIn(initial, [{ characterId: id, frames: [
      { time: 0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, bones: { LeftArm: body.LeftArm } },
      { time: 0.1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, bones: { LeftHandIndex2: { x: 0, y: 0, z: 0.2 } } },
    ] }], { position: false, rotation: false, pose: true });
    const track = changed.motionTracks![0];
    expect(evaluatePoseTrack(track, 0)?.LeftHandIndex2).toEqual(previous.LeftHandIndex2);
    expect(evaluatePoseTrack(track, 0.1)?.LeftHandIndex2.z).toBe(0.2);
    expect(evaluatePoseTrack(track, 0.1)?.RightHandThumb2).toEqual(previous.RightHandThumb2);
    expect(initial.motionTracks[0].keys[0].bones).toEqual(previous);
  });
});
