import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompositionState, MotionChannel } from "./composition";
import type { ProjectDraft } from "./projectTypes";

const port = vi.hoisted(() => ({ write: vi.fn(), files: vi.fn(), available: true }));
vi.mock("./mediaLibrary", () => ({ migrateProjectLayout: async () => new Map(), whenAppSettingsReady: async () => {} }));
vi.mock("./ownerFolders", () => ({ applyMovedPaths: (value: unknown) => value }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./projectFiles", () => ({
  canUseProjectFiles: () => port.available, PROJECT_FILE_NAME: "project.json",
  folderOf: (file: { relativePath: string }) => file.relativePath.split("/")[0],
  readAllProjectFiles: port.files, toFolderName: (name: string) => name, writeDataFile: port.write,
}));

let disk: Map<string, string>;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetModules();
  disk = new Map();
  port.available = true;
  port.write.mockReset().mockImplementation(async (path: string, contents: string) => {
    disk.set(path, contents);
    return { written: true };
  });
  port.files.mockReset().mockImplementation(async () => [...disk].map(([relativePath, contents]) => ({ relativePath, contents })));
  const values = new Map([["frameforge.local.projects.migrated.v1", "1"]]);
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }, setTimeout, clearTimeout });
});

async function fixture(saved: boolean) {
  const { newProjectDraft, newScene, newCut } = await import("./projectTypes");
  const { normalizeComposition, normalizeCompositionRoom } = await import("./composition");
  const store = await import("./localProjectStore");
  const writer = await import("./projectWrite");
  const { commitOpenProjectChange } = await import("./projectCommit");
  const { cutCompositionPatch } = await import("./cutCompositionSave");
  let live = { ...newProjectDraft(), title: "큰 구도 저장 시험", scenes: [{ ...newScene(), id: "scene", cuts: [{ ...newCut(1), id: "cut", refVideoPath: "작품/레퍼런스.mp4" }] }] };
  let id: string | undefined;
  if (saved) {
    id = "saved-project";
    disk.set("큰 구도 저장 시험/project.json", JSON.stringify({ id, title: live.title, folder: live.title, createdAt: "2026-01-01", updatedAt: "2026-01-01", schemaVersion: 1, draft: live }));
  }
  await store.loadProjects();
  const key = id ?? "새 프로젝트";
  let apply: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void = update => { live = { ...live, ...update(live) }; };
  const unregister = writer.registerProjectTarget(key, update => apply(update), () => live);
  const composition: CompositionState = normalizeComposition({
    rooms: [normalizeCompositionRoom({ id: "room", width: 14, depth: 9, height: 7 })],
    camera: { position: { x: 7, y: 3, z: 5 }, target: { x: 1, y: 2, z: 0 }, fovDegrees: 53 },
    motionTracks: (["position", "rotation", "pose"] as MotionChannel[]).map(channel => ({
      id: channel, targetId: "mannequin", channel, sourceId: "capture", sourceName: "12초 모캡",
      keys: Array.from({ length: 360 }, (_, index) => ({
        id: `${channel}-${index}`, time: index / 30, value: { x: index / 17, y: 2, z: -index / 31 },
        ...(channel === "pose" ? { bones: Object.fromEntries(Array.from({ length: 60 }, (_, joint) => [`관절-${joint}`, { x: index / 360, y: joint / 60, z: index / 720 }])) } : {}),
      })),
    })),
  });
  const owner = { targetKey: () => key, projectId: () => id, adoptId: (value: string) => { id = value; } };
  return { store, writer, owner, composition, unregister, cutCompositionPatch,
    id: () => id, live: () => live,
    delayApply: (next: typeof apply) => { apply = next; },
    setLive: (next: ProjectDraft) => { live = next; },
    commit: (update: (draft: ProjectDraft) => Partial<ProjectDraft>) => commitOpenProjectChange(owner, update),
    save: () => commitOpenProjectChange(owner, current => cutCompositionPatch(current, "cut", composition)),
  };
}

