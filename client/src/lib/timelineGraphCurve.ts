import {
  DEFAULT_EASING,
  SHOT_PRESETS,
  keyDefines,
  type CameraKeyframe,
  type CameraMove,
  type EasingCurve,
} from "@/lib/cameraMoves";
import {
  motionTracksOf,
  patchCameraMoveIn,
  poseJointRowsOf,
  setAmountKeyEasingIn,
  setCameraKeyEasingIn,
  setMotionEasingIn,
  setMotionKeyEasingIn,
} from "@/lib/compositionEdit";
import { CAMERA_KEY_ROWS, channelOf } from "@/components/composition/planner/timelineParts";
import type { CompositionState } from "@/lib/composition";

/** 타임라인에서 «지금 고른 키» — 갈래마다 가리키는 것이 다릅니다. */
export type PickedKey =
  | { kind: "motion"; targetId: string; keyId: string }
  | { kind: "joint"; targetId: string; keyId: string; bone: string }
  | { kind: "camera"; moveId: string; keyId: string }
  | { kind: "amount"; moveId: string; keyId: string }
  | { kind: "occlude"; trackId: string; keyId: string }
  | null;

/** 그래프 판이 어느 줄에 떠 있는가. */
export type GraphPanel =
  | { kind: "move"; id: string }
  | { kind: "track"; targetId: string; channel: string }
  | null;

export interface GraphCurve {
  /** 이 키가 그 속성의 **마지막** 인가. 그러면 뒤 구간이 없어 고쳐도 안 움직입니다. */
  last: boolean;
  title: string;
  curve: EasingCurve;
  onChange: (easing: EasingCurve) => void;
}

/** 마지막 키인가. 뒤 구간이 없으면 곡선을 고쳐도 아무 일이 안 일어납니다. */
function isLastKey(keys: { id: string; time: number }[], key: { id: string; time: number }) {
  return !keys.some((item) => item.time > key.time);
}

/**
 * 떠 있는 그래프가 그릴 **곡선과 저장 자리**.
 *
 *
 *
 * 그래서 **고른 키가 있으면 그 키의 구간**을 고칩니다(그 키 → 다음 키). 고른 키가
 * 없으면 예전처럼 클립·트랙 전체의 기본 곡선입니다. 애프터이펙트와 같은 규칙이라,
 * 「천천히 걷다가 빠르게 이동하다 천천히」 를 구간마다 따로 줄 수 있습니다.
 */
