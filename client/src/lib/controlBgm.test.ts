import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn() }));
vi.mock("./mediaLibrary", () => ({
  queueMirrorWrite: vi.fn(), queueMirrorWriteAndConfirm: state.save,
  registerMirrorSection: vi.fn(), whenAppSettingsReady: async () => {},
  assetSrc: (path: string) => path, safeFileName: (name: string) => name,
}));
vi.mock("./localEngines", () => ({ LOCAL_ENGINE_IDS: ["minimaxmusic", "acestep"], loadPrecision: () => "auto" }));
vi.mock("./localOutput", () => ({ runLocalToProject: state.run }));
vi.mock("./llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));
function memory() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }; }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const generation = { projectId: "b", trackId: "t", operationId: "music-1", engine: "acestep", prompt: "orchestral, strings, 90 bpm", lyrics: "[verse]\n함께 걷자", seconds: 30 };
async function prepare() {
  const bgm = await import("./bgmProjects");
  bgm.saveBgmProjects([{ ...bgm.createBgmProject("영화 음악"), id: "b", tracks: [{ ...bgm.createBgmTrack(), id: "t", name: "시작" }] }]);
  const q = await import("./taskQueue");
  await q.registerTaskJournal({ read: async () => null, write: async () => {} });
  const control = await import("./controlBgm");
  return { bgm, q, control };
}
async function finish(q: Awaited<ReturnType<typeof prepare>>["q"], jobId: string) {
  for (let index = 0; index < 30; index++) {
    await tick();
    const job = q.getTask(jobId)!;
    if (job.status !== "running" && job.status !== "waiting") { await q.flushTaskJournal(); return job; }
  }
  throw new Error("시험 작업이 끝나지 않았습니다.");
}
beforeEach(() => {
  vi.resetModules();
  const storage = memory();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  state.save.mockReset().mockResolvedValue(undefined);
  state.run.mockReset().mockResolvedValue({ path: "BGM/곡/영화 음악/시작.wav", name: "시작" });
});

