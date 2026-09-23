import { videoClipLimitOf } from "@/lib/modelRules";
import { toast } from "sonner";
import { cancelLlmJob, isLlmCancel, requestJsonFromLlm } from "@/lib/promptRequest";
import { getLocalProject } from "@/lib/localProjectStore";
import { assetSrc } from "@/lib/mediaLibrary";
import { refTag } from "@/lib/bootstrapStore";
import {
  enqueueTask,
  isStopping,
  llmResumeStepOf,
  projectIdOfTask,
  registerTaskRunner,
  stopTask,
  withResumableLlm,
} from "@/lib/taskQueue";
import { deliver, onBootstrapAdopted, patchRun, runOf } from "@/lib/bootstrapStore";
// 4단계(카드마다 프롬프트 쓰기)는 제 파일에 — 불러오는 것만으로 러너와 «부은 뒤» 훅이 걸립니다.
import { stopBootstrapPrompts } from "@/lib/bootstrapPrompts";
import {
  detailsFromOutline,
  hasBootstrapContent,
  parseBootstrapDetails,
  parseBootstrapOutline,
  parseBootstrapShots,
  type BootstrapOutline,
  type BootstrapResult,
} from "@/lib/projectBootstrap";

/**
 * **AI 일괄 생성 돌리기** — 줄에 세우고, 세 왕복을 돌고, 끝나면 살림에 넘깁니다.
 *
 * # 왜 살림(`bootstrapStore.ts`)과 갈랐는가
 *
 * 한 파일이 687줄이 되어 두 가지 일이 섞여 있었습니다 — «무엇을 들고 있고 어디에
 * 붓는가»(살림) 와 «LLM 을 세 번 부르는 절차»(돌리기). 절차를 고치다 저장 규칙을
 * 건드리고, 저장 규칙을 고치다 절차 사이에 낀 patch 를 놓치는 일이 생겨 사용자가
 * 리팩터링을 지시했습니다(2026-09-18). 옮기기만 했고 동작은 그대로입니다.
 *
 * 방향은 한쪽뿐입니다: **돌리기가 살림을 씁니다.** 살림은 돌리기를 모릅니다(순환 금지).
 * 창(`ProjectBootstrapDialog`)은 «만들기·중지» 만 여기서, 나머지는 살림에서 가져갑니다.
 *
 * 이 모듈은 불러오는 것만으로 러너를 답니다 — `main.tsx` 가 앱을 켤 때 통째로 import 하는
 * 까닭입니다. 화면을 열어야 등록되게 두면 앞서 줄에 섰던 일이 이어지지 않습니다.
 */

/** 돌고 있는 요청의 id — 「중지」 가 이걸로 끊습니다. 저장할 값이 아니라 살림 밖에 따로 둡니다. */
const jobs = new Map<string, string>();

/*
  새 프로젝트가 처음 저장되어 열쇠가 바뀌면 돌고 있던 요청 id 도 따라가야 합니다 —
  안 옮기면 «중지» 가 옛 열쇠로 찾다 못 끊습니다. 맵은 여기 있고 열쇠를 바꾸는 쪽은
  살림이라, 살림이 부르는 훅으로 겁니다(까닭은 `bootstrapStore.onBootstrapAdopted`).
*/
onBootstrapAdopted((from, to) => {
  const job = jobs.get(from);
  if (job) {
    jobs.delete(from);
    jobs.set(to, job);
  }
});

export interface BootstrapStartOptions {
  /** 「덧붙이기」 일 때 이미 있는 이름 — 알려 주지 않으면 같은 인물을 한 번 더 만듭니다. */
  existing: { characters: string[]; backgrounds: string[] };
  /** 작품 설정 요약(`summarizeProjectContext(draft).facts`). */
  project: unknown;
  /** 1단계를 건너뛰고 받아 둔 작품 정보로 2단계만 다시 — 2단계만 실패했을 때. */
  detailsOnly?: boolean;
  /** 화면에 적어 줄 프로젝트 이름. 알림에서 「어느 프로젝트가」 를 말합니다. */
  label?: string;
  /**
   * 넣은 뒤 **4단계 — 카드마다 프롬프트를 LLM 으로 따로 쓸까.** 안 주면 씁니다.
   *
   * 3단계 한 답으로는 컷마다 한 문단이 고작이라, 카드 단추와 같은
   * 요청을 카드마다 보냅니다(`bootstrapPrompts.ts`). 살림의 `input.richPrompts` 에 적어 두고 붓는
   * 쪽이 읽습니다 — 이 값이 그때의 진실입니다.
   */
  richPrompts?: boolean;
  /**
   * 작품에 고른 영상 모델(`draft.magnific.videoModel`). 2단계가 **컷 길이의 상한**을 이걸로 압니다 —
   * 씨댄쓰 2.5 는 30초, 미니맥스 H3 는 15초().
   */
  videoModel?: string;
}

