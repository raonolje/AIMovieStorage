import { composeInMagnific } from "@/lib/magnificCompose";
import { useState } from "react";
import { toast } from "sonner";
import { useTargetPlatform } from "@/components/PlatformSelect";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Eraser,
  Loader2,
  ScanSearch,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import SheetPanelCropper from "@/components/SheetPanelCropper";
import ImageLightbox from "@/components/ImageLightbox";
import { useProjectMedia } from "@/components/project/ProjectMediaContext";
import { useApiReady } from "@/lib/useApiReady";
import { uid } from "@/lib/projectTypes";
import { safeFileName, type ProjectAssetType } from "@/lib/mediaLibrary";
import BlueprintTogglePanel from "@/components/BlueprintTogglePanel";
import PromptResultPanels from "@/components/PromptResultPanels";
import PromptHistoryShelf from "@/components/PromptHistoryShelf";
import ReferenceImageUploader from "@/components/ReferenceImageUploader";
import ReferenceTagBar, {
  buildReferenceTags,
} from "@/components/ReferenceTagBar";
import PlatformSelect from "@/components/PlatformSelect";
import { LlmRequestButton } from "@/components/LlmRequestButton";
import AutoTextarea from "@/components/AutoTextarea";
import LocalGenerateButton from "@/components/LocalGenerateButton";
import {
  IMAGE_MODELS,
  IMAGE_ONLY_MODELS,
  magnificModelOf,
  modelLabel,
  normalizeModelId,
} from "@/lib/promptLibrary";
import { plainAnalysisText } from "@/lib/promptRequest";
import {
  REFERENCE_MODE_OPTIONS_BY_KIND,
  resolveReferenceMode,
} from "@/lib/promptWorkflow";
import {
  DOME_CHIP_ID,
  ROOM_INNER_CHIP_ID,
  ROOM_OUTER_CHIP_ID,
  isOutdoorSpaceChipId,
  backgroundComposeAspect,
  blueprintForSpace,
  unfoldChipOf,
  type BlueprintKind,
  type SpaceKind,
} from "@/lib/blueprint";
import type { PromptWorkflowState } from "@/lib/promptWorkflow";
import type { GeneratedImageAsset, ReferenceImage } from "@/lib/projectTypes";
import type { SavedPromptEntry } from "@/lib/promptHistory";
import type { RequestTemplateId } from "@/components/LlmRequestButton";
import type { usePromptCard } from "@/components/project/usePromptCard";
import { fieldStyle } from "@/components/project/fieldStyle";
import NaturalPromptButton from "@/components/NaturalPromptButton";
import { autoEquirectOf } from "@/components/project/useAutoUnfold";

/**
 * 프롬프트 카드의 공통 몸통.
 *
 * 캐릭터·배경·에셋·변형 카드가 **이 하나를 같이 씁니다.** 위쪽의 이름·설명
 * 같은 것만 갈래마다 다르고, 여기부터 아래는 넷이 똑같습니다.
 *
 * # 순서에 이유가 있습니다
 *
 * 레퍼런스 올리기
 * → 어떻게 쓸지 고르기
 * → **분석** (그림에서 무엇이 보이는지)
 * → **구성** (무엇을 뽑을지)
 * → 모델·플랫폼
 * → 프롬프트 네 칸
 * → 받아 둔 프롬프트
 *
 * 분석이 구성보다 **위**인 것은 순서대로 하기 때문입니다. 그림을 먼저 읽고,
 * 그다음에 무엇을 뽑을지 고릅니다. 반대로 두면 아직 안 읽은 채로 고르게 돼요.
 *
 * # 플랫폼은 모델과 별개입니다
 *
 * Magnific 은 `@파일이름`, ComfyUI 는 `<picture 1>` 로 레퍼런스를 가리킵니다.
 * 같은 모델이라도 어디에 붙여넣느냐에 따라 문법이 달라져서 따로 고릅니다.
 */
export default function PromptCardBody<
  T extends PromptWorkflowState<ReferenceImage, GeneratedImageAsset>,
