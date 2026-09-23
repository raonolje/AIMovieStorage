import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProjectDraft, newCharacter, newScene, newCut, type ProjectDraft } from "@/lib/projectTypes";
const state = vi.hoisted(() => ({ projects: new Map<string, ProjectDraft>(), run: vi.fn(), upscale: vi.fn(), persist: true, sources: vi.fn(), loadMocap: vi.fn(), bake: vi.fn(), loras: vi.fn() }));
vi.mock("@/lib/controlLoras", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/controlLoras")>(), resolveControlLoras: state.loras }));
vi.mock("@/lib/localEngines", () => ({ LOCAL_ENGINE_IDS: ["qwenimage", "wanvideo", "minimaxh3", "ltx25", "acestep"], LOCAL_ENGINE_CATALOG: { qwenimage: { kind: "image" }, wanvideo: { kind: "video" }, minimaxh3: { kind: "video" }, ltx25: { kind: "video" }, acestep: { kind: "music" } }, listLocalEngines: async () => [] }));
vi.mock("@/lib/mocapStore", () => ({ mocapSourcesOf: state.sources, loadMocapResult: state.loadMocap }));
vi.mock("@/lib/poseFrames", () => ({ bakePoseFrames: state.bake }));
vi.mock("@/lib/upscale", () => ({ UPSCALE_ENGINE_IDS: ["seedvr2"], listEngines: async () => [], upscaleFileToNew: state.upscale }));
vi.mock("@/lib/localOutput", () => ({ runLocalToProject: state.run }));
vi.mock("@/lib/localProjectStore", () => ({ projectFolderName: () => "저장된 작품 폴더" }));
vi.mock("@/lib/projectWrite", () => ({ readProject: (id: string) => state.projects.get(id) ?? null, writeProjectAndConfirm: async (id: string, updater: (current: ProjectDraft) => Partial<ProjectDraft>) => {
  const current = state.projects.get(id)!;
  const next = { ...current, ...updater(current) };
  state.projects.set(id, next);
  return { draft: next, persisted: state.persist, outcome: state.persist ? "written" : "error", why: "시험 저장 오류" };
} }));
vi.mock("@/lib/mediaLibrary", async (importOriginal) => ({
  isVideoFile: (await importOriginal<typeof import("@/lib/mediaLibrary")>()).isVideoFile,
  assetSrc: (path: string) => `asset:${path}`, loadImageForCanvas: vi.fn(), safeFileName: (value: string) => value,
}));
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
  state.loras.mockReset().mockResolvedValue([]);
  state.upscale.mockReset().mockResolvedValue({ path: "p/확대.png" });
  state.sources.mockReset().mockReturnValue([{ id: "pose", name: "동작", resultPath: "p/pose.json", mirror: true }]);
  state.loadMocap.mockReset().mockResolvedValue({ frames: [], mirrored: true });
  state.bake.mockReset().mockResolvedValue({ frames: ["p/pose-1.png", "p/pose-2.png"], fps: 24, seconds: 69.1, sourceStartSeconds: 0, sourceEndSeconds: 69.1 });
  state.projects.set("p", { ...newProjectDraft(), title: "작품", characters: [{ ...newCharacter(), id: "c", name: "주인공" }], scenes: [{ ...newScene(), id: "s", cuts: [{ ...newCut(1), id: "k", images: [{ id: "img", name: "원본", filePath: "p/원본.png", thumb: "", file: null }] }] }] });
});

