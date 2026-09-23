import { useSyncExternalStore } from "react";
import { LLM_TASK_LABELS, llmCostOf, type LlmTask } from "@/lib/llm";

/**
 * API 에 무엇을 부탁했고 어떻게 됐는지 남기는 자리.
 *
 * 요청 하나에 몇 십 초가 걸립니다. 그 사이 손을 놓고 기다리는 것이 아니라 다른
 * 카드를 열어 다음 요청을 겁니다. 그러면 곧 알 수 없어집니다 — 아까 그 요청이
 * 아직 도는 중인지, 답이 왔는지, 실패했는지, 왔다면 어디로 들어갔는지.
 *
 * 토스트는 지나가면 끝이라 이 물음에 답하지 못합니다. 남는 목록이 필요합니다.
 *
 * 리액트 밖에 둡니다. 요청은 창을 닫아도 계속 돌고, 기록은 그 창보다 오래
 * 살아야 하기 때문입니다. 화면은 useLlmActivity 로 구독만 합니다.
 */

/**
 * `resuming` — 앱이 닫힐 때 답을 기다리던 요청인데, 서버가 답을 들고 있어 **줄이 다시 돌면 이어 받을**
 * 것. 러너가 이어 받기를 시작하면 이 줄이 그대로 `running` 이 됩니다(새 줄을 만들지 않습니다 —
 * 같은 요청이 두 줄로 보이면 값을 두 번 낸 줄 압니다).
 */
export type LlmJobStatus = "running" | "resuming" | "done" | "failed";

export interface LlmJob {
  id: string;
  task: LlmTask;
  /** 어느 캐릭터·변형의 요청인지. "여울 · 전신 시트" 처럼 적습니다. */
  label: string;
  status: LlmJobStatus;
  startedAt: number;
  finishedAt?: number;
  /** 실패했을 때 그대로 보여 줄 말 */
  error?: string;
  /**
   * 제공사 쪽 응답 id(OpenAI 배경 모드). **이어 받을 수 있는 요청에만** 적힙니다 — 작업 줄에서 온 것.
   * 카드 단추로 건 요청은 앱이 닫히면 이어 받을 사람이 없으니 적지 않습니다(적으면 «이어 받는 중» 으로
   * 되살아나 영영 빙글빙글 돕니다).
   */
  responseId?: string;
  /** 앱을 껐다 켠 뒤 **이어 받은** 답인가. 화면이 「받음 (이어 받음)」 으로 적습니다. */
  resumed?: boolean;
  /**
   * 받은 값이 어디로 들어갔는지.
   *
   * 창을 옮긴 뒤에 답이 오면 화면에 안 보이는 곳으로 들어갑니다.
   * 그때 "어디로 갔는지" 를 여기 적어 두어야 찾아갈 수 있습니다.
   */
  delivered?: string;
  /** 이번 요청에 쓴 양. 답이 온 뒤에 채워집니다. */
  usage?: LlmUsage;
}

/**
 * **쓴 양** — 제공사가 답에 실어 주는 값을 그대로 둡니다.
 *
 * 2026-09-19 에 붙였습니다. 여태 얼마를 쓰는지 아무 데도 안 남아서, 어디가 비싼지 알려면
 * 프롬프트 파일 크기를 세어 짐작하는 수밖에 없었습니다. **측정이 없으면 줄일 곳도 못 고릅니다.**
 *
 * 캐시 두 칸을 나눠 둡니다 — 쓸 때 1.25배, 읽을 때 0.1배라 셈이 전혀 다릅니다.
 * 합쳐 두면 「캐시가 실제로 먹고 있나」 를 볼 수가 없습니다.
 */
export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 너무 쌓이면 화면이 무거워집니다. 최근 것만 둡니다. */
const MAX_JOBS = 40;

/**
 * 목록을 파일(localStorage)에도 둡니다.
 *
 * 메모리에만 두었더니 앱을 껐다 켜면 통째로 비었습니다. 「어제 그 분석
 * 요청이 갔던가?」 를 확인할 방법이 없어져서, 같은 요청을 두 번 걸어
 * 돈을 두 번 내는 일이 생깁니다.
 *
 * 도는 중이던 것은 «끊김» 으로 되살립니다 — 응답 id 가 없으면 앱이 죽은 순간 그 답은 못 받는
 * 것입니다. id 가 있으면 서버가 답을 들고 있어 «이어 받는 중» 으로 되살립니다.
 * 정말 받을 일이 줄에 남아 있는지는 줄이 압니다(`taskQueue` 가 `abandonLlmResumes` 로 맞춥니다).
 */
