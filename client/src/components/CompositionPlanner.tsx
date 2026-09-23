import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { sameImmutableJson } from "@/lib/immutableJson";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import CompositionViewport, {
  type TransformConstraint,
} from "@/components/composition/CompositionViewport";
import {
  CameraHelpHint,
  captureFormatFor,
  DropHint,
  FREE_CAPTURE_FORMAT,
  GroundPlaceHint,
  PlannerActionBar,
  PlannerHeader,
  PlannerViewBar,
  PreviewBadge,
  type PanelTabId,
  type PlannerRoomStatus,
} from "@/components/composition/planner/PlannerChrome";
import { LayoutPanel } from "@/components/composition/planner/LayoutPanel";
import { EnvironmentPanel } from "@/components/composition/planner/EnvironmentPanel";
import { PlannerCameraBar } from "@/components/composition/planner/CameraBar";
import { PlannerShotBar } from "@/components/composition/planner/ShotBar";
import { BonePicker } from "@/components/composition/planner/BonePicker";
import { PlannerMoveTimeline } from "@/components/composition/planner/MoveTimeline";
import { TimelinePanel } from "@/components/composition/planner/TimelinePanel";
import type { ProjectDraft } from "@/lib/projectTypes";
import { applyRoomPresetIn, captureRoomPreset, type RoomPreset } from "@/lib/roomPreset";
import { usePlannerPlayback } from "@/components/composition/planner/usePlannerPlayback";
import { usePlannerMedia } from "@/components/composition/planner/usePlannerMedia";
import { useReferenceVideo } from "@/components/composition/planner/useReferenceVideo";
import { DOME_CHIP_ID } from "@/lib/blueprint";
import { isInPanoramaDir } from "@/lib/faceSets";
import {
  type CompositionCharacterSource,
  type CompositionState,
  normalizeComposition,
  summarizeCompositionCamera,
} from "@/lib/composition";
import { assetSrc, deleteProjectMediaFile } from "@/lib/mediaLibrary";
import { confirmDialog } from "@/components/ConfirmDialog";
import {
  addRenderIn,
  backgroundOnOf,
  removeCustomBackgroundIn,
  musicOf,
  roomsOf,
  setRoomBackgroundIn,
  setRoomPlacementIn,
  mergeBonePoseIn,
  patchCameraIn,
  patchCameraMoveIn,
  activeRoomOf,
  roomFitSizeOf,
  withShownPoseIn,
  cameraMoveOf,
  cameraMovesOf,
  evaluateMotionTrack,
  motionTracksOf,
  setBoneRotationIn,
  setGlbClipsIn,
  setRoomDimsIn,
  timelineOf,
  transformObjectGroupIn,
  updateCharacterIn,
  type RoomFaceShell,
} from "@/lib/compositionEdit";
import { useUndoStack } from "@/lib/useUndoStack";
import { settleCompositionEditor, useCompositionControl, type ControlledCapture } from "@/components/composition/planner/useCompositionControl";
import { createPlannerSaveSession } from "@/components/composition/planner/plannerSaveSession";
import { useT } from "@/lib/i18n";
import { withCompositionChangeSource, type CompositionCapture } from "@/lib/compositionControl";
import { isTypingTarget } from "@/lib/isTypingTarget";
import { currentTutorialPage, reportTutorialPage } from "@/lib/tutorialStore";
import { HOLDS_PLANNER } from "@/lib/useTutorialPanel";
import { usePlannerAutoKeys } from "@/components/composition/planner/usePlannerAutoKeys";
import { usePlannerRoomRules } from "@/components/composition/planner/usePlannerRoomRules";
import { usePlannerShortcuts } from "@/components/composition/planner/usePlannerShortcuts";
import PlannerOverlays from "@/components/composition/planner/PlannerOverlays";
import { usePlannerPlaces } from "@/components/composition/planner/usePlannerPlaces";
import { usePlannerAssets } from "@/components/composition/planner/usePlannerAssets";
import { plannerLayerTargets } from "@/lib/plannerLayers";
import type { VisualAsset } from "@/lib/visualAsset";
import { PromptDialogHost } from "@/components/PromptDialog";
import { uid, type Background, type Character } from "@/lib/projectTypes";

/**
 * 구도 잡기.
 *
 * # 무엇을 하는 곳인가
 *
 * 컷 하나의 **카메라와 인물 자리**를 3차원에서 정합니다. 그림을 만드는 곳이
 * 아니라 «어디서 무엇을 보는가» 를 정하는 곳이에요. 여기서 정한 것이 컷
 * 프롬프트의 샷 크기·앵글·무빙이 됩니다.
 *
 * 말로만 「인물이 왼쪽에」 라고 적으면 생성기가 매번 다르게 해석합니다.
 * 여기서 세워 두면 «화면 왼쪽 3분의 1 지점, 카메라에서 4미터» 처럼 잴 수
 * 있는 값이 나옵니다.
 *
 * # 배경을 세우는 세 가지 길
 *
 * - **여섯 면** — 큐브 안쪽에 여섯 장을 붙입니다. 면끼리 안 맞으면 이음매가 보입니다
 * - **파노라마** — 뒤집은 구에 등장방형 한 장을 감습니다. 이음매가 없어 이쪽이 깔끔합니다
 * - **HDRI** — 빛까지 환경맵에서 받습니다. 실내 장면에 특히 좋습니다
 *
 * 파노라마 한 장만 있으면 앱이 여섯 면을 계산으로 잘라낼 수 있습니다
 * (`lib/panorama.ts`). 생성기로 여섯 번 뽑는 것보다 그쪽이 낫습니다 —
 * 확산 모델에는 3차원이 없어서 여섯 장의 경계가 서로 안 맞거든요.
 *
 * # 오른쪽 패널을 탭으로 나눈 이유
 *
 * 섹션을 한 줄로 쌓아두면 배경을 고르는 동안에도 카메라 무빙 카드 스물다섯
 * 장을 지나쳐야 합니다. 실제로는 한 번에 한 가지 일만 하므로 그 일에 필요한
 * 것만 남깁니다.
 *
 * # 파일이 나뉜 자리
 *
 * 이 파일은 상태·되돌리기·저장·탭 전환만 듭니다. 탭 네 개는
 * `composition/planner/*Panel.tsx`, 상태를 바꾸는 순수 함수는
 * `lib/compositionEdit.ts`, 재생·파일 넣기·영상 렌더는 같은 폴더의 훅입니다.
 * 3,300줄 한 파일이던 때는 규칙 하나를 고치면 다른 탭에서 빠뜨렸습니다.
 */

/**
 * «배경 고정» 공중부양 경고를 이미 닫았는가 — **앱을 켜 둔 동안** 기억합니다.
 *
 * 컴포넌트 상태로 두면 구도 창을 닫았다 열 때마다 되살아나서, 알고도 그 높이를
 * 쓰는 사람에게는 잔소리가 됩니다. 저장하지 않는 까닭은 이것이 구도의 값이
 * 아니라 «이 사람이 이번에 안 보겠다고 한 것» 이기 때문입니다.
 */

