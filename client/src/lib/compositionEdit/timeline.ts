import * as THREE from "three";
/*
  `lib/compositionEdit.ts` 를 갈래별로 나눈 조각입니다(2026-09-17).

  한 파일에 순수 함수 174개가 모여 3,900줄이 되면서 «어디에 있더라» 를 매번 찾아야 했습니다.
  파일 안에 이미 그어 두었던 구분선을 그대로 파일 경계로 삼았고, 부르는 길은 그대로입니다
  (`@/lib/compositionEdit` 배럴이 전부 다시 내보냅니다).
*/

import { cameraMoveId, createCameraMove, CAMERA_KEY_CHANNELS, evaluateCameraMoves, evaluateEasing, keyDefines, moveEnd, SHOT_PRESETS, sortedMoves, type CameraMove, type CameraKeyChannel, type CameraPose, type EasingCurve, type ShotPreset } from "@/lib/cameraMoves";
import { lerpVector, segmentAt, sortByTime } from "@/lib/keyframes";
import { EDITABLE_BONES, FINGER_BONE_RE, mergeBonePose } from "@/lib/rig";
import { musicSectionId } from "@/lib/composition";
import { CameraComposition, CompositionMusic, CompositionRender, CameraShot, CompositionState, MotionChannel, MotionKey, MotionTrack, Vector3Value } from "@/lib/composition";
import { timelineOf } from "./core";

import { activeRoomOf, roomsOf } from "./rooms";

// ── 카메라 · 타임라인 ─────────────────────────────────────────────────

export function patchCameraIn(
  current: CompositionState,
  pose: Partial<CameraComposition>,
): CompositionState {
  return { ...current, camera: { ...current.camera, ...pose } };
}

/*
  ── 저장해 둔 카메라 구도 ─────────────────────────────────────────────────
  
*/

/** 저장해 둔 구도들. */
export function cameraShotsOf(current: CompositionState): CameraShot[] {
  return current.cameraShots ?? [];
}

/** 지금 활성인 구도. 없으면 null. */
export function activeCameraShot(current: CompositionState): CameraShot | null {
  const id = current.activeShotId;
  if (!id) return null;
  return cameraShotsOf(current).find((shot) => shot.id === id) ?? null;
}

/**
 * 지금 카메라를 **새 구도로** 저장하고 그것을 활성으로 둡니다.
 *
 * 이름은 「카메라 1」 부터 번호를 올려 붙입니다 — 지우고 다시 만들 때 번호가 겹치지 않게
 * 목록에 없는 첫 번호를 씁니다. 사람이 곧바로 「수화 클로즈업샷」 으로 바꿔 쓸 자리입니다.
 */
export function addCameraShotIn(
  current: CompositionState,
  name?: string,
): { state: CompositionState; id: string } {
  const shots = cameraShotsOf(current);
  let number = shots.length + 1;
  const used = new Set(shots.map((shot) => shot.name));
  while (used.has(`카메라 ${number}`)) number += 1;
  const shot: CameraShot = {
    id: cameraMoveId(),
    name: name?.trim() || `카메라 ${number}`,
    position: { ...current.camera.position },
    target: { ...current.camera.target },
    fovDegrees: current.camera.fovDegrees,
  };
  return {
    state: { ...current, cameraShots: [...shots, shot], activeShotId: shot.id },
    id: shot.id,
  };
}

/**
 * 그 구도를 **지금 카메라로 덮어씁니다**(재저장).
 *
 * 이름은 그대로 둡니다 —
 * 「수화 클로즈업샷」 을 조금 다듬는 것이지 다른 구도가 되는 게 아닙니다.
 */
export function saveCameraShotIn(
  current: CompositionState,
  id: string,
): CompositionState {
  return {
    ...current,
    cameraShots: cameraShotsOf(current).map((shot) =>
      shot.id === id
        ? {
            ...shot,
            position: { ...current.camera.position },
            target: { ...current.camera.target },
            fovDegrees: current.camera.fovDegrees,
          }
        : shot,
    ),
    activeShotId: id,
  };
}

/**
 * 그 구도로 **카메라를 옮깁니다**. 활성 표시도 같이 옮깁니다.
 *
 * 화각까지 되돌립니다 — 자리만 맞고 화각이 남아 있으면 다른 그림이 됩니다.
 */
export function goToCameraShotIn(
  current: CompositionState,
  id: string,
): CompositionState {
  const shot = cameraShotsOf(current).find((item) => item.id === id);
  if (!shot) return current;
  return {
    ...current,
    camera: {
      ...current.camera,
      position: { ...shot.position },
      target: { ...shot.target },
      fovDegrees: shot.fovDegrees,
    },
    activeShotId: id,
  };
}

export function renameCameraShotIn(
  current: CompositionState,
  id: string,
  name: string,
): CompositionState {
  return {
    ...current,
    cameraShots: cameraShotsOf(current).map((shot) =>
      shot.id === id ? { ...shot, name } : shot,
    ),
  };
}

/** 구도를 지웁니다. 활성이던 것을 지우면 활성은 없음으로 — G 는 다시 처음 자리로 갑니다. */
export function removeCameraShotIn(
  current: CompositionState,
  id: string,
): CompositionState {
  return {
    ...current,
    cameraShots: cameraShotsOf(current).filter((shot) => shot.id !== id),
    activeShotId: current.activeShotId === id ? null : current.activeShotId,
  };
}

/** 모든 클립이 첫 클립의 앵커를 함께 쓰는가. */
export function lockAnchorsOf(current: CompositionState): boolean {
  return current.lockAnchors === true;
}

export function setLockAnchorsIn(
  current: CompositionState,
  on: boolean,
): CompositionState {
  return { ...current, lockAnchors: on };
}

/** 컷의 무빙 클립들. 없으면 빈 배열 — 카메라 고정입니다. */
export function cameraMovesOf(current: CompositionState): CameraMove[] {
  return current.cameraMoves ?? [];
}

/** 이름표로 클립 하나. */
export function cameraMoveOf(
  current: CompositionState,
  id: string | null,
): CameraMove | null {
  if (!id) return null;
  return cameraMovesOf(current).find((move) => move.id === id) ?? null;
}

/** 클립 하나를 고칩니다. 없는 이름표면 아무 일도 안 합니다. */
export function patchCameraMoveIn(
  current: CompositionState,
  id: string,
  patch: Partial<CameraMove>,
): CompositionState {
  return {
    ...current,
    cameraMoves: cameraMovesOf(current).map((move) =>
      move.id === id ? { ...move, ...patch } : move,
    ),
  };
}

/**
 * 클립을 하나 더합니다 — **마지막 클립이 끝나는 자리에 이어 붙입니다.**
 *
 * 새 클립을
 * 늘 0초에 두면 앞 것과 겹쳐서, 더할 때마다 시작 시각을 손으로 고쳐야 합니다.
 */
export function addCameraMoveIn(
  current: CompositionState,
  shotId?: string,
): { state: CompositionState; id: string } {
  const moves = cameraMovesOf(current);
  const last = moves.reduce((end, move) => Math.max(end, moveEnd(move)), 0);
  const created = { ...createCameraMove(shotId), startTime: last };
  /*
    앵커는 앞 클립 것을 물려받습니다. 한 컷 안에서 도는 중심이 클립마다 튀면
    이어 붙인 무빙이 매번 다른 데를 보고 돌아 «연결» 이 아니게 됩니다.
  */
  const previous = sortedMoves(moves).at(-1);
  if (previous) created.anchor = { ...previous.anchor };
  /*
    ── 자유 클립의 **시작점** ────────────────────────────────────────────
    , 「시작점은 현재 타임라인에 있는 시점의 카메라 구도 값을
    그대로 받고, 거기서부터 키프레임으로 바꾸는 거지」.

    0초 키를 미리 심어 둡니다. 안 심으면 키를 처음 찍는 순간 그 자세 하나만 남아
    **클립 내내 그 자리에 못 박힙니다** — 「2초에 여기」 를 찍었는데 0초부터 거기 있는
    셈이라, 사람이 기대하는 «여기서 저기로» 가 안 됩니다.
  */
  if (
    SHOT_PRESETS.find((item: ShotPreset) => item.id === created.shotId)
      ?.kind === "free"
  )
    created.keys = [
      { id: cameraMoveId(), time: 0, pose: poseAtTimeIn(current, last) },
    ];
  return {
    state: { ...current, cameraMoves: [...moves, created] },
    id: created.id,
  };
}

