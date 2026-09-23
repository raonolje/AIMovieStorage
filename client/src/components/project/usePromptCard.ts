import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import { getTargetPlatform } from "@/components/PlatformSelect";
import {
  type BlueprintKind,
  type SpaceKind,
  blueprintForSpace,
  CUBEMAP_CHIP_ID,
  DOME_CHIP_ID,
  isUnfoldChipId,
  panoramaBoxOf,
  spaceFitsChip,
  spaceForChips,
  PANORAMA_INTERIOR_CHIP_ID,
} from "@/lib/blueprint";
import { buildUnfoldTemplate } from "@/lib/unfoldPrompt";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { appendAnalysisHistory, describeRunConditions } from "@/lib/promptHistory";
// 요청 재료와 «네 칸 넣기» 는 lib 한 벌 — 「AI 일괄 생성」 4단계가 같은 것을 씁니다(규칙 1).
import {
  identityMarksOf,
  isUnfoldTemplateReference,
  sheetReferenceSources,
  sheetReferenceTags,
  sheetRequestPayload,
  sheetRunConditions,
  templateMentionOf as templateMentionOfList,
  withPromptResult,
  withUnfoldFrame as withUnfoldFrameOf,
} from "@/lib/promptPayloads";
import { cancelLlmJob, isLlmCancel, plainAnalysisText, requestJsonFromLlm, requestPromptFromLlm } from "@/lib/promptRequest";
import { buildRulePrompt } from "@/lib/rulePrompt";
import {
  assetSrc,
  deleteProjectMediaFile,
  listOwnerFiles,
  saveProjectMediaAsset,
  stemHasPrefix,
  type ProjectAssetType,
} from "@/lib/mediaLibrary";
import { modelLabel, normalizeImageModelId } from "@/lib/promptLibrary";
import { filterImageFiles, type PromptWorkflowState } from "@/lib/promptWorkflow";
import { uid, type GeneratedImageAsset, type ReferenceImage } from "@/lib/projectTypes";
import type { ProjectContextSummary } from "@/lib/projectContext";
import type { RequestTemplateId } from "@/components/LlmRequestButton";
import { getActiveProvider, getTaskModels, parseJsonResponse, type LlmTask } from "@/lib/llm";

/**
 * 프롬프트 카드가 하는 일들.
 *
 * # 왜 훅 하나로 모았는가
 *
 * 캐릭터·배경·에셋 카드는 **겉모습만 다르고 하는 일이 같습니다** — 레퍼런스를
 * 모으고, 분석을 부탁하고, 프롬프트를 받고, 이력에 쌓습니다.
 *
 * 원본에서는 이 코드가 세 군데(그리고 변형 창까지 하면 다섯 군데)에 복사돼
 * 있었습니다. 그래서 «분석은 한국어로» 같은 규칙을 한 곳에만 넣고 나머지를
 * 빠뜨리는 일이 반복됐어요. 여기 한 곳을 고치면 전부 같이 바뀝니다.
 *
 * # 상태를 함수로 갱신하는 이유 — 중요합니다
 *
 * 요청 하나에 몇 십 초가 걸립니다. 그동안 기다리지 않고 다른 카드를 열어
 * 다음 요청을 거는 것이 정상적인 사용법이에요. 그런데 갱신을 값으로 하면
 * **나중에 도착한 답이 먼저 도착한 답을 지웁니다.** 요청을 걸 때의 낡은
 * 상태 위에 덮어쓰기 때문입니다.
 *
 * 실제로 「이미지 분석 후 바로 특징 정하기를 눌렀더니 분석 내용이 사라졌다」는
 * 일이 있었습니다. 그래서 `patch` 는 항상 «지금 상태를 받아 다음 상태를 만드는
 * 함수» 여야 합니다.
 */

/** 카드 하나를 «지금 값을 받아» 고칩니다. 값으로 덮어쓰지 않습니다. */
export type EntityPatch<T> = (updater: (current: T) => Partial<T>) => void;

export interface PromptCardOptions<T extends PromptWorkflowState<ReferenceImage, GeneratedImageAsset>> {
  kind: BlueprintKind;
  entity: T;
  patch: EntityPatch<T>;
  /** 이 카드의 이름. 요청 기록과 화면 표시에 씁니다. */
  name: string;
  /**
   * **폴더 이름**. 안 주면 `name` 을 씁니다.
   *
   * 변형에서 갈라집니다. 변형 카드의 이름은 「냥이 · 겨울옷」 인데, 그걸
   * 폴더 이름으로 쓰면 `character/냥이 · 겨울옷/` 이 따로 생깁니다.
   * 폴더는 **인물당 하나**여야 합니다 — 변형·에셋·시트가 전부 그 인물
   * 폴더 안에 들어가야 나중에 탐색기로 봐도 한 인물의 것이 한자리에 있습니다.
   */
  ownerName?: string;
  /**
   * 파일 이름 앞부분. 안 주면 폴더 이름(`ownerName`)을 씁니다 → `냥이_001`.
   *
   * 변형은 `냥이_겨울` 을 줍니다 → `ref_냥이_겨울_001`. 폴더는 부모 것 하나지만
   * 파일 이름에 변형 이름이 들어가야 폴더를 열었을 때 어느 판의 것인지 보이고,
   * 마그니픽 @태그로 불렀을 때도 겨울옷 판인지 알 수 있습니다.
   */
  stem?: string;
  /**
   * 변형 카드면 "variation". 폴더를 다시 읽을 때 **자기 접두(`냥이_겨울_`) 파일만** 줍습니다.
   * 변형은 부모 폴더를 같이 쓰므로, 안 가리면 부모의 `ref_냥이_001` 이 «목록에 없는 파일» 로 보여
   * 열 때마다 다시 붙습니다 — 사용자가 뺀 레퍼런스가 계속 되살아나던 원인(2026-09-08).
   */
  scope?: "root" | "variation";
  /** 같은 폴더를 쓰는 다른 카드(부모·형제 변형·보유 에셋)가 이미 쓰는 파일. 폴더를 읽을 때 건너뜁니다. */
  claimedPaths?: () => Set<string>;
  description: string;
  projectName: string;
  projectContext: ProjectContextSummary | null;
  /** 레퍼런스를 넣을 폴더 갈래 */
  referenceAssetType: ProjectAssetType;
  /** 분석·프롬프트에 쓸 요청 문구와 작업 이름 */
  analysisTemplate: RequestTemplateId;
  analysisTask: LlmTask;
  promptTemplate: RequestTemplateId;
  promptTask: LlmTask;
  /** 배경일 때만 */
  spaceKind?: SpaceKind;
  /** 캐릭터일 때만. 규칙 조립에 넣을 키·체형 같은 것 */
  basics?: string[];
  /** 같은 것의 영어. 이게 없으면 영문 프롬프트와 LLM 요청에 나이·키·체형이 안 실립니다. */
  basicsEn?: string[];
}

