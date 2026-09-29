import { afterEach, describe, expect, it } from "vitest";
import { normalizeComposition } from "./composition";
import { placeCharacterIn } from "./compositionEdit";
import { CLEANUP_SYSTEM, analyzeMotion, cleanupPrompt } from "./motionCleanup";
import { registerCompositionSession, listCompositionSessions, type CompositionSessionPort } from "./compositionControl";
import { prepareCompositionMotionCleanup, applyCompositionMotionCleanup } from "./compositionMotionCleanupControl";

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); });

describe("구도 모캡 키 AI 다듬기", () => {
  it("화면과 같은 요청을 만들고 현재 판의 결과를 앱 다듬기 함수로 반영한다", async () => {
    const keys = Array.from({ length: 20 }, (_, index) => ({ id: `key-${index}`, time: index / 24,
      value: { x: index === 10 ? 3 : index * 0.02, y: 0, z: 0 } }));
    const track = { id: "track", targetId: "person", channel: "position" as const, keys };
    let state = { ...placeCharacterIn(normalizeComposition(), "person"), motionTracks: [track] };
    const port: CompositionSessionPort = {
      read: () => ({ state, canUndo: false, canRedo: false, context: { characterIds: ["person"], characterNames: { person: "서아" } } }),
      apply: (update) => { state = update(state); }, undo: () => {}, redo: () => {},
      capture: async () => ({ guide: "", plate: "" }), commit: async () => ({ persisted: true }),
    };
    cleanups.push(registerCompositionSession({ projectName: "작품", cutId: "컷" }, port));
    const sessionId = listCompositionSessions().at(-1)!.sessionId;
    const prepared = await prepareCompositionMotionCleanup({ sessionId, expectedRevision: 0, characterId: "person" });
    const expected = cleanupPrompt(analyzeMotion([track]), { name: "서아", duration: 19 / 24, fps: 25 });
    expect(prepared.revision).toBe(0);
    expect(prepared.result).toMatchObject({ system: CLEANUP_SYSTEM, prompt: expected });
    expect(prepared.result.issueCount).toBeGreaterThan(0);
    const applied = await applyCompositionMotionCleanup({ sessionId, expectedRevision: 0, characterId: "person", mode: "auto" });
    expect(applied.revision).toBe(1);
    expect(applied.result.changedKeys).toBeGreaterThan(0);
    expect(state.motionTracks![0].keys[10].value.x).toBeLessThan(3);
  });
});
