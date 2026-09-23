import { toast } from "sonner";
import { HOLDS_SHEET } from "@/lib/useTutorialPanel";
import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, FolderOpen, Layers, LayoutGrid, Pencil, Send, X } from "lucide-react";
import LineageTree, { LINEAGE_ROOT, lineageNodes } from "@/components/project/LineageTree";
import OwnedAssetLineage, { type OwnedAssetsProps } from "@/components/project/OwnedAssetLineage";
import AlternateLineage, {
  type AlternateEntity,
  type AlternateLineageProps,
} from "@/components/project/AlternateLineage";
import ImageLightbox from "@/components/ImageLightbox";
import { assetSrc, copyImageWithNotice, fileNameOf, revealFile, sendImagesToMagnific } from "@/lib/mediaLibrary";
import { lineageAccent, lineageColumns, lineagePanelStyle } from "@/components/project/lineageGrid";
import { useCollapsedCard } from "@/lib/collapsedCards";
import type { GeneratedImageAsset } from "@/lib/projectTypes";
import type { PromptVariationState } from "@/lib/promptWorkflow";
import type { ReferenceImage } from "@/lib/projectTypes";

/**
 * 인물·장소 하나를 담는 패널.
 *
 * 화면에 여러 개가 나란히 놓입니다. 안에는
 *
 * 원본 카드 → (곡선) → 변형 카드들
 * 다른 원본 (원본마다 작은 계보: 원본 → 변형)
 * 보유 애셋 (에셋마다 작은 계보: 원본 → 변형)
 * 제작한 시트 + [시트 제작]
 *
 * 이 순서로 들어갑니다.
 * 「캐릭터 시트 제작 버튼이 캐릭터 시트랑 묶여 있어야」 — 시트 상자는 시트가 0장이어도
 * 그리고, 만드는 단추가 그 상자 안에 있습니다.
 *
 * **편집은 여기서 안 합니다** — 카드를 누르면 창이 열립니다. 예전에는 패널 안에서 바로
 * 펼쳤는데, 인물이 셋만 넘어가도 무엇이 있는지 보려면 한없이 스크롤해야 했습니다.
 *
 * 머리 왼쪽의 화살표로 **한 줄로 접을 수** 있습니다().
 * 기본은 펼침. 접힘은 이 컴퓨터에만 기억합니다(`collapsedCards.ts`).
 *
 * 캐릭터와 배경이 같이 씁니다. 갈래에 따라 색과 말만 달라집니다.
 * 공용 에셋도 이 패널을 씁니다(kind="asset") — 다만 «보유 애셋»·«다른 원본» 상자는 없습니다.
 */
export default function EntityLineagePanel<
  TVariation extends PromptVariationState<ReferenceImage, GeneratedImageAsset>,
  TAlternate extends AlternateEntity = AlternateEntity,
