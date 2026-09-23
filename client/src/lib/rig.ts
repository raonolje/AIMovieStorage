import * as THREE from "three";
import { FINGER_NAMES } from "@/lib/composition";
import type { FingerName, FingerState, Vector3Value } from "@/lib/composition";

/**
 * 리그(뼈대) 다루기.
 *
 * Mixamo 리그를 씁니다 — 본 이름이 전부 `mixamorig` 로 시작합니다.
 *
 * # 여기서 배운 것 하나
 *
 * **본의 로컬축을 믿으면 안 됩니다.** 로컬축은 부모 본에서 물려받기 때문에
 * 마디마다 방향이 조금씩 틀어져 있습니다. 「Z 축으로 굽히면 되겠지」 하고
 * 짜면 어떤 마디는 손바닥 쪽으로, 어떤 마디는 옆으로 벌어집니다.
 *
 * 그래서 두 가지로 해결합니다.
 *
 * - 몸통·팔다리 — **월드축** 기준으로 돌립니다 (`rotateBoneWorld`)
 * - 손가락 — **손 본의 좌표계**를 공통 기준으로 삼습니다 (`rotateFingerInHandFrame`)
 *
 * 손가락을 손 기준으로 다루면 세 마디가 같은 숫자에 같은 방식으로 반응합니다.
 * 이게 안 되면 수치 입력이 무용지물이 됩니다 — 같은 45도인데 마디마다
 * 다른 방향으로 굽으니까요.
 */

export const MIXAMO = "mixamorig";

/**
 * 본 이름 접두사가 파일마다 다릅니다.
 *
 * Mixamo 가 내보낸 FBX 원본은 `mixamorig:Head` 처럼 **콜론**이 들어갑니다.
 * 그런데 블렌더를 거쳐 GLB 로 내보내면 콜론이 쓸 수 없는 문자라 `_` 로
 * 바뀌거나 아예 빠집니다. 어느 쪽이 올지 알 수 없으니 셋 다 시도합니다.
 *
 * 이걸 안 하면 본을 하나도 못 찾아서 포즈·IK·손가락이 조용히 아무 일도
 * 안 합니다. 오류도 안 나서 원인을 찾기 어려운 종류의 고장이에요.
 */
const BONE_PREFIXES = [`${MIXAMO}:`, `${MIXAMO}_`, MIXAMO, ""];

export function boneOf(model: THREE.Object3D, name: string) {
  for (const prefix of BONE_PREFIXES) {
    const found = model.getObjectByName(`${prefix}${name}`);
    if (found) return found;
  }
  return undefined;
}