describe("구도 원본의 파일 저장", () => {
  it.each([false, true])("저장된 프로젝트=%s: 360키 × 3채널을 파일에서 다시 읽어도 보존한다", async saved => {
    const f = await fixture(saved);
    // 브라우저 거울 용량이 차도 프로젝트 JSON에는 전체 모캡을 쓸 수 있어야 합니다.
    window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(await f.save()).toEqual({ projectId: f.id(), persisted: true });
    await f.commit(current => f.cutCompositionPatch(current, "cut", f.composition, { guideImagePath: "작품/구도.png", plateImagePath: "작품/배경.png" }));
    const raw = [...disk.values()][0];
    expect(raw.length).toBeGreaterThan(1_000_000);
    expect(disk.size).toBe(1);
    f.unregister();
    vi.resetModules();
    const reloadedStore = await import("./localProjectStore");
    await reloadedStore.loadProjects();
    const { settleLoading, newProjectDraft } = await import("./projectTypes");
    const { normalizeComposition } = await import("./composition");
    const reopened = settleLoading({ ...newProjectDraft(), ...reloadedStore.getLocalProject(f.id()!)!.draft });
    const cut = reopened.scenes[0].cuts[0];
    expect(cut).toMatchObject({ refVideoPath: "작품/레퍼런스.mp4", guideImagePath: "작품/구도.png", plateImagePath: "작품/배경.png" });
    const restored = normalizeComposition(cut.composition);
    expect(restored.motionTracks.map(track => track.keys.length)).toEqual([360, 360, 360]);
    // JSON은 -0을 0으로 바꾸므로 저장 형식의 동일성을 비교합니다.
    expect(JSON.stringify(restored.motionTracks) === JSON.stringify(f.composition.motionTracks)).toBe(true);
    expect(restored.rooms).toEqual(f.composition.rooms);
    expect(restored.camera).toEqual(f.composition.camera);
  });

  it("파일 저장이 끝나기 전에는 닫아도 된다는 응답을 하지 않는다", async () => {
    const f = await fixture(true), pending = gate();
    port.write.mockImplementation(async (path: string, contents: string) => { await pending.promise; disk.set(path, contents); return { written: true }; });
    let done = false;
    const saving = f.save().then(value => { done = true; return value; });
    await tick();
    expect(done).toBe(false);
    expect(f.live().scenes[0].cuts[0].composition).toBe(f.composition);
    pending.resolve();
    expect(await saving).toMatchObject({ persisted: true });
    f.unregister();
  });

  it("파일 쓰기가 실패하면 성공으로 닫지 않고 오류를 돌려준다", async () => {
    const f = await fixture(true);
    port.write.mockRejectedValue(new Error("파일 권한 없음"));
    await expect(f.save()).rejects.toThrow("파일 저장을 확인하지 못했습니다");
    expect(f.live().scenes[0].cuts[0].composition).toBe(f.composition);
    expect(JSON.parse([...disk.values()][0]).draft.scenes[0].cuts[0].composition).toBeUndefined();
    f.unregister();
  });

  it("자동 저장이 먼저 만든 프로젝트 ID를 이어받아 복제하지 않는다", async () => {
    const f = await fixture(false);
    let apply!: (current: ProjectDraft) => Partial<ProjectDraft>;
    f.delayApply(update => { apply = update; });
    const saving = f.save();
    await tick();
    const autosaved = f.store.saveLocalProject(f.live());
    f.owner.adoptId(autosaved.id);
    f.setLive({ ...f.live(), ...apply(f.live()) });
    expect(await saving).toEqual({ projectId: autosaved.id, persisted: true });
    expect(disk.size).toBe(1);
    f.unregister();
  });

  it("제목이나 저장 폴더가 없으면 명시적으로 멈춘다", async () => {
    const f = await fixture(false);
    f.setLive({ ...f.live(), title: " " });
    await expect(f.save()).rejects.toThrow("프로젝트 제목");
    f.setLive({ ...f.live(), title: "작품" });
    port.available = false;
    await expect(f.save()).rejects.toThrow("저장할 폴더");
    expect(port.write).not.toHaveBeenCalled();
    f.unregister();
  });

  it("캡처 중 삭제된 컷을 되살리지 않으며 다른 최신 편집을 지키며 저장한다", async () => {
    const f = await fixture(true);
    f.setLive({ ...f.live(), logline: "저장 직전 사람이 수정함" });
    await f.save();
    expect(JSON.parse([...disk.values()][0]).draft.logline).toBe("저장 직전 사람이 수정함");
    f.setLive({ ...f.live(), scenes: f.live().scenes.map(scene => ({ ...scene, cuts: [] })) });
    await expect(f.save()).rejects.toThrow("컷이 삭제");
    expect(f.live().scenes[0].cuts).toEqual([]);
    f.unregister();
  });
});
