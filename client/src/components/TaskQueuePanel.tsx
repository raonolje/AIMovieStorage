import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  ListTodo,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  clearFinishedTasks,
  stopAllTasks,
  countTasks,
  retryTask,
  stopTask,
  STALL_MS,
  useTaskQueue,
  type QueueTask,
} from "@/lib/taskQueue";

/**
 * **작업 판** — 오른쪽에서 열고 닫는 서랍.
 *
 *
 *
 * # 「멈춘 건지 진행 중인 건지」 에 답하는 법
 *
 * 돌고 있다는 표시(도는 동그라미)만으로는 답이 안 됩니다 — 죽은 요청도 똑같이 돕니다.
 * 그래서 **세 가지**를 함께 적습니다.
 *
 * 1. 지금 무엇을 하는 중인가 — 「2/3 상세와 장면」, 「이 컴퓨터가 5초를 뽑는 중」.
 * 2. 얼마나 지났는가 — 시작한 지 몇 분.
 * 3. **마지막 소식이 언제인가** — 여기가 핵심입니다. 일이 한 걸음 나아갈 때마다
 * 숨을 쉬고(`beat`), 5분 넘게 소식이 없으면 「소식 없음」 이라고 크게 적습니다.
 *
 * 끊지는 않습니다 — 영상 한 편이 20분 걸리는 일도 있습니다. 끊는 것은 사람이 정합니다.
 */

const TONE: Record<QueueTask["status"], { ko: string; color: string; back: string }> = {
  running: { ko: "진행 중", color: "oklch(0.84 0.16 290)", back: "oklch(0.62 0.22 290 / 18%)" },
  waiting: { ko: "대기 중", color: "oklch(0.74 0.13 60)", back: "oklch(0.74 0.13 60 / 14%)" },
  done: { ko: "끝남", color: "oklch(0.74 0.14 160)", back: "oklch(0.74 0.14 160 / 14%)" },
  failed: { ko: "실패", color: "oklch(0.78 0.16 25)", back: "oklch(0.78 0.16 25 / 16%)" },
  stopped: { ko: "멈춤", color: "oklch(0.60 0.01 265)", back: "oklch(1 0 0 / 6%)" },
};

/** 「3분 전」 처럼. 초 단위는 안 적습니다 — 1초마다 글자가 바뀌면 읽기가 어렵습니다. */
function ago(at: number | undefined, now: number): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

