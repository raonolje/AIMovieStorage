import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * LLM 호출 공용 레이어.
 *
 * 실제 HTTP 요청은 Rust 쪽 call_llm 이 합니다. 여기서는
 * - 어떤 작업에 어떤 모델을 쓸지
 * - 응답에서 JSON 을 꺼내 검증
 * - 실패하면 규칙 기반 결과로 되돌리기
 * 만 담당합니다.
 *
 * API 키는 이 코드로 넘어오지 않습니다. Rust 가 파일에서 직접 읽습니다.
 */

export type LlmProvider = "claude" | "openai";

/**
 * 작업 종류. 비용과 품질이 작업마다 달라서 모델도 따로 정합니다.
 * 설정에서 항목별로 바꿀 수 있습니다.
 */
export type LlmTask =
  | "characterAnalysis"
  | "characterSheet"
  | "characterVariation"
  | "characterProfile"
  | "firstReference"
  | "backgroundScale"
  | "backgroundAnalysis"
  | "backgroundSheet"
  | "backgroundVariation"
  | "assetPrompt"
  | "cutPrompt"
  /**
   * 컷 **영상** 프롬프트.
   *
   * 여태 영상 프롬프트는 규칙 조립뿐이라(`buildCutVideoPrompt`) LLM 작업이 아예 없었습니다 —
   * 규칙은 상황과 표정을 지어낼 수 없습니다. 뼈대는 규칙이 짓고 그 사이를 LLM 이 채웁니다.
   */
  | "cutVideoPrompt"
  | "storyboard"
  | "blender"
  | "projectBootstrap"
  | "projectDetails"
  /**
   * BGM 프롬프트.
   *
   * 규칙 조립(`buildBgmPrompt`)은 고른 태그를 그대로 늘어놓습니다 — 「긴장, 오케스트라,
   * 현악」. 그런데 수노는 **곡의 흐름**(도입·전개·끝)을 적어 줄수록 잘 뽑습니다. 사람이
   * 매번 그 문장을 쓰기는 번거로우니, 고른 태그와 «쓰임» 을 재료로 LLM 이 씁니다.
   */
  | "bgmPrompt"
  /**
   * 모캡 키 다듬기.
   * 흔들림 후보 구간의 숫자표를 읽고 «인식 오류인가, 의도한 빠른 동작인가» 를 가립니다(`motionCleanup.cleanupPrompt`).
   */
  | "motionCleanup"
  /**
   * **평소 말투 → 프롬프트 말.**
   *
   * 「슬프게 말해」 를 「시선이 내려가고 입술이 다물린다」 로 바꿉니다. 짧은 글 하나를
   * 바꾸는 일이라 **싼 단**으로 충분합니다 — 대신 자주 눌립니다.
   */
  | "naturalPrompt";

export const LLM_TASK_LABELS: Record<LlmTask, string> = {
  characterAnalysis: "캐릭터 레퍼런스 분석",
  characterSheet: "캐릭터 시트 프롬프트",
  characterVariation: "캐릭터 변형 프롬프트",
  characterProfile: "캐릭터 특징 정하기",
  firstReference: "첫 레퍼런스 프롬프트",
  backgroundScale: "배경 축척 추정",
  backgroundAnalysis: "배경 레퍼런스 분석",
  backgroundSheet: "배경 시트 프롬프트",
  bgmPrompt: "BGM 프롬프트",
  backgroundVariation: "배경 변형 프롬프트",
  assetPrompt: "에셋 프롬프트",
  cutPrompt: "컷 프롬프트 다듬기",
  cutVideoPrompt: "컷 영상 프롬프트 쓰기",
  naturalPrompt: "프롬프트 말로 바꾸기",
  storyboard: "스토리보드 생성",
  blender: "블렌더 작업 지시문",
  projectBootstrap: "AI 일괄 생성 · 작품과 목록",
  projectDetails: "AI 일괄 생성 · 상세와 씬",
  motionCleanup: "모캡 키 다듬기 분석",
};

