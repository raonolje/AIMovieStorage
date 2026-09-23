/*
  `lib/compositionEdit.ts` 를 갈래별로 나눈 조각입니다(2026-09-17).

  한 파일에 순수 함수 174개가 모여 3,900줄이 되면서 «어디에 있더라» 를 매번 찾아야 했습니다.
  파일 안에 이미 그어 두었던 구분선을 그대로 파일 경계로 삼았고, 부르는 길은 그대로입니다
  (`@/lib/compositionEdit` 배럴이 전부 다시 내보냅니다).
*/

import { CAMERA_FOV_MAX, CAMERA_FOV_MIN, compositionRoomId, cropBottomOf, HORIZON_DEFAULT_COLOR, horizonColorOf, normalizeCompositionRoom, ROOM_FIT_MARGIN, ROOM_SIZE_MAX, ROOM_SIZE_MIN } from "@/lib/composition";
import { CompositionCubeFace, CompositionRoom, CompositionState, Vector3Value } from "@/lib/composition";
import { foregroundPivotOf } from "./pivot";
import { snapRoomMountsIn } from "./props";
import { patchCameraIn } from "./timeline";

// ── 방(유한 큐브) — 크기 · 천장 뚫기 · 눈높이 ─────────────────────────────
/*
  ## 원리 (지우지 말 것)

  파노라마·6면은 **시차가 없는 각도 그림**입니다. 카메라 높이가 «그 배경을 찍은
  눈높이» 와 달라지면 바닥의 한 점이 그려진 각도와 3D 바닥의 각도가 어긋나
  인물이 뜹니다 — 사용자가 본 「인물이 하늘에 공중부양하고 있고」(2026-09-09).

  «방» 은 배경 여섯 면을 **밑면이 y=0 인 유한 큐브**에 붙입니다.
    · 바닥이 진짜 바닥이라 인물은 **절대 뜨지 않습니다.**
    · 90° 여섯 면은 눈이 정육면체 한가운데일 때만 각도가 맞고, 밑면이 y=0 이면
      한가운데 높이는 S/2 입니다 → **S = 2h**. 그래서 «방 크기» 와 «배경 눈높이» 는
      같은 손잡이의 두 표현입니다.
    · 방을 줄이면 1.7m 인물이 방에서 차지하는 비율이 커져 배경보다 커 보입니다.
      이것이 사용자가 원한 «큐브 크기로 배경을 키우고 줄이는» 동작입니다.

  이름 앞의 `roomFit…` 은 뷰포트 쪽(구현자 A)이 만드는 방 기하 함수와 이름이
  겹치지 않게 둔 접두입니다.
*/

const clampRoomSize = (size: number) =>
  Math.min(ROOM_SIZE_MAX, Math.max(ROOM_SIZE_MIN, size));

/**
 * 세워 둔 **방들**. 정규화를 지나면 반드시 하나 이상입니다.
 *
 * 그래도 빈 배열을 대비해 한 칸을 만들어 돌려줍니다 — 정규화를 안 거친 상태가
 * 어딘가 한 군데라도 있으면 배경이 통째로 사라지고, 그 원인을 찾기가 아주 어렵습니다.
 */
export function roomsOf(current: CompositionState): CompositionRoom[] {
  /*
    **없으면 없는 대로** 돌려줍니다().
    예전에는 빈 목록일 때 기본 방 한 칸을 지어 돌려줬습니다 — 그 탓에 새 컷을 열자마자 방이 서 있었습니다.
  */
  return current.rooms ?? [];
}

/** 지금 손대는 방. `activeRoomId` 가 없거나 사라졌으면 첫 방입니다. */
export function activeRoomOf(current: CompositionState): CompositionRoom {
  const list = roomsOf(current);
  /*
    방이 하나도 없으면 **저장되지 않는 빈 칸**을 돌려줍니다. 읽는 쪽(치수 표시·바닥 격자 크기)이 여기저기라 null 로 두면
    그 스물몇 군데가 전부 «방이 없을 때» 를 따로 처리해야 합니다. 쓰는 쪽(`patchRoomIn`)은 이 id 를 못 찾아 아무 일도
    하지 않으므로, 없는 방이 몰래 생기지는 않습니다. 화면은 `roomsOf(...).length` 로 «방 없음» 을 가립니다.
  */
  return list.find((room) => room.id === current.activeRoomId) ?? list[0] ?? normalizeCompositionRoom(undefined, 0);
}

