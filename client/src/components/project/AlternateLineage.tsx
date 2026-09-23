import { useRef } from "react";
import { CopyPlus, Plus, X } from "lucide-react";
import { EDITOR_DIALOG } from "@/lib/layout";
import { HOLDS_ENTITY_CARD } from "@/lib/useTutorialPanel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import LineageTree, { LINEAGE_ROOT, lineageNodes } from "@/components/project/LineageTree";
import VariationDialog from "@/components/project/VariationDialog";
import { lineageAccent } from "@/components/project/lineageGrid";
import {
  useEntityLineage,
  type EntityLineage,
  type LineageEntity,
  type LineageFolder,
} from "@/components/project/useEntityLineage";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { renameOwnedAssetFiles, useOwnedEditorClose } from "@/components/project/useOwnedAssetRename";
import { ALTERNATE_PLACEHOLDER, alternateStem } from "@/lib/assetStem";
import type { SpaceKind } from "@/lib/blueprint";
import type { RequestTemplateId } from "@/components/LlmRequestButton";
import type { LlmTask } from "@/lib/llm";

/** 다른 원본이 되는 것의 최소 모양 — `Character`·`Background` 가 전부 맞습니다 */
export type AlternateEntity = LineageEntity & { description?: string; analysis?: string };

/** 원본 편집 창을 그리는 쪽이 받는 것. Dialog 껍데기·닫기·이름 따라 바꾸기는 이 컴포넌트가 맡습니다 */
export interface AlternateRootEditorContext<T extends AlternateEntity> {
  /** 상자 안 번호. 창 머리의 「①」 이 됩니다 */
  rootIndex: number;
  /** 파일이 들어갈 폴더와 이름 규칙 — 주인 폴더에 «주인_이름_001» */
  folder: LineageFolder;
  /** 주인·보유 에셋·형제 원본이 쓰는 파일. 폴더 읽기에서 건너뛰고, X 로 빼도 파일은 남깁니다 */
  claimedPaths: () => Set<string>;
  onPatch: (updater: (current: T) => Partial<T>) => void;
  onRemove: () => void;
  onClose: () => void;
  /** 분석 가져오기 목록 — 주인 분석과 형제 원본들의 분석(빈 것은 뺌) */
  analysisSources: { label: string; text: string }[];
}

/** 인물·장소 패널이 「다른 원본」 상자에 넘기는 것. `EntityLineagePanel` 의 `alternates` */
export interface AlternateLineageProps<T extends AlternateEntity> {
  kind: "character" | "background";
  /** 주인. 파일이 이 주인의 폴더에 «주인_이름_번호» 로 들어갑니다(규칙 5) */
  owner: { name: string; analysis?: string };
  items: T[];
  /**
   * 주인(원본+변형)과 보유 애셋의 파일. 다른 원본끼리는 훅의 `claimedFor` 가 형제로 뺍니다 —
   * 여기 제 파일을 넣으면 그것을 남의 것으로 봐 X 로 빼도 파일이 안 지워집니다(규칙 3 위반).
   */
  ownerPaths: () => Set<string>;
  /**
   * 주인 변형과 보유 애셋이 **이미 쓰는 접두**(«숲_겨울» · «숲_제단») — `ownerReservedStems`.
   * 다른 원본 «겨울» 과 주인 변형 «겨울» 은 접두가 같아 파일 이름 공간이 하나가 됩니다. 새 이름의
   * 접두가 여기 있으면 파일이 없어도 거부하고 되돌립니다. 형제 원본끼리는 훅의 `reservedFor` 가 봅니다.
   */
  reservedStems?: () => string[];
  /** 지금 목록을 받아 다음 목록을 만드는 함수. 값으로 넘기면 안 됩니다 */
  onChange: (updater: (current: T[]) => T[]) => void;
  /** 새 원본 한 벌. StepCharacters 는 `newCharacter`, StepBackgrounds 는 `newBackground` */
  create: () => T;
  /** 원본 편집 창의 카드. Dialog 껍데기는 이 컴포넌트가 그립니다 */
  renderRootEditor: (item: T, ctx: AlternateRootEditorContext<T>) => React.ReactNode;
  /** 변형 창 템플릿. 캐릭터·배경 탭의 변형 창과 같은 넷 */
  variation: {
    analysisTemplate: RequestTemplateId;
    analysisTask: LlmTask;
    promptTemplate: RequestTemplateId;
    promptTask: LlmTask;
  };
  /**
   * 배경만 — 변형 창이 실내·실외 칸 목록을 고를 때 봅니다. 장소 탭의 변형 창이 `spaceKind` 를
   * 넘기므로 다른 원본의 변형도 같아야 합니다(규칙 1). 캐릭터는 없음.
   */
  spaceKindOf?: (item: T) => SpaceKind;
}

