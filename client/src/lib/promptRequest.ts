import { callLlmText, cancelLlmRequest, getActiveProvider, parseJsonResponse, toLlmImage, type LlmTask } from "@/lib/llm";
import { splitRequestText } from "@/lib/llmRequestText";
import { loadCommonRules, loadModelGuide, loadPlatformGuide, loadRequestTemplate, loadTechniqueGuides } from "@/lib/promptLibrary";
import {
  failLlmJob,
  finishLlmJob,
  noteLlmDelivery,
  noteLlmResponseId,
  noteLlmResumeFallback,
  startLlmJob,
} from "@/lib/llmActivity";
import type { RequestTemplateId } from "@/components/LlmRequestButton";
import { canonicalPromptModel, promptResultForModel } from "./promptModelSelection";
import { musicLyricsResult } from "./musicPromptPolicy";

/**
 * 요청문을 만들어 API 로 보내고, 네 칸짜리 프롬프트를 받아 옵니다.
 *
 * 여태 "프롬프트 작성" 버튼은 아무 데도 요청을 보내지 않고 정해진 틀에 값을 끼워
 * 넣기만 했습니다. 그래서 즉시 나오는 대신, 분석 결과 같은 긴 글이 그대로 슬롯에
 * 박혀 읽을 수 없는 문장이 나왔습니다.
 *
 * 보내는 내용은 "LLM 요청문" 창에 뜨는 글과 **똑같습니다.** 손으로 복사해 붙여넣든
 * 여기서 보내든 같은 것을 받게 하려는 것입니다. 둘이 다르면 어느 쪽이 맞는지
 * 확인할 방법이 없습니다.
 */

export interface PromptRequestResult {
  ko: string;
  en: string;
  negativeKo: string;
  negativeEn: string;
  panels?: string[];
  /**
   * **가사** — 곡 요청만 채워집니다(`bgm-prompt`).
   *
   * 음악 모델은 «스타일 + 가사» 두 칸을 받는데, 여태 여기서 ko/en 두 칸만 꺼내
   * 「스타일 · 가사 뽑기」 를 눌러도 **가사 칸이 계속 비어 있었습니다**. 네거티브와 같은 자리에 두어 부르는 쪽이 골라 쓰게 합니다.
   */
  lyricsKo?: string;
  lyricsEn?: string;
}

export interface LlmRequestOptions {
  /** 요청이 API 기록에 오르는 순간 그 id 를 알려 줍니다. 「중지」 단추가 이 id 로 끊습니다. */
  onStarted?: (jobId: string) => void;
  task: LlmTask;
  template: RequestTemplateId;
  data: unknown;
  modelId?: string;
  platformId?: string;
  techniques?: string[];
  /** 함께 올릴 그림. 파일이거나 화면 주소입니다. */
  images?: (File | string)[];
  /** 「API 기록」 에 뜰 이름. "여울 · 전신 시트" 처럼 적습니다 */
  label?: string;
  /**
   * 받은 값이 **어디로 들어갔는지**. "여울 · 레퍼런스 분석 에 넣음" 처럼 적습니다.
   *
   * 요청 하나에 몇 십 초가 걸려서, 답이 올 즈음에는 다른 카드를 보고 있는
   * 것이 보통입니다. 그러면 값은 화면 밖으로 들어갑니다. 어디로 갔는지
   * 안 적으면 찾아갈 방법이 없습니다.
   */
  deliveredTo?: string;
  /**
   * 받을 글의 최대 길이. 안 주면 4096 입니다.
   *
   * 프롬프트 한 벌은 4096 으로 넉넉하지만, 「AI 로 일괄 생성」 처럼 **인물 여럿과
   * 씬 목록을 한 답에 담는** 요청은 중간에 잘립니다. 잘린 JSON 은 파싱이 깨져
   * 「응답에서 JSON 을 찾지 못했습니다」 로만 보여서, 왜 실패했는지 알 수가 없습니다.
   */
  maxTokens?: number;
  /**
   * 몇 초까지 기다릴지. 안 주면 Rust 기본값(180초)입니다.
   *
   * `maxTokens` 만 올리고 여기를 그대로 두면 짝이 안 맞습니다 — 길게 받기로 해 놓고
   * 180초에 끊어 버리니, 정상적으로 길게 쓰던 답이 «시간이 지났습니다» 로 죽습니다.
   */
  timeoutSecs?: number;
  /**
   * 앱이 닫히기 전에 보낸 요청의 응답 id — 주면 보내지 않고 그 답을 **묻기만** 합니다. 서버에 그 답이 없으면
   * 처음부터 다시 보냅니다. 작업 줄의 `withResumableLlm` 이 채워 줍니다.
   */
  resumeId?: string;
  /** 응답 id 가 생기면 알립니다. 이걸 준 요청만 API 기록에 id 가 적혀 «이어 받는 중» 으로 되살아납니다. */
  onResponseId?: (responseId: string) => void;
}

