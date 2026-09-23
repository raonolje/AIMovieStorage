import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoFrameRenderer } from "@/components/composition/CompositionViewport";
import type { ReferenceVideoOptions } from "./referenceVideo";

const mocks = vi.hoisted(() => ({ save: vi.fn(), encode: vi.fn() }));
vi.mock("./mediaLibrary", () => ({ saveProjectMediaAsset: mocks.save }));
vi.mock("./referenceVideo", async importOriginal => ({
  ...await importOriginal<typeof import("./referenceVideo")>(), renderReferenceVideo: mocks.encode,
}));
import { exportReferenceVideoFiles } from "./referenceVideoExport";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ path: "project/reference.mp4" });
  mocks.encode.mockImplementation(async (options: ReferenceVideoOptions) => {
    const count = Math.round(options.duration * options.fps);
    for (let i = 0; i < count; i++) {
      await options.drawFrame(i / options.fps, i);
      options.onProgress?.(i + 1, count);
    }
    return { blob: new Blob(["mp4"]), frameCount: count, codec: "avc1" };
  });
});
function fixture() {
  const renderer: VideoFrameRenderer = {
    canvas: {} as HTMLCanvasElement, begin: vi.fn(), end: vi.fn(),
    prepareAt: vi.fn(async () => {}), drawAt: vi.fn(),
  };
  return { renderer, currentRenderer: () => renderer, projectName: "작품", sceneTitle: "장면", cutOrder: 2,
    width: 1920, height: 1080, duration: 2, fps: 2, requireProject: true };
}

describe("UI와 MCP가 공유하는 레퍼런스 영상 저장", () => {
  it("조각 경계를 정확한 프레임 시각으로 준비하고 저장 ack 뒤에 끝낸다", async () => {
    const f = fixture();
    const sequence: string[] = [];
    f.renderer.prepareAt = vi.fn(async time => { sequence.push(`준비:${time}`); });
    f.renderer.drawAt = vi.fn(time => { sequence.push(`그림:${time}`); });
    const onSaved = vi.fn(async () => { await Promise.resolve(); sequence.push("저장확인"); });
    const progress = vi.fn();
    const videos = await exportReferenceVideoFiles({ ...f, splitSeconds: 1, onSaved, onProgress: progress });
    expect(sequence).toEqual(["준비:0", "그림:0", "준비:0.5", "그림:0.5", "저장확인", "준비:1", "그림:1", "준비:1.5", "그림:1.5", "저장확인"]);
    expect(videos.map(video => [video.frameCount, video.seconds, video.part])).toEqual([[2, 1, "1/2"], [2, 1, "2/2"]]);
    expect(mocks.save.mock.calls.map(args => args[0].name)).toEqual(["장면_cut02_reference_part01_0s-1s.mp4", "장면_cut02_reference_part02_1s-2s.mp4"]);
    expect(progress).toHaveBeenLastCalledWith(4, 4);
    expect(f.renderer.begin).toHaveBeenCalledWith(1920, 1080);
    expect(f.renderer.end).toHaveBeenCalledOnce();
  });

  it("배경 영상 seek 대기 도중 렌더러가 교체되면 한 장도 그리거나 저장하지 않는다", async () => {
    const f = fixture();
    let current: VideoFrameRenderer | null = f.renderer;
    f.renderer.prepareAt = vi.fn(async () => { current = null; });
    await expect(exportReferenceVideoFiles({ ...f, currentRenderer: () => current })).rejects.toThrow("다시 만들어졌습니다");
    expect(f.renderer.drawAt).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(f.renderer.end).toHaveBeenCalledOnce();
  });

  it("파일을 쓴 뒤 저장 ack가 실패해도 경로를 먼저 기록하고 성공하지 않는다", async () => {
    const f = fixture();
    const fileSaved = vi.fn();
    await expect(exportReferenceVideoFiles({ ...f, onFileSaved: fileSaved, onSaved: async () => { throw new Error("디스크 실패"); } })).rejects.toThrow("디스크 실패");
    expect(fileSaved).toHaveBeenCalledWith(expect.objectContaining({ path: "project/reference.mp4", seconds: 2 }));
    expect(f.renderer.end).toHaveBeenCalledOnce();
  });

  it("취소 또는 파일 저장 실패는 다운로드로 우회하거나 완료로 알리지 않는다", async () => {
    const f = fixture();
    const abort = new AbortController();
    f.renderer.prepareAt = vi.fn(async () => { abort.abort(); });
    await expect(exportReferenceVideoFiles({ ...f, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue(null);
    const next = fixture();
    await expect(exportReferenceVideoFiles(next)).rejects.toThrow("프로젝트 폴더에 저장하지 못했습니다");
    expect(next.renderer.end).toHaveBeenCalledOnce();
  });
});
