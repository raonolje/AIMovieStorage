/** 몸·손 검출이 같은 방식으로 영상 읽기 실패와 취소를 처리합니다. 영상을 조작하기 전에 구독합니다. */
export function waitVideoFrameEvent(video: HTMLVideoElement, event: "loadeddata" | "seeked", action: () => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", failed); signal?.removeEventListener("abort", cancelled); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("영상 프레임을 읽지 못했습니다. 코덱과 파일 상태를 확인해 주세요.")); };
    const cancelled = () => { cleanup(); reject(new DOMException("취소", "AbortError")); };
    timer = setTimeout(failed, 20_000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) { cancelled(); return; }
    try { action(); } catch (error) { cleanup(); reject(error); }
  });
}