const JOBS_KEY = "ai-video-storage.llm-activity.v1";

/** 앱이 닫혀 끊긴 요청에 적는 말. 이어 받다 만 것도 같은 말에 까닭을 덧붙입니다. */
const CUT_BY_CLOSE = "앱이 닫혀 결과를 받지 못했습니다.";

function restore(): LlmJob[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(JOBS_KEY) || "[]") as LlmJob[];
    if (!Array.isArray(saved)) return [];
    return saved.map((job) => {
      if (job.status !== "running" && job.status !== "resuming") return job;
      if (job.responseId) return { ...job, status: "resuming" as const, error: undefined };
      return { ...job, status: "failed" as const, error: CUT_BY_CLOSE };
    });
  } catch {
    return [];
  }
}

let jobs: LlmJob[] = restore();
const listeners = new Set<() => void>();

function publish(next: LlmJob[]) {
  jobs = next.slice(0, MAX_JOBS);
  try {
    window.localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  } catch {
    // 저장 못 해도 요청은 계속돼야 합니다.
  }
  listeners.forEach((listener) => listener());
}

function patchJob(id: string, patch: Partial<LlmJob>) {
  publish(jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)));
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

/**
 * 지금까지 API 를 몇 번 불렀는지 — 앱을 껐다 켜도 남는 숫자.
 *
 * 프로젝트 보드의 «AI 최적화 횟수» 칸이 읽습니다. 목록(jobs)은 세션 것만
 * 들고 있으므로 숫자만 따로 셉니다.
 */
const TOTAL_COUNT_KEY = "ai-video-storage.llm-total-count.v1";

export function totalLlmJobCount(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(TOTAL_COUNT_KEY)) || 0;
}

function bumpTotalCount() {
  try {
    window.localStorage.setItem(TOTAL_COUNT_KEY, String(totalLlmJobCount() + 1));
  } catch {
    // 저장 못 해도 요청은 계속돼야 합니다.
  }
}

/**
 * 요청을 시작했다고 남깁니다. 돌려주는 id 로 나중에 결과를 적습니다.
 *
 * **같은 일의 옛 실패 줄은 걷어냅니다.** 한도(429)에 튕긴 일은 줄이 잠시 뒤 같은 자리에 다시 세우는데,
 * 그때마다 새 줄이 생기고 옛 실패는 그대로 남아 「실패 12건」 이 쌓였습니다 — 다시 받아 끝난 일인데도
 * 화면은 작품이 실패한 것처럼 보였습니다. 이름이 같은 일의 실패는 이번 시도가 대신하므로 치웁니다.
 * 튕긴 줄은 토큰을 쓰지 않아 셈에서 잃는 것도 없습니다.
 *
 * `resumeId` 가 있으면 새로 보내는 것이 아니라 **앱이 닫히기 전에 보낸 답을 이어 받는** 것입니다 —
 * 그 요청의 줄(«이어 받는 중»)이 남아 있으면 그 줄을 그대로 씁니다. 새 줄을 만들면 한 요청이 두 줄로
 * 보이고, 횟수도 한 번 더 셉니다(값은 한 번만 냈습니다).
 */
export function startLlmJob(task: LlmTask, label?: string, resumeId?: string) {
  if (resumeId) {
    const cut = jobs.find((job) => job.responseId === resumeId && job.status === "resuming");
    if (cut) {
      patchJob(cut.id, {
        status: "running",
        resumed: true,
        task,
        label: label?.trim() || LLM_TASK_LABELS[task],
        error: undefined,
        finishedAt: undefined,
      });
      return cut.id;
    }
  }
  bumpTotalCount();
  const name = label?.trim() || LLM_TASK_LABELS[task];
  const job: LlmJob = {
    id: makeId(),
    task,
    label: name,
    status: "running",
    startedAt: Date.now(),
    ...(resumeId ? { responseId: resumeId, resumed: true } : {}),
  };
  publish([job, ...jobs.filter((old) => !(old.status === "failed" && old.label === name))]);
  return job.id;
}

export function finishLlmJob(id: string) {
  patchJob(id, { status: "done", finishedAt: Date.now() });
}

export function failLlmJob(id: string, error: unknown) {
  patchJob(id, {
    status: "failed",
    finishedAt: Date.now(),
    error: error instanceof Error ? error.message : String(error),
  });
}

