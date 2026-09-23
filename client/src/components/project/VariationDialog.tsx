import { useEffect, useRef, useState } from "react";
import { HOLDS_VARIATION } from "@/lib/useTutorialPanel";
import { uid } from "@/lib/projectTypes";
import { EDITOR_DIALOG } from "@/lib/layout";
import { Sparkles, Star, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmDialog } from "@/components/ConfirmDialog";
import PromptCardBody from "@/components/project/PromptCardBody";
import GeneratedImageShelf from "@/components/project/GeneratedImageShelf";
import { usePromptCard } from "@/components/project/usePromptCard";
import {
  autoEquirectOf,
  getAutoUnfoldEnabled,
  useAutoUnfold,
} from "@/components/project/useAutoUnfold";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import {
  assetSrc,
  fileStem,
  renameStemFiles,
  safeFileName,
  stemHasPrefix,
  type ProjectAssetType,
} from "@/lib/mediaLibrary";
import { IMAGE_MODELS, normalizeModelId } from "@/lib/promptLibrary";
import { ensureParentReference } from "@/lib/promptWorkflow";
import { variationStemOf } from "@/lib/assetStem";
import type { BlueprintKind, SpaceKind } from "@/lib/blueprint";
import type { GeneratedImageAsset, ReferenceImage } from "@/lib/projectTypes";
import type { PromptVariationState } from "@/lib/promptWorkflow";
import type { RequestTemplateId } from "@/components/LlmRequestButton";
import type { LlmTask } from "@/lib/llm";
import { fieldStyle } from "@/components/project/fieldStyle";

/**
 * 변형 시트 만들기.
 *
 * # 정체성은 하나입니다
 *
 * 변형이란 「이 인물의 옷을 갈아입힌 것」이지 새 인물이 아닙니다. 그래서
 * **부모 시트가 정체성 기준 이미지**로 자동으로 걸리고, 뺄 수 없습니다.
 * 빼는 순간 다른 사람이 되니까요.
 *
 * 변형의 변형도 만들 수 있습니다. 그때 물리는 것은 원본이 아니라 **바로 위 판**
 * 입니다. 옷을 갈아입힌 판에서 머리만 바꾸면 옷은 그대로 따라와야 하거든요.
 *
 * # 레퍼런스마다 다른 것을 봅니다
 *
 * 여러 장을 올리면 각각에서 **다른 요소**를 가져옵니다.
 *
 * > `@정체성 기준`에서 헤어는 `@ref_1`의 헤어로 바꾸고, 옷은 `@ref_2`의 의상으로
 * > 바꾼다. 그 외의 모든 요소는 `@정체성 기준`으로 고정하고 구도만 바꾼다.
 *
 * 그래서 분석도 통짜로 하지 않습니다. 정체성 기준은 전체를, ref_1 은 헤어만,
 * ref_2 는 의상만 봅니다. 태그 막대에서 이미지를 눌러 태그를 끼워 넣으세요.
 *
 * # 캐릭터·배경·에셋이 같이 씁니다
 *
 * 안쪽 흐름이 셋 다 똑같습니다. `PromptCardBody` 를 그대로 쓰고, 갈래에 따라
 * 요청 문구만 갈아 끼웁니다.
 */

