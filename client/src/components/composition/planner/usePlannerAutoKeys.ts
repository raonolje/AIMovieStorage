import { useEffect, useRef, type RefObject } from "react";
import { SHOT_PRESETS, type CameraMove, type ShotPreset } from "@/lib/cameraMoves";
import {
  addCameraKeyIn,
  addMotionKeyIn,
  addPoseKeyIn,
  changedBones,
  evaluatePoseTrack,
  motionTracksOf,
  motionValueOf,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import type { CompositionState } from "@/lib/composition";
import { isControllerState } from "@/lib/compositionControllerState";

/**
 * **자동 키** — 값이 바뀌면 트랙에 스스로 키가 찍힙니다(인물·소품 · 자유 경로 카메라).
 *
 * 2026-09-18 에 `CompositionPlanner.tsx` 에서 떼어 냈습니다. 두 효과가 규칙이 같아서
 * (첫 값은 «바뀐 것» 이 아니다 · 재생 중에는 끈다 · 되돌리기에는 안 쌓는다) 붙여 둡니다 —
 * 한쪽만 고치면 「인물은 자동으로 찍히는데 카메라는 안 찍힌다」 가 됩니다.
 *
 * `setState` 로는 **되돌리기에 안 쌓는** 갱신을 받습니다(`useUndoStack` 의 `replace`).
 * 자동 키는 «사람이 한 편집» 이 아니라 «규칙» 이라, Ctrl+Z 로 지워도 다음 프레임에
 * 곧바로 다시 찍힙니다.
 */
export function usePlannerAutoKeys({
  open,
  playing,
  state,
  setState,
  playheadRef,
  cameraMove,
  playhead,
}: {
  open: boolean;
  playing: boolean;
  state: CompositionState;
  /** 되돌리기에 안 쌓는 갱신. */
  setState: UpdateComposition;
  playheadRef: RefObject<number>;
  /** 타임라인에서 고른 카메라 클립. 자유 경로일 때만 카메라 키가 찍힙니다. */
  cameraMove: CameraMove | null | undefined;
  playhead: number;
}) {
  /*
    ── 자동 키 ───────────────────────────────────────────────────────────
    

    **트랙이 이미 있는 속성만** 자동으로 찍습니다. 트랙이 없으면 아무 일도 안 합니다 —
    물체를 조금 옮겼다고 없던 동선이 생기면 놀랍니다. 첫 키는 사람이 찍고, 그 뒤부터
    자동입니다(애프터이펙트의 스톱워치와 같은 규칙).

    재생 중에는 끕니다. 재생은 트랙이 물체를 움직이는 것이라, 그 값을 다시 키로 적으면
    프레임마다 키가 쌓입니다.
  */
  const lastValuesRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (!open || playing) return;
    const tracks = motionTracksOf(state);
    if (!tracks.length) return;
    let next = state;
    let changed = false;
    for (const track of tracks) {
      // 꺼 둔 트랙은 자동으로도 안 찍습니다 — 안 쓰는 줄에 키가 쌓이면 켤 때 놀랍니다.
      if (track.muted) continue;
      /*
        자세는 벡터 하나가 아니라 관절 표 전체입니다. 표가 바뀌면 **상태의 자세 그대로** 찍습니다 —
        편집이 이미 «보이는 자세» 를 바탕으로 이뤄지므로(`withShownPoseIn`) 상태 값이 곧 의도한 자세.
      */
      if (track.channel === "pose") {
        const character = state.characters.find((item) => item.characterId === track.targetId);
        if (!character) continue;
        const poseKey = `${track.targetId}:pose`;
        const poseStamp = JSON.stringify(character.bonePose ?? {});
        const poseBefore = lastValuesRef.current.get(poseKey);
        lastValuesRef.current.set(poseKey, poseStamp);
        if (isControllerState(state) || poseBefore === undefined || poseBefore === poseStamp) continue;
        /*
          바뀐 관절을 «찍은 관절» 로 — 관절 줄에 방금 만진 자리가 점으로 섭니다.
          비교 상대는 상태에 남은 옛 자세가 아니라 **이 시각에 보이던 자세**입니다(`changedBones` 주석).
        */
        const now = character.bonePose ?? {};
        const shownBefore =
          evaluatePoseTrack(track, playheadRef.current) ??
          (JSON.parse(poseBefore) as Record<string, { x: number; y: number; z: number }>);
        const touched = changedBones(shownBefore, now);
        next = addPoseKeyIn(next, track.targetId, playheadRef.current, now, touched);
        changed = true;
        continue;
      }
      const value = motionValueOf(state, track.targetId, track.channel);
      if (!value) continue;
      const key = `${track.targetId}:${track.channel}`;
      const stamp = `${value.x.toFixed(4)},${value.y.toFixed(4)},${value.z.toFixed(4)}`;
      const before = lastValuesRef.current.get(key);
      lastValuesRef.current.set(key, stamp);
      // 처음 본 값은 «바뀐 것» 이 아닙니다 — 창을 열자마자 키가 찍히면 안 됩니다.
      if (isControllerState(state) || before === undefined || before === stamp) continue;
      next = addMotionKeyIn(
        next,
        track.targetId,
        track.channel,
        playheadRef.current,
      );
      changed = true;
    }
    /*
      **함수꼴 껍데기만 쓰고 `current` 를 버리면 안 됩니다**(2026-09-18 점검).

      `next` 는 위에서 **렌더 시점 `state`** 로 만든 값입니다. 그대로 넣으면 그사이
      3D 기즈모를 끌거나 폴더 읽기가 넣은 변경이 이 한 줄에 통째로 지워집니다.
      바꾼 것은 «자동 키» 뿐이니 그 트랙만 지금 값 위에 얹습니다.
    */
    if (changed)
      setState((current) => (current === state ? next : { ...current, motionTracks: next.motionTracks }));
  }, [open, playing, state]);

  /*
    ── 자유 경로의 자동 키 ───────────────────────────────────────────────
    

    인물·소품의 자동 키(바로 위)와 같은 규칙입니다 — 다만 «트랙이 있는 속성만» 대신
    **«고른 클립이 자유 경로일 때만»** 입니다. 아무 때나 찍으면 화면을 돌려 구도를
    살피기만 해도 길이 생겨 버립니다.

    재생 중에는 끕니다. 재생은 키가 카메라를 움직이는 것이라, 그 값을 다시 키로 적으면
    프레임마다 키가 쌓입니다.
  */
  const lastCameraRef = useRef<string | null>(null);
  useEffect(() => {
    const free =
      cameraMove &&
      !cameraMove.muted &&
      SHOT_PRESETS.find((item: ShotPreset) => item.id === cameraMove.shotId)
        ?.kind === "free";
    if (!open || playing || !free || !cameraMove) {
      lastCameraRef.current = null;
      return;
    }
    // 클립 **밖**에서 카메라를 만진 것은 이 길과 상관이 없습니다.
    const local = playhead - cameraMove.startTime;
    if (local < -0.001 || local > cameraMove.duration + 0.001) {
      lastCameraRef.current = null;
      return;
    }
    const { position, target } = state.camera;
    const stamp = `${cameraMove.id}|${position.x.toFixed(4)},${position.y.toFixed(4)},${position.z.toFixed(4)},${target.x.toFixed(4)},${target.y.toFixed(4)},${target.z.toFixed(4)}`;
    const before = lastCameraRef.current;
    lastCameraRef.current = stamp;
    // 처음 본 값은 «바뀐 것» 이 아닙니다 — 클립을 고르자마자 키가 찍히면 안 됩니다.
    if (isControllerState(state) || before === null || before === stamp) return;
    setState((current) =>
      addCameraKeyIn(current, cameraMove.id, Math.max(0, local)),
    );
  }, [open, playing, cameraMove, playhead, state.camera]);
}