/** 받은 값을 어디에 넣었는지 적습니다. 화면 밖으로 들어간 답을 찾아갈 단서입니다. */
export function noteLlmDelivery(id: string, delivered: string) {
  patchJob(id, { delivered });
}

/** 제공사 쪽 응답 id 가 생겼습니다. 이어 받을 수 있는 요청(작업 줄)만 적습니다 — 까닭은 `LlmJob.responseId`. */
export function noteLlmResponseId(id: string, responseId: string) {
  patchJob(id, { responseId });
}

/**
 * 이어 받으려 했는데 서버에 그 답이 없어 **처음부터 다시 보냅니다.** 같은 줄을 쓰되 «이어 받음» 표시는
 * 거둡니다 — 새 요청이라 값도 새로 냅니다.
 */
export function noteLlmResumeFallback(id: string) {
  bumpTotalCount();
  patchJob(id, { resumed: false, responseId: undefined, startedAt: Date.now() });
}

/**
 * «이어 받는 중» 인데 **받을 일이 줄에 없는** 줄을 끊김으로 적습니다. 작업 줄이 움직일 때마다 살아 있는
 * 일이 든 id 를 건네 옵니다(`taskQueue.reconcileResumes`) — 줄이 진실이고, 여기는 그것을 비출 뿐입니다.
 */
export function abandonLlmResumes(keep: Set<string>) {
  if (!jobs.some((job) => job.status === "resuming" && !(job.responseId && keep.has(job.responseId)))) return;
  publish(
    jobs.map((job) =>
      job.status === "resuming" && !(job.responseId && keep.has(job.responseId))
        ? { ...job, status: "failed" as const, finishedAt: Date.now(), error: `${CUT_BY_CLOSE} 이어 받을 일이 줄에 없습니다.` }
        : job,
    ),
  );
}

/**
 * 쓴 양을 그 요청에 적어 둡니다. Rust 가 `llm-usage` 로 쏘는 것을 받습니다.
 *
 * 실패한 요청에도 붙습니다 — **쓴 값은 이미 청구되므로** 기록에서 빠지면 안 됩니다.
 */
export function noteLlmUsage(id: string, usage: LlmUsage) {
  if (!id) return;
  patchJob(id, { usage });
}

/** 지금 목록에 남은 것들의 쓴 양 합계. 「이만큼 썼습니다」 한 줄에 씁니다. */
export function llmUsageTotals(list: LlmJob[]) {
  return list.reduce(
    (sum, job) => {
      const u = job.usage;
      if (!u) return sum;
      return {
        input: sum.input + u.inputTokens,
        output: sum.output + u.outputTokens,
        cacheRead: sum.cacheRead + u.cacheReadTokens,
        cacheWrite: sum.cacheWrite + u.cacheWriteTokens,
        cost: sum.cost + llmCostOf(u),
      };
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );
}

/** 끝난 것만 지웁니다. 도는 중·이어 받을 것은 남깁니다 — 지워도 요청은 계속 갑니다. */
export function clearFinishedLlmJobs() {
  publish(jobs.filter((job) => job.status === "running" || job.status === "resuming"));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const emptyServerSnapshot: LlmJob[] = [];

export function useLlmActivity() {
  return useSyncExternalStore(subscribe, () => jobs, () => emptyServerSnapshot);
}

/** 지금 목록 그대로 — 화면 밖(시험)에서 «앱을 켰을 때 무엇으로 되살아났나» 를 보는 데 씁니다. */
export function currentLlmJobs(): LlmJob[] {
  return jobs;
}


/*
  ── 쓴 양을 받아 적습니다 ──────────────────────────────────────────────
  Rust 가 답을 받자마자 `llm-usage` 로 쏩니다(`src-tauri/src/llm.rs`). 여기서 한 번만
  귀를 답니다 — 요청마다 달면 창을 여닫을 때 리스너가 쌓입니다.

  요청 id 로 짝을 맞춥니다. id 없이 간 요청(중지를 못 거는 자리)은 적을 데가 없어
  그냥 버립니다 — 그 자리를 위해 기록을 억지로 만들면 「어느 요청인지 모르는 줄」 이 쌓입니다.
*/
let usageHooked: Promise<void> | null = null;

export function hookLlmUsage(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!usageHooked) {
    usageHooked = import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<LlmUsage & { requestId: string }>("llm-usage", (event) => {
          const { requestId, ...usage } = event.payload ?? ({} as never);
          noteLlmUsage(requestId, usage);
        }),
      )
      .then(() => undefined)
      .catch(() => {
        usageHooked = null;
      });
  }
  return usageHooked;
}