export const BOOTSTRAP_TASK = "bootstrap";

interface BootstrapPayload {
  project: string;
  options: BootstrapStartOptions;
}

/**
 * **줄에 세웁니다.** 실제로 도는 것은 `taskQueue` 입니다.
 *
 * ,
 * 「앱을 다시 켜면 하던 작업이 연결되어서 진행될 수 있어야 해」.
 *
 * 여기서 직접 `await` 로 돌리면 그 둘이 안 됩니다 — 줄에 선 것을 볼 수 없고, 앱이 꺼지면
 * 남은 일이 통째로 사라집니다. 줄에 세워 두면 재료(`payload`)가 파일에 남아, 앱을 다시
 * 켰을 때 그대로 이어집니다.
 */
export function startBootstrap(project: string, options: BootstrapStartOptions) {
  const current = runOf(project);
  if (current.stage !== 0 || current.queued) return;
  if (!current.input.source.trim()) {
    toast.error("시나리오나 설정을 먼저 붙여넣어 주세요.");
    return;
  }
  if (options.detailsOnly && !current.outline) return;

  const id = enqueueTask({
    lane: "llm",
    kind: BOOTSTRAP_TASK,
    projectId: project,
    projectTitle: options.label || getLocalProject(project)?.title || "새 프로젝트",
    label: options.detailsOnly ? "AI 일괄 생성 · 상세만 다시 만들기" : "AI 일괄 생성 · 글과 구도",
    // 한 프로젝트에 둘을 세우지 않습니다 — 「만들기」 를 두 번 눌러도 한 번만 돕니다.
    dedupe: `${project}:bootstrap`,
    payload: { project, options } satisfies BootstrapPayload,
  });
  if (!id) {
    toast.message("이미 줄에 서 있습니다.", { description: "위쪽 «작업» 단추에서 차례를 볼 수 있습니다." });
    return;
  }
  patchRun(project, (current) => ({
    queued: true,
    taskId: id,
    result: null,
    appliedAt: null,
    held: null,
    error: null,
    // 4단계를 할지는 만들기를 누른 순간의 선택 — 붓는 쪽(`deliver`)이 이 값을 읽습니다.
    input: { ...current.input, richPrompts: options.richPrompts !== false },
  }));
}

/** 멈춥니다 — 줄에서 빼고, 이미 건 요청이 있으면 그것도 끊습니다. 4단계가 돌고 있으면 그것도 같이. */
export async function stopBootstrap(project: string) {
  const run = runOf(project);
  if (run.taskId) stopTask(run.taskId);
  const id = jobs.get(project);
  if (id) await cancelLlmJob(id);
  await stopBootstrapPrompts(project);
}

registerTaskRunner(BOOTSTRAP_TASK, async (raw, report, task) => {
  const { project, options } = raw as BootstrapPayload;
  await runBootstrap(project, options, report, task.id);
});

/**
 * 세 왕복을 차례로 돕니다.
 *
 * 진행은 두 군데에 적습니다 — 살림(창이 읽는 것)과 작업 줄(옆 판이 읽는 것). 줄 쪽에는
 * **몇 프로인지**도 함께 적습니다.
 */
