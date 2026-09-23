import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Vector3Value } from "@/lib/composition";
import {
  LM,
  smoothSamples,
  type CaptureResult,
  type CaptureSample,
  type CapturedPerson,
  type SmoothingLevel,
} from "@/lib/motionCapture";
import { applyBasePose, applyBonePose, boneOf } from "@/lib/rig";
import { lockFootPlants, type FootPlantReport } from "@/lib/footPlant";
import { retargetHands, CAPTURE_FINGER_BONES } from "@/lib/handRetarget";

/**
 * 영상에서 뽑은 관절 좌표 → **우리 캐릭터 구조 그대로**의 키 값.
 *
 * , 「관절만 추적하면 안 되고
 * 이동이랑 몸체 회전도 추적해야 해」. 그래서 캐릭터를 IK 식으로 따로 만들지 않고, 한 순간을 세 갈래로 나눕니다.
 *
 * - **이동**(위치 트랙) — 화면 속 골반 자리와 몸 크기(멀어지면 작아짐)로 바닥 위 x·z, 발이 바닥에서 뜬 만큼 y(점프)
 * - **몸 전체 회전**(회전 트랙 y) — 골반·어깨가 향하는 쪽
 * - **관절 회전**(자세 트랙) — 몸 전체 회전을 뺀 나머지를 `MotionKey.bones`(차렷 기준 상대 오일러)로
 *
 * # 관절 회전을 구하는 방식
 *
 * 차렷으로 세운 보이지 않는 인형 하나에서, 부모 관절부터 차례로 «뼈가 가리키는 방향» 을 영상의 방향으로 돌려 맞춘 뒤,
 * 그 결과를 `bonePose` 와 같은 «프리셋 대비 상대 회전» 으로 읽어 냅니다(`boneDeltaEuler` 와 같은 계산). 화면이 거는 길
 * (`setLiveBonePose`)과 같은 기준이라, 키로 넣으면 인형이 뽑을 때와 똑같은 자세가 됩니다.
 *
 * 팔꿈치·무릎은 방향만 맞추면 위팔이 제멋대로 비틀려 **팔꿈치가 뒤로 꺾여** 보입니다. 그래서 위팔·허벅지를 먼저 제 축으로
 * 비틀어, 인형의 접히는 축이 영상의 «어깨–팔꿈치–손목 평면» 과 맞게 한 다음 아래 마디를 돌립니다.
 */

/** 몸 33점으로 푸는 관절. 손 21점이 있으면 `retargetHands`가 손가락 30마디를 더합니다. */
export const CAPTURE_BONES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
] as const;

/** 한 순간의 결과(카메라 기준). 장면에 세우는 일은 `placeCapturedMotion`. */
export interface RetargetFrame {
  time: number;
  /** 카메라 기준 미터 — x 화면 오른쪽, z 카메라 쪽(+), y 바닥에서 뜬 높이. */
  root: Vector3Value;
  /** 카메라를 마주 보면 0. 라디안, 풀어 둔(끊김 없는) 값. */
  yaw: number;
  bones: Record<string, Vector3Value>;
}

const UP = new THREE.Vector3(0, 1, 0);
/** 귀–코 선이 수평보다 내려가 있는 정도(정면을 볼 때). 이만큼은 «고개 숙임» 이 아닙니다. */
const HEAD_NOSE_DROP = 0.25;
/** 가정 세로 화각 — 앞뒤 이동 거리에만 쓰입니다(가로 이동은 화각과 무관). 휴대폰·캠코더 광각의 중간값. */
const ASSUMED_VERTICAL_FOV = (45 * Math.PI) / 180;

/** MediaPipe 미터 좌표 → 우리 좌표(y 위, 카메라를 마주 보는 사람의 앞이 +z, 그 사람의 왼쪽이 +x). */
const toVec = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, -p.y, -p.z);
const mid = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5);

