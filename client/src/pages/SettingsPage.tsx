import { useEffect, useState } from "react";
import { LLM_CONCURRENCY, LLM_CONCURRENCY_CHOICES, getLlmConcurrency, setLlmConcurrency, useLlmConcurrency } from "@/lib/taskQueue";
import {
  BookOpen,
  Cpu,
  FileText,
  FolderOpen,
  Grid2x2,
  KeyRound,
  Languages,
  Layers,
  Link2,
  Maximize2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import UpdateBanner from "@/components/UpdateBanner";
import AppControlPanel from "@/components/AppControlPanel";
import {
  fetchedAtFor,
  isLoadingModels,
  modelsFor,
  refreshModels,
  useModelCatalog,
} from "@/lib/modelCatalog";
import { useLocation } from "wouter";
import { ensureTutorialSample } from "@/lib/tutorialSample";
import { LOCALES, setLocale, useLocale, useT } from "@/lib/i18n";
import { resetTutorials, setTutorialsEnabled, useTutorial } from "@/lib/tutorialStore";
import { TUTORIALS } from "@/tutorials";
import MagnificConnectPanel from "@/components/MagnificConnectPanel";
import LoraLibraryPanel from "@/components/LoraLibraryPanel";
import GlobalNav from "@/components/GlobalNav";
import { READING_WIDTH } from "@/lib/layout";
import { ConfirmDialogHost, confirmDialog } from "@/components/ConfirmDialog";
import PromptLibraryPanel from "@/components/PromptLibraryPanel";
import LocalEnginesPanel from "@/components/LocalEnginesPanel";
import {
  getAutoUnfoldEnabled,
  setAutoUnfoldEnabled,
} from "@/components/project/useAutoUnfold";
import {
  chooseStorageDirectory,
  getMediaLibrarySettings,
  saveMediaLibrarySettings,
} from "@/lib/mediaLibrary";
import { ensurePresetFolder, getPresetFolder, presetDirectory, setPresetFolder } from "@/lib/posePresets";
import { isOverrideActive } from "@/lib/storagePaths";
import {
  ensurePromptFolders,
  getPromptLibrarySettings,
  promptBaseDirectory,
  savePromptLibrarySettings,
  seedPromptLibrary,
} from "@/lib/promptLibrary";
import {
  LLM_TASK_LABELS,
  REASONING_EFFORT_OPTIONS,
  deleteApiKey,
  getActiveProvider,
  getApiKeyStatus,
  getTaskModels,
  resetTaskModelsFor,
  saveActiveProvider,
  saveApiKey,
  saveTaskModels,
  verifyApiKey,
  type ApiKeyStatus,
  type LlmProvider,
  type LlmTask,
  type ReasoningEffort,
} from "@/lib/llm";
import {
  SEEDVR2_MODEL_OPTIONS,
  SPANDREL_MODEL_OPTIONS,
  UPSCALE_STAGE_LABELS,
  UPSCALE_TARGET_OPTIONS,
  cancelInstall,
  checkComfy,
  chooseComfyWorkflowFile,
  defaultEngine,
  formatBytes,
  getComfySettings,
  getUpscaleSettings,
  inspectComfyWorkflow,
  installEngine,
  listEngines,
  saveComfySettings,
  saveUpscaleSettings,
  stopWorkers,
  uninstallEngine,
  upscaleReachNote,
  useUpscaleEngines,
  workerInfo,
  workflowProblem,
  type ComfySettings,
  type ComfyWorkflowInfo,
  type SeedVr2Model,
  type SpandrelModel,
  type UpscaleEngineId,
  type UpscaleEngineStatus,
  type UpscaleInstallProgress,
  type UpscaleSettings,
  type UpscaleTarget,
} from "@/lib/upscale";

/**
 * 설정 화면.
 *
 * 사고로 잃어 다시 쓴 것입니다. 기록에 55% 가 남아 있어서, 살아 있는 부분은
 * 그대로 쓰고 빈 곳만 채웠습니다.
 *
 * 작업별 모델은 **제공자마다 따로** 저장됩니다. 제공자를 바꿔 가며 비교해
 * 보는 일이 잦은데, 한 벌만 두면 바꿀 때마다 앞의 설정이 지워집니다.
 *
 * 문구는 `t()` 를 거칩니다(한국어 원문이 열쇠 — `lib/i18n.ts`). 아직 안 감싼 칸(엔진·로라·문구 판)은
 * 한국어로 나옵니다. 튜토리얼이 가리키는 칸에는 `data-tour` 가 달려 있습니다(`tutorials/ANCHORS.md`).
 */

// 힌트는 한국어 원문 그대로 두고 그릴 때 `t()` 로 바꿉니다 — 모듈 상수에 `t()` 를 넣으면 언어를 바꿔도 안 따라옵니다.
const PROVIDERS: { id: LlmProvider; label: string; hint: string; dot: string }[] = [
  {
    id: "claude",
    label: "Claude",
    hint: "긴 글과 판단이 필요한 작업에 씁니다",
    dot: "oklch(0.72 0.17 50)",
  },
  {
    id: "openai",
    label: "GPT",
    hint: "구조를 잡고 형식을 맞추는 작업에 씁니다",
    dot: "oklch(0.75 0.15 160)",
  },
];

export default function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const tutorials = useTutorial();
  const [baseDirectory, setBaseDirectory] = useState("");
  const [, navigate] = useLocation();
  /** 예시 작품은 그림 넉 장을 복사하므로 잠깐 걸립니다. 그 사이 두 번 눌리면 두 번 만듭니다. */
  const [makingSample, setMakingSample] = useState(false);
  const [presetFolder, setPresetFolderValue] = useState("");
  const [promptFolder, setPromptFolder] = useState("");
  const [taskModels, setTaskModels] = useState(getTaskModels());
  // «API 동시 요청 수» — 줄(`taskQueue`)이 진실이고 화면은 보여 주기만 합니다.
  const [llmConcurrency, setLlmConcurrencyState] = useState(() => getLlmConcurrency());
  const concurrencyNow = useLlmConcurrency();
  const [activeProvider, setActiveProvider] = useState<LlmProvider>(getActiveProvider());
  /*
    **모델 목록은 제공자에게 물어봅니다**(`modelCatalog.ts`).

    설정을 열 때 한 번 받아 두고 하루 동안 기억합니다. 실패해도 알림을 띄우지 않습니다 —
    아직 키를 안 넣은 사람에게 설정을 열 때마다 잔소리가 되니까요. 그때는 앱에 적어 둔
    목록으로 물러서고, 사람이 「목록 새로 받기」 를 누르면 그제야 까닭을 보여 줍니다.
  */
  useModelCatalog();
  const modelsLoading = isLoadingModels(activeProvider);
  const modelsFetchedAt = fetchedAtFor(activeProvider);
  useEffect(() => {
    void refreshModels(activeProvider);
  }, [activeProvider]);
  const [keyStatus, setKeyStatus] = useState<Record<LlmProvider, ApiKeyStatus>>({
    claude: { provider: "claude", saved: false, hint: null },
    openai: { provider: "openai", saved: false, hint: null },
  });
  const [keyInput, setKeyInput] = useState<Record<LlmProvider, string>>({
    claude: "",
    openai: "",
  });
  const [verifying, setVerifying] = useState<LlmProvider | null>(null);
  // ComfyUI 는 «외부 엔진» — 주소·워크플로만 여기 둡니다. 저장은 localStorage(다른 옵션과 같은 관례).
  const [comfy, setComfy] = useState<ComfySettings>(getComfySettings());
  const [comfyChecking, setComfyChecking] = useState(false);
  const [workflowInfo, setWorkflowInfo] = useState<ComfyWorkflowInfo | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  /**
   * 업스케일 엔진 — 설정 값은 여기(localStorage), 설치 상태·진행은 `useUpscaleEngines`(모듈 캐시)입니다.
   * 설치는 수십 분이 걸려서 이 화면을 떠나 있는 동안에도 진행돼야 하므로, 진행 줄을 컴포넌트가
   * 아니라 모듈이 듭니다 — 돌아오면 하던 진행이 그대로 이어집니다.
   */
  const [upscale, setUpscale] = useState<UpscaleSettings>(getUpscaleSettings());
  const { engines, installs, loaded: enginesLoaded, statusError } = useUpscaleEngines();
  /** 엔진별 «상태 확인» 으로 받아 온 워커 정보 한 줄. */
  const [engineNotes, setEngineNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    setBaseDirectory(getMediaLibrarySettings().baseDirectory);
    setPresetFolderValue(getPresetFolder());
    setPromptFolder(getPromptLibrarySettings().baseDirectory);
    void refreshKeys();
    // 잡혀 있는 워크플로가 아직 쓸 만한지(파일이 옮겨졌을 수 있음) 열 때 한 번 봅니다.
    void refreshWorkflowInfo(getComfySettings().workflowPath);
  }, []);

  /** 워크플로 JSON 을 읽어 LoadImage·SaveImage·SeedVR2 노드 수를 보여 줍니다. 없으면 빈 상태. */
  const refreshWorkflowInfo = async (workflowPath: string) => {
    if (!workflowPath.trim()) {
      setWorkflowInfo(null);
      setWorkflowError("");
      return;
    }
    try {
      const info = await inspectComfyWorkflow(workflowPath);
      setWorkflowInfo(info);
      setWorkflowError(workflowProblem(info) || "");
    } catch (error) {
      setWorkflowInfo(null);
      setWorkflowError(String(error));
    }
  };

  const applyComfy = (patch: Partial<ComfySettings>, notice?: string) => {
    const next = saveComfySettings(patch);
    setComfy(next);
    if (notice) toast.success(notice);
  };

  const pickWorkflow = async () => {
    try {
      const path = await chooseComfyWorkflowFile();
      if (!path) return;
      applyComfy({ workflowPath: path }, "업스케일 워크플로를 잡았습니다.");
      await refreshWorkflowInfo(path);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const verifyComfy = async () => {
    setComfyChecking(true);
    try {
      const summary = await checkComfy(comfy.baseUrl);
      toast.success(`연결됨 — ${summary}`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setComfyChecking(false);
    }
  };

  /**
   * 업스케일 설정 한 칸 고치기. **갱신 함수로만** 받습니다 — 값으로 덮어쓰면 설치 중에 다른 칸에서
   * 방금 저장한 것(예: 추가 모델 체크)을 지웁니다(CLAUDE.md «상태를 고칠 때»).
   */
  const applyUpscale = (update: (current: UpscaleSettings) => UpscaleSettings, notice?: string) => {
    setUpscale(saveUpscaleSettings(update));
    if (notice) toast.success(notice);
  };

  /** «기본 목표 크기» 옆 안내 — 지금 기본 엔진이 배율에 갇혀 있으면 그 사실을 적습니다. */
  const currentDefaultEngine = defaultEngine();
  const defaultReachNote = currentDefaultEngine ? upscaleReachNote(currentDefaultEngine) : null;

  /** 설치는 수 GB·수십 분입니다. 무엇을 얼마나 받는지 먼저 알리고 시작합니다. */
  const startInstall = async (engine: UpscaleEngineStatus) => {
    const ok = await confirmDialog({
      title: `${engine.name} 을(를) 설치할까요?`,
      description:
        `${engine.sizeHint} 를 내려받아 앱 데이터 폴더 upscale/engines/${engine.id}/ 에 넣습니다. ` +
        "회선에 따라 수십 분이 걸리고, 받는 동안 다른 화면을 써도 됩니다. " +
        "«취소» 를 누르면 멈추고, 받다 만 파일은 다음 설치 때 이어받습니다.",
      confirmLabel: "설치",
    });
    if (!ok) return;
    try {
      await installEngine(engine.id);
      toast.success(`${engine.name} 을(를) 설치했습니다.`);
    } catch (error) {
      toast.error(`설치 실패 — ${String(error)}`);
    }
  };

  const stopInstall = async (engine: UpscaleEngineStatus) => {
    try {
      await cancelInstall(engine.id);
      toast.message("설치를 멈추라고 알렸습니다.", {
        description: "받던 파일은 지우지 않습니다. 다시 «설치» 를 누르면 이어받습니다.",
      });
    } catch (error) {
      toast.error(String(error));
    }
  };

  /** 제거는 폴더를 통째로 지웁니다 — 가중치까지 사라지므로 반드시 묻습니다. */
  const removeEngine = async (engine: UpscaleEngineStatus) => {
    const ok = await confirmDialog({
      title: `${engine.name} 을(를) 제거할까요?`,
      description:
        "앱 데이터 폴더의 엔진 폴더를 통째로 지웁니다. 받아 둔 가중치도 함께 지워집니다. 되돌릴 수 없습니다.",
      subject: `upscale/engines/${engine.id}/`,
      confirmLabel: "제거",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await uninstallEngine(engine.id);
      setEngineNotes((current) => ({ ...current, [engine.id]: "" }));
      toast.success(`${engine.name} 을(를) 제거했습니다.`);
    } catch (error) {
      toast.error(`제거 실패 — ${String(error)}`);
    }
  };

  /** 폴더 상태를 다시 읽고, 워커가 떠 있으면 CUDA·장치까지 한 줄로 보여 줍니다. */
  const checkEngine = async (engine: UpscaleEngineStatus) => {
    setEngineNotes((current) => ({ ...current, [engine.id]: "확인 중…" }));
    try {
      await listEngines();
      const info = await workerInfo(engine.id);
      setEngineNotes((current) => ({
        ...current,
        [engine.id]: info
          ? `${info.cuda ? "CUDA 사용" : "CPU 로만 돎"}${info.device ? ` · ${info.device}` : ""}${
              info.torch ? ` · torch ${info.torch}` : ""
            }${info.vramGb ? ` · VRAM ${info.vramGb} GB` : ""}`
          : "워커가 아직 안 떠 있습니다. 업스케일을 한 번 돌리면 올라옵니다.",
      }));
    } catch (error) {
      setEngineNotes((current) => ({ ...current, [engine.id]: String(error) }));
    }
  };

  /** 모델을 올린 파이썬을 전부 내려 VRAM 을 비웁니다. 다음 업스케일 때 다시 올라옵니다. */
  const releaseWorkers = async () => {
    try {
      await stopWorkers();
      toast.success("워커를 내렸습니다. VRAM 이 비었습니다.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const refreshKeys = async () => {
    const blank = (provider: LlmProvider): ApiKeyStatus => ({ provider, saved: false, hint: null });
    const [claude, openai] = await Promise.all([
      getApiKeyStatus("claude").catch(() => blank("claude")),
      getApiKeyStatus("openai").catch(() => blank("openai")),
    ]);
    setKeyStatus({ claude, openai });
  };

  /**
   * 폴더 하나를 고르고 그 자리에서 저장합니다. 「고르고 또 저장」은 잊기 쉽습니다.
   * `startAt` 으로 지금 잡혀 있는 자리를 넘겨 대화상자가 거기서 열리게 합니다.
   */
  const pickFolder = async (apply: (path: string) => void, startAt?: string) => {
    try {
      const directory = await chooseStorageDirectory(startAt);
      if (!directory) return;
      apply(directory);
    } catch {
      toast.error("데스크톱 앱에서 폴더를 선택해 주세요.");
    }
  };

  /**
   * 기본 저장 폴더.
   *
   * 정하는 즉시 **아래로 갈라지는 폴더를 실제로 만들고** 기본 문구를 깔아
   * 둡니다. 파일이 처음 저장될 때까지 아무것도 안 생기면, 탐색기를 열어 본
   * 사람은 설정이 안 먹은 줄 알고 다시 고르게 됩니다.
   */
  const applyBaseDirectory = async (value: string) => {
    setBaseDirectory(value);
    saveMediaLibrarySettings({ baseDirectory: value.trim() });
    if (!value.trim()) {
      toast.success("기본 저장 폴더를 비웠습니다.");
      return;
    }
    await ensurePresetFolder().catch(() => null);
    await ensurePromptFolders().catch(() => null);
    const seeded = await seedPromptLibrary().catch(() => null);
    const count = seeded
      ? seeded.requests + seeded.models + seeded.platforms + seeded.techniques
      : 0;
    setPromptFolder(getPromptLibrarySettings().baseDirectory);
    setPresetFolderValue(getPresetFolder());
    toast.success(
      count
        ? `저장 폴더를 잡았습니다. Prompt · PosePreset 을 만들고 기본 문구 ${count}개를 넣었습니다.`
        : "저장 폴더를 잡았습니다. Prompt · PosePreset 폴더를 만들었습니다.",
    );
  };

  const applyPresetFolder = (value: string) => {
    setPresetFolderValue(value);
    setPresetFolder(value);
    toast.success(value.trim() ? "프리셋 폴더를 따로 지정했습니다." : "프리셋 폴더를 기본 자리로 되돌렸습니다.");
  };

  const applyPromptFolder = async (value: string) => {
    setPromptFolder(value);
    savePromptLibrarySettings({ baseDirectory: value.trim() });
    const seeded = await seedPromptLibrary().catch(() => null);
    toast.success(
      seeded
        ? `문구 폴더를 잡았습니다. 기본 문서 ${
            seeded.requests + seeded.models + seeded.platforms + seeded.techniques
          }개를 넣었습니다.`
        : "문구 폴더를 잡았습니다.",
    );
  };

  const storeKey = async (provider: LlmProvider) => {
    const key = keyInput[provider].trim();
    if (!key) {
      toast.error(t("키를 붙여넣어 주세요."));
      return;
    }
    try {
      await saveApiKey(provider, key);
      setKeyInput((current) => ({ ...current, [provider]: "" }));
      await refreshKeys();
      toast.success(t("{provider} 키를 저장했습니다.", { provider }));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const removeKey = async (provider: LlmProvider) => {
    await deleteApiKey(provider).catch(() => {});
    await refreshKeys();
    toast.success(t("{provider} 키를 지웠습니다.", { provider }));
  };

  /** 본 튜토리얼 수 — «처음부터 다시 보기» 옆에 적습니다. */
  const seenCount = TUTORIALS.filter((tutorial) => tutorials.seen[tutorial.id]).length;

  /** 작업 한 칸을 고칩니다. 지금 보고 있는 제공자 쪽만 바뀝니다. */
  const patchTaskModel = (task: LlmTask, patch: { model?: string; effort?: ReasoningEffort }) => {
    const next = {
      ...taskModels,
      [task]: {
        ...taskModels[task],
        [activeProvider]: { ...taskModels[task][activeProvider], ...patch },
      },
    };
    setTaskModels(next);
    saveTaskModels(next);
  };

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.12 0.008 265)" }}>
      <GlobalNav />

      <main className={`${READING_WIDTH} space-y-4 pb-14 pt-6`}>
        {/* ── 머리 ─────────────────────────────────────────────────── */}
        <div>
          <p
            className="text-[10px] font-bold tracking-[0.2em]"
            style={{ color: "oklch(0.55 0.15 290)" }}
          >
            LOCAL WORKSPACE
          </p>
          <h1 className="mt-0.5 text-xl font-bold text-white">{t("작업 환경")}</h1>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "oklch(0.50 0.01 265)" }}>
            {t("폴더·API 키·작업별 모델을 정합니다. 전부 이 기기에만 저장됩니다.")}
          </p>
        </div>

        {/*
          ── 앱 업데이트 ─────────────────────────────────────────────
          

          **새 판이 있을 때만 보입니다.** 없을 때도 자리를 차지하면 설정 맨 위가 늘
          「최신입니다」 한 줄로 채워집니다 — 확인은 아래 단추로 언제든 다시 합니다.
        */}
        <UpdateBanner />

        <AppControlPanel />

        {/* ── 프롬프트 작성 프로필 ─────────────────────────────────── */}
        <Section icon={Cpu} tint="oklch(0.78 0.18 290)" title={t("프롬프트 작성 프로필")} anchor="settings-profile">
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            {t("분석·프롬프트 작성에 쓸 제공자를 고릅니다. 아래 API 키와 작업별 모델이 이 선택을 따라갑니다.")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((provider) => {
              const on = activeProvider === provider.id;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setActiveProvider(provider.id);
                    saveActiveProvider(provider.id);
                  }}
                  className="rounded-xl p-3 text-left"
                  style={{
                    background: on ? "oklch(0.62 0.22 290 / 12%)" : "oklch(0.14 0.009 265)",
                    border: `1px solid ${on ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 8%)"}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: provider.dot }}
                    />
                    <span className="text-sm font-bold text-white">{provider.label}</span>
                    {on && (
                      <span
                        className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold"
                        style={{
                          background: "oklch(0.62 0.22 290 / 25%)",
                          color: "oklch(0.86 0.16 290)",
                        }}
                      >
                        {t("선택됨")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
                    {t(provider.hint)}
                  </p>
                </button>
              );
            })}
          </div>
        </Section>

        {/*
          ── 언어 · 튜토리얼 ──────────────────────────────────────────
          

          두 칸을 한 상자(`settings-language`)로 묶는 까닭 — 튜토리얼 걸음 «언어 · 튜토리얼» 이
          둘을 한 번에 가리킵니다. 앵커는 표(ANCHORS.md)와 자료가 서로를 세므로 하나만 둡니다.
        */}
        <div className="space-y-4" data-tour="settings-language">
          <Section icon={Languages} tint="oklch(0.78 0.16 200)" title={t("언어")}>
            <div className="flex flex-wrap gap-2">
              {LOCALES.map((entry) => {
                const on = entry.id === locale;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    lang={entry.id}
                    aria-pressed={on}
                    onClick={() => setLocale(entry.id)}
                    className="rounded-lg px-3.5 py-1.5 text-xs font-semibold"
                    style={{
                      background: on ? "oklch(0.62 0.22 290 / 22%)" : "oklch(1 0 0 / 6%)",
                      border: `1px solid ${on ? "oklch(0.62 0.22 290 / 55%)" : "oklch(1 0 0 / 8%)"}`,
                      color: on ? "oklch(0.88 0.12 290)" : "oklch(0.66 0.01 265)",
                    }}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
              {t(
                "기본은 한국어입니다. 바꾸면 화면 문구와 튜토리얼이 곧바로 그 언어로 바뀝니다. 아직 번역되지 않은 화면은 당분간 한국어로 나옵니다.",
              )}
            </p>
          </Section>

          <Section icon={BookOpen} tint="oklch(0.78 0.18 290)" title={t("튜토리얼")}>
            <div className="flex items-start gap-3">
              {/*
                스위치. 끄면 위 띠의 «튜토리얼» 단추와 안내 창이 함께 사라지고, 본 기록은 남습니다 —
                잠깐 끄고 다시 켰을 때 한 바퀴가 처음부터 또 뜨면 «껐다 켠 것» 이 벌이 됩니다.
              */}
              <button
                type="button"
                role="switch"
                aria-checked={tutorials.enabled}
                aria-label={tutorials.enabled ? t("튜토리얼을 끕니다") : t("튜토리얼을 켭니다")}
                onClick={() => setTutorialsEnabled(!tutorials.enabled)}
                className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
                style={{ background: tutorials.enabled ? "oklch(0.62 0.22 290)" : "oklch(1 0 0 / 14%)" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform"
                  style={{ transform: tutorials.enabled ? "translateX(16px)" : "translateX(0)" }}
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">{tutorials.enabled ? t("켜짐") : t("꺼짐")}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
                  {t("위 띠의 «튜토리얼» 단추와 처음 켤 때 저절로 뜨는 한 바퀴를 켜고 끕니다. 꺼도 본 기록은 남습니다.")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  resetTutorials();
                  toast.success(t("처음부터 다시 봅니다. 한 바퀴가 시작됩니다."));
                }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.14 200)" }}
              >
                <RotateCcw className="h-3 w-3" />
                {t("처음부터 다시 보기")}
              </button>
              {/*
                

                튜토리얼 걸음 여럿은 «내용이 있어야» 생기는 자리를 가리킵니다 — 뽑은 그림이 없으면
                가위가 없습니다. 그래서 전부 채워진 작품 하나를 만들어 둡니다.
              */}
              <button
                type="button"
                disabled={makingSample}
                onClick={() => {
                  setMakingSample(true);
                  void ensureTutorialSample()
                    .then((id) => {
                      toast.success(t("예시 작품을 만들었습니다. 여기서 튜토리얼을 따라가 보세요."));
                      navigate(`/project/${id}`);
                    })
                    .catch(() => toast.error(t("예시 작품을 만들지 못했습니다. 기본 저장 폴더를 먼저 정하세요.")))
                    .finally(() => setMakingSample(false));
                }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                style={{ background: "oklch(0.62 0.22 290 / 16%)", color: "oklch(0.86 0.14 290)" }}
              >
                <Sparkles className="h-3 w-3" />
                {makingSample ? t("만드는 중…") : t("연습용 예시 작품 만들기")}
              </button>
              <span className="text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                {t("본 것 {seen} · 전체 {total}", { seen: seenCount, total: TUTORIALS.length })}
              </span>
            </div>

            <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
              {t(
                "예시 작품에는 인물·장소·장면·컷과 뽑아 둔 그림·캐릭터 시트가 미리 들어 있습니다. 갓 설치한 상태에서는 가리킬 것이 없어 튜토리얼이 헛돌기 때문입니다. 보통 작품과 똑같아서 마음대로 고치거나 지워도 됩니다.",
              )}
            </p>

            <ul className="space-y-1 text-[10px] leading-relaxed" style={{ color: "oklch(0.50 0.01 265)" }}>
              <li>
                <b style={{ color: "oklch(0.78 0.10 290)" }}>{t("전체 따라하기")}</b> —{" "}
                {t("설정부터 확인 단계까지 작품 하나를 순서대로 따라갑니다. 처음 켤 때 한 번 저절로 뜹니다.")}
              </li>
              <li>
                <b style={{ color: "oklch(0.78 0.10 290)" }}>{t("이 페이지 기능")}</b> —{" "}
                {t("지금 보고 있는 화면의 단추와 칸을 하나씩 설명합니다. 작업하다 막히면 위 띠의 «튜토리얼» 에서 여세요.")}
              </li>
              <li>
                <b style={{ color: "oklch(0.78 0.10 290)" }}>{t("구도잡기 기능")}</b> —{" "}
                {t("구도잡기 창의 배치 · 환경 · 타임라인 · 단축키를 갈래별로 설명합니다.")}
              </li>
            </ul>
          </Section>
        </div>

        <Section icon={FolderOpen} tint="oklch(0.78 0.14 200)" title={t("폴더")} anchor="settings-folders">
          <FolderRow
            anchor="settings-base-folder"
            label={t("기본 저장 폴더")}
            hint={t("프로젝트마다 폴더가 하나 생기고 그림·영상·project.json 이 그 안에 들어갑니다. 아래 두 폴더도 여기서 갈라집니다")}
            value={baseDirectory}
            onChange={setBaseDirectory}
            onSave={() => void applyBaseDirectory(baseDirectory)}
            onPick={() => pickFolder((path) => void applyBaseDirectory(path), baseDirectory)}
          />
          {/*
            아래 둘은 기본 저장 폴더에서 갈라집니다.
            예전에는 셋 다 따로 고르게 했는데, 셋을 같은 곳으로 두면
            requests·models·프리셋 json 이 프로젝트 폴더들과 나란히
            최상단에 쏟아졌습니다. 탐색기로 열면 뭐가 작품이고 뭐가 설정인지
            알 수 없어져요.
          */}
          <DerivedFolderRow
            label={t("프롬프트 문구 폴더")}
            hint={t("요청 문구와 가이드를 md 파일로 둡니다. 앱 밖에서 편집기로도 고칠 수 있습니다")}
            resolved={promptBaseDirectory()}
            override={promptFolder}
            onPick={() => pickFolder((path) => void applyPromptFolder(path), promptBaseDirectory())}
            onReset={() => void applyPromptFolder("")}
          />
          <DerivedFolderRow
            label={t("포즈 프리셋 폴더")}
            hint={t("구도잡기에서 만든 자세를 여기 모읍니다")}
            resolved={presetDirectory()}
            override={presetFolder}
            onPick={() => pickFolder(applyPresetFolder, presetDirectory())}
            onReset={() => applyPresetFolder("")}
          />
        </Section>

        <Section icon={KeyRound} tint="oklch(0.78 0.18 290)" title={t("API 키")} anchor="settings-api-keys">
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            {t(
              "키는 앱 설정 폴더에 파일로 저장되고 호출도 앱 안에서 합니다. 브라우저 쪽에 두면 개발자 도구에서 그대로 보이고, 제공사 서버가 막기도 합니다. 저장한 뒤에는 끝 네 자리만 확인할 수 있습니다.",
            )}
          </p>
          <p className="text-[11px]" style={{ color: "oklch(0.45 0.01 265)" }}>
            {t("키 발급")} —{" "}
            <a
              href="https://platform.claude.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              style={{ color: "oklch(0.78 0.17 50)" }}
            >
              {t("Claude 콘솔")}
            </a>
            {" · "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              style={{ color: "oklch(0.78 0.16 160)" }}
            >
              {t("OpenAI 플랫폼")}
            </a>
            . {t("두 곳 모두 결제 수단 등록이 필요하고, 키는 만들 때 한 번만 보여줍니다.")}
          </p>
          {PROVIDERS.map((provider) => {
            const status = keyStatus[provider.id];
            return (
              <div
                key={provider.id}
                className="rounded-lg p-3"
                style={{ background: "oklch(0.14 0.009 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-xs font-semibold text-white">{provider.label}</p>
                  {status?.saved ? (
                    <span
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "oklch(0.70 0.15 160 / 18%)", color: "oklch(0.82 0.15 160)" }}
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {t("저장됨")}{status.hint ? ` ···${status.hint}` : ""}
                    </span>
                  ) : (
                    <span className="text-[10px]" style={{ color: "oklch(0.48 0.01 265)" }}>
                      {t("없음")}
                    </span>
                  )}
                  <span className="ml-auto text-[10px]" style={{ color: "oklch(0.44 0.01 265)" }}>
                    {t(provider.hint)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={keyInput[provider.id]}
                    onChange={(event) =>
                      setKeyInput((current) => ({ ...current, [provider.id]: event.target.value }))
                    }
                    placeholder={t("키를 붙여넣으세요")}
                    className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs outline-none"
                    style={{
                      background: "oklch(0.18 0.012 265)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                      color: "white",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void storeKey(provider.id)}
                    className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white gradient-primary"
                  >
                    {t("저장")}
                  </button>
                  {status?.saved && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          setVerifying(provider.id);
                          try {
                            await verifyApiKey(provider.id);
                            toast.success(t("{provider} 키가 정상 작동합니다.", { provider: provider.label }));
                          } catch (error) {
                            toast.error(t("연결 실패 — {error}", { error: String(error) }));
                          } finally {
                            setVerifying(null);
                          }
                        }}
                        disabled={verifying === provider.id}
                        className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.14 200)" }}
                      >
                        {verifying === provider.id ? t("확인 중…") : t("연결 확인")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeKey(provider.id)}
                        className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold"
                        style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.16 25)" }}
                      >
                        {t("지우기")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </Section>

        {/* ── 전개도 자동 커팅 ──────────────────────────────────────── */}
        <Section icon={Grid2x2} tint="oklch(0.78 0.16 200)" title={t("전개도 자동 6면 커팅")} anchor="settings-auto-unfold">
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            장소 카드에 <b>6면 전개도</b>가 들어오면 여섯 면을 자동으로 잘라
            <b> «6면» 폴더에 한 세트로</b> 저장합니다. 전개도 원본은 그대로 남습니다 —
            다시 자르거나 선을 고칠 때 그것이 재료입니다.
          </p>
          <label
            className="flex items-center gap-2 text-[11px]"
            style={{ color: "oklch(0.72 0.01 265)" }}
            title="전개도로 보이는데 아닌 그림이 잘리면 여기서 끄고 가위로 직접 자르세요"
          >
            <input
              type="checkbox"
              defaultChecked={getAutoUnfoldEnabled()}
              onChange={(event) => {
                setAutoUnfoldEnabled(event.target.checked);
                toast.success(
                  event.target.checked
                    ? "전개도가 들어오면 자동으로 6면을 자릅니다."
                    : "자동 커팅을 껐습니다. 가위 → «전개도» 탭에서 직접 자르세요.",
                );
              }}
            />
            전개도를 자동으로 6면으로 자르기
          </label>
          <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
            전개도인지는 <b>네 가지</b>를 다 보고 정합니다 — 회색 바탕 위 십자, 여섯 칸이
            전부 그려짐, 칸마다 색이 여러 가지(마그니픽에 올리는 «전개도 틀» 은 면마다
            단색이라 걸러집니다), 네 귀퉁이가 빔. 애매하면 아무것도 하지 않습니다.
          </p>
        </Section>

        {/* ── 로컬 모델 ─────────────────────────────────────────────── */}
        {/*
          마그니픽 연결 — 로컬 모델 바로 위입니다. 둘 다 «무엇으로 뽑는가» 라
          한 덩어리로 읽힙니다.
        */}
        {/*
          로라 서랍 — 로컬 모델 바로 아래에 두려 했으나, 로라는 «어떤 결로 뽑는가» 라
          엔진 설치보다 자주 만집니다. 위에 둡니다.
        */}
        <Section icon={Layers} tint="oklch(0.78 0.16 320)" title={t("로라 (엔진별로 찾고 받기)")} anchor="settings-lora">
          <LoraLibraryPanel />
        </Section>

        <Section icon={Link2} tint="oklch(0.78 0.16 45)" title={t("마그니픽 (MCP 로 끝까지 뽑기)")} anchor="settings-magnific">
          <MagnificConnectPanel />
        </Section>

        <Section icon={Cpu} tint="oklch(0.78 0.16 290)" title={t("로컬 모델 (그림·영상·음악)")} anchor="settings-local-engines">
          <LocalEnginesPanel />
        </Section>

        {/* ── 업스케일 엔진 ─────────────────────────────────────────── */}
        <Section icon={Maximize2} tint="oklch(0.78 0.16 160)" title={t("업스케일 엔진")} anchor="settings-upscale">
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            엔진은 앱 데이터 폴더 <b>upscale/</b> 에 <b>각자 고정 환경</b>(전용 파이썬 · 고정 버전 코드 ·
            검증한 가중치)으로 설치됩니다. <b>ComfyUI 와 무관</b>합니다 — ComfyUI 를 업데이트하거나 지워도
            여기 엔진은 그대로 돕니다. 가위로 여는 <b>이미지 편집 창</b> · 6면 세트 카드 · 파노라마 탭의
            «업스케일» 이 아래에서 고른 <b>기본 엔진</b>과 <b>기본 목표 크기</b>를 씁니다.
          </p>

          {/* 전체에 걸리는 것 — 목표 크기·워커 */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg p-3"
            style={{ background: "oklch(0.11 0.008 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
          >
            <span className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
              기본 목표 크기
            </span>
            <select
              value={upscale.defaultTarget}
              onChange={(event) => {
                const next = Number(event.target.value) as UpscaleTarget;
                applyUpscale((current) => ({ ...current, defaultTarget: next }), "기본 목표 크기를 저장했습니다.");
              }}
              className="rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: "oklch(0.18 0.012 265)", border: "1px solid oklch(1 0 0 / 8%)", color: "white" }}
            >
              {UPSCALE_TARGET_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
              «업스케일» 단추가 쓰는 긴 변. 파노라마 탭은 거기서 고른 면 크기를 따릅니다
            </span>
            {/*
              사용자 2026-09-09: 목표를 고를 때 «그 엔진이 원본에서 그 크기를 진짜로 만드는지» 를
              알려 줘야 합니다. 여기서는 어떤 그림에 쓸지 모르니 배율로만 말합니다 — 그림별
              숫자는 이미지 편집 창의 업스케일 칸이 원본을 재서 알려 줍니다(타일의 ▾ 메뉴는
              업스케일이 편집 창으로 들어가면서 없어졌습니다).
            */}
            {defaultReachNote && (
              <span className="basis-full text-[10px]" style={{ color: "oklch(0.72 0.14 60)" }}>
                {defaultReachNote}
              </span>
            )}
            <label
              className="ml-auto flex items-center gap-1.5 text-[11px]"
              style={{ color: "oklch(0.72 0.01 265)" }}
              title="켜 두면 모델이 GPU 에 남아 다음 장이 훨씬 빠릅니다. 끄면 작업마다 다시 올리느라 느립니다"
            >
              <input
                type="checkbox"
                checked={upscale.keepWorker}
                onChange={(event) => {
                  const on = event.target.checked;
                  applyUpscale((current) => ({ ...current, keepWorker: on }));
                }}
              />
              작업 후 워커 유지
            </label>
            <button
              type="button"
              onClick={() => void releaseWorkers()}
              title="지금 떠 있는 워커를 전부 내려 VRAM 을 비웁니다. 다음 업스케일 때 다시 올라옵니다"
              className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.14 60)" }}
            >
              워커 내리기
            </button>
            <button
              type="button"
              onClick={() => void listEngines()}
              className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
            >
              상태 새로 고침
            </button>
          </div>

          {!enginesLoaded && (
            <p className="text-[11px]" style={{ color: "oklch(0.50 0.01 265)" }}>
              설치 상태를 확인하는 중…
            </p>
          )}
          {statusError && (
            <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.70 0.16 25)" }}>
              엔진 상태를 읽지 못했습니다 — {statusError}. 데스크톱 앱(`pnpm dev:desktop`)에서 열었는지 확인하세요.
              브라우저에서는 외부 엔진(ComfyUI)만 씁니다.
            </p>
          )}

          {engines.map((engine) => (
            <EngineCard
              key={engine.id}
              engine={engine}
              progress={installs[engine.id]}
              isDefault={upscale.defaultEngine === engine.id}
              note={engineNotes[engine.id] || ""}
              onPickDefault={() =>
                applyUpscale(
                  (current) => ({ ...current, defaultEngine: engine.id as UpscaleEngineId }),
                  `기본 엔진을 ${engine.name} 으로 정했습니다.`,
                )
              }
              onInstall={() => void startInstall(engine)}
              onCancel={() => void stopInstall(engine)}
              onRemove={() => void removeEngine(engine)}
              onCheck={() => void checkEngine(engine)}
            >
              {/* 엔진마다 다른 선택지 — 여기만 갈라집니다 */}
              {engine.id === "seedvr2" && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold" style={{ color: "oklch(0.60 0.01 265)" }}>
                    추가 모델 — 설치할 때 함께 받습니다. 설치한 뒤 켜면 다시 «설치» 를 눌러 받으세요
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {SEEDVR2_MODEL_OPTIONS.filter((option) => option.extra).map((option) => {
                      const on = option.id === "7b_sharp" ? upscale.seedvr2.extraModels.sharp : upscale.seedvr2.extraModels.b3;
                      return (
                        <label
                          key={option.id}
                          className="flex items-center gap-1.5 text-[11px]"
                          style={{ color: "oklch(0.72 0.01 265)" }}
                          title={option.hint}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              applyUpscale((current) => ({
                                ...current,
                                seedvr2: {
                                  ...current.seedvr2,
                                  extraModels: {
                                    ...current.seedvr2.extraModels,
                                    ...(option.id === "7b_sharp" ? { sharp: checked } : { b3: checked }),
                                  },
                                },
                              }));
                            }}
                          />
                          {option.label}
                          <span style={{ color: "oklch(0.44 0.01 265)" }}>· {option.hint}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold" style={{ color: "oklch(0.60 0.01 265)" }}>
                      업스케일에 쓸 모델
                    </span>
                    <select
                      value={upscale.seedvr2.model}
                      onChange={(event) => {
                        const next = event.target.value as SeedVr2Model;
                        applyUpscale((current) => ({ ...current, seedvr2: { ...current.seedvr2, model: next } }));
                      }}
                      className="rounded-md px-2 py-1 text-[11px] outline-none"
                      style={{ background: "oklch(0.18 0.012 265)", border: "1px solid oklch(1 0 0 / 8%)", color: "white" }}
                    >
                      {SEEDVR2_MODEL_OPTIONS.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          // 안 받은 가중치를 고르면 워커가 오류를 냅니다. 여기서 미리 막습니다.
                          disabled={
                            option.extra &&
                            !(option.id === "7b_sharp" ? upscale.seedvr2.extraModels.sharp : upscale.seedvr2.extraModels.b3)
                          }
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {engine.id === "spandrel" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold" style={{ color: "oklch(0.60 0.01 265)" }}>
                    모델
                  </span>
                  <select
                    value={upscale.spandrel.model}
                    onChange={(event) => {
                      const next = event.target.value as SpandrelModel;
                      applyUpscale((current) => ({ ...current, spandrel: { model: next } }));
                    }}
                    className="rounded-md px-2 py-1 text-[11px] outline-none"
                    style={{ background: "oklch(0.18 0.012 265)", border: "1px solid oklch(1 0 0 / 8%)", color: "white" }}
                  >
                    {SPANDREL_MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px]" style={{ color: "oklch(0.44 0.01 265)" }}>
                    {SPANDREL_MODEL_OPTIONS.find((option) => option.id === upscale.spandrel.model)?.hint}
                  </span>
                </div>
              )}

              {engine.id === "comfy" && (
                <div className="space-y-2">
                  <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
                    ComfyUI 에서 업스케일 워크플로를 만들고 메뉴의 <b>Save (API Format)</b> 로 저장한 JSON 을 고르세요.
                    <b> LoadImage 노드 하나와 SaveImage 노드 하나</b>가 있어야 합니다. SeedVR2 노드가 있으면 목표
                    크기를 앱이 넣고, 다른 업스케일 노드면 워크플로를 그대로 돌립니다. 이건 <b>바깥 프로그램</b>이라
                    ComfyUI 가 켜져 있어야 하고, ComfyUI 를 업데이트하면 워크플로가 깨질 수 있습니다.
                  </p>
                  <FolderRow
                    label="ComfyUI 주소"
                    hint="ComfyUI 를 켜면 터미널에 나오는 주소입니다. 보통 http://127.0.0.1:8188"
                    value={comfy.baseUrl}
                    onChange={(value) => setComfy((current) => ({ ...current, baseUrl: value }))}
                    onSave={() => applyComfy({ baseUrl: comfy.baseUrl }, "ComfyUI 주소를 저장했습니다.")}
                    onPick={() => void verifyComfy()}
                    pickLabel={comfyChecking ? "확인 중…" : "연결 확인"}
                  />
                  <FolderRow
                    label="업스케일 워크플로 (API 형식 JSON)"
                    hint={
                      workflowError
                        ? workflowError
                        : workflowInfo
                          ? `노드 ${workflowInfo.nodeCount}개 · LoadImage ${workflowInfo.loadImageNodes} · SaveImage ${workflowInfo.saveImageNodes} · SeedVR2 ${
                              workflowInfo.seedvr2Nodes ? "있음 (목표 크기를 넣습니다)" : "없음 (워크플로 그대로 돌립니다)"
                            }`
                          : "아직 안 골랐습니다. 비어 있으면 이 외부 엔진은 «설치 안 됨» 으로 보입니다"
                    }
                    hintTone={workflowError ? "warn" : undefined}
                    value={comfy.workflowPath}
                    onChange={(value) => setComfy((current) => ({ ...current, workflowPath: value }))}
                    onSave={() => {
                      applyComfy({ workflowPath: comfy.workflowPath.trim() }, "업스케일 워크플로를 저장했습니다.");
                      void refreshWorkflowInfo(comfy.workflowPath.trim());
                    }}
                    onPick={() => void pickWorkflow()}
                  />
                </div>
              )}
            </EngineCard>
          ))}
        </Section>

        <Section icon={FileText} tint="oklch(0.78 0.14 60)" title={t("가이드 문서 관리")} anchor="settings-prompt-docs">
          <PromptLibraryPanel />
        </Section>

        <Section icon={Cpu} tint="oklch(0.78 0.16 160)" title={t("작업별 모델")} anchor="settings-task-models">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold text-white">사용할 제공자</p>
            <div className="flex rounded-md p-0.5" style={{ background: "oklch(0.18 0.012 265)" }}>
              {(["claude", "openai"] as LlmProvider[]).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => {
                    setActiveProvider(provider);
                    saveActiveProvider(provider);
                  }}
                  className="rounded px-3 py-1 text-xs font-semibold"
                  style={
                    activeProvider === provider
                      ? { background: "oklch(0.62 0.22 290 / 25%)", color: "oklch(0.86 0.16 290)" }
                      : { color: "oklch(0.55 0.01 265)" }
                  }
                >
                  {provider === "claude" ? "Claude" : "OpenAI"}
                  {!keyStatus[provider]?.saved && (
                    <span style={{ color: "oklch(0.62 0.14 25)" }}> ·키 없음</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs" style={{ color: "oklch(0.50 0.01 265)" }}>
            작업별 설정은 제공자마다 따로 저장됩니다. 위에서 제공자를 바꾸면 아래 목록도 그쪽
            설정으로 바뀌고, 다시 돌아와도 골라둔 값이 그대로 남습니다.
          </p>

          {/*
            동시 요청 —  4단계는 카드마다 요청 하나라 하나씩 받으면
            123장에 한 시간이 넘습니다. 답은 카드 id 로 찾아가므로 동시에 받아도 섞이지 않고, 한도(429)에
            걸리면 그 일만 잠시 쉬었다 다시 섭니다. 세 왕복(1/3→2/3→3/3)은 한 일이라 그 안에서는 차례대로.
          */}
          <label className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "oklch(0.70 0.01 265)" }}>
            <span className="font-semibold text-white">API 동시 요청 수</span>
            <select
              value={llmConcurrency}
              onChange={(event) => {
                const next = Number(event.target.value);
                setLlmConcurrencyState(next);
                setLlmConcurrency(next);
              }}
              className="rounded-md px-2 py-1 text-xs outline-none"
              style={{ background: "oklch(0.18 0.012 265)", border: "1px solid oklch(1 0 0 / 8%)", color: "oklch(0.85 0.01 265)" }}
            >
              <option value={LLM_CONCURRENCY.auto}>자동 (지금 {concurrencyNow.effective}개)</option>
              {/* 저장된 값이 후보에 없으면(예전 판의 5·7 같은 것) 그 값도 한 줄 보여 줘야 고른 게 사라져 보이지 않습니다. */}
              {[...new Set<number>([...LLM_CONCURRENCY_CHOICES, ...(llmConcurrency > 0 ? [llmConcurrency] : [])])]
                .sort((a, b) => a - b)
                .map((count) => (
                  <option key={count} value={count}>
                    {count}개
                  </option>
                ))}
            </select>
            <span style={{ color: "oklch(0.50 0.01 265)" }}>
              한꺼번에 보내는 글 요청 수. 「자동」 은 한도를 스스로 찾습니다 — 세 번 잇달아 잘 받으면 늘리고(처음엔 두 배씩,
              한 번 튕긴 뒤엔 하나씩, 상한 없음), 한도(429)에 걸리면 반으로 줄이며 그 요청은 잠시 쉬었다 다시 보냅니다.
              숫자를 고르면 그 수로 못 박습니다.
            </span>
          </label>

          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-white">
              작업별 모델 · {activeProvider === "claude" ? "Claude" : "OpenAI"}
            </p>
            <button
              type="button"
              onClick={() => {
                setTaskModels(resetTaskModelsFor(activeProvider));
                toast.success(
                  `${activeProvider === "claude" ? "Claude" : "OpenAI"} 작업별 설정을 기본값으로 되돌렸습니다.`,
                );
              }}
              title="이 제공자의 작업별 모델·추론 노력을 전부 기본값으로"
              className="ml-auto rounded-md px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.14 60)" }}
            >
              기본값
            </button>
            {/*
              **목록은 제공자에게 물어봅니다.**

              
              실제로 앱에는 `gpt-5.6-*` 이 박혀 있는데 계정에는 이미 `gpt-6-*` 이 있었습니다.
              받은 것은 하루 동안 기억하고(`modelCatalog.ts`), 이 단추로 그 전에도 새로 받습니다.
            */}
            <button
              type="button"
              disabled={modelsLoading}
              onClick={async () => {
                const got = await refreshModels(activeProvider, true);
                if ("count" in got) toast.success(`모델 ${got.count}개를 받았습니다.`);
                else toast.error(got.reason);
              }}
              title={
                modelsFetchedAt
                  ? `마지막으로 받은 때: ${new Date(modelsFetchedAt).toLocaleString()}`
                  : "아직 받은 적이 없습니다 — 지금은 앱에 적어 둔 목록입니다"
              }
              className="rounded-md px-2.5 py-1 text-[10px] font-semibold disabled:opacity-40"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.12 200)" }}
            >
              {modelsLoading ? "받는 중…" : "목록 새로 받기"}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(LLM_TASK_LABELS) as LlmTask[]).map((task) => {
              const choice = taskModels[task][activeProvider];
              const options = modelsFor(activeProvider);
              return (
                <div
                  key={task}
                  className="flex items-center gap-2 text-xs"
                  style={{ color: "oklch(0.60 0.01 265)" }}
                >
                  <span className="w-28 shrink-0 truncate" title={LLM_TASK_LABELS[task]}>
                    {LLM_TASK_LABELS[task]}
                  </span>
                  <select
                    value={choice.model}
                    onChange={(event) => patchTaskModel(task, { model: event.target.value })}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
                    style={{
                      background: "oklch(0.18 0.012 265)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "white",
                    }}
                  >
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    {/* 목록에 없는 모델을 예전에 저장해 뒀다면 그것도 보여줍니다. */}
                    {!options.some((option) => option.id === choice.model) && (
                      <option value={choice.model}>{choice.model}</option>
                    )}
                  </select>
                  <select
                    value={choice.effort}
                    onChange={(event) =>
                      patchTaskModel(task, { effort: event.target.value as ReasoningEffort })
                    }
                    title="추론 노력 — 높일수록 오래 생각하고 토큰을 더 씁니다"
                    className="w-24 shrink-0 rounded-md px-2 py-1.5 text-xs outline-none"
                    style={{
                      background: "oklch(0.18 0.012 265)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                      color: "oklch(0.78 0.10 200)",
                    }}
                  >
                    {REASONING_EFFORT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.45 0.01 265)" }}>
            오른쪽은 추론 노력입니다. 깊이 생각할수록 결과가 정돈되는 대신 느려지고 토큰을 더 씁니다.
            형식만 맞추면 되는 분석에는 <b>«생각 없이»</b> 로 두는 편이 낫습니다.
          </p>
        </Section>
      </main>
      {/* 확인 창을 띄울 자리. 없으면 브라우저 기본 confirm 으로 떨어집니다. */}
      <ConfirmDialogHost />
    </div>
  );
}

/**
 * 엔진 한 칸 — 이름·용도·라이선스·용량·상태 배지, 진행 줄, 단추, 그리고 엔진마다 다른 선택지(children).
 *
 * 캐릭터·배경처럼 «한 군데서만 고치면 나머지가 따라오게» 하려고 여섯 엔진이 같은 칸을 씁니다(규칙 1).
 * ComfyUI 도 예외가 아니라 `external` 배지만 달고 여기 들어옵니다 — 목록이 갈리면 «업스케일 설정이
 * 두 군데» 가 되어 어느 쪽이 도는지 알 수 없어집니다.
 */
function EngineCard({
  engine,
  progress,
  isDefault,
  note,
  onPickDefault,
  onInstall,
  onCancel,
  onRemove,
  onCheck,
  children,
}: {
  engine: UpscaleEngineStatus;
  progress?: UpscaleInstallProgress;
  isDefault: boolean;
  note: string;
  onPickDefault: () => void;
  onInstall: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onCheck: () => void;
  children?: React.ReactNode;
}) {
  const installing = engine.installing || Boolean(progress);
  const badge = installing
    ? { label: "설치 중", background: "oklch(0.70 0.14 60 / 18%)", color: "oklch(0.84 0.12 60)" }
    : engine.installed
      ? { label: engine.external ? "잡혔음" : "설치됨", background: "oklch(0.70 0.15 160 / 18%)", color: "oklch(0.82 0.15 160)" }
      : { label: "설치 안 됨", background: "oklch(1 0 0 / 6%)", color: "oklch(0.55 0.01 265)" };
  const percent = typeof progress?.percent === "number" ? Math.max(0, Math.min(100, progress.percent)) : null;

  return (
    <div
      className="space-y-2 rounded-lg p-3"
      style={{
        background: "oklch(0.14 0.009 265)",
        border: `1px solid ${isDefault ? "oklch(0.62 0.22 290 / 45%)" : "oklch(1 0 0 / 8%)"}`,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="flex min-w-0 items-center gap-2"
          title={engine.installed ? "이 엔진을 기본으로" : "설치한 뒤에 기본으로 고를 수 있습니다"}
        >
          <input
            type="radio"
            name="upscale-default-engine"
            checked={isDefault}
            disabled={!engine.installed}
            onChange={onPickDefault}
          />
          <span className="truncate text-xs font-semibold text-white">{engine.name}</span>
        </label>
        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: badge.background, color: badge.color }}>
          {badge.label}
        </span>
        {engine.experimental && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold"
            style={{ background: "oklch(0.70 0.14 60 / 18%)", color: "oklch(0.84 0.12 60)" }}
          >
            실험
          </span>
        )}
        {engine.external && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold"
            style={{ background: "oklch(0.70 0.12 200 / 18%)", color: "oklch(0.80 0.12 200)" }}
          >
            외부 엔진
          </span>
        )}
        {isDefault && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold"
            style={{ background: "oklch(0.62 0.22 290 / 25%)", color: "oklch(0.86 0.16 290)" }}
          >
            기본
          </span>
        )}

        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          {installing ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.16 25)" }}
            >
              취소
            </button>
          ) : engine.external ? null : engine.installed ? (
            <>
              <button
                type="button"
                onClick={onCheck}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.14 200)" }}
              >
                상태 확인
              </button>
              <button
                type="button"
                onClick={onInstall}
                title="가중치를 더 받거나 깨진 환경을 다시 만듭니다. 이미 있는 것은 건너뜁니다"
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
              >
                다시 설치
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.16 25)" }}
              >
                제거
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onInstall}
              className="rounded-md px-3 py-1 text-[11px] font-semibold text-white gradient-primary"
            >
              설치
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.50 0.01 265)" }}>
        {engine.purpose}
      </p>
      <p className="text-[10px]" style={{ color: "oklch(0.42 0.01 265)" }}>
        라이선스 {engine.license} · 용량 {engine.installed && engine.diskBytes ? formatBytes(engine.diskBytes) : engine.sizeHint}
        {engine.version ? ` · 버전 ${engine.version}` : ""}
      </p>

      {progress && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10px]" style={{ color: "oklch(0.72 0.01 265)" }}>
            <span className="font-semibold">{UPSCALE_STAGE_LABELS[progress.stage] ?? progress.stage}</span>
            <span className="min-w-0 flex-1 truncate" style={{ color: "oklch(0.52 0.01 265)" }}>
              {progress.message}
            </span>
            <span className="shrink-0">{percent === null ? "진행 중" : `${Math.round(percent)}%`}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full" style={{ background: "oklch(1 0 0 / 8%)" }}>
            {/* 퍼센트를 모르는 단계(uv·코드 압축 해제)는 옅게 꽉 채워 «멈춘 것이 아님» 을 보입니다. */}
            <div
              className="h-full rounded-full"
              style={{
                width: percent === null ? "100%" : `${percent}%`,
                background: percent === null ? "oklch(0.62 0.22 290 / 25%)" : "oklch(0.62 0.22 290)",
              }}
            />
          </div>
        </div>
      )}

      {engine.lastError && (
        <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.70 0.16 25)" }}>
          마지막 오류 — {engine.lastError}
        </p>
      )}
      {note && (
        <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.72 0.14 200)" }}>
          {note}
        </p>
      )}

      {children}
    </div>
  );
}

function Section({
  icon: Icon,
  tint,
  title,
  anchor,
  children,
}: {
  icon: typeof FolderOpen;
  tint: string;
  title: string;
  /** 튜토리얼이 가리킬 `data-tour` 이름(`tutorials/ANCHORS.md`). */
  anchor?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-tour={anchor}
      className="space-y-3 rounded-xl p-4"
      style={{ background: "oklch(0.14 0.009 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" style={{ color: tint }} />
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * 기본 저장 폴더에서 갈라지는 자리.
 *
 * 실제 자리를 보여 주기만 하고, 굳이 다른 데 두고 싶을 때만 직접 고릅니다.
 * 손으로 칠 수 있게 두었더니 저장 폴더를 그대로 붙여 넣는 일이 있었습니다.
 */
function DerivedFolderRow({
  label,
  hint,
  resolved,
  override,
  onPick,
  onReset,
}: {
  label: string;
  hint: string;
  resolved: string;
  override: string;
  onPick: () => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
          {label}
        </p>
        {isOverrideActive(override) && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: "oklch(0.70 0.14 60 / 18%)", color: "oklch(0.84 0.12 60)" }}
          >
            {t("따로 지정함")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 font-mono text-[11px]"
          style={{
            background: "oklch(0.11 0.008 265)",
            border: "1px solid oklch(1 0 0 / 8%)",
            color: resolved ? "oklch(0.74 0.01 265)" : "oklch(0.42 0.01 265)",
          }}
          title={resolved}
        >
          {resolved || t("기본 저장 폴더를 먼저 정해 주세요")}
        </p>
        <button
          type="button"
          onClick={onPick}
          className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
        >
          {t("다른 곳으로")}
        </button>
        {isOverrideActive(override) && (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.70 0.14 60)" }}
          >
            {t("기본 자리로")}
          </button>
        )}
      </div>
      <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
        {hint}
      </p>
    </div>
  );
}

function FolderRow({
  anchor,
  label,
  hint,
  hintTone,
  value,
  onChange,
  onSave,
  onPick,
  pickLabel,
  extra,
}: {
  /** 튜토리얼이 가리킬 `data-tour` 이름(`tutorials/ANCHORS.md`). */
  anchor?: string;
  label: string;
  hint: string;
  /** 도움말이 경고(워크플로 형식 오류 등)면 붉게 */
  hintTone?: "warn";
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onPick: () => void;
  /** «찾아보기» 자리 단추의 글. 주소 칸은 고를 파일이 없어 «연결 확인» 으로 씁니다 */
  pickLabel?: string;
  extra?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-1" data-tour={anchor}>
      <p className="text-[11px] font-semibold" style={{ color: "oklch(0.72 0.01 265)" }}>
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("아직 정하지 않았습니다")}
          className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs outline-none"
          style={{
            background: "oklch(0.18 0.012 265)",
            border: "1px solid oklch(1 0 0 / 10%)",
            color: "white",
          }}
        />
        <button
          type="button"
          onClick={onPick}
          className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
        >
          {pickLabel ?? t("찾아보기")}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white gradient-primary"
        >
          {t("저장")}
        </button>
        {extra}
      </div>
      <p
        className="text-[10px] leading-relaxed"
        style={{ color: hintTone === "warn" ? "oklch(0.70 0.16 25)" : "oklch(0.42 0.01 265)" }}
      >
        {hint}
      </p>
    </div>
  );
}
