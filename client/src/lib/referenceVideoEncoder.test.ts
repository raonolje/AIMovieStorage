import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ encode: vi.fn(), frameClose: vi.fn(), close: vi.fn(), flush: vi.fn(), queue: 0 }));
vi.mock("mp4-muxer", () => ({
  ArrayBufferTarget: class { buffer = new ArrayBuffer(0); },
  Muxer: class { addVideoChunk() {} finalize() {} },
}));
import { renderReferenceVideo } from "./referenceVideo";
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mock.queue = 0; mock.flush.mockResolvedValue(undefined);
  class Encoder {
    static isConfigSupported = async () => ({ supported: true });
    state = "configured"; configure() {} encode = mock.encode; flush = mock.flush;
    get encodeQueueSize() { return mock.queue; }
    close() { this.state = "closed"; mock.close(); }
  }
  vi.stubGlobal("window", { VideoEncoder: Encoder }); vi.stubGlobal("VideoEncoder", Encoder);
  vi.stubGlobal("VideoFrame", class { close = mock.frameClose; });
  // 숨겨진 WebView는 이 콜백을 아예 호출하지 않습니다.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const options = () => ({ width: 128, height: 128, fps: 1, duration: 1, drawFrame: async () => ({} as HTMLCanvasElement) });
describe("숨겨진 창의 영상 인코딩과 취소", () => {
  it("rAF가 멈춘 창에서도 타이머로 양보한 뒤 인코딩을 완료한다", async () => {
    const pending = renderReferenceVideo(options());
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ frameCount: 1 });
    expect(mock.encode).toHaveBeenCalledOnce(); expect(mock.frameClose).toHaveBeenCalledOnce(); expect(mock.close).toHaveBeenCalledOnce();
  });
  it("배경 영상 seek 뒤 취소되면 새 프레임을 인코더에 보내지 않는다", async () => {
    const abort = new AbortController();
    await expect(renderReferenceVideo({ ...options(), signal: abort.signal, drawFrame: async () => { abort.abort(); return {} as HTMLCanvasElement; } })).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.encode).not.toHaveBeenCalled(); expect(mock.close).toHaveBeenCalledOnce();
  });
  it("밀린 인코더 큐와 긴 flush도 취소할 수 있고 프레임과 인코더를 닫는다", async () => {
    mock.queue = 9;
    const abort = new AbortController();
    const pending = renderReferenceVideo({ ...options(), signal: abort.signal });
    const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(4); abort.abort(); await vi.runAllTimersAsync(); await stopped;
    expect(mock.frameClose).toHaveBeenCalledOnce(); expect(mock.close).toHaveBeenCalledOnce();
    mock.queue = 0; mock.flush.mockImplementation(() => new Promise(() => {}));
    const duringFlush = new AbortController();
    const second = renderReferenceVideo({ ...options(), signal: duringFlush.signal });
    const flushed = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync(); duringFlush.abort(); await flushed;
    expect(mock.close).toHaveBeenCalledTimes(2);
  });
});