>({
  kind,
  entityId,
  name,
  onNameChange,
  rootIndex,
  rootImages,
  variations,
  onOpenRoot,
  onOpenVariation,
  onBranch,
  onRemoveVariation,
  onRemove,
  alternates,
  ownedAssets,
  onComposeSheet,
  onSheetRename,
  onSheetRemove,
  onSheetEdit,
  onDropImages,
}: {
  kind: "character" | "background" | "asset";
  /** 인물·장소·에셋의 id. 접힘을 이 id 로 기억합니다 — 이름은 바뀌어도 id 는 그대로라서요 */
  entityId: string;
  name: string;
  onNameChange: (name: string) => void;
  /** 인물마다 붙는 번호. 카드에 배지로 뜹니다 */
  rootIndex: number;
  rootImages: GeneratedImageAsset[];
  variations: TVariation[];
  onOpenRoot: () => void;
  onOpenVariation: (id: string) => void;
  /** 이 카드에서 갈라내기. 원본이면 id 가 null */
  onBranch: (fromVariationId: string | null) => void;
  onRemoveVariation: (id: string) => void;
  onRemove: () => void;
  /**
   * 인물·장소에만 — «다른 원본» 상자(어린 시절·노인 버전처럼 같은 인물의 다른 모습).
   * 에셋은 다른 원본을 갖지 않습니다(보유 애셋과 같은 규칙). 그리기와 계보 조작은 `AlternateLineage`.
   */
  alternates?: AlternateLineageProps<TAlternate>;
  /**
   * 인물·장소에만. 에셋은 자기가 에셋이라 없습니다.
   *
   * 예전의 `onOpenAssets`(관리 창 열기)·`onCreateAsset` 을 대신합니다. 사용자 2026-09-08:
   * 「에셋을 굳이 모달로 띄워서 관리할 필요 없이 캐릭터처럼 부모 자식 관계의 카드 리스트로」.
   * 상자 안 그리기와 계보 조작은 `OwnedAssetLineage` 가 맡습니다.
   */
  ownedAssets?: OwnedAssetsProps;
  onComposeSheet?: () => void;
  /** 합성 시트 이름 바꾸기. 「이 판의 이름」 입력이 이걸 부릅니다 */
  onSheetRename?: (imageId: string, sheetLabel: string) => void;
  /** 합성 시트 지우기(파일도 — 규칙 3). */
  onSheetRemove?: (imageId: string) => void;
  /** 합성 시트를 시트 창으로 다시 열어 고치기. 판(`sheet`)이 붙은 시트만 됩니다 */
  onSheetEdit?: (imageId: string) => void;
  /**
   * 계보 카드에 그림을 끌어다 놓았을 때. `variationId` 가 null 이면 원본입니다.
   *
   * 밖에서 뽑아 온 결과를 그 판에 바로 붙입니다.
   */
  onDropImages?: (variationId: string | null, files: FileList) => void;
}) {
  const accent = lineageAccent(kind);

  const nodes = lineageNodes({ name, rootImages, variations, rootIndex });

  /** 크게 보는 시트. */
  const [viewing, setViewing] = useState<GeneratedImageAsset | null>(null);

  /**
   * 계보가 몇 열인가 — 이 값이 패널 폭을 정합니다.
   *
   * 보유 애셋의 미니 계보도 같이 셉니다. 변형이 깊은 애셋이 있으면 그쪽이 패널을 넓힙니다 —
   * 상자 안에 가로 스크롤을 두면 스크롤바가 폭을 깎는 고리가 생깁니다(`lineageGrid.ts`).
   */
  const columns = lineageColumns(variations);
  // 다른 원본의 미니 계보도 같은 상자 폭(compact)이라 같은 셈에 넣습니다.
  const miniLineages = [
    ...(ownedAssets?.assets ?? []),
    ...(alternates?.items ?? []),
  ];
  const assetColumns = miniLineages.reduce(
    (deepest, item) => Math.max(deepest, lineageColumns(item.variations || [])),
    0,
  );

  // 시트로 구운 것만 여기 모입니다. 원본 그림과 성격이 달라서요.
  const sheets = rootImages.filter((image) => image.isCompositeSheet);
  const sheetNoun = kind === "background" ? "배경" : kind === "asset" ? "에셋" : "캐릭터";

  /**
   * 접힘. 접으면 계보·상자·시트를 **아예 그리지 않습니다** — 마운트 비용도 아낍니다.
   * 폴더 읽기는 편집 창에서만 일어나므로 접어도 데이터는 안전합니다.
   */
  const [collapsed, toggleCollapsed] = useCollapsedCard(entityId);
  const primary = rootImages.find((image) => image.isPrimary) || rootImages[0];
  const summary = [
    variations.length && `변형 ${variations.length}`,
    alternates?.items.length && `다른 원본 ${alternates.items.length}`,
    ownedAssets?.assets.length && `애셋 ${ownedAssets.assets.length}`,
    sheets.length && `시트 ${sheets.length}`,
  ].filter((item): item is string => typeof item === "string");

  return (
    <section
      data-tour={kind === "character" ? "character-panel" : undefined}
      className="rounded-xl p-4"
      style={{
        background: "oklch(0.145 0.009 265)",
        border: "1px solid oklch(1 0 0 / 8%)",
        // 접힌 패널은 한 열 폭만 — 내용이 없는데 변형 깊이만큼 넓으면 자리를 헛되이 먹습니다.
        ...(collapsed ? lineagePanelStyle(1, 0) : lineagePanelStyle(columns, assetColumns)),
      }}
    >
      <div className={`flex items-center gap-2 ${collapsed ? "" : "mb-3"}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "펼치기" : "접기"}
          aria-expanded={!collapsed}
          title={collapsed ? "카드를 다시 펼칩니다" : "카드를 한 줄로 줄입니다"}
          className="shrink-0 rounded-md p-1 hover:bg-white/10"
          style={{ color: "oklch(0.60 0.01 265)" }}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={kind === "background" ? "장소 이름" : kind === "asset" ? "에셋 이름" : "인물 이름"}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-bold outline-none"
          style={{ color: "white" }}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${name || "이름 없음"} 지우기`}
          className="shrink-0 rounded-md p-1.5 hover:bg-white/10"
          style={{ color: "oklch(0.66 0.16 25)" }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── 접힌 한 줄 요약 ─────────────────────────────────────────────
          대표 그림 하나와 무엇이 몇 개 있는지만. 누르면 펼쳐집니다. */}
      {collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-white/5"
          title="펼치기"
        >
          <span
            className="h-7 w-7 shrink-0 overflow-hidden rounded-md"
            style={{ background: "oklch(0.22 0.01 265)" }}
          >
            {primary && (
              <img src={assetSrc(primary.filePath) || primary.thumb || ""} alt="" className="h-full w-full object-cover" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
            {summary.length ? summary.join(" · ") : "아직 비어 있음"}
          </span>
        </button>
      )}

      {!collapsed && (
        <>
          <LineageTree
            nodes={nodes}
            accent={accent}
            onOpen={(id) => (id === LINEAGE_ROOT ? onOpenRoot() : onOpenVariation(id))}
            onBranch={(id) => onBranch(id === LINEAGE_ROOT ? null : id)}
            onRemove={onRemoveVariation}
            onDropImages={
              onDropImages ? (id, files) => onDropImages(id === LINEAGE_ROOT ? null : id, files) : undefined
            }
          />

          {/* ── 다른 원본 ─────────────────────────────────────────────────────
              계보 바로 아래, 보유 애셋 위. 「냥이의 어린 시절」 은 냥이의 소품이 아니라 냥이 자신이라
              애셋보다 앞에 둡니다. 에셋 패널에는 없습니다(보유 애셋과 같은 규칙). */}
          {alternates && <AlternateLineage {...alternates} />}

          {/* ── 보유 애셋 ─────────────────────────────────────────────────────
              에셋 패널에는 없습니다 — 에셋이 또 에셋을 가지지는 않습니다.
              «애셋 관리» 단추는 없앴습니다(2026-09-08). 에셋이 여기 계보로 다 보이니
              따로 열 창이 없습니다. */}
          {ownedAssets && <OwnedAssetLineage {...ownedAssets} />}

          {/* ── 제작한 시트 + [시트 제작] ─────────────────────────────────────
              보유 애셋 **아래**, 시트가 0장이어도 상자를 그립니다. 만드는 단추가 상자 안에 있어야
              「시트를 만들면 여기 쌓인다」 가 보입니다. 공용 에셋(kind="asset")은
              시트를 만들지 않으니 단추가 없고, 옛 데이터에 시트가 있을 때만 상자가 뜹니다. */}
          {(onComposeSheet || sheets.length > 0) && (
            <div
              className="mt-3 rounded-lg p-3"
              style={{ background: "oklch(0.12 0.008 265)", border: "1px solid oklch(0.62 0.22 290 / 22%)" }}
            >
              <div className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.82 0.16 290)" }} />
                <p className="shrink-0 text-[11px] font-semibold text-white">
                  제작한 {sheetNoun} 시트 ({sheets.length})
                </p>
                <p className="min-w-0 flex-1 truncate text-[10px]" style={{ color: "oklch(0.45 0.01 265)" }}>
                  {sheets.length ? "이름을 적어 두면 어느 판인지 나중에 알아볼 수 있습니다" : "아직 만든 시트가 없습니다"}
                </p>
              </div>

              {sheets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {sheets.map((sheet) => {
                    const label = sheet.sheetLabel || sheet.name;
                    const fileName = fileNameOf(sheet.filePath) || `${sheet.name}.png`;
                    const editable = !!sheet.sheet;
                    return (
                      <div key={sheet.id} className="w-[104px]">
                        <div
                          data-tour="lineage-sheet-tile"
                          className="group relative aspect-square w-full overflow-hidden rounded-md"
                          style={{ background: "#ffffff", border: "1px solid oklch(1 0 0 / 10%)" }}
                        >
                          <img
                            src={assetSrc(sheet.filePath) || sheet.thumb || ""}
                            alt=""
                            title="크게 보기"
                            onClick={() => setViewing(sheet)}
                            className="h-full w-full cursor-zoom-in object-cover"
                          />
                          {/* 단추 자리는 ImageActions 의 모서리 규칙을 따릅니다 — 오른쪽 위 빼기, 왼쪽 아래 폴더, 오른쪽 아래 편집 */}
                          {onSheetRemove && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSheetRemove(sheet.id);
                              }}
                              aria-label={`${label} 지우기`}
                              title={`${label} 지우기 — 폴더의 파일도 지워집니다`}
                              className="absolute right-1 top-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              style={{ background: "oklch(0 0 0 / 72%)", color: "oklch(0.78 0.16 25)" }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                          {/* 왼쪽 위: 복사·마그니픽. */}
                          {sheet.filePath && (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  // 알림은 copyImageWithNotice 가 직접 띄웁니다.
                                  void copyImageWithNotice({ name: label, filePath: sheet.filePath });
                                }}
                                aria-label={`${label} 복사`}
                                title="그림을 클립보드에 복사"
                                className="absolute left-1 top-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void sendImagesToMagnific([sheet.filePath || ""])
                                    .then((message) => toast.success(message))
                                    .catch((error) => toast.error(String(error)));
                                }}
                                aria-label={`${label} 마그니픽으로`}
                                title="마그니픽 캔버스에 이미지 노드로 붙여넣기(파일 이름 유지)"
                                className="absolute left-7 top-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                style={{ background: "oklch(0 0 0 / 72%)", color: "oklch(0.72 0.14 200)" }}
                              >
                                <Send className="h-3 w-3" />
                              </button>
                            </>
                          )}
                          {sheet.filePath && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void revealFile(sheet.filePath);
                              }}
                              aria-label={`${label} 폴더 열기`}
                              title="폴더 열기"
                              className="absolute bottom-1 left-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                            >
                              <FolderOpen className="h-3 w-3" />
                            </button>
                          )}
                          {onSheetEdit && (
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (editable) onSheetEdit(sheet.id);
                              }}
                              aria-label={`${label} 편집`}
                              title={
                                editable
                                  ? "시트 창에서 이 판을 다시 열어 고칩니다"
                                  : "배치 기록이 없는 시트입니다. 새로 만들어 주세요"
                              }
                              className="absolute bottom-1 right-1 z-10 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
                              style={{
                                background: "oklch(0 0 0 / 72%)",
                                color: editable ? "white" : "oklch(0.45 0.01 265)",
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <input
                          value={sheet.sheetLabel || ""}
                          onChange={(event) => onSheetRename?.(sheet.id, event.target.value)}
                          placeholder="이 판의 이름"
                          data-tour="lineage-sheet-name"
                          className="mt-1 w-full rounded px-1.5 py-1 text-[10px] outline-none"
                          style={{
                            background: "oklch(0.18 0.012 265)",
                            border: "1px solid oklch(1 0 0 / 9%)",
                            color: "white",
                          }}
                        />
                        {/* 파일 이름과 규격. 고른 규격이 정말 적용됐는지 여기서 눈으로 확인합니다 */}
                        <p
                          className="mt-0.5 truncate text-[9px]"
                          style={{ color: "oklch(0.42 0.01 265)" }}
                          title={sheet.filePath || fileName}
                        >
                          {fileName}
                          {sheet.sheet ? ` · ${sheet.sheet.size.width}×${sheet.sheet.size.height}` : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 시트 제작 — 인물·장소만. 에셋은 시트를 만들지 않습니다. */}
              {onComposeSheet && (
                <button
                  type="button"
                  onClick={onComposeSheet}
                  data-tour="character-sheet-compose"
                  data-tour-open={HOLDS_SHEET}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold"
                  style={{
                    background: "oklch(0.62 0.22 290 / 12%)",
                    border: "1px solid oklch(0.62 0.22 290 / 32%)",
                    color: "oklch(0.84 0.18 290)",
                  }}
                >
                  <LayoutGrid className="h-3 w-3" />
                  {kind === "background" ? "배경 시트 제작" : "캐릭터 시트 제작"}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {viewing && (
        <ImageLightbox
          image={{ name: viewing.sheetLabel || viewing.name, filePath: viewing.filePath, thumb: viewing.thumb }}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}
