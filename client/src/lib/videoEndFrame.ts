import { assetSrc, safeFileName, saveProjectMediaAsset } from "./mediaLibrary";

/** 대표영상을 고를 때 실제 마지막 화면을 프로젝트 파일로 보존합니다. */
export async function saveVideoEndFrame(input: {
  videoPath: string;
  projectName: string;
  ownerName: string;
  stem: string;
}): Promise<string> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.crossOrigin = "anonymous";
  const wait = (event: "loadedmetadata" | "loadeddata" | "seeked", ready: () => boolean) => new Promise<void>((resolve, reject) => {
    if (ready()) { resolve(); return; }
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("영상 마지막 프레임 읽기 시간이 초과됐습니다.")); }, 20000);
    const cleanup = () => { window.clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("대표영상의 마지막 프레임을 읽지 못했습니다.")); };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
  try {
    video.src = assetSrc(input.videoPath);
    await wait("loadedmetadata", () => video.readyState >= HTMLMediaElement.HAVE_METADATA);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight)
      throw new Error("대표영상의 길이 또는 크기를 읽지 못했습니다.");
    const position = Math.max(0, video.duration - 0.08);
    if (Math.abs(video.currentTime - position) > 0.001) {
      video.currentTime = position;
      await wait("seeked", () => !video.seeking && Math.abs(video.currentTime - position) < 0.001);
    }
    await wait("loadeddata", () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("영상 프레임을 그릴 수 없습니다.");
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("영상 마지막 프레임을 PNG로 저장하지 못했습니다.");
    const stem = `${safeFileName(input.stem)}_마지막프레임`;
    const saved = await saveProjectMediaAsset(new File([blob], `${stem}.png`, { type: "image/png" }), {
      projectName: input.projectName, assetType: "scene-cut", ownerName: input.ownerName, stem,
    });
    if (!saved) throw new Error("프로젝트 저장 폴더에 마지막 프레임을 저장하지 못했습니다.");
    return saved.path;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}
