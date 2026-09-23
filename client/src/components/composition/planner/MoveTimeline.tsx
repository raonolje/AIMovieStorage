import { useT } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/isTypingTarget";
import TimelineMusicRow from "@/components/composition/planner/TimelineMusicRow";
import { CameraPathWarnings } from "./CameraPathWarnings";
import { TimelineRoomRows } from "./TimelineRoomRows";
import { TimelineResizePane } from "./TimelineResizePane";
import { ANCHOR_SPOTS, CAMERA_KEY_ROWS, GUTTER, gutterStyle, HANDHELD_PRESETS, MOTION_CHANNELS, TIMELINE_FIELD, TimelineSelect, amountHintOf, amountUnitOf, timelineFieldStyle } from "./timelineParts";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Crosshair, Eye, EyeOff, Pause, Play, X } from "lucide-react";
import { keyDefines, shotUsesAnchor, SHOT_PRESETS, moveEnd, sortedMoves, type CameraMove } from "@/lib/cameraMoves";
import { EasingGraphEditor } from "@/components/EasingGraphEditor";
import { graphCurveOf } from "@/lib/timelineGraphCurve";
import { NumberInput } from "@/components/composition/fields";
import { ShotPreviewIcon } from "@/components/ShotPreviewIcon";
import { type CompositionState } from "@/lib/composition";
import { sortByTime } from "@/lib/keyframes";
import { addAmountKeyIn, addCameraKeyIn, addCameraMoveIn, addMotionKeyAtIn, movePoseJointKeyIn, movePoseKeyGroupIn, poseJointRowsOf, removePoseJointKeyIn, removePoseKeyGroupIn, layerSpanOf, layersOf, moveOccludeKeyIn, occludeTracksOf, removeOccludeKeyIn, musicOf, setLayerHiddenIn, setLayerSpanIn, cameraShotsOf, moveAmountKeyIn, removeAmountKeyIn, lockAnchorsOf, setLockAnchorsIn, setTimelineIn, timelineOf, motionTracksOf, moveCameraKeyIn, moveMotionKeyIn, shiftMotionKeysIn, removeMotionKeyIn, cameraMovesOf, moveCameraMoveOrderIn, patchCameraKeyIn, patchCameraMoveIn, swapCameraMovePresetIn, removeCameraKeyIn, removeCameraMoveIn, type UpdateComposition } from "@/lib/compositionEdit";
import { promptNumber } from "@/components/PromptDialog";
import { resolveAnchorSource } from "@/lib/cameraMoves";

/**
 * 앵커를 붙일 높이 — 인물 키에 대한 비율(0 = 발밑, 1 = 정수리).
 *
 * 클로즈업은
 * 무엇을 크게 잡느냐가 전부라, 축도 그 자리에 서야 합니다.
 */
/**
 * 키를 찍을 수 있는 속성. 색이 **줄마다 다릅니다.**
 *
 * 줄이 둘만
 * 되어도 노란 마름모가 똑같이 생겨 「위가 이동인지 회전인지」 를 셀 수가 없었습니다.
 * 이름표(대상 · 속성)와 색을 같이 씁니다 — 색만으로도 훑을 때 구분이 되니까요.
 */
/**
 * 3D 화면 **아래에 붙는 카메라 무빙 타임라인** — 클립을 시간 위에 쌓습니다.
 *
 * # 왜 «레이어» 가 아니라 «줄» 인가
 *
 * 애프터이펙트의 레이어는 같은 시각에 여럿이 겹쳐 합성됩니다. 카메라는 하나뿐이라 겹칠 수가
 * 없습니다 — 그래서 여기서 쌓는 것은 **시간 위의 차례**입니다. 다음 클립은 앞 클립이 끝난
 * 자세에서 출발합니다(`evaluateCameraMoves`). 줄을 여러 개 그리는 것은 «무엇이 언제» 를
 * 한눈에 보기 위해서지, 동시에 먹이기 위해서가 아닙니다.
 *
 * # 끄는 규칙
 *
 * 막대 몸통을 끌면 **시각이 옮겨지고**, 오른쪽 끝을 끌면 **길이가 바뀝니다**. 0초 앞으로는
 * 못 갑니다. 끄는 동안 되돌리기 스택에 쌓지 않는 것은 부르는 쪽(`setState`)의 몫이 아니라
 * 여기서 매 프레임 `setState` 를 부르지 않기 때문입니다 — 포인터를 놓을 때까지 값만 계산하고
 * 상태는 그때그때 한 번씩 갱신합니다(React 배치가 알아서 묶습니다).
 */
