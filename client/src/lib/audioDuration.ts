import { assetSrc } from "./mediaLibrary";

/** 화면과 조종기가 같은 파일 길이를 사용해야 구간·영상 음원의 시각이 어긋나지 않습니다. */
export function measureAudioSeconds(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = document.createElement("audio");
    let done = false;
    const finish = (seconds?: number) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      probe.removeAttribute("src");
      probe.load();
      if (seconds && Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(new Error("음원 길이를 읽지 못했습니다."));
    };
    const timeout = setTimeout(() => finish(), 15_000);
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => finish(probe.duration), { once: true });
    probe.addEventListener("error", () => finish(), { once: true });
    probe.src = assetSrc(path);
  });
}
