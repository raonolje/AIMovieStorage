import { composeInMagnific, type MagnificVideoResolution } from "@/lib/magnificCompose";
import { HOLDS_PLANNER } from "@/lib/useTutorialPanel";
import { aspectNumberOf } from "@/components/composition/planner/PlannerChrome";
import { useEffect, useMemo, useRef, useState } from "react";
import { CompositionControlError, registerCompositionOpener } from "@/lib/compositionControl";
import { cutCompositionPatch } from "@/lib/cutCompositionSave";
import { projectFolderName } from "@/lib/localProjectStore";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Move3d,
  Ruler,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import CompositionPlanner, { type CompositionPlannerProps } from "@/components/CompositionPlanner";
import { newBackground } from "@/lib/projectTypes";
import { cutStem, sceneFolderName } from "@/lib/projectNames";
import { RoomPlaceDialog } from "@/components/composition/planner/RoomPlaceDialog";
import GeneratedImageShelf from "@/components/project/GeneratedImageShelf";
import FaceSetCard from "@/components/FaceSetCard";
import ImageLightbox, { type LightboxImage } from "@/components/ImageLightbox";
import { faceDisplayName, faceSetImages, splitFaceSets } from "@/lib/faceSets";
import CutVideoShelf from "@/components/project/CutVideoShelf";
import { requestPromptFromLlm } from "@/lib/promptRequest";
import {
  relinkPrompts,
  relinkPromptText,
  splitLinkTail,
  type PromptLinkInput,
} from "@/lib/promptLinks";
import {
  MODAL_BACKDROP,
  MODAL_BACKDROP_STYLE,
  MODAL_CARD_STYLE,
  modalCard,
} from "@/components/modalShell";
import { useApiReady } from "@/lib/useApiReady";
import { getTargetPlatform } from "@/components/PlatformSelect";
import { confirmDialog } from "@/components/ConfirmDialog";
import AutoTextarea from "@/components/AutoTextarea";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import {
  assetSrc,
  saveProjectMediaAsset,
} from "@/lib/mediaLibrary";
import {
  collectEntityPickerImages,
  collectSharedPickerImages,
  dedupePickerImages,
  type PickerGroup,
  type PickerImage,
} from "@/lib/entityImages";
import { fileStemOf } from "@/components/ReferenceTagBar";
import { objectLegend, tagCharacterNames } from "@/lib/compositionLegend";
import { buildCutPrompt } from "@/lib/cutPrompt";
import {
  backgroundMotionHint,
  buildCutVideoPrompt,
  cutVideoSecondsOf,
  formatVideoSeconds,
  heroImageOf,
} from "@/lib/cutVideoPrompt";
import { findMotionMask } from "@/lib/motionMask";
import { cutVideoLinkInput, magnificCutVideoReferences } from "@/lib/cutVideoReferences";
import { useT } from "@/lib/i18n";
import { cutToggleLabel, cutTogglesEnglish } from "@/lib/cutStyle";
/*
  요청 재료·사람 목록·«칸에 넣기» 는 `lib/promptPayloads` 한 벌 — 「AI 일괄 생성」 4단계가 화면 없이 같은
  요청을 보내야 해서 훅·컴포넌트 밖으로 꺼냈습니다(). 여기서는 화면만 아는 것(캡처 저장·토스트·잠금)을 보태 부릅니다. 규칙 1.
*/
import {
  cutCharacterRefs,
  cutLinkInput,
  cutPromptNote,
  cutRequestPayload,
  cutSwapPeople,
  cutVideoRequestPayload,
  cutVideoSkeletonInput,
  pickPrimaryPath,
  pickSheetPath,
  withCutPromptResult,
  cutSheetPathsForRequest,
} from "@/lib/promptPayloads";
import PickTile from "@/components/project/PickTile";
import CutStyleToggles from "@/components/project/CutStyleToggles";
import CutVideoSection from "@/components/project/CutVideoSection";
import CutPromptSection from "@/components/project/CutPromptSection";
import { cutComposeLines } from "@/lib/cutComposeLines";
import { autoRealism, isCloseUp } from "@/lib/autoRealism";
import NaturalPromptButton from "@/components/NaturalPromptButton";
import { koreanInEnglish, targetModelOf } from "@/lib/modelRules";
import {
  readCompositionIntoCut,
  sceneBackgroundImages,
  syncCutIntoComposition,
} from "@/lib/cutCompositionSync";
import {
  summarizeCompositionCamera,
  type CompositionState,
} from "@/lib/composition";
import type { ProjectContextSummary } from "@/lib/projectContext";
import type {
  Background,
  Character,
  Cut,
} from "@/lib/projectTypes";
import type { RoomPreset } from "@/lib/roomPreset";
import type { VisualAsset } from "@/lib/visualAsset";
import { fieldStyle } from "@/components/project/fieldStyle";

/**
 * 그림 줄 배지 색. 계보 패널의 강조색(`lineageAccent`)과 같은 계열 — 변형은 인물 보라,
 * 다른 원본은 그보다 붉은 쪽으로 살짝 튼 보라(같은 인물이되 변형은 아니라서 계열만 같게),
 * 보유 에셋은 에셋 초록, 공용 에셋은 레퍼런스 탭의 주황, 시트는 흰색. 원본은 배지가 없습니다.
 */
const PICKER_BADGE_COLOR: Record<PickerGroup, string> = {
  root: "oklch(0.80 0.01 265)",
  variation: "oklch(0.82 0.14 290)",
  alternate: "oklch(0.80 0.12 320)",
  sheet: "oklch(0.94 0 0)",
  owned: "oklch(0.82 0.15 160)",
  shared: "oklch(0.82 0.16 45)",
};

// «그림이 없을 때 그 사람을 세우는 한 줄»(`lookOf`)은 `lib/promptPayloads` 로 — 요청과 꼬리 줄, 일괄 생성이 같은 것을 씁니다.

/** 고른 것을 알리는 테두리 색. 탭 색과 같은 계열이라 «지금 어느 탭인지» 가 타일에서도 읽힙니다. */
const PICK_ACCENT = {
  character: "oklch(0.86 0.16 290)",
  background: "oklch(0.76 0.14 200)",
} as const;

/**
 * 인물·장소를 «그림으로» 고르는 타일 한 장.
 *
 * 배경만 드롭다운(«고르지 않음»)이었는데, 이름만으로는 «어느 골목» 인지 알 수 없어
 * 결국 2단계로 돌아가 확인해야 했습니다.
 *
 * 인물 줄과 배경 줄이 **같은 컴포넌트** 를 씁니다(규칙 1) — 한쪽만 그림이 되고 다른 쪽은
 * 글자로 남으면 다음에 규칙을 고칠 때 또 한쪽을 빠뜨립니다.
 */

/**
 * 컷 하나.
 *
 * # 머리줄이 요약입니다
 *
 * 번호와 고른 연출이 칩으로 붙습니다. 컷이 스무 개가 되면 하나씩 펼쳐 볼 수
 * 없어요. 접힌 채로도 「이 컷은 시네마틱·미스터리·50mm·네온」 이 읽혀야 합니다.
 *
 * # 샷·앵글·무빙은 여기 없습니다
 *
 * 구도잡기가 잽니다. 카메라와 인물 사이 거리에서 샷 크기가, 높이 차이에서
 * 앵글이 나와요. 두 곳에 두면 반드시 어긋나서, **읽기 전용으로만** 보여 줍니다.
 */