export interface VariationDialogProps<
  T extends PromptVariationState<ReferenceImage, GeneratedImageAsset>,
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: BlueprintKind;
  /** 부모 이름. 폴더 이름이 되고, 프롬프트에도 실립니다 */
  ownerName: string;
  /** 부모 설명. 「이 인물이 누구인지」를 LLM 에 알려 줍니다 */
  ownerDescription: string;
  /** 정체성 기준이 될 부모 그림. 없으면 변형을 만들 수 없습니다 */
  parentImage: GeneratedImageAsset | null;
  /**
   * 이 인물(부모)의 생성 이미지 전부.
   * 스트립으로 보여 주고, 누르면 변형 레퍼런스로 들어갑니다 — 폴더를 뒤져
   * 다시 올릴 필요가 없습니다.
   */
  ownerImages?: GeneratedImageAsset[];
  /**
   * 원본 인물의 생성 이미지를 고칩니다. 잘라낸 칸이 여기로 갑니다 — 그래야 위 줄에
   * 나타나 어느 변형에서든 레퍼런스로 집을 수 있습니다. 안 주면 이 변형의 생성 이미지로.
   */
  onOwnerImagesChange?: (
    update: (current: GeneratedImageAsset[]) => GeneratedImageAsset[],
  ) => void;
  /**
   * 이 인물(부모)의 **레퍼런스** 이미지. 생성 이미지와 함께 스트립에 뜹니다.
   *
   * 「이 캐릭터의 생성 이미지 외에 레퍼런스 이미지들도 여기서 관리할 수
   * 있어야 편할 것 같네? 그래야 변형 레퍼런스 이미지로 바로 바로 넣고 하지」
   * (지시 210)
   */
  ownerReferences?: ReferenceImage[];
  /** 부모의 이미지 분석. 같은 부모의 변형은 이걸 «가져오기» 로 나눠 씁니다. */
  ownerAnalysis?: string;
  /** 같은 부모의 다른 변형들(자기 자신 포함해도 됨 — 걸러냅니다). 분석 가져오기 목록의 재료. */
  siblings?: T[];
  variation: T;
  onSave: (variation: T) => void;
  spaceKind?: SpaceKind;
  analysisTemplate: RequestTemplateId;
  analysisTask: LlmTask;
  promptTemplate: RequestTemplateId;
  promptTask: LlmTask;
  /**
   * 보유 에셋의 변형처럼 «kind 와 폴더가 다른» 경우. 없으면 kind·ownerName 으로 정합니다.
   *
   * 보유 에셋은 제 폴더가 없고 주인(인물·장소) 폴더 안에 «주인_에셋» 으로 들어갑니다(규칙 5).
   * 그 변형도 같은 폴더에 «주인_에셋_변형» 이어야 합니다. 이게 없이 kind="asset" 으로 열면
   * `character/공용에셋/<에셋>/` 에 저장돼 주인 폴더 밖으로 흩어지고, 이름 바꾸기도 옛 파일을
   * 못 찾습니다. 화면 문구(«{ownerName} 정체성 기준» 등)는 그대로 에셋 이름을 씁니다.
   */
  folder?: {
    ownerName: string;
    referenceAssetType: ProjectAssetType;
    generatedAssetType: ProjectAssetType;
    /** 파일 이름 앞부분(«주인_에셋»). 변형 이름이 그 뒤에 붙습니다 */
    stemBase: string;
    /** 주인·형제 에셋이 쓰는 파일. 같은 폴더라 «내 것» 이 아닙니다 */
    claimedPaths?: () => Set<string>;
  };
  /**
   * 주인 변형 창(`folder` 없음)용 — 같은 폴더의 **보유 에셋·다른 원본(과 그 변형)** 파일.
   *
   * 다른 원본 «겨울» 의 접두 `숲_겨울` 은 주인 변형 «겨울» 의 접두와 같습니다. 이게 없으면 폴더 읽기가
   * 다른 원본의 `ref_숲_겨울_001` 을 «목록에 없는 내 파일» 로 붙이고, X 를 누르면 지웁니다
   * (검토 2026-09-08). 이름 바꾸기도 이 목록에 같은 접두가 있으면 손대지 않습니다.
   */
  claimedPaths?: () => Set<string>;
  /**
   * 주인 변형 창용 — 보유 에셋·다른 원본이 **이미 쓰는 접두**(`ownerReservedStems`).
   * 변형 이름을 다른 원본과 같게 적으면 그쪽 파일이 아직 없어도 거부합니다 — 같은 접두로 한 장이라도
   * 저장되면 그때부터 번호를 나눠 쓰기 시작해 서로의 파일을 가져갑니다.
   */
  reservedStems?: () => string[];
}

export default function VariationDialog<
  T extends PromptVariationState<ReferenceImage, GeneratedImageAsset>,
