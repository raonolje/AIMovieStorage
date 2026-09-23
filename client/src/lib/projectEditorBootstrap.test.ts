import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalProject } from "./localProjectStore";

const mocked = vi.hoisted(() => ({ files: vi.fn(), write: vi.fn(), settingsReady: vi.fn(), canUseFiles: vi.fn() }));
vi.mock("@/lib/projectCover", () => ({ coverOf: () => undefined }));
vi.mock("@/lib/mediaLibrary", () => ({ migrateProjectLayout: async () => new Map(), whenAppSettingsReady: mocked.settingsReady }));
vi.mock("@/lib/ownerFolders", () => ({ applyMovedPaths: (value: unknown) => value }));
vi.mock("@/lib/projectFiles", () => ({ canUseProjectFiles: mocked.canUseFiles, PROJECT_FILE_NAME: "project.json", folderOf: () => "작품", readAllProjectFiles: mocked.files, toFolderName: (value: string) => value, writeDataFile: mocked.write }));

function project(count: number): LocalProject {
  return {
    id: "same-id", title: "작품", folder: "작품", genre: "", logline: "", style: "", createdAt: "2026-01-01",
    updatedAt: `2026-09-${20 + count}`, sceneCount: count, assetCount: 0,
    draft: { title: "작품", characters: Array.from({ length: count }, (_, index) => ({ id: `actor-${index}` })), scenes: [{ id: "scene", cuts: Array.from({ length: count }, (_, index) => ({ id: `cut-${index}` })) }] },
  };
}
const diskFile = (value: LocalProject) => [{ relativePath: "작품/project.json", contents: JSON.stringify(value) }];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let values: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocked.canUseFiles.mockReturnValue(true);
  mocked.files.mockResolvedValue(diskFile(project(6)));
  mocked.settingsReady.mockResolvedValue(undefined);
  values = new Map([["frameforge.local.projects.v1", JSON.stringify([project(1)])]]);
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, setTimeout, clearTimeout });
});
afterEach(() => vi.unstubAllGlobals());

describe("직접 주소로 프로젝트를 여는 경계", () => {
  it("같은 id의 옛 localStorage가 있어도 설정과 최신 파일이 도착하기 전에는 편집 초안을 주지 않는다", async () => {
    const settings = deferred<void>();
    const files = deferred<ReturnType<typeof diskFile>>();
    mocked.settingsReady.mockReturnValue(settings.promise);
    mocked.files.mockReturnValue(files.promise);
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const { getLocalProject } = await import("./localProjectStore");
    expect(getLocalProject("same-id")?.draft.characters).toHaveLength(1);
    const opening = createProjectEditorBootstrap("same-id");
    const done = opening.start();
    expect(opening.getSnapshot()).toEqual({ status: "loading" });
    expect(mocked.files).not.toHaveBeenCalled();
    settings.resolve();
    await vi.waitFor(() => expect(mocked.files).toHaveBeenCalledTimes(1));
    expect(opening.getSnapshot()).toEqual({ status: "loading" });
    files.resolve(diskFile(project(6)));
    await done;
    const state = opening.getSnapshot();
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("읽기 미완료");
    expect(state.project.draft.characters).toHaveLength(6);
    expect(state.project.draft.scenes).toEqual(project(6).draft.scenes);
    expect(mocked.write).not.toHaveBeenCalled();
  });

  it("파일 읽기 실패는 명시 실패이며 옛 캐시를 파일로 옮기거나 성공으로 열지 않는다. 재시도는 최신 파일을 읽는다", async () => {
    mocked.files.mockRejectedValueOnce(new Error("읽기 권한 없음"));
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const opening = createProjectEditorBootstrap("same-id");
    await opening.start();
    expect(opening.getSnapshot().status).toBe("error");
    expect(mocked.write).not.toHaveBeenCalled();
    expect(values.has("frameforge.local.projects.migrated.v1")).toBe(false);
    await opening.start();
    expect(opening.getSnapshot().status).toBe("ready");
    expect(mocked.files).toHaveBeenCalledTimes(2);
  });

  it.each([{ files: [] }, { files: [{ relativePath: "작품/project.json", contents: "{깨진 파일" }] }])("없거나 깨진 대상 파일을 브라우저 사본으로 되살리지 않는다", async ({ files }) => {
    mocked.files.mockResolvedValue(files);
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const opening = createProjectEditorBootstrap("same-id");
    await opening.start();
    expect(opening.getSnapshot().status).toBe("error");
    expect(mocked.write).not.toHaveBeenCalled();
    expect(values.has("frameforge.local.projects.migrated.v1")).toBe(false);
  });

  it("다른 작품의 손상 파일은 읽을 수 있는 대상 작품을 막지 않는다", async () => {
    mocked.files.mockResolvedValue([...diskFile(project(6)), { relativePath: "다른 작품/project.json", contents: "{" }]);
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const opening = createProjectEditorBootstrap("same-id");
    await opening.start();
    expect(opening.getSnapshot().status).toBe("ready");
  });

  it("편집 시작 뒤의 재렌더·재시작 요청은 다시 읽지 않고 실시간 수동 변경을 우선한다", async () => {
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const { loadProjects } = await import("./localProjectStore");
    const { registerProjectTarget, readProject } = await import("./projectWrite");
    const { newProjectDraft } = await import("./projectTypes");
    const opening = createProjectEditorBootstrap("same-id");
    await opening.start();
    const ready = opening.getSnapshot();
    if (ready.status !== "ready") throw new Error("읽기 미완료");
    let editing = { ...newProjectDraft(), ...ready.project.draft };
    const unregister = registerProjectTarget("same-id", update => { editing = { ...editing, ...update(editing) }; }, () => editing);
    editing = { ...editing, title: "사용자가 방금 쓴 제목" };
    await opening.start();
    expect(mocked.files).toHaveBeenCalledTimes(1);
    // MCP 목록 갱신으로 디스크 캐시가 다시 채워져도 열린 편집 대상은 유지합니다.
    await loadProjects();
    expect(readProject("same-id")?.title).toBe("사용자가 방금 쓴 제목");
    expect(readProject("same-id")?.characters).toHaveLength(6);
    expect(opening.getSnapshot()).toBe(ready);
    expect(mocked.write).not.toHaveBeenCalled();
    unregister();
  });

  it("경로를 떠난 뒤 늦게 도착한 읽기 결과로 이전 편집기를 열지 않는다", async () => {
    const files = deferred<ReturnType<typeof diskFile>>();
    mocked.files.mockReturnValue(files.promise);
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const opening = createProjectEditorBootstrap("same-id");
    const listener = vi.fn();
    opening.subscribe(listener);
    const done = opening.start();
    opening.cancel();
    listener.mockClear();
    files.resolve(diskFile(project(6)));
    await done;
    expect(opening.getSnapshot().status).toBe("loading");
    expect(listener).not.toHaveBeenCalled();
  });

  it("파일 저장을 쓰지 않는 기존 브라우저 모드는 localStorage 프로젝트를 계속 연다", async () => {
    mocked.canUseFiles.mockReturnValue(false);
    const { createProjectEditorBootstrap } = await import("./projectEditorBootstrap");
    const opening = createProjectEditorBootstrap("same-id");
    await opening.start();
    expect(opening.getSnapshot().status).toBe("ready");
    expect(mocked.files).not.toHaveBeenCalled();
  });
});