/**
 * 지금 구도잡기 카메라를 무빙이 쓰는 **자세**(`CameraPose`) 로 옮깁니다.
 *
 * `fovScale` 은 «기준 화각에 대한 배율» 이라, 저장해 둔 화각을 1 로 봅니다 — 자유 키에
 * 절대 화각을 담으면 나중에 기준 화각을 바꿨을 때 줌이 통째로 어긋납니다.
 */
export function cameraPoseOf(current: CompositionState) {
  return {
    position: { ...current.camera.position },
    target: { ...current.camera.target },
    fovScale: 1,
  };
}

/** 무빙의 출발 자세. 화면 탐색 카메라보다 활성 저장 구도(없으면 첫 구도)가 먼저입니다. */
export function cameraMoveBasePoseOf(current: CompositionState) {
  const shots = cameraShotsOf(current);
  const shot = shots.find((item) => item.id === current.activeShotId) ?? shots[0];
  if (!shot) return cameraPoseOf(current);
  return {
    position: { ...shot.position },
    target: { ...shot.target },
    fovScale: current.camera.fovDegrees > 0 ? shot.fovDegrees / current.camera.fovDegrees : 1,
  };
}

/**
 * **그 시각에 카메라가 어디 있는가.** 앞선 클립들을 그 자리까지 다 돌려 본 결과입니다.
 *
 * , 「달리 인 뒤에 자유 경로가 붙으면 자유 경로의 시작 위치의 카메라 구도가
 * 시작점이 되는 거야」.
 *
 * 처음에는 «지금 구도잡기 카메라» 를 그대로 심었습니다. 그런데 새 클립은 **앞 클립들이
 * 끝난 뒤**에 붙으므로, 그 시각의 자세는 화면에 보이는 카메라가 아니라 «달리 인이 2.5m
 * 다가간 자리» 입니다. 그대로 심으면 자유 경로가 시작하자마자 카메라가 뒤로 튑니다.
 *
 * 앵커는 적어 둔 값을 씁니다 — 여기는 3D 씬을 모릅니다(따라가기 앵커는 뷰포트만 압니다).
 * 클립을 만드는 순간의 근사라, 조금 달라도 곧 사람이 키를 찍어 덮습니다.
 */
export function poseAtTimeIn(current: CompositionState, time: number) {
  const moves = cameraMovesOf(current);
  if (!moves.length) return cameraPoseOf(current);
  return evaluateCameraMoves(cameraPoseOf(current), moves, time);
}

/**
 * 지금 카메라 자세를 **자유 클립의 키프레임**으로 찍습니다.
 *
 * 카메라를 원하는 데 두고 이걸 부르면 그 자리가 길의 한 점이 됩니다.
 *
 * 같은 시각에 이미 키가 있으면 **덮어씁니다** — 같은 자리에 두 점이 겹치면 어느 쪽이
 * 이기는지 알 수 없고, 화면에서도 한 점으로만 보여 지울 수가 없습니다.
 */
export function addCameraKeyIn(
  current: CompositionState,
  id: string,
  localTime: number,
  /** 적을 자세. 안 넘기면 지금 구도잡기 카메라입니다. */
  pose?: CameraPose,
  /** 정할 갈래. 안 넘기면 셋 다(자리·바라보는 곳·줌). */
  channels?: CameraKeyChannel[],
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  const time = Math.max(0, Math.round(localTime * 100) / 100);
  const list = move.keys ?? [];
  const wanted = channels ?? CAMERA_KEY_CHANNELS;
  /*
    같은 시각·같은 갈래의 키만 비켜 줍니다. 「2초의 자리 키」 를 새로 찍는다고 「2초의
    줌 키」 까지 지우면, 갈래를 나눈 뜻이 없어집니다.
  */
  const kept = list.filter(
    (key) =>
      Math.abs(key.time - time) > 0.001 ||
      !wanted.some((channel) => keyDefines(key, channel)),
  );
  return patchCameraMoveIn(current, id, {
    keys: [
      ...kept,
      {
        id: cameraMoveId(),
        time,
        pose: pose ?? cameraPoseOf(current),
        channels: wanted,
      },
    ],
  });
}

/**
 * 자유 키 하나의 **값만** 고칩니다(시각은 그대로).
 *
 * 화면에서 카메라를 옮겨
 * 찍는 것이 빠르지만, 「정확히 x=2」 같은 값은 손으로 적는 편이 빠릅니다.
 */
export function patchCameraKeyIn(
  current: CompositionState,
  id: string,
  keyId: string,
  patch: Partial<CameraPose>,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  return patchCameraMoveIn(current, id, {
    keys: (move.keys ?? []).map((key) =>
      key.id === keyId ? { ...key, pose: { ...key.pose, ...patch } } : key,
    ),
  });
}

export function removeCameraKeyIn(
  current: CompositionState,
  id: string,
  keyId: string,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  return patchCameraMoveIn(current, id, {
    keys: (move.keys ?? []).filter((key) => key.id !== keyId),
  });
}

/**
 * 트랙을 시각 t 로 풉니다 — 키 사이를 **등속으로** 잇습니다.
 *
 * 완급 곡선을 안 거는 까닭: 인물 동선은 「몇 초에 어디」 가 전부이고, 리듬은 키를 촘촘히
 * 찍어 만드는 편이 손에 잡힙니다. 카메라와 달리 대상이 여럿이라, 대상마다 곡선을 따로
 * 두면 무엇이 왜 그렇게 움직이는지 아무도 못 따라갑니다.
 *
 * 키가 하나뿐이면 **그 값 그대로**입니다. 트랙이 생기는 순간부터 그
 * 대상은 «트랙이 정하는 값» 으로 보여야, 키 사이를 오가며 값을 고칠 수 있습니다.
 * 첫 키 앞·마지막 키 뒤에서는 그 키에 머뭅니다.
 */
export function evaluateMotionTrack(
  track: MotionTrack,
  time: number,
): Vector3Value | null {
  // 꺼 둔 트랙은 값을 안 돌려줍니다 — 부르는 쪽이 «트랙 없음» 과 같게 다룹니다.
  if (track.muted) return null;
  const segment = segmentAt(track.keys, time);
  if (!segment) return null;
  const { from, to, t } = segment;
  if (from === to) return from.value;
  /*
    완급을 안 건 트랙은 **등속 그대로**입니다. 옛 저장본이 갑자기 다르게 움직이면 안 되고,
    사람이 그래프를 연 적이 없는데 곡선이 걸려 있으면 「왜 느리게 출발하지」 가 됩니다.
  */
  /*
    구간의 완급은 **앞 키**가 들고 있습니다(`from.easing`). 그것도 없으면 트랙 곡선,
    그것도 없으면 등속입니다 — 손대지 않은 옛 저장본이 갑자기 다르게 움직이면 안 됩니다.
  */
  const curve = from.easing ?? track.easing;
  const eased = curve ? evaluateEasing(curve, t) : t;
  return lerpVector(from.value, to.value, eased);
}

/**
 * **자세 트랙**을 그 시각의 관절 회전으로 풉니다. 트랙이 꺼졌거나 키가 없으면 null.
 *
 * 관절마다 **쿼터니언으로 구면 보간**합니다. 오일러 세 숫자를 따로 섞으면 기즈모로 돌려 적힌
 * 값(같은 방향인데 x=π, z=π 처럼 적힌 것)과 수치로 적은 값 사이에서 팔이 한 바퀴 휘돕니다.
 * 완급은 이동·회전 트랙과 같은 규칙입니다(앞 키 → 트랙 곡선 → 등속).
 */
export function evaluatePoseTrack(
  track: MotionTrack,
  time: number,
): Record<string, Vector3Value> | null {
  if (track.muted || track.channel !== "pose") return null;
  const segment = segmentAt(track.keys, time);
  if (!segment) return null;
  const { from, to, t } = segment;
  if (from === to || t <= 0) return { ...(from.bones ?? {}) };
  const curve = from.easing ?? track.easing;
  const eased = curve ? evaluateEasing(curve, t) : t;
  const a = from.bones ?? {};
  const b = to.bones ?? {};
  const zero = { x: 0, y: 0, z: 0 };
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const out: Record<string, Vector3Value> = {};
  for (const bone of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[bone] ?? zero;
    const vb = b[bone] ?? zero;
    // 같은 값 사이는 적힌 그대로 — 쿼터니언을 거치면 같은 방향이 다른 숫자로 나올 수 있습니다.
    if (va.x === vb.x && va.y === vb.y && va.z === vb.z) {
      if (va.x || va.y || va.z) out[bone] = { ...va };
      continue;
    }
    qa.setFromEuler(euler.set(va.x, va.y, va.z, "XYZ"));
    qb.setFromEuler(euler.set(vb.x, vb.y, vb.z, "XYZ"));
    qa.slerp(qb, eased);
    euler.setFromQuaternion(qa, "XYZ");
    if (Math.abs(euler.x) + Math.abs(euler.y) + Math.abs(euler.z) < 1e-6) continue;
    out[bone] = { x: euler.x, y: euler.y, z: euler.z };
  }
  return out;
}