describe("외부 생성의 저장·취소·재전송", () => {
  it("LTX 두 단계는 최종 크기와 함께 명시 전달하고 다른 엔진에서는 거절한다", async () => {
    const { q, media } = await prepare();
    const options = { ...request.options, ltx_quality: "two-stage", width: 1920, height: 1080, fps: 24, seconds: 5 };
    await expect(media.enqueueControlGeneration({ ...request, options })).rejects.toThrow("LTX 2.5");
    await expect(media.enqueueControlGeneration({ ...request, engine: "ltx25", options: { ...options, ltx_quality: "silent-auto" } })).rejects.toThrow();
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "ltx25", options });
    expect((await finish(q, accepted.jobId)).status).toBe("done");
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining(options) }));
  });

  it("로라 ID만 저장하고 생성 직전 재검증한 경로·세기·트리거를 전달한다", async () => {
    const { q, media } = await prepare();
    const id = `lora-${"a".repeat(64)}`;
    state.loras.mockResolvedValue([{ path: "managed/engine/style.safetensors", weight: 0.5, trigger: "style tag" }]);
    const input = { ...request, loras: [{ id, weight: 0.5 }] };
    const accepted = await media.enqueueControlGeneration(input);
    const done = await finish(q, accepted.jobId);
    expect(done.status).toBe("done");
    expect(state.loras).toHaveBeenCalledTimes(2);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({
      prompt: `style tag, ${request.options.prompt}`, loras: [{ path: "managed/engine/style.safetensors", weight: 0.5, trigger: "style tag" }],
    }) }));
    expect(done.payload).toEqual(input);
    expect(JSON.stringify(done.payload)).not.toContain("managed/");
    expect(done.result?.data).toMatchObject({ loras: [{ id, weight: 0.5 }] });
  });

  it("접수 뒤 사라진 로라는 생성 직전 오류로 끝내며 GPU를 실행하지 않는다", async () => {
    const { q, media } = await prepare();
    state.loras.mockResolvedValueOnce([{ path: "managed/style.safetensors", weight: 1 }])
      .mockRejectedValueOnce(new Error("로라 ID가 사라졌습니다."));
    const accepted = await media.enqueueControlGeneration({ ...request, loras: [{ id: `lora-${"a".repeat(64)}`, weight: 1 }] });
    expect((await finish(q, accepted.jobId)).status).toBe("failed");
    expect(state.run).not.toHaveBeenCalled();
  });

  it("H3 프리셋의 workflow·세기·스텝 충돌을 거절하고 명시 옵션을 보존한다", async () => {
    const { q, media } = await prepare();
    const input = { ...request, engine: "minimaxh3", referenceAssetIds: ["img"],
      loras: [{ id: `lora-${"a".repeat(64)}`, weight: 1 }],
      options: { ...request.options, h3_lora_preset: "lightx2v-ref2va-4step-v0.1", h3_reference_resize_mode: "match", steps: 4 } };
    for (const change of [{ engine: "wanvideo" }, { referenceAssetIds: [] }, { loras: [] },
      { loras: [{ id: input.loras[0].id, weight: 0.5 }] }, { options: { ...input.options, steps: 30 } },
      { options: { ...input.options, h3_reference_resize_mode: "diffusers" } }])
      await expect(media.enqueueControlGeneration({ ...input, ...change })).rejects.toThrow("H3");
    const accepted = await media.enqueueControlGeneration(input);
    expect((await finish(q, accepted.jobId)).status).toBe("done");
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining(input.options) }));
  });

  it("같은 프로젝트의 카메라 레퍼런스와 절대 구간을 윤곽 입력으로 보내고 실제 길이를 보존한다", async () => {
    const { q, media } = await prepare();
    draft().scenes[0].cuts[0].refVideoPath = "p/camera.mp4";
    expect(media.listControlAssets("p")).toContainEqual(expect.objectContaining({ id: "k:refVideoPath", path: "p/camera.mp4", kind: "video" }));
    const structureSource = { assetId: "k:refVideoPath", kind: "canny", sourceStartSeconds: 6, durationSeconds: 5, weight: 0 };
    const meta = { structure_control: { conditioning_frames: 113, conditioning_seconds: 113 / 24, source_start_seconds: 6 } };
    state.run.mockResolvedValue({ path: "p/완성.mp4", name: "완성", meta });
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "ltx25", imageAssetId: "img", structureSource, options: { ...request.options, fps: 24, seconds: 5 } });
    const done = await finish(q, accepted.jobId);
    expect(done.status).toBe("done");
    expect(state.bake).not.toHaveBeenCalled();
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ image: "p/원본.png", structure_control: { path: "p/camera.mp4", kind: "canny", sourceStartSeconds: 6, durationSeconds: 5, weight: 0 }, fps: 24, seconds: 5 }) }));
    expect(done.result?.data).toMatchObject({ structureSource, meta, attached: true });
  });

  it("윤곽 입력은 임의 경로·다른 프로젝트·잘못된 종류·포즈 병용·미지원 엔진을 거절한다", async () => {
    const { media } = await prepare();
    draft().scenes[0].cuts[0].videos.push({ id: "camera", name: "구도", filePath: "p/camera.mp4", thumb: "", file: null });
    const structureSource = { assetId: "camera", kind: "canny", durationSeconds: 5 };
    const base = { ...request, engine: "ltx25", structureSource };
    for (const patch of [{ assetId: "foreign" }, { assetId: "img" }, { path: "C:/outside.mp4" }, { kind: "depth" }, { weight: 1.1 }, { thresholds: { low: 200, high: 92 } }]) {
      await expect(media.enqueueControlGeneration({ ...base, structureSource: { ...structureSource, ...patch } })).rejects.toThrow();
    }
    await expect(media.enqueueControlGeneration({ ...base, poseSource: { sourceId: "pose", personNumber: 1 } })).rejects.toThrow("함께");
    await expect(media.enqueueControlGeneration({ ...base, engine: "wanvideo" })).rejects.toThrow("LTX 2.5");
    await expect(media.enqueueControlGeneration({ ...base, options: { ...request.options, seconds: 6 } })).rejects.toThrow("생성 길이");
    expect(state.run).not.toHaveBeenCalled();
  });
  it.each(["mkv", "avi", "m4v"])("등록된 %s 영상도 앱과 같은 종류로 읽고 레퍼런스로 전달한다", async (extension) => {
    const { q, media } = await prepare();
    const filePath = `p/춤 원본.${extension}`;
    draft().scenes[0].cuts[0].videos.push({ id: "dance", name: "춤 원본", filePath, thumb: "", file: null });
    expect(media.listControlAssets("p").find((asset) => asset.id === "dance")).toMatchObject({ kind: "video", path: filePath });
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "minimaxh3", referenceAssetIds: ["dance"], options: { ...request.options, reference_video_range: "full" } });
    expect((await finish(q, accepted.jobId)).status).toBe("done");
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ references: [{ kind: "video", path: filePath }], reference_video_range: "full" }) }));
  });

  it("H3 영상 구간을 반드시 선택하고 앞 5초 옵션과 실제 입력 길이를 보존한다", async () => {
    const { q, media } = await prepare();
    draft().scenes[0].cuts[0].videos.push({ id: "dance", name: "춤", filePath: "p/춤.mp4", thumb: "", file: null });
    const videoRequest = { ...request, engine: "minimaxh3", referenceAssetIds: ["dance"] };
    await expect(media.enqueueControlGeneration(videoRequest)).rejects.toThrow("앞 5초 또는 전체");
    await expect(media.enqueueControlGeneration({ ...videoRequest, options: { ...request.options, reference_video_range: "unknown" } })).rejects.toThrow();
    await expect(media.enqueueControlGeneration({ ...request, options: { ...request.options, reference_video_range: "first5s" } })).rejects.toThrow("H3 영상");
    expect(state.run).not.toHaveBeenCalled();
    const reference_videos = [{ range: "first5s", decoded_seconds: 5, conditioning_seconds: 5, conditioning_frames: 120 }];
    state.run.mockResolvedValue({ path: "p/완성.mp4", name: "완성", meta: { reference_videos } });
    const accepted = await media.enqueueControlGeneration({ ...videoRequest, options: { ...request.options, reference_video_range: "first5s" } });
    const done = await finish(q, accepted.jobId);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ reference_video_range: "first5s" }) }));
    expect(done.result?.data).toMatchObject({ meta: { reference_videos } });
  });

  it("생성 조건을 전달하고 현재 컷에 결과를 저장한 뒤 작업 결과를 남긴다", async () => {
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "minimaxh3", imageAssetId: "img", referenceAssetIds: ["img"] });
    const done = await finish(q, accepted.jobId);
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ engine: "minimaxh3", projectName: "저장된 작품 폴더", kind: "video", opts: expect.objectContaining({ prompt: "숲 속 여행자", seed: 123, image: "p/원본.png", references: [{ kind: "image", path: "p/원본.png" }] }) }));
    expect(done.status).toBe("done");
    expect(done.result).toMatchObject({ paths: ["p/완성.png"], data: { attached: true } });
    expect(done.result?.assetIds?.[0]).toBe(draft().scenes[0].cuts[0].videos[0].id);
  });

  it("저장된 모캡을 출력 FPS로 굽고 세기 0도 워커에 전달합니다", async () => {
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "ltx25", options: { ...request.options, fps: 24 }, poseSource: { sourceId: "pose", personNumber: 1, weight: 0 } });
    expect((await finish(q, accepted.jobId)).status).toBe("done");
    expect(state.bake).toHaveBeenCalledWith(expect.objectContaining({ fps: 24, personNumber: 1, sourceStartSeconds: undefined, durationSeconds: undefined }));
    expect(state.bake.mock.calls[0][0]).not.toHaveProperty("mirror");
    expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ control: { kind: "pose", frames: ["p/pose-1.png", "p/pose-2.png"], fps: 24, weight: 0 } }) }));
  });

  it("생성 길이와 별개로 지정한 원본 구간을 굽고 실제 구간을 결과에 남깁니다", async () => {
    const { q, media } = await prepare();
    state.bake.mockResolvedValue({ frames: ["p/pose-1.png", "p/pose-2.png"], fps: 24,
      seconds: 5, sourceStartSeconds: 6, sourceEndSeconds: 11 });
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "ltx25",
      options: { ...request.options, fps: 24, seconds: 5 },
      poseSource: { sourceId: "pose", personNumber: 1, sourceStartSeconds: 6, durationSeconds: 5 } });
    const done = await finish(q, accepted.jobId);
    expect(done.status).toBe("done");
    expect(state.bake).toHaveBeenCalledWith(expect.objectContaining({ sourceStartSeconds: 6, durationSeconds: 5, fps: 24 }));
    expect(done.result?.data).toMatchObject({ poseSource: { sourceStartSeconds: 6, sourceEndSeconds: 11,
      durationSeconds: 5, fps: 24, frameCount: 2, mirrored: true } });
  });

  it("구간을 생략한 기존 요청은 options.seconds로 조용히 자르지 않습니다", async () => {
    const { q, media } = await prepare();
    const accepted = await media.enqueueControlGeneration({ ...request, engine: "ltx25",
      options: { ...request.options, seconds: 5 }, poseSource: { sourceId: "pose", personNumber: 1 } });
    expect((await finish(q, accepted.jobId)).result?.data).toMatchObject({ poseSource: { durationSeconds: 69.1 } });
    expect(state.bake).toHaveBeenCalledWith(expect.objectContaining({ sourceStartSeconds: undefined, durationSeconds: undefined }));
  });

  it("선택 범위가 잘못되면 로컬 GPU 생성을 시작하지 않습니다", async () => {
    const { q, media } = await prepare();
    const base = { ...request, engine: "ltx25", poseSource: { sourceId: "pose", personNumber: 1 } };
    for (const extra of [{ sourceStartSeconds: -1 }, { durationSeconds: 0 }, { durationSeconds: Infinity }])
      await expect(media.enqueueControlGeneration({ ...base, poseSource: { ...base.poseSource, ...extra } })).rejects.toThrow();
    state.bake.mockRejectedValue(new Error("포즈 구간이 모캡 분석 범위를 벗어났습니다."));
    const accepted = await media.enqueueControlGeneration({ ...base, poseSource: { ...base.poseSource, sourceStartSeconds: 68, durationSeconds: 5 } });
    expect((await finish(q, accepted.jobId)).status).toBe("failed");
    expect(state.run).not.toHaveBeenCalled();
  });

  it("받지 않는 모캡·레퍼런스와 다른 프로젝트의 모캡은 생성 전에 거절합니다", async () => {
    const { media } = await prepare();
    await expect(media.enqueueControlGeneration({ ...request, engine: "wanvideo", poseSource: { sourceId: "pose", personNumber: 1 } })).rejects.toThrow("모캡");
    await expect(media.enqueueControlGeneration({ ...request, referenceAssetIds: ["img"] })).rejects.toThrow("레퍼런스");
    await expect(media.enqueueControlGeneration({ ...request, engine: "ltx25", poseSource: { sourceId: "foreign", personNumber: 1 } })).rejects.toThrow("현재 프로젝트");
    expect(state.run).not.toHaveBeenCalled();
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
