import { t } from "./i18n";
import type { VideoFrameRenderer } from "@/components/composition/CompositionViewport";
import { renderReferenceVideo, splitParts } from "./referenceVideo";
import { saveProjectMediaAsset } from "./mediaLibrary";

export interface CompositionVideoOptions {
  width: number;
  height: number;
  duration: number;
  fps: number;
}
export interface SavedReferenceVideo extends CompositionVideoOptions {
  path: string;
  seconds: number;
  frameCount: number;
  codec: string;
  part?: string;
}
export interface CompositionVideoControls {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** 기다리는 동안 편집·닫기·취소가 일어났으면 파일을 붙이기 전에 멈춥니다. */
  assertCurrent?: () => void;
  onFileSaved?: (video: SavedReferenceVideo) => void;
}

/** UI와 외부 조종기가 같은 프레임·파일 저장 경로를 씁니다. 후속 프로젝트 저장은 호출자가 확인합니다. */
export async function exportReferenceVideoFiles(options: CompositionVideoOptions & CompositionVideoControls & {
  renderer: VideoFrameRenderer;
  currentRenderer: () => VideoFrameRenderer | null;
  projectName?: string;
  sceneTitle?: string;
  cutOrder?: number;
  shotLabel?: string | null;
  splitSeconds?: number | number[] | null;
  requireProject?: boolean;
  onSaved?: (video: SavedReferenceVideo) => void | Promise<void>;
}): Promise<SavedReferenceVideo[]> {
  const { renderer } = options;
  const check = () => {
    if (options.signal?.aborted) throw new DOMException(t("영상 만들기를 취소했습니다."), "AbortError");
    if (options.currentRenderer() !== renderer) throw new Error(t("렌더 도중 3D 화면이 다시 만들어졌습니다. 다시 시도해 주세요."));
    options.assertCurrent?.();
  };
  check();
  if (options.requireProject && !options.projectName?.trim()) throw new Error(t("프로젝트 저장 폴더가 준비되지 않았습니다."));
  const fps = Math.max(1, Math.round(options.fps));
  const totalFrames = Math.max(1, Math.round(options.duration * fps));
  const parts = splitParts(options.splitSeconds ?? null, totalFrames, fps);
  const saved: SavedReferenceVideo[] = [];
  try {
    renderer.begin(options.width, options.height);
    for (const [part, { firstFrame, frames }] of parts.entries()) {
      check();
      const encoded = await renderReferenceVideo({
        width: options.width, height: options.height, duration: frames / fps, fps, signal: options.signal,
        drawFrame: async (_time, index) => {
          check();
          const at = (firstFrame + index) / fps;
          await renderer.prepareAt(at);
          check();
          renderer.drawAt(at);
          return renderer.canvas;
        },
        onProgress: done => options.onProgress?.(firstFrame + done, totalFrames),
      });
      check();
      const fileName = [options.sceneTitle || "Scene", `cut${String(options.cutOrder ?? 1).padStart(2, "0")}`,
        options.shotLabel || "reference", ...(parts.length > 1 ? [
          `part${String(part + 1).padStart(2, "0")}`,
          `${formatSeconds(firstFrame / fps)}-${formatSeconds((firstFrame + frames) / fps)}`,
        ] : [])].join("_").replace(/\s+/g, "") + ".mp4";
      const file = new File([encoded.blob], fileName, { type: "video/mp4" });
      const asset = options.projectName?.trim() ? await saveProjectMediaAsset(file, {
        projectName: options.projectName, assetType: "composition-video", ownerName: options.sceneTitle || "Reference",
      }) : null;
      if (asset?.path) {
        const video: SavedReferenceVideo = { path: asset.path, seconds: encoded.frameCount / fps,
          frameCount: encoded.frameCount, codec: encoded.codec, width: options.width, height: options.height,
          fps, duration: encoded.frameCount / fps, ...(parts.length > 1 ? { part: `${part + 1}/${parts.length}` } : {}) };
        saved.push(video);
        // 파일 생성과 작품에 붙이기는 다릅니다. 뒤 단계가 실패해도 만든 파일의 경로는 작업 기록에 남깁니다.
        options.onFileSaved?.(video);
        check();
        await options.onSaved?.(video);
      } else {
        if (options.requireProject || options.projectName?.trim()) throw new Error(t("영상 파일을 프로젝트 폴더에 저장하지 못했습니다."));
        check();
        const url = URL.createObjectURL(encoded.blob);
        try {
          const link = document.createElement("a");
          link.href = url; link.download = fileName; link.click();
        } finally { URL.revokeObjectURL(url); }
      }
    }
    return saved;
  } finally { renderer.end(); }
}

/** 조각 경계가 파일 이름에서도 같은 시각을 가리키게 합니다. */
function formatSeconds(seconds: number) {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const rest = Math.round((rounded - minutes * 60) * 10) / 10;
  return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}