export default function TaskQueuePanel() {
  const tasks = useTaskQueue();
  const [open, setOpen] = useState(false);
  /*
    1초마다 다시 그립니다 — 「몇 분째」 와 「소식 없음」 은 시간이 흐르는 것 자체가 정보라,
    작업이 바뀔 때만 그리면 40분 동안 「0분」 으로 멈춰 있습니다. 판을 닫아 두면 쉽니다.
  */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const counts = countTasks(tasks, now);
  const live = tasks
    .filter((task) => task.status === "running" || task.status === "waiting")
    .sort((a, b) => (a.status === b.status ? a.queuedAt - b.queuedAt : a.status === "running" ? -1 : 1));
  const over = tasks
    .filter((task) => task.status !== "running" && task.status !== "waiting")
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="돌고 있는 일과 기다리는 일"
        data-tour="nav-tasks"
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
        style={{
          background: counts.running ? "oklch(0.62 0.22 290 / 18%)" : "oklch(1 0 0 / 5%)",
          color: counts.running ? "oklch(0.84 0.16 290)" : "oklch(0.55 0.01 265)",
        }}
      >
        {counts.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListTodo className="h-3 w-3" />}
        작업
        {counts.running + counts.waiting > 0 && (
          <span
            className="rounded-full px-1.5 text-[10px] font-bold"
            style={{ background: "oklch(0.62 0.22 290 / 30%)", color: "oklch(0.90 0.10 290)" }}
          >
            {counts.running + counts.waiting}
          </span>
        )}
        {/* 소식이 끊긴 일이 있으면 단추에서부터 눈에 띄어야 합니다. */}
        {counts.stalled > 0 && <AlertTriangle className="h-3 w-3" style={{ color: "oklch(0.78 0.16 60)" }} />}
      </button>

      {/*
        ── 서랍은 **본문 바깥**에 그립니다 ─────────────────────────────────
        

        이 단추는 위쪽 띠(`GlobalNav`) 안에 삽니다. 그 띠가 `sticky … z-40` 이라 **제
        쌓임 맥락**을 만드는데, 그 안에서는 `fixed` 도 `z-50` 도 그 층 안에서만 셉니다 —
        단계 표시의 동그라미가 서랍을 뚫고 올라오던 까닭입니다. 높이도 띠 안에 갇혀
        눌렸습니다. `body` 로 내보내면 둘 다 풀립니다.
      */}
      {open && createPortal(
        <>
          {/* 판 바깥을 누르면 닫힙니다. 작업을 보다가 화면으로 돌아가는 길입니다. */}
          <button
            type="button"
            aria-label="작업 판 닫기"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[90] cursor-default"
            style={{ background: "oklch(0 0 0 / 35%)" }}
          />
          <aside
            className="fixed right-0 top-0 z-[91] flex h-screen w-[30rem] max-w-[92vw] flex-col"
            style={{ background: "oklch(0.13 0.009 265)", borderLeft: "1px solid oklch(1 0 0 / 10%)" }}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "oklch(0.88 0.01 265)" }}>
                  작업
                </p>
                <p className="truncate text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
                  진행 {counts.running} · 대기 {counts.waiting}
                  {counts.failed ? ` · 실패 ${counts.failed}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-md p-1.5 hover:bg-white/10"
                style={{ color: "oklch(0.62 0.01 265)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="composition-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
              {!live.length && !over.length && (
                <p className="px-1 py-6 text-center text-[11px]" style={{ color: "oklch(0.44 0.01 265)" }}>
                  돌고 있는 일이 없습니다.
                </p>
              )}

              {/*
                남은 일이 여럿이면 **한 번에 멈출 길**을 줍니다. 일괄 생성은 카드 수만큼 일을 세우므로
                하나씩 누르는 것은 사실상 멈출 수 없는 것과 같습니다.
              */}
              {live.length > 1 && (
                <div className="flex items-center gap-2 px-1 pb-1">
                  <p className="text-[10px] font-semibold" style={{ color: "oklch(0.50 0.01 265)" }}>
                    남은 일 {live.length}
                  </p>
                  <span className="h-px flex-1" style={{ background: "oklch(1 0 0 / 8%)" }} />
                  <button
                    type="button"
                    onClick={stopAllTasks}
                    title="대기·진행 중인 일을 전부 멈춥니다. 끝난 일은 그대로 남습니다"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                    style={{ color: "oklch(0.70 0.14 25)" }}
                  >
                    <X className="h-3 w-3" /> 모두 취소
                  </button>
                </div>
              )}
              {live.map((task) => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}

              {over.length > 0 && (
                <div className="flex items-center gap-2 px-1 pt-3">
                  <p className="text-[10px] font-semibold" style={{ color: "oklch(0.50 0.01 265)" }}>
                    끝난 일
                  </p>
                  <span className="h-px flex-1" style={{ background: "oklch(1 0 0 / 8%)" }} />
                  <button
                    type="button"
                    onClick={clearFinishedTasks}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                    style={{ color: "oklch(0.50 0.01 265)" }}
                  >
                    <Trash2 className="h-3 w-3" /> 비우기
                  </button>
                </div>
              )}
              {over.map((task) => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}
            </div>

            {/*
              한 줄로 줄였습니다. 설명이 석 줄을 먹으면 정작 작업 목록이
              그만큼 좁아집니다. (별표가 그대로 찍히던 것도 여기였습니다. JSX 는 마크다운이
              아니라 `**굵게**` 가 글자 그대로 나옵니다.)
            */}
            <p
              className="shrink-0 px-4 py-2 text-[10px]"
              style={{ borderTop: "1px solid oklch(1 0 0 / 8%)", color: "oklch(0.44 0.01 265)" }}
            >
              줄마다 하나씩 · 앱을 껐다 켜도 이어집니다
            </p>
          </aside>
        </>,
        document.body,
      )}
    </>
  );
}

function TaskRow({ task, now }: { task: QueueTask; now: number }) {
  const tone = TONE[task.status];
  const since = task.startedAt ?? task.queuedAt;
  /*
    소식이 끊긴 지 오래됐는가. 이것이 사용자가 물은 「멈춘 건지 진행 중인 건지」 에 답하는
    자리입니다 — 도는 동그라미는 죽은 요청 위에서도 똑같이 돕니다.
  */
  const stalled = task.status === "running" && now - (task.beatAt ?? since) > STALL_MS;

  return (
    <div
      className="space-y-1.5 rounded-lg px-3 py-2.5"
      style={{
        background: "oklch(0.155 0.009 265)",
        border: `1px solid ${stalled ? "oklch(0.78 0.16 60 / 45%)" : "oklch(1 0 0 / 8%)"}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: tone.back, color: tone.color }}
        >
          {task.status === "running" ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : task.status === "waiting" ? (
            <Clock className="h-2.5 w-2.5" />
          ) : task.status === "done" ? (
            <Check className="h-2.5 w-2.5" />
          ) : null}
          {tone.ko}
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: "oklch(0.86 0.01 265)" }}>
          {task.label}
        </p>
        {(task.status === "waiting" || task.status === "running") && (
          <button
            type="button"
            onClick={() => stopTask(task.id)}
            title="이 일을 멈춥니다"
            className="shrink-0 rounded p-1 hover:bg-white/10"
            style={{ color: "oklch(0.70 0.14 25)" }}
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        {(task.status === "failed" || task.status === "stopped") && (
          <button
            type="button"
            onClick={() => retryTask(task.id)}
            title="다시 줄에 세웁니다"
            className="shrink-0 rounded p-1 hover:bg-white/10"
            style={{ color: "oklch(0.74 0.13 200)" }}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* 어느 작품의 일인가 — 여러 프로젝트를 한 줄에 세우므로 이것이 없으면 못 알아봅니다. */}
      <p className="truncate text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
        {task.projectTitle}
        {task.step ? ` · ${task.step}` : ""}
      </p>

      {task.status === "running" && (
        <>
          {task.progress !== undefined && (
            <div className="h-1 overflow-hidden rounded-full" style={{ background: "oklch(1 0 0 / 8%)" }}>
              <span
                className="block h-full rounded-full transition-[width]"
                style={{
                  width: `${Math.round(Math.max(0, Math.min(1, task.progress)) * 100)}%`,
                  background: "oklch(0.70 0.20 290)",
                }}
              />
            </div>
          )}
          <p
            className="text-[10px]"
            style={{ color: stalled ? "oklch(0.80 0.16 60)" : "oklch(0.46 0.01 265)" }}
          >
            {task.progress !== undefined ? `${Math.round(task.progress * 100)}% · ` : ""}
            {ago(since, now)}째
            {stalled
              ? ` · 소식 없음 ${ago(task.beatAt ?? since, now)} — 멈췄을 수 있습니다`
              : task.beatAt
                ? ` · 마지막 소식 ${ago(task.beatAt, now)} 전`
                : ""}
          </p>
        </>
      )}

      {task.status === "waiting" && (
        <p className="text-[10px]" style={{ color: "oklch(0.46 0.01 265)" }}>
          앞의 일이 끝나면 시작합니다 · 기다린 지 {ago(task.queuedAt, now)}
        </p>
      )}

      {task.error && (
        <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.76 0.15 25)" }}>
          {task.error}
        </p>
      )}
    </div>
  );
}