/** 인물의 자세 트랙(키가 있는 것). 없으면 null. */
export function poseTrackOf(
  current: CompositionState,
  targetId: string,
): MotionTrack | null {
  return (
    motionTracksOf(current).find(
      (item) => item.targetId === targetId && item.channel === "pose" && item.keys.length > 0,
    ) ?? null
  );
}

/**
 * ── 자세 줄을 **관절별로 펼치기** ───────────────────────────────────────────
 *
 *
 *
 * 저장은 «자세 한 장» 그대로 두고(까닭은 `MotionKey.bones`), 펼친 줄은 **읽어서 만든 보기**
 * 입니다. 관절마다 «값이 바뀌는 구간의 양 끝 키» 에만 점을 찍습니다 — 자세 키가 다섯 장이어도
 * 머리는 한 번만 돌았으면 머리 줄에는 점 두 개. 그래야 «무엇이 언제 움직였나» 가 읽힙니다.
 */
export const ZERO_ROTATION: Vector3Value = { x: 0, y: 0, z: 0 };
const boneValueIn = (key: MotionKey, bone: string) => key.bones?.[bone] ?? ZERO_ROTATION;
/*
  같은 회전인가 — **쿼터니언으로** 봅니다. 오일러 세 숫자로 비교하면 같은 방향이 다르게 적힌 값
  (보간을 한 번 거친 x=2.6 과 x=−0.5·y=π… 같은 것)이 «바뀜» 으로 잡혀, 손대지 않은 관절에 점이 섭니다.
*/
const rotationQuat = (value: Vector3Value) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(value.x, value.y, value.z, "XYZ"));
const sameRotation = (a: Vector3Value, b: Vector3Value, tolerance = 1e-4) => {
  if (Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance && Math.abs(a.z - b.z) < tolerance)
    return true;
  return rotationQuat(a).angleTo(rotationQuat(b)) < tolerance * 2;
};

/**
 * 두 자세에서 **실제로 돌린 관절**만. 없는 관절은 0(차렷).
 *
 * 자동 키가 «찍은 관절» 을
 * 고를 때 상태에 남아 있던 **옛 자세**와 비교해서, 편집 바탕을 보이는 자세로 맞추며(`withShownPoseIn`)
 * 달라진 오른팔까지 «돌린 관절» 로 잡았습니다. 부르는 쪽은 **그 시각에 보이던 자세**와 비교해야 합니다.
 */
export function changedBones(
  before: Record<string, Vector3Value>,
  after: Record<string, Vector3Value>,
): string[] {
  const zero = { x: 0, y: 0, z: 0 };
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (bone) => !sameRotation(before[bone] ?? zero, after[bone] ?? zero),
  );
}

export interface PoseJointRow {
  bone: string;
  /** 관절 이름(한국어). 목록에 없는 본은 본 이름 그대로. */
  label: string;
  /** 점을 찍을 키 — 이 관절이 움직이기 시작하거나 멈추는 키. */
  keys: MotionKey[];
  /** 움직이는 구간(초). 줄에 옅은 막대로 깝니다. */
  spans: { from: number; to: number }[];
}

export function poseJointRowsOf(track: MotionTrack | null | undefined): PoseJointRow[] {
  if (!track || track.channel !== "pose") return [];
  const keys = sortByTime(track.keys);
  if (!keys.length) return [];
  const bones = new Set(
    keys.flatMap((key) => [...Object.keys(key.bones ?? {}), ...(key.joints ?? [])]),
  );
  const order = new Map(EDITABLE_BONES.map((item, index) => [item.id, index]));
  const rows: PoseJointRow[] = [];
  for (const bone of bones) {
    // 사람이 찍은 자리는 값이 그대로여도 점입니다(`MotionKey.joints`).
    const stamped = keys.filter((key) => key.joints?.includes(bone));
    /*
      점 고르기 — **지나가는 키는 점이 아닙니다.** 팔 끝점을 끌어 옮기면 사이의 자세 키들에
      보간값이 적히는데(`resampleJoint`), 값이 바뀐 키마다 점을 찍으면 1·4초 두 점이던 팔이
      1·2·3·4초 네 점으로 보입니다. 앞에 남긴 점과 다음 키를 곧게 이은 값과 같으면 건너뜁니다.
      그 뒤 양 끝의 «그대로» 키(움직이기 전·멈춘 뒤)를 떼어 냅니다.
    */
    const kept: MotionKey[] = keys.length < 2 ? [] : [keys[0]];
    for (let index = 1; index < keys.length - 1; index += 1) {
      const from = kept[kept.length - 1];
      const to = keys[index + 1];
      const t = (keys[index].time - from.time) / Math.max(1e-6, to.time - from.time);
      const straight = slerpRotation(boneValueIn(from, bone), boneValueIn(to, bone), t);
      if (sameRotation(straight, boneValueIn(keys[index], bone), 1e-3)) continue;
      kept.push(keys[index]);
    }
    if (keys.length >= 2) kept.push(keys[keys.length - 1]);
    while (kept.length > 1 && sameRotation(boneValueIn(kept[0], bone), boneValueIn(kept[1], bone))) kept.shift();
    while (
      kept.length > 1 &&
      sameRotation(boneValueIn(kept[kept.length - 1], bone), boneValueIn(kept[kept.length - 2], bone))
    )
      kept.pop();
    const moving = kept.length >= 2;
    if (!moving && !stamped.length) continue;
    const spans: { from: number; to: number }[] = [];
    for (let index = 1; moving && index < kept.length; index += 1) {
      if (sameRotation(boneValueIn(kept[index - 1], bone), boneValueIn(kept[index], bone))) continue;
      const last = spans[spans.length - 1];
      if (last && Math.abs(last.to - kept[index - 1].time) < 1e-6) last.to = kept[index].time;
      else spans.push({ from: kept[index - 1].time, to: kept[index].time });
    }
    rows.push({
      bone,
      label: EDITABLE_BONES.find((item) => item.id === bone)?.label ?? bone,
      keys: sortByTime([...new Set([...(moving ? kept : []), ...stamped])]),
      spans,
    });
  }
  return rows.sort((a, b) => (order.get(a.bone) ?? 999) - (order.get(b.bone) ?? 999));
}

/** 두 회전 사이를 구면 보간한 오일러(XYZ). */
function slerpRotation(a: Vector3Value, b: Vector3Value, t: number): Vector3Value {
  const euler = new THREE.Euler();
  const qa = new THREE.Quaternion().setFromEuler(euler.set(a.x, a.y, a.z, "XYZ"));
  const qb = new THREE.Quaternion().setFromEuler(euler.set(b.x, b.y, b.z, "XYZ"));
  euler.setFromQuaternion(qa.slerp(qb, Math.min(1, Math.max(0, t))), "XYZ");
  return { x: euler.x, y: euler.y, z: euler.z };
}

/** 한 관절의 값만 바꾼 키. 0 이면 표에서 뺍니다(차렷과 같으니까). */
function withBoneValue(key: MotionKey, bone: string, value: Vector3Value): MotionKey {
  return { ...key, bones: mergeBonePose(key.bones ?? {}, { [bone]: value }) };
}

/**
 * 한 관절의 **점 목록**(움직임의 양 끝)을 모든 자세 키에 다시 채웁니다.
 *
 * 관절 줄의 점을 지우거나 옮기는 것은 «그 관절의 키» 를 고치는 것인데, 저장은 자세 한 장이라
 * 점과 점 사이의 **그대로인 키**(머리를 돌린 뒤 팔만 움직인 키)에도 그 관절 값이 적혀 있습니다.
 * 점만 고치면 그 키들이 옛 값을 붙잡아 둡니다 — 실제로 팔 끝점을 2초에서 4초로 끌었더니 3초
 * 키가 옛 값을 들고 있어 팔이 3초에 이미 다 올라가 있었습니다. 그래서 점을 고친 뒤에는 모든
 * 키의 그 관절 값을 **점 사이 보간값**으로 새로 적습니다(첫 점 앞·마지막 점 뒤는 붙잡음).
 */
