import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  newProjectDraft,
  newScene,
  newCut,
  newCharacter,
  newBackground,
  type ProjectDraft,
} from "./projectTypes";
import { parseMagnificCatalog } from "./magnificCatalog";

const state = vi.hoisted(() => ({
  draft: null as ProjectDraft | null,
  revision: "r1",
  base: "/library",
  native: vi.fn(),
  remember: vi.fn(),
  catalog: vi.fn(),
  write: vi.fn(),
  saved: null as unknown,
}));
vi.mock("./projectControl", () => ({
  getProjectSnapshot: async () => ({ revision: state.revision }),
  ProjectControlError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  },
}));
vi.mock("./projectWrite", () => ({
  readProject: (id: string) => (id === "p" ? state.draft : null),
}));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "작품" }));
vi.mock("./mediaLibrary", () => ({
  safeFileName: (value: string) => value,
  getMediaLibrarySettings: () => ({ baseDirectory: state.base }),
  composeMagnificAuto: async (input: {
    beforeCompose?: () => Promise<void>;
  }) => {
    await input.beforeCompose?.();
    return state.native(input);
  },
}));
vi.mock("./magnificBridge", () => ({ rememberMagnificSend: state.remember }));
vi.mock("./magnificModels", () => ({ loadMagnificModels: state.catalog }));
vi.mock("./llmActivity", () => ({ abandonLlmResumes: vi.fn() }));
const models = parseMagnificCatalog(
  readFileSync(
    new URL("./__fixtures__/magnific-video-catalog.toon", import.meta.url),
    "utf8",
  ),
);
const request = {
  projectId: "p",
  sceneId: "s",
  cutId: "k",
  expectedRevision: "r1",
  kind: "video",
  videoResolution: "720p",
};
const tick = () => new Promise<void>((done) => setTimeout(done, 0));
const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
};
const cut = () => state.draft!.scenes[0].cuts[0];
async function prepare() {
  const q = await import("./taskQueue");
  await q.registerTaskJournal({
    read: async () => state.saved as never,
    write: state.write,
  });
  const control = await import("./controlMagnific");
  return { q, control };
}
async function finish(q: Awaited<ReturnType<typeof prepare>>["q"], id: string) {
  for (let count = 0; count < 50; count++) {
    await tick();
    const task = q.getTask(id)!;
    if (task.status !== "running" && task.status !== "waiting") {
      await q.flushTaskJournal();
      return task;
    }
  }
  throw new Error("시험 작업이 끝나지 않았습니다.");
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", memory());
  state.revision = "r1";
  state.base = "/library";
  state.saved = null;
  state.native.mockReset().mockResolvedValue("보드에 구성했습니다.");
  state.remember.mockReset();
  state.catalog.mockReset().mockResolvedValue(models);
  state.write.mockReset().mockImplementation(async (value) => {
    state.saved = JSON.parse(JSON.stringify(value));
  });
  state.draft = {
    ...newProjectDraft(),
    title: "작품",
    magnific: { videoModel: "seedance-2.5" },
    characters: ["서아", "미나", "유나", "하린", "지유"].map((name, index) => ({
      ...newCharacter(),
      id: `c${index}`,
      name,
      generatedImages: index
        ? []
        : [{ id: "sheet", name: "인물", filePath: "/library/작품/인물.png" }],
    })),
    backgrounds: [
      { ...newBackground(), id: "b", name: "무대", generatedImages: [] },
    ],
    scenes: [
      {
        ...newScene(),
        id: "s",
        cuts: [
          {
            ...newCut(1),
            id: "k",
            backgroundId: "b",
            characterIds: ["c0", "c1", "c2", "c3", "c4"],
            guideImagePath: "/library/작품/구도.png",
            plateImagePath: "/library/작품/배경.png",
            refVideoPath: "/library/작품/구도영상.mp4",
            refVideoSeconds: 15,
            images: [
              {
                id: "hero",
                name: "그룹",
                filePath: "/library/작품/그룹.png",
                isPrimary: true,
              },
            ],
            promptEn: "One finished image of the group.",
            videoPromptEn:
              "Follow camera cuts and dance timing.\n\nNot yet generated: 미나 / 유나 / 하린 / 지유",
          },
        ],
      },
    ],
  };
});