/**
 * 「다른 원본」 상자 — 인물·장소 패널 안의 **또 하나의 미니 계보 목록**.
 *
 * 모양은 「보유 애셋」 상자(`OwnedAssetLineage`)와 같습니다 — 원본마다 이름 줄(이름 칸 + X)
 * 밑에 작은 계보(원본 → 변형), 끝에 «캐릭터 생성» 단추. 계보 조작은 같은 `useEntityLineage`
 * 이고 `owner` 를 줘서 폴더만 주인 것으로 돌립니다(«냥이_어린시절_001»). 원본 편집 창은
 * 캐릭터·배경 탭의 원본 카드(`CharacterCard`·`BackgroundCard`) **그대로** 를 `renderRootEditor`
 * 로 받아 그립니다 — 어린 시절도 인물이라 인물 창과 같은 칸(역할·키·프로필)이 필요합니다.
 *
 * **한 단계만** 입니다. 다른 원본 안의 `alternates`·`assets` 는 그리지 않습니다 — 깊어지면
 * 폴더 하나에 «냥이_어린시절_아기_…» 가 끝없이 붙고, 어느 것이 주인인지 알 수 없습니다.
 *
 * 원본 카드에는 X 가 없으므로(`LineageTree`) 원본을 지우는 길은 **이름 줄의 X** 뿐입니다.
 * 캐릭터와 배경이 이 하나를 씁니다(규칙 1).
 */
