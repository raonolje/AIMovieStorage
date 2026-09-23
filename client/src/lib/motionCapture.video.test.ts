import { afterEach, describe, expect, it, vi } from "vitest";
import { captureVideo } from "./motionCapture";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture(onSeek?: (video: EventTarget, time: number) => void) {
  const video = new EventTarget() as HTMLVideoElement;
  let time = 0;
  const seen: number[] = [];
  Object.assign(video, { videoWidth: 100, videoHeight: 100, duration: 0.3 });
  Object.defineProperty(video, "currentTime", { get: () => time, set: (next: number) => {
    time = next;
    if (onSeek) onSeek(video, next); else video.dispatchEvent(new Event("seeked"));
  } });
  const context = { drawImage: () => { seen.push(time); } };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
  const detector = { people: vi.fn(() => []), pose: vi.fn() };
  return { video, seen, detector };
}
describe("몸 영상 프레임 읽기의 정상·취소 경계", () => {
  it("정상 영상은 같은 첫 프레임을 포함해 원래 시각대로 읽고 결과 메타데이터를 유지합니다", async () => {
    const { video, seen, detector } = fixture();
    const capture = await captureVideo(video, detector, { fps: 10, mirror: true });
    expect(seen).toEqual([0, 0.1, 0.2]);
    expect(detector.people).toHaveBeenCalledTimes(3);
    expect(capture).toMatchObject({ width: 100, height: 100, duration: 0.3, fps: 10, start: 0, end: 0.3, engine: "mediapipe", mirrored: true });
  });
  it("다음 프레임 읽기 중 취소하면 그 프레임을 검출하거나 부분 결과를 반환하지 않습니다", async () => {
    const abort = new AbortController();
    const { video, seen, detector } = fixture(() => abort.abort());
    await expect(captureVideo(video, detector, { fps: 10, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([0]); expect(detector.people).toHaveBeenCalledTimes(1);
  });
});
