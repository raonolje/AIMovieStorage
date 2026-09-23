import { DEFAULT_SHADOWS, normalizeShadows, type CompositionShadows } from "@/lib/compositionShadows";
import {
  cameraMoveId,
  cameraMovesEnd,
  describeCameraMoves,
  resolveShotId,
  SHOT_PRESETS,
  type CameraMove,
  type EasingCurve,
} from "@/lib/cameraMoves";

/**
 * 구도 상태 — 「어디서 무엇을 보는가」.
 *
 * 컷 하나가 어떻게 보일지는 여기서 정해집니다. 말로 「인물이 왼쪽에」 라고
 * 적으면 생성기가 매번 다르게 해석하지만, 여기서 세워 두면
 * «화면 왼쪽 3분의 1 지점, 카메라에서 4미터» 처럼 **잴 수 있는 값**이 나옵니다.
 *
 * 그 값을 문장으로 옮기는 것이 `summarizeCompositionCamera` 입니다.
 */

export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface Vector2Value {
  x: number;
  y: number;
}

export const copyVector = (value: Vector3Value): Vector3Value => ({ ...value });

// ── 동선 그리기 ───────────────────────────────────────────────────────────

export type GuideLineKind = "camera" | "character" | "light";
export type GuideLineTool = "freehand" | "straight" | "arc";

export interface CompositionGuideLine {
  id: string;
  kind: GuideLineKind;
  tool: GuideLineTool;
  points: Vector2Value[];
  control?: Vector2Value;
  characterId?: string;
  characterLabel?: string;
  strokeWidth?: number;
}

/**
 * 화살표 방향을 구할 때 뒤로 훑는 최소 거리(뷰박스 단위).
 *
 * 프리핸드는 점이 촘촘해서 「직전 점」만 쓰면 마지막 한두 점의 손떨림이 그대로
 * 각도가 됩니다. 화살표가 선과 상관없는 방향을 보거나 떨어져 보이는 원인이라
 * 일정 거리 이상 떨어진 점까지 거슬러 올라가 평균 진행 방향을 잡습니다.
 */
const ARROW_DIRECTION_LOOKBACK = 6;

export function getGuideLineEndDirection(line: CompositionGuideLine) {
  const end = line.points[line.points.length - 1];
  if (!end) return { end: { x: 0, y: 0 }, angle: 0, vector: { x: 1, y: 0 } };

  // 2차 베지어는 컨트롤 포인트 방향에서 끝점으로 들어옵니다.
  let previous =
    line.tool === "arc" && line.control
      ? line.control
      : line.points[line.points.length - 2];

  if (line.tool === "freehand" || line.tool === "straight") {
    const candidates = [...line.points.slice(0, -1)].reverse();
    // 먼저 lookback 거리를 넘는 점을 찾고, 없으면 좌표가 다른 첫 점으로 물러섭니다.
    previous =
      candidates.find(
        (point) =>
          Math.hypot(end.x - point.x, end.y - point.y) >=
          ARROW_DIRECTION_LOOKBACK,
      ) ||
      candidates.find((point) => point.x !== end.x || point.y !== end.y) ||
      previous;
  }

  const dx = end.x - (previous?.x ?? end.x - 1);
  const dy = end.y - (previous?.y ?? end.y);
  const length = Math.hypot(dx, dy);
  // 길이가 0 이면 방향을 만들 수 없으므로 기본값(오른쪽)을 씁니다.
  if (length === 0) return { end, angle: 0, vector: { x: 1, y: 0 } };
  return {
    end,
    angle: Math.atan2(dy, dx),
    vector: { x: dx / length, y: dy / length },
  };
}

