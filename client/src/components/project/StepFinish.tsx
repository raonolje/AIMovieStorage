import { useMemo, useState } from "react";
import { Clapperboard, Film, Image as ImageIcon, Layers, Printer, Sparkles } from "lucide-react";
import BatchGeneratePanel from "@/components/project/BatchGeneratePanel";
import CutVideoShelf from "@/components/project/CutVideoShelf";
import SheetPreview from "@/components/project/SheetPreview";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { assetSrc } from "@/lib/mediaLibrary";
import { sceneFolderName } from "@/lib/projectNames";
import { storyboardCells } from "@/lib/storyboardSheet";
import type { ProjectDraft, SceneVideoAsset } from "@/lib/projectTypes";
import { getLocale, localeTag, useT } from "@/lib/i18n";

/**
 * 4단계 — **확인**. 만든 것을 모아 보는 자리입니다.
 *
 * # 여기서는 아무것도 만들지 않습니다
 *
 *
 *
 * 그래서 걷어낸 것:
 * - **컷 카드 격자** — 씬 구성 탭에 같은 것이 있고, 거기서는 고칠 수도 있습니다. 여기 것은
 * 보기만 하는 복사본이라 두 곳을 오가게 만들 뿐이었습니다.
 * - **«빽빽하게»** — 그 격자가 없어지니 함께 사라집니다.
 * - **«스토리보드 요청문»** — LLM 에게 컷 목록을 주고 글을 받아 메모 칸에 넣는 단추였는데,
 * 그 글이 어디에도 쓰이지 않았습니다. 시트를 굽는 일과도 무관했습니다.
 * - **«작업실로»** — 작업실 페이지 자체를 걷어냈습니다.
 * 그 자리는 단계 줄 아래의 «프로젝트 목록으로» 하나뿐입니다 — 본문에도 같은 단추를 두었다가
 * 로 걷어냈습니다.
 *
 * 남은 것은 **씬마다 한 줄**입니다 — 구운 시트 한 장, 그 시트를 인쇄하는 단추, 그리고 그
 * 씬에서 나온 영상들(씬 영상 + 컷 영상).
 */