function resampleJoint(
  keys: MotionKey[],
  bone: string,
  points: { time: number; value: Vector3Value }[],
): MotionKey[] {
  const list = points.slice().sort((a, b) => a.time - b.time);
  const at = (time: number): Vector3Value => {
    if (!list.length) return ZERO_ROTATION;
    if (time <= list[0].time) return list[0].value;
    const last = list[list.length - 1];
    if (time >= last.time) return last.value;
    const index = list.findIndex((_, i) => i < list.length - 1 && list[i + 1].time >= time);
    const from = list[index];
    const to = list[index + 1];
    return slerpRotation(from.value, to.value, (time - from.time) / Math.max(1e-6, to.time - from.time));
  };
  return keys.map((key) => withBoneValue(key, bone, at(key.time)));
}

/** 키 하나에서 «사람이 찍은 관절» 표시를 뗍니다. */
function unmarkJoint(keys: MotionKey[], keyId: string, bone: string): MotionKey[] {
  return keys.map((key) => {
    if (key.id !== keyId || !key.joints?.includes(bone)) return key;
    const rest = key.joints.filter((item) => item !== bone);
    const { joints: _drop, ...plain } = key;
    return rest.length ? { ...plain, joints: rest } : plain;
  });
}

/** 관절 줄의 점 목록 — `poseJointRowsOf` 가 그리는 점과 같습니다. */
function jointPointsOf(track: MotionTrack, bone: string) {
  const row = poseJointRowsOf(track).find((item) => item.bone === bone);
  return (row?.keys ?? []).map((key) => ({ id: key.id, time: key.time, value: boneValueIn(key, bone) }));
}

function replacePoseKeys(current: CompositionState, track: MotionTrack, keys: MotionKey[]): CompositionState {
  return {
    ...current,
    motionTracks: motionTracksOf(current).map((item) => (item === track ? { ...item, keys } : item)),
  };
}

/**
 * 관절 줄의 점 하나를 지웁니다 — **그 관절만**, 다른 관절은 그대로.
 *
 * 자세 키를 통째로 지우면 같은 키에 담긴 팔·다리의 동작까지 사라집니다. 애프터이펙트에서 한
 * 속성의 키를 지운 것과 같게, 남은 점들로 그 관절의 움직임을 다시 잇습니다.
 */
export function removePoseJointKeyIn(
  current: CompositionState,
  targetId: string,
  keyId: string,
  bone: string,
): CompositionState {
  const track = poseTrackOf(current, targetId);
  if (!track) return current;
  const points = jointPointsOf(track, bone);
  if (!points.some((point) => point.id === keyId)) return current;
  return prunePoseKey(
    replacePoseKeys(
      current,
      track,
      unmarkJoint(
        resampleJoint(track.keys, bone, points.filter((point) => point.id !== keyId)),
        keyId,
        bone,
      ),
    ),
    targetId,
    keyId,
  );
}

/**
 * 관절 점이 다 떠난 **빈 자세 키**를 치웁니다.
 *
 *
 * 관절 점을 옮기면 도착한 자리에 자세 키가 새로 서는데, 떠난 자리의 자세 키는 그대로 남아 있었습니다.
 * 그 키에 어떤 관절의 점도, 사람이 찍은 표시도 없으면 모든 관절 값이 앞뒤 점 사이의 값일 뿐이라
 * 지워도 움직임이 같습니다. **방금 손댄 그 키만** 봅니다 — 다른 키까지 훑으면 사람이 Shift+K 로
 * 찍어 둔 «통째 자세» 키(관절 표시가 없는 것)가 엉뚱하게 사라집니다. 마지막 한 장은 남깁니다.
 */
function prunePoseKey(current: CompositionState, targetId: string, keyId: string): CompositionState {
  const track = poseTrackOf(current, targetId);
  if (!track || track.keys.length < 2) return current;
  const key = track.keys.find((item) => item.id === keyId);
  if (!key || key.joints?.length) return current;
  if (poseJointRowsOf(track).some((row) => row.keys.some((item) => item.id === keyId))) return current;
  return replacePoseKeys(current, track, track.keys.filter((item) => item.id !== keyId));
}

/** 자세 키 하나에 점이 있는 관절들. */
function jointsAtKey(track: MotionTrack, keyId: string): string[] {
  return poseJointRowsOf(track)
    .filter((row) => row.keys.some((item) => item.id === keyId))
    .map((row) => row.bone);
}

/**
 * **접힌 자세 줄**의 점을 옮깁니다 — 그 자리에 점이 있는 관절들이 한 번에 갑니다.
 *
 * (애프터이펙트의 요약 키).
 *
 * 자세 키를 통째로 옮기지 않는 까닭: 그 키에는 점이 없는 관절의 **사이 값**도 적혀 있어, 통째로
 * 옮기면 그 관절들이 곧게 가던 길이 휩니다. 관절마다 점만 옮기고(`movePoseJointKeyIn`) 완급은
 * 도착한 키로 넘깁니다. 관절 점이 하나도 없는 키(통째 자세 키)는 통째로 옮깁니다.
 */
export function movePoseKeyGroupIn(
  current: CompositionState,
  targetId: string,
  keyId: string,
  time: number,
): CompositionState {
  const track = poseTrackOf(current, targetId);
  const key = track?.keys.find((item) => item.id === keyId);
  if (!track || !key) return current;
  const bones = jointsAtKey(track, keyId);
  if (!bones.length) return moveMotionKeyIn(current, targetId, keyId, time);
  const stamp = Math.max(0, Math.round(time * 20) / 20);
  if (Math.abs(stamp - key.time) < 0.001) return current;
  let next = current;
  for (const bone of bones) next = movePoseJointKeyIn(next, targetId, keyId, bone, stamp);
  const after = poseTrackOf(next, targetId);
  if (!after || !key.easing) return next;
  return replacePoseKeys(
    next,
    after,
    after.keys.map((item) =>
      Math.abs(item.time - stamp) < 0.001 && !item.easing ? { ...item, easing: key.easing } : item,
    ),
  );
}

/** 접힌 자세 줄의 점을 지웁니다 — 그 자리에 점이 있는 관절을 전부(관절 줄의 Delete 와 같은 규칙). */
export function removePoseKeyGroupIn(
  current: CompositionState,
  targetId: string,
  keyId: string,
): CompositionState {
  const track = poseTrackOf(current, targetId);
  if (!track) return current;
  const bones = jointsAtKey(track, keyId);
  if (!bones.length) return removeMotionKeyIn(current, targetId, keyId);
  let next = current;
  for (const bone of bones) next = removePoseJointKeyIn(next, targetId, keyId, bone);
  // 표시만 있던 관절이 없으면 여기서 비고, 한 장뿐이면 그 한 장을 지웁니다.
  const left = poseTrackOf(next, targetId);
  return left && left.keys.length === 1 && left.keys[0].id === keyId && !jointsAtKey(left, keyId).length
    ? removeMotionKeyIn(next, targetId, keyId)
    : next;
}

/**
 * 관절 줄의 점 하나를 **다른 시각으로** 옮깁니다 — 그 관절의 움직임만 따라갑니다.
 *
 * 도착한 시각에 자세 키가 없으면 그 시각에 보이는 자세로 한 장 만들고, 그 관절의 점 목록을
 * 고쳐 모든 키에 다시 채웁니다(`resampleJoint`). 다른 관절은 제자리.
 */