/** 본 이름에서 접두사를 뗍니다. `"mixamorig:LeftHandIndex2"` → `"LeftHandIndex2"` */
export function stripBonePrefix(name: string) {
  for (const prefix of BONE_PREFIXES) {
    if (prefix && name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

// ── 본 회전 ──────────────────────────────────────────────────────────────

/**
 * 월드축 기준으로 본을 회전시킵니다.
 * 본의 로컬축은 부모에서 물려받아 제각기 틀어져 있으므로, 공통 기준이 필요할 때 씁니다.
 */
export function rotateBoneWorld(
  model: THREE.Object3D,
  bone: THREE.Object3D,
  axis: THREE.Vector3,
  angle: number,
) {
  if (!bone.parent) return;
  model.updateMatrixWorld(true);
  const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const nextWorld = new THREE.Quaternion()
    .setFromAxisAngle(axis, angle)
    .multiply(boneWorld);
  bone.quaternion.copy(parentWorld.invert().multiply(nextWorld));
  model.updateMatrixWorld(true);
}

export const FINGER_BONE_RE =
  /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([123])$/;

/** 손가락 본이면 소속 손 본을 돌려줍니다. */
export function handBoneOf(model: THREE.Object3D, boneName: string) {
  const match = FINGER_BONE_RE.exec(boneName);
  return match ? boneOf(model, `${match[1]}Hand`) : null;
}

/**
 * 손 기준 좌표계로 손가락 본을 회전시킵니다.
 * 한 번의 쿼터니언 합성으로 처리해, 나중에 역으로 각도를 뽑아낼 때 정확히 되돌릴 수 있습니다.
 */
export function rotateFingerInHandFrame(
  model: THREE.Object3D,
  bone: THREE.Object3D,
  handQuat: THREE.Quaternion,
  rotation: Vector3Value,
) {
  if (!bone.parent) return;
  const local = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x, rotation.y, rotation.z, "XYZ"),
  );
  const deltaWorld = handQuat
    .clone()
    .multiply(local)
    .multiply(handQuat.clone().invert());
  model.updateMatrixWorld(true);
  const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(
    parentWorld.invert().multiply(deltaWorld.multiply(boneWorld)),
  );
  model.updateMatrixWorld(true);
}

/**
 * 프리셋 자세를 기준으로 관절별 추가 회전을 덧씌웁니다.
 *
 * 호출 전에 각 본의 프리셋 상태를 `userData` 에 남겨 둡니다. 나중에 기즈모로
 * 돌린 결과를 «프리셋 대비 상대 회전» 으로 되돌려 계산해야 하는데, 기준이
 * 없으면 못 하기 때문입니다.
 */
export function applyBonePose(
  model: THREE.Object3D,
  bonePose?: Record<string, Vector3Value>,
) {
  model.updateMatrixWorld(true);
  model.traverse((node) => {
    if (!(node as THREE.Bone).isBone) return;
    node.userData.presetQuaternion = node.quaternion.clone();
    // 손가락은 손 기준으로 각도를 다루므로, 되돌려 계산할 기준을 함께 남깁니다.
    node.userData.presetWorldQuaternion = node.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    const hand = handBoneOf(model, stripBonePrefix(node.name));
    if (hand)
      node.userData.presetHandQuaternion = hand.getWorldQuaternion(
        new THREE.Quaternion(),
      );
  });
  if (!bonePose) return;
  applyBoneDeltas(model, bonePose);
}

/** 프리셋 기준(`userData.presetQuaternion`)이 이미 남아 있는 본들에 상대 회전을 덧씌웁니다. */
function applyBoneDeltas(
  model: THREE.Object3D,
  bonePose: Record<string, Vector3Value>,
) {
  const euler = new THREE.Euler();
  const delta = new THREE.Quaternion();

  const entries = Object.entries(bonePose);
  // JSON의 키 삽입 순서는 자세의 일부가 아닙니다. 월드축으로 도는 손가락은
  // 몸·손목을 먼저 세운 뒤 부모 마디→끝 마디 순서로 걸어야 같은 자세가 재생됩니다.
  const ordered = [
    ...entries.filter(([name]) => !FINGER_BONE_RE.test(name)),
    ...entries.filter(([name]) => FINGER_BONE_RE.test(name)).sort(([a], [b]) => Number(a.at(-1)) - Number(b.at(-1))),
  ];
  for (const [boneName, rotation] of ordered) {
    if (!rotation || (!rotation.x && !rotation.y && !rotation.z)) continue;
    const bone = boneOf(model, boneName);
    if (!bone) continue;

    // 손가락은 「손 기준」 축으로 돌립니다. 그래야 세 마디가 같은 숫자에
    // 같은 방식으로 반응합니다.
    const handQuat = bone.userData.presetHandQuaternion as
      THREE.Quaternion | undefined;
    if (handQuat) {
      rotateFingerInHandFrame(model, bone, handQuat, rotation);
      continue;
    }

    euler.set(rotation.x, rotation.y, rotation.z, "XYZ");
    delta.setFromEuler(euler);
    bone.quaternion.multiply(delta);
  }
  model.updateMatrixWorld(true);
}

/**
 * **이미 서 있는 마네킹**의 자세를 통째로 바꿉니다 — 자세 트랙 재생용.
 *
 * 자세가 바뀔
 * 때마다 인형을 새로 세우면(`applyBonePose` 경로) 프레임마다 뼈대 복제·재질 복제가 돌아
 * 재생이 끊깁니다. 그래서 세울 때 남겨 둔 프리셋 기준으로 **본 회전만** 되돌렸다가 다시 겁니다.
 *
 * # 부모를 잠시 떼는 까닭
 *
 * 손가락은 «손 기준» 축으로 돌리는데, 그 기준(`presetHandQuaternion`)은 인형을 **씬에 붙이기
 * 전에** 잰 월드 회전입니다. 붙인 뒤에 월드로 계산하면 인물을 돌려 세운 만큼 손가락이 엉뚱한
 * 축으로 굽습니다. 부모 고리만 잠깐 끊으면 세울 때와 같은 좌표계가 됩니다(이벤트 없이).
 *
 * 발도 다시 붙입니다 — 쪼그려 앉는 자세로 넘어가면 골반 기준이라 발이 바닥 밑으로 들어갑니다.
 */
export function setLiveBonePose(
  model: THREE.Object3D,
  bonePose: Record<string, Vector3Value>,
) {
  const parent = model.parent;
  (model as { parent: THREE.Object3D | null }).parent = null;
  try {
    model.traverse((node) => {
      const preset = node.userData.presetQuaternion as THREE.Quaternion | undefined;
      if ((node as THREE.Bone).isBone && preset) node.quaternion.copy(preset);
    });
    model.updateMatrixWorld(true);
    applyBoneDeltas(model, bonePose);
    // 세울 때와 같은 접지 — 부모가 없으니 월드 Y 가 곧 부모 좌표의 Y 입니다.
    const lowest = lowestGroundY(model);
    if (lowest !== null) model.position.y -= lowest;
  } finally {
    (model as { parent: THREE.Object3D | null }).parent = parent;
  }
  model.updateMatrixWorld(true);
}

/**
 * 기즈모로 돌린 본의 현재 회전을 「프리셋 대비 상대 오일러」로 환산합니다.
 *
 * 손가락은 적용을 손 기준 좌표계에서 하므로 환산도 같은 기준으로 해야 합니다.
 * 기준이 어긋나면 링 하나를 돌려도 수치 세 개가 한꺼번에 움직입니다.
 */
export function boneDeltaEuler(bone: THREE.Object3D): Vector3Value {
  const handQuat = bone.userData.presetHandQuaternion as
    THREE.Quaternion | undefined;
  const presetWorld = bone.userData.presetWorldQuaternion as
    THREE.Quaternion | undefined;

  if (handQuat && presetWorld) {
    const currentWorld = bone.getWorldQuaternion(new THREE.Quaternion());
    // 월드에서 더해진 회전을 손 좌표계로 옮깁니다.
    const deltaWorld = currentWorld.multiply(presetWorld.clone().invert());
    const deltaHand = handQuat
      .clone()
      .invert()
      .multiply(deltaWorld)
      .multiply(handQuat.clone());
    const euler = new THREE.Euler().setFromQuaternion(deltaHand, "XYZ");
    return { x: euler.x, y: euler.y, z: euler.z };
  }

  const preset =
    (bone.userData.presetQuaternion as THREE.Quaternion | undefined) ||
    new THREE.Quaternion();
  const delta = preset.clone().invert().multiply(bone.quaternion);
  const euler = new THREE.Euler().setFromQuaternion(delta, "XYZ");
  return { x: euler.x, y: euler.y, z: euler.z };
}

/** 값이 전부 0 인 항목은 저장하지 않습니다. 목록에 조정 표시가 잘못 뜨는 걸 막습니다. */
export function mergeBonePose(
  base: Record<string, Vector3Value>,
  entries: Record<string, Vector3Value>,
) {
  const next = { ...base };
  for (const [bone, rotation] of Object.entries(entries)) {
    if (!rotation.x && !rotation.y && !rotation.z) delete next[bone];
    else next[bone] = rotation;
  }
  return next;
}

// ── 2본 IK ───────────────────────────────────────────────────────────────


// ── 접지 ─────────────────────────────────────────────────────────────────

/**
 * 접지 판정에 쓰는 관절들.
 *
 * 발만 보면 무릎 꿇기·바닥 앉기·눕기처럼 발이 아닌 부위가 바닥에 닿는
 * 자세를 표현할 수 없습니다 — 발 높이를 맞추려다 몸이 공중에 뜹니다.
 * 바닥에 닿을 수 있는 관절을 모두 넣고 그중 가장 낮은 것을 기준으로 삼습니다.
 */
const GROUND_BONE_NAMES = [
  "LeftToeBase",
  "RightToeBase",
  "LeftFoot",
  "RightFoot",
  "LeftLeg",
  "RightLeg", // 무릎
  "LeftUpLeg",
  "RightUpLeg", // 골반 옆
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "LeftHand",
  "RightHand",
  "LeftForeArm",
  "RightForeArm",
  "Head",
];

/**
 * 포즈가 적용된 상태에서 바닥에 가장 가까운 관절의 월드 Y 를 구합니다.
 *
 * ⚠ `Box3.setFromObject` 는 **쓰면 안 됩니다.** SkinnedMesh 의 스키닝 결과를
 * 반영하지 않아서, 포즈를 바꿔도 차렷 자세 기준 박스가 나옵니다. 그 값으로
 * 접지 보정을 하면 발이 바닥에서 뜨거나 파묻힙니다.
 */
export function lowestGroundY(root: THREE.Object3D): number | null {
  root.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  let lowest = Number.POSITIVE_INFINITY;
  for (const name of GROUND_BONE_NAMES) {
    const bone = boneOf(root, name);
    if (!bone) continue;
    position.setFromMatrixPosition(bone.matrixWorld);
    lowest = Math.min(lowest, position.y);
  }
  return Number.isFinite(lowest) ? lowest : null;
}


// ── 손가락 ───────────────────────────────────────────────────────────────

/**
 * 손가락 굽힘 각도(도).
 *
 * 손 기준 축으로 돌리므로 세 마디 모두 같은 축(Z)을 씁니다.
 * **첫마디는 건드리지 않습니다** — 손등에서 나오는 관절이라 굽히면 손 모양이
 * 무너집니다. 중간·끝만 접으면 주먹이 됩니다.
 */
export const FINGER_CURL_DEG: Record<FingerState, [number, number, number]> = {
  extend: [0, 0, 0],
  half: [0, 45, 45],
  fold: [0, 90, 90],
};

/** 엄지는 마디 구조가 달라 조금 덜 접습니다. */
export const THUMB_CURL_DEG: Record<FingerState, [number, number, number]> = {
  extend: [0, 0, 0],
  half: [0, 25, 25],
  fold: [0, 50, 45],
};

/** 좌우 손은 거울 대칭이라 굽는 부호가 반대입니다. */
export const curlSign = (side: "Left" | "Right") => (side === "Right" ? 1 : -1);

/** 손가락 상태를 관절 각도(bonePose)로 펼칩니다. */
export function fingerStateToBonePose(
  side: "Left" | "Right",
  finger: FingerName,
  state: FingerState,
) {
  const table =
    finger === "Thumb" ? THUMB_CURL_DEG[state] : FINGER_CURL_DEG[state];
  const sign = curlSign(side);
  const entries: Record<string, Vector3Value> = {};
  for (let joint = 0; joint < 3; joint += 1) {
    entries[`${side}Hand${finger}${joint + 1}`] = {
      x: 0,
      y: 0,
      z: toRad(sign * table[joint]),
    };
  }
  return entries;
}


export const FINGER_LABELS: Record<FingerName, string> = {
  Thumb: "엄지",
  Index: "검지",
  Middle: "중지",
  Ring: "약지",
  Pinky: "소지",
};

// ── 편집할 수 있는 관절 ──────────────────────────────────────────────────

/**
 * 세부 조정 가능한 본 목록.
 * Mixamo 리그 전체를 열면 선택이 어려우므로, 구도에서 실제로 의미 있는 관절만 노출합니다.
 */
export const EDITABLE_BONES: { id: string; label: string; group: string }[] = [
  { id: "Head", label: "머리", group: "상체" },
  { id: "Neck", label: "목", group: "상체" },
  { id: "Spine2", label: "가슴", group: "상체" },
  { id: "Spine", label: "허리", group: "상체" },
  { id: "Hips", label: "골반", group: "상체" },

  { id: "LeftArm", label: "왼팔", group: "왼쪽" },
  { id: "LeftForeArm", label: "왼 팔꿈치", group: "왼쪽" },
  { id: "LeftHand", label: "왼손", group: "왼쪽" },
  { id: "LeftUpLeg", label: "왼 허벅지", group: "왼쪽" },
  { id: "LeftLeg", label: "왼 무릎", group: "왼쪽" },
  { id: "LeftFoot", label: "왼발", group: "왼쪽" },

  { id: "RightArm", label: "오른팔", group: "오른쪽" },
  { id: "RightForeArm", label: "오른 팔꿈치", group: "오른쪽" },
  { id: "RightHand", label: "오른손", group: "오른쪽" },
  { id: "RightUpLeg", label: "오른 허벅지", group: "오른쪽" },
  { id: "RightLeg", label: "오른 무릎", group: "오른쪽" },
  { id: "RightFoot", label: "오른발", group: "오른쪽" },

  // 손가락 마디는 아래에서 붙입니다. 다섯 손가락 × 세 마디 = 한 손에 15개.
  ...fingerBones("Left", "왼손 손가락"),
  ...fingerBones("Right", "오른손 손가락"),
];

/**
 * 한 손의 손가락 관절 15개.
 *
 * 「손 모양」 의 폄·반·접음으로 대부분 끝나지만, 총을 쥐거나 수화를 하는
 * 컷에서는 마디 하나만 따로 굽혀야 합니다. 그때 3D 화면에서 직접 돌릴 수
 * 있어야 해서 관절 목록에도 올려 둡니다.
 */
function fingerBones(side: "Left" | "Right", group: string) {
  const joints = ["첫마디", "중간", "끝"];
  return FINGER_NAMES.flatMap((finger) =>
    joints.map((joint, index) => ({
      id: `${side}Hand${finger}${index + 1}`,
      label: `${FINGER_LABELS[finger]} ${joint}`,
      group,
    })),
  );
}

export const BONE_GROUPS = [
  "상체",
  "왼쪽",
  "오른쪽",
  "왼손 손가락",
  "오른손 손가락",
] as const;

/** 처음에 접어 둘 그룹. 손가락은 서른 개라 펼쳐 두면 나머지가 안 보입니다. */
export const COLLAPSED_BONE_GROUPS: string[] = ["왼손 손가락", "오른손 손가락"];

// ── 인물 식별 색 ─────────────────────────────────────────────────────────

export type MannequinBody = "male" | "female" | "neutral";

export function mannequinBody(gender?: string): MannequinBody {
  if (gender === "male" || gender === "남성" || gender === "남") return "male";
  if (gender === "female" || gender === "여성" || gender === "여")
    return "female";
  return "neutral";
}

/**
 * 캐릭터 식별 색.
 *
 * 성별은 색 계열로(남성=한색, 여성=난색, 중립=중간톤), 개인은 계열 안의
 * 순번으로 구분합니다. 계열만 다르면 인물이 늘었을 때 누가 누군지 헷갈리고,
 * 순번만 다르면 성별이 안 읽힙니다.
 */
export const BODY_COLORS: Record<MannequinBody, string[]> = {
  male: ["#5b8dd9", "#4fb3c4", "#7a7ee0", "#3f9d7a"],
  female: ["#e0728f", "#e39358", "#d9a13f", "#c96fc4"],
  neutral: ["#9aa4b8", "#8f9d86", "#a8968a", "#94909f"],
};


// ── 포즈 프리셋 ──────────────────────────────────────────────────────────

/**
 * 리그에 **기본 자세(A 포즈)** 를 적용합니다.
 *
 * GLB 원본은 T 포즈(양팔을 수평으로 벌린 자세)입니다. 그대로 세우면 팔이 화면을 가로질러
 * 구도를 가립니다. **차렷** — 양팔을 몸 옆으로 내린 자세 — 는 실제 사람이 서 있는 모습에
 * 가장 가까워 「저 자리에 저 크기로 선다」 를 눈으로 가늠하기 쉽습니다
 * ().
 *
 * 내장 포즈 프리셋(걷기·달리기·앉기…)은 같은 날 걷어냈습니다 — 「동작들 이상하고, 어차피
 * 포즈 프리셋 저장할 수 있으니까 프리셋으로 필요할 때마다 만들어서 저장하는 게 낫겠다」.
 * 자세는 관절을 직접 돌려 만들고 «내 프리셋» 에 담아 씁니다.
 *
 * 각도의 부호: 월드 Z 축으로 돌립니다. 왼팔(+X)은 음수가 아래, 오른팔(−X)은 양수가 아래입니다.
 */
export function applyBasePose(model: THREE.Object3D) {
  const zAxis = new THREE.Vector3(0, 0, 1);
  const rotateWorld = (boneName: string, angle: number) => {
    const bone = boneOf(model, boneName);
    if (bone) rotateBoneWorld(model, bone, zAxis, angle);
  };
  /*
    83° 내림(1.45 rad). 90° 로 완전히 내리면 위팔이 골반을 파고들어 실루엣이 뭉갭니다 —
    실제 차렷도 팔이 몸에 살짝 떨어져 있습니다. 팔꿈치를 몇 도 더 모아 손이 허벅지 옆에
    오게 합니다.
  */
  rotateWorld("LeftArm", -1.45);
  rotateWorld("RightArm", 1.45);
  rotateWorld("LeftForeArm", -0.08);
  rotateWorld("RightForeArm", 0.08);
}

/**
 * 손가락 관절을 직접 조정했을 때, 그 손가락만 프리셋에서 해제합니다.
 * 프리셋 굽힘과 수동 회전이 겹쳐 적용되면 결과를 예측할 수 없기 때문입니다.
 * 본 이름 예: `"LeftHandIndex2"` → `"LeftIndex"` 프리셋 해제
 */
export function releaseFingerPreset(
  fingers: Record<string, FingerState> | undefined,
  boneName: string,
) {
  const match = FINGER_BONE_RE.exec(boneName);
  if (!match || !fingers) return fingers;
  const key = `${match[1]}${match[2]}`;
  if (!(key in fingers)) return fingers;
  const next = { ...fingers };
  delete next[key];
  return next;
}
