import { isDomeRoom, type CompositionRoom, type CompositionState, type Vector3Value } from "./composition";
import { evaluateCameraMoves, moveEnd, resolveAnchorSource, sortedMoves, type CameraMove } from "./cameraMoves";
import { cameraMoveBasePoseOf, cameraMovesOf, cameraShotsOf, lockAnchorsOf } from "./compositionEdit/timeline";

export interface CameraCoverage {
  gaps: { start: number; end: number }[];
  clipped: { moveId: string; seconds: number }[];
}

/** 클립의 합집합으로 셉니다. 겹침·중간 빈 구간·꺼 둔 클립을 끝 시각 하나로 판단하지 않습니다. */
export function cameraTimelineCoverage(moves: CameraMove[], duration: number): CameraCoverage {
  const active = sortedMoves(moves).filter((move) => !move.muted && move.duration > 0);
  const span = Math.max(0, duration);
  const gaps: CameraCoverage["gaps"] = [];
  let end = 0;
  for (const move of active) {
    const from = Math.min(span, Math.max(0, move.startTime));
    const to = Math.min(span, Math.max(0, moveEnd(move)));
    if (from > end) gaps.push({ start: end, end: from });
    end = Math.max(end, to);
  }
  // 클립이 없는 구도는 의도한 고정 카메라입니다. 무빙을 넣은 뒤 길이가 어긋날 때만 알립니다.
  if (active.length && end < span) gaps.push({ start: end, end: span });
  return {
    gaps,
    clipped: active.filter((move) => moveEnd(move) > span).map((move) => ({
      moveId: move.id,
      seconds: moveEnd(move) - Math.max(span, move.startTime),
    })),
  };
}

/** 밑면 중심·Y 회전은 방 렌더링과 같은 좌표계입니다. */
function inRoom(point: Vector3Value, room: CompositionRoom): Vector3Value {
  const angle = room.rotationY * Math.PI / 180;
  const x = point.x - room.position.x;
  const z = point.z - room.position.z;
  return {
    x: x * Math.cos(angle) - z * Math.sin(angle),
    y: point.y - room.position.y,
    z: x * Math.sin(angle) + z * Math.cos(angle),
  };
}

function contains(point: Vector3Value, room: CompositionRoom) {
  const p = inRoom(point, room);
  return Math.abs(p.x) <= room.width / 2 + 1e-7 && Math.abs(p.z) <= room.depth / 2 + 1e-7 &&
    p.y >= -1e-7 && p.y <= room.height + 1e-7;
}

/** 두 표본이 모두 방 밖이어도 그 사이에 방을 관통하면 찾습니다. 반환값은 선분의 비율입니다. */
export function roomBoundaryCrossing(from: Vector3Value, to: Vector3Value, room: CompositionRoom): number | null {
  const a = inRoom(from, room);
  const b = inRoom(to, room);
  let enter = -Infinity;
  let leave = Infinity;
  const bounds = { x: [-room.width / 2, room.width / 2], y: [0, room.height], z: [-room.depth / 2, room.depth / 2] };
  for (const axis of ["x", "y", "z"] as const) {
    const delta = b[axis] - a[axis];
    const [min, max] = bounds[axis];
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] < min || a[axis] > max) return null;
      continue;
    }
    const hits = [(min - a[axis]) / delta, (max - a[axis]) / delta].sort((x, y) => x - y);
    enter = Math.max(enter, hits[0]);
    leave = Math.min(leave, hits[1]);
  }
  if (leave - enter < 1e-9 || enter > 1 || leave < 0) return null;
  // 방 안에서 움직이거나 벽을 스치기만 하는 선분은 통과가 아닙니다.
  if (enter >= 0 && enter <= 1) return enter;
  if (leave >= 0 && leave <= 1) return leave;
  return null;
}

export interface CameraPathDiagnostics {
  coverage: CameraCoverage;
  crossings: { moveId: string | null; roomId: string; time: number }[];
  startsOutside: boolean;
  unresolvedMoveIds: string[];
  sampleStepSeconds: number;
}