/**
 * 요청문을 만들어 보내고 JSON 을 그대로 돌려줍니다.
 *
 * 프롬프트 네 칸이 아니라 다른 모양의 답(캐릭터 특징 같은)을 받을 때 씁니다.
 * 요청문을 만드는 방식은 프롬프트 요청과 **한 글자도 다르지 않아야** 해서
 * 여기 한 곳에 둡니다.
 */
export async function requestJsonFromLlm<T>(options: LlmRequestOptions): Promise<T> {
  return parseJsonResponse<T>(await requestRawFromLlm(options));
}

/**
 * 요청 하나를 「API 기록」 에 남기면서 보냅니다.
 *
 * 여기 한 곳을 지나가야 기록이 빠짐없이 남습니다. 부르는 쪽마다 따로
 * 적게 했더니 **아무도 안 적어서 기록 창이 늘 비어 있었습니다.**
 */
async function requestRawFromLlm(options: LlmRequestOptions): Promise<string> {
  /*
    응답 id 는 **OpenAI 배경 모드**의 것입니다. 앱이 닫힌 사이 설정에서 Claude 로 바꿨으면 그 id 로 물을 데가
    없습니다 — Claude 는 이어 받을 길이 없어 처음부터 다시 보냅니다(잃은 답을 «이어 받음» 으로 적으면 안 됩니다).
  */
  const resumable = getActiveProvider() === "openai" ? options : { ...options, resumeId: undefined };
  const jobId = startLlmJob(options.task, options.label, resumable.resumeId);
  options.onStarted?.(jobId);
  try {
    const text = await sendResumable(resumable, jobId);
    finishLlmJob(jobId);
    if (options.deliveredTo) noteLlmDelivery(jobId, options.deliveredTo);
    return text;
  } catch (error) {
    failLlmJob(jobId, error);
    throw error;
  }
}

/**
 * 이어 받다 **서버에 답이 없으면 처음부터 다시** — 만료됐거나 id 가 틀린 것이라 기다려 봐야 소용없습니다.
 * 실패·중지·시간 초과는 그대로 실패입니다 — 그때 다시 보내면 사람이 모르는 새 값을 두 번 냅니다.
 */
async function sendResumable(options: LlmRequestOptions, jobId: string): Promise<string> {
  if (!options.resumeId) return sendToLlm(options, jobId);
  try {
    return await sendToLlm(options, jobId);
  } catch (error) {
    if (!isLlmResumeGone(error)) throw error;
    noteLlmResumeFallback(jobId);
    return sendToLlm({ ...options, resumeId: undefined }, jobId);
  }
}

async function sendToLlm(options: LlmRequestOptions, requestId?: string): Promise<string> {
  /*
    이어 받을 때는 요청문을 다시 짓지 않습니다 — 서버가 이미 다 가지고 있습니다. 템플릿을 읽고 그림을
    base64 로 바꾸는 일이 통째로 헛수고이고, 그림이 그새 폴더에서 사라졌으면 여기서 죽어 다 된 답까지 못 받습니다.
  */
  if (options.resumeId) {
    return callLlmText({
      task: options.task,
      system: "",
      prompt: "",
      timeoutSecs: options.timeoutSecs,
      requestId,
      resumeId: options.resumeId,
    });
  }
  /*
    응답 id 는 **이어 받을 수 있는 요청에만** 기록에 적습니다 — `onResponseId` 를 준 쪽(작업 줄)만 앱을
    껐다 켠 뒤 그 답을 찾아갑니다. 카드 단추 요청에 적으면 «이어 받는 중» 으로 되살아나 영영 돕니다.
  */
  const onResponseId = options.onResponseId
    ? (responseId: string) => {
        if (requestId) noteLlmResponseId(requestId, responseId);
        options.onResponseId?.(responseId);
      }
    : undefined;
  const parts = await buildPromptRequestText(options, Math.min(options.images?.length ?? 0, 4));

  // 그림은 넉 장까지만 보냅니다. 더 보내면 모델이 각각을 더 작게 줄여 보므로
  // 장수를 늘릴수록 오히려 한 장 한 장이 흐려집니다.
  const images = await Promise.all((options.images ?? []).slice(0, 4).map(source => toLlmImage(source)));

  return callLlmText({
    task: options.task,
    system: "You follow the instructions in the user message exactly and reply with only the requested JSON.",
    fixedPrompt: parts.fixed,
    prompt: parts.fresh,
    images,
    maxTokens: options.maxTokens ?? 4096,
    timeoutSecs: options.timeoutSecs,
    requestId,
    onResponseId,
  });
}