/**
 * 추론 노력.
 *
 * 깊이 생각할수록 결과가 정돈되는 대신 느려지고 토큰을 더 씁니다.
 * **형식만 맞추면 되는 분석에는 «생각 없이» 가 낫습니다** — 레퍼런스에서
 * 색과 옷을 읽어 적는 일에 오래 생각해 봐야 답이 달라지지 않고 요금만 늡니다.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export const REASONING_EFFORT_OPTIONS: {
  id: ReasoningEffort;
  label: string;
}[] = [
  { id: "none", label: "생각 없이" },
  { id: "low", label: "조금" },
  { id: "medium", label: "보통" },
  { id: "high", label: "깊이" },
  // 필요할 때 올려 쓰는 단계입니다. (지시 241)
  // 요금이 크게 올라가므로 기본값으로 쓰지 마세요.
  { id: "xhigh", label: "아주 깊이" },
];

export interface TaskModelChoice {
  model: string;
  effort: ReasoningEffort;
}

/** 08/19 확정 — 성격이 다른 세 단만 남깁니다. 예전에 저장한 다른 모델은
 * 드롭다운이 «목록에 없는 값» 으로 그대로 보여 줍니다. */
export const CLAUDE_MODEL_OPTIONS = [
  { id: "claude-sonnet-5", label: "Sonnet 5 — 균형" },
  { id: "claude-opus-5", label: "Opus 5 — 품질 우선" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — 빠르고 저렴" },
];

export const OPENAI_MODEL_OPTIONS = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — 균형" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol — 품질 우선" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — 빠르고 저렴" },
];

export function modelOptionsFor(provider: LlmProvider) {
  return provider === "claude" ? CLAUDE_MODEL_OPTIONS : OPENAI_MODEL_OPTIONS;
}

/**
 * 작업별 기본 모델.
 *
 * **제공자마다 따로 들고 있습니다.** 제공자를 바꿔 가며 비교해 보는 일이
 * 잦은데, 한 벌만 두면 바꿀 때마다 앞의 설정이 지워집니다. 따로 두면
 * 돌아왔을 때 골라 둔 값이 그대로 있습니다.
 *
 * # 요금을 기준으로 고릅니다
 *
 * 예전에는 거의 전부 중간 단(Sonnet 5 / Terra)이었습니다. 그런데 이 앱이
 * 부르는 열한 가지 작업은 **머리를 써야 하는 정도가 크게 다릅니다.**
 * 그림에서 색과 옷을 받아쓰는 일에 중간 단을 쓰는 것은 그냥 돈을 더 내는
 * 것이고, 반대로 스토리보드를 싼 단으로 뽑으면 컷끼리 앞뒤가 안 맞습니다.
 *
 * 세 갈래로 나눴습니다.
 *
 * - **받아쓰기** — 보이는 것을 형식에 맞춰 적기. 싼 단 · 생각 없이
 * - **글쓰기** — 프롬프트 한 벌 만들기. 중간 단 · 조금
 * - **판단** — 전체 흐름을 쥐고 있어야 하는 것. 중간~비싼 단 · 보통
 *
 * **추론 노력이 모델 선택보다 비쌀 때가 많습니다.** 생각한 토큰도 출력
 * 토큰으로 계산되기 때문입니다. 그래서 «깊이» 는 기본값에 하나도 없습니다 —
 * 필요한 작업만 그때 올려 쓰세요.
 */
type TaskModelMap = Record<LlmTask, Record<LlmProvider, TaskModelChoice>>;

const pair = (
  claudeModel: string,
  openaiModel: string,
  effort: ReasoningEffort = "low",
): Record<LlmProvider, TaskModelChoice> => ({
  claude: { model: claudeModel, effort },
  openai: { model: openaiModel, effort },
});

/** 싼 단·중간 단·비싼 단. 모델 이름을 여기 한 곳에서만 적습니다. */
const CHEAP = ["claude-haiku-4-5", "gpt-5.6-luna"] as const;
const MID = ["claude-sonnet-5", "gpt-5.6-terra"] as const;
const TOP = ["claude-opus-5", "gpt-5.6-sol"] as const;

