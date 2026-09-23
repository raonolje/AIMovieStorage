import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION, normalizeCompositionRoom, type CompositionState } from "./composition";
import { createCameraMove, type CameraMove } from "./cameraMoves";
import { cameraTimelineCoverage, diagnoseCameraPath, roomBoundaryCrossing } from "./cameraPathDiagnostics";
import { cameraMoveBasePoseOf } from "./compositionEdit/timeline";

const room = normalizeCompositionRoom({ id: "room", name: "방", width: 10, depth: 8, height: 3 });
const camera = { ...DEFAULT_COMPOSITION.camera, position: { x: 0, y: 1.5, z: 3 }, target: { x: 0, y: 1.5, z: 0 } };
function move(patch: Partial<CameraMove> = {}): CameraMove {
  return { ...createCameraMove("pull-reveal"), id: "move", duration: 6, amount: 6,
    easing: { p1x: 0, p1y: 0, p2x: 1, p2y: 1 }, anchor: { x: 0, y: 1.5, z: 0 }, ...patch };
}
function state(moves: CameraMove[], patch: Partial<CompositionState> = {}): CompositionState {
  return { ...DEFAULT_COMPOSITION, camera, rooms: [room], cameraMoves: moves, ...patch };
}

describe("카메라 경로 진단", () => {
  it("10×8m 방의 6m 풀백이 후면 경계를 지나는 시각을 찾고 무빙을 바꾸지 않습니다", () => {
    const source = state([move()]);
    const before = JSON.stringify(source);
    const result = diagnoseCameraPath(source, 6);
    expect(result.startsOutside).toBe(false);
    expect(result.crossings).toHaveLength(1);
    expect(result.crossings[0]).toMatchObject({ moveId: "move", roomId: "room" });
    expect(result.crossings[0].time).toBeCloseTo(1, 2);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("처음과 끝이 방 안이어도 큰 반경의 360도 오빗이 옆 벽을 넘는 것을 찾습니다", () => {
    const result = diagnoseCameraPath(state([move({ shotId: "orbit", amount: 360, lookAtAnchor: true })], {
      camera: { ...camera, position: { x: 0, y: 1.5, z: 4 } },
      rooms: [{ ...room, width: 6, depth: 10 }],
    }), 6);
    expect(result.startsOutside).toBe(false);
    expect(result.crossings).toHaveLength(1);
  });

  it("이동·회전한 방과 층 높이를 월드 좌표에 반영하고 양 끝이 밖인 관통도 찾습니다", () => {
    const rotated = { ...room, width: 2, depth: 10, rotationY: 90, position: { x: 20, y: 3, z: -6 } };
    expect(roomBoundaryCrossing({ x: 20, y: 4, z: -6 }, { x: 24, y: 4, z: -6 }, rotated)).toBeNull();
    expect(roomBoundaryCrossing({ x: 20, y: 4, z: -6 }, { x: 20, y: 4, z: -4 }, rotated)).toBeCloseTo(0.5);
    expect(roomBoundaryCrossing({ x: 20, y: 4, z: -8 }, { x: 20, y: 4, z: -4 }, rotated)).toBeCloseTo(0.25);
    expect(roomBoundaryCrossing({ x: 20, y: 2, z: -8 }, { x: 20, y: 2, z: -4 }, rotated)).toBeNull();
  });

  it("여러 방 중 다른 방 안에서 출발해도 밖이라고 하지 않고 공유 경계는 검사합니다", () => {
    const rooms = [room, { ...room, id: "next", position: { x: 0, y: 0, z: 8 } }];
    const result = diagnoseCameraPath(state([move({ amount: -6 })], {
      rooms, camera: { ...camera, position: { x: 0, y: 1.5, z: 7 } },
    }), 6);
    expect(result.startsOutside).toBe(false);
    expect(new Set(result.crossings.map((hit) => hit.roomId))).toEqual(new Set(["room", "next"]));
  });

  it("저장 구도 전환을 방 사이를 가로지르는 연속 이동으로 오인하지 않습니다", () => {
    const result = diagnoseCameraPath(state([move({ shotId: "static", amount: 0, cameraShotId: "b", startTime: 1 })], {
      rooms: [room, { ...room, id: "next", position: { x: 100, y: 0, z: 0 } }],
      cameraShots: [
        { id: "a", name: "카메라 1", ...camera },
        { id: "b", name: "카메라 2", ...camera, position: { x: 100, y: 1.5, z: 3 }, target: { x: 100, y: 1.5, z: 0 } },
      ], activeShotId: "a",
    }), 7);
    expect(result.crossings).toEqual([]);
  });

  it("따라가기 앵커를 임의의 고정 위치로 계산해 안전하다고 하지 않습니다", () => {
    const source = state([move({ anchorTargetId: "actor" })]);
    const missing = diagnoseCameraPath(source, 6);
    expect(missing.unresolvedMoveIds).toEqual(["move"]);
    expect(missing.crossings).toEqual([]);
    const resolved = diagnoseCameraPath(source, 6, () => ({ x: 0, y: 1.5, z: 0 }));
    expect(resolved.unresolvedMoveIds).toEqual([]);
    expect(resolved.crossings).toHaveLength(1);
  });

  it("꺼 둔 무빙과 숨긴 방·돔은 벽 통과 경고에 섞지 않습니다", () => {
    expect(diagnoseCameraPath(state([move({ muted: true })]), 6).crossings).toEqual([]);
    expect(diagnoseCameraPath(state([move()], { rooms: [{ ...room, hidden: true }] }), 6).crossings).toEqual([]);
    expect(diagnoseCameraPath(state([move()], { rooms: [{ ...room, outdoor: true, outdoorShape: "dome" }] }), 6).crossings).toEqual([]);
    expect(diagnoseCameraPath(state([move()], { backgroundOn: false }), 6).crossings).toEqual([]);
  });

  it("프레임 사이의 짧은 자유 키 경로도 키 시각을 직접 검사합니다", () => {
    const pose = (z: number) => ({ position: { x: 0, y: 1.5, z }, target: camera.target, fovScale: 1 });
    const result = diagnoseCameraPath(state([move({ shotId: "free", keys: [
      { id: "k0", time: 0, pose: pose(3) },
      { id: "k1", time: 0.012, pose: pose(6) },
      { id: "k2", time: 0.02, pose: pose(3) },
    ] })]), 6);
    expect(result.crossings[0].time).toBeLessThan(0.012);
  });

  it("타임라인 뒤의 이동은 경로 경고에 넣지 않고 잘린 길이로 알립니다", () => {
    const result = diagnoseCameraPath(state([move()]), 0.5);
    expect(result.crossings).toEqual([]);
    expect(result.coverage.clipped).toEqual([{ moveId: "move", seconds: 5.5 }]);
  });

  it("현재 탐색 카메라 대신 활성 저장 구도로 출발하고 없으면 첫 구도를 씁니다", () => {
    const source = state([move()], { cameraShots: [{ id: "saved", name: "저장", ...camera, position: { x: 1, y: 2, z: 0 } }] });
    expect(cameraMoveBasePoseOf(source).position).toEqual({ x: 1, y: 2, z: 0 });
    expect(cameraMoveBasePoseOf({ ...source, cameraShots: [] }).position).toEqual(camera.position);
  });
});

describe("카메라 클립과 타임라인 길이", () => {
  it("69초 중 19초까지만 무빙이 있으면 남은 50초를 알립니다", () => {
    expect(cameraTimelineCoverage([move({ duration: 19 })], 69)).toEqual({ gaps: [{ start: 19, end: 69 }], clipped: [] });
  });
  it("겹친 구간을 두 번 더하지 않고 중간 빈 구간·꺼진 클립·잘린 꼬리를 구분합니다", () => {
    expect(cameraTimelineCoverage([
      move({ id: "a", duration: 3 }), move({ id: "b", startTime: 2, duration: 2 }),
      move({ id: "off", startTime: 4, duration: 2, muted: true }), move({ id: "c", startTime: 6, duration: 6 }),
    ], 10)).toEqual({ gaps: [{ start: 4, end: 6 }], clipped: [{ moveId: "c", seconds: 2 }] });
  });
  it("고정 카메라만 있는 새 구도와 모두 꺼둔 클립에 빈 시간 경고를 띄우지 않습니다", () => {
    expect(cameraTimelineCoverage([], 10)).toEqual({ gaps: [], clipped: [] });
    expect(cameraTimelineCoverage([move({ muted: true })], 10)).toEqual({ gaps: [], clipped: [] });
  });
});
