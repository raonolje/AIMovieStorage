import { afterEach, describe, expect, it, vi } from "vitest";
import { waitVideoFrameEvent } from "./videoFrameWait";

afterEach(() => vi.useRealTimers());
describe("몸·손 분석의 영상 프레임 대기", () => {
  it.each(["loadeddata", "seeked"] as const)("%s가 오지 않아도 취소로 끝나고 구독과 타이머를 정리합니다", async event => {
    vi.useFakeTimers();
    const video = new EventTarget() as HTMLVideoElement;
    const remove = vi.spyOn(video, "removeEventListener");
    const abort = new AbortController();
    const waiting = waitVideoFrameEvent(video, event, () => {}, abort.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await rejected;
    expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("이미 취소한 요청은 영상 조작을 시작하지 않습니다", async () => {
    const abort = new AbortController(); abort.abort(); const action = vi.fn();
    await expect(waitVideoFrameEvent(new EventTarget() as HTMLVideoElement, "loadeddata", action, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(action).not.toHaveBeenCalled();
  });
  it("깨진 영상은 제한 시간 뒤 실패하고 정상 이벤트는 즉시 끝납니다", async () => {
    vi.useFakeTimers(); const video = new EventTarget() as HTMLVideoElement;
    const failed = expect(waitVideoFrameEvent(video, "seeked", () => {})).rejects.toThrow("영상 프레임");
    await vi.advanceTimersByTimeAsync(20_000); await failed;
    await waitVideoFrameEvent(video, "loadeddata", () => { video.dispatchEvent(new Event("loadeddata")); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
