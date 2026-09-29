import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, type ProjectDraft } from "./projectTypes";

const state = vi.hoisted(() => ({ draft: null as ProjectDraft | null, revision: "r1", input: {
  source: "", hint: "", counts: { characters: "0", backgrounds: "0", scenes: "0" }, mode: "append" as "append" | "replace", richPrompts: true,
  refs: [] as Array<{ id: string; path: string; name: string; kind: "image" | "video"; note: string; importSourcePath?: string }>,
  docs: [] as Array<{ id: string; path: string; name: string; importSourcePath?: string; chars: number; pages?: number }>,
}, history: vi.fn(), emptySave: vi.fn(), imported: vi.fn(), deleted: vi.fn() }));
vi.mock("./bootstrapStore", () => ({
  runOf: () => ({ input: state.input }),
  setBootstrapInput: (_id: string, patch: object) => { state.input = { ...state.input, ...patch }; },
  keepPast: state.history,
  refTag: () => "ref_img_1",
}));
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
vi.mock("./localProjectStore", () => ({ expectEmptyProjectSave: state.emptySave, projectFolderName: () => "작품" }));
vi.mock("./mediaLibrary", () => ({ assetSrc: (path: string) => path,
  safeFileName: (name: string) => name,
  importProjectMediaAsset: state.imported, deleteProjectMediaFile: state.deleted }));
vi.mock("./documentText", () => ({ DOCUMENT_EXTENSIONS: [".pdf", ".docx", ".txt"],
  readDocumentText: async () => ({ text: "첫 장면에서 두 사람이 대화한다.", pages: 2 }) }));

beforeEach(() => {
  state.draft = { ...newProjectDraft(), title: "작품" };
  state.revision = "r1";
  state.input = { source: "", hint: "", counts: { characters: "0", backgrounds: "0", scenes: "0" }, mode: "append", richPrompts: true, refs: [], docs: [] };
  state.history.mockReset();
  state.emptySave.mockReset();
  state.imported.mockReset().mockResolvedValue({ path: "C:/project/ref_img_1.png", name: "ref_img_1" });
  state.deleted.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["대본"]) })));
});