/** 두 축(가로 X, 위 Y)으로 만든 회전. */
function basisQuaternion(xAxis: THREE.Vector3, yAxis: THREE.Vector3) {
  const y = yAxis.clone().normalize();
  const x = xAxis.clone().sub(y.clone().multiplyScalar(xAxis.dot(y))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

interface LimbRest {
  upper: string;
  lower: string;
  end: string;
  /** 아래 마디가 접히는 축 — 아래 마디 로컬 좌표. */
  hingeLocal: THREE.Vector3;
}

export interface RetargetRig {
  model: THREE.Object3D;
  restWorld: Map<string, THREE.Quaternion>;
  hipsRest: THREE.Quaternion;
  chestRest: THREE.Quaternion;
  limbs: LimbRest[];
}

/**
 * 뽑기용 인형 — 화면의 인형과 **같은 순서**(차렷 → 프리셋 기준 기록)로 세웁니다(`CompositionViewport` 의 attachRig).
 * 크기는 안 맞춥니다 — 방향만 쓰기 때문입니다.
 */
export function createRetargetRig(template: THREE.Object3D): RetargetRig {
  const model = cloneSkeleton(template);
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1);
  applyBasePose(model);
  applyBonePose(model, {});
  model.updateMatrixWorld(true);

  const restWorld = new Map<string, THREE.Quaternion>();
  for (const name of [...CAPTURE_BONES, "Spine1"]) {
    const bone = boneOf(model, name);
    if (bone) restWorld.set(name, bone.getWorldQuaternion(new THREE.Quaternion()));
  }
  const at = (name: string) => {
    const bone = boneOf(model, name);
    return bone ? new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld) : new THREE.Vector3();
  };
  const hipMid = mid(at("LeftUpLeg"), at("RightUpLeg"));
  const shoulderMid = mid(at("LeftArm"), at("RightArm"));
  const torsoUp = shoulderMid.clone().sub(hipMid);
  const hipsRest = basisQuaternion(at("LeftUpLeg").sub(at("RightUpLeg")), torsoUp);
  const chestRest = basisQuaternion(at("LeftArm").sub(at("RightArm")), torsoUp);

  const limbs: LimbRest[] = [];
  const addLimb = (upper: string, lower: string, end: string, flex: THREE.Vector3) => {
    const lowerBone = boneOf(model, lower);
    if (!lowerBone || !boneOf(model, upper) || !boneOf(model, end)) return;
    // 곧게 편 아래 마디가 «앞(팔)·뒤(다리)» 로 접힐 때의 축. 부호까지 맞춰 두어야 꺾이는 쪽이 사람과 같습니다.
    const dir = at(end).sub(at(lower)).normalize();
    const hingeWorld = new THREE.Vector3().crossVectors(dir, flex).normalize();
    const inverse = lowerBone.getWorldQuaternion(new THREE.Quaternion()).invert();
    limbs.push({ upper, lower, end, hingeLocal: hingeWorld.applyQuaternion(inverse) });
  };
  addLimb("LeftArm", "LeftForeArm", "LeftHand", new THREE.Vector3(0, 0, 1));
  addLimb("RightArm", "RightForeArm", "RightHand", new THREE.Vector3(0, 0, 1));
  addLimb("LeftUpLeg", "LeftLeg", "LeftFoot", new THREE.Vector3(0, 0, -1));
  addLimb("RightUpLeg", "RightLeg", "RightFoot", new THREE.Vector3(0, 0, -1));
  return { model, restWorld, hipsRest, chestRest, limbs };
}

