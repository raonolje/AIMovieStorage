import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const port = vi.hoisted(() => ({ files: vi.fn(), write: vi.fn(), enabled: true }));
vi.mock("./projectCover", () => ({ coverOf: () => undefined }));
vi.mock("./mediaLibrary", () => ({ migrateProjectLayout: async () => new Map(), whenAppSettingsReady: async () => {} }));
vi.mock("./ownerFolders", () => ({ applyMovedPaths: (value: unknown) => value }));
vi.mock("./projectFiles", () => ({ canUseProjectFiles: () => port.enabled, PROJECT_FILE_NAME: "project.json",
  folderOf: () => "작품", readAllProjectFiles: port.files, toFolderName: (name: string) => name, writeDataFile: port.write }));
const STORAGE = "frameforge.local.projects.v1", MIGRATED = "frameforge.local.projects.migrated.v1";
const project = { id: "p", title: "작품", folder: "작품", createdAt: "2026-01-01", updatedAt: "2026-01-01", schemaVersion: 1,
  draft: { title: "작품", scenes: [{ cuts: [{ id: "cut", composition: { motionTracks: [{ keys: Array.from({ length: 1500 }, (_, time) => ({ time, bones: { Head: { x: 0, y: 1, z: 0 } } })) }] } }] }] } };
let values: Map<string, string>;
let writes: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  port.enabled = true;
  port.files.mockReset().mockResolvedValue([{ relativePath: "작품/project.json", contents: JSON.stringify(project) }]);
  port.write.mockReset().mockResolvedValue({ written: true });
  values = new Map([[STORAGE, JSON.stringify([{ ...project, title: "이전 거울" }])], [MIGRATED, "1"]]);
  writes = vi.fn((key: string, value: string) => values.set(key, value));
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: writes } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("파일 이행 후 브라우저 거울", () => {
  it("파일 읽기·저장·실패 복구에서 큰 프로젝트 목록을 다시 stringify하거나 localStorage에 쓰지 않는다", async () => {
    const previous = values.get(STORAGE);
    const store = await import("./localProjectStore");
    const stringify = vi.spyOn(JSON, "stringify");
    await store.loadProjects();
    await store.saveLocalProjectAndConfirm({ ...project.draft, title: "새 제목" }, "p");
    port.write.mockRejectedValueOnce(new Error("디스크 쓰기 실패"));
    expect((await store.saveLocalProjectAndConfirm({ ...project.draft, title: "실패한 제목" }, "p")).outcome).toBe("error");
    expect(store.getLocalProject("p")?.draft.title).toBe("새 제목");
    expect(writes).not.toHaveBeenCalledWith(STORAGE, expect.anything());
    expect(stringify.mock.calls.filter(([arg]) => Array.isArray(arg) && arg.some(item => item?.draft))).toHaveLength(0);
    expect(values.get(STORAGE)).toBe(previous);
  });

  it("폴더를 쓰지 않는 브라우저는 전체 초안을 거울에 저장하고 다시 읽는다", async () => {
    port.enabled = false;
    const store = await import("./localProjectStore");
    await store.loadProjects();
    const saved = await store.saveLocalProjectAndConfirm({ ...project.draft, title: "브라우저 편집" }, "p");
    expect(saved.outcome).toBe("written");
    expect(JSON.parse(values.get(STORAGE)!)[0].draft).toEqual({ ...project.draft, title: "브라우저 편집" });
    expect(port.write).not.toHaveBeenCalled();
    vi.resetModules();
    const again = await import("./localProjectStore");
    expect((await again.loadProjects())[0].draft.title).toBe("브라우저 편집");
  });

  it("최초 이행은 기존 거울을 파일로 옮기고 거울 원본은 덮지 않는다", async () => {
    values.delete(MIGRATED);
    port.files.mockResolvedValue([]);
    const previous = values.get(STORAGE);
    const store = await import("./localProjectStore");
    await store.loadProjects();
    expect(port.write).toHaveBeenCalledOnce();
    expect(JSON.parse(port.write.mock.calls[0][1]).draft).toEqual(project.draft);
    expect(values.has(MIGRATED)).toBe(true);
    expect(values.get(STORAGE)).toBe(previous);
  });

  it("파일 본문은 공백 없는 같은 스키마이며 동일 저장은 다시 쓰지 않고 CAS 기준을 유지한다", async () => {
    const store = await import("./localProjectStore");
    await store.loadProjects();
    const stringify = vi.spyOn(JSON, "stringify");
    const changed = { ...project.draft, title: "압축 저장", preview: "blob:temporary", file: new File(["영상"], "reference.mp4") };
    const saved = await store.saveLocalProjectAndConfirm(changed, "p");
    expect(saved.outcome).toBe("written");
    expect(port.write.mock.calls[0][2]).toBe(project.updatedAt);
    const contents = port.write.mock.calls[0][1] as string;
    const parsed = JSON.parse(contents);
    expect(parsed).toEqual(saved.project);
    expect(parsed.draft).toEqual({ ...project.draft, title: "압축 저장" });
    expect(contents).not.toContain("\n");
    expect(stringify.mock.calls).toHaveLength(1);
    expect(stringify.mock.calls[0]).toEqual([saved.project]);
    expect((await store.saveLocalProjectAndConfirm(changed, "p")).outcome).toBe("same");
    expect(port.write).toHaveBeenCalledOnce();
    expect(stringify.mock.calls).toHaveLength(1);
  });
});