>({
  kind,
  entity,
  patch,
  card,
  name,
  promptTemplate,
  spaceKind,
  extraActions,
  children,
  beforeAnalysis,
  analysisSources,
  fields,
  cropSave,
  onMakeIdentity,
  descriptionLabel = "추가 외형 묘사 — 분석 결과와 합산됩니다",
  descriptionPlaceholder = "생김새와 옷차림. 그림에서 못 읽는 것을 적으세요",
  analysisTemplate,
  sheetCaption,
  promptCaption = "외형 기준 + 구성에서 고른 칸 + 모델별 문법",
  placeScope,
}: {
  kind: BlueprintKind;
  entity: T;
  patch: (updater: (current: T) => Partial<T>) => void;
  card: ReturnType<typeof usePromptCard<T>>;
  name: string;
  promptTemplate: RequestTemplateId;
  spaceKind?: SpaceKind;
  /** 갈래마다 다른 버튼. 배경의 「360도 파노라마 프롬프트」 같은 것 */
  extraActions?: React.ReactNode;
  /** 구성 칸 아래에 끼워 넣을 것 */
  children?: React.ReactNode;
  /**
   * «이미지 분석» 바로 위에 끼워 넣을 것. 인물의 «캐릭터 특징» 이 여기 옵니다.
   *
   * 원래는 카드 맨 아래(생성 이미지 위)에 있었는데, 고 해서 올렸습니다 — 이름·외형 다음에 성격, 그다음 분석·프롬프트 순서가
   * 사람이 인물을 정하는 순서와 같습니다. (2026-09-07)
   */
  beforeAnalysis?: React.ReactNode;
  /**
   * 가져올 수 있는 다른 분석 — 변형 창에서 부모와 형제 변형의 분석을 줍니다.
   * 같은 부모의 변형은 생김새가 같아 분석을 나눠 쓸 때가 많습니다.
   * 늘 같이 쓰는 건 아니라 자동으로 채우지 않고 단추로 고릅니다.
   */
  analysisSources?: { label: string; text: string }[];
  /**
   * 갈래마다 다른 기본 정보 — 인물은 이름·역할·키, 장소는 이름·위치.
   *
   * **레퍼런스 스트립 오른쪽에 놓입니다.** 설계서(05, 「캐릭터 원본 편집 창」)가
   * 「좌: 레퍼런스 세로 스트립 / 우: 2열 필드」 로 정한 배치입니다. 위아래로
   * 쌓으면 그림과 값을 번갈아 보려고 스크롤을 오르내리게 됩니다.
   */
  fields?: React.ReactNode;
  /** 「추가 외형 묘사」 칸의 이름. 변형에서는 「바꿀 요소와 새 특징」 입니다 */
  descriptionLabel?: string;
  /**
   * 잘라낸 칸을 어디에 넣을지. 안 주면 **이 카드의 생성 이미지**에 넣습니다.
   *
   * 변형 창은 원본 인물의 생성 이미지에 넣습니다 — 그래야 위 «이 캐릭터의 생성 이미지» 줄에
   * 나타나 어느 변형에서든 레퍼런스로 집을 수 있습니다. 예전에는 잘라낸 칸이 레퍼런스로
   * 들어가 ref/ 폴더에 `ref_` 이름으로 저장됐습니다. (2026-09-07)
   */
  cropSave?: {
    ownerName: string;
    assetType: ProjectAssetType;
    /** 파일 이름 앞부분. 변형 창은 «인물_변형» 을 줘서 `냥이_겨울_얼굴 정면_자름_001` 이 됩니다. */
    stem?: string;
    /** `thumb` 은 방금 구운 blob 주소 — 저장된 파일을 앱이 못 읽을 때 대신 보여 주는 폴백입니다. */
    onSaved: (
      files: ({ path: string; name: string; thumb?: string } & Partial<
        Pick<GeneratedImageAsset, "face" | "faceSet">
      >)[],
    ) => void;
  };
  /** 주면 레퍼런스 타일에 «정체성 기준으로» 별이 붙습니다 (변형 창). */
  onMakeIdentity?: (id: string) => void;
  descriptionPlaceholder?: string;
  /** 분석 요청문 버튼용. 없으면 분석 요청문 버튼을 숨깁니다 */
  analysisTemplate?: RequestTemplateId;
  /** 구성 위 CUT BLUEPRINT 줄 오른쪽 문구. 예: "Portrait 4:5 · fixed 9-panel grid" */
  sheetCaption?: string;
  /**
   * 「프롬프트 작성」 부제.
   *
   * 무엇을 재료로 삼아 쓰는지 한 줄로 밝힙니다. 이게 없으면 아래 버튼이
   * 무엇을 근거로 글을 만드는지 알 수 없어, 결과가 마음에 안 들 때 어디를
   * 고쳐야 할지 짚지 못합니다.
   */
  promptCaption?: string;
  /**
   * **구도잡기에서 연 카드**인가 — 그러면 카드를 그 일에 맞게 좁힙니다.
   *
   * 사용자 2026-09-16:
   * - 「방 만들고… 전개도 만들 때 첫 레퍼런스 프롬프트는 필요 없어」 (늘 처음이니까요)
   * - 「배경 레퍼런스 구성에… 등장방형 실내 실외 안쪽면 바깥쪽면… 이것만 있으면 되잖아,
   * 여긴 방으로 바로 전개도 잘라서 넣는 거니까」
   * - 벽 그림은 「진짜 그 벽 사이즈에 맞춰서… 인물이랑 벽의 거리 계산해서」 뽑는 것이라
   * 구성 칸 자체가 필요 없습니다.
   *
   * `"room"` 실내 방 · `"dome"` 실외 방 · `"wall"` 벽 그림. 안 주면 예전 그대로(전부 보임).
   */
  placeScope?: "room" | "dome" | "wall" | "special";
}) {
  const references = entity.references || [];
  const modeOptions =
    REFERENCE_MODE_OPTIONS_BY_KIND[kind === "asset" ? "asset" : kind];
  const mode = resolveReferenceMode(entity.referenceMode, references.length);
  // 플랫폼에 따라 태그 글자가 다릅니다(마그니픽 = 파일 이름). 고르면 칩도 같이 바뀝니다.
  const platform = useTargetPlatform();
  const tags = buildReferenceTags(
    references.map((image) => ({
      id: image.id,
      name: image.name,
      label: image.label,
      thumb: image.thumb,
      filePath: image.filePath,
    })),
    platform,
  );

  /** 가위로 연 레퍼런스. 잘라낸 칸은 다시 이 카드의 레퍼런스로 들어옵니다. */
  /** 도는 단추 위에 마우스가 있는가. 그때만 «중지» 로 보입니다. */
  const [hoverStop, setHoverStop] = useState<"analysis" | "prompt" | null>(
    null,
  );
  const [cropTarget, setCropTarget] = useState<ReferenceImage | null>(null);
  /** 크게 보기로 연 레퍼런스 */
  const [viewing, setViewing] = useState<{
    name?: string;
    thumb?: string;
    filePath?: string;
  } | null>(null);
  const { projectName, imageMarks, setImageMarks, projectContext } = useProjectMedia();
  /*
    레퍼런스 타일에 있던 «업스케일 ▾» 은 없앴습니다(2026-09-09). — 키우기는 타일의 가위로
    여는 편집 창(`SheetPanelCropper`) 안의 «업스케일해서 저장»·«지금 그림 업스케일» 로 갔고,
    거기서 저장한 파일이 `onSaved` 로 이 카드에 그대로 들어옵니다.
  */
  // API 키가 없으면 요청 단추를 미리 막습니다. 눌러 놓고 몇 십 초 뒤에
  // 「연결이 안 됐습니다」 를 보는 것이 제일 답답합니다. (지시 113)
  const apiReady = useApiReady();

  const clearAll = () =>
    patch(
      () =>
        ({
          promptKo: "",
          promptEn: "",
          negativeKo: "",
          negativeEn: "",
        }) as Partial<T>,
    );

  return (
    <div className="space-y-3">
      {/*
        ── 머리: 레퍼런스 | 기본 정보 ─────────────────────────────────

        설계서가 정한 배치입니다 — **좌 레퍼런스 스트립, 우 2열 필드.**
        예전에는 위아래로 쌓여 있어서, 그림을 보며 키·체형을 적으려면
        스크롤을 오르내려야 했습니다. 창이 좁으면 한 줄로 접힙니다.
      */}
      <div className="grid gap-4 lg:grid-cols-[264px_1fr]">
        <div className="space-y-2" data-tour="card-references">
          <ReferenceImageUploader
            images={references.map((image) => ({
              id: image.id,
              thumb: card.previewOf(image),
              name: image.name,
              label: image.label,
              filePath: image.filePath,
              isParentReference: image.isParentReference,
            }))}
            onAddFiles={(files) => void card.addReferenceFiles(files)}
            onRemove={card.removeReference}
            onReplace={(id, file) => void card.replaceReference(id, file)}
            onView={(image) => setViewing(image)}
            // 부모 시트는 정체성 기준이라 뺄 수 없습니다. 빠지면 변형이 다른 사람이 됩니다.
            canRemove={(image) => !image.isParentReference}
            // 레퍼런스도 여기서 자릅니다. 얼굴만 잘라 변형 레퍼런스로 바로 넣는 것이
            // 기본 동작인데, 예전에는 폴더를 열어 밖에서 잘라 와야 했습니다.
            onCrop={(image) => {
              const found = references.find((item) => item.id === image.id);
              if (found) setCropTarget(found);
            }}
            onMakeIdentity={
              onMakeIdentity ? (image) => onMakeIdentity(image.id) : undefined
            }
          />
          <p
            className="text-[10px] leading-relaxed"
            style={{ color: "oklch(0.42 0.01 265)" }}
          >
            마우스를 올리면 복사·폴더·가위. 태그를 걸려면 <b>폴더에서 끌어다</b>{" "}
            놓으세요.
          </p>

          {references.length > 0 && (
            <>
              {/*
                레퍼런스를 어떻게 쓸지.
                모델은 이걸 스스로 판단하지 못합니다. 그냥 두면 대개 통째로
                흉내 내는 쪽으로 기울어서, 「이 옷만 참고」 같은 의도가 안 갑니다.
              */}
              <div className="flex flex-wrap gap-1.5">
                {modeOptions.map((option) => {
                  const on = option.id === mode;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        patch(
                          () => ({ referenceMode: option.id }) as Partial<T>,
                        )
                      }
                      title={option.hint}
                      className="rounded-md px-2 py-1 text-[10px] font-medium"
                      style={{
                        background: on
                          ? "oklch(0.62 0.22 290 / 20%)"
                          : "oklch(1 0 0 / 5%)",
                        border: `1px solid ${on ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 8%)"}`,
                        color: on
                          ? "oklch(0.86 0.16 290)"
                          : "oklch(0.58 0.01 265)",
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p
                className="text-[10px]"
                style={{ color: "oklch(0.42 0.01 265)" }}
              >
                {modeOptions.find((option) => option.id === mode)?.hint}
              </p>
            </>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          {fields}

          {/*
            태그 줄은 「추가 외형 묘사」 **바로 위**입니다.

            누르면 저 칸으로 들어가니까요. 예전에는 한참 아래에 있어서, 눌러
            놓고 어디로 갔는지 찾아 올라가야 했습니다.

            그리고 태그가 들어가는 자리가 영문 프롬프트가 아니라 여기인 이유 —
            영문 프롬프트는 **결과**고 태그는 그 결과를 만들기 위한 **주문**
            입니다. 결과 칸에 적으면 분석도 프롬프트 작성도 그 글을 못 봅니다.
          */}
          {tags.length > 0 && (
            <ReferenceTagBar
              tags={tags}
              onInsert={(mention) =>
                patch(
                  (current) =>
                    ({
                      description: `${current.description || ""}${current.description ? " " : ""}${mention}`,
                    }) as Partial<T>,
                )
              }
            />
          )}

          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <p
                className="text-[11px] font-medium"
                style={{ color: "oklch(0.62 0.01 265)" }}
              >
                {descriptionLabel}
              </p>
              {/*
                **설명 칸도 같은 단추를 씁니다**(규칙 1). 여기 적은 글이 시트 프롬프트의
                본문이 됩니다 — 컷에만 있고 카드에는 없으면 안 됩니다.
                정지 그림이라 `isVideo` 는 거짓입니다.
              */}
              <NaturalPromptButton
                text={entity.description || ""}
                kind="scene"
                isVideo={false}
                context={projectContext}
                onApply={(ko: string) => patch(() => ({ description: ko }) as Partial<T>)}
              />
            </div>
            <AutoTextarea
              value={entity.description || ""}
              onChange={(event) =>
                patch(() => ({ description: event.target.value }) as Partial<T>)
              }
              placeholder={descriptionPlaceholder}
              className="w-full rounded-md px-2.5 py-2 text-xs outline-none"
              style={{
                background: "oklch(0.10 0.006 265)",
                border: "1px solid oklch(1 0 0 / 10%)",
                color: "white",
              }}
            />
          </div>
        </div>
      </div>

      {beforeAnalysis}

      {/*
        ── 첫 레퍼런스 프롬프트 ────────────────────────────────────────

        **이미지 분석 바로 위**입니다. 아래는 전부 «그림이 있을 때» 의 일이고
        (분석 → 구성 → 시트 프롬프트), 이것만 «그림이 아직 없을 때» 의 일이라
        그 앞에 섭니다. 

        캐릭터·배경·에셋·변형이 **이 한 부품**을 같이 씁니다(규칙 1).
      */}
      {/*
        구도잡기에서 연 카드는 **늘 처음**이라 이 칸이 뜻이 없습니다(). 아래 «프롬프트 작성» 이 그 일을 합니다.
      */}
      {!placeScope && (
      <FirstReferencePanel
        kind={kind}
        name={name}
        hasReference={references.length > 0}
        modelId={card.firstReferenceModelId()}
        onModelChange={(id) =>
          patch(() => ({ firstReferenceModel: id }) as Partial<T>)
        }
        /*
          한 칸이던 시절의 값(`firstReferencePrompt`)은 **영문 칸**으로 읽습니다.
          지우지 않는 까닭: 예전에 받아 둔 프롬프트가 화면에서 사라지면 안 됩니다.
        */
        korean={entity.firstReferencePromptKo || ""}
        english={
          entity.firstReferencePromptEn || entity.firstReferencePrompt || ""
        }
        onKoreanChange={(text) =>
          patch(() => ({ firstReferencePromptKo: text }) as Partial<T>)
        }
        onEnglishChange={(text) =>
          patch(
            () =>
              ({
                firstReferencePromptEn: text,
                // 옛 한 칸 값은 여기서 놓아 줍니다 — 두 곳에 같은 글이 남으면 어느 쪽이
                // 진짜인지 알 수 없게 됩니다.
                firstReferencePrompt: "",
              }) as Partial<T>,
          )
        }
        busy={card.firstReferenceBusy}
        onRun={() => void card.runFirstReference()}
        onCancel={() => void card.cancelFirstReference()}
        requestData={card.firstReferenceRequestData}
        onApplyText={(raw) => card.applyFirstReference(raw)}
        apiReady={apiReady}
      />
      )}

      {/* ── 이미지 분석 ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2" data-tour="card-analysis">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white">이미지 분석</p>
          <p
            className="truncate text-[10px]"
            style={{ color: "oklch(0.45 0.01 265)" }}
          >
            {entity.analysis
              ? "분석 결과를 직접 고칠 수 있습니다"
              : "분석하거나, LLM 요청문으로 받은 답을 아래에 붙여넣으세요"}
          </p>
        </div>
        {analysisSources &&
          analysisSources.some((source) => source.text.trim()) && (
            <AnalysisImportButton
              sources={analysisSources.filter((source) => source.text.trim())}
              onPick={(source) => {
                // 직접 부른 것과 같은 길 — 이력에 남고, 덮어쓴 칸도 «덮어쓰기 전» 으로 남습니다.
                card.applyAnalysis(
                  source.text.trim(),
                  `${source.label} 분석 가져옴`,
                );
                toast.success(
                  `${source.label} 분석을 가져왔습니다. 전 것은 「받아 둔 분석」 에 남았습니다.`,
                );
              }}
            />
          )}
        {analysisTemplate && (
          <LlmRequestButton
            template={analysisTemplate}
            title={`레퍼런스 분석 요청 · ${name || "이름 없음"}`}
            data={card.analysisRequestData}
            imageCount={() => card.referenceSources().length}
            applyTextLabel="분석 결과"
            // JSON 으로 와도 풀어서 넣습니다. 화면에는 사람이 읽을 글만 남아야 합니다.
            // 직접 부른 것과 같은 길로 넣습니다 — 분석 칸과 이력이 늘 한 벌이어야 합니다.
            onApplyText={(raw) =>
              card.applyAnalysis(plainAnalysisText(raw), "붙여넣기")
            }
          />
        )}
        {/*
          도는 동안은 «분석 중…» 스피너를 그대로 두고, 마우스를 올렸을 때만 «중지» 로 바뀝니다.
          누르자마자 «중지» 가 되면 돌고 있는지 알 수 없었습니다.
        */}
        <button
          type="button"
          onClick={() =>
            card.analysisBusy
              ? void card.cancelAnalysis()
              : void card.runAnalysis()
          }
          onMouseEnter={() => setHoverStop("analysis")}
          onMouseLeave={() => setHoverStop(null)}
          disabled={!card.analysisBusy && (!references.length || !apiReady)}
          title={
            card.analysisBusy
              ? "요청을 끊습니다. 제공사 쪽 요금은 이미 발생했을 수 있습니다."
              : !apiReady
                ? "설정에서 API 키를 넣어야 씁니다. 옆의 「LLM 요청문」 으로는 지금도 됩니다"
                : undefined
          }
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
        >
          {card.analysisBusy ? (
            hoverStop === "analysis" ? (
              <X className="h-3 w-3" />
            ) : (
              <Loader2 className="h-3 w-3 animate-spin" />
            )
          ) : (
            <ScanSearch className="h-3 w-3" />
          )}
          {card.analysisBusy
            ? hoverStop === "analysis"
              ? "중지"
              : "분석 중…"
            : entity.analysis
              ? "재분석"
              : "이미지 분석"}
        </button>
      </div>

      <AutoTextarea
        value={entity.analysis || ""}
        // 손으로 고치는 것은 이력에 쌓지 않습니다. 글자마다 한 줄씩 쌓여 스무 개가 순식간에 찹니다.
        onChange={(event) =>
          patch(() => ({ analysis: event.target.value }) as Partial<T>)
        }
        placeholder="LLM 요청문으로 받은 분석 결과를 여기에 붙여넣으세요. 비워 두면 설명만으로 프롬프트를 만듭니다."
        className="w-full rounded-md px-2.5 py-2 text-[11px] leading-relaxed outline-none"
        style={{
          background: "oklch(0.10 0.006 265)",
          border: "1px solid oklch(1 0 0 / 8%)",
          color: "oklch(0.82 0.005 265)",
        }}
      />

      {/*
        받아 둔 분석. 분석 칸 **바로 아래**입니다 — 되돌리면 저 칸이 바뀌니까요.

        재분석·붙여넣기가 앞의 분석을 덮어써 사라지던 것을, 프롬프트와 같은 방식으로
        쌓아 되돌릴 수 있게 했습니다. 되돌리기는 칸만 바꾸고 이력에는 쌓지 않습니다
        (프롬프트와 같음). (2026-09-08)
      */}
      <PromptHistoryShelf
        title="받아 둔 분석"
        emptyText="받아 둔 분석이 아직 없습니다. 분석하거나 붙여넣을 때마다 여기 쌓이고, 어느 판이든 되돌릴 수 있습니다."
        history={entity.analysisHistory || []}
        preview={(entry) => entry.text}
        onRestore={(entry) =>
          patch(() => ({ analysis: entry.text }) as Partial<T>)
        }
        onRename={(id, label) =>
          patch(
            (current) =>
              ({
                analysisHistory: (current.analysisHistory || []).map((item) =>
                  item.id === id ? { ...item, label } : item,
                ),
              }) as Partial<T>,
          )
        }
        onRemove={(id) =>
          patch(
            (current) =>
              ({
                analysisHistory: (current.analysisHistory || []).filter(
                  (item) => item.id !== id,
                ),
              }) as Partial<T>,
          )
        }
      />

      {/* ── 구성 ─────────────────────────────────────────────────────── */}
      {sheetCaption && (
        <div className="flex items-center justify-between pt-1">
          <p
            className="text-[11px] font-bold tracking-widest"
            style={{ color: "oklch(0.72 0.16 290)" }}
          >
            CUT BLUEPRINT
          </p>
          <p className="text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
            {sheetCaption}
          </p>
        </div>
      )}
      {/*
        벽 그림은 **벽 크기와 인물까지의 거리**로 뽑는 것이라 구성 칸이 필요 없습니다(). 방·돔은 전개도/파노라마 칩만 남깁니다.
      */}
      {placeScope !== "wall" && (
      <BlueprintTogglePanel
        kind={kind}
        only={
          placeScope === "room"
            ? [ROOM_INNER_CHIP_ID, ROOM_OUTER_CHIP_ID]
            : placeScope === "dome"
              ? [DOME_CHIP_ID]
              : undefined
        }
        // 옛 등장방형 한 칩(`space-panorama`)은 카드가 실내면 실내 칩, 아니면 실외 칩으로 읽어 보여 줍니다.
        value={kind === "background" ? blueprintForSpace(entity.blueprint, spaceKind) : entity.blueprint}
        spaceKind={spaceKind}
        /*
          등장방형(전개도) 칩을 켜도 **이미지 모델은 안 바꿉니다.** 한때 GPT 로 바꿔 줬는데,  문서 16 §10 기록으로도 기본 모델이 실외 50 m 정육면체(정사각 칸)는 성공했고,
          실패는 칸이 납작한 방(10×10×3 m)이었습니다. 요금이 드는 모델은 사람이 고릅니다 — 칸 안내에 어느 쪽이 되는지 적어 둡니다.
        */
        onChange={(blueprint) => patch(() => ({ blueprint }) as Partial<T>)}
        panoramaSpace={entity.panoramaSpace}
        onPanoramaSpaceChange={(panoramaSpace) => patch(() => ({ panoramaSpace }) as Partial<T>)}
        exteriorSpace={entity.exteriorSpace}
        onExteriorSpaceChange={(exteriorSpace) => patch(() => ({ exteriorSpace }) as Partial<T>)}
      />
      )}

      {children}

      {/* ── 프롬프트 작성 ────────────────────────────────────────────── */}
      <div className="pt-1">
        <p className="text-xs font-semibold text-white">프롬프트 작성</p>
        <p className="text-[10px]" style={{ color: "oklch(0.45 0.01 265)" }}>
          {promptCaption}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className="shrink-0 text-[11px] font-semibold"
          style={{ color: "oklch(0.72 0.01 265)" }}
        >
          이미지 모델
        </span>
        <select
          value={normalizeModelId(entity.promptModel)}
          onChange={(event) =>
            patch(() => ({ promptModel: event.target.value }) as Partial<T>)
          }
          className="rounded-md px-2 py-1.5 text-[11px] outline-none"
          style={fieldStyle}
        >
          {IMAGE_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>

        <span className="min-w-0 flex-1" />

        {/*
          이 컴퓨터의 모델로 바로 한 장(). 캐릭터·배경·에셋·변형이 같이 씁니다 —
          한쪽에만 달면 규칙 1 을 어기는 자리가 또 하나 생깁니다.
          로컬 모델이 하나도 안 깔려 있으면 단추가 아예 안 보입니다.
        */}
        <LocalGenerateButton
          kind="image"
          prompt={{
            ko: entity.promptKo,
            en: entity.promptEn,
            negativeKo: entity.negativeKo,
            negativeEn: entity.negativeEn,
          }}
          aspect={kind === "character" ? "2:3" : "16:9"}
          projectName={projectName}
          assetType={
            cropSave?.assetType ??
            (`${kind === "background" ? "background" : kind === "asset" ? "asset" : "character"}-generated` as ProjectAssetType)
          }
          ownerName={cropSave?.ownerName ?? (name || "이름 없음")}
          stem={cropSave?.stem ?? safeFileName(name || "이름 없음")}
          onDone={(filePath, imageName) =>
            patch(
              (current) =>
                ({
                  generatedImages: [
                    ...(current.generatedImages || []),
                    {
                      id: uid(),
                      name: imageName,
                      thumb: "",
                      file: null,
                      filePath,
                      // 첫 장이면 대표. 선반의 별과 같은 규칙입니다(규칙 1).
                      isPrimary: !(current.generatedImages || []).length,
                    },
                  ],
                }) as Partial<T>,
            )
          }
        />

        {extraActions}

        {/* 어디에 붙여넣느냐에 따라 레퍼런스 문법이 달라집니다. */}
        <PlatformSelect />

        {/* API 키 없이 쓰는 길. 요청문을 만들어 주면 웹에 붙여넣어 받아 옵니다. */}
        <LlmRequestButton
          template={promptTemplate}
          title={`프롬프트 요청 · ${name || "이름 없음"}`}
          modelId={entity.promptModel}
          data={card.promptRequestData}
          imageCount={() => card.referenceSources().length}
          // 직접 부른 것과 같은 길로 넣습니다 — 네 칸과 이력이 늘 한 벌이어야 합니다.
          onApplyPrompt={(result) =>
            card.applyPrompt(result, card.conditions("붙여넣기"))
          }
        />

        <button
          type="button"
          onClick={card.applyByRule}
          title="API 없이 규칙으로 조립합니다"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            background: "oklch(1 0 0 / 6%)",
            color: "oklch(0.70 0.14 160)",
          }}
        >
          <Wand2 className="h-3 w-3" /> 규칙 조립
        </button>

        <button
          type="button"
          onClick={() =>
            card.promptBusy ? void card.cancelPrompt() : void card.runPrompt()
          }
          data-tour="card-prompt-write"
          onMouseEnter={() => setHoverStop("prompt")}
          onMouseLeave={() => setHoverStop(null)}
          disabled={!card.promptBusy && !apiReady}
          title={
            card.promptBusy
              ? "요청을 끊습니다. 제공사 쪽 요금은 이미 발생했을 수 있습니다."
              : !apiReady
                ? "설정에서 API 키를 넣어야 씁니다. 「규칙 조립」 이나 「LLM 요청문」 은 지금도 됩니다"
                : undefined
          }
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white gradient-primary disabled:opacity-50"
        >
          {card.promptBusy ? (
            hoverStop === "prompt" ? (
              <X className="h-3 w-3" />
            ) : (
              <Loader2 className="h-3 w-3 animate-spin" />
            )
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {card.promptBusy
            ? hoverStop === "prompt"
              ? "중지"
              : "만드는 중…"
            : "프롬프트 작성"}
        </button>
      </div>

      {/* ── 프롬프트 네 칸 ───────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={clearAll}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px]"
          style={{ color: "oklch(0.62 0.14 25)" }}
        >
          <Eraser className="h-2.5 w-2.5" /> 네 칸 모두 지우기
        </button>
      </div>

      <PromptResultPanels
        owner={{ kind, name }}
        /*
          미드저니를 골랐으면 «구성» 을 내놓지 않습니다.

          미드저니는 디스코드로만 돌아 마그니픽 캔버스에 생성기를 놓을 수가 없습니다.
          단추를 남겨 두면 나노 바나나로 조용히 떨어져, **고른 모델과 다른 생성기**가
          놓입니다 — 프롬프트의 `--ar`·`--no` 가 그 칸에 글자 그대로 들어가고요.
          첫 레퍼런스 칸과 같은 규칙입니다.
        */
        composeTitle={`프롬프트와 레퍼런스를 ${modelLabel(entity.promptModel)} 생성기로 이어 붙입니다.`}
        onCompose={!magnificModelOf(entity.promptModel) ? undefined : async (text) => {
          // 프롬프트에 태그로 쓰인 그림만 올립니다. 하나도 안 쓰였으면 전부 올립니다(태그 없이 쓴 프롬프트).
          const tags = buildReferenceTags(references, "magnific");
          const used = tags
            .filter((tag) => tag.filePath && text.includes(tag.mention))
            .map((tag) => tag.filePath as string);
          const all = tags
            .map((tag) => tag.filePath)
            .filter((path): path is string => Boolean(path));
          const message = await composeInMagnific({
            prompt: text,
            referencePaths: used.length ? used : all,
            owner: { kind, name },
            // 카드의 «이미지 모델» 선택이 여기까지 이어집니다.
            model: magnificModelOf(entity.promptModel),
            // 배경은 고른 칩의 비율로 — 전개도가 16:9 로 놓이면 틀이 늘어나 칸이 어긋납니다(`backgroundComposeAspect`).
            aspectRatio:
              kind === "background"
                ? (backgroundComposeAspect(
                    blueprintForSpace(entity.blueprint, spaceKind),
                    isOutdoorSpaceChipId(unfoldChipOf(blueprintForSpace(entity.blueprint, spaceKind)) ?? "")
                      ? entity.exteriorSpace
                      : entity.panoramaSpace,
                  ) ?? undefined)
                : undefined,
            onStatus: (status) => toast.message(status),
          });
          toast.success(message);
        }}
        korean={entity.promptKo}
        english={entity.promptEn}
        negativeKorean={entity.negativeKo}
        negativeEnglish={entity.negativeEn}
        onKoreanChange={(promptKo) => patch(() => ({ promptKo }) as Partial<T>)}
        onEnglishChange={(promptEn) =>
          patch(() => ({ promptEn }) as Partial<T>)
        }
        onNegativeKoreanChange={(negativeKo) =>
          patch(() => ({ negativeKo }) as Partial<T>)
        }
        onNegativeEnglishChange={(negativeEn) =>
          patch(() => ({ negativeEn }) as Partial<T>)
        }
        onAllChange={(set) =>
          patch(
            () =>
              ({
                promptKo: set.ko,
                promptEn: set.en,
                negativeKo: set.negativeKo,
                negativeEn: set.negativeEn,
              }) as Partial<T>,
          )
        }
      />

      {/*
        레퍼런스 자르기.

        잘라낸 칸은 **생성 이미지**로 들어갑니다(원본 인물 폴더, `인물_칸이름_자름_001`).
        예전에는 레퍼런스로 바로 들어가 ref/ 폴더에 `ref_` 로 저장됐는데, 라고 했습니다. 생성 이미지에 두면
        위 «이 캐릭터의 생성 이미지» 줄에서 어느 변형에서든 집어 쓸 수 있습니다.

        지운 판(`"erase"`)도 같이 들어갑니다. fe19e75(2026-09-07, 잘라낸 칸을 생성 이미지로)
        에서 `"crop" | "panorama"` 만 통과시키기 시작해 지운 판(그때는 `"mark"`)이 버려졌습니다.
        지운 판은 생성 이미지 폴더(인물 폴더 뿌리)에 저장되는데 폴더 읽기(usePromptCard)는
        ref/ 만 보므로, 여기서 등록하지 않으면 **파일은 있는데 화면에는 영영 안 뜹니다.**
        알림은 「지운 판 1장을 저장했습니다」 라고 하니 사용자는 «저장은 됐는데 화면에 없다/깨졌다»
        로 봅니다. (2026-09-08)

        표시한 그림(`"mark"`)도 같은 이유로 등록합니다. 파일은 폴더에 남는데 목록에 없으니
        변형 창의 «이 배경의 생성 이미지·레퍼런스» 에서 집을 수 없었습니다. 
      */}
      {cropTarget && (
        <SheetPanelCropper
          open
          onOpenChange={(next) => {
            if (!next) setCropTarget(null);
          }}
          imageSrc={card.previewOf(cropTarget)}
          // 원본 경로는 이름 짓기용 — `냥이_클로즈업_001` 을 지우면 `냥이_클로즈업_지움_001`.
          sourcePath={cropTarget.filePath}
          kind={kind}
          ownerName={cropSave?.ownerName ?? (name || "이름 없음")}
          stemPrefix={cropSave?.stem}
          projectName={projectName}
          assetType={
            cropSave?.assetType ??
            (`${kind === "background" ? "background" : kind === "asset" ? "asset" : "character"}-generated` as ProjectAssetType)
          }
          initialMarks={
            cropTarget.filePath ? imageMarks[cropTarget.filePath] : undefined
          }
          // 파노라마 여섯 면의 위 면 이름 — 실내 «천장», 아니면 «하늘».
          spaceKind={spaceKind}
          faceSetSize={kind === "background" ? autoEquirectOf(entity.blueprint, spaceKind, entity.panoramaSpace, entity.exteriorSpace, null, `${entity.promptEn ?? ""}\n${entity.promptKo ?? ""}`)?.stamp : undefined}
          onSaved={(files) => {
            files.forEach((file) => {
              if (file.marks) setImageMarks(file.path, file.marks);
            });
            /*
              종류를 가리지 않고 전부 등록합니다. 예전에는 네 종류를 이름으로 골라 넣었는데,
              새 종류(6면·업스케일)가 생길 때마다 여기를 빠뜨리면 «파일은 있는데 화면에 없다» 가
              또 납니다. 파노라마 탭이 붙인 면·세트 표(face/faceSet)도 그대로 옮깁니다 —
              잃어도 이름 파싱이 보완하지만, 있으면 파싱 없이 세트를 압니다.
            */
            const all = files.map((file) => {
              const faced = file as Partial<
                Pick<GeneratedImageAsset, "face" | "faceSet">
              >;
              return { ...file, face: faced.face, faceSet: faced.faceSet };
            });
            /*
              «지금 그림 업스케일»(`"upscale"`)만 갈라서 **레퍼런스로** 넣습니다.

              이 창은 레퍼런스 타일에서만 열립니다(위 onCrop). 키운 새 파일은 원본 옆,
              곧 ref/ 폴더에 `ref_…_업스케일_NNN` 으로 생깁니다. 그런데 이것을 생성 이미지로
              등록하면 다음에 카드를 열 때 폴더 읽기(usePromptCard)가 ref/ 를 훑어 같은 파일을
              레퍼런스로 **또** 붙입니다 — 한 그림이 두 목록에 앉는 «두 개로 불어나던 것»(지시 317)이
              그대로 재현됩니다. 예전 타일의 «업스케일 ▾» 도 원본 바로 옆 레퍼런스에 넣었습니다.
              잘라낸 칸·지운 판·표시는 생성 이미지 폴더로 저장되므로 아래 길 그대로입니다.
            */
            const upscaled = all.filter((file) => file.kind === "upscale");
            const saved = all.filter((file) => file.kind !== "upscale");
            if (upscaled.length) {
              patch((current) => {
                const list = current.references || [];
                const at = list.findIndex(
                  (item) => item.filePath === cropTarget.filePath,
                );
                const added: ReferenceImage[] = upscaled.map((file) => ({
                  id: uid(),
                  name: file.name,
                  // thumb 은 폴백. 저장된 파일이 먼저입니다(assetSrc(filePath) || thumb).
                  thumb: file.thumb ?? "",
                  file: null,
                  filePath: file.path,
                }));
                return {
                  references:
                    at < 0
                      ? [...list, ...added]
                      : [
                          ...list.slice(0, at + 1),
                          ...added,
                          ...list.slice(at + 1),
                        ],
                } as Partial<T>;
              });
              toast.success(
                `키운 ${upscaled.length}장을 레퍼런스에 넣었습니다.`,
              );
            }
            if (!saved.length) return;
            if (cropSave) {
              cropSave.onSaved(saved);
            } else {
              patch(
                (current) =>
                  ({
                    generatedImages: [
                      ...((
                        current as { generatedImages?: GeneratedImageAsset[] }
                      ).generatedImages || []),
                      // thumb 은 방금 구운 blob — `assetSrc(filePath)` 를 못 읽을 때 액박 대신 보여 줄 폴백.
                      ...saved.map((file) => ({
                        id: uid(),
                        name: file.name,
                        thumb: file.thumb ?? "",
                        file: null,
                        filePath: file.path,
                        face: file.face,
                        faceSet: file.faceSet,
                      })),
                    ],
                  }) as Partial<T>,
              );
            }
            const cropped = saved.filter(
              (file) => file.kind === "crop" || file.kind === "panorama",
            ).length;
            const erased = saved.filter((file) => file.kind === "erase").length;
            const marked = saved.filter((file) => file.kind === "mark").length;
            const others = saved.length - cropped - erased - marked;
            const parts = [
              cropped ? `잘라낸 ${cropped}장` : "",
              erased ? `지운 판 ${erased}장` : "",
              marked ? `표시한 그림 ${marked}장` : "",
              others ? `그 밖에 ${others}장` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            toast.success(
              `${parts}을 생성 이미지에 넣었습니다. 레퍼런스로 쓰려면 그 그림을 눌러 넣으세요.`,
            );
          }}
        />
      )}

      {viewing && (
        <ImageLightbox image={viewing} onClose={() => setViewing(null)} />
      )}

      <PromptHistoryShelf
        history={entity.promptHistory || []}
        onRestore={(entry: SavedPromptEntry) =>
          patch(
            (current) =>
              ({
                promptKo: entry.ko,
                promptEn: entry.en,
                negativeKo: entry.negativeKo,
                negativeEn: entry.negativeEn,
                // 프롬프트와 조건은 한 벌입니다. 따로 놀면 보이는 것과 체크된 것이 어긋납니다.
                blueprint: entry.blueprint || current.blueprint,
              }) as Partial<T>,
          )
        }
        onRename={(id, label) =>
          patch(
            (current) =>
              ({
                promptHistory: (current.promptHistory || []).map((item) =>
                  item.id === id ? { ...item, label } : item,
                ),
              }) as Partial<T>,
          )
        }
        onRemove={(id) =>
          patch(
            (current) =>
              ({
                promptHistory: (current.promptHistory || []).filter(
                  (item) => item.id !== id,
                ),
              }) as Partial<T>,
          )
        }
      />
    </div>
  );
}

/**
 * 부모·형제 변형의 분석을 골라 가져오는 단추. 하나뿐이면 바로 가져오고, 여럿이면 목록을 폅니다.
 * 별도 드롭다운 부품이 없어 작은 목록을 직접 그립니다(ui 폴더에 menu/popover 없음).
 */
function AnalysisImportButton({
  sources,
  onPick,
}: {
  sources: { label: string; text: string }[];
  onPick: (source: { label: string; text: string }) => void;
}) {
  const [openList, setOpenList] = useState(false);
  const pick = (source: { label: string; text: string }) => {
    setOpenList(false);
    onPick(source);
  };
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() =>
          sources.length === 1
            ? pick(sources[0])
            : setOpenList((value) => !value)
        }
        title="같은 부모의 다른 분석을 이 칸에 붙여넣습니다. 지금 칸은 「받아 둔 분석」 에 남습니다."
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold"
        style={{
          background: "oklch(0.22 0.02 265)",
          color: "oklch(0.85 0.05 265)",
          border: "1px solid oklch(1 0 0 / 10%)",
        }}
      >
        <ClipboardPaste className="h-3 w-3" />
        {sources.length === 1
          ? `${sources[0].label} 분석 가져오기`
          : "분석 가져오기"}
      </button>
      {openList && (
        <div
          className="absolute right-0 z-20 mt-1 w-80 overflow-hidden rounded-md"
          style={{
            background: "oklch(0.15 0.01 265)",
            border: "1px solid oklch(1 0 0 / 12%)",
          }}
        >
          {sources.map((source) => (
            <button
              key={source.label}
              type="button"
              onClick={() => pick(source)}
              className="block w-full px-3 py-2 text-left hover:bg-white/5"
            >
              <p className="text-[11px] font-semibold text-white">
                {source.label}
              </p>
              <p
                className="truncate text-[10px]"
                style={{ color: "oklch(0.55 0.01 265)" }}
              >
                {source.text.trim().slice(0, 80)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 갈래마다 부르는 말이 다릅니다. 「이 물건의 첫 그림」 을 「이 인물의」 라고 하면 안 됩니다. */
const FIRST_REFERENCE_NOUN: Record<BlueprintKind, string> = {
  character: "인물",
  background: "장소",
  asset: "물건",
};

/**
 * «구성» 이 마그니픽 생성기에 넣을 비율.
 *
 * 늘 16:9 로 보냈더니 인물 첫 장이 가로로 넓게 나와 전신이 작게 들어갔습니다.
 * 인물은 세로(2:3), 장소는 가로(16:9), 물건은 정사각이 기본입니다 — 마그니픽에서 바꿔도 됩니다.
 */
const FIRST_REFERENCE_RATIO: Record<BlueprintKind, string> = {
  character: "2:3",
  background: "16:9",
  asset: "1:1",
};

/**
 * 마그니픽 «구성» 은 **나노 바나나 생성기**를 놓습니다(`MAGNIFIC_IMAGE_MODEL`).
 *
 * 미드저니·스테이블 디퓨전을 골라 쓴 글을 그 칸에 넣으면 `--ar 2:3 --no …` 나
 * 「Negative prompt:」 줄이 프롬프트 본문에 글자 그대로 박힙니다.
 *
 * 그래서 «구성» 은 **고른 모델을 그대로** 마그니픽 생성기에 얹습니다(`magnificModelOf`).
 * 미드저니만 디스코드로 돌아 우리가 놓을 수가 없어, 그때만 단추 대신 안내가 섭니다.
 * 예전에는 나노 바나나일 때만 단추가 떴습니다 — 모델을 고르는 뜻이 절반만 살았습니다.
 */

/**
 * «첫 레퍼런스 프롬프트» — 레퍼런스 없이 첫 장을 뽑는 칸.
 *
 * # 왜 이 부품이 여기 있는가
 *
 * 카드의 나머지는 전부 «그림이 있을 때» 를 전제합니다. 분석은 그림을 읽는 것이고,
 * 시트 프롬프트는 그 분석과 태그로 씁니다. 그런데 **새 인물에게는 그림이 한 장도
 * 없습니다.** 여태 그 첫 장은 앱 밖에서 알아서 구해 와야 했습니다.
 *
 * 캐릭터·배경·에셋·변형이 이 하나를 같이 씁니다(규칙 1). 갈래마다 다른 것은
 * 부르는 말(인물·장소·물건)뿐이고, 나머지는 넷이 똑같습니다.
 *
 * # 접힘 규칙
 *
 * 레퍼런스가 하나라도 있으면 **접힌 채로** 시작합니다 — 그림이 생긴 뒤에는 지나간
 * 단계라 자리를 차지하면 안 됩니다. 하나도 없으면 펴진 채로, 보라색 테두리로 눈에
 * 띄게 둡니다. 이 카드에서 지금 할 일이 그것이기 때문입니다.
 *
 * 펼침 상태는 **처음 한 번만** 레퍼런스 수로 정하고 그 뒤에는 사람이 쥡니다.
 * 그림을 넣는 순간 칸이 접혀 버리면, 방금 받은 프롬프트를 보며 뽑던 사람이
 * 화면에서 글을 잃습니다(값은 남아 있지만 찾아 펴야 합니다).
 */
function FirstReferencePanel({
  kind,
  name,
  hasReference,
  modelId,
  onModelChange,
  korean,
  english,
  onKoreanChange,
  onEnglishChange,
  busy,
  onRun,
  onCancel,
  requestData,
  onApplyText,
  apiReady,
}: {
  kind: BlueprintKind;
  name: string;
  hasReference: boolean;
  modelId: string;
  onModelChange: (id: string) => void;
  korean: string;
  english: string;
  onKoreanChange: (text: string) => void;
  onEnglishChange: (text: string) => void;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  requestData: () => unknown;
  onApplyText: (raw: string) => void;
  apiReady: boolean;
}) {
  const [open, setOpen] = useState(!hasReference);
  /** 도는 단추 위에 마우스가 있는가. 그때만 «중지» 로 보입니다(분석·프롬프트와 같은 규칙). */
  const [hoverStop, setHoverStop] = useState(false);
  const noun = FIRST_REFERENCE_NOUN[kind];
  /** 레퍼런스가 없을 때만 눈에 띄게. 있으면 지나간 단계라 조용히 둡니다. */
  const highlight = !hasReference;

  /*
    «구성» — 프롬프트만 든 이미지 생성기를 캔버스에 놓습니다.

    레퍼런스 경로를 **빈 배열로** 넘깁니다. 이 칸의 존재 이유가 «그림이 없다» 라서
    올릴 그림이 없어요. `composeInMagnific` 은 그 경우를 이미 받아 줍니다
    (「그림이 없어도 됩니다 — 프롬프트만 든 생성기를 놓습니다」).

    복사·마그니픽 보내기는 `PromptResultPanels` 가 칸마다 답니다 — 네 칸짜리 생성
    프롬프트와 같은 부품입니다(공통 규칙 1). 여기서 따로 그리면 한글 칸에서 누른
    「마그니픽」 이 영문을 보내는 식으로 어긋납니다.
  */
  const compose = async (text: string) => {
    await composeInMagnific({
      prompt: text,
      referencePaths: [],
      owner: { kind, name },
      aspectRatio: FIRST_REFERENCE_RATIO[kind],
      // 고른 모델 그대로. 미드저니면 «구성» 단추가 아예 안 붙습니다.
      model: magnificModelOf(modelId),
      onStatus: (status) => toast.message(status),
    }).then((message) => toast.success(message));
  };

  return (
    <div
      className="rounded-lg"
      style={{
        background: highlight
          ? "oklch(0.62 0.22 290 / 8%)"
          : "oklch(1 0 0 / 3%)",
        border: `1px solid ${highlight ? "oklch(0.62 0.22 290 / 40%)" : "oklch(1 0 0 / 8%)"}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        data-tour="card-first-reference"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "oklch(0.55 0.01 265)" }}
          />
        ) : (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "oklch(0.55 0.01 265)" }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white">
            첫 레퍼런스 프롬프트
          </p>
          <p
            className="truncate text-[10px]"
            style={{ color: "oklch(0.45 0.01 265)" }}
          >
            {highlight
              ? `레퍼런스가 아직 없습니다. 적어 둔 설정만으로 이 ${noun}의 첫 그림을 뽑을 프롬프트를 만듭니다`
              : `레퍼런스 없이 첫 그림을 뽑던 칸입니다. 다시 뽑을 때 펴세요`}
          </p>
        </div>
        {!!(korean.trim() || english.trim()) && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "oklch(0.70 0.15 160 / 18%)",
              color: "oklch(0.82 0.15 160)",
            }}
          >
            만들어 둠
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="shrink-0 text-[11px] font-semibold"
              style={{ color: "oklch(0.72 0.01 265)" }}
            >
              이미지 모델
            </span>
            {/*
              영상 모델은 목록에 없습니다 — 첫 장은 «그림» 이라 Kling·Veo 로는 못 뽑습니다.
              고른 값이 글의 모양을 바꿉니다(미드저니 `--ar`·`--no`, 스테이블 디퓨전 네거티브 칸,
              나노 바나나 서술문). 그래서 카드의 «이미지 모델»(시트용)과 따로 고릅니다.
            */}
            <select
              value={modelId}
              onChange={(event) => onModelChange(event.target.value)}
              title="이 프롬프트를 어느 생성기에 넣을지. 모델마다 문법이 달라 글이 통째로 달라집니다"
              className="rounded-md px-2 py-1.5 text-[11px] outline-none"
              style={fieldStyle}
            >
              {IMAGE_ONLY_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>

            <span className="min-w-0 flex-1" />

            {/* API 키 없이 쓰는 길. 요청문을 만들어 주면 웹에 붙여넣어 받아 옵니다. */}
            <LlmRequestButton
              template="first-reference"
              title={`첫 레퍼런스 프롬프트 요청 · ${name || "이름 없음"}`}
              modelId={modelId}
              data={requestData}
              onApplyText={onApplyText}
              applyTextLabel="첫 레퍼런스 프롬프트"
            />

            <button
              type="button"
              onClick={() => (busy ? onCancel() : onRun())}
              onMouseEnter={() => setHoverStop(true)}
              onMouseLeave={() => setHoverStop(false)}
              disabled={!busy && !apiReady}
              title={
                busy
                  ? "요청을 끊습니다. 제공사 쪽 요금은 이미 발생했을 수 있습니다."
                  : !apiReady
                    ? "설정에서 API 키를 넣어야 씁니다. 옆의 「LLM 요청문」 으로는 지금도 됩니다"
                    : "이름·설명·기본 정보만으로 이 모델 문법에 맞는 생성 프롬프트를 씁니다"
              }
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
            >
              {busy ? (
                hoverStop ? (
                  <X className="h-3 w-3" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {busy
                ? hoverStop
                  ? "중지"
                  : "만드는 중…"
                : "맞춤 프롬프트 만들기"}
            </button>
          </div>

          {/*
            한글·영문 두 칸(). 모델마다 잘 듣는 말이 달라서 — 나노 바나나·GPT 는
            한국어도 읽고, 미드저니는 영어라야 합니다 — 누르는 칸이 곧 선택입니다.
          */}
          <PromptResultPanels
            compact
            owner={{ kind, name }}
            onCompose={magnificModelOf(modelId) ? (text) => compose(text) : undefined}
            composeTitle={`프롬프트만 든 ${modelLabel(modelId)} 생성기를 마그니픽 캔버스에 ${FIRST_REFERENCE_RATIO[kind]} 로 놓습니다.`}
            korean={korean}
            english={english}
            onKoreanChange={onKoreanChange}
            onEnglishChange={onEnglishChange}
          />
          {!magnificModelOf(modelId) && (
            <p className="text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
              미드저니는 디스코드로만 돌아서 «구성» 으로 생성기를 놓을 수 없습니다 —
              «복사» 로 디스코드에 붙여넣으세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
