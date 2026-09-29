import { beforeEach, describe, expect, it, vi } from "vitest";
import { newCharacter, newProjectDraft, type ProjectDraft } from "./projectTypes";

const state = vi.hoisted(() => ({ draft: null as ProjectDraft | null, revision: "r1", persisted: true,
  composed: vi.fn(), saved: vi.fn(), deleted: vi.fn() }));
vi.mock("./projectControl", () => ({
  ProjectControlError: class ProjectControlError extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  getProjectSnapshot: async () => ({ revision: state.revision }),
}));
vi.mock("./projectWrite", () => ({ readProject: () => state.draft,
  writeProjectAndConfirm: async (_id: string, update: (draft: ProjectDraft) => Partial<ProjectDraft>) => {
    state.draft = { ...state.draft!, ...update(state.draft!) };
    state.revision = "r2";
    return { persisted: state.persisted, draft: state.draft };
  },
}));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "작품폴더" }));
vi.mock("./mediaLibrary", () => ({ saveProjectMediaAsset: state.saved, deleteProjectMediaFile: state.deleted,
  assetSrc: (path: string) => path }));
vi.mock("./sheetCompose", () => ({ normalizeSheetSize: (size: unknown) => size,
  layoutToPx: (layout: unknown) => layout, sheetProfileBasics: () => [{ label: "이름", value: "서아" }],
  composeSheet: state.composed }));

beforeEach(() => {
  state.draft = { ...newProjectDraft(), title: "작품", characters: [{ ...newCharacter(), id: "actor", name: "서아",
    generatedImages: [{ id: "portrait", name: "서아_001", file: null, thumb: "", filePath: "C:/art/서아.png" }],
    sheetFills: { sheet: { face: "portrait" } } }],
    sheetLayouts: [{ id: "sheet", name: "전신과 얼굴", size: { width: 2048, height: 2048 }, coords: "px",
      placements: [{ id: "face", kind: "image", x: 0, y: 0, width: 1000, height: 1000 }] }] };
  state.revision = "r1";
  state.persisted = true;
  state.composed.mockReset().mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  state.saved.mockReset().mockResolvedValue({ path: "C:/art/서아_시트_001.png", name: "서아_시트_001" });
  state.deleted.mockReset().mockResolvedValue(undefined);
});

describe("시트 조종", () => {
  const request = { projectId: "p", expectedRevision: "r1", owner: { kind: "character" as const, id: "actor" },
    layoutId: "sheet", operationId: "bake-1" };
  it("앱 합성 함수를 사용하고 다시 편집할 수 있는 시트 판을 프로젝트에 남긴다", async () => {
    const { bakeControlSheet } = await import("./controlSheet");
    const result = await bakeControlSheet(request);
    expect(result).toMatchObject({ persisted: true, reused: false, revision: "r2" });
    expect(state.composed).toHaveBeenCalledWith(expect.objectContaining({
      placements: [expect.objectContaining({ id: "face", imageId: "portrait" })],
      images: [expect.objectContaining({ id: "portrait" })],
    }));
    expect(state.draft?.characters[0].generatedImages[1]).toMatchObject({
      filePath: "C:/art/서아_시트_001.png", importOperationId: "bake-1", isCompositeSheet: true,
      sheet: { layoutId: "sheet", coords: "px" },
    });
    const again = await bakeControlSheet(request);
    expect(again).toMatchObject({ reused: true, revision: "r2" });
    expect(state.saved).toHaveBeenCalledTimes(1);
  });
  it("디스크 저장 확인이 실패해도 이미 화면에 연결된 시트 파일을 지우지 않는다", async () => {
    state.persisted = false;
    const { bakeControlSheet } = await import("./controlSheet");
    await expect(bakeControlSheet(request)).rejects.toMatchObject({ code: "save_failed", details: { applied: true } });
    expect(state.deleted).not.toHaveBeenCalled();
    await expect(bakeControlSheet(request)).rejects.toMatchObject({ code: "save_failed", details: { applied: true } });
    state.persisted = true;
    await expect(bakeControlSheet(request)).resolves.toMatchObject({ reused: true, persisted: true });
    expect(state.saved).toHaveBeenCalledTimes(1);
  });
  it("누락된 이미지가 있으면 합성이나 파일 저장 전에 멈춘다", async () => {
    state.draft!.characters[0].sheetFills = { sheet: { face: "missing" } };
    const { bakeControlSheet } = await import("./controlSheet");
    await expect(bakeControlSheet(request)).rejects.toMatchObject({ code: "invalid_reference" });
    expect(state.composed).not.toHaveBeenCalled();
    expect(state.saved).not.toHaveBeenCalled();
  });
});