export const DEFAULT_TASK_MODELS: TaskModelMap = {
  // ── 받아쓰기 ────────────────────────────────────────────────────────
  // 레퍼런스에서 색·옷·재질을 읽어 적습니다. 오래 생각해 봐야 답이
  // 달라지지 않고 요금만 늡니다.
  characterAnalysis: pair(...CHEAP, "none"),
  backgroundAnalysis: pair(...CHEAP, "none"),
  // 이미 정해진 사실을 문장으로 다듬는 일. 사실은 요청문에 못 박혀 있습니다.
  cutPrompt: pair(...CHEAP, "none"),
  // 짧은 글 하나를 고치는 일입니다. 생각을 오래 할 까닭이 없습니다.
  naturalPrompt: pair(...CHEAP, "none"),
  /*
    BGM 도 같습니다 — 고른 태그가 이미 답을 정해 두었고, LLM 은 그것을 곡의 흐름으로
    풀어 쓸 뿐입니다. 오래 생각한다고 더 좋은 태그가 나오지 않습니다.
  */
  bgmPrompt: pair(...CHEAP, "none"),
  // 물건 하나를 여러 각도로 뽑는 정형적인 요청.
  assetPrompt: pair(...CHEAP, "low"),

  // ── 글쓰기 ──────────────────────────────────────────────────────────
  // 정했습니다. (지시 263)
  characterSheet: pair(...CHEAP, "low"),
  backgroundSheet: pair(...CHEAP, "low"),
  // 컷 영상은 뼈대가 규칙으로 서 있고 LLM 은 그 사이를 채웁니다. 시트 프롬프트와 같은 단 —
  // 컷 예순 개에 한 번씩 부르므로 비싼 단으로 두면 일괄 생성 한 번의 요금이 크게 뜁니다.
  cutVideoPrompt: pair(...CHEAP, "low"),
  // 성격·말투를 짓는 일. 조금은 생각해야 사람 같아집니다.
  characterProfile: pair(...MID, "low"),
  // 레퍼런스 없이 «첫 그림» 을 뽑을 프롬프트. 시트 프롬프트와 글쓰기 양은 비슷하지만,
  // 여기서 나온 한 장이 그 인물의 얼굴이 되어 이후 시트·변형이 전부 여기에 묶입니다.
  // 싼 단으로 뭉개면 다시 뽑는 값(생성기 요금 + 시간)이 훨씬 큽니다.
  firstReference: pair(...MID, "low"),
  // 그림 한 장을 보고 눈높이를 읽는 일 — 답은 숫자 하나지만 «무엇을 보고» 가 중요해서
  // 눈이 좋은 단이 필요합니다. 대신 답이 짧아 비용은 얼마 안 듭니다.
  backgroundScale: pair(...MID, "low"),
  // 블렌더 지시문은 길지만 구도 값에서 기계적으로 나옵니다. 비싼 단이 필요 없습니다.
  blender: pair(...MID, "low"),

  // ── 판단 ────────────────────────────────────────────────────────────
  // 변형은 «무엇을 바꾸고 무엇을 지킬지» 를 가려야 합니다. 여기서 헐거우면
  // 정체성이 흔들려 다른 사람이 나오고, 다시 뽑는 값이 더 비쌉니다.
  characterVariation: pair(...MID, "medium"),
  backgroundVariation: pair(...MID, "medium"),
  // 컷 전체의 앞뒤를 쥐고 있어야 하는 유일한 작업.
  storyboard: pair(...TOP, "medium"),
  // 시나리오 한 덩어리를 읽고 작품 전체의 뼈대(제목·줄거리·인물·장소)를 세웁니다.
  // 여기서 나온 목록이 2단계와 이후 모든 카드의 기준이 되므로, 헐거우면 그 뒤가 전부 흔들립니다.
  projectBootstrap: pair(...TOP, "medium"),
  // 1단계가 정한 목록을 상세로 펴는 일. 무엇을 쓸지는 이미 정해져 있어 중간 단이면 됩니다.
  projectDetails: pair(...MID, "low"),
  // 숫자표를 읽고 구간마다 «오류/의도» 를 가리는 판단. 표가 길어 싼 단은 앞부분만 보고 뒤를 뭉갭니다.
  motionCleanup: pair(...MID, "low"),
};