export function movePoseJointKeyIn(
  current: CompositionState,
  targetId: string,
  keyId: string,
  bone: string,
  time: number,
): CompositionState {
  const track = poseTrackOf(current, targetId);
  if (!track) return current;
  const points = jointPointsOf(track, bone);
  const point = points.find((item) => item.id === keyId);
  if (!point) return current;
  const stamp = Math.max(0, Math.round(time * 20) / 20);
  if (Math.abs(stamp - point.time) < 0.001) return current;
  let keys = unmarkJoint(track.keys, keyId, bone);
  if (!keys.some((item) => Math.abs(item.time - stamp) < 0.001)) {
    keys = [
      ...keys,
      {
        id: cameraMoveId(),
        time: stamp,
        value: { x: 0, y: 0, z: 0 },
        bones: { ...(evaluatePoseTrack({ ...track, muted: undefined }, stamp) ?? {}) },
      },
    ];
  }
  const moved = [
    // 도착 자리에 같은 관절의 점이 이미 있으면 옮겨 온 점이 이깁니다.
    ...points.filter((item) => item.id !== keyId && Math.abs(item.time - stamp) > 0.001),
    { id: keyId, time: stamp, value: point.value },
  ];
  // 옮겨 간 자리에도 «찍은 관절» 표시를 답니다 — 점이 값 변화 없이도 그 자리에 남게.
  const landed = resampleJoint(keys, bone, moved).map((item) =>
    Math.abs(item.time - stamp) < 0.001
      ? { ...item, joints: [...new Set([...(item.joints ?? []), bone])] }
      : item,
  );
  return prunePoseKey(replacePoseKeys(current, track, landed), targetId, keyId);
}

/**
 * 인물의 `bonePose` 를 **그 시각 화면에 보이는 자세**로 바꾼 상태. 자세 트랙이 없으면 그대로.
 *
 * 관절 하나를 돌리면 상태의 자세에 그 관절만 덧씌웁니다(`mergeBonePose`). 그런데 자세 트랙이
 * 있으면 상태의 자세는 «마지막으로 만진 그때» 이고 화면은 트랙이 계산한 자세라, 3초에서
 * 팔 하나를 돌렸는데 나머지 관절이 1초에 만졌던 모양으로 섞여 키가 찍힙니다(이동 트랙에서
 * K 가 겪은 것과 같은 사고 — `addMotionKeyAtIn`). 편집하기 **전에** 이것으로 바탕을 맞춥니다.
 */
export function withShownPoseIn(
  current: CompositionState,
  characterId: string,
  time: number,
): CompositionState {
  const track = poseTrackOf(current, characterId);
  const shown = track ? evaluatePoseTrack(track, time) : null;
  if (!shown) return current;
  return {
    ...current,
    characters: current.characters.map((item) =>
      item.characterId === characterId ? { ...item, bonePose: shown } : item,
    ),
  };
}

/**
 * 자세 키 한 장을 찍습니다. 같은 시각의 키는 덮어쓰고, 트랙이 없으면 만듭니다.
 * `bones` 를 안 넘기면 **그 시각 화면에 보이는 자세**(트랙이 있으면 계산값, 없으면 상태 값).
 */
export function addPoseKeyIn(
  current: CompositionState,
  characterId: string,
  time: number,
  bones?: Record<string, Vector3Value>,
  /** 사람이 찍은 관절(`MotionKey.joints`). 같은 시각의 키가 이미 들고 있던 표시와 합칩니다. */
  joints: string[] = [],
): CompositionState {
  const character = current.characters.find((item) => item.characterId === characterId);
  if (!character) return current;
  const track = poseTrackOf(current, characterId);
  const shown =
    bones ?? (track ? evaluatePoseTrack(track, time) : null) ?? character.bonePose ?? {};
  const stamp = Math.max(0, Math.round(time * 20) / 20);
  const tracks = motionTracksOf(current);
  const found = tracks.find((item) => item.targetId === characterId && item.channel === "pose");
  const same = found?.keys.find((k) => Math.abs(k.time - stamp) <= 0.001);
  const marked = [...new Set([...(same?.joints ?? []), ...joints])];
  const key: MotionKey = {
    // 같은 시각의 키는 이름표를 이어받습니다 — 골라 둔 점·그래프가 자동 키 한 번에 풀리지 않게.
    id: same?.id ?? cameraMoveId(),
    time: stamp,
    value: { x: 0, y: 0, z: 0 },
    bones: { ...shown },
    ...(same?.easing ? { easing: same.easing } : {}),
    ...(marked.length ? { joints: marked } : {}),
  };
  return {
    ...current,
    motionTracks: found
      ? tracks.map((item) =>
          item === found
            ? { ...item, keys: [...item.keys.filter((k) => Math.abs(k.time - stamp) > 0.001), key] }
            : item,
        )
      : [...tracks, { id: cameraMoveId(), targetId: characterId, channel: "pose", keys: [key] }],
  };
}

/**
 * **키 하나**의 완급을 정합니다 — 그 키에서 다음 키까지의 구간.
 *
 *
 */
export function setMotionKeyEasingIn(
  current: CompositionState,
  targetId: string,
  channel: MotionChannel,
  keyId: string,
  easing: EasingCurve,
): CompositionState {
  return {
    ...current,
    motionTracks: motionTracksOf(current).map((track) =>
      track.targetId === targetId && track.channel === channel
        ? {
            ...track,
            keys: track.keys.map((key) =>
              key.id === keyId ? { ...key, easing } : key,
            ),
          }
        : track,
    ),
  };
}

/** 자유 경로 키 하나의 완급(그 키에서 다음 키까지). */
export function setCameraKeyEasingIn(
  current: CompositionState,
  id: string,
  keyId: string,
  easing: EasingCurve,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  return patchCameraMoveIn(current, id, {
    keys: (move.keys ?? []).map((key) =>
      key.id === keyId ? { ...key, easing } : key,
    ),
  });
}

/** 이동량 키 하나의 완급(그 키에서 다음 키까지). */
export function setAmountKeyEasingIn(
  current: CompositionState,
  id: string,
  keyId: string,
  easing: EasingCurve,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  return patchCameraMoveIn(current, id, {
    amountKeys: (move.amountKeys ?? []).map((key) =>
      key.id === keyId ? { ...key, easing } : key,
    ),
  });
}

/** 인물·소품 트랙의 완급 곡선을 정합니다. 없으면 등속(리니어)입니다. */
export function setMotionEasingIn(
  current: CompositionState,
  targetId: string,
  channel: MotionChannel,
  easing: EasingCurve,
): CompositionState {
  return {
    ...current,
    motionTracks: motionTracksOf(current).map((track) =>
      track.targetId === targetId && track.channel === channel
        ? { ...track, easing }
        : track,
    ),
  };
}

/**
 * 타임라인의 **총 길이(초)와 프레임 수**를 정합니다.
 *
 *
 *
 * 5초는 «기본값» 이었지 한계가 아니었는데, 고칠 자리가 없어 한계처럼 굳어 있었습니다.
 * 길이를 줄일 때 **클립을 자르지는 않습니다** — 타임라인 밖으로 밀려난 클립은 화면에서만
 * 안 보일 뿐 값은 남아, 다시 늘리면 그대로 돌아옵니다. 잘라 버리면 되돌릴 수가 없습니다.
 */
export function setTimelineIn(
  current: CompositionState,
  patch: { duration?: number; fps?: number },
): CompositionState {
  const now = timelineOf(current);
  const take = (
    next: number | undefined,
    fallback: number,
    min: number,
    max: number,
  ) =>
    Number.isFinite(next ?? NaN)
      ? Math.min(max, Math.max(min, next as number))
      : fallback;
  return {
    ...current,
    timeline: {
      // 0.1초 밑으로는 재생이 한 프레임도 안 돌고, 10분이면 구도잡기의 쓰임을 넘습니다.
      duration: take(patch.duration, now.duration, 0.1, 600),
      // 실사 24 · 방송 30 · 게임 60. 1 밑이나 240 위는 쓸 일이 없습니다.
      fps: Math.round(take(patch.fps, now.fps, 1, 240)),
    },
  };
}

/** 이 구도에서 뽑은 레퍼런스 영상을 목록에 더합니다(같은 경로는 한 번만). */
export function addRenderIn(
  current: CompositionState,
  render: CompositionRender,
): CompositionState {
  const now = current.renders || [];
  if (now.some((item) => item.path === render.path)) return current;
  return { ...current, renders: [...now, render] };
}

/** 목록에서 뺍니다 — **기록만** 빼고 파일은 폴더에 둡니다(다른 컷이 쓰고 있을 수 있습니다). */
export function removeRenderIn(current: CompositionState, id: string): CompositionState {
  const now = current.renders || [];
  const next = now.filter((item) => item.id !== id);
  return next.length === now.length ? current : { ...current, renders: next };
}

/**
 * 벽에 **그림을 입히거나 뗍니다**(빈 문자열이면 뗌).
 *
 *
 * 그림은 파일 경로로만 적습니다 — 파일은 프로젝트 폴더에 그대로 두고, 뷰포트가 그 경로를 읽어 판에 붙입니다.
 */