/** 화살촉 밑동에서 끝나는 선. 선이 화살촉을 뚫고 나오지 않게 합니다. */
export function getGuideLinePath(
  line: CompositionGuideLine,
  end = line.points[line.points.length - 1],
) {
  const [start, ...rest] = line.points;
  if (!start || !rest.length || !end) return "";
  if (line.tool === "arc" && line.control)
    return `M ${start.x} ${start.y} Q ${line.control.x} ${line.control.y} ${end.x} ${end.y}`;
  if (line.tool === "freehand")
    return `M ${[...line.points.slice(0, -1), end].map((point) => `${point.x} ${point.y}`).join(" L ")}`;
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/** 두 편집기가 같은 계산을 써야 화살촉이 늘 선 끝에 붙습니다. */
export function getGuideArrowGeometry(
  line: CompositionGuideLine,
  strokeWidth = 0.7,
) {
  const { end, angle, vector } = getGuideLineEndDirection(line);
  const width = Math.max(0.2, strokeWidth);
  // 굵기를 줄여도 머리 비율이 유지되게 합니다.
  const headLength = width * 4.8;
  const headHalfWidth = width * 2.4;
  const stemEnd = {
    x: end.x - vector.x * headLength,
    y: end.y - vector.y * headLength,
  };
  const normal = { x: -vector.y, y: vector.x };

  return {
    end,
    angle,
    vector,
    normal,
    headLength,
    headHalfWidth,
    stemEnd,
    points:
      `${end.x},${end.y} ` +
      `${stemEnd.x + normal.x * headHalfWidth},${stemEnd.y + normal.y * headHalfWidth} ` +
      `${stemEnd.x - normal.x * headHalfWidth},${stemEnd.y - normal.y * headHalfWidth}`,
  };
}

// ── 인물 ─────────────────────────────────────────────────────────────────

/** 손가락 굽힘 3단계. 폄 / 반만 접기 / 완전히 접기 */
export type FingerState = "extend" | "half" | "fold";

export const FINGER_NAMES = [
  "Thumb",
  "Index",
  "Middle",
  "Ring",
  "Pinky",
] as const;
export type FingerName = (typeof FINGER_NAMES)[number];

/** 구도 잡을 때 자주 쓰는 프리셋 포즈. 프리셋은 시작점이고 세부는 본 편집으로 다듬습니다. */
export type CharacterPose =
  | "stand"
  | "walk"
  | "run"
  | "sit"
  | "sitGround"
  | "kneel"
  | "crouch"
  | "lie"
  | "armsUp"
  | "point"
  | "aim"
  | "hold"
  | "lean"
  | "reach"
  | "think"
  | "wave"
  | "fight"
  | "fall";

export interface CharacterComposition {
  characterId: string;
  position: Vector3Value;
  /** 3축 회전(라디안). 예전 데이터는 rotationY 만 있습니다. */
  rotation: Vector3Value;
  /** 예전 데이터 호환. rotation.y 와 같은 값입니다. */
  rotationY?: number;
  pose: CharacterPose;
  /**
   * 관절별 추가 회전(라디안). 프리셋 자세를 0으로 보는 **상대값**입니다.
   * 키는 mixamorig 접두사를 뺀 본 이름입니다. 예: `{ RightArm: { x: 0.3, y: 0, z: 0 } }`
   *
   * 절대 쿼터니언 대신 상대 오일러를 쓰는 이유는 수치 입력 때문입니다.
   * 절대값이면 「차렷 자세」조차 0이 아니라서, 사용자가 어떤 숫자로 되돌려야
   * 할지 알 수 없습니다. 상대값이면 0 이 곧 프리셋 원래 자세라 되돌리기가
   * 명확합니다.
   */
  bonePose?: Record<string, Vector3Value>;
  /**
   * 손가락 상태. 키는 `${Left|Right}${손가락}` 형식입니다. 예: `"LeftIndex"`
   * 관절 3개를 따로 만지는 대신 폄/반접힘/접힘 3단계로 다룹니다.
   * 이 조합만으로 주먹·가위·보자기·가리키기가 전부 표현됩니다.
   */
  fingers?: Record<string, FingerState>;
  /**
   * **이 사람의 몸 색**(hex). 안 적었으면 `compositionColors` 가 겹치지 않게 나눠 줍니다.
   *
   * 맞습니다. 캡처에는 이름표가 안 나가고
   * 프롬프트가 「파란 사람은 @…」 로 짝을 맞추므로, 색이 겹치면 인물이 통째로 바뀝니다.
   *
   * 마네킹은 옛 저장본이 `mannequins[].color` 에 적어 두었습니다 — 읽을 때 둘 다 봅니다.
   */
  color?: string;
  /** 이 인물이 컷 안에서 지나갈 길 */
  path?: Vector3Value[];
  /**
   * 이 컷 구도에서 제외한 인물.
   * 프로젝트 캐릭터는 목록에서 지울 수 없으므로(다른 컷에도 쓰이니까)
   * 배치에서만 빼둡니다.
   */
  hidden?: boolean;
  /** 구도잡기 안에서만 사는 마네킹. 프로젝트 캐릭터가 아닙니다. */
  isMannequin?: boolean;
  /** 마네킹 이름. 실제 캐릭터는 프로젝트에서 이름을 가져옵니다. */
  label?: string;
  /** 남·여·중립. 화면 식별 색의 계열을 정합니다. */
  gender?: "male" | "female" | "neutral";
  /** 키(cm). 없으면 프로젝트 캐릭터 값을 씁니다. */
  heightCm?: number;
}

/**
 * 구도잡기 안에서만 사는 인물.
 *
 * 프로젝트 캐릭터가 아직 없을 때, 또는 「지나가는 사람 하나」가 필요할 때
 * 씁니다. 컷 구도 안에서만 살기 때문에 이름·키를 여기서 직접 들고 있습니다.
 */
export interface CompositionMannequin {
  id: string;
  name: string;
  gender?: "male" | "female" | "neutral";
  heightCm: number;
  build?: "slim" | "average" | "heavy";
  /**
   * **이 마네킹의 몸 색**. 안 적었으면 성별 팔레트에서 순번대로 받습니다(예전과 같음).
   *
   * 색은 화면에서 누가 누구인지 가리는 **유일한 표시**입니다(캡처에는 이름표가 안 나갑니다).
   * 자동 순번은 사람이 늘면 돌고, 돌면 주연과 엑스트라가 같은 색이 됩니다 — 그때 여기서 못 박습니다.
   */
  color?: string;
}

/** 구도잡기가 세울 수 있는 인물 — 프로젝트 캐릭터와 마네킹을 같은 모양으로 봅니다. */
export interface CompositionCharacterSource {
  id: string;
  name: string;
  gender?: string;
  heightCm: number;
  build?: string;
}

// ── 소품·조명 ────────────────────────────────────────────────────────────

/**
 * 소품의 모양.
 *
 * `table` 은 목록에서 뺐습니다 — 실제로 탁자는 «납작한 상자» 라, 상자 하나를 눌러 만드는 편이 자유롭습니다.
 * 갈래 이름은 옛 저장본이 가리키므로 타입에는 남겨 둡니다(그리기도 그대로).
 */
export type CompositionObjectKind =
  "table" | "crate" | "light" | "box" | "sphere" | "cylinder" | "wall";

/**
 * 소품 **묶음** — 상자 몇 개를 모아 만든 한 덩어리.
 *
 * , 「구를 여러 개 배치해서
 * 그룹화시켜서 노란색으로 입힌 다음 프롬프트에는 «노란색 구로 만든 그룹은 안개로
 * 표현해라» 이런 식으로 매칭시켜 주는 거지」.
 *
 * # 왜 «색» 이 핵심인가
 *
 * 구도잡기의 소품은 회색 덩어리라, 여럿을 쌓아 두면 어디부터 어디까지가 한 물건인지
 * 화면에서 구분이 안 됩니다. 묶음마다 색을 주면 **눈으로도 한 덩어리**가 되고, 그 색이
 * 그대로 프롬프트의 이름표가 됩니다 — 「노란 덩어리는 안개」 처럼요.
 *
 * # `describeAs` 와 `swapRef` 는 다릅니다
 *
 * - `describeAs` — 「안개」·「쌓아 둔 종이 상자」 처럼 **말로** 바꿔 그리라는 지시
 * - `swapRef` — 이미 만들어 둔 **캐릭터·에셋 시트**로 바꾸라는 지시(그림이 근거)
 */
export interface CompositionObjectGroup {
  id: string;
  /**
   * **이 묶음을 다시 묶은** 바깥 묶음. 없으면 맨 바깥입니다.
   *
   * 상자 넷으로 의자를 만들고,
   * 의자 넷을 다시 «식탁 세트» 로 묶는 식입니다. 소품은 늘 **맨 안쪽 묶음**만 가리키고
   * (`ObjectComposition.groupId`), 바깥으로 올라가는 길은 여기로만 잇습니다 — 양쪽에
   * 적으면 반드시 한쪽이 낡습니다.
   */
  groupId?: string;
  /** 「안개 덩어리」 처럼 사람이 읽는 이름. */
  name: string;
  /** 묶음 색. 속한 소품이 전부 이 색이 됩니다. */
  color: string;
  /** 이 덩어리가 **실제로는 무엇인가**. 비면 모양만 알립니다. */
  describeAs?: string;
  /** 만들어 둔 시트로 바꿔 그리라는 지시. */
  swapRef?: CompositionSwapRef;
  /**
   * 덩어리째 인물의 관절에 매달기.
   *
   * `origin` 은 **관절에 닿는 월드의 한 점**입니다(붙일 때의 덩어리 한가운데). 속한
   * 소품의 자리는 그대로 두고 이 점만 관절에 맞추므로, 서로의 간격이 한 치도 안 변합니다.
   */
  attach?: CompositionAttach & { origin: Vector3Value };
}

/**
 * **이 자리에 무엇을 넣을 것인가** — 구도의 덩어리와 만들어 둔 시트를 잇습니다.
 *
 * 구도잡기는 «자리와 크기» 를 정하는 받침대이고, 실제 그림은 밖에서 뽑습니다. 그래서
 * 「왼쪽 아래 1.2×0.8m 상자」 만으로는 부족하고 「그 자리에 **이 가방**」 이라고 짚어
 * 줘야 생성기가 같은 물건을 냅니다. 이름만 적으면 매번 다른 가방이 나옵니다.
 */
/**
 * 소품을 인물의 한 관절에 매다는 방법.
 *
 * # 왜 «기준점» 이 따로 필요한가
 *
 * 검은 **손잡이**가 손에 잡혀야지 검의 한가운데가 손에 붙으면 안 됩니다. 그래서 소품
 * 안의 어느 점이 관절에 닿을지를 따로 적습니다(`pivot`). 상자 원점은 밑면 한가운데라,
 * 길쭉한 물건은 대개 한쪽 끝으로 옮기게 됩니다.
 */
export interface CompositionAttach {
  /** 붙일 인물(`characterId`). */
  targetId: string;
  /** 붙일 관절 이름(mixamo 접두 없는 것 — 예: `RightHand`). */
  bone: string;
  /**
   * 소품 안에서 **관절에 닿는 점**(소품 로컬, m). 기본은 원점입니다.
   *
   * 이 점을 관절에 맞추고 나머지가 따라옵니다 — 즉 소품을 `-pivot` 만큼 밀어 둡니다.
   */
  pivot?: Vector3Value;
}

/**
 * 소품을 **방의 한 면에 붙이기** — 바닥·천장·네 벽 중 하나에 닿게 두고, 방 크기가 바뀌어도 따라붙습니다.
 *
 * ,
 * 「방 바닥에 붙이든 벽에 붙이든 천장에 붙이든… 어딘가에는 붙여야 하니까」.
 *
 * 붙은 축 하나만 방이 정하고 **나머지 두 축은 사람이 끄는 대로** 둡니다 — 벽에 붙인 액자를 좌우로 밀 수 있어야
 * 쓸모가 있습니다. 그래서 자리를 통째로 계산하지 않고 닿는 축만 다시 눌러 줍니다(`snapRoomMountsIn`).
 */
export interface CompositionMount {
  /** 붙은 방(`CompositionRoom.id`). 방을 지우면 이 붙임도 풀립니다. */
  roomId: string;
  /** 붙은 면. `bottom` 바닥 · `top` 천장 · 나머지는 벽. */
  face: CompositionCubeFace;
}

export interface CompositionSwapRef {
  /** 무엇의 시트인가 — 인물 · 에셋 · 배경. */
  kind: "character" | "asset" | "background";
  /** 프로젝트 안의 id. 이름이 바뀌어도 이 값은 그대로입니다. */
  id: string;
  /** 프롬프트에 적을 이름. id 를 못 찾을 때를 위해 같이 들고 있습니다. */
  name: string;
}

export interface ObjectComposition {
  id: string;
  label: string;
  kind: CompositionObjectKind;
  position: Vector3Value;
  rotation: Vector3Value;
  scale: Vector3Value;
  visible: boolean;
  /**
   * 조명일 때만 씁니다.
   *
   * sky 는 하늘 전체에서 오는 빛입니다. 이게 하나라도 켜져 있으면 배경을
   * 원래 밝기로 보여 주고, 없으면 skylessBrightness 로 눌러 줍니다.
   * 조명 없이 배경만 환하면 인물이 붕 떠 보이기 때문입니다.
   */
  lightType?: "sky" | "point" | "spot" | "area";
  intensity?: number;
  color?: string;
  /** 이 소품이 속한 묶음. 묶음 색이 `color` 를 덮습니다. */
  groupId?: string;
  /**
   * **인물의 관절에 붙이기** — 붙이면 그 관절을 따라 함께 움직입니다.
   *
   * 붙은 소품의 `position`·`rotation` 은 **월드가 아니라 그 관절 기준**이 됩니다.
   * 손을 들면 검도 같이 올라가고, 포즈를 바꿔도 손에 붙어 있습니다. 떼면 다시 월드
   * 좌표로 돌아갑니다 — 그때 «지금 보이는 자리» 를 월드로 풀어 적어야 물건이 안 튑니다
   * (`detachObjectIn`).
   */
  attach?: CompositionAttach;
  /**
   * **방의 한 면에 붙이기**. 인물 관절에 매다는 `attach` 와 달리 방이 기준입니다(둘 다 걸면 관절이 이깁니다).
   */
  mount?: CompositionMount;
  /**
   * **이 방의 배경 소품**이라는 표시(`CompositionRoom.id`). 비어 있으면 **캐릭터 쪽 소품**입니다.
   *
   * , 「캐릭터용 소품은 굳이 방에 함께 저장될 필요가 없잖아」.
   *
   * 예전에는 **자리로** 갈랐습니다(방 상자 안에 있으면 그 방 것). 그러니 배치 탭에서 인물 손에 쥐여 준 검이 방 안에
   * 있다는 이유로 환경 목록에 뜨고, 방을 라이브러리에 담을 때 같이 딸려 갔습니다. 어디서 세웠는지는 자리가 아니라
   * **뜻**이라, 세울 때 적어 둡니다.
   */
  roomId?: string;
  /**
   * **투시** — 켜면 뒤가 비쳐 보이고, 카메라를 막지 않습니다.
   *
   * 방 면의 «뒤를 가릴 면» 과 같은 뜻을 소품에도 둡니다.
   * 시간대별로 바꾸려면 타임라인의 그 소품 줄에 키를 찍습니다(`OccludeTrack.objectId`).
   */
  seeThrough?: boolean;
  /** 이 소품 하나를 시트와 이었을 때. 묶음에 속하면 묶음 쪽이 이깁니다. */
  swapRef?: CompositionSwapRef;
  /**
   * **벽에 입힌 그림**(파일 경로). `kind: "wall"` 일 때만 씁니다.
   *
   * 여섯 면을 다 갖춘 방을 세우는 대신 **보이는 쪽만** 세우는 길입니다. 한 컷에 필요한 것은 대개 정면 한 장이라, 그 한 장을
   * 실제 크기의 판에 붙이면 인물과의 거리·크기가 그대로 맞습니다.
   */
  image?: string;
}

// ── 배경 ─────────────────────────────────────────────────────────────────

/**
 * 등록한 이미지의 용도.
 *
 * 등장방형 파노라마는 확장자가 따로 없어(그냥 jpg/png) 자동 판별이 어렵습니다.
 * 등록할 때 사용자가 직접 고르는 편이 예측 가능합니다.
 */
export type BackgroundKind = "background" | "panorama" | "hdri";

/**
 * 파노라마로 볼 최소 비율.
 *
 * 2:1 등장방형이 교과서이지만, **실제로 뽑히는 그림은 2:1 이 아닙니다.** 마그니픽에서
 * 나오는 파노라마는 2752×1536 = **1.79:1** 이라, 문턱이 1.8 이던 동안 우리가 뽑아 둔
 * 파노라마가 목록에 하나도 안 떴습니다().
 *
 * 그래서 1.75 로 내립니다. 16:9(1.78)도 들어오지만, 실외 돔에 걸 그림은 어차피 사람이
 * 고르는 것이고 «2:1 이 아니면 위아래가 조금 늘어난다» 고 옆에 적어 둡니다 —
 * 하나도 안 보이는 것보다 낫습니다.
 */
export const PANORAMA_ASPECT_MIN = 1.75;


export function isPanoramaAspect(aspect?: number) {
  return typeof aspect === "number" && aspect >= PANORAMA_ASPECT_MIN;
}


export interface CompositionCustomBackground {
  id: string;
  name: string;
  thumb: string;
  filePath?: string;
  kind?: BackgroundKind;
  /** 가로:세로 비율. 파노라마가 2:1 이 아닐 때 경고하는 용도입니다. */
  aspect?: number;
  /** HDRI 원본 파일 URL(.hdr/.exr). 썸네일과 별개로 로더가 직접 읽습니다. */
  sourceUrl?: string;
  /**
   * 확장자가 붙은 원래 파일 이름 — «맑은 하늘.exr».
   *
   * `name` 은 확장자를 뗀 것이라 그걸로 갈래를 가리면 .exr 을 늘 RGBELoader 로 읽어
   * 실패했습니다(). 저장 전에는 filePath 도 없어서
   * 확장자를 알 길이 이것뿐입니다.
   */
  fileName?: string;
}

export const COMPOSITION_CUBE_FACES = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
] as const;
export type CompositionCubeFace = (typeof COMPOSITION_CUBE_FACES)[number];

/** 화면에 보이는 면 이름. 구도잡기와 배경 표시 도구가 같은 말을 써야 합니다. */
export const CUBE_FACE_LABELS: Record<CompositionCubeFace, string> = {
  front: "정면",
  back: "후면",
  left: "왼쪽",
  right: "오른쪽",
  top: "천장",
  bottom: "바닥",
};

/**
 * **방 하나.** 실측 크기를 가진 육면체 한 칸입니다.
 *
 * , 「큐브의 안쪽 면이랑 바깥쪽 면에 적용되는 걸 다르게
 * 적용될 수 있게」.
 *
 * # 왜 방을 여럿 두는가
 *
 * 방 크기가 곧 축척입니다(`roomAutoGrow` 주석). 그래서 거실에서 주방으로 걸어가는 컷을
 * 방 하나로 잡으려면 두 공간을 합친 큰 상자를 만들어야 하는데, 그 순간 벽 그림이 늘어나고
 * 인물이 상대적으로 작아집니다. 방을 둘로 나눠 각각 실측대로 세우고 나란히 붙이면
 * 두 공간의 축척이 **각자** 맞습니다.
 *
 * # 안쪽 면과 바깥쪽 면
 *
 * 방 밖에서 본 방은 «건물» 입니다 — 안쪽 벽지 그림을 밖에서 보면 말이 안 됩니다.
 * 그래서 면 세트를 둘 둡니다. `outerFaces` 가 비어 있으면 바깥 껍질을 아예 안 세웁니다
 * (지금까지처럼 안쪽만 보이고, 밖에서는 방이 투명합니다).
 */