describe("Magnific 데스크톱 조종의 미리보기와 실행", () => {
  it("본문 그대로 모드는 명시 본문만 전송하고 Unicode 글자·공백 단어 수를 재며 참조·해상도 검사는 유지한다", async () => {
    const { q, control } = await prepare();
    await expect(
      control.previewControlMagnific({ ...request, promptMode: "exact" }),
    ).rejects.toThrow("prompt를 직접");
    const prompt = "5인 💃\nFollow @구도영상. Keep @그룹.";
    const preview = await control.previewControlMagnific({
      ...request,
      promptMode: "exact",
      prompt,
    });
    expect(preview.prompt).toBe(prompt);
    expect(preview.promptCharacters).toBe(Array.from(prompt).length);
    expect(preview.promptWords).toBe(6);
    expect(preview.metrics).toMatchObject({
      utf8Bytes: new TextEncoder().encode(prompt).length,
      characterCountMethod: "unicode_code_points",
    });
    expect(preview.references).toHaveLength(5);
    expect(preview.references[0].tag).toBe("@구도영상");
    const job = await control.enqueueControlMagnific({
      projectId: "p",
      expectedRevision: "r1",
      previewId: preview.previewId,
      operationId: "exact",
    });
    expect((await finish(q, job.jobId)).status).toBe("done");
    expect(state.native).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt,
        resolution: "720p",
        durationSeconds: 15,
      }),
    );
    cut().refVideoSeconds = 69;
    await expect(
      control.previewControlMagnific({
        ...request,
        promptMode: "exact",
        prompt,
      }),
    ).rejects.toThrow("최대 30초");
  });

  it("15초·720p·5개 참조를 읽기만으로 미리 보여 주며 본문과 프로젝트를 바꾸지 않는다", async () => {
    const { q, control } = await prepare();
    const original = JSON.stringify(state.draft);
    const preview = await control.previewControlMagnific(request);
    expect(preview).toMatchObject({
      seconds: 15,
      resolution: "720p",
      model: "seedance-2-5-pro",
      paidGeneration: false,
    });
    expect(preview.references.map((ref) => ref.name)).toEqual([
      "구도영상.mp4",
      "그룹.png",
      "구도.png",
      "배경.png",
      "인물.png",
    ]);
    expect(preview.prompt).toContain("representative image @그룹");
    expect(preview.prompt).toContain(
      "Optional individual sheets not attached:",
    );
    expect(preview.prompt).toContain("Follow camera cuts and dance timing.");
    expect(preview.prompt).not.toContain("Not yet generated:");
    expect(state.native).not.toHaveBeenCalled();
    expect(state.remember).not.toHaveBeenCalled();
    expect(q.listTasks()).toHaveLength(0);
    expect(JSON.stringify(state.draft)).toBe(original);
  });

  it("실행은 영속 시작 기록 뒤 같은 native 구성만 한 번 호출하고 재전송은 완료 작업을 돌려준다", async () => {
    const { q, control } = await prepare();
    const preview = await control.previewControlMagnific(request);
    state.native.mockImplementation(async (input) => {
      const journal = state.saved as {
        tasks: Array<{ externalEffectStartedAt?: number }>;
      };
      expect(
        journal.tasks.some((task) => Boolean(task.externalEffectStartedAt)),
      ).toBe(true);
      expect(input).toMatchObject({
        kind: "video",
        resolution: "720p",
        durationSeconds: 15,
        prompt: preview.prompt,
      });
      expect(input.paths).toHaveLength(5);
      return "완료";
    });
    const execution = {
      projectId: "p",
      expectedRevision: "r1",
      previewId: preview.previewId,
      operationId: "op",
    };
    const job = await control.enqueueControlMagnific(execution);
    const done = await finish(q, job.jobId);
    expect(done.status).toBe("done");
    expect(done.externalCheckpoint).toMatchObject({
      phase: "completed",
      paidGeneration: false,
    });
    state.revision = "r2";
    expect(await control.enqueueControlMagnific(execution)).toEqual({
      jobId: job.jobId,
      reused: true,
    });
    expect(state.native).toHaveBeenCalledTimes(1);
    await expect(
      control.enqueueControlMagnific({ ...execution, projectId: "other" }),
    ).rejects.toThrow("다른 내용");
  });

  it("69초·지원하지 않는 모델·다른 작품 경로·미저장 캡처를 보내지 않는다", async () => {
    const { control } = await prepare();
    cut().refVideoSeconds = 69.134;
    await expect(control.previewControlMagnific(request)).rejects.toThrow(
      "최대 30초",
    );
    cut().refVideoSeconds = 15;
    state.draft!.magnific!.videoModel = "seedance-2.0";
    await expect(control.previewControlMagnific(request)).rejects.toThrow(
      "Seedance 2.5",
    );
    state.draft!.magnific!.videoModel = "seedance-2.5";
    cut().refVideoPath = "/library/다른 작품/영상.mp4";
    await expect(control.previewControlMagnific(request)).rejects.toThrow(
      "폴더 밖",
    );
    cut().refVideoPath = "/library/작품/영상.mp4";
    cut().guideImagePath = undefined;
    cut().guideImage = "data:image/png;base64,AA==";
    await expect(control.previewControlMagnific(request)).rejects.toThrow(
      "파일로 저장",
    );
    expect(state.native).not.toHaveBeenCalled();
  });

  it("이미지 구성은 hero·영상을 추가하지 않고 기존 인물·구도·배경만 사용한다", async () => {
    const { control } = await prepare();
    const preview = await control.previewControlMagnific({
      ...request,
      kind: "image",
    });
    expect(preview.references.map((ref) => ref.name)).toEqual([
      "구도.png",
      "배경.png",
      "인물.png",
    ]);
    expect(preview.prompt).toContain("One finished image of the group.");
    expect(preview.seconds).toBeUndefined();
    expect(preview.resolution).toBeUndefined();
  });

  it("미리보기 뒤 수동 수정과 카탈로그 조회 도중 수정 모두 외부 전송 전에 거절한다", async () => {
    const { q, control } = await prepare();
    const preview = await control.previewControlMagnific(request);
    const execution = {
      projectId: "p",
      expectedRevision: "r1",
      previewId: preview.previewId,
      operationId: "stale",
    };
    state.revision = "r2";
    await expect(
      control.enqueueControlMagnific(execution),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    state.revision = "r1";
    state.catalog.mockImplementation(async () => {
      state.revision = "r2";
      return models;
    });
    const job = await control.enqueueControlMagnific(execution);
    expect((await finish(q, job.jobId)).status).toBe("failed");
    expect(state.native).not.toHaveBeenCalled();
  });

  it("외부 전송 후 응답 불명은 재시작·UI 재시도에서도 자동 재업로드하지 않는다", async () => {
    let { q, control } = await prepare();
    const preview = await control.previewControlMagnific(request);
    state.native.mockRejectedValue(new Error("응답을 받지 못했습니다."));
    const job = await control.enqueueControlMagnific({
      projectId: "p",
      expectedRevision: "r1",
      previewId: preview.previewId,
      operationId: "unknown",
    });
    expect((await finish(q, job.jobId)).status).toBe("failed");
    vi.resetModules();
    ({ q, control } = await prepare());
    q.retryTask(job.jobId);
    const retried = await finish(q, job.jobId);
    expect(retried.error).toContain("자동으로 다시 올리지 않습니다");
    expect(retried.externalEffectStartedAt).toBeGreaterThan(0);
    expect(state.native).toHaveBeenCalledTimes(1);
  });

  it("같은 파일 stem과 임의 경로 인자는 미리보기에서 거절한다", async () => {
    const { control } = await prepare();
    cut().refVideoPath = "/library/작품/그룹.mp4";
    await expect(control.previewControlMagnific(request)).rejects.toThrow(
      "파일 이름이 겹칩니다",
    );
    await expect(
      control.previewControlMagnific({
        ...request,
        referencePaths: ["C:/outside.png"],
      }),
    ).rejects.toThrow();
    expect(state.native).not.toHaveBeenCalled();
  });
});
