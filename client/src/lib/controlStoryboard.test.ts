import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, newScene, newCut, type ProjectDraft } from "./projectTypes";

const state = vi.hoisted(() => ({ draft: null as ProjectDraft | null, revision: "r1", deleted: vi.fn() }));
vi.mock("./projectControl", () => ({
  ProjectControlError: class ProjectControlError extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  getProjectSnapshot: async () => ({ revision: state.revision }),
}));
vi.mock("./projectWrite", () => ({
  readProject: () => state.draft,
  writeProjectAndConfirm: async (_id: string, update: (draft: ProjectDraft) => Partial<ProjectDraft>) => {
    state.draft = { ...state.draft!, ...update(state.draft!) };
    state.revision = "r2";
    return { persisted: true };
  },
}));
vi.mock("./mediaLibrary", () => ({
  deleteProjectMediaFile: state.deleted,
  fileStem: (value: string) => value.split("/").pop()?.replace(/\.[^.]+$/, "") || "",
  safeFileName: (value: string) => value,
  saveProjectMediaAsset: async () => ({ path: "작품/장면/시트.png" }),
}));
vi.mock("./storyboardSheet", () => ({
  storyboardCells: (scene: { cuts: unknown[] }) => scene.cuts.map((cut) => ({ cut })),
  composeStoryboard: async () => ({ blob: new Blob(["image"], { type: "image/png" }) }),
  buildStoryboardVideoPrompt: () => ({ ko: "컷 순서대로 인물을 비춥니다.", en: "Follow the cuts in order.", seconds: 8, clamped: false }),
}));
vi.mock("./storyboardPromptRequest", () => ({ storyboardLockNames: () => [], storyboardSwaps: () => [] }));
vi.mock("./storyboardPromptHistory", () => ({ withStoryboardPrompt: (_scene: unknown, prompt: { ko: string; en: string }) => ({ storyboardPromptKo: prompt.ko, storyboardPromptEn: prompt.en }) }));

beforeEach(() => {
  const scene = { ...newScene(), id: "scene", title: "무대", cuts: [{ ...newCut(1), id: "cut" }] };
  state.draft = { ...newProjectDraft(), title: "작품", scenes: [scene] };
  state.revision = "r1";
  state.deleted.mockReset();
});

describe("스토리보드 대화 조종", () => {
  it("화면과 같은 컷 시트를 굽고 한영 영상 프롬프트를 함께 저장한다", async () => {
    const { bakeControlStoryboard } = await import("./controlStoryboard");
    const result = await bakeControlStoryboard({ projectId: "p", sceneId: "scene", expectedRevision: "r1" });
    expect(result).toMatchObject({ persisted: true, storyboardPath: "작품/장면/시트.png", cellCount: 1, revision: "r2" });
    expect(state.draft?.scenes[0]).toMatchObject({ storyboardPromptKo: "컷 순서대로 인물을 비춥니다.", storyboardPromptEn: "Follow the cuts in order." });
    expect(state.deleted).not.toHaveBeenCalled();
  });
});
