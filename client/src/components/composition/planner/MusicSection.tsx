import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle, Music, Plus, Scissors, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { FIELD_STYLE, NumberInput, PanelSection } from "@/components/composition/fields";
import { isDesktopApp } from "@/lib/llm";
import { importMusicToBgm, listBgmChoices } from "@/lib/bgmLibrary";
import { measureAudioSeconds } from "@/lib/audioDuration";
import { analyzeMusicFile } from "@/lib/musicBeats";
import { generateKimodoMotion, KIMODO_MODELS } from "@/lib/kimodoGeneration";
import { useMocapSources, mocapSourcesOf, loadMocapResult, importKimodoMotion } from "@/lib/mocapStore";
import { selectedPerson } from "@/lib/compositionMocapControl";
import { loadCaptureRetargetRig } from "@/lib/capturedMotionApply";
import { retargetPerson } from "@/lib/motionRetarget";
import { applyDanceChoreographyIn } from "@/lib/musicChoreography";
import {
  cutMusicAtIn,
  musicOf,
  moveMusicStartIn,
  splitMusicByBarsIn,
  splitMusicByDetectedBarsIn,
  patchMusicIn,
  setMusicIn,
  setTimelineIn,
  timelineOf,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import type { CompositionCharacterSource, CompositionState } from "@/lib/composition";

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
  plannerCharacters,
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
  plannerCharacters: CompositionCharacterSource[];
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
  const [pendingMusic, setPendingMusic] = useState<{ path: string; name: string; seconds: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingDance, setApplyingDance] = useState(false);
  const [importingDance, setImportingDance] = useState(false);
  const [generatingDance, setGeneratingDance] = useState(false);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [motionModel, setMotionModel] = useState<typeof KIMODO_MODELS[number]>(KIMODO_MODELS[0]);
  const [motionSeconds, setMotionSeconds] = useState(5);
  const [encoderDevice, setEncoderDevice] = useState<"cuda" | "cpu">("cuda");
  const [motionMessage, setMotionMessage] = useState("");
  const kimodoInput = useRef<HTMLInputElement>(null);
  const [danceSourceId, setDanceSourceId] = useState("");
  const [dancePersonNumber, setDancePersonNumber] = useState(1);
  const latestState = useRef(state);
  latestState.current = state;
  const pendingDance = useRef<{ before: CompositionState; after: CompositionState; characters: number; sections: number } | null>(null);
  const danceSources = useMocapSources(projectName ?? "").filter(source => source.resultPath && source.status === "done");

  useEffect(() => {
    const pending = pendingDance.current;
    if (!pending || state === pending.before) return;
    pendingDance.current = null;
    if (state === pending.after) toast.success(t("{characters}명에게 {sections}개 음악 구간의 동작 키를 넣었습니다.", {
      characters: pending.characters, sections: pending.sections,
    }));
    else toast.error("구도가 바뀌었습니다. 다시 적용하세요.");
  }, [state, t]);

  const applyDance = async () => {
    const source = danceSources.find(item => item.id === (danceSourceId || danceSources[0]?.id));
    const sections = music?.sections ?? [];
    if (!projectName || !source || !sections.length || applyingDance) return;
    const characters = state.characters.map(item => item.characterId);
    const genders = characters.map(id => plannerCharacters.find(item => item.id === id)?.gender ??
      state.mannequins.find(item => item.id === id)?.gender);
    if (!characters.length || new Set(genders).size > 1) {
      toast.error(t("배치된 캐릭터가 없거나 몸 리그가 다릅니다. 같은 리그끼리 적용하세요."));
      return;
    }
    setApplyingDance(true);
    try {
      const loaded = await loadMocapResult(projectName, source);
      const latest = mocapSourcesOf(projectName).find(item => item.id === source.id);
      if (!loaded || !latest || latest.resultPath !== source.resultPath || latest.status !== "done")
        throw new Error("저장된 모캡 결과가 바뀌었거나 열리지 않았습니다.");
      const capture = latest.result ?? loaded;
      const person = selectedPerson(capture, dancePersonNumber, capture.start, capture.end);
      const rig = await loadCaptureRetargetRig(genders[0]);
      const frames = retargetPerson(rig, person, capture, { smoothing: latest.smoothing, footPlant: latest.footPlant === true });
      if (frames.length !== person.samples.length || frames.some(frame => !Number.isFinite(frame.time)))
        throw new Error("동작 키를 계산하지 못했습니다.");
      if (mocapSourcesOf(projectName).find(item => item.id === source.id)?.resultPath !== source.resultPath)
        throw new Error("모캡 원본이 변경됐습니다.");
      if (latestState.current !== state) throw new Error("구도가 바뀌었습니다. 다시 적용하세요.");
      const next = applyDanceChoreographyIn(state, characters, frames, sections, { id: source.id, name: source.name });
      pendingDance.current = { before: state, after: next, characters: characters.length, sections: sections.length };
      setState(current => {
        return current === state ? next : current;
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setApplyingDance(false); }
  };

  const analyze = async () => {
    if (!music || analyzing) return;
    const path = music.path;
    setAnalyzing(true);
    try {
      const result = await analyzeMusicFile(path);
      setState((current) => musicOf(current)?.path === path
        ? patchMusicIn(current, { bpm: result.bpm, beatTimes: result.beats, beatConfidence: result.confidence, downbeatIndex: 0 })
        : current);
      toast.success(t("{bpm} BPM · {count}박 분석", { bpm: result.bpm, count: result.beats.length }), {
        description: result.confidence < 0.25 ? t("확신도가 낮습니다. 박자와 첫 박을 확인하세요.") : t("첫 박과 마디 경계를 확인한 뒤 구간을 나누세요."),
      });
    } catch (error) { toast.error(`${t("박자를 분석하지 못했습니다.")} ${error instanceof Error ? error.message : String(error)}`); }
    finally { setAnalyzing(false); }
  };

  /** BGM 화면에서 뽑아 둔 곡을 그대로 씁니다 — 파일은 `BGM/곡/…` 에 두고 경로만 적습니다. */
  const useBgm = async (path: string, label: string) => {
    try {
      const seconds = await measureAudioSeconds(path);
      setPendingMusic({ path, name: label, seconds });
    } catch { toast.error("음원 길이를 읽지 못해 타임라인에 올리지 않았습니다."); }
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
      const seconds = await measureAudioSeconds(path);
      setPendingMusic({ path, name, seconds });
    } catch (error) {
      toast.error(`음악을 고르지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPicking(false);
    }
  };

  const insertMusic = (fitTimeline: boolean) => {
    if (!pendingMusic) return;
    setState((current) => {
      const withMusic = setMusicIn(current, { ...pendingMusic, startTime: 0, sections: [] });
      return fitTimeline ? setTimelineIn(withMusic, { duration: Math.round(pendingMusic.seconds * 10) / 10 }) : withMusic;
    });
    toast.success(`${pendingMusic.name} · ${pendingMusic.seconds.toFixed(1)}초`);
    setPendingMusic(null);
  };

  return (
    <PanelSection tour="timeline-music" title={t("노래")} open={open} onToggle={onToggle}>
      {pendingMusic && (
        <div role="dialog" aria-label="음악 삽입 시 타임라인 길이" className="mb-2 rounded-md border border-violet-500/50 bg-violet-500/10 p-2 text-[10px]">
          <p className="mb-1.5">{pendingMusic.name} ({pendingMusic.seconds.toFixed(1)}초)를 넣습니다. 전체 타임라인 길이를 음악에 맞출까요?</p>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => insertMusic(true)} className="rounded bg-violet-600 px-2 py-1 text-white">음악 길이에 맞추기</button>
            <button type="button" onClick={() => insertMusic(false)} className="rounded border border-white/20 px-2 py-1">현재 길이 유지</button>
            <button type="button" onClick={() => setPendingMusic(null)} className="rounded border border-white/20 px-2 py-1">취소</button>
          </div>
        </div>
      )}
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
                setState((current) => patchMusicIn(current, { bpm: Number(event.target.value) || 120, beatTimes: undefined, beatConfidence: undefined, downbeatIndex: undefined }))
              }
              className="w-12 rounded px-1 py-0.5 text-[9px] tabular-nums outline-none"
              style={FIELD_STYLE}
            />
            <span>BPM ·</span>
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void analyze()}
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold disabled:opacity-50"
              style={{ background: "oklch(0.62 0.22 300 / 18%)", color: "oklch(0.86 0.16 300)" }}
            >
              {analyzing && <LoaderCircle className="mr-0.5 inline h-2.5 w-2.5 animate-spin" />}
              {t("박자 분석")}
            </button>
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
          <div className="flex items-center gap-1 text-[9px]" style={{ color: "oklch(0.58 0.01 265)" }}>
            <label htmlFor="music-start-time">레이어 시작</label>
            <input id="music-start-time" type="number" min={0} max={timeline.duration} step={0.05}
              value={music.startTime ?? 0}
              onChange={event => setState(current => moveMusicStartIn(current, Number(event.target.value)))}
              className="w-16 rounded px-1 py-0.5" style={FIELD_STYLE} />
            <span>초 · 아래 파형 막대를 끌어서 옮길 수도 있습니다</span>
          </div>

          {music.beatTimes?.length ? (
            <div className="flex flex-wrap items-center gap-1 text-[9px]" style={{ color: "oklch(0.68 0.02 265)" }}>
              <span>{t("감지 {count}박 · 확신 {confidence}%", { count: music.beatTimes.length, confidence: Math.round((music.beatConfidence ?? 0) * 100) })}</span>
              <label>{t("첫 박")}</label>
              <select
                value={music.downbeatIndex ?? 0}
                onChange={(event) => setState((current) => patchMusicIn(current, { downbeatIndex: Number(event.target.value) }))}
                style={FIELD_STYLE}
                className="rounded px-1 py-0.5"
              >
                {[0, 1, 2, 3].map(value => <option key={value} value={value}>{t("{number}번째 감지 박", { number: value + 1 })}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setState((current) => splitMusicByDetectedBarsIn(current, musicOf(current)?.barsPerSection ?? 8))}
                className="rounded px-1.5 py-0.5 font-semibold"
                style={{ background: "oklch(0.70 0.18 160 / 16%)", color: "oklch(0.80 0.16 160)" }}
              >{t("분석 박자로 구간 나누기")}</button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1 rounded p-1.5 text-[9px]" style={{ border: "1px solid oklch(0.70 0.18 160 / 22%)" }}>
            <span>{t("음악 구간에 군무 넣기")}</span>
            <input ref={kimodoInput} type="file" accept=".bvh" className="hidden" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (!file || !projectName || importingDance) return;
              setImportingDance(true);
              void importKimodoMotion(projectName, file).then(source => {
                setDanceSourceId(source.id);
                toast.success(t("KIMODO BVH를 프로젝트에 등록했습니다."));
              }).catch(error => toast.error(error instanceof Error ? error.message : String(error)))
                .finally(() => setImportingDance(false));
            }} />
            <button type="button" disabled={importingDance || !projectName} onClick={() => kimodoInput.current?.click()}
              className="rounded px-1.5 py-0.5 disabled:opacity-50" style={FIELD_STYLE}>
              {importingDance && <LoaderCircle className="mr-0.5 inline h-2.5 w-2.5 animate-spin" />}
              {t("KIMODO BVH 가져오기")}
            </button>
            <select value={danceSourceId || danceSources[0]?.id || ""} onChange={event => setDanceSourceId(event.target.value)}
              className="max-w-36 rounded px-1 py-0.5" style={FIELD_STYLE} aria-label={t("모캡 동작 원본")}>
              {danceSources.length ? danceSources.map(source => <option key={source.id} value={source.id}>{source.name}</option>) : <option value="">{t("분석된 동작 없음")}</option>}
            </select>
            <label>{t("인물 번호")}</label>
            <input type="number" min={1} max={99} value={dancePersonNumber}
              onChange={event => setDancePersonNumber(Math.max(1, Number(event.target.value) || 1))}
              className="w-9 rounded px-1 py-0.5" style={FIELD_STYLE} />
            <button type="button" disabled={applyingDance || !danceSources.length || !music.sections.length || !state.characters.length}
              onClick={() => void applyDance()} className="rounded px-1.5 py-0.5 font-semibold disabled:opacity-50"
              style={{ background: "oklch(0.70 0.18 160 / 16%)", color: "oklch(0.80 0.16 160)" }}>
              {applyingDance && <LoaderCircle className="mr-0.5 inline h-2.5 w-2.5 animate-spin" />}
              {t("배치된 캐릭터 모두에게 적용")}
            </button>
            <span>{t("각 캐릭터의 자리·카메라 키는 유지하고 자세 키만 반복합니다.")}</span>
          </div>
          <div className="space-y-1 rounded p-1.5 text-[10px]" style={{ border: "1px solid oklch(0.70 0.18 160 / 22%)" }}>
            <p>{t("KIMODO 동작 생성 · 설정 → 로컬 모델에서 먼저 설치하세요.")}</p>
            <textarea value={motionPrompt} maxLength={4000} disabled={generatingDance}
              onChange={event => setMotionPrompt(event.target.value)} rows={2}
              placeholder={t("영문으로 춤의 동작·분위기를 설명하세요.")}
              aria-label={t("동작 설명")} className="w-full rounded px-1 py-0.5" style={FIELD_STYLE} />
            <div className="flex flex-wrap items-center gap-1">
              <select value={motionModel} disabled={generatingDance} aria-label={t("동작 모델")}
                onChange={event => setMotionModel(event.target.value as typeof motionModel)} style={FIELD_STYLE}>
                {KIMODO_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
              <label>{t("동작 길이(초)")}</label>
              <input type="number" min={0.5} max={30} step={0.5} value={motionSeconds} disabled={generatingDance}
                onChange={event => setMotionSeconds(Number(event.target.value))} className="w-12 rounded" style={FIELD_STYLE} />
              <select value={encoderDevice} disabled={generatingDance} aria-label={t("텍스트 인코더 위치")}
                onChange={event => setEncoderDevice(event.target.value as "cuda" | "cpu")} style={FIELD_STYLE}>
                <option value="cuda">{t("텍스트 인코더 GPU")}</option>
                <option value="cpu">{t("텍스트 인코더 CPU · VRAM 절약")}</option>
              </select>
              <button type="button" disabled={generatingDance || !projectName || !motionPrompt.trim() || !(motionSeconds >= 0.5 && motionSeconds <= 30)}
                onClick={() => {
                  if (!projectName || generatingDance) return;
                  setGeneratingDance(true); setMotionMessage(t("모델 준비 중"));
                  void generateKimodoMotion({ projectName, operationId: crypto.randomUUID(), prompt: motionPrompt,
                    model: motionModel, seconds: motionSeconds, seed: 0, steps: 100, textEncoderDevice: encoderDevice }, setMotionMessage)
                    .then(source => { setDanceSourceId(source.id); toast.success(t("KIMODO BVH를 프로젝트에 등록했습니다.")); })
                    .catch(error => toast.error(error instanceof Error ? error.message : String(error)))
                    .finally(() => { setGeneratingDance(false); setMotionMessage(""); });
                }} className="rounded px-1.5 py-0.5 disabled:opacity-50" style={FIELD_STYLE}>
                {generatingDance && <LoaderCircle className="mr-0.5 inline h-2.5 w-2.5 animate-spin" />}{t("동작 생성")}
              </button>
              {motionMessage && <span role="status">{motionMessage}</span>}
            </div>
            <p>{t("음악 직접 입력 모델이 아닙니다. 생성 후 박자 구간에 동작을 적용하세요. 첫 생성은 모델 다운로드가 필요합니다.")}</p>
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
