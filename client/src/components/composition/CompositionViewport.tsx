import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { assetSrc } from "@/lib/mediaLibrary";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OUTDOOR_EYE_HEIGHT } from "@/lib/unfoldPrompt";
import { characterColorMap } from "@/lib/compositionColors";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { toast } from "sonner";
import {
  evaluateCameraMoves,
  resolveAnchorSource,
  sortedMoves,
  type CameraMove,
  type CameraPose,
} from "@/lib/cameraMoves";
import {
  applyBonePose,
  applyBasePose,
  boneDeltaEuler,
  boneOf,
  lowestGroundY,
  setLiveBonePose,
  mannequinBody,
} from "@/lib/rig";
import {
  COMPOSITION_CUBE_FACES,
  isDomeRoom,
  type CharacterComposition,
  type CompositionCharacterSource,
  type CompositionCubeFace,
  type CompositionRoom,
  type CompositionState,
  type GlbTrack,
  type ObjectComposition,
  type RoomVideoFace,
  type Vector3Value,
} from "@/lib/composition";
import { createOrbit } from "@/components/composition/viewport/orbit";
import { createGroundPlacing } from "@/components/composition/viewport/groundPlacing";
import { createKeyboardMove } from "@/components/composition/viewport/keyboardMove";
import {
  BACKGROUND_CUBE_SIZE,
  BACKGROUND_RENDER_ORDER,
  FLOOR_SIZE,
  type LabelAnchor,
  MODEL_URLS,
  attachLabel,
  buildAnchorMarker,
  buildFallbackFigure,
  buildFloor,
  buildSelectionRing,
  createLabel,
  disposeMaterials,
  disposeOwnedMesh,
  floorDepthOf,
  fitShadowToFloor,
  floorSizeOf,
  gltfCache,
  loadCachedTexture,
  loadRoomDriftTexture,
  releaseRoomDriftTextures,
  applyRoomDrift,
  loadRoomVideoTexture,
  releaseRoomVideoTextures,
  applyRoomVideoTime,
  seekRoomVideoTime,
  type RoomVideoCache,
  type RoomVideoTexture,
  buildRoomShell,
  buildDomeGuide,
  buildPanoramaDome,
  setBackgroundOcclusion,
  orderBackgroundRooms,
  applyWallCutaway,
  modelTemplates,
  syncLabel,
} from "./viewport/sceneHelpers";
import {
  ORBIT_DAMPING,
  backgroundOnOf,
  foregroundPivotOf,
  activeCameraShot,
  evaluateMotionTrack,
  evaluatePoseTrack,
  motionTracksOf,
  occludeAtIn,
  objectSeeThroughAtIn,
  layersOf,
  visibleAtIn,
  outerGroupOf,
  roomsOf,
  cameraShotsOf,
  lockAnchorsOf,
} from "@/lib/compositionEdit";

/**
 * 구도잡기 3D 화면.
 *
 * # 이펙트를 역할별로 나눠 두었습니다
 *
 * 예전에는 이펙트 하나가 구도 상태가 바뀔 때마다 씬을 통째로 다시 지었습니다.
 * 상태와 화면이 절대로 어긋나지 않는 대신, 인물 하나를 클릭해도 WebGL
 * 렌더러까지 새로 만들어 느렸습니다. 지금은 이렇게 나뉩니다.
 *
 * - 렌더러·씬·카메라·컨트롤·기즈모 — 마운트 때 한 번 (`sceneRef`)
 * - 카메라 자세·화각·비율·전경 확대·조명·바닥 — 값 하나짜리 작은 이펙트
 * - 배경(6면·파노라마·HDRI) / 인물 / 소품·조명 / GLB 트랙 / 앵커 — 각자의 키
 * - 선택·기즈모 대상 — 선택 관련 props 에만 반응하고, 위 이펙트들이 물체를
 * 다시 만들면 `syncSelectionRef` 로 다시 붙입니다
 *
 * 부분 갱신이 됐어도 **캐시는 여전히 필수**입니다 — 없으면 슬라이더를 한 번
 * 움직일 때마다 배경 이미지와 GLB 를 다시 읽어서, 그 사이 화면이 비어 보이며
 * 깜박입니다.
 *
 * # 재생 중에는 React 를 거치지 않습니다
 *
 * 카메라 무빙 미리보기는 `playheadRef` 를 직접 읽습니다. 상태로 두면
 * 초당 열두 번씩 이 컴포넌트가 통째로 다시 그려지고, 그게 곧 재생 끊김으로
 * 보입니다. 이 컴포넌트에는 useState 가 하나도 없습니다.
 *
 * # 헬퍼는 `userData.helper` 로 표시합니다
 *
 * 격자·이름표·경로선·앵커는 구도를 잡을 때 필요하지만 레퍼런스 영상에
 * 나오면 안 됩니다. 표시를 달아 두면 영상 렌더 직전에 한 번에 숨길 수 있습니다.
 */

/**
 * 레퍼런스 영상용 프레임 렌더러.
 * 미리보기 루프는 「지금 시각」을 계속 따라가지만, 영상은 「지정한 시각」을 한 장씩 그려야 합니다.
 */
export interface VideoFrameRenderer {
  canvas: HTMLCanvasElement;
  /** 출력 해상도로 바꾸고 헬퍼 표시를 숨깁니다. */
  begin: (width: number, height: number) => void;
  /**
   * 그 시각의 **배경 영상 프레임이 올라올 때까지** 기다립니다. `drawAt` 바로 앞에서 부르세요.
   *
   * 되감기는 비동기라, 시각을 옮기자마자 그리면 **한 프레임 전** 배경이 찍힙니다 — 배경만 조금씩
   * 밀린 영상이 나오고, 그 어긋남은 다 굽고 나서야 보입니다. 배경 영상을 안 건 컷에서는 곧바로 돌아옵니다.
   */
  prepareAt: (time: number) => Promise<void>;
  /** 해당 시각의 카메라·애니메이션을 적용해 한 장 그립니다. */
  drawAt: (time: number) => void;
  /** 원래 화면 상태로 되돌립니다. */
  end: () => void;
}

export type TransformConstraint = "free" | "ground" | "height";

export interface CompositionViewportProps {
  composition: CompositionState;
  characters: CompositionCharacterSource[];
  aspect: number;

  /**
   * 방마다 여섯 면의 **그림 주소**(id 가 아니라 이미 찾아 둔 주소).
   *
   * 씬은 배경 목록을 모릅니다 — id 를 주소로 바꾸는 일은 `usePlannerMedia` 가 하고
   * 여기는 받아서 붙이기만 합니다. `outer` 가 null 이면 바깥 껍질을 안 세웁니다.
   */
  roomFaceImages: {
    id: string;
    inner: Partial<Record<CompositionCubeFace, string>>;
    outer: Partial<Record<CompositionCubeFace, string>> | null;
    /** 파노라마 돔 그림 주소. 있으면 상자 대신 돔(`buildPanoramaDome`). */
    panorama?: string | null;
    /**
     * **배경 영상**(`CompositionRoom.video`) — 그 면(또는 돔)에 정지 그림 대신 걸 영상 주소.
     * 그림과 마찬가지로 id 를 주소로 바꾸는 일은 `usePlannerMedia` 가 하고 여기는 붙이기만 합니다.
     */
    video?: { face: RoomVideoFace; url: string } | null;
  }[];

  selected: string;
  onSelect: (value: string) => void;
  transformMode: "translate" | "rotate" | "scale";
  /** 1·2·3 단축키로 기즈모를 바꿉니다. 언리얼의 W/E/R 자리 — 우리는 W/A/S/D 가 이동이라 숫자로. */
  onTransformMode?: (mode: "translate" | "rotate" | "scale") => void;
  /** Ctrl+1·2·3 — 자유·바닥·높이. 같은 숫자에 Ctrl 만 더해 «같은 줄의 다른 칸» 임이 손에 남습니다. */
  onTransformConstraint?: (constraint: TransformConstraint) => void;
  transformConstraint: TransformConstraint;

  /** 기즈모를 붙일 본. null 이면 인물 전체를 다룹니다 */
  activeBone: string | null;
  boneTransformMode: "translate" | "rotate";
  fineSnap: boolean;

  /** 이어 붙는 무빙 클립들. 재생·영상 렌더가 이 목록을 시간순으로 먹입니다. */
  cameraMoves: CameraMove[];
  /** 지금 고른 클립 — 앵커 기즈모가 이것만 보여 줍니다. */
  cameraMove: CameraMove | null;
  anchorGizmo: boolean;

  /**
   * «바닥에 세우기» 모드. 켜고 화면을 찍으면 그 자리(y=0)로 고른 인물을 옮깁니다.
   * 저장은 `onCharacterTransform` 을 그대로 거치므로 되돌리기(Ctrl+Z)에 들어갑니다.
   */
  groundPlacing?: boolean;

  /** 재생 위치. 상태가 아니라 ref 로 받습니다 — 리렌더가 곧 끊김이라서요 */
  playheadRef: MutableRefObject<number>;
  previewingRef: MutableRefObject<boolean>;
  /**
   * **시계가 정말 도는 동안만** 참. 배경 영상을 돌릴지 멈출지가 여기 달려 있습니다.
   *
   * `previewingRef`(«카메라를 타임라인이 몹니다»)와 다릅니다 — 저쪽은 눈금을 한 번 끌기만 해도
   * 켜지고 사람이 화면을 돌릴 때까지 켜진 채라, 그걸 믿으면 **멈춘 뒤에도 배경만 계속 움직입니다.**
   */
  playingRef?: MutableRefObject<boolean>;
  /**
   * **멈춰 있을 때의** 재생 위치(초)와 재생 여부. 상태로 받습니다.
   *
   * 위 ref 들은 재생 중 끊김을 막으려고 둔 것이고, 이 둘은 «눈금을 손으로 옮겼다» 를
   * 알아채는 용도입니다 — 그때 한 번만 카메라를 그 시각으로 맞춥니다.
   */
  playhead: number;
  previewing: boolean;
  onPreviewInterrupt?: () => void;

  onCharacterTransform: (
    id: string,
    patch: Pick<CharacterComposition, "position" | "rotation" | "rotationY">,
  ) => void;
  onObjectTransform: (id: string, patch: Partial<ObjectComposition>) => void;
  onGlbTransform: (id: string, patch: Partial<GlbTrack>) => void;
  /**
   * **방을 화면에서 옮겼을 때**. Shift 로 잡은 방만 옵니다.
   * 크기는 기즈모의 배율이라, 받는 쪽이 방 치수에 곱해 넣습니다.
   */
  onRoomTransform?: (
    id: string,
    patch: {
      position: Vector3Value;
      rotationY: number;
      scale: Vector3Value;
    },
  ) => void;
  onBonePose?: (
    characterId: string,
    bone: string,
    rotation: Vector3Value,
  ) => void;
  onBonePoseBatch?: (
    characterId: string,
    entries: Record<string, Vector3Value>,
  ) => void;
  onAnchorChange?: (anchor: Vector3Value) => void;
  onCameraChange: (pose: {
    position: Vector3Value;
    target: Vector3Value;
  }) => void;
  onGlbClips?: (id: string, clips: string[], duration: number) => void;

  /**
   * 화면 찍기 함수를 부모에게 넘깁니다.
   * `backgroundOnly` 면 인물·소품·헬퍼를 빼고 **배경만** 그립니다(생성기에 줄 배경 플레이트).
   */
  onCaptureReady: (
    capture: ((options?: { backgroundOnly?: boolean; requireReady?: boolean }) => string) | null,
  ) => void;
  onVideoRenderReady?: (renderer: VideoFrameRenderer | null) => void;
}

interface GlbMixerEntry {
  mixer: THREE.AnimationMixer;
  track: GlbTrack;
  clipDuration: number;
}

/**
 * 마운트 때 한 번 만들고 이펙트들이 나눠 쓰는 씬 얼개.
 *
 * 인물·소품·GLB 의 루트는 각자의 이펙트가 채우고, 선택 이펙트가 읽어 기즈모를
 * 붙입니다. 재생 루프는 매 프레임 이 객체를 읽으므로, 이펙트가 물체를 바꿀 때는
 * 여기 필드를 바꿔야 루프가 따라옵니다.
 */
interface ViewportScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transform: TransformControls;
  /**
   * 전경 그룹 — 인물·소품·GLB.
   * 배경과 분리해 둬야 「배경은 그대로 두고 앞만 키우기」가 됩니다.
   */
  foreground: THREE.Group;
  ambient: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;

  characterRoots: Map<string, THREE.Group>;
  characterRigs: Map<string, THREE.Object3D>;
  objectRoots: Map<string, THREE.Object3D>;
  glbRoots: Map<string, THREE.Group>;
  glbMixers: GlbMixerEntry[];
  anchorGroup: THREE.Group | null;
  selectionRing: THREE.Mesh | null;
  /**
   * 화면 크기가 물체 크기와 무관해야 하는 이름표들.
   * 재생 루프가 매 프레임 부모 스케일을 되나눕니다 — 기즈모로 크기를 끄는 동안
   * 글상자까지 늘어나지 않게 하는 유일한 길입니다.
   */
  labels: LabelAnchor[];

  /**
    «방» — 밑면이 y=0 인 유한 큐브 안쪽에 여섯 면을 붙입니다.

    갈래가 하나뿐입니다. 파노라마 구·HDRI 구·«배경 고정/함께»·돔·3D 세트는 2026-09-11 에
    걷어냈습니다.
  */
  background: {
    /** 방들을 담는 자리. 배경이 바뀌어도 이 그룹은 그대로 삽니다. */
    root: THREE.Group | null;
    /**
     * 세워 둔 방 — **방 하나에 틀 하나, 껍질 둘**.
     *
     * 틀(rig)은 한 변 1 짜리 상자를 방 치수로 늘리고 밑면을 y=0 에 맞춥니다. 껍질은
     * 안쪽(벽지)과 바깥쪽(외벽)이고, 바깥면을 안 붙였으면 `outer` 는 null 입니다.
     * 치수를 여기 같이 적어 두는 까닭은 **매 프레임 상태를 안 읽기** 위해서입니다 —
     * 슬라이더를 끄는 동안 React 상태를 프레임마다 읽으면 씬이 통째로 다시 만들어집니다.
     */
    rooms: {
      id: string;
      rig: THREE.Group;
      inner: THREE.Mesh;
      outer: THREE.Mesh | null;
      /** 파노라마 돔(`buildPanoramaDome`). 걸린 방만 — 틀(rig) 밖에 따로 섭니다. */
      dome?: THREE.Group | null;
      width: number;
      depth: number;
      height: number;
      position: Vector3Value;
      rotationY: number;
      /**
       * **배경 흐름** — 이 방이 초당 옮길 UV 와, 옮길 텍스처들(`CompositionRoom.drift`).
       *
       * 치수와 같은 까닭으로 여기 적어 둡니다 — 매 프레임 React 상태를 읽으면 씬이 통째로
       * 다시 만들어집니다. 흐름을 끈 방은 목록이 비어 있어 루프가 바로 지나갑니다.
       */
      drift: { x: number; y: number } | null;
      driftTextures: THREE.Texture[];
      /**
       * **배경 영상** — 이 방이 띄운 `<video>` 와 그 텍스처(`CompositionRoom.video`).
       *
       * 흐름과 같은 까닭으로 여기 적어 둡니다 — 매 프레임 React 상태를 읽으면 씬이 통째로 다시
       * 만들어집니다. 안 건 방은 목록이 비어 있어 루프가 바로 지나갑니다.
       */
      videoTextures: RoomVideoTexture[];
    }[];
    /**
     * 이 씬이 띄운 **배경 영상**들. 방을 다시 세워도 살아 있어 크기 슬라이더를 끄는 동안
     * 같은 `<video>` 를 그대로 쓰고, **창이 닫힐 때 여기서 한꺼번에 놓입니다**(까닭은
     * `sceneHelpers` 의 «왜 캐시를 씬이 들고 있는가»).
     */
    videoCache: RoomVideoCache;
    /** 배경 상자를 «한 변 몇 미터로» 만들었는지 — 방 배율의 분모입니다. */
    roomUnit: number;
    /**
     * 투시를 켤 것인가(`applyWallCutaway`). 매 프레임 읽으므로 React 상태가 아니라
     * 여기 둡니다 — 프레임마다 상태를 읽으면 씬이 통째로 다시 만들어집니다.
     */
    cutaway: boolean;
    /** 투시가 «인물이 어디 있나» 를 볼 자리. 인물 뿌리들을 넘겨받습니다. */
    subjects: (() => THREE.Vector3[]) | null;
  };
  /** 카메라 무빙의 화각 배율을 곱할 기준 화각. 저장된 fovDegrees 를 따라갑니다. */
  baseFov: number;
  /** 그 시각의 무빙 결과를 화면에 보여 줍니다. 눈금을 옮겼을 때만 부릅니다. */
  showMovesAt: ((time: number) => void) | null;

  /**
   * 회전 중심을 **부드럽게** 옮기는 중인 상태. null 이면 옮기는 중이 아닙니다.
   *
   * 시선점을 한 프레임에 순간이동시키면 카메라가 갑자기 딴 데를 보게 되어
   * 화면이 튑니다(카메라 자리는 그대로인데 바라보는 점만 바뀌니까요).
   * 그래서 0.16~0.42초에 걸쳐 옮기고, 다 옮긴 뒤에 한 번만 저장합니다.
   */
  orbitGlide: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    /** M 키(고른 것 앞으로 가기)처럼 **카메라 자리도** 함께 옮길 때만 있습니다. */
    camFrom?: THREE.Vector3;
    camTo?: THREE.Vector3;
    start: number;
    ms: number;
  } | null;

  /** 지금 기즈모가 무엇을 잡고 있는지. mouseUp 에서 어디에 저장할지 정할 때 씁니다. */
  gizmo: {
    anchorAttached: boolean;
    attachedBone: THREE.Object3D | null;
    characterId: string | null;
    bone: string | null;
    objectId: string | null;
    glbId: string | null;
    /** 잡고 있는 **방**. Shift 로 고른 것만 여기에 들어옵니다. */
    roomId: string | null;
  };
  dragStartRotation: Vector3Value | null;

  resize: () => void;
}

const EMPTY_GIZMO: ViewportScene["gizmo"] = {
  anchorAttached: false,
  attachedBone: null,
  characterId: null,
  bone: null,
  objectId: null,
  glbId: null,
  roomId: null,
};