export interface CompositionPlannerProps {
  cutId?: string;
  onControlCommit?: (composition: CompositionState, captures: CompositionCapture) => Promise<unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 이 컷에 나오는 인물들 */
  characters: Character[];
  /** 고를 수 있는 배경들 */
  backgrounds: Background[];
  composition?: CompositionState;
  /** 화면 비율. 안전틀을 그립니다 */
  aspect?: number;
  onSave: (composition: CompositionState) => void | Promise<void>;
  /**
   * 화면을 찍어 컷으로 넘깁니다 — **두 장**입니다.
   *
   * `guide` 는 인물까지 든 배치 그림(카메라 각도·누가 어디에), `plate` 는 **같은 카메라에서
   * 배경만** 그린 그림입니다. 생성기에는 파노라마 원본이 아니라 이 plate 를 줘야 왜곡 없이
   * 그 컷의 배경이 됩니다().
   */
  onCapture?: (shots: { guide: string; plate: string }) => void | Promise<void>;
  /**
   * 레퍼런스 영상을 저장했을 때 — 컷이 경로와 길이를 받아 둡니다.
   *
   *
   */
  onVideoSaved?: (path: string, seconds: number) => void | Promise<void>;
  /** 인물 이름·키를 여기서 고쳤을 때 프로젝트에 올려보냅니다 */
  onCharacterUpdate?: (
    id: string,
    patch: { name: string; heightCm: number },
  ) => void;
  projectName?: string;
  sceneTitle?: string;
  cutOrder?: number;
  /** 이 컷이 지금 쓰는 레퍼런스 영상 경로. 타임라인의 «뽑아 둔 영상» 목록에서 표시합니다. */
  usedVideoPath?: string;
  /**
   * 이 방 크기로 **장소 카드**를 만들어 프로젝트에 더합니다. 돌려주는 것은 만든 카드의 id —
   * 그 id 를 방에 적어 두고(`CompositionRoom.backgroundId`) 바로 카드 창을 엽니다.
   * 안 주면 그 칸이 안 보입니다(구도잡기를 프로젝트 밖에서 열었을 때).
   */
  onCreatePlace?: (background: Background) => void;
  /** 장소 카드 하나를 고칩니다(프롬프트·그림 등록·자동 6면 커팅이 이 길로 저장됩니다). */
  onPatchBackground?: (
    backgroundId: string,
    updater: (current: Background) => Partial<Background>,
  ) => void;
  /** 장소 카드를 지웁니다(카드 안의 «지우기»). */
  onRemoveBackground?: (backgroundId: string) => void;
  /**
   * **장소 라이브러리** — 걷어낸 «배경» 단계를 창으로 되살립니다.
   *
   *
   *
   * 장소는 구도잡기에서 만들지만, **계보(관계도)와 보유 에셋**은 카드 하나가 아니라 목록 전체를 봐야 하는 일입니다.
   * 그래서 씬 단계에 있던 그 화면(`StepBackgrounds`)을 그대로 창에 띄웁니다 — 새로 짜면 두 자리가 갈라집니다(규칙 1).
   */
  placeLibrary?: {
    draft: ProjectDraft;
    onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
  };
  /**
   * **방 라이브러리** — 프로젝트가 들고 있는 저장된 방들(`ProjectDraft.roomPresets`).
   * 안 주면 그 칸이 안 보입니다.
   */
  /**
   * **배경 에셋**(공용 에셋) 목록과 그것을 고치는 길. 구도잡기 안에서 소품의 에셋 시트를 만들고 잇습니다
   * (). 안 주면 그 단추가 안 보입니다.
   */
  sharedAssets?: VisualAsset[];
  onChangeSharedAssets?: (updater: (current: VisualAsset[]) => VisualAsset[]) => void;
  roomPresets?: RoomPreset[];
  onSaveRoomPreset?: (preset: RoomPreset) => void;
  onRemoveRoomPreset?: (id: string) => void;
}

