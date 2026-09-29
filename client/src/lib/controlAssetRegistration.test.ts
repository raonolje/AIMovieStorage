import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  draft: null as any,
  importFile: vi.fn(),
  write: vi.fn(),
  revision: "r1",
  endFrame: vi.fn(),
}));
vi.mock("./mediaLibrary", () => ({
  assetSrc: (path: string) => `asset://${path}`,
  importProjectMediaAsset: mock.importFile,
  isVideoFile: (path: string) => /\.(mp4|mov|webm)$/i.test(path),
}));
vi.mock("./controlMedia", async (load) => {
  const { z } = await import("zod");
  return { mediaTargetSchema: z.object({ kind: z.enum(["character", "background", "cut"]), id: z.string() }).strict(),
    controlMediaTarget: (_draft: unknown, target: { id: string }) => ({ ownerName: target.id, stem: target.id, assetType: "scene-cut" }) };
});
vi.mock("./projectControl", () => ({
  ProjectControlError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  getProjectSnapshot: async () => ({ revision: mock.revision }),
  checkKoreanPrompt: (value: string) => { if (value && !/[가-힣]/.test(value)) throw Error("한글 프롬프트가 아닙니다"); },
}));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "test-project" }));
vi.mock("./projectWrite", () => ({
  readProject: () => mock.draft,
  writeProjectAndConfirm: mock.write,
}));
vi.mock("./projectTypes", () => ({ uid: () => "new-asset" }));
vi.mock("./videoEndFrame", () => ({ saveVideoEndFrame: mock.endFrame }));

import { registerControlMedia, setControlAssetPrimary } from "./controlAssetRegistration";

beforeEach(() => {
  mock.draft = { title: "Test", characters: [], backgrounds: [], scenes: [{ cuts: [{ id: "cut-1", images: [], videos: [] }] }] };
  mock.revision = "r1";
  mock.importFile.mockReset().mockResolvedValue({ path: "C:/project/result.png", name: "result" });
  mock.endFrame.mockReset().mockResolvedValue("C:/project/result_마지막프레임.png");
  mock.write.mockReset().mockImplementation(async (_id: string, update: (draft: unknown) => object) => {
    mock.draft = { ...mock.draft, ...update(mock.draft) };
    return { persisted: true };
  });
});

describe("chat asset registration", () => {
  it("영상 후보는 자동 대표가 되지 않고 명시 선택 때 마지막 프레임을 함께 저장한다", async () => {
    mock.importFile.mockResolvedValue({ path: "C:/project/result.mp4", name: "result" });
    const target = { kind: "cut", id: "cut-1" };
    const added = await registerControlMedia({ projectId: "p", expectedRevision: "r1", operationId: "movie-1",
      target, sourcePath: "C:/chat/result.mp4" });
    expect(added).toMatchObject({ primary: false });
    expect(mock.endFrame).not.toHaveBeenCalled();
    await setControlAssetPrimary({ projectId: "p", expectedRevision: "r1", target, assetId: "new-asset" });
    expect(mock.draft.scenes[0].cuts[0].videos[0]).toMatchObject({ isPrimary: true,
      endFramePath: "C:/project/result_마지막프레임.png" });
    expect(mock.endFrame).toHaveBeenCalledOnce();
  });
  it("copies a candidate once, stores its prompt, and keeps a single representative", async () => {
    const request = { projectId: "p", expectedRevision: "r1", operationId: "op-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.png", promptEn: "concert wide shot" };
    const first = await registerControlMedia(request);
    expect(first).toMatchObject({ assetId: "new-asset", persisted: true, primary: true });
    expect(mock.importFile).toHaveBeenCalledOnce();
    expect(mock.draft.scenes[0].cuts[0].images).toMatchObject([{ importOperationId: "op-1", promptEn: "concert wide shot", isPrimary: true }]);
    expect(mock.draft.scenes[0].cuts[0].promptEn).toBeUndefined();
    expect(mock.draft.scenes[0].cuts[0].promptHistory).toBeUndefined();
    expect(await registerControlMedia(request)).toMatchObject({ reused: true });
    expect(mock.importFile).toHaveBeenCalledOnce();
    expect(mock.draft.scenes[0].cuts[0].promptHistory).toBeUndefined();
  });

  it("new imported prompts preserve the earlier image and video prompt versions", async () => {
    mock.draft.scenes[0].cuts[0].promptKo = "이전 그림";
    mock.draft.scenes[0].cuts[0].promptEn = "old image";
    mock.draft.scenes[0].cuts[0].videoPromptKo = "이전 영상";
    mock.draft.scenes[0].cuts[0].videoPromptEn = "old video";
    await registerControlMedia({ projectId: "p", expectedRevision: "r1", operationId: "image-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.png", promptKo: "새 그림", promptEn: "new image" });
    await registerControlMedia({ projectId: "p", expectedRevision: "r1", operationId: "video-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.mp4", promptKo: "새 영상", promptEn: "new video" });
    const cut = mock.draft.scenes[0].cuts[0];
    expect(cut.promptHistory.map((item: { ko: string }) => item.ko)).toEqual(["새 그림", "이전 그림"]);
    expect(cut.videoPromptHistory.map((item: { ko: string }) => item.ko)).toEqual(["새 영상", "이전 영상"]);
  });

  it("selects only one primary in the target shelf", async () => {
    mock.draft.scenes[0].cuts[0].images = [{ id: "old", isPrimary: true }, { id: "new", isPrimary: false }];
    await setControlAssetPrimary({ projectId: "p", expectedRevision: "r1", target: { kind: "cut", id: "cut-1" }, assetId: "new" });
    expect(mock.draft.scenes[0].cuts[0].images.map((item: { isPrimary: boolean }) => item.isPrimary)).toEqual([false, true]);
  });
});