/**
 * 방 하나를 고칩니다. **방 목록의 유일한 쓰기 통로**입니다.
 *
 * 다른 편집 함수는 전부 이걸 거칩니다 — 배열을 직접 만들면 「방을 지웠는데 활성 방이
 * 사라진 방을 가리킨다」 같은 구멍이 생깁니다. 여기 하나만 맞으면 그런 일이 없습니다.
 */
export function patchRoomIn(
  current: CompositionState,
  roomId: string | null,
  patch: (room: CompositionRoom) => CompositionRoom,
): CompositionState {
  const list = roomsOf(current);
  const target = roomId ?? activeRoomOf(current).id;
  return {
    ...current,
    rooms: list.map((room) => (room.id === target ? patch(room) : room)),
  };
}

/** 활성 방의 세 변(m). */
export function roomDimsOf(current: CompositionState): {
  width: number;
  depth: number;
  height: number;
} {
  const room = activeRoomOf(current);
  return { width: room.width, depth: room.depth, height: room.height };
}

/** 활성 방의 가로(m). 옛 이름이 «한 변» 이라 부르는 곳이 남아 있습니다. */
export function roomFitSizeOf(current: CompositionState): number {
  return activeRoomOf(current).width;
}

/**
 * 방의 세 변을 정합니다. 넘기지 않은 것은 그대로 둡니다.
 *
 * 축척은 «한 변» 이 아니라 세 변 전부입니다 — 실내는 6×5×2.4m 처럼 층고만 낮은 일이
 * 흔해서() 정육면체로는
 * 바닥·천장·벽을 제자리에 둘 수 없습니다.
 */
export function setRoomDimsIn(
  current: CompositionState,
  dims: { width?: number; depth?: number; height?: number },
  roomId: string | null = null,
  /**
   * **사람이 손으로** 바꾼 것인가. 켜면 처음 한 번 «만지기 전 층고» 를 적어 둡니다
   * (`homeHeight`) — 「원래대로」 단추가 돌아갈 자리입니다.
   *
   * 여섯 면 비율 맞추기와 자동 넓히기는 끕니다. 그쪽까지 적어 두면 「원래대로」 가
   * 자동으로 정해진 값을 되돌려 버려, 누르자마자 다시 자동으로 고쳐지는 되돌이표가 됩니다.
   */
  manual = false,
): CompositionState {
  const pick = (next: number | undefined, fallback: number) =>
    clampRoomSize(Number.isFinite(next ?? NaN) ? (next as number) : fallback);
  // 방이 자라면 **붙여 둔 소품도 따라갑니다** — 안 그러면 벽만 물러나고 액자가 허공에 남습니다.
  const resized = patchRoomIn(current, roomId, (room) => {
    const height = pick(dims.height, room.height);
    const touched = manual && Math.abs(height - room.height) > 1e-6;
    return {
      ...room,
      width: pick(dims.width, room.width),
      depth: pick(dims.depth, room.depth),
      height,
      // 끄는 동안 매번 덮어쓰면 «끌기 직전» 이 아니라 «한 프레임 전» 이 됩니다.
      homeHeight: room.homeHeight ?? (touched ? room.height : undefined),
    };
  });
  return snapRoomMountsIn(resized, roomId);
}

/**
 * 방의 **파노라마 돔**(`CompositionRoom.panorama`)을 겁니다. 빈 문자열이면 돔을 풀고 상자로 돌아갑니다.
 *
 * `side` 를 주면 방 가로·깊이를 그 값으로 — 돔 반지름이 곧 «공터 경계까지의 거리» 라, 파노라마를 뽑은 크기(한 변 S m)여야
 * 나무·건물이 사람과 맞는 크기로 섭니다. 돔은 층고를 안 쓰므로 그대로 둡니다.
 */
