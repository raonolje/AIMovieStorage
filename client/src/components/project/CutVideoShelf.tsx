import { useState, type DragEvent } from "react";
import { Expand, FolderOpen, Star, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import {
  assetSrc,
  deleteProjectMediaFile,
  revealFile,
  safeFileName,
  saveProjectMediaAsset,
} from "@/lib/mediaLibrary";
import type { SceneVideoAsset } from "@/lib/projectTypes";
import { useT } from "@/lib/i18n";

/**
 * 컷에 붙은 영상들. 밖(마그니픽·Kling·Veo)에서 뽑아 온 mp4 를 두는 자리입니다.
 *
 * 타입·저장 갈래·삭제까지 있었는데 화면이 없어서 영상만 앱 밖에 남았습니다
 * (09 보고서 F1). 후보함에서 «채택» 하면 여기 붙습니다.
 */
export default function CutVideoShelf({
  videos,
  onChange,
  label = "영상",
  ownerName,
  canAdd,
  tour,
}: {
  videos: SceneVideoAsset[];
  onChange: (update: (current: SceneVideoAsset[]) => SceneVideoAsset[]) => void;
  /** 선반 이름. 장면에 붙을 때는 「씬 영상」 — 컷 영상과 헷갈리면 안 됩니다. */
  label?: string;
  /** 폴더에 넣을 때의 주인 이름(장면 제목 등). 없으면 선반 이름을 씁니다. */
  ownerName?: string;
  /**
   * **밖에서 뽑아 온 영상을 여기서 바로 등록합니다.**
   *
   * * 맞습니다. 여태 영상이 들어오는 길은 «마그니픽 후보함에서 채택» 과 «로컬 생성» 둘뿐이라,
   * 클링·Veo 처럼 다른 데서 뽑아 온 mp4 는 넣을 자리가 아예 없었습니다.
   */
  canAdd?: boolean;
  /** 튜토리얼 말풍선이 잡을 `data-tour` 이름(`tutorials/ANCHORS.md`). */
  tour?: string;
}) {
  const t = useT();
  const { projectName } = useProjectMedia();
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);

  const add = async (files: File[]) => {
    const movies = files.filter((file) => file.type.startsWith("video/"));
    if (!movies.length) {
      toast.error(t("영상 파일이 아닙니다."));
      return;
    }
    setBusy(true);
    try {
      for (const file of movies) {
        /*
          **원본 파일 이름은 넘기지 않습니다.**

          공통 함수는 멀쩡했고,
          제가 `stem` 에 원본 이름(`KakaoTalk_20260911_…`)을 넣어 그대로 굳혀 버렸습니다.
          `stem` 을 비우면 주인 이름이 앞에 붙고 Rust 가 `_001` 을 올립니다 — 「수화의 숲_001」.

          파일 이름이 곧 마그니픽의 `@태그`라, 생성기가 붙인 긴 이름으로는 태그를 못 겁니다
          (`generatedImages` 가 그림에서 지키는 규칙과 같습니다).
        */
        const saved = projectName
          ? await saveProjectMediaAsset(file, {
              projectName,
              assetType: "scene-video",
              ownerName: safeFileName(ownerName || label),
            }).catch(() => null)
          : null;
        /*
          폴더에 못 넣었으면 목록에도 안 올립니다. blob 은 앱을 닫으면 죽어서, 남겨 두면
          다음에 열었을 때 «까만 칸» 만 남습니다 — 없느니만 못합니다.
        */
        if (!saved) {
          toast.error(t("{name} 을 폴더에 넣지 못했습니다.", { name: file.name }), {
            description: t("설정에서 저장 폴더를 골랐는지 확인하세요."),
          });
          continue;
        }
        onChange((current) => [
          ...current,
          {
            id: Math.random().toString(36).slice(2),
            // **폴더에 놓인 이름과 화면에 뜨는 이름이 같아야 합니다**(`saveProjectMediaAsset` 주석).
            name: saved.name,
            filePath: saved.path,
          },
        ]);
      }
      toast.success(t("영상 {count}개를 등록했습니다.", { count: movies.length }), {
        description: t("프로젝트 폴더로 옮기면서 «장면이름_001» 로 이름을 바꿨습니다."),
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * **대표를 하나만** 세웁니다. 그림 선반의 «별» 과 같은 규칙입니다 — 둘이면 어느 것이
   * 그 장면인지 알 수 없어, 스토리보드나 내보내기가 아무거나 집습니다.
   */
  const setPrimary = (id: string) =>
    onChange((current) =>
      current.map((item) => ({ ...item, isPrimary: item.id === id ? !item.isPrimary : false })),
    );

  /** 크게 볼 영상. 선반의 칸은 작아서 얼굴이 안 보입니다. */
  const [big, setBig] = useState<SceneVideoAsset | null>(null);

  const dropHandlers = canAdd
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: () => setDropping(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDropping(false);
          void add(Array.from(event.dataTransfer.files));
        },
      }
    : {};

  // 등록할 길이 있으면 비어 있어도 자리를 지킵니다 — 없으면 넣을 곳이 안 보입니다.
  if (!videos.length && !canAdd) return null;

  const remove = async (video: SceneVideoAsset) => {
    // 화면에서 지우면 폴더의 원본도 지웁니다 (규칙 3).
    const ok = await confirmDialog({
      title: t("{name} 을 지울까요?", { name: video.name }),
      description: video.filePath
        ? t("저장 폴더의 원본 파일도 함께 지워집니다. 되돌릴 수 없습니다.")
        : t("목록에서 빠집니다."),
      confirmLabel: t("지우기"),
      tone: "danger",
    });
    if (!ok) return;
    onChange((current) => current.filter((item) => item.id !== video.id));
    if (video.filePath) {
      const deleted = await deleteProjectMediaFile(projectName, video.filePath);
      if (!deleted) toast.error(t("폴더의 파일은 지우지 못했습니다. 직접 지워 주세요."));
    }
  };

  return (
    <div
      {...dropHandlers}
      data-tour={tour}
      className="space-y-2 rounded-lg p-3"
      style={{
        background: "oklch(0.13 0.009 265)",
        border: `1px ${dropping ? "dashed" : "solid"} ${
          dropping ? "oklch(0.70 0.15 200)" : "oklch(0.55 0.15 200 / 20%)"
        }`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white">{t(label)}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
            {t("{count}개 등록", { count: videos.length })}
          </span>
          {canAdd && (
            <label
              className="cursor-pointer rounded px-2 py-1 text-[10px] font-semibold"
              style={{
                background: "oklch(0.55 0.15 200 / 18%)",
                color: "oklch(0.80 0.14 200)",
                opacity: busy ? 0.5 : 1,
              }}
              title={t("밖에서 뽑아 온 mp4 를 골라 넣습니다. 끌어다 놓아도 됩니다")}
            >
              <Upload className="mr-1 inline h-3 w-3" />
              {busy ? t("넣는 중…") : t("영상 불러오기")}
              <input
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  // 같은 파일을 다시 고를 수 있게 비웁니다 — 안 비우면 change 가 안 옵니다.
                  event.target.value = "";
                  void add(files);
                }}
              />
            </label>
          )}
        </div>
      </div>
      {canAdd && videos.length === 0 && (
        <p className="py-3 text-center text-[10px]" style={{ color: "oklch(0.46 0.01 265)" }}>
          {t("아직 없습니다 — 영상을 여기로 끌어다 놓거나 «영상 불러오기» 로 넣으세요.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {videos.map((video) => (
          <div
            key={video.id}
            className="group relative w-[200px] rounded-lg"
            style={{
              outline: video.isPrimary ? "2px solid oklch(0.86 0.16 85)" : "none",
              outlineOffset: 2,
            }}
          >
            <video
              src={assetSrc(video.filePath) || undefined}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-lg"
              style={{ background: "oklch(0.1 0.006 265)" }}
            />
            <p className="mt-1 truncate text-[10px]" title={video.name} style={{ color: "oklch(0.62 0.01 265)" }}>
              {video.isPrimary ? "★ " : ""}
              {video.name}
            </p>
            <div className="absolute left-1 top-1 flex gap-1">
              {/* 대표는 늘 보입니다 — 어느 것이 그 장면인지가 이 선반에서 가장 중요한 표시입니다. */}
              <button
                type="button"
                title={video.isPrimary ? t("대표에서 내립니다") : t("이 영상을 대표로")}
                onClick={() => setPrimary(video.id)}
                className="rounded-full p-1"
                style={{
                  background: "oklch(0 0 0 / 72%)",
                  color: video.isPrimary ? "oklch(0.86 0.16 85)" : "oklch(0.62 0.01 265)",
                }}
              >
                <Star
                  className="h-3 w-3"
                  fill={video.isPrimary ? "currentColor" : "none"}
                />
              </button>
            </div>
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                title={t("큰 화면으로 보기")}
                onClick={() => setBig(video)}
                className="rounded-full p-1"
                style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
              >
                <Expand className="h-3 w-3" />
              </button>
              {video.filePath && (
                <button
                  type="button"
                  title={t("폴더 열기")}
                  onClick={() => void revealFile(video.filePath)}
                  className="rounded-full p-1"
                  style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                >
                  <FolderOpen className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                title={t("지우기")}
                onClick={() => void remove(video)}
                className="rounded-full p-1"
                style={{ background: "oklch(0 0 0 / 72%)", color: "oklch(0.78 0.16 25)" }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/*
        ── 큰 화면 ──────────────────────────────────────────────────
        
        선반의 칸은 200px 이라 얼굴도 자막도 안 보입니다. 고른 것을 화면 가득 띄웁니다.
      */}
      {big && (
        <div
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-2 p-8"
          style={{ background: "oklch(0 0 0 / 88%)" }}
          onClick={() => setBig(null)}
        >
          <video
            src={assetSrc(big.filePath) || big.thumb}
            controls
            autoPlay
            onClick={(event) => event.stopPropagation()}
            className="max-h-[82vh] w-auto max-w-full rounded-lg"
            style={{ background: "black" }}
          />
          <div data-tour="shelf-video-big" className="flex items-center gap-2">
            <p className="text-[11px]" style={{ color: "oklch(0.72 0.01 265)" }}>
              {big.isPrimary ? "★ " : ""}
              {big.name}
            </p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPrimary(big.id);
                setBig({ ...big, isPrimary: !big.isPrimary });
              }}
              className="rounded px-2 py-1 text-[10px] font-semibold"
              style={{
                background: "oklch(1 0 0 / 10%)",
                color: big.isPrimary ? "oklch(0.86 0.16 85)" : "oklch(0.70 0.01 265)",
              }}
            >
              {big.isPrimary ? t("대표에서 내리기") : t("대표로 정하기")}
            </button>
            <button
              type="button"
              onClick={() => setBig(null)}
              className="rounded px-2 py-1 text-[10px]"
              style={{ background: "oklch(1 0 0 / 10%)", color: "oklch(0.70 0.01 265)" }}
            >
              {t("닫기")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