export default function CompositionPlanner({
  cutId,
  onControlCommit,
  open,
  onOpenChange,
  characters,
  backgrounds,
  composition,
  aspect = 16 / 9,
  onSave,
  onCapture,
  onVideoSaved,
  onCharacterUpdate,
  projectName,
  sceneTitle,
  cutOrder,
  usedVideoPath,
  onCreatePlace,
  onPatchBackground,
  onRemoveBackground,
  placeLibrary,
  sharedAssets,
  onChangeSharedAssets,
  roomPresets,
  onSaveRoomPreset,
  onRemoveRoomPreset,
}: CompositionPlannerProps) {
  const t = useT();
  /*
    ── 열려 있는 동안은 «지금 화면» 이 구도잡기 ──────────────────────────
    
    구도잡기 갈래를 위 띠 목록에 늘 세워 두었더니, 창이 닫힌 채로 «방과 환경» 을 누르면
    가리킬 자리가 하나도 없어 「이 단계의 자리가 지금 화면에 없습니다」 만 떴습니다.

    창은 주소가 없어 `pageForLocation` 이 못 알아봅니다. 그래서 열려 있는 동안만 스스로
    알립니다. 닫을 때 `null` 이 아니라 **덮기 전의 것으로** 되돌리는 까닭 — 프로젝트 껍데기는
    «단계가 바뀔 때만» 알리므로, `null` 로 두면 창을 닫은 뒤 목록이 텅 빕니다.
  */
  useEffect(() => {
    if (!open) return;
    const before = currentTutorialPage();
    reportTutorialPage("planner");
    return () => reportTutorialPage(before);
  }, [open]);

  /*
    ── 되돌리기 ──────────────────────────────────────────────────────────
    구도 작업은 시행착오가 많아 되돌리기가 없으면 손이 묶입니다.

    2026-09-18: **공용 훅으로 바꿨습니다**(`lib/useUndoStack.ts`). 그 훅의 머리말이
    이미 「시트 배치·칸 자르기·구도잡기가 저마다 스택을 따로 들고 있었다… 한 벌로
    모아 한 번 고치면 전부에 먹게 합니다」 라고 적어 두었는데, 정작 구도잡기만
    손수 만든 스택을 그대로 쓰고 있었습니다(규칙 1).

    그래서 여기에는 **고쳐 둔 것이 안 와 있었습니다.** 옛 스택은 두 판을 `!==` 로만
    견주어서, 손잡이를 한 번 끌면 프레임마다 판이 쌓이고 쉰 칸 제한에 걸려 **그 드래그
    하나가 되돌리기 기록 전체를 밀어냈습니다**(지시 263 과 같은 사고). 공용 훅은
    JSON 으로 견주고 `replace`·`mark` 로 «되돌리기 단위» 를 나눕니다.
  */
  const history = useUndoStack<CompositionState>(() => normalizeComposition(composition), {
    limit: 50,
  });
  const state = history.value;
  const currentState = useRef(state);
  currentState.current = state;
  const saveCallbacks = useRef({ onSave, onControlCommit, onCapture });
  saveCallbacks.current = { onSave, onControlCommit, onCapture };
  const [saveSession] = useState(() => ({ current: createPlannerSaveSession(state) }));
  const uiSaving = useRef(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [cameraRestoreRequest, setCameraRestoreRequest] = useState(0);
  const setState = history.set;
  /** 되돌리기에 안 쌓는 변경 — «사람이 한 편집» 이 아닌 것(자동 키·방 자동 맞춤). */
  const setStateRaw = history.replace;
  const undo = useCallback(() => withCompositionChangeSource(
    cutId && projectName ? { projectName, cutId } : null, "undo", () => flushSync(history.undo),
  ), [cutId, projectName, history.undo]);
  const redo = useCallback(() => withCompositionChangeSource(
    cutId && projectName ? { projectName, cutId } : null, "redo", () => flushSync(history.redo),
  ), [cutId, projectName, history.redo]);

  useEffect(() => {
    if (open) {
      // 창을 열 때는 기록까지 비웁니다 — 지난번 작업을 되돌릴 수 있으면 안 됩니다.
      const opened = normalizeComposition(composition);
      history.reset(opened);
      saveSession.current.reset(opened);
      /*
        «클릭을 기다리는 모드» 는 열 때마다 꺼 둡니다.

        이 창은 컷 카드마다 **항상 마운트**되어 있어서(`open` 은 Dialog 에만 갑니다)
        닫아도 화면 상태가 그대로 남습니다. 구도는 위에서 새로 읽어 오는데 모드만
        남으면, 다시 열었을 때 지난번에 찍어 둔 점이 **이번 카메라와 상관없는 자리**에
        떠 있고 클릭도 계속 «맞추기» 로 먹힙니다 — 켠 적이 없으니 끄는 단추를 찾을
        생각도 못 합니다. «바닥에 세우기» 도 같은 이유로 함께 끕니다.
      */
      setGroundPlacing(false);
    }
  }, [open, composition]);

  // ── 화면 상태 ─────────────────────────────────────────────────────────
  /*
    탭은 저장본에 안 들어갑니다 — 열 때마다 «배치» 부터입니다. «카메라» 탭은 없앴고
    (손잡이를 전부 화면 아래 타임라인으로 옮겼습니다) 갈래 이름만 타입에 남아 있습니다.
  */
  const [panelTab, setPanelTab] = useState<PanelTabId>("layout");
  const [selected, setSelected] = useState<string>("none");

  /*
    ── Tab = 관절 고르기 ─────────────────────────────────────────────────
    

    **인물을 잡았을 때만** 엽니다. 소품·GLB 에는 관절이 없어서, 아무 때나 열면 빈 목록이
    뜹니다. 입력칸 안에서는 Tab 이 다음 칸으로 가야 하므로 건너뜁니다 — 수치를 치다가
    창이 열리면 값을 못 넘깁니다.
  */
  useEffect(() => {
    if (!open) return;
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (isTypingTarget(event.target)) return;
      if (!selected.startsWith("character:")) return;
      event.preventDefault();
      setBonePicker((open) => (open ? null : { ...pointerRef.current }));
    };
    window.addEventListener("keydown", onTab);
    return () => window.removeEventListener("keydown", onTab);
  }, [open, selected]);

  /*
    고른 것이 바뀌면 관절 창을 닫고 **잡아 둔 관절도 놓습니다.**

     파이 메뉴는
    «지금 잡은 관절» 이 있으면 그 고리부터 여는데, 옛 관절이 남아 있으면 엉뚱한 데서
    시작합니다. 인물을 다시 고르는 것은 대개 «다른 데를 만지려고» 입니다.
  */
  /*
    타임라인 관절 줄에서 «이 인물의 이 관절» 을 잡을 때 — 인물을 바꿔 고르면 바로 위 규칙이
    관절을 놓아 버리므로, 잡을 관절을 잠깐 맡겨 두었다가 선택이 바뀐 뒤에 잡습니다.
  */
  const pendingBoneRef = useRef<string | null>(null);
  useEffect(() => {
    setBonePicker(null);
    setActiveBone(pendingBoneRef.current);
    pendingBoneRef.current = null;
  }, [selected]);

  /*
    마우스 자리를 계속 적어 둡니다. Tab 을 누른 **그 순간**의 커서가 파이 메뉴의 한가운데라,
    키를 받고 나서는 알 길이 없습니다(키 이벤트에는 좌표가 없습니다).
    상태가 아니라 ref 인 까닭: 마우스가 움직일 때마다 다시 그릴 이유가 없습니다.
  */
  const pointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!open) return;
    const onMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [open]);
  const [transformMode, setTransformMode] = useState<
    "translate" | "rotate" | "scale"
  >("translate");
  const [transformConstraint, setTransformConstraint] =
    useState<TransformConstraint>("ground");
  const [activeBone, setActiveBone] = useState<string | null>(null);
  /**
   * Tab 으로 여는 관절 고르기. 인물을 잡았을 때만 열리고, **마우스 자리**가 원의 중심이 됩니다.
   * null 이면 닫힘 — 자리를 같이 들고 있어야 열릴 때의 커서 자리를 쓸 수 있습니다.
   */
  const [bonePicker, setBonePicker] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [boneTransformMode, setBoneTransformMode] = useState<
    "translate" | "rotate"
  >("rotate");
  const [fineSnap, setFineSnap] = useState(true);
  /** 켜면 3D 화면의 앵커에 이동 기즈모가 붙습니다. 다른 선택보다 우선합니다. */
  const [anchorGizmo, setAnchorGizmo] = useState(false);
  /** 켜면 화면을 찍은 자리(y=0)로 고른 인물을 옮깁니다. 저장은 기존 편집 경로라 Ctrl+Z 가 먹습니다. */
  const [groundPlacing, setGroundPlacing] = useState(false);
  /**
   * 세트를 걸 **껍질**. 세트 이름이 «…외벽» 이면 자동으로 바깥으로 가므로 여기는 늘 안쪽입니다.
   *
   * 낱장으로 한 면씩 고르는 칸은 걷었습니다().
   * 전체보기도 이제 **세트 목록**입니다 — 고르면 여섯 면이 한 번에 걸립니다.
   */
  const faceShell: RoomFaceShell = "inner";
  const [galleryOpen, setGalleryOpen] = useState(false);
  /** 장소 라이브러리(옛 «배경» 단계) 창. 계보·보유 에셋을 여기서 봅니다. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** 「다른 작품에서 방 끌어오기」 창이 열려 있는가. */
  const [roomBorrowOpen, setRoomBorrowOpen] = useState(false);
  const [blenderPrompt, setBlenderPrompt] = useState<string | null>(null);
  /** «영상에서 모션 가져오기» 창. 열린 순간의 재생 위치를 «넣을 자리» 기본값으로 넘깁니다. */
  const [motionCaptureAt, setMotionCaptureAt] = useState<number | null>(null);
  /**
   * 타임라인 인물 줄에서 **오른쪽 단추**를 눌렀을 때 뜨는 메뉴.
   *
   *
   *
   * 메뉴를 **타임라인이 아니라 여기서** 띄우는 까닭: 고를 모션 목록과 모캡 창을 이 화면이
   * 들고 있습니다. 타임라인이 그것을 알면 두 화면이 서로를 끌어안습니다.
   */
  const [motionMenu, setMotionMenu] = useState<{
    targetId: string;
    targetName: string;
    sourceId?: string;
    sourceName?: string;
    x: number;
    y: number;
  } | null>(null);
  /** 모캡 창을 **무엇을 하러** 여는가 — 그 줄과 그 사람을 미리 골라 둡니다. */
  const [motionIntent, setMotionIntent] = useState<{
    characterId: string;
    sourceId?: string;
    /** 열자마자 다시 분석할지(«재분석» 으로 왔을 때). */
    reanalyze?: boolean;
  } | null>(null);
  /** 지시문 창의 제목 — 블렌더 지시문과 6면 프롬프트가 같은 창을 씁니다. */
  const [promptTitle, setPromptTitle] = useState("블렌더 작업 지시문");
  const [dropActive, setDropActive] = useState(false);
  const [captureAspect, setCaptureAspect] = useState(aspect);

  // 패널 섹션 접힘 상태. 기본값은 자주 쓰는 영역만 펼쳐둡니다.
  // 탭을 오가도 접힌 상태가 남아야 해서 탭이 아니라 여기서 듭니다.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    characters: true,
    pose: true,
    objects: true,
    faces: true,
    faceSets: true,
    backgrounds: true,
    panorama: false,
    hdri: false,
    cameraMove: true,
    glb: true,
    video: true,
  });
  const toggleSection = (key: string) =>
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));

  const captureRef = useRef<ControlledCapture | null>(null);

  // ── 재생 ──────────────────────────────────────────────────────────────
  const timeline = timelineOf(state);
  /*
    지금 고른 무빙 클립. 카메라 탭과 하단 타임라인이 같은 것을 가리켜야 해서 여기 둡니다.
    고른 것이 없으면 첫 클립을 봅니다 — 탭을 열자마자 만질 것이 있어야 합니다.
  */
  /*
    `selected` 는 «character:abc» 처럼 갈래가 붙은 이름표입니다. 트랙·앵커는 갈래 없이
    **순수 id** 로 찾으므로 여기서 한 번 벗겨 둡니다 — 벗기지 않고 넘겼다가 동선 찍기와
    앵커 걸기가 조용히 아무 일도 안 했습니다(, 「대상 동선 찍기 버튼 여전히 동작하지 않음」).
  */
  const selectedTargetId = selected.includes(":")
    ? selected.slice(selected.indexOf(":") + 1)
    : "";

  const [selectedMoveId, setSelectedMoveId] = useState<string | null>(null);
  const cameraMoves = cameraMovesOf(state);
  const cameraMove =
    cameraMoveOf(state, selectedMoveId) ?? cameraMoves[0] ?? null;
  /*
    노래를 올렸으면 재생할 때 **같이 울립니다**. 경로는 파일이라 `assetSrc` 로 바꿔 넘깁니다 —
    데스크톱이 아니면 빈 문자열이 되어 소리 없이 돕니다.
  */
  const music = musicOf(state);
  const playback = usePlannerPlayback(
    timeline.duration,
    music ? { src: assetSrc(music.path), offset: music.offset ?? 0 } : null,
  );
  const {
    playing,
    setPlaying,
    previewing,
    setPreviewing,
    playhead,
    playheadRef,
    previewingRef,
    playingRef,
    seek,
  } = playback;

  // ── 인물 ──────────────────────────────────────────────────────────────
  /** 프로젝트 캐릭터와 마네킹을 같은 모양으로 봅니다. */
  const plannerCharacters = useMemo<CompositionCharacterSource[]>(
    () => [
      ...characters.map((character) => ({
        id: character.id,
        name: character.name || "이름 없음",
        gender: character.gender,
        heightCm: character.heightCm ?? 170,
      })),
      ...state.mannequins.map((mannequin) => ({
        id: mannequin.id,
        name: mannequin.name,
        gender: mannequin.gender,
        heightCm: mannequin.heightCm,
        build: mannequin.build,
      })),
    ],
    [characters, state.mannequins],
  );

  /** 인물 id → 키(cm). 구도 요약과 방 크기 계산이 같은 표를 봅니다. */
  const characterHeights = useMemo(
    () =>
      Object.fromEntries(
        plannerCharacters.map((item) => [item.id, item.heightCm]),
      ),
    [plannerCharacters],
  );

  /** «바닥에 세우기» 가 옮길 인물 이름. 뷰포트와 같은 규칙 — 고른 인물, 없으면 첫 인물. */
  const groundTargetName = useMemo(() => {
    const visible = state.characters.filter((item) => !item.hidden);
    if (!visible.length) return null;
    const pickedId = selected.startsWith("character:")
      ? selected.slice(10)
      : null;
    const placement =
      visible.find((item) => item.characterId === pickedId) ?? visible[0];
    return (
      plannerCharacters.find((item) => item.id === placement.characterId)
        ?.name ?? "인물"
    );
  }, [state.characters, selected, plannerCharacters]);

  // ── 배경 · GLB 파일 넣기 ──────────────────────────────────────────────
  const media = usePlannerMedia({
    state,
    setState,
    backgrounds,
    open,
    projectName,
    sceneTitle,
    setPreviewing,
    faceShell,
  });

  /*
    장소 카드(방·벽) — 만들기와, 그림이 들어오면 자동으로 거는 일까지 한 흐름입니다.
    까닭은 `usePlannerPlaces` 머리말에.
  */
  const {
    placeOpen,
    setPlaceOpen,
    wallImageFor,
    setWallImageFor,
    setWallPlaceId,
    activePlace,
    openPlace,
    createPlaceForRoom,
    createWallImage,
  } = usePlannerPlaces({
    open,
    state,
    setState,
    backgrounds,
    sceneTitle,
    onCreatePlace,
    media,
  });


  /** 타임라인 트랙 줄에 보여 줄 이름표 — 인물은 이름, 소품은 라벨. */
  const targetNames = useMemo(() => {
    const table: Record<string, string> = {};
    for (const item of plannerCharacters) table[item.id] = item.name;
    for (const item of state.objects) table[item.id] = item.label;
    return table;
  }, [plannerCharacters, state.objects]);

  /** 타임라인에 줄로 세울 대상(인물·소품·GLB). 색 규칙은 `plannerLayerTargets`. */
  const layerTargets = useMemo(
    () => plannerLayerTargets(state, plannerCharacters),
    [state, plannerCharacters],
  );

  const { roomFaceImages } = media;

  /* 소품에 걸 «바꿔 그릴 시트» 와 자리에서 바로 만드는 에셋 카드. */
  const {
    swapOptions,
    assetsOpen,
    setAssetsOpen,
    openAssetId,
    setOpenAssetId,
    createAssetForObject,
    createAssetForGroup,
  } = usePlannerAssets({
    state,
    setState,
    characters,
    backgrounds,
    sharedAssets,
    onChangeSharedAssets,
  });

  /*
    ── 스스로 도는 규칙들 ────────────────────────────────────────────────
    자동 키·단축키·방 규칙은 셋 다 «화면에 안 보이는 규칙» 이라 훅으로 뺐습니다.
    셋 다 되돌리기에는 안 쌓습니다(`setStateRaw`) — 사람이 한 편집이 아니니까요.
  */
  usePlannerAutoKeys({
    open,
    playing,
    state,
    setState: setStateRaw,
    playheadRef,
    cameraMove,
    playhead,
  });
  usePlannerRoomRules({
    open,
    state,
    setState: setStateRaw,
    characterHeights,
    faceSets: media.faceSets,
    backgroundFaceImages: media.backgroundFaceImages,
  });
  usePlannerShortcuts({
    open,
    playing,
    setPlaying,
    undo,
    redo,
    setState,
    playheadRef,
    selectedTargetId,
    transformMode,
    activeBone,
    characters: state.characters,
    targetNames,
  });

  const freeView = !captureAspect;
  const captureFormat = captureFormatFor(captureAspect);
  const video = useReferenceVideo({
    captureFormat,
    timeline,
    cameraMove,
    projectName,
    sceneTitle,
    cutOrder,
    setPlaying,
    setPreviewing,
    onVideoSaved,
    /*
      뽑은 영상은 **구도가 들고 있습니다**(). 컷에 적히는 것은 통째로 뽑은 한 편이고,
      여기 목록에는 조각까지 남아 나중에 «그때 그 12초짜리» 를 다시 고를 수 있습니다.
    */
    onRendered: ({ path, seconds, part }) =>
      setState((current) =>
        addRenderIn(current, {
          id: uid(),
          path,
          seconds,
          at: new Date().toISOString(),
          part,
        }),
      ),
  });

  const persist = async <T,>(saved: CompositionState, write: () => Promise<T>) => {
    setSaveBusy(true);
    try { return await saveSession.current.persist(saved, write); }
    finally { if (!uiSaving.current) setSaveBusy(false); }
  };
  const control = useCompositionControl({
    open,
    identity: cutId && projectName ? { cutId, projectName, sceneTitle, cutOrder } : null,
    history,
    context: { characterIds: characters.map(item => item.id), imageIds: media.availableBackgrounds.map(item => item.id) },
    capture: () => captureRef.current,
    stopPlayback: () => { setPlaying(false); setPreviewing(false); },
    exportVideo: video.exportVideo,
    commit: onControlCommit
      ? (saved, captures) => persist(saved, () => onControlCommit(saved, captures))
      : undefined,
  });

  const requestClose = () => {
    if (uiSaving.current || saveSession.current.saving) return;
    void saveSession.current.requestClose(
      () => currentState.current,
      () => confirmDialog({
        title: t("저장하지 않은 구도 변경을 버릴까요?"),
        description: t("마지막으로 저장한 뒤 바꾼 내용은 사라집니다."),
        confirmLabel: t("변경 버리고 닫기"),
        cancelLabel: t("계속 편집"),
        tone: "danger",
      }),
      () => onOpenChange(false),
    );
  };
  const saveAndClose = async () => {
    if (uiSaving.current || saveSession.current.saving) return;
    uiSaving.current = true;
    setSaveBusy(true);
    const opened = saveSession.current.generation;
    let stateSaved = false;
    try {
      flushSync(() => { setPlaying(false); setPreviewing(false); });
      await settleCompositionEditor();
      const saved = currentState.current;
      // 캡처가 실패해도 작업한 구도 자체는 먼저 파일에 남깁니다. 확인을 받기 전에는 닫지 않습니다.
      await persist(saved, async () => { await saveCallbacks.current.onSave(saved); });
      stateSaved = true;
      if (saveSession.current.generation !== opened) return;
      if (!sameImmutableJson(currentState.current, saved)) {
        toast.message(t("저장하는 동안 구도가 바뀌었습니다. 새 변경은 계속 편집할 수 있습니다."));
        return;
      }
      if (saveCallbacks.current.onControlCommit || saveCallbacks.current.onCapture) {
        const captures = await control.capture();
        if (!sameImmutableJson(currentState.current, saved)) {
          toast.message(t("저장하는 동안 구도가 바뀌었습니다. 새 변경은 계속 편집할 수 있습니다."));
          return;
        }
        await persist(saved, async () => {
          // 첫 저장이 동명 프로젝트의 폴더를 바꿀 수 있어, 이전 렌더의 경로를 쥔 콜백은 쓰지 않습니다.
          const callbacks = saveCallbacks.current;
          if (callbacks.onControlCommit) await callbacks.onControlCommit(saved, captures);
          else await callbacks.onCapture?.(captures);
        });
      }
      if (saveSession.current.generation !== opened) return;
      if (saveSession.current.isDirty(currentState.current)) {
        toast.message(t("저장하는 동안 구도가 바뀌었습니다. 새 변경은 계속 편집할 수 있습니다."));
        return;
      }
      onOpenChange(false);
      toast.success(t("구도를 저장하고 컷에 넘겼습니다."));
    } catch (error) {
      toast.error(t(stateSaved ? "구도는 저장했지만 미리보기 저장을 끝내지 못했습니다." : "구도를 저장하지 못했습니다."), {
        description: t(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      uiSaving.current = false;
      setSaveBusy(false);
    }
  };

  // ── 구도 요약 ─────────────────────────────────────────────────────────
  const summary = useMemo(
    () =>
      summarizeCompositionCamera(state, {
        heightsCm: characterHeights,
        aspect: captureAspect || FREE_CAPTURE_FORMAT.id,
      }),
    [state, characterHeights, captureAspect],
  );

  // ── 방 · 공중부양 경고 ────────────────────────────────────────────────
  /** 도구줄에 넘길 것 — 이제 방 한 변 하나뿐입니다. */
  const room: PlannerRoomStatus = { size: roomFitSizeOf(state) };

  const sectionToggles = { openSections, toggleSection };

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}>
      <DialogContent
        tutorialHolds={HOLDS_PLANNER}
        showCloseButton={false}
        className="h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none border-0 p-0 text-white sm:max-w-none"
        style={{ background: "oklch(0.13 0.009 265)" }}
      >
        <DialogTitle className="sr-only">{t("구도 잡기")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("카메라와 인물 자리를 3차원에서 정합니다")}
        </DialogDescription>

        <div className="relative flex h-full min-h-0 min-w-0 flex-col">
          {/* ── 머리줄 ─────────────────────────────────────────────── */}
          <PlannerHeader
            summary={summary}
            onUndo={undo}
            onRedo={redo}
            onClose={requestClose}
          />

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* ── 3D 화면 ───────────────────────────────────────────── */}
            <div data-composition-stage className="relative flex min-h-0 items-center justify-center p-4">
              <div
                className="relative max-h-full max-w-full"
                style={{
                  ...(freeView
                    ? // «3D 배치» — 프레임 없이 남은 공간을 전부 씁니다.
                      { width: "100%", height: "100%" }
                    : {
                        aspectRatio: `${captureFormat.width} / ${captureFormat.height}`,
                        width: `min(100%, calc((100vh - 12rem) * ${captureFormat.width / captureFormat.height}))`,
                      }),
                  /*
                    «여기까지 몇 미터» 를 켠 동안은 커서를 십자로.
                    캔버스가 커서를 비워 두므로(`groundPlacing` 이펙트) 여기서 준 것이
                    그대로 내려갑니다. «바닥에 세우기» 도 십자라 손이 같은 것을 기대합니다 —
                    모드를 켰는데 커서가 그대로면 켜졌는지 화면으로 알 길이 없습니다.
                  */
                }}
                // 배경·HDRI·GLB 를 화면에 바로 떨어뜨려 넣습니다.
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!dropActive) setDropActive(true);
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  )
                    setDropActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropActive(false);
                  Array.from(event.dataTransfer.files || []).forEach(
                    (file) => void media.handleDroppedFile(file),
                  );
                }}
              >
                <div
                  data-tour="planner-viewport"
                  className="absolute inset-0 overflow-hidden rounded-lg"
                  style={{
                    background: "oklch(0.08 0.006 265)",
                    border: "1px solid oklch(1 0 0 / 10%)",
                  }}
                >
                  <CompositionViewport
                    composition={state}
                    characters={plannerCharacters}
                    aspect={captureAspect}
                    roomFaceImages={roomFaceImages}
                    selected={selected}
                    onSelect={setSelected}
                    transformMode={transformMode}
                    onTransformMode={setTransformMode}
                    transformConstraint={transformConstraint}
                    onTransformConstraint={setTransformConstraint}
                    activeBone={activeBone}
                    boneTransformMode={boneTransformMode}
                    fineSnap={fineSnap}
                    cameraMoves={cameraMoves}
                    cameraMove={cameraMove}
                    anchorGizmo={anchorGizmo && !!cameraMove?.showAnchor}
                    groundPlacing={groundPlacing}
                    playheadRef={playheadRef}
                    playhead={playhead}
                    previewing={previewing}
                    cameraRestoreRequest={cameraRestoreRequest}
                    previewingRef={previewingRef}
                    // 배경 영상을 돌릴지 멈출지 — «미리보기» 와 달리 시계가 정말 도는 동안만 참입니다.
                    playingRef={playingRef}
                    onPreviewInterrupt={() => {
                      setPlaying(false);
                      setPreviewing(false);
                    }}
                    onCharacterTransform={(id, patch) =>
                      setState((current) =>
                        updateCharacterIn(current, id, patch),
                      )
                    }
                    /*
                      묶음에 속한 소품을 끌면 **덩어리가 통째로** 따라옵니다
                      ().
                      회전·크기는 덩어리의 한가운데를 축으로 돌아야 모양이 안 흩어집니다.
                    */
                    onObjectTransform={(id, patch) =>
                      setState((current) =>
                        transformObjectGroupIn(current, id, patch),
                      )
                    }
                    onGlbTransform={media.updateGlb}
                    /*
                      Shift 로 잡은 **방**을 화면에서 옮긴 결과입니다. 크기는 기즈모의 배율이라
                      방 치수에 곱해 넣습니다 — 실외는 늘 가운데에 서므로 자리는 `setRoomPlacementIn` 이 지킵니다.
                    */
                    onRoomTransform={(id, patch) =>
                      setState((current) => {
                        const room = roomsOf(current).find((item) => item.id === id);
                        if (!room) return current;
                        const moved = setRoomPlacementIn(current, id, {
                          x: patch.position.x,
                          y: patch.position.y,
                          z: patch.position.z,
                          rotationY: patch.rotationY,
                        });
                        const grew =
                          Math.abs(patch.scale.x - 1) > 0.001 ||
                          Math.abs(patch.scale.y - 1) > 0.001 ||
                          Math.abs(patch.scale.z - 1) > 0.001;
                        return grew
                          ? setRoomDimsIn(
                              moved,
                              {
                                width: room.width * patch.scale.x,
                                depth: room.depth * patch.scale.z,
                                height: room.height * patch.scale.y,
                              },
                              id,
                              true,
                            )
                          : moved;
                      })
                    }
                    /* 자세 트랙이 있으면 **보이는 자세** 위에 덧씌웁니다 — 까닭은 `withShownPoseIn`. */
                    onBonePose={(characterId, bone, rotation) =>
                      setState((current) =>
                        setBoneRotationIn(
                          withShownPoseIn(current, characterId, playheadRef.current),
                          characterId,
                          bone,
                          rotation,
                        ),
                      )
                    }
                    onBonePoseBatch={(characterId, entries) =>
                      setState((current) =>
                        mergeBonePoseIn(
                          withShownPoseIn(current, characterId, playheadRef.current),
                          characterId,
                          entries,
                        ),
                      )
                    }
                    onAnchorChange={(anchor) =>
                      setState((current) =>
                        cameraMove
                          ? patchCameraMoveIn(current, cameraMove.id, {
                              anchor,
                            })
                          : current,
                      )
                    }
                    onCameraChange={(pose) =>
                      setState((current) => patchCameraIn(current, pose))
                    }
                    // 바뀐 게 없으면 setGlbClipsIn 이 current 를 그대로 돌려줍니다.
                    // 새 객체를 만들면 씬 재빌드 → 콜백 재호출 → 무한 루프입니다.
                    onGlbClips={(id, clips, duration) =>
                      setState((current) =>
                        setGlbClipsIn(current, id, clips, duration),
                      )
                    }
                    onCaptureReady={(capture) => {
                      captureRef.current = capture;
                    }}
                    onVideoRenderReady={(frameRenderer) => {
                      video.videoRendererRef.current = frameRenderer;
                    }}
                  />
                </div>

                {previewing && (
                  <PreviewBadge playing={playing} playhead={playhead} />
                )}

                {dropActive && <DropHint />}
              </div>

              <PlannerViewBar
                captureAspect={captureAspect}
                setCaptureAspect={setCaptureAspect}
              >
                {/* 샷 크기·조작 속도는 화면을 보면서 돌리는 값이라 오른쪽 패널이 아니라 여기 둡니다. */}
                <PlannerCameraBar
                  state={state}
                  setState={setState}
                  setStateRaw={setStateRaw}
                  mark={history.mark}
                />
                {/* 저장해 둔 구도도 «화면을 보면서» 오가는 것이라 같은 줄에 둡니다. */}
                <PlannerShotBar state={state} setState={setState} onGoToShot={() => {
                  // 저장 좌표가 같아도 화면은 타임라인의 다른 시점을 보고 있을 수 있습니다.
                  previewingRef.current = false;
                  playingRef.current = false;
                  setPlaying(false);
                  setPreviewing(false);
                  setCameraRestoreRequest((request) => request + 1);
                }} />
              </PlannerViewBar>

              {/*
                무빙 타임라인은 **3D 화면 아래**입니다 (). 오른쪽 패널이 아니라 화면 밑에 두는 까닭은, 클립을 끄는
                동안 3D 가 그 시각으로 따라 움직이는 것을 봐야 하기 때문입니다.
              */}
              {bonePicker && (
                <BonePicker
                  activeBone={activeBone}
                  origin={bonePicker}
                  onSelect={setActiveBone}
                  onClose={() => setBonePicker(null)}
                />
              )}

              {/*
                안내 문구와 타임라인을 **한 덩어리로** 쌓습니다. 둘 다 `bottom-6` 에
                떠 있어서 서로 겹쳤습니다().
                흐름으로 쌓으면 타임라인 높이가 바뀌어도 문구가 알아서 위로 밀립니다.
              */}
              <div className="absolute inset-x-6 bottom-6 z-10">
                <CameraHelpHint />
                <PlannerMoveTimeline
                  state={state}
                  setState={setState}
                  onMotionMenu={setMotionMenu}
                  duration={timeline.duration}
                  playhead={playhead}
                  onSeek={(time) => {
                    setPreviewing(true);
                    seek(time);
                  }}
                  selectedId={cameraMove?.id ?? null}
                  setSelectedId={setSelectedMoveId}
                  selectedTargetId={selectedTargetId}
                  targetNames={targetNames}
                  layerTargets={layerTargets}
                  onSelectTarget={(target) => setSelected(`${target.kind}:${target.id}`)}
                  activeBone={activeBone}
                  onSelectBone={(targetId, bone) => {
                    const key = `character:${targetId}`;
                    if (selected === key) setActiveBone(bone);
                    else {
                      pendingBoneRef.current = bone;
                      setSelected(key);
                    }
                    // 오른쪽에 그 관절 수치가 보이게 — 배치 탭의 «포즈» 칸을 엽니다.
                    setPanelTab("layout");
                    setOpenSections((current) => ({ ...current, pose: true }));
                  }}
                  selectedMove={cameraMove}
                  /*
                    앵커로 쓸 자리 — 인물·소품의 **가슴 높이**. 사람을 중심으로 돌 때
                    발밑을 축으로 잡으면 머리가 화면 밖으로 휘둘립니다.
                  */
                  anchorOf={(targetId, ratio) => {
                    /*
                      **지금 시각의 자리**를 씁니다.
                      동선 트랙이 있으면 상태에 적힌 자리는 «키를 찍던 그때» 이고 화면에
                      서 있는 자리는 재생 머리가 정한 자리라, 그대로 쓰면 어긋납니다.
                    */
                    const moved = motionTracksOf(state).find(
                      (track) =>
                        track.targetId === targetId &&
                        track.channel === "position",
                    );
                    const here =
                      (moved && evaluateMotionTrack(moved, playhead)) || null;
                    const character = state.characters.find(
                      (item) => item.characterId === targetId,
                    );
                    if (character) {
                      const height = (characterHeights[targetId] ?? 170) / 100;
                      const at = here ?? character.position;
                      return {
                        x: at.x,
                        y: at.y + height * ratio,
                        z: at.z,
                      };
                    }
                    const object = state.objects.find(
                      (item) => item.id === targetId,
                    );
                    if (!object) return null;
                    const at = here ?? object.position;
                    return {
                      x: at.x,
                      // 소품은 «키» 가 크기라, 같은 비율을 상자 높이에 곱합니다.
                      y: at.y + object.scale.y * ratio,
                      z: at.z,
                    };
                  }}
                  anchorGizmo={anchorGizmo}
                  onAnchorGizmo={setAnchorGizmo}
                  playing={playing}
                  playheadLineRef={playback.playheadLineRef}
                  onPlay={(next) => {
                    setPreviewing(true);
                    if (next) seek(0);
                    setPlaying(next);
                  }}
                />
              </div>

              <PlannerActionBar
                backgroundOn={backgroundOnOf(state)}
                room={room}
                showFloor={state.showFloor}
                groundPlacing={groundPlacing}
                /* 축척 맞추기와 서로 배타 — 둘 다 클릭을 기다리면 어느 쪽이 먹을지 알 수 없습니다. */
                setGroundPlacing={(value) => {
                  setGroundPlacing(value);
                }}
                panelTab={panelTab}
                setPanelTab={setPanelTab}
                characterCount={plannerCharacters.length}
                setState={setState}
                saving={saveBusy}
                onSave={() => void saveAndClose()}
              />

              {groundPlacing && (
                <GroundPlaceHint targetName={groundTargetName} />
              )}
            </div>

            {/* ── 오른쪽 패널 ───────────────────────────────────────── */}
            <aside
              className="composition-scroll min-h-0 space-y-3 overflow-y-auto p-4"
              style={{
                background: "oklch(0.15 0.01 265)",
                borderLeft: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              {panelTab === "layout" && (
                <LayoutPanel
                  /*
                    관절 수치·프리셋 칸은 **지금 시각의 자세**를 보여 줍니다. 상태 값을 보여 주면 3초에서
                    본 숫자가 1초에 만진 숫자라, 그 숫자를 바탕으로 고친 관절이 엉뚱한 자세로 찍힙니다.
                    고른 인물만 바꿉니다 — 다른 칸은 상태 그대로.
                  */
                  state={
                    selectedTargetId && !playing
                      ? withShownPoseIn(state, selectedTargetId, playhead)
                      : state
                  }
                  setState={setState}
                  plannerCharacters={plannerCharacters}
                  swapOptions={swapOptions}
                  wallImages={media.listedBackgrounds}
                  onCreateWallImage={onCreatePlace ? createWallImage : undefined}
                  onCreateAsset={onChangeSharedAssets ? createAssetForObject : undefined}
                  onCreateGroupAsset={onChangeSharedAssets ? createAssetForGroup : undefined}
                  selected={selected}
                  setSelected={setSelected}
                  transformMode={transformMode}
                  setTransformMode={setTransformMode}
                  transformConstraint={transformConstraint}
                  setTransformConstraint={setTransformConstraint}
                  activeBone={activeBone}
                  setActiveBone={setActiveBone}
                  boneTransformMode={boneTransformMode}
                  setBoneTransformMode={setBoneTransformMode}
                  fineSnap={fineSnap}
                  setFineSnap={setFineSnap}
                  onCharacterUpdate={onCharacterUpdate}
                  {...sectionToggles}
                />
              )}

              {panelTab === "environment" && (
                <EnvironmentPanel
                  setStateRaw={setStateRaw}
                  mark={history.mark}
                  state={state}
                  setState={setState}
                  listedBackgrounds={media.listedBackgrounds}
                  faceSets={media.faceSets}
                  assignFaceSet={media.assignFaceSet}
                  assignPanorama={media.assignPanorama}
                  /*
                    밖에서 만든 360° 그림을 **바로** 들여옵니다(). 여기 한 줄만 이으면 `usePlannerMedia` 가 목록 등록·비율 재기·
                    프로젝트 폴더 저장까지 이미 다 합니다 — 6면·HDRI 가 지나는 그 길입니다.
                  */
                  onImportPanorama={(file) => media.addCustomBackground(file, "panorama")}
                  /*
                    **지우면 폴더의 원본도 지웁니다**(공통 규칙 3). 파일이 남으면 폴더를 다시 읽을 때
                    목록에 되살아나, 를 겪습니다.
                  */
                  onDeletePanorama={async (background) => {
                    const ok = await confirmDialog({
                      title: `«${background.name}» 을 지울까요?`,
                      description:
                        "저장 폴더의 원본 파일도 함께 지워집니다. 되돌릴 수 없습니다.",
                      confirmLabel: "지우기",
                      tone: "danger",
                    });
                    if (!ok) return;
                    if (projectName && background.filePath) {
                      await deleteProjectMediaFile(projectName, background.filePath).catch(() => null);
                    }
                    setState((current) => removeCustomBackgroundIn(current, background.id));
                  }}
                  onCreatePlace={onCreatePlace ? createPlaceForRoom : undefined}
                  onOpenPlace={activePlace && onPatchBackground ? () => setPlaceOpen(true) : undefined}
                  /*
                     벽 그림 카드는 방에 거는 장소가 아니고, 실외에는 돔(파노라마)
                    카드만 뜹니다.
                  */
                  places={backgrounds
                    .filter((item) => item.usage !== "wall")
                    // 호리존 방에는 장소 카드가 없습니다 — 목록 자체를 비웁니다.
                    .filter(() => !activeRoomOf(state).horizon)
                    .filter((item) =>
                      activeRoomOf(state).outdoor
                        ? // 돔 표시·돔 칩·**파노라마 폴더에 있는 그림** 셋 중 하나면 실외 것입니다.
                          // 폴더로도 가리는 까닭: 표시를 못 붙인 옛 그림도 자리로 알아봅니다.
                          item.usage === "dome" ||
                          item.blueprint?.includes(DOME_CHIP_ID) ||
                          (item.generatedImages ?? []).some((image) =>
                            isInPanoramaDir(image.filePath),
                          )
                        : item.usage !== "dome",
                    )
                    .map((item) => ({ id: item.id, name: item.name }))}
                  /*
                    **고르기는 고르기만** 합니다(). 창은 «열기»·«만들기» 를 눌렀을 때만 뜹니다. 빈 값을 고르면 이음을 끊습니다.
                  */
                  onPickPlace={
                    onPatchBackground
                      ? (backgroundId) =>
                          setState((current) => setRoomBackgroundIn(current, backgroundId))
                      : undefined
                  }
                  roomLibrary={
                    onSaveRoomPreset && onRemoveRoomPreset
                      ? {
                          presets: roomPresets ?? [],
                          save: () => {
                            const room = activeRoomOf(state);
                            const preset = captureRoomPreset(state, room.id);
                            if (!preset) return;
                            onSaveRoomPreset(preset);
                            toast.success(`«${preset.name}» 을 라이브러리에 담았습니다.`, {
                              description: preset.objects.length
                                ? `방 + 소품 ${preset.objects.length}개 — 다른 컷에서 그대로 꺼내 씁니다`
                                : "다른 컷에서 그대로 꺼내 씁니다",
                            });
                          },
                          apply: (preset) => {
                            setState((current) => applyRoomPresetIn(current, preset));
                            toast.success(`«${preset.name}» 을 세웠습니다.`, {
                              description: "옆에 나란히 세웠습니다 — 자리는 방 목록에서 옮기세요",
                            });
                          },
                          remove: onRemoveRoomPreset,
                          // 다른 작품의 방을 **복사해** 들여옵니다(면 그림까지).
                          borrow: placeLibrary ? () => setRoomBorrowOpen(true) : undefined,
                        }
                      : undefined
                  }
                  placeName={activePlace?.name ?? null}
                  isFaceSetAssigned={media.isFaceSetAssigned}
                  onOpenGallery={() => setGalleryOpen(true)}
                  onOpenLibrary={placeLibrary ? () => setLibraryOpen(true) : undefined}
                  /*
                    배경 소품도 **에셋과 이어집니다**(). 배치 탭과 같은 목록·같은 만들기를 씁니다.
                  */
                  assetOptions={swapOptions}
                  onCreateAsset={onChangeSharedAssets ? createAssetForObject : undefined}
                  onCreateGroupAsset={onChangeSharedAssets ? createAssetForGroup : undefined}
                  selected={selected}
                  setSelected={setSelected}
                  /*
                    **배경 영상** — 면·돔에 영상을 걸고, 그 면 그림으로 새 루프를 만듭니다.
                    프로젝트 폴더가 있어야 만들 수 있으므로 프로젝트 밖에서 연 창에서는 칸 자체가 안 뜹니다.
                    저장 자리는 이 방에 이어 둔 **장소 폴더**이고(규칙 5), 프롬프트는 그 장소 카드의 것을 바탕에 깝니다.
                  */
                  roomVideo={
                    projectName?.trim()
                      ? {
                          videos: media.roomVideos,
                          projectName,
                          ownerName: activePlace?.name ?? null,
                          prompt: { ko: activePlace?.promptKo, en: activePlace?.promptEn },
                          remember: media.rememberRoomVideo,
                          faceImagePath: media.faceImagePathOf,
                        }
                      : undefined
                  }
                  {...sectionToggles}
                />
              )}

              {panelTab === "timeline" && (
                <TimelinePanel
                  state={state}
                  setState={setState}
                  plannerCharacters={plannerCharacters}
                  timeline={timeline}
                  captureFormat={captureFormat}
                  video={video}
                  selected={selected}
                  setSelected={setSelected}
                  updateGlb={media.updateGlb}
                  onAddGlbFile={(file) => void media.handleDroppedFile(file)}
                  onBlenderPrompt={(text) => {
                    setPromptTitle("블렌더 작업 지시문");
                    setBlenderPrompt(text);
                  }}
                  playhead={playhead}
                  usedVideoPath={usedVideoPath}
                  onUseRender={(path, seconds) => {
                    void Promise.resolve().then(() => onVideoSaved?.(path, seconds)).catch(error => {
                      toast.error(t("레퍼런스 영상 경로를 저장하지 못했습니다."), { description: error instanceof Error ? error.message : String(error) });
                    });
                  }}
                  projectName={projectName}
                  sceneTitle={sceneTitle}
                  cutOrder={cutOrder}
                  onMotionCapture={() => {
                    // 재생 중이면 멈춥니다 — 넣는 동안 재생 루프가 인형 자세를 계속 덮어써서 결과가 안 보입니다.
                    setPlaying(false);
                    setMotionCaptureAt(playheadRef.current);
                  }}
                  {...sectionToggles}
                />
              )}
            </aside>
          </div>

          {/* 겹쳐 뜨는 창 여덟 개 — 여는 열쇠는 여기, 그리기는 저기(`PlannerOverlays`). */}
          <PlannerOverlays
            state={state}
            setState={setState}
            media={media}
            projectName={projectName}
            playhead={playhead}
            plannerCharacters={plannerCharacters}
            galleryOpen={galleryOpen}
            setGalleryOpen={setGalleryOpen}
            placeLibrary={placeLibrary}
            roomBorrowOpen={roomBorrowOpen}
            setRoomBorrowOpen={setRoomBorrowOpen}
            onSaveRoomPreset={onSaveRoomPreset}
            libraryOpen={libraryOpen}
            setLibraryOpen={setLibraryOpen}
            onPatchBackground={onPatchBackground}
            onRemoveBackground={onRemoveBackground}
            openPlace={openPlace}
            activePlace={activePlace}
            placeOpen={placeOpen}
            setPlaceOpen={setPlaceOpen}
            wallImageFor={wallImageFor}
            setWallImageFor={setWallImageFor}
            setWallPlaceId={setWallPlaceId}
            sharedAssets={sharedAssets}
            onChangeSharedAssets={onChangeSharedAssets}
            assetsOpen={assetsOpen}
            setAssetsOpen={setAssetsOpen}
            openAssetId={openAssetId}
            setOpenAssetId={setOpenAssetId}
            motionMenu={motionMenu}
            setMotionMenu={setMotionMenu}
            motionIntent={motionIntent}
            setMotionIntent={setMotionIntent}
            motionCaptureAt={motionCaptureAt}
            setMotionCaptureAt={setMotionCaptureAt}
            blenderPrompt={blenderPrompt}
            setBlenderPrompt={setBlenderPrompt}
            promptTitle={promptTitle}
          />
        </div>
        {/*
          값 입력 창을 **이 Dialog 안에** 둡니다. Radix 가 포커스를 Dialog 안에 가둬서,
          밖에 그린 입력칸은 눌러도 포커스를 곧 뺏겨 글자를 칠 수 없습니다
          (까닭은 `PromptDialog` 의 `hosts` 주석에). 앱 뿌리의 것은 그대로 두고,
          구도잡기가 열려 있는 동안에만 이쪽이 답합니다.
        */}
        <PromptDialogHost />
      </DialogContent>
    </Dialog>
  );
}