/**
 * 배경막을 제자리에 둡니다. **재생 루프·영상 렌더·배경을 세울 때 같은 규칙**입니다.
 *
 * ## 배경막은 늘 눈에 붙어 있습니다
 *
 * 위치를 카메라와 똑같이 두면
 * (1) 궤도로 돌든 W/A/S/D 로 걸어가든 눈이 늘 상자 한가운데라 큐브 투영이 정확하고
 * (실측 오차 0.000°, 월드에 못 박으면 최대 45.6°),
 * (2) «상자 바닥면이 우리 바닥과 어긋나 보이는» 문제가 사라집니다 —
 * 면은 투영면일 뿐 바닥이 아니고, 지평선은 늘 눈높이에 옵니다.
 *
 * ## «배경도 함께» 는 옮기지 않고 «눌러서» 만듭니다
 *
 * 배경은 무한히 먼 각도 그림이라, 카메라를 빼면 인물만 작아지고 배경은 그대로입니다
 * (). 배경막을 월드 어딘가에 못 박아
 * 봐야 소용이 없습니다 — 반지름 60 짜리 배경막을 원점에 세우고 4m→8m 로 물러나면
 * 인물은 1/2 이 되는데 배경은 (60+4)/(60+8) = 0.94 배, 즉 **드리프트의 6% 밖에**
 * 못 잡습니다(반지름을 4m 로 줄여도 0.67 배로 절반뿐). 정확히 맞추려면 배경막이
 * 인물과 같은 깊이에 있어야 하는데, 그러면 그것은 이미 배경이 아닙니다.
 *
 * 그래서 배경막은 눈에 붙여 둔 채 **화면에서 차지하는 각도만** 줄입니다.
 * 바깥 틀을 **수평(요만) 축**으로 돌려 놓고 그 틀의 x·y 를 m 배로 누르면, 각
 * 방향의 tan 이 그대로 m 배가 되어 배경 그림이 화면 중심을 기준으로 정확히 m 배로
 * 축소·확대됩니다(= 배경만 화각이 다른 렌즈로 찍은 것과 같습니다).
 * m = 기준거리/현재거리 로 두면 인물의 화면 크기와 **정확히** 같은 비율이 됩니다.
 *
 * 안쪽 틀(spin)은 바깥 틀의 회전을 되돌립니다. 그러지 않으면 배경 그림이
 * 카메라를 따라 돌아 버립니다 — 눌러야 하는 것은 «시야 축» 이지 그림이 아닙니다.
 *
 * ## 왜 «카메라 축» 이 아니라 «수평 축» 인가
 *
 * diag(m,m,1) 이 그대로 두는 평면은 «누르는 틀의 y=0» 입니다. 카메라 축으로
 * 누르면 그 평면이 **카메라 로컬 y=0**(= 시선에 수직인 평면)이라, 조금이라도
 * 내려다보면 월드 눈높이 평면과 갈라져 배경 지평선이 화면 중심 쪽으로 끌려옵니다.
 * 실측(기준 4m·화각 40°·세로 900px 환산): 피치 9.6° 에서 139px(화면의 15%),
 * 14.5° 에서 255px(28%), 22° 에서 417px(46%). 구도잡기는 늘 조금 내려다보므로
 * «지평선은 그대로» 라는 약속이 사실상 늘 깨졌습니다.
 *
 * 요(yaw)만 남긴 축으로 누르면 그 평면이 **월드 눈높이 평면**이라 지평선이 정확히
 * 제자리에 남고(위 세 자세 모두 0.0px), 화면 중심의 배율은 그대로 m 입니다.
 * 인물의 발과 배경 땅의 관계가 그래서 유지됩니다. «배경 고정» 은 scale 이 1 이라
 * R·I·R⁻¹ = I — 어떤 축을 쓰든 같아서, 고정 모드의 0.000° 정확도는 그대로입니다.
 *
 * 대신 배경 그림 자체의 원근은 «확대·축소» 라 근사입니다(시차가 없습니다).
 * 각도를 정확히 봐야 할 때는 «배경 고정» 으로 돌아가면 됩니다.
 *
 * @param anchorDistance 카메라에서 **앵커(월드의 한 점)** 까지 거리. 시선점까지가
 * 아닙니다 — 걷기·팬은 시선점을 카메라와 같이 옮겨 거리가 안 변합니다.
 */
/**
 * 방 틀을 제자리에 둡니다 — 한 변 S, 중심 (0, S/2, 0), 배율 S / roomUnit.
 *
 * 중심을 S/2 에 두는 것이 이 모드의 전부입니다. 그래야 밑면이 정확히 y=0, 즉 우리 바닥
 * 격자와 같은 평면이 되고, 바닥 그림의 (x,0,z) 와 그 자리에 선 인물이 **같은 점**이 됩니다.
 * 카메라를 어디로 옮겨도 발이 그림에서 떨어지지 않습니다.
 *
 * 회전은 걸지 않습니다. 방은 세상에 고정된 물건이라 카메라가 돌면 벽이 지나가야 합니다.
 * 크기는 지오메트리를 다시 만들지 않고 배율로 줍니다 — 슬라이더를 드래그하는 동안 여섯
 * 장을 다시 붙이면 깜박입니다.
 *
 * 여섯 면 90° 는 눈이 정육면체 한가운데(y = S/2)일 때만 정확합니다. 벗어나면 벽은
 * «그려진 벽» 이라 각도가 근사가 되지만, 방은 최종 그림이 아니라 **구도를 잡는 받침대**라
 * 그 근사로 충분합니다.
 */
/**
 * 소품 하나를 **비치게 / 막게** 합니다. 재질을 직접 만지므로 씬을 다시 세우지 않고도 됩니다 —
 * 재생 중에 매 프레임 부르기 때문입니다(프레임마다 씬을 다시 지으면 재생이 멈춥니다).
 */
function setObjectSeeThrough(root: THREE.Object3D, on: boolean) {
  if (root.userData.seeThroughOn === on) return;
  root.userData.seeThroughOn = on;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    // 조명 자리를 알리는 작은 공은 원래 반쯤 비치는 표시라 건드리지 않습니다.
    if (node.userData.helper) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!(material instanceof THREE.Material)) return;
      const shaded = material as THREE.MeshStandardMaterial;
      if (shaded.userData.solidOpacity === undefined)
        shaded.userData.solidOpacity = shaded.opacity ?? 1;
      shaded.transparent = on || shaded.userData.solidOpacity < 1;
      shaded.opacity = on ? 0.22 : shaded.userData.solidOpacity;
      shaded.depthWrite = !on;
      shaded.needsUpdate = true;
    });
  });
}

function placeBackgroundRig(
  background: ViewportScene["background"],
  camera?: THREE.Camera,
) {
  const unit =
    background.roomUnit > 0 ? background.roomUnit : BACKGROUND_CUBE_SIZE;
  background.rooms.forEach((entry) => {
    const width = entry.width > 0 ? entry.width : 1;
    const depth = entry.depth > 0 ? entry.depth : width;
    const height = entry.height > 0 ? entry.height : width;
    /*
      자리는 **방 밑면 한가운데**라 y 에 높이의 절반을 더해야 상자 중심이 됩니다.
      그래야 밑면이 정확히 방의 바닥 높이 — 첫 방이면 y=0, 곧 우리 격자와 같은 평면입니다.
      («2층» 을 얹으려고 자리의 y 를 올리면 그만큼 통째로 올라갑니다.)
    */
    entry.rig.position.set(
      entry.position.x,
      entry.position.y + height / 2,
      entry.position.z,
    );
    entry.rig.rotation.set(0, (entry.rotationY * Math.PI) / 180, 0);
    entry.rig.scale.set(width / unit, height / unit, depth / unit);
    // 돔은 틀 밖에 따로 섭니다(반지름·눈높이가 미터 그대로라 틀의 배율을 타면 찌그러집니다). 자리·회전만 따라갑니다.
    if (entry.dome) {
      entry.dome.position.set(entry.position.x, entry.position.y, entry.position.z);
      entry.dome.rotation.set(0, (entry.rotationY * Math.PI) / 180, 0);
    }
    /*
      바깥 껍질을 **아주 조금** 키웁니다. 두 껍질이 같은 평면에 있으면 깊이가 같아
      화면에서 두 그림이 지글거립니다(z-fighting). 0.2% 면 8m 방에서 1.6cm 라
      눈에 안 보이면서도 깊이 버퍼가 둘을 확실히 가릅니다.
    */
    if (entry.outer) entry.outer.scale.setScalar(1.002);
  });

  /*
    ── 방이 여럿이면 칠하는 순서를 정합니다 ────────────────────────────

    배경 상자는 깊이를 안 씁니다(`markAsBackgroundMesh` — 방보다 큰 인물이 벽에 파묻혀
    잘리지 않게). 방이 하나일 때는 그래도 됐지만, 둘이 되는 순간 **깊이가 없으니 나중에
    그린 방이 먼저 그린 방을 덮습니다.** 그래서 먼 것부터 칠합니다(화가 알고리즘).

    규칙은 `orderBackgroundRooms` 에 있습니다 — **겹친 방은 감싸는 방 먼저**, 같은 겹이면
    먼 방 먼저. 가운데 거리만 보던 시절에는 방 안에 방을 넣으면 순서가 프레임마다 뒤집혀
    벽이 깜박였습니다().

    가리기를 켠 면이 있는 껍질도 **같은 순서**에 섭니다(`setBackgroundOcclusion` 의 9/15 절) —
    그 면이 깊이를 써서 뒤엣것을 가리고, 나머지 면은 순서대로 칠해집니다.
  */
  if (camera && background.rooms.length > 1) {
    orderBackgroundRooms(background.rooms, camera.position).forEach(
      (entry, slot) => {
        [entry.inner, entry.outer].forEach((mesh) => {
          if (mesh && mesh.renderOrder < 0)
            mesh.renderOrder = BACKGROUND_RENDER_ORDER + slot;
        });
      },
    );
  }

  /*
    ── 투시 — 방 밖에서 안의 인물을 가리는 벽만 걷습니다 ────────────────
     규칙과 9/14 «가리기» 와의
    관계는 `applyWallCutaway` 에 적어 두었습니다.
  */
  if (camera) {
    const subjects = background.subjects?.() ?? [];
    background.rooms.forEach((entry) =>
      applyWallCutaway(entry, camera.position, subjects, background.cutaway),
    );
  }
}

const samePose = (a: CameraPose, b: CameraPose) =>
  Math.abs(a.position.x - b.position.x) < 1e-9 &&
  Math.abs(a.position.y - b.position.y) < 1e-9 &&
  Math.abs(a.position.z - b.position.z) < 1e-9 &&
  Math.abs(a.target.x - b.target.x) < 1e-9 &&
  Math.abs(a.target.y - b.target.y) < 1e-9 &&
  Math.abs(a.target.z - b.target.z) < 1e-9;