/** API 버튼과 대화 조종기가 같은 템플릿·모델 규칙·조건문을 읽습니다. */
export async function buildPromptRequestText(
  options: Pick<LlmRequestOptions, "template" | "data" | "modelId" | "platformId" | "techniques">,
  imageCount = 0,
): Promise<{ fixed: string; fresh: string }> {
  const data = options.data as { generationTarget?: import("./promptModelSelection").PromptSelection; targetTool?: string; nanoBanana21?: import("./nanoBanana21Profile").NanoBanana21Options } | null;
  const target=data?.generationTarget;
  if(target?.error)throw new Error(target.error);
  if(target?.route==="comfy"&&!target.workflowTarget)throw new Error("workflow_prompt_role_required: workflow와 프롬프트 역할을 먼저 선택하세요. 다른 모델로 대체하지 않습니다.");
  const workflow=target?.workflowTarget?(await import("./comfyWorkflowLibrary")).workflowPromptContext(target.workflowTarget):undefined;
  const modelId = canonicalPromptModel(data?.generationTarget?.modelId ?? options.modelId ?? (options.template === "bgm-prompt" ? data?.targetTool : undefined));
  const platformId = data?.generationTarget?.platformId ?? options.platformId;
  const nano21=await import("./nanoBanana21Profile");
  const nano21Context=nano21.isNanoBanana21(modelId)?{provider:nano21.NANO_BANANA_21,request:nano21.validateNanoBanana21Options(data?.nanoBanana21)}:undefined;
  const [system, modelGuide, platformGuide, techniqueGuides, commonRules] = await Promise.all([
    loadRequestTemplate(options.template),
    modelId ? loadModelGuide(modelId) : Promise.resolve(""),
    platformId ? loadPlatformGuide(platformId) : Promise.resolve(""),
    loadTechniqueGuides(options.techniques ?? []),
    // 칩을 고르든 말든 늘 붙습니다.
    loadCommonRules(),
  ]);

  // ::when 문단을 고르는 값. LlmRequestButton 과 같은 규칙이어야 합니다.
  const vars: Record<string, string> = {};
  if (platformId) vars.platform = platformId;
  if (modelId) vars.modelId = modelId;
  if (options.data && typeof options.data === "object") {
    for (const [key, value] of Object.entries(options.data as Record<string, unknown>)) {
      if (typeof value === "string") vars[key] = value;
    }
  }

  return splitRequestText({
    system,
    modelGuide: modelId ? `선택 생성 모델 ID: ${modelId}\n${modelGuide || "이 ID의 검증된 전용 가이드가 없습니다. 다른 모델 문법으로 대체하지 말고 지원 확인이 필요함을 명시하세요."}${workflow ? `\n\n명시 Comfy 역할/모델/입력 계약:\n${JSON.stringify(workflow,null,2)}\npositive는 선택 역할에 작성합니다. negativeSupport가 supported가 아니면 negativeKo/negativeEn은 빈 문자열로 주세요. 실제 graph에 없는 제어 입력·화자 ID·참조 지원은 만들어내지 마세요. 초안 작성은 생성 승인 또는 모델 제어 보장이 아닙니다.` : ""}` : "생성 모델이 미선택입니다. 특정 모델 제어를 보장하지 마세요.",
    platformGuide: nano21Context ? `${platformGuide}\n\n선택한 2.1 provider 프로필과 요청 옵션:\n${JSON.stringify(nano21Context,null,2)}\n참조 fidelity 경고를 등장 인원 금지로 바꾸지 마세요. 이 값은 프롬프트 작성 정보이며 Magnific API에 전달되었다는 뜻이 아닙니다.` : platformGuide,
    techniqueGuides,
    commonRules: options.template === "bgm-prompt" ? `${commonRules}\n\n사용자 필수 저장 규칙: instrumental=true이면 lyricsKo/lyricsEn은 빈 문자열입니다. 보컬 가사는 마지막 독립 줄에 소문자 literal [end]를 중복 없이 한 번만 씁니다. 모델의 종료를 보장하는 제어토큰으로 주장하지 않습니다. 모델 고유 종료 표기와 다르면 원본 가사와 모델 변환 단계의 차이를 설명하고 원본 규칙을 유지합니다. 같은 멤버의 음색·음역·발음·창법 프로필과 파트 배정을 유지하고, single lead에는 single-tracked close-miked dry centered lead와 명확한 발음을 권합니다. 후렴 구간 [Chorus]는 chorus effect와 다릅니다. 모델/endpoint가 제공하지 않는 화자 ID/negative_prompt/seed/보컬 고정 기능을 만들지 않습니다.` : commonRules,
    prompt: JSON.stringify(options.data, null, 2),
    vars,
    imageCount,
  });
}

