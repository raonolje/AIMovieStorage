import { beforeEach, describe, expect, it, vi } from "vitest";
import { newBackground, newProjectDraft, type ProjectDraft } from "./projectTypes";

const state = vi.hoisted(() => ({ draft: null as ProjectDraft | null, revision: "r1", deleted: vi.fn(),
  saved: vi.fn(), safe: true, persisted: true, detected: true }));
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
vi.mock("./mediaLibrary", () => ({ assetSrc: (path: string) => path, loadImageForCanvas: async () => ({}),
  deleteProjectMediaFile: state.deleted }));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "작품" }));
vi.mock("./crossUnfold", () => ({
  looksLikeCrossUnfold: () => state.detected ? { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 1 / 3, 2 / 3, 1] } : null,
  backgroundColorOf: () => [128, 128, 128],
  cutCrossFaces: () => (["front", "back", "left", "right", "top", "bottom"] as const)
    .map((face) => ({ face, canvas: { toBlob: (resolve: (blob: Blob) => void) => resolve(new Blob([face])) } })),
  measureCrossFaces: () => [], assessCrossFaces: () => ({ safe: state.safe, issues: state.safe ? [] : ["seam"] }),
}));
vi.mock("./faceSetSave", () => ({ saveFaceSet: state.saved }));
vi.mock("@/components/project/useAutoUnfold", () => ({ autoEquirectOf: () => null }));

beforeEach(() => {
  const background = { ...newBackground(), id: "bg-1", name: "무대", generatedImages: [
    { id: "image-1", name: "무대_전개도", filePath: "C:/art/cross.png", thumb: "", file: null },
  ] };
  state.draft = { ...newProjectDraft(), title: "작품", backgrounds: [background] };
  state.revision = "r1";
  state.safe = true;
  state.persisted = true;
  state.detected = true;
  state.deleted.mockReset().mockResolvedValue(undefined);
  state.saved.mockReset().mockResolvedValue({ setIds: ["무대_001"], saved:
    (["front", "back", "left", "right", "top", "bottom"] as const)
      .map((face) => ({ face, path: `C:/art/6면/${face}.png`, name: `무대_${face}_001`, faceSet: "무대_001" })) });
});

describe("배경 전개도 조종", () => {
  it("앱과 같은 6면 세트를 저장하고 프로젝트가 확인된 뒤 전개도를 처리 완료로 표시한다", async () => {
    const { unfoldBackgroundImage } = await import("./controlBackgroundUnfold");
    const result = await unfoldBackgroundImage({ projectId: "p", expectedRevision: "r1", backgroundId: "bg-1", imageId: "image-1" });
    expect(result).toMatchObject({ persisted: true, faceSet: "무대_001", revision: "r2" });
    expect(state.draft?.backgrounds[0].generatedImages).toHaveLength(7);
    expect(state.draft?.backgrounds[0].generatedImages[0].unfoldedAt).toBeTruthy();
    expect(state.deleted).not.toHaveBeenCalled();
  });
  it("6면 안전 검사가 실패하면 폴더·프로젝트에 쓰지 않는다", async () => {
    state.safe = false;
    const { unfoldBackgroundImage } = await import("./controlBackgroundUnfold");
    await expect(unfoldBackgroundImage({ projectId: "p", expectedRevision: "r1", backgroundId: "bg-1", imageId: "image-1" }))
      .rejects.toMatchObject({ code: "unsafe_unfold" });
    expect(state.saved).not.toHaveBeenCalled();
    expect(state.draft?.backgrounds[0].generatedImages).toHaveLength(1);
  });
  it("자동 판정이 놓친 전개도는 화면처럼 경계선을 직접 지정해 자른다", async () => {
    state.detected = false;
    const { unfoldBackgroundImage } = await import("./controlBackgroundUnfold");
    const request = { projectId: "p", expectedRevision: "r1", backgroundId: "bg-1", imageId: "image-1" };
    await expect(unfoldBackgroundImage(request)).rejects.toMatchObject({ code: "not_cross_unfold" });
    const result = await unfoldBackgroundImage({ ...request,
      lines: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 1 / 3, 2 / 3, 1] } });
    expect(result).toMatchObject({ persisted: true, faceSet: "무대_001" });
  });
  it("세트가 부분 저장되면 그 파일을 거두고 원본을 그대로 둔다", async () => {
    state.saved.mockResolvedValueOnce({ setIds: ["무대_001"], saved: [{ face: "front", path: "C:/art/6면/front.png", name: "front", faceSet: "무대_001" }], stoppedBecause: "파일 충돌" });
    const { unfoldBackgroundImage } = await import("./controlBackgroundUnfold");
    await expect(unfoldBackgroundImage({ projectId: "p", expectedRevision: "r1", backgroundId: "bg-1", imageId: "image-1" }))
      .rejects.toMatchObject({ code: "face_set_incomplete" });
    expect(state.deleted).toHaveBeenCalledWith("작품", "C:/art/6면/front.png");
    expect(state.draft?.backgrounds[0].generatedImages).toHaveLength(1);
  });
  it("화면에 적용되고 디스크 확인만 실패한 경우 연결된 얼굴 파일은 지우지 않는다", async () => {
    state.persisted = false;
    const { unfoldBackgroundImage } = await import("./controlBackgroundUnfold");
    await expect(unfoldBackgroundImage({ projectId: "p", expectedRevision: "r1", backgroundId: "bg-1", imageId: "image-1" }))
      .rejects.toMatchObject({ code: "save_failed", details: { applied: true } });
    expect(state.draft?.backgrounds[0].generatedImages).toHaveLength(7);
    expect(state.deleted).not.toHaveBeenCalled();
  });
});