export interface CompositionRoom {
  id: string;
  /** 「거실」·「주방」 처럼 사람이 읽는 이름. 목록과 3D 이름표에 씁니다. */
  name: string;
  /** 세 변(m). 가로 W · 깊이 D · 층고 H. */
  width: number;
  depth: number;
  height: number;
  /**
   * 방 **밑면 한가운데**의 자리(m). 첫 방은 원점입니다.
   *
   * 중심이 아니라 밑면을 기준으로 두는 까닭은 바닥이 곧 우리 격자(y=0)라서입니다 —
   * 층고를 바꿔도 바닥이 안 움직여야 인물의 발이 그림에서 떨어지지 않습니다.
   * 2층을 얹을 때만 y 를 씁니다.
   */
  position: Vector3Value;
  /** y 축 회전(도). 복도가 꺾이는 모양을 만들 때만 씁니다. */
  rotationY: number;
  /**
   * **실외 방**인가. 실외는 여섯 면 상자가 아니라 파노라마 한 장을 두른 돔입니다.
   *
   * 방을 세울 때 정하므로 «이미지 생성» 이 무엇을 뽑을지(전개도냐 파노라마냐)도 여기서 갈립니다.
   */
  outdoor?: boolean;
  /**
   * 실외를 **무엇으로 두를 것인가** — 돔(파노라마 한 장) 또는 상자(여섯 면).
   *
   * 둘은 보장하는 것이 다릅니다(문서 14 «보장 위계»). **돔**은 각도만 맞습니다 — 카메라가 제자리에서 도는
   * 컷이면 이음매 없이 깔끔하고 그림 한 장이면 됩니다. 카메라가 걸어 다니면 배경이 따라붙어 시차가 없습니다.
   * **상자**는 여섯 면이 실제 기하라 카메라가 옮겨 다녀도 앞뒤·가림이 맞습니다 — 대신 모서리 이음매가 보이고
   * 여섯 장의 색·빛이 서로 맞아야 합니다. 안 적었으면 돔입니다(실외의 기본).
   */
  outdoorShape?: "dome" | "box";
  /**
   * 이 방이 쓰는 **장소 카드**(`Background.id`). 구도잡기에서 «이 방 배경 만들기» 로 만들면 여기 적힙니다.
   *
   * 방과 카드를 이어 두면 ① 카드의 프롬프트를 방 옆에서 바로 열 수 있고 ② 그 카드에서 잘린 6면 세트를 **이 방에** 자동으로 겁니다.
   * 카드를 지워도 방은 남습니다(id 만 가리킨 것이 없어질 뿐) — 방이 사라지면 구도가 통째로 흔들리니까요.
   */
  backgroundId?: string;
  /** 안쪽 여섯 면 — 방 **안에서** 보는 그림. */
  faces: Partial<Record<CompositionCubeFace, string>>;
  /** 바깥 여섯 면 — 방 **밖에서** 보는 그림(건물 외벽). 비면 바깥 껍질을 안 세웁니다. */
  outerFaces?: Partial<Record<CompositionCubeFace, string>>;
  /** 면마다 뒤엣것을 가릴지. 비어 있으면 아무 면도 안 가립니다. */
  occludeFaces?: Partial<Record<CompositionCubeFace, boolean>>;
  /** 잠시 안 보이게. 지우지 않고 끄는 자리 — 옆방이 시야를 막을 때. */
  hidden?: boolean;
  /**
   * 자동 넓히기가 **키우기 전의** 세 변. 넓힌 적이 없으면 없습니다.
   *
   * 넓히기는 «사람이 한 편집» 이 아니라 규칙이라 되돌리기 스택에 안 쌓습니다
   * (`CompositionPlanner` 의 자동 넓히기 절). 그래서 Ctrl+Z 로는 못 되돌리고,
   * 끄는 순간 돌아갈 자리를 **여기 적어 두는 수밖에** 없습니다. 실측으로 뽑은
   * 배경에서 방 크기는 곧 축척이라, 한 번 부푼 채로 남으면 인물이 영영 작아 보입니다.
   */
  grownFrom?: { width: number; depth: number; height: number };
  /**
   * 사람이 **층고를 손으로 만지기 직전**의 값(m). 안 만졌으면 없습니다.
   *
   * 가로·깊이는 여섯 면 그림의 비율에서 자동으로 정해지고, 사람이 정하는 것은 층고뿐이라
   * 되돌릴 값도 층고 하나면 충분합니다. 슬라이더를 끄는 동안 매번 덮어쓰지 않고 **처음
   * 한 번만** 적습니다 — 그래야 「끌기 전」 으로 돌아갑니다.
   *
   * 자동 넓히기(`grownFrom`)와 자리가 다른 까닭: 저쪽은 «규칙이 부풀린 것», 이쪽은
   * «사람이 만진 것» 입니다. 되돌리는 순간도 다릅니다(토글 끄기 / 단추 누르기).
   */
  homeHeight?: number;
  /**
   * 옆 네 면 그림의 **아래쪽 몇 할을 벽에 안 붙이는가**(0~0.9). 없으면 그림 전체를 붙입니다.
   *
   * 실외 전개도의 옆면을
   * «지평선이 벽 맨 아래 3 %» 로 그려 달라고 세 번 고쳐 적었지만 나노 바나나는 매번 **지평선이 가운데인 보통 눈높이
   * 사진**을 그렸습니다. 그 사진을 50 m 방 벽에 통째로 붙이면 지평선이 25 m 높이에 걸려 나무가 거인이 됩니다.
   *
   * 그래서 생성기가 잘하는 쪽(한가운데 눈높이 E 에서 본 90° 사진)을 그대로 받고, 방이 기하를 맞춥니다. 한 변 S 인 방에서
   * 90° 사진의 세로는 벽 앞뒤 S 에 해당하므로, 지평선(그림 가운데)이 바닥에서 E 높이에 오려면 아래 (0.5 − E/S) 를 버리고
   * 방 높이를 S/2 + E 로 두면 됩니다 — 천장(위 사진)도 눈에서 S/2 위라 정확히 맞고, 버린 아래쪽(가까운 땅)은 바닥의 실측
   * 지도가 대신합니다. 값은 세트를 걸 때 카드가 적어 둔 것(`GeneratedImageAsset.faceSetSize.cropBottom`)에서 옵니다.
   */
  sideCropBottom?: number;
  /**
   * 벽의 **가로÷높이·깊이÷높이** — 세트를 뽑은 카드의 치수에서 옵니다. 없으면 여섯 면 그림의 비율로 정합니다.
   *
   * 2026-09-15 MCP 실측(6×4×3 m 방): 생성기가 칸마다 너비를 조금씩 달리 그려 잘린 면의 비율이 앞 벽 1.9·뒤 벽 1.74·왼쪽 1.27
   * (원래 2.0·2.0·1.33)였습니다. 그림 비율로 방을 세우면 5.7×3.8 m 가 됩니다. 카드에 치수가 적힌 세트는 그 치수가 정답이라,
   * 그림은 그 벽에 맞춰 조금 늘여 붙입니다. 치수가 아니라 비로 두는 까닭 — 층고 슬라이더를 움직여도 가로·깊이가 같은 비로 따라가야
   * 합니다(`CompositionPlanner` 의 비율 효과).
   */
  faceRatio?: { width: number; depth: number };
  /**
   * **파노라마 돔** — 등장방형 한 장(배경 id). 있으면 이 방은 상자 대신 지면 투영 돔으로 섭니다(`buildPanoramaDome`).
   *
   * 돔 반지름은 방 가로·깊이의 절반, 눈높이는 1.6 m(파노라마를 찍은 높이). 바닥 면(`faces.bottom`)이 걸려 있으면 그 실측 지도를
   * 가로×깊이 평면으로 깝니다 — 지면 투영 바닥은 카메라가 가운데서 멀어지면 번지기 때문입니다(2026-09-16 헤드리스 실측).
   */
  panorama?: string;
  /**
   * **호리존 방** — 여섯 안쪽 면이 **한 가지 색**인 스튜디오(사이클로라마). 있으면 이 방은 호리존입니다.
   *
   * 전개도·파노라마·장소 카드가 **없는** 방입니다 — 그림을 붙이는 대신 색 하나로 여섯 면을 잇습니다. 그래서 `faces` 는
   * 늘 비어 있고 `outdoor` 는 두지 않습니다(실외 갈래와 겹치면 «이미지 생성» 이 파노라마를 뽑으려 듭니다).
   * 색은 `#rrggbb` 하나뿐입니다 — 정규화가 모양이 틀린 값을 떨어뜨리면 방은 보통 실내 방이 됩니다.
   */
  horizon?: { color: string };
  /**
   * **배경 흐름** — 이 방의 면·돔 그림을 초당 이만큼(그림 한 장의 몇 배) 흘립니다. 없으면 정지 그림입니다.
   *
   * # 왜 두는가
   *
   * 면·돔 텍스처가 정지 그림이면 레퍼런스 영상에 배경 움직임이 **한 프레임도 안 찍힙니다.** 영상 모델은
   * 그걸 그대로 따라 배경을 얼려 버려서, 차 안에서 창밖이 흘러야 하는 컷이 특히 어색합니다. 그림을 새로
   * 뽑지 않고도 «배경이 움직이는 컷» 이라는 사실을 영상에 남기는 가장 싼 길이 UV 를 옮기는 것입니다.
   *
   * # 왜 미터가 아니라 UV 인가
   *
   * «초당 그림 한 장의 몇 배» 라서, 방 크기를 바꿔도 «몇 초에 한 바퀴» 가 그대로입니다. 미터로 두면
   * 방 크기가 곧 축척인 이 앱에서(`setRoomDimsIn`) 치수를 만질 때마다 눈에 익은 속도가 흔들립니다.
   *
   * 부호는 **그림이 움직여 보이는 쪽**이 아니라 표집 자리를 옮기는 쪽입니다 — 사람이 고르는 네 방향은
   * `EnvironmentPanel` 의 `ROOM_DRIFT_DIRECTIONS` 한 벌이 부호까지 들고 있습니다.
   *
   * 기본은 **없음(정지)** 입니다. 쓰던 사람의 배경이 어느 날 갑자기 흐르면 놀랍니다.
   */
  drift?: { x: number; y: number };
  /**
   * **배경 영상** — 한 면(또는 돔)에 정지 그림 대신 **영상**을 겁니다. 없으면 전부 정지 그림입니다.
   *
   * # 왜 흐름(`drift`)만으로는 모자란가
   *
   * UV 를 옮기는 흐름은 «그림 전체가 한 방향으로 미끄러지는» 것뿐입니다 — 구름·터널 조명·차창 밖
   * 풍경처럼 통째로 흐르는 것에는 맞지만, **지나가는 차·부서지는 파도·걸어가는 사람**은 그렇게
   * 생기지 않습니다. 그 면에 실제로 움직이는 그림이 있어야 레퍼런스 영상에 그 움직임이 찍히고,
   * 영상 모델이 「이 구역은 이렇게 움직인다」 를 읽습니다.
   *
   * # 왜 면 하나인가
   *
   * 한 컷에서 움직여야 하는 배경은 대개 카메라가 보는 한 면(뒷벽·창밖)이나 돔 전체입니다. 여섯 면을
   * 각각 영상으로 두면 디코더가 여섯 개 돌아 재생이 무너지고, 실제로 그렇게 쓸 일도 없었습니다.
   * 더 필요해지면 배열로 넓히면 됩니다 — 지금 배열로 두면 화면·정리·시각 맞추기가 전부 갈래를 탑니다.
   *
   * `source` 는 **영상 파일 경로**(목록의 id 와 같습니다). 아직 안 골랐으면 빈 글자이고, 그때는
   * «켜 두었지만 걸린 것이 없는» 상태입니다 — 켜자마자 목록이 비어 있어도 «만들기» 를 누를 수 있어야
   * 해서 이 상태를 지웁니다.
   *
   * 기본은 **없음**입니다. 흐름과 마찬가지로, 쓰던 사람의 배경이 어느 날 갑자기 움직이면 놀랍니다.
   * 흐름과 **함께** 켤 수 있습니다(흐르는 영상) — 서로를 끄지 않습니다.
   */
  video?: { face: RoomVideoFace; source: string };
}

/** 배경 영상을 걸 자리 — 여섯 면 중 하나이거나 파노라마 돔 전체. */
export type RoomVideoFace = CompositionCubeFace | "panorama";

/**
 * 배경을 무엇으로 세울지.
 *
 * - cube — 여섯 면을 상자 안쪽에 붙입니다. 면끼리 안 맞으면 이음매가 보입니다
 * - panorama — 등장방형 한 장을 뒤집은 구에 감습니다. 이음매가 없어 이쪽이 깔끔합니다
 * - hdri — 빛까지 환경맵에서 받습니다
 */

/**
 * 배경막을 다루는 세 갈래. 자세한 뜻은 `CompositionState.backgroundShot` 에.
 * "fixed" = 배경 고정(무한 하늘) · "room" = 방(유한 큐브) · "shot" = 배경도 함께(근사).
 */

// ── GLB 트랙 ─────────────────────────────────────────────────────────────

/**
 * 외부에서 가져온 GLB 자산.
 *
 * 블렌더에서 만든 애니메이션을 그대로 씬에 얹습니다. 카메라·배경·조명은
 * 구도잡기가 계속 담당하고, 이 트랙은 인물·오브젝트 움직임만 맡습니다.
 */
export interface GlbTrack {
  id: string;
  name: string;
  /** 넣던 순간의 blob URL. 앱을 닫으면 죽으니 저장에서는 빠집니다. */
  url: string;
  /** 프로젝트 폴더에 정리한 파일. 다시 열 때는 이것으로 읽습니다. (2026-09-05 검증) */
  filePath?: string;
  /** 재생할 애니메이션 클립 이름. 비어 있으면 첫 클립을 씁니다. */
  clipName?: string;
  /** 로드 후 확인된 클립 목록(화면 표시용) */
  clips?: string[];
  /** 클립 길이(초). 로드하면서 알게 됩니다 */
  clipDuration?: number;
  /** 끄면 한 번만 재생하고 마지막 프레임에서 멈춥니다 */
  loop?: boolean;
  /** 마스터 타임라인에서 이 애니메이션이 시작하는 시각(초) */
  startTime: number;
  /** 재생 속도 배율 */
  speed: number;
  position: Vector3Value;
  rotation: Vector3Value;
  /** 균등 스케일. 블렌더와 단위가 달라도 여기서 맞춥니다. */
  scale: number;
  visible: boolean;
}