>({
  open,
  onOpenChange,
  kind,
  ownerName,
  ownerDescription,
  parentImage,
  ownerImages = [],
  onOwnerImagesChange,
  ownerReferences = [],
  ownerAnalysis,
  siblings = [],
  variation,
  onSave,
  spaceKind,
  analysisTemplate,
  analysisTask,
  promptTemplate,
  promptTask,
  folder,
  claimedPaths: foreignClaimedPaths,
  reservedStems,
}: VariationDialogProps<T>) {
  const { projectName, projectContext, renamePaths } = useProjectMedia();
  const [draft, setDraft] = useState<T>(variation);
  /**
   * 창을 열 때의 변형 이름. 닫을 때 이것과 다르면 파일 이름을 따라 바꿉니다.
   *
   * 글자마다 바꾸면 「겨」「겨울」 파일이 줄줄이 생기고 확인 창이 계속 뜹니다.
   * 창을 닫는 순간이 «다 적었다» 는 뜻입니다.
   */
  const openedName = useRef(variation.name || "");
  /**
   * 이 창에서 파일을 저장할 때 **실제로 쓴** 접두. 이름을 「겨」 까지 적고 그림을 올리면
   * `ref_냥이_겨_001` 로 저장되는데, 닫을 때 «열 때 이름» 만 보면 그 파일을 못 찾아
   * 영영 옛 접두로 남습니다(검토 2026-09-08). 처음 저장한 접두를 기억해 둡니다.
   */
  const usedStem = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    openedName.current = variation.name || "";
    usedStem.current = null;
    /**
     * 창을 열 때 부모 시트를 정체성 기준으로 끼웁니다.
     *
     * 이미 들어 있으면 건드리지 않습니다. 매번 새로 만들면 사용자가 다른
     * 그림으로 바꿔 놓은 것을 덮어써 버립니다.
     */
    setDraft((current) => {
      const next = {
        ...current,
        references: ensureParentReference(
          current.references,
          parentImage
            ? {
                id: `parent-${parentImage.id}`,
                name: `${ownerName} 정체성 기준`,
                label: "정체성 기준",
                thumb:
                  assetSrc(parentImage.filePath) || parentImage.thumb || "",
                file: null,
                filePath: parentImage.filePath,
                isParentReference: true,
              }
            : null,
        ),
      };
      latest.current = next;
      // 부모도 같은 객체를 들게 합니다 — 아래 «따라가기» 가 «부모가 든 것 = 최신» 을 전제로 합니다.
      saveRef.current(next);
      return next;
    });
  }, [open, parentImage?.id, ownerName]);

  /**
   * 부모가 든 변형이 바뀌면 창도 따라갑니다.
   *
   * 답이 오기 전에 창을 닫았다 다시 열면, 늦게 온 답은 **옛 창의 patch** 로 부모에 들어가고
   * 새 창은 열 때 복사한 옛 상태를 들고 있어 «프롬프트를 받았습니다» 는 뜨는데 칸은 비어
   * 보였습니다. 이름 바꾸기로 경로가 갈아 끼워질 때도 같습니다. 이 창이
   * 고친 것은 patch 가 부모에 같은 객체를 넘기므로(identity 같음) 되돌아오지 않습니다.
   */
  useEffect(() => {
    if (
      !open ||
      variation.id !== latest.current.id ||
      variation === latest.current
    )
      return;
    latest.current = variation;
    setDraft(variation);
  }, [open, variation]);

  /**
   * 고치는 즉시 **위(프로젝트)로 씁니다.** (지시 286)
   *
   * 예전에는 창 안 로컬 상태에만 두고 닫을 때 올렸습니다. 그런데 LLM 답은
   * 몇 십 초 뒤에 옵니다. 답이 오기 전에 창을 닫으면 컴포넌트가 사라지고,
   * 늦게 온 답의 patch 는 없어진 컴포넌트로 들어가 버려졌습니다. 스피너도
   * 켜진 채 남았고요.
   *
   * 최신 값을 ref 로 들고 있어서, 창이 사라진 뒤에 patch 가 와도 위로 갑니다.
   */
  const latest = useRef<T>(variation);
  const patch = (updater: (current: T) => Partial<T>) => {
    const partial = updater(latest.current);
    const next = { ...latest.current, ...partial };
    // 그림이 저장돼 들어오는 patch 면 그때의 접두를 적어 둡니다(usedStem 설명 참조).
    // 접두가 원본 것 그대로(`stemBase`)면 적지 않습니다 — 그 접두로 이름을 바꾸면 원본 파일까지 끌려갑니다.
    if (
      ("references" in partial || "generatedImages" in partial) &&
      variationStem &&
      variationStem !== stemBase &&
      !usedStem.current
    ) {
      usedStem.current = variationStem;
    }
    latest.current = next;
    setDraft(next);
    saveRef.current(next);
  };

  // 변형 그림은 부모 폴더 안에 들어갑니다. 폴더가 흩어지면 나중에 보기 힘듭니다.
  // 보유 에셋의 변형은 `folder` 가 주인 폴더를 가리킵니다 — kind 만 보면 공용 에셋 폴더로 갑니다.
  const referenceAssetType: ProjectAssetType =
    folder?.referenceAssetType ??
    (kind === "background"
      ? "background-reference"
      : kind === "asset"
        ? "asset-reference"
        : "character-reference");
  const generatedAssetType: ProjectAssetType =
    folder?.generatedAssetType ?? (`${kind}-generated` as ProjectAssetType);
  /** 실제 폴더 이름. 화면의 `ownerName` 은 보유 에셋이면 에셋 이름이라 폴더와 다를 수 있습니다 */
  const folderOwner = folder?.ownerName ?? ownerName;
  /** 파일 이름 앞부분의 앞부분 — 인물이면 «냥이», 보유 에셋이면 «냥이_단검» */
  const stemBase = folder?.stemBase ?? ownerName;
  /**
   * 파일 이름 앞부분 — «인물_변형». 폴더는 부모 것 하나지만(규칙 5) 파일 이름에는
   * 어느 판인지 남깁니다: `ref_냥이_겨울_001`, `냥이_겨울_001`, `냥이_겨울_얼굴 정면_001`.
   * 예전에는 부모 이름만 붙어(`냥이_004`) 폴더를 열어도 어느 변형 것인지 알 수 없었고,
   * 마그니픽 @태그로도 구분이 안 됐습니다. 이름을 아직 안 적었으면 부모 이름만 씁니다.
   *
   * 보유 에셋·다른 원본의 변형(`folder` 있음)은 이름이 비어도 접두를 비우지 않고 `folder.stemBase`
   * («냥이_어린시절»)로 떨어집니다 — 접두가 없으면 Rust 가 폴더 주인 이름을 써서 `냥이_001` 로 저장돼
   * **주인 파일과 섞이고**, 나중에 변형 이름을 적어도 옛 접두가 `냥이` 라 따라가지 못하며 원본 이름을
   * 바꿀 때도 `냥이_어린시절_` 접두로 안 잡혀 영영 주인 이름으로 남습니다(검토 2026-09-08). 마그니픽 채택
   * (`magnificBridge.variationStemOf`)과 같은 규칙이라 두 경로의 파일 이름이 어긋나지 않습니다.
   */
  const variationStem = folder
    ? variationStemOf(stemBase, draft.name)
    : draft.name?.trim()
      ? `${stemBase}_${draft.name.trim()}`
      : undefined;
  /** 이 변형이 아닌 것이 쓰는 파일 — 보유 에셋·다른 원본 창은 `folder.claimedPaths`, 주인 변형 창은 `claimedPaths` */
  const foreignPaths = () =>
    new Set([
      ...(folder?.claimedPaths?.() ?? []),
      ...(foreignClaimedPaths?.() ?? []),
    ]);

  const card = usePromptCard<T>({
    kind,
    entity: draft,
    patch,
    name: `${ownerName} · ${draft.name || "변형"}`,
    // 폴더는 **부모 이름 하나**입니다. 변형 이름까지 붙이면
    // `character/냥이 · 겨울옷/` 이 따로 생겨 한 인물의 것이 흩어집니다.
    ownerName: folderOwner,
    stem: variationStem,
    scope: "variation",
    // 부모 폴더를 같이 쓰니 부모·형제 변형이 쓰는 파일은 «내 것» 이 아닙니다.
    // 보유 에셋이면 그 주인·형제 에셋의 파일(`folder.claimedPaths`)까지, 주인 변형이면
    // 같은 폴더의 보유 에셋·다른 원본 파일(`claimedPaths`)까지 — 접두 `숲_겨울` 이 겹칠 수 있어서요.
    claimedPaths: () =>
      new Set([
        ...foreignPaths(),
        ...[
          ...ownerReferences,
          ...ownerImages,
          ...siblings
            .filter((item) => item.id !== draft.id)
            .flatMap((item) => [
              ...(item.references || []),
              ...(item.generatedImages || []),
            ]),
        ]
          .map((image) => image.filePath)
          .filter((path): path is string => Boolean(path)),
      ]),
    description: [ownerDescription, draft.description]
      .filter(Boolean)
      .join(" — "),
    projectName,
    projectContext,
    referenceAssetType,
    analysisTemplate,
    analysisTask,
    promptTemplate,
    promptTask,
    spaceKind,
  });

  /**
   * 변형 이름이 바뀌었으면 그 변형의 파일 이름도 따라가게 합니다. **창을 닫을 때 한 번.**
   *
   * 파일 이름이 곧 마그니픽 @태그라, 「겨울」 을 「밤」 으로 고쳤는데 파일이
   * `냥이_겨울_001` 로 남으면 태그가 옛 판을 부릅니다. 정체성 기준(부모 시트)과
   * 빌려 온 그림은 부모 것이라 세지 않습니다 — 파일 이름이 `냥이_겨울_` 로 시작하는
   * 것만이고, Rust 도 같은 규칙으로 고르니 부모 것(`냥이_004`)은 건드려지지 않습니다.
   */
  const renameFilesIfNeeded = async (current: T) => {
    const after = current.name?.trim() || "";
    if (!after) return;
    const newStem = `${stemBase}_${after}`;
    const before = openedName.current.trim();
    /*
      이름이 바뀌었는데 새 접두가 보유 에셋·다른 원본의 것과 같으면 파일이 없어도 거부하고 되돌립니다.
      다른 원본 «겨울» 이 아직 파일이 없을 때 통과시키면, 이후 양쪽이 `숲_겨울_` 번호를 나눠 쓰기 시작해
      폴더 읽기·이름 바꾸기가 서로의 파일을 가져갑니다(검토 2026-09-08). 이름 그대로 닫는 것은 안 막습니다 —
      옛 데이터에 이미 겹친 이름이 있으면 닫을 때마다 되돌려 끝이 없습니다.
    */
    if (after !== before && reservedStems?.().includes(newStem)) {
      toast.error(
        `「${after}」 은 이 ${kind === "background" ? "장소" : kind === "asset" ? "에셋" : "인물"}의 다른 원본·에셋이 이미 쓰는 이름이라 파일 앞부분(${safeFileName(newStem)}_…)이 겹칩니다. 변형 이름을 되돌립니다.`,
        {
          description:
            "같은 폴더에서 같은 앞부분을 쓰면 서로의 파일을 가져갑니다. 다른 이름을 적으세요.",
        },
      );
      patch(() => ({ name: before }) as Partial<T>);
      return;
    }
    // 옛 접두 후보: 열 때 이름과, 이 창에서 실제로 저장에 쓴 접두. 새 이름과 같은 것은 뺍니다.
    // 원본 접두 그대로(`stemBase`)인 것도 뺍니다 — Rust 는 폴더 안의 `접두_*` 전부를 바꾸므로
    // «냥이_어린시절» 로 바꾸면 이 변형 것이 아니라 원본 파일까지 `냥이_어린시절_겨울_…` 이 됩니다.
    const oldStems = [
      ...new Set([
        before ? `${stemBase}_${before}` : "",
        usedStem.current || "",
      ]),
    ].filter((stem) => stem && stem !== newStem && stem !== stemBase);
    if (!oldStems.length) return;
    // 잘라낸 칸은 부모의 생성 이미지 목록(ownerImages)에 들어가므로 같이 봅니다. 접두로 고르니
    // 부모 것(`냥이_004`)은 걸리지 않습니다.
    const own = [
      ...(current.references || []).filter(
        (reference) =>
          !reference.isParentReference &&
          !reference.sharedFile &&
          !reference.id.startsWith("owner-"),
      ),
      ...(current.generatedImages || []),
      ...ownerImages,
    ];
    const staleByStem = oldStems
      .map((oldStem) => ({
        oldStem,
        stale: own.filter(
          (image) =>
            image.filePath && stemHasPrefix(fileStem(image.filePath), oldStem),
        ),
      }))
      .filter((group) => group.stale.length);
    if (!staleByStem.length) return;

    /*
      보호 장치 — 남의 파일(보유 에셋·다른 원본, 그 변형)에 같은 접두가 있으면 손대지 않습니다.
      Rust 의 `rename_stem_files` 는 폴더 전체에서 접두를 바꾸므로, 다른 원본 «겨울» 의 `숲_겨울_001`
      과 그 변형 `숲_겨울_밤_001` 까지 `숲_밤_…` 이 되어 그쪽은 이름은 «겨울» 인데 파일은 «밤» 이 됩니다
      (검토 2026-09-08). `renameOwnedAssetFiles` 와 같은 규칙 — 이름을 되돌리고 폴더를 진실로 둡니다.
    */
    const foreign = foreignPaths();
    const clash = staleByStem.find(({ oldStem }) =>
      [...foreign].some((path) => stemHasPrefix(fileStem(path), oldStem)),
    );
    if (clash) {
      toast.error(
        `다른 원본이나 에셋이 같은 앞부분(${safeFileName(clash.oldStem)}_…)을 쓰고 있어 파일 이름을 바꾸지 않습니다. 변형 이름을 되돌립니다.`,
        {
          description:
            "겹치는 원본·에셋의 이름을 먼저 바꾼 뒤 다시 시도하세요.",
        },
      );
      patch(() => ({ name: before }) as Partial<T>);
      return;
    }

    const samples = [
      ...new Set(
        staleByStem.flatMap((group) =>
          group.stale.map((image) => fileStem(image.filePath || "")),
        ),
      ),
    ].slice(0, 3);
    const ok = await confirmDialog({
      title: `변형 이름을 「${after}」 로 바꾸면 파일 이름도 바뀝니다`,
      description:
        `그 변형의 파일 이름(${samples.join(", ")} …)도 ${safeFileName(newStem)}_… 로 바뀌고, ` +
        "마그니픽 @태그도 새 이름을 따릅니다. 부모 시트 파일은 그대로입니다.",
      confirmLabel: "바꾸기",
    });
    if (!ok) return;

    let movedCount = 0;
    const failed: { path: string; reason: string }[] = [];
    for (const { oldStem } of staleByStem) {
      // 폴더는 실제 폴더(`folderOwner`) — 보유 에셋이면 주인 폴더에서 찾아야 옛 파일이 있습니다.
      const outcome = await renameStemFiles({
        projectName,
        assetType: referenceAssetType,
        ownerName: folderOwner,
        oldStem,
        newStem,
      });
      // 자식 변형의 정체성 기준, 부모가 빌려 쓴 레퍼런스, 표시(imageMarks)까지 같은 파일을
      // 가리키니 초안 전체에서 갈아 끼웁니다. 창 안의 것만 고치면 나머지가 없는 경로를 듭니다.
      if (outcome.moved.size) renamePaths(outcome.moved);
      movedCount += outcome.moved.size;
      failed.push(...outcome.failed);
    }
    // 다음에 또 바꿀 때는 지금 이름이 기준입니다.
    openedName.current = after;
    usedStem.current = newStem;
    if (failed.length) {
      toast.error(
        `${failed.length}개 파일은 다른 프로그램이 쓰고 있어 이름을 못 바꿨습니다. 그 파일은 옛 이름으로 남습니다.`,
        { description: failed[0].reason },
      );
    } else if (movedCount) {
      toast.success(
        `파일 ${movedCount}개의 이름을 ${safeFileName(newStem)}_… 로 바꿨습니다.`,
      );
    }
  };

  /**
   * 창을 닫습니다. 닫기가 곧 저장입니다 — 변형 카드는 「이 카드에서 변형」 을 누른 순간
   * 이미 목록에 있으므로 여기서 걸러 낼 것이 없습니다.
   */
  const finish = async () => {
    const current = latest.current;
    // 고칠 때마다 이미 위로 썼지만(patch), 닫을 때 한 번 더 써서 마지막 상태를 못 박습니다.
    onSave(current);
    await renameFilesIfNeeded(current);
    onOpenChange(false);
  };
  const close = () => void finish();

  // onSave 는 매 렌더 새로 만들어집니다. patch 가 늘 최신 것을 부르게 ref 로 둡니다.
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  /**
   * 정체성 기준 **바꾸기**. «빼기» 는 여전히 안 되고(규칙 6) 바꾸기만 됩니다 — 기준은 늘 한 장.
   * 새 기준을 맨 앞에 두는 이유는 태그가
   * «첫 번째 = 정체성» 으로 매겨지기 때문입니다. 옛 기준은 빌려 쓴 그림으로 남아 X 로 뺄 수 있습니다(파일은 남음).
   * 레퍼런스 타일의 ★ 과 위 «이 인물의 생성 이미지» 줄의 ★ 이 같은 함수를 씁니다.
   */
  /*
    ── 변형 창에도 자동 6면 자르기 ─────────────────────────────────────────
    등장방형은 대개 **변형 창**에서 뽑습니다(앵커를 찍은 마스터가 정체성 기준). 장소 카드에만 걸어 두면
    파노라마가 들어오는 자리에서 안 잘립니다 — 
    전개도도 같은 훅이라 함께 걸립니다(9/15 보고서의 «변형 창에는 안 붙였다» 를 여기서 풉니다).
    잘라 낸 여섯 장은 잘라내기 저장(`cropSave`)과 같은 규칙으로 원본의 생성 이미지로 갑니다.
    배경 변형만, 창이 열려 있을 때만 — 닫힌 창의 `draft` 는 옛 값일 수 있습니다.
  */
  useAutoUnfold({
    images: draft.generatedImages,
    patch: patch as unknown as (
      updater: (current: { generatedImages: GeneratedImageAsset[] }) => {
        generatedImages: GeneratedImageAsset[];
      },
    ) => void,
    projectName,
    assetType: generatedAssetType,
    ownerName: folderOwner,
    prefix: variationStem ?? stemBase,
    spaceKind,
    enabled: open && kind === "background" && getAutoUnfoldEnabled(),
    onlyNew: true,
    equirect:
      kind === "background"
        ? autoEquirectOf(draft.blueprint, spaceKind, draft.panoramaSpace, draft.exteriorSpace, card.identityMarks(), `${draft.promptEn ?? ""}
${draft.promptKo ?? ""}`)
        : null,
    onSaved: onOwnerImagesChange
      ? (added) => onOwnerImagesChange((current) => [...current, ...added])
      : undefined,
  });

  const makeIdentity = (id: string) => {
    patch((current) => {
      const list = current.references || [];
      const target = list.find((reference) => reference.id === id);
      if (!target || target.isParentReference) return {} as Partial<T>;
      const rest = list
        .filter((reference) => reference.id !== id)
        .map((reference) =>
          reference.isParentReference
            ? {
                ...reference,
                isParentReference: false,
                label: undefined,
                sharedFile: true,
              }
            : reference,
        );
      return {
        references: [
          { ...target, isParentReference: true, label: "정체성 기준" },
          ...rest,
        ],
      } as Partial<T>;
    });
    toast.success(
      "정체성 기준을 바꿨습니다. 옛 기준은 보통 레퍼런스로 남아 X 로 뺄 수 있습니다.",
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      {/*
        품은 자리는 카드 몸통 것 + 창 제 것 둘(`HOLDS_VARIATION`). 안 적으면 변형 창을 가리키는
        걸음에 이르는 순간 창이 스스로 닫혀, 그 걸음이 밝힐 것을 잃습니다.
      */}
      <DialogContent
        showCloseButton={false}
        tutorialHolds={HOLDS_VARIATION}
        className={EDITOR_DIALOG}
        style={{ background: "oklch(0.13 0.009 265)" }}
      >
        <DialogTitle className="sr-only">변형 시트</DialogTitle>
        <DialogDescription className="sr-only">
          부모 시트를 정체성 기준으로 삼아 일부만 바꾼 판을 만듭니다
        </DialogDescription>

        <div
          className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3"
          style={{
            background: "oklch(0.13 0.009 265)",
            borderBottom: "1px solid oklch(1 0 0 / 8%)",
          }}
        >
          <Sparkles
            className="h-4 w-4 shrink-0"
            style={{ color: "oklch(0.80 0.16 45)" }}
          />
          <div className="min-w-0 shrink-0">
            <p className="text-sm font-semibold leading-tight">
              {kind === "background"
                ? "배경 변형"
                : kind === "asset"
                  ? "에셋 변형"
                  : "캐릭터 변형"}
            </p>
            <p
              className="text-[10px] leading-tight"
              style={{ color: "oklch(0.55 0.12 45)" }}
            >
              {ownerName} 원본에서 파생
            </p>
          </div>
          <p
            className="min-w-0 flex-1 truncate text-[11px]"
            style={{ color: "oklch(0.48 0.01 265)" }}
          >
            정체성은 부모 시트로 고정됩니다. 여기서는 바꿀 것만 적으세요
          </p>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="shrink-0 rounded p-1.5 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {!parentImage && (
            <p
              className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
              style={{
                background: "oklch(0.62 0.18 25 / 12%)",
                border: "1px solid oklch(0.62 0.18 25 / 30%)",
                color: "oklch(0.80 0.16 25)",
              }}
            >
              부모 시트에 그림이 아직 없습니다. 정체성 기준이 없으면 변형이 다른
              인물이 됩니다. 원본 시트를 먼저 뽑아 등록해 주세요.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft.name || ""}
              onChange={(event) =>
                patch(() => ({ name: event.target.value }) as Partial<T>)
              }
              placeholder="변형 시트 이름 (예: 겨울 외투, 밤 장면)"
              className="min-w-[180px] flex-1 rounded-md px-2.5 py-2 text-sm font-semibold outline-none"
              style={fieldStyle}
            />
            <select
              value={normalizeModelId(draft.promptModel)}
              onChange={(event) =>
                patch(() => ({ promptModel: event.target.value }) as Partial<T>)
              }
              title="이 변형 프롬프트를 어느 이미지 모델 문법으로 뽑을지"
              data-tour="variation-model"
              className="shrink-0 rounded-md px-2.5 py-2 text-xs outline-none"
              style={fieldStyle}
            >
              {IMAGE_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          {/* ── 이 인물의 생성 이미지 — 눌러서 레퍼런스로 ─────────────────
              변형 재료는 대개 이미 뽑아 둔 그림입니다. 폴더를 뒤져 다시
              올리게 하지 않고 여기서 바로 집어넣습니다. */}
          {(ownerImages.length > 0 || ownerReferences.length > 0) && (
            <div
              data-tour="variation-parent-images"
              className="rounded-lg p-2.5"
              style={{
                background: "oklch(0.12 0.008 265)",
                border: "1px solid oklch(1 0 0 / 7%)",
              }}
            >
              <p
                className="text-[10px] font-semibold"
                style={{ color: "oklch(0.62 0.01 265)" }}
              >
                이{" "}
                {kind === "background"
                  ? "배경"
                  : kind === "asset"
                    ? "에셋"
                    : "캐릭터"}
                의 생성 이미지·레퍼런스 — 클릭해 레퍼런스에 추가
              </p>
              <div className="composition-scroll mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                {[
                  ...ownerImages,
                  // 레퍼런스도 같은 줄에. 폴더를 뒤져 다시 올리지 않게. (지시 210)
                  ...ownerReferences.map((reference) => ({
                    id: `ref-${reference.id}`,
                    name: reference.name || reference.label || "레퍼런스",
                    thumb: reference.thumb,
                    filePath: reference.filePath,
                  })),
                ].map((image) => {
                  const src = assetSrc(image.filePath) || image.thumb || "";
                  const hit = draft.references.find(
                    (reference) =>
                      reference.id === `owner-${image.id}` ||
                      (!!image.filePath &&
                        reference.filePath === image.filePath),
                  );
                  const added = Boolean(hit);
                  const isIdentity = Boolean(hit?.isParentReference);
                  /*
                    이미 넣은 것을 다시 누르면 목록에서 뺍니다(파일은 그대로).
                    정체성 기준만은 못 뺍니다 — 빼면 다른 사람이 됩니다(규칙 6).
                    
                  */
                  const detach = () => {
                    if (!hit) return;
                    if (hit.isParentReference) {
                      toast.error(
                        "정체성 기준은 뺄 수 없습니다. 빼면 다른 사람이 됩니다.",
                        {
                          description:
                            "바꾸려면 다른 그림의 ★(정체성 기준으로)을 누르세요. 옛 기준은 보통 레퍼런스가 되어 뺄 수 있습니다.",
                        },
                      );
                      return;
                    }
                    // 같은 그림이 두 번 들어가 있으면(두 번 눌렀거나 옛 데이터) 하나만 빼면 «추가됨» 이
                    // 그대로 남아 «해제했는데 다시 추가돼 있다» 로 보입니다. 전부 뺍니다.
                    patch(
                      (current) =>
                        ({
                          references: current.references.filter(
                            (reference) =>
                              reference.isParentReference ||
                              !(
                                reference.id === `owner-${image.id}` ||
                                (!!image.filePath &&
                                  reference.filePath === image.filePath)
                              ),
                          ),
                        }) as Partial<T>,
                    );
                  };
                  const attach = () =>
                    patch(
                      (current) =>
                        ({
                          references: [
                            ...current.references,
                            {
                              id: `owner-${image.id}`,
                              name: image.name || "생성 이미지",
                              thumb: src,
                              file: null,
                              filePath: image.filePath,
                              // 원본 인물의 파일을 빌려 쓰는 것. 목록에서 빼도 파일은 지우지 않습니다.
                              sharedFile: true,
                            },
                          ],
                        }) as Partial<T>,
                    );
                  return (
                    <div key={image.id} className="relative shrink-0">
                      <button
                        type="button"
                        onClick={added ? detach : attach}
                        title={
                          isIdentity
                            ? `${image.name} — 정체성 기준. 바꾸려면 다른 그림의 ★ 을 누르세요`
                            : added
                              ? `${image.name} — 다시 누르면 레퍼런스에서 뺍니다 (파일은 남습니다)`
                              : `${image.name} 을 레퍼런스로`
                        }
                        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md"
                        style={{
                          border: `1px solid ${isIdentity ? "oklch(0.70 0.20 290 / 80%)" : added ? "oklch(0.70 0.15 160 / 60%)" : "oklch(1 0 0 / 10%)"}`,
                        }}
                      >
                        {src && (
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-cover"
                            /*
                            저장된 파일을 못 읽으면 방금 만든 blob(thumb)으로 한 번 더 시도하고, 그것도
                            없으면 숨깁니다 — ReferenceImageUploader 와 같은 규칙(액박 대신 빈 칸).
                            
                            어느 경로가 막혔는지는 콘솔에 남겨 원인을 짚을 수 있게 합니다.
                            «assetSrc 먼저, thumb 은 폴백» 순서는 그대로입니다.
                          */
                            onError={(event) => {
                              const fallback = image.thumb;
                              if (
                                fallback &&
                                event.currentTarget.src !== fallback
                              ) {
                                event.currentTarget.src = fallback;
                                return;
                              }
                              console.warn(
                                "그림을 읽지 못했습니다",
                                image.filePath,
                                event.currentTarget.src,
                              );
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                        {added && (
                          <span
                            className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[8px] font-bold"
                            style={{
                              background: "oklch(0 0 0 / 70%)",
                              color: isIdentity
                                ? "oklch(0.84 0.18 290)"
                                : "oklch(0.80 0.15 160)",
                            }}
                          >
                            {isIdentity ? "정체성 기준" : "추가됨"}
                          </span>
                        )}
                      </button>
                      {/*
                      추가된 그림을 바로 정체성 기준으로. 앵커를 찍은 판을 기준으로 삼고 «2차 · 앵커에서 뽑기»
                      를 고르는 흐름이라, 레퍼런스 타일까지 내려가지 않고 여기서 바꿉니다.
                      button 안에 button 을 못 두니 형제로 띄웁니다.
                    */}
                      {added && !isIdentity && hit && (
                        <button
                          type="button"
                          onClick={() => makeIdentity(hit.id)}
                          aria-label={`${image.name} 을 정체성 기준으로`}
                          title="이 그림을 정체성 기준으로 (옛 기준은 보통 레퍼런스가 됩니다)"
                          className="absolute -right-1 -top-1 z-10 rounded-full p-0.5"
                          style={{
                            background: "oklch(0.62 0.22 290)",
                            color: "white",
                            border: "1px solid oklch(0.13 0.009 265)",
                          }}
                        >
                          <Star className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <PromptCardBody
            kind={kind}
            // 같은 부모의 분석(부모 것 먼저, 그다음 형제 변형)을 가져올 수 있게 — 늘 같이 쓰진 않으니 단추로.
            analysisSources={[
              ...(ownerAnalysis?.trim()
                ? [{ label: `부모 「${ownerName}」`, text: ownerAnalysis }]
                : []),
              ...siblings
                .filter((item) => item.id !== draft.id && item.analysis?.trim())
                .map((item) => ({
                  label: `변형 「${item.name || "이름 없음"}」`,
                  text: item.analysis || "",
                })),
            ]}
            // 잘라낸 칸·지운 판은 원본 인물의 생성 이미지로. 이름은 «인물_변형_칸이름_자름_001»·
            // «인물_변형_원본꼬리_지움_001» — 어느 판에서 잘라 냈는지 남습니다. 변형 이름을 바꾸면
            // renameFilesIfNeeded 가 «인물_변형_» 접두로 골라 이 파일들도 같이 바꿉니다.
            cropSave={{
              ownerName: folderOwner,
              stem: variationStem,
              assetType: generatedAssetType,
              onSaved: (files) => {
                // thumb 은 방금 구운 blob — 저장된 파일을 앱이 못 읽을 때 액박 대신 보여 줄 폴백.
                // 파노라마 여섯 면의 면·세트 표(face/faceSet)도 같이 — 부모 목록에서 세트 카드로 묶이게.
                const added = files.map((file) => ({
                  id: uid(),
                  name: file.name,
                  thumb: file.thumb ?? "",
                  file: null,
                  filePath: file.path,
                  face: file.face,
                  faceSet: file.faceSet,
                }));
                if (onOwnerImagesChange)
                  onOwnerImagesChange((current) => [...current, ...added]);
                else
                  patch(
                    (current) =>
                      ({
                        generatedImages: [
                          ...(current.generatedImages || []),
                          ...added,
                        ],
                      }) as Partial<T>,
                  );
              },
            }}
            /*
              정체성 기준을 다른 그림으로 바꿉니다 — 부모 시트를 잘라 다듬은 그림 등.
              «빼기» 는 여전히 안 되고(규칙 6) «바꾸기» 만 됩니다. 새 기준을 맨 앞에 두는
              이유는 태그가 «첫 번째 = 정체성» 으로 매겨지기 때문입니다. 옛 기준은 빌려 쓴
              그림으로 남아 필요 없으면 X 로 뺄 수 있습니다(파일은 남음).
            */
            onMakeIdentity={makeIdentity}
            descriptionLabel="바꿀 요소와 새 특징"
            descriptionPlaceholder={
              "@정체성 에서 헤어는 @ref_1 의 헤어로 바꾸고, 옷은 @ref_2 의 의상으로 바꾼다. " +
              "그 외의 모든 요소는 @정체성 으로 고정하고 구도만 바꾼다."
            }
            entity={draft}
            patch={patch}
            card={card}
            name={`${ownerName} · ${draft.name || "변형"}`}
            promptTemplate={promptTemplate}
            spaceKind={spaceKind}
            analysisTemplate={analysisTemplate}
            promptCaption="부모 시트를 정체성 기준으로 고정 + 바꿀 요소만 + 모델별 문법"
          />

          <GeneratedImageShelf
            images={draft.generatedImages}
            onChange={(update) =>
              patch(
                (current) =>
                  ({
                    generatedImages: update(current.generatedImages),
                  }) as Partial<T>,
              )
            }
            assetLabel={draft.name || "변형"}
            // 부모 폴더 안에 넣습니다. 「냥이 변형 시트」 폴더를 따로 만들지 않습니다.
            ownerName={folderOwner}
            // 파일 이름에는 판이 남습니다 — «냥이_겨울_001».
            stem={variationStem}
            assetType={generatedAssetType}
            cropKind={kind}
            faceSetSize={kind === "background" ? autoEquirectOf(draft.blueprint, spaceKind, draft.panoramaSpace, draft.exteriorSpace, null, `${draft.promptEn ?? ""}\n${draft.promptKo ?? ""}`)?.stamp : undefined}
            // 변형에는 spaceKind 가 없어 부모 것을 씁니다 — 파노라마 위 면 이름(천장/하늘)용.
            spaceKind={spaceKind}
          />
        </div>

        {/*
          «저장하고 닫기» 단추는 뺐습니다. 고치는 즉시 위로 쓰므로 누를 이유가 없고, 있으면
          «안 누르면 안 남나?» 하고 헷갈립니다. 닫기(X·바깥 클릭)가 곧 저장입니다.
        */}
      </DialogContent>
    </Dialog>
  );
}