export default function CutCard({
  tutorialOpen,
  cut,
  index,
  sceneTitle,
  sceneSummary,
  characters,
  backgrounds,
  projectAspect,
  imageModel,
  videoModel,
  videoAspect,
  savedShots,
  context,
  patchCut,
  onRemove,
  onCreateBackground,
  onPatchBackground,
  onRemoveBackground,
  placeLibrary,
  onChangeSharedAssets,
  roomPresets,
  onSaveRoomPreset,
  onRemoveRoomPreset,
}: {
  cut: Cut;
  index: number;
  sceneTitle: string;
  sceneSummary: string;
  characters: Character[];
  backgrounds: Background[];
  /**
   * 작품이 정한 그림 비율(「9:16」 등). **구도잡기가 여기서 시작합니다.**
   *
   * 2026-09-18 점검: 작품을 9:16 으로 잡아 두고 구도잡기를 열면 프레임이 16:9 였습니다.
   * 세로로 뽑을 컷을 가로 프레임에서 잡고 있었던 셈이라, 잡아 둔 구도와 뽑힌 그림의
   * 가장자리가 서로 달랐습니다.
   */
  projectAspect?: string;
  /**
   * 이 작품의 영상 모델(마그니픽에서 고른 것). 모델마다 프롬프트 규칙이 달라서
   * 조립할 때 갈라 씁니다 — 소리를 못 만드는 모델에는 대사를 안 보내고, 부정문이
   * 안 통하는 모델에는 금지 사항을 긍정으로 뒤집습니다(`modelRules.ts`).
   */
  videoModel?: string;
  /**
   * **그림** 모델. 컷 그림 프롬프트를 이 모델 문법으로 씁니다.
   *
   * 영상만 모델을 받고 그림은 안 받고
   * 있었습니다 — 같은 컷인데 한쪽만 모델에 맞춰 쓰이고 있었습니다.
   */
  imageModel?: string;
  /**
   * **영상** 화면비. 그림과 다를 수 있습니다(그림 16:9 · 영상 9:16).
   *
   * 사용자 2026-09-18 점검에서 드러났습니다 — 영상 프롬프트에 그림 비율이 가고 있었습니다.
   */
  videoAspect?: string;
  context: ProjectContextSummary | null;
  /** 값이나 «지금 컷을 받아 바꿀 부분을 돌려주는 함수». 오래 기다린 뒤 쓰는 것은 함수로. */
  patchCut: (patch: Partial<Cut> | ((cut: Cut) => Partial<Cut>)) => void;
  onRemove: () => void;
  /**
   * 이 프로젝트에서 **잡아 둔 구도들**. 「구도 불러오기」 목록에 뜹니다.
   *
   * ,
   * 「구도 불러오기 하면 구도잡기에서 작업했던 공간도 그대로 불러오는 거야… 구도 불러온 다음
   * 배경만 바꿀 수도 있으니」. 그래서 **구도 상태를 통째로** 복사합니다 — 방·소품·인물 자리까지.
   */
  savedShots?: {
    id: string;
    label: string;
    thumb?: string;
    composition: CompositionState;
  }[];
  /** 구도잡기에서 만든 **장소 카드**를 프로젝트에 더합니다. 안 주면 그 칸이 구도잡기에 안 보입니다. */
  onCreateBackground?: (background: Background) => void;
  /** 구도잡기 안에서 연 장소 카드의 편집을 프로젝트에 반영합니다(프롬프트·그림 등록·자동 6면 커팅). */
  onPatchBackground?: (
    backgroundId: string,
    updater: (current: Background) => Partial<Background>,
  ) => void;
  /** 장소 카드를 지웁니다. */
  onRemoveBackground?: (backgroundId: string) => void;
  /** 구도잡기에서 열 **장소 라이브러리**(옛 배경 단계 — 계보·보유 에셋). 그대로 넘깁니다. */
  placeLibrary?: CompositionPlannerProps["placeLibrary"];
  /** 배경 에셋(공용) 고치기 — 구도잡기에서 소품의 에셋 시트를 만들고 잇습니다. */
  onChangeSharedAssets?: (updater: (current: VisualAsset[]) => VisualAsset[]) => void;
  /** 방 라이브러리 — 프로젝트가 들고 있는 저장된 방들. 안 주면 구도잡기에서 그 칸이 안 보입니다. */
  roomPresets?: RoomPreset[];
  onSaveRoomPreset?: (preset: RoomPreset) => void;
  onRemoveRoomPreset?: (id: string) => void;
  /** 튜토리얼이 「이 컷을 펴 둬라」 고 고른 것. 접힌 컷은 머리줄만 보여 자리를 못 가리킵니다. */
  tutorialOpen?: boolean;
}) {
  const { projectName, sharedAssets, commitProjectChange } = useProjectMedia();
  const t = useT();
  const [open, setOpen] = useState(false);

  // 튜토리얼이 고른 컷은 폅니다. 접는 것까지 하지는 않습니다 — 사람이 보던 것을 닫아 버리면 안 됩니다.
  useEffect(() => {
    if (tutorialOpen) setOpen(true);
  }, [tutorialOpen]);
  const [cutBusy, setCutBusy] = useState(false);
  const apiReady = useApiReady();

  /** LlmRequestButton 과 API 요청이 **같은 재료**를 쓰게 한 곳에 둡니다. */
  /**
   * 컷 키 이미지 프롬프트를 받을 때 LLM 에 넘기는 **재료 한 벌**.
   *
   * 여태 여기로 간 것은 «씬 요약 · 컷 설명 · 연출 토글 · VFX» 뿐이었습니다. 구도는 그림만
   * 올라가고 **글로는 한 마디도 안 갔고**, 고른 시트도, 대사·연기 지시도 안 갔습니다.
   * 그래서 프롬프트가 「그 컷이 무엇인지」 를 반쯤만 알고 쓰였습니다.
   *
   * 몸통은 `lib/promptPayloads.cutRequestPayload` 에 있습니다(2026-09-22) — 일괄 생성 4단계가 같은 것을 보냅니다.
   */
  const cutRequestData = () =>
    cutRequestPayload({
      projectFacts: context?.facts ?? null,
      sceneSummary,
      cut,
      cutCharacters,
      background,
      summary,
      useComposition,
      facts: buildFacts().facts,
    });

  const runCutPrompt = async () => {
    if (cutBusy) return;
    const filled = [
      cut.promptKo,
      cut.promptEn,
      cut.negativeKo,
      cut.negativeEn,
    ].some((t) => t?.trim());
    if (filled) {
      const ok = await confirmDialog({
        title: "지금 프롬프트를 새로 받을까요?",
        description: "네 칸이 새 값으로 바뀝니다.",
        confirmLabel: "새로 받기",
      });
      if (!ok) return;
    }
    setCutBusy(true);
    try {
      const result = await requestPromptFromLlm({
        label: `컷 ${cut.order} · 프롬프트 작성`,
        deliveredTo: `컷 ${cut.order} · 프롬프트 네 칸에 넣음`,
        task: "cutPrompt",
        template: "cut-prompt",
        platformId: getTargetPlatform(),
        techniques: cut.techniques || [],
        data: cutRequestData(),
        images: cut.guideImage ? [cut.guideImage] : [],
      });
      await keepPrompt(result, "프롬프트 작성");
      toast.success("컷 프롬프트를 받았습니다.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setCutBusy(false);
    }
  };
  /** 이 컷의 «특수 배경» 카드(도면·동선 등). 만들면 프로젝트 장소 목록에 그대로 생깁니다. */
  const [specialId, setSpecialId] = useState<string | null>(null);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  /**
   * 구도잡기에 넘길 구도. 열 때 컷 선택을 반영해 만든 것입니다.
   *
   * 컷에 바로 저장하지 않는 이유: 창을 열었다 그냥 닫으면 아무 일도 없어야 합니다.
   * 저장을 누를 때 구도잡기가 돌려주는 값이 컷에 실립니다.
   */
  const [plannerComposition, setPlannerComposition] = useState<
    CompositionState | undefined
  >(cut.composition);
  const [tab, setTab] = useState<"character" | "background" | "reference">(
    "character",
  );
  /** 6면 세트 카드를 누르면 여섯 면을 넘겨 봅니다 */
  const [viewingSet, setViewingSet] = useState<LightboxImage[] | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  /**
   * 구도를 레퍼런스 삼아 마그니픽에서 뽑기.
   *
   * 이 길이 축척 문제를 통째로 비켜 갑니다. 3D 는 **카메라 각도·인물 자리·누가 어디에**
   * 만 말하면 되고, 잔디와 인물의 크기를 픽셀 단위로 맞추는 일은 생성기가 합니다.
   * 그리고 컷마다 **같은 3D 세트**에서 뽑은 구도를 넘기므로, A→B 컷 전환에서 배경이
   * 달라지지 않습니다 — 이 기능이 원래 막으려던 그 문제입니다.
   *
   * 보내는 것: ① 구도 그림(배치·카메라) ② 배경 그림(장소의 정체성) ③ 인물 시트(사람의 정체성).
   */
  /**
   * 이 컷이 마그니픽에 올릴 **재료**를 모읍니다 — 구도 그림·배경 플레이트·인물 시트.
   *
   * 그림으로 뽑든(«구성») 영상으로 뽑든(«영상으로») 올릴 것은 같습니다. 두 군데서
   * 따로 모으면 한쪽에만 배경 플레이트가 붙는 식으로 반드시 어긋납니다(공통 규칙 1).
   */
  /*
    ── 컷마다 켜고 끄는 두 스위치 ────────────────────────────────────────
     씬에 «작업 방식» 을 고르게 하던 것을 컷의 스위치 둘이 대신합니다 — 고를 곳이 한 겹 줄고, 같은 씬 안에서
    컷마다 다르게 갈 수 있습니다.
  */
  const hasComposition = Boolean(cut.composition || cut.guideImage || cut.guideImagePath);
  const useComposition = cut.useComposition !== false && hasComposition;
  const useRefVideo = cut.useRefVideo !== false && Boolean(cut.refVideoPath);

  /**
   * 찍은 그림을 **프로젝트 폴더에 내려놓습니다**(data URL → png 파일).
   *
   * 컷을 지워도 남아야 하고 다른 컷에서 다시 쓰는 일이 잦아 `scene-cut` 갈래에 둡니다.
   */
  const storeCapture = async (dataUrl: string | undefined, suffix: string, targetProjectName = projectName) => {
    if (!dataUrl || !targetProjectName?.trim()) return undefined;
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `컷${cut.order}_${suffix}.png`, { type: "image/png" });
    const saved = await saveProjectMediaAsset(file, {
      projectName: targetProjectName,
      assetType: "scene-cut",
      ownerName: sceneFolderName(sceneTitle, index),
      stem: `${cutStem(sceneTitle, index, cut.order)}_${suffix}`,
    });
    return saved?.path;
  };

  /** 구도를 저장·캡처한 **그 순간** 두 장을 폴더에 내려놓고 경로를 컷에 적습니다. */
  const storeCaptures = async (guide?: string, plate?: string) => {
    try {
      const [guideImagePath, plateImagePath] = await Promise.all([
        storeCapture(guide, "구도"),
        storeCapture(plate, "배경"),
      ]);
      if (!guideImagePath && !plateImagePath) return;
      // 값이 아니라 함수로 고칩니다 — 저장하는 사이 도착한 프롬프트 답을 지우면 안 됩니다.
      patchCut(() => ({ guideImagePath, plateImagePath }));
    } catch {
      // 폴더에 못 넣어도 data URL 은 남아 있어 보내기는 됩니다. 조용히 넘어갑니다.
    }
  };

  const gatherCutRefs = async () => {
    /*
      구도 그림은 캡처 직후 data URL 이라 폴더에 한 번 내려놓아야 보낼 수 있습니다.
      컷을 지워도 남아야 하고 다른 컷에서 다시 쓰는 일이 잦아 `scene-cut` 갈래에 둡니다.
    */
    /*
      구도를 끈 컷은 구도 그림·배경 플레이트를 **아예 안 올립니다**. 파일은 그대로 두고(다시 켜면 그 자리) 이번 요청에서만 뺍니다 —
      올려 두고 프롬프트에서만 빼면 생성기가 «올사용자 그림» 을 어떻게든 참고해 버립니다.
    */
    let guidePath = useComposition ? cut.guideImagePath : undefined;
    let platePath = useComposition ? cut.plateImagePath : undefined;
    if (useComposition && !guidePath) guidePath = await storeCapture(cut.guideImage, "구도");
    if (useComposition && !platePath) platePath = await storeCapture(cut.plateImage, "배경");
    /*
      경로를 컷에 적는 것은 **구도를 켠 채 새로 내려놓았을 때뿐**입니다. 끈 컷에서는 guidePath·platePath 가
      비어 있는데, 그것이 «저장된 경로와 다르다» 는 이유로 patch 하면 위 주석과 반대로 저장해 둔 경로를
      지웁니다 — 컷이 플레이트를 잊고 «로컬 영상» 이 파노라마 원본으로 물러섭니다. 「프롬프트 작성」·
      「영상 프롬프트」 도 이 길을 타게 되면서 드러났습니다(2026-09-21 점검). 빈 쪽은 지금 값을 둡니다.
      `await` 뒤의 patch 는 함수로 — 캡처를 내려놓는 사이 도착한 프롬프트 답을 지우면 안 됩니다.
    */
    if (useComposition && (guidePath !== cut.guideImagePath || platePath !== cut.plateImagePath))
      patchCut((current) => ({
        guideImagePath: guidePath ?? current.guideImagePath,
        plateImagePath: platePath ?? current.plateImagePath,
      }));
    /*
      인물은 **캐릭터 시트**를 먼저 고릅니다(`pickSheetPath` — 까닭은 그 주석).
      배경은 **파노라마 원본이 아니라 배경 플레이트**를 보냅니다.

      등장방형 파노라마를 그대로 주면 생성기가 그 왜곡을 따라 그리고, 한 컷의 화각과
      안 맞으니 배경을 제 나름대로 다시 해석합니다.
      플레이트는 그 컷의 카메라로 이미 잘린 그림이라 왜곡이 없습니다.
      플레이트가 없는 옛 컷만 어쩔 수 없이 배경 대표 그림으로 물러섭니다.
    */
    const backgroundPath =
      platePath ?? pickPrimaryPath(background?.generatedImages);

    /*
      ── 마그니픽 @태그로 프롬프트를 씁니다 ────────────────────────────

      마그니픽은 올린 그림을 **파일 이름**으로 부릅니다 — 프롬프트에 `@파일이름` 이라고
      적어야 칩으로 이어지고, 그래야 「이 그림을 이렇게 써라」 가 전달됩니다. 「첫 번째
      그림은…」 처럼 순서로 적으면 아무 그림도 안 걸립니다().

      그리고 구도 캡처에는 이제 **이름표가 없습니다**(생성기가 글자를 그려 버려서).
      누가 누구인지는 마네킹의 **식별 색**으로 말합니다 — 「파란 사람 = @냥이_시트_001」.
      이게 곧 «캐릭터 스왑» 이 되는 자리입니다.
    */
    const tagOf = (path: string) => `@${fileStemOf(path)}`;
    const guideTag = guidePath ? tagOf(guidePath) : "";
    /*
      ── 인물마다 **고른 레퍼런스** ─────────────────────────────────────
      구도에 놓인 인물(마네킹 엑스트라 포함), 구도가 없으면 컷에 고른 인물 — 고른 시트·별칭까지 한 벌로
      `cutSwapPeople` 이 짓습니다. 그림 «구성»·영상 «구성»·「@ 다시 잇기」·일괄 생성이 같은 목록을 봅니다.
    */
    const swaps = cutSwapPeople(cut, characters);
    /*
      본문의 이름을 태그로 올릴 때 넘기는 «사람» 목록. 그림 «구성»·영상 «구성» 이 같은 것을 쓰고,
      「@ 다시 잇기」 는 `gatherLinkInput` 을 거쳐 같은 이름·태그·별칭을 받습니다 — 한쪽만
      별칭을 모르면 영문 본문이 «구성» 에서는 칩이 서고 다시 잇기에서는 안 서는 식으로 어긋납니다.
    */
    const tagPeople = swaps.map((person) => ({
      name: person.name,
      tag: person.sheetPath ? tagOf(person.sheetPath) : undefined,
      aliases: person.aliases,
    }));
    /*
      ── 소품도 **시트로** 올립니다 ────────────────────────────────────
      

      구도잡기에서 소품에 에셋 카드를 이어 두면(`swapRef`) 그 시트가 «이 물건이 이렇게
      생겼다» 인데, 여태 올리는 것은 구도·배경·인물 시트뿐이었습니다. 소품은 「빨간 상자는
      가방입니다」 까지만 가고 **어떤 가방인지**는 생성기가 지어냈습니다 — 이어 둔 시트가
      있는데도요. 인물과 같은 규칙으로 시트를 올리고 `@태그` 로 부릅니다.

      에셋 카드는 세 곳에 삽니다 — 작품 공용(`sharedAssets`)·인물 소유·장소 소유.
      `swapRef.kind` 가 인물·장소면 그 시트를 씁니다(소품 자리에 사람을 세우는 경우).
    */
    const assetPool = [
      ...(sharedAssets || []),
      ...characters.flatMap((item) => item.assets || []),
      ...backgrounds.flatMap((item) => item.assets || []),
    ];
    const sheetOfSwap = (ref: { kind: string; id: string } | undefined): string | undefined => {
      if (!ref) return undefined;
      if (ref.kind === "asset") return pickSheetPath(assetPool.find((item) => item.id === ref.id)?.generatedImages);
      if (ref.kind === "character") {
        const person = characters.find((item) => item.id === ref.id);
        return person ? cutCharacterRefs(cut, person.id, person.generatedImages)[0] : undefined;
      }
      if (ref.kind === "background") return pickPrimaryPath(backgrounds.find((item) => item.id === ref.id)?.generatedImages);
      return undefined;
    };
    const props = objectLegend(cut.composition).map((prop) => {
      const sheetPath = sheetOfSwap(
        (cut.composition?.objects || []).find((item) => item.id === prop.id)?.swapRef,
      );
      return { ...prop, sheetPath, tag: sheetPath ? tagOf(sheetPath) : undefined };
    });
    const propPaths = props.map((prop) => prop.sheetPath).filter((path): path is string => Boolean(path));
    const characterPaths = swaps.flatMap((item) => item.sheetPaths);
    // 같은 시트가 두 소품에 이어져 있어도 한 번만 올립니다 — 마그니픽은 같은 파일을 두 번 받으면 « #2» 를 붙여 태그가 어긋납니다.
    const references = [...new Set([guidePath, backgroundPath, ...characterPaths, ...propPaths])].filter(
      (path): path is string => Boolean(path),
    );
    return {
      guidePath,
      guideTag,
      platePath,
      backgroundPath,
      tagOf,
      swaps,
      tagPeople,
      props,
      propPaths,
      characterPaths,
      references,
    };
  };

  const [sendingShot, setSendingShot] = useState(false);
  const sendCompositionToMagnific = async (
    prompt: string,
    lang: "ko" | "en" = "en",
  ) => {
    if (sendingShot) return;
    /*
      구도를 **쓰기로 한** 컷에서만 구도 그림을 요구합니다. 인물 시트와 글만으로 뽑는 길이 따로 있습니다.
    */
    if (useComposition && !cut.guideImage && !cut.guideImagePath) {
      toast.error("먼저 구도잡기에서 구도를 저장해 주세요.", {
        description:
          "구도 없이 인물 시트만으로 뽑으려면 위의 «구도 쓰기» 를 꺼 주세요.",
      });
      return;
    }
    if (!prompt.trim()) {
      toast.error("보낼 프롬프트가 없습니다.");
      return;
    }
    setSendingShot(true);
    try {
      const {
        guidePath,
        guideTag,
        platePath,
        backgroundPath,
        tagOf,
        swaps,
        tagPeople,
        props,
        characterPaths,
        references,
      } = await gatherCutRefs();
      if (useComposition && !guidePath) {
        toast.error("구도 그림을 폴더에 저장하지 못했습니다.");
        return;
      }

      // 안내문은 순수 함수가 짓습니다(`lib/cutComposeLines.ts`) — 여기서는 재료만 넘깁니다.
      const lines = cutComposeLines({
        lang,
        guideTag,
        platePath,
        backgroundPath,
        tagOf,
        swaps,
        props,
      });

      // 꼬리 줄(참고 그림)은 이미 태그가 서 있어 본문만 바꿉니다 — 같이 바꾸면 칩이 두 번 섭니다(`splitLinkTail`).
      const split = splitLinkTail(prompt.trim());
      const body = [tagCharacterNames(split.body, tagPeople), split.tail]
        .filter(Boolean)
        .join("\n\n");
      await composeInMagnific({
        prompt: `${lines.join("\n")}\n\n${body}`,
        referencePaths: references,
        owner: { kind: "cut", name: `컷 ${cut.order}`, cutId: cut.id },
        onStatus: (message) => toast.loading(message, { id: `shot:${cut.id}` }),
      });
      toast.success(`컷 ${cut.order} 을 마그니픽에 올렸습니다.`, {
        id: `shot:${cut.id}`,
        description: `구도 + ${platePath ? "배경 플레이트" : "배경"} + 인물 시트 ${characterPaths.length}장 · @태그로 이어 두었습니다`,
      });
    } catch (error) {
      toast.error(String(error), { id: `shot:${cut.id}` });
    } finally {
      setSendingShot(false);
    }
  };

  const cutCharacters = useMemo(
    () => characters.filter((item) => cut.characterIds.includes(item.id)),
    [characters, cut.characterIds],
  );
  const background = backgrounds.find((item) => item.id === cut.backgroundId);
  const tags = cut.styleTags || [];
  /*
    **알아서 켜 주는 실사 기본값** — 화면에도 보여 줍니다.

     다만 **말없이** 넣지는 않습니다.
    자동으로 무엇이 들어갔는지 안 보이면 「왜 이런 그림이 나왔지」 를 알 수가 없습니다.
    질감 칸에서 손으로 켜고 끄면 그쪽이 이깁니다.
  */
  const autoLook = autoRealism({
    styles: context?.facts.styles ?? [],
    hasPeople: (cut.characterIds || []).length > 0,
    closeUp: true,
    manual: tags,
  });

  /**
   * 구도잡기 열기 — 컷에서 고른 인물·배경을 씬에 반영하고 엽니다.
   *
   * 규칙은 `lib/cutCompositionSync.ts` 에 있습니다. 요약: **열 때는 컷이 기준,
   * 닫을 때는 씬이 기준.** 두 방향이 서로 채우면 한쪽이 뺀 것을 다른 쪽이 되살립니다.
   */
  /** 「구도 불러오기」 창이 열려 있는가. */
  const [shotsOpen, setShotsOpen] = useState(false);

  /**
   * 잡아 둔 구도를 **통째로** 이 컷에 옮깁니다.
   *
   * `renders`(그 구도에서 뽑은 레퍼런스 영상)만 뺍니다 — 영상은 그 컷의 타이밍으로 뽑은
   * 것이라, 카메라를 바꿀 이 컷에 따라오면 «내가 안 뽑은 영상» 이 붙습니다.
   * 구도 그림도 따라오지 않습니다. 새 구도를 저장할 때 새로 찍힙니다.
   */
  const loadShot = async (shot: { label: string; composition: CompositionState }) => {
    if (cut.composition) {
      const ok = await confirmDialog({
        title: "지금 구도를 덮어쓸까요?",
        description: `«${shot.label}» 의 방·소품·인물 자리를 그대로 가져옵니다. 지금 잡아 둔 구도는 사라집니다.`,
        confirmLabel: "가져오기",
        tone: "danger",
      });
      if (!ok) return;
    }
    /*
      **깊은 복사로 가져옵니다.**

      

      여태 `{...shot.composition}` 얕은 복사였습니다. 안쪽 배열(방·소품·인물)을 원본 컷과
      **같은 객체로 공유**했습니다. 지금은 모든 편집이 새 배열을 만드는 순수 변환이라
      사고가 안 났지만, 제자리로 고치는 코드가 한 줄만 들어와도 **불러온 컷을 고치면
      원본 컷이 같이 바뀝니다.** 그런 코드는 언제든 들어올 수 있으니 여기서 끊어 둡니다.

      `renders` 는 뽑아 둔 그림이라 따라오면 안 됩니다 — 다른 컷의 결과입니다.
    */
    const { renders: _renders, ...rest } = shot.composition;
    const copied = JSON.parse(JSON.stringify(rest)) as CompositionState;
    patchCut(() => ({ composition: copied }));
    setShotsOpen(false);
    toast.success(`«${shot.label}» 의 구도를 가져왔습니다.`, {
      description: "구도잡기를 열어 카메라만 바꾸면 됩니다. 배경도 여기서 갈아 끼울 수 있습니다.",
    });
  };

  const openPlanner = () => {
    const synced = syncCutIntoComposition(cut.composition, {
      cut,
      characters,
      backgrounds,
    });
    setPlannerComposition(synced.composition);
    // 조용한 알림 한 줄 — 씬이 저절로 바뀐 것을 모르면 「내가 언제 이걸 넣었지」 가 됩니다.
    if (synced.notice) toast.message(synced.notice);
    setPlanning(true);
  };
  const openPlannerRef = useRef(openPlanner);
  openPlannerRef.current = openPlanner;
  useEffect(() => {
    if (!projectName) return;
    return registerCompositionOpener({ projectName, cutId: cut.id, sceneTitle, cutOrder: cut.order }, () => openPlannerRef.current());
  }, [projectName, cut.id, sceneTitle, cut.order]);

  /** 인물·배경을 그림으로 고르는 줄. 배경은 6면 세트가 있으면 세트 카드로 보여 줍니다. */
  const characterTiles = useMemo(
    () =>
      characters.map((item) => ({
        entity: item,
        thumb: collectEntityPickerImages(item)[0],
      })),
    [characters],
  );
  const backgroundTiles = useMemo(
    () =>
      backgrounds.map((item) => {
        /*
          타일은 **씬이 실제로 쓰는 재료**(원본 `generatedImages`)로 판단합니다.

          picker 그림(변형·다른 원본·시트·에셋까지)으로 재면 타일은 «이건 6면짜리»
          라고 약속하는데 구도잡기를 열면 정면 한 장만 걸리거나 아무것도 안 걸립니다 —
          `applyBackgroundIn`·`availableBackgrounds` 는 원본 생성 이미지만 보니까요.
          두 곳이 영원히 같은 답을 내도록 `cutCompositionSync` 의 목록을 씁니다(규칙 1).
        */
        const { sets, singles } = splitFaceSets(sceneBackgroundImages(item), {
          legacy: true,
        });
        // 합성 시트는 대표 그림으로 쓰지 않습니다(씬에서도 배경막으로 안 씁니다).
        const usable = singles.filter((image) => !image.isCompositeSheet);
        return { entity: item, set: sets[0], thumb: usable[0] ?? singles[0] };
      }),
    [backgrounds],
  );

  /** 이 구도에서 뽑아 둔 레퍼런스 영상들 — 최근이 앞. */
  const renders = useMemo(
    () =>
      [...(cut.composition?.renders ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)),
    [cut.composition?.renders],
  );

  const summary = summarizeCompositionCamera(cut.composition, {
    heightsCm: Object.fromEntries(
      characters.map((item) => [item.id, item.heightCm ?? 170]),
    ),
  });

  const buildFacts = () =>
    buildCutPrompt({ cut, characters: cutCharacters, background, context });

  /*
    ── 「@ 다시 잇기」 ───────────────────────────────────────────────────
    

    프롬프트를 새로 받으면 손으로 고친 문장까지 같이 날아갑니다. 바뀐 것이 그림 이름
    하나일 때는 이름만 갈아 끼웁니다 — 키 이미지 두 칸과 영상 두 칸을 한 번에.
  */
  const [relinking, setRelinking] = useState(false);
  /*
    토스트의 단추는 **나중에** 눌립니다. 그때 부를 함수가 지금 렌더의 `cut` 을 물고 있으면
    그 사이 바뀐 선택이 반영되지 않습니다. 늘 최신 것을 부르도록 손잡이만 둡니다.
  */
  const relinkRef = useRef<() => Promise<void>>(async () => {});
  /**
   * **@태그를 잇는 재료 한 벌** — 사람(고른 시트·생김새·별칭)·배경·구도.
   *
   * 여태 「@ 다시 잇기」 만 이 재료를 알았습니다. 그래서 「영상 프롬프트」 나 「프롬프트 작성」 으로
   * 프롬프트를 새로 만들면 @태그와 꼬리 줄이 **전부 풀렸습니다**(2026-09-21 실측) — 이어 둔 것을
   * 새 글이 덮어쓰고, 다시 잇기를 또 눌러야 했습니다. 이제 새로 만드는 자리 둘(`keepPrompt`·
   * `applyVideoPrompt`)과 다시 잇기가 **이 한 벌**을 같이 씁니다(규칙 1) — 세 곳이 따로 모으면
   * 한 곳만 배경 생김새를 빠뜨리는 식으로 반드시 어긋납니다.
   *
   * `gatherCutRefs` 가 캡처를 폴더에 내려놓느라 기다리므로 async 입니다. 받은 뒤의 patch 는
   * 반드시 함수로 — 기다리는 사이 도착한 다른 답을 지우면 안 됩니다.
   */
  const gatherLinkInput = async (): Promise<PromptLinkInput> => {
    // 캡처를 폴더에 내려놓는 것만 화면의 일 — 재료 자체는 `cutLinkInput`(일괄 생성과 같은 것).
    const { guidePath, backgroundPath } = await gatherCutRefs();
    return cutLinkInput({ cut, characters, background, summary, useComposition, guidePath, backgroundPath });
  };
  const relinkTags = async () => {
    if (relinking) return;
    setRelinking(true);
    try {
      const input = await gatherLinkInput();
      const key = relinkPrompts(
        { promptKo: cut.promptKo, promptEn: cut.promptEn },
        input,
      );
      const videoInput = cutVideoLinkInput(cut, input);
      const videoPromptKo = relinkPromptText(cut.videoPromptKo ?? "", videoInput, "ko");
      const videoPromptEn = relinkPromptText(cut.videoPromptEn ?? "", videoInput, "en");
      const videoChanged =
        videoPromptKo !== (cut.videoPromptKo ?? "") ||
        videoPromptEn !== (cut.videoPromptEn ?? "");
      if (!key.changed && !videoChanged) {
        toast("다시 이을 것이 없습니다.", {
          description: "프롬프트의 @태그가 지금 걸린 그림과 같습니다.",
        });
        return;
      }
      // 값이 아니라 함수로 — `await` 로 재료를 모으는 사이 도착한 답을 지우면 안 됩니다.
      patchCut(() => ({
        promptKo: key.promptKo,
        promptEn: key.promptEn,
        videoPromptKo,
        videoPromptEn,
      }));
      toast.success(`컷 ${cut.order} 의 @태그를 다시 이었습니다.`, {
        description: "문장은 그대로 두고 그림 이름만 바꿨습니다.",
      });
    } finally {
      setRelinking(false);
    }
  };
  // 토스트가 나중에 부를 때도 «지금» 것이 되도록. 렌더마다 갈아 끼웁니다.
  relinkRef.current = relinkTags;

  /**
   * 받은 프롬프트를 **칸에 넣고 기록에도 남깁니다.**
   *
   * 「무엇이 체크되었나」 는 컷에서 **연출 토글·기법·구도를 쓰는지**입니다. 그 조건이
   * 적혀 있어야 「아까 판이 더 나았다」 를 되짚을 수 있습니다.
   */
  const keepPrompt = async (
    made: { ko: string; en: string; negativeKo: string; negativeEn: string },
    how: string,
  ) => {
    /*
      **영문에 한국어가 섞였으면 알려 줍니다.**

      

      규칙 조립은 **번역을 못 합니다.** 사람이 한국어로 적은 컷 제목·설명·VFX 가 영문
      칸에도 그대로 들어갑니다. 지워 버리면 영문 프롬프트가 알맹이를 잃으므로 **버리지
      않고 알려만 줍니다** — 그대로 보낼지 «프롬프트 받기» 로 다시 지을지는 사람이 정합니다.
    */
    // 잇기 **전에** 봅니다 — 태그와 꼬리 줄의 한글 이름(«참고 그림: 서진우 @…»)은 일부러 둔 것입니다.
    const mixed = koreanInEnglish(made.en);
    if (mixed)
      toast.warning("영문 프롬프트에 한국어가 섞였습니다.", {
        description: `${mixed.chunks.join(" · ")} — ${mixed.hint}`,
        duration: 10000,
      });
    /*
      새 글에도 @태그를 **바로** 잇습니다. 여태는 맨 글을 넣고 끝이라, 「@ 다시 잇기」 로
      이어 둔 태그가 새로 받을 때마다 풀렸습니다(2026-09-21 실측). 재료를 못 모아도(캡처
      저장 실패 등) 받은 글은 잃지 않습니다 — 수십 초 기다린 답이라 맨 글이라도 넣습니다.
    */
    const input = await gatherLinkInput().catch(() => undefined);
    const ko = input ? relinkPromptText(made.ko, input, "ko") : made.ko;
    const en = input ? relinkPromptText(made.en, input, "en") : made.en;
    // 무슨 조건으로 뽑았는지 — 이력에 적는 한 줄(`cutPromptNote`, 일괄 생성과 같은 글).
    const note = cutPromptNote({
      how,
      useComposition,
      hasComposition: summary.hasComposition,
      tags,
      techniques: cut.techniques || [],
      peopleCount: cutCharacters.length,
    });
    // 값이 아니라 함수로 — 재료를 모으는 사이 도착한 다른 답을 지우면 안 됩니다.
    // 기록에는 칸에 들어간 그대로(태그 이어진 글) — 되돌릴 때 태그까지 같이 돌아와야 합니다(`withCutPromptResult`).
    patchCut((current) => withCutPromptResult(current, made, { ko, en }, how, note));
  };

  const applyRulePrompt = async () => {
    const result = buildFacts();
    const extra = tags.map(cutToggleLabel);
    /*
      **켜 둔 토글을 영문 쪽에도 싣습니다.**

      안 되고
      있었습니다. 규칙 조립이 한국어에만 라벨을 붙이고 영문은 그대로 두었습니다. 밖의
      생성기 대부분이 영어를 훨씬 잘 알아듣는데 켜 둔 토글이 한 글자도 안 갔습니다.
      한국어 라벨을 번역해 보내지는 않습니다 — 촬영 용어로 따로 적어 둔 것을 씁니다.
    */
    const extraEn = cutTogglesEnglish(tags);
    /*
      ── 알아서 켜 주는 실사 기본값 ────────────────────────────────────────
      

      질감 칸 열두 개를 만들어 놓아도 **아는 사람만 켭니다.** 그래서 작품 스타일과 이 컷의
      샷 크기를 보고 **앱이 먼저 켭니다.** 사람이 손으로 정한 것은 건드리지 않습니다.
    */
    const auto = autoRealism({
      styles: context?.facts.styles ?? [],
      hasPeople: cutCharacters.length > 0,
      // 샷 크기는 인물마다 있습니다 — **한 명이라도 얼굴이 크면** 눈·피부를 지시할 자리가 있습니다.
      closeUp: ((result.facts.subjects as { shot?: string }[] | undefined) ?? []).some((item) =>
        isCloseUp(item.shot),
      ),
      manual: tags,
    });
    await keepPrompt(
      {
        ko: [result.ko, extra.join(", "), cut.vfx].filter(Boolean).join(" "),
        // VFX 도 영문에 실립니다 — 여태 한국어 쪽에만 붙어 있었습니다.
        en: [result.en, extraEn, auto.en, cut.vfx].filter(Boolean).join(" "),
        negativeKo: result.negativeKo,
        negativeEn: result.negativeEn,
      },
      "규칙 조립",
    );
    toast.success("구도와 연출에서 컷 프롬프트를 만들었습니다.");
  };

  /* ── 컷을 **영상으로** ────────────────────────────────────────────────
     

     그림 프롬프트와 **칸을 따로 둡니다**. 한 칸에 섞으면 그림을 뽑을 때 「0~2초에
     고개를 든다」 같은 시간 이야기가 끼어들어 자세가 흐려집니다. */
  const [sendingVideo, setSendingVideo] = useState(false);
  const [magnificVideoResolution, setMagnificVideoResolution] = useState<MagnificVideoResolution>("1080p");
  // 인물 id → 이름, 이름 → 연기 기준은 영상 뼈대 재료(`cutVideoSkeletonInput`) 안에서 짓습니다 — 일괄 생성과 같은 규칙.
  const videoSeconds = cutVideoSecondsOf(cut);
  const heroImage = heroImageOf(cut);
  /*
    ── 「여기만 움직인다」 흑백 마스크 ──────────────────────────────────
    자르기 창의 «움직임 구역» 으로 그려 두면 이 컷의 그림 선반에 «원본_움직임_NNN» 으로
    앉습니다. 그린 뒤에 **자동으로** 물립니다 — 어디선가 한 번 더 고르게 하면 그려 놓고
    안 걸린 채 뽑는 일이 생깁니다(실제로 화면은 그리는데 워커가 못 받던 적이 있습니다).

    레퍼런스 목록(`localVideoRefs`)에는 **넣지 않습니다.** 마스크는 모델에게 보여 줄
    그림이 아니라 뽑은 뒤 섞는 판입니다 — 레퍼런스로 넣으면 새까만 그림을 흉내 냅니다.
  */
  const motionMask = useMemo(() => findMotionMask(cut.images), [cut.images]);

  /**
   * 로컬 영상에 물릴 **레퍼런스** — 순서가 곧 뜻입니다.
   *
   * 미니맥스 H3 의 `ref2va` 가 정확히 그 일을 합니다.
   *
   * 순서: **구도잡기 영상(움직임) → 대표 그림(이 컷의 그림) → 인물 시트(정체성) → 배경(장소).**
   * 모델이 프롬프트에 「<Video 1>」 처럼 이름을 붙이고 공유 시계에 올려 두어서, 같은 것을
   * 다른 순서로 주면 다른 요청이 됩니다. 움직임이 가장 세야 하니 영상이 맨 앞입니다.
   *
   * 한도는 그림 9·영상 3, 모두 합쳐 12개입니다. 인물이 많은 컷에서 넘치지 않게 자릅니다.
   */
  const localVideoRefs = useMemo(() => {
    const out: { kind: "image" | "video" | "audio"; path: string }[] = [];
    if (useRefVideo && cut.refVideoPath) out.push({ kind: "video", path: cut.refVideoPath });
    if (heroImage?.filePath) out.push({ kind: "image", path: heroImage.filePath });
    for (const person of cutCharacters) {
      const images = person.generatedImages || [];
      const sheet =
        images.find((item) => item.isCompositeSheet) ??
        images.find((item) => item.isPrimary) ??
        images[0];
      if (sheet?.filePath) out.push({ kind: "image", path: sheet.filePath });
    }
    const plate =
      cut.plateImagePath ??
      (background?.generatedImages || []).find((item) => item.isPrimary)
        ?.filePath ??
      (background?.generatedImages || [])[0]?.filePath;
    if (plate) out.push({ kind: "image", path: plate });
    const images = out.filter((item) => item.kind === "image").slice(0, 9);
    const videos = out.filter((item) => item.kind === "video").slice(0, 3);
    // 걸러 낸 뒤에도 **원래 순서**를 지켜야 합니다 — 순서가 요청의 일부입니다.
    const kept = new Set([...images, ...videos]);
    return out.filter((item) => kept.has(item)).slice(0, 12);
  }, [
    useRefVideo,
    cut.refVideoPath,
    cut.plateImagePath,
    heroImage?.filePath,
    cutCharacters,
    background,
  ]);

  /**
   * 규칙이 짓는 **영상 뼈대** — 「영상 프롬프트」 단추가 그대로 넣고, 「프롬프트 작성」 은 이 위에 LLM 이 살을 붙입니다.
   * 재료는 `cutVideoSkeletonInput`(일괄 생성과 같은 것) — 구도를 끄면 카메라·자리도 글에서 빠지고, 켠 연출 토글과
   * 자동 실사 기본값(영상은 컷 그림보다 더 자주 플라스틱 얼굴이 나옵니다)이 실립니다.
   */
  const videoSkeleton = () => {
    const skeletonInput = cutVideoSkeletonInput({
      cut,
      characters,
      cutCharacters,
      background,
      context,
      useComposition,
      useRefVideo,
      // 화면비와 «바꾸지 마세요» 에 박을 이름 — 둘 다 없으면 생성기가 제멋대로 정합니다.
      aspect: videoAspect || projectAspect,
      videoModel,
    });
    return { skeletonInput, skeleton: buildCutVideoPrompt(skeletonInput) };
  };

  /**
   * 영상 두 칸에 넣습니다 — 규칙 뼈대든 LLM 답이든 **이 길 하나**로.
   *
   * 새 글에도 @태그를 **바로** 잇습니다 — 「@ 다시 잇기」 와 같은 재료(`gatherLinkInput`).
   * 여태는 맨 글로 덮어써서, 이어 둔 태그가 「영상 프롬프트」 를 누를 때마다 풀렸습니다(2026-09-21 실측).
   * 재료를 못 모아도 지은 글은 넣습니다. 값이 아니라 함수로 — 기다리는 사이 도착한 답을 지우면 안 됩니다.
   */
  const keepVideoPrompt = async (made: { ko: string; en: string }) => {
    const input = await gatherLinkInput().then(link => cutVideoLinkInput(cut, link)).catch(() => undefined);
    patchCut(() => ({
      videoPromptKo: input ? relinkPromptText(made.ko, input, "ko") : made.ko,
      videoPromptEn: input ? relinkPromptText(made.en, input, "en") : made.en,
    }));
  };

  const applyVideoPrompt = async () => {
    const { skeleton } = videoSkeleton();
    await keepVideoPrompt(skeleton);
    toast.success(`컷 ${cut.order} 영상 프롬프트를 만들었습니다.`, {
      description: `러닝타임 ${skeleton.seconds.toFixed(1)}초 · ${
        useRefVideo ? "구도잡기 레퍼런스 영상과 함께 보냅니다" : "레퍼런스 영상 없이 글로만 설명합니다"
      }`,
    });
  };

  /*
    ── 영상 프롬프트를 **LLM 으로** ──────────────────────────────────────
     영상 칸에는 여태 규칙 조립(「영상 프롬프트」)뿐이었습니다 — 규칙은
    «누가 어디 서고 카메라가 어떻게 가는가» 는 알아도 상황·표정·공기는 지어낼 수 없습니다.
    그림 칸의 「프롬프트 작성」 과 같은 자리·같은 모양으로 둡니다(규칙 1). 뼈대는 규칙이, 살은 LLM 이.
  */
  const [videoBusy, setVideoBusy] = useState(false);
  const runVideoPrompt = async () => {
    if (videoBusy) return;
    if ([cut.videoPromptKo, cut.videoPromptEn].some((text) => text?.trim())) {
      const ok = await confirmDialog({
        title: "지금 영상 프롬프트를 새로 받을까요?",
        description: "두 칸이 새 값으로 바뀝니다.",
        confirmLabel: "새로 받기",
      });
      if (!ok) return;
    }
    setVideoBusy(true);
    try {
      const { skeleton, skeletonInput } = videoSkeleton();
      const result = await requestPromptFromLlm({
        label: `컷 ${cut.order} · 영상 프롬프트 작성`,
        deliveredTo: `컷 ${cut.order} · 영상 프롬프트 두 칸에 넣음`,
        task: "cutVideoPrompt",
        template: "cut-video-prompt",
        // 고른 영상 모델의 가이드가 요청에 붙습니다 — 그 모델의 대사 문법·금지 자리로 쓰이게.
        modelId: skeletonInput.modelId,
        platformId: getTargetPlatform(),
        techniques: cut.techniques || [],
        data: cutVideoRequestPayload({
          skeleton,
          skeletonInput,
          projectFacts: context?.facts ?? null,
          sceneSummary,
          cut,
          cutCharacters,
          background,
          summary,
          useComposition,
        }),
      });
      await keepVideoPrompt(result);
      toast.success(`컷 ${cut.order} 영상 프롬프트를 받았습니다.`, {
        description: `러닝타임 ${skeleton.seconds.toFixed(1)}초 · 규칙 뼈대 위에 상황·환경·동작을 채웠습니다`,
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setVideoBusy(false);
    }
  };

  /**
   * 영상 생성기로 보냅니다 — 그림 «구성» 재료에 컷의 대표 그림과 레퍼런스 영상을 더합니다.
   *
   * 러닝타임은 사람이 적지 않습니다. 구도잡기 타임라인이 정한 길이를 그대로 넣습니다
   * (그러지 않으면 구도는 4초인데 생성기는 5초인 어긋남이 반드시 생깁니다).
   */
  const sendCutVideoToMagnific = async (prompt: string, lang: "ko" | "en") => {
    if (sendingVideo) return;
    if (!prompt.trim()) {
      toast.error("보낼 영상 프롬프트가 없습니다.", {
        description: "「영상 프롬프트」 를 먼저 눌러 주세요.",
      });
      return;
    }
    setSendingVideo(true);
    try {
      const { guidePath, backgroundPath, guideTag, references, swaps, props, tagOf } = await gatherCutRefs();
      /*
        레퍼런스 **영상이 맨 앞**입니다. 생성기는 앞쪽 레퍼런스를 더 무겁게 읽는데,
        영상이 카메라 움직임과 타이밍을 통째로 들고 있어 가장 강해야 합니다.
        영상이 없으면 구도 그림이 그 자리를 대신합니다(움직임은 글로만 갑니다).
      */
      const paths = magnificCutVideoReferences(cut, references, useRefVideo);
      const ko = lang === "ko";
      const lines: string[] = [];
      if (useRefVideo && cut.refVideoPath)
        lines.push(
          ko
            ? `${tagOf(cut.refVideoPath)} 는 이 컷의 카메라 움직임과 타이밍을 그대로 담은 레퍼런스 영상입니다(${formatVideoSeconds(videoSeconds)}초). 그 움직임·길이·프레이밍을 그대로 따르세요.`
            : `${tagOf(cut.refVideoPath)} is the reference video holding this shot's exact camera motion and timing (${formatVideoSeconds(videoSeconds)}s). Follow its movement, length and framing exactly.`,
        );
      else if (guideTag)
        lines.push(
          ko
            ? `${guideTag} 는 이 컷의 3D 배치도입니다. 카메라 각도·화각·인물이 선 자리를 그대로 맞추세요.`
            : `${guideTag} is a 3D block-out of this shot. Match its camera angle, lens and figure placement exactly.`,
        );
      const heroPath = heroImageOf(cut)?.filePath;
      if (heroPath)
        lines.push(
          ko
            ? `${tagOf(heroPath)} 는 이 컷의 대표 그림입니다. 여기에 보이는 인물 구성·외형·의상을 기준으로 유지하세요.${useRefVideo && cut.refVideoPath ? " 움직임과 카메라 타이밍은 레퍼런스 영상을 따르세요." : ""}`
            : `${tagOf(heroPath)} is this shot's representative image. Preserve its cast, appearance and clothing.${useRefVideo && cut.refVideoPath ? " Use the reference video for motion and camera timing." : ""}`,
        );
      if (swaps.some((person) => person.sheetPath))
        lines.push(
          ko
            ? "본문에서 @태그로 부르는 인물은 그 시트만 보고 그리세요 — 얼굴·머리·체형·의상은 시트 그대로입니다. 회색 마네킹·민무늬 덩어리는 결과에 하나도 남으면 안 됩니다."
            : "Every person tagged @ below must be drawn from that sheet alone - face, hair, body and clothing exactly as the sheet. No grey mannequin or plain block may survive in the result.",
        );
      // 소품 시트도 영상에 같이 올라갑니다(`gatherCutRefs`) — 그림 «구성» 과 같은 규칙, 같은 줄.
      for (const prop of props.filter((item) => item.tag))
        lines.push(
          ko
            ? `${prop.tag} 은 이 컷의 소품 «${prop.label}» 입니다(배치도의 ${prop.color.ko} 덩어리 자리). 모양·재질·색을 그 시트 그대로 그리세요.`
            : `${prop.tag} is the prop "${prop.label}" of this shot (the ${prop.color.en} block in the layout). Draw it exactly as that sheet - shape, material, colour.`,
        );
      // 새 대표 그림이 생기면 옛 «아직 없음» 꼬리도 갱신합니다. 사용자 본문은 유지합니다.
      const body = relinkPromptText(prompt.trim(), cutVideoLinkInput(cut, cutLinkInput({
        cut, characters, background, summary, useComposition, guidePath, backgroundPath,
      })), lang);
      await composeInMagnific({
        kind: "video",
        // 앞에서 고른 영상 모델. 슬러그를 아는 것만 넘어갑니다(까닭은 그림 «구성» 주석).
        model: targetModelOf(videoModel)?.magnific,
        requestedVideoModel: videoModel,
        seconds: videoSeconds,
        videoResolution: magnificVideoResolution,
        prompt: [lines.join("\n"), body].filter(Boolean).join("\n\n"),
        referencePaths: paths,
        owner: { kind: "cut", name: `컷 ${cut.order}`, cutId: cut.id },
        onStatus: (message) => toast.loading(message, { id: `video:${cut.id}` }),
      });
      toast.success(`컷 ${cut.order} 을 영상 생성기로 올렸습니다.`, {
        id: `video:${cut.id}`,
        description: `러닝타임 ${formatVideoSeconds(videoSeconds)}초 · 레퍼런스 ${paths.length}개`,
      });
    } catch (error) {
      toast.error(String(error), { id: `video:${cut.id}` });
    } finally {
      setSendingVideo(false);
    }
  };

  /*
    **지금 값을 받아 다음 값을 만듭니다.**

    여태 렌더 시점의 `tags` 로 새 목록을 지었습니다. 칩을 빠르게 연달아 누르거나, 누르는
    사이에 다른 경로가 토글을 바꾸면 **앞의 것이 되살아납니다.** 규칙은 하나입니다 —
    `patch` 는 늘 «지금 값을 받아 다음 값을 만드는 함수».
  */
  const toggleTag = (id: string) =>
    patchCut((current) => {
      const now = current.styleTags || [];
      return {
        styleTags: now.includes(id) ? now.filter((item) => item !== id) : [...now, id],
      };
    });

  /**
   * 탭마다 다른 그림을 보여 줍니다. 이 컷이 무엇을 물고 있는지 한눈에.
   *
   * 예전에는 원본 생성 이미지 앞 두 장뿐이었습니다. 원본 전부 + 변형 + 시트 + 보유 에셋 + 공용 에셋을
   * `entityImages.ts` 하나로 모읍니다 — 배경 탭도 같은 함수라 한쪽만 빠지는 일이 없습니다(규칙 1).
   *
   * 아직 «고르는» 것은 아닙니다. 컷에는 고른 그림을 적는 칸이 없어(로드맵 09 F0·F11)
   * 이 줄은 «무엇이 있는지» 보여 주는 자리입니다.
   */
  const tabImages = useMemo<PickerImage[]>(() => {
    if (tab === "reference") {
      return dedupePickerImages(
        cut.images.map((image) => ({
          id: image.filePath || image.id,
          name: image.name,
          thumb: image.thumb,
          filePath: image.filePath,
          group: "root",
          badge: "",
          ownerName: `컷 ${cut.order}`,
        })),
      );
    }
    const own =
      tab === "character"
        ? cutCharacters.flatMap((item) => collectEntityPickerImages(item))
        : background
          ? collectEntityPickerImages(background)
          : [];
    // 공용 에셋은 인물·장소 어느 탭에서든 뜹니다 — 공용이라는 뜻이 그것이니까요.
    return dedupePickerImages([
      ...own,
      ...collectSharedPickerImages(sharedAssets),
    ]);
  }, [tab, cutCharacters, background, sharedAssets, cut.images, cut.order]);
  /** 인물이 둘이면 누구 것인지 묶어 보여 줍니다. 묶음이 하나뿐이면 머리줄을 안 그립니다. */
  const imageGroups = useMemo(() => {
    const map = new Map<string, PickerImage[]>();
    for (const image of tabImages) {
      const list = map.get(image.ownerName) || [];
      list.push(image);
      map.set(image.ownerName, list);
    }
    return [...map.entries()];
  }, [tabImages]);
  /**
   * ── 인물마다 «이 그림을 레퍼런스로» ────────────────────────────────
   *
   * 묶음 머리줄이 곧 인물 이름이라 이름으로 인물을 찾습니다(`collectEntityPickerImages` 의 `ownerName`). 변형·시트·보유 에셋도
   * 그 인물 이름으로 묶여 들어와, 한 인물의 어떤 그림이든 고를 수 있습니다. 공용 에셋 묶음은 인물이 없어 고르기가 안 뜹니다.
   */
  const characterIdOfOwner = (ownerName: string) =>
    cutCharacters.find((item) => (item.name?.trim() || "이름 없음") === ownerName)?.id;
  const pickedRefsOf = (characterId: string) => cut.characterRefs?.[characterId] || [];
  const toggleCharacterRef = (characterId: string, filePath: string) =>
    patchCut((current) => {
      const now = current.characterRefs?.[characterId] || [];
      // 고른 순서가 곧 올라가는 순서입니다 — 생성기는 앞쪽 레퍼런스를 더 무겁게 읽습니다.
      const next = now.includes(filePath)
        ? now.filter((item) => item !== filePath)
        : [...now, filePath];
      /*
        빈 칸([])을 **지우지 않고 남깁니다.** 예전에는 마지막 그림을 빼면 칸을 지워 «안 골랐다» 로 돌아갔고, 그러면
        자동 시트로 물러서서 태그가 그대로였습니다 — 「풀리지도
        않고」. 이제 [] 는 「이 컷에서는 그림을 안 쓴다」 입니다(`pickedCharacterRefs`). 자동 시트로 되돌리고 싶으면
        그 그림을 다시 고르면 됩니다.
      */
      const all = { ...(current.characterRefs || {}), [characterId]: next };
      /*
        ── 고르고 나서 «아무 일도 안 일어나는» 것을 막습니다 ────────────────
        

        레퍼런스를 고르는 것과 프롬프트에 @태그가 박히는 것은 **다른 일**입니다
        (프롬프트를 통째로 다시 받지 않으려고 일부러 나눠 둔 것 — ). 그런데 화면에는 그 사실이 안 보여서,
        고른 사람은 끝난 줄 압니다.

        그래서 **여기서 바로 권합니다.** 자동으로 고쳐 버리지는 않습니다 — 손으로
        고쳐 둔 문장이 있는 칸을 묻지도 않고 건드리면 안 되니까요.
      */
      if ((current.promptKo || current.promptEn || "").trim())
        toast("레퍼런스를 바꿨습니다 — 프롬프트에도 이을까요?", {
          description: "문장은 그대로 두고 @그림 이름만 갈아 끼웁니다.",
          action: { label: "@ 다시 잇기", onClick: () => void relinkRef.current() },
        });
      return { characterRefs: all };
    });

  /** 이 탭에 고른 인물·장소가 있는데 그림이 하나도 없을 때만 안내합니다. */
  const pickedButEmpty =
    tabImages.length === 0 &&
    (tab === "character"
      ? cutCharacters.length > 0
      : tab === "background" && !!background);

  return (
    <div
      className="rounded-lg"
      style={{
        background: "oklch(0.12 0.008 265)",
        border: "1px solid oklch(1 0 0 / 8%)",
      }}
    >
      {/* ── 머리줄 ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0"
          aria-label="펼치기"
          // 접힌 컷은 머리줄만 보입니다 — 펴야 아래 자리들이 생깁니다.
          data-tour-switch="cut-frame cut-switches cut-summary cut-refs cut-style-toggles cut-dialogue cut-background-motion cut-prompt-section cut-prompt-write cut-video-section cut-video-prompt cut-ref-video-list"
          data-tour-switch-kind="expand"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown
              className="h-3.5 w-3.5"
              style={{ color: "oklch(0.58 0.01 265)" }}
            />
          ) : (
            <ChevronRight
              className="h-3.5 w-3.5"
              style={{ color: "oklch(0.58 0.01 265)" }}
            />
          )}
        </button>

        <span
          className="flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10px] font-bold tabular-nums"
          style={{
            background: "oklch(0.62 0.22 290 / 20%)",
            color: "oklch(0.86 0.16 290)",
          }}
        >
          {String(cut.order).padStart(2, "0")}
        </span>

        <input
          value={cut.title}
          onChange={(event) => patchCut({ title: event.target.value })}
          placeholder="한 줄 제목"
          className="min-w-[80px] max-w-[180px] rounded bg-transparent px-1 py-0.5 text-[11px] font-semibold outline-none"
          style={{ color: "white" }}
        />

        {/* 고른 연출을 칩으로. 접혀 있어도 이 컷이 어떤 컷인지 읽혀야 합니다. */}
        {tags.map((id) => (
          <span
            key={id}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px]"
            style={{
              background: "oklch(0.62 0.22 290 / 14%)",
              color: "oklch(0.80 0.14 290)",
            }}
          >
            {cutToggleLabel(id)}
          </span>
        ))}

        {/*
          대표 그림 — **스토리보드 칸에 실릴 한 장**입니다.

          접힌 채로도 보여야 씬을 훑으며 「어느 컷이 아직 그림이 없나」 를 셀 수 있습니다.
          별을 옮기면 여기 그림도 바뀝니다(대표는 선반의 별 하나로만 정합니다).
        */}
        {heroImage && (
          <img
            src={assetSrc(heroImage.filePath) || heroImage.thumb}
            alt=""
            title="이 컷의 대표 그림 — 스토리보드 칸에 실립니다"
            className="h-5 w-9 shrink-0 rounded object-cover"
            style={{ border: "1px solid oklch(1 0 0 / 16%)" }}
          />
        )}

        <span className="min-w-0 flex-1" />

        <button
          type="button"
          onClick={openPlanner}
          data-tour="cut-open-planner"
          // 구도잡기 창 안의 자리는 창이 떠야 생깁니다 — 여는 쪽과 닫는 쪽이 같은 목록을 봅니다.
          data-tour-open={HOLDS_PLANNER}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
          style={{
            background: "oklch(0.62 0.22 290 / 14%)",
            border: "1px solid oklch(0.62 0.22 290 / 32%)",
            color: "oklch(0.84 0.16 290)",
          }}
        >
          <Move3d className="h-3 w-3" /> 구도잡기
        </button>
        {/*
          **잡아 둔 구도 그대로 가져오기.** 같은 공간에서 카메라만 바꾸는 컷이 흔한데,
          그때마다 인물 일곱을 다시 세우는 것은 일이 아닙니다. 방·소품·인물 자리를 통째로
          복사하고, 배경은 그다음에 바꾸면 됩니다.
        */}
        {savedShots && savedShots.length > 0 && (
          <button
            type="button"
            onClick={() => setShotsOpen(true)}
            data-tour="cut-import-composition"
            title={`이 프로젝트에서 잡아 둔 구도 ${savedShots.length}개에서 골라 그대로 가져옵니다`}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
            style={{
              background: "oklch(1 0 0 / 6%)",
              border: "1px solid oklch(0.62 0.22 290 / 22%)",
              color: "oklch(0.72 0.12 290)",
            }}
          >
            <Copy className="h-3 w-3" /> 구도 불러오기
          </button>
        )}
        {/*
          ── 특수 배경 ──────────────────────────────────────────────
          

          구도잡기의 방 카드는 전개도·파노라마만 고르게 좁혔습니다. 도면·동선·사람 크기 기준 같은 «읽는 그림» 은 컷을
          설명하려고 뽑는 것이라 여기(컷)에서 만듭니다 — 같은 장소 카드를, 구성 칸을 **전부 펴서** 엽니다.
        */}
        {onCreateBackground && onPatchBackground && (
          <button
            type="button"
            onClick={() => {
              if (specialId) {
                setSpecialOpen(true);
                return;
              }
              /*
                공간 유형을 **실내외**로 둡니다. 칩이 사라진 게 아니라 카드가 «실내» 라 실외 칩(조감도·항공 수직·등각)이
                가려져 있었습니다. 특수 배경은 «읽는 그림» 이라 실내·실외를 가리지 않습니다.
              */
              const made = {
                ...newBackground("mixed"),
                name: `${sceneTitle || "장면"} · 컷 ${cut.order} 특수 배경`,
              };
              onCreateBackground(made);
              setSpecialId(made.id);
              setSpecialOpen(true);
            }}
            data-tour="cut-special-background"
            title="도면 · 도면+동선 · 사람 크기 기준 같은 «읽는 그림» 을 뽑습니다"
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
            style={{
              background: "oklch(0.70 0.15 160 / 12%)",
              border: "1px solid oklch(0.70 0.15 160 / 32%)",
              color: "oklch(0.82 0.15 160)",
            }}
          >
            <Ruler className="h-3 w-3" /> 특수 배경
          </button>
        )}
        {/*
          «이미지 편집»(동선 그리기) 단추는 걷었습니다. 이제 그림의 가위(공용 이미지 편집 창)의 «동선» 탭에서 그립니다.
        */}
        <button
          type="button"
          onClick={onRemove}
          aria-label="컷 지우기"
          className="shrink-0 rounded p-1 hover:bg-white/10"
          style={{ color: "oklch(0.60 0.15 25)" }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <div
          className="space-y-3 border-t px-3 pb-3 pt-3"
          style={{ borderColor: "oklch(1 0 0 / 8%)" }}
        >
          {/* ── 프레임 + 설명 ────────────────────────────────────────── */}
          <div className="flex gap-3">
            {cut.guideImage ? (
              <div className="relative w-[150px] shrink-0" data-tour="cut-frame">
                <img
                  src={cut.guideImage}
                  alt="구도 참고"
                  className="w-full rounded-md"
                  style={{ border: "1px solid oklch(1 0 0 / 10%)" }}
                />
                <button
                  type="button"
                  onClick={() => patchCut({ guideImage: undefined })}
                  aria-label="참고 그림 빼기"
                  className="absolute right-1 top-1 rounded-full p-0.5"
                  style={{ background: "oklch(0 0 0 / 72%)", color: "white" }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                <p
                  className="absolute inset-x-0 bottom-0 truncate px-1 py-0.5 text-[9px]"
                  style={{ background: "oklch(0 0 0 / 70%)", color: "white" }}
                >
                  {sceneTitle} 컷 {cut.order} 프레임
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={openPlanner}
                data-tour="cut-frame"
                className="flex h-[110px] w-[150px] shrink-0 flex-col items-center justify-center gap-1 rounded-md text-[10px]"
                style={{
                  background: "oklch(0.10 0.006 265)",
                  border: "1px dashed oklch(0.62 0.22 290 / 40%)",
                  color: "oklch(0.62 0.14 290)",
                }}
              >
                <Move3d className="h-4 w-4" />
                구도를 잡으면 프레임이 붙습니다
              </button>
            )}

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-1.5">
                <p
                  className="text-[9px] font-bold tracking-widest"
                  style={{ color: "oklch(0.45 0.01 265)" }}
                >
                  SCENE DESCRIPTION
                </p>
                {/* 설명 칸도 같은 단추를 씁니다 — 여기 적은 글이 프롬프트 첫 줄이 됩니다. */}
                <NaturalPromptButton
                  text={cut.description}
                  kind="scene"
                  isVideo={false}
                  seconds={cutVideoSecondsOf(cut)}
                  people={cutCharacters.map((item) => item.name)}
                  context={context}
                  onApply={(ko) => patchCut({ description: ko })}
                />
              </div>
              <AutoTextarea
                value={cut.description}
                onChange={(event) =>
                  patchCut({ description: event.target.value })
                }
                placeholder="무엇이 보이고 무엇이 일어나는지"
                className="w-full rounded-md px-2.5 py-2 text-[11px] outline-none"
                style={fieldStyle}
              />
            </div>
          </div>

          {/*
            ── 이 컷을 어떻게 뽑을까 — 스위치 둘 ───────────────────────
            
            씬마다 «작업 방식» 을 고르던 자리를 이 두 스위치가 대신합니다 — 켜고 끄면 올라가는 레퍼런스와 @태그 문장이 같이 바뀝니다.
          */}
          <div className="flex flex-wrap items-center gap-1.5" data-tour="cut-switches">
            {(
              [
                {
                  id: "composition" as const,
                  label: "구도 쓰기",
                  on: useComposition,
                  can: hasComposition,
                  hint: hasComposition
                    ? "구도 그림·배경 플레이트를 레퍼런스로 올리고, 프롬프트에 «배치도대로» 를 싣습니다. 끄면 인물 시트와 글만으로 뽑습니다."
                    : "아직 구도가 없습니다 — «구도잡기» 에서 저장하면 켜집니다.",
                  color: "oklch(0.76 0.14 200)",
                  toggle: () => patchCut((current) => ({ useComposition: current.useComposition === false })),
                },
                {
                  id: "refVideo" as const,
                  label: "레퍼런스 영상 쓰기",
                  on: useRefVideo,
                  can: Boolean(cut.refVideoPath),
                  hint: cut.refVideoPath
                    ? "구도잡기에서 뽑은 영상을 영상 생성기에 함께 올리고, 카메라 설명을 글에서 뺍니다(두 지시가 겹치면 어긋납니다)."
                    : "아직 레퍼런스 영상이 없습니다 — 구도잡기 타임라인에서 뽑으면 켜집니다.",
                  color: "oklch(0.80 0.16 45)",
                  toggle: () => patchCut((current) => ({ useRefVideo: current.useRefVideo === false })),
                },
              ]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!item.can}
                onClick={item.toggle}
                title={item.hint}
                className="rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                style={{
                  background: item.on ? "oklch(1 0 0 / 8%)" : "transparent",
                  border: `1px solid ${item.on ? item.color : "oklch(1 0 0 / 10%)"}`,
                  color: item.on ? item.color : "oklch(0.52 0.01 265)",
                }}
              >
                {item.on ? "● " : "○ "}
                {item.label}
              </button>
            ))}
            <span className="text-[9px]" style={{ color: "oklch(0.45 0.01 265)" }}>
              {useComposition
                ? "구도 그림 + 인물 시트로 뽑습니다"
                : "인물 시트와 글만으로 뽑습니다 — 키 이미지용"}
            </span>
          </div>

          {/* ── 구도에서 읽은 것. 읽기 전용입니다 ────────────────────── */}
          <div
            data-tour="cut-summary"
            className="rounded-md px-2.5 py-2 text-[10px] leading-relaxed"
            style={{
              background: summary.hasComposition
                ? "oklch(0.55 0.15 200 / 10%)"
                : "oklch(1 0 0 / 3%)",
              border: `1px solid ${summary.hasComposition ? "oklch(0.55 0.15 200 / 28%)" : "oklch(1 0 0 / 6%)"}`,
              color: summary.hasComposition
                ? "oklch(0.78 0.14 200)"
                : "oklch(0.45 0.01 265)",
            }}
          >
            {summary.hasComposition ? (
              <>
                <b>구도에서 읽음</b> · {summary.ko}
              </>
            ) : (
              "구도를 잡으면 샷 크기·앵글·거리·무빙이 여기 자동으로 뜹니다. 토글로 직접 고르지 않습니다 — 두 곳에 두면 어긋나서요."
            )}
          </div>

          {/* ── 인물·장소·레퍼런스 ───────────────────────────────────── */}
          <div data-tour="cut-refs">
            {tabImages.length > 0 && (
              // 변형·시트·에셋까지 펼치면 인물 하나에 수십 장입니다. 높이를 제한해 안에서만
              // 스크롤합니다(후보함과 같은 방식) — 컷 카드가 무한히 길어지면 아래 연출 토글을 못 봅니다.
              <div className="mb-1.5 max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
                {imageGroups.map(([ownerName, images]) => {
                  const ownerId = tab === "character" ? characterIdOfOwner(ownerName) : undefined;
                  const picked = ownerId ? pickedRefsOf(ownerId) : [];
                  /*
                    **안 골랐을 때 실제로 쓰이는 시트**를 찾아 둡니다.

                    
                    안 고르면 앱이 시트 한 장을 알아서 씁니다(`cutSheetPathsForRequest`). 그런데 화면에는 아무
                    표시가 없어 «안 걸렸다» 로 보였습니다. 자동으로 쓰이는 그 한 장을 점선으로 알려 줍니다 —
                    고른 것(실선 주황)과 구별되고, 누르면 그때부터 «사람이 고른 것» 이 됩니다.
                  */
                  const autoOwner = ownerId ? characters.find((item) => item.id === ownerId) : undefined;
                  const autoPath =
                    !picked.length && autoOwner ? cutSheetPathsForRequest(cut, autoOwner)[0] : undefined;
                  return (
                  <div key={ownerName}>
                    {(imageGroups.length > 1 || ownerId) && (
                      <p
                        className="mb-1 flex items-center gap-1.5 text-[9px] font-bold"
                        style={{ color: "oklch(0.55 0.01 265)" }}
                      >
                        {ownerName}
                        {ownerId && (
                          <span style={{ color: picked.length ? "oklch(0.80 0.16 45)" : "oklch(0.42 0.01 265)" }}>
                            {picked.length
                              ? `레퍼런스 ${picked.length}장 — 누르면 빼기`
                              : autoPath
                                ? "점선 한 장이 자동으로 쓰입니다 — 다른 그림을 누르면 그쪽으로 바뀝니다(전부 빼면 이름만)"
                                : "그림을 눌러 이 인물의 레퍼런스를 고릅니다(안 고르면 시트 한 장 · 전부 빼면 이름만)"}
                          </span>
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {/* 6면은 여덟 장으로 늘어놓지 않고 세트 카드 한 장으로. 선반과 같은 카드. */}
                      {(() => {
                        // `6면/` 밖의 이름 인식(legacy)은 장소 탭에서만 — 인물·에셋의 «정면»·«후면» 칸이 세트로 오인되지 않게.
                        const { sets, singles } = splitFaceSets(images, {
                          legacy: tab === "background",
                        });
                        return (
                          <>
                            {sets.map((set) => (
                              <FaceSetCard
                                key={set.id}
                                set={set}
                                width={110}
                                cellHeight={30}
                                onClick={() =>
                                  setViewingSet(
                                    faceSetImages(set).map((image) => ({
                                      // 넘겨 볼 때 면이 앞에 보이게 «정면 · 장소 #1» — 실내면 위 면이 «천장».
                                      name: faceDisplayName(
                                        image,
                                        background?.spaceKind,
                                      ),
                                      thumb:
                                        assetSrc(image.filePath) || image.thumb,
                                      filePath: image.filePath,
                                    })),
                                  )
                                }
                                caption={
                                  <span
                                    style={{ color: "oklch(0.52 0.01 265)" }}
                                  >
                                    {set.label}
                                  </span>
                                }
                              />
                            ))}
                            {singles.map((image) => {
                              const at = ownerId && image.filePath ? picked.indexOf(image.filePath) : -1;
                              const auto = at < 0 && Boolean(autoPath) && image.filePath === autoPath;
                              return (
                              <div
                                key={image.id}
                                className="relative w-[72px]"
                                title={
                                  ownerId && image.filePath
                                    ? at >= 0
                                      ? `${image.name} — 레퍼런스 ${at + 1}번. 누르면 뺍니다`
                                      : auto
                                        ? `${image.name} — 따로 고르지 않아 이 한 장이 자동으로 쓰입니다. 누르면 «고른 것» 이 됩니다`
                                        : `${image.name} — 누르면 이 인물의 레퍼런스로 올립니다(여러 장 가능)`
                                    : image.name
                                }
                              >
                                <div
                                  onClick={() => {
                                    if (ownerId && image.filePath) toggleCharacterRef(ownerId, image.filePath);
                                  }}
                                  className="aspect-square w-full overflow-hidden rounded-md"
                                  style={{
                                    background: "oklch(0.10 0.006 265)",
                                    cursor: ownerId && image.filePath ? "pointer" : undefined,
                                    // 고른 그림은 주황 테두리. 6000px 합성 시트는 72px 로는 알아볼 수 없어 흰 테두리로 «시트» 임을 알립니다.
                                    border: `1px ${auto ? "dashed" : "solid"} ${
                                      at >= 0
                                        ? "oklch(0.80 0.16 45)"
                                        : auto
                                          ? "oklch(0.80 0.16 45 / 70%)"
                                          : image.group === "sheet"
                                            ? "oklch(1 0 0 / 55%)"
                                            : "transparent"
                                    }`,
                                    outline: at >= 0 ? "1px solid oklch(0.80 0.16 45 / 60%)" : undefined,
                                  }}
                                >
                                  <img
                                    src={
                                      assetSrc(image.filePath) ||
                                      image.thumb ||
                                      ""
                                    }
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                {/* 어디서 온 그림인지 — 변형은 보라, 시트는 흰색, 보유 에셋은 초록, 공용 에셋은 주황. */}
                                {image.badge && (
                                  <span
                                    className="absolute left-0.5 top-0.5 max-w-[68px] truncate rounded px-1 text-[8px] font-bold"
                                    style={{
                                      background: "oklch(0 0 0 / 72%)",
                                      color: PICKER_BADGE_COLOR[image.group],
                                    }}
                                  >
                                    {image.badge}
                                  </span>
                                )}
                                {at >= 0 && (
                                  <span
                                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                                    style={{ background: "oklch(0.80 0.16 45)", color: "oklch(0.18 0.02 45)" }}
                                  >
                                    {at + 1}
                                  </span>
                                )}
                                <p
                                  className="truncate text-[9px]"
                                  style={{ color: "oklch(0.52 0.01 265)" }}
                                >
                                  {image.name}
                                </p>
                              </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
            {viewingSet && (
              <ImageLightbox
                images={viewingSet}
                onClose={() => setViewingSet(null)}
              />
            )}
            {pickedButEmpty && (
              <p
                className="mb-1.5 text-[10px]"
                style={{ color: "oklch(0.45 0.01 265)" }}
              >
                {tab === "character" ? "고른 인물" : "고른 장소"}의 그림이 아직
                없습니다 — 2단계에서 시트를 만들거나 후보함에서 채택하세요
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  {
                    id: "character",
                    label: "캐릭터",
                    color: "oklch(0.78 0.16 290)",
                  },
                  {
                    id: "background",
                    label: "배경",
                    color: "oklch(0.76 0.14 200)",
                  },
                  {
                    id: "reference",
                    label: "레퍼런스",
                    color: "oklch(0.78 0.16 45)",
                  },
                ] as const
              ).map((item) => {
                const on = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className="rounded-md px-2 py-1 text-[10px] font-semibold"
                    style={{
                      background: on ? "oklch(1 0 0 / 8%)" : "transparent",
                      border: `1px solid ${on ? item.color : "oklch(1 0 0 / 8%)"}`,
                      color: on ? item.color : "oklch(0.55 0.01 265)",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {tab === "character" && (
              <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                {characters.length === 0 && (
                  <span
                    className="text-[10px]"
                    style={{ color: "oklch(0.42 0.01 265)" }}
                  >
                    2단계에서 인물을 먼저 만드세요
                  </span>
                )}
                {characterTiles.map(({ entity, thumb }) => {
                  const on = cut.characterIds.includes(entity.id);
                  return (
                    <PickTile
                      key={entity.id}
                      label={entity.name || "이름 없음"}
                      thumb={
                        thumb
                          ? assetSrc(thumb.filePath) || thumb.thumb
                          : undefined
                      }
                      selected={on}
                      accent={PICK_ACCENT.character}
                      onClick={() =>
                        // 값이 아니라 갱신 함수로 — 프롬프트를 기다리는 동안 눌러도 답이 지워지지 않게.
                        patchCut((current) => ({
                          characterIds: current.characterIds.includes(entity.id)
                            ? current.characterIds.filter(
                                (id) => id !== entity.id,
                              )
                            : [...current.characterIds, entity.id],
                        }))
                      }
                    />
                  );
                })}
              </div>
            )}

            {tab === "background" && (
              <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                {backgrounds.length === 0 && (
                  <span
                    className="text-[10px]"
                    style={{ color: "oklch(0.42 0.01 265)" }}
                  >
                    등록된 배경이 없습니다 — 2단계에서 먼저 만드세요
                  </span>
                )}
                {backgroundTiles.map(({ entity, set, thumb }) => {
                  const on = cut.backgroundId === entity.id;
                  // 한 번 더 누르면 «고르지 않음». 드롭다운의 그 칸을 대신합니다.
                  const pick = () =>
                    patchCut((current) => ({
                      backgroundId:
                        current.backgroundId === entity.id ? "" : entity.id,
                    }));
                  // 6면 세트가 있는 배경은 세트 카드로 — «이건 6면짜리» 가 한눈에 보입니다.
                  return set ? (
                    <FaceSetCard
                      key={entity.id}
                      set={set}
                      width={110}
                      cellHeight={30}
                      spaceKind={entity.spaceKind}
                      selected={on}
                      onClick={pick}
                      title={`${entity.name || "이름 없음"} — 6면 세트`}
                      caption={
                        <span
                          style={{
                            color: on
                              ? PICK_ACCENT.background
                              : "oklch(0.52 0.01 265)",
                          }}
                        >
                          {entity.name || "이름 없음"}
                        </span>
                      }
                    />
                  ) : (
                    <PickTile
                      key={entity.id}
                      label={entity.name || "이름 없음"}
                      thumb={
                        thumb
                          ? assetSrc(thumb.filePath) || thumb.thumb
                          : undefined
                      }
                      selected={on}
                      accent={PICK_ACCENT.background}
                      onClick={pick}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 연출 토글 ────────────────────────────────────────────── */}
          <CutStyleToggles
            tags={tags}
            openGroups={openGroups}
            setOpenGroups={setOpenGroups}
            toggleTag={toggleTag}
            autoLook={autoLook}
          />

          {/*
            ── 대사 · 연기 지시 ─────────────────────────────────────────
             구도잡기는 «어디서 어떻게 움직이는가» 만 압니다 — 무슨 말을 하고 어떤 표정인지는 사람이 적습니다.
          */}
            <div data-tour="cut-dialogue">
              <div className="mb-1 flex items-center gap-1.5">
                <p className="text-[11px] font-semibold" style={{ color: "oklch(0.82 0.16 320)" }}>
                  대사 · 연기 지시
                </p>
                {/*
                  평소 말투로 적어도 됩니다 — 이 단추가 프롬프트 말로 바꿔 줍니다.
                  「슬프게 말해」 → 「시선이 내려가고 입술이 다물린다」. 규칙 1: 같은 단추를
                  VFX 칸도 씁니다.
                */}
                <NaturalPromptButton
                  text={cut.acting || ""}
                  kind="acting"
                  isVideo
                  seconds={cutVideoSecondsOf(cut)}
                  shot={(buildFacts().facts.subjects as { shot?: string }[] | undefined)?.[0]?.shot}
                  people={cutCharacters.map((item) => item.name)}
                  context={context}
                  onApply={(ko, en) => patchCut({ acting: ko, actingEn: en || undefined })}
                />
              </div>
              <AutoTextarea
                value={cut.acting || ""}
                onChange={(event) => patchCut({ acting: event.target.value })}
                placeholder={'예) 수화: "그만해." — 낮게, 눈은 피하지 않고. 상대는 반 박자 늦게 고개를 든다'}
                className="w-full rounded-md px-2.5 py-2 text-[11px] outline-none"
                style={fieldStyle}
              />
            </div>

          {/*
            ── 배경 움직임 ─────────────────────────────────────────────
            구도잡기가 뽑는 레퍼런스 영상은 배경이 **정지 그림**입니다(면 텍스처·돔 파노라마).
            영상 모델은 프레임 내내 안 변하는 구역을 「여기는 원래 안 움직인다」 로 읽어, 달리는
            차 안 컷인데 창밖이 통째로 얼어붙습니다. 그림으로는 전할 길이 없어 글로 못 박습니다.

            VFX 칸과 나란히 두되 **위**입니다 — 프롬프트에 실리는 순서도 «환경 → 효과» 입니다
            (`lib/cutVideoPrompt.ts`). 두 칸의 뜻이 다른 까닭은 `projectTypes.Cut` 주석에.
          */}
          <div data-tour="cut-background-motion">
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-[11px] font-semibold" style={{ color: "oklch(0.80 0.13 200)" }}>
                {t("배경 움직임")}
              </p>
              {/*
                규칙 1 — 대사·VFX 칸과 **같은 단추**입니다. 다만 갈래는 `background` 로 따로 줍니다:
                효과 갈래로 다듬으면 규모·난류 같은 폭발 낱말이 붙어 배경이 출렁입니다.
              */}
              <NaturalPromptButton
                text={cut.backgroundMotion || ""}
                kind="background"
                isVideo
                seconds={cutVideoSecondsOf(cut)}
                people={cutCharacters.map((item) => item.name)}
                context={context}
                onApply={(ko, en) =>
                  patchCut(() => ({ backgroundMotion: ko, backgroundMotionEn: en || undefined }))
                }
              />
            </div>
            <AutoTextarea
              value={cut.backgroundMotion || ""}
              onChange={(event) => patchCut(() => ({ backgroundMotion: event.target.value }))}
              /*
                구도에 실외 방이나 «창» 소품이 있을 때만 그 컷에 맞는 보기로 바뀝니다. 값을 지어
                넣지는 않습니다 — 없는 움직임을 적어 두면 생성기가 그것을 그립니다.
              */
              placeholder={t(
                backgroundMotionHint(cut.composition) ??
                  "예) 멀리 구름이 천천히 흐른다 — 배경이 스스로 하는 움직임만. 폭발·연기는 VFX 칸입니다",
              )}
              className="w-full rounded-md px-2.5 py-2 text-[11px] outline-none"
              style={fieldStyle}
            />
          </div>

          {/* ── VFX ──────────────────────────────────────────────────── */}
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-[11px] font-semibold" style={{ color: "oklch(0.82 0.14 45)" }}>
                VFX
              </p>
              <NaturalPromptButton
                text={cut.vfx || ""}
                kind="vfx"
                isVideo
                seconds={cutVideoSecondsOf(cut)}
                people={cutCharacters.map((item) => item.name)}
                context={context}
                onApply={(ko, en) => patchCut({ vfx: ko, vfxEn: en || undefined })}
              />
            </div>
            <AutoTextarea
              value={cut.vfx || ""}
              onChange={(event) => patchCut({ vfx: event.target.value })}
              placeholder={'예) 굵은 비가 비스듬히 쏟아지고, 창에 물줄기가 흘러내린다 — 「비를 추가해」 처럼 시키는 말투는 쓰지 마세요'}
              className="w-full rounded-md px-2.5 py-2 text-[11px] outline-none"
              style={fieldStyle}
            />
          </div>

          <CutPromptSection
            cut={cut}
            patchCut={patchCut}
            apiReady={apiReady}
            cutBusy={cutBusy}
            runCutPrompt={runCutPrompt}
            cutRequestData={cutRequestData}
            modelId={targetModelOf(imageModel)?.id}
            applyRulePrompt={applyRulePrompt}
            relinkTags={relinkTags}
            relinking={relinking}
            sendCompositionToMagnific={sendCompositionToMagnific}
            projectName={projectName}
            sceneTitle={sceneTitle}
            index={index}
          />

          {/*
            ── 컷을 영상으로 ───────────────────────────────────────────
             그림 프롬프트와 칸을 나눈 까닭은 `lib/cutVideoPrompt.ts` 에
            적어 두었습니다 — 한 칸에 섞으면 그림 쪽 자세가 흐려집니다.
          */}
          <CutVideoSection
            cut={cut}
            videoModel={videoModel}
            magnificVideoResolution={magnificVideoResolution}
            onMagnificVideoResolutionChange={setMagnificVideoResolution}
            magnificBusy={sendingVideo}
            patchCut={patchCut}
            applyVideoPrompt={applyVideoPrompt}
            runVideoPrompt={runVideoPrompt}
            videoBusy={videoBusy}
            apiReady={apiReady}
            videoSeconds={videoSeconds}
            heroImage={heroImage}
            motionMask={motionMask}
            localVideoRefs={localVideoRefs}
            renders={renders}
            projectName={projectName}
            sceneTitle={sceneTitle}
            index={index}
            sendCutVideoToMagnific={sendCutVideoToMagnific}
          />

          <GeneratedImageShelf
            images={cut.images}
            onChange={(update) =>
              patchCut((cut) => ({ images: update(cut.images) }))
            }
            assetLabel={`컷 ${cut.order}`}
            ownerName={sceneFolderName(sceneTitle, index)}
            assetType="scene-cut"
          />

          {/* 컷 영상. 밖에서 뽑아 온 mp4 를 여기 둡니다 — 후보함에서 «채택» 하면 여기 붙습니다. */}

          <CutVideoShelf
            videos={cut.videos || []}

            onChange={(update) =>
              patchCut((current) => ({ videos: update(current.videos || []) }))
            }
          />
        </div>
      )}

      {/* 특수 배경 카드 — 구성 칸을 좁히지 않습니다(도면·동선까지 전부 고를 수 있어야 하니까). */}
      {onPatchBackground && (
        <RoomPlaceDialog
          background={backgrounds.find((item) => item.id === specialId) ?? null}
          roomName={`컷 ${cut.order}`}
          // 첫 레퍼런스 칸만 뺍니다 — 구성은 전부 보여야 도면·조감도를 고를 수 있습니다.
          placeScope="special"
          open={specialOpen}
          onOpenChange={setSpecialOpen}
          onPatch={(updater) => specialId && onPatchBackground(specialId, updater)}
          onRemove={() => {
            if (specialId) onRemoveBackground?.(specialId);
            setSpecialId(null);
          }}
        />
      )}

      {/*
        ── 잡아 둔 구도 고르기 ────────────────────────────────────────
        

        글로 «장면 2 · 컷 1» 만 적어 두면 그게 어떤 그림이었는지 기억이 안 납니다.
        구도 그림이 곧 그 구도의 얼굴이라 그림으로 고릅니다.
      */}
      {shotsOpen && savedShots && (
        <div
          className={`${MODAL_BACKDROP} z-[80]`}
          style={MODAL_BACKDROP_STYLE}
          onClick={() => setShotsOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={modalCard("large")}
            style={MODAL_CARD_STYLE}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
            >
              <p className="text-sm font-semibold" style={{ color: "oklch(0.88 0.01 265)" }}>
                구도 불러오기 — 잡아 둔 구도 {savedShots.length}개
              </p>
              <button
                type="button"
                onClick={() => setShotsOpen(false)}
                className="rounded-md p-1.5 hover:bg-white/10"
                style={{ color: "oklch(0.62 0.01 265)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="shrink-0 px-4 pt-2 text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
              방·소품·인물 자리를 <b>통째로</b> 가져옵니다. 카메라만 바꾸거나 배경만 갈아 끼우면 됩니다.
              그 구도에서 뽑아 둔 레퍼런스 영상은 따라오지 않습니다.
            </p>
            <div className="composition-scroll grid min-h-0 flex-1 gap-2 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-4">
              {savedShots.map((shot) => (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => void loadShot(shot)}
                  className="overflow-hidden rounded-lg text-left"
                  style={{ background: "oklch(0.11 0.007 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
                >
                  <div className="aspect-video w-full" style={{ background: "oklch(0.09 0.006 265)" }}>
                    {shot.thumb ? (
                      <img
                        src={assetSrc(shot.thumb) || shot.thumb}
                        alt={shot.label}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center text-[10px]"
                        style={{ color: "oklch(0.34 0.01 265)" }}
                      >
                        구도 그림 없음
                      </div>
                    )}
                  </div>
                  <p
                    className="truncate px-2 py-1.5 text-[11px]"
                    style={{ color: "oklch(0.76 0.01 265)" }}
                  >
                    {shot.label}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <CompositionPlanner
        cutId={cut.id}
        onControlCommit={async (composition, captures) => {
          if (!commitProjectChange) throw new CompositionControlError("project_not_saved", "프로젝트 저장이 준비되지 않았습니다.");
          const owner = await commitProjectChange(current => cutCompositionPatch(current, cut.id, composition));
          // 새 프로젝트와 이름이 같은 작품이 있으면 저장소가 폴더에 번호를 붙입니다. 확정된 폴더로 그림도 보냅니다.
          const targetProjectName = projectFolderName(owner.projectId, projectName);
          const [guideImagePath, plateImagePath] = await Promise.all([
            storeCapture(captures.guide, "구도", targetProjectName),
            storeCapture(captures.plate, "배경", targetProjectName),
          ]);
          if (!guideImagePath || !plateImagePath) throw new CompositionControlError("capture_save_failed", "구도와 배경 그림을 프로젝트 폴더에 모두 저장하지 못했습니다.");
          await commitProjectChange(current => cutCompositionPatch(current, cut.id, composition, {
            guideImage: captures.guide, plateImage: captures.plate, guideImagePath, plateImagePath,
          }));
          return { guideImagePath, plateImagePath, persisted: true };
        }}
        open={planning}
        onOpenChange={setPlanning}
        // 컷에 체크한 인물만 주면, 아직 체크 전일 때 세울 사람이 없습니다.
        // 프로젝트 인물 전체를 주고, 누굴 세울지는 구도잡기 안에서 고릅니다.
        characters={characters}
        backgrounds={backgrounds}
        // 작품이 정한 비율로 프레임을 시작합니다 — 「9:16」 이면 세로로.
        aspect={aspectNumberOf(projectAspect)}
        // 열 때 컷 선택을 반영해 둔 구도. 아직 컷에 저장한 것은 아닙니다.
        composition={plannerComposition}
        projectName={projectName}
        sceneTitle={sceneTitle}
        cutOrder={cut.order}
        usedVideoPath={cut.refVideoPath}
        /*
          구도잡기 안에서 **장소 카드**를 만들고 그 자리에서 엽니다(). 카드는 프로젝트의 장소 목록에 그대로 생깁니다 —
          씬 탭에서 보던 그 카드입니다.
        */
        onCreatePlace={
          onCreateBackground
            ? (place) => {
                onCreateBackground(place);
                toast.success(`장소 «${place.name}» 를 만들었습니다.`, {
                  description: "이 방에 이어 두었습니다. 카드에서 프롬프트를 뽑고 그림을 등록하면 6면이 자동으로 잘려 걸립니다",
                });
              }
            : undefined
        }
        onPatchBackground={onPatchBackground}
        onRemoveBackground={onRemoveBackground}
        placeLibrary={placeLibrary}
        sharedAssets={sharedAssets}
        onChangeSharedAssets={onChangeSharedAssets}
        roomPresets={roomPresets}
        onSaveRoomPreset={onSaveRoomPreset}
        onRemoveRoomPreset={onRemoveRoomPreset}
        onSave={async (composition: CompositionState) => {
          // 알림 문구는 «화면에 보이던 컷» 으로 만듭니다 — 사람이 방금 본 것과 같은 말이라야 읽힙니다.
          const { notice } = readCompositionIntoCut(composition, {
            cut,
            characters,
            backgrounds,
          });
          // 캡처보다 먼저 구도 원본을 파일에 확정합니다. 자동 저장 예약만으로는 닫아도 된다고 말할 수 없습니다.
          if (!commitProjectChange) throw new CompositionControlError("project_not_saved", "프로젝트 저장이 준비되지 않았습니다.");
          await commitProjectChange(current => cutCompositionPatch(current, cut.id, composition));
          if (notice) toast.message(notice);
        }}
        onCapture={({ guide, plate }) => {
          // 새로 찍었으니 저장해 둔 옛 경로는 버립니다 — 안 버리면 옛 그림을 계속 보냅니다.
          // 구도를 잡는 몇 분 사이에 도착한 프롬프트 답은 `patchCut` 이 얕게 합치므로 값꼴이어도
          // 남습니다. 함수꼴은 저장소 약속(patch 는 늘 함수)을 따른 것이지, 지금 값을 읽지는 않습니다.
          patchCut(() => ({
            guideImage: guide,
            guideImagePath: undefined,
            plateImage: plate,
            plateImagePath: undefined,
          }));
          /*
            **찍는 순간 폴더에도 내려놓습니다.**

            여태는 «마그니픽으로 보내기» 를 누를 때만 내려놓았습니다. 그때까지는 data URL 뿐이라,
            프로젝트를 저장하면 그 긴 글자가 project.json 에 통째로 들어가고(한 장에 수 MB),
            스토리보드처럼 파일 경로가 필요한 쪽에서는 아무것도 못 씁니다.
          */
          void storeCaptures(guide, plate);
        }}
        /*
          레퍼런스 영상이 저장되면 컷이 그 경로와 길이를 들고 있습니다.
          
        */
        onVideoSaved={async (refVideoPath, refVideoSeconds) => {
          if (!commitProjectChange) throw new CompositionControlError("project_not_saved", "프로젝트 저장이 준비되지 않았습니다.");
          // 몇 분 동안 바뀐 프롬프트·대사·다른 컷을 보존하고, 파일 저장 확인 뒤에만 완료를 알립니다.
          await commitProjectChange(current => {
            let found = false;
            const scenes = current.scenes.map(scene => ({ ...scene, cuts: scene.cuts.map(item => {
              if (item.id !== cut.id) return item;
              found = true;
              return { ...item, refVideoPath, refVideoSeconds };
            }) }));
            if (!found) throw new CompositionControlError("cut_not_found", "영상을 붙일 컷이 삭제되었습니다.");
            return { ...current, scenes };
          });
        }}
      />
    </div>
  );
}