const TASK_MODEL_KEY = "ai-video-storage.llm-task-models.v2";
const ACTIVE_PROVIDER_KEY = "ai-video-storage.llm-provider.v1";

/** 지금 보고 있는 제공자. 작업별 설정 화면이 이걸 따라갑니다. */
export function getActiveProvider(): LlmProvider {
  if (typeof window === "undefined") return "claude";
  const saved = window.localStorage.getItem(ACTIVE_PROVIDER_KEY);
  return saved === "openai" ? "openai" : "claude";
}

export function saveActiveProvider(provider: LlmProvider) {
  window.localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
}

export function getTaskModels(): TaskModelMap {
  if (typeof window === "undefined")
    return structuredClone(DEFAULT_TASK_MODELS);
  try {
    const saved = window.localStorage.getItem(TASK_MODEL_KEY);
    if (!saved) return structuredClone(DEFAULT_TASK_MODELS);
    const parsed = JSON.parse(saved) as Partial<TaskModelMap>;
    // 작업이 나중에 늘어날 수 있어서, 저장된 것 위에 기본값을 덧대 채웁니다.
    const merged = structuredClone(DEFAULT_TASK_MODELS);
    for (const task of Object.keys(merged) as LlmTask[]) {
      const stored = parsed[task];
      if (!stored) continue;
      for (const provider of ["claude", "openai"] as LlmProvider[]) {
        if (stored[provider])
          merged[task][provider] = {
            ...merged[task][provider],
            ...stored[provider],
          };
      }
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_TASK_MODELS);
  }
}

export function saveTaskModels(models: TaskModelMap) {
  window.localStorage.setItem(TASK_MODEL_KEY, JSON.stringify(models));
}

/**
 * 한 제공자의 작업별 설정만 기본값으로 되돌립니다.
 *
 * 이것저것 만지다 보면 무엇이 기본이었는지 잊게 됩니다. 다른 제공자 쪽
 * 설정은 건드리지 않습니다 — 거긴 아직 만지던 중일 수 있으니까요.
 */
export function resetTaskModelsFor(provider: LlmProvider): TaskModelMap {
  const current = getTaskModels();
  for (const task of Object.keys(current) as LlmTask[]) {
    current[task][provider] = { ...DEFAULT_TASK_MODELS[task][provider] };
  }
  saveTaskModels(current);
  return current;
}

export function isDesktopApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ApiKeyStatus {
  provider: string;
  saved: boolean;
  /**
   * 키 끝 네 글자. 어느 키를 넣어 뒀는지 사람이 알아보는 유일한 단서입니다.
   *
   * **Rust 가 보내는 칸 이름은 `hint` 입니다**(`llm.rs` 의 `ApiKeyStatus`). 여기서만
   * `lastFour` 로 적어 두었더니 값이 늘 비어서, 「저장됨 ···abcd」 가 **한 번도 안 떴습니다**
   * (2026-09-23 검토). 칸 이름은 보내는 쪽을 따릅니다 — 두 이름을 두면 잇는 코드를
   * 어디에도 안 두고 조용히 비는 일이 또 납니다.
   */
  hint?: string | null;
}

export async function getApiKeyStatus(
  provider: LlmProvider,
): Promise<ApiKeyStatus> {
  if (!isDesktopApp()) return { provider, saved: false, hint: null };
  return invoke<ApiKeyStatus>("get_api_key_status", { provider });
}

export async function saveApiKey(provider: LlmProvider, key: string) {
  return invoke("save_api_key", { provider, key });
}

export async function deleteApiKey(provider: LlmProvider) {
  return invoke("delete_api_key", { provider });
}

/**
 * 키가 실제로 통하는지 확인합니다.
 *
 * «저장됨» 은 파일이 있다는 뜻일 뿐, 키가 만료됐거나 잘못 붙여넣었어도
 * 저장은 됩니다. 제일 싼 모델로 한 글자짜리 답을 받아 봐야 확실합니다.
 */
