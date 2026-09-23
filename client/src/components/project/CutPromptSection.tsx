import { Link2, Loader2, Sparkles, Wand2 } from "lucide-react";
import { LlmRequestButton } from "@/components/LlmRequestButton";
import LocalGenerateButton from "@/components/LocalGenerateButton";
import PromptResultPanels from "@/components/PromptResultPanels";
import PromptHistoryShelf from "@/components/PromptHistoryShelf";
import { TechniqueSelect } from "@/components/TechniqueSelect";
import { cutStem, sceneFolderName } from "@/lib/projectNames";
import { uid } from "@/lib/projectTypes";
import type { Cut } from "@/lib/projectTypes";
import type { SavedPromptEntry } from "@/lib/promptHistory";

/**
 * **컷 그림 프롬프트 칸** — 받기·규칙 조립·@ 다시 잇기·이력·로컬로 뽑기.
 *
 * 2026-09-18 에 `CutCard.tsx` 에서 떼어 냈습니다. 영상 칸(`CutVideoSection`)과 짝이고,
 * 둘을 나눈 까닭은 `lib/cutVideoPrompt.ts` 에 적어 두었습니다 — 한 칸에 섞으면
 * 그림 쪽 자세가 흐려집니다.
 */
export default function CutPromptSection({
  cut,
  patchCut,
  apiReady,
  cutBusy,
  runCutPrompt,
  cutRequestData,
  applyRulePrompt,
  relinkTags,
  relinking,
  sendCompositionToMagnific,
  projectName,
  sceneTitle,
  index,
  modelId,
}: {
  cut: Cut;
  patchCut: (patch: Partial<Cut> | ((cut: Cut) => Partial<Cut>)) => void;
  /** API 키가 있는가. 없으면 «프롬프트 작성» 이 꺼집니다. */
  apiReady: boolean;
  cutBusy: boolean;
  runCutPrompt: () => void;
  cutRequestData: () => unknown;
  applyRulePrompt: () => void;
  /** 그림을 바꿨을 때 프롬프트 속 `@태그` 를 지금 그림으로 다시 잇습니다. */
  relinkTags: () => void;
  relinking: boolean;
  sendCompositionToMagnific: (text: string, lang: "ko" | "en") => Promise<void>;
  projectName: string;
  sceneTitle: string;
  index: number;
  /**
   * 이 작품이 **그림을 뽑을 모델**(`targetModels("image")` 의 id).
   *
   * 있으면 LLM 요청에 그 모델의 가이드가 함께 붙어, 그 문법으로 쓰인 프롬프트가
   * 돌아옵니다.
   */
  modelId?: string;
}) {
  return (
    <section
        className="space-y-2 rounded-md p-3"
        style={{
          background: "oklch(0.13 0.009 265)",
          border: "1px solid oklch(0.62 0.22 290 / 22%)",
        }}
      >
        <div className="flex flex-wrap items-center gap-2" data-tour="cut-prompt-section">
          <p className="text-[11px] font-semibold text-white">
            컷 프롬프트
          </p>
          <p
            className="min-w-0 flex-1 truncate text-[10px]"
            style={{ color: "oklch(0.45 0.01 265)" }}
          >
            구도에서 읽은 샷·앵글·거리는 사실입니다. LLM 은 문장만
            다듬습니다
          </p>
          {/*
            API 로 바로 받는 「프롬프트 작성」. (지시 324)

            캐릭터·배경에는 있는데 컷에는 손으로 붙여넣는 「LLM 요청문」 뿐이라
            컷 프롬프트는 API 기록에도 안 남고 한 번에 받을 수도 없었습니다.
            「공통 기능은 배경·캐릭터·씬 구성에 함께 반영할 것」.
          */}
          <button
            type="button"
            onClick={() => void runCutPrompt()}
            data-tour="cut-prompt-write"
            disabled={cutBusy || !apiReady}
            title={
              !apiReady
                ? "설정에서 API 키를 넣어야 씁니다. 「LLM 요청문」 은 지금도 됩니다"
                : undefined
            }
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-white gradient-primary disabled:opacity-40"
          >
            {cutBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            프롬프트 작성
          </button>
          <button
            type="button"
            onClick={applyRulePrompt}
            disabled={!cut.composition}
            title={
              cut.composition
                ? "구도와 연출에서 만듭니다"
                : "먼저 구도를 잡아 주세요"
            }
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-40"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.70 0.14 160)",
            }}
          >
            <Wand2 className="h-3 w-3" /> 규칙 조립
          </button>
          {/*
            그림만 갈아 끼웁니다 — 시트를 바꾸거나 나중에 넣었을 때.
            프롬프트가 한 칸도 없으면 이을 것이 없으니 눌리지 않습니다.
          */}
          <button
            type="button"
            onClick={() => void relinkTags()}
            disabled={
              relinking ||
              ![cut.promptKo, cut.promptEn, cut.videoPromptKo, cut.videoPromptEn].some(
                (text) => text?.trim(),
              )
            }
            title="써 둔 프롬프트는 그대로 두고, 그림 이름(@태그)만 지금 걸린 것으로 바꿉니다"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-40"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.74 0.14 250)",
            }}
          >
            {relinking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Link2 className="h-3 w-3" />
            )}
            @ 다시 잇기
          </button>
          {/* 이 컷에 실을 기법 가이드. 필요한 것만 고릅니다. (지시 131) */}
          <TechniqueSelect
            value={cut.techniques || []}
            onChange={(techniques: string[]) => patchCut(() => ({ techniques }))}
          />
          {/*
            이 컴퓨터의 모델로 바로 한 장. 적어 둔 프롬프트를 그대로 쓰되
            마그니픽용 @칩·매개변수는 보내는 순간에 걷어냅니다(`tuneForLocal`).
            로컬 모델이 하나도 안 깔려 있으면 단추가 아예 안 보입니다.
          */}
          <LocalGenerateButton
            kind="image"
            prompt={{
              ko: cut.promptKo,
              en: cut.promptEn,
              negativeKo: cut.negativeKo,
              negativeEn: cut.negativeEn,
            }}
            projectName={projectName}
            assetType="scene-cut"
            ownerName={sceneFolderName(sceneTitle, index)}
            stem={cutStem(sceneTitle, index, cut.order)}
            onDone={(filePath, name) =>
              patchCut((current) => ({
                images: [
                  ...current.images,
                  {
                    id: uid(),
                    name,
                    thumb: "",
                    file: null,
                    filePath,
                    // 첫 장이면 대표가 됩니다 — 선반·후보함과 같은 규칙(규칙 1).
                    isPrimary: !current.images.length,
                  },
                ],
              }))
            }
          />
          <LlmRequestButton
            template="cut-prompt"
            // 고른 모델이 있으면 그 가이드가 요청에 붙습니다(`loadModelGuide`).
            modelId={modelId}
            techniques={() => cut.techniques || []}
            title={`컷 프롬프트 다듬기 · 컷 ${cut.order}`}
            data={cutRequestData}
            imageCount={() => (cut.guideImage ? 1 : 0)}
            onApplyPrompt={(result: { ko: string; en: string; negativeKo: string; negativeEn: string }) =>
              // LLM 왕복은 수십 초입니다. 그 사이 만진 다른 칸을 덮으면 안 됩니다.
              patchCut(() => ({
                promptKo: result.ko,
                promptEn: result.en,
                negativeKo: result.negativeKo,
                negativeEn: result.negativeEn,
              }))
            }
          />
        </div>

        {/*
          «구성» 은 칸마다 답니다 — 한글로 보낼지 영문으로 보낼지는 그때그때 다릅니다
          ().
          캐릭터·배경 카드가 쓰는 그 단추와 같은 자리, 같은 모양입니다(공통 규칙 1).
        */}
        <PromptResultPanels
          compact
          owner={{ kind: "cut", name: `컷 ${cut.order}`, cutId: cut.id }}
          onCompose={(text, lang) => sendCompositionToMagnific(text, lang)}
          korean={cut.promptKo || ""}
          english={cut.promptEn || ""}
          negativeKorean={cut.negativeKo || ""}
          negativeEnglish={cut.negativeEn || ""}
          onKoreanChange={(promptKo) => patchCut(() => ({ promptKo }))}
          onEnglishChange={(promptEn) => patchCut(() => ({ promptEn }))}
          onNegativeKoreanChange={(negativeKo) => patchCut(() => ({ negativeKo }))}
          onNegativeEnglishChange={(negativeEn) => patchCut(() => ({ negativeEn }))}
          onAllChange={(set) =>
            patchCut(() => ({
              promptKo: set.ko,
              promptEn: set.en,
              negativeKo: set.negativeKo,
              negativeEn: set.negativeEn,
            }))
          }
        />
        {/*
          받아 둔 컷 프롬프트. 캐릭터·배경 카드에는 예전부터 있던 선반인데 컷에만
          없어서, 「프롬프트 작성」 을 한 번 더 누르면 앞의 판이 그 자리에서
          사라졌습니다(공통 규칙 1). 무슨 조건으로 뽑았는지도 함께 적힙니다.
        */}
        <PromptHistoryShelf
          history={cut.promptHistory || []}
          onRestore={(entry: SavedPromptEntry) =>
            patchCut(() => ({
              promptKo: entry.ko,
              promptEn: entry.en,
              negativeKo: entry.negativeKo,
              negativeEn: entry.negativeEn,
            }))
          }
          onRename={(id: string, label: string) =>
            patchCut((current) => ({
              promptHistory: (current.promptHistory || []).map((item) =>
                item.id === id ? { ...item, label } : item,
              ),
            }))
          }
          onRemove={(id: string) =>
            patchCut((current) => ({
              promptHistory: (current.promptHistory || []).filter((item) => item.id !== id),
            }))
          }
        />
      </section>
  );
}
