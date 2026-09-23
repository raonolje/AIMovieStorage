import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, newCharacter, newScene, newCut, type ProjectDraft } from "@/lib/projectTypes";
import { normalizeComposition } from "./composition";

const state = vi.hoisted(() => ({ projects: new Map<string, { id: string; draft: ProjectDraft }>(), fail: false, beforeWrite: null as (() => void) | null, persistGate: null as Promise<void> | null, loads: vi.fn() }));
vi.mock("@/lib/localProjectStore", () => ({
  loadProjects: async () => { state.loads(); return [...state.projects.values()]; },
  listLocalProjects: () => [...state.projects.values()].map((item) => ({ id: item.id, title: item.draft.title })),
  getLocalProject: (id: string) => state.projects.get(id) ?? null,
  saveLocalProjectAndConfirm: async (draft: ProjectDraft, id: string) => {
    if (state.fail) return { project: { id, draft }, outcome: "error" };
    const project = { id, draft: JSON.parse(JSON.stringify(draft)) as ProjectDraft };
    state.projects.set(id, project);
    return { project, outcome: "written" };
  },
}));
vi.mock("@/lib/projectWrite", () => ({
  readProject: (id: string) => state.projects.get(id)?.draft ?? null,
  writeProjectAndConfirm: async (id: string, update: (current: ProjectDraft) => Partial<ProjectDraft>) => {
    state.beforeWrite?.();
    const item = state.projects.get(id)!;
    item.draft = { ...item.draft, ...update(item.draft) };
    const applied = item.draft;
    if (state.persistGate) await state.persistGate;
    return { draft: applied, persisted: !state.fail, outcome: state.fail ? "error" : "written", why: state.fail ? "파일 저장 실패" : undefined };
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.projects.clear();
  state.fail = false;
  state.beforeWrite = null;
  state.persistGate = null;
  state.loads.mockClear();
  state.projects.set("p", { id: "p", draft: { ...newProjectDraft(), title: "작품" } });
});
const current = () => state.projects.get("p")!.draft;
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("프로젝트 대화 조종", () => {
  it("5인 긴 구도는 요약 조회·수정에서 키를 줄이되 원본 키와 전체 리비전 검사를 유지한다", async () => {
    const api = await import("./projectControl");
    const composition = normalizeComposition();
    composition.motionTracks = Array.from({ length: 5 }, (_, person) => ({ id: `track-${person}`, targetId: `actor-${person}`, channel: "pose" as const,
      keys: Array.from({ length: 1983 }, (_, frame) => ({ id: `key-${person}-${frame}`, time: frame / 30, value: { x: 0, y: 0, z: 0 } })) }));
    current().characters = Array.from({ length: 5 }, (_, person) => ({ ...newCharacter(), id: `actor-${person}`, name: `인물 ${person}` }));
    current().scenes = [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k", composition, guideImage: `data:image/png;base64,${"A".repeat(100_000)}` }] }];
    const first = await api.getProjectSnapshot("p", "summary");
    expect(first.draft.characters.map(actor => actor.id)).toEqual(current().characters.map(actor => actor.id));
    expect(first.draft.scenes[0]).toMatchObject({ id: "s", cuts: [{ id: "k", guideImage: "" }] });
    expect(first.draft.scenes[0].cuts[0].composition?.motionTracks).toHaveLength(5);
    expect(first.draft.scenes[0].cuts[0].composition?.motionTracks?.[0]).toMatchObject({ keys: [], keyCount: 1983, keyTimeRange: [0, 1982 / 30] });
    expect(first.projection.truncated).toBe(true);
    expect(JSON.stringify(first).length).toBeLessThan(50_000);
    const changed = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "cut.update", sceneId: "s", id: "k", fields: { promptEn: "new prompt" } }] });
    expect(changed.projection.detail).toBe("summary");
    expect(current().scenes[0].cuts[0].composition?.motionTracks?.[0].keys).toHaveLength(1983);
    current().scenes[0].cuts[0].composition!.motionTracks![4].keys[1982].value.x = 7;
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: changed.revision, commands: [{ type: "project.update", fields: { title: "오래된 요청" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: "previous-session" });
    expect(changes.fullSnapshotRequired).toBe(true);
    expect(changes.snapshot?.projection.detail).toBe("summary");
    expect(JSON.stringify(changes).length).toBeLessThan(50_000);
    const full = await api.getProjectSnapshot("p", "full");
    expect(full.draft.scenes[0].cuts[0].composition?.motionTracks?.[4].keys[1982].value.x).toBe(7);
    expect(full.revision).toBe(changes.revision);
  });

  it.each([false, true])("저장 중 수동 수정과 조회 뒤에는 과거 적용판으로 변경 이력을 되감지 않는다 (저장 실패: %s)", async (fail) => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const wait = gate(); state.persistGate = wait.promise;
    let completed = false;
    const writing = api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "조종기가 바꾼 제목" } }] });
    const result = writing.then((value) => { completed = true; return { value }; }, (error: unknown) => { completed = true; return { error }; });
    await tick();
    state.projects.get("p")!.draft = { ...current(), logline: "사람이 쓴 줄거리" };
    const during = await api.getProjectSnapshot("p");
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/title", before: "작품", after: "조종기가 바꾼 제목", source: "controller" }),
      expect.objectContaining({ path: "/logline", after: "사람이 쓴 줄거리", source: "app" }),
    ]));
    expect(completed).toBe(false);
    state.fail = fail; wait.resolve();
    const settled = await result;
    if (fail) expect(settled).toMatchObject({ error: { code: "save_failed", details: { applied: true } } });
    else expect(settled).toMatchObject({ value: { persisted: true, revision: during.revision, draft: { logline: "사람이 쓴 줄거리" } } });
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: during.revision })).toMatchObject({ revision: during.revision, changes: [] });
  });

  it("조종기 적용 뒤 같은 칸을 수동으로 덮었으면 최종 순변경의 주체는 앱이다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const wait = gate(); state.persistGate = wait.promise;
    const writing = api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "중간 제목" } }] });
    await tick();
    state.projects.get("p")!.draft = { ...current(), title: "사람의 최종 제목" };
    const during = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(during.changes).toEqual([expect.objectContaining({ path: "/title", before: "작품", after: "사람의 최종 제목", source: "app" })]);
    wait.resolve(); await writing;
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: during.revision })).toMatchObject({ changes: [] });
  });

  it("사람의 수정은 다음 조회의 새 revision과 변경 경로로 보인다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    current().logline = "사람이 고친 줄거리";
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.revision).not.toBe(first.revision);
    expect(changes.fullSnapshotRequired).toBe(false);
    expect(changes.changes).toContainEqual(expect.objectContaining({ source: "app", path: "/logline", before: null, after: "사람이 고친 줄거리" }));
    expect(state.loads).toHaveBeenCalledTimes(1);
  });

  it("오래된 상태를 읽은 조종기는 사람의 변경을 덮지 못한다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    current().logline = "사람의 결정";
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { logline: "오래된 결정" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(current().logline).toBe("사람의 결정");
  });

  it("같은 묶음에서 만든 인물과 장소를 새 컷에서 안정된 ID로 참조한다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const result = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "character.add", id: "c1", fields: { name: "주인공", promptEn: "a traveler" } },
      { type: "background.add", id: "b1", fields: { name: "숲" } },
      { type: "scene.add", id: "s1", fields: { title: "등장" } },
      { type: "cut.add", id: "k1", sceneId: "s1", fields: { title: "걸어온다", characterIds: ["c1"], backgroundId: "b1", promptKo: "숲 속을 걷는 여행자" } },
    ] });
    expect(result.persisted).toBe(true);
    expect(current().characters[0]).toMatchObject({ id: "c1", promptEn: "a traveler", generatedImages: [] });
    expect(current().scenes[0].cuts).toHaveLength(1);
    expect(current().scenes[0].cuts[0]).toMatchObject({ id: "k1", characterIds: ["c1"], backgroundId: "b1" });
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes.every((item) => item.source === "controller")).toBe(true);
  });

  it("ID를 생략해도 새 카드 ID를 반환하고 다음 편집에 그대로 쓴다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    const made = await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "character.add", fields: { name: "주인공" } }] });
    const id = made.created[0].id;
    expect(id).toBeTruthy();
    await api.updateProjectControl({ projectId: "p", expectedRevision: made.revision, commands: [{ type: "character.update", id, fields: { description: "조용한 여행자" } }] });
    expect(current().characters).toHaveLength(1);
    expect(current().characters[0].description).toBe("조용한 여행자");
  });

  it("잘못된 참조가 묶음 뒤에 있으면 앞의 변경도 적용하지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [
      { type: "scene.add", id: "s1", fields: { title: "새 장면" } },
      { type: "cut.add", id: "k1", sceneId: "s1", fields: { characterIds: ["없는 인물"] } },
    ] })).rejects.toMatchObject({ code: "invalid_reference" });
    expect(current().scenes).toHaveLength(0);
  });

  it("적용 직전 수동 변경도 React 계산 중 예외 없이 보존한다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    state.beforeWrite = () => { current().logline = "직전 수정"; };
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "조종기 제목" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(current().title).toBe("작품");
    expect(current().logline).toBe("직전 수정");
  });

  it("저장 실패는 적용과 구분해 반환하고 전체 성공으로 알리지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const first = await api.getProjectSnapshot("p");
    state.fail = true;
    await expect(api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "변경" } }] })).rejects.toMatchObject({ code: "save_failed", details: { applied: true } });
  });

  it("모르는 revision이면 전체 상태가 필요하다고 알린다", async () => {
    const api = await import("@/lib/projectControl");
    expect(await api.getProjectChanges({ projectId: "p", sinceRevision: "이전 앱 세션" })).toMatchObject({ fullSnapshotRequired: true, snapshot: { draft: { title: "작품" } } });
  });

  it("같은 생성 요청을 다시 보내도 새 프로젝트를 만들지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const input = { title: "새 작품", synopsis: "여행", operationId: "create-once" };
    const first = await api.createProjectControl(input);
    const repeated = await api.createProjectControl(input);
    expect(repeated.projectId).toBe(first.projectId);
    expect(repeated.reused).toBe(true);
    expect(state.projects.size).toBe(2);
    await expect(api.createProjectControl({ ...input, title: "다른 작품" })).rejects.toMatchObject({ code: "operation_conflict" });
  });

  it("인물 ID로 된 변경 경로는 배열 순서와 관계없이 유지된다", async () => {
    const api = await import("@/lib/projectControl");
    current().characters = [{ ...newCharacter(), id: "c1", name: "처음" }, { ...newCharacter(), id: "c2", name: "둘째" }];
    const first = await api.getProjectSnapshot("p");
    current().characters.reverse();
    current().characters.find((item) => item.id === "c1")!.description = "수동 편집";
    const changes = await api.getProjectChanges({ projectId: "p", sinceRevision: first.revision });
    expect(changes.changes).toContainEqual(expect.objectContaining({ path: "/characters/c1/description", after: "수동 편집" }));
  });

  it("프로젝트 열기는 등록된 앱 라우터를 쓴다", async () => {
    const api = await import("@/lib/projectControl");
    const navigate = vi.fn();
    const off = api.registerProjectNavigation(navigate);
    expect(await api.openProjectControl("p")).toMatchObject({ opened: true });
    expect(navigate).toHaveBeenCalledWith("p");
    off();
    await expect(api.openProjectControl("p")).rejects.toMatchObject({ code: "navigation_unavailable" });
  });

  it("기존 미디어·구도는 텍스트 변경으로 사라지지 않는다", async () => {
    const api = await import("@/lib/projectControl");
    const cut = { ...newCut(1), id: "k", guideImagePath: "p/guide.png", videos: [{ id: "v", name: "영상", filePath: "p/video.mp4", createdAt: "now" }] };
    current().scenes = [{ ...newScene(), id: "s", cuts: [cut] }];
    const first = await api.getProjectSnapshot("p");
    await api.updateProjectControl({ projectId: "p", expectedRevision: first.revision, commands: [{ type: "cut.update", sceneId: "s", id: "k", fields: { promptEn: "new prompt" } }] });
    expect(current().scenes[0].cuts[0]).toMatchObject({ guideImagePath: "p/guide.png", videos: cut.videos, promptEn: "new prompt" });
  });
});
