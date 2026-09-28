import type { SavedAnalysisEntry, SavedPromptEntry } from "@/lib/promptHistory";

/**
 * 캐릭터·배경·에셋 카드가 공통으로 들고 있는 것.
 *
 * 셋은 겉보기가 달라도 하는 일이 같습니다 — 레퍼런스를 모으고, 무엇을 뽑을지
 * 고르고, LLM 에 프롬프트를 부탁하고, 받은 것을 네 칸에 넣습니다.
 * 그 공통분모를 여기 두고 세 곳이 같이 씁니다. 한 곳에서 고치면 셋이 함께
 * 바뀌게 하려는 것입니다. 예전에 세 군데에 복사해 뒀다가, 한 곳만 고치고
 * 나머지를 빠뜨리는 일이 반복됐습니다.
 *
 * 사고로 잃어 기록의 조각(하단 함수들)과 남은 설계 기록으로 다시 쓴 파일입니다.
 */

/**
 * 레퍼런스를 어떻게 쓸지.
 *
 * - none — 이미지를 무시하고 설명만으로 만듭니다.
 * - keep — 레퍼런스 속 그것이 곧 이것입니다. 같은 것으로 보여야 합니다.
 * - blend — 여러 장에서 요소를 골라 새로 만듭니다. 어느 한 장과도 같으면 안 됩니다.
 *
 * **같은 요청문이라도 이게 달라지면 결과가 완전히 달라집니다.** 그런데 모델은
 * 이걸 스스로 판단할 수 없습니다. 레퍼런스를 걸어 두면 대개 통째로 흉내 내는
 * 쪽으로 기울어서, 「이 옷만 참고하고 얼굴은 새로」 같은 의도가 전달되지 않습니다.
 */
export type ReferenceMode = "none" | "keep" | "blend";

export interface ReferenceModeOption {
  id: ReferenceMode;
  label: string;
  hint: string;
  /** 프롬프트에 실제로 들어가는 말 */
  english: string;
}

/**
 * 갈래마다 말이 다릅니다.
 *
 * 캐릭터에게 «그대로» 는 «같은 사람» 이고, 배경에게는 «같은 장소» 입니다.
 * 한 낱말로 뭉뚱그리면 어느 쪽도 정확히 전달되지 않습니다.
 */
export const REFERENCE_MODE_OPTIONS_BY_KIND: Record<
  "character" | "background" | "asset",
  ReferenceModeOption[]
> = {
  character: [
    {
      id: "keep",
      label: "이 인물 그대로",
      hint: "레퍼런스 속 인물과 같은 사람으로 만듭니다",
      english:
        "the reference shows the same character; keep the face, body proportions and identity identical and only fill in what the reference does not show",
    },
    {
      id: "blend",
      label: "요소만 참고",
      hint: "여러 장에서 특징을 골라 새 인물을 만듭니다",
      english:
        "borrow only the elements named in the description; this is a new person and must not match any single reference face",
    },
    {
      id: "none",
      label: "참고 안 함",
      hint: "이미지를 무시하고 아래 설명만으로 만듭니다",
      english: "ignore the attached images entirely and build only from the written description",
    },
  ],
  background: [
    {
      id: "keep",
      label: "이 장소 그대로",
      hint: "레퍼런스 속 장소와 같은 곳으로 만듭니다",
      english:
        "the reference shows the same place; keep its layout, terrain and architecture identical and only fill in what the reference does not show",
    },
    {
      id: "blend",
      label: "요소만 참고",
      hint: "재질이나 건물 양식 같은 일부만 가져옵니다",
      english:
        "borrow only the elements named in the description; this is a new place and must not reproduce the reference's framing",
    },
    {
      id: "none",
      label: "참고 안 함",
      hint: "이미지를 무시하고 아래 설명만으로 만듭니다",
      english: "ignore the attached images entirely and build only from the written description",
    },
  ],
  asset: [
    {
      id: "keep",
      label: "이 물건 그대로",
      hint: "레퍼런스 속 물건과 같은 것으로 만듭니다",
      english:
        "the reference shows the same object; keep its shape, proportions and material identical",
    },
    {
      id: "blend",
      label: "요소만 참고",
      hint: "재질이나 장식 같은 일부만 가져옵니다",
      english: "borrow only the elements named in the description; this is a new object",
    },
    {
      id: "none",
      label: "참고 안 함",
      hint: "이미지를 무시하고 아래 설명만으로 만듭니다",
      english: "ignore the attached images entirely and build only from the written description",
    },
  ],
};