async function runBootstrap(
  project: string,
  options: BootstrapStartOptions,
  report: (change: { progress?: number; step?: string }) => void,
  taskId: string,
) {
  /*
    열쇠는 **줄에서 그때그때** 읽습니다. 저장 전 프로젝트는 «새 프로젝트» 로 줄에 서는데, 도는 사이 제목을
    적으면 첫 자동 저장이 id 를 만들고 `adoptBootstrapRun` 이 살림과 줄을 새 열쇠로 옮깁니다(`retargetTasks`).
    손에 든 `project` 는 시작할 때의 사본이라 그대로 쓰면 옛 열쇠에 진행을 적고 옛 열쇠로 부어, 답이 주인 없는
    자리에 떨어집니다(2026-09-22 검토 — 4단계에서 실제로 났고, 세 왕복도 같은 모양입니다).
  */
  const key = () => projectIdOfTask(taskId) ?? project;
  const current = runOf(key());
  const { input } = current;
  const number = (value: string) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 30) : 0;
  };
  const wanted = {
    characters: number(input.counts.characters),
    backgrounds: number(input.counts.backgrounds),
    scenes: number(input.counts.scenes),
  };
  const where = options.label ? ` — ${options.label}` : "";
  /*
    올린 것들. **그림만 모델에게 보여 줍니다** — 영상은 API 로 못 올리니 「무엇을 참조할지」
    적은 말로 대신합니다. 그 말과 경로는 아래 `data.refs` 로 실려 갑니다.
  */
  const refs = input.refs ?? [];
  /*
    **경로가 아니라 주소**를 넘깁니다. 「Failed to fetch」 가 0초에 났습니다. `D:\…\안경.png` 같은 파일 경로를 그대로 줬는데,
    그림을 싣는 쪽은 그것을 `fetch` 합니다. 파일 경로는 주소가 아니라 즉시 죽습니다.
    그림을 안 올린 프로젝트에서는 목록이 비어 아무 일도 없었고, 그래서 어떤 작품은 되고
    어떤 작품은 안 됐습니다.
  */
  /*
    **주소를 못 만든 그림은 목록에서 통째로 뺍니다.**

    2026-09-18 시험에서 찾았습니다 — 예전에는 주소를 만든 뒤(`map`) 빈 것을 걸러서
    (`filter`), 주소가 없는 그림 하나가 **이름표 번호만 차지하고 실제로는 안 붙었습니다.**
    그러면 「ref_img_2」 라고 적은 것이 세 번째 그림을 가리키게 됩니다.
    이름표와 붙는 차례가 어긋나면 이름표는 없느니만 못합니다.
  */
  const usable = refs.filter((item) => item.kind !== "image" || Boolean(assetSrc(item.path)));
  const refImages = usable
    .filter((item) => item.kind === "image")
    .map((item) => assetSrc(item.path));
  /*
    **이름표를 함께 보냅니다**(`ref_img_1` · `ref_mov_2`).

     파일을 여러 장 올리면 「캐릭터는 어떤 그림, 동작은 어떤 영상」 을
    가리킬 말이 필요합니다. 파일 이름은 한글·공백·확장자가 섞여 LLM 이 자주 놓칩니다.

    **그림은 보내는 순서와 번호가 같아야 합니다** — 「ref_img_2」 라고 적었는데 두 번째로
    붙은 그림이 다른 것이면 아무 소용이 없습니다. 그래서 아래 `refImages` 와 같은 차례로
    셉니다(둘 다 `refs` 의 차례를 그대로 따릅니다).
  */
  const refNotes = usable.map((item) => ({
    이름표: refTag(usable, item.id),
    이름: item.name,
    종류: item.kind === "video" ? "영상" : "그림",
    "이렇게 쓰세요": item.note || "참고 자료",
  }));

  const at = (stage: 0 | 1 | 2 | 3, progress: number, step: string) => {
    patchRun(key(), () => ({ stage, queued: false }));
    report({ progress, step });
  };
  at(options.detailsOnly ? 2 : 1, 0.05, options.detailsOnly ? "2/3 상세와 장면" : "1/3 인물과 장소");

  const started = (id: string) => {
    jobs.set(key(), id);
  };
  /*
    ── 앱이 닫혔다 켜져 다시 도는 길 ──────────────────────────────────────
    

    닫힐 때 **어느 왕복이 가고 있었는지** 줄이 압니다(`llmResumeStep`). 그 앞 왕복은 이미 답을 받아 살림에
    적어 둔 것이라 다시 보내지 않습니다 — 값을 치른 답을 두 번 사지 않습니다. 가고 있던 왕복은
    `withResumableLlm` 이 보내지 않고 묻기만 합니다. 앞 왕복을 어쩔 수 없이 다시 보내면(살림이 비어 있을 때)
    그 순간 줄의 열쇠가 지워져 뒤 왕복도 새로 갑니다 — 옛 목록으로 만든 상세를 새 목록에 붙이면 안 됩니다.
  */
  const ROUNDS = ["outline", "details", "shots"] as const;
  const reached = ROUNDS.indexOf(llmResumeStepOf(taskId) as (typeof ROUNDS)[number]);
  const alreadyGot = (round: (typeof ROUNDS)[number]) => reached > ROUNDS.indexOf(round);

  /** 이번 왕복에서 손에 쥔 작품 정보. 2단계가 죽어도 이것만은 남깁니다. */
  let head: BootstrapOutline | null = options.detailsOnly || alreadyGot("outline") ? current.outline : null;

  try {
    if (!head) {
      head = parseBootstrapOutline(
        await withResumableLlm(taskId, "outline", (llm) =>
          requestJsonFromLlm<unknown>({
            ...llm,
            task: "projectBootstrap",
            template: "project-bootstrap",
            label: `AI 일괄 생성 · 1/3 작품과 목록${where}`,
            deliveredTo: "주제 설정 · 일괄 생성 미리보기",
            data: {
              source: input.source.trim(),
              hint: input.hint.trim(),
              counts: wanted,
              existing: input.mode === "append" ? options.existing : { characters: [], backgrounds: [] },
              project: options.project,
              refs: refNotes,
            },
            images: refImages,
            onStarted: started,
          }),
        ),
      );
      patchRun(key(), () => ({ outline: head }));
    }
    if (isStopping(taskId)) return;

    at(2, 0.35, "2/3 상세와 장면");
    const details =
      alreadyGot("details") && current.result?.details
        ? current.result.details
        : parseBootstrapDetails(
            await withResumableLlm(taskId, "details", (llm) =>
              requestJsonFromLlm<unknown>({
                ...llm,
                task: "projectDetails",
                template: "project-details",
                label: `AI 일괄 생성 · 2/3 상세와 씬${where}`,
                deliveredTo: "주제 설정 · 일괄 생성 미리보기",
                /*
                  인물 여럿과 씬 목록이 **한 답에** 들어갑니다. 4096 이면 중간에서 잘리고,
                  8192 도 17쪽짜리 대본에서는 모자랐습니다. 한국어는 같은 내용에 토큰이 더 듭니다.
                  그래도 잘리면 `parseJsonResponse` 가 받은 데까지 건져 냅니다.
                */
                // 2026-09-22 부터 `project-details.md` 가 인물·장소마다 외형 **60~120 어절**을 요구합니다 — 인물 여섯에
                // 장소 넷이면 그것만으로 16384 가 차서 씬·컷이 잘렸습니다. 한 단 더 올립니다.
                maxTokens: 24576,
                // 길게 받기로 했으면 시간도 같이 늘려야 합니다 — 180초로는 끝까지 오지 못합니다. 토큰과 같은 비율로.
                timeoutSecs: 630,
                data: {
                  outline: head,
                  source: input.source.trim(),
                  counts: wanted,
                  project: options.project,
                  refs: refNotes,
                  // 컷 한 토막의 상한 — 모델을 모르면 null(문구가 10초로 봅니다).
                  videoModel: videoClipLimitOf(options.videoModel),
                },
                images: refImages,
                onStarted: started,
              }),
            ),
          );

    const made: BootstrapResult = { outline: head, details };
    if (!hasBootstrapContent(made)) {
      throw new Error("받은 답이 비어 있습니다. 시나리오를 조금 더 자세히 적고 다시 해 보세요.");
    }
    patchRun(key(), () => ({ result: made, doneAt: Date.now() }));
    if (isStopping(taskId)) return;

    /*
      ── 3단계 — 구도와 키컷 프롬프트 ──────────────────────────────────
      여기서 죽어도 2단계는 살려 둡니다. 씬·컷은 이미 값을 치렀고, 구도와 프롬프트는
      나중에 컷마다 따로 받을 수도 있습니다.
    */
    at(3, 0.7, "3/3 컷마다 구도와 프롬프트");
    try {
      const shots = parseBootstrapShots(
        await withResumableLlm(taskId, "shots", (llm) =>
          requestJsonFromLlm<unknown>({
            ...llm,
            task: "projectDetails",
            template: "project-shots",
            label: `AI 일괄 생성 · 3/3 구도와 키컷${where}`,
            deliveredTo: "주제 설정 · 컷마다 구도와 프롬프트",
            // 컷마다 프롬프트 두 벌이라 2단계보다 더 깁니다. 여기서 잘려도
            // `parseJsonResponse` 가 받은 컷까지는 건집니다 — 나머지는 컷 카드에서 따로.
            maxTokens: 20480,
            timeoutSecs: 600,
            data: {
              outline: head,
              scenes: details.scenes,
              project: options.project,
              refs: refNotes,
              /*
                4단계(카드마다 프롬프트 다시 쓰기)를 할지 — 문구가 `::when richPrompts=yes` 로 가릅니다. 4단계가
                뒤따르면 여기 두 칸은 «초안» 이라 짧게 쓰고 예산을 구도 칸에 쓰고, 안 따르면 이 답이 마지막이라
                여기서 채워야 합니다. ::when 은 문자열 완전일치라 "yes"/"no" 로 보냅니다(`llmRequestText.ts`).
              */
              richPrompts: options.richPrompts !== false ? "yes" : "no",
            },
            images: refImages,
            onStarted: started,
          }),
        ),
      );
      patchRun(key(), () => ({ result: { ...made, shots }, doneAt: Date.now() }));
      // 「들어갔습니다」 알림은 붓는 쪽(`deliver`)이 합니다 — 여기서 또 띄우면 두 번 울립니다.
    } catch (error) {
      if (isLlmCancel(error)) toast.message("구도 만들기를 중지했습니다.");
      else
        toast.error(String(error), {
          description: "씬·컷은 받아 두었습니다. 구도와 프롬프트는 컷 카드에서 따로 받을 수 있습니다.",
          duration: 12000,
        });
    }
  } catch (error) {
    /*
      **1단계 목록은 버리지 않습니다.**

      2단계가 죽어도 1단계는 이미 「누가 나오고 어디가 나오는가」 를 알고 있습니다. 예전에는
      그것을 통째로 버리고 빈 목록을 부어서, 화면에는 «주제 설정» 만 채워졌습니다
      (). 값은 이미 치른 답입니다.
      카드만 세워 두면 나머지는 카드마다 있는 「특징 정하기」 로 채울 수 있습니다.
    */
    if (head)
      patchRun(key(), () => ({
        result: { outline: head!, details: detailsFromOutline(head!) },
        doneAt: Date.now(),
      }));
    if (isLlmCancel(error)) {
      toast.message(`일괄 생성을 중지했습니다${where}.`);
      return;
    }
    patchRun(key(), () => ({ error: String(error) }));
    /*
      **무엇이 안 들어갔는지 분명히 말합니다.** 예전에는 「초안에 들어갔습니다」 만 뜨고
      캐릭터·씬이 비어 있어서, 사람은 그것이 정상인 줄 알았습니다.
    */
    toast.error("상세와 씬을 받지 못했습니다.", {
      description: head
        ? "인물·장소 카드는 이름만이라도 세워 두었습니다. 창의 «상세만 다시 만들기» 를 눌러 보세요."
        : "시나리오를 조금 더 자세히 적고 다시 해 보세요.",
      duration: 15000,
    });
    // 줄에도 실패로 남깁니다 — 「왜 안 됐지」 를 옆 판에서 바로 볼 수 있어야 합니다.
    throw error;
  } finally {
    jobs.delete(key());
    patchRun(key(), () => ({ stage: 0, queued: false }));
    report({ progress: 0.95, step: "초안에 넣는 중" });
    /*
      다 돌고 나서 **붓습니다.** 3단계가 죽어 2단계까지만 받은 답도 여기로 옵니다 —
      씬·컷은 이미 값을 치른 것이라 버릴 이유가 없습니다.

      다만 **사람이 멈췄으면 4단계는 세우지 않습니다.** 3단계에서 중지를 눌렀는데도 붓기가
      카드마다 프롬프트 요청을 백 개 넘게 세워, 멈춘 사람이 다시 백 번을 멈춰야 했습니다.
      받아 둔 답은 그대로 붓되(값은 이미 치렀습니다) 새 요청만 막습니다.
    */
    if (isStopping(taskId)) {
      patchRun(key(), (current) => ({ input: { ...current.input, richPrompts: false } }));
    }
    deliver(key(), true);
  }
}