export function setRoomPanoramaIn(
  current: CompositionState,
  id: string,
  side: number | null = null,
  roomId: string | null = null,
): CompositionState {
  return patchRoomIn(current, roomId, (room) => {
    const next = { ...room, panorama: id || undefined };
    if (id && side && side > 0) {
      next.width = clampRoomSize(side);
      next.depth = clampRoomSize(side);
      // 벽 비는 상자의 것이라 돔에서는 뜻이 없고, 남으면 비율 효과가 가로·깊이를 층고에 묶어 돔을 줄입니다.
      next.faceRatio = undefined;
    }
    return next;
  });
}

/**
 * 실외를 **돔으로 두를지 상자로 두를지** 정합니다.
 *
 * 상자로 바꾸면 돔 텍스처를 풉니다 —
 * 파노라마가 걸린 채로 상자가 되면 화면에는 돔만 보여 «여섯 면을 걸었는데 안 보인다» 가 됩니다.
 */
export function setOutdoorShapeIn(
  current: CompositionState,
  roomId: string,
  shape: "dome" | "box",
): CompositionState {
  return patchRoomIn(current, roomId, (room) => ({
    ...room,
    outdoorShape: shape === "box" ? "box" : undefined,
    panorama: shape === "box" ? undefined : room.panorama,
  }));
}

/**
 * 호리존 방의 **색**(`CompositionRoom.horizon.color`)을 바꿉니다.
 *
 * 호리존이 아닌 방은 그대로 둡니다 — 여기서 색을 심어 버리면 실내 방이 말없이 호리존이 되어(전개도가 안 보임)
 * 「6면을 걸었는데 회색 벽만 보인다」 가 됩니다. 갈래는 방을 세울 때(`addRoomIn`) 한 번만 정합니다.
 * 모양이 틀린 색(`horizonColorOf` 가 거르는 것)도 그대로 둡니다.
 */
export function setRoomHorizonColorIn(
  current: CompositionState,
  roomId: string | null,
  color: string,
): CompositionState {
  const next = horizonColorOf(color);
  if (!next) return current;
  return patchRoomIn(current, roomId, (room) =>
    !room.horizon || room.horizon.color === next ? room : { ...room, horizon: { color: next } },
  );
}

/** 세트가 적어 온 벽 비(`CompositionRoom.faceRatio`)를 정합니다. 없음이면 그림 비율로 돌아갑니다. */
export function setRoomFaceRatioIn(
  current: CompositionState,
  ratio: { width: number; depth: number } | undefined,
  roomId: string | null = null,
): CompositionState {
  return patchRoomIn(current, roomId, (room) => {
    const same =
      room.faceRatio === ratio ||
      (room.faceRatio && ratio && Math.abs(room.faceRatio.width - ratio.width) < 1e-6 && Math.abs(room.faceRatio.depth - ratio.depth) < 1e-6);
    return same ? room : { ...room, faceRatio: ratio };
  });
}

/** 옆면 아래 자르기(`CompositionRoom.sideCropBottom`)를 정합니다. 없음·0 이면 자르기를 풉니다. */
export function setRoomSideCropIn(
  current: CompositionState,
  crop: number | undefined,
  roomId: string | null = null,
): CompositionState {
  const next = cropBottomOf(crop);
  return patchRoomIn(current, roomId, (room) =>
    room.sideCropBottom === next ? room : { ...room, sideCropBottom: next },
  );
}

/**
 * 방들이 **함께** 덮는 넓이(m) — 바닥 격자를 얼마나 깔지 정할 때 씁니다.
 *
 * 방 하나였을 때는 그냥 그 방의 가로였습니다. 여럿이면 옆방까지 담아야 「이 방에서
 * 저 방으로 걸어간다」 를 격자 위에서 볼 수 있습니다. 원점 기준 양쪽이라 한 변은
 * «가장 먼 끝까지의 거리 × 2» 입니다.
 *
 * 회전한 방은 **가로·깊이를 맞바꾼 것까지** 덮게 큰 쪽을 씁니다. 정확한 회전 사각형을
 * 재는 것보다 넉넉한 편이 낫습니다 — 격자는 자일 뿐이라 조금 넓어도 잃는 것이 없고,
 * 모자라면 인물 발밑이 잘립니다.
 */