export function setObjectImageIn(
  current: CompositionState,
  objectId: string,
  path: string,
): CompositionState {
  return {
    ...current,
    objects: current.objects.map((item) =>
      item.id === objectId ? { ...item, image: path || undefined } : item,
    ),
  };
}

/**
 * 벽 하나와 **인물들 사이의 거리**(m). 배경 그림을 뽑을 때 «얼마나 뒤에 있는 벽인가» 를 말해 주려고 씁니다.
 *
 *
 * 벽의 판은 z 축을 보는 면이라, **벽면의 법선 방향 거리**(벽이 돌아가 있어도 맞는 거리)를 잽니다.
 */
export function wallDistanceOf(
  current: CompositionState,
  objectId: string,
): { near: number; far: number; count: number } | null {
  const wall = current.objects.find((item) => item.id === objectId);
  if (!wall) return null;
  const people = current.characters.filter((item) => !item.hidden);
  if (!people.length) return null;
  // 벽이 y 축으로 돌아간 만큼 법선도 돕니다(판은 기본으로 +z 를 봅니다).
  const yaw = wall.rotation?.y ?? 0;
  const normal = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const distances = people.map((person) =>
    Math.abs(
      (person.position.x - wall.position.x) * normal.x +
        (person.position.z - wall.position.z) * normal.z,
    ),
  );
  return {
    near: Math.min(...distances),
    far: Math.max(...distances),
    count: people.length,
  };
}

/** 이 방이 쓰는 장소 카드를 잇거나(값) 끊습니다(빈 문자열). */
export function setRoomBackgroundIn(
  current: CompositionState,
  backgroundId: string,
  roomId?: string,
): CompositionState {
  const target = roomId ?? activeRoomOf(current).id;
  return {
    ...current,
    rooms: roomsOf(current).map((room) =>
      room.id === target ? { ...room, backgroundId: backgroundId || undefined } : room,
    ),
  };
}

/**
 * 타임라인에 깔린 노래. 없으면 null.
 *
 * `sections` 가 빠진 옛 저장본이 있을 수 있어 여기서 한 번 채웁니다 — 읽는 쪽마다 `?? []` 를 적으면
 * 한 군데 빠뜨렸을 때 «구간이 있는데 나눠 뽑기에는 안 뜨는» 어긋남이 생깁니다.
 */
export function musicOf(current: CompositionState): CompositionMusic | null {
  const music = timelineOf(current).music;
  return music?.path ? { ...music, sections: music.sections ?? [] } : null;
}

/** 노래를 깔거나(값) 걷습니다(null). 구간은 새 노래에서 처음부터 다시 잡습니다. */
export function setMusicIn(
  current: CompositionState,
  music: CompositionMusic | null,
): CompositionState {
  const timeline = timelineOf(current);
  if (!music) {
    if (!timeline.music) return current;
    const { music: _drop, ...rest } = timeline;
    return { ...current, timeline: rest };
  }
  return { ...current, timeline: { ...timeline, music: { ...music, sections: music.sections ?? [] } } };
}

/** 노래는 그대로 두고 값만 고칩니다(민 자리·빠르기·구간). */
export function patchMusicIn(
  current: CompositionState,
  patch: Partial<CompositionMusic>,
): CompositionState {
  const music = musicOf(current);
  return music ? setMusicIn(current, { ...music, ...patch }) : current;
}

/**
 * 빠르기(BPM)와 마디로 구간을 한 번에 나눕니다. 한 마디는 4박(4/4 박자)입니다.
 *
 * 구간은 **타임라인 안**에서만 만듭니다 — 노래가 타임라인보다 길면 뒤쪽은 뽑을 화면이 없습니다.
 * 노래를 민 만큼(`offset`) 첫 박이 타임라인 0초가 아닐 수 있어, 첫 경계를 그 나머지에서 시작합니다.
 */
export function splitMusicByBarsIn(
  current: CompositionState,
  bpm: number,
  bars: number,
): CompositionState {
  const music = musicOf(current);
  if (!music || bpm <= 0 || bars <= 0) return current;
  const step = (60 / bpm) * 4 * bars;
  const span = timelineOf(current).duration;
  const offset = music.offset ?? 0;
  // 노래를 민 경우 첫 마디가 타임라인 0초보다 앞에서 시작합니다 — 그 나머지만큼 당겨 첫 경계를 잡습니다.
  const first = offset > 0 ? ((step - (offset % step)) % step) : -offset % step;
  const sections: CompositionMusic["sections"] = [];
  let index = 1;
  for (let start = first > 0.05 ? 0 : first; start < span - 0.05; start = sections[sections.length - 1].end) {
    const end = Math.min(span, (sections.length === 0 && first > 0.05 ? first : start) + step);
    sections.push({
      id: musicSectionId(),
      label: `${index}`,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
    });
    index += 1;
    if (end >= span - 0.001) break;
  }
  return patchMusicIn(current, { bpm, barsPerSection: bars, sections });
}

/** 지금 플레이헤드 자리에서 구간을 둘로. 구간이 없으면 «처음~여기 / 여기~끝». */
export function cutMusicAtIn(current: CompositionState, at: number): CompositionState {
  const music = musicOf(current);
  if (!music) return current;
  const span = timelineOf(current).duration;
  const time = Math.round(Math.min(span, Math.max(0, at)) * 100) / 100;
  const sections = music.sections.length
    ? music.sections
    : [{ id: musicSectionId(), label: "1", start: 0, end: span }];
  const found = sections.find((item) => time > item.start + 0.05 && time < item.end - 0.05);
  if (!found) return patchMusicIn(current, { sections });
  return patchMusicIn(current, {
    sections: sections.flatMap((item) =>
      item.id === found.id
        ? [
            { ...item, end: time },
            { id: musicSectionId(), label: `${item.label}-2`, start: time, end: item.end },
          ]
        : [item],
    ),
  });
}

/** 컷의 인물·소품 트랙들. */
export function motionTracksOf(current: CompositionState): MotionTrack[] {
  return current.motionTracks ?? [];
}

/**
 * 인물·소품의 **지금 자리**를 그 시각의 키로 찍습니다.
 *
 *
 *
 * 같은 시각에 이미 키가 있으면 덮어씁니다 — 같은 자리에 두 점이 겹치면 화면에서 한 점으로만
 * 보여 지울 수가 없습니다. 트랙이 없으면 그때 만듭니다.
 */
/** 대상의 지금 속성 값. 없는 대상이면 null. */
export function motionValueOf(
  current: CompositionState,
  targetId: string,
  channel: MotionChannel,
): Vector3Value | null {
  const character = current.characters.find((c) => c.characterId === targetId);
  if (character) {
    // 인물 크기는 캐릭터 설정(키)이 정합니다. 자세는 벡터 하나가 아니라 `addPoseKeyIn` 이 맡습니다.
    if (channel === "scale" || channel === "pose") return null;
    return {
      ...(channel === "position" ? character.position : character.rotation),
    };
  }
  const object = current.objects.find((o) => o.id === targetId);
  if (object) {
    if (channel === "pose") return null;
    return {
      ...(channel === "position"
        ? object.position
        : channel === "rotation"
          ? object.rotation
          : object.scale),
    };
  }
  /*
    **GLB 도 같은 트랙으로 움직입니다**(). 크기는 한 값(균등)이라 세 축에 같은 값을 넣습니다 — 트랙은 벡터로 적고, 화면은 x 만 씁니다.
  */
  const glb = (current.glbTracks ?? []).find((item) => item.id === targetId);
  if (!glb || channel === "pose") return null;
  if (channel === "position") return { ...glb.position };
  if (channel === "rotation") return { ...glb.rotation };
  const size = glb.scale || 1;
  return { x: size, y: size, z: size };
}

export function addMotionKeyIn(
  current: CompositionState,
  targetId: string,
  channel: MotionChannel,
  time: number,
): CompositionState {
  if (channel === "pose") return addPoseKeyIn(current, targetId, time);
  const value = motionValueOf(current, targetId, channel);
  if (!value) return current;
  const stamp = Math.max(0, Math.round(time * 20) / 20);
  const key: MotionKey = { id: cameraMoveId(), time: stamp, value };
  const tracks = motionTracksOf(current);
  const found = tracks.find(
    (t) => t.targetId === targetId && t.channel === channel,
  );
  const next = found
    ? tracks.map((t) =>
        t === found
          ? {
              ...t,
              keys: [
                ...t.keys.filter((k) => Math.abs(k.time - stamp) > 0.001),
                key,
              ],
            }
          : t,
      )
    : [...tracks, { id: cameraMoveId(), targetId, channel, keys: [key] }];
  return { ...current, motionTracks: next };
}

