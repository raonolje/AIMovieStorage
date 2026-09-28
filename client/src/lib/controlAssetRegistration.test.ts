import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  draft: null as any,
  importFile: vi.fn(),
  write: vi.fn(),
  revision: "r1",
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
}));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "test-project" }));
vi.mock("./projectWrite", () => ({
  readProject: () => mock.draft,
  writeProjectAndConfirm: mock.write,
}));
vi.mock("./projectTypes", () => ({ uid: () => "new-asset" }));

import { registerControlMedia, setControlAssetPrimary } from "./controlAssetRegistration";

beforeEach(() => {
  mock.draft = { title: "Test", characters: [], backgrounds: [], scenes: [{ cuts: [{ id: "cut-1", images: [], videos: [] }] }] };
  mock.revision = "r1";
  mock.importFile.mockReset().mockResolvedValue({ path: "C:/project/result.png", name: "result" });
  mock.write.mockReset().mockImplementation(async (_id: string, update: (draft: unknown) => object) => {
    mock.draft = { ...mock.draft, ...update(mock.draft) };
    return { persisted: true };
  });
});

describe("chat asset registration", () => {
  it("copies a candidate once, stores its prompt, and keeps a single representative", async () => {
    const request = { projectId: "p", expectedRevision: "r1", operationId: "op-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.png", promptEn: "concert wide shot" };
    const first = await registerControlMedia(request);
    expect(first).toMatchObject({ assetId: "new-asset", persisted: true, primary: true });
    expect(mock.importFile).toHaveBeenCalledOnce();
    expect(mock.draft.scenes[0].cuts[0].images).toMatchObject([{ importOperationId: "op-1", promptEn: "concert wide shot", isPrimary: true }]);
    expect(mock.draft.scenes[0].cuts[0].promptEn).toBe("concert wide shot");
    expect(await registerControlMedia(request)).toMatchObject({ reused: true });
    expect(mock.importFile).toHaveBeenCalledOnce();
  });

  it("selects only one primary in the target shelf", async () => {
    mock.draft.scenes[0].cuts[0].images = [{ id: "old", isPrimary: true }, { id: "new", isPrimary: false }];
    await setControlAssetPrimary({ projectId: "p", expectedRevision: "r1", target: { kind: "cut", id: "cut-1" }, assetId: "new" });
    expect(mock.draft.scenes[0].cuts[0].images.map((item: { isPrimary: boolean }) => item.isPrimary)).toEqual([false, true]);
  });
});