export function roomsExtentOf(current: CompositionState): {
  width: number;
  depth: number;
} {
  let halfX = 0;
  let halfZ = 0;
  roomsOf(current).forEach((room) => {
    const turned = Math.abs(Math.sin((room.rotationY * Math.PI) / 180)) > 0.3;
    const w = turned ? room.depth : room.width;
    const d = turned ? room.width : room.depth;
    halfX = Math.max(halfX, Math.abs(room.position.x) + w / 2);
    halfZ = Math.max(halfZ, Math.abs(room.position.z) + d / 2);
  });
  return { width: halfX * 2, depth: halfZ * 2 };
}

/**
 * 방을 하나 세웁니다. 이미 방이 있으면 활성 방 **오른쪽에** 벽을 맞대어 붙입니다.
 *
 * ,
 * 「실외 방은 한 변 50 m 돔이 아니라 한 변 100 m 돔으로 바꾸자(기본이 100 m 고 당연히 조절할 수 있어야 하고)」.
 *
 * 돔 반지름이 곧 «둘레까지의 거리» 라, 실내 치수를 물려받으면 나무가 사람만 해집니다. 기본 100 m 는 그저 출발점이고
 * 가로·깊이·층고 칸에서 언제든 바꿉니다.
 */
/**
 * 실외 방(돔)의 **기본 한 변**(m).
 * 파노라마를 뽑을 때 프롬프트에 적히는 크기이기도 해서, 여기 하나만 고치면 화면·프롬프트가 같이 따라갑니다.
 */
export const OUTDOOR_ROOM_SIDE = 100;

/**
 * 호리존 방의 **기본 세 변**(m) — 가로 8 · 깊이 6 · 높이 4.
 *
 * 실내 방(5×4×2.7)보다 큰 까닭: 사이클로라마 스튜디오는 방이 아니라 «무대» 라, 제품을 놓고 카메라를 물릴 자리가
 * 필요합니다. 층고 2.7 이면 부감 컷에서 천장 모서리가 잡힙니다.
 */
export const HORIZON_ROOM_DIMS = { width: 8, depth: 6, height: 4 } as const;

/** 방의 세 갈래 — 실내(6면 상자) · 실외(돔/큰 상자) · 호리존(단색 스튜디오, 사용자 2026-09-22). */
export type RoomKind = "indoor" | "outdoor" | "horizon";

export function addRoomIn(
  current: CompositionState,
  kind: RoomKind = "indoor",
): {
  state: CompositionState;
  id: string;
} {
  const list = roomsOf(current);
  const outdoor = kind === "outdoor";
  const horizon = kind === "horizon";
  const first = list.length === 0;
  const from = activeRoomOf(current);
  /*
    자리를 원점에 두면 새 방이 기존 방 **속에** 들어가 두 상자가 겹칩니다. 벽을 맞대어
    붙이면 문으로 이어진 두 칸이 되어, 거의 언제나 그게 원하는 모양입니다.
    치수는 기존 방을 그대로 물려받습니다 — 대개 같은 층고의 옆방이라서요.
  */
  // 실외는 «세상» 이라 언제나 원점입니다(그 안에 실내 방들이 섭니다 — 사용자 2026-09-17).
  // 호리존은 옆방 치수를 안 물려받습니다 — 스튜디오 크기는 옆 «거실» 과 무관합니다.
  const width = outdoor ? OUTDOOR_ROOM_SIDE : horizon ? HORIZON_ROOM_DIMS.width : first ? 5 : from.width;
  const depth = outdoor ? OUTDOOR_ROOM_SIDE : horizon ? HORIZON_ROOM_DIMS.depth : first ? 4 : from.depth;
  // 돔은 층고를 안 쓰지만(반지름이 크기를 정합니다) 바닥 격자·안내에 쓰이므로 반쯤으로 둡니다.
  const height = outdoor ? OUTDOOR_ROOM_SIDE / 2 : horizon ? HORIZON_ROOM_DIMS.height : first ? 2.7 : from.height;
  const room = normalizeCompositionRoom(
    {
      id: compositionRoomId(),
      name: outdoor ? `실외 ${list.length + 1}` : horizon ? `호리존 ${list.length + 1}` : `방 ${list.length + 1}`,
      outdoor: outdoor || undefined,
      // 호리존은 그림 대신 색 하나 — `faces` 는 비워 두고 색만 적습니다(`CompositionRoom.horizon`).
      horizon: horizon ? { color: HORIZON_DEFAULT_COLOR } : undefined,
      width,
      depth,
      height,
      /*
        실외는 **언제나 원점**입니다 — 그 안에 실내 방들이 서기 때문입니다().
        실내는 앞 방 오른쪽에 벽을 맞대어 세웁니다.
      */
      position:
        outdoor || first
          ? { x: 0, y: 0, z: 0 }
          : {
              x: from.position.x + from.width / 2 + width / 2,
              y: from.position.y,
              z: from.position.z,
            },
      rotationY: outdoor || first ? 0 : from.rotationY,
      faces: {},
    },
    list.length,
  );
  return {
    state: { ...current, rooms: [...list, room], activeRoomId: room.id },
    id: room.id,
  };
}