export default function AlternateLineage<T extends AlternateEntity>({
  kind,
  owner,
  items,
  ownerPaths,
  reservedStems,
  onChange,
  create,
  renderRootEditor,
  variation: templates,
  spaceKindOf,
}: AlternateLineageProps<T>) {
  const { projectName, renamePaths } = useProjectMedia();
  const accent = lineageAccent(kind);

  const lineage = useEntityLineage<T>({
    kind,
    entities: items,
    projectName,
    onChange,
    // 자리표시 «원본» — 이름 없는 원본이 «냥이_원본_001». 에셋과 같은 «에셋» 을 쓰면 폴더에서 섞입니다.
    owner: { kind, name: owner.name, claimedPaths: ownerPaths, placeholder: ALTERNATE_PLACEHOLDER, reservedStems },
  });
  const { editing, setEditing, openEntity, patchEntity } = lineage;

  /**
   * 이름 칸에 커서가 들어올 때의 이름(원본 id 별). 커서가 빠질 때 이것과 다르면 파일 접두를
   * 따라 바꿉니다 — `OwnedAssetLineage.followRename` 과 같은 규칙. 글자마다 바꾸면 「어」「어린」
   * 파일이 줄줄이 생기고 확인 창이 계속 뜹니다.
   */
  const focusName = useRef<Record<string, string>>({});
  const followRename = (item: T) => {
    const before = focusName.current[item.id];
    if (before === undefined || before.trim() === item.name.trim()) return;
    const folder = lineage.folderFor(item);
    void renameOwnedAssetFiles({
      projectName,
      folder,
      asset: item,
      oldStems: [alternateStem(folder.ownerName, before)],
      newName: item.name,
      foreignPaths: lineage.claimedFor(item),
      renamePaths,
      noun: "원본",
      // 주인 변형·보유 애셋·형제 원본과 같은 이름은 파일이 없어도 거부 — 접두가 같으면 그때부터 섞입니다.
      reservedStems: lineage.reservedFor(item),
    }).then((outcome) => {
      // 취소·충돌이면 폴더가 진실입니다 — 화면 이름을 파일 접두의 이름(없으면 커서 들어올 때 이름)으로.
      if (!outcome.ok) patchEntity(item.id, () => ({ name: outcome.revertName ?? before }));
    });
  };

  // «캐릭터 생성» 은 바로 새 원본을 만들어 엽니다 — 빈 카드만 생기면 «어디서 채우지?» 가 됩니다.
  const createOne = () => {
    const created = create();
    onChange((current) => [...current, created]);
    setEditing({ entityId: created.id, kind: "root" });
  };

  const noun = kind === "background" ? "배경" : "캐릭터";
  const rootIndexOf = (id: string) => items.findIndex((item) => item.id === id) + 1;

  /** 분석 가져오기 목록 — 주인 분석과 형제 원본들의 분석. 빈 것은 뺍니다 */
  const analysisSourcesFor = (item: T) =>
    [
      { label: `부모 「${owner.name}」`, text: owner.analysis || "" },
      ...items
        .filter((sibling) => sibling.id !== item.id)
        .map((sibling) => ({ label: `원본 「${sibling.name || "이름 없음"}」`, text: sibling.analysis || "" })),
    ].filter((source) => source.text.trim());

  return (
    <div
      data-tour="lineage-alternates"
      className="mt-3 rounded-lg p-3"
      style={{ background: "oklch(0.12 0.008 265)", border: `1px solid ${accent.replace(")", " / 22%)")}` }}
    >
      <div className="flex items-center gap-2">
        <CopyPlus className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <p className="shrink-0 text-[11px] font-semibold" style={{ color: accent }}>
          다른 원본
        </p>
        <p className="min-w-0 flex-1 truncate text-[10px]" style={{ color: "oklch(0.45 0.01 265)" }}>
          {kind === "background"
            ? "계절·시대처럼 같은 장소의 다른 모습. 각각 제 변형을 가집니다"
            : "어린 시절·노인처럼 같은 인물의 다른 모습. 각각 제 변형을 가집니다"}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="mt-1.5 text-[10px]" style={{ color: "oklch(0.45 0.01 265)" }}>
          아직 다른 원본이 없습니다.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {items.map((item, index) => (
            <div key={item.id}>
              {/* 이름 줄. 「보유 애셋」 상자와 같은 모양 — 원본을 지우는 길은 이 X 뿐입니다. */}
              <div data-tour="lineage-alternate-name" className="mb-1.5 flex items-center gap-1.5">
                <input
                  value={item.name}
                  onChange={(event) => patchEntity(item.id, () => ({ name: event.target.value }))}
                  onFocus={() => {
                    focusName.current[item.id] = item.name;
                  }}
                  onBlur={() => followRename(item)}
                  placeholder="원본 이름 (예: 어린 시절)"
                  className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[11px] font-bold outline-none"
                  style={{ color: "white" }}
                />
                <button
                  type="button"
                  onClick={() => void lineage.remove(item)}
                  aria-label={`${item.name || "이름 없는 원본"} 지우기`}
                  className="shrink-0 rounded-md p-1 hover:bg-white/10"
                  style={{ color: "oklch(0.66 0.16 25)" }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              <LineageTree
                compact
                nodes={lineageNodes({
                  name: item.name,
                  rootImages: item.generatedImages,
                  variations: item.variations || [],
                  rootIndex: index + 1,
                  unnamed: "이름 없는 원본",
                })}
                accent={accent}
                onOpen={(id) =>
                  setEditing(
                    id === LINEAGE_ROOT
                      ? { entityId: item.id, kind: "root" }
                      : { entityId: item.id, kind: "variation", id },
                  )
                }
                onBranch={(id) => lineage.branch(item, id === LINEAGE_ROOT ? null : id)}
                onRemove={(id) => void lineage.removeVariation(item, id)}
                onDropImages={(id, files) => lineage.dropImages(item, id === LINEAGE_ROOT ? null : id, files)}
              />
            </div>
          ))}
        </div>
      )}

      {/* 생성 단추는 목록 끝에 — 아래로 길어지니 위에 두면 오르내립니다(보유 애셋과 같은 자리). */}
      <button
        type="button"
        onClick={createOne}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold"
        style={{ border: `1px dashed ${accent.replace(")", " / 40%)")}`, color: accent }}
      >
        <Plus className="h-2.5 w-2.5" /> {noun} 생성
      </button>

      {/* ── 원본 편집 창. 열린 하나만 마운트합니다 — 폴더 읽기가 마운트마다 한 번이라서요. */}
      {openEntity && editing?.kind === "root" && (
        <AlternateRootDialog
          lineage={lineage}
          item={openEntity}
          rootIndex={rootIndexOf(openEntity.id)}
          analysisSources={analysisSourcesFor(openEntity)}
          renderRootEditor={renderRootEditor}
        />
      )}

      {/* ── 변형 편집 창. `AssetLineageDialogs` 의 변형 분기와 같은 호출 — 폴더만 주인 것으로. */}
      {openEntity && editing?.kind === "variation" && (() => {
        const variation = (openEntity.variations || []).find((item) => item.id === editing.id);
        if (!variation) return null;
        const parent = (openEntity.variations || []).find((item) => item.id === variation.parentVariationId);
        // 변형의 변형이면 바로 위 판의 그림이 정체성 기준입니다.
        const source = parent?.generatedImages || openEntity.generatedImages;
        const folder = lineage.folderFor(openEntity);
        return (
          <VariationDialog
            open
            onOpenChange={(next: boolean) => !next && setEditing(null)}
            kind={kind}
            ownerName={openEntity.name || owner.name}
            ownerDescription={openEntity.description || ""}
            parentImage={source.find((image) => image.isPrimary) || source[0] || null}
            ownerImages={openEntity.generatedImages}
            onOwnerImagesChange={(update) =>
              patchEntity(openEntity.id, (current) => ({ generatedImages: update(current.generatedImages || []) }))
            }
            ownerReferences={openEntity.references}
            ownerAnalysis={openEntity.analysis}
            siblings={openEntity.variations || []}
            variation={variation}
            onSave={(next) =>
              patchEntity(openEntity.id, (current) => ({
                variations: (current.variations || []).map((item) => (item.id === next.id ? next : item)),
              }))
            }
            /*
              폴더는 주인 것, 접두는 «주인_이름»(이름 없으면 «주인_원본»). 이게 없으면 변형 창이
              kind·ownerName 만 보고 `character/어린시절/` 을 따로 팝니다(규칙 5 위반).
            */
            folder={{
              ownerName: folder.ownerName,
              referenceAssetType: folder.referenceAssetType,
              generatedAssetType: folder.generatedAssetType,
              stemBase: folder.stemBase ?? alternateStem(folder.ownerName, openEntity.name),
              claimedPaths: () => lineage.claimedFor(openEntity),
            }}
            spaceKind={spaceKindOf?.(openEntity)}
            analysisTemplate={templates.analysisTemplate}
            analysisTask={templates.analysisTask}
            promptTemplate={templates.promptTemplate}
            promptTask={templates.promptTask}
          />
        );
      })()}
    </div>
  );
}

