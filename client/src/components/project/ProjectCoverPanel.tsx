import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { assetSrc } from "@/lib/mediaLibrary";
import { coverOf, coverPromptOf } from "@/lib/projectCover";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import LocalGenerateButton from "@/components/LocalGenerateButton";
import type { GeneratedImageAsset, ProjectDraft } from "@/lib/projectTypes";

/**
 * **작품 대표 그림** — 프로젝트 보드 카드에 뜨는 한 장.
 *
 *
 *
 * 세 가지 길을 나란히 둡니다.
 *
 * ① **아무것도 안 해도** 작품 안의 그림 한 장이 저절로 걸립니다(`coverOf`). 인물이나 장소를
 * 하나라도 뽑아 두었으면 카드가 비지 않습니다 — 이게 기본이고, 여기서는 «자동» 이라 적힙니다.
 * ② **로컬로 만들기** — 제목·로그라인·장르·화풍을 엮은 프롬프트로 이 컴퓨터의 모델이 한 장 뽑습니다.
 * API 요금이 안 나가는 길이라 기본으로 이것을 권합니다.
 * ③ **작품 안의 그림에서 고르기** — 이미 뽑아 둔 것 중 마음에 드는 것으로 바꿉니다.
 *
 * 저장 자리는 `<프로젝트>/cover/` 입니다. 인물·장소 폴더에 섞으면 이름 바꾸기가 엉뚱하게
 * 따라 움직입니다(규칙 5).
 */
export default function ProjectCoverPanel({
  draft,
  onChange,
}: {
  draft: ProjectDraft;
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
}) {
  const t = useT();
  const { projectName } = useProjectMedia();
  const [picking, setPicking] = useState(false);

  const chosen = draft.coverPath?.trim();
  const shown = coverOf(draft);
  const prompt = coverPromptOf(draft);

  /** 작품 안의 그림 전부 — 고르기 판에 늘어놓습니다. 시트와 6면 낱장은 뺍니다. */
  const inside: GeneratedImageAsset[] = [
    ...draft.backgrounds.flatMap((item) => item.generatedImages || []),
    ...draft.characters.flatMap((item) => item.generatedImages || []),
  ].filter((image) => image.filePath && !image.isCompositeSheet && !image.face);

  const set = (path: string | undefined) =>
    onChange(() => ({ coverPath: path }));

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div
          className="h-20 w-32 shrink-0 overflow-hidden rounded-md"
          style={{ background: "oklch(0.10 0.006 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          {assetSrc(shown) ? (
            <img src={assetSrc(shown)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImagePlus className="h-5 w-5" style={{ color: "oklch(0.34 0.01 265)" }} />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[10px]" style={{ color: "oklch(0.58 0.01 265)" }}>
            {shown
              ? chosen
                ? t("이 그림으로 정해 두었습니다.")
                : t("작품 안의 그림에서 저절로 고른 것입니다 — 마음에 안 들면 아래에서 바꾸세요.")
              : t("아직 그림이 없습니다. 아래에서 한 장 만들거나 고르면 보드 카드에 뜹니다.")}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <LocalGenerateButton
              kind="image"
              label={t("대표 그림 로컬로 만들기")}
              aspect="16:9"
              prompt={{ ko: prompt.ko, en: prompt.en }}
              projectName={projectName}
              assetType="project-cover"
              // 주인이 없는 갈래라 빈 값입니다 — `cover/` 바로 아래에 놓입니다.
              ownerName=""
              stem={draft.title?.trim() || "대표"}
              onDone={(filePath) => {
                set(filePath);
                toast.success(t("대표 그림을 바꿨습니다."));
              }}
            />

            {inside.length > 0 && (
              <button
                type="button"
                onClick={() => setPicking((value) => !value)}
                className="rounded-md px-2 py-1 text-[10px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
              >
                {picking ? t("닫기") : t("작품 안의 그림에서 고르기 ({count})", { count: inside.length })}
              </button>
            )}

            {chosen && (
              <button
                type="button"
                onClick={() => set(undefined)}
                title={t("정해 둔 것을 풀면 작품 안의 그림에서 저절로 고릅니다. 파일은 그대로 남습니다.")}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.62 0.16 25)" }}
              >
                <Trash2 className="h-3 w-3" /> {t("자동으로 되돌리기")}
              </button>
            )}
          </div>
        </div>
      </div>

      {picking && (
        <div className="grid grid-cols-6 gap-1.5">
          {inside.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => {
                set(image.filePath);
                setPicking(false);
              }}
              title={image.name}
              className="aspect-video overflow-hidden rounded-md"
              style={{
                border:
                  chosen === image.filePath
                    ? "2px solid oklch(0.62 0.22 290)"
                    : "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <img src={assetSrc(image.filePath)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