/**
 * 방을 지웁니다. **마지막 한 칸까지** 지울 수 있습니다 — 방이 없는 것이 새 컷의 기본 상태라,
 * 하나 남은 방을 못 지우면 «구도만 잡는 컷» 으로 되돌아갈 길이 없습니다.
 */
export function removeRoomIn(
  current: CompositionState,
  roomId: string,
): CompositionState {
  const list = roomsOf(current);
  if (!list.length) return current;
  const rooms = list.filter((room) => room.id !== roomId);
  return {
    ...current,
    rooms,
    // 방이 사라졌으면 그 면에 붙여 둔 것도 풀립니다 — 남기면 없는 방을 가리키는 붙임이 됩니다.
    objects: current.objects.map((object) =>
      object.mount?.roomId === roomId ? { ...object, mount: undefined } : object,
    ),
    activeRoomId:
      current.activeRoomId === roomId
        // 마지막 방을 지우면 활성 방도 없습니다 — `rooms[0]` 을 그냥 읽으면 여기서 터집니다.
        ? rooms[0]?.id ?? null
        : (current.activeRoomId ?? null),
  };
}

export function setActiveRoomIn(
  current: CompositionState,
  roomId: string,
): CompositionState {
  return { ...current, activeRoomId: roomId };
}

export function renameRoomIn(
  current: CompositionState,
  roomId: string,
  name: string,
): CompositionState {
  return patchRoomIn(current, roomId, (room) => ({ ...room, name }));
}

/** 방의 자리(밑면 한가운데, m)와 회전(도). 넘기지 않은 것은 그대로. */
export function setRoomPlacementIn(
  current: CompositionState,
  roomId: string | null,
  placement: { x?: number; y?: number; z?: number; rotationY?: number },
): CompositionState {
  const take = (next: number | undefined, fallback: number) =>
    Number.isFinite(next ?? NaN) ? (next as number) : fallback;
  const moved = patchRoomIn(current, roomId, (room) => {
    /*
      **실외는 늘 가운데**입니다.
      실외는 돔이든 큰 상자든 «세상» 이라, 옆으로 밀면 그 안에 있어야 할 방들이 밖으로 나가 버립니다.
      높이만 사람이 정합니다(2층 무대처럼 바닥을 올릴 때).
    */
    if (room.outdoor) {
      return {
        ...room,
        position: { x: 0, y: take(placement.y, room.position.y), z: 0 },
        rotationY: take(placement.rotationY, room.rotationY),
      };
    }
    return {
      ...room,
      position: {
        x: take(placement.x, room.position.x),
        y: take(placement.y, room.position.y),
        z: take(placement.z, room.position.z),
      },
      rotationY: take(placement.rotationY, room.rotationY),
    };
  });
  return snapRoomMountsIn(moved, roomId);
}

export function setRoomHiddenIn(
  current: CompositionState,
  roomId: string,
  hidden: boolean,
): CompositionState {
  return patchRoomIn(current, roomId, (room) => ({
    ...room,
    hidden: hidden ? true : undefined,
  }));
}

/** 배경을 붙일지(방에 여섯 면), 빈 방에서 구도만 잡을지. */
/**
 * 배경(방)이 서 있는가 — **방이 하나라도 있어야** 참입니다.
 *
 *
 *
 * 방을 기본으로 안 세우게 바꾼 뒤(같은 날), 이 값이 «켜짐» 으로 남아 바닥 격자가 **방 크기**(=0)를 따라가 화면이 통째로
 * 비었습니다. 방이 없으면 예전 «구도만» 과 똑같이 굴어야 합니다 — 넓은 기본 격자에 인물만 선 화면. 그 위에서 방을 더해 갑니다.
 */