// ── 카메라 ───────────────────────────────────────────────────────────────

export interface CameraComposition {
  position: Vector3Value;
  /** 카메라가 바라보는 지점. 위치와 이 둘로 방향이 정해집니다. */
  target: Vector3Value;
  /** 세로 화각(도). 렌즈 느낌을 정합니다. 낮을수록 망원입니다. */
  fovDegrees: number;
}

/**
 * 저장해 둔 카메라 한 대.
 *
 * 화각까지 담습니다 — 구도는 «어디서 보는가» 와 «얼마나 넓게 보는가» 가 함께라야 복원됩니다.
 * 클로즈업으로 잡아 둔 것을 불렀는데 화각이 광각으로 남아 있으면 다른 그림이 됩니다.
 */
export interface CameraShot {
  id: string;
  /** 「수화 클로즈업샷」 처럼 사람이 붙이는 이름. */
  name: string;
  position: Vector3Value;
  target: Vector3Value;
  fovDegrees: number;
}

/**
 * 트랙 하나가 적는 **속성**.
 *
 * 한 키에 셋을 함께 담으면 «자리만 옮기고 싶은데 회전까지 그때 값으로 굳는» 일이 납니다.
 * 속성을 나누면 자리는 다섯 번, 회전은 두 번처럼 서로 다른 리듬으로 찍을 수 있습니다.
 */
export type MotionChannel = "position" | "rotation" | "scale" | "pose";

/** 인물·소품 하나의 **한 속성** 트랙. */
export interface MotionTrack {
  id: string;
  /** 인물이면 `characterId`, 소품이면 `ObjectComposition.id`. */
  targetId: string;
  /** 무엇을 적는 트랙인가. 대상 하나에 속성마다 트랙이 따로 생깁니다. */
  channel: MotionChannel;
  keys: MotionKey[];
  /**
   * 이 트랙에 들어간 **모션의 이름**(모캡에서 왔을 때).
   *
   * 키만 보고는 그게 어느 춤이었는지 알 수 없습니다. 영상 아홉 개를 분석해 두면 더욱이요.
   * 손으로 찍은 키에는 없습니다(그때는 «수화» 로만 뜹니다).
   */
  sourceName?: string;
  /** 그 모션을 만든 분석 줄의 id — «재분석» 이 어느 영상을 다시 볼지 여기서 찾습니다. */
  sourceId?: string;
  /**
   * 키 **사이의 완급**. 없으면 등속(리니어)입니다.
   *
   * 카메라 무빙만 완급을 갖고 인물은 등속이면, 카메라는 부드럽게 멈추는데 그 안의 사람만
   * 기계처럼 딱 서서 눈에 띕니다. 기본을 리니어로 두는 까닭은 손대지 않은 옛 저장본이
   * 갑자기 다르게 움직이면 안 되기 때문입니다.
   */
  easing?: EasingCurve;
  /**
   * 이 트랙을 **잠시 끄기**. 켜면(=muted) 재생에서 빠집니다.
   *
   * 지우는 것과 다릅니다 — 키는 그대로 남고 «지금은 안 쓴다» 만 표시합니다. 무빙이
   * 여럿일 때 하나씩 꺼 보며 어느 것이 어색한지 가리는 것이 가장 흔한 쓰임입니다.
   */
  muted?: boolean;
}

/** 트랙의 한 점 — «이 시각에 이 값이었다». */
export interface MotionKey {
  id: string;
  /** 마스터 타임라인의 절대 초. 카메라 클립과 달리 트랙은 컷 전체에 걸칩니다. */
  time: number;
  /** 속성 값. 자리는 m, 회전은 라디안, 크기는 배율입니다. */
  value: Vector3Value;
  /**
   * 이 키에서 **다음 키까지**의 완급. 없으면 트랙의 곡선을 씁니다.
   *
   * 곡선이 트랙에 하나뿐이면 구간마다 다른 리듬을 만들 수 없습니다.
   */
  easing?: EasingCurve;
  /**
   * **자세 키**(`channel: "pose"`)의 관절별 회전 — `CharacterComposition.bonePose` 와 같은 모양.
   * 자세 키의 `value` 는 쓰지 않습니다(0,0,0).
   *
   * # 관절마다 줄을 따로 두지 않고 «자세 한 장» 으로 담는 까닭
   *
   * 마네킹 관절은 손가락까지 쉰 개가 넘습니다. 줄을 관절마다 두면 사람 하나에 쉰 줄이 생겨
   * 타임라인이 읽히지 않고, 프리셋 하나 적용할 때마다 쉰 개의 키를 따로 찍어야 합니다.
   * 한 장에 모든 관절 값을 담아 두고 **관절마다 따로 보간**하면 결과는 같습니다 — 팔이
   * 0~2초, 다리가 1~3초에 움직여도 1초에 찍은 한 장이 그 사이 값을 붙잡아 줍니다.
   * 키에 없는 관절은 0(차렷)입니다.
   */
  bones?: Record<string, Vector3Value>;
  /**
   * 이 자세 키에서 **사람이 직접 찍은 관절** — 관절 줄에 값이 안 바뀌어도 점을 찍습니다.
   *
   * 관절 줄은 «값이 바뀐 자리» 로만 점을 골랐는데, K 로
   * 막 찍은 손목은 아직 앞뒤와 값이 같아 점이 없었습니다. 애프터이펙트에서 K 는 «여기에 키가
   * 있다» 를 적는 것이지 «값이 바뀌었다» 가 아닙니다. 그래서 찍은 관절을 따로 적어 둡니다.
   */
  joints?: string[];
}

/**
 * 인물·소품의 **레이어** — 타임라인에 막대 하나로 섭니다. 막대가 있는 동안만 화면에 있습니다.
 *
 * # 키 여러 개가 아니라 막대 하나
 *
 * 처음에는 «여기서 나타남 / 여기서 사라짐» 키를 찍는 계단 트랙(`visibilityTracks`)으로
 * 만들었습니다. 규칙은 맞았지만 «올삐가 언제부터 언제까지 있나» 가 점 두 개로만 보여서,
 * 막대를 보자마자 읽히는 편집 프로그램의 약속과 달랐습니다. 이제 **시작~끝 한 막대**입니다.
 * 한 사람이 두 번 나타나는 일은 드물고, 그때는 인형을 하나 더 세우면 됩니다.
 *
 * 레이어가 **없는** 대상은 타임라인 처음부터 끝까지 있습니다(옛 저장본 그대로).
 */
export interface TargetLayer {
  id: string;
  /** 인물이면 `characterId`, 소품이면 `ObjectComposition.id`. */
  targetId: string;
  /** 나타나는 초. */
  start: number;
  /** 사라지는 초. 없으면 타임라인 끝까지. */
  end?: number;
  /** 눈 끄기 — 막대는 남고 화면에서만 뺍니다(애프터이펙트의 눈과 같은 뜻). */
  hidden?: boolean;
}

/** 한동안 쓰였던 계단 트랙. 읽을 때 `TargetLayer` 로 옮기고 다시는 쓰지 않습니다. */
interface LegacyVisibilityTrack {
  targetId: string;
  keys: { time: number; visible: boolean }[];
}

/** 계단 키를 막대 하나로 — 처음 보이는 시각부터 그 뒤 처음 사라지는 시각까지. */
function layerFromLegacy(track: LegacyVisibilityTrack, id: string): TargetLayer | null {
  const keys = (track.keys || []).slice().sort((a, b) => a.time - b.time);
  if (!track.targetId || !keys.length) return null;
  /*
    첫 키 앞은 첫 키의 반대였습니다.
    - 첫 키가 «나타남» → 그 시각부터.
    - 첫 키가 0초보다 뒤의 «사라짐» → 0초부터 보이던 것.
    - 첫 키가 **0초의** «사라짐» → 처음엔 없다가 다음 «나타남» 부터.
  */
  const first = keys[0];
  const start = first.visible
    ? first.time
    : first.time > 1e-6
      ? 0
      : (keys.find((key) => key.visible)?.time ?? 0);
  const endKey = keys.find((key) => !key.visible && key.time > start);
  return { id, targetId: track.targetId, start, ...(endKey ? { end: endKey.time } : {}) };
}

/**
 * 방의 한 면이 **그 시각에 뒤엣것을 가리는가** — 켜고 끄는 키.
 *
 * 트랙이 **없는** 면은 방의 고정 스위치(`CompositionRoom.occludeFaces`)를 따릅니다.
 * 트랙이 있으면 트랙이 이깁니다 — 시간대별로 정해 둔 것이 한 번에 정한 것보다 구체적이라서요.
 * 첫 키 앞은 첫 키의 반대입니다(`VisibilityKey` 와 같은 규칙).
 */
export interface OccludeKey {
  id: string;
  time: number;
  on: boolean;
}

/**
 * 시간대별 «가린다 / 안 가린다». 방의 한 면, 또는 **소품 하나**(`objectId`)에 붙습니다.
 *
 * 방 면 줄에는 `roomId`+`face` 가, 소품 줄에는 `objectId` 가 찹니다. 둘을 한 표에 두는 까닭은 재생이 **한 군데서**
 * 시간을 읽어야 하기 때문입니다 — 표가 둘이면 한쪽만 고쳐 어긋나는 일이 반드시 생깁니다.
 */
export interface OccludeTrack {
  id: string;
  /** 방 면 줄일 때. 소품 줄이면 비어 있습니다. */
  roomId?: string;
  face?: CompositionCubeFace;
  /** 소품 줄일 때(`ObjectComposition.id`). */
  objectId?: string;
  keys: OccludeKey[];
  muted?: boolean;
}

export interface CompositionTimeline {
  /** 초 */
  duration: number;
  fps: number;
  /**
   * 타임라인에 올린 **노래**. 뮤직비디오는 노래가 곧 시간표입니다.
   *
   * 씬에 «작업 방식» 을 고르게 하는 대신, 노래를 올린 컷이 곧 뮤직비디오 컷입니다 — 골라야 할 것이 하나 줄어듭니다.
   */
  music?: CompositionMusic;
}

/**
 * 타임라인에 깔린 노래 하나와 그 **구간**.
 *
 * 구간은 **타임라인 시각**(초)입니다 — 노래 시각이 아닙니다. `offset` 으로 노래를 밀어 두면
 * 둘이 갈라지는데, 나눠 뽑기·재생·표시가 전부 타임라인 시각으로 말해야 어긋나지 않습니다.
 */
export interface CompositionMusic {
  /** 파일 경로. 파일은 그대로 두고 경로만 적습니다(그림과 같은 규칙). */
  path: string;
  name: string;
  /** 노래 전체 길이(초). 타임라인 길이와 다를 수 있습니다. */
  seconds: number;
  /**
   * 타임라인 0초에서 **노래의 몇 초**가 울리는가. 후렴부터 쓰려면 여기를 밀어 둡니다.
   */
  offset?: number;
  bpm?: number;
  barsPerSection?: number;
  /** 구간 — 나눠 뽑기가 이 경계에서 자릅니다. */
  sections: { id: string; label: string; start: number; end: number }[];
}

/**
 * 이 구도에서 뽑은 **레퍼런스 영상** 한 편.
 *
 * 컷에는 «지금 쓰는 것» 한 편만 적히는데(`Cut.refVideoPath`), 실제로는 길이·나눠 뽑기·카메라를 바꿔 가며
 * 여러 번 뽑습니다. 목록을 구도가 들고 있으면 그 구도를 다시 열 때 뽑아 둔 것이 전부 남아 있고, 컷은 그중 하나를 고릅니다.
 */
export interface CompositionRender {
  id: string;
  path: string;
  /** 초. 생성기에 넣을 러닝타임이 됩니다. */
  seconds: number;
  /** 뽑은 시각(ISO). 목록을 최근 순으로 봅니다. */
  at: string;
  /** 나눠 뽑기 조각이면 «3/12» 처럼. 통째로면 비어 있습니다. */
  part?: string;
}

export interface CompositionState {
  camera: CameraComposition;
  /**
   * 카메라 무빙 **클립 목록**. 시간순으로 이어 붙습니다(앞 클립이 끝난 자세에서 다음이 출발).
   *
   * 예전에는 컷당 하나였습니다 — 옛 저장본은 `cameraMove` 한 개를 들고 있어 정규화가
   * 목록 첫 칸으로 옮깁니다.
   */
  /**
   * 저장해 둔 **카메라 구도**들. 누르면 그 자리로 바로 갑니다.
   *
   * 카메라 무빙(`cameraMoves`)과는 다른 것입니다. 무빙은 «시간에 따라 움직이는 한 대» 이고
   * 이쪽은 «세워 둔 여러 대» 입니다 — 한 씬을 A 클로즈업·B 역각·전경으로 나눠 잡아 두고
   * 오가는 용도라 시간 축이 없습니다.
   */
  cameraShots?: CameraShot[];
  /** 지금 활성인 구도. G 키가 이 자리로 돌아갑니다. 없으면 창을 열었을 때의 자리로. */
  activeShotId?: string | null;
  /**
   * 모든 무빙 클립이 **첫 클립의 앵커**를 함께 쓸지.
   *
   * 한 사람을 여러 무빙으로 돌 때는 축이
   * 하나여야 이어 붙였을 때 튀지 않고, 무빙마다 다른 것을 볼 때는 따로여야 합니다.
   */
  lockAnchors?: boolean;