export async function verifyApiKey(provider: LlmProvider): Promise<void> {
  if (!isDesktopApp()) throw new Error("데스크톱 앱에서만 확인할 수 있습니다.");
  const model = provider === "claude" ? "claude-haiku-4-5" : "gpt-5.6-luna";
  await invoke<string>("call_llm", {
    request: {
      provider,
      model,
      effort: "none",
      system: "Reply with exactly: ok",
      prompt: "ping",
      images: [],
      // 8 로 두었더니 OpenAI 가 «16 이상이어야 한다» 며 400 을 냈습니다.
      // 넉넉히 둡니다 — 확인 한 번에 드는 값은 어차피 0에 가깝습니다.
      maxTokens: 64,
      // 확인은 «되는지 아닌지» 만 보는 것이라 오래 기다릴 이유가 없습니다.
      timeoutSecs: 30,
    },
  });
}

export interface LlmImageInput {
  mediaType: string;
  /** data: 접두사를 뺀 base64 본문 */
  data: string;
}

export interface LlmCallOptions {
  /**
   * 요청문 중 **늘 같은 앞부분**(템플릿·모델 가이드·공통규칙·기법 문서).
   *
   * 여기에 캐시 표를 답니다 — 두 번째 요청부터 입력 요금의 0.1배로 읽힙니다.
   * 작업 데이터가 한 글자라도 섞이면 요청마다 캐시가 어긋나 쓰기 요금만 냅니다.
   */
  fixedPrompt?: string;
  /** 요청 id. 주면 cancelLlmRequest 로 중간에 끊을 수 있습니다(API 기록의 job id 를 씁니다). */
  requestId?: string;
  task: LlmTask;
  /** 안 주면 지금 고른 제공자를 씁니다. */
  provider?: LlmProvider;
  system: string;
  prompt: string;
  images?: LlmImageInput[];
  maxTokens?: number;
  temperature?: number;
  /**
   * 몇 초까지 기다릴지. 안 주면 Rust 쪽 기본값(180초)입니다.
   *
   * **maxTokens 를 올린 요청은 시간도 같이 올려야 짝이 맞습니다.** 「AI 로 일괄 생성」 의
   * 2단계는 8192 토큰으로 부르는데 시간 제한은 180초 그대로여서, 인물 여럿 + 씬 목록을
   * 받다가 시간이 지나 통째로 실패했습니다(그 바람에 1단계 결과까지 버려졌습니다).
   */
  timeoutSecs?: number;
  /**
   * **앱이 닫히기 전에 보낸 요청의 응답 id.** 주면 보내지 않고 그 답을 **묻기만** 합니다(`llm_resume`).
   *
   * OpenAI 는 배경 모드라
   * 서버가 답을 들고 있습니다. 서버에 그 답이 없으면(만료·잘못된 id) `isLlmResumeGone` 인 오류가 나고,
   * 부르는 쪽이 처음부터 다시 보냅니다. Claude 는 이어 받을 길이 없어 늘 다시 보냅니다.
   */
  resumeId?: string;
  /** 요청이 서버에 닿아 응답 id 가 생기면 알립니다(Rust 의 `llm-started`). 작업 줄이 이걸 적어 둡니다. */
  onResponseId?: (responseId: string) => void;
}

/**
 * **보낼까, 물을까** — 부를 명령과 보낼 것을 정합니다. 순수 함수라 시험이 이걸 봅니다(`llm.test.ts`).
 *
 * 이어 받을 때는 요청문·그림을 싣지 않습니다 — 서버가 이미 다 가지고 있고, 우리는 id 로 묻기만 합니다.
 * 모델 이름은 요금표의 열쇠라 같이 보냅니다(답에 실린 이름은 날짜가 붙은 판이라 표와 안 맞습니다).
 */
export function llmInvocationOf(
  options: LlmCallOptions,
  provider: LlmProvider,
  choice: TaskModelChoice,
): { command: "call_llm" | "llm_resume"; request: Record<string, unknown> } {
  if (options.resumeId) {
    return {
      command: "llm_resume",
      request: {
        provider,
        responseId: options.resumeId,
        model: choice.model,
        timeoutSecs: options.timeoutSecs,
        requestId: options.requestId,
      },
    };
  }
  return {
    command: "call_llm",
    request: {
      provider,
      model: choice.model,
      effort: choice.effort,
      system: options.system,
      // 늘 같은 앞부분. 있으면 Rust 가 여기에 캐시 표를 답니다.
      fixedPrompt: options.fixedPrompt,
      prompt: options.prompt,
      images: (options.images || []).map((image) => ({
        mediaType: image.mediaType,
        data: image.data,
      })),
      maxTokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      timeoutSecs: options.timeoutSecs,
      requestId: options.requestId,
    },
  };
}