export function backgroundOnOf(current: {
  backgroundOn?: boolean;
  rooms?: CompositionRoom[];
}): boolean {
  if (!(current.rooms?.length ?? 0)) return false;
  return current.backgroundOn !== false;
}

/** 인물이 방을 벗어나면 방을 넓힐지. 기본은 고정(거짓)입니다. */
export function roomAutoGrowOf(current: CompositionState): boolean {
  return current.roomAutoGrow === true;
}

/** 활성 방에서 면마다 뒤엣것을 가리는지. 기본은 전부 아니오 — 배경은 «무한히 먼 하늘» 입니다. */
export function occludeFacesOf(
  current: CompositionState,
): Partial<Record<CompositionCubeFace, boolean>> {
  return activeRoomOf(current).occludeFaces ?? {};
}

export function setFaceOccludesIn(
  current: CompositionState,
  face: CompositionCubeFace,
  on: boolean,
  roomId: string | null = null,
): CompositionState {
  return patchRoomIn(current, roomId, (room) => ({
    ...room,
    occludeFaces: { ...(room.occludeFaces ?? {}), [face]: on },
  }));
}

/**
 * 방의 여섯 면 — **안쪽**(`"inner"`)과 **바깥쪽**(`"outer"`) 을 가려 읽습니다.
 *
 *
 * 방 안에서는 벽지가, 밖에서는 건물 외벽이 보여야 합니다.
 */
export type RoomFaceShell = "inner" | "outer";

export function roomFacesOf(
  room: CompositionRoom,
  shell: RoomFaceShell,
): Partial<Record<CompositionCubeFace, string>> {
  return (shell === "outer" ? room.outerFaces : room.faces) ?? {};
}

/** 큐브 한 면에 배경을 붙입니다. 빈 문자열이면 그 면을 비웁니다. */
export function setRoomFaceIn(
  current: CompositionState,
  face: CompositionCubeFace,
  id: string,
  shell: RoomFaceShell = "inner",
  roomId: string | null = null,
): CompositionState {
  return patchRoomIn(current, roomId, (room) => {
    const next = { ...roomFacesOf(room, shell), [face]: id };
    /*
      빈 문자열은 «안 붙임» 입니다. 남겨 두면 `outerFaces` 가 «있긴 한데 전부 빈» 상태가
      되어 바깥 껍질을 괜히 세우게 되므로(껍질 하나가 통째로 검게 보입니다) 지웁니다.
    */
    if (!id) delete next[face];
    if (shell === "outer") {
      const any = Object.values(next).some(Boolean);
      return { ...room, outerFaces: any ? next : undefined };
    }
    return { ...room, faces: next };
  });
}

export interface RoomFitExtent {
  /** 가장 높은 점(m) — 천장(y=S)과 견줍니다 */
  top: number;
  /** 방 한가운데(x·z=0)에서 가장 멀리 나간 수평 거리(m) — 벽(±S/2)과 견줍니다 */
  reach: number;
  /** 가장 크게 튀어나온 것의 이름. 알림 문구에 씁니다 */
  label: string | null;
}

/*
  소품 종류마다의 «놓았을 때» 크기(m). 뷰포트가 만드는 도형과 같은 값입니다
  (구 반지름 0.5·상자 1×1×1·탁자 1.4×0.75×0.8·조명 표시구 반지름 0.1).

  뷰포트에서 Box3 로 재지 않는 까닭: 방 크기는 **저장되는 값**이라, 씬이 만들어진
  뒤에야 알 수 있는 값으로 정하면 창을 열 때마다 방이 조금씩 달라집니다. 상태에서
  세면 같은 구도는 언제 열어도 같은 방입니다(전경 확대 피벗과 같은 이유 —
  `foregroundPivotPoints` 주석).
*/
const OBJECT_EXTENT: Record<string, { top: number; half: number }> = {
  sphere: { top: 0.5, half: 0.5 },
  cylinder: { top: 1, half: 0.5 },
  table: { top: 0.75, half: 0.7 },
  light: { top: 0.1, half: 0.1 },
  box: { top: 1, half: 0.5 },
  crate: { top: 1, half: 0.5 },
};