export default function StepFinish({
  draft,
  onChange,
  projectId,
}: {
  draft: ProjectDraft;
  /** 어느 작품의 일인가 — 「한 번에 뽑기」 가 줄에 세울 때 붙입니다. */
  projectId: string;
  /** 여기서 등록한 영상이 그 장면에 붙습니다. */
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
}) {
  const t = useT();
  const { imageMarks } = useProjectMedia();

  /**
   * 씬마다 «시트 · 칸 수 · 영상» 한 벌.
   *
   * 칸 수는 `storyboardCells` 로 셉니다 — 씬 구성 탭이 굽는 것과 **같은 함수**라야
   * 「여기는 4칸이라는데 저기서는 3칸이 구워졌다」 가 생기지 않습니다.
   */
  const scenes = useMemo(
    () =>
      draft.scenes.map((scene, index) => {
        const cuts = [...scene.cuts].sort((a, b) => a.order - b.order);
        /*
          씬 영상만이 아니라 **컷 영상도** 모읍니다. 컷 영상은 컷 카드 안에만 있어 전체를 훑어볼 자리가 없었습니다.
        */
        // 씬 영상은 위 선반이 보여 주므로, 여기서는 **컷 영상만** 모읍니다.
        const cutVideos: { from: number; video: SceneVideoAsset }[] = cuts.flatMap((cut) =>
          (cut.videos || []).map((video) => ({ from: cut.order, video })),
        );
        return {
          id: scene.id,
          title: scene.title || t("장면 {number}", { number: index + 1 }),
          // 폴더 이름은 화면 제목이 아니라 **규칙**을 따릅니다(`projectNames`).
          folder: sceneFolderName(scene.title, index),
          index,
          cutCount: cuts.length,
          cellCount: storyboardCells(scene, imageMarks).length,
          storyboardPath: scene.storyboardPath,
          storyboardAt: scene.storyboardAt,
          cutVideos,
          sceneVideoCount: (scene.videos || []).length,
        };
      }),
    [draft.scenes, imageMarks, t],
  );

  const counts = {
    characters: draft.characters.length,
    backgrounds: draft.backgrounds.length,
    cuts: scenes.reduce((total, scene) => total + scene.cutCount, 0),
    boards: scenes.filter((scene) => scene.storyboardPath).length,
    videos: scenes.reduce(
      (total, scene) => total + scene.cutVideos.length + scene.sceneVideoCount,
      0,
    ),
  };

  /*
    ── 시트 **한 장만** 인쇄 ─────────────────────────────────────────
    `window.print()` 는 페이지 전체를 찍습니다. 씬이 넷이면 넷이 다 나오죠.
    그래서 고른 시트를 종이 크기로 깔아 두고, 화면의 나머지는 인쇄에서만 감춥니다
    (`print:hidden`). 그림이 붙기 전에 인쇄창을 열면 빈 종이가 나오므로 한 틱 기다립니다.
  */
  const [printPath, setPrintPath] = useState<string | null>(null);
  const printSheet = (path: string) => {
    setPrintPath(path);
    window.setTimeout(() => {
      window.print();
      setPrintPath(null);
    }, 150);
  };

  return (
    <div className="space-y-4">
      {printPath && (
        <div className="fixed inset-0 z-[9999] hidden bg-white print:block">
          <img
            src={assetSrc(printPath) || undefined}
            alt={t("스토리보드")}
            className="h-full w-full object-contain"
          />
        </div>
      )}

      <div className={printPath ? "space-y-4 print:hidden" : "space-y-4"}>
        {/* ── 한눈에 ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-tour="finish-counts">
          {[
            { icon: Layers, label: "인물", value: counts.characters },
            { icon: ImageIcon, label: "장소", value: counts.backgrounds },
            { icon: Clapperboard, label: "컷", value: counts.cuts },
            { icon: Sparkles, label: "스토리보드", value: counts.boards },
            { icon: Film, label: "영상", value: counts.videos },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl px-3 py-2.5"
              style={{
                background: "oklch(0.145 0.009 265)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <div className="flex items-center gap-1.5">
                <item.icon className="h-3 w-3" style={{ color: "oklch(0.62 0.14 290)" }} />
                <span className="text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                  {t(item.label)}
                </span>
              </div>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-white">{item.value}</p>
            </div>
          ))}
        </div>

        {/*
          ── 한 번에 뽑기 ─────────────────────────────────────────────
          
          확인 탭에 두는 까닭: 컷 프롬프트와 시트가 다 갖춰졌는지 여기서 보고 누릅니다.
        */}
        {draft.scenes.length > 0 && (
          <BatchGeneratePanel projectId={projectId} draft={draft} />
        )}

        {/* ── 씬마다 한 줄 ───────────────────────────────────────────── */}
        {scenes.length === 0 ? (
          <p
            className="rounded-xl px-4 py-8 text-center text-xs"
            style={{ background: "oklch(0.12 0.008 265)", color: "oklch(0.48 0.01 265)" }}
          >
            {t("아직 장면이 없습니다. «씬 구성» 에서 장면과 컷을 만들어 주세요.")}
          </p>
        ) : (
          scenes.map((scene) => (
            <section
              key={scene.id}
              data-tour="finish-scene-row"
              className="space-y-2 rounded-xl p-4"
              style={{
                background: "oklch(0.145 0.009 265)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Clapperboard
                  className="h-4 w-4 shrink-0"
                  style={{ color: "oklch(0.84 0.16 290)" }}
                />
                <p className="shrink-0 text-sm font-semibold">
                  {scene.index + 1}. {scene.title}
                </p>
                <p
                  className="min-w-0 flex-1 truncate text-[11px]"
                  style={{ color: "oklch(0.48 0.01 265)" }}
                >
                  {scene.storyboardPath
                    ? `${t("컷 {count}칸", { count: scene.cellCount })}${
                        scene.storyboardAt
                          ? ` · ${new Date(scene.storyboardAt).toLocaleString(localeTag(getLocale()))}`
                          : ""
                      }`
                    : t("컷 {count}개 · 아직 시트를 굽지 않았습니다 — «씬 구성» 에서 만듭니다", { count: scene.cutCount })}
                </p>
                {scene.storyboardPath && (
                  <button
                    type="button"
                    onClick={() => printSheet(scene.storyboardPath!)}
                    data-tour="finish-print"
                    className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold"
                    style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.14 200)" }}
                  >
                    <Printer className="h-3 w-3" /> {t("인쇄")}
                  </button>
                )}
              </div>

              {scene.storyboardPath ? (
                /* 미리보기는 공용 부품이 맡습니다 — 씬 구성 탭과 같은 규칙(공통 규칙 1). */
                <SheetPreview
                  path={scene.storyboardPath}
                  alt={t("{title} 스토리보드", { title: scene.title })}
                  maxHeight={300}
                />
              ) : (
                <p
                  className="rounded-md px-4 py-6 text-center text-[11px]"
                  style={{ background: "oklch(0.11 0.007 265)", color: "oklch(0.44 0.01 265)" }}
                >
                  {t("«씬 구성» 탭의 그 장면 아래에서 «스토리보드 만들기» 를 누르면 여기 뜹니다.")}
                </p>
              )}

              {/*
                ── 이 장면에서 나온 영상 ────────────────────────────────
                밖에서 뽑아 온 것도 **여기서 바로 등록**합니다(). 등록한 것은 그 장면의 «씬 영상» 으로 붙습니다 —
                어느 컷의 것인지는 컷 카드에서 넣어야 알 수 있습니다.
              */}
              <CutVideoShelf
                tour="finish-scene-video"
                label="씬 영상 — 밖에서 뽑아 온 것도 여기로"
                ownerName={scene.folder}
                canAdd
                videos={draft.scenes.find((item) => item.id === scene.id)?.videos || []}
                onChange={(update) =>
                  onChange((current) => ({
                    scenes: current.scenes.map((item) =>
                      item.id === scene.id
                        ? { ...item, videos: update(item.videos || []) }
                        : item,
                    ),
                  }))
                }
              />

              {/*
                컷 영상만 따로 봅니다 — 씬 영상은 위 선반이 이미 보여 주고 있어,
                둘을 합쳐 다시 늘어놓으면 같은 영상이 두 번 뜹니다
                ().
              */}
              {scene.cutVideos.length > 0 && (
                <div className="space-y-1" data-tour="finish-cut-videos">
                  <p
                    className="text-[10px] font-semibold"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    {t("컷 영상 {count}개", { count: scene.cutVideos.length })}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {scene.cutVideos.map(({ from, video }) => (
                      <div
                        key={`${from}-${video.id}`}
                        className="space-y-1 rounded-md p-2"
                        style={{
                          background: "oklch(0.11 0.007 265)",
                          border: "1px solid oklch(1 0 0 / 7%)",
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                            style={{
                              background: "oklch(0.72 0.16 45 / 18%)",
                              color: "oklch(0.84 0.14 45)",
                            }}
                          >
                            {t("컷 {number}", { number: from })}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-[10px]"
                            style={{ color: "oklch(0.72 0.01 265)" }}
                          >
                            {video.isPrimary ? "★ " : ""}
                            {video.name}
                          </span>
                        </div>
                        {video.filePath && (
                          <video
                            src={assetSrc(video.filePath) || undefined}
                            controls
                            className="w-full rounded"
                            style={{ background: "black" }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))
        )}

      </div>
    </div>
  );
}