describe("일괄 생성 대화 조종", () => {
  it("대본 원본을 저장하고 앱 추출기로 읽어 입력칸에 한 번만 붙인다", async () => {
    const control = await import("./controlBootstrap");
    const request = { projectId: "p", expectedRevision: "r1", operationId: "doc-1", sourcePath: "C:/Downloads/시나리오.pdf" };
    const first = await control.importBootstrapDocument(request);
    expect(first).toMatchObject({ reused: false, pages: 2 });
    expect(state.input.source).toContain("첫 장면에서 두 사람이 대화한다.");
    expect(state.input.docs).toHaveLength(1);
    const again = await control.importBootstrapDocument(request);
    expect(again.reused).toBe(true);
    expect(state.imported).toHaveBeenCalledOnce();
    expect(state.input.source.match(/첫 장면/g)).toHaveLength(1);
  });
  it("참고 이미지를 앱 프로젝트에 한 번만 복사하고 @이름표와 사용 메모를 유지한다", async () => {
    const control = await import("./controlBootstrap");
    const request = { projectId: "p", expectedRevision: "r1", operationId: "reference-1",
      sourcePath: "C:/Downloads/dance.png", kind: "image", note: "다섯 명 의상 기준" };
    const first = await control.registerBootstrapReference(request);
    expect(first).toMatchObject({ reused: false, tag: "ref_img_1" });
    expect(state.imported).toHaveBeenCalledOnce();
    expect(state.input.refs[0]).toMatchObject({ path: "C:/project/ref_img_1.png", note: "다섯 명 의상 기준" });
    const same = await control.registerBootstrapReference(request);
    expect(same.reused).toBe(true);
    expect(state.imported).toHaveBeenCalledOnce();
    await expect(control.registerBootstrapReference({ ...request, sourcePath: "C:/Downloads/other.png" }))
      .rejects.toMatchObject({ code: "operation_conflict" });
    await control.updateBootstrapReference({ projectId: "p", expectedRevision: "r1", referenceId: first.referenceId,
      note: "다섯 명 헤어와 의상 기준" });
    expect(state.input.refs[0].note).toBe("다섯 명 헤어와 의상 기준");
    await control.updateBootstrapReference({ projectId: "p", expectedRevision: "r1", referenceId: first.referenceId, remove: true });
    expect(state.input.refs).toHaveLength(0);
    expect(state.deleted).not.toHaveBeenCalled();
  });
  it("비우기 모드는 명시 확인 없이는 기존 장면에 손대지 않는다", async () => {
    const control = await import("./controlBootstrap");
    const input = await control.updateBootstrapInput({ projectId: "p", expectedRevision: "r1", source: "새 작품", mode: "replace",
      counts: { characters: 1, backgrounds: 0, scenes: 0 } });
    await expect(control.applyBootstrapResult({ projectId: "p", expectedRevision: "r1", operationId: "replace-1",
      inputFingerprint: input.inputFingerprint, outline: { title: "새 작품" }, details: { characters: [{ name: "새 인물" }], backgrounds: [], scenes: [] } }))
      .rejects.toMatchObject({ code: "replace_confirmation_required" });
    expect(state.draft?.title).toBe("작품");
    expect(state.emptySave).not.toHaveBeenCalled();
  });
  it("앱의 답 해석·구도 조립기로 한 번만 적용하고 같은 작업 재시도를 중복 생성하지 않는다", async () => {
    const control = await import("./controlBootstrap");
    const input = await control.updateBootstrapInput({ projectId: "p", expectedRevision: "r1", source: "무대에서 다섯 명이 춤춘다.",
      counts: { characters: 5, backgrounds: 1, scenes: 1 } });
    const outlinePrompt = await control.prepareBootstrapPrompt({ projectId: "p", expectedRevision: "r1", phase: "outline" });
    expect(outlinePrompt.structuredContent.request).toContain("무대에서 다섯 명이 춤춘다.");
    expect(outlinePrompt.structuredContent.inputFingerprint).toBe(input.inputFingerprint);
    const request = { projectId: "p", expectedRevision: "r1", operationId: "mv-1", inputFingerprint: input.inputFingerprint,
      outline: { title: "무대", characters: [{ name: "서아", note: "댄서" }], backgrounds: [{ name: "공연장", note: "네온" }] },
      details: { characters: [{ name: "서아", description: "밝게 춤추는 성인" }], backgrounds: [{ name: "공연장", description: "네온 조명" }],
        scenes: [{ title: "후렴", summary: "군무", cuts: [{ title: "와이드", description: "무대 군무", characterNames: ["서아"], backgroundName: "공연장", seconds: 8 }] }] },
      shots: { scenes: [{ title: "후렴", cuts: [{ order: 1, shot: "wide", angle: "eye level", people: [{ name: "서아", x: 0, z: 0, facing: 0 }], promptKo: "서아가 공연장에서 춤춘다", promptEn: "Seoah dances on stage" }] }] },
    };
    const applied = await control.applyBootstrapResult(request);
    expect(applied).toMatchObject({ persisted: true, revision: "r2" });
    expect(applied.promptTargets).toEqual([
      { kind: "character", id: state.draft?.characters[0].id },
      { kind: "background", id: state.draft?.backgrounds[0].id },
      { kind: "cutImage", sceneId: state.draft?.scenes[0].id, cutId: state.draft?.scenes[0].cuts[0].id },
      { kind: "cutVideo", sceneId: state.draft?.scenes[0].id, cutId: state.draft?.scenes[0].cuts[0].id },
    ]);
    expect(state.draft?.scenes).toHaveLength(1);
    expect(state.draft?.scenes[0].cuts[0].composition).toBeTruthy();
    expect(state.history).toHaveBeenCalledOnce();
    const worklist = await control.getBootstrapPromptTargets({ projectId: "p", operationId: "mv-1" });
    expect(worklist).toMatchObject({ total: 4, remaining: 4, revision: "r2" });
    expect(worklist.targets.every((item) => item.exists && !item.completed)).toBe(true);
    state.draft!.characters[0].promptHistory = [{ ko: "상세 한국어", en: "Detailed English", note: "대화 조종기 · 프롬프트 작성" }];
    expect((await control.getBootstrapPromptTargets({ projectId: "p" })).remaining).toBe(3);
    state.draft!.scenes[0].cuts[0].videoPromptHistory = [{ ko: "영상 한국어", en: "Video English", note: "대화 조종기 · 프롬프트 작성" }];
    expect((await control.getBootstrapPromptTargets({ projectId: "p" })).remaining).toBe(2);
    const retried = await control.applyBootstrapResult(request);
    expect(retried).toMatchObject({ alreadyApplied: true });
    expect(retried.remaining).toBe(2);
    expect(state.draft?.scenes).toHaveLength(1);
  });
  it("예전 판에서 적용한 작업은 작업표가 없어도 중복 적용하지 않는다", async () => {
    const control = await import("./controlBootstrap");
    state.draft!.controlBootstrapOperations = ["legacy-1"];
    const retried = await control.applyBootstrapResult({ projectId: "p", expectedRevision: "r1",
      operationId: "legacy-1", inputFingerprint: "unused", outline: {}, details: {} });
    expect(retried).toMatchObject({ alreadyApplied: true, promptTargetsUnavailable: true });
    expect(state.draft?.scenes).toHaveLength(0);
  });
});