/**
 * 키 하나를 **다른 시각으로** 옮깁니다.
 *
 * 동선을 만들 때
 * 자리는 맞는데 «조금 늦게» 가 대부분이라, 지우고 다시 찍게 하면 자리까지 다시 잡아야 합니다.
 */
/**
 * 잡아 둔 **여러 키를 한꺼번에** 옮깁니다 — 전부 같은 만큼.
 *
 *
 *
 * 하나씩 옮기면 600개짜리 모캡에서는 손이 남아나지 않습니다. 그리고 **사이 간격이 틀어지면
 * 춤이 아니게 됩니다** — 그래서 시각을 각자 계산하지 않고 **같은 delta** 를 더합니다.
 *
 * 0초 아래로는 안 내려갑니다. 무리가 왼쪽 끝에 닿으면 **거기서 멈춥니다** — 앞쪽만 0 에
 * 몰리면 간격이 무너지니, 가장 이른 키가 0 에 닿는 지점까지만 밀어 줍니다.
 */
export function shiftMotionKeysIn(
  current: CompositionState,
  keyIds: readonly string[],
  delta: number,
): CompositionState {
  const picked = new Set(keyIds);
  if (!picked.size) return current;
  const tracks = motionTracksOf(current);
  /*
    **대상·채널을 가리지 않습니다.** 한 사람의 이동·회전·자세는 **같은 순간의
    한 동작**이라, 채널마다 따로 옮기면 팔만 먼저 가는 춤이 됩니다.
  */
  const earliest = Math.min(
    ...tracks.flatMap((track) =>
      track.keys.filter((key) => picked.has(key.id)).map((key) => key.time),
    ),
  );
  if (!Number.isFinite(earliest)) return current;
  const shift = Math.round(Math.max(delta, -earliest) * 20) / 20;
  if (shift === 0) return current;
  return {
    ...current,
    motionTracks: tracks.map((item) => ({
      ...item,
      keys: item.keys.map((key) =>
        picked.has(key.id)
          ? { ...key, time: Math.max(0, Math.round((key.time + shift) * 20) / 20) }
          : key,
      ),
    })),
  };
}

export function moveMotionKeyIn(
  current: CompositionState,
  targetId: string,
  keyId: string,
  time: number,
): CompositionState {
  const stamp = Math.max(0, Math.round(time * 20) / 20);
  return {
    ...current,
    motionTracks: motionTracksOf(current).map((track) =>
      track.targetId === targetId
        ? {
            ...track,
            keys: track.keys.map((key) =>
              key.id === keyId ? { ...key, time: stamp } : key,
            ),
          }
        : track,
    ),
  };
}

/**
 * 프리셋 클립의 **이동량 키**를 찍습니다 — 「이 시각에 몇 도」.
 *
 *
 *
 * 첫 키를 찍을 때는 **0 초 키를 같이** 넣습니다. 하나만 있으면 클립 내내 그 값으로 멈춰
 * 있어서 «안 움직인다» 가 되는데, 사람이 원한 것은 «여기서 저기까지» 이기 때문입니다.
 */
export function addAmountKeyIn(
  current: CompositionState,
  id: string,
  localTime: number,
  amount: number,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  const stamp = Math.max(0, Math.round(localTime * 20) / 20);
  const existing = move.amountKeys ?? [];
  /*
    **첫 키를 찍을 때는 양 끝을 함께 세웁니다** — 0초에 0, 끝에 프리셋 이동량.

    예전에는 0초 키 하나만 심었고, 재생 머리가 0초일 때는 그것마저 안 심었습니다.
    그러면 「+ 이동량 키」 를 처음 누른 순간 **키가 하나뿐**이 되어 그 값이 클립 내내
    상수가 됩니다 — 카메라가 아예 안 움직여서, 값을 고쳐도 화면이 그대로였습니다
    ().

    양 끝을 세워 두면 손대기 전과 **똑같이 움직이면서**, 시작·끝을 각각 고칠 수 있습니다.
    사용자가 처음 요청한 「시작은 몇 도, 끝은 몇 도」 가 그대로 됩니다.
  */
  const seed = existing.length
    ? []
    : [
        { id: cameraMoveId(), time: 0, amount: 0 },
        {
          id: cameraMoveId(),
          time: Math.max(0.05, move.duration),
          amount: move.amount,
        },
      ];
  return patchCameraMoveIn(current, id, {
    amountKeys: [
      // 심은 것도 같은 시각이면 사람이 넣은 값이 이깁니다.
      ...seed.filter((key) => Math.abs(key.time - stamp) > 0.001),
      ...existing.filter((key) => Math.abs(key.time - stamp) > 0.001),
      { id: cameraMoveId(), time: stamp, amount },
    ],
  });
}

export function removeAmountKeyIn(
  current: CompositionState,
  id: string,
  keyId: string,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  return patchCameraMoveIn(current, id, {
    amountKeys: (move.amountKeys ?? []).filter((key) => key.id !== keyId),
  });
}

export function moveAmountKeyIn(
  current: CompositionState,
  id: string,
  keyId: string,
  localTime: number,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  const stamp = Math.max(0, Math.round(localTime * 20) / 20);
  return patchCameraMoveIn(current, id, {
    amountKeys: (move.amountKeys ?? []).map((key) =>
      key.id === keyId ? { ...key, time: stamp } : key,
    ),
  });
}

/** 자유 경로 클립의 키를 다른 시각으로. 클립 시작부터의 초입니다. */
export function moveCameraKeyIn(
  current: CompositionState,
  id: string,
  keyId: string,
  localTime: number,
): CompositionState {
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  /*
    **0.01초 눈금**으로 촘촘하게 붙입니다.

    0.05초였을 때는 끄는 동안 키가 한 칸씩 «툭툭» 튀었고, 칸 사이에서는 손을 움직여도
    제자리로 돌아온 것처럼 보였습니다(). 클립을 끄는 것과 달리 키는 «정확히 그 순간» 이
    중요한 값이라 눈금을 잘게 둡니다.
  */
  const stamp = Math.max(0, Math.round(localTime * 100) / 100);
  return patchCameraMoveIn(current, id, {
    keys: (move.keys ?? []).map((key) =>
      key.id === keyId ? { ...key, time: stamp } : key,
    ),
  });
}

/** 키 하나를 뺍니다. 트랙이 비면 트랙째 지웁니다 — 빈 줄이 타임라인에 남지 않게. */
export function removeMotionKeyIn(
  current: CompositionState,
  targetId: string,
  keyId: string,
): CompositionState {
  const next = motionTracksOf(current)
    .map((t) =>
      t.targetId === targetId
        ? { ...t, keys: t.keys.filter((k) => k.id !== keyId) }
        : t,
    )
    .filter((t) => t.keys.length > 0);
  return { ...current, motionTracks: next };
}

/**
 * **영상에서 뽑은 움직임**을 인물들의 이동·회전·자세 트랙에 한꺼번에 넣습니다(`motionRetarget.placeCapturedMotion` 의 결과).
 *
 * , 「우리 캐릭터는 관절은 회전값만 있고 캐릭터 전체는
 * 이동이랑 회전값이 있으니까」 — 그래서 한 순간이 세 트랙(position·rotation·pose)의 키 세 개가 됩니다.
 *
 * 넣는 구간(첫 키~마지막 키) 안에 원래 있던 키는 **그 채널만** 지웁니다. 남겨 두면 영상 키 사이에 옛 키가 끼어 몸이 튑니다.
 * 구간 밖의 키(앞 장면의 걷기 등)는 그대로 둡니다. 타임라인이 짧으면 끝까지 늘립니다 — 노래 한 곡(3분 넘게)을 한 번에 넣는 게
 * 흔한 쓰임이라 5 초 타임라인에 잘려 들어가면 안 됩니다.
 */
