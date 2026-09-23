import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), measure: vi.fn(), warning: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("./llm", () => ({ isDesktopApp: () => false }));
vi.mock("./mediaLibrary", () => ({ safeFileName: (value: string) => value, saveProjectMediaAsset: mock.save, assetSrc: (path: string) => path }));
vi.mock("./magnificModels", () => ({ loadMagnificModels: async () => [] }));
vi.mock("sonner", () => ({ toast: { warning: mock.warning } }));
vi.mock("./magnificGenerationMetadata", async importOriginal => ({
  ...await importOriginal<typeof import("./magnificGenerationMetadata")>(), measureMagnificMedia: mock.measure,
}));
import { generateWithMagnific } from "./magnificMcp";
const input = { kind: "image" as const, args: { mode: "nano-pro", aspectRatio: "2:1" },
  projectName: "작품", assetType: "scene-cut" as const, ownerName: "장면", stem: "그림", extension: "png" };
beforeEach(() => {
  vi.clearAllMocks();
  mock.save.mockResolvedValue({ path: "project/image.png", name: "image" });
  mock.measure.mockResolvedValue({ status: "measured", width: 5504, height: 3072 });
  mock.invoke.mockImplementation(async (command: string) => {
    if (command === "magnific_generate_details") return { identifier: "job", response: { identifier: "job", modelNotice: "서버 모델 변경 안내", models: [{ requested: "2:1", accepted: "16:9" }] } };
    if (command === "magnific_wait") return { done: true, url: "https://example.invalid/image.png", failed: false, response: { width: 5504, height: 3072 } };
    if (command === "magnific_download") return "project/image.png";
    throw new Error(`시험에서 허용하지 않은 명령: ${command}`);
  });
});

describe("Magnific 접수 메타데이터 전달", () => {
  it("한 번만 생성하고 접수 직후·다운로드 후 기록하며 요청값과 파일 실측을 섞지 않는다", async () => {
    const updates: unknown[] = [];
    const result = await generateWithMagnific({ ...input, onMetadata: (metadata, path) => updates.push(JSON.parse(JSON.stringify({ metadata, path }))) });
    expect(mock.invoke.mock.calls.filter(call => call[0].startsWith("magnific_generate"))).toHaveLength(1);
    expect(updates[0]).toMatchObject({ metadata: { accepted: { identifier: "job" }, measured: { status: "pending" } } });
    expect(updates.at(-1)).toMatchObject({ path: "project/image.png", metadata: { measured: { width: 5504, height: 3072 } } });
    expect(result.metadata.requested.args.aspectRatio).toBe("2:1");
    expect(result.metadata.accepted.response).toMatchObject({ models: [{ accepted: "16:9" }] });
    expect(result.metadata.completion).toEqual({ width: 5504, height: 3072 });
    expect(result.metadata.notices).toContain("서버 모델 변경 안내");
    expect(result.metadata.notices.join(" ")).toContain("5504×3072");
    expect(mock.warning).toHaveBeenCalledTimes(2);
  });

  it("상세 응답 유실은 구형 생성 명령으로 재시도하지 않는다", async () => {
    mock.invoke.mockRejectedValue(new Error("접수 뒤 연결 끊김"));
    await expect(generateWithMagnific(input)).rejects.toThrow("접수 뒤 연결 끊김");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0][0]).toBe("magnific_generate_details");
  });

  it("측정 실패는 파일을 잃거나 요청 크기로 성공한 것처럼 채우지 않는다", async () => {
    mock.measure.mockRejectedValue(new Error("메타데이터를 읽지 못함"));
    const result = await generateWithMagnific(input);
    expect(result.path).toBe("project/image.png");
    expect(result.metadata.measured).toEqual({ status: "unavailable" });
    expect(result.metadata.notices.join(" ")).toContain("확인한 상태가 아닙니다");
  });
});
