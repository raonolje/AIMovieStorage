import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const port = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn(), release: vi.fn(), bytes: 0, exists: true }));
vi.mock("@/lib/mediaLibrary", () => ({
  safeFileName: (value: string) => value,
  saveProjectMediaAsset: port.save,
  releaseEmptyProjectAsset: port.release,
}));
vi.mock("@/lib/localEngines", () => ({ runLocal: port.run }));

const path = "시험 작품/character/서아/서아_로컬_001.png";
const output = "시험 작품/character/서아/서아_로컬_001_001.png";
const input = { engine: "qwenimage" as const, extension: "png", kind: "image" as const,
  projectName: "시험 작품", assetType: "character-generated" as const, ownerName: "서아", stem: "서아", opts: { prompt: "시험" } };

beforeEach(() => {
  vi.resetModules();
  port.save.mockReset().mockResolvedValue({ path });
  port.run.mockReset().mockResolvedValue({ output, seconds: 2, meta: { precision: "int8" } });
  port.bytes = 0; port.exists = true;
  port.release.mockReset().mockImplementation(async () => {
    if (!port.exists || port.bytes !== 0) return false;
    port.exists = false;
    return true;
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("로컬 생성의 빈 예약 파일 정리", () => {
  it("엔진 시작이 실패해도 첫 자리를 해제하고 원래 오류를 돌려준다", async () => {
    const error = new Error("모델을 올리지 못했습니다");
    port.run.mockRejectedValue(error);
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).rejects.toBe(error);
    expect(port.save.mock.calls[0][0].size).toBe(0);
    expect(port.release).toHaveBeenCalledWith(input.projectName, path);
    expect(port.exists).toBe(false);
  });

  it("취소도 첫 예약을 해제하며 취소 오류를 유지한다", async () => {
    const error = new DOMException("취소했습니다", "AbortError");
    port.run.mockRejectedValue(error);
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).rejects.toBe(error);
    expect(port.exists).toBe(false);
  });

  it("다른 경로에 성공하면 첫 자리만 해제하고 실제 결과와 정보를 반환한다", async () => {
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).resolves.toEqual({ path: output, name: "서아_로컬_001_001", seconds: 2, meta: { precision: "int8" } });
    expect(port.release).toHaveBeenCalledWith(input.projectName, path);
    expect(port.release).not.toHaveBeenCalledWith(input.projectName, output);
  });

  it("첫 자리에 결과를 썼으면 정리를 요청하지 않는다", async () => {
    port.run.mockResolvedValue({ output: path, seconds: 2 });
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).resolves.toMatchObject({ path });
    expect(port.release).not.toHaveBeenCalled();
    expect(port.exists).toBe(true);
  });

  it("실패 때 첫 자리에 이미 내용이 생겼다면 빈 파일 해제 규칙으로 보존한다", async () => {
    port.run.mockImplementation(async () => { port.bytes = 120; throw new Error("응답 유실"); });
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).rejects.toThrow("응답 유실");
    expect(port.release).toHaveBeenCalledOnce();
    expect(port.exists).toBe(true);
  });

  it("정리 실패가 원래 엔진 오류를 덮지 않는다", async () => {
    const error = new Error("원래 엔진 오류");
    port.run.mockRejectedValue(error);
    port.release.mockRejectedValue(new Error("정리 권한 없음"));
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).rejects.toBe(error);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("정리 실패가 이미 만들어진 결과를 실패로 바꾸지 않는다", async () => {
    port.release.mockRejectedValue(new Error("정리 권한 없음"));
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).resolves.toMatchObject({ path: output });
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("자리 자체를 만들지 못하면 생성과 정리를 요청하지 않는다", async () => {
    port.save.mockResolvedValue(null);
    const { runLocalToProject } = await import("./localOutput");
    await expect(runLocalToProject(input)).rejects.toThrow("결과를 놓을 자리");
    expect(port.run).not.toHaveBeenCalled();
    expect(port.release).not.toHaveBeenCalled();
  });
});