export async function callLlmText(options: LlmCallOptions): Promise<string> {
  if (!isDesktopApp())
    throw new Error("데스크톱 앱에서만 LLM 을 호출할 수 있습니다.");
  const provider = options.provider ?? getActiveProvider();
  const { command, request } = llmInvocationOf(options, provider, getTaskModels()[options.task][provider]);
  /*
    응답 id 를 받을 귀는 **보내기 전에** 답니다 — id 는 답보다 먼저(몇 초 안에) 오고, 그 뒤 몇 분 사이에
    앱이 닫히는 것이 문제의 모양입니다. 요청 id 없이 간 것은 짝을 맞출 수 없어 안 답니다.
  */
  const watching = Boolean(options.requestId && options.onResponseId);
  if (watching) {
    await hookLlmStarted();
    responseIdWatchers.set(options.requestId!, options.onResponseId!);
  }
  try {
    return await invoke<string>(command, { request });
  } finally {
    if (watching) responseIdWatchers.delete(options.requestId!);
  }
}

/*
  ── 응답 id 를 받아 전합니다 ─────────────────────────────────────────────
  Rust 가 요청이 서버에 닿자마자 `llm-started` 로 쏩니다(`src-tauri/src/llm.rs`). 여기서 한 번만 귀를 답니다 —
  요청마다 달면 리스너가 쌓입니다(`llmActivity.hookLlmUsage` 와 같은 모양). 요청 id 로 짝을 맞춥니다.
*/
const responseIdWatchers = new Map<string, (responseId: string) => void>();
let startedHooked: Promise<void> | null = null;

export function hookLlmStarted(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!startedHooked) {
    startedHooked = import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ requestId: string; responseId: string }>("llm-started", (event) => {
          const { requestId, responseId } = event.payload ?? ({} as never);
          if (requestId && responseId) responseIdWatchers.get(requestId)?.(responseId);
        }),
      )
      .then(() => undefined)
      .catch(() => {
        startedHooked = null;
      });
  }
  return startedHooked;
}

/** 진행 중인 LLM 요청을 끊습니다. 제공사 쪽 요금은 이미 발생했을 수 있습니다. */
export async function cancelLlmRequest(requestId: string): Promise<boolean> {
  if (!isDesktopApp()) return false;
  return invoke<boolean>("cancel_llm", { requestId });
}

/**
 * 응답에서 JSON 을 꺼냅니다.
 *
 * 형식을 아무리 지시해도 모델은 ```json 펜스나 짧은 머리말을 붙이곤 합니다.
 * 매번 파싱이 깨지느니 여기서 한 번 정리하는 편이 낫습니다.
 */
/**
 * **중간에서 잘린 JSON 을 살려 냅니다.**
 *
 * 모델이 `maxTokens` 에 걸리면 답이 **문장 한가운데서 끊깁니다.** 그러면 `JSON.parse` 가
 * 실패하고, 예전에는 그것으로 끝이었습니다 — 인물 열 명 중 아홉 명이 멀쩡히 적혀 있어도
 * 통째로 버렸습니다(2026-09-18, 17쪽짜리 대본에서 «캐릭터·씬이 하나도 안 들어간» 원인).
 *
 * 끝에서부터 «값 하나가 온전히 끝난 자리» 를 되짚어 가며, 거기서 자르고 열린 괄호를
 * 닫아 봅니다. 처음 성공하는 자리가 **가장 많이 건진** 자리입니다.
 *
 * 되살린 값은 **받은 데까지**입니다. 부르는 쪽이 「덜 왔다」 를 사람에게 알려야 합니다.
 */
