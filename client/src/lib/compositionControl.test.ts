import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeComposition, type CompositionState } from "./composition";
import { addMannequinIn, setGlbClipsIn } from "./compositionEdit";
import { SHOT_PRESETS } from "./cameraMoves";
import { settleCompositionEditor } from "@/components/composition/planner/useCompositionControl";
import {
  reduceCompositionCommands,
  CompositionControlError,
  compositionCommandsJsonSchema,
} from "./compositionControlCommands";
import {
  applyCompositionCommands,
  captureComposition,
  commitComposition,
  getCompositionChanges,
  getCompositionSession,
  listCompositionSessions,
  listCompositionTargets,
  observeCompositionSession,
  openComposition,
  redoComposition,
  registerCompositionOpener,
  registerCompositionProjectPage,
  registerCompositionSession,
  undoComposition,
  withCompositionChangeSource,
  type CompositionSessionPort,
} from "./compositionControl";

const context = { characterIds: ["person"], imageIds: ["image"] };
const identity = { projectName: "시험 프로젝트", cutId: "cut" };
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function fixture(initial = normalizeComposition()) {
  let state = initial;
  const past: CompositionState[] = [];
  const future: CompositionState[] = [];
  const commit = vi.fn(async () => ({ persisted: true }));
  const capture = vi.fn(async () => ({
    guide: "data:image/png;base64,Zw==",
    plate: "data:image/png;base64,cA==",
  }));
  const port: CompositionSessionPort = {
    read: () => ({
      state,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      context,
    }),
    apply: (updater) => {
      const next = updater(state);
      past.push(state);
      state = next;
      future.length = 0;
    },
    undo: () => {
      future.push(state);
      state = past.pop()!;
    },
    redo: () => {
      past.push(state);
      state = future.pop()!;
    },
    capture,
    commit,
  };
  cleanups.push(registerCompositionSession(identity, port));
  const sessionId = listCompositionSessions().at(-1)!.sessionId;
  return {
    sessionId,
    port,
    capture,
    commit,
    state: () => state,
    user: (updater: (current: CompositionState) => CompositionState) => {
      port.apply(updater);
      observeCompositionSession(identity);
    },
  };
}