describe("BGM 외부 조종과 수동 편집 왕복", () => {
  it("BGM API 버튼과 같은 요청문을 현재 곡 판에서 준비하고 낡은 판은 거절한다", async () => {
    const { control, bgm } = await prepare();
    const before = await control.getBgmSnapshot("b");
    const expected = await import("./promptRequest");
    const requestData = await import("./bgmPromptRequest");
    const parts = await expected.buildPromptRequestText({ template: "bgm-prompt",
      data: requestData.bgmRequestData(bgm.loadBgmProjects()[0].tracks[0]) });
    const prepared = await control.prepareBgmPrompt({ projectId: "b", trackId: "t", expectedRevision: before.revision });
    expect(prepared.request).toBe([parts.fixed, parts.fresh].filter(Boolean).join("\n\n---\n\n"));
    bgm.updateBgmProjects((items) => items.map((item) => ({ ...item, description: "사람이 수정" })));
    await expect(control.prepareBgmPrompt({ projectId: "b", trackId: "t", expectedRevision: before.revision }))
      .rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("외부 편집을 화면 구독에 알리고 그 뒤 수동 수정도 최신 값에 얹어 변경 내역을 돌려준다", async () => {
    const { bgm, control } = await prepare();
    let displayed = bgm.loadBgmProjects();
    const unsubscribe = bgm.subscribeBgmProjects(() => { displayed = bgm.loadBgmProjects(); });
    const initial = await control.getBgmSnapshot("b");
    const changed = await control.updateBgmControl({ projectId: "b", expectedRevision: initial.revision, commands: [{ type: "track.update", id: "t", fields: { styleEn: "strings", lyricsKo: "함께 걷자", instrumental: false } }] });
    expect(displayed[0].tracks[0]).toMatchObject({ styleEn: "strings", promptEn: "strings", lyrics: "함께 걷자\n[end]", lyricsKo: "함께 걷자\n[end]", instrumental: false, vocals: [] });
    bgm.updateBgmProjects((current) => current.map((project) => ({ ...project, tracks: project.tracks.map((track) => bgm.patchBgmTrack(track, { name: "사람이 바꾼 곡명" })) })));
    const changes = await control.getBgmChanges({ projectId: "b", sinceRevision: initial.revision });
    expect(changes.changes).toEqual(expect.arrayContaining([expect.objectContaining({ source: "controller", path: "/tracks/t/styleEn", after: "strings" }), expect.objectContaining({ source: "app", path: "/tracks/t/name", after: "사람이 바꾼 곡명" })]));
    expect((await control.getBgmSnapshot("b")).project.tracks[0].styleEn).toBe("strings");
    await expect(control.updateBgmControl({ projectId: "b", expectedRevision: changed.revision, commands: [{ type: "track.update", id: "t", fields: { name: "옛 요청" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    unsubscribe();
  });

  it("조종기로 곡 프롬프트를 다시 쓰면 이전 판과 새 판을 UI 이력에 남긴다", async () => {
    const { control } = await prepare();
    const before = await control.getBgmSnapshot("b");
    const first = await control.updateBgmControl({ projectId: "b", expectedRevision: before.revision,
      commands: [{ type: "track.update", id: "t", fields: { styleKo: "밝은 현악", styleEn: "bright strings" } }] });
    const second = await control.updateBgmControl({ projectId: "b", expectedRevision: first.revision,
      commands: [{ type: "track.update", id: "t", fields: { styleKo: "잔잔한 현악", styleEn: "soft strings" } }] });
    expect(second.project.tracks[0].promptHistory.map((entry: { ko: string }) => entry.ko))
      .toEqual(["잔잔한 현악", "밝은 현악"]);
  });

  it("실제 파일 저장 응답을 기다리고 기다리는 동안의 수동 수정은 덮지 않는다", async () => {
    const { bgm, control } = await prepare();
    const initial = await control.getBgmSnapshot("b");
    const wait = gate(); state.save.mockImplementation(() => wait.promise);
    let done = false;
    const writing = control.updateBgmControl({ projectId: "b", expectedRevision: initial.revision, commands: [{ type: "project.update", fields: { description: "새 음악" } }] }).then((value) => { done = true; return value; });
    await tick();
    expect(done).toBe(false);
    bgm.updateBgmProjects((current) => current.map((project) => ({ ...project, linkedProject: "손으로 연결한 영화" })));
    wait.resolve();
    expect((await writing).project).toMatchObject({ description: "새 음악", linkedProject: "손으로 연결한 영화" });
  });

  it("곡 추가와 수정 배치는 한 번에 반영하고 잘못된 마지막 명령은 전체를 거절한다", async () => {
    const { bgm, control } = await prepare();
    const before = await control.getBgmSnapshot("b");
    await expect(control.updateBgmControl({ projectId: "b", expectedRevision: before.revision, commands: [{ type: "track.add", id: "new", fields: { name: "새 곡" } }, { type: "track.update", id: "missing", fields: { lyrics: "실패" } }] })).rejects.toMatchObject({ code: "target_not_found" });
    expect(bgm.loadBgmProjects()[0].tracks).toHaveLength(1);
    const result = await control.updateBgmControl({ projectId: "b", expectedRevision: before.revision, commands: [{ type: "track.add", id: "new", fields: { name: "새 곡" } }, { type: "track.update", id: "new", fields: { notes: "같은 배치에서 수정" } }] });
    expect(result.created).toEqual([{ type: "track.add", id: "new" }]);
    expect(result.project.tracks[1].notes).toBe("같은 배치에서 수정");
  });

  it("저장 실패는 적용된 상태와 함께 오류로 돌려주고 알려지지 않은 버전은 전체를 요청한다", async () => {
    const { control } = await prepare();
    const before = await control.getBgmSnapshot("b");
    state.save.mockRejectedValue(new Error("디스크 오류"));
    await expect(control.updateBgmControl({ projectId: "b", expectedRevision: before.revision, commands: [{ type: "track.update", id: "t", fields: { notes: "남은 편집" } }] })).rejects.toMatchObject({ code: "save_failed", details: { applied: true } });
    expect(await control.getBgmChanges({ projectId: "b", sinceRevision: "다른 앱 실행" })).toMatchObject({ fullSnapshotRequired: true, snapshot: { project: { tracks: [expect.objectContaining({ notes: "남은 편집" })] } } });
  });

  it("프로젝트 생성 응답을 잃어 재요청해도 하나만 남고 다른 요청 내용은 거절한다", async () => {
    const { bgm, control } = await prepare();
    const input = { operationId: "new-bgm", name: "새 영화 음악" };
    const made = await control.createBgmControl(input);
    bgm.updateBgmProjects((current) => current.map((project) => project.id === made.projectId ? { ...project, description: "수동 편집 보존" } : project));
    expect(await control.createBgmControl(input)).toMatchObject({ projectId: made.projectId, reused: true, persisted: true, project: { description: "수동 편집 보존" } });
    expect(await control.listBgmControl()).toHaveLength(2);
    await expect(control.createBgmControl({ ...input, name: "다른 영화" })).rejects.toMatchObject({ code: "operation_conflict" });
  });

  it("프로젝트 첫 저장 실패 후 같은 요청은 실제 파일 저장을 재시도한다", async () => {
    const { control } = await prepare();
    state.save.mockRejectedValueOnce(new Error("첫 저장 실패"));
    const input = { operationId: "retry-new", name: "재시도 작품" };
    await expect(control.createBgmControl(input)).rejects.toMatchObject({ code: "save_failed" });
    expect(await control.createBgmControl(input)).toMatchObject({ reused: true, persisted: true });
    expect(state.save).toHaveBeenCalledTimes(2);
  });

  it("웹뷰 저장 자체가 거절되면 실제로 없는 편집을 변경 내역으로 기록하지 않는다", async () => {
    const { control } = await prepare();
    const before = await control.getBgmSnapshot("b");
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("저장소 용량 초과"); });
    await expect(control.updateBgmControl({ projectId: "b", expectedRevision: before.revision, commands: [{ type: "project.update", fields: { description: "저장되지 않을 글" } }] })).rejects.toThrow("저장소 용량 초과");
    expect(await control.getBgmChanges({ projectId: "b", sinceRevision: before.revision })).toMatchObject({ revision: before.revision, changes: [] });
    await expect(control.createBgmControl({ name: "없는 작품", operationId: "quota" })).rejects.toMatchObject({ code: "save_failed", details: { applied: false } });
    write.mockRestore();
  });
});

describe("Comfy 전환 후 이전 BGM 실행 요청",()=>{
  it("UI와 조종기는 직접 엔진 실행을 접수하지 않고 곡 편집과 파일을 보존합니다",async()=>{
    const {bgm,q,control}=await prepare();const run=await import("./bgmRun");
    const before=JSON.stringify(bgm.loadBgmProjects());
    expect(run.startBgmTrack({...generation,engine:"acestep"})).toBe(false);
    for(const engine of ["acestep","minimaxmusic"])await expect(control.enqueueControlBgm({...generation,engine})).rejects.toThrow("legacy_generation_disabled");
    expect(q.listTasks()).toHaveLength(0);expect(state.run).not.toHaveBeenCalled();expect(JSON.stringify(bgm.loadBgmProjects())).toBe(before);
  });
  it("Comfy Music3 요청 본문·응답 metadata·stale는 명시 역할을 사용한다",async()=>{
    const {control,bgm}=await prepare();
    const target={kind:"workflow" as const,workflowId:"music-test",workflowSha256:"a".repeat(64),roleId:"primary",modelRuleId:"minimaxmusic3"};
    const candidate=await import("./workflowEvidence/music3-instrumental-smoke.candidate.json");
    localStorage.setItem("ai-video-storage.comfy-workflow-library.v1",JSON.stringify([{source:{...candidate.default.source,workflowId:target.workflowId},selection:candidate.default.selection,workflowSha256:target.workflowSha256,issues:[],checkedAtUtc:"2026-10-06T18:00:00.000Z"}]));
    const helpers=await import("./bgmPromptRequest");
    bgm.updateBgmProjects(projects=>projects.map(project=>({...project,tracks:project.tracks.map(track=>({...track,targetTool:"comfy",promptWorkflow:target,promptKo:"수동",promptModelStamp:helpers.bgmPromptStamp({...track,targetTool:"comfy",promptWorkflow:target})}))})));
    const before=await control.getBgmSnapshot("b"),request=await control.prepareBgmPrompt({projectId:"b",trackId:"t",expectedRevision:before.revision});
    expect(request).toMatchObject({modelId:"minimaxmusic3",generationTarget:{route:"comfy",workflowTarget:target},stale:""});expect(request.request).toContain("MiniMaxMusic3TextEncode");
    bgm.updateBgmProjects(projects=>projects.map(project=>({...project,tracks:project.tracks.map(track=>({...track,promptWorkflow:{...target,workflowSha256:"b".repeat(64)}}))})));
    const changed=await control.getBgmSnapshot("b");await expect(control.prepareBgmPrompt({projectId:"b",trackId:"t",expectedRevision:changed.revision})).rejects.toThrow("stale");expect(bgm.loadBgmProjects()[0].tracks[0].promptKo).toBe("수동");
  });
  it("잘못된 엔진·외부 경로·없는 곡은 접수 전에 거절합니다",async()=>{
    const {q,control}=await prepare();for(const change of [{engine:"wanvideo"},{outputPath:"C:/overwrite.wav"},{trackId:"missing"}])await expect(control.enqueueControlBgm({...generation,...change})).rejects.toThrow();
    expect(q.listTasks()).toHaveLength(0);expect(state.run).not.toHaveBeenCalled();
  });
});