function repairTruncatedJson(text: string): string | null {
  const stack: string[] = [];
  const cuts: { at: number; open: string }[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      // 덩어리 하나가 온전히 끝난 자리.
      cuts.push({ at: i + 1, open: stack.join("") });
      continue;
    }
    // 쉼표 **앞**은 「값 하나가 방금 끝났다」 는 가장 믿을 만한 신호입니다.
    if (ch === ",") cuts.push({ at: i, open: stack.join("") });
  }
  const close = (open: string) =>
    open
      .split("")
      .reverse()
      .map((ch) => (ch === "{" ? "}" : "]"))
      .join("");
  /*
    뒤에서부터 봅니다 — 뒤쪽일수록 많이 건집니다. 200 자리까지만 보는 까닭은, 그보다
    더 되짚어야 한다면 답이 처음부터 JSON 이 아니었을 가능성이 크기 때문입니다.
  */
  for (let i = cuts.length - 1; i >= Math.max(0, cuts.length - 200); i -= 1) {
    const { at, open } = cuts[i];
    if (!open) continue;
    try {
      return JSON.stringify(JSON.parse(text.slice(0, at) + close(open)));
    } catch {
      // 이 자리는 아니었습니다. 한 칸 더 앞으로.
    }
  }
  return null;
}

export function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  /*
    **닫는 펜스가 없어도** 엽니다. 답이 잘리면 ```json 은 있는데 닫는 ``` 이 없어서,
    예전에는 여는 펜스까지 통째로 JSON 으로 읽다가 첫 글자에서 실패했습니다.
  */
  const opened = fenced ? null : trimmed.match(/```(?:json)?\s*([\s\S]*)$/);
  const candidate = (fenced?.[1] ?? opened?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // 펜스가 없고 앞뒤에 말이 붙은 경우: 가장 바깥 중괄호만 잘라 봅니다.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        // 아래 되살리기로 넘어갑니다.
      }
    }
    // 마지막 수단 — 잘린 답에서 받은 데까지 건집니다.
    const head = start >= 0 ? candidate.slice(start) : candidate;
    const repaired = repairTruncatedJson(head);
    if (repaired) {
      console.warn("[LLM] 답이 중간에서 잘려 받은 데까지만 읽었습니다.", {
        받은길이: text.length,
      });
      return JSON.parse(repaired) as T;
    }
    throw new Error("응답에서 JSON 을 찾지 못했습니다.");
  }
}


/**
 * 그림 하나를 LLM 에 실을 수 있는 모양으로 바꿉니다.
 *
 * 사고로 잃어 다시 쓴 함수입니다. 원본에서 두 가지가 중요했습니다.
 *
 * **하나 — 형식을 반드시 확인합니다.** 제공사는 png·jpeg·gif·webp 만 받습니다.
 * 예전에는 «작은 그림은 그대로 보내기» 로 질러 갔는데, 그때 형식이 비어 있거나
 * octet-stream 인 파일이 섞여 들어와 «Invalid MIME type» 으로 통째로 실패했습니다.
 * 받아 주는 형식이 아니면 캔버스로 다시 그려 png 로 만듭니다.
 *
 * **둘 — 너무 큰 그림은 줄입니다.** 모델은 어차피 정해진 크기로 줄여서 보고,
 * 요금은 픽셀 수에 비례합니다. 큰 그림을 그대로 보내면 돈만 더 내고 결과는
 * 같습니다.
 */
const LLM_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
const MAX_EDGE = 1568;

export async function toLlmImage(
  source: File | string,
): Promise<LlmImageInput> {
  /*
    주소가 아닌 것(파일 경로)이 오면 `fetch` 가 「Failed to fetch」 로 즉시 죽습니다.
    그 말로는 무엇이 잘못됐는지 알 수 없어서, 여기서 미리 가려 **무엇을 줬는지** 말합니다
    .
    폴더의 파일은 `assetSrc()` 로 바꿔서 주세요.
  */
  if (typeof source === "string" && !/^(https?|data|blob|asset):/i.test(source)) {
    throw new Error(
      `그림 주소가 아닙니다: ${source.slice(0, 80)} — 폴더 경로라면 assetSrc() 로 바꿔서 넘겨야 합니다.`,
    );
  }
  const blob =
    typeof source === "string" ? await (await fetch(source)).blob() : source;

  const bitmap = await createImageBitmap(blob).catch(() => null);
  const tooBig = bitmap
    ? Math.max(bitmap.width, bitmap.height) > MAX_EDGE
    : false;

  if (bitmap && (tooBig || !LLM_IMAGE_TYPES.test(blob.type))) {
    const scale = tooBig ? MAX_EDGE / Math.max(bitmap.width, bitmap.height) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const redrawn = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (redrawn)
        return { mediaType: "image/png", data: await toBase64(redrawn) };
    }
  }

  if (!LLM_IMAGE_TYPES.test(blob.type)) {
    throw new Error("png·jpeg·gif·webp 만 보낼 수 있습니다.");
  }
  return { mediaType: blob.type, data: await toBase64(blob) };
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  // 한 번에 넘기면 인자가 너무 많다고 터집니다. 조각을 내어 이어 붙입니다.
  const CHUNK = 0x8000;
  const binary = Array.from({ length: Math.ceil(buffer.length / CHUNK) }, (_, index) =>
    String.fromCharCode(...buffer.subarray(index * CHUNK, (index + 1) * CHUNK)),
  ).join("");
  return btoa(binary);
}

/**
 * 이 작업을 지금 LLM 으로 돌릴 수 있는지.
 *
 * 작업마다 쓰는 제공사가 달라서, 그 제공사의 키가 있는지 봐야 합니다.
 * 키가 없으면 버튼을 눌러 봐야 실패하므로 미리 알려 줍니다.
 */
export function useLlmReady(task: LlmTask) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const provider = getActiveProvider();
    getApiKeyStatus(provider)
      .then((status) => {
        if (alive) setReady(status.saved);
      })
      .catch(() => {
        if (alive) setReady(false);
      });
    return () => {
      alive = false;
    };
  }, [task]);

  return ready;
}

/**
 * **백만 토큰당 요금(USD).** 여기 한 곳에서만 적습니다.
 *
 * # 왜 코드에 적나
 *
 * 요금은 제공사가 언제든 바꿉니다. 그래서 이 표는 **짐작을 보여 주기 위한 것**이지
 * 청구서가 아닙니다 — 화면에도 «추정» 이라고 적습니다. 값이 틀어졌다 싶으면 여기만
 * 고치면 기록 전체가 따라 바뀝니다.
 *
 * 토큰 수 자체는 제공사가 준 **사실**이라 언제나 맞습니다. 그래서 화면에는 토큰을
 * 먼저 보여 주고 금액은 곁들입니다.
 *
 * # 캐시 두 칸을 왜 나눠 두나
 *
 * 캐시는 **쓸 때 1.25배, 읽을 때 0.1배**입니다. 한 칸으로 합치면 「캐시가 실제로
 * 먹고 있나」 를 볼 수가 없습니다 — 캐시를 붙이고도 값이 그대로면 안 먹는 것입니다.
 *
 * 적어 둔 날: 2026-09-19.
 */
export const LLM_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 15, output: 75 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-5.6-sol": { input: 15, output: 75 },
  "gpt-5.6-terra": { input: 3, output: 15 },
  "gpt-5.6-luna": { input: 1, output: 5 },
};

/** 모르는 모델이면 중간 단으로 셉니다 — 0 으로 두면 「공짜」 로 보입니다. */
const FALLBACK_PRICE = { input: 3, output: 15 };

export function llmCostOf(usage: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  const price = LLM_PRICES[usage.model] ?? FALLBACK_PRICE;
  const per = (tokens: number, rate: number) => (tokens / 1_000_000) * rate;
  return (
    per(usage.inputTokens, price.input) +
    per(usage.outputTokens, price.output) +
    // 캐시 읽기는 0.1배, 쓰기는 1.25배.
    per(usage.cacheReadTokens, price.input * 0.1) +
    per(usage.cacheWriteTokens, price.input * 1.25)
  );
}

/** 「$0.0431」 처럼. 아주 작은 값이 0 으로 보이지 않게 자릿수를 늘립니다. */
export function formatLlmCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}