describe("구도 명령 관문", () => {
  it("스키마 없는 키와 실행 코드를 거부하고 원래 상태를 지킵니다", () => {
    const state = normalizeComposition();
    for (const commands of [
      [{ op: "eval", code: "alert(1)" }],
      [{ op: "camera.set", positionMeters: { x: Infinity, y: 0, z: 0 } }],
      [{ op: "display.update", showFloor: true, unexpected: 1 }],
    ]) {
      expect(() => reduceCompositionCommands(state, commands, context)).toThrow(
        CompositionControlError,
      );
    }
    expect(compositionCommandsJsonSchema.type).toBe("array");
  });
  it("배치 뒤쪽의 대상 오류가 앞쪽의 카메라 변경도 남기지 않습니다", async () => {
    const f = fixture();
    const before = f.state();
    await expect(
      applyCompositionCommands({
        sessionId: f.sessionId,
        expectedRevision: 0,
        commands: [
          { op: "camera.set", fovDegrees: 60 },
          { op: "object.remove", id: "missing" },
        ],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.state()).toBe(before);
    expect(getCompositionSession(f.sessionId).canUndo).toBe(false);
  });
  it("인물의 회전은 라디안, 방의 회전은 도로 같은 규칙에 맞춥니다", () => {
    const first = reduceCompositionCommands(
      normalizeComposition(),
      [
        { op: "character.place", id: "person" },
        { op: "room.add", kind: "indoor" },
      ],
      context,
    );
    const roomId = first.created[0].id;
    const next = reduceCompositionCommands(
      first.state,
      [
        {
          op: "character.update",
          id: "person",
          rotationDegrees: { x: 0, y: 90, z: 0 },
        },
        { op: "room.update", id: roomId, rotationDegrees: 90 },
      ],
      context,
    ).state;
    expect(next.characters[0].rotation.y).toBeCloseTo(Math.PI / 2);
    expect(next.rooms?.find((room) => room.id === roomId)?.rotationY).toBe(90);
  });
  it("묶음을 옮길 때 기존 그룹 변환으로 두 소품의 간격을 보존합니다", () => {
    const made = reduceCompositionCommands(
      normalizeComposition(),
      [
        { op: "object.add", kind: "box", label: "앞" },
        { op: "object.add", kind: "box", label: "뒤" },
      ],
      context,
    );
    const [a, b] = made.created.map((item) => item.id);
    const group = reduceCompositionCommands(
      made.state,
      [
        { op: "object.update", id: b, positionMeters: { x: 2, y: 0, z: -1.2 } },
        { op: "group.create", ids: [a, b] },
      ],
      context,
    );
    const moved = reduceCompositionCommands(
      group.state,
      [
        {
          op: "object.update",
          id: a,
          positionMeters: { x: 4, y: 0, z: -1.2 },
          wholeGroup: true,
        },
      ],
      context,
    ).state;
    expect(
      moved.objects[1].position.x - moved.objects[0].position.x,
    ).toBeCloseTo(2);
  });
  it("등록되지 않은 프로젝트 인물과 관절을 거부합니다", () => {
    expect(() =>
      reduceCompositionCommands(
        normalizeComposition(),
        [{ op: "character.place", id: "unknown" }],
        context,
      ),
    ).toThrow();
    const state = addMannequinIn(normalizeComposition(), "male", "mannequin");
    expect(() =>
      reduceCompositionCommands(
        state,
        [
          {
            op: "pose.bone",
            id: "mannequin",
            bone: "constructor",
            rotationDegrees: { x: 0, y: 0, z: 0 },
          },
        ],
        context,
      ),
    ).toThrow();
  });
  it("GLB 메타데이터가 같으면 같은 참조를 유지합니다", () => {
    const state = normalizeComposition();
    expect(setGlbClipsIn(state, "missing", [], 0)).toBe(state);
    expect(
      reduceCompositionCommands(
        state,
        [{ op: "camera.set", fovDegrees: state.camera.fovDegrees }],
        context,
      ).state,
    ).toBe(state);
  });
  it("키 묶음을 0초 쪽으로 밀어도 사이 간격을 보존합니다", () => {
    const initial = reduceCompositionCommands(
      normalizeComposition(),
      [
        { op: "character.place", id: "person" },
        {
          op: "motion_key.add",
          targetId: "person",
          channel: "position",
          timeSeconds: 1,
        },
        {
          op: "motion_key.add",
          targetId: "person",
          channel: "position",
          timeSeconds: 3,
        },
      ],
      context,
    ).state;
    const keyIds = initial.motionTracks![0].keys.map((key) => key.id);
    const next = reduceCompositionCommands(
      initial,
      [{ op: "motion_keys.shift", keyIds, deltaSeconds: -4 }],
      context,
    ).state;
    expect(next.motionTracks![0].keys.map((key) => key.time)).toEqual([0, 2]);
    expect(initial.motionTracks![0].keys.map((key) => key.time)).toEqual([
      1, 3,
    ]);
    expect(() =>
      reduceCompositionCommands(
        initial,
        [
          {
            op: "motion_key.add",
            targetId: "person",
            channel: "scale",
            timeSeconds: 0,
          },
        ],
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "unsupported_channel" }));
  });
  it("손가락을 정한 뒤 소품을 떼어도 지정한 월드 자리에 둡니다", () => {
    const made = reduceCompositionCommands(
      normalizeComposition(),
      [
        { op: "character.place", id: "person" },
        {
          op: "pose.finger",
          id: "person",
          side: "Left",
          finger: "Index",
          state: "fold",
        },
        { op: "object.add", kind: "box", label: "검" },
      ],
      context,
    );
    const objectId = made.created[0].id;
    const held = reduceCompositionCommands(
      made.state,
      [
        {
          op: "object.attach",
          id: objectId,
          characterId: "person",
          bone: "LeftHand",
        },
      ],
      context,
    ).state;
    const next = reduceCompositionCommands(
      held,
      [
        {
          op: "object.detach",
          id: objectId,
          worldPositionMeters: { x: 2, y: 1, z: 3 },
          worldRotationDegrees: { x: 0, y: 90, z: 0 },
        },
      ],
      context,
    ).state;
    expect(next.characters[0].bonePose!.LeftHandIndex2.z).not.toBe(0);
    expect(next.objects[0].attach).toBeUndefined();
    expect(next.objects[0].position).toEqual({ x: 2, y: 1, z: 3 });
    expect(next.objects[0].rotation.y).toBeCloseTo(Math.PI / 2);
  });
  it("첫 카메라 이동량 키는 양 끝을 유지하고 없는 키 수정은 거절합니다", () => {
    const presetId = SHOT_PRESETS.find((preset) => preset.kind !== "free")!.id;
    const made = reduceCompositionCommands(
      normalizeComposition(),
      [{ op: "camera_move.add", presetId }],
      context,
    );
    const id = made.created[0].id;
    const duration = made.state.cameraMoves![0].duration;
    const next = reduceCompositionCommands(
      made.state,
      [
        {
          op: "amount_key.add",
          id,
          localTimeSeconds: duration / 2,
          amount: 30,
        },
      ],
      context,
    ).state;
    expect(
      next
        .cameraMoves![0].amountKeys!.map((key) => key.time)
        .sort((a, b) => a - b),
    ).toEqual([0, Math.round((duration / 2) * 20) / 20, duration]);
    expect(() =>
      reduceCompositionCommands(
        next,
        [{ op: "amount_key.move", id, keyId: "missing", localTimeSeconds: 1 }],
        context,
      ),
    ).toThrow();
  });
  it("가림 키를 옮기고 지우면 마지막 빈 트랙도 없앱니다", () => {
    const made = reduceCompositionCommands(
      normalizeComposition(),
      [{ op: "room.add", kind: "indoor" }],
      context,
    );
    const next = reduceCompositionCommands(
      made.state,
      [
        {
          op: "occlusion_key.room_toggle",
          roomId: made.created[0].id,
          face: "front",
          timeSeconds: 1,
        },
      ],
      context,
    ).state;
    const track = next.occludeTracks![0];
    const moved = reduceCompositionCommands(
      next,
      [
        {
          op: "occlusion_key.move",
          trackId: track.id,
          keyId: track.keys[0].id,
          timeSeconds: 2,
        },
      ],
      context,
    ).state;
    expect(moved.occludeTracks![0].keys[0].time).toBe(2);
    const removed = reduceCompositionCommands(
      moved,
      [
        {
          op: "occlusion_key.remove",
          trackId: track.id,
          keyId: track.keys[0].id,
        },
      ],
      context,
    ).state;
    expect(removed.occludeTracks).toEqual([]);
  });
  it("자유 카메라 키의 화각을 재생기가 읽는 배율로 바꿉니다", () => {
    const presetId = SHOT_PRESETS.find((preset) => preset.kind === "free")!.id;
    const made = reduceCompositionCommands(
      normalizeComposition(),
      [{ op: "camera_move.add", presetId }],
      context,
    );
    const move = made.state.cameraMoves![0];
    const next = reduceCompositionCommands(
      made.state,
      [
        {
          op: "camera_key.update",
          id: move.id,
          keyId: move.keys![0].id,
          fovDegrees: 60,
        },
      ],
      context,
    ).state;
    expect(
      next.cameraMoves![0].keys![0].pose.fovScale * next.camera.fovDegrees,
    ).toBeCloseTo(60);
    expect(next.cameraMoves![0].keys![0].pose).not.toHaveProperty("fovDegrees");
  });
});

describe("구도 세션과 사람의 편집", () => {
  it("숨긴 창에서 rAF가 오지 않아도 편집 효과 대기는 끝납니다", async () => {
    vi.useFakeTimers();
    const frame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", frame);
    try {
      let finished = false;
      const waiting = settleCompositionEditor().then(() => {
        finished = true;
      });
      await vi.runAllTimersAsync();
      await waiting;
      expect(finished).toBe(true);
      expect(frame).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("편집 뒤 화면 대기가 실패하면 실제 적용과 생성 ID를 오류에도 알립니다", async () => {
    const f = fixture();
    f.port.settle = async () => {
      throw new Error("화면 효과 실패");
    };
    await expect(
      applyCompositionCommands({
        sessionId: f.sessionId,
        expectedRevision: 0,
        commands: [{ op: "mannequin.add", gender: "female", name: "한 명" }],
      }),
    ).rejects.toMatchObject({
      code: "edit_confirmation_failed",
      details: {
        applied: true,
        created: [{ index: 0, id: expect.any(String) }],
        snapshot: { revision: 1, state: { mannequins: [{ name: "한 명" }] } },
      },
    });
    expect(f.state().mannequins).toHaveLength(1);
    expect(listCompositionSessions()[0].busy).toBe(false);
    f.port.settle = undefined;
    const undone = await undoComposition({
      sessionId: f.sessionId,
      expectedRevision: 1,
    });
    expect(undone.state.mannequins).toEqual([]);
  });
  it("되돌린 뒤 화면 대기가 실패해도 실제 되돌린 판을 알립니다", async () => {
    const f = fixture();
    await applyCompositionCommands({
      sessionId: f.sessionId,
      expectedRevision: 0,
      commands: [{ op: "camera.set", fovDegrees: 60 }],
    });
    f.port.settle = async () => {
      throw new Error("화면 효과 실패");
    };
    await expect(
      undoComposition({ sessionId: f.sessionId, expectedRevision: 1 }),
    ).rejects.toMatchObject({
      code: "edit_confirmation_failed",
      details: {
        applied: true,
        operation: "undo",
        snapshot: { revision: 2, canRedo: true },
      },
    });
  });
  it("여러 명령을 하나의 되돌리기 기록에 넣고 다시 실행합니다", async () => {
    const f = fixture();
    const before = f.state();
    const changed = await applyCompositionCommands({
      sessionId: f.sessionId,
      expectedRevision: 0,
      commands: [
        { op: "camera.set", fovDegrees: 60 },
        { op: "mannequin.add", gender: "female", name: "주인공" },
      ],
    });
    expect(changed.revision).toBe(1);
    expect(changed.created).toHaveLength(1);
    const undone = await undoComposition({
      sessionId: f.sessionId,
      expectedRevision: 1,
    });
    expect(undone.state).toEqual(before);
    const redone = await redoComposition({
      sessionId: f.sessionId,
      expectedRevision: 2,
    });
    expect(redone.state.mannequins[0].name).toBe("주인공");
    const log = getCompositionChanges({
      sessionId: f.sessionId,
      sinceRevision: 0,
    });
    expect(log.changes.map((item) => item.source)).toEqual([
      "controller",
      "undo",
      "redo",
    ]);
  });
  it("사람이 바꾼 경로와 전후 값을 기록하고 오래된 명령을 거절합니다", async () => {
    const f = fixture();
    f.user((current) => ({
      ...current,
      camera: { ...current.camera, fovDegrees: 55 },
    }));
    f.user((current) => ({ ...current, showFloor: !current.showFloor }));
    const log = getCompositionChanges({
      sessionId: f.sessionId,
      sinceRevision: 0,
    });
    expect(log.revision).toBe(2);
    expect(log.changes[0]).toMatchObject({
      source: "editor",
      changedPaths: ["/camera/fovDegrees"],
      changes: [{ path: "/camera/fovDegrees", after: 55 }],
    });
    await expect(
      applyCompositionCommands({
        sessionId: f.sessionId,
        expectedRevision: 0,
        commands: [{ op: "camera.set", fovDegrees: 40 }],
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(f.state().camera.fovDegrees).toBe(55);
    expect(log.snapshot.state.showFloor).toBe(f.state().showFloor);
  });
  it("대화가 멈춘 동안 로그가 넘치면 전체 판이 필요하다고 알려줍니다", () => {
    const f = fixture();
    for (let i = 0; i < 205; i++)
      f.user((current) => ({ ...current, showFloor: !current.showFloor }));
    const log = getCompositionChanges({
      sessionId: f.sessionId,
      sinceRevision: 0,
    });
    expect(log.changes).toHaveLength(200);
    expect(log.fullSnapshotRequired).toBe(true);
    expect(log.snapshot.revision).toBe(205);
  });
  it("사람의 되돌리기와 다시 실행도 출처를 구분합니다", () => {
    const f = fixture();
    f.user((current) => ({ ...current, showFloor: !current.showFloor }));
    withCompositionChangeSource(identity, "undo", f.port.undo);
    withCompositionChangeSource(identity, "redo", f.port.redo);
    f.user((current) => ({
      ...current,
      camera: { ...current.camera, fovDegrees: 55 },
    }));
    expect(
      getCompositionChanges({
        sessionId: f.sessionId,
        sinceRevision: 0,
      }).changes.map((item) => item.source),
    ).toEqual(["editor", "undo", "redo", "editor"]);
  });
  it("씬 단계가 아직 마운트되지 않아도 목록을 읽고 단계 이동 후 구도를 엽니다", async () => {
    const prepare = vi.fn(() => {
      cleanups.push(
        registerCompositionOpener(identity, () => {
          fixture();
        }),
      );
    });
    cleanups.push(
      registerCompositionProjectPage(
        identity.projectName,
        () => [identity],
        prepare,
      ),
    );
    expect(listCompositionTargets()).toEqual([identity]);
    const opened = await openComposition(identity);
    expect(prepare).toHaveBeenCalledWith(identity.cutId);
    expect(opened.cutId).toBe(identity.cutId);
    expect(listCompositionTargets()).toEqual([identity]);
  });
  it("프로젝트에 없는 컷을 열려고 해도 새 컷을 만들지 않습니다", async () => {
    const prepare = vi.fn();
    cleanups.push(
      registerCompositionProjectPage(
        identity.projectName,
        () => [identity],
        prepare,
      ),
    );
    await expect(
      openComposition({ projectName: identity.projectName, cutId: "missing" }),
    ).rejects.toMatchObject({ code: "cut_not_found" });
    expect(prepare).not.toHaveBeenCalled();
  });
  it("조회 결과를 고쳐도 실제 구도는 바뀌지 않습니다", () => {
    const f = fixture();
    const before = f.state().camera.fovDegrees;
    getCompositionSession(f.sessionId).state.camera.fovDegrees = 89;
    expect(f.state().camera.fovDegrees).toBe(before);
  });
  it("같은 값 적용·캡처·저장만으로 revision을 올리지 않습니다", async () => {
    const f = fixture();
    await applyCompositionCommands({
      sessionId: f.sessionId,
      expectedRevision: 0,
      commands: [{ op: "camera.set", fovDegrees: f.state().camera.fovDegrees }],
    });
    await captureComposition({ sessionId: f.sessionId, expectedRevision: 0 });
    const saved = await commitComposition({
      sessionId: f.sessionId,
      expectedRevision: 0,
    });
    expect(saved.revision).toBe(0);
    expect(saved.persistedLatest).toBe(true);
    expect(
      getCompositionChanges({ sessionId: f.sessionId, sinceRevision: 0 })
        .changes,
    ).toEqual([]);
  });
  it("캡처 대기 중 사람의 편집이 들어오면 이전 판의 이미지를 반환하지 않습니다", async () => {
    const f = fixture();
    f.capture.mockImplementation(async () => {
      f.user((current) => ({ ...current, showFloor: !current.showFloor }));
      return { guide: "g", plate: "p" };
    });
    await expect(
      captureComposition({ sessionId: f.sessionId, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("디스크 저장 오류를 성공으로 바꾸지 않습니다", async () => {
    const f = fixture();
    f.commit.mockRejectedValue(new Error("디스크 쓰기 실패"));
    await expect(
      commitComposition({ sessionId: f.sessionId, expectedRevision: 0 }),
    ).rejects.toThrow("디스크 쓰기 실패");
    expect(listCompositionSessions()[0].busy).toBe(false);
  });
  it("저장 중 새 편집이 생기면 저장한 판과 현재 판을 구분합니다", async () => {
    const f = fixture();
    f.commit.mockImplementation(async () => {
      f.user((current) => ({ ...current, showFloor: !current.showFloor }));
      return { persisted: true };
    });
    const result = await commitComposition({
      sessionId: f.sessionId,
      expectedRevision: 0,
    });
    expect(result).toMatchObject({
      persistedRevision: 0,
      revision: 1,
      persistedLatest: false,
    });
  });
});
