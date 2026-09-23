import { Check, Loader2, Play, Square } from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import {
  charactersToGenerate,
  cutsToGenerate,
  scenesToGenerate,
  startProjectGeneration,
} from "@/lib/batchRun";
import { stopProjectTasks, useTaskQueue } from "@/lib/taskQueue";
import type { ProjectDraft } from "@/lib/projectTypes";
import { useT } from "@/lib/i18n";

/**
 * **한 번에 뽑기 — 진행 상황.**
 *
 *
 *
 * # 고르기도 시작도 여기가 아닙니다
 *
 * 무엇으로 뽑을지(생성기·모델·해상도)는 **일괄 생성 창**이 들고 있고, 시작은 그 창의
 * 「만들기」 가 합니다. 켜는 자리와 고르는 자리가 갈려 있으면 켜 놓고 이 탭까지 갔다
 * 와야 하니 「한 번에」 가 아닙니다.
 *
 * 그래서 이 판이 주로 보여 주는 것은 **지금 어떻게 되어 가는가** 입니다 — 무엇이 남았고,
 * 무엇이 돌고 있고, 멈추려면 어디를 누르는가. 자세한 줄은 위쪽 «작업» 서랍에 있습니다.
 *
 * # «지금 뽑기» 하나는 남깁니다
 *
 * 고르기와 시작을 창으로 옮기고 나니, **이미 다 만들어 둔 작품을 다시 뽑을 길**이
 * 사라졌습니다 — 시나리오 없이 「만들기」 를 누를 수는 없으니까요. 사용자 2026-09-17
 * 「지금 뽑기 되살려」. 그래서 **이 초안 그대로** 줄에 세우는 단추만 하나 둡니다.
 * 무엇으로 뽑을지는 여전히 창에서 고른 값(`batchEngines` · `magnific`)을 씁니다 —
 * 고르는 자리가 둘이 되면 한쪽만 고치는 날이 옵니다(공통 규칙 1).
 */
export default function BatchGeneratePanel({
  projectId,
  draft,
}: {
  /** 프로젝트 id. 줄에 선 일이 어느 작품 것인지 이걸로 갈립니다. */
  projectId: string;
  draft: ProjectDraft;
}) {
  const t = useT();
  const tasks = useTaskQueue();
  const mine = tasks.filter(
    (task) => task.projectId === projectId && (task.status === "running" || task.status === "waiting"),
  );
  const running = mine.find((task) => task.status === "running");
  const done = tasks.filter((task) => task.projectId === projectId && task.status === "done").length;
  const failed = tasks.filter((task) => task.projectId === projectId && task.status === "failed").length;

  /** 아직 안 뽑힌 것들. 「만들기」 를 다시 누르면 이만큼이 줄에 섭니다. */
  const left =
    charactersToGenerate(draft).length +
    cutsToGenerate(draft).length +
    scenesToGenerate(draft).length * 2;

  const run = async () => {
    const ok = await confirmDialog({
      title: t("아직 안 뽑은 {count}개를 순서대로 뽑을까요?", { count: left }),
      description:
        t("인물 시트 → 컷 그림 → 스토리보드 → 씬 영상 차례로 돕니다. 이미 그림이 붙은 컷과 영상이 있는 장면은 건너뜁니다. 무엇으로 뽑을지는 주제 설정의 «AI 로 일괄 생성» 에서 고른 것을 씁니다."),
      confirmLabel: t("줄에 세우기"),
    });
    if (!ok) return;
    startProjectGeneration(projectId, draft);
  };

  return (
    <section
      data-tour="finish-batch"
      className="space-y-2 rounded-xl p-4"
      style={{ background: "oklch(0.145 0.009 265)", border: "1px solid oklch(0.62 0.22 290 / 22%)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="shrink-0 text-sm font-semibold">{t("한 번에 뽑기")}</p>
        <p className="min-w-0 flex-1 truncate text-[11px]" style={{ color: "oklch(0.48 0.01 265)" }}>
          {mine.length
            ? t("남은 일 {count}개", { count: mine.length })
            : left
              ? t("아직 안 뽑은 것 {count}개", { count: left })
              : t("이 작품에서 뽑을 것이 더 없습니다")}
        </p>
        {mine.length > 0 && (
          <button
            type="button"
            onClick={() => stopProjectTasks(projectId)}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.76 0.16 25)" }}
          >
            <Square className="h-3 w-3" /> {t("이 작품 것 모두 멈추기")}
          </button>
        )}
        {/*
          이미 만들어 둔 작품을 다시 뽑는 길. 뽑을 것이 없으면 안 보입니다 —
          눌러 봐야 「돌릴 것이 없습니다」 만 뜨는 단추는 자리만 차지합니다.
        */}
        {left > 0 && (
          <button
            type="button"
            onClick={() => void run()}
            title={t("이 초안 그대로 줄에 세웁니다. 무엇으로 뽑을지는 «AI 로 일괄 생성» 에서 고른 값을 씁니다")}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-semibold text-white gradient-primary"
          >
            <Play className="h-3 w-3" /> {t("지금 뽑기")}
          </button>
        )}
      </div>

      {mine.length > 0 ? (
        <p className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.72 0.14 290)" }}>
          <Loader2 className="h-3 w-3 animate-spin" />
          {running ? `${running.label}${running.step ? ` · ${running.step}` : ""}` : t("차례를 기다리는 중")}
        </p>
      ) : (
        done > 0 && (
          <p className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.72 0.14 160)" }}>
            <Check className="h-3 w-3" />
            {t("{count}개를 마쳤습니다", { count: done })}
            {failed ? ` · ${t("{count}개 실패(«작업» 서랍에서 다시 할 수 있습니다)", { count: failed })}` : ""}
          </p>
        )
      )}

      <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.44 0.01 265)" }}>
        <b>{t("인물 시트 → 컷 그림 → 스토리보드 → 씬 영상")}</b>{" "}
        {t("차례로 돕니다 — 앞 걸음에서 만든 그림이 다음 걸음의 레퍼런스가 됩니다. 생성 도구는 주제 설정의 «AI 로 일괄 생성» 에서 고릅니다. «넣고 이미지·영상까지 바로 뽑기» 를 켜면 만들기 한 번으로 여기까지 이어집니다. «지금 뽑기» 는 기존 작품을 같은 설정으로 다시 돌립니다. 진행 상황은 위쪽 «작업» 서랍에서 확인하세요.")}
      </p>
    </section>
  );
}