/**
 * 안 골랐을 때 무엇으로 볼지.
 *
 * 이미지가 있으면 «그대로» 입니다. 레퍼런스를 걸어 둔 이유가 대개 그것이라서요.
 * 이미지가 없으면 «참고 안 함» 말고는 뜻이 없습니다.
 */
export function resolveReferenceMode(
  mode: ReferenceMode | undefined,
  imageCount: number,
): ReferenceMode {
  if (mode) return mode;
  return imageCount > 0 ? "keep" : "none";
}

export function referenceModeOption(
  kind: "character" | "background" | "asset",
  mode: ReferenceMode,
): ReferenceModeOption {
  const options = REFERENCE_MODE_OPTIONS_BY_KIND[kind];
  return options.find((option) => option.id === mode) || options[0];
}

/** 프롬프트를 만드는 카드가 공통으로 들고 있는 것. */
export interface PromptWorkflowState<TReference = unknown, TImage = unknown> {
  /** 고른 레퍼런스 구성 칸들 */
  blueprint: string[];
  /**
   * 배경의 앵커 파노라마가 담을 **공간 넓이**(m). 파노라마 칩을 켰을 때만 씁니다.
   * 까닭은 `PanoramaSpace` 주석 — 넓이를 안 주면 생성기가 방 크기를 지어냅니다.
   */
  panoramaSpace?: { width: number; depth: number; height?: number };
  /**
   * 실외 등장방형의 **정육면체 크기**(한 변을 세 치수에). 방 크기(`panoramaSpace`)와 따로 둡니다 —
   * 까닭은 `spaceForChips` 주석.
   */
  exteriorSpace?: { width: number; depth: number; height?: number };
  references: TReference[];
  generatedImages: TImage[];
  /** 레퍼런스를 어떻게 쓸지 */
  referenceMode?: ReferenceMode;
  /**
   * 레퍼런스에서 **무엇을 지키고 무엇을 바꿀지** 사람이 적는 글.
   *
   * 화면에서는 「추가 외형 묘사」 입니다. 태그 단추(@정체성, @ref_1)를 누르면
   * 여기로 들어갑니다 — 이 글이 분석 요청에 그대로 실려 나가서, 어느 그림에서
   * 무엇을 가져올지 LLM 이 알게 됩니다.
   *
   * 캐릭터·배경·에셋·변형이 다 들고 있던 것을 여기로 올렸습니다. 공통 몸통
   * (`PromptCardBody`)이 갈래를 안 가리고 쓸 수 있어야 해서요.
   */
  description?: string;
  /** 레퍼런스 이미지를 보고 적어 둔 설명 */
  /**
   * **다른 작품에서 끌어온 카드**라면 어디서 왔는지 한 줄.
   *
   *
   * 가져온 뒤에는 저쪽과 아무 관계가 없지만(복사입니다), 「이 인물은 1편 것」 을
   * 나중에 알 수 있어야 합니다.
   */
  borrowedFrom?: string;
  analysis?: string;
  /**
   * 같은 분석의 **영어 한 벌**.
   *
   * 사용자 2026-09-18 점검에서 드러났습니다 — 한국어 분석문이 **영문 프롬프트에도 그대로**
   * 실리고 있었습니다. 생성기는 그 부분을 통째로 무시하거나 글자로 그려 넣습니다.
   * 분석을 받을 때 둘을 한 번에 받으므로 요청이 더 늘지는 않습니다.
   */
  analysisEn?: string;
  analysisLoading?: boolean;
  /**
   * «첫 레퍼런스 프롬프트» — 레퍼런스 그림이 하나도 없을 때 **설정만으로** 첫 장을
   * 뽑는 프롬프트와, 그것을 어느 이미지 모델 문법으로 쓸지.
   *
   * # 왜 여기(공통 상태)인가
   *
   * 캐릭터·배경·에셋·변형이 같은 부품을 씁니다(규칙 1). 캐릭터 쪽에만 칸을 두면
   * 배경에는 없는 기능이 되고, 예전처럼 규칙 하나를 고칠 때 나머지를 빠뜨립니다.
   *
   * # 왜 promptKo 를 재활용하지 않는가
   *
   * 아래 네 칸(promptKo/promptEn…)은 **시트 프롬프트** 입니다. 첫 레퍼런스는 그
   * 앞 단계라 성격이 다르고, 한 칸에 같이 두면 「프롬프트 작성」 이 첫 레퍼런스를
   * 말없이 덮어씁니다. 이력(promptHistory)에도 성격이 다른 글이 섞입니다.
   *
   * `firstReferenceModel` 을 `promptModel` 과 따로 두는 이유도 같습니다 — 첫 장은
   * 미드저니로 뽑고 시트는 나노 바나나로 가는 것이 정상적인 사용법입니다.
   *
   * 도는 중 표시(loading)는 **저장하지 않습니다.** 분석·프롬프트는 그 칸이 데이터에
   * 실려서, 요청이 오류·앱 종료로 끝나면 다시 열었을 때 «만드는 중…» 이 영영 돌았습니다
   * . 여기서는 처음부터 훅 안의 상태로만 둡니다.
   */
  /**
   * 첫 레퍼런스 프롬프트 — **한글·영문 두 칸**.
   *
   *
   * 모델마다 잘 듣는 말이 달라서(나노 바나나·GPT 는 한국어도 읽고, 미드저니는 영어라야
   * 합니다) 쓰는 사람이 그 자리에서 골라야 합니다.
   *
   * `firstReferencePrompt` 는 **한 칸이던 시절의 값**입니다. 지우지 않고 읽을 때
   * 영문 칸으로 옮깁니다 — 예전에 받아 둔 프롬프트가 사라지면 안 됩니다.
   */
  firstReferencePromptKo?: string;
  firstReferencePromptEn?: string;
  firstReferencePrompt?: string;
  firstReferenceModel?: string;
  promptKo: string;
  promptEn: string;
  negativeKo: string;
  negativeEn: string;
  promptLoading?: boolean;
  /** 어느 모델로 프롬프트를 뽑을지 */
  promptModel?: string;
  /**
   * 받아 둔 프롬프트들.
   *
   * 프롬프트를 두 번 돌렸다는 것은 무언가를 바꿔서 돌렸다는 뜻입니다.
   * 새로 받은 것이 앞의 것을 덮어쓰면 되돌릴 방법이 없어집니다.
   */
  promptHistory?: SavedPromptEntry[];
  /**
   * 받아 둔 분석들.
   *
   * 분석은 재분석·붙여넣기가 앞의 것을 그 자리에서 덮어써 사라졌습니다.
   * 프롬프트와 같은 방식으로 받을 때마다 남겨 되돌릴 수 있게 합니다.
   * ()
   */
  analysisHistory?: SavedAnalysisEntry[];
}

