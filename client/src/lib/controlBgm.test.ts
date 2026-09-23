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
  it("외부 편집을 화면 구독에 알리고 그 뒤 수동 수정도 최신 값에 얹어 변경 내역을 돌려준다", async () => {
    const { bgm, control } = await prepare();
    let displayed = bgm.loadBgmProjects();
    const unsubscribe = bgm.subscribeBgmProjects(() => { displayed = bgm.loadBgmProjects(); });
    const initial = await control.getBgmSnapshot("b");
    const changed = await control.updateBgmControl({ projectId: "b", expectedRevision: initial.revision, commands: [{ type: "track.update", id: "t", fields: { styleEn: "strings", lyricsKo: "함께 걷자", instrumental: false } }] });
    expect(displayed[0].tracks[0]).toMatchObject({ styleEn: "strings", promptEn: "strings", lyrics: "함께 걷자", lyricsKo: "함께 걷자", instrumental: false, vocals: [] });
    bgm.updateBgmProjects((current) => current.map((project) => ({ ...project, tracks: project.tracks.map((track) => bgm.patchBgmTrack(track, { name: "사람이 바꾼 곡명" })) })));
    const changes = await control.getBgmChanges({ projectId: "b", sinceRevision: initial.revision });
    expect(changes.changes).toEqual(expect.arrayContaining([expect.objectContaining({ source: "controller", path: "/tracks/t/styleEn", after: "strings" }), expect.objectContaining({ source: "app", path: "/tracks/t/name", after: "사람이 바꾼 곡명" })]));
    expect((await control.getBgmSnapshot("b")).project.tracks[0].styleEn).toBe("strings");
    await expect(control.updateBgmControl({ projectId: "b", expectedRevision: changed.revision, commands: [{ type: "track.update", id: "t", fields: { name: "옛 요청" } }] })).rejects.toMatchObject({ code: "revision_conflict" });
    unsubscribe();
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

describe("BGM 공용 작업 러너", () => {
  it("UI 생성 버튼의 중복 방지 메타데이터가 붙어도 공용 러너가 곡을 만든다", async () => {
    const { bgm, q } = await prepare();
    const run = await import("./bgmRun");
    const input = { projectId: "b", projectName: "영화 음악", trackId: "t", trackName: "시작", engine: "acestep" as const, prompt: "strings", lyrics: "", seconds: 30 };
    expect(run.startBgmTrack(input)).toBe(true);
    expect(run.startBgmTrack(input)).toBe(false);
    const job = q.listTasks()[0];
    expect(job.payload).toMatchObject({ dedupe: "bgm:t" });
    expect((await finish(q, job.id)).status).toBe("done");
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(bgm.loadBgmProjects()[0].tracks[0].resultPaths).toHaveLength(1);
  });

  it("프롬프트와 가사를 로컬 모델에 직접 전달하고 재요청은 같은 작업을 돌려준다", async () => {
    const { bgm, q, control } = await prepare();
    const accepted = await control.enqueueControlBgm(generation);
    const result = await finish(q, accepted.jobId);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ engine: "acestep", projectName: "BGM", ownerName: "영화 음악", opts: expect.objectContaining({ prompt: generation.prompt, lyrics: generation.lyrics, seconds: 30 }) }));
    expect(result.status).toBe("done");
    expect(result.result).toMatchObject({ paths: ["BGM/곡/영화 음악/시작.wav"], data: { attached: true, projectId: "b", trackId: "t" } });
    expect(bgm.loadBgmProjects()[0].tracks[0].resultPaths).toEqual(["BGM/곡/영화 음악/시작.wav"]);
    expect(await control.enqueueControlBgm(generation)).toEqual({ jobId: accepted.jobId, reused: true });
    expect(state.run).toHaveBeenCalledTimes(1);
    await expect(control.enqueueControlBgm({ ...generation, prompt: "다른 프롬프트" })).rejects.toThrow("다른 내용");
  });

  it("생성 중 사람이 고친 곡과 추가한 다른 곡을 보존한다", async () => {
    const { bgm, q, control } = await prepare();
    const wait = gate(); state.run.mockImplementation(async () => { await wait.promise; return { path: "완성.wav" }; });
    const accepted = await control.enqueueControlBgm(generation); await tick();
    bgm.updateBgmProjects((current) => current.map((project) => ({ ...project, tracks: [...project.tracks.map((track) => bgm.patchBgmTrack(track, { lyrics: "사람이 쓴 새 가사" })), { ...bgm.createBgmTrack(), id: "other" }] })));
    wait.resolve(); await finish(q, accepted.jobId);
    expect(bgm.loadBgmProjects()[0].tracks).toMatchObject([{ lyrics: "사람이 쓴 새 가사", resultPaths: ["완성.wav"] }, { id: "other" }]);
  });

  it("생성 중 취소는 파일 위치를 보존하고 곡에 붙이지 않는다", async () => {
    const { bgm, q, control } = await prepare();
    const wait = gate(); state.run.mockImplementation(async () => { await wait.promise; return { path: "취소.wav" }; });
    const accepted = await control.enqueueControlBgm(generation); await tick();
    q.stopTask(accepted.jobId); wait.resolve();
    const stopped = await finish(q, accepted.jobId);
    expect(stopped.status).toBe("stopped");
    expect(stopped.result).toMatchObject({ paths: ["취소.wav"], data: { attached: false, cancelled: true } });
    expect(bgm.loadBgmProjects()[0].tracks[0].resultPaths).toEqual([]);
  });

  it("곡이 삭제되거나 저장이 실패해도 생성 파일 위치는 작업 결과에 남긴다", async () => {
    const { bgm, q, control } = await prepare();
    const wait = gate(); state.run.mockImplementation(async () => { await wait.promise; return { path: "고아.wav" }; });
    const accepted = await control.enqueueControlBgm(generation); await tick();
    bgm.updateBgmProjects((current) => current.map((project) => ({ ...project, tracks: [] })));
    wait.resolve();
    const failed = await finish(q, accepted.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("곡을 찾지 못했습니다");
    expect(failed.result?.paths).toEqual(["고아.wav"]);
  });

  it("결과 부착의 파일 저장 오류를 성공으로 숨기지 않는다", async () => {
    const { q, control } = await prepare();
    state.save.mockRejectedValue(new Error("설정 파일 쓰기 실패"));
    const accepted = await control.enqueueControlBgm(generation);
    const failed = await finish(q, accepted.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("설정 파일 쓰기 실패");
    expect(failed.result?.paths).toHaveLength(1);
  });

  it("음악 아닌 엔진·임의 파일 경로·없어진 곡을 새 요청과 재개 작업 양쪽에서 막는다", async () => {
    const { q, control } = await prepare();
    await expect(control.enqueueControlBgm({ ...generation, engine: "wanvideo" })).rejects.toThrow();
    await expect(control.enqueueControlBgm({ ...generation, outputPath: "C:/덮어쓰기.wav" })).rejects.toThrow();
    await expect(control.enqueueControlBgm({ ...generation, trackId: "missing" })).rejects.toThrow("곡을 찾지 못했습니다");
    const accepted = await q.enqueueTaskOperation({ lane: "media", kind: "bgmTrack", operationId: "resume-invalid", projectId: "bgm:b", projectTitle: "음악", label: "재개", payload: { projectId: "b", trackId: "t", engine: "wanvideo", prompt: "잘못된 엔진", lyrics: "", seconds: 30 } });
    expect((await finish(q, accepted.jobId)).status).toBe("failed");
    expect(state.run).not.toHaveBeenCalled();
  });
});