/** 인물의 어깨 반폭(m). 벽까지 거리를 잴 때 몸통 두께만큼은 미리 빼 둡니다. */
const CHARACTER_HALF_WIDTH = 0.35;
/**
 * GLB 한 트랙의 **어림 크기**(m, scale 1 기준).
 *
 * 진짜 경계 상자는 파일을 읽어 봐야 알 수 있고 그것은 뷰포트의 일입니다. 여기서는
 * 사람 하나 크기로 어림잡습니다 — 자동 넓히기는 «부족하면 더 넓히는» 쪽으로만
 * 틀리므로(다음 프레임에 다시 재서 또 넓힙니다) 어림값이어도 방이 좁아지지는
 * 않습니다.
 */
const GLB_GUESS = { top: 1.8, half: 1 };

/**
 * 인물·소품·GLB 가 차지하는 높이와 수평 거리.
 *
 * 전경 확대(foregroundZoom)를 함께 셉니다 — 확대는 전경 그룹을 통째로 키우므로
 * 20배로 켜 두면 1.7m 인물이 실제로 34m 짜리가 되어 천장을 뚫습니다.
 * 가로·세로는 «놓인 것들의 한가운데» 를 피벗으로 벌어지고(`foregroundPivotOf`),
 * 높이는 바닥(y=0)을 피벗으로 커집니다.
 */
export function roomFitExtentOf(
  current: CompositionState,
  heightsCm?: Record<string, number>,
): RoomFitExtent {
  const zoom = current.foregroundZoom || 1;
  const pivot = foregroundPivotOf(current);
  const result: RoomFitExtent = { top: 0, reach: 0, label: null };
  const take = (
    label: string,
    position: Vector3Value,
    top: number,
    half: number,
  ) => {
    const worldTop = zoom * (position.y + top);
    const x = Math.abs(pivot.x + zoom * (position.x - pivot.x)) + half * zoom;
    const z = Math.abs(pivot.z + zoom * (position.z - pivot.z)) + half * zoom;
    const reach = Math.max(x, z);
    // 방이 얼마나 커야 하는지로 견줍니다 — 천장은 S, 벽은 S/2 라 잣대가 다릅니다.
    if (Math.max(worldTop, reach * 2) > Math.max(result.top, result.reach * 2))
      result.label = label;
    result.top = Math.max(result.top, worldTop);
    result.reach = Math.max(result.reach, reach);
  };

  current.characters.forEach((item) => {
    if (item.hidden) return;
    const heightCm = heightsCm?.[item.characterId] ?? item.heightCm ?? 170;
    take("인물", item.position, heightCm / 100, CHARACTER_HALF_WIDTH);
  });
  current.objects.forEach((item) => {
    if (!item.visible) return;
    const size = OBJECT_EXTENT[item.kind] ?? OBJECT_EXTENT.box;
    take(
      item.label || "소품",
      item.position,
      size.top * (item.scale?.y ?? 1),
      size.half * Math.max(item.scale?.x ?? 1, item.scale?.z ?? 1),
    );
  });
  (current.glbTracks || []).forEach((item) => {
    if (!item.visible) return;
    const scale = item.scale || 1;
    take(
      item.name || "GLB",
      item.position,
      GLB_GUESS.top * scale,
      GLB_GUESS.half * scale,
    );
  });
  return result;
}

/**
 * 이만큼 놓으려면 방이 최소 몇 미터여야 하는가(여유 20% 포함).
 *
 * 천장은 y=S, 벽은 ±S/2 이므로 필요한 크기는 max(가장 높은 점, 수평 거리 × 2) 입니다.
 */
/**
 * 지금 놓인 것을 담으려면 세 변이 각각 몇 미터여야 하는가.
 *
 * 가로·깊이는 방 한가운데에서 잰 수평 거리의 두 배, 높이는 가장 높은 점입니다. 여유 20% 는
 * 딱 맞게 넓히면 머리카락 한 올이 늘 천장에 닿기 때문입니다.
 */
