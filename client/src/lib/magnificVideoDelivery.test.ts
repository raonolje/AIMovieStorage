import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMagnificCatalog } from "./magnificCatalog";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), compose: vi.fn(), remember: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/llm", () => ({ isDesktopApp: () => false }));
vi.mock("@/lib/mediaLibrary", () => ({ safeFileName: (s: string) => s, saveProjectMediaAsset: vi.fn(), composeMagnificAuto: mocks.compose }));
vi.mock("@/lib/magnificBridge", () => ({ rememberMagnificSend: mocks.remember }));
vi.mock("@/lib/magnificModels", () => ({ loadMagnificModels: async () => returnedModels }));
import { generateWithMagnific } from "./magnificMcp";
import { composeInMagnific } from "./magnificCompose";

const models = parseMagnificCatalog(readFileSync(new URL("./__fixtures__/magnific-video-catalog.toon", import.meta.url), "utf8"));
let returnedModels = models;
const base = { kind: "video" as const, projectName: "시험", assetType: "scene-video" as const, ownerName: "컷", stem: "cut", extension: "mp4" };

describe("Magnific 전송 직전 거절", () => {
  beforeEach(() => { vi.clearAllMocks(); returnedModels = models; });

  it("영상 미지원·알 수 없는 모델은 유료 생성 명령을 호출하지 않는다", async () => {
    for (const slug of ["kling-30", "unknown-model"]) {
      await expect(generateWithMagnific({ ...base, args: { slug, references: [{ type: "video", url: "clip" }] } })).rejects.toThrow();
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("지원 모델의 영상 입력은 영상 그대로 보내며 중간에 첫 프레임으로 바꾸지 않는다", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "magnific_generate_details") return { identifier: "job", response: { identifier: "job" } };
      if (command === "magnific_wait") return { failed: true, message: "시험 종료" };
      throw new Error("허용하지 않은 시험 호출");
    });
    const references = [{ type: "video", url: "clip" }, { type: "image", url: "person" }];
    await expect(generateWithMagnific({ ...base, args: { slug: "seedance-2-5-pro", references } })).rejects.toThrow("시험 종료");
    expect(mocks.invoke).toHaveBeenCalledWith("magnific_generate_details", { kind: "video", args: { slug: "bytedance-seedance-pro-2.5", references } });
    expect(mocks.invoke.mock.calls[0][1].args).not.toHaveProperty("keyframes");
  });

  it("검증된 Motion Control의 시작 그림과 참조 영상을 제거·변환 없이 생성 명령으로 보낸다", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "magnific_generate_details") return { identifier: "job", response: { identifier: "job" } };
      if (command === "magnific_wait") return { failed: true, message: "시험 종료" };
      throw new Error("허용하지 않은 시험 호출");
    });
    const args = { slug: "kling-motion-control-30", duration: 15, resolution: "1080p",
      keyframes: { start: { type: "image", url: "start-image" } }, references: [{ type: "video", url: "motion-video" }] };
    const before = JSON.stringify(args);
    await expect(generateWithMagnific({ ...base, args })).rejects.toThrow("시험 종료");
    expect(mocks.invoke).toHaveBeenCalledWith("magnific_generate_details", { kind: "video", args });
    expect(JSON.stringify(args)).toBe(before);
  });

  it("데스크톱 모델 대응이 없거나 영상 미지원이면 캔버스 구성도 호출하지 않는다", async () => {
    const input = { kind: "video" as const, prompt: "따라 걷기", referencePaths: ["clip.mp4"] };
    await expect(composeInMagnific({ ...input, requestedVideoModel: "kling-3.0" })).rejects.toThrow(/기본 모델로 바꾸지/);
    await expect(composeInMagnific({ ...input, model: "kling-30" })).rejects.toThrow(/video/);
    expect(mocks.compose).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("15초 데스크톱 구성은 같은 길이·프롬프트·참조를 그대로 보낸다", async () => {
    const prompt = "군무 0–15초와 마지막 카메라 리빌까지 유지";
    const references = ["camera.mp4", "group.png"];
    await composeInMagnific({ kind: "video", prompt, referencePaths: references,
      model: "seedance-2-5-pro", requestedVideoModel: "seedance-2.5", seconds: 15 });
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({ prompt, paths: references, durationSeconds: 15, resolution: "1080p" }));
  });

  it("720p 구성은 카탈로그 검사와 실제 생성기 인자에 같은 해상도를 쓴다", async () => {
    const model = models.find(item => item.slug === "bytedance-seedance-pro-2.5")!;
    returnedModels = [{ ...model, details: { ...model.details, references: [
      { type: "video", allowed: true, limit: 1, prohibitedIf: { resolution: ["1080p"] } },
      { type: "image", allowed: true, limit: 9 },
    ] } }];
    const input = { kind: "video" as const, prompt: "군무 유지", referencePaths: ["camera.mp4", "group.png"],
      model: "seedance-2-5-pro", requestedVideoModel: "seedance-2.5", seconds: 15 };
    await composeInMagnific({ ...input, videoResolution: "720p" });
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({ resolution: "720p", durationSeconds: 15, paths: input.referencePaths }));
    mocks.compose.mockClear();
    await expect(composeInMagnific({ ...input, videoResolution: "1080p" })).rejects.toThrow(/해상도/);
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it("전체 69초와 지원되지 않는 프레임 길이는 구성 전에 거절하고 전송 내용을 자르지 않는다", async () => {
    for (const seconds of [69.134, 113 / 24]) {
      await expect(composeInMagnific({ kind: "video", prompt: "원본 안무 유지", referencePaths: ["camera.mp4", "group.png"],
        model: "seedance-2-5-pro", requestedVideoModel: "seedance-2.5", seconds,
        owner: { kind: "cut", cutId: "c", name: "시험 컷" } })).rejects.toThrow(/구간|길이/);
    }
    expect(mocks.compose).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });
});