/**
 * 변형.
 *
 * 같은 캐릭터의 다른 의상, 같은 장소의 다른 시간대처럼 **원본에서 갈라져 나온
 * 판**입니다. 원본과 같은 것을 들고 있어야 해서 위 상태를 그대로 물려받습니다.
 */
export interface PromptVariationState<TReference = unknown, TImage = unknown>
  extends PromptWorkflowState<TReference, TImage> {
  id: string;
  name: string;
  /**
   * 무엇에서 갈라져 나왔는지.
   *
   * 변형의 변형을 만들 수 있어서, 원본이 아니라 바로 위 판을 가리킵니다.
   * 이걸 따라 올라가면 정체성 기준이 되는 첫 시트에 닿습니다.
   */
  parentVariationId?: string;
}

export function filterImageFiles(files: FileList | File[]) {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}


/**
 * 부모 시트를 레퍼런스 맨 앞에 세워 둡니다.
 *
 * 변형은 «원본과 같은 인물» 이어야 하므로 부모 시트가 정체성 기준입니다.
 * 맨 앞이어야 하는 이유는 프롬프트가 첫 장을 그렇게 쓰기 때문입니다.
 * 사람이 실수로 지워도 다시 세워 둡니다 — 이게 빠지면 변형이 다른 사람이 됩니다.
 */
export function ensureParentReference<T extends { isParentReference?: boolean }>(
  references: T[] | undefined,
  parentReference: T | null,
) {
  const current = references || [];
  return current.some((reference) => reference.isParentReference)
    ? current
    : parentReference
      ? [parentReference, ...current]
      : current;
}

export function createPromptVariation<TReference, TImage>({
  id,
  parentVariationId,
  name,
  promptModel,
  references,
  blueprint,
}: Pick<
  PromptVariationState<TReference, TImage>,
  "id" | "parentVariationId" | "name" | "promptModel" | "references" | "blueprint"
>): PromptVariationState<TReference, TImage> {
  return {
    id,
    parentVariationId,
    name,
    promptModel,
    references,
    blueprint,
    generatedImages: [],
    promptKo: "",
    promptEn: "",
    negativeKo: "",
    negativeEn: "",
    promptHistory: [],
    analysisHistory: [],
  };
}