/** 본의 월드 회전을 정합니다(부모 역회전을 곱해 로컬로). */
function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion) {
  const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

const worldPosition = (bone: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

/** 뼈가 `target` 방향을 가리키게 월드에서 돌립니다(가장 짧은 회전). */
function swingTo(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  const current = worldPosition(child).sub(worldPosition(bone));
  if (current.lengthSq() < 1e-10 || target.lengthSq() < 1e-10) return;
  const swing = new THREE.Quaternion().setFromUnitVectors(current.normalize(), target.clone().normalize());
  setWorldQuaternion(bone, swing.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
}

/**
 * 한 순간의 33점(몸 회전을 뺀 좌표)으로 인형 자세를 맞추고, 관절마다 프리셋 대비 상대 회전을 돌려줍니다.
 */
function solvePose(rig: RetargetRig, points: THREE.Vector3[], visible: number[]): Record<string, Vector3Value> {
  const { model } = rig;
  model.traverse((node) => {
    const preset = node.userData.presetQuaternion as THREE.Quaternion | undefined;
    if ((node as THREE.Bone).isBone && preset) node.quaternion.copy(preset);
  });
  model.updateMatrixWorld(true);
  const bone = (name: string) => boneOf(model, name);
  const p = (index: number) => points[index];

  // ── 몸통: 골반은 골반 선, 가슴은 어깨 선. 사이 허리 마디는 둘 사이를 나눠 비틉니다 ──
  const hipMid = mid(p(LM.leftHip), p(LM.rightHip));
  const shoulderMid = mid(p(LM.leftShoulder), p(LM.rightShoulder));
  const torsoUp = shoulderMid.clone().sub(hipMid);
  const hipTurn = basisQuaternion(p(LM.leftHip).clone().sub(p(LM.rightHip)), torsoUp).multiply(
    rig.hipsRest.clone().invert(),
  );
  const chestTurn = basisQuaternion(p(LM.leftShoulder).clone().sub(p(LM.rightShoulder)), torsoUp).multiply(
    rig.chestRest.clone().invert(),
  );
  const earMid = mid(p(LM.leftEar), p(LM.rightEar));
  const earAxis = p(LM.leftEar).clone().sub(p(LM.rightEar));
  const facing = p(LM.nose).clone().sub(earMid);
  const headVisible = Math.min(visible[LM.nose], Math.max(visible[LM.leftEar], visible[LM.rightEar]));
  // 정면을 볼 때도 코는 귀보다 낮습니다 — 그만큼을 «기준 얼굴» 에 넣어 두어야 늘 고개 숙인 인형이 안 됩니다.
  const restFacing = new THREE.Vector3(0, -Math.sin(HEAD_NOSE_DROP), Math.cos(HEAD_NOSE_DROP));
  const restHead = basisQuaternion(new THREE.Vector3(1, 0, 0), new THREE.Vector3().crossVectors(restFacing, new THREE.Vector3(1, 0, 0)));
  const liveHead = basisQuaternion(earAxis, new THREE.Vector3().crossVectors(facing, earAxis));
  const headTurn =
    headVisible > 0.4 && earAxis.lengthSq() > 1e-6 ? liveHead.multiply(restHead.invert()) : chestTurn.clone();

  const place = (name: string, turn: THREE.Quaternion) => {
    const target = bone(name);
    const rest = rig.restWorld.get(name);
    if (target && rest) setWorldQuaternion(target, turn.clone().multiply(rest));
  };
  place("Hips", hipTurn);
  place("Spine", hipTurn.clone().slerp(chestTurn, 1 / 3));
  place("Spine1", hipTurn.clone().slerp(chestTurn, 2 / 3));
  place("Spine2", chestTurn);
  place("Neck", chestTurn.clone().slerp(headTurn, 0.5));
  place("Head", headTurn);

  // ── 팔다리: 위 마디 방향 → 접히는 축 맞춰 비틀기 → 아래 마디 방향 → 손·발 ──
  const limbPoints: Record<string, [number, number, number]> = {
    LeftArm: [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
    RightArm: [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
    LeftUpLeg: [LM.leftHip, LM.leftKnee, LM.leftAnkle],
    RightUpLeg: [LM.rightHip, LM.rightKnee, LM.rightAnkle],
  };
  for (const limb of rig.limbs) {
    const [a, b, c] = limbPoints[limb.upper];
    const upper = bone(limb.upper);
    const lower = bone(limb.lower);
    const end = bone(limb.end);
    if (!upper || !lower || !end) continue;
    const upperDir = p(b).clone().sub(p(a));
    const lowerDir = p(c).clone().sub(p(b));
    swingTo(upper, lower, upperDir);

    const axis = upperDir.clone().normalize();
    const bend = new THREE.Vector3().crossVectors(axis, lowerDir.clone().normalize());
    // 거의 편 팔은 접히는 평면이 없어(점 떨림이 곧 방향) 비틀지 않습니다. 굽을수록 온전히 맞춥니다.
    const weight = THREE.MathUtils.smoothstep(bend.length(), 0.12, 0.4) * Math.min(visible[b], visible[c]) ** 0.5;
    if (weight > 0.01) {
      const hingeNow = limb.hingeLocal.clone().applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion()));
      const from = hingeNow.sub(axis.clone().multiplyScalar(hingeNow.dot(axis)));
      const to = bend.normalize().sub(axis.clone().multiplyScalar(bend.dot(axis)));
      if (from.lengthSq() > 1e-8 && to.lengthSq() > 1e-8) {
        from.normalize();
        to.normalize();
        const angle = Math.atan2(new THREE.Vector3().crossVectors(from, to).dot(axis), from.dot(to));
        const twist = new THREE.Quaternion().setFromAxisAngle(axis, angle * weight);
        setWorldQuaternion(upper, twist.multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
      }
    }
    swingTo(lower, end, lowerDir);
  }
  const hands: [string, string, number, number, number][] = [
    ["LeftHand", "LeftHandMiddle1", LM.leftWrist, LM.leftIndex, LM.leftPinky],
    ["RightHand", "RightHandMiddle1", LM.rightWrist, LM.rightIndex, LM.rightPinky],
  ];
  for (const [name, childName, wrist, index, pinky] of hands) {
    const hand = bone(name);
    const child = bone(childName);
    if (!hand || !child || Math.min(visible[index], visible[pinky]) < 0.3) continue;
    swingTo(hand, child, mid(p(index), p(pinky)).sub(p(wrist)));
  }
  const feet: [string, string, number, number][] = [
    ["LeftFoot", "LeftToeBase", LM.leftAnkle, LM.leftFootIndex],
    ["RightFoot", "RightToeBase", LM.rightAnkle, LM.rightFootIndex],
  ];
  for (const [name, childName, ankle, toe] of feet) {
    const foot = bone(name);
    const child = bone(childName);
    if (!foot || !child || visible[toe] < 0.3) continue;
    swingTo(foot, child, p(toe).clone().sub(p(ankle)));
  }

  // ── 프리셋 대비 상대 회전으로 읽기(`boneDeltaEuler` 와 같은 식) ──
  const out: Record<string, Vector3Value> = {};
  const euler = new THREE.Euler();
  for (const name of CAPTURE_BONES) {
    const target = bone(name);
    const preset = target?.userData.presetQuaternion as THREE.Quaternion | undefined;
    if (!target || !preset) continue;
    euler.setFromQuaternion(preset.clone().invert().multiply(target.quaternion), "XYZ");
    if (Math.abs(euler.x) + Math.abs(euler.y) + Math.abs(euler.z) < 1e-4) continue;
    out[name] = { x: round4(euler.x), y: round4(euler.y), z: round4(euler.z) };
  }
  return out;
}

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/** 몸이 향하는 쪽(카메라를 마주 보면 0) — 골반 선과 어깨 선을 더해 한쪽이 옆으로 겹쳐 짧아져도 버팁니다. */
function yawOf(points: THREE.Vector3[]) {
  const across = points[LM.leftHip].clone().sub(points[LM.rightHip]).add(points[LM.leftShoulder].clone().sub(points[LM.rightShoulder]));
  return Math.atan2(-across.z, across.x);
}

/** 시간순 값들의 가우스 평활. 간격이 벌어진 곳은 넘어 섞지 않습니다. */
function smoothSeries(times: number[], values: number[], sigma: number) {
  return values.map((_, i) => {
    let total = 0;
    let sum = 0;
    for (let k = i; k >= 0 && times[i] - times[k] <= sigma * 2.5; k -= 1) {
      if (k < i && times[k + 1] - times[k] > 0.35) break;
      const w = Math.exp(-((times[i] - times[k]) ** 2) / (2 * sigma * sigma));
      sum += values[k] * w;
      total += w;
    }
    for (let k = i + 1; k < values.length && times[k] - times[i] <= sigma * 2.5; k += 1) {
      if (times[k] - times[k - 1] > 0.35) break;
      const w = Math.exp(-((times[k] - times[i]) ** 2) / (2 * sigma * sigma));
      sum += values[k] * w;
      total += w;
    }
    return sum / total;
  });
}

/**
 * 한 사람을 순간마다 «이동·몸 회전·관절 회전» 으로 풉니다.
 *
 * # 이동을 재는 법
 *
 * 영상 좌표는 화면 안의 자리뿐이라, **몸통·다리 길이(미터 좌표)를 화면 속 길이(픽셀)로 나눈 값** k(픽셀 하나가 몇 m 인가)를
 * 순간마다 잽니다. 가로 자리 = (골반 화면 x − 화면 가운데) × k — 화각을 몰라도 맞습니다. 카메라에서의 거리 = 초점거리 × k
 * — 이쪽만 화각을 가정합니다(45°). 몸이 기울어 짧아 보이는 마디가 k 를 키우므로 여섯 마디 중 **둘째로 작은 값**을 씁니다.
 * 점프는 발 높이(같은 k 로 잰 미터)가 앞뒤 2 초의 바닥보다 떠오른 만큼입니다.
 */
export function retargetPerson(
  rig: RetargetRig,
  person: CapturedPerson,
  capture: Pick<CaptureResult, "width" | "height">,
  options: {
    smoothing?: SmoothingLevel;
    /**
     * 디딘 발 고정(`footPlant.ts`). **기본은 꺼짐** — 켜야만 한 단계가 더 붙습니다.
     *
     * 그래서 이 한 줄과 파일 하나가 경계 전부입니다.
     */
    footPlant?: boolean;
    /** 무엇이 달라졌는지 창에 적으려고 — 켰을 때만 부릅니다. */
    onPlantReport?: (report: FootPlantReport) => void;
  } = {},
): RetargetFrame[] {
  const samples: CaptureSample[] = smoothSamples(person.samples, options.smoothing ?? "normal");
  if (!samples.length) return [];
  const { width, height } = capture;
  const focal = height / (2 * Math.tan(ASSUMED_VERTICAL_FOV / 2));
  const segments: [number, number][] = [
    [LM.leftShoulder, LM.leftHip],
    [LM.rightShoulder, LM.rightHip],
    [LM.leftHip, LM.leftKnee],
    [LM.rightHip, LM.rightKnee],
    [LM.leftKnee, LM.leftAnkle],
    [LM.rightKnee, LM.rightAnkle],
  ];

  const times = samples.map((s) => s.time);
  const logScale: number[] = [];
  let lastScale = 0.003;
  for (const sample of samples) {
    const ratios: number[] = [];
    for (const [a, b] of segments) {
      if (Math.min(sample.image[a].v, sample.image[b].v) < 0.5) continue;
      const pixels = Math.hypot((sample.image[a].x - sample.image[b].x) * width, (sample.image[a].y - sample.image[b].y) * height);
      const meters = toVec(sample.world[a]).distanceTo(toVec(sample.world[b]));
      if (pixels > 4 && meters > 0.05) ratios.push(meters / pixels);
    }
    ratios.sort((x, y) => x - y);
    if (ratios.length) lastScale = ratios[Math.min(1, ratios.length - 1)];
    logScale.push(Math.log(lastScale));
  }
  // 거리는 떨림이 크게 번집니다(초점거리를 곱하니까) — 넉넉히 눌러 둡니다.
  const scale = smoothSeries(times, logScale, 0.35).map(Math.exp);

  const rootX: number[] = [];
  const rootZ: number[] = [];
  const footY: number[] = [];
  /*
    엔진이 실제 이동 자리를 준 경우(GVHMR) — 화면 속 크기로 짐작하지 않습니다. 카메라가 따라가며 찍은 영상에서는 사람이 화면
    가운데에 머물러 짐작하면 제자리걸음이 되기 때문입니다. 좌표는 첫 장 카메라 기준(y 아래)이라 앱 방향으로만 바꿉니다.
  */
  const given = samples.every((sample) => sample.root);
  samples.forEach((sample, i) => {
    if (given && sample.root) {
      rootX.push(sample.root.x);
      rootZ.push(-sample.root.z);
      footY.push(-sample.root.y);
      return;
    }
    const k = scale[i];
    const hipU = ((sample.image[LM.leftHip].x + sample.image[LM.rightHip].x) / 2) * width;
    rootX.push((hipU - width / 2) * k);
    rootZ.push(-(focal * k));
    const footIndices = [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex];
    const lowest = Math.max(...footIndices.map((j) => (sample.image[j].v > 0.3 ? sample.image[j].y : 0)));
    footY.push(lowest > 0 ? -(lowest * height - height / 2) * k : Number.NaN);
  });
  const smoothX = smoothSeries(times, rootX, 0.08);
  const smoothZ = smoothSeries(times, rootZ, 0.2);
  const jump = footY.map((value, i) => {
    if (!Number.isFinite(value)) return 0;
    const near = footY.filter((other, k) => Number.isFinite(other) && Math.abs(times[k] - times[i]) <= 2).sort((a, b) => a - b);
    const ground = near[Math.floor(near.length * 0.15)] ?? value;
    // 거리 추정 오차(몇 %)가 발 높이 몇 cm 로 번지므로 그 밑은 버립니다.
    return Math.min(1.5, Math.max(0, value - ground - 0.06));
  });
  const smoothJump = smoothSeries(times, jump, 0.05);

  let previousYaw = 0;
  const frames = samples.map((sample, i) => {
    const points = sample.world.map(toVec);
    let yaw = yawOf(points);
    // 끊김 없이 풀어 둡니다 — 회전 트랙은 숫자를 그대로 섞어서(179°→−179° 면 한 바퀴 돕니다).
    if (i > 0) {
      while (yaw - previousYaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw - previousYaw < -Math.PI) yaw += Math.PI * 2;
    }
    previousYaw = yaw;
    const unturned = points.map((point) => point.clone().applyAxisAngle(UP, -yaw));
    const body = solvePose(rig, unturned, sample.world.map((point) => point.v));
    const bones = retargetHands(rig.model, body, sample.hands, yaw);
    return {
      time: sample.time,
      root: { x: smoothX[i], y: smoothJump[i], z: smoothZ[i] },
      yaw,
      bones,
    };
  });
  const settled = despikeRotations(frames);
  if (!options.footPlant) return settled;
  const locked = lockFootPlants(rig, settled);
  options.onPlantReport?.(locked.report);
  return locked.frames;
}

/**
 * **관절 회전의 한 장짜리 튐** 을 앞뒤 사이 값으로.
 *
 * 좌표 단계의 튐 보정(`motionRepair.repairPerson`)을 지나도, 팔이 거의 곧게 펴진 장에서는 위팔 비틀기 방향이 한 장만 반대로
 * 잡혀 캐릭터 팔이 «휙 돌았다 돌아오는» 일이 남습니다(점 떨림이 곧 비틀기 방향이 되는 자세). 좌표로는 멀쩡해서 앞 단계가 못
 * 봅니다. 그래서 회전으로 한 번 더 봅니다 — 앞 장→이 장, 이 장→뒤 장이 둘 다 크게 돌았는데(0.6 rad 넘게) 앞 장→뒤 장은 가까우면
 * 이 장을 앞뒤의 가운데로. 몸 방향(yaw)도 같은 식으로 봅니다.
 */
function despikeRotations(frames: RetargetFrame[]) {
  if (frames.length < 3) return frames;
  const quat = (value: Vector3Value) => new THREE.Quaternion().setFromEuler(new THREE.Euler(value.x, value.y, value.z, "XYZ"));
  const zero = { x: 0, y: 0, z: 0 };
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 1; i < frames.length - 1; i += 1) {
      const before = frames[i - 1];
      const current = frames[i];
      const after = frames[i + 1];
      if (after.time - before.time > 0.25) continue;
      for (const name of [...CAPTURE_BONES, ...CAPTURE_FINGER_BONES]) {
        // 미검출 손가락을 0으로 채워 앞뒤 실측값까지 지우지 않습니다.
        if (!current.bones[name] || !before.bones[name] || !after.bones[name]) continue;
        const a = quat(before.bones[name] ?? zero);
        const b = quat(current.bones[name] ?? zero);
        const c = quat(after.bones[name] ?? zero);
        const into = a.angleTo(b);
        const out = b.angleTo(c);
        if (into > 0.6 && out > 0.6 && a.angleTo(c) < Math.min(into, out) * 0.5) {
          const euler = new THREE.Euler().setFromQuaternion(a.slerp(c, 0.5), "XYZ");
          current.bones = { ...current.bones, [name]: { x: round4(euler.x), y: round4(euler.y), z: round4(euler.z) } };
        }
      }
      const into = Math.abs(current.yaw - before.yaw);
      const out = Math.abs(after.yaw - current.yaw);
      if (into > 0.8 && out > 0.8 && Math.abs(after.yaw - before.yaw) < Math.min(into, out) * 0.5)
        current.yaw = (before.yaw + after.yaw) / 2;
    }
  }
  return frames;
}

/** 한 사람 ↔ 한 캐릭터 짝. */
export interface CaptureAssignment {
  characterId: string;
  frames: RetargetFrame[];
  /** 키를 넣기 전 캐릭터의 자리·회전 — 움직임은 여기서 시작합니다. */
  position: Vector3Value;
  rotation: Vector3Value;
}

/** 장면에 세운 한 순간. */
export interface PlacedFrame {
  time: number;
  position: Vector3Value;
  rotation: Vector3Value;
  bones: Record<string, Vector3Value>;
}

/**
 * 카메라 기준 움직임을 **장면에** 세웁니다.
 *
 * - 대형 유지(`formation`) — 여러 사람이면 영상 속 서로의 간격·앞뒤가 그대로 옮겨집니다. 기준 자리는 짝지은 캐릭터들의 지금
 * 자리 평균, 정면은 첫 캐릭터가 지금 보는 쪽입니다. 군무에서 «누가 앞줄» 이 흐트러지면 뮤직비디오가 안 됩니다.
 * - 제자리 기준 — 캐릭터마다 지금 자리·방향에서 영상 속 **움직인 만큼만** 움직입니다.
 *
 * `start` 는 영상의 `captureStart` 초가 타임라인의 몇 초에 오는가.
 */
export function placeCapturedMotion(
  assignments: CaptureAssignment[],
  options: { start: number; captureStart: number; formation: boolean },
): { characterId: string; frames: PlacedFrame[] }[] {
  const live = assignments.filter((item) => item.frames.length > 0);
  if (!live.length) return [];
  const groupYaw = live[0].rotation.y;
  const groupOrigin = { x: 0, z: 0 };
  const groupAnchor = { x: 0, z: 0 };
  for (const item of live) {
    groupOrigin.x += item.frames[0].root.x / live.length;
    groupOrigin.z += item.frames[0].root.z / live.length;
    groupAnchor.x += item.position.x / live.length;
    groupAnchor.z += item.position.z / live.length;
  }
  return live.map((item) => {
    const formation = options.formation && live.length > 1;
    const yawBase = formation ? groupYaw : item.rotation.y;
    const origin = formation ? groupOrigin : { x: item.frames[0].root.x, z: item.frames[0].root.z };
    const anchor = formation ? groupAnchor : { x: item.position.x, z: item.position.z };
    // 영상의 «카메라를 마주 봄» 을 캐릭터가 지금 보는 쪽으로 — 첫 순간 영상 속 방향만큼은 더 돌아 있습니다.
    const cos = Math.cos(yawBase);
    const sin = Math.sin(yawBase);
    const frames = item.frames.map((frame) => {
      const dx = frame.root.x - origin.x;
      const dz = frame.root.z - origin.z;
      return {
        // 초당 30 장이면 1/30 초 간격이라 0.05 초 눈금에 못 맞춥니다 — 만분의 일 초로만.
        time: Math.round((options.start + frame.time - options.captureStart) * 1e4) / 1e4,
        position: {
          x: round4(anchor.x + dx * cos + dz * sin),
          y: round4(item.position.y + frame.root.y),
          z: round4(anchor.z - dx * sin + dz * cos),
        },
        rotation: { x: item.rotation.x, y: round4(yawBase + frame.yaw), z: item.rotation.z },
        bones: frame.bones,
      };
    });
    return { characterId: item.characterId, frames };
  });
}