/** 「중지」 — API 기록의 job id 로 진행 중인 요청을 끊습니다. 기다리던 쪽은 «중지했습니다» 오류를 받습니다. */
export async function cancelLlmJob(jobId: string): Promise<boolean> {
    return cancelLlmRequest(jobId);
}

/** 오류가 «중지» 에서 온 것인지. 중지는 실패가 아니라 조용히 로딩만 끄면 됩니다. */
export function isLlmCancel(error: unknown): boolean {
  return String(error).includes("중지했습니다");
}

/** 이어 받을 답이 서버에 없다는 오류인지(Rust `RESUME_GONE`). 이때만 처음부터 다시 보냅니다. */
export function isLlmResumeGone(error: unknown): boolean {
  return String(error).includes("이어 받을 답이 서버에 없습니다");
}

export async function requestPromptFromLlm(options: LlmRequestOptions): Promise<PromptRequestResult> {
  const raw = await requestRawFromLlm(options);
  const parsed = parseJsonResponse<Record<string, unknown>>(raw);
  /*
    모델이 키 이름을 바꾸거나 한 겹 더 싸서 돌려주는 일이 있습니다(`{"prompt": {"ko": …}}`,
    `korean`/`english`, `prompt_ko`). 그러면 네 칸이 빈 문자열로 들어가면서 «프롬프트를 받았습니다»
    라고만 뜨고 칸은 비어 있었습니다. 흔한 이름을 두루 찾고, 그래도 비면 오류로
    돌려 규칙 조립으로 넘어가게 합니다 — 조용히 빈 칸을 남기지 않습니다.
  */
  const unwrap = (value: Record<string, unknown>): Record<string, unknown> => {
    for (const key of ["prompt", "prompts", "result", "data", "output"]) {
      const inner = value[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
    }
    return value;
  };
  const body = unwrap(parsed);
  const text = (source: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const ko = text(body, ["ko", "korean", "koreanPrompt", "prompt_ko", "promptKo", "kr", "styleKo", "style_ko"]);
  const en = text(body, ["en", "english", "englishPrompt", "prompt_en", "promptEn", "styleEn", "style_en", "style"]);
  if (!ko && !en) {
    throw new Error(`답에 프롬프트(ko/en)가 없습니다. 답 앞부분: ${raw.trim().slice(0, 160)}`);
  }
  const result = {
    ko,
    en,
    negativeKo: text(body, ["negativeKo", "negative_ko", "negativeKorean"]),
    // 예전 형식으로 한 덩어리만 돌려주는 경우도 받아 줍니다.
    negativeEn: text(body, ["negativeEn", "negative_en", "negativeEnglish", "negative"]),
    // 가사는 곡 요청에만 옵니다. 안 오면 빈 문자열이라 부르는 쪽에서 «왔을 때만» 넣습니다.
    lyricsKo: text(body, ["lyricsKo", "lyrics_ko", "lyricsKorean", "가사"]),
    lyricsEn: text(body, ["lyricsEn", "lyrics_en", "lyricsEnglish", "lyrics"]),
    panels: body.panels as PromptRequestResult["panels"],
  };
  return options.template === "bgm-prompt" ? musicLyricsResult(result, Boolean((options.data as { instrumental?: boolean })?.instrumental)) : promptResultForModel(result, canonicalPromptModel((options.data as { generationTarget?: { modelId?: string } })?.generationTarget?.modelId ?? options.modelId));
}

/**
 * 분석 칸에 JSON 이 통째로 들어 있으면 사람이 읽는 문장만 꺼냅니다.
 *
 * 분석 결과를 손으로 붙여넣을 수 있게 열어 두었더니, LLM 이 돌려준 JSON 을
 * 그대로 넣는 경우가 생겼습니다. 그 상태로 프롬프트를 조립하면 중괄호와 따옴표가
 * 프롬프트 본문에 박힙니다.
 */
export function plainAnalysisText(value?: string | null): string {
  const text = (value || "").trim();
  if (!text.startsWith("{") && !text.startsWith("```")) return text;

  try {
    const parsed = parseJsonResponse<{ appearance?: string; analysis?: string }>(text);
    return (parsed.appearance || parsed.analysis || "").trim() || text;
  } catch {
    return text;
  }
}
