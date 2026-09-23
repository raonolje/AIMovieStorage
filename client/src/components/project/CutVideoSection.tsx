import { Film, Loader2, Sparkles } from "lucide-react";
import LocalGenerateButton from "@/components/LocalGenerateButton";
import MagnificVideoCapability from "@/components/MagnificVideoCapability";
import PromptResultPanels from "@/components/PromptResultPanels";
import { assetSrc } from "@/lib/mediaLibrary";
import { cutStem, sceneFolderName } from "@/lib/projectNames";
import { uid } from "@/lib/projectTypes";
import type { Cut, GeneratedImageAsset } from "@/lib/projectTypes";
import type { MagnificVideoResolution } from "@/lib/magnificCompose";
import { useT } from "@/lib/i18n";

/**
 * **컷을 영상으로 뽑는 칸.**
 *
 * 그림 프롬프트와 칸을 나눈 까닭은 `lib/cutVideoPrompt.ts` 에 적어 두었습니다 —
 * 한 칸에 섞으면 그림 쪽 자세가 흐려집니다.
 *
 * 2026-09-18 에 `CutCard.tsx` 에서 떼어 냈습니다.
 */
export default function CutVideoSection({
  cut,
  videoModel,
  magnificVideoResolution,
  onMagnificVideoResolutionChange,
  magnificBusy,
  patchCut,
  applyVideoPrompt,
  runVideoPrompt,
  videoBusy,
  apiReady,
  videoSeconds,
  heroImage,
  motionMask,
  localVideoRefs,
  renders,
  projectName,
  sceneTitle,
  index,
  sendCutVideoToMagnific,
}: {
  cut: Cut;
  videoModel?: string;
  magnificVideoResolution: MagnificVideoResolution;
  onMagnificVideoResolutionChange: (value: MagnificVideoResolution) => void;
  magnificBusy: boolean;
  patchCut: (patch: Partial<Cut> | ((cut: Cut) => Partial<Cut>)) => void;
  /** 규칙으로만 짓는 「영상 프롬프트」. */
  applyVideoPrompt: () => void;
  /**
   * LLM 으로 받는 「프롬프트 작성」 — 규칙 뼈대 위에 상황·환경·동작·표정을 채웁니다.
   */
  runVideoPrompt: () => void;
  videoBusy: boolean;
  /** API 키가 있는가. 없으면 «프롬프트 작성» 이 꺼집니다 — 그림 칸(`CutPromptSection`)과 같은 규칙. */
  apiReady: boolean;
  /** 구도잡기 타임라인이 정한 러닝타임(초). */
  videoSeconds: number;
  /** 로컬 영상의 **첫 프레임**으로 쓸 대표 그림(I2V). */
  heroImage: GeneratedImageAsset | null;
  /** 「여기만 움직인다」 흑백 마스크. 그려 두면 자동으로 물립니다(`CutCard` 가 찾습니다). */
  motionMask: GeneratedImageAsset | null;
  localVideoRefs: { kind: "image" | "video" | "audio"; path: string }[];
  /** 구도잡기에서 뽑아 둔 영상들. 그중 하나를 레퍼런스로 고릅니다. */
  renders: { id: string; path: string; seconds: number; at: string; part?: string }[];
  projectName: string;
  sceneTitle: string;
  index: number;
  sendCutVideoToMagnific: (text: string, lang: "ko" | "en") => Promise<void>;
}) {
  const t = useT();
  return (
      <section
        className="space-y-2 rounded-md p-3"
        style={{
          background: "oklch(0.13 0.009 265)",
          border: "1px solid oklch(0.72 0.16 45 / 22%)",
        }}
      >
        {/*
          머리줄의 단추는 전부 **한 줄**에 섭니다 — 컷 프롬프트 칸과 같은 모양(규칙 1).
          「버튼 여전히 뒤죽박죽인데」: 로컬 영상 단추가 «모델+단추 /
          로라 / 자세» 를 세로로 쌓아 두 줄이 단추 아래로 매달렸던 것은 `LocalGenerateButton` 과
          `LoraPicker` 를 가로 한 줄로 펴서 풀었습니다. 여기서는 정렬만 맡습니다.
        */}
        <div className="flex flex-wrap items-center gap-2" data-tour="cut-video-section">
          <p className="text-[11px] font-semibold text-white">
            영상 프롬프트
          </p>
          <p
            className="min-w-0 flex-1 truncate text-[10px]"
            style={{ color: "oklch(0.45 0.01 265)" }}
          >
            {cut.refVideoPath
              ? `구도잡기 레퍼런스 영상 ${(cut.refVideoSeconds ?? videoSeconds).toFixed(1)}초 · 인물 시트·배경과 함께 올립니다`
              : `러닝타임 ${videoSeconds.toFixed(1)}초 — 구도잡기 타임라인이 정합니다`}
          </p>
          {/*
            API 로 바로 받는 「프롬프트 작성」 — 그림 칸의 그 단추와 같은 자리·같은 모양(규칙 1).
            여태 영상 칸은 규칙 조립(「영상 프롬프트」)뿐이라 상황·표정·공기가 한 줄로 끝났습니다
            (). 뼈대는 규칙이 짓고 그 사이를 LLM 이 채웁니다.
          */}
          <button
            type="button"
            onClick={() => void runVideoPrompt()}
            disabled={videoBusy || !apiReady}
            title={
              !apiReady
                ? "설정에서 API 키를 넣어야 씁니다. 「영상 프롬프트」 는 지금도 됩니다"
                : "규칙 뼈대(구도·@태그·형식) 위에 상황·환경·동작·표정을 LLM 이 채웁니다"
            }
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-white gradient-primary disabled:opacity-40"
          >
            {videoBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            프롬프트 작성
          </button>
          <button
            type="button"
            onClick={applyVideoPrompt}
            data-tour="cut-video-prompt"
            disabled={!cut.composition}
            title={
              cut.composition
                ? "구도의 카메라 무빙·인물·소품에서 영상 프롬프트를 만듭니다"
                : "먼저 구도를 잡아 주세요"
            }
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-40"
            style={{
              background: "oklch(1 0 0 / 6%)",
              color: "oklch(0.78 0.15 45)",
            }}
          >
            <Film className="h-3 w-3" /> 영상 프롬프트
          </button>
          {/*
            로컬 영상은 **대표 그림을 첫 프레임으로** 씁니다(I2V). 그래야 앞뒤 컷과
            인물이 같습니다 — 글만 주면 컷마다 다른 사람이 나옵니다.
            로라는 설정의 목록에서 켜 둔 것이 전부 함께 들어갑니다(멀티 로라).
          */}
          <LocalGenerateButton
            kind="video"
            label="로컬 영상"
            seconds={videoSeconds}
            firstFrame={heroImage?.filePath}
            references={localVideoRefs}
            motionMask={motionMask?.filePath || undefined}
            prompt={{ ko: cut.videoPromptKo, en: cut.videoPromptEn }}
            projectName={projectName}
            assetType="scene-video"
            ownerName={sceneFolderName(sceneTitle, index)}
            stem={cutStem(sceneTitle, index, cut.order)}
            onDone={(filePath, name) =>
              patchCut((current) => ({
                videos: [
                  ...(current.videos || []),
                  { id: uid(), name, filePath },
                ],
              }))
            }
          />

</div>

        {/*
          ── 구도잡기에서 뽑은 영상 고르기 ────────────────────────────
          

          **등록과 저장은 이미 되고 있었습니다** — 뽑을 때 프로젝트 폴더에 떨어지고
          (`useReferenceVideo`), 구도가 목록으로 들고 있습니다(`composition.renders`).
          마지막에 뽑은 한 편만 컷에 적혀서, 앞서 뽑은 것을 **고를 길이 없었을 뿐**입니다.
          조각까지 남아 있으니 「그때 그 12초짜리」 를 여기서 되돌려 고릅니다.
        */}
        {/*
          ── 레퍼런스 영상은 **여기서 바로 봅니다** ──────────────────────────
           여태 «3.0초» 칩만 있어서 무엇이 걸렸는지
          이름과 길이로만 알 수 있었습니다. 뽑은 영상은 마그니픽·로컬 생성기에 «카메라
          움직임의 기준» 으로 올라가는 것이라, 올리기 전에 눈으로 확인할 자리가 있어야 합니다.

          재생기는 `CutVideoShelf` 와 같은 모양(`assetSrc` + controls). 컷에 적힌 것
          (`refVideoPath`)이 목록(`renders`)에 없어도 — 구도를 다시 저장하면서 목록이 비는 일이
          있습니다 — 걸린 영상은 그대로 보여 줍니다.
        */}
        {(cut.refVideoPath || renders.length > 0) && (
          <div className="flex flex-wrap items-start gap-3">
            {cut.refVideoPath && (
              <div className="w-[260px] shrink-0">
                <video
                  key={cut.refVideoPath}
                  src={assetSrc(cut.refVideoPath) || undefined}
                  controls
                  preload="metadata"
                  className="aspect-video w-full rounded-lg"
                  style={{ background: "oklch(0.1 0.006 265)" }}
                />
                <p
                  className="mt-1 truncate text-[10px] tabular-nums"
                  title={cut.refVideoPath}
                  style={{ color: "oklch(0.62 0.01 265)" }}
                >
                  {cut.useRefVideo === false ? "○ " : "● "}
                  {cut.refVideoPath.split(/[\\/]/).pop()} · {(cut.refVideoSeconds ?? videoSeconds).toFixed(1)}초
                </p>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1" data-tour="cut-ref-video-list">
              <p className="text-[10px] font-semibold" style={{ color: "oklch(0.52 0.01 265)" }}>
                구도잡기에서 뽑은 영상 ({renders.length})
              </p>
              {renders.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {renders.map((render) => {
                    const on = cut.refVideoPath === render.path;
                    return (
                      <button
                        key={render.id}
                        type="button"
                        // «켜져 있나» 는 렌더 시점의 `on` 이 아니라 **지금 값**에서 읽습니다. 누르는 순간과
                        // 같은 배치에 `onVideoSaved` 가 먼저 들어오면 `on` 은 옛 영상 기준이라, 방금 걸린
                        // 새 영상을 떼어 버립니다. (다른 칸은 `patchCut` 이 얕게 합치므로 값꼴이어도
                        // 안 지워집니다 — 함수꼴인 까닭은 오직 이 판정 때문입니다.)
                        onClick={() =>
                          patchCut((current) =>
                            current.refVideoPath === render.path
                              ? { refVideoPath: undefined, refVideoSeconds: undefined }
                              : { refVideoPath: render.path, refVideoSeconds: render.seconds },
                          )
                        }
                        title={`${render.path}
${new Date(render.at).toLocaleString()}`}
                        className="rounded px-2 py-1 text-[10px] tabular-nums"
                        style={{
                          background: on ? "oklch(0.72 0.16 45 / 22%)" : "oklch(1 0 0 / 5%)",
                          border: `1px solid ${on ? "oklch(0.72 0.16 45 / 50%)" : "transparent"}`,
                          color: on ? "oklch(0.86 0.14 45)" : "oklch(0.62 0.01 265)",
                        }}
                      >
                        {on ? "● " : ""}
                        {render.part ? `${render.part} · ` : ""}
                        {render.seconds.toFixed(1)}초
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[9px]" style={{ color: "oklch(0.44 0.01 265)" }}>
                  목록은 비었지만 걸린 영상은 왼쪽에 있습니다 — 구도잡기 타임라인에서 다시 뽑으면 여기 쌓입니다.
                </p>
              )}
              <p className="text-[9px]" style={{ color: "oklch(0.44 0.01 265)" }}>
                고른 것이 카메라 무빙·인물 동선의 레퍼런스로 올라갑니다. 다시 누르면 뗍니다. 올릴지 말지는 위 «레퍼런스 영상 쓰기» 토글이 정합니다.
              </p>
            </div>
          </div>
        )}

        <label className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"
          title={t("«영상으로»에서 Magnific 캔버스에 구성할 해상도입니다. 로컬 영상의 해상도는 바꾸지 않습니다.")}>
          <span>{t("Magnific 구성 해상도")}</span>
          <select aria-label={t("Magnific 구성 해상도")} value={magnificVideoResolution} disabled={magnificBusy}
            onChange={event => onMagnificVideoResolutionChange(event.target.value as MagnificVideoResolution)}
            className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-white disabled:opacity-40">
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
        <MagnificVideoCapability modelId={videoModel} hasRefVideo={cut.useRefVideo !== false && Boolean(cut.refVideoPath)} />
        <PromptResultPanels
          compact
          owner={{ kind: "cut", name: `컷 ${cut.order}`, cutId: cut.id }}
          composeLabel="영상으로"
          composeTitle="레퍼런스 영상·인물 시트·배경을 올리고, 러닝타임까지 맞춘 영상 생성기를 이어 붙입니다."
          onCompose={sendCutVideoToMagnific}
          korean={cut.videoPromptKo || ""}
          english={cut.videoPromptEn || ""}
          onKoreanChange={(videoPromptKo: string) => patchCut(() => ({ videoPromptKo }))}
          onEnglishChange={(videoPromptEn: string) => patchCut(() => ({ videoPromptEn }))}
        />
      </section>
  );
}
