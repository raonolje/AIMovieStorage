import { restoreBgmProjectsFromDisk } from "@/lib/bgmRestore";
import { useEffect, useState } from "react";
import { Loader2, Music, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import GlobalNav from "@/components/GlobalNav";
import { WORK_WIDTH } from "@/lib/layout";
import { ConfirmDialogHost, confirmDialog } from "@/components/ConfirmDialog";
import PromptResultPanels from "@/components/PromptResultPanels";
import { LlmRequestButton } from "@/components/LlmRequestButton";
import LocalEnginesPanel from "@/components/LocalEnginesPanel";
import { requestPromptFromLlm } from "@/lib/promptRequest";
import PromptHistoryShelf from "@/components/PromptHistoryShelf";
import type { SavedPromptEntry } from "@/lib/promptHistory";
import { useApiReady } from "@/lib/useApiReady";
import { assetSrc } from "@/lib/mediaLibrary";
import { BGM_TASK, startBgmTrack } from "@/lib/bgmRun";
import { useTaskQueue } from "@/lib/taskQueue";
import { availableLocalEngines, useLocalEngines } from "@/lib/localEngines";
import {
  BGM_ERAS,
  BGM_GENRES,
  BGM_INSTRUMENTS,
  BGM_MOODS,
  BGM_PRODUCTION,
  BGM_VOCALS,
  structureOptionsOf,
  BGM_TOOLS,
  SUNO_LYRICS_COMFORT,
  SUNO_LYRICS_LIMIT,
  SUNO_STYLE_LIMIT,
  type BgmProject,
  type BgmTrack,
  buildBgmStyle,
  localEngineOfTool,
  createBgmProject,
  createBgmTrack,
  loadBgmProjects,
  updateBgmProjects,
  subscribeBgmProjects,
  patchBgmTrack,
} from "@/lib/bgmProjects";

/**
 * LLM 에 보낼 **곡 재료 한 벌**.
 *
 * 「LLM 요청문」 창에 뜨는 글과 API 로 보내는 글이 한 글자도 달라선 안 됩니다(`promptRequest` 규칙).
 * 두 군데에 손으로 적어 두었더니 한쪽에만 보컬·구조 태그를 빠뜨려, 모델이 보컬을 모르는 채
 * 「가사 없음, instrumental」 로 답하는 일이 있었습니다().
 */
function bgmRequestData(track: BgmTrack) {
  return {
    name: track.name,
    usage: track.usage,
    mood: track.mood,
    genre: track.genre,
    instruments: track.instruments,
    vocals: track.vocals ?? [],
    era: track.era ?? [],
    production: track.production ?? [],
    structure: track.structure ?? [],
    tempo: track.tempo || null,
    durationSeconds: track.durationSeconds || null,
    instrumental: track.instrumental,
    /*
      참·거짓만 보내면 모델이 «알아서» 연주곡으로 답합니다. 사람이 끈 스위치를 모델이
      되켜는 셈이라(),
      **한국어 지시문으로** 함께 보냅니다. 값이 아니라 말이어야 지켜집니다.
    */
    지시: track.instrumental
      ? "연주곡입니다. 노랫말을 짓지 말고 구간 태그와 연주 지시만 적으세요."
      : "노래입니다. 반드시 부를 가사를 쓰세요. instrumental·no vocals 같은 말을 스타일에 넣지 마세요.",
    // 이미 적어 둔 가사가 있으면 그것을 **고쳐 쓰라**는 뜻으로 함께 보냅니다.
    lyrics: track.instrumental ? null : track.lyricsKo || track.lyrics || null,
    excludeStyles: track.excludeStyles || null,
    reference: track.reference || null,
    notes: track.notes || null,
    targetTool: track.targetTool,
  };
}

/**
 * Suno 칸의 **글자 수**와 그 칸에서 알아 둘 것 한 줄.
 *
 * 한도를 넘긴 채 붙여넣으면 Suno 가 조용히 뒤를 잘라 냅니다 — 프로덕션·시대 태그가
 * 통째로 날아가는데 화면에는 아무 표시도 안 납니다. 넘치기 전에 보이게 둡니다.
 */
function SunoCount({
  length,
  limit,
  comfort,
  note,
}: {
  length: number;
  limit: number;
  /** 한도보다 먼저 걸리는 실무 기준(가사) — 이보다 길면 Suno 가 서두릅니다. */
  comfort?: number;
  note: string;
}) {
  const over = length > limit;
  const rushed = !over && comfort !== undefined && length > comfort;
  return (
    <p
      className="-mt-1 text-[10px]"
      style={{
        color: over
          ? "oklch(0.70 0.19 25)"
          : rushed
            ? "oklch(0.76 0.15 75)"
            : "oklch(0.46 0.01 265)",
      }}
    >
      {length.toLocaleString()} / {limit.toLocaleString()}자
      {over
        ? " — 한도를 넘겨 뒤가 잘립니다"
        : rushed
          ? ` — ${comfort?.toLocaleString()}자가 넘으면 곡이 서두릅니다`
          : ` · ${note}`}
    </p>
  );
}

function TagRow({
  label,
  options,
  selected,
  onToggle,
  tour,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  /** 튜토리얼 말풍선이 잡을 `data-tour` 이름(`tutorials/ANCHORS.md`). */
  tour?: string;
}) {
  return (
    <div data-tour={tour}>
      <p
        className="mb-1.5 text-[11px] font-semibold"
        style={{ color: "oklch(0.52 0.01 265)" }}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => onToggle(option)}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{
                background: active
                  ? "oklch(0.62 0.22 290 / 20%)"
                  : "oklch(1 0 0 / 4%)",
                border: `1px solid ${active ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 7%)"}`,
                color: active ? "oklch(0.84 0.19 290)" : "oklch(0.62 0.01 265)",
              }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BgmProjectsPage() {
  const [projects, setProjects] = useState<BgmProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeBgmProjects(() => setProjects(loadBgmProjects()));
    /*
      **폴더를 한 번 훑어 되살립니다.**

      BGM 기록은 브라우저 저장소에만 있었습니다. 그래서 `BGM/곡/<프로젝트>/` 에 곡이 멀쩡히
      있어도 화면은 「프로젝트가 없습니다」 였습니다 — 앱을 다시 깔거나 저장소가 비면 그렇게 되고,
      «폴더가 진실» 이라는 이 앱의 규칙과도 어긋납니다.

      먼저 기록을 그대로 띄우고(폴더 읽기를 기다리느라 화면이 비어 있지 않게), 읽어 온 뒤에
      빠진 것만 채웁니다. 사람이 적어 둔 프롬프트는 덮지 않습니다.
    */
    const loaded = loadBgmProjects();
    setProjects(loaded);
    setSelectedId(loaded[0]?.id ?? null);

    let alive = true;
    void restoreBgmProjectsFromDisk().then((filled) => {
      if (!alive || filled === loaded) return;
      setProjects(loadBgmProjects());
      setSelectedId((current) => current ?? filled[0]?.id ?? null);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const persist = updateBgmProjects;

  const createProject = () => {
    const name = newName.trim();
    if (!name) {
      toast.error("이름을 적어 주세요.");
      return;
    }
    const created = createBgmProject(name);
    persist((current) => [...current, created]);
    setSelectedId(created.id);
    setSelectedTrackId(null);
    setAdding(false);
    setNewName("");
  };

  /**
   * BGM 프로젝트를 지웁니다 — **기록만** 지우고 뽑아 둔 곡 파일은 폴더에 남깁니다.
   *
   * 화면에서 지우면 파일도 지우는 것이 이 앱의 규칙이지만(공통 규칙 3),
   * 곡은 예외로 둡니다 — 한 곡을 여러 영상 프로젝트의 컷이 타임라인에 깔고 있을 수 있어, 기록을 지운다고 파일까지 없애면
   * 그 컷들의 노래가 한꺼번에 사라집니다. 폴더(`BGM/곡/<프로젝트>`)는 그대로 두고 사람이 탐색기에서 지웁니다.
   */
  const removeProject = async (target: BgmProject) => {
    const ok = await confirmDialog({
      title: `«${target.name}» 을 지울까요?`,
      description:
        target.tracks.length > 0
          ? `곡 ${target.tracks.length}개의 기록이 함께 사라집니다. 뽑아 둔 음원 파일은 BGM 폴더에 그대로 남습니다.`
          : "되돌릴 수 없습니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    const next = persist((current) => current.filter((item) => item.id !== target.id));
    if (selectedId === target.id) {
      setSelectedId(next[0]?.id ?? null);
      setSelectedTrackId(null);
    }
    toast.success(`«${target.name}» 을 지웠습니다.`, {
      description: "음원 파일은 BGM 폴더에 남아 있습니다.",
    });
  };

  const project = projects.find((item) => item.id === selectedId) ?? null;
  const track =
    project?.tracks.find((item) => item.id === selectedTrackId) ?? null;

  const updateTrack = (patch: Partial<BgmTrack>) => {
    if (!project || !track) return;
    persist(
      (current) => current.map((item) =>
        item.id !== project.id
          ? item
          : {
              ...item,
              updatedAt: Date.now(),
              tracks: item.tracks.map((entry) =>
                entry.id !== track.id
                  ? entry
                  : patchBgmTrack(entry, patch),
              ),
            },
      ),
    );
  };

  /**
   * 「가사 없는 연주곡」 을 켜고 끕니다 — **보컬 태그까지 함께** 맞춥니다.
   *
   * 체크박스와 보컬 태그 «연주곡» 이 따로 놀아서, 체크는 꺼 두고 보컬은 고르지 않은 상태가
   * 흔했습니다. 그러면 LLM 에는 «연주곡 아님» 과 «보컬 없음» 이 같이 가서, 모델이 알아서
   * 연주곡으로 답했습니다().
   * 스위치는 하나여야 합니다.
   */
  const setInstrumental = (on: boolean) => {
    if (!track) return;
    const rest = (track.vocals ?? []).filter((item) => item !== "연주곡");
    // 구간 이름도 갈립니다 — 연주곡에 verse·pre-chorus 가 남아 있으면 안 됩니다.
    const allowed = structureOptionsOf(on);
    updateTrack({
      instrumental: on,
      vocals: on ? ["연주곡"] : rest,
      structure: (track.structure ?? []).filter((item) => allowed.includes(item)),
    });
  };

  const toggleTag = (
    key: "mood" | "genre" | "instruments" | "vocals" | "era" | "production" | "structure",
    value: string,
  ) => {
    if (!track) return;
    // 뒤에 더한 줄(보컬·시대·프로덕션·구조)은 옛 저장본에 없어 빈 배열로 시작합니다.
    // 보컬의 «연주곡» 은 체크박스와 같은 스위치입니다 — 한쪽만 바뀌면 둘이 어긋납니다.
    if (key === "vocals" && value === "연주곡") {
      setInstrumental(!track.instrumental);
      return;
    }
    const current = track[key] ?? [];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    // 사람 목소리를 하나라도 고르면 연주곡일 수 없습니다.
    if (key === "vocals" && next.length > 0 && track.instrumental) {
      updateTrack({ vocals: next.filter((item) => item !== "연주곡"), instrumental: false });
      return;
    }
    updateTrack({ [key]: next } as Partial<BgmTrack>);
  };

  const toolHint =
    BGM_TOOLS.find((tool) => tool.id === track?.targetTool)?.hint ?? "";

  /*
    ── 수노용 프롬프트를 **API 로** ──────────────────────────────────────
    

    여태 이 화면에는 손으로 복사해 붙여넣는 「LLM 요청문」 뿐이라, 곡마다 창을 열고
    붙여넣고 답을 다시 옮겨야 했습니다. 캐릭터·컷 카드에는 이미 API 단추가 있습니다
    (공통 규칙 1 — 한쪽에만 있는 기능을 만들지 않습니다).
  */
  const apiReady = useApiReady();
  const [promptBusy, setPromptBusy] = useState(false);
  const requestPrompt = async () => {
    if (!track || promptBusy) return;
    if (track.styleKo || track.styleEn || track.promptKo || track.promptEn) {
      const ok = await confirmDialog({
        title: "이미 적어 둔 곡 스타일이 있습니다.",
        description:
          "새로 받아 덮어쓸까요? 스타일 두 칸이 사라집니다. 가사는 새로 온 것이 있을 때만 바뀝니다.",
        confirmLabel: "덮어쓰기",
        tone: "danger",
      });
      if (!ok) return;
    }
    setPromptBusy(true);
    try {
      const result = await requestPromptFromLlm({
        task: "bgmPrompt",
        template: "bgm-prompt",
        label: `BGM · ${track.name || "곡"}`,
        deliveredTo: `BGM · ${track.name || "곡"} 프롬프트 두 칸에 넣음`,
        data: bgmRequestData(track),
      });
      /*
        받은 것을 **스타일 두 칸**과 **가사 두 칸**에 넣습니다.

        여태 ko/en 두 칸만 꺼내 쓰는 바람에 단추 이름은 「스타일 · 가사 뽑기」 인데 가사 칸은
        늘 비어 있었습니다(). 가사는 **온 것만**
        덮어씁니다 — 모델이 빠뜨렸을 때 손으로 적어 둔 가사를 지우면 안 됩니다.

        그리고 이력에 남깁니다 — 
      */
      const entry: SavedPromptEntry = {
        id: `${Date.now()}`,
        createdAt: Date.now(),
        ko: result.ko,
        en: result.en,
        negativeKo: "",
        negativeEn: "",
      };
      const gotLyrics = Boolean(result.lyricsKo || result.lyricsEn);
      updateTrack({
        styleKo: result.ko,
        styleEn: result.en,
        promptKo: result.ko,
        promptEn: result.en,
        ...(gotLyrics
          ? {
              lyricsKo: result.lyricsKo || track.lyricsKo || track.lyrics,
              lyricsEn: result.lyricsEn || track.lyricsEn || "",
              lyrics: result.lyricsKo || track.lyrics,
            }
          : {}),
        promptHistory: [entry, ...(track.promptHistory ?? [])].slice(0, 20),
      });
      /*
        사람이 끈 스위치를 모델이 되켰는지 봅니다.

        「가사 없는 연주곡」 이 꺼져 있는데 연주곡으로 답해 오는 일이 있었습니다
        ().
        요청문에서 못을 박았지만 모델이 늘 지키리라 믿을 수는 없으니, 어긋나면 **보이게** 합니다.
        조용히 넘어가면 스타일 칸에 «no vocals» 가 박힌 채로 생성기까지 갑니다.
      */
      const saysInstrumental = /instrumental|no vocals|no human voice|가사\s*없|목소리(를)?\s*사용하지/i.test(
        `${result.ko}\n${result.en}`,
      );
      if (!track.instrumental && (saysInstrumental || !gotLyrics)) {
        toast.warning("연주곡이 아닌데 가사 없이 왔습니다.", {
          description: "보컬을 골라 두었는지 보고 다시 뽑아 보세요. 스타일 칸의 «instrumental» 도 지워야 합니다.",
        });
      } else {
        toast.success(
          gotLyrics ? "곡 스타일과 가사를 받아 칸에 넣었습니다." : "곡 스타일을 받아 칸에 넣었습니다.",
        );
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPromptBusy(false);
    }
  };

  /*
    ── 로컬 음악 모델로 **바로 뽑기** ────────────────────────────────────
    

    프롬프트는 **영문 칸**을 보냅니다. 음악 모델의 태그 어휘가 영어라, 한글을 그대로
    넣으면 장르·악기를 못 알아듣고 밋밋한 곡이 나옵니다.
  */
  useLocalEngines(); // 설치 상태를 구독해야 «바로 뽑기» 단추가 제때 살아납니다.
  /*
    **고른 도구의 엔진**으로 뽑습니다. 예전에는 설치된 음악 엔진 중 첫 번째를 말없이 썼습니다. 수노를 고른 상태면 로컬 칸은 비어 있습니다.
  */
  const wantedEngine = track ? localEngineOfTool(track.targetTool) : null;
  const musicEngine =
    availableLocalEngines("music").find((engine) => engine.id === wantedEngine) ?? null;
  /*
    ── 곡 뽑기는 **작업 줄**에서 ──────────────────────────────────────────
    

    여기서 `await` 로 돌고 있었습니다. 그래서 이 화면을 벗어나면 진행을 물을 데가 없고,
    앱이 꺼지면 남은 일이 사라졌습니다. 곡 하나에 몇 분씩 걸리는 일이라 그림·영상과 같은
    줄에 섭니다(`lib/bgmRun.ts`). 여기서는 **세우고, 그 줄을 들여다보기만** 합니다.
  */
  const tasks = useTaskQueue();
  const running = tasks.find(
    (item) =>
      item.kind === BGM_TASK &&
      (item.payload as { trackId?: string })?.trackId === track?.id &&
      (item.status === "running" || item.status === "waiting"),
  );
  const makingMusic = Boolean(running);
  const musicStatus = running?.step || (running?.status === "waiting" ? "차례를 기다리는 중" : "");

  const makeMusic = () => {
    if (!track || !project || !musicEngine) return;
    startBgmTrack({
      projectId: project.id,
      projectName: project.name,
      trackId: track.id,
      trackName: track.name || "곡",
      engine: musicEngine.id,
      prompt: (track.promptEn || track.promptKo).trim(),
      seconds: Number(track.durationSeconds) || 60,
      // 연주곡이면 가사를 비웁니다 — 비면 엔진이 `[inst]` 로 받습니다.
      lyrics: track.instrumental ? "" : track.lyrics,
    });
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "oklch(0.12 0.008 265)" }}
    >
      <GlobalNav />
      {/* 위쪽 띠가 sticky 라 자리를 이미 차지합니다. pt 를 크게 주면 빈 줄이 생깁니다. */}
      <main className={`${WORK_WIDTH} pb-14 pt-6`}>
        <header className="mb-8">
          <p
            className="mb-2 text-xs font-bold uppercase tracking-widest"
            style={{ color: "oklch(0.67 0.22 290)" }}
          >
            BGM
          </p>
          <h1 className="font-display text-3xl font-bold text-white">
            BGM 프로젝트
          </h1>
          <p className="mt-2 text-sm" style={{ color: "oklch(0.55 0.01 265)" }}>
            Suno · ComfyUI 의 MiniMax Music 용 프롬프트를 만들고, 생성한 곡을
            곡별로 정리합니다.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          {/* 프로젝트·트랙 목록 */}
          <aside className="space-y-3">
            {/*
              이름을 여기서 바로 받습니다.
              예전에는 window.prompt 를 썼는데, **데스크톱 앱의 WebView 는 그걸
              띄우지 않습니다.** 버튼을 눌러도 아무 일도 안 일어나서 «BGM 은
              프로젝트를 못 만든다» 는 상태로 한동안 있었습니다.
            */}
            {adding ? (
              <div
                className="space-y-1.5 rounded-lg p-2"
                style={{
                  background: "oklch(0.16 0.01 265)",
                  border: "1px solid oklch(0.62 0.22 290 / 35%)",
                }}
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createProject();
                    if (event.key === "Escape") {
                      setAdding(false);
                      setNewName("");
                    }
                  }}
                  placeholder="BGM 프로젝트 이름"
                  className="w-full rounded-md px-2.5 py-1.5 text-xs outline-none"
                  style={{
                    background: "oklch(0.18 0.012 265)",
                    border: "1px solid oklch(1 0 0 / 10%)",
                    color: "white",
                  }}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={createProject}
                    className="flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-white gradient-primary"
                  >
                    만들기
                  </button>
                  <button
                    onClick={() => {
                      setAdding(false);
                      setNewName("");
                    }}
                    className="rounded-md px-2 py-1.5 text-[11px]"
                    style={{
                      background: "oklch(1 0 0 / 6%)",
                      color: "oklch(0.60 0.01 265)",
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                data-tour="bgm-project-add"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white gradient-primary"
              >
                <Plus className="h-3.5 w-3.5" /> 프로젝트 추가
              </button>
            )}

            <div className="space-y-1">
              {projects.map((item) => (
                <div
                  key={item.id}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2"
                  style={{
                    background:
                      item.id === selectedId
                        ? "oklch(0.62 0.22 290 / 14%)"
                        : "oklch(0.16 0.01 265)",
                    border: `1px solid ${item.id === selectedId ? "oklch(0.62 0.22 290 / 35%)" : "oklch(1 0 0 / 6%)"}`,
                  }}
                >
                  <button
                    onClick={() => {
                      setSelectedId(item.id);
                      setSelectedTrackId(null);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Music
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: "oklch(0.72 0.15 200)" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-white">
                      {item.name}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "oklch(0.48 0.01 265)" }}
                    >
                      {item.tracks.length}
                    </span>
                  </button>
                  <button
                    onClick={() => void removeProject(item)}
                    title="이 BGM 프로젝트를 지웁니다 — 음원 파일은 폴더에 남습니다"
                    aria-label="프로젝트 지우기"
                    className="shrink-0 rounded p-1 hover:bg-white/10"
                    style={{ color: "oklch(0.60 0.15 25)" }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {projects.length === 0 && (
                <p
                  className="px-1 text-[11px]"
                  style={{ color: "oklch(0.45 0.01 265)" }}
                >
                  프로젝트가 없습니다.
                </p>
              )}
            </div>

            {project && (
              <div
                className="space-y-1 border-t pt-3"
                style={{ borderColor: "oklch(1 0 0 / 8%)" }}
              >
                <button
                  data-tour="bgm-track-add"
                  data-tour-open="bgm-chips bgm-tempo-length bgm-tool bgm-instrumental bgm-write bgm-style-panels bgm-history bgm-local-generate bgm-tracks-list"
                  onClick={() => {
                    const created = createBgmTrack();
                    persist(
                      (current) => current.map((item) =>
                        item.id !== project.id
                          ? item
                          : { ...item, updatedAt: Date.now(), tracks: [...item.tracks, created] },
                      ),
                    );
                    setSelectedTrackId(created.id);
                  }}
                  className="w-full rounded-md px-3 py-1.5 text-[11px] font-semibold"
                  style={{
                    background: "oklch(1 0 0 / 5%)",
                    color: "oklch(0.74 0.14 200)",
                  }}
                >
                  + 곡 추가
                </button>
                {project.tracks.map((entry, index) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedTrackId(entry.id)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left"
                    style={{
                      background:
                        entry.id === selectedTrackId
                          ? "oklch(0.55 0.15 200 / 14%)"
                          : "transparent",
                      color: "oklch(0.75 0.01 265)",
                    }}
                  >
                    <span
                      className="text-[10px]"
                      style={{ color: "oklch(0.45 0.01 265)" }}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">
                      {entry.name || "이름 없는 곡"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* 곡 편집 */}
          <section>
            {!track ? (
              <div
                className="rounded-lg p-8 text-center text-sm"
                style={{
                  background: "oklch(0.14 0.012 265)",
                  border: "1px solid oklch(1 0 0 / 8%)",
                  color: "oklch(0.50 0.01 265)",
                }}
              >
                왼쪽에서 곡을 고르거나 새로 추가하세요.
              </div>
            ) : (
              <div
                className="space-y-4 rounded-lg p-5"
                style={{
                  background: "oklch(0.14 0.012 265)",
                  border: "1px solid oklch(1 0 0 / 8%)",
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={track.name}
                    onChange={(event) =>
                      updateTrack({ name: event.target.value })
                    }
                    placeholder="곡 이름 (예: 오프닝 테마)"
                    className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none"
                    style={{
                      background: "oklch(0.18 0.012 265)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "white",
                    }}
                  />
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `${track.name || "이름 없는 곡"} 을 지울까요?`,
                        description:
                          "곡 설정과 프롬프트가 사라집니다. 폴더에 저장된 음원 파일은 남습니다.",
                        confirmLabel: "지우기",
                        tone: "danger",
                      });
                      if (!ok) return;
                      persist(
                        (current) => current.map((item) =>
                          item.id !== project!.id
                            ? item
                            : {
                                ...item,
                                updatedAt: Date.now(),
                                tracks: item.tracks.filter(
                                  (entry) => entry.id !== track.id,
                                ),
                              },
                        ),
                      );
                      setSelectedTrackId(null);
                    }}
                    className="rounded-md p-2 hover:bg-white/10"
                    style={{ color: "oklch(0.60 0.14 25)" }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <input
                  value={track.usage}
                  onChange={(event) =>
                    updateTrack({ usage: event.target.value })
                  }
                  placeholder="어느 장면에 쓸지 (예: 씬 2 골목 추격)"
                  className="w-full rounded-md px-3 py-2 text-xs outline-none"
                  style={{
                    background: "oklch(0.18 0.012 265)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                    color: "white",
                  }}
                />

                <TagRow
                  tour="bgm-chips"
                  label="분위기"
                  options={BGM_MOODS}
                  selected={track.mood}
                  onToggle={(value) => toggleTag("mood", value)}
                />
                <TagRow
                  label="장르"
                  options={BGM_GENRES}
                  selected={track.genre}
                  onToggle={(value) => toggleTag("genre", value)}
                />
                <TagRow
                  label="악기"
                  options={BGM_INSTRUMENTS}
                  selected={track.instruments}
                  onToggle={(value) => toggleTag("instruments", value)}
                />
                {/*
                   보컬·시대·프로덕션·구조까지 —
                  여기서 고른 낱말이 그대로 스타일 문장과 가사 틀이 됩니다.
                */}
                <TagRow
                  label="보컬"
                  options={BGM_VOCALS}
                  selected={track.vocals ?? []}
                  onToggle={(value) => toggleTag("vocals", value)}
                />
                <TagRow
                  label="시대 · 질감"
                  options={BGM_ERAS}
                  selected={track.era ?? []}
                  onToggle={(value) => toggleTag("era", value)}
                />
                <TagRow
                  label="프로덕션"
                  options={BGM_PRODUCTION}
                  selected={track.production ?? []}
                  onToggle={(value) => toggleTag("production", value)}
                />
                <TagRow
                  label={track.instrumental ? "곡 구조 (연주)" : "곡 구조"}
                  options={structureOptionsOf(track.instrumental)}
                  selected={track.structure ?? []}
                  onToggle={(value) => toggleTag("structure", value)}
                />
                <p className="-mt-1 text-[10px]" style={{ color: "oklch(0.46 0.01 265)" }}>
                  {track.instrumental
                    ? "고른 차례대로 구간이 만들어집니다. 연주곡이라 verse · chorus 대신 주제와 변주로 짭니다."
                    : "고른 차례대로 가사 틀이 됩니다. 로컬 모델은 길이(초)보다 이 구간 수를 따릅니다."}
                </p>

                <div className="grid gap-2 sm:grid-cols-3" data-tour="bgm-tempo-length">
                  <label
                    className="text-[11px]"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    템포 (BPM)
                    <input
                      value={track.tempo}
                      onChange={(event) =>
                        updateTrack({ tempo: event.target.value })
                      }
                      placeholder="비우면 자동"
                      className="mt-1 w-full rounded-md px-2 py-1.5 text-xs outline-none"
                      style={{
                        background: "oklch(0.18 0.012 265)",
                        border: "1px solid oklch(1 0 0 / 8%)",
                        color: "white",
                      }}
                    />
                  </label>
                  <label
                    className="text-[11px]"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    길이 (초)
                    <input
                      value={track.durationSeconds}
                      placeholder="비우면 자동"
                      title="비워 두면 생성기가 곡 구조에 맞춰 정합니다. 로컬 모델은 가사의 구조 태그가 길이를 정합니다"
                      onChange={(event) =>
                        updateTrack({ durationSeconds: event.target.value })
                      }
                      className="mt-1 w-full rounded-md px-2 py-1.5 text-xs outline-none"
                      style={{
                        background: "oklch(0.18 0.012 265)",
                        border: "1px solid oklch(1 0 0 / 8%)",
                        color: "white",
                      }}
                    />
                  </label>
                  <label
                    data-tour="bgm-tool"
                    className="text-[11px]"
                    style={{ color: "oklch(0.52 0.01 265)" }}
                  >
                    생성 도구
                    <select
                      value={track.targetTool}
                      onChange={(event) =>
                        updateTrack({
                          targetTool: event.target
                            .value as BgmTrack["targetTool"],
                        })
                      }
                      className="mt-1 w-full rounded-md px-2 py-1.5 text-xs outline-none"
                      style={{
                        background: "oklch(0.18 0.012 265)",
                        border: "1px solid oklch(1 0 0 / 8%)",
                        color: "white",
                      }}
                    >
                      {BGM_TOOLS.map((tool) => (
                        <option key={tool.id} value={tool.id}>
                          {tool.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {toolHint && (
                  <p
                    className="text-[10px] leading-relaxed"
                    style={{ color: "oklch(0.45 0.01 265)" }}
                  >
                    {toolHint}
                  </p>
                )}

                <label
                  data-tour="bgm-instrumental"
                  className="flex items-center gap-2 text-[11px]"
                  style={{ color: "oklch(0.55 0.01 265)" }}
                >
                  <input
                    type="checkbox"
                    checked={track.instrumental}
                    onChange={(event) => setInstrumental(event.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  가사 없는 연주곡
                </label>
                <p className="-mt-1 text-[10px]" style={{ color: "oklch(0.46 0.01 265)" }}>
                  {track.instrumental
                    ? "가사 없이 연주로만 만듭니다. 「스타일 · 가사 뽑기」 는 구간 태그만 채웁니다."
                    : "노래입니다 — 「스타일 · 가사 뽑기」 가 가사를 써 옵니다. 연주곡으로 받고 싶으면 이 칸을 켜세요."}
                </p>

                {!track.instrumental && (
                  <textarea
                    value={track.lyrics}
                    onChange={(event) =>
                      updateTrack({ lyrics: event.target.value })
                    }
                    rows={4}
                    placeholder="가사"
                    className="w-full resize-y rounded-md px-3 py-2 text-xs leading-relaxed outline-none"
                    style={{
                      background: "oklch(0.11 0.008 265)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "oklch(0.82 0.01 265)",
                    }}
                  />
                )}

                <input
                  value={track.reference}
                  onChange={(event) =>
                    updateTrack({ reference: event.target.value })
                  }
                  placeholder="참고할 느낌 (예: 느린 현악에 낮은 신스가 깔린 도시 야경)"
                  className="w-full rounded-md px-3 py-2 text-xs outline-none"
                  style={{
                    background: "oklch(0.18 0.012 265)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                    color: "white",
                  }}
                />

                <textarea
                  value={track.notes}
                  onChange={(event) =>
                    updateTrack({ notes: event.target.value })
                  }
                  rows={3}
                  placeholder="곡 구조나 전개에 대한 메모 (예: 20초까지 정적, 이후 드럼 진입)"
                  className="w-full resize-y rounded-md px-3 py-2 text-xs leading-relaxed outline-none"
                  style={{
                    background: "oklch(0.11 0.008 265)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                    color: "oklch(0.82 0.01 265)",
                  }}
                />

                <div
                  className="flex flex-wrap items-center justify-end gap-2 border-t pt-3"
                  style={{ borderColor: "oklch(1 0 0 / 8%)" }}
                >
                  <LlmRequestButton
                    template="bgm-prompt"
                    title={`곡 스타일 · 가사 요청 · ${track.name || "곡"}`}
                    data={() => bgmRequestData(track)}
                    tail="가사"
                    // 곡에는 네거티브 칸이 없습니다. 스타일 두 칸과 가사 두 칸만 씁니다.
                    onApplyPrompt={(result) =>
                      updateTrack({
                        styleKo: result.ko,
                        styleEn: result.en,
                        promptKo: result.ko,
                        promptEn: result.en,
                        ...(result.lyricsKo || result.lyricsEn
                          ? {
                              lyricsKo: result.lyricsKo || track.lyricsKo || track.lyrics,
                              lyricsEn: result.lyricsEn || track.lyricsEn || "",
                              lyrics: result.lyricsKo || track.lyrics,
                            }
                          : {}),
                      })
                    }
                  />
                  {/*
                    API 로 바로 받는 「프롬프트 작성」. 캐릭터·컷 카드에 있는 그 단추와
                    같은 자리, 같은 모양입니다(공통 규칙 1).
                  */}
                  <button
                    type="button"
                    onClick={() => void requestPrompt()}
                    data-tour="bgm-write"
                    disabled={promptBusy || !apiReady}
                    title={
                      apiReady
                        ? "설정에서 고른 모델로 곡 스타일과 가사를 받아 칸에 넣습니다"
                        : "설정에서 API 키를 넣어야 씁니다. 「LLM 요청문」 은 지금도 됩니다"
                    }
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white gradient-primary disabled:opacity-40"
                  >
                    {promptBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    스타일 · 가사 뽑기
                  </button>
                  <button
                    onClick={async () => {
                      if (track.styleKo || track.styleEn || track.promptKo || track.promptEn) {
                        const ok = await confirmDialog({
                          title: "이미 적어 둔 스타일이 있습니다.",
                          description:
                            "새로 만들어 덮어쓸까요? 지금 적힌 내용은 사라집니다.",
                          confirmLabel: "덮어쓰기",
                          tone: "danger",
                        });
                        if (!ok) return;
                      }
                      const made = buildBgmStyle(track);
                      updateTrack({
                        styleKo: made.styleKo,
                        styleEn: made.styleEn,
                        promptKo: made.styleKo,
                        promptEn: made.styleEn,
                        lyricsKo: made.lyricsKo,
                        lyricsEn: made.lyricsEn,
                        lyrics: made.lyricsKo,
                      });
                      toast.success("곡 스타일과 가사 틀을 만들었습니다.");
                    }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: "oklch(1 0 0 / 6%)",
                      color: "oklch(0.70 0.14 160)",
                    }}
                  >
                    <Wand2 className="h-3 w-3" /> 규칙 조립
                  </button>
                </div>

                {/*
                  ── 곡 스타일과 가사 ───────────────────────────────────
                  , 「마그니픽으로 프롬프트 복사하는 버튼은 여기는 필요 없어」.

                  Suno v6 은 *Style*(1,000자)·*Lyrics*(5,000자) 두 칸을 받고, 로컬 모델도 스타일 서술 + 가사입니다.
                  그래서 화면도 그 두 칸이고, 네거티브 칸은 없앴습니다 — 대신 아래 «제외할 스타일» 이 그 자리입니다.
                */}
                <PromptResultPanels
                  tour="bgm-style-panels"
                  magnific={false}
                  koLabel="곡 스타일 (한글)"
                  enLabel="Style (생성기에 넣는 칸)"
                  korean={track.styleKo ?? track.promptKo}
                  english={track.styleEn ?? track.promptEn}
                  compact
                  onKoreanChange={(value) => updateTrack({ styleKo: value, promptKo: value })}
                  onEnglishChange={(value) => updateTrack({ styleEn: value, promptEn: value })}
                />
                {track.targetTool === "suno" && (
                  <SunoCount
                    length={(track.styleEn ?? track.promptEn ?? "").length}
                    limit={SUNO_STYLE_LIMIT}
                    note="Style Influence 가 기본 50% 라 앞에 쓴 말이 살아남습니다"
                  />
                )}

                <PromptResultPanels
                  magnific={false}
                  koLabel="가사 (한글)"
                  enLabel="Lyrics (생성기에 넣는 칸)"
                  korean={track.lyricsKo ?? track.lyrics}
                  english={track.lyricsEn ?? ""}
                  compact
                  onKoreanChange={(value) => updateTrack({ lyricsKo: value, lyrics: value })}
                  onEnglishChange={(value) => updateTrack({ lyricsEn: value })}
                />
                {track.targetTool === "suno" && (
                  <SunoCount
                    length={(track.lyricsEn ?? "").length}
                    limit={SUNO_LYRICS_LIMIT}
                    comfort={SUNO_LYRICS_COMFORT}
                    note="구간 머리말에 «[Bridge | Female — Whispered]» 처럼 연출을 적을 수 있습니다 (v6)"
                  />
                )}

                {/*
                  네거티브 프롬프트가 아니라 **제외할 스타일**입니다(Suno 의 Exclude Styles).
                  로컬 모델에는 이런 칸이 없어 스타일 끝에 «avoid …» 로 붙습니다.
                */}
                <label className="block space-y-1">
                  <span className="text-[11px]" style={{ color: "oklch(0.52 0.01 265)" }}>
                    제외할 스타일 — 빼고 싶은 것 (예: heavy metal, autotune)
                  </span>
                  <input
                    value={track.excludeStyles ?? ""}
                    onChange={(event) => updateTrack({ excludeStyles: event.target.value })}
                    placeholder="쉼표로 나열 · Suno 는 5개까지"
                    className="w-full rounded-md px-3 py-2 text-xs outline-none"
                    style={{
                      background: "oklch(0.18 0.012 265)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "white",
                    }}
                  />
                </label>

                {/*
                  받아 둔 것을 되돌릴 수 있게 **이력**을 답니다 — 인물·장소 카드와 같은 선반입니다(규칙 1).
                */}
                <PromptHistoryShelf
                  history={track.promptHistory ?? []}
                  onRestore={(entry) =>
                    updateTrack({
                      styleKo: entry.ko,
                      styleEn: entry.en,
                      promptKo: entry.ko,
                      promptEn: entry.en,
                    })
                  }
                  onRename={(id, label) =>
                    updateTrack({
                      promptHistory: (track.promptHistory ?? []).map((item) =>
                        item.id === id ? { ...item, label } : item,
                      ),
                    })
                  }
                  onRemove={(id) =>
                    updateTrack({
                      promptHistory: (track.promptHistory ?? []).filter((item) => item.id !== id),
                    })
                  }
                  title="받아 둔 곡 스타일"
                  tour="bgm-history"
                  emptyText="아직 없습니다 — 위에서 받거나 조립하면 여기 쌓입니다."
                />

                {/*
                  ── 로컬 모델로 바로 뽑기 ────────────────────────────────
                   수노는 밖에서 뽑아 오는 길이라 프롬프트까지,
                  로컬은 여기서 파일까지 나옵니다.
                */}
                <section
                  className="space-y-2 rounded-lg p-3"
                  style={{
                    background: "oklch(0.11 0.008 265)",
                    border: "1px solid oklch(0.72 0.16 290 / 22%)",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Music
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: "oklch(0.84 0.16 290)" }}
                    />
                    <p className="shrink-0 text-[11px] font-semibold text-white">
                      로컬 모델로 바로 뽑기
                    </p>
                    <p
                      className="min-w-0 flex-1 truncate text-[10px]"
                      style={{ color: "oklch(0.45 0.01 265)" }}
                    >
                      {musicEngine
                        ? `${musicEngine.name} · 영문 스타일과 가사를 보냅니다 (태그 어휘가 영어입니다)`
                        : wantedEngine
                          ? "고른 모델이 아직 설치되지 않았습니다 — 아래에서 설치하세요"
                          : "위 «생성 도구» 에서 로컬 모델을 고르면 여기서 바로 뽑습니다"}
                    </p>
                    <button
                      type="button"
                      onClick={() => void makeMusic()}
                      data-tour="bgm-local-generate"
                      disabled={!musicEngine || makingMusic}
                      className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
                    >
                      {makingMusic ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Music className="h-3 w-3" />
                      )}
                      {makingMusic ? "줄에 섰습니다" : "바로 뽑기"}
                    </button>
                  </div>

                  {makingMusic && musicStatus && (
                    <p
                      className="text-[10px]"
                      style={{ color: "oklch(0.72 0.14 290)" }}
                    >
                      {musicStatus}
                    </p>
                  )}

                  {(track.resultPaths || []).length > 0 && (
                    <div className="space-y-1.5" data-tour="bgm-tracks-list">
                      {(track.resultPaths || []).map((path) => (
                        <div key={path} className="flex items-center gap-2">
                          <audio
                            src={assetSrc(path) || undefined}
                            controls
                            preload="metadata"
                            className="min-w-0 flex-1"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateTrack({
                                resultPaths: (track.resultPaths || []).filter(
                                  (item) => item !== path,
                                ),
                              })
                            }
                            title="목록에서 뺍니다(폴더의 파일은 그대로 둡니다)"
                            className="shrink-0 rounded p-1 hover:bg-white/10"
                            style={{ color: "oklch(0.60 0.15 25)" }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <LocalEnginesPanel compact kinds={["music"]} />
                </section>
              </div>
            )}
          </section>
        </div>
      </main>
      {/* 확인 창을 띄울 자리. 이게 없으면 confirmDialog 가 열리지 않습니다. */}
      <ConfirmDialogHost />
    </div>
  );
}
