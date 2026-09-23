import { describe, expect, it, vi } from "vitest";
import { normalizeComposition } from "@/lib/composition";
import { patchCameraIn } from "@/lib/compositionEdit";
import {
  applyCompositionCommands, commitComposition, getCompositionSession,
  redoComposition, registerCompositionSession, undoComposition,
} from "@/lib/compositionControl";
import { createPlannerSaveSession } from "./plannerSaveSession";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("구도 창의 저장 확인과 닫기", () => {
  const initial = normalizeComposition();
  const edited = patchCameraIn(initial, { fovDegrees: 70 });

  it("아무것도 안 바꾼 창은 묻지 않고 닫고, 편집한 창은 취소하면 유지합니다", async () => {
    const session = createPlannerSaveSession(initial);
    const confirm = vi.fn(async () => false);
    const close = vi.fn();
    await session.requestClose(() => structuredClone(initial), confirm, close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    await session.requestClose(() => edited, confirm, close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    await session.requestClose(() => edited, async () => true, close);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("저장 실패는 변경을 지우지 않고, 디스크 확인을 기다리는 중에는 닫지 않습니다", async () => {
    const session = createPlannerSaveSession(initial);
    const pending = deferred();
    const save = session.persist(edited, () => pending.promise);
    const close = vi.fn();
    const confirm = vi.fn(async () => true);
    expect(await session.requestClose(() => edited, confirm, close)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(session.isDirty(edited)).toBe(true);
    pending.resolve();
    await save;
    expect(session.isDirty(edited)).toBe(false);
    await expect(session.persist(initial, async () => { throw Error("쓰기 실패"); })).rejects.toThrow("쓰기 실패");
    expect(session.isDirty(initial)).toBe(true);
    expect(session.isDirty(edited)).toBe(false);
  });

  it("저장하는 동안 추가한 편집은 미저장으로 남으며 이전 판으로 undo하면 저장됨입니다", async () => {
    const session = createPlannerSaveSession(initial);
    const pending = deferred();
    const save = session.persist(edited, () => pending.promise);
    const newer = patchCameraIn(edited, { fovDegrees: 90 });
    pending.resolve();
    await save;
    expect(session.isDirty(newer)).toBe(true);
    expect(session.isDirty(edited)).toBe(false);
    expect(session.isDirty(initial)).toBe(true);
  });

  it("닫기 확인을 중복으로 띄우지 않고 이전 창의 응답으로 새 창을 닫지 않습니다", async () => {
    const session = createPlannerSaveSession(initial);
    const pending = deferred();
    const confirm = vi.fn(async () => { await pending.promise; return true; });
    const close = vi.fn();
    const closing = session.requestClose(() => edited, confirm, close);
    expect(await session.requestClose(() => edited, confirm, close)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    session.reset(edited);
    pending.resolve();
    expect(await closing).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("지난 창의 늦은 저장 응답은 새 창의 저장 기준을 바꾸지 않습니다", async () => {
    const session = createPlannerSaveSession(initial);
    const pending = deferred();
    const save = session.persist(edited, () => pending.promise);
    session.reset(initial);
    pending.resolve();
    await save;
    expect(session.isDirty(initial)).toBe(false);
    expect(session.isDirty(edited)).toBe(true);
  });

  it("실제 MCP commit 뒤에는 닫기 확인이 없고 같은 세션의 undo/redo가 dirty를 바꿉니다", async () => {
    const saved = createPlannerSaveSession(initial);
    let value = initial;
    const past: typeof value[] = [];
    const future: typeof value[] = [];
    const unregister = registerCompositionSession({ projectName: "미저장 확인 시험", cutId: "cut" }, {
      read: () => ({ state: value, canUndo: !!past.length, canRedo: !!future.length, context: { characterIds: [], imageIds: [] } }),
      apply: (update) => { past.push(value); value = update(value); },
      undo: () => { future.push(value); value = past.pop()!; },
      redo: () => { past.push(value); value = future.pop()!; },
      capture: async () => ({ guide: "data:image/png;base64,Zw==", plate: "data:image/png;base64,cA==" }),
      commit: (snapshot) => saved.persist(snapshot, async () => ({ persisted: true })),
    });
    try {
      const { listCompositionSessions } = await import("@/lib/compositionControl");
      const id = listCompositionSessions().find((item) => item.projectName === "미저장 확인 시험")!.sessionId;
      const before = getCompositionSession(id);
      const after = await applyCompositionCommands({ sessionId: id, expectedRevision: before.revision, commands: [{ op: "camera.set", fovDegrees: 70 }] });
      expect(saved.isDirty(value)).toBe(true);
      await commitComposition({ sessionId: id, expectedRevision: after.revision });
      const confirm = vi.fn(async () => false);
      const close = vi.fn();
      await saved.requestClose(() => value, confirm, close);
      expect(confirm).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
      const undone = await undoComposition({ sessionId: id, expectedRevision: after.revision });
      await saved.requestClose(() => value, confirm, close);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      await redoComposition({ sessionId: id, expectedRevision: undone.revision });
      expect(saved.isDirty(value)).toBe(false);
    } finally { unregister(); }
  });
});