  cameraMoves?: CameraMove[];
  /** @deprecated 옛 저장본 호환. 읽지 마세요 — `cameraMoves` 가 원본입니다. */
  cameraMove?: CameraMove | null;
  characters: CharacterComposition[];
  /** 구도잡기 안에서만 사는 인물들 */
  mannequins: CompositionMannequin[];
  objects: ObjectComposition[];
  /**
   * 소품 **묶음**. 상자 몇 개를 모아 한 덩어리로 다루고, 그 덩어리에 뜻을 붙입니다.
   */
  objectGroups?: CompositionObjectGroup[];
  guideLines?: CompositionGuideLine[];
  /**
   * 컷 전체가 공유하는 마스터 타임라인.
   * 카메라 무빙·GLB 애니메이션·캐릭터 동선이 모두 이 시계를 봅니다.
   */
  timeline?: CompositionTimeline;
  /** 이 구도에서 뽑은 레퍼런스 영상들(최근이 뒤). 컷은 이 중 하나를 골라 씁니다. */
  renders?: CompositionRender[];
  /** 블렌더 등에서 가져온 GLB 애니메이션 트랙 */
  glbTracks?: GlbTrack[];

  /**
   * 인물·소품의 **시간 트랙**. 대상 하나에 하나씩입니다.
   *
   * 키가 **둘 이상**인 트랙만 움직입니다. 하나뿐이면 재생 중에도 원래 자리에 그대로 둡니다 —
   * 실수로 한 번 찍었다고 물체가 엉뚱한 데로 순간이동하면 되돌리기가 어렵습니다.
   */
  motionTracks?: MotionTrack[];
  /** 인물·소품의 레이어 막대 — 있는 시간. `TargetLayer` 참고. */
  layers?: TargetLayer[];
  /** 방 면의 시간대별 «가린다/안 가린다». `OccludeTrack` 참고. */
  occludeTracks?: OccludeTrack[];

  /** 바닥 격자를 그릴지. 인물이 공중에 뜬 건지 보려면 필요합니다. */
  showFloor: boolean;
  /** 격자와 독립된 그림자. 사진 방의 자동 모드는 인물 발밑의 부드러운 접지 그늘입니다. */
  shadows?: CompositionShadows;
  /** 이름표를 띄울지. 캡처와 영상에서는 자동으로 꺼집니다. */
  showLabels: boolean;
  /** 인물이 지나갈 길을 선으로 그릴지 */
  showCharacterPaths: boolean;
  /** 전경(인물·소품) 확대 배율. 배경은 그대로 두고 앞만 키웁니다 */
  foregroundZoom: number;

  /**
   * 마우스·키보드 카메라 조작 속도 배수(0.2~3, 기본 1).
   *
   * 회전 감도는 화각과 거리로 자동으로 잡히지만(`orbitRotateSpeed`), 사람마다·마우스마다
   * 손맛이 달라 그 자동값이 여전히 빠르거나 느립니다.
   * 자동값에 **곱해서** 씁니다 — 거리·화각에 맞추는 규칙은 그대로 두고 손맛만 옮깁니다.
   */
  cameraSpeed?: number;

  /**
   * 배경을 붙일지, 빈 «방» 에서 구도만 잡을지.
   *
   * 파노라마·HDRI·
   * 배경 고정/함께·배경 눈높이·축척 맞추기·돔·3D 세트를 전부 걷어냈습니다.
   */
  backgroundOn?: boolean;
  /**
   * 세워 둔 **방들**. 정규화가 반드시 하나 이상 채웁니다.
   *
   * 여기가 방의 **진짜 자리**입니다 — 아래 `roomSize`·`roomDepth`·`roomHeight`·
   * `backgroundFaces`·`occludeFaces` 는 방이 하나뿐이던 시절의 저장본을 읽을 때만
   * 쓰입니다(`normalizeComposition` 이 `rooms[0]` 로 옮깁니다). 값을 둘로 두면
   * 한쪽만 고치는 사고가 나므로, 정규화를 지나면 아무도 옛 필드를 읽지 않습니다.
   */
  rooms?: CompositionRoom[];
  /**
   * 지금 손대는 방. 면을 붙이거나 치수를 고치면 이 방이 바뀝니다.
   *
   * null 이면 첫 방입니다 — 방이 하나뿐인 보통 경우에 «활성 방을 고르는 일» 자체를
   * 안 하게 하려고 둡니다.
   */
  activeRoomId?: string | null;
  /**
   * @deprecated 방이 하나뿐이던 시절의 **가로**(m). `rooms[0].width` 로 옮겨집니다.
   *
   * 옛 이름이 «한 변» 이라 필드 이름은 `roomSize` 그대로 둡니다(저장본 호환).
   */
  roomSize?: number;
  /** @deprecated 옛 저장본의 **깊이**(m). `rooms[0].depth` 로 옮겨집니다. */
  roomDepth?: number;
  /** @deprecated 옛 저장본의 **층고**(m). `rooms[0].height` 로 옮겨집니다. */
  roomHeight?: number;
  /**
   * 인물·소품이 방을 벗어나면 방을 **넓힐지**. 기본은 **아니오**(고정).
   *
   * 방 크기가 곧 배경 그림의 크기라, 넓히면 벽도 같이 커져 인물이 상대적으로 작아집니다.
   * 실측으로 뽑은 배경에서는 그게 곧 축척이 틀어지는 것입니다. 그래서 기본은 고정이고,
   * 넓히기는 «방이 얼마든 상관없는» 옛 방식(구도만)으로 쓸 때만 켭니다.
   */
  roomAutoGrow?: boolean;
  /**
   * **투시** — 방 밖에서 볼 때 안의 인물을 가리는 **외벽**을 반투명하게 걷을지. 기본은 **켜짐**.
   *
   * 걷는 경우는 «카메라 밖·인물 안·그 벽이 사이를 막을 때» 로 좁혀서,
   * 9/14 의 «가리기»(문 밖 인물을 방 안에서 볼 때)는 그대로 살아 있습니다.
   * 끄면 진짜 건물처럼 밖에서는 안이 안 보입니다.
   *
   * # 사람이 체크한 «가릴 면» 은 켜도 안 걷습니다
   *
   * 한때 안쪽 면까지 걷었더니 「오른쪽 벽을 가릴 면으로 체크해 놓았는데 밖에서 인물이 다
   * 보이네」 가 됐습니다. 그래서 걷는 것은 **외벽 그림 때문에 자동으로 가리는 바깥 껍질**
   * 뿐입니다(`applyWallCutaway`).
   *
   * # 이름이 `wallCutaway` 가 아닌 까닭
   *
   * 그 사고를 고치며 잠깐 기본을 꺼짐으로 뒀다가, 로 다시
   * 켰습니다. 그 사이 앱이 정규화한 `wallCutaway: false` 를 **자동저장했을 수 있습니다** —
   * 사람이 끈 것과 구별이 안 되는 값이라, 같은 이름으로 기본만 바꾸면 사용자 구도는 계속
   * 꺼진 채로 남습니다. 그래서 이름을 새로 달고 옛 값은 읽지 않습니다.
   */
  outerCutaway?: boolean;
  /**
   * 배경 상자가 **뒤에 있는 것을 가릴지**. 기본은 아니오(다 보임).
   *
   * 배경은 원래 «무한히 먼 하늘» 이라 깊이를 안 씁니다(`markAsBackgroundMesh`). 방 모드에서는
   * 상자가 진짜 벽이라, 켜면 벽 뒤에 선 인물이 제대로 가려집니다 — 문 밖에 세운 인물이
   * 정말 밖에 있는지 눈으로 확인할 수 있습니다. 대신 방보다 큰 인물·GLB 는 몸이 잘립니다.
   */
  /**
   * **면마다** 뒤엣것을 가릴지. 비어 있으면 아무 면도 안 가립니다.
   *
   * 여섯 면을 한꺼번에 켜면 상자가 닫혀 버려 안이 아예 안 보입니다. 실제로 필요한 것은
   * «이 벽 하나만» 입니다 — 문 쪽 벽만 가려 두면 밖에 선 인물이 그 벽 뒤로 사라지면서도
   * 방 안은 훤합니다. 그래서 참·거짓 하나가 아니라 면마다 둡니다.
   */
  /** @deprecated 옛 저장본 호환. `rooms[0].occludeFaces` 로 옮겨집니다. */
  occludeFaces?: Partial<Record<CompositionCubeFace, boolean>>;
  /** @deprecated 옛 저장본 호환 — «여섯 면 전부» 라는 뜻이었습니다. 정규화가 옮깁니다. */
  roomOccludes?: boolean;
  customBackgrounds: CompositionCustomBackground[];
  /** @deprecated 옛 저장본 호환. `rooms[0].faces` 로 옮겨집니다. */
  backgroundFaces: Partial<Record<CompositionCubeFace, string>>;

  /**
   * 컷의 «캐릭터»·«배경» 선택과 한 번이라도 맞춰 본 적이 있는가.
   *
   * 동기화 규칙(`lib/cutCompositionSync.ts`)이 «지운 것을 되살리지 않으려면» 씬에 없는
   * 인물이 «컷에서 뺀 사람» 인지 «아직 한 번도 맞춘 적 없는 옛 구도» 인지 가려야 합니다.
   * 이 표가 없으면 동기화가 생기기 전에 잡아 둔 구도를 여는 순간, 컷에 체크가 없다는
   * 이유로 애써 세워 둔 인물이 전부 숨겨집니다. 그래서 **첫 동기화 전에는 더하기만** 하고
   * (저장하면 씬이 컷 선택을 채웁니다), 그 뒤부터 열 때 컷이 기준이 됩니다.
   */
  cutSynced?: boolean;
  /**
   * 하늘 조명이 없을 때 배경을 얼마나 눌러 둘지. 0~1.
   *
   * 조명을 하나도 안 켰는데 배경만 환하면 인물이 배경 위에 오려 붙인 것처럼
   * 보입니다. 그래서 기본으로 조금 어둡게 깔고, 하늘 조명을 켜면 원래
   * 밝기로 돌려 줍니다.
   */
  skylessBrightness: number;
}

/**
 * «방» 한 변이 가질 수 있는 범위(m)와 기본값.
 *
 * 0.4m = 손바닥만 한 상자(벌레 시점), 400m = 축구장 몇 개. 기본 8m 는 거실·작은 공터쯤이고
 * 1.7m 인물이 화면에서 «사람만 하게» 보이는 자리입니다.
 *
 * 예전에는 배경 눈높이 h 와 S = 2h 로 묶여 있었지만(여섯 면 90° 는 눈이 한가운데일 때만 정확),
 * 방이 «최종 그림» 이 아니라 **구도를 잡는 받침대**가 되면서 그 묶임을 풀었습니다.
 */
export const ROOM_SIZE_MIN = 0.4;
export const ROOM_SIZE_MAX = 400;
export const DEFAULT_ROOM_SIZE = 8;

export const clampRoomSide = (value: number | undefined, fallback: number) =>
  Number.isFinite(value ?? NaN)
    ? Math.min(ROOM_SIZE_MAX, Math.max(ROOM_SIZE_MIN, value as number))
    : fallback;

let roomSeq = 0;
/** 방 하나에 붙는 이름표. 저장본 안에서만 유일하면 되므로 시각+순번이면 충분합니다. */
export function compositionRoomId(): string {
  roomSeq += 1;
  return `rm${Date.now().toString(36)}${roomSeq.toString(36)}`;
}

let musicSeq = 0;
/** 노래 구간 하나에 붙는 이름표. 방 이름표와 같은 규칙(저장본 안에서만 유일하면 됩니다). */
export function musicSectionId(): string {
  musicSeq += 1;
  return `ms${Date.now().toString(36)}${musicSeq.toString(36)}`;
}

/**
 * 저장본에서 읽은 방 한 칸을 지금 쓰는 모양으로. 빠진 값은 기본으로 채웁니다.
 *
 * 자리·회전이 undefined 인 채로 three 에 들어가면 행렬이 통째로 NaN 이 되어 상자가
 * 화면에서 사라집니다 — 인물 정규화가 `rotationY` 하나로 겪었던 것과 같은 사고라
 * 여기서도 한 번에 막습니다.
 */
