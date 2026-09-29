import { useEffect, useState } from "react";
import { EDITOR_DIALOG } from "@/lib/layout";
import { HOLDS_ENTITY_CARD } from "@/lib/useTutorialPanel";
import { TUTORIAL_CARD_EVENT, type TutorialCardWant } from "@/lib/tutorialStore";
import { PackageOpen, Plus, Trash2, User } from "lucide-react";
import CharacterProfilePanel from "@/components/CharacterProfilePanel";
import CharacterVoicePanel from "@/components/project/CharacterVoicePanel";
import { applyVoiceChange } from "@/lib/characterVoice";
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
import {
  ownerClaimedPaths,
  ownerReservedStems,
  useEntityLineage,
  type LineageFolder,
} from "@/components/project/useEntityLineage";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import BorrowCardsDialog from "@/components/BorrowCardsDialog";
import { fieldStyle } from "@/components/project/fieldStyle";
import { sheetProfileBasics } from "@/lib/sheetCompose";
// 기본 정보(키·체형·나이…)와 그 표는 `lib/promptPayloads` 한 벌 — 일괄 생성 4단계가 같은 것으로 요청합니다(규칙 1).
import { BUILD_LABELS, characterBasics } from "@/lib/promptPayloads";
import {
  newCharacter,
  uid,
  type Character,
  type ProjectDraft,
} from "@/lib/projectTypes";

/**
 * 2단계 — 인물.
 *
 * 카드 하나가 인물 하나입니다. 안쪽의 «레퍼런스 → 분석 → 프롬프트» 흐름은
 * 배경·에셋과 똑같아서 `PromptCardBody` 가 맡습니다. 여기서 다루는 것은
 * 인물에만 있는 것들 — 이름·역할·키·체형, 그리고 성격 프로필입니다.
 *
 * 지우기·변형 만들기·그림 떨구기 같은 계보 조작은 `useEntityLineage` 가
 * 맡습니다. 배경·공용 에셋과 한 벌이라, 여기서 따로 고치면 안 됩니다(규칙 1).
 */
