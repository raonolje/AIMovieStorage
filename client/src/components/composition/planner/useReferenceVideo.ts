import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import type { VideoFrameRenderer } from "@/components/composition/CompositionViewport";
import { SHOT_PRESETS, type CameraMove } from "@/lib/cameraMoves";
import { isReferenceVideoSupported } from "@/lib/referenceVideo";
import { exportReferenceVideoFiles, type CompositionVideoOptions, type CompositionVideoControls } from "@/lib/referenceVideoExport";
import type { CompositionTimeline } from "@/lib/composition";

/** 탭을 바꿔도 취소·진행 상태를 잃지 않도록 구도 창에서 수명을 관리합니다. */
export function useReferenceVideo({ captureFormat, timeline, cameraMove, projectName, sceneTitle, cutOrder,
  onVideoSaved, onRendered, setPlaying, setPreviewing,
}: {
  captureFormat: { width: number; height: number };
  timeline: CompositionTimeline;
  cameraMove: CameraMove | null;
  projectName?: string;
  sceneTitle?: string;
  cutOrder?: number;
  /** 파일 경로를 화면에 붙인 시점이 아니라 프로젝트 저장 완료까지 기다립니다. */
  onVideoSaved?: (path: string, seconds: number) => void | Promise<void>;
  onRendered?: (render: { path: string; seconds: number; part?: string }) => void;
  setPlaying: (value: boolean) => void;
  setPreviewing: (value: boolean) => void;
}) {
  const t = useT();
  const videoRendererRef = useRef<VideoFrameRenderer | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const [videoRendering, setVideoRendering] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);
  useEffect(() => () => renderAbortRef.current?.abort(), []);
  // 프레임마다 React를 갱신하면 씬 효과와 GLB 믹서가 흔들립니다. 숫자는 DOM만 갱신합니다.
  const paintProgress = (done: number, total: number) => {
    if (progressBarRef.current) progressBarRef.current.style.width = `${done / Math.max(1, total) * 100}%`;
    if (progressTextRef.current) progressTextRef.current.textContent = t("{done} / {total} 프레임", { done, total });
  };
  const run = async (options: CompositionVideoOptions, controls: CompositionVideoControls,
    splitSeconds: number | number[] | null, fromController: boolean) => {
    if (renderAbortRef.current) throw new Error(t("이미 이 구도의 영상을 만들고 있습니다."));
    const renderer = videoRendererRef.current;
    if (!renderer) throw new Error(t("3D 화면이 준비되지 않았습니다."));
    if (!isReferenceVideoSupported()) throw new Error(t("이 환경에서는 영상 인코딩을 쓸 수 없습니다."));
    const abort = new AbortController();
    const cancel = () => abort.abort();
    controls.signal?.addEventListener("abort", cancel, { once: true });
    if (controls.signal?.aborted) abort.abort();
    renderAbortRef.current = abort;
    setPlaying(false); setPreviewing(false); setVideoRendering(true);
    try {
      // 미리보기 종료가 반영된 뒤 같은 캔버스를 씁니다. 숨겨진 창에서도 rAF를 기다리지 않습니다.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return await exportReferenceVideoFiles({ ...options, ...controls, signal: abort.signal, renderer,
        currentRenderer: () => videoRendererRef.current, projectName, sceneTitle, cutOrder,
        shotLabel: cameraMove ? SHOT_PRESETS.find(preset => preset.id === cameraMove.shotId)?.label : null,
        splitSeconds, requireProject: fromController,
        onProgress: (done, total) => { paintProgress(done, total); controls.onProgress?.(done, total); },
        onSaved: fromController ? undefined : async video => {
          if (!video.part) await onVideoSaved?.(video.path, video.seconds);
          onRendered?.(video);
        },
      });
    } finally {
      controls.signal?.removeEventListener("abort", cancel);
      if (renderAbortRef.current === abort) renderAbortRef.current = null;
      setVideoRendering(false);
    }
  };
  const renderReference = async (splitSeconds: number | number[] | null = null) => {
    try {
      const saved = await run({ ...captureFormat, duration: timeline.duration, fps: timeline.fps }, {}, splitSeconds, false);
      toast.success(saved.length > 1 ? t("레퍼런스 영상 {count}조각을 저장했습니다.", { count: saved.length }) : t("레퍼런스 영상을 만들었습니다."),
        saved[0] ? { description: saved[0].path } : undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") toast.info(t("영상 만들기를 취소했습니다."));
      else toast.error(t("영상을 만들지 못했습니다. {error}", { error: error instanceof Error ? error.message : String(error) }));
    }
  };
  const exportVideo = async (options: CompositionVideoOptions, controls: CompositionVideoControls) => {
    const saved = await run(options, controls, null, true);
    if (saved.length !== 1) throw new Error(t("레퍼런스 영상 파일을 확인하지 못했습니다."));
    return saved[0];
  };
  return { videoRendererRef, renderAbortRef, videoRendering, progressBarRef, progressTextRef, renderReference, exportVideo };
}
export type PlannerVideoRender = ReturnType<typeof useReferenceVideo>;