export function normalizeCompositionRoom(
  saved: Partial<CompositionRoom> | undefined,
  index = 0,
): CompositionRoom {
  const width = clampRoomSide(saved?.width, DEFAULT_ROOM_SIZE);
  const horizonColor = horizonColorOf(saved?.horizon?.color);
  return {
    id: saved?.id || compositionRoomId(),
    name: saved?.name || (index === 0 ? "방" : `방 ${index + 1}`),
    width,
    depth: clampRoomSide(saved?.depth, width),
    height: clampRoomSide(saved?.height, width),
    position: {
      x: Number.isFinite(saved?.position?.x ?? NaN) ? saved!.position!.x : 0,
      y: Number.isFinite(saved?.position?.y ?? NaN) ? saved!.position!.y : 0,
      z: Number.isFinite(saved?.position?.z ?? NaN) ? saved!.position!.z : 0,
    },
    rotationY: Number.isFinite(saved?.rotationY ?? NaN)
      ? (saved?.rotationY as number)
      : 0,
    // 방을 세울 때 정한 갈래. 정규화가 떨어뜨리면 실외 방이 실내처럼 굴어 «이미지 생성» 이 전개도를 뽑습니다.
    // 호리존이 있으면 실외 표는 버립니다 — 둘이 같이 있으면 돔 안내선은 뜨는데 껍질은 숨어 «색을 골랐는데 돔이 보인다» 가
    // 됩니다. 갈래는 하나여야 하고, 색을 일부러 적은 쪽(호리존)이 이깁니다.
    outdoor: saved?.outdoor === true && !horizonColor ? true : undefined,
    faces: { ...(saved?.faces || {}) },
    grownFrom: saved?.grownFrom ? { ...saved.grownFrom } : undefined,
    homeHeight: Number.isFinite(saved?.homeHeight ?? NaN)
      ? (saved?.homeHeight as number)
      : undefined,
    outerFaces: saved?.outerFaces ? { ...saved.outerFaces } : undefined,
    occludeFaces: saved?.occludeFaces ? { ...saved.occludeFaces } : undefined,
    hidden: saved?.hidden === true ? true : undefined,
    sideCropBottom: cropBottomOf(saved?.sideCropBottom),
    panorama: typeof saved?.panorama === "string" && saved.panorama ? saved.panorama : undefined,
    // 실외를 두르는 방식. 안 적힌 옛 저장본은 돔입니다(그때는 돔뿐이었습니다).
    outdoorShape: saved?.outdoorShape === "box" ? "box" : undefined,
    backgroundId: saved?.backgroundId || undefined,
    faceRatio:
      saved?.faceRatio && saved.faceRatio.width > 0 && saved.faceRatio.depth > 0
        ? { width: saved.faceRatio.width, depth: saved.faceRatio.depth }
        : undefined,
    // 호리존 색. 정규화가 떨어뜨리면 저장본을 다시 열 때 호리존이 그냥 빈 실내 방이 됩니다(다른 새 칸과 같은 함정).
    horizon: horizonColor ? { color: horizonColor } : undefined,
    // 배경 흐름도 같은 함정 — 빠뜨리면 흐름을 켜 두고 저장한 컷이 다시 열 때 조용히 정지 그림으로 돌아갑니다.
    drift: roomDriftOf(saved?.drift),
    // 배경 영상도 같은 함정. 걸어 둔 영상이 다시 열 때 사라지면 「분명 움직였는데」 가 됩니다.
    video: roomVideoOf(saved?.video),
  };
}

/** 배경 흐름의 한계(초당 그림의 몇 배). 1 이면 초당 한 바퀴라 벽이 그냥 뭉개집니다 — 눈으로 따라갈 수 있는 끝. */
export const ROOM_DRIFT_MAX = 0.5;

/**
 * 배경 흐름 값을 다듬습니다. 둘 다 0 이거나 숫자가 아니면 «안 흐름»(없음).
 *
 * 판단이 여기 한 벌인 까닭: 화면(«켜짐» 표시)·뷰포트(텍스처를 따로 뜰지)·저장본이 «흐르는 방인가» 를
 * 각자 세면 한 곳만 어긋나 「켜 둔 것처럼 보이는데 안 움직이는 방」 이 생깁니다.
 */
export function roomDriftOf(value: unknown): { x: number; y: number } | undefined {
  const saved = value as { x?: unknown; y?: unknown } | null | undefined;
  const pick = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.max(-ROOM_DRIFT_MAX, Math.min(ROOM_DRIFT_MAX, input))
      : 0;
  const x = pick(saved?.x);
  const y = pick(saved?.y);
  return x === 0 && y === 0 ? undefined : { x, y };
}

/**
 * 배경 영상 루프의 **기본 길이(초)**. 2~4 초면 이음매가 눈에 안 띄고, 로컬 i2v 가 한 번에 내는 길이입니다.
 * 길게 뽑을수록 시간이 제곱으로 들면서 «배경이 살짝 움직인다» 는 목적에는 아무것도 더해 주지 않습니다.
 */
export const ROOM_VIDEO_SECONDS = 3;

/**
 * 배경 영상 값을 다듬습니다. 값이 없거나 모양이 아니면 «안 걸림»(없음).
 *
 * 판단이 여기 한 벌인 까닭은 흐름(`roomDriftOf`)과 같습니다 — 화면(«켜짐» 표시)·뷰포트(영상을 띄울지)·
 * 저장본이 각자 세면 한 곳만 어긋나 「켜 둔 것처럼 보이는데 안 움직이는 방」 이 생깁니다.
 * 면 이름이 이상하면 **정면**으로 돌립니다(끄지 않습니다) — 켜 둔 것을 조용히 꺼 버리는 편이 더 놀랍습니다.
 */
export function roomVideoOf(value: unknown): { face: RoomVideoFace; source: string } | undefined {
  const saved = value as { face?: unknown; source?: unknown } | null | undefined;
  if (!saved || typeof saved !== "object") return undefined;
  const face =
    saved.face === "panorama" || COMPOSITION_CUBE_FACES.includes(saved.face as CompositionCubeFace)
      ? (saved.face as RoomVideoFace)
      : "front";
  return { face, source: typeof saved.source === "string" ? saved.source : "" };
}

/** 옆면 아래 자르기 값을 0~0.9 로. 0 이하·이상한 값은 «안 자름»(없음). */
export function cropBottomOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(0.9, value) : undefined;
}

// ── 호리존 방 ─────────────────────────────────────────────────────────────
/*
   색의 모양·기본값·프리셋·문장은 **여기 한 벌**입니다 — 방 세우기(`addRoomIn`)·환경 탭·뷰포트·
  컷 프롬프트·영상 프롬프트가 전부 이것을 읽습니다. 흩어 두면 「환경 탭은 소문자, 프롬프트는 대문자」 처럼 한 곳만 어긋납니다.
*/

/** 호리존을 세울 때의 색 — 제품 컷에서 가장 흔한 «밝은 회색» 입니다(순백은 노출이 날아갑니다). */
export const HORIZON_DEFAULT_COLOR = "#f2f2f2";

/** 환경 탭의 색 프리셋. 순서는 밝은 것부터, 크로마는 맨 뒤. */
export const HORIZON_COLOR_PRESETS: { label: string; color: string }[] = [
  { label: "흰색", color: "#ffffff" },
  { label: "밝은 회색", color: "#f2f2f2" },
  { label: "18% 회색", color: "#777777" },
  { label: "검정", color: "#000000" },
  { label: "크로마 그린", color: "#00b140" },
  { label: "크로마 블루", color: "#0047bb" },
];

/**
 * 호리존 색을 `#rrggbb`(소문자)로. 모양이 틀리면 없음.
 *
 * `<input type="color">` 는 늘 소문자 `#rrggbb` 를 주지만 저장본은 손으로 고칠 수 있고, three 의 `Color` 는
 * 이상한 문자열을 받으면 검정으로 조용히 떨어집니다 — «흰 호리존을 골랐는데 검다» 를 여기서 막습니다.
 */
export function horizonColorOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : undefined;
}

/** 이 방이 호리존인가 — 판단은 이 한 줄뿐입니다(`horizon` 칸이 있으면 호리존). */
export function isHorizonRoom(room: Pick<CompositionRoom, "horizon"> | null | undefined): boolean {
  return !!room?.horizon;
}

/**
 * 이 방이 **돔**인가 — 실외인데 «방형» 이 아니면 돔입니다(안 적힌 옛 저장본은 돔뿐이던 시절 것).
 *
 * 화면(환경 탭)·씬(상자냐 돔이냐)·배경 영상(면이냐 돔 전체냐)이 같은 것을 세 군데서 따로 세고
 * 있었습니다. 한 곳만 어긋나면 «고른 모양과 보이는 모양이 다르다» 가 되는데, 그 어긋남은
 * 읽어서는 못 찾습니다(CLAUDE.md 의 «같은 규칙을 두 벌 적지 마세요»).
 */
export function isDomeRoom(
  room: Pick<CompositionRoom, "outdoor" | "outdoorShape"> | null | undefined,
): boolean {
  return room?.outdoor === true && room.outdoorShape !== "box";
}

/**
 * 이 방에서 «배경 영상» 을 걸 **실제 자리**. 돔이면 늘 돔 전체이고, 상자 방에서 돔 값이 남아 있으면 정면입니다.
 *
 * 방 갈래는 나중에 바뀔 수 있어서(실외 돔 ↔ 방형) 저장된 면이 지금 모양과 안 맞을 수 있습니다.
 * 맞지 않는 면에 걸면 **영상이 안 보이는 면에 걸려** 「켰는데 아무 일도 안 일어난다」 가 됩니다.
 */
export function roomVideoFaceOf(room: CompositionRoom): RoomVideoFace {
  const face = room.video?.face ?? "front";
  if (isDomeRoom(room)) return "panorama";
  return face === "panorama" ? "front" : face;
}

/**
 * 세로 화각의 범위(도). 12° ≈ 200mm 망원, 90° ≈ 12mm 초광각(35mm 판 기준).
 * 더 넓히면 가장자리 왜곡이 심해 «구도» 를 읽을 수 없고, 더 좁히면 조금만
 * 돌려도 화면이 튑니다.
 */
export const CAMERA_FOV_MIN = 12;
export const CAMERA_FOV_MAX = 90;


/** 자동 넓히기의 여유 — 딱 맞게 넓히면 머리카락 한 올이 늘 천장에 닿습니다. */
export const ROOM_FIT_MARGIN = 1.2;

/** 카메라 조작 속도 배수의 범위. 0.2 면 다섯 배 느리게, 3 이면 세 배 빠르게. */
export const CAMERA_SPEED_MIN = 0.2;
export const CAMERA_SPEED_MAX = 3;
export const DEFAULT_COMPOSITION: CompositionState = {
  camera: {
    position: { x: 0, y: 1.6, z: 4 },
    target: { x: 0, y: 1.4, z: 0 },
    fovDegrees: 40,
  },
  cameraShots: [],
  activeShotId: null,
  cameraMoves: [],
  cameraMove: null,
  characters: [],
  mannequins: [],
  objects: [],
  objectGroups: [],
  guideLines: [],
  timeline: { duration: 5, fps: 24 },
  glbTracks: [],
  motionTracks: [],
  layers: [],
  occludeTracks: [],
  showFloor: true,
  shadows: { ...DEFAULT_SHADOWS },
  showLabels: true,
  showCharacterPaths: true,
  foregroundZoom: 1,
  cameraSpeed: 1,
  backgroundOn: true,
  /*
    기본 구도는 «방 하나». 정규화가 반드시 하나 이상 채우므로 여기 빈 배열을 두면
    `DEFAULT_COMPOSITION` 을 그대로 쓰는 자리(새 구도)에서만 방이 없어집니다 —
    그래서 여기서도 한 칸을 세웁니다. id 는 정규화가 다시 매깁니다.
  */
  rooms: [],
  activeRoomId: null,
  roomAutoGrow: false,
  customBackgrounds: [],
  backgroundFaces: {},
  skylessBrightness: 0.35,
};

/**
 * 저장된 구도를 지금 쓰는 모양으로 맞춥니다.
 *
 * 예전 데이터는 `rotationY` 하나만 들고 있습니다. 그대로 읽으면 X·Z 가
 * undefined 라서 three.js 에서 NaN 이 되고 인물이 화면에서 사라집니다.
 */