/**
 * 다른 원본의 편집 창 껍데기.
 *
 * 따로 컴포넌트인 이유: `useOwnedEditorClose` 는 훅이라 «창이 열려 있을 때만» 부를 수 없습니다.
 * 열린 원본마다 이 컴포넌트가 마운트되어 열 때 이름을 기억하고, 닫을 때 파일 접두를 따라
 * 바꿉니다 — 보유 에셋 창(`AssetEditorDialog`)과 **같은 훅** 이라 닫기 규칙(중복 막기·
 * 실패 시 이름 되돌리기)이 한 벌입니다(규칙 1).
 */
function AlternateRootDialog<T extends AlternateEntity>({
  lineage,
  item,
  rootIndex,
  analysisSources,
  renderRootEditor,
}: {
  lineage: EntityLineage<T>;
  item: T;
  rootIndex: number;
  analysisSources: { label: string; text: string }[];
  renderRootEditor: AlternateLineageProps<T>["renderRootEditor"];
}) {
  const { projectName, renamePaths } = useProjectMedia();
  const folder = lineage.folderFor(item);
  const claimedPaths = () => lineage.claimedFor(item);

  const { patch, finish } = useOwnedEditorClose<T>({
    projectName,
    folder,
    entity: item,
    foreignPaths: claimedPaths,
    renamePaths,
    onPatch: (updater) => lineage.patchEntity(item.id, updater),
    onClose: () => {
      /*
        **아무것도 안 적고 닫으면 그 원본은 지웁니다.**

        사용자 2026-09-18 점검에서, 「캐릭터 생성」 을 누를 때마다 빈 «이름 없는 원본» 이
        하나씩 쌓이는 것이 드러났습니다. 창을 열어 보기만 해도 남습니다. 목록이 빈 카드로
        길어지면 어느 것이 진짜인지 알 수 없어집니다.

        **적은 것이 하나라도 있으면 지우지 않습니다** — 지우는 쪽이 늘 더 위험합니다.
      */
      const blank =
        !(item.name || "").trim() &&
        !(item.description || "").trim() &&
        !(item.analysis || "").trim() &&
        !(item.references || []).length &&
        !(item.generatedImages || []).length &&
        !(item.variations || []).length;
      lineage.setEditing(null);
      if (blank) void lineage.remove(item);
    },
    noun: "원본",
    // 이름 줄(`followRename`)과 같은 검사 — 창에서 적은 이름도 주인 변형·애셋·형제와 겹치면 되돌립니다.
    reservedStems: () => lineage.reservedFor(item),
  });

  return (
    <Dialog open onOpenChange={(next: boolean) => !next && void finish()}>
      {/*
        `tutorialHolds` 에 제 앵커를 같이 적습니다. 안 적으면 이 창을 가리키는 걸음에 이르는
        순간 창이 «내가 품은 자리가 아니네» 하며 스스로 닫혀, 밝힐 것이 사라집니다.
      */}
      <DialogContent
        data-tour="lineage-alternate-editor"
        tutorialHolds={`${HOLDS_ENTITY_CARD} lineage-alternate-editor`}
        className={EDITOR_DIALOG}
        style={{ background: "oklch(0.13 0.009 265)" }}
      >
        {/* 이름이 비면 「이름 없는 원본 원본」 이 되지 않게 — 스크린리더가 읽는 제목입니다. */}
        <DialogTitle className="sr-only">{item.name ? `${item.name} 원본` : "이름 없는 원본"}</DialogTitle>
        <DialogDescription className="sr-only">같은 인물·장소의 다른 모습을 만듭니다</DialogDescription>
        {renderRootEditor(item, {
          rootIndex,
          folder,
          claimedPaths,
          onPatch: patch,
          onRemove: () => void lineage.remove(item),
          onClose: () => void finish(),
          analysisSources,
        })}
      </DialogContent>
    </Dialog>
  );
}
