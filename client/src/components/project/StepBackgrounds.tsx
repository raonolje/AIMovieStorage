import { cardWantFor, useCurrentTutorialAnchor } from "@/lib/tutorialStore";
import { isInPanoramaDir } from "@/lib/faceSets";
import { useEffect, useState } from "react";
import { EDITOR_DIALOG } from "@/lib/layout";
import { HOLDS_ENTITY_CARD } from "@/lib/useTutorialPanel";
import { MapPin, PackageOpen, Plus, Trash2 } from "lucide-react";
import BorrowCardsDialog from "@/components/BorrowCardsDialog";
import GeneratedImageShelf from "@/components/project/GeneratedImageShelf";
import EntityLineagePanel from "@/components/project/EntityLineagePanel";
import EntitySheetComposer from "@/components/project/EntitySheetComposer";
import { LINEAGE_GRID } from "@/components/project/lineageGrid";
import VariationDialog from "@/components/project/VariationDialog";
import SharedAssetSection from "@/components/SharedAssetSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import PromptCardBody from "@/components/project/PromptCardBody";
import { usePromptCard } from "@/components/project/usePromptCard";
import { autoEquirectOf, useAutoUnfold } from "@/components/project/useAutoUnfold";
import {
  ownerClaimedPaths,
  ownerReservedStems,
  useEntityLineage,
  type LineageFolder,
} from "@/components/project/useEntityLineage";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { fieldStyle } from "@/components/project/fieldStyle";
import { LlmRequestButton } from "@/components/LlmRequestButton";
import { markColor } from "@/components/ImageMarkupEditor";
import { describeMarksForLlm } from "@/lib/imageMarkDraw";
import { backgroundCardDescription } from "@/lib/promptPayloads";
import {
  INITIAL_BACKGROUND_BLUEPRINT_BY_SPACE,
  SPACE_KIND_OPTIONS,
  type SpaceKind,
} from "@/lib/blueprint";
import {
  newBackground,
  uid,
  type Background,
  type GeneratedImageAsset,
  type ProjectDraft,
} from "@/lib/projectTypes";

/**
 * 3단계 — 장소.
 *
 * # 배경은 두 단계로 만듭니다
 *
 * 1차 — 그 공간 전체를 한눈에 보는 **마스터 이미지**를 만듭니다.
 * 2차 — 그 그림 위에 **앵커**를 찍고, 그 지점에서 여섯 면이나 파노라마를 뽑습니다.
 *
 * 여섯 면을 처음부터 따로 만들면 같은 장소로 안 보입니다. 먼저 하나의 공간을
 * 정해 놓고 거기서 방향만 바꿔야 이어집니다.
 *
 * 앵커를 찍는 곳은 여기가 아닙니다. **그림 위의 가위 → 표시하기** 입니다.
 * 배경 카드가 표시를 들고 있으면, 같은 공간에서 앵커만 옮겨 다른 씬을 만들
 * 때마다 원본을 다시 뽑거나 표시를 지웠다 다시 찍어야 하니까요.
 *
 * 지우기·변형 만들기·그림 떨구기 같은 계보 조작은 `useEntityLineage` 가
 * 맡습니다. 캐릭터·공용 에셋과 한 벌이라, 여기서 따로 고치면 안 됩니다(규칙 1).
 */
