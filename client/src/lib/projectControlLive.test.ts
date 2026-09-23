import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, type ProjectDraft } from "./projectTypes";

const saved = vi.hoisted(() => ({ draft: null as ProjectDraft | null, saves: vi.fn() }));
vi.mock("./localProjectStore", () => ({
  loadProjects: async () => [],
  listLocalProjects: () => [{ id: "live", title: saved.draft?.title }],
  getLocalProject: () => ({ id: "live", draft: saved.draft }),
  saveLocalProjectAndConfirm: async (draft: ProjectDraft, id: string) => {
    saved.saves(draft); saved.draft = draft;
    return { project: { id, draft }, outcome: "written" };
  },
}));

beforeEach(() => { vi.resetModules(); saved.draft = { ...newProjectDraft(), title: "실제 쓰기 어댑터" }; saved.saves.mockClear(); });

describe("실제 열린 프로젝트 어댑터와 변경 관찰", () => {
  it("화면과 같은 함수형 patch를 거쳐 다른 root로 돌아온 결과도 수동 수정과 정확히 구분한다", async () => {
    const writer = await import("./projectWrite");
    const api = await import("./projectControl");
    let live = saved.draft!;
    // NewProjectPage가 등록하는 patch와 read의 계약을 실제 projectWrite에 연결합니다.
    const patch = (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => { live = { ...live, ...updater(live) }; };
    const off = writer.registerProjectTarget("live", patch, () => live);
    try {
      const first = await api.getProjectSnapshot("live", "summary");
      patch(() => ({ logline: "화면에서 적은 내용" }));
      const manual = await api.getProjectChanges({ projectId: "live", sinceRevision: first.revision });
      expect(manual.changes).toContainEqual(expect.objectContaining({ path: "/logline", after: "화면에서 적은 내용", source: "app" }));
      await expect(api.updateProjectControl({ projectId: "live", expectedRevision: first.revision, commands: [{ type: "project.update", fields: { title: "옛 요청" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
      const done = await api.updateProjectControl({ projectId: "live", expectedRevision: manual.revision, commands: [{ type: "project.update", fields: { title: "새 요청" } }] });
      expect(done).toMatchObject({ persisted: true, draft: { title: "새 요청", logline: "화면에서 적은 내용" } });
      // writeLive는 같은 값을 담은 별도 root를 반환합니다. 참조 차이가 가짜 변경을 만들면 안 됩니다.
      expect(saved.saves.mock.calls.at(-1)![0]).not.toBe(live);
      expect(await api.getProjectChanges({ projectId: "live", sinceRevision: done.revision })).toMatchObject({ changes: [], revision: done.revision });
    } finally { off(); }
  });

  it("실제 어댑터가 적용 직전에 새 화면 판을 읽으면 수동 내용을 보존하며 낡은 요청을 막는다", async () => {
    const writer = await import("./projectWrite");
    const api = await import("./projectControl");
    let live = saved.draft!;
    const off = writer.registerProjectTarget("live", update => {
      live = { ...live, logline: "적용 직전 화면 변경" };
      live = { ...live, ...update(live) };
    }, () => live);
    try {
      const before = await api.getProjectSnapshot("live", "summary");
      await expect(api.updateProjectControl({ projectId: "live", expectedRevision: before.revision, commands: [{ type: "project.update", fields: { title: "낡은 제목" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
      expect(live).toMatchObject({ title: "실제 쓰기 어댑터", logline: "적용 직전 화면 변경" });
    } finally { off(); }
  });
});