export default function StepCharacters({
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
  const [borrowing, setBorrowing] = useState(false);
  // 펼친 카드 id 는 세터만 씁니다 — 어느 것이 열렸는지는 카드가 스스로 압니다.
  const [, setOpenId] = useState<string | null>(
    draft.characters[0]?.id ?? null,
  );
  const { projectName } = useProjectMedia();

  const lineage = useEntityLineage<Character>({
    kind: "character",
    entities: draft.characters,
    projectName,
    onChange: (update) =>
      onChange((current) => ({ characters: update(current.characters) })),
  });
  const {
    editing,
    setEditing,
    openEntity: openCharacter,
    patchEntity: patchCharacter,
  } = lineage;

  const add = () => {
    const created = newCharacter();
    onChange((current) => ({ characters: [...current.characters, created] }));
    setOpenId(created.id);
  };

  /*
    ── 튜토리얼이 카드 창을 열고 닫습니다 ─────────────────────────────────
    

    캐릭터 튜토리얼의 걸음은 카드 창 «안»(레퍼런스·분석·프롬프트·가위)과 그 아래 «패널»
    (시트 제작·변형) 두 층에 걸쳐 있습니다. 어느 쪽이 필요한지는 안내 창이 앵커 이름으로
    판단해(`cardWantFor`) 부탁만 보내고, 실제로 여닫는 것은 상태를 쥔 여기서 합니다.

    첫 인물을 여는 까닭 — 튜토리얼은 «아무 카드나 하나» 면 됩니다. 이미 열려 있으면 그대로 둡니다
    (열린 것을 닫았다 다시 열면 사람이 적던 글이 날아갑니다).
  */
  useEffect(() => {
    const onWant = (event: Event) => {
      const want = (event as CustomEvent<TutorialCardWant>).detail;
      if (want === "closed") {
        setEditing(null);
        return;
      }
      if (editing) return;
      const first = draft.characters[0];
      if (first) {
        setEditing({ entityId: first.id, kind: "root" });
        return;
      }
      // 하나도 없으면 빈 카드를
      // 하나 만들어 엽니다. 없는 화면을 가리키며 「여기 있습니다」 라고 할 수는 없습니다.
      const created = newCharacter();
      onChange((current) => ({ characters: [...current.characters, created] }));
      setOpenId(created.id);
      setEditing({ entityId: created.id, kind: "root" });
    };
    window.addEventListener(TUTORIAL_CARD_EVENT, onWant);
    return () => window.removeEventListener(TUTORIAL_CARD_EVENT, onWant);
  }, [draft.characters, editing, setEditing, onChange]);

  /** 시트 창을 연 인물. `sheetId` 가 있으면 그 시트를 고치는 중(다시 굽기) */
  const [sheetFor, setSheetFor] = useState<{
    ownerId: string;
    sheetId?: string;
  } | null>(null);
  const sheetOwner = draft.characters.find(
    (item) => item.id === sheetFor?.ownerId,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <p
          className="min-w-0 flex-1 text-xs"
          style={{ color: "oklch(0.55 0.01 265)" }}
        >
          영상에 등장하는 캐릭터를 등록합니다. 이미지를 업로드하면 외형을
          분석하여 모델별 최적화 프롬프트를 생성합니다.
        </p>
        {/* «추가» 단추는 목록 끝 하나뿐입니다. 위에도 두면 오르내리며 헷갈립니다. */}
      </div>

      {draft.characters.length === 0 && (
        <div
          className="flex flex-col items-center gap-3 rounded-xl px-4 py-10"
          style={{ border: "2px dashed oklch(1 0 0 / 10%)" }}
        >
          <User className="h-8 w-8" style={{ color: "oklch(0.35 0.01 265)" }} />
          <p className="text-xs" style={{ color: "oklch(0.52 0.01 265)" }}>
            등록된 캐릭터가 없습니다
          </p>
          <button
            type="button"
            onClick={add}
            data-tour="characters-add"
            className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold"
            style={{
              background: "oklch(0.62 0.22 290 / 16%)",
              border: "1px solid oklch(0.62 0.22 290 / 40%)",
              color: "oklch(0.86 0.16 290)",
            }}
          >
            <Plus className="h-3.5 w-3.5" /> 첫 캐릭터 추가하기
          </button>
          <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
            캐릭터 없이도 계속 진행할 수 있습니다
          </p>
        </div>
      )}

      {/* 인물마다 패널 하나. 넓으면 나란히 놓입니다. */}
      {/* 4열 (xl 기준) — 인물이 늘어도 한눈에 훑을 수 있게 좁고 길게 놓습니다. (08/21 확정) */}
      <div className={LINEAGE_GRID}>
        {draft.characters.map((character, index) => (
          <EntityLineagePanel
            key={character.id}
            kind="character"
            entityId={character.id}
            name={character.name}
            onNameChange={(name) =>
              patchCharacter(character.id, () => ({ name }))
            }
            rootIndex={index + 1}
            rootImages={character.generatedImages}
            variations={character.variations}
            onOpenRoot={() =>
              setEditing({ entityId: character.id, kind: "root" })
            }
            onOpenVariation={(id) =>
              setEditing({ entityId: character.id, kind: "variation", id })
            }
            onBranch={(fromId) => lineage.branch(character, fromId)}
            onRemoveVariation={(id) =>
              void lineage.removeVariation(character, id)
            }
            onRemove={() => void lineage.remove(character)}
            /*
              다른 원본 — 「냥이의 어린 시절, 냥이의 노인 버전」. 파일은 이 인물 폴더 안에
              «인물_이름_번호» 로(규칙 5). 원본 편집 창은 이 탭의 원본 카드(`CharacterCard`) 그대로 —
              어린 시절도 인물이라 역할·키·프로필 칸이 똑같이 필요합니다. 배경 탭도 같은 상자(규칙 1).
            */
            alternates={{
              kind: "character",
              owner: {
                name: character.name || "인물",
                analysis: character.analysis,
              },
              items: character.alternates ?? [],
              // 주인과 보유 에셋의 파일만 «남의 것». 다른 원본 제 것은 넣지 않습니다 — 넣으면 훅이
              // 제 파일을 남의 것으로 봐 X 로 빼도 파일이 안 지워집니다(`ownerClaimedPaths` 주석).
              ownerPaths: () =>
                ownerClaimedPaths(character, {
                  includeAssets: true,
                  includeAlternates: false,
                }),
              // 주인 변형·보유 에셋의 접두. 다른 원본 «겨울» 과 변형 «겨울» 은 접두가 같아(`냥이_겨울`) 파일이
              // 섞이므로 같은 이름을 파일이 없어도 거부합니다. 형제 원본은 훅이 봅니다(`reservedFor`).
              reservedStems: () =>
                ownerReservedStems(character, character.name || "인물", {
                  includeVariations: true,
                  includeAssets: true,
                  includeAlternates: false,
                }),
              onChange: (update) =>
                patchCharacter(character.id, (current) => ({
                  alternates: update(current.alternates ?? []),
                })),
              create: newCharacter,
              renderRootEditor: (alternate, ctx) => (
                <CharacterCard
                  character={alternate}
                  draft={draft}
                  rootIndex={ctx.rootIndex}
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
                analysisTemplate: "character-analysis",
                analysisTask: "characterAnalysis",
                promptTemplate: "character-variation",
                promptTask: "characterVariation",
              },
            }}
            /*
              보유 애셋은 패널 안 미니 계보로. 관리 창은 없앴습니다.
              파일은 이 인물 폴더 안에 «인물_에셋_번호» 로 들어가므로(규칙 5), 인물(과 변형)의
              파일 목록을 넘겨 에셋 카드가 폴더를 읽을 때 인물 파일을 제 것으로 줍지 않게 합니다.
            */
            ownedAssets={{
              owner: { kind: "character", name: character.name || "인물" },
              assets: character.assets ?? [],
              // 다른 원본의 파일도 같은 폴더라 «남의 것» 에 넣습니다. 에셋 제 것은 넣지 않습니다 —
              // 넣으면 훅이 제 파일을 남의 것으로 봐 X 로 빼도 파일이 안 지워집니다(`ownerClaimedPaths` 주석).
              ownerPaths: () =>
                ownerClaimedPaths(character, {
                  includeAssets: false,
                  includeAlternates: true,
                }),
              // 주인 변형·다른 원본의 접두 — 같은 이름의 에셋은 파일이 없어도 거부(다른 원본 상자와 같은 이유).
              reservedStems: () =>
                ownerReservedStems(character, character.name || "인물", {
                  includeVariations: true,
                  includeAssets: false,
                  includeAlternates: true,
                }),
              onChange: (update) =>
                patchCharacter(character.id, (current) => ({
                  assets: update(current.assets ?? []),
                })),
            }}
            onComposeSheet={() => setSheetFor({ ownerId: character.id })}
            onDropImages={(variationId, files) =>
              lineage.dropImages(character, variationId, files)
            }
            onSheetRename={(imageId, sheetLabel) =>
              lineage.renameSheet(character, imageId, sheetLabel)
            }
            onSheetRemove={(imageId) =>
              void lineage.removeSheet(character, imageId)
            }
            onSheetEdit={(imageId) =>
              setSheetFor({ ownerId: character.id, sheetId: imageId })
            }
          />
        ))}
      </div>

      {/* 위 단추까지 올라갔다 내려오지 않게 목록 끝에도 같은 단추를 둡니다. */}
      {draft.characters.length > 0 && (
        <button
          type="button"
          onClick={add}
          data-tour="characters-add"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-xs font-semibold"
          style={{
            border: "2px dashed oklch(1 0 0 / 10%)",
            color: "oklch(0.72 0.14 290)",
          }}
        >
          <Plus className="h-3.5 w-3.5" /> 캐릭터 추가
        </button>
      )}

      {/*
        ── 다른 작품에서 끌어오기 ──────────────────────────────────────
        

        **복사**입니다. 카드도 그림도 이 작품 폴더로 새로 들어옵니다 — 한 카드를 두
        작품이 가리키면 규칙 3(화면에서 지우면 원본도 지움)이 무너집니다.
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
        <PackageOpen className="h-3.5 w-3.5" /> 다른 작품에서 캐릭터 끌어오기
      </button>

      {borrowing && (
        <BorrowCardsDialog
          kind="character"
          draft={draft}
          projectName={projectName}
          onClose={() => setBorrowing(false)}
          onDone={(made) =>
            onChange((current) => ({
              characters: [...current.characters, ...made.characters],
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

      {/* ── 원본 편집 ─────────────────────────────────────────────────── */}
      {openCharacter && editing?.kind === "root" && (
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
              {openCharacter.name || "인물"} 원본 시트
            </DialogTitle>
            <DialogDescription className="sr-only">
              인물의 기준이 되는 첫 시트를 만듭니다
            </DialogDescription>
            <CharacterCard
              character={openCharacter}
              draft={draft}
              onVoicePatch={(update) => onChange((current) => applyVoiceChange(current, openCharacter.id, update))}
              rootIndex={
                draft.characters.findIndex(
                  (item) => item.id === openCharacter.id,
                ) + 1
              }
              open
              onToggle={() => setEditing(null)}
              onPatch={(updater) => patchCharacter(openCharacter.id, updater)}
              onRemove={() => void lineage.remove(openCharacter)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ── 변형 편집 ─────────────────────────────────────────────────── */}
      {openCharacter &&
        editing?.kind === "variation" &&
        (() => {
          const variation = openCharacter.variations.find(
            (item) => item.id === editing.id,
          );
          if (!variation) return null;
          const parent = openCharacter.variations.find(
            (item) => item.id === variation.parentVariationId,
          );
          // 변형의 변형이면 바로 위 판의 그림이 정체성 기준입니다.
          const source =
            parent?.generatedImages || openCharacter.generatedImages;
          return (
            <VariationDialog
              open
              onOpenChange={(next: boolean) => !next && setEditing(null)}
              kind="character"
              ownerName={openCharacter.name || "인물"}
              ownerDescription={openCharacter.description}
              parentImage={
                source.find((image) => image.isPrimary) || source[0] || null
              }
              ownerImages={openCharacter.generatedImages}
              onOwnerImagesChange={(update) =>
                patchCharacter(openCharacter.id, (current) => ({
                  generatedImages: update(current.generatedImages || []),
                }))
              }
              ownerReferences={openCharacter.references}
              ownerAnalysis={openCharacter.analysis}
              siblings={openCharacter.variations}
              variation={variation}
              onSave={(next) =>
                patchCharacter(openCharacter.id, (current) => ({
                  variations: current.variations.map((item) =>
                    item.id === next.id ? next : item,
                  ),
                }))
              }
              analysisTemplate="character-analysis"
              analysisTask="characterAnalysis"
              promptTemplate="character-variation"
              promptTask="characterVariation"
              /*
              보유 에셋·다른 원본(과 그 변형)의 파일과 접두. 다른 원본 «겨울» 의 접두 `냥이_겨울` 은 이 변형
              «겨울» 과 같아서, 안 넘기면 변형 창이 그 파일을 제 것으로 줍고(X 로 지움) 이름 바꾸기가 그 파일까지
              끌고 갑니다(검토 2026-09-08). 제 파일과 형제 변형은 창이 따로 세니 여기서는 뺍니다.
            */
              claimedPaths={() =>
                ownerClaimedPaths(openCharacter, {
                  includeAssets: true,
                  includeAlternates: true,
                  includeSelf: false,
                  includeVariations: false,
                })
              }
              reservedStems={() =>
                ownerReservedStems(
                  openCharacter,
                  openCharacter.name || "인물",
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

      {/* 시트 창. 배경과 같은 컴포넌트입니다 — 배치도 초기화 같은 규칙이 한쪽에만 생기지 않게. */}
      {sheetOwner && (
        <EntitySheetComposer
          kind="character"
          owner={sheetOwner}
          onClose={() => setSheetFor(null)}
          projectName={projectName}
          sharedAssets={draft.sharedAssets}
          profile={sheetOwner.profile}
          // 표 줄은 `profileLines` 한 곳에서. 여기서 따로 만들면 프로필 칸이 빠집니다
          // .
          basics={sheetProfileBasics(sheetOwner.profile, {
            name: sheetOwner.name,
            role: sheetOwner.role,
            heightCm: sheetOwner.heightCm,
            gender: sheetOwner.gender,
          })}
          patchOwner={(updater) => patchCharacter(sheetOwner.id, updater)}
          // 배치도는 프로젝트 공용 — 다른 인물의 시트에서도 고를 수 있습니다.
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
 * 인물 원본 편집 카드.
 *
 * 주인 인물과 **다른 원본**(어린 시절·노인 버전, `AlternateLineage`)이 같은 카드를 씁니다 —
 * 어린 시절도 인물이라 역할·키·프로필 칸이 똑같이 필요합니다. 다른 것은 파일이 들어가는 폴더와
 * 이름 규칙(`folder`)뿐: 주인은 제 폴더에 `냥이_001`, 다른 원본은 주인 폴더에 `냥이_어린시절_001`
 * (규칙 5). 카드를 두 벌로 두면 규칙 하나를 고칠 때 한쪽을 빠뜨립니다(규칙 1).
 */
export function CharacterCard({
  character,
  draft,
  onVoicePatch,
  rootIndex = 1,
  open,
  onPatch,
  onRemove,
  folder,
  claimedPaths,
  analysisSources,
}: {
  character: Character;
  draft: ProjectDraft;
  onVoicePatch?: (update: (current: Character) => Partial<Character>) => void;
  /** 계보 패널의 번호와 같은 번호. 「①」 로 뜹니다 */
  rootIndex?: number;
  open: boolean;
  onToggle: () => void;
  onPatch: (updater: (current: Character) => Partial<Character>) => void;
  onRemove: () => void;
  /** 다른 원본일 때만 — 주인 폴더와 «주인_이름» 접두. 없으면 주인 인물(제 폴더, 제 이름) */
  folder?: LineageFolder;
  /** 다른 원본일 때만 — 주인·보유 에셋·형제 원본이 쓰는 파일. 폴더 읽기에서 건너뜁니다 */
  claimedPaths?: () => Set<string>;
  /** 분석 가져오기 목록(주인·형제 원본의 분석). `PromptCardBody` 에 그대로 */
  analysisSources?: { label: string; text: string }[];
}) {
  const { projectName, projectContext } = useProjectMedia();

  const card = usePromptCard<Character>({
    kind: "character",
    entity: character,
    patch: onPatch,
    name: character.name,
    /*
      다른 원본(`folder` 있음)은 주인 폴더 안이라 변형처럼 **자기 접두 파일만** 줍습니다.
      이름을 아직 안 적었으면 접두는 `냥이_원본`(folderFor) — 주인 파일을 제 것으로 주우면 안 되니까요.
      주인 인물은 제 폴더라 접두 없이 전부 제 것입니다.
    */
    scope: folder ? "variation" : undefined,
    stem: folder?.stemBase,
    ownerName: folder?.ownerName,
    // 변형·보유 에셋(과 에셋의 변형)·다른 원본(과 그 변형)의 파일도 이 폴더에 있습니다. 그것까지 원본
    // 목록에 붙이면 안 됩니다. 에셋 파일은 `냥이_단검_001`, 다른 원본은 `냥이_어린시절_001` 이라 접두
    // `냥이` 로는 걸러지지 않습니다 — 여기서 빼는 수밖에 없습니다. 제 원본 파일만 빼고(`includeSelf: false`).
    // 다른 원본이면 넘어온 것(주인·에셋·형제) ∪ **제 변형** 파일 — 접두가 `냥이_어린시절_` 로 같아서
    // (`냥이_어린시절_웃음_001`) 안 가리면 변형 그림이 원본 목록에 붙습니다(`AssetEditorDialog` 와 같은 이유).
    claimedPaths: () =>
      new Set([
        ...(claimedPaths?.() ?? []),
        ...ownerClaimedPaths(character, {
          includeAssets: true,
          includeAlternates: true,
          includeSelf: false,
        }),
      ]),
    description: character.description,
    projectName,
    projectContext,
    referenceAssetType: folder?.referenceAssetType ?? "character-reference",
    analysisTemplate: "character-analysis",
    analysisTask: "characterAnalysis",
    promptTemplate: "character-sheet",
    promptTask: "characterSheet",
    // 규칙으로 조립하거나 요청할 때 함께 넣을 기본 정보(키·체형·나이…). 까닭은 `characterBasics` 주석.
    ...characterBasics(character),
  });

  const preview =
    character.generatedImages?.find((image) => image.isPrimary) ||
    character.generatedImages?.[0];

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
        {/* 계보 패널의 번호와 같은 번호 — 어느 카드를 열었는지 잇습니다. */}
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={{
            background: "oklch(0.62 0.22 290 / 25%)",
            color: "oklch(0.86 0.16 290)",
          }}
        >
          {rootIndex}
        </span>

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
              <User
                className="h-4 w-4"
                style={{ color: "oklch(0.32 0.01 265)" }}
              />
            </div>
          )}
        </div>

        <p className="min-w-0 truncate text-sm font-semibold text-white">
          {character.name || "이름 없음"}
        </p>
        {character.role && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "oklch(1 0 0 / 8%)",
              color: "oklch(0.72 0.01 265)",
            }}
          >
            {character.role}
          </span>
        )}
        {!!character.analysis?.trim() && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "oklch(0.70 0.15 160 / 18%)",
              color: "oklch(0.82 0.15 160)",
            }}
          >
            분석완료
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
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
          {/* 2열 — 짝이 되는 것끼리 나란히. (08/20 확정) */}
          <PromptCardBody
            kind="character"
            // 성격·말투·습관. 그림으로는 알 수 없는 것이라 따로 둡니다.
            // 6000×6000 시트의 빈 자리에 찍혀서, 영상 모델이 이 인물을 연기할 때 읽습니다.
            // 「배치상 이미지 분석 위가 낫다」 — 분석·프롬프트보다 앞에 둡니다.
            beforeAnalysis={
              <div className="space-y-3"><CharacterProfilePanel
                profile={character.profile}
                onChange={(profile) => onPatch(() => ({ profile }))}
                basics={{
                  name: character.name,
                  role: character.role,
                  gender: character.gender,
                  heightCm: character.heightCm,
                  description: character.description,
                }}
                projectContext={projectContext?.facts ?? null}
                projectName={projectName}
                images={card.referenceSources()}
              />{!folder && <CharacterVoicePanel character={character} draft={draft} projectName={projectName} onPatch={onPatch} onVoicePatch={onVoicePatch} />}</div>
            }
            // 기본 정보는 레퍼런스 스트립 **오른쪽**에 놓입니다.
            // 설계서(05, 「캐릭터 원본 편집 창」)가 정한 좌우 배치입니다.
            fields={
              <div className="grid gap-2 sm:grid-cols-2" data-tour="card-basics">
                <Field label="이름">
                  <input
                    value={character.name}
                    onChange={(event) =>
                      onPatch(() => ({ name: event.target.value }))
                    }
                    placeholder="이름"
                    className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
                    style={fieldStyle}
                  />
                </Field>
                <Field label="역할">
                  <input
                    value={character.role}
                    onChange={(event) =>
                      onPatch(() => ({ role: event.target.value }))
                    }
                    placeholder="주인공, 조연, 악당..."
                    className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
                    style={fieldStyle}
                  />
                </Field>
                <Field label="형태">
                  <select
                    value={character.kind}
                    onChange={(event) =>
                      onPatch(() => ({
                        kind: event.target.value as Character["kind"],
                      }))
                    }
                    className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
                    style={fieldStyle}
                  >
                    <option value="human">사람형</option>
                    <option value="animal">동물형</option>
                    <option value="creature">그 밖의 존재</option>
                  </select>
                </Field>
                <Field label="성별">
                  <select
                    value={
                      character.gender === "male" ||
                      character.gender === "female"
                        ? character.gender
                        : "neutral"
                    }
                    onChange={(event) =>
                      onPatch(() => ({ gender: event.target.value }))
                    }
                    className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
                    style={fieldStyle}
                  >
                    <option value="female">여성형</option>
                    <option value="male">남성형</option>
                    <option value="neutral">중립형</option>
                  </select>
                </Field>
                <Field label="키(cm)">
                  <input
                    type="number"
                    value={character.heightCm}
                    onChange={(event) =>
                      onPatch(() => ({
                        heightCm: Number(event.target.value) || 0,
                      }))
                    }
                    className="no-spinner w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
                    style={fieldStyle}
                  />
                </Field>
                <Field label="체격">
                  <select
                    value={character.build}
                    onChange={(event) =>
                      onPatch(() => ({
                        build: event.target.value as Character["build"],
                      }))
                    }
                    className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
                    style={fieldStyle}
                  >
                    {Object.entries(BUILD_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            }
            /*
              다른 원본은 제 폴더가 없습니다. `cropSave` 없이는 `SheetPanelCropper` 가 이름(«어린시절»)으로
              폴더를 파 잘라낸 칸·표시가 `character/어린시절/` 로 가고, 그 파일은 주인 폴더 읽기·이름 바꾸기·
              주인 지우기가 전부 못 봅니다(규칙 5·3 위반, 검토 2026-09-08). 생성 이미지 선반과 같은 폴더·접두로.
              주인 인물은 지금대로(카드 이름 = 폴더 이름).
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
            entity={character}
            patch={onPatch}
            card={card}
            name={character.name}
            analysisTemplate="character-analysis"
            sheetCaption="Portrait 4:5 · fixed 9-panel grid"
            promptCaption="외형 기준 + 9구획 시트 설계도 + 모델별 문법"
            promptTemplate="character-sheet"
            analysisSources={analysisSources}
          />

          <GeneratedImageShelf
            images={character.generatedImages}
            onChange={(update) =>
              onPatch((current) => ({
                generatedImages: update(current.generatedImages),
              }))
            }
            assetLabel={character.name || "캐릭터"}
            // 폴더·이름 규칙은 `folder` 하나에서. 다른 원본이면 주인 폴더에 «주인_이름_001».
            ownerName={folder?.ownerName ?? (character.name || "캐릭터")}
            stem={folder?.stemBase}
            assetType={folder?.generatedAssetType ?? "character-generated"}
          />
        </div>
      )}
    </section>
  );
}

// 체형·성별 표(BUILD_LABELS·BUILD_EN·GENDER_EN)는 `lib/promptPayloads` 로 옮겼습니다 — 일괄 생성 4단계가 같은 표로 요청합니다.

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span
        className="text-[10px] font-semibold"
        style={{ color: "oklch(0.60 0.01 265)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
