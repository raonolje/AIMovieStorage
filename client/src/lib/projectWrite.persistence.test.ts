import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ write: vi.fn(), files: vi.fn() }));
vi.mock("@/lib/projectCover", () => ({ coverOf: () => undefined }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/mediaLibrary", () => ({ migrateProjectLayout: async () => new Map(), whenAppSettingsReady: async () => {} }));
vi.mock("@/lib/ownerFolders", () => ({ applyMovedPaths: (value: unknown) => value }));
vi.mock("@/lib/projectMigrate", () => ({ PROJECT_SCHEMA_VERSION: 1, migrateSavedProject: (value: unknown) => value, schemaVersionOf: (value: { schemaVersion?: number }) => value?.schemaVersion ?? 0 }));
vi.mock("@/lib/projectFiles", () => ({ canUseProjectFiles: () => true, PROJECT_FILE_NAME: "project.json", folderOf: () => "작품", readAllProjectFiles: mocked.files, toFolderName: (value: string) => value, writeDataFile: mocked.write }));
vi.mock("@/lib/projectTypes", () => ({ newProjectDraft: () => ({}), settleLoading: (value: unknown) => value }));

const original = { id: "p", title: "작품", folder: "작품", createdAt: "2026-01-01", updatedAt: "2026-01-01", draft: { title: "작품", scenes: [{ cuts: [{ id: "c" }] }] } };
const edited = { ...original.draft, title: "고친 작품" };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetModules();
  mocked.write.mockReset();
  mocked.files.mockResolvedValue([{ relativePath: "작품/project.json", contents: JSON.stringify(original) }]);
  const values = new Map<string, string>([["frameforge.local.projects.migrated.v1", "1"]]);
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, setTimeout, clearTimeout });
});

describe("저장 완료 응답", () => {
  it("새 프로젝트의 첫 저장이 실패해도 같은 내용으로 파일 저장을 다시 시도한다", async () => {
    mocked.write.mockRejectedValueOnce(new Error("첫 쓰기 실패")).mockResolvedValue({ written: true });
    const store = await import("@/lib/localProjectStore");
    await store.loadProjects();
    expect((await store.saveLocalProjectAndConfirm(edited, "new-project")).outcome).toBe("error");
    expect((await store.saveLocalProjectAndConfirm(edited, "new-project")).outcome).toBe("written");
    expect(mocked.write).toHaveBeenCalledTimes(2);
  });

  it("대상 삭제 등 갱신 오류는 React 계산 밖의 호출자에게 돌려준다", async () => {
    const store = await import("@/lib/localProjectStore");
    const writer = await import("@/lib/projectWrite");
    await store.loadProjects();
    const draft = original.draft as never;
    const unregister = writer.registerProjectTarget("p", (update) => {
      expect(() => update(draft)).not.toThrow();
    }, () => draft);
    await expect(writer.writeProjectAndConfirm("p", () => { throw new Error("대상이 삭제됐습니다"); })).rejects.toThrow("대상이 삭제");
    expect(mocked.write).not.toHaveBeenCalled();
    unregister();
  });

  it("같은 내용의 두 번째 저장도 첫 파일 쓰기의 실패를 기다린다", async () => {
    const g = gate();
    mocked.write.mockImplementation(async () => { await g.promise; throw new Error("파일 권한 없음"); });
    const store = await import("@/lib/localProjectStore");
    await store.loadProjects();
    const first = store.saveLocalProjectAndConfirm(edited, "p");
    await tick();
    let secondDone = false;
    const second = store.saveLocalProjectAndConfirm(edited, "p").then((value) => { secondDone = true; return value; });
    await tick();
    expect(secondDone).toBe(false);
    g.resolve();
    expect((await first).outcome).toBe("error");
    expect((await second).outcome).toBe("error");
    expect(store.getLocalProject("p")?.draft.title).toBe("작품");
    expect(mocked.write).toHaveBeenCalledTimes(1);
  });

  it("같은 내용의 두 저장은 파일 쓰기 하나를 함께 기다린다", async () => {
    const g = gate();
    mocked.write.mockImplementation(async () => { await g.promise; return { written: true }; });
    const store = await import("@/lib/localProjectStore");
    await store.loadProjects();
    const first = store.saveLocalProjectAndConfirm(edited, "p");
    const second = store.saveLocalProjectAndConfirm(edited, "p");
    g.resolve();
    expect((await first).outcome).toBe("written");
    expect((await second).outcome).toBe("written");
    expect(mocked.write).toHaveBeenCalledTimes(1);
  });

  it("열린 화면에 적용해도 실제 파일 결과 전에는 외부 저장 성공을 주지 않는다", async () => {
    const g = gate();
    mocked.write.mockImplementation(async () => { await g.promise; return { written: true }; });
    const store = await import("@/lib/localProjectStore");
    const writer = await import("@/lib/projectWrite");
    await store.loadProjects();
    let live = original.draft as never;
    const unregister = writer.registerProjectTarget("p", (update) => { live = { ...live, ...update(live) } as never; }, () => live);
    let done = false;
    const changed = writer.writeProjectAndConfirm("p", () => ({ title: "고친 작품" })).then((value) => { done = true; return value; });
    await tick();
    expect(done).toBe(false);
    g.resolve();
    expect(await changed).toMatchObject({ persisted: true, outcome: "written", draft: { title: "고친 작품" } });
    unregister();
  });

  it("열린 화면 파일 쓰기가 실패하면 적용됨과 저장 실패를 구분한다", async () => {
    mocked.write.mockRejectedValue(new Error("파일 권한 없음"));
    const store = await import("@/lib/localProjectStore");
    const writer = await import("@/lib/projectWrite");
    await store.loadProjects();
    let live = original.draft as never;
    const unregister = writer.registerProjectTarget("p", (update) => { live = { ...live, ...update(live) } as never; }, () => live);
    expect(await writer.writeProjectAndConfirm("p", () => ({ title: "고친 작품" }))).toMatchObject({ persisted: false, outcome: "error", draft: { title: "고친 작품" } });
    unregister();
  });
});