export function normalizeComposition(
  saved?: Partial<CompositionState> | null,
): CompositionState {
  if (!saved) return { ...DEFAULT_COMPOSITION };
  const camera = { ...DEFAULT_COMPOSITION.camera, ...(saved.camera || {}) };
  /*
    옛 저장본 옮기기 — 축척 손잡이가 «배경 눈높이 h» 에서 «방 한 변 S» 하나로 바뀌었습니다.

    둘은 S = 2h 로 묶여 있었으므로(밑면이 y=0 인 정육면체의 한가운데 높이가 S/2), 방 크기가
    없고 눈높이만 있는 저장본은 2h 로 옮깁니다. 그래야 예전에 맞춰 둔 «배경 대 인물» 비율이
    그대로 살아납니다. 사라진 값(파노라마·HDRI·배경 배치·돔·3D 세트)은 그냥 버립니다 —
    되살릴 화면이 없습니다.
  */
  const legacy = saved as Partial<CompositionState> & {
    backgroundEyeHeight?: number;
  };
  const roomSize =
    saved.roomSize ??
    (typeof legacy.backgroundEyeHeight === "number"
      ? legacy.backgroundEyeHeight * 2
      : DEFAULT_ROOM_SIZE);
  /*
    방이 하나뿐이던 저장본을 **방 배열의 첫 칸**으로 옮깁니다.

    옛 필드(`roomSize`·`backgroundFaces`·`occludeFaces`)는 타입에 남겨 두지만 여기를
    지나면 아무도 읽지 않습니다 — 둘 다 살려 두면 「면을 붙였는데 안 보인다」 처럼
    한쪽만 고친 사고가 반드시 납니다. 정규화가 한 방향으로만 흐르게 둡니다.
  */
  /*
    **새 구도에는 방이 없습니다.**

    빈 구도에서 인물만 세우고 시작해, 필요할 때 «방 추가»(실내·실외)로 세웁니다. 아래 한 칸은 **옛 저장본**을 옮길 때만
    만듭니다 — 방이 하나뿐이던 시절의 값(`roomSize`·`backgroundFaces`·`roomOccludes`)이 있으면 그 방이 실재했던 것입니다.
  */
  const hadLegacyRoom =
    saved.roomSize !== undefined ||
    saved.roomDepth !== undefined ||
    saved.roomHeight !== undefined ||
    saved.roomOccludes !== undefined ||
    saved.occludeFaces !== undefined ||
    Boolean(saved.backgroundFaces && Object.keys(saved.backgroundFaces).length) ||
    typeof legacy.backgroundEyeHeight === "number";
  const rooms: CompositionRoom[] = (
    saved.rooms && saved.rooms.length
      ? saved.rooms
      : !hadLegacyRoom
      ? []
      : [
          {
            id: compositionRoomId(),
            name: "방",
            width: roomSize,
            depth: saved.roomDepth ?? roomSize,
            height: saved.roomHeight ?? roomSize,
            faces: saved.backgroundFaces || {},
            /*
              옛 저장본의 `roomOccludes: true` 는 «여섯 면 전부» 라는 뜻이었습니다.
              그대로 옮기면 상자가 닫혀 안이 안 보이므로, 켜 두었던 사람에게는
              **정면 하나만** 물려줍니다 — 가장 자주 쓰는 면이고 나머지는 필요할 때 켭니다.
            */
            occludeFaces:
              saved.occludeFaces ??
              (saved.roomOccludes === true ? { front: true } : undefined),
          },
        ]
  ).map((room, index) => normalizeCompositionRoom(room, index));
  return {
    ...DEFAULT_COMPOSITION,
    ...saved,
    shadows: normalizeShadows(saved.shadows, saved.showFloor !== false),
    camera,
    characters: (saved.characters || []).map((item) => {
      const rotation = item.rotation || { x: 0, y: item.rotationY || 0, z: 0 };
      return {
        ...item,
        rotation,
        rotationY: rotation.y,
        pose: item.pose || "stand",
        position: copyVector(item.position),
        path: (item.path || []).map(copyVector),
        bonePose: item.bonePose ? { ...item.bonePose } : undefined,
        fingers: item.fingers ? { ...item.fingers } : undefined,
      };
    }),
    mannequins: (saved.mannequins || []).map((item) => ({
      ...item,
      // 색은 «고른 것만» 남깁니다 — 빈 문자열이 남으면 자동 색으로 돌아가지 못합니다.
      color: typeof item.color === "string" && item.color ? item.color : undefined,
    })),
    objects: saved.objects || [],
    /*
      묶음이 사라졌는데 소품이 그 묶음을 가리키면 색·이름이 없는 «유령 묶음» 이 됩니다.
      없는 묶음을 가리키는 소품은 묶음에서 풀어 줍니다.
    */
    objectGroups: saved.objectGroups || [],
    /*
      옛 트랙은 한 키에 자리·회전·크기가 함께 있었습니다(2026-09-12~14). 속성별로 갈라
      옮깁니다 — 그대로 두면 «이동만 찍었는데 회전까지 굳는» 문제가 남습니다.
    */
    // 키가 빈 트랙은 버립니다 — 화면에 빈 줄만 남으면 «왜 있지» 가 됩니다.
    layers: [
      ...(saved.layers || []).filter(
        (layer) => layer && layer.targetId && Number.isFinite(layer.start),
      ),
      // 계단 트랙으로 저장된 것은 막대로 옮깁니다. 같은 대상의 막대가 이미 있으면 그쪽이 이깁니다.
      ...(((saved as { visibilityTracks?: LegacyVisibilityTrack[] }).visibilityTracks || [])
        .filter((track) => !(saved.layers || []).some((layer) => layer.targetId === track.targetId))
        .map((track, index) => layerFromLegacy(track, `layer-legacy-${index}`))
        .filter((layer): layer is TargetLayer => layer !== null)),
    ],
    occludeTracks: (saved.occludeTracks || [])
      .filter(
        (track) =>
          track &&
          ((track.roomId && track.face) || track.objectId) &&
          Array.isArray(track.keys) &&
          track.keys.length > 0,
      )
      // 면 줄의 «눈» 도 같은 날 걷었습니다 — 까닭은 아래 `motionTracks` 주석.
      .map((track) => ({ ...track, muted: undefined })),
    motionTracks: (saved.motionTracks || []).flatMap((track) => {
      const keys = track.keys || [];
      /*
        트랙 «눈»(잠시 끄기)은 2026-09-15 에 속성 줄에서 걷었습니다.
        켤 단추가 없어졌으니 꺼 둔 채 저장된 트랙은 **켜서** 읽습니다 — 영영 못 켜는 트랙이
        남으면 「키는 있는데 왜 안 움직이지」 가 됩니다.
      */
      if (track.channel) return [{ ...track, muted: undefined, keys }];
      const legacy = keys as unknown as {
        id: string;
        time: number;
        position?: Vector3Value;
        rotation?: Vector3Value;
        scale?: Vector3Value;
      }[];
      const split = (
        channel: MotionChannel,
        pick: (key: (typeof legacy)[number]) => Vector3Value | undefined,
      ) => {
        const picked = legacy
          .map((key) => {
            const value = pick(key);
            return value
              ? { id: `${key.id}-${channel}`, time: key.time, value }
              : null;
          })
          .filter((key): key is MotionKey => key !== null);
        return picked.length
          ? [
              {
                id: `${track.id}-${channel}`,
                targetId: track.targetId,
                channel,
                keys: picked,
              },
            ]
          : [];
      };
      return [
        ...split("position", (key) => key.position),
        ...split("rotation", (key) => key.rotation),
        ...split("scale", (key) => key.scale),
      ];
    }),
    guideLines: saved.guideLines || [],
    /*
      옛 저장본은 무빙이 하나(`cameraMove`)였습니다 — 목록 첫 칸으로 옮깁니다.
      이름표가 없던 클립에는 지금 붙입니다(타임라인에서 고르고 끌려면 필요).
    */
    cameraMoves: (saved.cameraMoves?.length
      ? saved.cameraMoves
      : saved.cameraMove
        ? [saved.cameraMove]
        : []
    ).map((move) => ({
      ...move,
      id: move.id || cameraMoveId(),
      // 합쳐 없어진 프리셋(달리 아웃·오빗 180° …)은 지금 id 로 옮깁니다.
      // 클립이 `amount` 를 이미 들고 있어 움직임은 그대로 살아납니다.
      shotId: resolveShotId(move.shotId),
    })),
    cameraMove: null,
    cameraShots: (saved.cameraShots || []).map((shot) => ({
      ...shot,
      id: shot.id || cameraMoveId(),
    })),
    activeShotId: saved.activeShotId ?? null,
    glbTracks: saved.glbTracks || [],
    customBackgrounds: saved.customBackgrounds || [],
    backgroundFaces: saved.backgroundFaces || {},
    backgroundOn: saved.backgroundOn ?? true,
    rooms,
    // 사라진 방을 가리키는 저장본이면 첫 방으로 되돌립니다 — null 이 곧 «첫 방» 입니다.
    activeRoomId: rooms.some((room) => room.id === saved.activeRoomId)
      ? (saved.activeRoomId as string)
      : null,
    // 옛 저장본은 자동으로 커졌지만, 실측 방에서는 그게 축척을 흔듭니다 — 기본을 고정으로.
    roomAutoGrow: saved.roomAutoGrow === true,
    outerCutaway: saved.outerCutaway !== false,
  };
}

// ── 구도에서 말 뽑아내기 ─────────────────────────────────────────────────

/**
 * 샷 크기를 «인물이 화면 세로를 얼마나 차지하는가» 로 정합니다.
 *
 * 「클로즈업으로 잡아 줘」 라고 적는 것보다 이쪽이 정확합니다. 사람마다
 * 클로즈업의 뜻이 다르지만, «화면 세로의 절반» 은 누구에게나 절반이에요.
 *
 * ## 왜 거리만으로는 안 되는가
 *
 * 예전에는 거리만 봤습니다. 화각이 40° 로 못 박혀 있던 동안에는 «거리 = 샷 크기»
 * 가 성립했지만, 카메라 탭에 «샷 크기 — 렌즈 화각»(12°~90°) 손잡이가 생기면서
 * 그 전제가 깨졌습니다. 2m 에서 초광각 80° 면 화면은 전신이 다 들어온 풀샷인데
 * 거리만 보면 «클로즈업» 이라고 적어 LLM 에 «사실» 로 넘어갑니다 — 참고 그림과
 * 정반대의 샷을 지시하게 됩니다(반대로 망원 18°·5m 는 화면이 클로즈업인데
 * «미디엄 샷» 이 됩니다).
 *
 * 경계값은 옛 기준(화각 40°·키 1.7m)에서 그대로 옮긴 것이라, 화각을 안 만진
 * 옛 구도는 예전과 같은 이름이 나옵니다.
 *
 * @param distance 카메라에서 인물까지 거리(m)
 * @param fovDegrees 세로 화각(도)
 * @param subjectHeight 인물 키(m)
 */
export function shotSizeOf(
  distance: number,
  fovDegrees = DEFAULT_COMPOSITION.camera.fovDegrees,
  subjectHeight = 1.7,
): { ko: string; en: string } {
  const half = Math.tan((Math.max(1, fovDegrees) * Math.PI) / 360);
  // 화면 세로 중 인물이 차지하는 비율. 1 이면 화면을 꽉 채웁니다.
  const share = subjectHeight / (2 * Math.max(0.05, distance) * half);
  if (share >= 2.34) return { ko: "익스트림 클로즈업", en: "extreme close-up" };
  if (share >= 1.3) return { ko: "클로즈업", en: "close-up" };
  if (share >= 0.83)
    return { ko: "바스트 샷", en: "medium close-up, chest up" };
  if (share >= 0.52) return { ko: "웨이스트 샷", en: "medium shot, waist up" };
  if (share >= 0.33) return { ko: "니 샷", en: "medium long shot, knees up" };
  if (share >= 0.195)
    return { ko: "풀 샷", en: "full shot, whole body in frame" };
  return { ko: "롱 샷", en: "long shot, figure small in the frame" };
}

/** 카메라 높이로 앵글을 정합니다. 인물 눈높이 기준입니다. */
export function angleOf(
  cameraY: number,
  subjectEyeY: number,
): { ko: string; en: string } {
  const diff = cameraY - subjectEyeY;
  if (diff > 1.2) return { ko: "높은 부감", en: "high angle looking down" };
  if (diff > 0.3) return { ko: "약한 부감", en: "slightly high angle" };
  if (diff < -1.2) return { ko: "낮은 앙각", en: "low angle looking up" };
  if (diff < -0.3) return { ko: "약한 앙각", en: "slightly low angle" };
  return { ko: "눈높이", en: "eye level" };
}