export function applyCapturedMotionIn(
  current: CompositionState,
  placed: {
    characterId: string;
    frames: { time: number; position: Vector3Value; rotation: Vector3Value; bones: Record<string, Vector3Value> }[];
  }[],
  channels: { position: boolean; rotation: boolean; pose: boolean },
  /** 어느 모션에서 왔는가 — 레이어에 «수화(춤선…)» 으로 뜹니다. */
  source?: { id: string; name: string },
): CompositionState {
  let tracks = motionTracksOf(current);
  let end = 0;
  for (const item of placed) {
    if (!item.frames.length || !current.characters.some((c) => c.characterId === item.characterId)) continue;
    // 바로 바깥의 수동 키까지 오차 범위로 지우면 짧은 손 동작이 함께 사라집니다.
    const from = item.frames[0].time;
    const to = item.frames[item.frames.length - 1].time;
    end = Math.max(end, to);
    const write = (channel: MotionChannel, keys: MotionKey[]) => {
      const found = tracks.find((t) => t.targetId === item.characterId && t.channel === channel);
      // 이름은 **덮어씁니다** — 다른 모션을 넣었으면 레이어에도 그 이름이 떠야 합니다.
      const mark = source ? { sourceId: source.id, sourceName: source.name } : {};
      tracks = found
        ? tracks.map((t) =>
            t === found
              ? {
                  ...t,
                  ...mark,
                  keys: [...t.keys.filter((k) => k.time < from || k.time > to), ...keys].sort((a, b) => a.time - b.time),
                }
              : t,
          )
        : [...tracks, { id: cameraMoveId(), targetId: item.characterId, channel, keys, ...mark }];
    };
    if (channels.position)
      write("position", item.frames.map((frame) => ({ id: cameraMoveId(), time: frame.time, value: { ...frame.position } })));
    if (channels.rotation)
      write("rotation", item.frames.map((frame) => ({ id: cameraMoveId(), time: frame.time, value: { ...frame.rotation } })));
    if (channels.pose) {
      const oldPose = poseTrackOf(current, item.characterId);
      const character = current.characters.find((c) => c.characterId === item.characterId)!;
      const captured: MotionTrack = {
        id: "capture", targetId: item.characterId, channel: "pose", easing: oldPose?.easing,
        keys: item.frames.map((frame, index) => ({ id: `capture-${index}`, time: frame.time, value: { x: 0, y: 0, z: 0 }, bones: frame.bones })),
      };
      // 몇 분짜리 캡처를 원래 키 시각마다 다시 정렬·보간하지 않도록 직접 찾습니다.
      const capturedAt = new Map(item.frames.map((frame) => [frame.time, frame.bones]));
      const detectedFingersAt = (time: number) => {
        const exact = capturedAt.get(time);
        if (exact) return new Set(Object.keys(exact).filter((name) => FINGER_BONE_RE.test(name)));
        const segment = segmentAt(captured.keys, time)!;
        const a = segment.from.bones ?? {}, b = segment.to.bones ?? {};
        const names = Object.keys(segment.t >= 1 ? b : a);
        // 한쪽 장에서 못 읽은 마디는 보간으로 지어내지 않습니다. 정확히 검출한 키는 0도도 유효합니다.
        return new Set(names.filter((name) => FINGER_BONE_RE.test(name) && (
          segment.from === segment.to || segment.t <= 0 || segment.t >= 1 || name in b
        )));
      };
      const times = new Set(item.frames.map((frame) => frame.time));
      const oldFingerNames = new Set(oldPose?.keys.flatMap((key) => Object.keys(key.bones ?? {}).filter((name) => FINGER_BONE_RE.test(name))) ?? []);
      for (const key of oldPose?.keys ?? []) {
        if (key.time < from || key.time > to) continue;
        const detected = detectedFingersAt(key.time);
        // 캡처 시각만 남기면 그 사이의 수동 손 키가 소실됩니다. 0도로 돌아오는 키도 포함합니다.
        if ([...oldFingerNames].some((name) => !detected.has(name))) times.add(key.time);
      }
      write("pose", [...times].sort((a, b) => a - b).map((time) => {
        const previous = (oldPose ? evaluatePoseTrack(oldPose, time) : null) ?? character.bonePose ?? {};
        const fingers = Object.fromEntries(Object.entries(previous).filter(([name]) => FINGER_BONE_RE.test(name)));
        const pose = capturedAt.get(time) ?? evaluatePoseTrack(captured, time) ?? {};
        const body = Object.fromEntries(Object.entries(pose).filter(([name]) => !FINGER_BONE_RE.test(name)));
        const detected = Object.fromEntries([...detectedFingersAt(time)].map((name) => [name, pose[name] ?? { x: 0, y: 0, z: 0 }]));
        // 시각과 그때의 값은 보존합니다. 완급은 몸·손이 공유하므로 서로 다른 원래 곡선까지
        // 동시에 재현하는 것은 현재 저장 형식의 범위를 벗어납니다.
        return { id: cameraMoveId(), time, value: { x: 0, y: 0, z: 0 }, bones: { ...body, ...fingers, ...detected } };
      }));
    }
  }
  const next = { ...current, motionTracks: tracks };
  return end > timelineOf(current).duration ? setTimelineIn(next, { duration: Math.ceil(end * 10) / 10 }) : next;
}

/**
 * 클립의 **프리셋만** 갈아 끼웁니다. 시각·길이·앵커·완급은 그대로 둡니다.
 *
 *
 *
 * 지우고 다시 놓으면 자리와 길이를 처음부터 맞춰야 합니다 — 「2.1초부터 3.4초까지」 를
 * 다시 잡는 일이 실제로는 제일 성가십니다. 갈아 끼우면 **자리는 그대로 두고 움직임만**
 * 바뀝니다.
 *
 * 이동량은 새 프리셋의 기본값으로 바꿉니다 — 오빗의 90(도)을 줌에 그대로 두면 90배가
 * 되어 화면이 터집니다. 단위가 다른 값을 물려받을 수는 없습니다.
 */
export function swapCameraMovePresetIn(
  current: CompositionState,
  id: string,
  shotId: string,
): CompositionState {
  const preset = SHOT_PRESETS.find((item: ShotPreset) => item.id === shotId);
  if (!preset) return current;
  const move = cameraMoveOf(current, id);
  if (!move) return current;
  const sample = createCameraMove(shotId);
  return patchCameraMoveIn(current, id, {
    shotId,
    amount: sample.amount,
    axis: sample.axis,
    // 자유 경로로 갈아타면 «지금 시각의 자세» 를 0초 키로 심어 시작점을 만듭니다.
    keys:
      preset.kind === "free"
        ? [
            {
              id: cameraMoveId(),
              time: 0,
              pose: poseAtTimeIn(current, move.startTime),
            },
          ]
        : undefined,
    // 단위가 바뀌므로 옛 이동량 키는 버립니다(도 → 미터는 옮길 수가 없습니다).
    amountKeys: undefined,
  });
}

/**
 * 클립의 **줄 차례**를 위아래로 옮깁니다.
 *
 *
 *
 * 맞습니다 — 줄은 **시각 순**으로 그려지므로 «위» 는 곧 «먼저» 입니다. 그래서 차례를
 * 바꾸는 일은 곧 **시작 시각을 맞바꾸는 일**입니다. 길이가 서로 다르면 뒤엣것이 앞으로
 * 올 때 빈틈이 생기므로, 앞 클립 자리에 붙여 놓고 그 뒤를 이어 붙입니다.
 */
export function moveCameraMoveOrderIn(
  current: CompositionState,
  id: string,
  delta: number,
): CompositionState {
  const list = sortedMoves(cameraMovesOf(current));
  const at = list.findIndex((move) => move.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= list.length) return current;
  const reordered = [...list];
  const [taken] = reordered.splice(at, 1);
  reordered.splice(to, 0, taken);
  /*
    자리를 다시 깝니다 — 첫 클립의 시작을 그대로 두고 차례대로 이어 붙입니다.
    시각만 맞바꾸면 길이가 다른 두 클립 사이에 빈틈이나 겹침이 남습니다.
  */
  let cursor = list[0]?.startTime ?? 0;
  const placed = new Map<string, number>();
  for (const move of reordered) {
    placed.set(move.id, cursor);
    cursor += move.duration;
  }
  return {
    ...current,
    cameraMoves: cameraMovesOf(current).map((move) =>
      placed.has(move.id)
        ? { ...move, startTime: placed.get(move.id) as number }
        : move,
    ),
  };
}

export function removeCameraMoveIn(
  current: CompositionState,
  id: string,
): CompositionState {
  return {
    ...current,
    cameraMoves: cameraMovesOf(current).filter((move) => move.id !== id),
  };
}