export function usePromptCard<
  T extends PromptWorkflowState<ReferenceImage, GeneratedImageAsset>,
>(options: PromptCardOptions<T>) {
  const { entity, patch, kind, name } = options;
  /**
   * 요청에 싣는 구성 칩. 옛 등장방형 한 칩(`space-panorama`, 실내·실외를 가르기 전)은 카드가 실내면
   * 실내 칩, 아니면 실외 칩으로 읽습니다(`blueprintForSpace`) — 그대로 두면 방 카드가 하늘·땅 문장으로 나갑니다.
   */
  const blueprint = kind === "background" ? blueprintForSpace(entity.blueprint, options.spaceKind) : entity.blueprint;
  /*
    그림에 그려 둔 표시(앵커). 변형 창은 부모 시트(항공 그림에 앵커를 찍은 것)를 정체성 기준으로
    걸어 두는데, 예전에는 그 앵커가 요청에 한 글자도 안 실려 LLM 이 «북쪽» 을 지어냈습니다
    (docs/복원/10 §1). 정체성 그림의 표시를 여기서 찾아 싣습니다 — props 로 내려받지 않는 이유는
    ProjectMediaContext 설명과 같습니다(중간 컴포넌트 하나만 빠뜨려도 조용히 빈 값).
  */
  const { imageMarks } = useProjectMedia();
  /*
    분석과 프롬프트 작성은 **따로** 잠급니다.

    하나로 잠갔더니 «분석 중» 이면 «프롬프트 작성» 을 못 눌렀습니다. 
    답은 각자 patch(갱신 함수)로 제 칸에 붙으니 동시에 돌아도 서로 덮지 않습니다.
  */
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  /*
    «첫 레퍼런스 프롬프트» 도 따로 잠급니다. 같은 이유입니다 — 첫 장을 뽑을 프롬프트를
    기다리는 동안 다른 카드에서 분석을 돌리는 것이 정상적인 사용법입니다.

    도는 중 표시를 **entity 에 저장하지 않습니다.** 분석·프롬프트는 그 칸이 프로젝트
    파일에까지 실려서, 요청이 오류나 앱 종료로 끝나면 다시 열었을 때 «만드는 중…» 이
    영영 돌았습니다. 여기서는 처음부터 훅 안의 상태로만 둡니다.
  */
  const [firstReferenceBusy, setFirstReferenceBusy] = useState(false);
  /** 지금 돌고 있는 요청의 API 기록 id. 「중지」 가 이걸로 끊습니다. */
  const analysisJob = useRef<string | null>(null);
  const promptJob = useRef<string | null>(null);
  const firstReferenceJob = useRef<string | null>(null);

  /*
    창을 다시 열었을 때 «분석 중…» 이 그대로 도는 문제. 로딩 표시는
    데이터에 저장되는데(프로젝트 파일에도 실림) 요청이 오류·중지·앱 종료로 끝나면 끄지
    못한 채 남습니다. 이 훅이 새로 붙었다는 건 **이 인스턴스가 보낸 요청은 없다** 는 뜻이라
    표시를 끕니다. 다른 인스턴스가 보낸 요청이 아직 돌고 있어도 결과는 갱신 함수로
    제자리에 들어옵니다.
  */
  const entityId = (entity as { id?: string }).id;
  useEffect(() => {
    if (entity.analysisLoading || entity.promptLoading) {
      patch(() => ({ analysisLoading: false, promptLoading: false } as Partial<T>));
    }
    // 처음 붙을 때와 다른 카드로 바뀔 때만. 요청 중 entity 가 바뀌는 것에는 반응하면 안 됩니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);
  const busy: "analysis" | "prompt" | null = analysisBusy ? "analysis" : promptBusy ? "prompt" : null;

  /** 화면에 띄울 주소. **저장된 파일이 먼저입니다.** blob 은 앱을 닫으면 죽습니다. */
  const previewOf = (image: { filePath?: string; thumb?: string }) =>
    assetSrc(image.filePath) || image.thumb || "";

  /*
    ── 폴더에 있는 것을 화면으로 ───────────────────────────────────────────

    폴더가 원본이니 화살표가 양쪽으로 가야 합니다. 화면에서 넣은 것은 폴더로
    가고 있었는데, 그 반대가 없었습니다. 그래서 탐색기에서 직접 넣은 파일과
    시트에서 잘라낸 칸이 목록에 안 떴고, 사용자은 «레퍼런스가 계속 초기화된다»
    고 느꼈습니다 — 실은 폴더에 멀쩡히 있는데 화면이 못 본 것이었습니다.

    카드를 열 때 한 번만 읽습니다. 계속 읽으면 방금 지운 것이 되살아납니다.
    이미 목록에 있는 자리는 건드리지 않고, **없는 것만 뒤에 붙입니다.*  */
  const scanned = useRef(false);
  useEffect(() => {
    if (scanned.current || !options.projectName.trim()) return;
    scanned.current = true;
    void (async () => {
      const found = await listOwnerFiles({
        projectName: options.projectName,
        assetType: options.referenceAssetType,
        ownerName: options.ownerName || name || KIND_FALLBACK[kind],
      });
      // 다른 카드가 쓰는 파일과, 변형이면 남의 접두 파일은 «내 것이 아닌 파일» 입니다.
      const claimed = options.claimedPaths?.() ?? new Set<string>();
      const scoped = found.filter((file) => {
        if (claimed.has(file.filePath)) return false;
        if (options.scope === "variation") return Boolean(options.stem) && stemHasPrefix(file.name, options.stem || "");
        return true;
      });
      if (!scoped.length) return;
      patch((current) => {
        const have = new Set((current.references || []).map((image) => image.filePath));
        /*
          같은 그림이 두 개로 불어나던 것. (지시 317)

          저장이 끝나기 전에 창을 닫으면 filePath 를 채우는 두 번째 patch 가
          버려집니다. 그 상태로 다시 열면 폴더 파일이 «목록에 없는 것» 으로
          보여 새로 붙었습니다. 이름이 같고 아직 filePath 가 없는 것이 있으면
          새로 붙이지 않고 **그 자리에 경로를 채웁니다.*        */
        const orphans = new Map(
          (current.references || [])
            .filter((image) => !image.filePath && image.name)
            .map((image) => [image.name, image.id] as const),
        );
        const fills = new Map<string, string>();
        const missing = scoped.filter((file) => {
          if (have.has(file.filePath)) return false;
          const orphanId = orphans.get(file.name);
          if (orphanId && !fills.has(orphanId)) {
            fills.set(orphanId, file.filePath);
            return false;
          }
          return true;
        });
        if (!missing.length && !fills.size) return {} as Partial<T>;
        return {
          references: [
            ...(current.references || []).map((image) =>
              fills.has(image.id) ? { ...image, filePath: fills.get(image.id) } : image,
            ),
            ...missing.map((file) => ({
              id: uid(),
              name: file.name,
              thumb: "",
              file: null,
              filePath: file.filePath,
            })),
          ],
        } as Partial<T>;
      });
    })();
    // 카드를 열 때 한 번. 이름이 바뀔 때마다 다시 읽으면 옛 폴더 것이 섞입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.projectName]);

  /** LLM 에 올릴 그림들. 넉 장까지만 씁니다 — 더 보내면 각각을 더 작게 봅니다(`sheetReferenceSources`, 일괄 생성과 같은 것). */
  const referenceSources = () => sheetReferenceSources(entity.references || []);

  /**
   * 그림에 붙은 태그를 요청에 함께 싣습니다 — 규칙은 `sheetReferenceTags`(lib) 한 벌, 여기서는 플랫폼만 보탭니다.
   *
   * `list` 를 주면 그 목록으로 셉니다 — 방금 넣은 전개도 틀처럼 **아직 화면 상태에 안 들어온** 그림까지 요청에
   * 싣기 위해서입니다(`ensureUnfoldTemplate`). 안 주면 지금 카드의 레퍼런스.
   */
  const referenceTags = (list: ReferenceImage[] = entity.references || []) =>
    sheetReferenceTags(list, getTargetPlatform());
  /** 레퍼런스 가운데 전개도 틀의 태그. 없으면 null. */
  const templateMentionOf = (list: ReferenceImage[] = entity.references || []) =>
    templateMentionOfList(list, getTargetPlatform());

  // ── 레퍼런스 ────────────────────────────────────────────────────────────

  /**
   * 파일을 받아 화면에 붙이고 **폴더에도 저장합니다.**
   *
   * 폴더가 원본이라 여기서 저장해 두지 않으면, 앱을 닫았다 열었을 때
   * 레퍼런스가 빈칸이 됩니다. 저장이 끝나면 `filePath` 를 채워 넣습니다.
   */
  const addReferenceFiles = async (files: FileList | File[], extra?: Partial<ReferenceImage>) => {
    const picked = filterImageFiles(files);
    if (!picked.length) {
      toast.error("이미지 파일만 넣을 수 있습니다.");
      return [] as ReferenceImage[];
    }

    const added: ReferenceImage[] = picked.map((file) => ({
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      thumb: URL.createObjectURL(file),
      file,
      ...extra,
    }));

    patch((current) => ({ references: [...(current.references || []), ...added] } as Partial<T>));

    // 제목이 없으면 폴더를 못 정합니다. 그냥 넘어가면 화면에는 그림이 보이는데
    // 폴더에는 아무것도 없고, blob 주소라 **앱을 닫으면 통째로 사라집니다.**
    // 조용히 실패하면 알 방법이 없어서 반드시 알려 줍니다.
    if (!options.projectName.trim()) {
      toast.warning("프로젝트 제목을 먼저 정하세요. 그래야 그림이 폴더에 저장됩니다.");
      return added;
    }

    const saved = await Promise.all(
      added.map(async (image) => {
        const file = image.file;
        if (!file) return null;
        const result = await saveProjectMediaAsset(file, {
          projectName: options.projectName,
          assetType: options.referenceAssetType,
          ownerName: options.ownerName || name || KIND_FALLBACK[kind],
          // 원본 파일 이름은 넘기지 않습니다 — «인물 이름_001» (변형은 «인물_변형_001») 로 저장됩니다.
          //
          // 예전에는 원본 파일 이름을 그대로 넘겨서
          // `raon_A_cute_Korean_woman_with_gray_cat_ears_playful_...png`
          // 같은 이름이 폴더에 그대로 쌓였습니다. 파일 이름이 곧 Magnific 의
          // @태그라서, 그런 이름으로는 태그를 걸 수가 없습니다.
          stem: options.stem,
        }).catch(() => null);
        return result ? { id: image.id, path: result.path, name: result.name } : null;
      }),
    );

    const stored = new Map(saved.filter(Boolean).map((item) => [item!.id, item!]));
    if (!stored.size) return added;

    // 값이 아니라 함수로 고칩니다. 저장이 끝나는 사이에 다른 것이 들어왔을 수 있습니다.
    // 이름도 함께 바꿉니다 — 폴더에 놓인 이름과 화면에 뜨는 이름이 같아야
    // 태그가 파일을 가리킵니다.
    patch((current) => ({
      references: (current.references || []).map((image) => {
        const item = stored.get(image.id);
        return item ? { ...image, filePath: item.path, name: item.name } : image;
      }),
    } as Partial<T>));
    // 저장된 이름으로 돌려줍니다 — 부르는 쪽이 곧바로 태그(파일 이름)를 지어야 할 때가 있습니다.
    return added.map((image) => {
      const item = stored.get(image.id);
      return item ? { ...image, filePath: item.path, name: item.name } : image;
    });
  };

  /**
   * 레퍼런스를 뺍니다. **폴더 파일도 함께 지우므로 먼저 묻습니다.**
   *
   * 예전에는 ✕ 를 누르는 즉시 파일까지 지웠습니다. 타일이 작고 ✕ 도 작아서
   * 옆 것을 누르려다 잘못 눌리는데, 그러면 되돌릴 방법이 없었습니다.
   * 「x로 레퍼런스 이미지 지울 때 한번 물어봐야 할 것 같아」 (지시 51)
   */
  const removeReference = async (id: string) => {
    const target = (entity.references || []).find((image) => image.id === id);
    // 부모 시트(정체성 기준)와 원본 인물에서 빌려 온 그림(owner-…)은 «이 카드의 파일» 이
    // 아니라 부모 것입니다. 목록에서만 빠지고 파일은 그대로 둡니다 — 지우면 원본 인물의
    // 레퍼런스가 사라집니다. 예전 것은 sharedFile 표시가 없어 id 로도 알아봅니다.
    // 같은 폴더를 쓰는 다른 카드(부모·형제 변형·보유 에셋)의 파일도 «이 카드의 파일» 이 아닙니다.
    // 폴더 다시 읽기가 잘못 붙여 둔 것을 X 로 빼다 부모 파일을 지우면 안 됩니다(2026-09-08).
    const claimedByOthers = Boolean(target?.filePath) && (options.claimedPaths?.().has(target?.filePath || "") ?? false);
    const borrowed =
      Boolean(target?.isParentReference) ||
      Boolean(target?.sharedFile) ||
      (target?.id || "").startsWith("owner-") ||
      claimedByOthers;
    const deletesFile = Boolean(target?.filePath) && !borrowed;

    if (borrowed && target?.filePath) {
      toast.success("목록에서 뺐습니다. 파일은 다른 카드(원본 인물 등) 것이라 남습니다.");
    }
    if (deletesFile) {
      const ok = await confirmDialog({
        title: `${target?.name || target?.label || "레퍼런스"} 을 지울까요?`,
        description: "저장 폴더의 원본 파일도 함께 지워집니다. 되돌릴 수 없습니다.",
        confirmLabel: "지우기",
        tone: "danger",
      });
      if (!ok) return;
    }

    patch((current) => ({
      references: (current.references || []).filter((image) => image.id !== id),
    } as Partial<T>));

    // 화면 삭제 = 폴더 파일도 삭제. 남겨 두면 폴더를 다시 읽을 때 되살아납니다.
    if (deletesFile && target?.filePath) {
      void deleteProjectMediaFile(options.projectName, target.filePath);
    }
  };

  /**
   * 레퍼런스 한 장을 **다른 파일로 갈아 끼웁니다.** 자리와 태그(@ref_N)는 그대로.
   *
   * 「변형 레퍼런스 이미지에 들어가 있는 이미지를 다른 걸로 교체를 못하네..
   * 하나는 픽스야」 (지시 215·217). 빼고 다시 넣으면 순서가 뒤로 가서 태그
   * 번호가 바뀝니다. 그러면 「@ref_1 의 헤어로」 라고 적어 둔 글이 딴 그림을
   * 가리킵니다. 그래서 빼지 않고 그 자리에서 바꿉니다.
   *
   * 부모 시트(정체성 기준)도 바꿀 수 있습니다 — 얼굴만 잘라 낸 클로즈업으로
   * 갈아 끼우는 것이 이 기능의 목적입니다. 다만 부모 파일은 부모 것이라
   * 지우지 않습니다.
   */
  const replaceReference = async (id: string, file: File) => {
    const [picked] = filterImageFiles([file]);
    if (!picked) {
      toast.error("이미지 파일만 넣을 수 있습니다.");
      return;
    }
    const target = (entity.references || []).find((image) => image.id === id);
    if (!target) return;

    const thumb = URL.createObjectURL(picked);
    patch((current) => ({
      references: (current.references || []).map((image) =>
        image.id === id
          ? { ...image, thumb, file: picked, filePath: undefined, name: picked.name.replace(/\.[^.]+$/, "") }
          : image,
      ),
    } as Partial<T>));

    // 옛 파일은 이 카드 것일 때만 지웁니다. 부모 시트는 부모 것입니다.
    if (target.filePath && !target.isParentReference) {
      void deleteProjectMediaFile(options.projectName, target.filePath);
    }

    if (!options.projectName.trim()) {
      toast.warning("프로젝트 제목을 먼저 정하세요. 그래야 그림이 폴더에 저장됩니다.");
      return;
    }
    const saved = await saveProjectMediaAsset(picked, {
      projectName: options.projectName,
      assetType: options.referenceAssetType,
      ownerName: options.ownerName || name || KIND_FALLBACK[kind],
      stem: options.stem,
    }).catch(() => null);
    if (!saved) return;
    patch((current) => ({
      references: (current.references || []).map((image) =>
        image.id === id ? { ...image, filePath: saved.path, name: saved.name } : image,
      ),
    } as Partial<T>));
  };

  // ── 레퍼런스 분석 ───────────────────────────────────────────────────────

  /**
   * 분석 칸을 채우고 「받아 둔 분석」 에 쌓습니다. 둘이 늘 같이 일어나야 합니다.
   *
   * 예전에는 재분석도 붙여넣기도 `analysis` 만 덮어써서, 앞의 분석이 그 자리에서
   * 사라졌습니다. 손으로 다듬어 둔 문장까지 같이요. (2026-09-08). 프롬프트의 `applyPrompt`
   * 와 같은 길입니다 — API 로 받든 붙여넣든 여기를 지나야 이력이 한 벌로 남습니다.
   *
   * **텍스트 칸을 손으로 고칠 때는 부르지 않습니다.** 글자마다 한 줄씩 쌓입니다.
   */
  const applyAnalysis = (text: string, note?: string, textEn?: string) =>
    patch((current) => {
      // 덮어쓰기 **전** 칸도 남깁니다. 이 기능 전에 받은 분석(이력 없음)이나 손으로 다듬은
      // 문장은 이력에 없어서, 새 답이 오는 순간 영영 사라졌습니다(검토 2026-09-08).
      const before = current.analysis?.trim() || "";
      const newest = current.analysisHistory?.[0]?.text.trim() ?? "";
      const kept =
        before && newest !== before
          ? appendAnalysisHistory(current.analysisHistory, { text: before, note: "덮어쓰기 전" })
          : current.analysisHistory;
      return {
        analysis: text,
        // 영문 한 벌. 없으면 예전 값을 지우지 않습니다 — 손으로 넣어 둔 것이 있을 수 있습니다.
        ...(textEn?.trim() ? { analysisEn: textEn.trim() } : {}),
        analysisLoading: false,
        analysisHistory: appendAnalysisHistory(kept, { text, note }),
      } as Partial<T>;
    });

  /**
   * 분석을 무슨 조건으로 받았는지 한 줄. 목록에서 «3장짜리» 와 «4장짜리» 를 가르는 근거입니다.
   *
   * 장수는 **실제로 보낸 그림 수**를 받습니다. 답이 오는 몇 십 초 사이에 레퍼런스를
   * 더 넣었을 수 있어서, 그때 세면 보낸 것과 다른 수가 적힙니다.
   */
  const analysisConditions = (sentImageCount: number) => {
    // 분석에 쓰는 LLM 은 설정의 작업별 모델입니다. 카드의 `promptModel` 은 그림 모델이라 다른 것입니다.
    let model: string | undefined;
    try {
      model = getTaskModels()[options.analysisTask][getActiveProvider()].model;
    } catch {
      model = undefined;
    }
    return describeRunConditions({
      referenceCount: sentImageCount,
      model,
    });
  };

  /**
   * 레퍼런스를 보고 무엇이 보이는지 적습니다.
   *
   * **답은 늘 한국어입니다.** 예전에는 어떤 때는 JSON, 어떤 때는 영문 서술이
   * 와서 화면에 그대로 붙었습니다. 요청 문구에 못을 박아 뒀고, 그래도 JSON 이
   * 오면 `plainAnalysisText` 가 풀어 줍니다.
   */
  const runAnalysis = async () => {
    const images = referenceSources();
    if (!images.length) {
      toast.error("분석할 레퍼런스 이미지가 없습니다.");
      return;
    }

    /*
      이미 분석이 있으면 먼저 묻습니다. 프롬프트의 runPrompt 와 같은 이유입니다.

      몇 십 초와 요금을 들여 받은 데다 손으로 다듬은 문장이 얹혀 있을 수 있는데,
      말없이 덮어쓰면 그것이 사라진 것처럼 보입니다. 「받아 둔 분석」 에 남긴 하지만,
      되돌리려면 그것을 찾아 눌러야 한다는 것을 알아야 합니다.
    */
    if (entity.analysis?.trim()) {
      const ok = await confirmDialog({
        title: "지금 분석을 새로 받을까요?",
        description: "지금 것은 「받아 둔 분석」 에 남으니 되돌릴 수 있습니다.",
        confirmLabel: "새로 받기",
      });
      if (!ok) return;
    }

    setAnalysisBusy(true);
    patch(() => ({ analysisLoading: true } as Partial<T>));
    try {
      const result = await requestJsonFromLlm<{
        appearance?: string;
        appearanceEn?: string;
        analysis?: string;
      }>({
        task: options.analysisTask,
        template: options.analysisTemplate,
        // 기록에 「여울 · 레퍼런스 분석」 처럼 뜹니다. 어느 카드의 요청인지
        // 안 적으면 여러 개를 돌렸을 때 목록에서 구분이 안 됩니다.
        label: `${name || "이름 없음"} · 레퍼런스 분석`,
        deliveredTo: `${name || "이름 없음"} · 이미지 분석 칸에 넣음`,
        data: {
          project: options.projectContext?.facts ?? null,
          name,
          description: options.description,
          references: referenceTags(),
        },
        images,
        onStarted: (id) => {
          analysisJob.current = id;
        },
      });
      const text = plainAnalysisText(result.appearance || result.analysis || "");
      /*
        **영문 한 벌도 받아 둡니다.**

        여태
        한국어 분석문이 **영문 프롬프트에도 그대로** 실렸습니다. 생성기는 그 부분을
        통째로 무시하거나 글자로 그려 넣습니다. 분석을 받을 때 한 번에 둘을 받으면
        요청이 늘지 않으면서 그 구멍이 막힙니다.
      */
      const textEn = plainAnalysisText(result.appearanceEn || "");
      // 값이 아니라 함수로 — 기다리는 동안 다른 칸을 만졌어도 그것을 지우지 않습니다.
      applyAnalysis(text, analysisConditions(images.length), textEn);
      toast.success("레퍼런스를 분석했습니다.");
    } catch (error) {
      patch(() => ({ analysisLoading: false } as Partial<T>));
      if (isLlmCancel(error)) toast.message("분석을 중지했습니다.");
      else toast.error(String(error));
    } finally {
      analysisJob.current = null;
      setAnalysisBusy(false);
    }
  };

  /** 「중지」 — 돌고 있는 분석 요청을 끊습니다. 끊기면 위 catch 가 로딩을 끕니다. */
  const cancelAnalysis = async () => {
    const id = analysisJob.current;
    if (!id) return;
    await cancelLlmJob(id);
  };

  // ── 첫 레퍼런스 프롬프트 ────────────────────────────────────────────────
  //
  // 아래 «프롬프트 작성» 과 정반대의 자리입니다. 저쪽은 **그림이 있을 때** 그것을 보고
  // 시트를 뽑는 것이고, 여기는 **그림이 한 장도 없을 때** 설정만으로 첫 장을 뽑습니다.
  //

  /**
   * 어느 이미지 모델 문법으로 쓸지.
   *
   * 카드의 `promptModel`(시트용)과 **따로** 둡니다 — 첫 장은 미드저니로 뽑고 시트는
   * 나노 바나나로 가는 것이 정상적인 사용법입니다. 영상 모델은 고를 수 없습니다.
   */
  const firstReferenceModelId = () => normalizeImageModelId(entity.firstReferenceModel);

  /**
   * 결과 칸에 넣습니다. API 로 받든 「LLM 요청문」 으로 붙여넣든 이 길을 지납니다.
   *
   * JSON 을 통째로 붙여넣어도 프롬프트만 꺼냅니다. 요청 문구가 JSON 을 내라고 하니
   * 웹에서 받아 오는 사람은 `{"prompt": …}` 를 그대로 복사합니다. 그걸 그대로 두면
   * 중괄호와 따옴표가 생성기에 들어갑니다(`plainAnalysisText` 와 같은 이유).
   */
  const applyFirstReference = (raw: string) => {
    const text = raw.trim();
    /*
      **한글·영문 두 칸**으로 나눠 넣습니다.

      한 칸만 온 옛 답(`{"prompt": …}`)이나 사람이 손으로 붙여넣은 글도 받아야 합니다 —
      그때는 한글이 섞여 있으면 한글 칸, 아니면 영문 칸으로 보냅니다. 두 칸을 만들면서
      «어느 칸인지 모르겠으니 버린다» 로 두면, 웹에서 받아 붙여넣는 길이 통째로 죽습니다.
    */
    let ko = "";
    let en = "";
    if (text.startsWith("{") || text.startsWith("```")) {
      try {
        const parsed = parseJsonResponse<{
          ko?: string;
          en?: string;
          prompt?: string;
          text?: string;
        }>(text);
        ko = (parsed.ko || "").trim();
        en = (parsed.en || "").trim();
        if (!ko && !en) {
          const one = (parsed.prompt || parsed.text || "").trim();
          if (/[가-힣]/.test(one)) ko = one;
          else en = one;
        }
      } catch {
        // JSON 이 아니면 붙여넣은 글 그대로 둡니다. 사람이 손으로 쓴 프롬프트일 수 있습니다.
      }
    }
    if (!ko && !en) {
      if (/[가-힣]/.test(text)) ko = text;
      else en = text;
    }
    patch(
      () =>
        ({
          ...(ko ? { firstReferencePromptKo: ko } : {}),
          ...(en ? { firstReferencePromptEn: en } : {}),
        }) as Partial<T>,
    );
  };

  /**
   * 요청에 싣는 재료 — **한 벌**.
   *
   * `runFirstReference` 와 「LLM 요청문」 단추가 같은 함수를 씁니다. 따로 조립하면
   * 창에 보이는 요청문과 실제로 보낸 것이 달라집니다(promptRequestPayload 와 같은 이유).
   *
   * `kind`·`modelId`·`spaceKind` 는 문자열이라 그대로 `::when` 변수가 됩니다 —
   * 요청 문구가 인물·장소·물건과 모델 문법에 따라 다른 문단을 고릅니다.
   */
  const firstReferencePayload = () => ({
    project: options.projectContext?.facts ?? null,
    kind,
    name,
    description: options.description,
    // 키·체형·역할처럼 그림에서 읽을 수 없는 값. 인물 카드만 줍니다.
    basics: options.basics ?? null,
    // 이 자리는 대개 레퍼런스가 없어서 비어 있습니다. 있으면 재료로 씁니다.
    analysis: entity.analysis || null,
    spaceKind: options.spaceKind ?? null,
    modelId: firstReferenceModelId(),
    modelLabel: modelLabel(firstReferenceModelId()),
  });

  const runFirstReference = async () => {
    // 이미 받아 둔 것이 있으면 먼저 묻습니다. 이 칸에는 이력이 없어서(첫 장을 뽑고 나면
    // 쓸 일이 없는 칸이라 이력까지 두지 않았습니다) 덮어쓰면 되돌릴 수 없습니다.
    if (
      entity.firstReferencePromptKo?.trim() ||
      entity.firstReferencePromptEn?.trim() ||
      entity.firstReferencePrompt?.trim()
    ) {
      const ok = await confirmDialog({
        title: "첫 레퍼런스 프롬프트를 새로 받을까요?",
        description: "지금 칸의 글은 사라집니다. 되돌릴 수 없으니 필요하면 먼저 복사해 두세요.",
        confirmLabel: "새로 받기",
      });
      if (!ok) return;
    }

    setFirstReferenceBusy(true);
    try {
      const result = await requestJsonFromLlm<{
        ko?: string;
        en?: string;
        prompt?: string;
        text?: string;
      }>({
        task: "firstReference",
        template: "first-reference",
        label: `${name || "이름 없음"} · 첫 레퍼런스 프롬프트`,
        deliveredTo: `${name || "이름 없음"} · 첫 레퍼런스 프롬프트 칸에 넣음`,
        // 모델 가이드를 함께 싣습니다. 미드저니와 스테이블 디퓨전은 글의 모양 자체가 달라서,
        // 가이드 없이는 어느 쪽으로 써도 되는 밋밋한 문장이 옵니다.
        modelId: firstReferenceModelId(),
        data: firstReferencePayload(),
        // 그림은 **일부러 안 보냅니다.** 레퍼런스 없이 첫 장을 뽑는 자리입니다.
        onStarted: (id) => {
          firstReferenceJob.current = id;
        },
      });
      // 키 이름이 조금 달라도 살려 냅니다(promptRequest 의 관대한 파싱과 같은 이유).
      const ko = (result.ko || "").trim();
      const en = (result.en || "").trim();
      const one = (result.prompt || result.text || "").trim();
      if (!ko && !en && !one)
        throw new Error("답에 프롬프트가 없습니다. 「LLM 요청문」 으로 다시 받아 보세요.");
      // 두 칸을 한 번에 넣습니다. 칸마다 따로 부르면 뒤 호출이 앞 호출을 덮어씁니다.
      if (ko || en)
        patch(
          () =>
            ({
              ...(ko ? { firstReferencePromptKo: ko } : {}),
              ...(en ? { firstReferencePromptEn: en } : {}),
            }) as Partial<T>,
        );
      else applyFirstReference(one);
      toast.success("첫 레퍼런스 프롬프트를 받았습니다 — 한글·영문 두 칸.");
    } catch (error) {
      if (isLlmCancel(error)) toast.message("첫 레퍼런스 프롬프트 작성을 중지했습니다.");
      else toast.error(String(error));
    } finally {
      firstReferenceJob.current = null;
      setFirstReferenceBusy(false);
    }
  };

  /** 「중지」 — 돌고 있는 첫 레퍼런스 요청을 끊습니다. */
  const cancelFirstReference = async () => {
    const id = firstReferenceJob.current;
    if (!id) return;
    await cancelLlmJob(id);
  };

  // ── 프롬프트 ────────────────────────────────────────────────────────────

  /** 지금 조건을 한 줄로. 이력 목록에서 어느 판인지 알아보게 합니다. */
  const conditions = (extra?: string) =>
    sheetRunConditions({
      extra,
      kind,
      blueprint,
      spaceKind: options.spaceKind,
      referenceCount: (entity.references || []).length,
      hasAnalysis: Boolean(entity.analysis?.trim()),
      model: entity.promptModel,
    });

  /** 네 칸을 채우고 이력에 쌓습니다. 둘이 늘 같이 일어나야 합니다 — 규칙은 `withPromptResult` 한 곳에. */
  const applyPrompt = (
    result: { ko: string; en: string; negativeKo: string; negativeEn: string },
    label: string,
  ) => patch((current) => withPromptResult(current, result, label));

  /** API 없이 규칙으로 조립합니다. 실패했을 때의 대비이자, 키가 없을 때의 길입니다. */
  const buildByRule = (references: ReferenceImage[] = entity.references || []) =>
    buildRulePrompt({
      kind,
      name,
      description: options.description,
      blueprint: blueprint,
      context: options.projectContext,
      referenceCount: (entity.references || []).length,
      referenceMode: entity.referenceMode,
      analysis: entity.analysis,
      analysisEn: entity.analysisEn,
      spaceKind: options.spaceKind,
      basics: options.basics,
      basicsEn: options.basicsEn,
      references: referenceTags(references).map((tag) => ({ mention: tag.tag, isIdentity: tag.isIdentity })),
      templateMention: kind === "background" ? templateMentionOf(references) : null,
      // «도면 + 동선» 칩의 화살표 설명. 표시가 없으면 칩이 기본 문장을 씁니다.
      marks: identityMarks(),
      // 앵커 파노라마의 공간 넓이 — 앵커 자리와 함께 벽까지의 거리가 됩니다.
      space: kind === "background" ? spaceForChips(blueprint, entity.panoramaSpace, entity.exteriorSpace) : null,
    });

  /** 정체성 그림(첫 번째 레퍼런스) 위의 표시. 배경일 때만 — 규칙은 `identityMarksOf`(lib). */
  const identityMarks = () => identityMarksOf(kind, entity.references || [], imageMarks);

  /**
   * 프롬프트 작성 요청에 싣는 데이터 — **한 벌**.
   *
   * 예전에는 `runPrompt` 와 「LLM 요청문」 단추(`promptRequestData`)가 같은 것을 따로 조립했고,
   * 앵커를 한쪽에만 넣으면 창에 보이는 요청문과 실제로 보낸 것이 달라집니다. 한 함수로 둡니다.
   * 몸통은 `lib/promptPayloads.sheetRequestPayload` 로 옮겼습니다(2026-09-22) — 「AI 일괄 생성」
   * 4단계가 화면 없이 같은 재료를 지어야 해서입니다. 여기서는 훅만 아는 것(앵커·틀 태그·레퍼런스)을 모읍니다.
   */
  const promptRequestPayload = (references: ReferenceImage[] = entity.references || []) =>
    sheetRequestPayload({
      kind,
      name,
      description: options.description,
      projectFacts: options.projectContext?.facts ?? null,
      entity,
      blueprint,
      spaceKind: options.spaceKind,
      basics: options.basics,
      basicsEn: options.basicsEn,
      identityMarks: identityMarks(),
      templateMention: kind === "background" ? templateMentionOf(references) : null,
      references: referenceTags(references),
    });

  /*
    ── 전개도 틀 그림을 레퍼런스에 자동으로 ────────────────────────────────
     전개도 칩은 **칸 틀 그림이 있어야** 칸 크기를 지킵니다(글로 적으면 안 지킴 — unfoldPrompt 머리말).
    처음엔 «틀 그림 넣기» 단추를 따로 뒀는데, 누르는 걸 잊으면 전개도가 제멋대로 나옵니다. 프롬프트를 만드는
    순간(API·규칙 둘 다) 방 크기의 틀이 없으면 넣어 둡니다 — 레퍼런스라 «구성» 으로 보낼 때 저절로 함께 올라갑니다.

    꼬리표(`label`)로 알아봅니다. 저장되면 파일 이름이 «ref_장소_001» 로 바뀌어 이름으로는 못 찾기 때문입니다.
    방 크기가 바뀌면 새 틀을 하나 더 넣습니다 — 옛 틀은 사람이 ✕ 로 뺍니다(빼면 파일도 지워지니 말없이 안 지웁니다).
    등장방형은 틀이 필요 없어 아무것도 안 합니다.
  */
  const ensureUnfoldTemplate = async (): Promise<ReferenceImage[]> => {
    // 한 번에 하나 — 크기 칸을 고친 뒤의 자동 갈아 끼우기와 «프롬프트 작성» 이 겹치면 틀이 둘 생깁니다.
    if (templateJob.current) return templateJob.current;
    const job = writeUnfoldTemplate().finally(() => {
      templateJob.current = null;
    });
    templateJob.current = job;
    return job;
  };

  const writeUnfoldTemplate = async (): Promise<ReferenceImage[]> => {
    const current = entity.references || [];
    const wanted = unfoldTemplateWanted();
    if (!wanted) return current;
    const { box, label } = wanted;
    if (current.some((image) => image.label === label)) return current;
    // 실외·방 모두 바탕과 거의 같은 회색 칸 틀 — 색 틀은 테두리로 남고 벽을 물들였습니다(`buildUnfoldTemplate` 주석).
    const { canvas } = buildUnfoldTemplate(box, 2160, true, wanted.horizon);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return current;
    const file = new File([blob], `전개도 틀.png`, { type: "image/png" });

    /*
      ── 크기가 바뀌었으면 **그 자리를 갈아 끼웁니다** ─────────────────────────
      
      예전엔 크기가 바뀌면 새 틀을 **하나 더** 붙였습니다 — 옛 틀도 «구성» 으로 같이 올라가고, 프롬프트 태그는 목록에서
      먼저 나오는 옛 틀을 불렀습니다. 그래서 앱이 지은 틀(꼬리표 «전개도 틀»)은 한 장만 두고 그림을 바꿔 끼웁니다.
      옛 틀 파일은 지웁니다 — 사람이 올린 그림이 아니라 앱이 방 크기로 그린 그림이고, 남기면 폴더를 다시 읽을 때
      옛 비율의 틀이 되살아나 같은 혼동이 납니다(레퍼런스 «갈아 끼우기» 와 같은 규칙).
    */
    const old = current.find((image) => isUnfoldTemplateReference(image) && !image.isParentReference && !image.sharedFile);
    if (old) {
      const thumb = URL.createObjectURL(file);
      patch((latest) => ({
        references: (latest.references || []).map((image) =>
          image.id === old.id ? { ...image, thumb, file, filePath: undefined, label } : image,
        ),
      } as Partial<T>));
      if (old.filePath) void deleteProjectMediaFile(options.projectName, old.filePath);
      let replaced: ReferenceImage = { ...old, thumb, file, filePath: undefined, label };
      if (options.projectName.trim()) {
        const saved = await saveProjectMediaAsset(file, {
          projectName: options.projectName,
          assetType: options.referenceAssetType,
          ownerName: options.ownerName || name || KIND_FALLBACK[kind],
          stem: options.stem,
        }).catch(() => null);
        if (saved) {
          replaced = { ...replaced, filePath: saved.path, name: saved.name };
          patch((latest) => ({
            references: (latest.references || []).map((image) =>
              image.id === old.id ? { ...image, filePath: saved.path, name: saved.name } : image,
            ),
          } as Partial<T>));
        }
      }
      toast.message(`전개도 틀을 ${label.replace("전개도 틀 ", "")} 로 바꿨습니다`, {
        description: "크기나 틀 모양이 바뀌어 칸을 다시 그렸습니다. 프롬프트도 다시 받아야 치수가 맞습니다.",
        id: "unfold-template",
      });
      return current.map((image) => (image.id === old.id ? replaced : image));
    }

    const added = await addReferenceFiles([file], { label });
    toast.message(`${label} 그림을 레퍼런스에 넣었습니다`, {
      description: "칸 자리대로 그리게 하는 틀입니다 — 프롬프트가 태그로 부르고, «구성» 으로 보낼 때 함께 올라갑니다.",
      id: "unfold-template",
    });
    return [...current, ...added];
  };

  /** 지금 칩·크기에 맞는 틀. 전개도 칩이 아니거나 방 크기가 비었으면 null. */
  const unfoldTemplateWanted = () => {
    // 파노라마 돔은 틀 그림 없이 한 장을 뽑습니다(`DOME_CHIP_ID`).
    if (kind !== "background" || !blueprint.some((id) => isUnfoldChipId(id) && id !== DOME_CHIP_ID)) return null;
    /*
      실외 큐브맵은 칸이 늘 정사각이라 크기와 상관없이 같은 틀입니다 — 한 변을 안 넣어도 넣습니다.
      방은 가로·깊이·층고가 칸 비율이라 크기가 차야 짓습니다.
    */
    const cube = blueprint.includes(CUBEMAP_CHIP_ID);
    const space = entity.panoramaSpace;
    if (!cube && !spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, space)) return null;
    const box = cube ? { width: 1, depth: 1, height: 1 } : panoramaBoxOf(space!, true);
    /*
      꼬리표가 바뀌면 옛 틀을 갈아 끼웁니다. «· 회색» 을 붙인 까닭 — 2026-09-15 에 틀을 색 칸·밝은 회색 칸에서 **바탕과 거의 같은
      회색 칸**으로 바꿨는데, 꼬리표가 같으면 이미 틀이 있는 카드가 옛 틀을 그대로 올립니다.
    */
    // 실외 틀은 옆 칸에 지평선(아래 절반 조금 어둡게)을 넣은 판 — 꼬리표가 달라 옛 틀이 저절로 갈립니다.
    const label = cube ? "전개도 틀 실외 · 지평선" : `전개도 틀 ${box.width}×${box.depth}×${box.height} m · 회색`;
    return { box, label, horizon: cube };
  };

  /*
    크기 칸을 고치면(칩을 바꾸면) **이미 틀이 있는 카드에서는** 곧바로 갈아 끼웁니다 — 레퍼런스 줄의 틀이 지금 방 비율로
    보여야 «바뀌나?» 를 눈으로 압니다. 숫자를 치는 동안(12 → 1 → 12) 파일을 여러 번 쓰지 않게 잠깐 기다립니다.
    틀이 아직 없는 카드에는 여기서 새로 넣지 않습니다 — 넣는 것은 프롬프트를 만들 때입니다.
  */
  const templateJob = useRef<Promise<ReferenceImage[]> | null>(null);
  const ensureRef = useRef(ensureUnfoldTemplate);
  ensureRef.current = ensureUnfoldTemplate;
  const wantedLabel = unfoldTemplateWanted()?.label ?? null;
  const hasTemplate = (entity.references || []).some(isUnfoldTemplateReference);
  const templateStale = Boolean(
    wantedLabel && hasTemplate && !(entity.references || []).some((image) => image.label === wantedLabel),
  );
  useEffect(() => {
    if (!templateStale) return;
    const timer = window.setTimeout(() => void ensureRef.current(), 900);
    return () => window.clearTimeout(timer);
  }, [templateStale, wantedLabel]);

  /*
    전개도 칩이면 LLM 답(en·ko)은 **장소 묘사**입니다(요청 템플릿 `::when anchorKind=unfold`). 앱이 틀·칸·카메라 문장
    안에 끼워 완결 프롬프트로 만듭니다 — 규칙은 lib 의 `withUnfoldFrame` 한 벌(「AI 일괄 생성」 4단계가 같은 것을 씁니다).
    여기서는 플랫폼과 이 카드의 칩·공간만 보탭니다.
  */
  const withUnfoldFrame = (
    result: { ko: string; en: string; negativeKo: string; negativeEn: string },
    references: ReferenceImage[],
  ) => withUnfoldFrameOf(result, { kind, blueprint, entity, references, platform: getTargetPlatform() });

  const runPrompt = async () => {
    /*
      이미 프롬프트가 차 있으면 먼저 묻습니다. (지시 110)

      프롬프트 한 벌을 받는 데 몇 십 초와 요금이 듭니다. 그걸 말없이
      덮어쓰면 방금 손본 문장이 사라집니다. 「받아 둔 프롬프트」 에 쌓이긴
      하지만, 되돌리려면 그것을 찾아 눌러야 한다는 것을 알아야 합니다.
    */
    const filled = [entity.promptKo, entity.promptEn, entity.negativeKo, entity.negativeEn].some(
      (text) => text?.trim(),
    );
    if (filled) {
      const ok = await confirmDialog({
        title: "지금 프롬프트를 새로 받을까요?",
        description:
          "네 칸이 새 값으로 바뀝니다. 지금 것은 「받아 둔 프롬프트」 에 남으니 되돌릴 수 있습니다.",
        confirmLabel: "새로 받기",
      });
      if (!ok) return;
    }

    setPromptBusy(true);
    patch(() => ({ promptLoading: true } as Partial<T>));
    /*
      전개도 틀을 **요청을 짓기 전에** 넣고 그 목록으로 짓습니다. 예전엔 넣기만 하고 요청은 옛 목록으로 지어서, 틀이
      레퍼런스에 들어가도 프롬프트에 그 @태그가 없었습니다().
    */
    const references = await ensureUnfoldTemplate();
    try {
      const result = await requestPromptFromLlm({
        onStarted: (id) => {
          promptJob.current = id;
        },
        label: `${name || "이름 없음"} · 프롬프트 작성`,
        deliveredTo: `${name || "이름 없음"} · 프롬프트 네 칸에 넣음`,
        task: options.promptTask,
        template: options.promptTemplate,
        modelId: entity.promptModel,
        /*
          **고른 플랫폼을 요청에 실어 보냅니다.** (지시 128)

          마그니픽은 `@파일이름`, 컴피UI 는 `<picture 1>` 로 레퍼런스를
          가리킵니다. 같은 모델이라도 어디에 붙여넣느냐에 따라 문법이
          달라져요. 예전에는 화면에서 고르기만 하고 요청에는 안 넘겨서,
          마그니픽용으로 골라도 프롬프트가 그대로 나왔습니다.
        */
        platformId: getTargetPlatform(),
        data: promptRequestPayload(references),
        images: referenceSources(),
      });
      applyPrompt(withUnfoldFrame(result, references), conditions());
      toast.success("프롬프트를 받았습니다.");
    } catch (error) {
      if (isLlmCancel(error)) {
        // 중지는 실패가 아닙니다. 규칙 조립으로 덮지 않고 로딩만 끕니다.
        patch(() => ({ promptLoading: false } as Partial<T>));
        toast.message("프롬프트 작성을 중지했습니다.");
      } else {
        // 실패해도 빈 칸을 보여 주지 않습니다. 규칙으로 조립한 것이라도 바탕은 됩니다.
        applyPrompt(buildByRule(references), conditions("규칙 조립"));
        toast.error(`API 요청이 실패해 규칙으로 조립했습니다. ${error}`);
      }
    } finally {
      promptJob.current = null;
      setPromptBusy(false);
    }
  };

  /** 「중지」 — 돌고 있는 프롬프트 요청을 끊습니다. */
  const cancelPrompt = async () => {
    const id = promptJob.current;
    if (!id) return;
    await cancelLlmJob(id);
  };

  const applyByRule = async () => {
    const references = await ensureUnfoldTemplate();
    applyPrompt(buildByRule(references), conditions("규칙 조립"));
    toast.success("규칙으로 조립했습니다.");
  };

  return {
    busy,
    analysisBusy,
    promptBusy,
    previewOf,
    referenceSources,
    addReferenceFiles,
    removeReference,
    replaceReference,
    runAnalysis,
    cancelAnalysis,
    /** 분석 칸을 채우면서 「받아 둔 분석」 에 쌓습니다. 붙여넣기도 이 길로 옵니다. */
    applyAnalysis,
    firstReferenceBusy,
    /** 지금 고른 이미지 모델 id. 화면의 드롭다운이 이 값을 보여 줍니다. */
    firstReferenceModelId,
    runFirstReference,
    cancelFirstReference,
    /** 결과 칸에 넣습니다. 「LLM 요청문」 으로 받은 답도 이 길로 옵니다. */
    applyFirstReference,
    /** 첫 레퍼런스 LLM 요청문 버튼에 넘길 데이터. 위 runFirstReference 와 같은 함수입니다. */
    firstReferenceRequestData: firstReferencePayload,
    /** 분석 LLM 요청문 버튼에 넘길 데이터. 위 runAnalysis 와 같은 것이어야 합니다. */
    analysisRequestData: () => ({
      project: options.projectContext?.facts ?? null,
      name,
      description: options.description,
      references: referenceTags(),
    }),
    runPrompt,
    cancelPrompt,
    applyByRule,
    applyPrompt,
    conditions,
    /** LlmRequestButton 에 넘길 요청 데이터. 위 runPrompt 와 같은 함수라 어긋날 수 없습니다. */
    promptRequestData: promptRequestPayload,
    /** 정체성 그림 위 표시 — 구성 칸이 앵커에서 벽까지의 거리를 미리 보여 주는 데 씁니다. */
    identityMarks,
  };
}

// «전개도 틀로 넣은 레퍼런스인가»(`isUnfoldTemplateReference`)는 lib 로 — 태그 셈과 같은 자리에 있어야 합니다.

const KIND_FALLBACK: Record<BlueprintKind, string> = {
  character: "캐릭터",
  background: "배경",
  asset: "에셋",
};