/** 화면 가로에서 인물이 어디쯤 있는지. 삼분할로 말합니다. */
/**
 * **인물이 화면 어디에 있는가** — 가로·세로를 -1~1 로.
 *
 * 왼쪽 -1 · 오른쪽 +1 / 위 -1 · 아래 +1. 화면 안이면 -1~1 안에 듭니다.
 *
 * # 왜 한 벌로 모았나
 *
 * 2026-09-21 점검: 같은 계산이 `summarizeCompositionCamera` 와 `cutPrompt.ts` 에 **두 벌**
 * 있었고, **가로 화각 공식이 서로 달랐습니다.**
 *
 * 이쪽 atan(tan(fov/2) × 비율) ← 맞는 식
 * 저쪽 (fov × 16/9) / 2 ← 각도에 비율을 그냥 곱함
 *
 * 그래서 같은 구도인데 컷 프롬프트와 영상 프롬프트가 인물을 다른 자리에 적었습니다.
 * 화각이 넓을수록 더 벌어집니다(90° 에서 두 배 가까이).
 *
 * # 세로는 «가슴 높이» 를 잽니다
 *
 * 발밑을 재면 클로즈업에서 화면 밖(140%)이 나오고, 정수리를 재면 늘 위쪽에 붙습니다.
 * 키의 0.72 가 「그 사람이 화면의 이 자리에 있다」 와 가장 잘 맞습니다.
 */
export function framePlaceOf(
  camera: { position: Vector3Value; fovDegrees: number },
  position: Vector3Value,
  heightM: number,
  aspect = 16 / 9,
): { lateral: number; vertical: number; xPct: number; yPct: number } {
  const halfV = Math.tan((camera.fovDegrees * Math.PI) / 360) || 0.0001;
  const halfH = Math.atan(halfV * aspect) || 0.0001;
  const dx = position.x - camera.position.x;
  const dz = position.z - camera.position.z;
  const distance = Math.hypot(dx, dz);
  const lateral = Math.atan2(dx, Math.abs(dz) || 0.001) / halfH;
  const chestY = position.y + heightM * 0.72;
  const vertical =
    Math.atan2(camera.position.y - chestY, Math.max(distance, 0.001)) /
    (Math.atan(halfV) || 0.0001);
  return {
    lateral,
    vertical,
    // 한 자리까지만 — 그보다 잘게 적어 봐야 생성기가 못 지킵니다.
    xPct: Math.round((lateral + 1) * 500) / 10,
    yPct: Math.round((vertical + 1) * 500) / 10,
  };
}

export function framePositionOf(offsetRatio: number): {
  ko: string;
  en: string;
} {
  if (offsetRatio < -0.18)
    return { ko: "화면 왼쪽 삼분할선", en: "on the left third of the frame" };
  if (offsetRatio > 0.18)
    return {
      ko: "화면 오른쪽 삼분할선",
      en: "on the right third of the frame",
    };
  return { ko: "화면 가운데", en: "centred in the frame" };
}

/** 인물 수로 부르는 이름이 따로 있습니다. 「투 샷」 은 두 사람이 한 화면에 있다는 뜻입니다. */
function groupShotOf(count: number): { ko: string; en: string } | null {
  if (count === 2) return { ko: "투 샷", en: "two shot" };
  if (count === 3) return { ko: "쓰리 샷", en: "three shot" };
  if (count >= 4) return { ko: "그룹 샷", en: "group shot" };
  return null;
}

export interface CompositionCameraSummary {
  /** 화면에 그대로 보여 줄 한 줄 */
  ko: string;
  en: string;
  /** LLM 에 「바꾸지 말라」고 넘길 값들 */
  facts: Record<string, unknown>;
  /** 인물별로 나눠 본 것 */
  subjects: {
    characterId: string;
    distanceM: number;
    shot: { ko: string; en: string };
    angle: { ko: string; en: string };
    position: { ko: string; en: string };
    /**
     * **화면에서의 자리(백분율).** 왼쪽 0% · 오른쪽 100% / 위 0% · 아래 100%.
     *
     * 사용자 2026-09-21: Seedance 2.5 가 `THE WOMAN 화면 왼쪽, x 42%, y 44%` 처럼
     * **숫자로** 자리를 받아 줍니다. 말로 「왼쪽에」 라고만 하면 컷마다 조금씩
     * 옮겨 가는데 백분율은 안 흔들립니다.
     *
     * 우리는 이 값을 **이미 알고 있습니다** — 구도잡기가 3D 자리를 들고 있고
     * 여기서 이미 화면 가로 위치(`lateral`)를 재고 있었습니다. 안 쓰고 있었을 뿐입니다.
     *
     * 화면 밖으로 나간 인물은 0~100 을 벗어납니다. 자르지 않습니다 — 「프레임 밖에
     * 있다」 는 것도 사실이고, 잘라서 100% 로 만들면 가장자리에 붙어 선 것처럼 읽힙니다.
     */
    screen: { xPct: number; yPct: number };
  }[];
  /** 구도가 없으면 false. 이때는 수동 값으로 물러섭니다. */
  hasComposition: boolean;
}

/**
 * 구도에서 샷·앵글·무빙을 읽어 문장으로 옮깁니다.
 *
 * **여기서 나온 것은 사실입니다.** 컷 프롬프트를 만들 때 이 값을 LLM 에
 * 넘기되 「바꾸지 말라」고 못을 박습니다. 그냥 넘기면 임의로 고쳐서,
 * 「인물이 왼쪽에」 라고 정해 뒀는데 오른쪽에 세운 문장이 나옵니다.
 */
export function summarizeCompositionCamera(
  composition?: CompositionState | null,
  options: {
    /** 인물 키(cm)를 아는 경우. 없으면 170 으로 봅니다 */
    heightsCm?: Record<string, number>;
    /** 이미 만들어 둔 무빙 설명이 있으면 그걸 씁니다 */
    movement?: { ko: string; en: string } | null;
    /** 화면 가로세로비. 가로 화각을 계산하는 데 씁니다 */
    aspect?: number;
  } = {},
): CompositionCameraSummary {
  const empty: CompositionCameraSummary = {
    ko: "",
    en: "",
    facts: {},
    subjects: [],
    hasComposition: false,
  };
  if (!composition) return empty;

  const placed = (composition.characters || []).filter((item) => !item.hidden);
  if (!placed.length) return empty;

  const camera = composition.camera;
  const aspect = options.aspect ?? 16 / 9;
  const subjects = placed.map((placement) => {
    const heightCm =
      options.heightsCm?.[placement.characterId] ?? placement.heightCm ?? 170;
    const height = heightCm / 100;
    const dx = placement.position.x - camera.position.x;
    const dz = placement.position.z - camera.position.z;
    const distance = Math.hypot(dx, dz);
    const place = framePlaceOf(camera, placement.position, height, aspect);

    return {
      characterId: placement.characterId,
      distanceM: Math.round(distance * 10) / 10,
      // 샷 이름은 화면 점유율로 정합니다 — 화각을 바꿔도 이름이 따라옵니다.
      shot: shotSizeOf(distance, camera.fovDegrees, height),
      // 눈은 정수리보다 조금 아래입니다. 0.94 는 사람 비례에서 나온 값입니다.
      angle: angleOf(camera.position.y, placement.position.y + height * 0.94),
      position: framePositionOf(place.lateral),
      screen: { xPct: place.xPct, yPct: place.yPct },
    };
  });

  // 가장 가까운 인물이 그 컷의 주인공입니다. 샷 크기는 그 사람 기준으로 부릅니다.
  const lead = subjects.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
  const group = groupShotOf(subjects.length);

  /*
    이어 붙인 클립 **전부**를 말합니다.

    예전에는 `describeCameraMove(moves[0])` 로 첫 클립만 설명했습니다. 이 문장은 컷
    프롬프트에 «바꾸지 말 것» 으로 실리는 사실이라, 클립을 둘 이상 걸면 틀린 사실이
    그대로 생성기로 흘러갔습니다(2026-09-12 정리에서 발견).
  */
  const moves = composition.cameraMoves ?? [];
  const move = moves[0] ?? null;
  const movement = options.movement ?? describeCameraMoves(moves);
  const preset = move
    ? SHOT_PRESETS.find((item) => item.id === move.shotId)
    : undefined;

  const koParts = [
    group ? `${group.ko}(${lead.shot.ko} 기준)` : lead.shot.ko,
    lead.angle.ko,
    lead.position.ko,
    movement ? `카메라 무빙 ${movement.ko}` : "카메라 고정",
  ];
  const enParts = [
    group ? `${group.en}, ${lead.shot.en}` : lead.shot.en,
    lead.angle.en,
    lead.position.en,
    movement
      ? `camera move: ${movement.en}`
      : "locked-off camera, no camera movement",
  ];

  return {
    ko: koParts.filter(Boolean).join(", "),
    en: enParts.filter(Boolean).join(", "),
    hasComposition: true,
    subjects,
    facts: {
      camera: {
        fovDegrees: camera.fovDegrees,
        heightM: Math.round(camera.position.y * 100) / 100,
      },
      groupShot: group?.en ?? null,
      subjects: subjects.map((item) => ({
        characterId: item.characterId,
        distanceM: item.distanceM,
        shot: item.shot.en,
        angle: item.angle.en,
        framePosition: item.position.en,
      })),
      /*
        사실도 클립 전부입니다. 문장은 «0~2초 달리 인 → 2~3초 팬 좌» 인데 사실이 첫
        클립 길이만 말하면 둘이 서로 다른 이야기를 합니다.
      */
      cameraMove: moves.length
        ? {
            preset: preset?.label ?? null,
            seconds: cameraMovesEnd(moves),
            clips: moves.length,
          }
        : null,
    },
  };
}

/**
 * 지금 방이 **호리존**이면 그 배경을 한 문장으로. 아니면 null.
 *
 * 호리존은 장소 카드가 없어 «장소는 …» 줄이 안 생깁니다. 그러면 생성기는 배경을 제멋대로 지어냅니다 —
 * 제품 컷에서 가장 안 되는 일입니다. 그래서 구도에서 읽은 **사실**로 배경을 못 박습니다: 이음매 없는 단색,
 * 바닥과 벽의 경계가 안 보임, 그리고 색 코드. 한국어는 사람이 읽는 요청문, 영어는 생성기에 가는 줄입니다.
 *
 * 컷 프롬프트(`cutPrompt.ts`)와 영상 프롬프트(`cutVideoPrompt.ts`)가 **같이** 씁니다 — 문장을 두 벌 두면
 * 색을 바꿨을 때 한쪽만 옛 색을 말합니다.
 *
 * 활성 방을 봅니다(`activeRoomId`, 없으면 첫 방). 숨긴 방은 화면에 없으니 배경도 아닙니다.
 */
export function describeHorizonRoom(
  composition?: CompositionState | null,
): { ko: string; en: string; color: string } | null {
  if (!composition) return null;
  const rooms = composition.rooms ?? [];
  const room = rooms.find((item) => item.id === composition.activeRoomId) ?? rooms[0];
  const color = horizonColorOf(room?.horizon?.color);
  if (!room || room.hidden || !color) return null;
  return {
    color,
    ko: `배경: 호리존 스튜디오 — 이음매 없는 단색 배경(색 ${color}), 바닥과 벽의 경계가 보이지 않음.`,
    en: `Background: seamless cyclorama studio, solid ${color} background, no visible floor-wall edge, soft even studio light.`,
  };
}

/**
 * **호리존이 장소를 이깁니다** — 지금 방이 호리존이면 컷의 배경(장소 카드)은 프롬프트에 안 싣습니다.
 *
 * 컷에 배경을 골라 둔 채 구도에서 호리존 방을 활성으로 두면 «장소는 카페 …» 와 «배경: 호리존 스튜디오 …» 가
 * 한 프롬프트에 같이 실립니다. 생성기는 둘 중 하나를 제멋대로 고르고(대개 문장이 긴 장소 쪽), 제품 컷이 카페 안에
 * 섭니다. 호리존은 사람이 **일부러** 세운 것(제품 컷용, 사용자 2026-09-22)이라 호리존이 이깁니다 — 장소 줄과
 * `facts.location` 을 빼고 호리존 문장만 싣습니다. 컷의 배경 **선택** 은 건드리지 않습니다 — 호리존 방을 지우면
 * 그 장소가 다시 살아나야 하니까요.
 *
 * 컷 프롬프트(`cutPrompt.ts`)와 영상 프롬프트(`cutVideoPrompt.ts`)가 **같이** 씁니다 — 한쪽만 장소를 빼면
 * 그림과 영상이 다른 배경을 말합니다. 판단은 `describeHorizonRoom` 과 같은 것 하나(활성 방이 숨기지 않은 호리존인가)입니다.
 */
export function horizonOverridesLocation(composition?: CompositionState | null): boolean {
  return describeHorizonRoom(composition) !== null;
}