/**
 * 방을 **비율을 지킨 채** 키웁니다.
 *
 * 세 변의 비율은 여섯 면 그림에서 나옵니다(`roomRatioFromFaces`). 한 변만 늘리면 그 비율이
 * 깨져 벽 그림이 늘어나므로, 자동 넓히기는 세 변에 같은 배수를 겁니다.
 */
export function roomScaleIn(
  current: CompositionState,
  factor: number,
): CompositionState {
  if (!Number.isFinite(factor) || factor <= 1.0001) return current;
  return patchRoomIn(current, null, (room) => ({
    ...room,
    width: clampRoomSize(room.width * factor),
    depth: clampRoomSize(room.depth * factor),
    height: clampRoomSize(room.height * factor),
    /*
      **처음 부풀 때의 치수만** 적어 둡니다. 넓히기는 여러 번 도는데, 그때마다 덮어쓰면
      «돌아갈 자리» 가 직전의 부푼 크기가 되어 토글을 꺼도 원래대로 안 옵니다.
    */
    grownFrom: room.grownFrom ?? {
      width: room.width,
      depth: room.depth,
      height: room.height,
    },
  }));
}

/**
 * 여섯 면 그림의 가로세로비로 방의 비율을 정합니다 — **높이를 1 로 둔 값**입니다.
 *
 *
 *
 * 상자 W×D×H 에서 각 면이 덮는 넓이는 정해져 있습니다.
 *
 * 정면·후면 = W × H, 왼쪽·오른쪽 = D × H, 위·아래 = W × D
 *
 * 그래서 정면 그림의 가로세로비가 곧 W/H, 옆면 그림의 비가 곧 D/H 입니다. 절대 크기는
 * 그림에 없으므로(그림은 비율만 압니다) 높이 하나만 사람이 정하면 나머지가 따라옵니다.
 *
 * 정면이 없으면 후면을, 왼쪽이 없으면 오른쪽을 봅니다. 둘 다 없으면 null — 그때는 지금
 * 비율을 그대로 둡니다.
 */
export function roomRatioFromFaces(
  aspects: Partial<Record<CompositionCubeFace, number>>,
): { width: number; depth: number } | null {
  const side = (a?: number, b?: number) => {
    const value = Number.isFinite(a ?? NaN) ? a : b;
    return Number.isFinite(value ?? NaN) && (value as number) > 0
      ? (value as number)
      : null;
  };
  const width = side(aspects.front, aspects.back);
  const depth = side(aspects.left, aspects.right);
  if (width === null && depth === null) return null;
  // 한쪽만 알면 나머지는 정사각형으로 봅니다 — 모르는 것을 지어내지 않습니다.
  return { width: width ?? depth ?? 1, depth: depth ?? width ?? 1 };
}

export function roomFitRequiredDims(extent: RoomFitExtent): {
  width: number;
  depth: number;
  height: number;
} {
  const flat = clampRoomSize(extent.reach * 2 * ROOM_FIT_MARGIN);
  return {
    width: flat,
    depth: flat,
    height: clampRoomSize(extent.top * ROOM_FIT_MARGIN),
  };
}

export function roomFitRequiredSize(extent: RoomFitExtent): number {
  return clampRoomSize(
    Math.max(extent.top, extent.reach * 2) * ROOM_FIT_MARGIN,
  );
}

/**
 * 세로 화각(샷 크기). 범위 밖 값은 막습니다.
 *
 * 화각만 바꾸면 **인물과 배경이 정확히 같은 비율로** 커지고 작아집니다
 * (둘 다 화면 크기가 1/tan(화각/2) 에 비례). 그래서 «비율을 지킨 채 원거리·근거리»
 * 는 원래 이쪽이 정답입니다 — 카메라를 앞뒤로 빼는 것은 비율 자체를 바꿉니다.
 */
export function setCameraFovIn(
  current: CompositionState,
  fovDegrees: number,
): CompositionState {
  const next = Number.isFinite(fovDegrees)
    ? fovDegrees
    : current.camera.fovDegrees;
  return patchCameraIn(current, {
    fovDegrees: Math.min(
      CAMERA_FOV_MAX,
      Math.max(CAMERA_FOV_MIN, Math.round(next * 10) / 10),
    ),
  });
}

