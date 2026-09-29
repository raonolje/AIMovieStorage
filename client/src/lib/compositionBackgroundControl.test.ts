import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeComposition } from "./composition";
import { getCompositionSession, listCompositionSessions, registerCompositionSession } from "./compositionControl";
import { importCompositionBackground } from "./compositionBackgroundControl";

const files = vi.hoisted(() => ({ copy: vi.fn(), remove: vi.fn() }));
vi.mock("./mediaLibrary", () => ({ PANORAMA_DIR: "파노라마", assetSrc: (path: string) => `asset://${path}`,
  importProjectMediaAsset: files.copy, deleteProjectMediaFile: files.remove }));

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; files.copy.mockReset(); files.remove.mockReset(); });

describe("구도 배경 가져오기", () => {
  it("파노라마는 전용 폴더에 복사하고 재요청은 기존 항목을 고른다", async () => {
    let state = normalizeComposition();
    cleanup = registerCompositionSession({ projectName: "작품", cutId: "컷", sceneTitle: "무대" }, {
      read: () => ({ state, canUndo: false, canRedo: false, context: { characterIds: [] } }),
      apply: (updater) => { state = updater(state); },
      undo: () => {}, redo: () => {},
      capture: async () => ({ guide: "", plate: "" }), commit: async () => ({ persisted: true }),
    });
    const sessionId = listCompositionSessions().at(-1)!.sessionId;
    files.copy.mockResolvedValue({ path: "C:/project/파노라마/stage_001.png", name: "stage_001" });
    const first = await importCompositionBackground({ sessionId, expectedRevision: 0, sourcePath: "C:/Downloads/stage.png", kind: "panorama" });
    expect(first.result).toMatchObject({ reused: false, path: "C:/project/파노라마/stage_001.png" });
    expect(files.copy).toHaveBeenCalledWith("C:/Downloads/stage.png", expect.objectContaining({ subdir: "파노라마" }));
    expect(state.customBackgrounds).toHaveLength(1);
    expect(state.panoramaId).toBe(state.customBackgrounds[0].id);
    const second = await importCompositionBackground({ sessionId, expectedRevision: first.revision,
      sourcePath: "C:/Downloads/stage.png", kind: "panorama" });
    expect(second.result).toMatchObject({ reused: true, id: first.result.id });
    expect(files.copy).toHaveBeenCalledOnce();
    expect(getCompositionSession(sessionId).state.customBackgrounds).toHaveLength(1);
  });
});