export default function StepBackgrounds({
  draft,
  onChange,
}: {
  draft: ProjectDraft;
  /**
   * 초안을 고칩니다. **지금 값을 받아 다음 값을 만드는 함수** 여야 합니다.
   *
   * 값으로 덮어쓰면, LLM 요청이 도는 사이에 카드를 더하거나 지웠을 때
   * 나중에 도착한 갱신이 그 사이 변경을 통째로 지웁니다.
   */
  onChange: (updater: (current: ProjectDraft) => Partial<ProjectDraft>) => void;
}) {
  const anchor = useCurrentTutorialAnchor();
  const [borrowing, setBorrowing] = useState(false);
  // 펼친 카드 id 는 세터만 씁니다 — 어느 것이 열렸는지는 카드가 스스로 압니다.
  const [, setOpenId] = useState<string | null>(
    draft.backgrounds[0]?.id ?? null,
  );
  const { projectName } = useProjectMedia();

  const lineage = useEntityLineage<Background>({
    kind: "background",
    entities: draft.backgrounds,
    projectName,
    onChange: (update) =>
      onChange((current) => ({ backgrounds: update(current.backgrounds) })),
  });
  const {
    editing,
    setEditing,
    openEntity: openBackground,
    patchEntity: patchBackground,
  } = lineage;

  /*
    **장소 카드는 지금 걸음을 보고 스스로 엽니다.**

     인물 쪽처럼 «열어 줘» 부탁을 듣게 했더니,
    이 화면은 구도잡기의 «장소 라이브러리» 창 안에서 뜨는 탓에 **부탁이 오간 뒤에 태어납니다** —
    아무도 못 듣습니다. 그래서 듣는 대신 지금 걸음의 앵커를 직접 봅니다(`cardWantFor`).

     전개도 여섯 면·파노라마·앵커 찍기·표시하기는 **장소 그림**에서
    하는 일인데, 카드를 여는 길이 인물에만 있어 그 걸음들이 인물 사진 위에서 돌고 있었습니다.

    **전개도가 붙은 카드를 고릅니다** — 파노라마나 6면이 든 장소가 있으면 그것, 없으면 첫 장소.
    그래야 가위를 열었을 때 «파노라마»·«전개도 6면» 탭이 실제로 서 있습니다.
  */
  useEffect(() => {
    const want = cardWantFor(anchor ?? undefined);
    if (!want) return;
    if (want === "closed") {
      setEditing(null);
      return;
    }
    if (editing) return;
    const unfolded = draft.backgrounds.find((item) =>
      (item.generatedImages || []).some((image) => image.face || isInPanoramaDir(image.filePath)),
    );
    const pick = unfolded ?? draft.backgrounds[0];
    if (pick) {
      setEditing({ entityId: pick.id, kind: "root" });
      return;
    }
    const made = newBackground();
    onChange((current) => ({ backgrounds: [...current.backgrounds, made] }));
    setOpenId(made.id);
    setEditing({ entityId: made.id, kind: "root" });
  }, [anchor, draft.backgrounds, editing, setEditing, onChange]);

  const add = () => {
    const created = newBackground();
    onChange((current) => ({ backgrounds: [...current.backgrounds, created] }));
    setOpenId(created.id);
  };

  /** 시트 창을 연 장소. `sheetId` 가 있으면 그 시트를 고치는 중(다시 굽기) — 캐릭터 탭과 같은 규칙 */
  const [sheetFor, setSheetFor] = useState<{
    ownerId: string;
    sheetId?: string;
  } | null>(null);
  const sheetOwner = draft.backgrounds.find(
    (item) => item.id === sheetFor?.ownerId,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <p
          className="min-w-0 flex-1 text-xs"
          style={{ color: "oklch(0.55 0.01 265)" }}
        >
          장면이 벌어지는 장소를 등록합니다. 마스터 이미지를 만들고, 앵커를 찍어
          여섯 면이나 파노라마를 뽑습니다.
        </p>
        {/* «추가» 단추는 목록 끝 하나뿐입니다 — 캐릭터 탭과 같은 규칙. */}
      </div>

      {draft.backgrounds.length === 0 && (
        <div
          className="flex flex-col items-center gap-3 rounded-xl px-4 py-10"
          style={{ border: "2px dashed oklch(1 0 0 / 10%)" }}
        >
          <MapPin
            className="h-8 w-8"
            style={{ color: "oklch(0.35 0.01 265)" }}
          />
          <p className="text-xs" style={{ color: "oklch(0.52 0.01 265)" }}>
            등록된 장소가 없습니다
          </p>
          <button
            type="button"
            onClick={add}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold"
            style={{
              background: "oklch(0.55 0.15 200 / 16%)",
              border: "1px solid oklch(0.55 0.15 200 / 40%)",
              color: "oklch(0.82 0.14 200)",
            }}
          >
            <Plus className="h-3.5 w-3.5" /> 첫 장소 추가하기
          </button>
          <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
            배경 없이도 계속 진행할 수 있습니다
          </p>
        </div>
      )}

      {/* 캐릭터 탭과 **같은 컴포넌트**를 씁니다. 한쪽에만 기능이 생기는 일을 막습니다. */}
      {/* 4열 (xl 기준) — 캐릭터 페이지와 같은 밀도. (08/21 확정) */}
      <div className={LINEAGE_GRID}>
        {draft.backgrounds.map((background, index) => (
          <EntityLineagePanel
            key={background.id}
            kind="background"
            entityId={background.id}
            name={background.name}
            onNameChange={(name) =>
              patchBackground(background.id, () => ({ name }))
            }
            rootIndex={index + 1}
            rootImages={background.generatedImages}
            variations={background.variations}
            onOpenRoot={() =>
              setEditing({ entityId: background.id, kind: "root" })
            }
            onOpenVariation={(id) =>
              setEditing({ entityId: background.id, kind: "variation", id })
            }
            onBranch={(fromId) => lineage.branch(background, fromId)}
            onRemoveVariation={(id) =>
              void lineage.removeVariation(background, id)
            }
            onRemove={() => void lineage.remove(background)}
            /*
              다른 원본 — 계절·시대처럼 같은 장소의 다른 모습. 캐릭터 탭과 같은 상자(규칙 1).
              파일은 이 장소 폴더 안에 «장소_이름_번호» 로(규칙 5). 원본 편집 창은 이 탭의 원본 카드
              (`BackgroundCard`) 그대로 — 겨울의 숲도 장소라 공간 유형·앵커 칸이 똑같이 필요합니다.
            */
            alternates={{
              kind: "background",
              owner: {
                name: background.name || "장소",
                analysis: background.analysis,
              },
              items: background.alternates ?? [],
              // 주인과 보유 에셋의 파일만 «남의 것». 다른 원본 제 것은 넣지 않습니다 — 넣으면 훅이
              // 제 파일을 남의 것으로 봐 X 로 빼도 파일이 안 지워집니다(`ownerClaimedPaths` 주석).
              ownerPaths: () =>
                ownerClaimedPaths(background, {
                  includeAssets: true,
                  includeAlternates: false,
                }),
              // 주인 변형·보유 에셋의 접두. 다른 원본 «겨울» 과 변형 «겨울» 은 접두가 같아(`숲_겨울`) 파일이
              // 섞이므로 같은 이름을 파일이 없어도 거부합니다. 형제 원본은 훅이 봅니다(`reservedFor`).
              reservedStems: () =>
                ownerReservedStems(background, background.name || "장소", {
                  includeVariations: true,
                  includeAssets: true,
                  includeAlternates: false,
                }),
              onChange: (update) =>
                patchBackground(background.id, (current) => ({
                  alternates: update(current.alternates ?? []),
                })),
              create: () => newBackground(),
              renderRootEditor: (alternate, ctx) => (
                <BackgroundCard
                  background={alternate}
                  open
                  onToggle={ctx.onClose}
                  onPatch={ctx.onPatch}
                  onRemove={ctx.onRemove}
                  folder={ctx.folder}
                  claimedPaths={ctx.claimedPaths}
                  analysisSources={ctx.analysisSources}
                />
              ),
              variation: {
                analysisTemplate: "background-analysis",
                analysisTask: "backgroundAnalysis",
                promptTemplate: "background-variation",
                promptTask: "backgroundVariation",
              },
              // 장소 탭의 변형 창이 spaceKind 를 넘기니 다른 원본의 변형도 같아야 합니다.
              spaceKindOf: (alternate) => alternate.spaceKind || "exterior",
            }}
            /*
              보유 애셋은 패널 안 미니 계보로 — 캐릭터 탭과 같은 규칙.
              파일은 이 장소 폴더 안에 «장소_에셋_번호» 로 들어가므로(규칙 5), 장소(와 변형)의
              파일 목록을 넘겨 에셋 카드가 폴더를 읽을 때 장소 파일을 제 것으로 줍지 않게 합니다.
            */
            ownedAssets={{
              owner: { kind: "background", name: background.name || "장소" },
              assets: background.assets ?? [],
              // 다른 원본의 파일도 같은 폴더라 «남의 것» 에 넣습니다. 에셋 제 것은 넣지 않습니다 —
              // 넣으면 훅이 제 파일을 남의 것으로 봐 X 로 빼도 파일이 안 지워집니다(`ownerClaimedPaths` 주석).
              ownerPaths: () =>
                ownerClaimedPaths(background, {
                  includeAssets: false,
                  includeAlternates: true,
                }),
              // 주인 변형·다른 원본의 접두 — 같은 이름의 에셋은 파일이 없어도 거부(다른 원본 상자와 같은 이유).
              reservedStems: () =>
                ownerReservedStems(background, background.name || "장소", {
                  includeVariations: true,
                  includeAssets: false,
                  includeAlternates: true,
                }),
              onChange: (update) =>
                patchBackground(background.id, (current) => ({
                  assets: update(current.assets ?? []),
                })),
            }}
            onComposeSheet={() => setSheetFor({ ownerId: background.id })}
            onDropImages={(variationId, files) =>
              lineage.dropImages(background, variationId, files)
            }
            onSheetRename={(imageId, sheetLabel) =>
              lineage.renameSheet(background, imageId, sheetLabel)
            }
            onSheetRemove={(imageId) =>
              void lineage.removeSheet(background, imageId)
            }
            onSheetEdit={(imageId) =>
              setSheetFor({ ownerId: background.id, sheetId: imageId })
            }
          />
        ))}
      </div>

      {/* 위 단추까지 올라갔다 내려오지 않게 목록 끝에도 같은 단추를 둡니다. */}
      {draft.backgrounds.length > 0 && (
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-xs font-semibold"
          style={{
            border: "2px dashed oklch(1 0 0 / 10%)",
            color: "oklch(0.72 0.14 290)",
          }}
        >
          <Plus className="h-3.5 w-3.5" /> 배경 추가
        </button>
      )}

      {/*
        캐릭터 탭과 **같은 창**을 씁니다(규칙 1). 갈래만 다릅니다 —
        
      */}
      <button
        type="button"
        onClick={() => setBorrowing(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[11px] font-semibold"
        style={{
          border: "1px dashed oklch(1 0 0 / 10%)",
          color: "oklch(0.66 0.11 200)",
        }}
      >
        <PackageOpen className="h-3.5 w-3.5" /> 다른 작품에서 장소 끌어오기
      </button>

      {borrowing && (
        <BorrowCardsDialog
          kind="background"
          draft={draft}
          projectName={projectName}
          onClose={() => setBorrowing(false)}
          onDone={(made) =>
            onChange((current) => ({
              backgrounds: [...current.backgrounds, ...made.backgrounds],
            }))
          }
        />
      )}

      {/* 공용 에셋 바 — 캐릭터·배경 페이지에 같은 목록이 뜹니다. */}
      <SharedAssetSection
        assets={draft.sharedAssets || []}
        projectName={draft.title}
        onChange={(update) =>
          onChange((current) => ({
            sharedAssets: update(current.sharedAssets || []),
          }))
        }
      />

      {openBackground && editing?.kind === "root" && (
        <Dialog
          open
          onOpenChange={(next: boolean) => !next && setEditing(null)}
        >
          <DialogContent
            tutorialHolds={HOLDS_ENTITY_CARD}
            className={EDITOR_DIALOG}
            style={{ background: "oklch(0.13 0.009 265)" }}
          >
            <DialogTitle className="sr-only">
              {openBackground.name || "장소"} 마스터 이미지
            </DialogTitle>
            <DialogDescription className="sr-only">
              공간 전체를 한눈에 보는 기준 이미지를 만듭니다
            </DialogDescription>
            <BackgroundCard
              background={openBackground}
              open
              onToggle={() => setEditing(null)}
              onPatch={(updater) => patchBackground(openBackground.id, updater)}
              onRemove={() => void lineage.remove(openBackground)}
            />
          </DialogContent>
        </Dialog>
      )}

      {openBackground &&
        editing?.kind === "variation" &&
        (() => {
          const variation = openBackground.variations.find(
            (item) => item.id === editing.id,
          );
          if (!variation) return null;
          const parent = openBackground.variations.find(
            (item) => item.id === variation.parentVariationId,
          );
          const source =
            parent?.generatedImages || openBackground.generatedImages;
          return (
            <VariationDialog
              open
              onOpenChange={(next: boolean) => !next && setEditing(null)}
              kind="background"
              ownerName={openBackground.name || "장소"}
              ownerDescription={[
                openBackground.location,
                openBackground.description,
              ]
                .filter(Boolean)
                .join(" — ")}
              parentImage={
                source.find((image) => image.isPrimary) || source[0] || null
              }
              ownerImages={openBackground.generatedImages}
              onOwnerImagesChange={(update) =>
                patchBackground(openBackground.id, (current) => ({
                  generatedImages: update(current.generatedImages || []),
                }))
              }
              ownerReferences={openBackground.references}
              ownerAnalysis={openBackground.analysis}
              siblings={openBackground.variations}
              variation={variation}
              onSave={(next) =>
                patchBackground(openBackground.id, (current) => ({
                  variations: current.variations.map((item) =>
                    item.id === next.id ? next : item,
                  ),
                }))
              }
              spaceKind={openBackground.spaceKind || "exterior"}
              analysisTemplate="background-analysis"
              analysisTask="backgroundAnalysis"
              promptTemplate="background-variation"
              promptTask="backgroundVariation"
              /*
              보유 에셋·다른 원본(과 그 변형)의 파일과 접두 — 캐릭터 탭과 같은 규칙(규칙 1). 다른 원본 «겨울» 의
              접두 `숲_겨울` 은 이 변형 «겨울» 과 같아서, 안 넘기면 변형 창이 그 파일을 제 것으로 줍고(X 로 지움)
              이름 바꾸기가 그 파일까지 끌고 갑니다(검토 2026-09-08). 제 파일과 형제 변형은 창이 따로 셉니다.
            */
              claimedPaths={() =>
                ownerClaimedPaths(openBackground, {
                  includeAssets: true,
                  includeAlternates: true,
                  includeSelf: false,
                  includeVariations: false,
                })
              }
              reservedStems={() =>
                ownerReservedStems(
                  openBackground,
                  openBackground.name || "장소",
                  {
                    includeVariations: false,
                    includeAssets: true,
                    includeAlternates: true,
                  },
                )
              }
            />
          );
        })()}

      {/* 시트 창. 캐릭터와 같은 컴포넌트입니다 — 배치도 초기화 같은 규칙이 한쪽에만 생기지 않게. */}
      {sheetOwner && (
        <EntitySheetComposer
          kind="background"
          owner={sheetOwner}
          onClose={() => setSheetFor(null)}
          projectName={projectName}
          sharedAssets={draft.sharedAssets}
          basics={[
            { label: "장소", value: sheetOwner.name },
            { label: "위치", value: sheetOwner.location },
          ].filter((item) => item.value)}
          patchOwner={(updater) => patchBackground(sheetOwner.id, updater)}
          // 배치도는 프로젝트 공용 — 캐릭터 탭과 같은 목록에서 고릅니다.
          layouts={draft.sheetLayouts || []}
          patchProject={(updater) =>
            onChange((current) => ({
              sheetLayouts: updater(current.sheetLayouts || []),
            }))
          }
          editing={
            sheetFor?.sheetId
              ? sheetOwner.generatedImages.find(
                  (image) => image.id === sheetFor.sheetId,
                )
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * 장소 원본 편집 카드.
 *
 * 주인 장소와 **다른 원본**(겨울의 숲·백 년 전의 숲, `AlternateLineage`)이 같은 카드를 씁니다 —
 * 캐릭터 탭의 `CharacterCard` 와 같은 규칙(규칙 1). 다른 것은 파일이 들어가는 폴더와 이름 규칙
 * (`folder`)뿐: 주인은 제 폴더에 `숲_001`, 다른 원본은 주인 폴더에 `숲_겨울_001`(규칙 5).
 */
export function BackgroundCard({
  background,
  open,
  onPatch,
  onRemove,
  folder,
  claimedPaths,
  analysisSources,
  placeScope,
}: {
  background: Background;
  open: boolean;
  onToggle: () => void;
  onPatch: (updater: (current: Background) => Partial<Background>) => void;
  onRemove: () => void;
  /** 다른 원본일 때만 — 주인 폴더와 «주인_이름» 접두. 없으면 주인 장소(제 폴더, 제 이름) */
  folder?: LineageFolder;
  /** 다른 원본일 때만 — 주인·보유 에셋·형제 원본이 쓰는 파일. 폴더 읽기에서 건너뜁니다 */
  claimedPaths?: () => Set<string>;
  /** 분석 가져오기 목록(주인·형제 원본의 분석). `PromptCardBody` 에 그대로 */
  analysisSources?: { label: string; text: string }[];
  /**
   * 구도잡기에서 연 카드일 때 — 카드를 그 일에 맞게 좁힙니다(첫 레퍼런스 칸 빼고, 구성은 전개도·파노라마만).
   * 자세한 까닭은 `PromptCardBody` 의 같은 이름 프롭 주석에.
   */
  placeScope?: "room" | "dome" | "wall" | "special";
}) {
  const { projectName, projectContext, imageMarks } = useProjectMedia();
  const spaceKind: SpaceKind = background.spaceKind || "exterior";

  const card = usePromptCard<Background>({
    kind: "background",
    entity: background,
    patch: onPatch,
    name: background.name,
    /*
      다른 원본(`folder` 있음)은 주인 폴더 안이라 변형처럼 **자기 접두 파일만** 줍습니다.
      이름을 아직 안 적었으면 접두는 `숲_원본`(folderFor) — 주인 파일을 제 것으로 주우면 안 되니까요.
      주인 장소는 제 폴더라 접두 없이 전부 제 것입니다.
    */
    scope: folder ? "variation" : undefined,
    stem: folder?.stemBase,
    ownerName: folder?.ownerName,
    // 변형·보유 에셋(과 에셋의 변형)·다른 원본(과 그 변형)의 파일도 이 폴더에 있습니다. 그것까지 원본
    // 목록에 붙이면 안 됩니다. 에셋 파일은 `숲_제단_001`, 다른 원본은 `숲_겨울_001` 이라 접두 `숲` 으로는
    // 걸러지지 않습니다 — 여기서 빼는 수밖에 없습니다. 제 원본 파일만 빼고(`includeSelf: false`).
    // 다른 원본이면 넘어온 것(주인·에셋·형제) ∪ **제 변형** 파일 — 접두가 `숲_겨울_` 로 같아서
    // (`숲_겨울_밤_001`) 안 가리면 변형 그림이 원본 목록에 붙습니다(`AssetEditorDialog` 와 같은 이유).
    claimedPaths: () =>
      new Set([
        ...(claimedPaths?.() ?? []),
        ...ownerClaimedPaths(background, {
          includeAssets: true,
          includeAlternates: true,
          includeSelf: false,
        }),
      ]),
    // 위치와 설명을 한 줄로 — 일괄 생성 4단계가 같은 함수로 짓습니다(규칙 1).
    description: backgroundCardDescription(background),
    projectName,
    projectContext,
    referenceAssetType: folder?.referenceAssetType ?? "background-reference",
    analysisTemplate: "background-analysis",
    analysisTask: "backgroundAnalysis",
    promptTemplate: "background-sheet",
    promptTask: "backgroundSheet",
    spaceKind,
  });

  /*
    전개도가 들어오면 **자동으로 여섯 면을 잘라 저장합니다.**

     그림이 들어오는 길은 여럿이라(선반·후보함·로컬·폴더 읽기)
    길마다 걸면 새 길이 생길 때 빠뜨립니다. 카드가 제 목록을 지켜보는 자리 하나면 됩니다.

    접두·폴더는 잘라낸 칸을 저장할 때와 **같은 규칙**입니다(위 `cropSave` 와 같은 값) —
    다른 원본은 제 폴더가 없어서 주인 폴더에 «주인_이름» 접두로 들어가야 합니다(규칙 5).
  */
  useAutoUnfold({
    images: background.generatedImages,
    patch: onPatch as (
      updater: (current: { generatedImages: GeneratedImageAsset[] }) => {
        generatedImages: GeneratedImageAsset[];
      },
    ) => void,
    projectName,
    assetType: folder?.generatedAssetType ?? "background-generated",
    ownerName: folder?.ownerName ?? background.name,
    prefix: folder?.stemBase ?? background.name,
    spaceKind,
    // 등장방형 칩을 켜 두었으면 2:1 그림도 여섯 면으로(실내는 방 크기·앵커로, 실외는 정육면체).
    equirect: autoEquirectOf(background.blueprint, spaceKind, background.panoramaSpace, background.exteriorSpace, card.identityMarks(), `${background.promptEn ?? ""}
${background.promptKo ?? ""}`),
  });

  const preview =
    background.generatedImages?.find((image) => image.isPrimary) ||
    background.generatedImages?.[0];

  /** 표시를 읽어 올 그림. 앵커는 그림에 붙어 있고 여기서는 고르기만 합니다. */
  const markSource =
    background.generatedImages?.find(
      (image) => image.id === background.faceMarkSourceId,
    ) || background.generatedImages?.[0];
  const marks =
    (markSource?.filePath ? imageMarks[markSource.filePath] : undefined) || [];

  return (
    <section
      className="rounded-xl"
      style={{
        background: "oklch(0.14 0.009 265)",
        border: "1px solid oklch(1 0 0 / 8%)",
      }}
    >
      {/* 오른쪽 48px 는 비워 둡니다 — DialogContent 가 그 자리에 닫기 X 를
          자동으로 그립니다. 안 비우면 휴지통 위에 X 가 포개져서,
          지우려고 눌렀는데 창만 닫힙니다. */}
      <div className="flex items-center gap-2 py-2.5 pl-3 pr-12">
        <div
          className="h-9 w-9 shrink-0 overflow-hidden rounded-lg"
          style={{ background: "oklch(0.10 0.006 265)" }}
        >
          {preview ? (
            <img
              src={card.previewOf(preview)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <MapPin
                className="h-4 w-4"
                style={{ color: "oklch(0.32 0.01 265)" }}
              />
            </div>
          )}
        </div>

        <input
          value={background.name}
          onChange={(event) => onPatch(() => ({ name: event.target.value }))}
          placeholder="장소 이름"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold outline-none"
          style={{ color: "white" }}
        />
        <button
          type="button"
          data-tour="env-place-remove"
          onClick={onRemove}
          aria-label="지우기"
          className="shrink-0 rounded p-1.5 hover:bg-white/10"
          style={{ color: "oklch(0.60 0.15 25)" }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div
          className="space-y-3 border-t px-3 pb-3 pt-3"
          style={{ borderColor: "oklch(1 0 0 / 8%)" }}
        >
          {/*
            실내인지 실외인지가 먼저입니다. 마스터 이미지의 종류가 여기서 갈려요.
            실외는 조감도가 통하지만 실내는 지붕에 막혀 아무것도 안 보입니다.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[11px] font-semibold"
              style={{ color: "oklch(0.72 0.01 265)" }}
            >
              공간 유형
            </span>
            {SPACE_KIND_OPTIONS.map((option) => {
              const on = spaceKind === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    onPatch((current) => ({
                      spaceKind: option.id,
                      // 유형을 바꾸면 고른 칸이 그쪽에 없는 것일 수 있습니다.
                      // 아직 아무것도 안 골랐을 때만 기본값으로 갈아 끼웁니다.
                      blueprint: current.blueprint.length
                        ? current.blueprint
                        : [...INITIAL_BACKGROUND_BLUEPRINT_BY_SPACE[option.id]],
                    }))
                  }
                  title={option.hint}
                  className="rounded-md px-2.5 py-1.5 text-[11px] font-medium"
                  style={{
                    background: on
                      ? "oklch(0.55 0.15 200 / 22%)"
                      : "oklch(1 0 0 / 5%)",
                    border: `1px solid ${on ? "oklch(0.55 0.15 200 / 50%)" : "oklch(1 0 0 / 8%)"}`,
                    color: on ? "oklch(0.84 0.14 200)" : "oklch(0.58 0.01 265)",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <PromptCardBody
            kind="background"
            placeScope={placeScope}
            // 기본 정보는 레퍼런스 스트립 오른쪽. 캐릭터와 같은 배치입니다.
            fields={
              <input
                value={background.location}
                onChange={(event) =>
                  onPatch(() => ({ location: event.target.value }))
                }
                placeholder="어디에 있는 곳인지 (예: 계곡 안쪽, 마을에서 반나절)"
                className="w-full rounded-md px-2.5 py-2 text-xs outline-none"
                style={fieldStyle}
              />
            }
            descriptionLabel="공간 묘사 — 분석 결과와 합산됩니다"
            descriptionPlaceholder="무엇이 있는 곳인지. 재질과 빛도 함께 적으세요"
            /*
              다른 원본은 제 폴더가 없습니다. `cropSave` 없이는 `SheetPanelCropper` 가 이름(«겨울»)으로 폴더를
              파 잘라낸 칸·표시가 `background/겨울/` 로 가고, 그 파일은 주인 폴더 읽기·이름 바꾸기·주인 지우기가
              전부 못 봅니다(규칙 5·3 위반, 검토 2026-09-08). 캐릭터 카드와 같은 규칙(규칙 1). 주인 장소는 지금대로.
            */
            cropSave={
              folder
                ? {
                    ownerName: folder.ownerName,
                    assetType: folder.generatedAssetType,
                    stem: folder.stemBase,
                    onSaved: (files) =>
                      onPatch((current) => ({
                        generatedImages: [
                          ...current.generatedImages,
                          // thumb 은 방금 구운 blob — 저장된 파일을 앱이 못 읽을 때 액박 대신 보여 줄 폴백.
                          ...files.map((file) => ({
                            id: uid(),
                            name: file.name,
                            thumb: file.thumb ?? "",
                            file: null,
                            filePath: file.path,
                          })),
                        ],
                      })),
                  }
                : undefined
            }
            entity={background}
            patch={onPatch}
            card={card}
            name={background.name}
            analysisTemplate="background-analysis"
            sheetCaption="Landscape 16:9 · master image"
            promptCaption="공간 기준 + 구성에서 고른 칸 + 모델별 문법"
            promptTemplate="background-sheet"
            spaceKind={spaceKind}
            analysisSources={analysisSources}
          />

          {/* ── 2차 · 앵커에서 뽑기 ────────────────────────────────────── */}
          {(background.generatedImages?.length || 0) > 0 && (
            <section
              className="space-y-2 rounded-lg p-3"
              style={{
                background: "oklch(0.13 0.009 265)",
                border: "1px solid oklch(0.55 0.15 200 / 22%)",
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">
                    마스터 이미지에 앵커 찍기
                  </p>
                  <p
                    className="mt-0.5 text-[10px]"
                    style={{ color: "oklch(0.45 0.01 265)" }}
                  >
                    카메라가 설 지점을 찍고 정면으로 볼 쪽으로 끌면, 그 지점에서
                    여섯 면이나 파노라마가 나옵니다
                  </p>
                </div>
                <select
                  value={markSource?.id || ""}
                  onChange={(event) =>
                    onPatch(() => ({ faceMarkSourceId: event.target.value }))
                  }
                  className="shrink-0 rounded-md px-2 py-1.5 text-[11px] outline-none"
                  style={fieldStyle}
                >
                  {(background.generatedImages || []).map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.name}
                    </option>
                  ))}
                </select>
                <LlmRequestButton
                  template="background-faces"
                  title={`배경 6면 프롬프트 · ${background.name || "배경"}`}
                  modelId={background.promptModel}
                  data={() => ({
                    project: projectContext?.facts ?? null,
                    name: background.name,
                    location: background.location,
                    description: background.description,
                    analysis: background.analysis || null,
                    spaceKind,
                    requiredAspects: background.blueprint,
                    // 번호·각도는 변형 창의 프롬프트 요청(usePromptCard)과 같은 함수로 — 두 창이 다른 각도를
                    // 보내면 «앞» 이 매번 다른 뜻이 됩니다.
                    marks: describeMarksForLlm(marks),
                  })}
                  imageCount={() => 1}
                  // 6면 요청도 결과가 네 칸으로 돌아와야 합니다. 앵커에서 뽑는
                  // 프롬프트라 조건 줄에 «앵커» 라고 남겨 어느 판인지 알아봅니다.
                  onApplyPrompt={(result) =>
                    card.applyPrompt(
                      result,
                      card.conditions("앵커 6면 · 붙여넣기"),
                    )
                  }
                />
              </div>

              {marks.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {marks.map((mark, index) => (
                    <span
                      key={mark.id}
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        background: "oklch(1 0 0 / 6%)",
                        color: "oklch(0.72 0.01 265)",
                      }}
                    >
                      <b style={{ color: markColor(index) }}>{index + 1}</b>{" "}
                      {mark.note || "설명 없음"}
                    </span>
                  ))}
                </div>
              ) : (
                <p
                  className="text-[11px] leading-relaxed"
                  style={{ color: "oklch(0.45 0.01 265)" }}
                >
                  이 그림에는 아직 표시가 없습니다. 그림 위에 마우스를 올려{" "}
                  <b>가위</b> 를 누르고
                  <b> 표시하기</b> 로 앵커를 찍은 뒤 <b>표시한 그림 저장</b> 을
                  누르세요. 표시가 그려진 그림이 폴더에 새 파일로 생기고, 그
                  파일을 위에서 고르면 여기 표시가 따라옵니다.
                </p>
              )}
            </section>
          )}

          <GeneratedImageShelf
            images={background.generatedImages}
            onChange={(update) =>
              onPatch((current) => ({
                generatedImages: update(current.generatedImages),
              }))
            }
            assetLabel={background.name || "배경"}
            // 폴더·이름 규칙은 `folder` 하나에서. 다른 원본이면 주인 폴더에 «주인_이름_001».
            ownerName={folder?.ownerName ?? (background.name || "배경")}
            stem={folder?.stemBase}
            assetType={folder?.generatedAssetType ?? "background-generated"}
            cropKind="background"
            faceSetSize={autoEquirectOf(background.blueprint, spaceKind, background.panoramaSpace, background.exteriorSpace, null, `${background.promptEn ?? ""}\n${background.promptKo ?? ""}`)?.stamp}
            // 파노라마 여섯 면의 위 면 이름 — 실내 «천장», 아니면 «하늘».
            spaceKind={spaceKind}
          />
        </div>
      )}
    </section>
  );
}