export function PlannerMoveTimeline({
  state,
  setState,
  duration,
  playhead,
  onSeek,
  onMotionMenu,
  selectedId,
  setSelectedId,
  selectedTargetId,
  targetNames,
  layerTargets,
  onSelectTarget,
  activeBone,
  onSelectBone,
  playing,
  onPlay,
  playheadLineRef,
  anchorGizmo,
  onAnchorGizmo,
  selectedMove,
  anchorOf,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  /** 마스터 타임라인 길이(초). 눈금과 막대 자리가 이 값을 기준으로 그려집니다. */
  duration: number;
  playhead: number;
  onSeek: (time: number) => void;
  /**
   * 인물 줄에서 **오른쪽 단추**를 눌렀을 때. 안 주면 메뉴가 안 뜹니다.
   *
   * 메뉴 자체는 **구도잡기 창**이 띄웁니다 — 분석 줄 목록과 모캡 창을 그쪽이 들고 있어서,
   * 타임라인이 그것을 알면 두 화면이 서로를 끌어안게 됩니다.
   */
  onMotionMenu?: (menu: {
    targetId: string;
    targetName: string;
    sourceId?: string;
    sourceName?: string;
    x: number;
    y: number;
  }) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** 배치 탭에서 고른 인물·소품의 **순수 id**(갈래 접두 없이). 빈 문자열이면 안 고름. */
  selectedTargetId?: string;
  /** 대상 이름을 보여 주기 위한 표. id → 이름. */
  targetNames?: Record<string, string>;
  /**
   * 레이어 막대로 세울 대상 — 구도에 선 인물과 소품. 색은 3D 인형의 **식별 색**입니다.
   * 막대 색이 인형 색과 같아야 «노란 막대 = 노란 인형(올삐)» 이 바로 읽힙니다.
   */
  layerTargets?: { id: string; name: string; color: string; kind: "character" | "object" }[];
  /** 막대를 누르면 3D 에서도 그 대상을 고릅니다(배치 탭을 오가지 않게). */
  onSelectTarget?: (target: { id: string; kind: "character" | "object" }) => void;
  /** 지금 잡은 관절 — 관절 줄에서 그 줄을 밝게 보여 줍니다. */
  activeBone?: string | null;
  /** 관절 줄을 누르면 그 인물의 그 관절을 잡습니다(3D 기즈모 + 오른쪽 관절 수치). */
  onSelectBone?: (targetId: string, bone: string) => void;
  playing: boolean;
  onPlay: (next: boolean) => void;
  /** 재생 중에 빨간 세로선을 직접 옮기는 자리. `usePlannerPlayback` 이 씁니다. */
  playheadLineRef?: React.RefObject<HTMLDivElement | null>;
  /** 앵커를 3D 에서 끌 수 있게 하는 기즈모. 카메라 탭을 오가지 않게 여기서도 켭니다. */
  anchorGizmo: boolean;
  onAnchorGizmo: (next: boolean) => void;
  /** 지금 고른 클립 — 앵커를 여기에 걸어 줍니다. */
  selectedMove: CameraMove | null;
  /**
   * 대상 id 와 **키 비율**(0=발밑, 1=정수리)로 앵커 자리를 구합니다.
   * 3D 를 아는 쪽이 넘겨 줍니다 — 여기서는 인물 키를 모릅니다.
   */
  anchorOf: (
    targetId: string,
    ratio: number,
  ) => { x: number; y: number; z: number } | null;
}) {
  const t = useT();
  const moves = sortedMoves(cameraMovesOf(state));
  /** 저장해 둔 카메라 — 클립마다 «어디서 출발할지» 를 고르는 목록입니다. */
  const shots = cameraShotsOf(state);
  /** 고른 클립의 프리셋. 이동량 단위와 «자유 무빙인가» 를 여기서 봅니다. */
  const selectedPreset = selectedMove
    ? SHOT_PRESETS.find((item) => item.id === selectedMove.shotId)
    : undefined;
  /**
   * 고른 클립이 **실제로 쓰는 앵커**가 제 것인지 남의 것인지.
   *
   * 남의 것을 쓰는 중이면 손잡이를 켠 색으로 보여 줍니다 — 앵커 단추를 눌러도 안 먹는
   * 것처럼 보이는 때가 바로 이 경우라, 눈에 보여야 「왜 안 바뀌지」 가 안 생깁니다.
   */
  const anchorSourceLabel = (() => {
    if (!selectedMove) return { on: false, name: "" };
    if (selectedMove.anchorFromId) {
      const from = resolveAnchorSource(selectedMove, moves);
      return {
        on: true,
        name:
          SHOT_PRESETS.find((item) => item.id === from.shotId)?.label ??
          "다른 클립",
      };
    }
    if (lockAnchorsOf(state) && moves[0] && moves[0].id !== selectedMove.id)
      return { on: true, name: "첫 클립" };
    return { on: false, name: "" };
  })();

  /*
    ── A 키 — 따라갈 앵커 레이어 넘기기 ─────────────────────────────────
     목록을 열어 고르는 것보다 눌러서 넘기는 쪽이 빠릅니다 —
    클립이 둘셋이라 한두 번이면 원하는 것에 닿습니다.

    차례는 목록과 같습니다: 내 것 → 전부 첫 클립 → 다른 클립들 → 다시 내 것.
  */
  useEffect(() => {
    if (!selectedMove) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code !== "KeyA" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      const others = moves.filter((item) => item.id !== selectedMove.id);
      const cycle = ["own", "lock", ...others.map((item) => `move:${item.id}`)];
      const now = selectedMove.anchorFromId
        ? `move:${selectedMove.anchorFromId}`
        : lockAnchorsOf(state)
          ? "lock"
          : "own";
      const next = cycle[(Math.max(0, cycle.indexOf(now)) + 1) % cycle.length];
      setState((current) => {
        const cleared = patchCameraMoveIn(current, selectedMove.id, {
          anchorFromId: next.startsWith("move:") ? next.slice(5) : undefined,
        });
        return setLockAnchorsIn(cleared, next === "lock");
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedMove, moves, state, setState]);
  const trackRef = useRef<HTMLDivElement>(null);
  /*
    접힘 상태는 **이 컴퓨터에 기억**합니다. 컷을 옮겨 다닐 때마다 다시 펴지면 접는 뜻이
    없습니다. 저장 공간이 막혀도 동작은 해야 해서 읽기·쓰기를 감쌉니다.
  */
  const [collapsed, setCollapsedRaw] = useState(() => {
    try {
      return window.localStorage.getItem("frameforge.timelineCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const rememberCollapsed = (next: boolean) => {
    setCollapsedRaw(next);
    try {
      window.localStorage.setItem("frameforge.timelineCollapsed", next ? "1" : "0");
    } catch {
      /* 기억만 못 할 뿐입니다. */
    }
  };
  /*
    ── 접고 펼 때 **아래로 스르르** ─────────────────────────────────────────
    

    겉 상자(`shellRef`)의 **높이**와 속 판(`innerRef`)의 **아래로 밀림**을 같은 곡선으로 함께
    움직입니다. 판은 화면 아래에 붙어 있어서, 높이만 줄이면 위 안내 문구가 따라 내려오긴 해도 판이
    아래에서 잘려 나가는 것처럼 보이고, 밀기만 하면 문구가 끝에 가서 한 번에 툭 떨어집니다. 둘을
    같이 해야 «판이 화면 밑으로 내려간다» 로 보입니다. 잘라 내는 `overflow: hidden` 은 움직이는
    동안에만 겁니다 — 늘 걸면 판 위로 걸친 「접기」 단추와 위로 뜨는 속도 그래프가 잘립니다.

    React 상태로 프레임을 돌리지 않고 브라우저 애니메이션(WAAPI)을 씁니다 — 이 판은 레이어가 많아
    한 번 다시 그리는 값이 큽니다(재생선을 ref 로 옮기는 것과 같은 까닭). 움직임 줄이기 설정이면 건너뜁니다.
  */
  const shellRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const collapseMotionRef = useRef<"expand" | "bar" | null>(null);
  const collapsingRef = useRef(false);
  const reducedMotion = () => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };
  const COLLAPSE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const setCollapsed = (next: boolean) => {
    if (collapsingRef.current) return;
    const shell = shellRef.current;
    const inner = innerRef.current;
    if (!next) {
      collapseMotionRef.current = "expand";
      rememberCollapsed(false);
      return;
    }
    if (!shell || !inner || reducedMotion()) {
      rememberCollapsed(true);
      return;
    }
    const height = inner.offsetHeight;
    collapsingRef.current = true;
    shell.style.overflow = "hidden";
    const timing = { duration: 280, easing: COLLAPSE_EASE, fill: "forwards" as const };
    inner.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: `translateY(${height}px)`, opacity: 0.3 },
      ],
      timing,
    );
    shell.animate([{ height: `${height}px` }, { height: "0px" }], timing);
    /*
      끝났을 때 상태를 바꾸는 일은 `onfinish` 가 아니라 **타이머**가 맡습니다. 창이 가려지거나
      탭이 멈추면 애니메이션 시계가 서서 `onfinish` 가 안 올 수 있는데, 그러면 판이 높이 0 에 멈춘
      채 영영 접히지도 펴지지도 않습니다(헤드리스 확인에서 실제로 그렇게 멈췄습니다).
    */
    window.setTimeout(() => {
      collapsingRef.current = false;
      collapseMotionRef.current = "bar";
      rememberCollapsed(true);
    }, timing.duration + 20);
  };
  /** 단축키 쪽 이펙트는 한 번만 붙으므로 늘 최신 함수·값을 ref 로 봅니다. */
  const toggleCollapsedRef = useRef(() => {});
  toggleCollapsedRef.current = () => setCollapsed(!collapsed);
  useLayoutEffect(() => {
    const mode = collapseMotionRef.current;
    collapseMotionRef.current = null;
    const shell = shellRef.current;
    const inner = innerRef.current;
    if (!mode || !shell || !inner) return;
    // 접힐 때 «끝 자리에 멈춰 둔» 애니메이션을 풀어야 새 내용이 제 높이로 섭니다.
    shell.getAnimations().forEach((item) => item.cancel());
    inner.getAnimations().forEach((item) => item.cancel());
    shell.style.overflow = "";
    if (reducedMotion()) return;
    if (mode === "bar") {
      inner.animate(
        [
          { transform: "translateY(10px)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 180, easing: COLLAPSE_EASE },
      );
      return;
    }
    const height = inner.offsetHeight;
    shell.style.overflow = "hidden";
    const timing = { duration: 320, easing: COLLAPSE_EASE };
    inner.animate(
      [
        { transform: `translateY(${height}px)`, opacity: 0.3 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      timing,
    );
    shell.animate([{ height: "0px" }, { height: `${height}px` }], timing);
    // 잘라 내기는 타이머로 풉니다 — 까닭은 접을 때와 같습니다(`onfinish` 가 안 올 수 있음).
    window.setTimeout(() => {
      shell.style.overflow = "";
    }, timing.duration + 20);
  }, [collapsed]);
  /*
    Ctrl+Space 로 열고 닫기. 스페이스 하나는 재생이라(구도잡기 창) Ctrl 이 붙었을 때만 받습니다 —
    재생 단축키 쪽이 이미 Ctrl 을 걸러 둬서 둘이 동시에 먹지 않습니다.
    글자를 치는 중에는 안 받습니다.
  */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      toggleCollapsedRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /**
   * 지금 펼친 **속도 그래프**. null 이면 아무것도 안 폈습니다.
   *
   * 카메라 클립과 인물·소품 트랙이 **한 자리**를 나눠 씁니다(). 둘을 따로 두면 화면에
   * 그래프가 둘 뜨고, 안 그래도 좁은 세로가 더 좁아집니다.
   *
   * # 왜 «떠 있는 판» 인가
   *
   * 처음에는 타임라인 안에 그대로 끼워 넣었습니다. 그랬더니 그래프 높이만큼 타임라인이
   * 자라 **구도잡기 머리말까지 밀고 올라가 겹쳤습니다**(). 타임라인은 화면 아래에 떠 있는 판이라 자랄 자리가 없습니다.
   * 그래서 그래프는 타임라인 **위에 겹쳐** 띄웁니다 — 3D 화면을 잠깐 가릴 뿐 배치는
   * 한 픽셀도 안 움직입니다.
   */
  /**
   * 값을 손으로 고치는 중인 **자유 경로 키**. null 이면 안 고치는 중.
   *
   * 화면에서 카메라를 옮겨 찍는 쪽이 빠르지만, 「정확히 x=2」 같은 값은 손이 빠릅니다.
   */
  const [freeKey, setFreeKey] = useState<{
    moveId: string;
    keyId: string;
  } | null>(null);
  const [graphPanel, setGraphPanel] = useState<
    | { kind: "move"; id: string }
    | { kind: "track"; targetId: string; channel: string }
    | null
  >(null);

  /**
   * 고른 키. Delete 로 지웁니다.
   *
   * 예전에는 **누르면 곧바로 지워졌습니다** — 옮기려고 누른 것까지 사라졌습니다.
   * 이제 누르면 고르고, 끌면 옮기고, Delete 로 지웁니다.
   */
  /**
   * **고무줄로 잡아 둔 키들** — 그 시간대의 것을 **전부**.
   *
   * 처음에는 «한 사람의 한 채널» 로 좁혔는데 맞습니다. 한 사람의 이동·회전·자세는 **같은 순간의 한 동작**
   * 이라, 채널마다 따로 옮기면 팔만 먼저 가는 춤이 됩니다. 사람이 여럿이어도 마찬가지고요
   * (댄스 배틀은 둘을 함께 밀어야 합니다).
   */
  const [keyBand, setKeyBand] = useState<string[]>([]);
  /** 지금 끌고 있는 고무줄(초). 화면에만 씁니다. */
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);

  const [pickedKey, setPickedKey] = useState<
    | { kind: "motion"; targetId: string; keyId: string }
    /** 자세 줄을 펼친 **관절 줄**의 점 — 자세 키 하나 안의 한 관절. */
    | { kind: "joint"; targetId: string; keyId: string; bone: string }
    | { kind: "camera"; moveId: string; keyId: string }
    | { kind: "amount"; moveId: string; keyId: string }
    | { kind: "occlude"; trackId: string; keyId: string }
    | null
  >(null);

  // 떠 있는 그래프가 그릴 곡선과 저장 자리(`lib/timelineGraphCurve.ts`) — 순수 계산입니다.
  const graphCurve = graphCurveOf({ graphPanel, pickedKey, state, moves, targetNames, setState });

  /** 무빙 전체가 출발하는 구도 — 활성 구도, 없으면 첫 구도. */
  const baseShot =
    shots.find((item) => item.id === state.activeShotId) ?? shots[0] ?? null;

  /** 고른 이동량 키의 알맹이 — 손잡이 줄에서 값을 바로 고치려고 풉니다. */
  const pickedAmountKey = (() => {
    if (pickedKey?.kind !== "amount") return null;
    const move = moves.find((item) => item.id === pickedKey.moveId);
    const key = move?.amountKeys?.find((item) => item.id === pickedKey.keyId);
    return move && key ? { move, key } : null;
  })();

  /** 값을 고치는 중인 자유 키의 실제 알맹이. 클립이나 키가 사라졌으면 null. */
  const freeKeyEdit = (() => {
    if (!freeKey) return null;
    const move = moves.find((item) => item.id === freeKey.moveId);
    const key = move?.keys?.find((item) => item.id === freeKey.keyId);
    return move && key ? { move, key } : null;
  })();

  useEffect(() => {
    if (!pickedKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setState((current) =>
        pickedKey.kind === "motion"
          ? motionTracksOf(current).some(
              (track) =>
                track.channel === "pose" &&
                track.targetId === pickedKey.targetId &&
                track.keys.some((key) => key.id === pickedKey.keyId),
            )
            ? removePoseKeyGroupIn(current, pickedKey.targetId, pickedKey.keyId)
            : removeMotionKeyIn(current, pickedKey.targetId, pickedKey.keyId)
          : pickedKey.kind === "joint"
            ? removePoseJointKeyIn(current, pickedKey.targetId, pickedKey.keyId, pickedKey.bone)
            : pickedKey.kind === "occlude"
            ? removeOccludeKeyIn(current, pickedKey.trackId, pickedKey.keyId)
            : pickedKey.kind === "amount"
              ? removeAmountKeyIn(current, pickedKey.moveId, pickedKey.keyId)
              : removeCameraKeyIn(current, pickedKey.moveId, pickedKey.keyId),
      );
      setPickedKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedKey, setState]);

  /*
    고른 **클립**도 Delete 로 지웁니다.  키를 고른 상태면 키가 먼저입니다 — 방금 만진 것을
    지우는 쪽이 덜 놀랍습니다.
  */
  useEffect(() => {
    if (pickedKey || !selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setState((current) => removeCameraMoveIn(current, selectedId));
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedKey, selectedId, setState, setSelectedId]);

  /** 키를 끌어 시각을 옮깁니다. `toTime` 이 포인터 x 를 그 키의 시간으로 바꿉니다. */
  /**
   * 빈 자리에서 끌면 **고무줄**로 그 구간의 키를 한꺼번에 잡습니다.
   *
   * 키 위에서 누르면 키가 먼저 받습니다(`dragKey` 가 `stopPropagation`). 그래서 이 손잡이는
   * «키가 없는 자리» 에서만 시작합니다 — 애프터이펙트와 같은 느낌입니다.
   *
   * 짧게 톡 누르면(0.02초 미만) **풀기**입니다. 잡아 둔 것을 지우는 길이 따로 없으면
   * 한 번 잡은 뒤로는 계속 딸려 다닙니다.
   */
  const dragBand =
    (_keys: readonly { id: string; time: number }[]) => (event: React.PointerEvent) => {
      event.preventDefault();
      const from = timeAt(event.clientX);
      setBand({ from, to: from });
      const move = (pointer: PointerEvent) =>
        setBand((now) => (now ? { ...now, to: timeAt(pointer.clientX) } : now));
      const up = (pointer: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setBand(null);
        const to = timeAt(pointer.clientX);
        const low = Math.min(from, to);
        const high = Math.max(from, to);
        if (high - low < 0.02) {
          setKeyBand([]);
          return;
        }
        /*
          **모든 인물·모든 채널**에서 그 구간의 키를 잡습니다. 어느 줄에서 끌었든 같습니다 —
          한 동작은 이동·회전·자세가 함께 움직여야 하고, 둘이 함께 추는 춤은 둘을 함께
          밀어야 합니다.
        */
        const caught = motionTracksOf(state).flatMap((track) =>
          track.keys.filter((key) => key.time >= low && key.time <= high).map((key) => key.id),
        );
        setKeyBand(caught);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  /** 이 키가 고무줄에 잡혀 있나. */
  const inBand = (keyId: string) => keyBand.includes(keyId);

  const dragKey =
    (
      pick: NonNullable<typeof pickedKey>,
      toTime: (clientX: number) => number,
    ) =>
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setPickedKey(pick);
      /*
        ── 고르면 **바로** 값이 열립니다 ─────────────────────────────────
        

        두 번 누르기는 «숨은 기능» 이라 처음 보면 찾을 수가 없고, 키가 작아 두 번을
        같은 자리에 맞추기도 어렵습니다. 한 번 누르면 고르고 값 판이 열립니다 —
        끌기는 그대로 되고(누른 채 움직이면 옮겨집니다), 판은 값만 보여 줍니다.
      */
      if (pick.kind === "camera")
        setFreeKey({ moveId: pick.moveId, keyId: pick.keyId });
      /*
        **무리째 끌기.** 잡아 둔 무리 안의 키를 잡으면 그 무리가 통째로 따라옵니다
        ().
        기준은 «처음 잡은 자리에서 얼마나 움직였나» 입니다 — 키의 새 시각을 각자 계산하면
        사이 간격이 틀어져 춤이 아니게 됩니다.
      */
      const bandMove =
        pick.kind === "motion" && keyBand.includes(pick.keyId)
          ? { keyIds: keyBand, from: toTime(event.clientX) }
          : null;
      let shifted = 0;

      const step = (pointer: PointerEvent) => {
        const at = toTime(pointer.clientX);
        if (bandMove) {
          // 이미 옮긴 만큼을 빼서 **늘어난 차이만** 더합니다(누적되지 않게).
          const delta = at - bandMove.from - shifted;
          if (Math.abs(delta) < 0.05) return;
          shifted += delta;
          setState((current) => shiftMotionKeysIn(current, bandMove.keyIds, delta));
          return;
        }
        setState((current) =>
          pick.kind === "motion"
            ? moveMotionKeyIn(current, pick.targetId, pick.keyId, at)
            : pick.kind === "joint"
              ? current // 관절 점은 `dragJoint` 가 손을 뗄 때 한 번에 옮깁니다.
              : pick.kind === "occlude"
              ? moveOccludeKeyIn(current, pick.trackId, pick.keyId, at)
              : pick.kind === "amount"
                ? moveAmountKeyIn(current, pick.moveId, pick.keyId, at)
                : moveCameraKeyIn(current, pick.moveId, pick.keyId, at),
        );
      };
      const up = () => {
        window.removeEventListener("pointermove", step);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", step);
      window.addEventListener("pointerup", up);
    };
  /**
   * 관절 점을 끄는 중인 자리. 끄는 동안은 **그림자만** 옮기고 손을 뗄 때 한 번에 옮깁니다.
   *
   * 관절 점을 옮기면 도착한 시각에 새 자세 키가 생길 수 있어 키 이름표가 바뀝니다. 끄는 중에
   * 매번 상태를 고치면 잡고 있던 점이 사라져(이름표가 달라져) 두 번째 움직임부터 허공을 끕니다.
   * 되돌리기에도 끈 거리만큼 수십 칸이 쌓입니다.
   */
  const [jointGhost, setJointGhost] = useState<{ keyId: string; bone: string; time: number } | null>(null);
  /**
   * 접힌 자세 줄의 점 끌기 — 관절 점과 같은 까닭으로 그림자만 옮기다 손을 뗄 때 한 번에.
   * `bone` 자리에 빈 문자열을 씁니다(«그 자리의 관절 전부»).
   */
  const dragPoseSummary =
    (targetId: string, key: { id: string; time: number }) =>
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setPickedKey({ kind: "motion", targetId, keyId: key.id });
      const startX = event.clientX;
      let moved = false;
      let at = key.time;
      const step = (pointer: PointerEvent) => {
        if (Math.abs(pointer.clientX - startX) > 3) moved = true;
        if (!moved) return;
        at = Math.min(span, Math.max(0, Math.round(timeAt(pointer.clientX) * 20) / 20));
        setJointGhost({ keyId: key.id, bone: "", time: at });
      };
      const up = () => {
        window.removeEventListener("pointermove", step);
        window.removeEventListener("pointerup", up);
        setJointGhost(null);
        if (!moved) return;
        setState((current) => movePoseKeyGroupIn(current, targetId, key.id, at));
        setPickedKey(null);
      };
      window.addEventListener("pointermove", step);
      window.addEventListener("pointerup", up);
    };
  const dragJoint =
    (targetId: string, bone: string, key: { id: string; time: number }) =>
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setPickedKey({ kind: "joint", targetId, keyId: key.id, bone });
      const startX = event.clientX;
      let moved = false;
      let at = key.time;
      const step = (pointer: PointerEvent) => {
        if (Math.abs(pointer.clientX - startX) > 3) moved = true;
        if (!moved) return;
        at = Math.min(span, Math.max(0, Math.round(timeAt(pointer.clientX) * 20) / 20));
        setJointGhost({ keyId: key.id, bone, time: at });
      };
      const up = () => {
        window.removeEventListener("pointermove", step);
        window.removeEventListener("pointerup", up);
        setJointGhost(null);
        if (moved) {
          setState((current) => movePoseJointKeyIn(current, targetId, key.id, bone, at));
          setPickedKey(null);
          return;
        }
        /*
          누르기만 했으면 **그 시각으로 가서 그 관절을 잡습니다.** 「확인하고 자세 수정」 이
          바로 되게 — 그 자리에서 기즈모로 돌리면 자동 키가 이 자세 키에 그대로 들어갑니다.
        */
        onSeek(key.time);
        onSelectBone?.(targetId, bone);
      };
      window.addEventListener("pointermove", step);
      window.addEventListener("pointerup", up);
    };
  /** 펼친 자세 줄 — 인물 id. 기본은 닫힘(관절이 서른 개 넘게 늘어설 수 있어서). */
  const [openPose, setOpenPose] = useState<Set<string>>(() => new Set());

  const span = Math.max(0.5, duration);

  /**
   * 판을 옆으로 얼마나 늘려 볼까(1 = 화면에 딱 맞게).
   *
   * 애프터이펙트처럼 `+`·`-` 로 오갑니다. 16배까지 두는 까닭: 20초를 30 fps 로 넣으면
   * 키가 600개라, 1,200px 판에서는 키 사이가 2px 입니다. 16배면 32px 이 되어 집을 수 있습니다.
   */
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 글자를 적는 중에는 손대지 않습니다 — 이름 칸에 «+» 를 치는 일이 흔합니다.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      )
        return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((now) => Math.min(16, Math.round(now * 2 * 100) / 100));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((now) => Math.max(1, Math.round((now / 2) * 100) / 100));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * 초 → 트랙 안의 비율. **1 을 넘을 수 있습니다.**
   *
   * 키는 **지워지지 않았습니다.** 여기서 1 로 잘라 버려서, 끝을 넘은 키가 전부 오른쪽 끝에
   * 겹쳐 쌓인 것입니다 — 스무 개가 한 점으로 보이니 «빠졌다» 로 읽힙니다.
   * 이제 자르지 않고, 줄마다 넘치는 것을 **가립니다**(`overflow-hidden`).
   * 러닝타임을 다시 늘리면 그 자리에 그대로 돌아옵니다.
   */
  const ratioOf = (seconds: number) => Math.max(0, seconds / span);
  /** 러닝타임 뒤에 남아 있는 키의 수 — 가려졌을 뿐 지워지지 않았습니다. */
  const beyond = motionTracksOf(state).reduce(
    (total, track) => total + track.keys.filter((key) => key.time > span + 1e-6).length,
    0,
  );
  /** 타임라인에 깔린 노래. 없으면 줄을 안 그립니다. */
  const music = musicOf(state);

  /** 포인터 x → 초. 트랙 폭을 매번 다시 재는 까닭: 패널 접기·창 크기로 폭이 바뀝니다. */
  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return ((clientX - rect.left) / rect.width) * span;
  };

  const dragClip =
    (move: CameraMove, mode: "move" | "resize") =>
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(move.id);
      const grabbed = timeAt(event.clientX);
      const startTime = move.startTime;
      const startDuration = move.duration;
      const step = (pointer: PointerEvent) => {
        const delta = timeAt(pointer.clientX) - grabbed;
        // 0.05초 눈금에 붙입니다. 프레임 단위로 재는 값이 아니라 «몇 초짜리 무빙» 이라서요.
        const snap = (value: number) => Math.round(value * 20) / 20;
        if (mode === "move") {
          const next = snap(Math.max(0, startTime + delta));
          setState((current) =>
            patchCameraMoveIn(current, move.id, { startTime: next }),
          );
        } else {
          const next = snap(Math.max(0.1, startDuration + delta));
          setState((current) =>
            patchCameraMoveIn(current, move.id, { duration: next }),
          );
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", step);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", step);
      window.addEventListener("pointerup", up);
    };

  /*
    레이어 키 줄을 사람이 여닫은 기록. 기본(키가 있거나 고른 대상이면 폄)을 **덮어쓸 때만**
    적습니다 — 한 표로 두면 «기본으로 펴진 줄» 을 접었다가 다른 사람을 고를 때 되살아납니다.
  */
  const [openLayers, setOpenLayers] = useState<Set<string>>(() => new Set());
  const [closedLayers, setClosedLayers] = useState<Set<string>>(() => new Set());
  const toggleLayerOpen = (id: string, isOpen: boolean) => {
    const without = (set: Set<string>) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    };
    const withId = (set: Set<string>) => new Set(set).add(id);
    if (isOpen) {
      setOpenLayers(without);
      setClosedLayers(withId);
    } else {
      setClosedLayers(without);
      setOpenLayers(withId);
    }
  };

  /**
   * 레이어 막대를 끕니다 — 몸통은 통째로 옮기고, 양 끝은 들어오고 나가는 시각.
   *
   * 누르는 순간 3D 에서도 그 대상을 고릅니다. 막대를 만지는 사람은 곧 그 인물의 키를 찍거나
   * 자리를 옮기려는 것이라, 배치 탭으로 가서 다시 고르게 하면 손이 끊깁니다.
   */
  const dragLayer =
    (
      target: { id: string; kind: "character" | "object" },
      span: { start: number; end: number },
      mode: "move" | "start" | "end",
    ) =>
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectTarget?.(target);
      const grabbed = timeAt(event.clientX);
      const length = span.end - span.start;
      const step = (pointer: PointerEvent) => {
        const delta = timeAt(pointer.clientX) - grabbed;
        setState((current) => {
          if (mode === "start")
            return setLayerSpanIn(current, target.id, { start: span.start + delta });
          if (mode === "end")
            return setLayerSpanIn(current, target.id, { end: span.end + delta });
          // 통째로 옮길 때는 길이를 지킵니다 — 끝에 부딪히면 거기서 멈춥니다.
          const start = Math.min(Math.max(0, span.start + delta), Math.max(0, duration - length));
          return setLayerSpanIn(current, target.id, { start, end: start + length });
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", step);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", step);
      window.addEventListener("pointerup", up);
    };

  /**
   * 화면에 있는 **모든 키의 시각**(오름차순, 중복 제거).
   * 트랙 키와 자유 경로 키를 함께 봅니다 — 「다음 키」 는 무엇의 키든 다음이어야 합니다.
   */
  const allKeyTimes = Array.from(
    new Set([
      ...motionTracksOf(state).flatMap((track) =>
        track.keys.map((key) => Math.round(key.time * 1000) / 1000),
      ),
      // 막대의 시작·끝도 «키» 로 칩니다 — 「다음 키로」 로 올삐가 들어오는 순간에 닿게.
      ...layersOf(state).flatMap((layer) =>
        [layer.start, layer.end ?? duration].map((time) => Math.round(time * 1000) / 1000),
      ),
      ...occludeTracksOf(state).flatMap((track) =>
        track.keys.map((key) => Math.round(key.time * 1000) / 1000),
      ),
      ...moves.flatMap((move) =>
        (move.keys ?? []).map(
          (key) => Math.round((move.startTime + key.time) * 1000) / 1000,
        ),
      ),
    ]),
  ).sort((a, b) => a - b);

  /** 눈금 한 칸(초). 길이에 따라 1·2·5초로 벌려 글자가 겹치지 않게 합니다. */
  const tickStep = span <= 6 ? 1 : span <= 15 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= span + 1e-6; t += tickStep) ticks.push(t);

  /*
    ── 접힌 타임라인 ──────────────────────────────────────────────────────
    

    인물·방 레이어가 붙으면서 판이 3D 화면의 절반을 덮게 됐습니다. 접어도 **재생 단추와
    시각은 남깁니다** — 구도를 보면서 돌려 보는 것이 접는 이유라, 재생까지 숨기면 다시 펴야
    합니다.
  */
  /*
    접힘·펼침 두 갈래가 **같은 겉·속 상자** 안에 섭니다. 상자 모양이 같아야 React 가 그 DOM 을
    그대로 두어, 접히며 걸어 둔 애니메이션을 다음 모습에서 이어 풀 수 있습니다.
  */
  const shell = (body: React.ReactNode) => (
    <div ref={shellRef}>
      <div ref={innerRef}>{body}</div>
    </div>
  );

  if (collapsed) {
    return shell(
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-lg px-2 py-1"
        style={{
          background: "oklch(0.09 0.006 265 / 96%)",
          border: "1px solid oklch(1 0 0 / 12%)",
        }}
      >
        <span className="text-[10px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
          {t("타임라인")}
        </span>
        <button
          type="button"
          onClick={() => onPlay(!playing)}
          data-tour="bottom-play"
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: "oklch(0.70 0.15 160 / 16%)", color: "oklch(0.84 0.15 160)" }}
          title={t("재생 · 멈춤 (스페이스)")}
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? t("멈춤") : t("재생")}
        </button>
        <span className="text-[10px] tabular-nums" style={{ color: "oklch(0.62 0.12 200)" }}>
          {playhead.toFixed(2)}s / {duration.toFixed(1)}s
        </span>
        <span className="min-w-0 flex-1" />
        {/*
          접혀 있으면 아래 자리들이 **아예 안 그려집니다** — 튜토리얼이 찾을 길이 없습니다.
          그래서 여는 단추가 «내가 열면 이것들이 생긴다» 고 적어 둡니다(TutorialOverlay 가 읽어
          한 번 누릅니다). 
        */}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          data-tour-switch="bottom-timeline bottom-collapse bottom-duration bottom-fps bottom-shot-presets bottom-clip-start bottom-anchor bottom-clip-amount bottom-clip-length bottom-axis bottom-easing bottom-layers bottom-room-rows"
          data-tour-switch-kind="expand"
          aria-expanded={false}
          title={t("타임라인 펴기 (Ctrl+Space)")}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.78 0.01 265)" }}
        >
          <ChevronsUp className="h-3 w-3" /> {t("펴기")}
          <span style={{ color: "oklch(0.48 0.01 265)" }}>Ctrl+Space</span>
        </button>
      </div>,
    );
  }

  return shell(
    <TimelineResizePane
      /*
        재생 중에 타임라인 **어디를 눌러도** 멈춥니다. 
        눈금자를 눌러 옮기거나 키를 잡는 것은 «여기서 고치겠다» 는 뜻인데, 재생이 계속 머리를
        밀어 가면 누른 자리를 곧바로 떠납니다. 캡처 단계에서 받아 막대·키 끌기보다 먼저 멈춥니다.
        재생 단추는 스스로 멈춤을 하므로 여기서 한 번 더 멈춰도 같은 결과입니다.
      */
      onPointerDownCapture={() => {
        if (playing) onPlay(false);
      }}
      data-tour="bottom-timeline"
      className="pointer-events-auto relative rounded-lg p-2"
      style={{
        /*
          거의 불투명하게. 78% 로 두었더니 3D 화면의 «60 fps» 글씨가 단추 사이로
          비쳐 글자가 겹쳐 보였습니다().
        */
        background: "oklch(0.09 0.006 265 / 96%)",
        border: "1px solid oklch(1 0 0 / 12%)",
      }}
    >
      {/* 접기 — 판 오른쪽 위 모서리. 머리줄 단추들과 안 겹치게 판 바깥 위로 살짝 걸칩니다. */}
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        data-tour="bottom-collapse"
        title={t("타임라인을 아래로 접기 (Ctrl+Space) — 재생 단추는 남습니다")}
        className="absolute -top-3 right-3 z-20 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-semibold"
        style={{
          background: "oklch(0.13 0.01 265)",
          border: "1px solid oklch(1 0 0 / 14%)",
          color: "oklch(0.78 0.01 265)",
        }}
      >
        <ChevronsDown className="h-3 w-3" /> {t("접기")}
        <span style={{ color: "oklch(0.48 0.01 265)" }}>Ctrl+Space</span>
      </button>

      {/*
        ── 자유 경로 키의 값 ────────────────────────────────────────────
        

        «회전» 은 각도가 아니라 **바라보는 점**으로 적습니다. 카메라를 각도로 적으면
        같은 그림을 만드는 각이 여럿이라(짐벌) 손으로 맞추기가 아주 어렵습니다. 「어디를
        보는가」 는 3D 화면의 그 점과 그대로 맞아떨어집니다 — 인물 발밑이 (0,0,0) 이면
        그 값을 적으면 됩니다.

        그래프와 같은 자리에 **떠 있는 판**으로 띄웁니다(타임라인이 자라지 않게).
      */}
      {freeKeyEdit && (
        <div
          data-tour="bottom-free-key"
          className="absolute bottom-full left-0 z-30 mb-2 rounded-lg p-2"
          style={{
            width: 232,
            background: "oklch(0.13 0.01 265 / 97%)",
            border: "1px solid oklch(0.72 0.16 90 / 40%)",
            boxShadow: "0 18px 48px oklch(0 0 0 / 65%)",
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span
              className="truncate text-[9px] font-semibold"
              style={{ color: "oklch(0.90 0.14 90)" }}
            >
              자유 경로 · {freeKeyEdit.key.time.toFixed(2)}초 키
            </span>
            <button
              type="button"
              onClick={() => setFreeKey(null)}
              title={t("닫기")}
              className="shrink-0 rounded p-0.5"
              style={{ color: "oklch(0.60 0.01 265)" }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {[
            { group: "position" as const, label: "카메라 자리(m)" },
            { group: "target" as const, label: "바라보는 곳(m)" },
          ].map((row) => (
            <div key={row.group} className="mb-1.5">
              <span
                className="block text-[9px]"
                style={{ color: "oklch(0.52 0.01 265)" }}
              >
                {row.label}
              </span>
              <div className="mt-0.5 grid grid-cols-3 gap-1">
                {(["x", "y", "z"] as const).map((axis) => (
                  <NumberInput
                    key={axis}
                    value={
                      Math.round(freeKeyEdit.key.pose[row.group][axis] * 100) /
                      100
                    }
                    step={0.1}
                    onChange={(next) =>
                      setState((current) =>
                        patchCameraKeyIn(
                          current,
                          freeKeyEdit.move.id,
                          freeKeyEdit.key.id,
                          {
                            [row.group]: {
                              ...freeKeyEdit.key.pose[row.group],
                              [axis]: next,
                            },
                          } as Partial<typeof freeKeyEdit.key.pose>,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          <span
            className="block text-[9px]"
            style={{ color: "oklch(0.52 0.01 265)" }}
          >
            줌(배율) — 2면 두 배로 당깁니다
          </span>
          <div className="mt-0.5 w-20">
            <NumberInput
              value={Math.round(freeKeyEdit.key.pose.fovScale * 100) / 100}
              step={0.1}
              min={0.1}
              onChange={(next) =>
                setState((current) =>
                  patchCameraKeyIn(
                    current,
                    freeKeyEdit.move.id,
                    freeKeyEdit.key.id,
                    { fovScale: Math.max(0.1, next) },
                  ),
                )
              }
            />
          </div>
          <p
            className="mt-1.5 text-[9px] leading-relaxed"
            style={{ color: "oklch(0.48 0.01 265)" }}
          >
            이 클립을 고른 채{" "}
            <b>재생 머리를 옮기고 3D 에서 카메라를 움직이면</b> 그 자리가
            자동으로 키가 됩니다. 여기는 그 값을 정확히 고치는 자리입니다.
          </p>
        </div>
      )}

      {/*
        ── 떠 있는 속도 그래프 ──────────────────────────────────────────
        타임라인 **위에 겹쳐** 띄웁니다. 안에 끼워 넣으면 그래프 높이만큼 판이 자라
        구도잡기 머리말까지 밀고 올라갑니다().
        폭을 못 박아 두는 까닭도 같습니다 — `w-full` 이면 타임라인 폭만큼 벌어져
        화면을 통째로 덮었습니다.
      */}
      {graphCurve && (
        <div
          className="absolute bottom-full left-0 z-30 mb-2 rounded-lg p-2"
          style={{
            width: 232,
            background: "oklch(0.13 0.01 265 / 97%)",
            border: "1px solid oklch(0.62 0.22 290 / 40%)",
            boxShadow: "0 18px 48px oklch(0 0 0 / 65%)",
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span
              className="truncate text-[9px] font-semibold"
              style={{ color: "oklch(0.86 0.16 290)" }}
            >
              {graphCurve.title}
            </span>
            <button
              type="button"
              onClick={() => setGraphPanel(null)}
              title={t("닫기")}
              className="shrink-0 rounded p-0.5"
              style={{ color: "oklch(0.60 0.01 265)" }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {/*
            ── 마지막 키에는 걸 곳이 없습니다 ───────────────────────────
            
            곡선은 «이 키에서 다음 키까지» 라, 마지막 키를 고르고 그래프를 만지면
            아무 일도 안 일어납니다. 그게 화면에 안 보이면 「왜 안 먹지」 가 됩니다.
          */}
          {graphCurve.last && (
            <p
              className="mb-1.5 rounded px-1.5 py-1 text-[9px] leading-relaxed"
              style={{
                background: "oklch(0.66 0.17 60 / 16%)",
                border: "1px solid oklch(0.66 0.17 60 / 34%)",
                color: "oklch(0.86 0.13 60)",
              }}
            >
              <b>마지막 키 — 뒤 구간이 없습니다.</b> 곡선은 «이 키에서 다음
              키까지» 라, 여기를 고쳐도 움직임이 바뀌지 않습니다. 앞 키를
              고르거나 뒤에 키를 하나 더 찍어 주세요.
            </p>
          )}
          <EasingGraphEditor
            curve={graphCurve.curve}
            onChange={graphCurve.onChange}
          />
        </div>
      )}

      <div className="composition-scroll h-full min-h-0 overflow-y-auto overscroll-contain pr-1">
      <CameraPathWarnings state={state} duration={duration} onSeek={onSeek} onSelectMove={setSelectedId} />
      <div className="mb-1 flex items-center gap-2">
        <span
          className="text-[9px] font-semibold"
          style={{ color: "oklch(0.62 0.01 265)" }}
        >
          {t("카메라 무빙 — 앞 클립이 끝난 자세에서 다음이 출발합니다")}
        </span>
        {/*
          ── 무빙이 어디서 출발하는가 ────────────────────────────────────
          

          계산은 맞았지만 **화면에 안 보였습니다.** 어느 구도에서 출발하는지 글자로
          박아 두면, 화면을 돌려 놓고도 「무빙은 카메라 1 에서 시작한다」 를 믿을 수
          있습니다(돌려도 출발점은 안 따라갑니다).
        */}
        {baseShot && (
          <button
            type="button"
            onClick={() => onSeek(0)}
            data-tour="bottom-start-shot"
            title={`무빙은 «${baseShot.name}» 에서 출발합니다 — 화면을 돌려도 출발점은 그대로입니다. 눌러서 0초로`}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{
              background: "oklch(0.55 0.15 200 / 22%)",
              color: "oklch(0.84 0.13 200)",
            }}
          >
            <Crosshair className="h-2.5 w-2.5" />
            출발: {baseShot.name}
          </button>
        )}
        {/*
          재생 단추.  무빙을 고치는 자리와 확인하는 자리가 달라서
          타임라인 탭까지 가야 했습니다.
        */}
        {/*
          ── 키로 건너뛰기 ────────────────────────────────────────────────
          

          손으로 눈금자를 맞추면 0.05초씩 어긋나 **새 키가 생깁니다**. 정확히 그 자리로
          가야 기존 키를 고칠 수 있습니다.
        */}
        <button
          type="button"
          onClick={() => {
            const before = allKeyTimes.filter((t) => t < playhead - 0.001);
            if (before.length) onSeek(before[before.length - 1]);
          }}
          title={t("앞 키프레임으로")}
          className="rounded px-1 py-0.5"
          style={{ color: "oklch(0.66 0.14 90)" }}
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            const after = allKeyTimes.find((t) => t > playhead + 0.001);
            if (after !== undefined) onSeek(after);
          }}
          title={t("다음 키프레임으로")}
          className="rounded px-1 py-0.5"
          style={{ color: "oklch(0.66 0.14 90)" }}
        >
          <ChevronRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onPlay(!playing)}
          data-tour="bottom-play"
          title={playing ? t("멈추기") : t("처음부터 재생")}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
          style={{
            background: playing
              ? "oklch(0.66 0.17 25 / 26%)"
              : "oklch(0.55 0.15 200 / 26%)",
            color: playing ? "oklch(0.84 0.15 25)" : "oklch(0.82 0.13 200)",
          }}
        >
          {playing ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {playing ? t("멈춤") : t("재생")}
        </button>
        <span
          className="tabular-nums text-[9px]"
          style={{ color: "oklch(0.72 0.15 200)" }}
        >
          {playhead.toFixed(2)}s / {span.toFixed(1)}s
        </span>
        {/*
          ── 앵커를 여기서 바로 ──────────────────────────────────────────
          ,
          「앵커 위치를 수동으로 이동할 수도 있지만 캐릭터의 한 부위나 오브젝트에 자동으로
          붙일 수도 있어야 할 것 같아」.

          고른 클립의 회전·달리 중심을 **배치 탭에서 고른 것** 의 가슴 높이로 옮깁니다.
          바닥(y=0)이 아니라 가슴인 까닭: 사람을 중심으로 돌 때 발밑을 축으로 잡으면
          머리가 화면 밖으로 휘둘립니다.
        */}
        {/*
          ── 오른쪽 묶음 ────────────────────────────────────────────────
          

          예전에는 **앵커 묶음에만** `ml-auto` 가 있었습니다. 그래서 클립을 고르면
          둘 다 오른쪽에 붙지만, 클립이 없으면 키 묶음이 왼쪽으로 딸려 와 재생 단추
          옆에 붙었습니다 — 같은 단추가 상황에 따라 다른 자리에 서면 손이 헤맵니다.
          껍데기 하나에 담아 **늘 오른쪽**에 둡니다.
        */}
        <span className="ml-auto flex items-center gap-1">
          {/*
            ── 앵커는 늘 보입니다 ────────────────────────────────────────
            

            예전에는 «고른 대상이 있을 때» 만 줄이 떴습니다. 그런데 앵커는 대상이 없어도
            뜻이 있는 값입니다 — 방 한가운데를 돌거나 빈 자리를 중심으로 달리는 구도가
            그렇습니다. 자리는 늘 손으로 적을 수 있고, 대상을 고르면 그때 «어느 부위에
            붙일지» 와 «따라가기» 가 함께 나타납니다.
          */}
          {selectedMove && (
            <span
              data-tour="bottom-anchor"
              className="flex items-center gap-0.5"
              // 앵커를 안 쓰는 무빙에서는 흐리게 — 만져도 그림이 안 바뀝니다.
              style={{
                opacity: shotUsesAnchor(selectedPreset?.kind) ? 1 : 0.45,
              }}
              title={
                shotUsesAnchor(selectedPreset?.kind)
                  ? "이 무빙은 앵커를 중심으로 움직입니다"
                  : `${selectedPreset?.label ?? "이 무빙"} 은 앵커와 무관합니다 — 제자리 회전·평행 이동·화각이라 기준점을 옮겨도 그림이 그대로입니다`
              }
            >
              <Crosshair
                className="h-3 w-3"
                style={{ color: "oklch(0.72 0.14 90)" }}
              />
              {/* 자리를 직접 — 대상이 없어도 앵커는 있어야 합니다. */}
              {/*
                 공용 `NumberInput` 은 패널용이라 이 줄에서는
                키가 큽니다. 같은 줄에 서는 것들끼리 높이를 맞춥니다.
              */}
              <span className="flex items-center gap-0.5">
                {(["x", "y", "z"] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step={0.1}
                    value={Math.round(selectedMove.anchor[axis] * 100) / 100}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      setState((current) =>
                        patchCameraMoveIn(current, selectedMove.id, {
                          anchor: { ...selectedMove.anchor, [axis]: next },
                          showAnchor: true,
                        }),
                      );
                    }}
                    title={`앵커 ${axis.toUpperCase()}(m)`}
                    className="rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums outline-none"
                    style={{
                      width: 44,
                      background: "oklch(1 0 0 / 7%)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                      color: "oklch(0.86 0.10 90)",
                    }}
                  />
                ))}
              </span>
              {/*
              어느 높이에 붙일지 고릅니다. 
              가슴 하나로 못 박으면 클로즈업마다 축이 엉뚱한 데 섭니다.
            */}
              {selectedTargetId && (
                <span
                  className="mx-0.5 text-[9px]"
                  style={{ color: "oklch(0.56 0.01 265)" }}
                >
                  {targetNames?.[selectedTargetId] ?? "고른 것"} 의
                </span>
              )}
              {selectedTargetId &&
                ANCHOR_SPOTS.map((spot) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => {
                      const anchor = anchorOf(selectedTargetId, spot.ratio);
                      if (!anchor) return;
                      setState((current) =>
                        patchCameraMoveIn(current, selectedMove.id, {
                          anchor,
                          showAnchor: true,
                        }),
                      );
                    }}
                    title={`${spot.label} 높이를 이 무빙의 중심으로 잡습니다`}
                    className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                    style={{
                      background: "oklch(0.72 0.16 90 / 20%)",
                      color: "oklch(0.88 0.14 90)",
                    }}
                  >
                    {spot.label}
                  </button>
                ))}
              {/*
              ── 세 손잡이를 여기로 ────────────────────────────────────────
              

              따라가기·기즈모·잠금은 앵커를 잡는 한 동작의 세 면이라, 앵커 단추 옆이
              제자리입니다.
            */}
              {/* 따라갈 상대가 있어야 뜻이 섭니다 — 대상을 안 고르면 안 보입니다. */}
              {selectedTargetId && (
                <button
                  type="button"
                  onClick={() =>
                    setState((current) =>
                      patchCameraMoveIn(current, selectedMove.id, {
                        anchorTargetId: selectedMove.anchorTargetId
                          ? undefined
                          : selectedTargetId,
                        anchorRatio: selectedMove.anchorRatio ?? 0.73,
                        showAnchor: true,
                      }),
                    )
                  }
                  title={
                    selectedMove.anchorTargetId
                      ? "따라가기를 끕니다 — 앵커가 한자리에 섭니다"
                      : "앵커가 이 대상을 따라다닙니다 — 걸어가는 사람을 돌며 찍을 때"
                  }
                  className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{
                    background: selectedMove.anchorTargetId
                      ? "oklch(0.72 0.16 90 / 42%)"
                      : "oklch(1 0 0 / 7%)",
                    color: selectedMove.anchorTargetId
                      ? "oklch(0.92 0.14 90)"
                      : "oklch(0.60 0.01 265)",
                  }}
                >
                  {t("따라가기")}
                </button>
              )}
              <button
                type="button"
                onClick={() => onAnchorGizmo(!anchorGizmo)}
                title="앵커를 3D 에서 끌어 옮깁니다"
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  background: anchorGizmo
                    ? "oklch(0.72 0.16 90 / 42%)"
                    : "oklch(1 0 0 / 7%)",
                  color: anchorGizmo
                    ? "oklch(0.92 0.14 90)"
                    : "oklch(0.60 0.01 265)",
                }}
              >
                {t("손으로")}
              </button>
              {/*
              ── 어느 클립의 앵커를 따라갈까 ──────────────────────────────
              

              예전 「한 앵커」 는 «전부 첫 클립» 하나뿐이라 두 사람을 번갈아 잡는 컷을
              만들 수가 없었습니다. 이제 클립마다 따를 상대를 고릅니다 —
              「내 것」·「전부 첫 클립」·그리고 다른 클립 하나하나.
            */}
              <TimelineSelect
                width={96}
                tone={anchorSourceLabel.on}
                title="이 클립이 어느 앵커를 쓸지 — A 키로도 넘깁니다"
                value={
                  selectedMove.anchorFromId
                    ? `move:${selectedMove.anchorFromId}`
                    : lockAnchorsOf(state)
                      ? "lock"
                      : "own"
                }
                options={[
                  { id: "own", label: t("앵커: 내 것") },
                  { id: "lock", label: t("앵커: 전부 첫 클립") },
                  ...moves
                    .filter((item) => item.id !== selectedMove.id)
                    .map((item) => ({
                      id: `move:${item.id}`,
                      label: `앵커: ${
                        SHOT_PRESETS.find((preset) => preset.id === item.shotId)
                          ?.label ?? item.shotId
                      }`,
                    })),
                ]}
                onChange={(pick) =>
                  setState((current) => {
                    const cleared = patchCameraMoveIn(
                      current,
                      selectedMove.id,
                      {
                        anchorFromId: pick.startsWith("move:")
                          ? pick.slice(5)
                          : undefined,
                      },
                    );
                    // «전부 첫 클립» 은 컷 전체의 손잡이라 클립이 아니라 상태에 답니다.
                    return setLockAnchorsIn(cleared, pick === "lock");
                  })
                }
              />
            </span>
          )}
        </span>
      </div>

      {/*
        ── 샷 고르기 ────────────────────────────────────────────────────
        

        목록(select)은 열어야 보이고 글자뿐이라 «어떤 움직임인지» 가 안 읽힙니다. 카메라 탭과
        같은 도식을 그대로 가로로 늘어놓으면 눌러서 바로 더할 수 있습니다.
      */}
      <div data-tour="bottom-shot-presets" className="composition-scroll -mx-0.5 mb-1 flex gap-1 overflow-x-auto px-0.5 pb-1">
        {/* 감춘 프리셋(고정 샷 등)은 목록에 안 냅니다 — 옛 저장본을 살리려고만 남겨 둡니다. */}
        {SHOT_PRESETS.filter((preset) => !preset.hidden).map((preset, index) => (
          <button
            key={preset.id}
            type="button"
            /*
              클립이 하나도 없으면 «이동량» · «길이» · «속도 그래프» · 자유 경로 키 칸이 아예
              안 그려집니다 — 고를 클립이 없으니까요. 그래서 **첫 아이콘이 그 자리들의 문**이라고
              적어 둡니다. 
            */
            data-tour-open={
              index === 0 ? "bottom-clip-amount bottom-clip-length bottom-easing bottom-free-key" : undefined
            }
            /*
              끌어서 클립 위에 놓으면 **그 클립의 무빙이 바뀝니다**.
               지우고 다시 놓으면 자리와 길이를 처음부터
              맞춰야 하는데, 그 맞추는 일이 실제로는 제일 성가십니다.
            */
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", preset.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => {
              /*
                ── 카메라를 먼저 세우고 무빙 ─────────────────────────────
                

                무빙은 «어디서 출발하는가» 가 있어야 뜻이 섭니다. 저장 구도가 없으면
                기준이 «지금 화면» 뿐이라, 화면을 한 번 돌리는 순간 무빙이 통째로
                다른 곳을 가리킵니다. 그래서 구도를 먼저 세우게 막습니다.
              */
              if (!shots.length) {
                toast.error("저장한 카메라가 없습니다", {
                  description:
                    "3D 화면 왼쪽 «지금 구도 저장» 으로 카메라를 먼저 세워 주세요. 그 구도가 무빙의 출발점이 됩니다.",
                });
                return;
              }
              setState((current) => {
                const added = addCameraMoveIn(current, preset.id);
                /*
                  **첫 클립만** 출발 카메라를 붙입니다. 둘째부터는 앞 클립이 끝난
                  자세에서 이어지는 것이 보통이고(«이어서»), 갈아타고 싶으면 왼쪽
                  칸에서 고르면 됩니다.
                */
                const first = cameraMovesOf(current).length === 0;
                const withShot = first
                  ? patchCameraMoveIn(added.state, added.id, {
                      cameraShotId: current.activeShotId ?? shots[0].id,
                    })
                  : added.state;
                setSelectedId(added.id);
                return withShot;
              });
            }}
            title={`${t(preset.label)} — ${preset.hint}${
              shotUsesAnchor(preset.kind)
                ? " · 앵커(기준점)를 중심으로 움직입니다"
                : " · 앵커와 무관합니다(제자리 회전·평행 이동·화각)"
            }`}
            className="shrink-0 rounded-md p-1"
            style={{
              // 46 → 62px.
              width: 62,
              /*
                앵커를 쓰는 무빙(오빗·달리)만 노란 기가 돕니다. 앵커를 옮겨도 그림이 안 바뀌는데 단추가 똑같이
                보이면 「왜 안 먹지」 가 됩니다.
              */
              background: shotUsesAnchor(preset.kind)
                ? "oklch(0.72 0.16 90 / 12%)"
                : "oklch(1 0 0 / 5%)",
              border: `1px solid ${
                shotUsesAnchor(preset.kind)
                  ? "oklch(0.72 0.16 90 / 30%)"
                  : "oklch(1 0 0 / 8%)"
              }`,
            }}
          >
            <div className="h-9 w-full">
              <ShotPreviewIcon
                kind={preset.kind}
                axis={preset.axis}
                amount={preset.amount}
              />
            </div>
            <span
              className="mt-0.5 block truncate text-[9px] font-semibold"
              style={{ color: "oklch(0.70 0.01 265)" }}
            >
              {t(preset.label)}
            </span>
          </button>
        ))}
      </div>

      {/*
        ── 재생선 — 눈금자부터 맨 아래 레이어까지 한 줄 ───────────────────
         예전 선은 눈금자 12px 안의 1px 선이라, 아래
        레이어 막대를 보는 동안에는 «지금 몇 초 자리인가» 를 막대와 맞춰 볼 수가 없었습니다.

        선을 **이 덩어리 전체**에 겹쳐 세웁니다. 줄마다 따로 그리지 않는 까닭 — 재생 중에는
        React 를 거치지 않고 ref 하나(`playheadLineRef`)의 left 만 옮기므로, 선이 하나여야
        레이어가 몇 줄이든 같이 움직입니다. 왼쪽 이름 칸(GUTTER)을 비워 줄들의 «0초» 에 맞춥니다.
      */}
      {/*
        ── 확대·축소 ────────────────────────────────────────────────────
        

        20초짜리 모캡을 30 fps 로 넣으면 키가 600개입니다. 판 너비가 1,200px 이면 키 사이가
        2px 이라 손가락으로 집을 수가 없습니다. 판을 **옆으로 늘려** 굴려 봅니다.

        판 안쪽만 넓히고 겉은 `overflow-x` 로 굴립니다 — 초→자리 셈(`ratioOf`·`timeAt`)은
        늘 «판 안쪽의 비율» 이라 배율이 몇이든 그대로 맞습니다.
      */}
      <div className="composition-scroll overflow-x-auto">
      <div className="relative" style={{ minWidth: `${zoom * 100}%` }}>
      <div
        className="pointer-events-none absolute inset-y-0"
        style={{ left: GUTTER, right: 0, zIndex: 20 }}
      >
        <div
          ref={playheadLineRef}
          className="absolute inset-y-0"
          style={{ left: `${ratioOf(playhead) * 100}%`, width: 0 }}
        >
          <div
            className="absolute inset-y-0 -translate-x-1/2"
            style={{
              width: 2,
              background: "oklch(0.72 0.22 25)",
              boxShadow: "0 0 6px oklch(0.72 0.22 25 / 70%)",
            }}
          />
          {/* 머리 — 눈금자 위의 손잡이 모양. 선만으로는 굵어도 막대 경계와 헷갈립니다. */}
          <div
            className="absolute top-0 -translate-x-1/2 rounded-sm"
            style={{
              width: 12,
              height: 14,
              background: "oklch(0.72 0.22 25)",
              clipPath: "polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%)",
            }}
          />
        </div>
      </div>

      {/* 눈금자 — 누르면 그 시각으로 옮깁니다. */}
      {/*
        눈금자는 **누른 채로 끌면 따라옵니다**(스크럽).  한 번에 한
        자리로 뛰는 것보다, 끌면서 그림이 흘러가는 쪽이 무빙을 훨씬 빨리 고칩니다.
      */}
      <div className="flex items-center">
        {/*
          왼쪽 칸 — 눈금자 자리에서는 **총 길이·프레임**을 적습니다.
           5초는 기본값이었지 한계가 아니었는데,
          고칠 자리가 없어 한계처럼 굳어 있었습니다.
        */}
        <div
          className="flex shrink-0 items-center gap-0.5"
          style={gutterStyle}
        >
          <button
            type="button"
            onClick={async () => {
              const seconds = await promptNumber({
                title: "타임라인 총 길이",
                description:
                  "줄여도 클립은 안 지워집니다 — 밖으로 밀려난 클립은 안 보일 뿐, 다시 늘리면 그대로 돌아옵니다.",
                value: Math.round(timelineOf(state).duration * 100) / 100,
                unit: "초",
              });
              if (seconds === null) return;
              setState((current) =>
                setTimelineIn(current, { duration: seconds }),
              );
            }}
            data-tour="bottom-duration"
            title="타임라인 총 길이를 정합니다"
            className="rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.72 0.01 265)",
            }}
          >
            {span.toFixed(span < 10 ? 1 : 0)}s
          </button>
          <button
            type="button"
            onClick={async () => {
              const fps = await promptNumber({
                title: "프레임 수",
                description:
                  "실사 24 · 방송 30 · 게임 60. 재생과 영상 내보내기가 이 값을 씁니다.",
                value: timelineOf(state).fps,
                unit: "fps",
              });
              if (fps === null) return;
              setState((current) => setTimelineIn(current, { fps }));
            }}
            data-tour="bottom-fps"
            title="초당 프레임 수를 정합니다"
            className="rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.60 0.01 265)",
            }}
          >
            {timelineOf(state).fps}f
          </button>
          {/*
            배율은 **보이는 자리에** 둡니다. 단축키만 있으면 확대해 놓은 것을 잊고
            「왜 옆으로 길지?」 가 됩니다. 눌러도 원래대로 돌아갑니다.
          */}
          <button
            type="button"
            onClick={() => setZoom(1)}
            title={`가로 배율 — «+» 로 늘리고 «−» 로 줄입니다${zoom > 1 ? " · 눌러서 원래대로" : ""}`}
            className="rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums"
            style={{
              background: zoom > 1 ? "oklch(0.62 0.22 290 / 22%)" : "oklch(1 0 0 / 6%)",
              color: zoom > 1 ? "oklch(0.84 0.16 290)" : "oklch(0.60 0.01 265)",
            }}
          >
            ×{zoom}
          </button>
          {/*
            잡아 둔 무리를 **보이게** 둡니다. 색만으로는 몇 개를 잡았는지 모르고,
            잡아 둔 것을 잊은 채 키 하나를 끌면 무리가 통째로 따라와 놀랍니다.
          */}
          {/*
            **끝 뒤에 남은 키**를 셉니다. 러닝타임을 줄이면 키는 그대로 있는데 화면에서만
            가려집니다 — 세어 주지 않으면 「지워졌다」 로 읽힙니다.
            늘리면 그 자리에 그대로 돌아옵니다.
          */}
          {beyond > 0 && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] tabular-nums"
              style={{ background: "oklch(0.70 0.14 45 / 20%)", color: "oklch(0.86 0.12 45)" }}
              title={`러닝타임(${span.toFixed(1)}초) 뒤에 키 ${beyond}개가 있습니다. 지워진 것이 아니라 가려진 것이고, 길이를 늘리면 다시 보입니다`}
            >
              끝 뒤 {beyond}개
            </span>
          )}
          {keyBand.length > 0 && (
            <button
              type="button"
              onClick={() => setKeyBand([])}
              data-tour="bottom-key-band"
              title="잡아 둔 키를 풉니다 — 빈 자리를 톡 눌러도 풀립니다"
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
              style={{ background: "oklch(0.72 0.16 60 / 24%)", color: "oklch(0.88 0.14 60)" }}
            >
              키 {keyBand.length}개 잡음 · 풀기
            </button>
          )}
        </div>
        {/*
          재생선(빨간 세로선)과 그 오각형 머리는 `pointer-events-none` 이라 앵커를 걸어도
          잡히지 않습니다. 시각을 실제로 옮기는 손잡이는 이 눈금자라 여기에 답니다.
        */}
        <div
          ref={trackRef}
          data-tour="bottom-ruler"
          onPointerDown={(event) => {
            event.preventDefault();
            onSeek(timeAt(event.clientX));
            const move = (pointer: PointerEvent) =>
              onSeek(timeAt(pointer.clientX));
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          className="relative h-6 flex-1 cursor-ew-resize rounded"
          style={{
            background: "oklch(0.30 0.05 250 / 55%)",
            border: "1px solid oklch(0.62 0.10 250 / 45%)",
          }}
        >
          {/* 반 칸 눈금 — 초 사이를 눈으로 나눌 수 있게 짧은 금만. */}
          {ticks.map((tick) =>
            tick + tickStep / 2 <= span + 1e-6 ? (
              <span
                key={`half-${tick}`}
                className="pointer-events-none absolute bottom-0 h-1.5 w-px"
                style={{
                  left: `${ratioOf(tick + tickStep / 2) * 100}%`,
                  background: "oklch(0.80 0.04 250 / 40%)",
                }}
              />
            ) : null,
          )}
          {ticks.map((tick) => (
            <span key={tick}>
              <span
                className="pointer-events-none absolute bottom-0 h-2.5 w-px"
                style={{
                  left: `${ratioOf(tick) * 100}%`,
                  background: "oklch(0.88 0.04 250 / 70%)",
                }}
              />
              <span
                className="pointer-events-none absolute top-0.5 text-[10px] font-semibold tabular-nums"
                style={{
                  left: `${ratioOf(tick) * 100}%`,
                  color: "oklch(0.90 0.03 250)",
                  // 끝 눈금은 안쪽으로 붙여 판 밖으로 안 삐져나가게.
                  transform:
                    tick === 0
                      ? "translateX(3px)"
                      : tick >= span - 1e-6
                        ? "translateX(calc(-100% - 3px))"
                        : "translateX(-50%)",
                }}
              >
                {tick}s
              </span>
            </span>
          ))}
          {/*
            재생선은 위(덩어리 전체)에 있습니다. 재생 중에는 React 상태를 안 바꾸므로
            (`usePlannerPlayback`) 자리를 **ref 로 직접** 씁니다 — 
          */}
        </div>
      </div>


      {/*
        ── 고른 클립 손잡이 ─────────────────────────────────────────────
        

        그래프를 늘 펼쳐 두지 않는 까닭: 타임라인이 화면 아래에 떠 있는 판이라 세로가
        귀합니다. 고른 클립이 있을 때만, 그것도 눌렀을 때만 폅니다.
      */}
      {selectedMove && (
        <div className="mt-1 flex items-center gap-1">
          {/* 왼쪽 칸을 맞춰 둡니다 — 다른 줄과 어긋나면 어느 클립의 손잡이인지 흐려집니다. */}
          <span
            className="shrink-0 truncate text-[9px] font-semibold"
            style={{ ...gutterStyle, color: "oklch(0.72 0.06 290)" }}
          >
            {selectedPreset?.label ?? "무빙"}
          </span>
          {/*
            ── 프리셋 무빙은 «얼마나 움직이나» 하나면 됩니다 ──────────────
            

            맞습니다. 프리셋 클립은 **«지금 자세에서 얼마나»** 라 절대 좌표가 없습니다.
            그래서 손잡이는 셋이면 충분합니다 — 이동량 · 길이 · 속도 그래프.

            예전에는 이것을 «이동량 키» 로만 고칠 수 있었습니다. 그런데 키를 하나만
            찍으면 그 값이 클립 내내 상수가 되어 카메라가 아예 안 움직였고, 그래서
            「값이 수정이 안 돼」 로 보였습니다. 이제 값을 **바로** 고칩니다.
            («이동량 키» 는 클립 중간에 속도를 꺾고 싶을 때만 쓰는 고급 손잡이로 남깁니다.)
          */}
          {selectedPreset?.kind !== "free" && (
            <>
              <span
                className="text-[9px]"
                style={{ color: "oklch(0.56 0.01 265)" }}
              >
                {t("이동량")}
              </span>
              {/*
                
                공용 `NumberInput` 은 패널용이라 이 줄에서는 혼자 키가 큽니다 —
                앵커 좌표칸과 같은 모양으로 맞춥니다(`timelineFieldStyle`).
              */}
              <input
                type="number"
                step={selectedPreset?.kind === "zoom" ? 0.1 : 1}
                value={Math.round(selectedMove.amount * 100) / 100}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  setState((current) =>
                    patchCameraMoveIn(current, selectedMove.id, {
                      amount: next,
                    }),
                  );
                }}
                data-tour="bottom-clip-amount"
                title={amountHintOf(selectedPreset, selectedMove)}
                className={TIMELINE_FIELD}
                style={{ ...timelineFieldStyle(), width: 54 }}
              />
              <span
                className="text-[9px]"
                style={{ color: "oklch(0.52 0.01 265)" }}
              >
                {amountUnitOf(selectedPreset?.kind)}
              </span>
            </>
          )}
          <span
            className="ml-1 text-[9px]"
            style={{ color: "oklch(0.56 0.01 265)" }}
          >
            {t("길이")}
          </span>
          <input
            type="number"
            step={0.25}
            min={0.1}
            value={Math.round(selectedMove.duration * 100) / 100}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              setState((current) =>
                patchCameraMoveIn(current, selectedMove.id, {
                  duration: Math.max(0.1, next),
                }),
              );
            }}
            data-tour="bottom-clip-length"
            title="이 클립이 몇 초 동안 움직일지"
            className={TIMELINE_FIELD}
            style={{ ...timelineFieldStyle(), width: 50 }}
          />
          <span
            className="text-[9px]"
            style={{ color: "oklch(0.52 0.01 265)" }}
          >
            {t("초")}
          </span>
          {/* 자유 경로는 «찍어 둔 자리» 라 이동량이 없습니다 — 대신 키를 찍습니다. */}
          {selectedPreset?.kind === "free" && (
            <button
              type="button"
              onClick={() =>
                setState((current) =>
                  addCameraKeyIn(
                    current,
                    selectedMove.id,
                    Math.max(0, playhead - selectedMove.startTime),
                  ),
                )
              }
              title="재생 머리 자리에 «지금 카메라» 를 통째로(자리·시선·줌) 찍습니다. 갈래 하나만 찍으려면 아래 줄의 + 를 쓰세요"
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                background: "oklch(0.72 0.16 90 / 26%)",
                color: "oklch(0.90 0.14 90)",
              }}
            >
              + 키 전부
            </button>
          )}
          {/*
            고른 **이동량 키**의 값.  클립 전체의 이동량 옆에 나란히 두어, 「이 클립은 −2.5까지
            가는데 1.2초에는 −1」 처럼 둘을 같이 보며 고칠 수 있습니다.
          */}
          {pickedAmountKey && (
            <>
              <span
                className="text-[9px]"
                style={{ color: "oklch(0.72 0.13 200)" }}
              >
                {pickedAmountKey.key.time.toFixed(2)}{t("초")}
              </span>
              <input
                type="number"
                step={selectedPreset?.kind === "zoom" ? 0.1 : 1}
                value={Math.round(pickedAmountKey.key.amount * 100) / 100}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  setState((current) =>
                    addAmountKeyIn(
                      current,
                      pickedAmountKey.move.id,
                      pickedAmountKey.key.time,
                      next,
                    ),
                  );
                }}
                className="rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums outline-none"
                style={{
                  width: 54,
                  background: "oklch(0.55 0.15 200 / 18%)",
                  border: "1px solid oklch(0.62 0.15 200 / 45%)",
                  color: "oklch(0.88 0.13 200)",
                }}
              />
            </>
          )}
          {/*
            ── 카메라 탭에 있던 나머지 손잡이 ───────────────────────────
            

            탭에 숨어 있던 손잡이는 **없는 것과 같습니다.** 「있는지 몰랐네」 가 그
            증거예요. 무빙을 고른 자리에 다 모아 둡니다.
          */}
          {selectedPreset?.kind === "orbit" && (
            <TimelineSelect
              width={74}
              title="무엇을 축으로 돌지 — 수평은 사람 주위를 돌고, 수직은 위아래로 넘어갑니다"
              value={selectedMove.axis}
              options={[
                { id: "y", label: t("축: 수평") },
                { id: "x", label: t("축: 수직") },
                { id: "xy", label: t("축: 나선") },
              ]}
              onChange={(axis) =>
                setState((current) =>
                  patchCameraMoveIn(current, selectedMove.id, {
                    axis: axis as typeof selectedMove.axis,
                  }),
                )
              }
            />
          )}
          {shotUsesAnchor(selectedPreset?.kind) && (
            <button
              type="button"
              onClick={() =>
                setState((current) =>
                  patchCameraMoveIn(current, selectedMove.id, {
                    lookAtAnchor: !selectedMove.lookAtAnchor,
                  }),
                )
              }
              title={
                selectedMove.lookAtAnchor
                  ? "앵커가 화면 한가운데로 옵니다 — 끄면 잡아 둔 구도를 지킨 채 다가갑니다"
                  : "잡아 둔 구도를 지킨 채 움직입니다 — 켜면 앵커가 화면 한가운데로 옵니다"
              }
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                background: selectedMove.lookAtAnchor
                  ? "oklch(0.72 0.16 90 / 38%)"
                  : "oklch(1 0 0 / 7%)",
                color: selectedMove.lookAtAnchor
                  ? "oklch(0.92 0.14 90)"
                  : "oklch(0.60 0.01 265)",
              }}
            >
              {t("앵커 보기")}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setState((current) =>
                patchCameraMoveIn(current, selectedMove.id, {
                  showAnchor: !selectedMove.showAnchor,
                }),
              )
            }
            data-tour="bottom-axis"
            title="앵커 십자를 3D 화면에 보일지"
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{
              background: selectedMove.showAnchor
                ? "oklch(0.72 0.16 90 / 30%)"
                : "oklch(1 0 0 / 7%)",
              color: selectedMove.showAnchor
                ? "oklch(0.88 0.14 90)"
                : "oklch(0.60 0.01 265)",
            }}
          >
            {t("앵커 표시")}
          </button>
          {/*
            ── 손떨림 ──────────────────────────────────────────────────
            

            슬라이더는 «어디가 핸드헬드인지» 를 안 알려 줍니다. 숫자로 적고, 흔한
            자리를 단추로 놓아 한 번에 고르게 합니다. 단위는 **%** 로 읽습니다
            (저장값은 0~1 이라 100 으로 나눠 담습니다).
          */}
          <span
            className="text-[9px]"
            style={{ color: "oklch(0.56 0.01 265)" }}
          >
            {t("손떨림")}
          </span>
          <input
            type="number"
            step={5}
            min={0}
            max={100}
            value={Math.round(selectedMove.handheld * 100)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              setState((current) =>
                patchCameraMoveIn(current, selectedMove.id, {
                  handheld: Math.min(1, Math.max(0, next / 100)),
                }),
              );
            }}
            title="0% 삼각대 · 12% 어깨에 올린 느낌 · 25% 손으로 든 다큐 · 50% 뛰면서 · 80%+ 흔들어 찍는 액션"
            className={TIMELINE_FIELD}
            style={{ ...timelineFieldStyle(), width: 42 }}
          />
          <span
            className="text-[9px]"
            style={{ color: "oklch(0.52 0.01 265)" }}
          >
            %
          </span>
          {HANDHELD_PRESETS.map((preset) => {
            const on = Math.abs(selectedMove.handheld - preset.value) < 0.001;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() =>
                  setState((current) =>
                    patchCameraMoveIn(current, selectedMove.id, {
                      handheld: preset.value,
                    }),
                  )
                }
                title={preset.hint}
                className="rounded px-1 py-0.5 text-[9px] font-semibold"
                style={{
                  background: on
                    ? "oklch(0.55 0.15 200 / 30%)"
                    : "oklch(1 0 0 / 6%)",
                  color: on ? "oklch(0.86 0.13 200)" : "oklch(0.58 0.01 265)",
                }}
              >
                {t(preset.label)}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setGraphPanel(
                graphPanel?.kind === "move" && graphPanel.id === selectedMove.id
                  ? null
                  : { kind: "move", id: selectedMove.id },
              )
            }
            data-tour="bottom-easing"
            title="이 클립의 완급 곡선 — 키 사이에 같은 곡선이 걸립니다"
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{
              background:
                graphPanel?.kind === "move" && graphPanel.id === selectedMove.id
                  ? "oklch(0.62 0.22 290 / 34%)"
                  : "oklch(1 0 0 / 7%)",
              color:
                graphPanel?.kind === "move" && graphPanel.id === selectedMove.id
                  ? "oklch(0.88 0.16 290)"
                  : "oklch(0.60 0.01 265)",
            }}
          >
            {t("속도 그래프")}
          </button>
        </div>
      )}

      {/*
        클립 줄 — 하나씩 아래로 쌓입니다.

        
        줄 개수와 판 높이를 분리하고 바깥의 한 스크롤에서 움직입니다. 이 목록까지 별도 높이로
        자르면 세로 스크롤이 두 개 생기므로 접기·높이 조절은 판 전체가 맡습니다.
      */}
      <div className="mt-1 space-y-1 pr-0.5">
        {moves.length === 0 && (
          <p
            className="py-1 text-[9px] leading-relaxed"
            style={{ color: "oklch(0.45 0.01 265)" }}
          >
            아직 무빙이 없습니다 — 카메라는 고정입니다. «무빙 더하기» 를
            누르거나 카메라 탭에서 샷을 고르면 여기 줄이 생깁니다.
          </p>
        )}
        {moves.map((move) => {
          const preset = SHOT_PRESETS.find((item) => item.id === move.shotId);
          const on = move.id === selectedId;
          const left = ratioOf(move.startTime) * 100;
          const width = Math.max(
            1.5,
            (ratioOf(moveEnd(move)) - ratioOf(move.startTime)) * 100,
          );
          const shot = move.cameraShotId
            ? shots.find((item) => item.id === move.cameraShotId)
            : null;
          return (
            <div key={move.id}>
              <div className="flex items-center">
                {/*
                왼쪽 칸 — **어느 저장 구도에서 출발할지**.
                

                비워 두면 예전대로 **앞 클립이 끝난 자세**에서 이어집니다. 고르면 그 시각에
                컷이 바뀝니다 — 한 타임라인에 여러 대를 세우는 셈입니다.
              */}
                <div
                  className="flex shrink-0 items-center gap-0.5"
                  style={gutterStyle}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) =>
                        patchCameraMoveIn(current, move.id, {
                          muted: move.muted ? undefined : true,
                        }),
                      )
                    }
                    title={
                      move.muted
                        ? "다시 켭니다 — 이 무빙이 재생에 들어갑니다"
                        : "잠시 끕니다 — 값은 남고 카메라가 이 클립을 건너뜁니다"
                    }
                    className="shrink-0 rounded p-0.5"
                    style={{
                      color: move.muted
                        ? "oklch(0.42 0.01 265)"
                        : "oklch(0.70 0.01 265)",
                    }}
                  >
                    {move.muted ? (
                      <EyeOff className="h-2.5 w-2.5" />
                    ) : (
                      <Eye className="h-2.5 w-2.5" />
                    )}
                  </button>
                  {/*
                  줄 차례 바꾸기. 줄은 시각
                  순이라 «위» 가 곧 «먼저» 입니다. 바꾸면 자리를 다시 이어 붙입니다.
                */}
                  <span className="flex shrink-0 flex-col">
                    {[
                      { delta: -1, mark: "▲", hint: "한 줄 위로(먼저)" },
                      { delta: 1, mark: "▼", hint: "한 줄 아래로(나중)" },
                    ].map((step) => (
                      <button
                        key={step.delta}
                        type="button"
                        onClick={() =>
                          setState((current) =>
                            moveCameraMoveOrderIn(current, move.id, step.delta),
                          )
                        }
                        title={step.hint}
                        className="leading-none"
                        style={{
                          fontSize: 6,
                          color: "oklch(0.58 0.01 265)",
                        }}
                      >
                        {step.mark}
                      </button>
                    ))}
                  </span>
                  <TimelineSelect
                    tour="bottom-clip-start"
                    value={move.cameraShotId ?? ""}
                    tone={Boolean(shot)}
                    placeholder={shots.length ? t("이어서") : t("구도 없음")}
                    title={
                      shot
                        ? `«${shot.name}» 구도에서 출발합니다 — 이 시각에 컷이 바뀝니다`
                        : "앞 클립이 끝난 자세에서 이어집니다. 저장한 구도를 고르면 그 구도로 갈아탑니다"
                    }
                    options={
                      shots.length
                        ? [
                            { id: "", label: t("이어서") },
                            ...shots.map((item) => ({
                              id: item.id,
                              label: item.name,
                            })),
                          ]
                        : []
                    }
                    /*
                    저장한 구도가 하나도 없으면 고를 것이 없습니다. 그냥 못 누르게만 두면
                    「왜 안 눌리지」 로 끝나므로 무엇을 먼저 해야 하는지 알려 줍니다
                    ().
                  */
                    onBlocked={() =>
                      toast.info("저장한 카메라가 없습니다", {
                        description:
                          "3D 화면 왼쪽 «지금 구도 저장» 으로 카메라를 먼저 세워 두면, 클립마다 어느 구도에서 출발할지 고를 수 있습니다.",
                      })
                    }
                    onChange={(id) =>
                      setState((current) =>
                        patchCameraMoveIn(current, move.id, {
                          cameraShotId: id || undefined,
                        }),
                      )
                    }
                  />
                </div>
                <div className="relative h-5 flex-1 overflow-hidden">
                  <div
                    onDragOver={(event) => {
                      // 놓을 수 있는 자리임을 커서로 알립니다.
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const shotId = event.dataTransfer.getData("text/plain");
                      if (!shotId || shotId === move.shotId) return;
                      setState((current) =>
                        swapCameraMovePresetIn(current, move.id, shotId),
                      );
                      setSelectedId(move.id);
                      const dropped = SHOT_PRESETS.find(
                        (item) => item.id === shotId,
                      );
                      toast.success(
                        `«${dropped?.label ?? shotId}» 로 바꿨습니다`,
                        {
                          description:
                            "자리와 길이는 그대로입니다. 이동량은 새 무빙의 기본값으로 바뀝니다(단위가 달라서요).",
                        },
                      );
                    }}
                    onPointerDown={dragClip(move, "move")}
                    onDoubleClick={async () => {
                      /*
                     끝을 끄는 것보다 숫자가 빠른 때가 있습니다 —
                    「정확히 2초」 같은 값.
                  */
                      const seconds = await promptNumber({
                        title: `${preset?.label ?? "무빙"} 길이`,
                        description: "0.05초 눈금에 맞춰 들어갑니다.",
                        value: move.duration,
                        unit: "초",
                      });
                      if (seconds === null || seconds <= 0) return;
                      setState((current) =>
                        patchCameraMoveIn(current, move.id, {
                          duration: Math.round(seconds * 20) / 20,
                        }),
                      );
                    }}
                    title={`${t(preset?.label ?? move.shotId)} — 몸통을 끌면 시각, 오른쪽 끝을 끌면 길이, 두 번 누르면 초 입력 · 골라 두고 Delete 로 삭제`}
                    className="absolute inset-y-0 flex cursor-grab items-center overflow-hidden rounded pl-1.5 pr-4 text-[9px] font-semibold"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: on
                        ? "oklch(0.62 0.22 290 / 42%)"
                        : "oklch(0.62 0.22 290 / 20%)",
                      border: `1px solid ${on ? "oklch(0.72 0.18 290)" : "oklch(1 0 0 / 12%)"}`,
                      color: "oklch(0.92 0.06 290)",
                    }}
                  >
                    <span className="truncate">
                      {t(preset?.label ?? move.shotId)}
                    </span>
                    {/*
                  자유 클립에 찍어 둔 자리들. 클립 막대 위에 점으로 보여 줘야 «언제 어디를
                  지나는지» 가 한눈에 들어옵니다. 점을 누르면 그 키를 지웁니다.
                */}
                    {/*
                  이동량 키 — 「이 시각에 몇 도」.  두 번 누르면 값을 고칩니다.
                */}
                    {preset?.kind !== "free" &&
                      sortByTime(move.amountKeys ?? []).map((key) => {
                        const picked =
                          pickedKey?.kind === "amount" &&
                          pickedKey.keyId === key.id;
                        return (
                          /*
                          ── 키가 먼저 ───────────────────────────────────
                          

                          보이는 점은 10px 이라 손이 거의 못 맞춥니다. **보이는 것보다
                          넓은 판**(20px)을 씌우고 그 판이 눌림을 먼저 받게 합니다
                          (`zIndex`). 클립 몸통은 그 아래라, 판 안을 누르면 클립이
                          아니라 키가 잡힙니다.
                        */
                          <span
                            key={key.id}
                            onPointerDown={dragKey(
                              {
                                kind: "amount",
                                moveId: move.id,
                                keyId: key.id,
                              },
                              (clientX) => timeAt(clientX) - move.startTime,
                            )}
                            onDoubleClick={async (event) => {
                              event.stopPropagation();
                              const value = await promptNumber({
                                title: `${key.time.toFixed(2)}초의 이동량`,
                                description: amountHintOf(preset, move),
                                value: key.amount,
                                unit: amountUnitOf(preset?.kind),
                              });
                              if (value === null) return;
                              setState((current) =>
                                addAmountKeyIn(
                                  current,
                                  move.id,
                                  key.time,
                                  value,
                                ),
                              );
                            }}
                            title={`${key.time.toFixed(2)}초 · ${key.amount}${amountUnitOf(preset?.kind)} — 끌어서 옮기고, 두 번 누르면 값, Delete 로 삭제`}
                            className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
                            style={{
                              left: `${Math.min(100, (key.time / Math.max(move.duration, 0.0001)) * 100)}%`,
                              width: 20,
                              height: 20,
                              zIndex: 5,
                            }}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{
                                background: picked
                                  ? "oklch(0.98 0.08 200)"
                                  : "oklch(0.80 0.14 200)",
                                border: `1px solid ${picked ? "oklch(0.98 0 0)" : "oklch(0.24 0.02 265)"}`,
                              }}
                            />
                          </span>
                        );
                      })}
                    {/*
                    ── 끝 손잡이 ─────────────────────────────────────────
                    

                    지우는 x 가 클립 오른쪽 끝에 겹쳐 있어, 길이를 늘이려고 끝을 잡으면
                    x 가 먼저 눌렸습니다. x 를 빼고(삭제는 골라 두고 Delete) 손잡이를
                    넓혔습니다 — 끝은 «길이» 만 맡습니다.
                  */}
                    <span
                      onPointerDown={dragClip(move, "resize")}
                      title="끌어서 길이 바꾸기 · 지우기는 골라 두고 Delete"
                      className="absolute inset-y-0 right-0 w-3 cursor-ew-resize"
                      style={{ background: "oklch(1 0 0 / 26%)" }}
                    />
                  </div>
                </div>
              </div>
              {/*
                ── 자유 경로의 키는 **줄 아래로** ──────────────────────────
                , 「각각의 요소마다 키프레임 찍을 수
                있어야 해」.

                클립 막대 안에 점을 얹으면 막대를 끄는 손과 키를 잡는 손이 같은 자리에서
                싸웁니다. 인물·소품 트랙처럼 **아래에 자기 줄**을 내주면 서로 안 겹치고,
                갈래(자리·바라보는 곳·줌)마다 한 줄이라 무엇의 키인지도 바로 읽힙니다.
              */}
              {preset?.kind === "free" &&
                CAMERA_KEY_ROWS.map((row) => {
                  const mine = sortByTime(move.keys ?? []).filter((key) =>
                    keyDefines(key, row.id),
                  );
                  return (
                    <div key={row.id} className="flex items-center">
                      <div
                        className="flex shrink-0 items-center gap-0.5"
                        style={gutterStyle}
                      >
                        <span
                          className="min-w-0 flex-1 truncate pl-3 text-[8px] font-semibold"
                          style={{ color: row.color }}
                          title={`${t(preset.label)} 의 ${row.label} 키 ${mine.length}개`}
                        >
                          ↳ {row.label}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setState((current) =>
                              addCameraKeyIn(
                                current,
                                move.id,
                                Math.max(0, playhead - move.startTime),
                                undefined,
                                [row.id],
                              ),
                            )
                          }
                          title={`재생 머리 자리에 «지금 ${row.label}» 만 키로 찍습니다`}
                          className="shrink-0 rounded px-1 text-[9px] font-semibold"
                          style={{
                            background: `color-mix(in oklch, ${row.color} 22%, transparent)`,
                            color: row.color,
                          }}
                        >
                          +
                        </button>
                      </div>
                      <div className="relative h-3.5 flex-1">
                        {mine.map((key) => {
                          const picked =
                            pickedKey?.kind === "camera" &&
                            pickedKey.keyId === key.id;
                          return (
                            <span
                              key={key.id}
                              onPointerDown={dragKey(
                                {
                                  kind: "camera",
                                  moveId: move.id,
                                  keyId: key.id,
                                },
                                (clientX) => timeAt(clientX) - move.startTime,
                              )}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                setFreeKey({ moveId: move.id, keyId: key.id });
                              }}
                              /*
                                값 판은 이 점을 눌러야 생깁니다 — 아무 키도 안 고른 동안에는
                                판이 아예 안 그려져 튜토리얼이 밝힐 자리가 없습니다.
                                그래서 이 점이 «내가 열면 그 판이 생긴다» 고 적어 둡니다.
                              */
                              data-tour-open="bottom-free-key"
                              title={`${row.label} · ${key.time.toFixed(2)}초 — 끌어서 옮기고, 두 번 누르면 값, Delete 로 지웁니다`}
                              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
                              style={{
                                left: `${ratioOf(move.startTime + key.time) * 100}%`,
                                width: 20,
                                height: 18,
                                zIndex: 5,
                              }}
                            >
                              <span
                                className="h-2.5 w-2.5 rotate-45"
                                style={{
                                  background: picked
                                    ? "oklch(0.98 0.04 265)"
                                    : row.color,
                                  border: `1px solid ${picked ? "oklch(0.98 0 0)" : "oklch(0.24 0.02 265)"}`,
                                }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}

        <TimelineMusicRow
          music={music}
          span={span}
          gutterStyle={gutterStyle}
          ratioOf={ratioOf}
          onSeek={onSeek}
        />

        {/*
          ── 인물·소품 레이어 ──────────────────────────────────────────────
          

          카메라 클립과 **같은 모양**입니다 — 막대 몸통을 끌면 옮기고, 양 끝을 끌면 자르고,
          아래 줄에 속성별 키. 막대가 있는 동안만 화면에 섭니다.
        */}
        {(layerTargets ?? []).length > 0 && (
          <div
            data-tour="bottom-layers"
            className="flex items-center gap-1 pt-1 text-[8px] font-semibold"
            style={{ color: "oklch(0.50 0.01 265)" }}
          >
            <span style={gutterStyle}>{t("인물 · 소품")}</span>
            <span className="h-px flex-1" style={{ background: "oklch(1 0 0 / 8%)" }} />
          </div>
        )}
        {(layerTargets ?? []).map((target) => {
          const span = layerSpanOf(state, target.id);
          const tracks = motionTracksOf(state).filter((track) => track.targetId === target.id);
          const picked = target.id === selectedTargetId;
          /*
            아래 속성 줄은 **기본으로 닫아 둡니다.** ▸ 로 사람이 여닫습니다.

            처음엔 «키가 있거나 고른 대상» 이면 저절로 폈는데,  키는 K 로
            찍으니(1·2·3 으로 속성 고르고 K) 줄을 펴 둘 까닭이 없습니다.
          */
          const open = openLayers.has(target.id) && !closedLayers.has(target.id);
          /*
            이 줄에 들어간 모션의 이름 — 트랙 중 하나에만 적혀 있어도 그것을 씁니다.
            채널마다 따로 적히지만 한 번에 들어간 것이라 셋이 같습니다.
          */
          const motionName = tracks.find((track) => track.sourceName)?.sourceName ?? "";
          const motionSourceId = tracks.find((track) => track.sourceId)?.sourceId;
          const left = ratioOf(span.start) * 100;
          const width = Math.max(1.5, (ratioOf(span.end) - ratioOf(span.start)) * 100);
          const color = target.color;
          return (
            <div key={target.id}>
              <div className="flex items-center">
                <div className="flex shrink-0 items-center gap-0.5" style={gutterStyle}>
                  <button
                    type="button"
                    onClick={() => toggleLayerOpen(target.id, open)}
                    title={
                      open
                        ? "키 줄 접기"
                        : target.kind === "character"
                          ? "키 줄 펴기 — 이동·회전·자세"
                          : "키 줄 펴기 — 이동·회전·크기"
                    }
                    className="shrink-0 rounded p-1 hover:bg-white/5"
                    style={{ color: "oklch(0.70 0.01 265)" }}
                  >
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setState((current) => setLayerHiddenIn(current, target.id, !span.hidden))}
                    title={span.hidden ? "다시 켭니다 — 막대 구간에 화면에 섭니다" : "잠시 끕니다 — 막대는 남고 화면에서만 뺍니다"}
                    className="shrink-0 rounded p-0.5"
                    style={{ color: span.hidden ? "oklch(0.42 0.01 265)" : "oklch(0.70 0.01 265)" }}
                  >
                    {span.hidden ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                  </button>
                  {/*
                    ── 속도 그래프는 **레이어에** 하나 ─────────────────────────
                     그래프는 **고른 키의 구간**을 고칩니다(`graphCurve` ①) — 이동 키를
                    잡으면 이동, 자세 키를 잡으면 자세. 그래서 속성마다 단추를 둘 까닭이 없습니다.
                    키를 안 골랐으면 키가 둘 이상인 첫 속성의 기본 곡선을 엽니다.
                  */}
                  {(() => {
                    const moving = MOTION_CHANNELS.map((channel) =>
                      tracks.find((item) => item.channel === channel.id),
                    ).find((track) => track && track.keys.length >= 2);
                    if (!moving) return <span className="w-3.5 shrink-0" />;
                    const graphOn = graphPanel?.kind === "track" && graphPanel.targetId === target.id;
                    const pickedTrack =
                      pickedKey?.kind === "motion" && pickedKey.targetId === target.id
                        ? tracks.find((item) => item.keys.some((key) => key.id === pickedKey.keyId))
                        : undefined;
                    return (
                      <button
                        type="button"
                        onClick={() =>
                          setGraphPanel(
                            graphOn
                              ? null
                              : {
                                  kind: "track",
                                  targetId: target.id,
                                  channel: (pickedTrack ?? moving).channel,
                                },
                          )
                        }
                        title="속도 그래프 — 키를 고르면 그 키에서 다음 키까지의 완급을 고칩니다"
                        className="shrink-0 rounded px-0.5 text-[9px] font-semibold leading-none"
                        style={{
                          background: graphOn ? "oklch(0.62 0.22 290 / 34%)" : "oklch(1 0 0 / 6%)",
                          color: graphOn ? "oklch(0.88 0.16 290)" : "oklch(0.62 0.01 265)",
                        }}
                      >
                        ∿
                      </button>
                    );
                  })()}
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: color, opacity: span.hidden ? 0.4 : 1 }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[9px] font-semibold"
                    style={{
                      color: picked ? "oklch(0.96 0.02 265)" : "oklch(0.78 0.01 265)",
                      textDecoration: span.hidden ? "line-through" : undefined,
                    }}
                    title={`${target.name}${motionName ? ` · 모션 «${motionName}»` : ""} — ${span.start.toFixed(2)}초 ~ ${span.end.toFixed(2)}초${motionName ? " · 오른쪽 단추로 모션 바꾸기·재분석" : ""}`}
                    onContextMenu={(event) => {
                      // 오른쪽 단추 — 이 줄에 들어간 모션을 다루는 자리.
                      event.preventDefault();
                      if (!onMotionMenu) return;
                      onMotionMenu({
                        targetId: target.id,
                        targetName: target.name,
                        sourceId: motionSourceId,
                        sourceName: motionName,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    {target.name}
                    {/*
                      **어떤 모션이 들어갔는지** 괄호로(). 키만 보고는
                      그게 어느 춤이었는지 알 수 없습니다.
                    */}
                    {motionName && (
                      <span className="font-normal" style={{ color: "oklch(0.62 0.12 60)" }}>
                        {" "}
                        ({motionName})
                      </span>
                    )}
                  </span>
                </div>
                <div className="relative h-5 flex-1 overflow-hidden">
                  <div
                    onPointerDown={dragLayer(target, span, "move")}
                    onDoubleClick={async () => {
                      /*
                        「정확히 2초에 들어온다」 는 끌기보다 숫자가 빠릅니다 — 카메라 클립의
                        두 번 누르기와 같은 약속. 시작만 묻고 길이는 그대로 둡니다.
                      */
                      const seconds = await promptNumber({
                        title: `${target.name} 이 나타나는 시각`,
                        description: "막대 길이는 그대로 두고 통째로 옮깁니다. 0.05초 눈금.",
                        value: span.start,
                        unit: "초",
                      });
                      if (seconds === null || seconds < 0) return;
                      const length = span.end - span.start;
                      setState((current) =>
                        setLayerSpanIn(current, target.id, { start: seconds, end: seconds + length }),
                      );
                    }}
                    title={`${target.name} — ${span.start.toFixed(2)}~${span.end.toFixed(2)}초에 화면에 있습니다. 몸통을 끌면 옮기고, 양 끝을 끌면 들어오고 나가는 시각, 두 번 누르면 시작 초`}
                    className="absolute inset-y-0 flex cursor-grab items-center overflow-hidden rounded px-3 text-[9px] font-semibold"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: `color-mix(in oklch, ${color} ${picked ? 46 : 26}%, transparent)`,
                      border: `1px solid ${picked ? color : "oklch(1 0 0 / 12%)"}`,
                      color: "oklch(0.95 0.02 265)",
                      opacity: span.hidden ? 0.45 : 1,
                    }}
                  >
                    <span className="truncate">{target.name}</span>
                    {/* 양 끝 손잡이 — 들어오는 시각 · 나가는 시각. 카메라 클립 끝 손잡이와 같은 폭. */}
                    <span
                      onPointerDown={dragLayer(target, span, "start")}
                      title="끌어서 나타나는 시각"
                      className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize"
                      style={{ background: "oklch(1 0 0 / 26%)" }}
                    />
                    <span
                      onPointerDown={dragLayer(target, span, "end")}
                      title="끌어서 사라지는 시각"
                      className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize"
                      style={{ background: "oklch(1 0 0 / 26%)" }}
                    />
                  </div>
                </div>
              </div>
              {/*
                ── 속성 키는 **막대 아래 줄로** ───────────────────────────────
                자유 경로의 «↳ 자리 / 바라보는 곳 / 줌» 줄과 같은 모양입니다. 「+」 는 재생 머리
                자리에 «지금 값» 을 찍고, 첫 키 뒤로는 3D 에서 옮기기만 해도 자동으로 찍힙니다.
              */}
              {open &&
                // 인물 크기는 캐릭터의 키(cm)가 정합니다 — 찍을 수 없는 줄은 안 보입니다.
                // 자세(관절)는 인물에만 있습니다.
                MOTION_CHANNELS.filter((channel) =>
                  target.kind === "character" ? channel.id !== "scale" : channel.id !== "pose",
                ).map((channel) => {
                  const track = tracks.find((item) => item.channel === channel.id);
                  const keys = sortByTime(track?.keys ?? []);
                  const joints = channel.id === "pose" ? poseJointRowsOf(track) : [];
                  const poseOpen = channel.id === "pose" && openPose.has(target.id);
                  return (
                    <div key={channel.id}>
                    <div className="flex items-center">
                      <div className="flex shrink-0 items-center gap-0.5" style={gutterStyle}>
                        {/*
                          자세 줄은 **이름 칸 전체**가 펴기 단추입니다. 처음엔 10px 화살표만 눌렸는데
                          「펼치기 영역이 너무 좁아서 펼치기 힘드네」.
                        */}
                        {channel.id === "pose" ? (
                          <button
                            type="button"
                            disabled={!joints.length}
                            onClick={() =>
                              setOpenPose((current) => {
                                const next = new Set(current);
                                if (next.has(target.id)) next.delete(target.id);
                                else next.add(target.id);
                                return next;
                              })
                            }
                            title={
                              joints.length
                                ? poseOpen
                                  ? "관절 줄 접기"
                                  : `관절 줄 펴기 — 키가 있는 관절 ${joints.length}개`
                                : "아직 관절 키가 없습니다 — 관절을 잡고 K 를 누르거나 관절을 돌리면 줄이 생깁니다"
                            }
                            className="flex h-full min-w-0 flex-1 items-center gap-0.5 self-stretch rounded-sm pl-1 text-left text-[9px] font-semibold hover:bg-white/5"
                            style={{ color: channel.color }}
                          >
                            <span style={{ color: joints.length ? channel.color : "oklch(0.36 0.01 265)" }}>
                              {poseOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </span>
                            <span className="truncate">{t(channel.label)}</span>
                          </button>
                        ) : (
                          <span
                            className="min-w-0 flex-1 truncate pl-4 text-[9px] font-semibold"
                            style={{ color: channel.color }}
                            title={`${target.name} 의 ${t(channel.label)} 키 ${keys.length}개${keys.length === 1 ? " (하나뿐이라 안 움직입니다)" : ""}`}
                          >
                            ↳ {t(channel.label)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setState((current) => addMotionKeyAtIn(current, target.id, channel.id, playhead))
                          }
                          title={
                            channel.id === "pose"
                              ? `재생 머리(${playhead.toFixed(2)}초) 자리에 지금 보이는 자세(관절 전부)를 키로 찍습니다 — 관절을 고른 채 K 와 같습니다`
                              : `재생 머리(${playhead.toFixed(2)}초) 자리에 «지금 ${t(channel.label)}» 을 키로 찍습니다`
                          }
                          // 오른쪽을 띄웁니다 — 0초의 키 점(폭 20px)이 이름 칸으로 반쯤 걸쳐 「+」 를 덮었습니다.
                          className="mr-2.5 shrink-0 rounded px-1.5 py-px text-[10px] font-semibold"
                          style={{
                            background: `color-mix(in oklch, ${channel.color} 22%, transparent)`,
                            color: channel.color,
                          }}
                        >
                          +
                        </button>
                      </div>
                      <div
                        className="relative h-5 flex-1 overflow-hidden"
                        onPointerDown={dragBand(keys)}
                      >
                        {/* 끌고 있는 고무줄 — 잡히는 구간을 눈으로 보여 줍니다. */}
                        {band && (
                          <span
                            className="pointer-events-none absolute inset-y-0"
                            style={{
                              left: `${ratioOf(Math.min(band.from, band.to)) * 100}%`,
                              width: `${Math.abs(ratioOf(band.to) - ratioOf(band.from)) * 100}%`,
                              background: "oklch(0.72 0.16 60 / 22%)",
                              border: "1px solid oklch(0.72 0.16 60 / 60%)",
                              zIndex: 6,
                            }}
                          />
                        )}
                        {/* 막대 구간을 옅게 깔아 «이 사람이 있는 동안» 이 키 줄에서도 보이게. */}
                        <span
                          className="pointer-events-none absolute inset-y-1 rounded-sm"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: `color-mix(in oklch, ${color} 8%, transparent)`,
                          }}
                        />
                        {/*
                          ── 자세 줄의 점 = 관절 점의 **요약** ─────────────────────────
                          
                          펼치면 관절 줄이 점을 맡으니 자세 줄은 비웁니다. 접으면 관절 점이 있는
                          자세 키에만 점을 두고(관절 줄이 아직 없으면 자세 키 전부), 끌면 그 자리의
                          관절 점이 한꺼번에 갑니다(`movePoseKeyGroupIn`).
                        */}
                        {(channel.id !== "pose"
                          ? keys
                          : poseOpen
                            ? []
                            : joints.length
                              ? keys.filter((key) => joints.some((row) => row.keys.some((item) => item.id === key.id)))
                              : keys
                        ).map((key) => {
                          const on = pickedKey?.kind === "motion" && pickedKey.keyId === key.id;
                          const summary = channel.id === "pose" && joints.length > 0;
                          const ghost =
                            summary && jointGhost && jointGhost.keyId === key.id && jointGhost.bone === ""
                              ? jointGhost.time
                              : null;
                          const bonesHere = summary
                            ? joints.filter((row) => row.keys.some((item) => item.id === key.id)).map((row) => row.label)
                            : [];
                          return (
                            <span
                              key={key.id}
                              onPointerDown={
                                summary
                                  ? dragPoseSummary(target.id, key)
                                  : dragKey({ kind: "motion", targetId: target.id, keyId: key.id }, timeAt)
                              }
                              title={
                                summary
                                  ? `${target.name} · 자세 · ${key.time.toFixed(2)}초 — ${bonesHere.join(", ")} · 끌면 이 관절들이 한 번에 옮겨지고, Delete 면 한 번에 지웁니다`
                                  : `${target.name} · ${t(channel.label)} · ${key.time.toFixed(2)}초 — 끌어서 옮기고, 눌러 고른 뒤 Delete 로 지웁니다`
                              }
                              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
                              style={{ left: `${ratioOf(ghost ?? key.time) * 100}%`, width: 20, height: 18, zIndex: 5, opacity: ghost !== null ? 0.6 : 1 }}
                            >
                              <span
                                className="h-2.5 w-2.5 rotate-45"
                                style={{
                                  background: on
                                    ? "oklch(0.98 0.04 265)"
                                    : inBand(key.id)
                                      ? "oklch(0.86 0.16 60)"
                                      : channel.color,
                                  border: `1px solid ${
                                    on
                                      ? "oklch(0.98 0 0)"
                                      : inBand(key.id)
                                        ? "oklch(0.96 0.10 60)"
                                        : "oklch(0.24 0.02 265)"
                                  }`,
                                }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    {/*
                      ── 관절 줄 ─────────────────────────────────────────────────
                       움직인 관절만, 움직인 구간에 옅은 막대와
                      그 양 끝 점. 이름을 누르면 그 관절을 잡고, 점을 누르면 그 시각으로 가서 잡습니다.
                      점을 끌면 그 관절만 옮겨지고, Delete 면 그 관절만 이 키에서 안 움직입니다.
                    */}
                    {poseOpen &&
                      joints.map((row) => {
                        const holding = activeBone === row.bone && picked;
                        const shown = row.keys.map((key) => {
                          const v = key.bones?.[row.bone] ?? { x: 0, y: 0, z: 0 };
                          const deg = (r: number) => Math.round((r * 180) / Math.PI);
                          return `${key.time.toFixed(2)}초 ${deg(v.x)}°·${deg(v.y)}°·${deg(v.z)}°`;
                        });
                        return (
                          <div key={row.bone} className="flex items-center">
                            <button
                              type="button"
                              onClick={() => onSelectBone?.(target.id, row.bone)}
                              title={`${target.name} · ${row.label} — 누르면 이 관절을 잡습니다\n${shown.join("\n")}`}
                              className="flex h-4 shrink-0 items-center truncate rounded-sm pl-5 text-left text-[9px] font-semibold hover:bg-white/5"
                              style={{
                                ...gutterStyle,
                                color: holding ? "oklch(0.96 0.08 145)" : "oklch(0.68 0.07 145)",
                                background: holding
                                  ? "oklch(0.80 0.15 145 / 16%)"
                                  : gutterStyle.background,
                              }}
                            >
                              <span className="truncate">· {row.label}</span>
                            </button>
                            <div className="relative h-4 flex-1">
                              {row.spans.map((item) => (
                                <span
                                  key={`${item.from}-${item.to}`}
                                  className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-sm"
                                  style={{
                                    left: `${ratioOf(item.from) * 100}%`,
                                    width: `${(ratioOf(item.to) - ratioOf(item.from)) * 100}%`,
                                    background: `color-mix(in oklch, ${channel.color} 30%, transparent)`,
                                  }}
                                />
                              ))}
                              {row.keys.map((key, index) => {
                                const on =
                                  pickedKey?.kind === "joint" &&
                                  pickedKey.keyId === key.id &&
                                  pickedKey.bone === row.bone;
                                const ghost =
                                  jointGhost && jointGhost.keyId === key.id && jointGhost.bone === row.bone
                                    ? jointGhost.time
                                    : null;
                                return (
                                  <span
                                    key={key.id}
                                    onPointerDown={dragJoint(target.id, row.bone, key)}
                                    title={`${row.label} · ${shown[index]} — 누르면 그 시각으로 가서 이 관절을 잡고, 끌면 이 관절만 옮기고, Delete 면 이 관절만 여기서 안 움직입니다`}
                                    className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
                                    style={{ left: `${ratioOf(ghost ?? key.time) * 100}%`, width: 18, height: 14, zIndex: 5 }}
                                  >
                                    <span
                                      className="h-2 w-2 rotate-45"
                                      style={{
                                        background: on ? "oklch(0.98 0.04 265)" : channel.color,
                                        border: `1px solid ${on ? "oklch(0.98 0 0)" : "oklch(0.24 0.02 265)"}`,
                                        opacity: ghost !== null ? 0.6 : 1,
                                      }}
                                    />
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          );
        })}

        <TimelineRoomRows
          state={state}
          setState={setState}
          playhead={playhead}
          span={span}
          gutter={GUTTER}
          ratioOf={ratioOf}
          timeAt={timeAt}
          dragKey={dragKey}
          pickedKey={pickedKey}
          openLayers={openLayers}
          closedLayers={closedLayers}
          toggleLayerOpen={toggleLayerOpen}
          sortByTime={sortByTime}
        />

      </div>
      </div>
      </div>
    </div>
    </TimelineResizePane>,
  );
}

export default PlannerMoveTimeline;
