import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, newCharacter, newScene, newCut, type ProjectDraft } from "@/lib/projectTypes";
const state = vi.hoisted(() => ({ projects: new Map<string, ProjectDraft>(), run: vi.fn(), upscale: vi.fn(), persist: true }));
vi.mock("@/lib/localEngines", () => ({ LOCAL_ENGINE_IDS: ["qwenimage", "wanvideo", "acestep"], LOCAL_ENGINE_CATALOG: { qwenimage: { kind: "image" }, wanvideo: { kind: "video" }, acestep: { kind: "music" } }, listLocalEngines: async () => [] }));
vi.mock("@/lib/upscale", () => ({ UPSCALE_ENGINE_IDS: ["seedvr2"], listEngines: async () => [], upscaleFileToNew: state.upscale }));
vi.mock("@/lib/localOutput", () => ({ runLocalToProject: state.run }));
vi.mock("@/lib/localProjectStore", () => ({ projectFolderName: () => "저장된 작품 폴더" }));
vi.mock("@/lib/projectWrite", () => ({ readProject: (id: string) => state.projects.get(id) ?? null, writeProjectAndConfirm: async (id: string, updater: (current: ProjectDraft) => Partial<ProjectDraft>) => {
  const current = state.projects.get(id)!;
  const next = { ...current, ...updater(current) };
  state.projects.set(id, next);
  return { draft: next, persisted: state.persist, outcome: state.persist ? "written" : "error", why: "시험 저장 오류" };
} }));
vi.mock("@/lib/mediaLibrary", () => ({ assetSrc: (path: string) => `asset:${path}`, loadImageForCanvas: vi.fn(), safeFileName: (value: string) => value }));
vi.mock("@/lib/llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
const tick = () => new Promise<void>((done) => setTimeout(done, 0));
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function memory() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) }; }
const request = { projectId: "p", target: { kind: "cut", id: "k" }, engine: "qwenimage", operationId: "generate-1", options: { prompt: "숲 속 여행자", seed: 123 } };
const draft = () => state.projects.get("p")!;
async function prepare() {
  const q = await import("@/lib/taskQueue");
  await q.registerTaskJournal({ read: async () => null, write: async () => {} });
  const media = await import("@/lib/controlMedia");
  return { q, media };
}
async function finish(q: Awaited<ReturnType<typeof prepare>>["q"], id: string) {
  for (let tries = 0; tries < 20; tries++) {
    await tick();
    const task = q.getTask(id)!;
    if (task.status !== "running" && task.status !== "waiting") { await q.flushTaskJournal(); return task; }
  }
  throw new Error("시험 작업이 끝나지 않았습니다.");
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", memory());
  state.projects.clear(); state.persist = true;
  state.run.mockReset().mockResolvedValue({ path: "p/완성.png", name: "완성" });
  state.upscale.mockReset().mockResolvedValue({ path: "p/확대.png" });
  state.projects.set("p", { ...newProjectDraft(), title: "작품", characters: [{ ...newCharacter(), id: "c", name: "주인공" }], scenes: [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k", images: [{ id: "img", name: "원본", filePath: "p/원본.png", thumb: "", file: null }] }] }] });
});

describe("외부 생성의 저장·취소·재전송", () => {
  it("생성 조건을 전달하고 현재 컷에 결과를 저장한 뒤 작업 결과를 남긴다", async () => {
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration({ ...request, imageAssetId: "img", referenceAssetIds: ["img"] });
    const done = await finish(q, accepted.jobId);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ engine: "qwenimage", projectName: "저장된 작품 폴더", kind: "image", opts: expect.objectContaining({ prompt: "숲 속 여행자", seed: 123, image: "p/원본.png", references: [{ kind: "image", path: "p/원본.png" }] }) }));
    expect(done.status).toBe("done");
    expect(done.result).toMatchObject({ paths: ["p/완성.png"], data: { attached: true } });
    expect(done.result?.assetIds?.[0]).toBe(draft().scenes[0].cuts[0].images[1].id);
  });

  it("생성을 기다리는 동안 사람이 수정한 제목과 대사를 보존한다", async () => {
    const wait = gate();
    state.run.mockImplementation(async () => { await wait.promise; return { path: "p/완성.png", name: "완성" }; });
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration(request);
    await tick();
    draft().scenes[0].cuts[0].title = "사람이 바꾼 제목";
    draft().scenes[0].cuts[0].acting = "손을 흔든다";
    wait.resolve();
    await finish(q, accepted.jobId);
    expect(draft().scenes[0].cuts[0]).toMatchObject({ title: "사람이 바꾼 제목", acting: "손을 흔든다" });
  });

  it("파일 생성 후 저장 확인이 실패하면 성공으로 끝내지 않고 파일 위치는 남긴다", async () => {
    const { q, media } = await prepare();
    state.persist = false;
    const accepted = await media.enqueueControlGeneration(request);
    const failed = await finish(q, accepted.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("프로젝트 저장");
    expect(failed.result?.paths).toEqual(["p/완성.png"]);
    expect(failed.result?.assetIds).toBeUndefined();
  });

  it("실행 중 취소하면 완성된 파일을 기록하되 컷에 붙이지 않는다", async () => {
    const wait = gate();
    state.run.mockImplementation(async () => { await wait.promise; return { path: "p/완성.png", name: "완성" }; });
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration(request);
    await tick();
    q.stopTask(accepted.jobId);
    await q.flushTaskJournal();
    wait.resolve();
    const stopped = await finish(q, accepted.jobId);
    expect(stopped.status).toBe("stopped");
    expect(stopped.result).toMatchObject({ paths: ["p/완성.png"], data: { attached: false, cancelled: true } });
    expect(draft().scenes[0].cuts[0].images).toHaveLength(1);
  });

  it("완료 응답을 잃어 같은 명령을 다시 보내도 두 번 생성하지 않는다", async () => {
    const { q, media } = await prepare();
    const first = await media.enqueueControlGeneration(request);
    await finish(q, first.jobId);
    expect(await media.enqueueControlGeneration(request)).toEqual({ jobId: first.jobId, reused: true });
    await tick();
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(draft().scenes[0].cuts[0].images).toHaveLength(2);
    await expect(media.enqueueControlGeneration({ ...request, options: { prompt: "다른 내용" } })).rejects.toThrow("다른 내용");
  });

  it("다른 프로젝트의 에셋과 공개판 제외 엔진·임의 경로는 거절한다", async () => {
    const { media } = await prepare();
    state.projects.set("other", { ...newProjectDraft(), characters: [{ ...newCharacter(), id: "other-c", generatedImages: [{ id: "foreign", name: "남의 그림", filePath: "other/그림.png", file: null, thumb: "" }] }] });
    await expect(media.enqueueControlGeneration({ ...request, imageAssetId: "foreign" })).rejects.toThrow("에셋");
    await expect(media.enqueueControlGeneration({ ...request, engine: "anima" })).rejects.toThrow();
    await expect(media.enqueueControlGeneration({ ...request, options: { prompt: "입력", image: "C:/임의경로.png" } })).rejects.toThrow();
    expect(state.run).not.toHaveBeenCalled();
  });

  it("재시작 대기열의 잘못된 영상 대상도 생성 전에 거절한다", async () => {
    const { q } = await prepare();
    const accepted = await q.enqueueTaskOperation({ lane: "media", projectId: "p", projectTitle: "작품", kind: "control.generate", label: "기록 재개", operationId: "resume-bad", payload: { ...request, engine: "wanvideo", target: { kind: "character", id: "c" } } });
    const failed = await finish(q, accepted.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("영상 결과는 컷");
    expect(state.run).not.toHaveBeenCalled();
  });

  it("업스케일도 지정한 에셋의 주인에게 새 결과를 붙인다", async () => {
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlUpscale({ projectId: "p", assetId: "img", operationId: "up-1", engine: "seedvr2", targetSize: 4096 });
    const done = await finish(q, accepted.jobId);
    expect(state.upscale).toHaveBeenCalledWith("p/원본.png", "원본_업스케일", expect.objectContaining({ engine: "seedvr2", targetSize: 4096 }));
    expect(done.result).toMatchObject({ paths: ["p/확대.png"], data: { attached: true } });
    expect(draft().scenes[0].cuts[0].images[1].filePath).toBe("p/확대.png");
  });

  it("생성 도중 대상이 삭제되면 실패하되 결과 파일 위치는 남긴다", async () => {
    const wait = gate();
    state.run.mockImplementation(async () => { await wait.promise; return { path: "p/완성.png", name: "완성" }; });
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration(request);
    await tick();
    draft().scenes[0].cuts = [];
    wait.resolve();
    const failed = await finish(q, accepted.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.result?.paths).toEqual(["p/완성.png"]);
  });
});
