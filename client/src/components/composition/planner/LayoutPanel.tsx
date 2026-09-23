import { useT } from "@/lib/i18n";
import { useState } from "react";
import {
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lightbulb,
  RotateCcw,
  X,
} from "lucide-react";
import type { TransformConstraint } from "@/components/composition/CompositionViewport";
import {
  ChoiceRow,
  FIELD_STYLE,
  NameInput,
  NumberInput,
  ONE_VECTOR,
  PanelSection,
  ZERO_VECTOR,
} from "@/components/composition/fields";
import {
  BonePosePanel,
  HandPosePanel,
  PosePresetLibrary,
} from "@/components/composition/PosePanel";
import PoseFromImageField from "@/components/composition/PoseFromImageField";
import { mergeBonePose, releaseFingerPreset } from "@/lib/rig";
import type {
  CharacterComposition,
  CompositionCharacterSource,
  CompositionMannequin,
  CompositionState,
  ObjectComposition,
} from "@/lib/composition";
import {
  addMannequinIn,
  addObjectIn,
  attachObjectIn,
  detachObjectIn,
  objectGroupOf,
  patchMannequinIn,
  setObjectPivotIn,
  setObjectImageIn,
  setObjectSwapIn,
  wallDistanceOf,
  placeCharacterIn,
  removeMannequinIn,
  characterObjectsOf,
  setCharacterColorsIn,
  updateCharacterIn,
  updateObjectIn,
  type ObjectKindEntry,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import { assetSrc } from "@/lib/mediaLibrary";
import type { SectionToggles } from "./PlannerChrome";
import { MotionCleanupPanel } from "./MotionCleanupPanel";
import { OBJECT_KINDS, SWAPPABLE_KINDS } from "./objectKinds";
import { MANNEQUIN_COLORS, characterColorMap, pinnedColorOf } from "@/lib/compositionColors";
import { ObjectFields } from "./ObjectFields";
import { CharacterFields } from "./CharacterFields";
import { GizmoModeRow } from "./GizmoModeRow";
import { ObjectList } from "./ObjectList";
import { GroupCards } from "./ObjectGroupPanel";

/**
 * 배치 탭 — 인물 · 소품/조명 · 선택 항목 수치 · 포즈.
 *
 * 선택(`selected`)과 본 선택(`activeBone`)은 3D 화면도 같이 보기 때문에
 * `CompositionPlanner` 가 들고 있고, 여기서는 받아서 바꿉니다.
 */

/*
  놓을 수 있는 것들.

  «크레이트» 는 2026-09-11 에 뺐습니다 — 지오메트리가 박스와 **글자 그대로 같아서**
  (둘 다 1×1×1 상자) 목록에 둘 까닭이 없었습니다. 테이블은 1.4×0.75×0.8 로 비율이
  달라 남깁니다.

  아이콘도 모양별로 갈랐습니다 — 셋 다 같은 정육면체 아이콘이라 목록에서 구분이
  안 됐습니다.
*/
/*
  «테이블» 을 뺐습니다.  탁자는 «납작한 상자» 라 상자 하나를 눌러 만드는 편이 자유롭고, 다리까지
  만들려면 어차피 상자 몇 개를 묶어야 합니다. 옛 저장본의 탁자는 그대로 그려집니다.
*/
/**
 * 소품을 매달 수 있는 관절. 실제로 물건을 드는 자리만 추렸습니다.
 *
 * 관절은 예순 개가 넘지만 검·가방·모자를 다는 곳은 몇 안 됩니다. 전부 늘어놓으면
 * 「RightHandIndex2」 같은 이름 사이에서 손이 길을 잃습니다.
 */
const ATTACH_BONES = [
  { id: "RightHand", label: "오른손" },
  { id: "LeftHand", label: "왼손" },
  { id: "RightForeArm", label: "오른 팔뚝" },
  { id: "LeftForeArm", label: "왼 팔뚝" },
  { id: "Head", label: "머리" },
  { id: "Neck", label: "목" },
  { id: "Spine2", label: "가슴" },
  { id: "Hips", label: "허리" },
  { id: "RightFoot", label: "오른발" },
  { id: "LeftFoot", label: "왼발" },
];


export interface LayoutPanelProps extends SectionToggles {
  state: CompositionState;
  setState: UpdateComposition;
  /** 프로젝트 캐릭터와 마네킹을 같은 모양으로 본 것 */
  plannerCharacters: CompositionCharacterSource[];
  /**
   * **바꿔 그릴 수 있는 시트들** — 프로젝트의 인물·배경과 거기 붙은 에셋.
   *
   * 목록을 여기서 만들지 않는 까닭: 이 패널은
   * 구도 상태만 알고 프로젝트를 모릅니다 — 부모가 풀어서 넘깁니다.
   */
  swapOptions: {
    kind: "character" | "asset" | "background";
    id: string;
    name: string;
    group: string;
  }[];
  selected: string;
  setSelected: (value: string) => void;
  transformMode: "translate" | "rotate" | "scale";
  setTransformMode: (mode: "translate" | "rotate" | "scale") => void;
  transformConstraint: TransformConstraint;
  setTransformConstraint: (constraint: TransformConstraint) => void;
  activeBone: string | null;
  setActiveBone: (bone: string | null) => void;
  boneTransformMode: "translate" | "rotate";
  setBoneTransformMode: (mode: "translate" | "rotate") => void;
  fineSnap: boolean;
  setFineSnap: (value: boolean) => void;
  /**
   * **벽에 붙일 수 있는 그림들** — 프로젝트 폴더에서 읽은 배경·장소 그림입니다(`usePlannerMedia.listedBackgrounds`).
   * 벽을 고르면 여기서 한 장을 골라 붙입니다.
   */
  wallImages?: { id: string; name: string; thumb: string; filePath?: string }[];
  /** 이 벽 크기·인물 거리에 맞춘 **배경 그림을 만들러** 갑니다(장소 카드가 창으로 뜹니다). */
  onCreateWallImage?: (objectId: string) => void;
  /**
   * 고른 소품의 **에셋 카드**를 만들어 바로 잇거나(없을 때), 이미 이어 둔 카드를 엽니다.
   *
   * 안 주면 단추가 안 보입니다
   * (구도잡기를 프로젝트 밖에서 열었을 때).
   */
  onCreateAsset?: (objectId: string, label: string) => void;
  /** 덩어리 쪽 에셋 —  */
  onCreateGroupAsset?: (groupId: string, label: string) => void;
  /** 인물 이름·키를 여기서 고쳤을 때 프로젝트에 올려보냅니다 */
  onCharacterUpdate?: (
    id: string,
    patch: { name: string; heightCm: number },
  ) => void;
}

export function LayoutPanel({
  state,
  setState,
  plannerCharacters,
  swapOptions,
  selected,
  setSelected,
  transformMode,
  setTransformMode,
  transformConstraint,
  setTransformConstraint,
  activeBone,
  setActiveBone,
  boneTransformMode,
  setBoneTransformMode,
  fineSnap,
  setFineSnap,
  wallImages,
  onCreateWallImage,
  onCreateAsset,
  onCreateGroupAsset,
  onCharacterUpdate,
  openSections,
  toggleSection,
}: LayoutPanelProps) {
  const t = useT();
  // ── 인물 ──────────────────────────────────────────────────────────────
  const selectedCharacterId = selected.startsWith("character:")
    ? selected.slice(10)
    : null;
  /**
   * **묶으려고 체크해 둔 소품**들. 3D 선택과 별개입니다.
   *
   * 3D 선택은 하나뿐이라 «여럿을 골라 묶기» 를 할 수가 없습니다. 체크 상자를 따로 두면
   * 화면을 돌려 가며 하나씩 담을 수 있고, 묶는 순간 비워집니다.
   */

  const selectedObjectId = selected.startsWith("object:")
    ? selected.slice(7)
    : null;

  const selectedCharacter = state.characters.find(
    (item) => item.characterId === selectedCharacterId,
  );
  const selectedCharacterSource = plannerCharacters.find(
    (item) => item.id === selectedCharacterId,
  );
  const selectedObject = state.objects.find(
    (item) => item.id === selectedObjectId,
  );
  /**
   * 고른 것이 **덩어리**인가. 덩어리 줄을 누르면 속의 첫 소품이 골라지므로, 그 소품의 묶음으로 압니다.
   */
  const selectedGroup = objectGroupOf(state, selectedObject?.groupId);
  /**
   * 이어 둔 에셋이 **아직 있는가**. 지운 에셋을 가리키는 이음은 «없는 것» 으로 봅니다.
   */
  const linkedAsset =
    selectedObject?.swapRef &&
    swapOptions.find(
      (item) =>
        item.kind === selectedObject.swapRef!.kind && item.id === selectedObject.swapRef!.id,
    );
  /** 고른 사람이 못 박아 둔 색(없으면 자동). 마네킹과 캐릭터를 같이 봅니다. */
  const pinnedHex = selectedCharacter
    ? pinnedColorOf(state, selectedCharacter.characterId)
    : undefined;
  /** 고른 벽과 인물 사이의 거리 — 배경 그림을 뽑을 때 «얼마나 뒤인가» 를 말해 줍니다. */
  const wallGap =
    selectedObject?.kind === "wall" ? wallDistanceOf(state, selectedObject.id) : null;

  /**
   * 몸 색 표 — 3D 화면·프롬프트 대조표와 **같은 것**을 봅니다.
   * 여기서 따로 순번을 세다가 화면과 목록의 색이 어긋났습니다().
   */
  const bodyColors = characterColorMap(
    state,
    (id) => plannerCharacters.find((item) => item.id === id)?.gender,
  );

  /**
   * **Ctrl 로 함께 잡아 둔 사람들.** 색은 이 사람들에게 한꺼번에 들어갑니다.
   *
   * 엑스트라 열 명을 한 색으로 묶는 일이 흔한데, 하나씩 누르면 열 번입니다.
   */
  const [colorPick, setColorPick] = useState<string[]>([]);
  /** 색을 받을 사람들 — Ctrl 로 잡아 둔 게 있으면 그들, 없으면 지금 고른 한 사람. */
  const colorTargets =
    colorPick.length > 0
      ? colorPick
      : selectedCharacter
        ? [selectedCharacter.characterId]
        : [];
  const paintColor = (color: string | undefined) =>
    setState((current) => setCharacterColorsIn(current, colorTargets, color));

  const updateCharacter = (id: string, patch: Partial<CharacterComposition>) =>
    setState((current) => updateCharacterIn(current, id, patch));

  const placeCharacter = (id: string) =>
    setState((current) => placeCharacterIn(current, id));

  const addMannequin = (gender: "male" | "female") =>
    setState((current) => addMannequinIn(current, gender));

  /**
   * 인물 이름 변경.
   * 마네킹은 구도 상태 안에서만 살기 때문에 로컬 state 를 고치고,
   * 프로젝트에서 넘어온 인물은 상위로 올려보냅니다.
   */
  const renameCharacter = (id: string, name: string) => {
    if (state.mannequins.some((item) => item.id === id)) {
      setState((current) => patchMannequinIn(current, id, { name }));
      return;
    }
    const source = plannerCharacters.find((item) => item.id === id);
    onCharacterUpdate?.(id, { name, heightCm: source?.heightCm ?? 170 });
  };

  /**
   * 체격.
   *
   * 마네킹은 구도 안에서만 사니 여기서 정합니다. 프로젝트 인물은 캐릭터
   * 카드가 주인이라 여기서는 보여 주기만 합니다 — 두 곳에서 고칠 수 있으면
   * 어느 쪽이 맞는지 알 수 없어집니다.
   */
  const setMannequinBuild = (
    id: string,
    build: CompositionMannequin["build"],
  ) => setState((current) => patchMannequinIn(current, id, { build }));

  const setCharacterHeight = (id: string, heightCm: number) => {
    if (state.mannequins.some((item) => item.id === id)) {
      setState((current) => patchMannequinIn(current, id, { heightCm }));
      return;
    }
    const source = plannerCharacters.find((item) => item.id === id);
    onCharacterUpdate?.(id, { name: source?.name ?? "", heightCm });
  };

  // ── 소품 ──────────────────────────────────────────────────────────────
  const addObject = (entry: ObjectKindEntry) =>
    setState((current) => addObjectIn(current, entry));

  const updateObject = (id: string, patch: Partial<ObjectComposition>) =>
    setState((current) => updateObjectIn(current, id, patch));

  const bonePose = selectedCharacter?.bonePose || {};

  return (
    <>
      <PanelSection
        tour="layout-characters"
        title={t("인물")}
        count={plannerCharacters.length}
        open={openSections.characters}
        onToggle={() => toggleSection("characters")}
      >
        <div className="space-y-1.5">
          {plannerCharacters.length === 0 && (
            <p
              className="text-[10px]"
              style={{ color: "oklch(0.45 0.01 265)" }}
            >
              {t("이 컷에 인물이 없습니다. 아래에서 마네킹을 세워도 됩니다.")}
            </p>
          )}
          {plannerCharacters.map((character, index) => {
            const placement = state.characters.find(
              (item) => item.characterId === character.id,
            );
            const on = selected === `character:${character.id}`;
            // 3D 마네킹과 **같은 표**에서 꺼냅니다. 예전에는 여기서 순번을 따로 세다가
            // 화면과 목록의 색이 어긋났습니다(2026-09-17).
            const dotColor = placement ? bodyColors.get(character.id) ?? null : null;
            const marked = colorPick.includes(character.id);
            return (
              <div key={character.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  // 미배치 인물은 누르면 구도에 추가되므로, 튜토리얼은 직접 누를 자리만 안내합니다.
                  data-tour-open="layout-character-fields layout-body-color layout-gizmo-mode layout-path layout-pose-from-image layout-joints layout-hands layout-presets"
                  onClick={(event) => {
                    // Ctrl(맥은 ⌘) 로 누르면 **함께 잡습니다** — 색을 한 번에 바꾸려고.
                    if (event.ctrlKey || event.metaKey) {
                      if (!placement) return;
                      setColorPick((now) =>
                        now.includes(character.id)
                          ? now.filter((item) => item !== character.id)
                          : [...now, character.id],
                      );
                      return;
                    }
                    setColorPick([]);
                    if (!placement) {
                      placeCharacter(character.id);
                      setSelected(`character:${character.id}`);
                      return;
                    }
                    setSelected(on ? "none" : `character:${character.id}`);
                    setActiveBone(null);
                  }}
                  title={`${character.name} · Ctrl 을 누르고 누르면 여럿을 함께 잡습니다(색 한 번에)`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left text-[11px] font-medium"
                  style={{
                    background: on
                      ? "oklch(0.62 0.22 290 / 22%)"
                      : marked
                        ? "oklch(0.72 0.16 60 / 18%)"
                        : placement
                          ? "oklch(1 0 0 / 6%)"
                          : "transparent",
                    border: `1px solid ${marked ? "oklch(0.72 0.16 60 / 55%)" : "transparent"}`,
                    color: placement
                      ? "oklch(0.84 0.10 290)"
                      : "oklch(0.55 0.01 265)",
                  }}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{
                      background: dotColor || "oklch(1 0 0 / 10%)",
                      color: dotColor ? "oklch(0.15 0.01 265)" : "inherit",
                    }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {character.name}
                  </span>
                  <span
                    className="shrink-0 text-[9px]"
                    style={{ color: "oklch(0.48 0.01 265)" }}
                  >
                    {character.heightCm}cm
                  </span>
                </button>
                {placement && (
                  <button
                    type="button"
                    onClick={() =>
                      updateCharacter(character.id, {
                        hidden: !placement.hidden,
                      })
                    }
                    title={placement.hidden ? "이 컷에 넣기" : "이 컷에서 빼기"}
                    className="shrink-0 rounded p-1 hover:bg-white/10"
                  >
                    {placement.hidden ? (
                      <EyeOff
                        className="h-3 w-3"
                        style={{ color: "oklch(0.45 0.01 265)" }}
                      />
                    ) : (
                      <Eye
                        className="h-3 w-3"
                        style={{ color: "oklch(0.62 0.01 265)" }}
                      />
                    )}
                  </button>
                )}
                {/*
                  **마네킹은 목록에서 바로 뺍니다.**
                  프로젝트 인물은 지우지 않습니다 — 그건 캐릭터 단계의 것이고 여기서는 «이 컷에서 빼기»(눈)뿐입니다.
                */}
                {state.mannequins.some((item) => item.id === character.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      setState((current) => removeMannequinIn(current, character.id));
                      if (on) setSelected("none");
                    }}
                    title="이 마네킹을 지웁니다"
                    className="shrink-0 rounded p-1 hover:bg-white/10"
                    style={{ color: "oklch(0.60 0.16 25)" }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          {/* 이름 없는 «사람 크기 자리» 둘 — 튜토리얼이 이 줄을 통째로 가리킵니다. */}
          <div data-tour="layout-mannequins" className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => addMannequin("male")}
              className="rounded-md px-2 py-1.5 text-[10px]"
              style={{
                background: "oklch(0.55 0.15 250 / 16%)",
                color: "oklch(0.78 0.13 250)",
              }}
            >
              {t("+ 남성형")}
            </button>
            <button
              type="button"
              onClick={() => addMannequin("female")}
              className="rounded-md px-2 py-1.5 text-[10px]"
              style={{
                background: "oklch(0.62 0.16 20 / 16%)",
                color: "oklch(0.80 0.14 20)",
              }}
            >
              {t("+ 여성형")}
            </button>
          </div>
        </div>
      </PanelSection>

      {/*
        ── 고른 인물 ─────────────────────────────────────────────────────
         목록에서 사람을 고르면 그 사람의 칸이 **바로 아래**에서 열립니다.
      */}
          {selectedCharacter && selectedCharacterSource && (
            <>
              {/* 여기서 정한 이름이 나중에 캐릭터 시트 인물과 맞추는 키가 됩니다. */}
              <label data-tour="layout-character-fields" className="mb-2 block space-y-1">
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: "oklch(0.52 0.01 265)" }}
                >
                  {t("인물 이름")}
                </span>
                <NameInput
                  aria-label={t("인물 이름")}
                  value={selectedCharacterSource.name}
                  placeholder={t("예: 주안")}
                  onCommit={(name) =>
                    renameCharacter(selectedCharacter.characterId, name)
                  }
                />
              </label>
              <label className="mb-3 block space-y-1">
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: "oklch(0.52 0.01 265)" }}
                >
                  {t("키 (cm)")}
                </span>
                <NumberInput
                  value={selectedCharacterSource.heightCm}
                  step={1}
                  min={60}
                  onChange={(heightCm) =>
                    setCharacterHeight(selectedCharacter.characterId, heightCm)
                  }
                />
              </label>

              {/* 체격 — 프롬프트에 「마른 편」 같은 말로 실립니다. */}
              {(() => {
                const isMannequin = state.mannequins.some(
                  (item) => item.id === selectedCharacter.characterId,
                );
                return (
                  <label className="mb-3 block space-y-1">
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: "oklch(0.52 0.01 265)" }}
                    >
                      {t("체격")}
                    </span>
                    <select
                      value={selectedCharacterSource.build || "average"}
                      disabled={!isMannequin}
                      title={
                        isMannequin
                          ? undefined
                          : "프로젝트 인물의 체격은 캐릭터 카드에서 정합니다"
                      }
                      onChange={(event) =>
                        setMannequinBuild(
                          selectedCharacter.characterId,
                          event.target.value as CompositionMannequin["build"],
                        )
                      }
                      className="h-8 w-full rounded-md px-2 text-xs outline-none disabled:opacity-45"
                      style={FIELD_STYLE}
                    >
                      <option value="slim">{t("슬림")}</option>
                      <option value="average">{t("보통")}</option>
                      <option value="heavy">{t("덩치 큰")}</option>
                    </select>
                  </label>
                );
              })()}

              {/*
                ── 몸 색 ────────────────────────────────────────────
                ,
                「지금 망화랑 수화도 같은 색으로 그려졌네… 캐릭터도 색을 바꿀 수 있게 해 줘야겠다」.

                색은 캡처에서 **누가 누구인지 가리는 유일한 표시**입니다(이름표는 그림에 안 나갑니다).
                프롬프트가 「파란 사람은 @…」 로 짝을 맞추므로, 겹치면 인물이 통째로 바뀝니다.
                그래서 마네킹만이 아니라 **캐릭터도** 여기서 못 박습니다. «자동» 이면 겹치지 않게 나눠 줍니다.
              */}
              <div data-tour="layout-body-color" className="mb-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
                    {t("몸 색")}
                  </span>
                  <span className="text-[9px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                    {colorPick.length > 0
                      ? `함께 잡은 ${colorPick.length}명에 한 번에`
                      : "Ctrl 로 여럿을 잡으면 한 번에"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => paintColor(undefined)}
                    title="겹치지 않게 알아서 나눠 줍니다"
                    className="rounded px-2 py-1 text-[9px]"
                    style={{
                      background: pinnedHex ? "oklch(1 0 0 / 5%)" : "oklch(0.62 0.22 290 / 22%)",
                      color: pinnedHex ? "oklch(0.60 0.01 265)" : "oklch(0.84 0.16 290)",
                    }}
                  >
                    {t("자동")}
                  </button>
                  {MANNEQUIN_COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => paintColor(swatch)}
                      title={`이 색으로 못 박기 — ${swatch}`}
                      className="h-6 w-6 rounded"
                      style={{
                        background: swatch,
                        outline:
                          pinnedHex?.toLowerCase() === swatch.toLowerCase()
                            ? "2px solid oklch(0.92 0.02 265)"
                            : "none",
                        outlineOffset: 1,
                        border: "1px solid oklch(1 0 0 / 18%)",
                      }}
                    />
                  ))}
                  {/*
                    고르개로 찍은 색은 **놓는 순간 저장됩니다**.
                    끄는 동안(onChange)은 화면만 따라가고, 손을 떼면(onBlur) 그 값이 그대로 남습니다.
                  */}
                  <input
                    type="color"
                    aria-label={t("몸 색 직접 고르기")}
                    value={pinnedHex || bodyColors.get(selectedCharacter.characterId) || "#9aa4b8"}
                    onChange={(event) => paintColor(event.target.value)}
                    className="h-6 w-8 rounded"
                  />
                </div>
                {colorPick.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setColorPick([])}
                    className="text-[9px] underline"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    {t("함께 잡은 것 풀기")}
                  </button>
                )}
              </div>

              {/* 지금 무엇을 만질까 — 자리 칸 바로 위입니다(소품 칸과 같은 줄). */}
              <GizmoModeRow
                transformMode={transformMode}
                setTransformMode={setTransformMode}
                transformConstraint={transformConstraint}
                setTransformConstraint={setTransformConstraint}
                scaleDisabled
              />

              {/*
                위치·회전 숫자는 **접어 둡니다**(). 평소에는 화면에서 끌고, 맞춰야 할 때만 폅니다.
              */}
              <CharacterFields
                placement={selectedCharacter}
                onChange={(patch) => updateCharacter(selectedCharacter.characterId, patch)}
              />

              {/* 캐릭터 동선 — 인물을 세워 둔 자리에서 [+] 를 누를 때마다
                  점이 하나씩 찍히고, 뷰포트에 길이 그려집니다. */}
              <div data-tour="layout-path" className="mt-3 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      showCharacterPaths: !current.showCharacterPaths,
                    }))
                  }
                  title="찍어 둔 동선을 3D 화면에 보이거나 숨깁니다"
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold"
                  style={{
                    background: state.showCharacterPaths
                      ? "oklch(0.62 0.22 290 / 16%)"
                      : "oklch(1 0 0 / 5%)",
                    border: `1px solid ${state.showCharacterPaths ? "oklch(0.62 0.22 290 / 35%)" : "oklch(1 0 0 / 10%)"}`,
                    color: state.showCharacterPaths
                      ? "oklch(0.84 0.18 290)"
                      : "oklch(0.60 0.01 265)",
                  }}
                >
                  캐릭터 동선 ({selectedCharacter.path?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateCharacter(selectedCharacter.characterId, {
                      path: [
                        ...(selectedCharacter.path || []),
                        { ...selectedCharacter.position },
                      ],
                    })
                  }
                  title="지금 서 있는 자리를 동선 점으로 추가"
                  className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-bold"
                  style={{
                    background: "oklch(0.62 0.22 290 / 20%)",
                    color: "oklch(0.85 0.18 290)",
                  }}
                >
                  +
                </button>
                {(selectedCharacter.path?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateCharacter(selectedCharacter.characterId, {
                        path: [],
                      })
                    }
                    title="이 인물의 동선을 전부 지우기"
                    className="shrink-0 rounded-md p-1.5 hover:bg-white/10"
                    style={{ color: "oklch(0.58 0.14 25)" }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* 영상에서 넣은 촘촘한 키가 있으면 — 캐릭터마다 따로 다듬습니다(`MotionCleanupPanel`). */}
              <MotionCleanupPanel
                state={state}
                setState={setState}
                characterId={selectedCharacter.characterId}
                name={selectedCharacterSource?.name ?? "캐릭터"}
              />

              <button
                type="button"
                onClick={() =>
                  updateCharacter(selectedCharacter.characterId, {
                    position: { ...ZERO_VECTOR },
                    rotation: { ...ZERO_VECTOR },
                    rotationY: 0,
                  })
                }
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]"
                style={{
                  background: "oklch(0.55 0.15 200 / 14%)",
                  border: "1px solid oklch(0.55 0.15 200 / 35%)",
                  color: "oklch(0.72 0.15 200)",
                }}
              >
                <RotateCcw className="h-3 w-3" /> {t("위치·회전 초기화")}
              </button>

              {state.mannequins.some(
                (item) => item.id === selectedCharacter.characterId,
              ) && (
                <button
                  type="button"
                  onClick={() => {
                    setState((current) =>
                      removeMannequinIn(current, selectedCharacter.characterId),
                    );
                    setSelected("none");
                  }}
                  className="mt-2 w-full rounded-md px-2 py-1.5 text-[11px]"
                  style={{
                    background: "oklch(0.62 0.18 25 / 12%)",
                    color: "oklch(0.78 0.16 25)",
                  }}
                >
                  {t("마네킹 제거")}
                </button>
              )}
            </>
          )}

      <PanelSection
        tour="layout-objects"
        title={t("소품 · 조명")}
        count={characterObjectsOf(state).length}
        open={openSections.objects}
        onToggle={() => toggleSection("objects")}
      >
        <div className="space-y-1.5">
          {/*
            **캐릭터 쪽 소품만** 섭니다. 방에 딸린 배경 소품은 환경 탭의 그 방 속성에 있습니다
            ().
            묶은 것은 덩어리 한 줄로 서고, 이름은 두 번 눌러 고칩니다.
          */}
          <ObjectList
            state={state}
            setState={setState}
            objects={characterObjectsOf(state)}
            selected={selected}
            setSelected={setSelected}
            emptyNote={t("아직 없습니다 — 아래에서 골라 세우면 화면 한가운데에 섭니다.")}
          />
          <div data-tour="layout-object-kinds" className="grid grid-cols-2 gap-1">
            {OBJECT_KINDS.map((kind) => (
              <button
                key={kind.label}
                type="button"
                onClick={() => addObject(kind)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px]"
                style={{
                  background: "oklch(1 0 0 / 5%)",
                  color: "oklch(0.64 0.01 265)",
                }}
              >
                <kind.icon
                  className="h-3 w-3 shrink-0"
                  style={{ opacity: 0.7 }}
                />
                {t(kind.label)}
              </button>
            ))}
          </div>

          {/* 하늘 조명 상태. 켜져 있으면 배경이 원래 밝기로 나옵니다.
              행 자체는 정보 표시 — 조명 종류는 조명을 골라 바꿉니다. */}
          {state.objects.some(
            (item) =>
              item.kind === "light" && item.lightType === "sky" && item.visible,
          ) && (
            <div
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px]"
              style={{
                background: "oklch(1 0 0 / 3%)",
                color: "oklch(0.48 0.01 265)",
              }}
            >
              <Lightbulb
                className="h-3 w-3"
                style={{ color: "oklch(0.75 0.12 85)" }}
              />
              스카이 조명 사용 중
            </div>
          )}
        </div>
      </PanelSection>

      {/*
        ── 고른 것의 속성 ───────────────────────────────────────────────
        수치 입력(이동·회전·크기) 줄은 인물 칸과 소품 칸 **각각의 맨 위**로 옮겼습니다
        ().
      */}
      {(selectedCharacter || selectedObject) && (
        <section
          className="pt-3"
          style={{ borderTop: "1px solid oklch(1 0 0 / 7%)" }}
        >
          {/*
            ── 고른 덩어리 ───────────────────────────────────────────────
            ,
            「덩어리를 선택했는데도 이름 바꾸는 란이 남아 있으면 안 되지」.

            묶는 일은 **목록 안**(체크 → 묶기)에서 합니다. 여기는 «고른 덩어리 하나» 의 속성만 —
            색·이름·무엇으로 바꿀지·묶음 에셋. 낱개 소품의 칸(벽 그림·에셋·붙이기)은 뜨지 않습니다.
          */}
          {selectedGroup && (
            <PanelSection
              tour="layout-group-section"
              title={t("덩어리")}
              open={openSections.groups !== false}
              onToggle={() => toggleSection("groups")}
            >
              <GroupCards
                state={state}
                setState={setState}
                groupIds={[selectedGroup.id]}
                assets={swapOptions}
                onCreateAsset={onCreateGroupAsset}
              />
            </PanelSection>
          )}

          {selectedObject && !selectedGroup && (
            <>
              <GizmoModeRow
                transformMode={transformMode}
                setTransformMode={setTransformMode}
                transformConstraint={transformConstraint}
                setTransformConstraint={setTransformConstraint}
              />
              {/*
                ── 고른 소품의 수치 ───────────────────────────────────
                기즈모 단추 바로 아래가 그 자리입니다.
              */}
              {/*
                수치 입력과 색은 **접어 둡니다**(). 환경 탭과 **같은 칸**입니다.
              */}
              <ObjectFields
                object={selectedObject}
                onChange={(patch) => updateObject(selectedObject.id, patch)}
              />
              <button
                type="button"
                onClick={() =>
                  updateObject(selectedObject.id, {
                    position: { ...ZERO_VECTOR },
                    rotation: { ...ZERO_VECTOR },
                    scale: { ...ONE_VECTOR },
                  })
                }
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]"
                style={{
                  background: "oklch(0.55 0.15 200 / 14%)",
                  border: "1px solid oklch(0.55 0.15 200 / 35%)",
                  color: "oklch(0.72 0.15 200)",
                }}
              >
                <RotateCcw className="h-3 w-3" /> 위치·회전·크기 모두 초기화
              </button>
              {/*
                **벽과 조명에는 에셋이 없습니다.** 벽은 그림을 입히는 것이고, 조명은
                그려지는 물건이 아닙니다.
              */}
              {SWAPPABLE_KINDS.includes(selectedObject.kind) && (
              <>
              <span
                data-tour="layout-object-swap"
                className="mt-2 block text-[10px] font-semibold"
                style={{ color: "oklch(0.52 0.01 265)" }}
              >
                무엇으로 바꿔 그릴까 — 만들어 둔 시트
              </span>
              <select
                value={linkedAsset ? `${linkedAsset.kind}:${linkedAsset.id}` : ""}
                onChange={(event) => {
                  const found = swapOptions.find(
                    (item) => `${item.kind}:${item.id}` === event.target.value,
                  );
                  setState((current) =>
                    setObjectSwapIn(current, selectedObject.id, found ?? null),
                  );
                }}
                className="mt-1 w-full rounded px-1.5 py-1 text-[10px] outline-none"
                style={{
                  background: "oklch(0.11 0.008 265)",
                  border: "1px solid oklch(1 0 0 / 10%)",
                  color: "oklch(0.86 0.01 265)",
                }}
              >
                <option value="">
                  {swapOptions.some((item) => item.kind === "asset")
                    ? "안 고름 — 이름만 프롬프트에"
                    : "만들어 둔 에셋이 없습니다"}
                </option>
                {/*
                  **에셋만** 뜹니다. 소품을 «인물 시트» 로 바꿔 그릴 일은 없습니다 — 인물은 인물 자리에 섭니다.
                */}
                {swapOptions
                  .filter((item) => item.kind === "asset")
                  .map((item) => (
                  <option
                    key={`${item.kind}:${item.id}`}
                    value={`${item.kind}:${item.id}`}
                  >
                    {item.group} · {item.name}
                  </option>
                ))}
              </select>

              {/*
                ── 여기서 **에셋을 만들어 바로 잇습니다** ────────────────
                 소품을 놓은 그 자리에서 에셋 카드를 만들고(이름은 소품 이름 그대로) 바로 이 소품에 겁니다 —
                에셋을 만들러 다른 화면에 갔다 오면 무엇을 만들러 갔는지 잊고, 돌아와서 다시 골라야 합니다.
              */}
              {onCreateAsset && (
                <button
                  type="button"
                  data-tour="layout-object-asset"
                  onClick={() => onCreateAsset(selectedObject.id, selectedObject.label)}
                  className="mt-1 w-full rounded px-2 py-1.5 text-[10px] font-semibold"
                  style={{
                    background: "oklch(0.70 0.15 160 / 16%)",
                    border: "1px solid oklch(0.70 0.15 160 / 40%)",
                    color: "oklch(0.82 0.14 160)",
                  }}
                >
                  {linkedAsset
                    ? `«${linkedAsset.name}» 열기 — 시트 뽑기`
                    : "이 소품의 에셋 만들기 — 시트를 뽑아 바로 잇습니다"}
                </button>
              )}
              </>
              )}

              {/*
                ── 인물 관절에 붙이기 ─────────────────────────────────────
                

                붙이면 좌표의 뜻이 «월드» 에서 «그 관절 기준» 으로 바뀝니다. 그래서
                자리를 0 으로 되돌립니다 — 관절에 딱 붙은 데서 손잡이를 맞추는 편이,
                엉뚱한 데로 튄 물건을 찾아다니는 것보다 훨씬 빠릅니다.
              */}
              {selectedObject.kind !== "light" && (
                <div data-tour="layout-attach-bone" className="mb-2">
                  <span
                    className="block text-[10px] font-semibold"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    인물에 붙이기 — 포즈를 따라 함께 움직입니다
                  </span>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <select
                      value={selectedObject.attach?.targetId ?? ""}
                      onChange={(event) =>
                        setState((current) =>
                          event.target.value
                            ? attachObjectIn(current, selectedObject.id, {
                                targetId: event.target.value,
                                bone:
                                  selectedObject.attach?.bone ?? "RightHand",
                              })
                            : detachObjectIn(current, selectedObject.id),
                        )
                      }
                      className="w-full rounded px-1.5 py-1 text-[10px] outline-none"
                      style={{
                        background: "oklch(0.11 0.008 265)",
                        border: "1px solid oklch(1 0 0 / 10%)",
                        color: "oklch(0.86 0.01 265)",
                      }}
                    >
                      <option value="">안 붙임</option>
                      {state.characters
                        .filter((item) => !item.hidden)
                        .map((item) => (
                          <option
                            key={item.characterId}
                            value={item.characterId}
                          >
                            {plannerCharacters.find(
                              (source) => source.id === item.characterId,
                            )?.name ?? item.characterId}
                          </option>
                        ))}
                    </select>
                    <select
                      value={selectedObject.attach?.bone ?? "RightHand"}
                      disabled={!selectedObject.attach}
                      onChange={(event) =>
                        setState((current) =>
                          selectedObject.attach
                            ? attachObjectIn(current, selectedObject.id, {
                                targetId: selectedObject.attach.targetId,
                                bone: event.target.value,
                              })
                            : current,
                        )
                      }
                      className="w-full rounded px-1.5 py-1 text-[10px] outline-none disabled:opacity-40"
                      style={{
                        background: "oklch(0.11 0.008 265)",
                        border: "1px solid oklch(1 0 0 / 10%)",
                        color: "oklch(0.86 0.01 265)",
                      }}
                    >
                      {ATTACH_BONES.map((bone) => (
                        <option key={bone.id} value={bone.id}>
                          {bone.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedObject.attach && (
                    <>
                      {/*
                        손잡이 자리 — 소품 안에서 **관절에 닿는 점**입니다.
                        검은 손잡이가 손에 잡혀야지 한가운데가 잡히면 안 됩니다.
                      */}
                      <span
                        className="mt-1.5 block text-[9px]"
                        style={{ color: "oklch(0.52 0.01 265)" }}
                      >
                        손잡이 자리(m) — 소품 안에서 관절에 닿는 점
                      </span>
                      <div className="mt-0.5 grid grid-cols-3 gap-1">
                        {(["x", "y", "z"] as const).map((axis) => (
                          <NumberInput
                            key={axis}
                            value={
                              Math.round(
                                (selectedObject.attach?.pivot?.[axis] ?? 0) *
                                  100,
                              ) / 100
                            }
                            step={0.05}
                            onChange={(next) =>
                              setState((current) =>
                                setObjectPivotIn(current, selectedObject.id, {
                                  x: selectedObject.attach?.pivot?.x ?? 0,
                                  y: selectedObject.attach?.pivot?.y ?? 0,
                                  z: selectedObject.attach?.pivot?.z ?? 0,
                                  [axis]: next,
                                }),
                              )
                            }
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* 이름은 위 목록에서 **두 번 눌러** 고칩니다 — 칸이 둘이면 어느 쪽이 진짜인지 헷갈립니다. */}


              {selectedObject.kind === "light" && (
                <div data-tour="layout-light" className="mt-3 space-y-2">
                  <ChoiceRow
                    value={selectedObject.lightType || "point"}
                    columns={4}
                    options={[
                      {
                        id: "sky" as const,
                        label: "하늘",
                        hint: "하늘 전체에서 오는 빛",
                      },
                      { id: "point" as const, label: "포인트" },
                      { id: "spot" as const, label: "스팟" },
                      { id: "area" as const, label: "면광" },
                    ]}
                    onChange={(lightType) =>
                      updateObject(selectedObject.id, { lightType })
                    }
                  />
                  <label
                    className="block text-[10px]"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    세기
                    <NumberInput
                      value={selectedObject.intensity ?? 8}
                      step={0.5}
                      min={0}
                      onChange={(intensity) =>
                        updateObject(selectedObject.id, { intensity })
                      }
                    />
                  </label>
                  <label
                    className="flex items-center gap-2 text-[10px]"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    색
                    <input
                      type="color"
                      value={selectedObject.color || "#ffe9b0"}
                      onChange={(event) =>
                        updateObject(selectedObject.id, {
                          color: event.target.value,
                        })
                      }
                      className="h-7 w-12 rounded"
                    />
                  </label>
                </div>
              )}

              {/*
                ── 이 벽의 그림 ──────────────────────────────────────
                자주 만지는 수치·에셋이 위, 한 번 고르면 되는 그림이 아래입니다.
              */}
              {/*
                ── 벽에 붙일 그림 ─────────────────────────────────────
                

                한 컷에 필요한 배경은 대개 «정면 한 장» 입니다. 벽을 세워 크기를 맞추고 그 위에 그림을 붙이면, 인물과의 거리·크기가
                화면에서 바로 맞습니다. 여섯 면을 다 갖춘 방은 카메라가 도는 컷에서만 필요합니다.
              */}
              {selectedObject.kind === "wall" && (
                <div data-tour="layout-wall-image" className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
                      이 벽의 그림
                    </span>
                    <span className="text-[9px] tabular-nums" style={{ color: "oklch(0.50 0.01 265)" }}>
                      {selectedObject.scale.x.toFixed(1)} × {selectedObject.scale.y.toFixed(1)} m
                      {wallGap ? ` · 인물에서 ${wallGap.near.toFixed(1)} m 뒤` : ""}
                    </span>
                  </div>

                  {selectedObject.image ? (
                    <div className="flex items-center gap-1.5">
                      <img
                        src={assetSrc(selectedObject.image) || selectedObject.image}
                        alt=""
                        className="h-10 w-16 shrink-0 rounded object-cover"
                        style={{ border: "1px solid oklch(1 0 0 / 14%)" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[9px]" style={{ color: "oklch(0.62 0.01 265)" }}>
                        {selectedObject.image.split(/[\/]/).pop()}
                      </span>
                      <button
                        type="button"
                        onClick={() => setState((current) => setObjectImageIn(current, selectedObject.id, ""))}
                        title="그림만 뗍니다 — 벽은 그대로 서 있습니다"
                        className="shrink-0 rounded p-1 hover:bg-white/10"
                        style={{ color: "oklch(0.62 0.16 25)" }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[9px]" style={{ color: "oklch(0.45 0.01 265)" }}>
                      아직 없습니다 — 아래에서 고르거나 이 크기로 새로 뽑으세요.
                    </p>
                  )}

                  {(wallImages?.length ?? 0) > 0 && (
                    <select
                      value={selectedObject.image ?? ""}
                      onChange={(event) =>
                        setState((current) =>
                          setObjectImageIn(current, selectedObject.id, event.target.value),
                        )
                      }
                      className="w-full rounded px-1.5 py-1 text-[10px] outline-none"
                      style={FIELD_STYLE}
                    >
                      <option value="">그림 고르기 — 만들어 둔 것 {wallImages?.length}장</option>
                      {(wallImages ?? []).map((image) => (
                        <option key={image.id} value={image.filePath ?? image.id}>
                          {image.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {onCreateWallImage && (
                    <button
                      type="button"
                      onClick={() => onCreateWallImage(selectedObject.id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold"
                      style={{
                        background: "oklch(0.55 0.15 200 / 18%)",
                        border: "1px solid oklch(0.55 0.15 200 / 45%)",
                        color: "oklch(0.82 0.14 200)",
                      }}
                    >
                      <ImageIcon className="h-3 w-3" /> 이 크기로 배경 그림 만들기
                    </button>
                  )}
                </div>
              )}

              {/*
                  ── 어떤 시트로 바꿀까 ────────────────────────────────
                  

                  고르면 「이 자리에 «수화의 검» 을 그려라」 가 프롬프트에 들어갑니다.
                  안 고르면 이름만 나갑니다 — 그것만으로도 「가방」 정도는 통하지만,
                  **같은 가방**이 나오려면 시트를 짚어 줘야 합니다.
                */}
            </>
          )}
        </section>
      )}

      {/* ── 포즈 ────────────────────────────────────────── */}
      {selectedCharacter && (
        <PanelSection
          tour="layout-pose-section"
          title={t("포즈")}
          open={openSections.pose}
          onToggle={() => toggleSection("pose")}
        >
          {/*
            자세는 «내 프리셋» 에서 꺼내 씁니다. 내장 포즈 목록(걷기·달리기·앉기…)은
            2026-09-11 에 걷어냈습니다 — 
            기본 자세는 A 포즈입니다(`applyBasePose`).
          */}
          <PosePresetLibrary
            bonePose={bonePose}
            onApply={(entries, replaceAll) =>
              updateCharacter(selectedCharacter.characterId, {
                bonePose: replaceAll
                  ? entries
                  : mergeBonePose(bonePose, entries),
              })
            }
          />

          <div
            className="mt-3 pt-3"
            style={{ borderTop: "1px solid oklch(1 0 0 / 7%)" }}
          >
            <p
              className="mb-1.5 text-[10px] font-semibold"
              style={{ color: "oklch(0.45 0.01 265)" }}
            >
              {t("관절 세부 조정")}
            </p>
            {/*
              그림 한 장에서 포즈를 통째로 가져옵니다 — 관절을 하나씩 돌리기 전에
              **출발점**을 잡는 자리라 관절 판 바로 위에 둡니다. 가져온 뒤 어긋난 것만
              아래에서 고치면 됩니다.
            */}
            <div className="mb-2">
              <PoseFromImageField
                gender={selectedCharacter.gender}
                onPose={(bones) =>
                  updateCharacter(selectedCharacter.characterId, {
                    // 손가락 프리셋은 그대로 둡니다 — 검출기가 손가락을 안 줍니다(33점은 손목까지).
                    bonePose: mergeBonePose(bonePose, bones),
                  })
                }
              />
            </div>
            <BonePosePanel
              bonePose={bonePose}
              activeBone={activeBone}
              onSelectBone={setActiveBone}
              onChangeBone={(bone, rotation) =>
                updateCharacter(selectedCharacter.characterId, {
                  bonePose: mergeBonePose(bonePose, { [bone]: rotation }),
                  fingers: releaseFingerPreset(selectedCharacter.fingers, bone),
                })
              }
              onResetBone={(bone) =>
                updateCharacter(selectedCharacter.characterId, {
                  bonePose: mergeBonePose(bonePose, {
                    [bone]: { ...ZERO_VECTOR },
                  }),
                })
              }
              onResetAll={() =>
                updateCharacter(selectedCharacter.characterId, {
                  bonePose: {},
                  fingers: {},
                })
              }
              boneTransformMode={boneTransformMode}
              onBoneTransformMode={setBoneTransformMode}
              fineSnap={fineSnap}
              onFineSnap={setFineSnap}
            />
          </div>

          <div
            className="mt-3 pt-3"
            style={{ borderTop: "1px solid oklch(1 0 0 / 7%)" }}
          >
            <p
              className="mb-1.5 text-[10px] font-semibold"
              style={{ color: "oklch(0.45 0.01 265)" }}
            >
              {t("손 모양")}
            </p>
            <HandPosePanel
              bonePose={bonePose}
              onChange={(entries, clearedHand) => {
                // 손 프리셋이 우선권을 가집니다. 프리셋을 누르면 그 손의
                // 관절 수동 조정을 지워 프리셋 모양이 그대로 나오게 합니다.
                let base = bonePose;
                if (clearedHand) {
                  base = Object.fromEntries(
                    Object.entries(base).filter(
                      ([key]) => !key.startsWith(`${clearedHand}Hand`),
                    ),
                  );
                }
                updateCharacter(selectedCharacter.characterId, {
                  bonePose: mergeBonePose(base, entries),
                });
              }}
            />
          </div>
        </PanelSection>
      )}
    </>
  );
}