/**
 * 재생과 같은 평가기로 표본을 만들고 방의 실제 회전·이동을 적용해 경계를 검사합니다.
 * 카메라를 제한하거나 저장값을 고치지 않습니다. 표본 사이 곡선의 완전한 충돌 검사는 아닙니다.
 * 따라가기 앵커는 3D 경계 상자가 있어야 정확합니다. 제공하지 않으면 그 영향 이후는 미검사로 남깁니다.
 */
export function diagnoseCameraPath(
  state: CompositionState,
  duration: number,
  resolveTrackedAnchor?: (source: CameraMove, time: number) => Vector3Value | null,
): CameraPathDiagnostics {
  const allMoves = sortedMoves(cameraMovesOf(state));
  const moves = allMoves.filter((move) => !move.muted);
  const rooms = state.backgroundOn === false ? [] : (state.rooms ?? []).filter((room) =>
    !room.hidden && !isDomeRoom(room) && !room.panorama,
  );
  const span = Math.max(0, duration);
  const step = Math.max(1 / 24, span / 2400);
  const result: CameraPathDiagnostics = {
    coverage: cameraTimelineCoverage(moves, span), crossings: [], startsOutside: false,
    unresolvedMoveIds: [], sampleStepSeconds: step,
  };
  if (!rooms.length || !moves.length || !span) return result;
  const shots = cameraShotsOf(state);
  const base = cameraMoveBasePoseOf(state);
  const times = new Set<number>([0, span]);
  for (let i = 1; i * step < span; i++) times.add(i * step);
  for (const move of moves) {
    for (const at of [move.startTime, move.startTime + 1e-6, moveEnd(move),
      ...(move.keys ?? []).map((key) => move.startTime + key.time),
      ...(move.amountKeys ?? []).map((key) => move.startTime + key.time)]) {
      if (at >= 0 && at <= span) times.add(at);
    }
  }
  const seen = new Set<string>();
  const unresolved = new Set<string>();
  let previous: { time: number; position: Vector3Value } | null = null;
  for (const time of [...times].sort((a, b) => a - b)) {
    let missingAnchor = false;
    const pose = evaluateCameraMoves(base, moves, time, (move, at) => {
      const source = move.anchorFromId ? resolveAnchorSource(move, allMoves) :
        lockAnchorsOf(state) ? allMoves[0] ?? move : move;
      if (!source.anchorTargetId) return source.anchor;
      const anchor = resolveTrackedAnchor?.(source, at);
      if (!anchor) { missingAnchor = true; unresolved.add(move.id); }
      return anchor ?? null;
    }, (id) => {
      const shot = shots.find((item) => item.id === id);
      return shot ? { position: shot.position, target: shot.target, fovScale: 1 } : null;
    });
    if (missingAnchor) { previous = null; continue; }
    if (time === 0) result.startsOutside = !rooms.some((room) => contains(pose.position, room));
    const move = [...moves].reverse().find((item) => time > item.startTime);
    // 저장 구도로 갈아타거나 자유 키의 첫 자세로 뛰는 순간을 벽을 통과하는 이동으로 잇지 않습니다.
    const jump = previous && moves.some((item) => item.startTime >= previous!.time && item.startTime < time &&
      (item.cameraShotId || item.keys?.length || item.amountKeys?.length));
    if (previous && !jump) {
      for (const room of rooms) {
        const key = `${move?.id ?? ""}:${room.id}`;
        if (seen.has(key)) continue;
        const crossing = roomBoundaryCrossing(previous.position, pose.position, room);
        if (crossing === null) continue;
        seen.add(key);
        result.crossings.push({ moveId: move?.id ?? null, roomId: room.id,
          time: previous.time + (time - previous.time) * crossing });
      }
    }
    previous = { time, position: pose.position };
  }
  result.unresolvedMoveIds = [...unresolved];
  return result;
}