export function graphCurveOf(input: {
  graphPanel: GraphPanel;
  pickedKey: PickedKey;
  state: CompositionState;
  moves: CameraMove[];
  targetNames?: Record<string, string>;
  setState: (updater: (current: CompositionState) => CompositionState) => void;
}): GraphCurve | null {
  const { graphPanel, pickedKey, state, moves, targetNames, setState } = input;
    if (!graphPanel) return null;

    // ① 키를 골라 두었으면 그 키의 구간이 먼저입니다.
    // 관절 점을 골랐으면 그것이 든 **자세 키**의 구간입니다(완급은 자세 한 장에 하나).
    if (pickedKey?.kind === "motion" || pickedKey?.kind === "joint") {
      /*
        대상의 **첫 트랙**이 아니라 그 키가 든 트랙입니다. 예전엔 대상만 보고 찾아서, 회전·자세
        줄의 키를 골라도 이동 트랙에서 키를 못 찾고 «기본 속도» 로 떨어졌습니다 — 그래프 단추가
        레이어 줄 하나로 모인 뒤로는 고른 키가 곧 «어느 속성의 그래프인가» 라서 틀리면 안 됩니다.
      */
      const track = motionTracksOf(state).find(
        (item) =>
          item.targetId === pickedKey.targetId &&
          item.keys.some((key) => key.id === pickedKey.keyId),
      );
      const key = track?.keys.find((item) => item.id === pickedKey.keyId);
      /*
        «마지막 키» 는 **속성마다** 봅니다.  자세 키는 관절 전부가 한 장이라 트랙 전체로 보면, 오른팔이 1초에 멈추고 팔꿈치가
        2초까지 가는 경우 오른팔의 1초 점을 골라도 «뒤 구간이 있다» 로 나왔습니다. 관절 점을 골랐으면
        그 관절 줄의 점들로, 접힌 자세 줄의 점이면 요약 점들로 봅니다.
      */
      const jointRow =
        pickedKey.kind === "joint" && track
          ? poseJointRowsOf(track).find((row) => row.bone === pickedKey.bone)
          : undefined;
      const summaryKeys =
        pickedKey.kind === "motion" && track?.channel === "pose"
          ? track.keys.filter((item) =>
              poseJointRowsOf(track).some((row) => row.keys.some((point) => point.id === item.id)),
            )
          : [];
      if (track && key)
        return {
          last: jointRow
            ? isLastKey(jointRow.keys, key)
            : summaryKeys.length
              ? isLastKey(summaryKeys, key)
              : isLastKey(track.keys, key),
          title: `${targetNames?.[track.targetId] ?? track.targetId} · ${jointRow ? `자세 · ${jointRow.label}` : channelOf(track.channel).label} · ${key.time.toFixed(2)}초부터`,
          curve: key.easing ?? track.easing ?? DEFAULT_EASING,
          onChange: (easing: NonNullable<typeof key.easing>) =>
            setState((current) =>
              setMotionKeyEasingIn(
                current,
                track.targetId,
                track.channel,
                key.id,
                easing,
              ),
            ),
        };
    }
    if (pickedKey?.kind === "camera" || pickedKey?.kind === "amount") {
      const move = moves.find((item) => item.id === pickedKey.moveId);
      const key =
        pickedKey.kind === "camera"
          ? move?.keys?.find((item) => item.id === pickedKey.keyId)
          : move?.amountKeys?.find((item) => item.id === pickedKey.keyId);
      if (move && key) {
        const preset = SHOT_PRESETS.find((item) => item.id === move.shotId);
        const write =
          pickedKey.kind === "camera"
            ? setCameraKeyEasingIn
            : setAmountKeyEasingIn;
        return {
          /*
            자유 경로는 **갈래마다** 줄이 다르므로 «마지막» 도 갈래 안에서 봅니다 —
            이동 키가 마지막이어도 줌 키는 뒤에 더 있을 수 있습니다.
          */
          last: isLastKey(
            pickedKey.kind === "camera"
              ? (move.keys ?? []).filter((item) =>
                  CAMERA_KEY_ROWS.some(
                    (row) =>
                      keyDefines(item, row.id) &&
                      keyDefines(key as CameraKeyframe, row.id),
                  ),
                )
              : (move.amountKeys ?? []),
            key,
          ),
          title: `${preset?.label ?? "무빙"} · ${key.time.toFixed(2)}초부터`,
          curve: key.easing ?? move.easing,
          onChange: (easing: typeof move.easing) =>
            setState((current) => write(current, move.id, key.id, easing)),
        };
      }
    }

    // ② 고른 키가 없으면 클립·트랙 전체의 기본 곡선.
    if (graphPanel.kind === "move") {
      const move = moves.find((item) => item.id === graphPanel.id);
      if (!move) return null;
      const preset = SHOT_PRESETS.find((item) => item.id === move.shotId);
      return {
        last: false,
        title: `${preset?.label ?? "무빙"} — 기본 속도`,
        curve: move.easing,
        onChange: (easing: typeof move.easing) =>
          setState((current) =>
            patchCameraMoveIn(current, move.id, { easing }),
          ),
      };
    }
    const track = motionTracksOf(state).find(
      (item) =>
        item.targetId === graphPanel.targetId &&
        item.channel === graphPanel.channel,
    );
    if (!track) return null;
    return {
      last: false,
      title: `${targetNames?.[track.targetId] ?? track.targetId} · ${channelOf(track.channel).label} — 기본 속도`,
      curve: track.easing ?? DEFAULT_EASING,
      onChange: (easing: NonNullable<typeof track.easing>) =>
        setState((current) =>
          setMotionEasingIn(current, track.targetId, track.channel, easing),
        ),
    };
}
