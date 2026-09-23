import { useState } from "react";
import { useT } from "@/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { Music, Plus, Scissors, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { FIELD_STYLE, NumberInput, PanelSection } from "@/components/composition/fields";
import { isDesktopApp } from "@/lib/llm";
import { importMusicToBgm, listBgmChoices } from "@/lib/bgmLibrary";
import { assetSrc } from "@/lib/mediaLibrary";
import {
  cutMusicAtIn,
  musicOf,
  splitMusicByBarsIn,
  patchMusicIn,
  setMusicIn,
  setTimelineIn,
  timelineOf,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import type { CompositionState } from "@/lib/composition";

/**
 * 타임라인에 **노래를 깝니다.**
 *
 *
 *
 * # 왜 씬이 아니라 여기인가
 *
 * 처음에는 씬 화면에 «작업 방식 = 뮤직비디오» 를 고르고 거기서 음악을 걸었습니다. 그런데 노래에 맞춰 움직임을 잡는
 * 일은 전부 구도잡기에서 일어납니다 — 후렴이 어디서 시작하는지 보면서 키를 찍고, 그 경계대로 영상을 잘라 뽑습니다.
 * 고를 것을 하나 없애고(«작업 방식»), 노래를 올린 컷이 곧 뮤직비디오 컷이 됩니다.
 *
 * # 구간은 타임라인 시각입니다
 *
 * 노래를 민 자리(`offset`)가 있어도 구간·재생·나눠 뽑기는 전부 **타임라인 0초 기준**으로 말합니다. 한쪽만 노래 시각으로
 * 세면 「2분 30초 후렴」 이 화면에서는 다른 자리가 됩니다.
 */
export function MusicSection({
  state,
  setState,
  playhead,
  projectName,
  sceneTitle,
  cutOrder,
  open,
  onToggle,
}: {
  state: CompositionState;
  setState: UpdateComposition;
  /** «여기서 자르기» 가 쓰는 지금 재생 머리(초). */
  playhead: number;
  /** 올린 음원을 BGM 업로드 폴더에 파일링할 때 씁니다 — «어느 프로젝트의 어느 씬·컷». */
  projectName?: string;
  sceneTitle?: string;
  cutOrder?: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const music = musicOf(state);
  const timeline = timelineOf(state);
  /** BGM 화면에서 뽑아 둔 곡. 이 칸을 열 때 한 번 읽습니다 — 다시 열면 새로 읽히니 갓 뽑은 곡도 뜹니다. */
  const [choices] = useState(() => listBgmChoices());
  const [picking, setPicking] = useState(false);

  /** 길이는 파일을 한 번 읽어야 압니다 — 「타임라인을 노래 길이로」 를 누르려면 끝이 어디인지 알아야 합니다. */
  const measure = (path: string) =>
    new Promise<number>((resolve) => {
      const probe = document.createElement("audio");
      probe.preload = "metadata";
      probe.addEventListener("loadedmetadata", () => resolve(probe.duration || 0), { once: true });
      probe.addEventListener("error", () => resolve(0), { once: true });
      probe.src = assetSrc(path);
    });

  /** BGM 화면에서 뽑아 둔 곡을 그대로 씁니다 — 파일은 `BGM/곡/…` 에 두고 경로만 적습니다. */
  const useBgm = async (path: string, label: string) => {
    const seconds = await measure(path);
    setState((current) => setMusicIn(current, { path, name: label, seconds, sections: [] }));
    toast.success(`${label} · ${seconds.toFixed(1)}초`, {
      description: "BGM 프로젝트의 곡을 타임라인에 깔았습니다",
    });
  };

  /**
   * 파일로 올리기 — 고른 음원을 **BGM 업로드 폴더로 옮겨 놓고** 그 경로를 씁니다.
   *
   * 사람이 고른 자리(바탕화면·다운로드)를 그대로 가리키면, 그 파일을 옮기거나 지우는 순간
   * 컷의 노래가 사라집니다.
   */
  const pick = async () => {
    if (!isDesktopApp()) {
      toast.error("음악 고르기는 데스크톱 앱에서만 됩니다.");
      return;
    }
    if (picking) return;
    setPicking(true);
    try {
      const paths = await invoke<string[]>("choose_audio_files");
      const source = paths[0];
      if (!source) return;
      const copied = await importMusicToBgm(source, {
        projectName: projectName || "프로젝트",
        sceneTitle,
        cutOrder,
      }).catch((error) => {
        // 옮기지 못해도 작업은 이어져야 합니다 — 고른 자리를 그대로 가리키고, 그렇게 알립니다.
        toast.warning("BGM 폴더로 옮기지 못해 고른 자리를 그대로 씁니다.", { description: String(error) });
        return null;
      });
      const path = copied?.path ?? source;
      const name = copied?.name ?? (source.split(/[\\/]/).pop() ?? source);
      const seconds = await measure(path);
      setState((current) => setMusicIn(current, { path, name, seconds, sections: [] }));
      toast.success(`${name} · ${seconds.toFixed(1)}초`, {
        description: copied
          ? "BGM · 업로드 폴더에 씬·컷 번호로 넣었습니다. 재생하면 같이 울립니다"
          : "재생하면 같이 울립니다. 빠르기로 나누거나 «여기서 자르기» 로 구간을 잡으세요",
      });
    } catch (error) {
      toast.error(`음악을 고르지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPicking(false);
    }
  };

  return (
    <PanelSection tour="timeline-music" title={t("노래")} open={open} onToggle={onToggle}>
      {!music ? (
        <div data-tour="timeline-music-pick" className="space-y-1.5">
          {/*
            길이 둘입니다 — **BGM 화면에서 뽑아 둔 곡**을 그대로 쓰거나, 밖에서 받은 음원을 올리거나.
            
          */}
          {choices.length > 0 && (
            <select
              value=""
              onChange={(event) => {
                const found = choices.find((item) => item.path === event.target.value);
                if (found) void useBgm(found.path, `${found.projectName} · ${found.trackName}`);
              }}
              className="w-full rounded-md px-2 py-1.5 text-[10px] outline-none"
              style={FIELD_STYLE}
            >
              <option value="">BGM에서 고르기 — 뽑아 둔 곡 {choices.length}개</option>
              {choices.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.projectName} · {item.trackName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void pick()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[10px] font-semibold"
            style={{
              background: "oklch(0.62 0.22 300 / 14%)",
              border: "1px dashed oklch(0.62 0.22 300 / 40%)",
              color: "oklch(0.86 0.16 300)",
            }}
          >
            <Upload className="h-3.5 w-3.5" /> 음원 올리기 — BGM · 업로드 폴더에 들어갑니다
          </button>
          {choices.length === 0 && (
            <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
              BGM 화면에서 곡을 뽑아 두면 여기서 바로 고를 수 있습니다.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Music className="h-3 w-3 shrink-0" style={{ color: "oklch(0.86 0.16 300)" }} />
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-white" title={music.path}>
              {music.name}
            </span>
            <span className="shrink-0 text-[9px] tabular-nums" style={{ color: "oklch(0.55 0.01 265)" }}>
              {music.seconds.toFixed(1)}초
            </span>
            <button
              type="button"
              onClick={() => void pick()}
              className="shrink-0 rounded px-1.5 py-0.5 text-[9px]"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.01 265)" }}
            >
              바꾸기
            </button>
            <button
              type="button"
              onClick={() => setState((current) => setMusicIn(current, null))}
              title="타임라인에서 노래를 뺍니다. 파일은 그대로 둡니다"
              className="shrink-0 rounded p-1 hover:bg-white/10"
              style={{ color: "oklch(0.60 0.15 25)" }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>

          {/*
            타임라인이 노래보다 짧으면 뒤쪽은 뽑을 화면이 없습니다. 길이를 맞추는 일이 가장 잦아 단추로 둡니다
            — 3분 곡이면 타임라인도 3분.
          */}
          <div className="flex items-center gap-1 text-[9px]" style={{ color: "oklch(0.58 0.01 265)" }}>
            <span className="shrink-0">타임라인 {timeline.duration.toFixed(1)}초</span>
            {Math.abs(timeline.duration - music.seconds) > 0.05 && music.seconds > 0 && (
              <button
                type="button"
                onClick={() =>
                  setState((current) =>
                    setTimelineIn(current, { duration: Math.round(music.seconds * 10) / 10 }),
                  )
                }
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ background: "oklch(0.62 0.22 300 / 18%)", color: "oklch(0.86 0.16 300)" }}
              >
                노래 길이({music.seconds.toFixed(1)}초)로
              </button>
            )}
            <span className="ml-auto shrink-0">노래를 민 자리</span>
            <div className="w-14 shrink-0">
              <NumberInput
                value={Math.round((music.offset ?? 0) * 100) / 100}
                step={0.5}
                min={0}
                onChange={(offset) => setState((current) => patchMusicIn(current, { offset }))}
              />
            </div>
          </div>

          <div data-tour="timeline-music-sections" className="flex flex-wrap items-center gap-1 text-[9px]" style={{ color: "oklch(0.58 0.01 265)" }}>
            <span>빠르기</span>
            <input
              type="number"
              min={40}
              max={240}
              value={music.bpm ?? 120}
              onChange={(event) =>
                setState((current) => patchMusicIn(current, { bpm: Number(event.target.value) || 120 }))
              }
              className="w-12 rounded px-1 py-0.5 text-[9px] tabular-nums outline-none"
              style={FIELD_STYLE}
            />
            <span>BPM ·</span>
            <input
              type="number"
              min={1}
              max={64}
              value={music.barsPerSection ?? 8}
              onChange={(event) =>
                setState((current) => patchMusicIn(current, { barsPerSection: Number(event.target.value) || 8 }))
              }
              className="w-10 rounded px-1 py-0.5 text-[9px] tabular-nums outline-none"
              style={FIELD_STYLE}
            />
            <span>마디씩</span>
            <button
              type="button"
              onClick={() =>
                setState((current) => {
                  const now = musicOf(current);
                  return now
                    ? // 나누기는 «지금 값» 에서 — 사이에 타임라인 길이를 바꿨을 수 있습니다.
                      splitMusicByBarsIn(current, now.bpm ?? 120, now.barsPerSection ?? 8)
                    : current;
                })
              }
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ background: "oklch(0.62 0.22 300 / 18%)", color: "oklch(0.86 0.16 300)" }}
            >
              <Plus className="mr-0.5 inline h-2.5 w-2.5" /> 구간 나누기
            </button>
            <button
              type="button"
              onClick={() => setState((current) => cutMusicAtIn(current, playhead))}
              title="지금 재생 머리 자리에서 구간을 둘로 나눕니다"
              className="rounded px-1.5 py-0.5 text-[9px]"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
            >
              <Scissors className="mr-0.5 inline h-2.5 w-2.5" /> {playhead.toFixed(2)}초에서 자르기
            </button>
          </div>

          {music.sections.length > 0 && (
            <div className="composition-scroll max-h-32 space-y-1 overflow-y-auto pr-1">
              {music.sections.map((section) => (
                <div key={section.id} className="flex items-center gap-1">
                  <input
                    value={section.label}
                    onChange={(event) =>
                      setState((current) => {
                        const now = musicOf(current);
                        return now
                          ? patchMusicIn(current, {
                              sections: now.sections.map((item) =>
                                item.id === section.id ? { ...item, label: event.target.value } : item,
                              ),
                            })
                          : current;
                      })
                    }
                    className="w-20 rounded px-1 py-0.5 text-[9px] outline-none"
                    style={FIELD_STYLE}
                    placeholder="도입 · 후렴"
                  />
                  <span className="text-[9px] tabular-nums" style={{ color: "oklch(0.58 0.01 265)" }}>
                    {section.start.toFixed(2)} ~ {section.end.toFixed(2)}초
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) => {
                        const now = musicOf(current);
                        return now
                          ? patchMusicIn(current, {
                              sections: now.sections.filter((item) => item.id !== section.id),
                            })
                          : current;
                      })
                    }
                    className="ml-auto rounded p-0.5 hover:bg-white/10"
                    style={{ color: "oklch(0.60 0.15 25)" }}
                    aria-label="구간 지우기"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-[9px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            구간 경계가 아래 «레퍼런스 영상» 의 나눠 뽑기 자르는 자리가 됩니다 — 이어 붙이면 노래와 박자가 맞습니다.
            파일은 그대로 두고 경로만 적습니다.
          </p>
        </div>
      )}
    </PanelSection>
  );
}

export default MusicSection;
