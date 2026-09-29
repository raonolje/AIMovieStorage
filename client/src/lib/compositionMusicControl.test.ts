import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeComposition } from "./composition";
import { registerCompositionSession, getCompositionSession, listCompositionSessions, type CompositionSessionPort } from "./compositionControl";

const mocks = vi.hoisted(() => ({ choices: vi.fn(), seconds: vi.fn() }));
vi.mock("./bgmLibrary", () => ({ listBgmChoices: mocks.choices }));
vi.mock("./audioDuration", () => ({ measureAudioSeconds: mocks.seconds }));

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.resetAllMocks(); });

function opened() {
  let state = normalizeComposition();
  const port: CompositionSessionPort = {
    read: () => ({ state, canUndo: false, canRedo: false,
      context: { characterIds: [], musicPaths: ["BGM/곡/무대.wav"] } }),
    apply: (update) => { state = update(state); }, undo: () => {}, redo: () => {},
    capture: async () => ({ guide: "", plate: "" }), commit: async () => ({ persisted: true }),
  };
  cleanups.push(registerCompositionSession({ projectName: "작품", cutId: "컷" }, port));
  const sessionId = listCompositionSessions().at(-1)!.sessionId;
  return { sessionId, state: () => state };
}

describe("구도 음악 조종", () => {
  it("LLM이 초를 적지 않고 실제 음원 길이를 읽은 뒤 한 번 저장한다", async () => {
    const f = opened();
    mocks.choices.mockReturnValue([{ path: "BGM/곡/무대.wav", trackName: "무대" }]);
    mocks.seconds.mockResolvedValue(69.24);
    const { useCompositionBgm } = await import("./compositionMusicControl");
    const result = await useCompositionBgm({ sessionId: f.sessionId, expectedRevision: 0, path: "BGM/곡/무대.wav" });
    expect(result.revision).toBe(1);
    expect(result.result).toMatchObject({ seconds: 69.24 });
    expect(f.state().timeline?.music).toMatchObject({ path: "BGM/곡/무대.wav", seconds: 69.24 });
  });
  it("등록되지 않았거나 길이를 읽지 못한 음원은 구도를 바꾸지 않는다", async () => {
    const f = opened();
    mocks.choices.mockReturnValue([{ path: "BGM/곡/무대.wav", trackName: "무대" }]);
    const { useCompositionBgm } = await import("./compositionMusicControl");
    await expect(useCompositionBgm({ sessionId: f.sessionId, expectedRevision: 0, path: "C:/other.mp3" }))
      .rejects.toMatchObject({ code: "invalid_asset" });
    mocks.seconds.mockRejectedValue(new Error("읽기 실패"));
    await expect(useCompositionBgm({ sessionId: f.sessionId, expectedRevision: 0, path: "BGM/곡/무대.wav" }))
      .rejects.toMatchObject({ code: "invalid_audio" });
    expect(getCompositionSession(f.sessionId).revision).toBe(0);
    expect(f.state().timeline?.music).toBeFalsy();
  });
});