export default function CompositionViewport(props: CompositionViewportProps) {
  const {
    composition,
    characters,
    aspect,
    roomFaceImages,
    selected,
    transformMode,
    transformConstraint,
    activeBone,
    fineSnap,
    cameraMoves,
    cameraMove,
    anchorGizmo,
    groundPlacing,
    playheadRef,
    previewingRef,
    playingRef,
    playhead,
    previewing,
  } = props;

  const hostRef = useRef<HTMLDivElement>(null);
  /**
   * 콜백은 ref 로 넘깁니다.
   * 의존성에 넣으면 부모가 다시 그려질 때마다 씬이 통째로 재생성됩니다.
   */
  const handlersRef = useRef(props);
  handlersRef.current = props;
  const cameraMovesRef = useRef(cameraMoves);
  cameraMovesRef.current = cameraMoves;
  // 트랙도 매 프레임 읽습니다. 상태를 의존성으로 걸면 씬이 통째로 재생성됩니다.
  const motionTracksRef = useRef(motionTracksOf(composition));
  motionTracksRef.current = motionTracksOf(composition);
  /*
    시간대별 «있다/없다» 와 «가릴 면» 은 매 프레임 읽습니다. 자리 트랙과 같은 까닭으로
    React 상태가 아니라 ref 로 넘깁니다 — 프레임마다 상태를 읽으면 씬이 통째로 다시 섭니다.
    구도 전체를 넘기는 까닭: 가릴 면은 트랙이 없는 면에서 방의 고정 스위치로 물러서야 해서
    방 목록도 같이 봐야 합니다(`occludeAtIn`).
  */
  const timedCompositionRef = useRef(composition);
  timedCompositionRef.current = composition;
  /*
    전경 확대 배율.

    **매 렌더마다 다시 채워야 합니다.** 예전에는 `useRef(...)` 로 마운트 때
    한 번만 잡고 끝이라, 슬라이더를 움직여도 값이 그대로였습니다 — 전경
    확대가 아예 안 먹었습니다. (지시 182·189)
  */
  const zoomRef = useRef(composition.foregroundZoom);
  zoomRef.current = composition.foregroundZoom;
  // 화면 비율. resize 는 마운트 때 만든 함수라 최신 값을 ref 로 읽습니다.
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  /*
    카메라 무빙의 기준 자세 = 저장된 카메라.

    예전에는 씬을 다시 지을 때 잡아 두었는데, 화면을 돌린 뒤(저장됨) 재생을
    누르면 다시 짓기 전의 낡은 자세에서 출발하는 문제가 있었습니다. 매 렌더마다
    저장값을 따라가면 «지금 화면에 보이는 자리» 에서 무빙이 시작합니다.
  */
  /*
    ── 무빙의 출발점 ────────────────────────────────────────────────────
    

    맞습니다. 출발점을 «지금 화면» 으로 두었더니, 구도를 저장해 놓고 각도를 살피려고
    화면을 한 번 돌리는 순간 무빙의 출발점까지 따라 움직였습니다 — 저장한 구도가 아무
    뜻이 없었던 것입니다.

    이제 **활성 저장 구도가 있으면 그것**이 출발점입니다. 화면을 아무리 돌려도 무빙은
    「카메라 1 에서 시작해 앵커를 돈다」 로 고정됩니다. 저장 구도가 하나도 없을 때만
    예전처럼 지금 화면을 씁니다(무빙을 못 놓게 막아 두었으니 드문 경우입니다).
  */
  const moveBasePose = (() => {
    const shots = cameraShotsOf(composition);
    const shot =
      shots.find((item) => item.id === composition.activeShotId) ?? shots[0];
    if (shot)
      return {
        position: { ...shot.position },
        target: { ...shot.target },
        // 저장한 화각이 곧 이 구도의 «1배» 입니다.
        fovScale:
          composition.camera.fovDegrees > 0
            ? shot.fovDegrees / composition.camera.fovDegrees
            : 1,
      };
    return {
      position: { ...composition.camera.position },
      target: { ...composition.camera.target },
      fovScale: 1,
    };
  })();
  const baseCameraRef = useRef<CameraPose>(moveBasePose);
  baseCameraRef.current = moveBasePose;
  /*
    뷰포트와 저장값이 마지막으로 합의한 카메라 자세.

    화면을 돌리면 mouseUp 에서 저장값으로 보냅니다. 그 값이 props 로 되돌아올 때
    카메라를 다시 세우면, 감쇠(damping)로 미끄러지던 카메라가 뚝 끊깁니다.
    그래서 «우리가 보낸 값이 그대로 돌아온 것» 은 건너뛰고, 되돌리기·프리셋처럼
    바깥에서 바뀐 값만 적용합니다.
  */
  const lastCameraPoseRef = useRef<CameraPose | null>(null);

  /** 마운트 이펙트가 채우고 나머지 이펙트가 읽는 씬 얼개. 언마운트 때 null. */
  const sceneRef = useRef<ViewportScene | null>(null);
  /**
   * 선택 이펙트가 등록하는 «기즈모·링을 지금 물체에 다시 붙이기».
   *
   * 인물·소품·GLB·앵커 이펙트가 물체를 새로 만들면 기즈모가 잡고 있던 옛 물체는
   * 씬에서 빠집니다. 그때 이걸 불러 새 물체에 다시 붙입니다. 선택 이펙트의
   * 의존성에 인물 키 같은 것을 전부 나열하는 대신 이 방식을 씁니다 — 의존성을
   * 빠뜨리면 기즈모가 허공을 잡는 사고가 조용히 생기기 때문입니다.
   */
  const syncSelectionRef = useRef<(() => void) | null>(null);
  /**
   * «회전 중심을 보고 있는 대상으로 옮기기»(F 키 · 선택이 바뀔 때).
   * 마운트 이펙트가 등록하고, 선택 이펙트가 불러 씁니다.
   */
  const orbitFocusRef = useRef<(() => void) | null>(null);
  /** 선택 이펙트가 마운트 첫 실행을 건너뛰게 하는 표시. */
  const orbitFocusReadyRef = useRef(false);

  const selectedCharacterId = selected.startsWith("character:")
    ? selected.slice(10)
    : null;
  const selectedObjectId = selected.startsWith("object:")
    ? selected.slice(7)
    : null;
  const selectedGlbId = selected.startsWith("glb:") ? selected.slice(4) : null;
  /**
   * 잡은 **방**.
   */
  const selectedRoomId = selected.startsWith("room:") ? selected.slice(5) : null;

  // 이펙트의 의존성으로 쓸 문자열 키들. 객체를 그대로 넣으면 매번 새 참조라
  // 물체가 끝없이 다시 만들어집니다.
  /**
   * 클립을 **손본 것**을 알아채는 열쇠 — 자리·길이·이동량·앵커·출발 구도.
   *
   * 카메라 자세는 일부러 뺐습니다. 넣으면 화면을 돌릴 때마다 열쇠가 바뀌어, 되돌리기가
   * 돌리기와 싸웁니다.
   */
  const moveEditKey = cameraMoves
    .map((move) =>
      [
        move.id,
        move.shotId,
        move.startTime,
        move.duration,
        move.amount,
        move.cameraShotId ?? "",
        move.anchor.x,
        move.anchor.y,
        move.anchor.z,
        move.anchorTargetId ?? "",
      ].join(","),
    )
    .join("|");

  const rooms = roomsOf(composition);
  /** 방이 **몇 개이고 어떤 모양인지**. 바뀌면 상자를 다시 세웁니다. */
  const roomShapeKey = rooms
    .map((room: CompositionRoom) =>
      [
        room.id,
        room.hidden ? "x" : "o",
        room.width,
        room.depth,
        room.height,
        room.position.x,
        room.position.y,
        room.position.z,
        room.rotationY,
        room.sideCropBottom ?? 0,
        // 돔↔상자를 바꾸면 세우는 것 자체가 달라집니다 — 키에 없으면 화면이 안 바뀝니다.
        room.outdoor ? (room.outdoorShape === "box" ? "box" : "dome") : "in",
        // 호리존 색. 재질이 색 하나라 바꾸면 상자를 다시 세워야 하고, 키에 없으면 색을 골라도 화면이 그대로입니다.
        room.horizon?.color ?? "",
        /*
          배경 흐름. 켜고 끄면 쓰는 텍스처가 **아예 달라지고**(방 몫으로 따로 뜬 것 ↔ 공용 캐시)
          속도는 틀에 적어 두는 값이라, 둘 다 키에 없으면 손잡이를 움직여도 화면이 그대로입니다.
          치수와 마찬가지로 다시 세우는 값이 싼 까닭은 텍스처가 캐시에 남아서입니다.
        */
        room.drift?.x ?? 0,
        room.drift?.y ?? 0,
      ].join(","),
    )
    .join("|");
  /** 방마다 붙인 **그림**. 주소가 바뀌면 그 상자만 다시 붙이면 됩니다. */
  const roomFaceKey = roomFaceImages
    .map((item) =>
      [
        item.id,
        ...COMPOSITION_CUBE_FACES.map((face) => item.inner[face] || ""),
        ...COMPOSITION_CUBE_FACES.map((face) => item.outer?.[face] || ""),
        item.panorama || "",
        // 배경 영상. 어느 면에 어떤 영상인지가 바뀌면 그 상자만 다시 붙이면 됩니다(그림과 같은 규칙).
        item.video ? `${item.video.face}:${item.video.url}` : "",
      ].join(","),
    )
    .join("|");
  /** 면마다 뒤엣것을 가릴지. 재질만 건드리므로 상자를 다시 세우지 않습니다. */
  const roomOccludeKey = rooms
    .map((room: CompositionRoom) =>
      COMPOSITION_CUBE_FACES.map((face) =>
        room.occludeFaces?.[face] === true ? "1" : "0",
      ).join(""),
    )
    .join("|");
  // clips·clipDuration 은 일부러 뺐습니다. onGlbClips 가 그 둘을 채우는데,
  // 키에 들어 있으면 «GLB 붙임 → 콜백 → 키 변경 → GLB 다시 붙임» 으로 돕니다.
  const glbKey = (composition.glbTracks || [])
    .map((t) =>
      [
        t.id,
        t.url,
        t.clipName,
        t.visible,
        t.scale,
        t.position.x,
        t.position.y,
        t.position.z,
        t.rotation.x,
        t.rotation.y,
        t.rotation.z,
      ].join(","),
    )
    .join("|");
  const characterKey = composition.characters
    .map((c) =>
      [
        c.characterId,
        c.hidden,
        c.pose,
        JSON.stringify(c.position),
        JSON.stringify(c.rotation),
        JSON.stringify(c.bonePose || {}),
        JSON.stringify(c.fingers || {}),
        JSON.stringify(c.path || []),
      ].join(","),
    )
    .join("|");
  const objectKey = composition.objects
    .map((o) =>
      [
        o.id,
        o.kind,
        o.visible,
        o.lightType,
        o.intensity,
        o.color,
        JSON.stringify(o.position),
        JSON.stringify(o.rotation),
        JSON.stringify(o.scale),
        // 붙인 관절이 바뀌면 씬 그래프의 부모가 달라지므로 다시 세워야 합니다.
        o.attach ? `${o.attach.targetId}:${o.attach.bone}` : "",
        o.attach?.pivot ? JSON.stringify(o.attach.pivot) : "",
        o.groupId ?? "",
        // 벽에 입힌 그림이 바뀌면 판을 다시 세워 새 그림을 붙입니다.
        o.image ?? "",
        // 투시가 바뀌면 재질을 갈아 끼웁니다(비치는 재질은 그리는 차례가 다릅니다).
        o.seeThrough ? "see" : "",
      ].join(","),
    )
    .join("|")
    // 묶음의 색·부착이 바뀌어도 다시 세웁니다.
    .concat(
      "//",
      (composition.objectGroups ?? [])
        .map((g) =>
          [
            g.id,
            g.color,
            g.attach ? `${g.attach.targetId}:${g.attach.bone}` : "",
            g.attach ? JSON.stringify(g.attach.origin) : "",
          ].join(","),
        )
        .join("|"),
    );
  const anchorKey = cameraMove?.showAnchor
    ? [cameraMove.anchor.x, cameraMove.anchor.y, cameraMove.anchor.z].join(",")
    : "";

  const hasSkyLight = composition.objects.some(
    (item) => item.kind === "light" && item.lightType === "sky" && item.visible,
  );
  // 조명을 하나도 안 켰는데 배경만 환하면 인물이 오려 붙인 것처럼 보입니다.
  const backgroundDim = hasSkyLight ? 1 : composition.skylessBrightness;

  /** 배경을 붙일지, 빈 방에서 구도만 잡을지. 배경 이펙트의 키입니다. */
  const backgroundOn = backgroundOnOf(composition);

  // ── (a) 렌더러·씬·카메라·컨트롤·기즈모 — 마운트에 한 번 ─────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // ── 기본 얼개 ─────────────────────────────────────────────────────
    // 마운트 시점의 저장값으로 초기화합니다. 아래 작은 이펙트들이 같은 커밋에서
    // 한 번 더 맞추지만, animate() 첫 호출이 이 이펙트 안에서 바로 그리므로
    // 첫 프레임이 기본 카메라(원점)로 찍히지 않게 여기서도 세워 둡니다.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);

    const camera = new THREE.PerspectiveCamera(
      composition.camera.fovDegrees,
      aspectRef.current,
      0.05,
      400,
    );
    camera.position.set(
      composition.camera.position.x,
      composition.camera.position.y,
      composition.camera.position.z,
    );

    const previewPixelRatio = Math.min(window.devicePixelRatio, 2);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(previewPixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 바닥면을 숨기면 그림자도 같이 사라져야 합니다. 그림자를 받을 면이 없어도
    // 오브젝트끼리 드리우는 그림자가 남아 캡처에 찍히므로 그림자 맵 자체를 끕니다.
    renderer.shadowMap.enabled = composition.showFloor;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    /*
      ── 조작감 ────────────────────────────────────────────────────────
      기본값 그대로는 「너무 획획 움직여서 마우스로 맞추기가 어렵다」 가 됩니다.
      숫자로 짚은 까닭은 compositionEdit.ts 의 «궤도 조작감» 절에 적어 두었고,
      여기서는 그 결론만 겁니다.

      · dampingFactor 0.05 → 0.22 : 손을 뗀 뒤 미끄러지는 시간 0.97초 → 0.2초.
      · rotateSpeed 는 매 프레임 `orbitRotateSpeed` 로 다시 겁니다(화각만).
      · panSpeed·zoomSpeed 는 **1 그대로** 둡니다 — three 가 이미 시선점까지
        거리에 정확히 비례하게 계산합니다. 여기서 배율을 얹으면 「1px 끌면
        그림도 1px」 이라는 유일하게 옳은 기준이 깨집니다.
      · zoomToCursor : 휠을 굴리면 **커서 밑 지점**으로 파고듭니다. 회전축을
        옮기는 가장 빠른 길이라(three 가 시선점도 같이 옮깁니다) 「축이 어디로
        잡혀 있는지 모르겠다」 에 직접 듣습니다.
    */
    controls.dampingFactor = ORBIT_DAMPING;
    controls.zoomToCursor = true;
    /*
      가운데 버튼은 three 기본이 «달리(줌)» 인데, 화면 아래 도움말과 언리얼 모두 «이동» 입니다.
      휠로 이미 줌이 되므로 가운데는 이동 쪽이 쓸모가 큽니다.
    */
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    /*
      시선점이 카메라에 겹치면 회전이 발작합니다(반지름 0 에서 각도가 정의되지 않음).
      near 와 같은 값까지만 막습니다 — 더 크게 잡으면 아주 작은 방에서 이 클램프가
      카메라를 벽 밖으로 밀어내, 방 크기 보정이 지켜야 할 «화면 그대로» 가 깨집니다.
    */
    controls.minDistance = 0.05;
    controls.target.set(
      composition.camera.target.x,
      composition.camera.target.y,
      composition.camera.target.z,
    );

    const foreground = new THREE.Group();
    foreground.scale.setScalar(zoomRef.current || 1);
    scene.add(foreground);

    // ── 조명 ──────────────────────────────────────────────────────────
    // 세기·그림자 여부는 조명 이펙트가 맞춥니다.
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    /*
      방향은 그대로(4,8,5)이고 **거리만** 멀리 물립니다. 평행광이라 밝기는 거리와
      무관하지만 그림자 카메라는 이 자리에서 찍습니다 — 10 m 앞에 두면 48 m 격자의
      먼 구석이 near 평면 뒤로 넘어가 그림자가 잘립니다((24,0,24) 지점의 깊이가
      음수). 격자 폭의 1.5배(72 m)까지 물리면 격자 전체가 near~far 안에 듭니다.
    */
    key.position.set(4, 8, 5).setLength(FLOOR_SIZE * 1.5);
    key.castShadow = composition.showFloor;
    /*
      그림자 카메라는 **바닥 격자와 같은 넓이**를 덮어야 합니다.

      ±12 로 못 박아 두었던 값은 예전 FLOOR_SIZE(24)의 반쪽이었습니다. 격자를
      48 로 넓히면서 이 숫자를 안 따라가자, «바닥에 세우기» 가 허용하는 범위
      (±24) 의 바깥 절반 — 대략 16~24 m — 에서는 발밑 그림자가 아예 안 생겼습니다
      (실측: (0,0,−20)·(18,0,0)·(24,0,0) 모두 그림자 없음). 「인물이 그 배경의
      땅에 서 있어 보이게」 가 이 작업의 목적인데, 접지감을 주는 가장 강한 단서가
      바로 그 구간에서 사라진 겁니다. 그래서 FLOOR_SIZE 하나만 고치면 둘이 같이
      따라가게 상수에서 끌어 씁니다.

      절두체는 빛 방향으로 누운 정사각형이라, 월드의 48×48 격자를 **어느 방향에서
      보든** 덮으려면 반쪽이 아니라 «반대각선» 이 필요합니다 — 24√2 ≈ 33.9 m.
      24 로 두면 격자 네 귀퉁이((±24, ±24))에서만 그림자가 빠집니다.

      해상도는 **텍셀 밀도**로 정합니다. 예전은 24 m / 1024 = 2.34 cm/텍셀,
      지금은 67.9 m / 2048 = 3.31 cm/텍셀입니다. 1024 로 두면 6.6 cm 로 두 배
      뭉개지므로 2048 은 필요합니다. 완전히 예전 밀도로 돌아가려면 4096 이지만,
      그림자 맵은 매 프레임 다시 그려서 재생이 끊길 수 있어 여기서 멈춥니다.
    */
    // 여기 값은 «격자가 48m 일 때» 의 출발점입니다. «방» 에서는 격자가 방 크기를
    // 따라가므로, 아래 «바닥» 절의 이펙트가 **같은 함수로** 다시 맞춥니다(규칙 1).
    // 맵 크기만 여기서 한 번 — 텍셀 밀도 근거는 위 주석에.
    key.shadow.mapSize.set(2048, 2048);
    fitShadowToFloor(key, FLOOR_SIZE);
    scene.add(key);

    // ── 기즈모 ────────────────────────────────────────────────────────
    const transform = new TransformControls(camera, renderer.domElement);
    transform.addEventListener("dragging-changed", (event) => {
      controls.enabled = !(event as unknown as { value: boolean }).value;
    });
    scene.add(transform.getHelper());

    /*
      배경막 틀 — 배경(6면·파노라마·HDRI)이 바뀌어도 **틀은 그대로 삽니다.**
      틀을 배경과 함께 만들었다가는 배경을 바꿀 때마다 씬 그래프가 흔들려,
      한 프레임 동안 배경이 원점에 찍히는 깜박임이 생깁니다.
      바깥(rig) = 눈 자리·카메라 축·화면 배율, 안쪽(spin) = 그 회전 되돌리기.
    */
    const backgroundRoot = new THREE.Group();
    scene.add(backgroundRoot);

    const ctx: ViewportScene = {
      renderer,
      scene,
      camera,
      controls,
      transform,
      foreground,
      ambient,
      keyLight: key,
      characterRoots: new Map(),
      characterRigs: new Map(),
      objectRoots: new Map(),
      glbRoots: new Map(),
      glbMixers: [],
      anchorGroup: null,
      selectionRing: null,
      labels: [],
      background: {
        root: backgroundRoot,
        rooms: [],
        roomUnit: BACKGROUND_CUBE_SIZE,
        cutaway: true,
        subjects: null,
        videoCache: new Map(),
      },
      baseFov: composition.camera.fovDegrees,
      showMovesAt: null,
      orbitGlide: null,
      gizmo: { ...EMPTY_GIZMO },
      dragStartRotation: null,
      resize: () => {},
    };
    sceneRef.current = ctx;
    /*
      투시가 볼 인물 자리 — **가슴 높이**(발끝 + 1m). 발끝으로 선을 그으면 바닥 바로 위를
      지나 벽 아래 걸레받이만 걷히고 얼굴은 여전히 가려집니다.
      인물 뿌리 표를 그대로 읽으므로 인물이 걸어가도 매 프레임 따라갑니다.
    */
    ctx.background.subjects = () =>
      [...ctx.characterRoots.values()]
        .filter((root) => root.visible)
        .map((root) => root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)));

    /**
     * 드래그를 시작할 때의 값. **잡은 축만 갱신하려고 기억합니다.**
     *
     * 3D 회전은 쿼터니언이라, 한 축을 돌린 뒤 오일러로 되풀면 나머지 두 축
     * 값도 함께 바뀝니다. 수학적으로는 맞지만 쓰는 사람에게는 「X만 돌렸는데
     * Y·Z 숫자가 제멋대로 움직인다」 로 보입니다. 원래 값으로 돌리기도
     * 불가능해집니다.
     *
     * 그래서 **기즈모로 잡은 축의 값만** 새로 쓰고 나머지는 그대로 둡니다.
     * TransformControls 가 `axis` 로 지금 잡은 축을 알려 줍니다.
     */
    const rememberDragStart = () => {
      const { attachedBone, characterId } = ctx.gizmo;
      if (attachedBone && characterId) {
        ctx.dragStartRotation = boneDeltaEuler(attachedBone);
        return;
      }
      const root = transform.object as THREE.Object3D | undefined;
      if (!root) return;
      const euler = new THREE.Euler().setFromQuaternion(root.quaternion, "YXZ");
      ctx.dragStartRotation = { x: euler.x, y: euler.y, z: euler.z };
    };

    /** 잡은 축만 새 값으로 바꾼 회전. 축을 모르면 통째로 씁니다. */
    const axisOnly = (next: Vector3Value): Vector3Value => {
      const axis = transform.axis;
      const dragStartRotation = ctx.dragStartRotation;
      if (!dragStartRotation || !axis) return next;
      const key = axis.toLowerCase() as keyof Vector3Value;
      if (key !== "x" && key !== "y" && key !== "z") return next;
      return { ...dragStartRotation, [key]: next[key] };
    };

    const commitTransform = () => {
      const handlers = handlersRef.current;
      const {
        anchorAttached,
        attachedBone,
        characterId,
        bone,
        objectId,
        glbId,
        roomId,
      } = ctx.gizmo;

      // 앵커를 기즈모로 옮긴 경우
      if (anchorAttached && ctx.anchorGroup) {
        handlers.onAnchorChange?.({
          x: Number(ctx.anchorGroup.position.x.toFixed(3)),
          y: Number(ctx.anchorGroup.position.y.toFixed(3)),
          z: Number(ctx.anchorGroup.position.z.toFixed(3)),
        });
        return;
      }

      // 본을 직접 조작한 경우: 인물 전체 변환이 아니라 본 회전을 저장합니다.
      if (attachedBone && characterId) {
        handlers.onBonePose?.(
          characterId,
          bone!,
          axisOnly(boneDeltaEuler(attachedBone)),
        );
        return;
      }

      const root = transform.object as THREE.Object3D | undefined;
      if (!root) return;

      if (characterId) {
        // root.rotation 은 XYZ 오일러라 Y축을 90도 넘게 돌리면 표현이 뒤집힙니다
        // (x=π, z=π 로 튀면서 y 가 π-θ 로 접힘). YXZ 순서로 다시 풀어야
        // yaw 가 연속적으로 유지됩니다. 90도 이상에서 각도가 되돌아가던 원인입니다.
        const euler = new THREE.Euler().setFromQuaternion(
          root.quaternion,
          "YXZ",
        );
        const rotation = axisOnly({ x: euler.x, y: euler.y, z: euler.z });
        handlers.onCharacterTransform(characterId, {
          position: {
            x: root.position.x,
            y: root.position.y,
            z: root.position.z,
          },
          rotation,
          rotationY: rotation.y,
        });
        return;
      }
      if (objectId) {
        handlers.onObjectTransform(objectId, {
          position: {
            x: root.position.x,
            y: root.position.y,
            z: root.position.z,
          },
          rotation: {
            x: root.rotation.x,
            y: root.rotation.y,
            z: root.rotation.z,
          },
          scale: { x: root.scale.x, y: root.scale.y, z: root.scale.z },
        });
        return;
      }
      if (roomId) {
        /*
          방은 **자리·방향·크기**를 씁니다. 크기는 기즈모의 배율을 방 치수에 곱해 넣고(밑면이 바닥이라 높이는 위로만
          자랍니다), 배율은 다시 1 로 돌려 둡니다 — 안 그러면 다음 드래그에서 곱이 겹칩니다.
        */
        handlers.onRoomTransform?.(roomId, {
          position: {
            x: root.position.x,
            y: root.position.y,
            z: root.position.z,
          },
          rotationY: new THREE.Euler().setFromQuaternion(root.quaternion, "YXZ").y,
          scale: { x: root.scale.x, y: root.scale.y, z: root.scale.z },
        });
        root.scale.setScalar(1);
        return;
      }
      if (glbId) {
        handlers.onGlbTransform(glbId, {
          position: {
            x: root.position.x,
            y: root.position.y,
            z: root.position.z,
          },
          rotation: {
            x: root.rotation.x,
            y: root.rotation.y,
            z: root.rotation.z,
          },
          scale: root.scale.x,
        });
      }
    };
    /*
      ── 끌면서 **수치를 봅니다** ──────────────────────────────────────
      

      끌기 시작한 자리를 기억해 두고, 움직일 때마다 **그때부터 얼마나** 를 적습니다(«+1.20 m», «−35°», «×1.24»).
      절대값이 아니라 변화량인 까닭: 손이 기억하는 것은 «얼마나 돌렸나» 이지 «지금 각도가 몇 도인가» 가 아닙니다.
      절대값은 오른쪽 패널의 숫자 칸에 늘 떠 있습니다.

      React 상태를 쓰지 않습니다 — 끄는 동안 프레임마다 setState 하면 3D 씬이 통째로 다시 만들어집니다(CLAUDE.md 함정).
    */
    const readout = document.createElement("div");
    readout.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      "z-index:6",
      "padding:3px 8px",
      "border-radius:6px",
      "pointer-events:none",
      "white-space:nowrap",
      "font:600 12px/1.4 ui-monospace,SFMono-Regular,monospace",
      "background:rgba(10,12,18,0.88)",
      "border:1px solid rgba(160,180,255,0.35)",
      "color:#cfe0ff",
      "display:none",
    ].join(";");
    host.appendChild(readout);

    /**
     * 수치는 **잡고 있는 손잡이 옆**에 뜹니다.
     *
     *
     * 화면 맨 위에 두었더니 손은 기즈모를 잡고 눈은 위를 보는 꼴이었습니다. 끄는 동안 포인터가 곧 그 축 손잡이라,
     * 포인터를 따라다니게 하면 «축에 붙은» 것이 됩니다. 화면 밖으로 나가지 않게 가장자리에서 안으로 접습니다.
     */
    let pointerAt: { x: number; y: number } | null = null;
    const placeReadout = () => {
      if (!pointerAt) return;
      const box = host.getBoundingClientRect();
      const width = readout.offsetWidth || 90;
      const height = readout.offsetHeight || 22;
      // 손가락(커서) 오른쪽 위 — 손잡이와 숫자가 겹치지 않는 자리입니다.
      let left = pointerAt.x - box.left + 16;
      let top = pointerAt.y - box.top - height - 10;
      if (left + width > box.width - 8) left = pointerAt.x - box.left - width - 16;
      if (top < 8) top = pointerAt.y - box.top + 18;
      readout.style.left = `${Math.max(8, Math.min(box.width - width - 8, left))}px`;
      readout.style.top = `${Math.max(8, Math.min(box.height - height - 8, top))}px`;
    };
    const trackPointer = (event: PointerEvent) => {
      pointerAt = { x: event.clientX, y: event.clientY };
      if (readout.style.display !== "none") placeReadout();
    };
    renderer.domElement.addEventListener("pointermove", trackPointer);

    /** 지금 기즈모를 끌고 있는가. 값을 적어 둘 필요는 없습니다 — 화면에 적는 것이 «지금 값» 이라서요. */
    let dragging = false;
    let readoutTimer: ReturnType<typeof setTimeout> | null = null;

    const dragTarget = (): THREE.Object3D | null => {
      const { attachedBone } = ctx.gizmo;
      if (attachedBone) return attachedBone;
      return (transform.object as THREE.Object3D | undefined) ?? null;
    };

    const startReadout = () => {
      if (!dragTarget()) return;
      dragging = true;
      if (readoutTimer) {
        clearTimeout(readoutTimer);
        readoutTimer = null;
      }
    };

    const paintReadout = () => {
      const target = dragTarget();
      if (!dragging || !target) return;
      const axis = transform.axis ?? "";
      const mode = transform.mode;
      /*
        **지금 값**만 적습니다(, 「이동이랑 비율도 마찬가지」).

        처음에는 «이번에 얼마나 움직였나»(변화량)를 적었는데, 그러면 끌 때마다 0 에서 다시 시작해 「이 인물이 지금 몇 도인가」 를
        알 수 없었습니다. 화면에 보이는 것이 곧 숫자여야 합니다 — 오른쪽 패널의 값과도 같은 값입니다.
      */
      const wrap = (degrees: number) => {
        const value = (((degrees % 360) + 540) % 360) - 180;
        return Math.abs(value) < 0.05 ? 0 : value;
      };
      let text = "";
      if (mode === "translate") {
        const one = (key: "x" | "y" | "z") =>
          `${key.toUpperCase()} ${target.position[key].toFixed(2)} m`;
        text =
          axis === "X" || axis === "Y" || axis === "Z"
            ? one(axis.toLowerCase() as "x" | "y" | "z")
            : `${one("x")}  ${one("y")}  ${one("z")}`;
      } else if (mode === "rotate") {
        /*
          각은 **YXZ 오일러**로 풉니다 — XYZ 로 읽으면 Y 를 90° 넘길 때 표현이 뒤집혀(x=π·z=π 로 튀며 y 가 접힘)
          돌리는데 숫자가 되돌아갑니다. 이 파일의 `axisOnly` 주석과 같은 까닭입니다.
        */
        const euler = new THREE.Euler().setFromQuaternion(target.quaternion, "YXZ");
        const axisKey = axis.toLowerCase() as "x" | "y" | "z";
        const one = (key: "x" | "y" | "z") =>
          `${key.toUpperCase()} ${wrap(THREE.MathUtils.radToDeg(euler[key])).toFixed(1)}°`;
        text =
          axisKey === "x" || axisKey === "y" || axisKey === "z"
            ? one(axisKey)
            : `${one("x")}  ${one("y")}  ${one("z")}`;
      } else {
        const same =
          Math.abs(target.scale.x - target.scale.y) < 0.001 &&
          Math.abs(target.scale.y - target.scale.z) < 0.001;
        text = same
          ? `×${target.scale.x.toFixed(3)}`
          : `X ×${target.scale.x.toFixed(2)}  Y ×${target.scale.y.toFixed(2)}  Z ×${target.scale.z.toFixed(2)}`;
      }
      readout.textContent = text;
      readout.style.display = "block";
      placeReadout();
    };

    const endReadout = () => {
      dragging = false;
      // 놓자마자 지우면 «얼마나 움직였는지» 를 읽을 새가 없습니다. 잠깐 두었다 지웁니다.
      if (readoutTimer) clearTimeout(readoutTimer);
      readoutTimer = setTimeout(() => {
        readout.style.display = "none";
        readoutTimer = null;
      }, 1500);
    };

    transform.addEventListener("mouseDown", rememberDragStart);
    transform.addEventListener("mouseDown", startReadout);
    transform.addEventListener("objectChange", paintReadout);
    transform.addEventListener("mouseUp", commitTransform);
    transform.addEventListener("mouseUp", endReadout);

    // ── 카메라 무빙 미리보기 ──────────────────────────────────────────
    const applyCameraPose = (pose: CameraPose) => {
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      controls.target.set(pose.target.x, pose.target.y, pose.target.z);
      camera.lookAt(controls.target);
      const nextFov = ctx.baseFov * pose.fovScale;
      if (Math.abs(camera.fov - nextFov) > 0.0001) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    };

    /*
      ── 처음 자리 ────────────────────────────────────────────────────────
      

      창을 열었을 때의 카메라를 그대로 적어 둡니다. 걷다가 길을 잃었을 때 돌아올 자리가
      필요한데, «맨 처음 보던 그림» 이 가장 헷갈리지 않는 기준입니다.

      부드럽게 옮기지 않는 까닭: 여기는 자리도 방향도 한꺼번에 바뀌므로, 중간 프레임이
      어디를 보는지 뜻이 없습니다. 시선점만 옮기는 F 와 다릅니다.
    */
    const openedPose: CameraPose = {
      position: { ...camera.position },
      target: { ...controls.target },
      fovScale: 1,
    };
    /**
     * G 가 돌아갈 자리 — **활성 구도가 있으면 그 구도**, 없으면 창을 열었을 때의 자리.
     *
     * 구도를 세워 두었으면 «처음» 의 뜻이 그쪽으로 옮겨갑니다.
     * 화각은 배율이 아니라 도(度)로 저장돼 있어, 지금 기준 화각에 대한 배율로 바꿔 넣습니다.
     */
    const goHome = () => {
      ctx.orbitGlide = null;
      const shot = activeCameraShot(handlersRef.current.composition);
      applyCameraPose(
        shot
          ? {
              position: { ...shot.position },
              target: { ...shot.target },
              fovScale: ctx.baseFov > 0 ? shot.fovDegrees / ctx.baseFov : 1,
            }
          : openedPose,
      );
      if (!previewingRef.current) commitCameraPose();
      return shot?.name ?? null;
    };

    /*
      ── 대상에 붙은 앵커 풀기 ────────────────────────────────────────────
      앵커가 인물·소품에 붙어 있으면(`anchorTargetId`) 그때 **3D 에 서 있는 자리**를 씁니다.
      상태에 적힌 자리가 아니라 씬의 자리라야 동선 트랙으로 걸어가는 사람을 따라갑니다.

      «어느 클립의 앵커를 쓸지» 는 세 갈래입니다(`anchorSourceOf`).
        · 클립에 `anchorFromId` 가 있으면 **그 클립**의 앵커 설정 — 
        · 앵커 잠금(`lockAnchors`)이면 첫 클립 — 전부 한 사람을 돌 때
        · 아무것도 없으면 자기 것
    */
    const anchorSourceOf = (move: CameraMove) => {
      const list = cameraMovesRef.current;
      if (move.anchorFromId) return resolveAnchorSource(move, list);
      return lockAnchorsOf(handlersRef.current.composition)
        ? (sortedMoves(list)[0] ?? move)
        : move;
    };

    const resolveAnchor = (move: CameraMove) => {
      const source = anchorSourceOf(move);
      const targetId = source.anchorTargetId;
      if (!targetId) return source === move ? null : { ...source.anchor };
      const node =
        ctx.characterRoots.get(targetId) ?? ctx.objectRoots.get(targetId);
      if (!node) return source === move ? null : { ...source.anchor };
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) return { ...source.anchor };
      const ratio = source.anchorRatio ?? 0.73;
      return {
        x: (box.min.x + box.max.x) / 2,
        y: box.min.y + (box.max.y - box.min.y) * ratio,
        z: (box.min.z + box.max.z) / 2,
      };
    };

    /*
      ── 저장한 구도로 갈아타기 ───────────────────────────────────────────
      클립에 «출발 카메라»(`cameraShotId`)가 걸려 있으면 그 시각에 컷이 바뀝니다.
      
    */
    const resolveShot = (shotId: string) => {
      const shot = cameraShotsOf(handlersRef.current.composition).find(
        (item) => item.id === shotId,
      );
      if (!shot) return null;
      return {
        position: { ...shot.position },
        target: { ...shot.target },
        fovScale: ctx.baseFov > 0 ? shot.fovDegrees / ctx.baseFov : 1,
      };
    };

    /*
      ── 앵커 표시를 따라 움직이기 ────────────────────────────────────────
      

      표시용 십자는 만들 때 `move.anchor` 자리에 세우고 끝이었습니다. 따라가기를 켜면
      **계산은** 대상을 따라갔지만(`resolveAnchor`) **보이는 십자는** 처음 자리에 그대로
      남아, 화면에서는 「안 따라간다」 로 보였습니다. 매 프레임 풀어서 옮깁니다.

      손으로 끄는 중(기즈모)에는 건드리지 않습니다 — 매 프레임 되돌리면 끌리지 않습니다
      (인물 트랙에서 똑같이 겪은 사고, `applyMotionTime` 의 같은 자리 참고).
    */
    const syncAnchorMarker = () => {
      const group = ctx.anchorGroup;
      const move = handlersRef.current.cameraMove;
      if (!group || !move?.showAnchor) return;
      if (transform.dragging || transform.axis) return;
      const at = resolveAnchor(move);
      if (!at) return;
      group.position.set(at.x, at.y, at.z);
    };

    /*
      ── 눈금을 옮기면 그 시각의 카메라를 보여 줍니다 ─────────────────────
      

      계산은 맞았습니다(실측: 구도 1에서 앵커로 정확히 2.5m). 문제는 **멈춰 있을 때는
      카메라를 아예 안 건드렸다**는 것입니다 — 눈금을 옮겨도 화면이 그대로라, 저장한
      구도에서 출발하는지 눈으로 확인할 길이 없었습니다.

      **매 프레임이 아니라 «눈금이 옮겨졌을 때만»** 적용합니다. 매 프레임 덮어쓰면
      화면을 돌릴 수가 없습니다(돌리는 족족 되돌아옵니다). 눈금은 손으로 옮길 때만
      바뀌므로, 돌리기와 싸우지 않습니다 — 인물 트랙이 멈춰 있을 때도 값을 보여 주는
      것과 같은 뜻입니다.
    */
    const showMovesAt = (time: number) => {
      const list = cameraMovesRef.current;
      if (!list.length) return;
      applyCameraPose(
        evaluateCameraMoves(
          baseCameraRef.current,
          list,
          time,
          resolveAnchor,
          resolveShot,
        ),
      );
    };
    ctx.showMovesAt = showMovesAt;

    const applyCameraMove = () => {
      if (!previewingRef.current) return;
      const list = cameraMovesRef.current;
      if (!list.length) return;
      applyCameraPose(
        evaluateCameraMoves(
          baseCameraRef.current,
          list,
          playheadRef.current,
          resolveAnchor,
          resolveShot,
        ),
      );
    };

    /*
      인물·소품 트랙을 그 시각의 값으로 맞춥니다 — **멈춰 있을 때도** 그렇게 합니다.

      처음에는 재생 중에만 적용했습니다. 그런데 그러면 키 사이를 오가며 값을 고칠 수가
      없습니다 — 2초 키로 가 봐야 물체가 그 자리에 없으니까요().

      기즈모로 옮긴 값이 되돌려지지 않는 까닭: 트랙이 있는 대상은 값을 만지는 순간
      **그 시각에 키가 찍힙니다**(`CompositionPlanner` 의 자동 키). 그래서 트랙이 다시
      읽어도 같은 값이 나옵니다. 애프터이펙트와 같은 규칙입니다.
    */
    const applyMotionTime = (time = playheadRef.current) => {
      /*
        **기즈모를 끄는 동안에는 손대지 않습니다.**

        트랙이 매 프레임 값을 덮어쓰는데, 끄는 중에는 아직 키가 찍히기 전이라 옛 값으로
        되돌아갑니다 — 화면에서는 «물체가 안 움직이는» 것으로 보입니다().
        손을 떼면 그 값이 상태로 들어가고 자동 키가 찍힌 뒤 다시 트랙이 맡습니다.
      */
      applyTimedVisibility(time);
      applyTimedOcclusion(time);
      if (transform.dragging || transform.axis) return;
      applyTimedPose(time);
      for (const track of motionTracksRef.current) {
        if (track.channel === "pose") continue;
        const at = evaluateMotionTrack(track, time);
        if (!at) continue;
        const node =
          ctx.characterRoots.get(track.targetId) ??
          ctx.objectRoots.get(track.targetId) ??
          // GLB 도 같은 트랙으로 움직입니다 — 제 애니메이션은 클립이 돌리고,
          // 어디서 어디로 가는지는 이 트랙이 정합니다.
          ctx.glbRoots.get(track.targetId);
        if (!node) continue;
        // 트랙 하나가 한 속성만 적습니다 — 자리를 옮겨도 회전은 그대로입니다.
        if (track.channel === "position") node.position.set(at.x, at.y, at.z);
        else if (track.channel === "rotation")
          node.rotation.set(at.x, at.y, at.z);
        else node.scale.set(at.x, at.y, at.z);
      }
    };

    /*
      ── 자세 트랙 — 관절마다의 회전 ─────────────────────────────────────
      

      같은 시각·같은 트랙이면 **다시 걸지 않습니다.** 이 함수는 멈춰 있을 때도 매 프레임
      도는데, 손가락 하나 돌릴 때마다 뼈대 전체의 행렬을 다시 계산해서 다섯 사람이면
      프레임마다 수만 번이 됩니다. 인형을 새로 세우면 기억(`userData`)도 새로 시작해 한 번 겁니다.

      트랙이 **사라진** 인형(키를 다 지움)은 상태의 자세로 한 번 되돌립니다 — 안 그러면 마지막으로
      계산한 자세에 굳어 «키를 지웠는데 그대로» 가 됩니다.
    */
    const applyTimedPose = (time: number) => {
      const current = timedCompositionRef.current;
      ctx.characterRigs.forEach((rig, id) => {
        const track = motionTracksRef.current.find(
          (item) => item.targetId === id && item.channel === "pose" && item.keys.length > 0,
        );
        const was = rig.userData.timedPose as { track: unknown; time: number } | undefined;
        if (!track) {
          if (!was) return;
          delete rig.userData.timedPose;
          const character = current.characters.find((item) => item.characterId === id);
          setLiveBonePose(rig, character?.bonePose ?? {});
          return;
        }
        if (was && was.track === track && Math.abs(was.time - time) < 1e-6) return;
        const bones = evaluatePoseTrack(track, time);
        if (!bones) return;
        setLiveBonePose(rig, bones);
        rig.userData.timedPose = { track, time };
      });
    };

    /*
      ── 레이어 막대 — 막대 안에서만 화면에 있습니다 ──────────────────
      , 「카메라처럼
      타임라인에 채워 넣고… 올삐가 나타나는 시작점 끝점으로 직관적으로 보이잖아」.

      막대가 **있었던** 대상만 기억해 둡니다. 막대를 지우면 그 대상은 원래대로(보임) 돌려
      놓아야 하는데, 막대가 사라진 뒤에는 누구를 돌려놔야 할지 알 길이 없어서입니다.
      기즈모로 끄는 중에도 적용합니다 — 사라진 사람을 잡고 있을 수는 없습니다.
    */
    const visibilityTouched = new Set<string>();
    const applyTimedVisibility = (time: number) => {
      const current = timedCompositionRef.current;
      const tracked = new Set(layersOf(current).map((layer) => layer.targetId));
      const ids = new Set([...tracked, ...visibilityTouched]);
      ids.forEach((id) => {
        const node = ctx.characterRoots.get(id) ?? ctx.objectRoots.get(id);
        if (!node) return;
        /*
          소품은 자기 «보이기» 스위치(`ObjectComposition.visible`)가 따로 있습니다.
          트랙이 그 위에 얹히는 것이지 그것을 무시하면 안 됩니다 — 꺼 둔 소품이 트랙
          때문에 나타나면 놀랍니다.
        */
        const base =
          (current.objects || []).find((item) => item.id === id)?.visible !== false;
        node.visible = base && visibleAtIn(current, id, time);
        if (tracked.has(id)) visibilityTouched.add(id);
        else visibilityTouched.delete(id);
      });
    };

    /*
      ── 시간대별 «가릴 면» ───────────────────────────────────────────
      

      안쪽 껍질의 가림을 **여기서 매 프레임** 정합니다(예전에는 체크박스가 바뀔 때 한 번).
      같은 값이면 재질을 안 건드립니다 — `needsUpdate` 를 매 프레임 걸면 셰이더를 다시 짜느라
      재생이 끊깁니다. 상자를 새로 세우면 기억이 없어 첫 프레임에 한 번 걸립니다.
    */
    const applyTimedOcclusion = (time: number) => {
      const current = timedCompositionRef.current;
      ctx.background.rooms.forEach((entry) => {
        const faces = COMPOSITION_CUBE_FACES.map((face) =>
          occludeAtIn(current, entry.id, face, time),
        );
        const key = faces.map((on) => (on ? "1" : "0")).join("");
        if (entry.inner.userData.timedOccludeKey === key) return;
        entry.inner.userData.timedOccludeKey = key;
        setBackgroundOcclusion(
          entry.inner,
          (face) => faces[COMPOSITION_CUBE_FACES.indexOf(face)] === true,
          THREE.BackSide,
        );
      });
      /*
        소품의 «투시» 도 같은 자리에서 정합니다().
        값이 그대로면 재질을 안 건드립니다 — `setObjectSeeThrough` 가 먼저 견줍니다.
      */
      current.objects.forEach((item) => {
        const root = ctx.objectRoots.get(item.id);
        if (root) setObjectSeeThrough(root, objectSeeThroughAtIn(current, item.id, time));
      });
    };

    /*
      ── 배경 흐름 ──────────────────────────────────────────────────────
      면·돔 그림을 그 시각만큼 옮깁니다(`CompositionRoom.drift`). **재생 루프와 영상 렌더가
      둘 다 여기를 지납니다** — 한쪽만 부르면 화면에서는 흐르는데 레퍼런스 영상에는 한 프레임도
      안 찍혀, 배경을 움직이려고 켠 것이 헛일이 됩니다.

      React 상태는 안 읽습니다. 속도·텍스처는 상자를 세울 때 틀(`ctx.background.rooms`)에 적어
      두었습니다 — 프레임마다 상태를 읽으면 씬이 통째로 다시 만들어집니다.
    */
    const applyBackgroundDrift = (time = playheadRef.current) => {
      ctx.background.rooms.forEach((entry) => {
        if (!entry.driftTextures.length) return;
        applyRoomDrift(entry.driftTextures, entry.drift, time);
      });
    };

    /*
      ── 배경 영상 ──────────────────────────────────────────────────────
      면·돔에 건 영상을 **구도잡기 시각에 맞춥니다**(`CompositionRoom.video`). 재생하면 같이 돌고,
      멈추면 같이 멈추고, 눈금을 옮기면 그 시각의 프레임으로 갑니다 — 흐름과 같은 약속입니다.

      영상 렌더는 이 길로 안 옵니다. 되감기가 비동기라 **기다렸다가 그려야** 하고(`drawAt` 옆의
      `prepareAt`), 여기서 같이 부르면 한 프레임 전 그림이 찍힙니다.
    */
    const applyBackgroundVideo = (
      time = playheadRef.current,
      playing = playingRef?.current === true,
    ) => {
      ctx.background.rooms.forEach((entry) => {
        if (!entry.videoTextures.length) return;
        applyRoomVideoTime(entry.videoTextures, time, playing);
      });
    };

    const applyGlbTime = (time = playheadRef.current) => {
      ctx.glbMixers.forEach(({ mixer, track, clipDuration }) => {
        let local = Math.max(0, (time - track.startTime) * (track.speed || 1));
        if (!track.loop && clipDuration > 0)
          local = Math.min(local, clipDuration - 0.0001);
        else if (track.loop && clipDuration > 0) local %= clipDuration;
        mixer.setTime(local);
      });
    };

    // 미리보기 중에는 카메라를 타임라인이 몹니다. 사용자가 화면을 돌리면 해제합니다.
    controls.addEventListener("start", () => {
      if (previewingRef.current) handlersRef.current.onPreviewInterrupt?.();
    });

    // 드래그로 화면을 돌리는 동안에는 해상도를 한 단계 더 낮춥니다.
    // 조작 중에는 화질보다 반응 속도가 중요하고, 손을 떼면 곧바로 원래 화질로 돌아옵니다.
    let restoreQualityTimer: number | undefined;
    controls.addEventListener("start", () => {
      if (restoreQualityTimer) window.clearTimeout(restoreQualityTimer);
      renderer.setPixelRatio(Math.min(previewPixelRatio, 1));
    });
    controls.addEventListener("end", () => {
      if (restoreQualityTimer) window.clearTimeout(restoreQualityTimer);
      restoreQualityTimer = window.setTimeout(() => {
        renderer.setPixelRatio(previewPixelRatio);
        renderer.shadowMap.needsUpdate = true;
      }, 120);
      // 사용자가 돌려 놓은 카메라를 구도에 반영합니다.
      if (previewingRef.current) return;
      commitCameraPose();
    });

    function commitCameraPose() {
      const pose = {
        position: {
          x: Number(camera.position.x.toFixed(3)),
          y: Number(camera.position.y.toFixed(3)),
          z: Number(camera.position.z.toFixed(3)),
        },
        target: {
          x: Number(controls.target.x.toFixed(3)),
          y: Number(controls.target.y.toFixed(3)),
          z: Number(controls.target.z.toFixed(3)),
        },
      };
      // 이 값이 props 로 되돌아오면 카메라 이펙트가 건너뛰도록 기억해 둡니다.
      lastCameraPoseRef.current = { ...pose, fovScale: 1 };
      handlersRef.current.onCameraChange(pose);
    }

    /*
      ── 돌리기·집기 ────────────────────────────────────────────────────
      회전 중심을 잡는 세 가지 길(드래그 시작 · 더블클릭 · F)과 화면에서 집기는
      `viewport/orbit.ts` 한 곳에 모았습니다. 여기 있던 함수 열세 개가 이 이펙트를
      1300줄로 만들던 가장 큰 덩어리였습니다(2026-09-14 정리).

      이벤트 등록·해제는 **여기 그대로** 둡니다 — 리스너 붙는 순서가 조작감에 영향을
      주는데, 그 순서까지 옮기면 정리하는 김에 바뀌어 버립니다.
    */
    const orbit = createOrbit({
      camera,
      controls,
      dom: renderer.domElement,
      scene: ctx,
      handlers: handlersRef,
      previewing: previewingRef,
      transform,
      commitCameraPose,
    });
    orbitFocusRef.current = orbit.focus;
    renderer.domElement.addEventListener("pointerdown", orbit.onPointerDown);
    renderer.domElement.addEventListener("pointerup", orbit.onPointerUp);
    renderer.domElement.addEventListener("dblclick", orbit.onDoubleClick);

    /*
      ── 키보드 ────────────────────────────────────────────────────────
      걷기(W/A/S/D/Q/E)와 한 글자 단축키(1·2·3 · F · G)는 `keyboardMove.ts` 로
      옮겼습니다. 등록·해제만 여기 남습니다 — 리스너가 붙는 순서가 조작감을
      바꾸므로 순서는 이 이펙트가 계속 들고 있습니다.
    */
    const keyboard = createKeyboardMove({
      camera,
      controls,
      orbit,
      scene: ctx,
      handlers: handlersRef,
      previewing: previewingRef,
      commitCameraPose,
      goHome,
    });
    window.addEventListener("keydown", keyboard.onKeyDown);
    window.addEventListener("keyup", keyboard.onKeyUp);
    window.addEventListener("blur", keyboard.onWindowBlur);

    /*
      ── 바닥에 세우기 ─────────────────────────────────────────────────
      화면을 찍은 곳으로 인물을 옮기는 일은 `groundPlacing.ts` 로 옮겼습니다.
      기즈모가 **먼저** 등록돼 있어야 «끌던 중인지» 를 알 수 있어, 등록 자리는
      여기 그대로 둡니다.
    */
    const ground = createGroundPlacing({
      camera,
      dom: renderer.domElement,
      transform,
      handlers: handlersRef,
      previewing: previewingRef,
      zoom: zoomRef,
    });
    renderer.domElement.addEventListener("pointerdown", ground.onPointerDown);
    renderer.domElement.addEventListener("pointerup", ground.onPointerUp);

    // ── 재생 루프 ─────────────────────────────────────────────────────
    // 재생 중 프레임률 계측·표시. 값이 눈에 보여야 무엇을 줄일지 판단할 수 있습니다.
    const fpsBadge = document.createElement("div");
    fpsBadge.style.cssText = [
      "position:absolute",
      "left:8px",
      "bottom:8px",
      "z-index:5",
      "padding:2px 6px",
      "border-radius:4px",
      "pointer-events:none",
      "font:600 10px/1.4 ui-monospace,SFMono-Regular,monospace",
      "background:rgba(10,12,18,0.72)",
      "color:#9fb4ff",
      "display:none",
    ].join(";");
    host.appendChild(fpsBadge);

    // 영상 렌더 중에는 원래 상태를 여기 보관했다가 끝나면 되돌립니다.
    let videoRenderState: {
      size: THREE.Vector2;
      pixelRatio: number;
      aspect: number;
      hidden: THREE.Object3D[];
      shadowAuto: boolean;
    } | null = null;

    let animationFrame = 0;
    let frameCount = 0;
    let fpsWindowStart = performance.now();
    let previewingBefore = false;
    let shadowFrame = 0;

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      // 영상 렌더 중에는 미리보기 루프가 캔버스 크기와 카메라를 건드리면 안 됩니다.
      if (videoRenderState) return;
      const previewing = previewingRef.current;

      // 미리보기에 들어가고 나올 때 화질을 전환합니다.
      // 재생 중에는 화질보다 매끄러움이 중요하고, 멈추면 곧바로 원래 화질로 돌아옵니다.
      if (previewing !== previewingBefore) {
        previewingBefore = previewing;
        renderer.setPixelRatio(previewing ? 1 : previewPixelRatio);
        renderer.shadowMap.needsUpdate = true;
        fpsBadge.style.display = previewing ? "block" : "none";
        frameCount = 0;
        fpsWindowStart = performance.now();
      }

      keyboard.advance();
      // 시선점을 옮기는 중이면 이어서 옮기고, 화각·거리에 맞춘 회전 감도를 다시 겁니다.
      orbit.advanceGlide();
      orbit.applyFeel();
      // 트랙은 재생 중이 아니어도 맞춥니다 — 키 사이를 오가며 값을 고쳐야 하니까요.
      applyMotionTime();
      applyCameraMove();
      applyGlbTime();
      // 배경도 트랙과 같은 규칙 — 멈춰 있어도 그 시각의 자리로. 눈금을 끌면 배경이 따라 흐릅니다.
      applyBackgroundDrift();
      applyBackgroundVideo();

      // 그림자 맵을 다시 굽는 건 씬을 한 번 더 그리는 것과 같습니다.
      // 매 프레임 하면 비용이 두 배가 되므로 3프레임에 한 번만 갱신합니다.
      // 참고용 화면에서 그림자가 한두 프레임 늦는 건 눈에 띄지 않습니다.
      if (previewing && ctx.glbMixers.length && shadowFrame++ % 3 === 0) {
        renderer.shadowMap.needsUpdate = true;
      }

      controls.update();

      /*
        이름표는 물체 크기와 카메라 거리·화각을 되돌려 «화면에서 늘 같은 크기» 로
        둡니다. 기즈모로 물체를 끄는 동안에도, 카메라가 미끄러지는 동안에도
        React 상태는 안 바뀌므로 여기서 매 프레임 다시 계산합니다.
      */
      ctx.labels.forEach((label) => syncLabel(label, camera));
      // 따라가기 앵커는 대상이 걸어가면 같이 가야 합니다 — 표시도 매 프레임 맞춥니다.
      syncAnchorMarker();

      /*
        배경막을 카메라 자리로 옮기고 화면 배율을 다시 겁니다 — 매 프레임.

        `controls.update()` 뒤라야 합니다. 감쇠(damping)로 카메라가 아직
        미끄러지는 중이면 한 프레임 뒤처진 자리에 배경이 놓여, 손을 뗄 때
        배경이 미세하게 흔들립니다.
      */
      placeBackgroundRig(ctx.background, camera);

      renderer.render(scene, camera);

      if (previewing) {
        frameCount += 1;
        const now = performance.now();
        const elapsed = now - fpsWindowStart;
        if (elapsed >= 500) {
          const measured = (frameCount * 1000) / elapsed;
          frameCount = 0;
          fpsWindowStart = now;
          fpsBadge.textContent = `${measured.toFixed(0)} fps`;
          fpsBadge.style.color =
            measured >= 50 ? "#7fe0a8" : measured >= 28 ? "#ffd08a" : "#ff9a9a";
          // 30 아래로 떨어지면 해상도를 한 단계 더 내려서라도 끊김을 막습니다.
          if (measured < 28) renderer.setPixelRatio(0.75);
          else if (measured > 55) renderer.setPixelRatio(1);
        }
      }
    };
    animate();

    // ── 화면 찍기 ─────────────────────────────────────────────────────
    /*
      «구도 캡처» 와 «배경 플레이트» — 같은 카메라, 두 장.

       등장방형 파노라마는 **저장 형식**이지 한 컷의
      그림이 아닙니다. 생성기에 원본을 그대로 주면 그 왜곡을 따라 그리고, 화각이 안 맞으니
      제 나름대로 다시 해석합니다.

      그래서 배경 레퍼런스는 **이 카메라에서 본 배경만 그린 한 장**(인물·소품·헬퍼를 뺀 것)을
      씁니다. 원근이 이미 맞게 잘려 있어 왜곡이 없고, 컷마다 같은 3D 세트에서 나오므로
      A→B 컷 전환에서도 배경이 그대로입니다.
    */
    handlersRef.current.onCaptureReady((options) => {
      // 외부 조종기는 기둥 대체물이나 덜 읽은 배경을 보고 다음 판단을 하면 안 됩니다.
      // 수동 캡처는 기존 동작을 지키고, 완료를 보장하는 명령만 실제 로딩 상태를 확인합니다.
      if (options?.requireReady) {
        if (videoRenderState) throw new Error("레퍼런스 영상 렌더가 끝나야 구도를 캡처할 수 있습니다.");
        // Codex/Claude가 앞에 있으면 rAF가 멈출 수 있습니다. 평소 재생 루프의 같은 계산을 직접 적용합니다.
        applyMotionTime();
        applyCameraMove();
        applyGlbTime();
        applyBackgroundDrift();
        applyBackgroundVideo();
        controls.update();
        placeBackgroundRig(ctx.background, camera);
        renderer.shadowMap.needsUpdate = true;
        const current = handlersRef.current.composition;
        const missingCharacter = current.characters.some(item => !item.hidden && !ctx.characterRigs.has(item.characterId));
        const missingGlb = (current.glbTracks ?? []).some(item => item.visible && (item.filePath || item.url) && !ctx.glbRoots.has(item.id));
        let missingTexture = false;
        scene.traverseVisible(node => {
          if (!(node instanceof THREE.Mesh)) return;
          if (node.userData.captureAssetPending || node.userData.captureAssetFailed) missingTexture = true;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) {
            const map = (material as THREE.MeshStandardMaterial).map;
            if (!map) continue;
            const source = map.image as HTMLImageElement | HTMLVideoElement | undefined;
            if (!source || (source instanceof HTMLImageElement && (!source.complete || source.naturalWidth === 0)) || (source instanceof HTMLVideoElement && (source.readyState < 2 || source.seeking))) missingTexture = true;
          }
        });
        if (missingCharacter || missingGlb || missingTexture) throw new Error("구도에 필요한 모델 또는 그림을 읽는 중입니다.");
      }
      const helper = transform.getHelper();
      const wasHelper = helper.visible;
      helper.visible = false;
      const hidden: THREE.Object3D[] = [];
      /*
        헬퍼(격자·이름표·동선·앵커·기즈모)는 **두 장 모두에서** 뺍니다.

        예전에는 배경 플레이트에서만 뺐습니다. 그런데 구도 그림에 남은 이름표를
        생성기가 «그림 속 글자» 로 알아듣고 그대로 그려 넣습니다 — 컷마다 다른
        낙서가 생기고, 지우려면 손을 대야 합니다().

        이름을 지우면 「저 마네킹이 누구인가」 가 사라지는데, 그건 그림이 아니라
        **프롬프트**로 넘깁니다 — 마네킹의 식별 색을 글로 적어 보냅니다
        (`lib/compositionLegend.ts`).
      */
      scene.traverse((node) => {
        if (node.userData.helper && node.visible) {
          node.visible = false;
          hidden.push(node);
        }
      });
      // 배경 플레이트는 여기에 더해 전경(인물·소품·GLB)까지 통째로 끕니다.
      if (options?.backgroundOnly && ctx.foreground.visible) {
        ctx.foreground.visible = false;
        hidden.push(ctx.foreground);
      }
      try {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      } finally {
        // 캔버스 읽기가 실패해도 사람이 보던 화면의 헬퍼·전경은 반드시 돌려놓습니다.
        hidden.forEach((node) => { node.visible = true; });
        helper.visible = wasHelper;
      }
    });

    // 레퍼런스 영상용 프레임 렌더러.
    // 미리보기 루프와 달리 「시각을 지정해서 한 장 그리기」가 필요합니다.
    // 헬퍼(격자·이름표·경로·앵커·기즈모)는 영상에 나오면 안 되므로 잠시 숨깁니다.
    handlersRef.current.onVideoRenderReady?.({
      canvas: renderer.domElement,
      begin: (width, height) => {
        videoRenderState = {
          size: renderer.getSize(new THREE.Vector2()),
          pixelRatio: renderer.getPixelRatio(),
          aspect: camera.aspect,
          hidden: [],
          shadowAuto: renderer.shadowMap.autoUpdate,
        };
        const helper = transform.getHelper();
        if (helper.visible) {
          helper.visible = false;
          videoRenderState.hidden.push(helper);
        }
        foreground.traverse((node) => {
          if (node.userData.helper && node.visible) {
            node.visible = false;
            videoRenderState!.hidden.push(node);
          }
        });
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        // 프레임마다 물체가 움직이므로 그림자는 매번 다시 구워야 합니다.
        // 실시간이 아니니 비용은 문제가 안 됩니다.
        renderer.shadowMap.autoUpdate = true;
      },
      /*
        배경 영상만 **기다릴 것**이 있습니다. 카메라·인물·GLB 는 값을 넣으면 그 자리에서 끝나지만
        영상은 되감기가 끝나야 그 프레임이 올라옵니다(`seekRoomVideoTime`).
      */
      prepareAt: async (time) => {
        const entries = ctx.background.rooms.flatMap((room) => room.videoTextures);
        if (!entries.length) return;
        await seekRoomVideoTime(entries, time);
      },
      drawAt: (time) => {
        const list = cameraMovesRef.current;
        if (list.length)
          applyCameraPose(
            evaluateCameraMoves(
              baseCameraRef.current,
              list,
              time,
              resolveAnchor,
              resolveShot,
            ),
          );
        applyMotionTime(time);
        applyGlbTime(time);
        // 영상은 미리보기 루프를 거치지 않습니다. 여기서도 배경을 카메라에
        // 붙이지 않으면 무빙이 있는 컷에서 배경만 제자리에 남아 미끄러집니다.
        // 배경 흐름도 같은 까닭 — 빠뜨리면 화면에서만 흐르고 영상에는 정지 배경이 굽힙니다.
        applyBackgroundDrift(time);
        placeBackgroundRig(ctx.background, camera);
        renderer.render(scene, camera);
      },
      end: () => {
        if (!videoRenderState) return;
        renderer.setPixelRatio(videoRenderState.pixelRatio);
        renderer.setSize(
          videoRenderState.size.x,
          videoRenderState.size.y,
          false,
        );
        camera.aspect = videoRenderState.aspect;
        camera.updateProjectionMatrix();
        renderer.shadowMap.autoUpdate = videoRenderState.shadowAuto;
        renderer.shadowMap.needsUpdate = true;
        videoRenderState.hidden.forEach((node) => {
          node.visible = true;
        });
        videoRenderState = null;
      },
    });

    // ── 크기 맞추기 ───────────────────────────────────────────────────
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      // aspect 0 = 자유 화면(«3D 배치») — 호스트 비율을 그대로 씁니다.
      camera.aspect = aspectRef.current || host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    };
    ctx.resize = resize;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("keydown", keyboard.onKeyDown);
      window.removeEventListener("keyup", keyboard.onKeyUp);
      window.removeEventListener("blur", keyboard.onWindowBlur);
      renderer.domElement.removeEventListener(
        "pointerdown",
        ground.onPointerDown,
      );
      renderer.domElement.removeEventListener("pointerup", ground.onPointerUp);
      renderer.domElement.removeEventListener(
        "pointerdown",
        orbit.onPointerDown,
      );
      renderer.domElement.removeEventListener("pointerup", orbit.onPointerUp);
      renderer.domElement.removeEventListener("dblclick", orbit.onDoubleClick);
      orbitFocusRef.current = null;
      if (restoreQualityTimer) window.clearTimeout(restoreQualityTimer);
      handlersRef.current.onCaptureReady(null);
      handlersRef.current.onVideoRenderReady?.(null);
      transform.detach();
      transform.dispose();
      controls.dispose();
      /*
        **띄워 둔 배경 영상을 전부 놓습니다.** 방을 세우는 이펙트는 «다시 세우기» 와 «창 닫기» 를
        구분하지 못해 거기서는 못 놓습니다(놓으면 크기 슬라이더를 끄는 내내 다시 읽습니다).
        여기까지 왔다면 이 씬은 끝난 것이라, 남은 `<video>` 는 디코더만 붙들고 있습니다.
      */
      releaseRoomVideoTextures(ctx.background.videoCache, new Set());
      renderer.dispose();
      renderer.domElement.remove();
      fpsBadge.remove();
      // 끌 때 수치를 보여 주던 배지도 함께 — 남겨 두면 창을 다시 열 때 옛 글자가 떠 있습니다.
      if (readoutTimer) clearTimeout(readoutTimer);
      renderer.domElement.removeEventListener("pointermove", trackPointer);
      readout.remove();
      sceneRef.current = null;
    };
    // 마운트에 한 번만. 저장값은 아래 이펙트들이 각자 따라갑니다.
    // 콜백은 ref 로 넘기므로 여기 없습니다 — 넣으면 부모가 다시 그려질 때마다
    // 씬이 통째로 재생성됩니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 카메라 자세 — 저장값이 바깥에서 바뀌었을 때만 ───────────────────────
  const cameraPosition = composition.camera.position;
  const cameraTarget = composition.camera.target;
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const pose: CameraPose = {
      position: {
        x: cameraPosition.x,
        y: cameraPosition.y,
        z: cameraPosition.z,
      },
      target: { x: cameraTarget.x, y: cameraTarget.y, z: cameraTarget.z },
      fovScale: 1,
    };
    // 우리가 mouseUp 에서 보낸 값이 그대로 돌아온 것이면 건너뜁니다(감쇠 유지).
    if (lastCameraPoseRef.current && samePose(lastCameraPoseRef.current, pose))
      return;
    lastCameraPoseRef.current = pose;
    ctx.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    ctx.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    // 바깥이 카메라를 옮겼습니다 — 옮기던 중심은 뜻을 잃습니다.
    ctx.orbitGlide = null;
  }, [
    cameraPosition.x,
    cameraPosition.y,
    cameraPosition.z,
    cameraTarget.x,
    cameraTarget.y,
    cameraTarget.z,
  ]);

  /*
    ── 회전 중심을 «고른 대상» 으로 ─────────────────────────────────────
    고른 것이 바뀌면 시선점을 그 몸의 가슴 높이로 부드럽게 옮깁니다. 순간이동은
    안 됩니다 — 카메라 자리는 그대로인데 바라보는 점만 바뀌므로 화면이 튑니다.

    고른 것이 없어졌을 때는 **아무것도 하지 않습니다.** 그때는 돌리기를 시작할 때
    화면 한가운데 바닥으로 조용히 다시 잡히는데(`viewport/orbit.ts` 의 `onPointerDown`),
    그쪽은 시선 축 위라 화면이 안 움직입니다.

    선택 직후 한 프레임 안에 인물이 아직 안 만들어졌을 수 있어(GLB 는 파일을 읽고
    붙습니다) 못 찾으면 그냥 넘어갑니다 — 그래도 F 로 언제든 다시 잡을 수 있습니다.
  */
  useEffect(() => {
    /*
      **창을 열자마자는 일하지 않습니다.** 마운트 때도 이 이펙트가 한 번 도는데,
      그때 중심을 옮기면 「구도잡기를 열기만 했는데 저장된 카메라가 바뀌어 있다」
      가 됩니다. 사람이 고른 것을 «바꿨을 때» 만 옮깁니다.
    */
    if (!orbitFocusReadyRef.current) {
      orbitFocusReadyRef.current = true;
      return;
    }
    if (!selectedCharacterId && !selectedObjectId && !selectedGlbId && !selectedRoomId)
      return;
    if (previewingRef.current) return;
    /*
      ── 무빙을 짜는 중에는 화면을 안 돌립니다 ──────────────────────────
      , 「난 내가 잡은 구도인 이미지 1 에서 달리가 시작했으면
      좋겠다는 거고」.

      중심 옮기기는 **시선점을 그 몸으로** 보내는 일이라 카메라가 그쪽으로 고개를
      돌립니다 — 애써 잡아 둔 구도가 한순간에 무너집니다. 앵커를 붙이려고 인물을
      고르는 것뿐인데 구도가 바뀌면, 「무빙이 딴 데서 시작한다」 로 보일 수밖에 없습니다.

      그래서 **무빙이 있고 재생 머리가 첫 클립 앞**일 때, 곧 «출발 구도를 보고 있는
      중» 일 때는 건너뜁니다. 그때는 구도를 지키는 것이 중심을 옮기는 것보다 중요합니다.
      다른 때는 예전처럼 옮기고, 언제든 **F** 로 직접 잡을 수 있습니다.
    */
    const moves = cameraMovesRef.current;
    if (moves.length) {
      const firstStart = sortedMoves(moves)[0]?.startTime ?? 0;
      if (playheadRef.current <= firstStart + 0.0001) return;
    }
    orbitFocusRef.current?.();
    // previewingRef 는 ref 라 의존성에 넣지 않습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharacterId, selectedObjectId, selectedGlbId]);

  // ── 화각 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.baseFov = composition.camera.fovDegrees;
    ctx.camera.fov = composition.camera.fovDegrees;
    ctx.camera.updateProjectionMatrix();
  }, [composition.camera.fovDegrees]);

  // ── 화면 비율 ─────────────────────────────────────────────────────────
  useEffect(() => {
    sceneRef.current?.resize();
  }, [aspect]);

  /*
    ── 전경 확대 ────────────────────────────────────────────────────────
    그룹을 통째로 키웁니다. 그러면 **인물 사이 거리도 같이 늘어나서**, 배율이 크면
    둘이 화면 밖으로 흩어집니다().
    그래서 가로·세로(x·z)는 전경의 한가운데를 붙들어 제자리에서 커지게 하고,
    높이(y)는 건드리지 않습니다 — y 까지 보정하면 발이 바닥을 뚫고 내려갑니다.

    한가운데는 **씬의 자식이 아니라 상태**에서 셉니다(`foregroundPivotOf`).
    격자·굵은 선·그림자 면도 전경의 자식이라 예전에는 평균에 섞였고, 굵은 선을
    하나 더 넣자 저장된 컷의 인물이 딴 자리에 섰습니다(20배에서 5.7 m). 「바닥을
    껐다 켜는 것」 만으로 배치가 움직이면 안 됩니다. 까닭은 compositionEdit.ts 의
    «전경 확대의 피벗» 절에.
  */
  const zoomPivot = useMemo(
    () => foregroundPivotOf(composition),
    // 인물·소품·GLB 의 좌표는 이 키들이 대신합니다(객체는 매번 새 참조라 못 씁니다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [characterKey, objectKey, glbKey],
  );
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const zoom = zoomRef.current || 1;
    ctx.foreground.scale.setScalar(zoom);
    ctx.foreground.position.set(
      zoomPivot.x - zoom * zoomPivot.x,
      0,
      zoomPivot.z - zoom * zoomPivot.z,
    );
  }, [composition.foregroundZoom, zoomPivot]);

  // ── 조명 세기·그림자 ──────────────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.ambient.intensity = hasSkyLight ? 0.35 : 0.7;
    ctx.keyLight.castShadow = composition.showFloor;
    // 바닥면을 숨기면 그림자도 같이 사라져야 합니다. 그림자를 받을 면이 없어도
    // 오브젝트끼리 드리우는 그림자가 남아 캡처에 찍히므로 그림자 맵 자체를 끕니다.
    ctx.renderer.shadowMap.enabled = composition.showFloor;
    ctx.renderer.shadowMap.needsUpdate = true;
  }, [hasSkyLight, composition.showFloor]);

  /*
    ── 바닥 ─────────────────────────────────────────────────────────────
    격자 한 변은 «방» 에서 방 크기를 따라갑니다(`floorSizeOf`). 방의 밑면이 곧
    바닥이라 둘이 다르면 벽 아래로 격자가 삐져나가거나 모자랍니다.

    그림자 카메라와 조명 거리도 같은 값을 봅니다 — 예전에 FLOOR_SIZE 만 넓히고
    그림자 범위를 안 따라가게 두었다가, 16~24m 구간의 인물에게서 발밑 그림자가
    통째로 사라진 적이 있습니다(위 (a) 이펙트의 그림자 주석). 방은 3m 도 되고
    400m 도 되므로 여기서 반드시 같이 맞춥니다.
  */
  const floorSize = floorSizeOf(composition);
  const floorDepth = floorDepthOf(composition);
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    // 빛을 먼저 물립니다 — `fitShadowToFloor` 의 near/far 가 «빛까지의 거리» 를 봅니다.
    ctx.keyLight.position.set(4, 8, 5).setLength(floorSize * 1.5);
    fitShadowToFloor(ctx.keyLight, floorSize);
    ctx.renderer.shadowMap.needsUpdate = true;
  }, [floorSize]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !composition.showFloor) return;
    const { grid, majorGrid, floor } = buildFloor(floorSize, floorDepth);
    ctx.foreground.add(grid);
    ctx.foreground.add(majorGrid);
    ctx.foreground.add(floor);
    return () => {
      grid.removeFromParent();
      majorGrid.removeFromParent();
      floor.removeFromParent();
      disposeOwnedMesh(grid);
      disposeOwnedMesh(majorGrid);
      disposeOwnedMesh(floor);
    };
  }, [composition.showFloor, floorSize, floorDepth]);

  // ── «바닥에 세우기» 커서 ──────────────────────────────────────────────
  // 모드가 켜진 것이 커서로도 보여야 «클릭이 왜 인물을 옮기지» 하지 않습니다.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.renderer.domElement.style.cursor = groundPlacing ? "crosshair" : "";
    return () => {
      const current = sceneRef.current;
      if (current) current.renderer.domElement.style.cursor = "";
    };
  }, [groundPlacing]);

  // ── (c) 배경 — 방 배열 ───────────────────────────────────────────────
  /*
    ── 배경: 방마다 여섯 면 ─────────────────────────────────────────────
    여섯 면은 «눈높이에서 본 여섯 방향» 이라 상자 안쪽에 그대로 붙입니다. 면이 빈 자리는
    어두운 색으로 두어 «아직 안 넣었다» 가 보이게 합니다.

    , 「큐브의 안쪽 면이랑 바깥쪽 면에
    적용되는 걸 다르게 적용될 수 있게」. 방마다 틀 하나에 껍질 둘(안쪽 벽지·바깥쪽 외벽)을
    세웁니다. 바깥면을 안 붙인 방은 껍질을 아예 안 만듭니다 — 지금까지처럼 밖에서 보면
    방이 투명해서 안이 훤히 보입니다.
  */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { scene } = ctx;
    scene.background = new THREE.Color(0x0a0a0f);
    scene.environment = null;
    scene.environmentIntensity = 1;

    const built: ViewportScene["background"]["rooms"] = [];
    ctx.background.rooms = built;

    if (backgroundOn) {
      ctx.background.roomUnit = BACKGROUND_CUBE_SIZE;
      rooms.forEach((room: CompositionRoom) => {
        if (room.hidden) return;
        const images = roomFaceImages.find((item) => item.id === room.id);
        const rig = new THREE.Group();
        /*
          **호리존**은 그림·돔·바깥 껍질이 전부 없습니다 — 여섯 면이 색 하나입니다. 면 그림이 어쩌다
          남아 있어도(컷의 배경 동기화가 활성 방에 걸 수 있습니다) 색이 이깁니다 — «색을 골랐는데 그림이 보인다» 보다
          «그림이 안 보인다» 가 덜 놀랍고, 방 갈래는 세울 때 정한 것이라서요.
        */
        const solidColor = room.horizon?.color;
        /*
          **배경 흐름이 걸린 방은 제 몫의 텍스처를 씁니다**(`loadRoomDriftTexture` 머리말).
          공용 캐시를 흘리면 같은 그림을 쓰는 다른 방까지 따라 흐릅니다. 호리존은 그림이
          아니라 색이라 흐를 것이 없습니다.
        */
        const drift = solidColor ? null : room.drift ?? null;
        const driftTextures: THREE.Texture[] = [];
        /*
          **배경 영상**(`CompositionRoom.video`) — 그 면(또는 돔)만 정지 그림 대신 영상입니다.
          주소가 그림 자리에 그대로 들어가므로 상자·돔을 세우는 코드는 한 줄도 갈래를 타지 않습니다.
          호리존은 색 하나라 걸 자리가 없고, 아직 안 고른 «켜 두기만 한» 상태도 빈 주소라 지나갑니다.
        */
        const video = solidColor || !images?.video?.url ? null : images.video;
        const videoTextures: RoomVideoTexture[] = [];
        const loadTexture = (source: string) => {
          if (video && source === video.url) {
            const entry = loadRoomVideoTexture(ctx.background.videoCache, room.id, source);
            if (!videoTextures.includes(entry)) videoTextures.push(entry);
            // 흐름을 함께 켜 두었으면 영상도 흐릅니다(흐르는 영상) — 서로를 끄지 않습니다.
            if (drift && !driftTextures.includes(entry.texture)) driftTextures.push(entry.texture);
            return entry.texture;
          }
          if (!drift) return loadCachedTexture(source);
          const texture = loadRoomDriftTexture(room.id, source);
          // 같은 그림이 여러 면에 걸릴 수 있습니다 — 두 번 옮기지는 않지만 목록이 부풀 까닭도 없습니다.
          if (!driftTextures.includes(texture)) driftTextures.push(texture);
          return texture;
        };
        /** 영상을 건 면은 그림 자리를 영상 주소로 갈아 끼웁니다(돔은 아래 `panoramaSource`). */
        const innerImages = solidColor
          ? {}
          : video && video.face !== "panorama"
            ? { ...(images?.inner ?? {}), [video.face]: video.url }
            : images?.inner ?? {};
        const panoramaSource =
          video?.face === "panorama" ? video.url : images?.panorama || "";
        // 면 순서·uv 보정·크기는 sceneHelpers 가 한꺼번에 들고 있습니다.
        // 여기서 순서만 따로 적어 두면 uv 보정과 어긋나 여섯 장이 또 뒤틀립니다.
        const inner = buildRoomShell(innerImages, {
          shell: "inner",
          dim: backgroundDim,
          loadTexture,
          // 옆면 아래 자르기는 실외 세트의 지평선 맞추기라, 단색 벽에서는 뜻이 없고 벽에 구멍만 냅니다.
          sideCropBottom: solidColor ? undefined : room.sideCropBottom,
          solidColor,
        });
        rig.add(inner);
        /*
          파노라마 돔이 걸린 방은 상자를 **숨기고** 돔을 세웁니다. 상자는 지우지 않습니다 — 투시·칠하는 순서·방 안 판정이
          `inner` 를 기준으로 돌아서, 없애면 그 계산이 전부 갈래를 타야 합니다. 바깥 껍질은 돔과 뜻이 겹쳐 세우지 않습니다.
        */
        /*
          **돔으로 고른 실외는 그림이 없어도 돔입니다.** 여태 파노라마가 걸려야만 돔이 서고, 그전에는 상자가 서 있었습니다.
          고른 모양과 보이는 모양이 다르면 크기를 가늠할 수 없어, 그림이 없으면 안내선만 세웁니다.
        */
        const domeLike = isDomeRoom(room);
        const domeRadius = Math.max(room.width, room.depth) / 2;
        const dome = panoramaSource && !solidColor
          ? buildPanoramaDome({
              panorama: panoramaSource,
              radius: domeRadius,
              eye: OUTDOOR_EYE_HEIGHT,
              dim: backgroundDim,
              loadTexture,
              // 바닥은 여섯 면 표에서 옵니다 — 영상을 건 돔에서도 발밑 지도는 그대로 실측 그림입니다.
              floor: innerImages.bottom ? { source: innerImages.bottom, width: room.width, depth: room.depth } : null,
            })
          : domeLike
            ? buildDomeGuide({ radius: domeRadius, eye: OUTDOOR_EYE_HEIGHT })
            : null;
        if (dome) {
          inner.visible = false;
          ctx.background.root?.add(dome);
        }
        const outer = images?.outer && !dome && !solidColor
          ? buildRoomShell(images.outer, {
              shell: "outer",
              dim: backgroundDim,
              loadTexture,
            })
          : null;
        if (outer) rig.add(outer);
        ctx.background.root?.add(rig);
        built.push({
          id: room.id,
          rig,
          inner,
          outer,
          dome,
          width: room.width,
          depth: room.depth,
          height: room.height,
          position: room.position,
          rotationY: room.rotationY,
          drift,
          driftTextures,
          videoTextures,
        });
      });
      // 첫 프레임이 원점에 찍히지 않게 세우자마자 한 번 제자리로.
      placeBackgroundRig(ctx.background, ctx.camera);
    }
    /*
      흐름을 끈 방·지운 방의 텍스처를 놓아 줍니다. 세울 때 훑는 까닭은 **정리(cleanup)에서는
      안 되기** 때문입니다 — 정리는 다음 세우기 **직전**에 돌아서, 거기서 지우면 크기 슬라이더를
      끄는 동안(상자가 매 프레임 다시 섭니다) 여섯 장을 프레임마다 다시 읽어 벽이 깜박입니다.
    */
    releaseRoomDriftTextures(
      new Set(built.filter((entry) => entry.driftTextures.length > 0).map((entry) => entry.id)),
    );
    /*
      **끝난 영상은 반드시 놓아 줍니다.** 방을 바꾸거나 «배경 영상» 을 끄면 그 `<video>` 는 다시
      안 쓰이는데, 그냥 두면 디코더가 쌓여 몇 번 만에 3D 화면이 버벅입니다(`releaseRoomVideoTextures`).
      흐름과 같은 자리에서 훑는 까닭도 같습니다 — 정리(cleanup)에서 하면 크기 슬라이더를 끄는 동안
      상자가 매 프레임 다시 서면서 영상이 프레임마다 다시 로드됩니다.
    */
    releaseRoomVideoTextures(
      ctx.background.videoCache,
      new Set(built.flatMap((entry) => entry.videoTextures.map((item) => item.key))),
    );

    return () => {
      if (ctx.background.rooms === built) ctx.background.rooms = [];
      built.forEach((entry) => {
        entry.rig.removeFromParent();
        if (entry.dome) {
          entry.dome.removeFromParent();
          entry.dome.traverse((node: THREE.Object3D) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            disposeMaterials(mesh.material);
          });
        }
        [entry.inner, entry.outer].forEach((mesh) => {
          if (!mesh) return;
          mesh.removeFromParent();
          // 텍스처는 캐시 소유라 재질·지오메트리만 지웁니다.
          mesh.geometry.dispose();
          disposeMaterials(mesh.material);
        });
      });
    };
    // 방과 면의 내용은 roomShapeKey·roomFaceKey 가 대신합니다(객체는 매번 새 참조라 못 씁니다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundOn, roomShapeKey, roomFaceKey, backgroundDim]);

  /*
    ── 방 크기 ──────────────────────────────────────────────────────────
    한 변 S 를 값 하나로 넘깁니다. 배경막은 그대로 두고 틀의 배율만 바뀌므로
    (`placeBackgroundRig` 의 «방» 절) 슬라이더를 드래그해도 깜박이지 않습니다.

    카메라의 far 도 여기서 함께 봅니다. 400m 방 안에서 한쪽 벽에 붙어 서면 반대쪽
    벽까지가 400m 라, 못 박아 둔 far(400)로는 **벽이 통째로 잘려 사라집니다.**
    필요한 만큼만 늘리는 이유는 near(0.05) 와의 비가 커질수록 깊이 정밀도가
    떨어져 가까운 면끼리 z-fighting 이 나기 때문입니다. 방 대각선(√3·S)에 조금
    여유를 둔 값이면 어느 구석에 서도 반대편 모서리가 보입니다.
  */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    /*
      **카메라 보정은 여기서 하지 않습니다.**

      방 크기를 바꿀 때 화면이 튀지 않게 카메라를 같은 비율로 옮기는 일은
      `roomKeepViewIn`(lib/compositionEdit.ts) 이 «크기를 정하는 편집 함수» 안에서
      한 커밋으로 합니다. 예전에는 이 이펙트가 «크기가 바뀌었는데 카메라는 안
      바뀐 커밋» 을 조건으로 보정했는데, 그 조건은 «사람이 방 손잡이를 만졌다» 와
      다른 것이라 자동 넓히기·«카메라도 같이» 끔 에도 걸려 카메라가 날아가고
      되돌리기 항목이 둘씩 쌓였습니다(까닭은 `roomKeepViewIn` 주석).

      여기 남은 것은 «씬에 크기를 알려 주는 일» 뿐입니다.
    */
    /*
      씬이 들고 있는 치수를 **방마다** 새로 적습니다. 상자를 다시 세우지 않고 틀의 배율만
      바꾸므로 슬라이더를 끄는 동안 여섯 장을 다시 붙이는 깜박임이 없습니다.
      (방을 더하거나 빼는 것은 위 이펙트가 `roomShapeKey` 로 처리합니다 — 여기는 «있는
      방의 치수·자리가 바뀐 경우» 만 봅니다.)
    */
    let reach = 0;
    ctx.background.rooms.forEach((entry) => {
      const room = rooms.find((item: CompositionRoom) => item.id === entry.id);
      if (!room) return;
      entry.width = room.width;
      entry.depth = room.depth;
      entry.height = room.height;
      entry.position = room.position;
      entry.rotationY = room.rotationY;
      reach = Math.max(
        reach,
        Math.hypot(room.position.x, room.position.z) +
          Math.max(room.width, room.depth, room.height),
      );
    });
    placeBackgroundRig(ctx.background, ctx.camera);
    /*
      **far 는 방 전체를 담아야 합니다.** 400m 방 안에서 한쪽 벽에 붙어 서면 반대쪽
      벽까지가 400m 라, 못 박아 둔 far(400)로는 벽이 통째로 잘려 사라집니다. 방이 여럿이면
      가장 먼 방의 반대 구석까지가 기준이라 «자리까지의 거리 + 그 방의 가장 긴 변» 입니다.

      필요한 만큼만 늘리는 까닭은 near(0.05) 와의 비가 커질수록 깊이 정밀도가 떨어져
      가까운 면끼리 z-fighting 이 나기 때문입니다.
    */
    const far = Math.max(400, reach * 2);
    if (ctx.camera.far !== far) {
      ctx.camera.far = far;
      ctx.camera.updateProjectionMatrix();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomShapeKey]);

  /*
    투시 스위치. 매 프레임 쓰는 값이라 ctx 에 옮겨 적기만 합니다(씬을 다시 세우지 않음).
    기본은 켜짐 — 까닭과 이름 내력은 `CompositionState.outerCutaway` 주석에.
  */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.background.cutaway = composition.outerCutaway !== false;
  }, [composition.outerCutaway]);

  /*
    배경 상자가 뒤엣것을 가릴지. 재질만 건드리므로 상자를 다시 세우지 않습니다 —
    체크를 누를 때마다 여섯 장을 다시 붙이면 깜박입니다.
  */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.background.rooms.forEach((entry) => {
      /*
        안쪽 껍질은 **매 프레임** 정합니다(`applyTimedOcclusion`) — 시간대별 키가 생겨서요.
        여기서는 기억만 지워, 체크박스를 바꾼 다음 프레임에 새 값이 걸리게 합니다.
      */
      delete entry.inner.userData.timedOccludeKey;
      /*
        바깥 껍질은 **그림을 붙인 면만** 깊이를 씁니다.

        외벽 그림을 붙였다는 것은 「밖에서 보면 건물이 보인다」 는 뜻이라 그 면은 늘
        가려야 합니다(안쪽 가리기는 방 안 구도를 위한 별개의 손잡이라 엮지 않습니다).
        반대로 **안 붙인 면은 투명한 판**인데, 거기까지 깊이를 쓰면 보이지도 않는 판이
        뒤엣것을 지웁니다 — 앞면만 그린 건물의 옆으로 돌아가면 방 안이 통째로
        사라집니다. 그래서 «그림이 있는가» 를 그대로 조건으로 씁니다.
      */
      const outerImages = roomFaceImages.find(
        (item) => item.id === entry.id,
      )?.outer;
      if (entry.outer)
        setBackgroundOcclusion(
          entry.outer,
          (face) => !!outerImages?.[face],
          THREE.FrontSide,
        );
    });
    // 면이 바뀌면 상자를 새로 세우므로 그때도 다시 걸어야 합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomOccludeKey, roomShapeKey, roomFaceKey]);

  // ── (b) 인물 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { foreground, characterRoots, characterRigs } = ctx;
    let cancelled = false;
    /** 이 실행에서 foreground 에 직접 넣은 것들(인물 루트·동선). 정리 때 빼려고 기억합니다. */
    const added: THREE.Object3D[] = [];
    /** 리그가 붙으면 figure 에서 빠지는 기둥들. 빠진 뒤에도 GPU 자원은 남아 있어 따로 지웁니다. */
    const fallbacks: THREE.Group[] = [];
    /** 이 실행이 등록한 이름표. 정리 때 ctx.labels 에서 이것만 빼려고 기억합니다. */
    const labels: LabelAnchor[] = [];
    /** 몸 색 표 — 숨긴 사람까지 넣어 세므로, 누군가를 껐다 켜도 색이 흔들리지 않습니다. */
    const bodyColors = characterColorMap(
      composition,
      (id) => characters.find((item) => item.id === id)?.gender,
    );

    composition.characters
      .filter((placement) => !placement.hidden)
      .forEach((placement, index) => {
        const source = characters.find(
          (item) => item.id === placement.characterId,
        );
        const heightCm = source?.heightCm ?? placement.heightCm ?? 170;
        const tall = heightCm / 100;
        const gender = source?.gender ?? placement.gender;
        /*
          몸 색은 `compositionColors` 가 정한 표에서 꺼내 옵니다 — 화면·왼쪽 목록·프롬프트 대조표가
          **같은 표**를 봐야 «저 파란 사람» 이 통합니다. 예전에는 셋이 각자 순번을 세다가 어긋났고,
          성별 팔레트가 넷뿐이라 다섯 번째 사람부터 앞사람과 같은 색이 됐습니다(2026-09-17).
        */
        const bodyColor = bodyColors.get(placement.characterId) || "#9aa4b8";

        const figure = new THREE.Group();
        figure.position.set(
          placement.position.x,
          placement.position.y,
          placement.position.z,
        );
        // 캐릭터도 오브젝트처럼 3축 회전을 저장합니다. rotation 이 없는 예전 데이터는
        // normalizeComposition 에서 rotationY 로부터 채워집니다.
        figure.rotation.set(
          placement.rotation?.x ?? 0,
          placement.rotation?.y ?? placement.rotationY ?? 0,
          placement.rotation?.z ?? 0,
        );
        foreground.add(figure);
        added.push(figure);
        characterRoots.set(placement.characterId, figure);

        const fallback = buildFallbackFigure(bodyColor, tall);
        figure.add(fallback);
        fallbacks.push(fallback);

        /** 리그드 모델을 붙이고 포즈를 적용합니다. */
        const attachRig = (template: THREE.Group) => {
          const loaded = cloneSkeleton(template) as THREE.Group;
          loaded.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            node.castShadow = true;
            node.receiveShadow = true;
            // cloneSkeleton 은 재질을 템플릿과 공유합니다. 색을 그대로 바꾸면 같은 모델을
            // 쓰는 모든 캐릭터가 함께 물들기 때문에 인스턴스마다 재질을 복제합니다.
            const materials = Array.isArray(node.material)
              ? node.material
              : [node.material];
            const cloned = materials.map((material) => {
              const copy = material.clone() as THREE.MeshStandardMaterial;
              if (copy.color) copy.color.set(bodyColor);
              return copy;
            });
            node.material = cloned.length === 1 ? cloned[0] : cloned;
          });

          // 모델 원본 키를 재서 실제 키에 맞춥니다.
          const bounds = new THREE.Box3().setFromObject(loaded);
          const natural = bounds.max.y - bounds.min.y || 1;
          loaded.scale.setScalar(tall / natural);

          // 포즈 → 사용자의 세부 조정 순서라야 합니다.
          // 순서가 바뀌면 프리셋이 사용자의 수정을 덮어써서 편집이 사라집니다.
          applyBasePose(loaded);
          applyBonePose(loaded, placement.bonePose);
          loaded.updateMatrixWorld(true);

          // 접지 보정. Box3 는 스키닝을 반영 못 하므로 관절 높이를 직접 잽니다.
          const lowest = lowestGroundY(loaded);
          if (lowest !== null) loaded.position.y -= lowest;
          else
            loaded.position.y -= new THREE.Box3().setFromObject(loaded).min.y;

          figure.remove(fallback);
          figure.add(loaded);
          characterRigs.set(placement.characterId, loaded);
        };

        const modelUrl = MODEL_URLS[mannequinBody(gender)];
        const template = modelTemplates.get(modelUrl);
        if (template) {
          attachRig(template);
        } else {
          // 확장자로 로더를 가립니다. FBX 는 씬 그래프를 바로 돌려주고,
          // GLB 는 gltf.scene 안에 들어 있습니다.
          const isFbx = /\.fbx$/i.test(modelUrl);
          const onLoaded = (loaded: THREE.Group) => {
            modelTemplates.set(modelUrl, loaded);
            if (cancelled) return;
            attachRig(loaded);
            // 본 기즈모는 리그가 있어야 붙습니다. 첫 로드가 끝난 지금 다시 시도합니다.
            syncSelectionRef.current?.();
          };
          /**
           * 모델을 못 읽으면 기둥으로 물러섭니다. 구도 잡는 데 지장은 없지만
           * **조용히 넘기면 안 됩니다.** 예전에 경로를 잘못 잡아 놓고 「왜
           * 마네킹이 안 뜨지」 하며 한참 헤맸어요. 콘솔에 이유를 남깁니다.
           */
          const onError = (error: unknown) => {
            console.warn(
              `[구도잡기] 마네킹 모델을 읽지 못했습니다 · ${modelUrl}\n` +
                `client/public/models/ 안에 있는지 확인해 주세요. Vite 루트가 client/ 라 ` +
                `프로젝트 최상단 public/ 은 안 읽습니다.`,
              error,
            );
          };

          if (isFbx)
            new FBXLoader().load(modelUrl, onLoaded, undefined, onError);
          else
            new GLTFLoader().load(
              modelUrl,
              (gltf) => onLoaded(gltf.scene),
              undefined,
              onError,
            );
        }

        if (composition.showLabels) {
          // 인물 그룹에는 scale 을 걸지 않아 지금은 늘어날 일이 없지만, 기즈모
          // «크기» 모드로 인물을 잡으면 그룹이 커집니다. 소품과 같은 길로 붙여
          // 두면 어느 쪽이든 이름표만 그대로 남습니다.
          labels.push(
            attachLabel(
              figure,
              createLabel(source?.name || `인물 ${index + 1}`, bodyColor),
              tall,
            ),
          );
        }

        // 동선
        if (
          composition.showCharacterPaths &&
          (placement.path?.length ?? 0) > 1
        ) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(
              placement.path!.map(
                (p) => new THREE.Vector3(p.x, p.y + 0.02, p.z),
              ),
            ),
            new THREE.LineBasicMaterial({ color: bodyColor }),
          );
          line.userData.helper = true;
          foreground.add(line);
          added.push(line);
        }
      });

    ctx.labels.push(...labels);

    // 인물이 새로 만들어졌으니 기즈모·선택 링을 새 물체에 다시 붙입니다.
    syncSelectionRef.current?.();

    return () => {
      cancelled = true;
      ctx.labels = ctx.labels.filter((entry) => !labels.includes(entry));
      // 복제한 리그는 지오메트리를 템플릿과 공유하므로 재질만 지웁니다.
      characterRigs.forEach((rig) => {
        rig.traverse((node) => {
          if (node instanceof THREE.Mesh) disposeMaterials(node.material);
        });
        rig.removeFromParent();
      });
      characterRigs.clear();
      characterRoots.clear();
      added.forEach((object) => {
        object.removeFromParent();
        disposeOwnedMesh(object);
      });
      fallbacks.forEach(disposeOwnedMesh);
    };
    // composition.characters 의 내용은 characterKey 가 대신합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    characterKey,
    characters,
    composition.showLabels,
    composition.showCharacterPaths,
  ]);

  // ── 소품·조명 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { foreground, objectRoots, characterRigs } = ctx;
    const added: THREE.Group[] = [];
    /** 이 실행이 등록한 이름표. 정리 때 ctx.labels 에서 이것만 빼려고 기억합니다. */
    const labels: LabelAnchor[] = [];

    composition.objects
      .filter((item) => item.visible)
      .forEach((item) => {
        const group0 = new THREE.Group();
        group0.position.set(item.position.x, item.position.y, item.position.z);
        group0.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
        group0.scale.set(item.scale.x, item.scale.y, item.scale.z);
        /*
          ── 관절에 붙이기 ─────────────────────────────────────────────
          

          three 의 씬 그래프가 그대로 답입니다 — 관절의 **자식**으로 넣으면 손이
          움직일 때 행렬이 저절로 따라옵니다. 손 위치를 매 프레임 베껴 쓰는 길도
          있지만, 그러면 포즈를 바꾸는 동안 한 프레임씩 뒤처져 검이 손에서 덜컹거립니다.

          인물이 아직 안 붙었으면(GLB 는 파일을 읽고 붙습니다) 전경에 그대로 둡니다 —
          인물이 들어오면 이 이펙트가 다시 돌아 제자리를 찾습니다.
        */
        /*
          묶음째 붙였으면 **묶음의 설정**이 이깁니다. 덩어리 안의 소품이
          하나씩 다른 데 붙으면 모양이 흩어집니다.
        */
        // 겹쳐 묶었으면 **맨 바깥** 묶음의 설정이 이깁니다 — 보이는 덩어리가 그것입니다.
        const group = item.groupId
          ? (outerGroupOf(composition, item) ?? undefined)
          : undefined;
        const attach = group?.attach ?? item.attach;
        const attachTo = attach
          ? (() => {
              const rig = characterRigs.get(attach.targetId);
              return rig ? boneOf(rig, attach.bone) : undefined;
            })()
          : undefined;
        if (attachTo && group?.attach) {
          /*
            덩어리는 «자리 − origin» 으로 매답니다. 소품의 자리를 그대로 두고 기준점만
            빼므로 서로의 간격이 한 치도 안 변합니다 — 이것이 «모양 유지» 의 전부입니다.
          */
          const origin = group.attach.origin;
          group0.position.set(
            item.position.x - origin.x,
            item.position.y - origin.y,
            item.position.z - origin.z,
          );
        }
        if (attachTo) {
          attachTo.add(group0);
          /*
            **관절의 배율을 되나눕니다.** 인물 뼈는 대개 1 이 아니라(글b 단위·리타깃),
            그대로 두면 검이 뼈 배율만큼 늘어나거나 쪼그라듭니다.
          */
          const scale = new THREE.Vector3();
          attachTo.getWorldScale(scale);
          group0.scale.set(
            item.scale.x / (scale.x || 1),
            item.scale.y / (scale.y || 1),
            item.scale.z / (scale.z || 1),
          );
        } else {
          foreground.add(group0);
        }
        added.push(group0);
        objectRoots.set(item.id, group0);

        /*
          기준점(손잡이)만큼 **속을 밀어** 둡니다. 그래야 «이 점» 이 관절에 닿습니다 —
          검의 한가운데가 아니라 손잡이가 손에 잡혀야 하니까요.
        */
        const pivot = attach?.pivot;
        const pivotAt = group?.attach ? undefined : pivot;
        const inner = pivotAt ? new THREE.Group() : group0;
        if (pivotAt) {
          inner.position.set(-pivotAt.x, -pivotAt.y, -pivotAt.z);
          group0.add(inner);
        }

        /** 이 물체의 꼭대기 높이(그룹 로컬, 스케일 전). 이름표를 그 위에 올립니다. */
        let topY = 0;

        if (item.kind === "light") {
          // 조명은 그 자체가 보이지 않으니 자리를 표시해 줍니다.
          const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 12, 10),
            new THREE.MeshBasicMaterial({ color: item.color || "#ffe9b0" }),
          );
          bulb.userData.helper = true;
          inner.add(bulb);
          topY = 0.1;

          if (item.lightType !== "sky") {
            const light = new THREE.PointLight(
              new THREE.Color(item.color || "#ffe9b0"),
              item.intensity ?? 8,
              0,
              2,
            );
            light.castShadow = composition.showFloor;
            inner.add(light);
          }
        } else if (item.kind === "wall") {
          /*
            ── 배경 벽 ────────────────────────────────────────────────
             여섯 면을 다 갖춘 방 대신 **보이는 쪽만** 세우는 길입니다.

            판은 **한 변 1 m 짜리**로 만들고 크기는 소품의 scale 이 정합니다(가로 4 · 높이 2.6 이면 4×2.6 m 벽).
            그래야 오른쪽 패널의 숫자와 화면의 미터가 그대로 같습니다.
          */
          const geometry = new THREE.PlaneGeometry(1, 1);
          const material = new THREE.MeshStandardMaterial({
            color: item.image ? "#ffffff" : item.color || "#6b7183",
            roughness: 0.95,
            metalness: 0,
            // 뒤에서 봐도 보이게 — 벽을 돌려 세우다 «사라졌다» 고 놀라지 않게 합니다.
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          // 판의 원점은 가운데라, 밑동이 바닥(y=0)에 닿도록 반만큼 올립니다.
          mesh.position.y = 0.5;
          if (item.image) {
            /*
              그림은 **비동기로** 붙습니다. 붙기 전에도 판은 서 있어야 크기를 잡을 수 있으니, 먼저 회색으로 세우고
              읽히는 대로 갈아 끼웁니다. `asset://` 은 캔버스 오염 문제로 `loadImageForCanvas` 를 쓰지만 여기서는
              three 의 로더가 직접 읽습니다(캡처는 WebGL 이라 오염되지 않습니다).
            */
            const source = assetSrc(item.image) || item.image;
            mesh.userData.captureAssetPending = true;
            new THREE.TextureLoader().load(source, (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace;
              material.map = texture;
              material.color.set("#ffffff");
              material.needsUpdate = true;
              mesh.userData.captureAssetPending = false;
            }, undefined, () => {
              mesh.userData.captureAssetPending = false;
              mesh.userData.captureAssetFailed = true;
            });
          }
          mesh.updateMatrixWorld(true);
          topY = new THREE.Box3().setFromObject(mesh).max.y;
          inner.add(mesh);
        } else {
          const geometry =
            item.kind === "sphere"
              ? new THREE.SphereGeometry(0.5, 24, 18)
              : item.kind === "cylinder"
                ? new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
                : item.kind === "table"
                  ? new THREE.BoxGeometry(1.4, 0.75, 0.8)
                  : new THREE.BoxGeometry(1, 1, 1);
          const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: item.color || "#8a8fa3",
              roughness: 0.7,
              metalness: 0.05,
            }),
          );
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // 상자류는 바닥에 올려 둡니다. 원점이 가운데면 반쯤 파묻혀 보입니다.
          if (item.kind !== "sphere") mesh.position.y = 0.5;
          if (item.kind === "table") mesh.position.y = 0.375;
          // 꼭대기는 종류마다 다르므로 재서 씁니다(구는 0.5, 상자는 1, 탁자는 0.75).
          // 아직 그룹에 넣기 전이라 matrixWorld 가 곧 로컬 행렬 — 스케일이 안 섞입니다.
          mesh.updateMatrixWorld(true);
          topY = new THREE.Box3().setFromObject(mesh).max.y;
          inner.add(mesh);
        }

        /*
          ── 투시 ────────────────────────────────────────────────────
           방 면의 «뒤를 가릴 면» 과 같은 뜻을 소품에도 둡니다.

          `depthWrite` 를 꺼야 뒤에 선 인물이 비칩니다 — 투명도만 낮추면 깊이 버퍼가 여전히 뒤를 가립니다.
          재생 중에는 타임라인이 매 프레임 다시 정합니다(`applyTimedOcclusion`).
        */
        setObjectSeeThrough(group0, item.seeThrough === true);

        if (composition.showLabels && item.label) {
          // 그룹에 걸린 scale 을 되나눠 붙입니다 — 물체를 키워도 글상자는 그대로.
          labels.push(
            attachLabel(group0, createLabel(item.label, "#cfd4e2"), topY),
          );
        }
      });

    ctx.labels.push(...labels);

    syncSelectionRef.current?.();

    return () => {
      ctx.labels = ctx.labels.filter((entry) => !labels.includes(entry));
      objectRoots.clear();
      added.forEach((group) => {
        group.removeFromParent();
        group.traverse((node) => {
          // 점광원은 그림자 맵을 들고 있어 따로 놓아 줘야 합니다.
          if (node instanceof THREE.PointLight) node.dispose();
        });
        disposeOwnedMesh(group);
      });
    };
    /*
      `characterKey` 도 함께 봅니다 — 관절에 붙인 소품은 인물이 씬에 들어온 **뒤에**
      부모를 잡을 수 있습니다(GLB 는 파일을 읽고 붙습니다). 인물이 다시 지어지면
      옛 뼈는 버려지므로, 소품도 같이 다시 세워 새 뼈에 매답니다.
    */
    // composition.objects 의 내용은 objectKey 가 대신합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectKey, characterKey, composition.showLabels, composition.showFloor]);

  // ── (d) GLB 트랙 — 로드·클립 ──────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { foreground, glbRoots } = ctx;
    let cancelled = false;
    const glbMixers: GlbMixerEntry[] = [];
    // 재생 루프가 매 프레임 읽는 배열을 통째로 바꿔 끼웁니다.
    ctx.glbMixers = glbMixers;

    (composition.glbTracks || []).forEach((track) => {
      // 저장된 파일이 먼저. blob 은 저장에서 빠져 다시 열면 없습니다.
      const trackUrl = assetSrc(track.filePath) || track.url;
      if (!track.visible || !trackUrl) return;

      const attach = (source: {
        scene: THREE.Group;
        animations: THREE.AnimationClip[];
      }) => {
        // 캐시된 원본을 복제해서 씁니다. 스킨드 메시도 있으므로 SkeletonUtils 를 씁니다.
        const root = cloneSkeleton(source.scene) as THREE.Group;
        root.position.set(track.position.x, track.position.y, track.position.z);
        root.rotation.set(track.rotation.x, track.rotation.y, track.rotation.z);
        root.scale.setScalar(track.scale || 1);
        root.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        foreground.add(root);
        glbRoots.set(track.id, root);

        const clip =
          source.animations.find((item) => item.name === track.clipName) ||
          source.animations[0];
        if (source.animations.length) {
          // 부모는 바뀐 게 없으면 current 를 그대로 돌려줘야 합니다. 여기서는 glbKey 에
          // clips·clipDuration 이 없어 이 콜백이 이 이펙트를 다시 돌리지 못합니다.
          handlersRef.current.onGlbClips?.(
            track.id,
            source.animations.map((item) => item.name),
            clip?.duration ?? 0,
          );
        }

        if (clip) {
          const mixer = new THREE.AnimationMixer(root);
          mixer.clipAction(clip).play();
          // timeScale 은 1 로 둡니다.
          // setTime() 은 내부적으로 update(delta) 를 호출하고 그 델타에 timeScale 이
          // 곱해지므로, 0 으로 두면 시간이 전혀 진행되지 않습니다.
          // 자동 재생은 update() 를 부르지 않는 것으로 막고, 위치는 setTime 으로만 정합니다.
          mixer.timeScale = 1;
          glbMixers.push({ mixer, track, clipDuration: clip.duration });
        }

        // 선택된 GLB 가 방금 생겼을 수 있습니다. 기즈모를 다시 붙입니다.
        syncSelectionRef.current?.();
      };

      const cached = gltfCache.get(trackUrl);
      if (cached) {
        // 이미 읽어둔 파일은 즉시 붙입니다. 슬라이더·스크럽 때 깜박이지 않는 이유입니다.
        attach(cached);
        return;
      }

      new GLTFLoader().load(
        trackUrl,
        (gltf) => {
          const source = { scene: gltf.scene, animations: gltf.animations };
          gltfCache.set(trackUrl, source);
          if (!cancelled) attach(source);
        },
        undefined,
        (error) => {
          console.warn("GLB 로드 실패", error);
          toast.error(`GLB 를 읽지 못했습니다 · ${track.name}`);
        },
      );
    });

    return () => {
      cancelled = true;
      glbMixers.forEach(({ mixer }) => mixer.stopAllAction());
      if (ctx.glbMixers === glbMixers) ctx.glbMixers = [];
      // 복제한 GLB 는 지오메트리·재질을 캐시 원본과 공유하므로 씬에서 빼기만 합니다.
      glbRoots.forEach((root) => root.removeFromParent());
      glbRoots.clear();
    };
    // composition.glbTracks 의 내용은 glbKey 가 대신합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbKey]);

  /*
    ── 멈춰 있을 때도 «그 시각의 카메라» ────────────────────────────────
    재생 중에는 루프가 맡고, 멈춰 있을 때는 **눈금이 옮겨진 순간**에만 한 번 맞춥니다.
    매 프레임 맞추면 화면을 돌리는 족족 되돌아와 구도를 잡을 수가 없습니다.
  */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || previewing) return;
    ctx.showMovesAt?.(playhead);
    // playhead 는 부모가 멈춰 있을 때만 상태로 올려 줍니다(재생 중에는 ref 로만 돕니다).
  }, [playhead, previewing]);

  /*
    ── 클립을 손볼 때는 «출발 구도» 로 되돌립니다 ───────────────────────
    

    무빙을 손보는 동안(앵커를 옮기고, 이동량을 고치고, 클립을 갈아 끼우고) 화면이 딴
    데를 보고 있으면 «무엇을 고치는 중인지» 가 안 보입니다. 그래서 **첫 클립이 시작하기
    전 자리에 서 있을 때**는, 클립이 바뀔 때마다 화면을 출발 구도로 되돌립니다.

    화면 돌리기와 안 싸우는 까닭: 이 이펙트는 **클립 목록이 바뀔 때만** 돕니다
    (`moveEditKey`). 화면을 돌려도 클립은 그대로라 되돌아오지 않습니다.
  */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || previewing) return;
    const list = cameraMovesRef.current;
    if (!list.length) return;
    const firstStart = sortedMoves(list)[0]?.startTime ?? 0;
    if (playhead > firstStart + 0.0001) return;
    ctx.showMovesAt?.(playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveEditKey, previewing]);

  // ── 카메라 무빙 앵커 ──────────────────────────────────────────────────
  // 기즈모를 붙이려면 이 그룹을 나중에 다시 잡아야 해서 ctx 에 보관합니다.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !cameraMove?.showAnchor) return;
    const group = buildAnchorMarker();
    group.position.set(
      cameraMove.anchor.x,
      cameraMove.anchor.y,
      cameraMove.anchor.z,
    );
    ctx.foreground.add(group);
    ctx.anchorGroup = group;
    syncSelectionRef.current?.();
    return () => {
      if (ctx.anchorGroup === group) ctx.anchorGroup = null;
      group.removeFromParent();
      disposeOwnedMesh(group);
    };
    // cameraMove 는 부모가 그릴 때마다 새 객체일 수 있어 anchorKey(표시 여부·좌표)로 좁힙니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  // ── (f) 선택·기즈모 대상 ──────────────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      const ctx = sceneRef.current;
      if (!ctx) return;
      const {
        transform,
        characterRoots,
        characterRigs,
        objectRoots,
        glbRoots,
      } = ctx;

      // 이전 대상부터 놓습니다. 기즈모 하나를 계속 쓰므로 붙일 때마다 크기·축·
      // 스냅을 전부 다시 정해야 이전 선택의 설정이 남지 않습니다.
      if (ctx.selectionRing) {
        ctx.selectionRing.removeFromParent();
        disposeOwnedMesh(ctx.selectionRing);
        ctx.selectionRing = null;
      }
      transform.detach();
      transform.getHelper().quaternion.identity();
      transform.setTranslationSnap(null);
      transform.setRotationSnap(null);
      ctx.gizmo = {
        ...EMPTY_GIZMO,
        characterId: selectedCharacterId,
        bone: activeBone,
        objectId: selectedObjectId,
        glbId: selectedGlbId,
        roomId: selectedRoomId,
      };

      // 선택 표시 링
      if (selectedCharacterId) {
        const figure = characterRoots.get(selectedCharacterId);
        if (figure) {
          const ring = buildSelectionRing();
          figure.add(ring);
          ctx.selectionRing = ring;
        }
      }

      // 앵커 기즈모. 다른 선택보다 우선합니다. 앵커를 옮기는 중에는 그것만 만지면 되니까요.
      let anchorAttached = false;
      if (anchorGizmo && ctx.anchorGroup) {
        anchorAttached = true;
        transform.attach(ctx.anchorGroup);
        transform.setMode("translate");
        transform.setSpace("world");
        transform.size = 0.8;
        transform.showX = true;
        transform.showY = true;
        transform.showZ = true;
      }

      let attachedBone: THREE.Object3D | null = null;

      // 본이 선택되어 있으면 인물 전체 대신 그 관절에 기즈모를 붙입니다.
      // 슬라이더로 각도를 맞추는 대신 3D 화면에서 직접 돌리기 위한 경로입니다.
      if (
        !anchorAttached &&
        selectedCharacterId &&
        activeBone &&
        characterRigs.has(selectedCharacterId)
      ) {
        const rig = characterRigs.get(selectedCharacterId)!;
        const bone = boneOf(rig, activeBone);
        if (bone) {
          attachedBone = bone;
          /*
            **관절은 회전만 합니다.** IK 이동은 걷어냈습니다.

            손을 끌면 팔꿈치가 따라오는데 그 양이 커서 원하는 자리에 못 세웠고,
            되돌리기도 어려웠습니다. 로 정한 방향입니다. (지시 10)
          */
          transform.attach(bone);
          transform.setMode("rotate");
          // 관절용 기즈모는 몸에 비해 크면 조작이 거칠어집니다.
          transform.size = 0.45;
          // 관절은 항상 3축을 다 씁니다. 인물 이동용 축 제한이 남아 있으면 링이 사라집니다.
          transform.showX = true;
          transform.showY = true;
          transform.showZ = true;

          // 기즈모 기준을 각도 환산 기준과 맞춰야 링 하나가 수치 하나에 대응합니다.
          // 몸통·팔다리는 본 로컬 기준, 손가락은 손 기준으로 각도를 다루므로
          // 손가락일 때는 손 본의 방향을 기즈모에 그대로 물려줍니다.
          transform.setSpace("local");
          const handQuat = bone.userData.presetHandQuaternion as
            THREE.Quaternion | undefined;
          if (handQuat) transform.getHelper().quaternion.copy(handQuat);

          // 미세 조정 스냅. 인물이 2m 남짓이라 스냅이 없으면 한 픽셀 드래그에도 크게 움직입니다.
          if (fineSnap) {
            transform.setTranslationSnap(0.02);
            transform.setRotationSnap(THREE.MathUtils.degToRad(2));
          } else {
            transform.setTranslationSnap(null);
            transform.setRotationSnap(null);
          }
        }
      }

      if (!anchorAttached && !attachedBone) {
        const target =
          (selectedCharacterId && characterRoots.get(selectedCharacterId)) ||
          (selectedObjectId && objectRoots.get(selectedObjectId)) ||
          (selectedGlbId && glbRoots.get(selectedGlbId)) ||
          // 방은 틀(rig)을 잡습니다 — 여섯 면과 그 안의 것이 함께 따라옵니다.
          (selectedRoomId &&
            ctx.background.rooms.find((entry) => entry.id === selectedRoomId)?.rig);
        if (target) {
          transform.attach(target);
          transform.setMode(transformMode);
          transform.setSpace("world");
          transform.size = 1;
          const isRotate = transformMode === "rotate";
          // 인물·소품 모두 3축 회전을 저장하므로 회전은 3축을 그대로 씁니다.
          // 이동에서만 「바닥에 붙여 두기」·「높이만」 제한이 걸립니다.
          transform.showX = isRotate || transformConstraint !== "height";
          transform.showY = isRotate || transformConstraint !== "ground";
          transform.showZ = isRotate || transformConstraint !== "height";
          transform.setTranslationSnap(fineSnap ? 0.05 : null);
          transform.setRotationSnap(
            fineSnap ? THREE.MathUtils.degToRad(5) : null,
          );
        }
      }

      ctx.gizmo.anchorAttached = anchorAttached;
      ctx.gizmo.attachedBone = attachedBone;
    };

    syncSelectionRef.current = sync;
    sync();

    return () => {
      syncSelectionRef.current = null;
      const ctx = sceneRef.current;
      if (!ctx) return;
      if (ctx.selectionRing) {
        ctx.selectionRing.removeFromParent();
        disposeOwnedMesh(ctx.selectionRing);
        ctx.selectionRing = null;
      }
      ctx.transform.detach();
      ctx.gizmo = { ...EMPTY_GIZMO };
    };
  }, [
    selectedCharacterId,
    selectedObjectId,
    selectedGlbId,
    selectedRoomId,
    activeBone,
    transformMode,
    transformConstraint,
    fineSnap,
    anchorGizmo,
  ]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
