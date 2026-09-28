import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { BookOpen, Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import { pageForLocation, startTutorial, useReportedTutorialPage, useTutorial } from "@/lib/tutorialStore";
import { FULL_TUTORIAL, tutorialsFor, type Tutorial } from "@/tutorials";

/**
 * «튜토리얼» 단추와 그 아래 펼쳐지는 목록. 위 띠에 하나, 구도잡기 창의 머리줄에 하나입니다.
 *
 * 두 묶음입니다 — «전체 따라하기» 하나, 그리고 **지금 화면의 기능**뿐.
 *
 *
 * 구도잡기 갈래 열한 개를 어느 화면에서든 늘 세워 두었다가 뺐습니다 — 창이 닫힌 채로 «방과 환경» 을
 * 누르면 걸음이 가리키는 자리가 하나도 없어 「이 단계의 자리가 지금 화면에 없습니다」 만 떴습니다
 * (). 이제 그 갈래는 **구도잡기 창이 열려 있을 때만**
 * 목록에 오릅니다 — 창이 열리는 동안 스스로 «지금 화면은 planner» 라고 알립니다.
 *
 * 설정에서 튜토리얼을 끄면 단추째 사라집니다 — 꺼 놓았는데 단추가 남아 있으면 «껐는데 왜 있나» 가 됩니다.
 *
 * 펼친 판은 body 로 내보냅니다. 위 띠에 backdrop-filter 가 걸려 있어 그 안의 fixed 는 띠 안에
 * 갇힙니다(`LlmActivityPanel` 이 먼저 겪은 일).
 */
const PANEL_WIDTH = 352;

export default function TutorialMenu() {
  const t = useT();
  const { enabled, seen, active } = useTutorial();
  const [location] = useLocation();
  const reported = useReportedTutorialPage();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  // 판은 body 로 내보내므로 단추가 어디 있든 스스로 자리를 재야 합니다. 위 띠와 구도잡기 창의
  // 머리줄 두 곳에서 쓰는데, 창은 화면 가운데 떠 있어 «띠 아래» 로 못 박아 두면 어긋납니다.
  const [top, setTop] = useState(48);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!enabled) return null;

  const page = pageForLocation(location, reported);
  const forPage = page ? tutorialsFor(page) : [];

  const toggle = () => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (box) {
      setLeft(Math.max(8, Math.min(box.left, window.innerWidth - PANEL_WIDTH - 8)));
      setTop(box.bottom + 6);
    }
    setOpen((value) => !value);
  };

  const pick = (id: string) => {
    setOpen(false);
    startTutorial(id);
  };

  const item = (tutorial: Tutorial) => {
    const running = active?.tutorialId === tutorial.id;
    return (
      <button
        key={tutorial.id}
        type="button"
        onClick={() => pick(tutorial.id)}
        className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
        style={running ? { background: "oklch(0.62 0.22 290 / 14%)" } : undefined}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white">
            {t(tutorial.title)}
            <span className="ml-1.5 font-normal" style={{ color: "oklch(0.50 0.01 265)" }}>
              {t("{count}걸음", { count: tutorial.steps.length })}
            </span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed" style={{ color: "oklch(0.55 0.01 265)" }}>
            {t(tutorial.summary)}
          </p>
        </div>
        {seen[tutorial.id] && (
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label={t("봤음")} style={{ color: "oklch(0.74 0.14 160)" }} />
        )}
      </button>
    );
  };

  const group = (title: string, tutorials: Tutorial[], empty?: string) => (
    <div>
      <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold tracking-wider" style={{ color: "oklch(0.60 0.15 290)" }}>
        {title}
      </p>
      {tutorials.length ? (
        tutorials.map(item)
      ) : (
        <p className="px-2.5 py-1.5 text-[10px]" style={{ color: "oklch(0.45 0.01 265)" }}>
          {empty}
        </p>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
        style={{
          background: active ? "oklch(0.62 0.22 290 / 18%)" : "oklch(1 0 0 / 5%)",
          color: active ? "oklch(0.84 0.16 290)" : "oklch(0.55 0.01 265)",
        }}
      >
        <BookOpen className="h-3 w-3" />
        {t("튜토리얼")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {/* 판 바깥을 누르면 닫힙니다. */}
            <button
              type="button"
              aria-label={t("튜토리얼 메뉴 닫기")}
              onClick={() => setOpen(false)}
              data-tutorial-layer=""
              className="fixed inset-0 z-[94] cursor-default"
              style={{ pointerEvents: "auto" }}
            />
            <div
              data-tutorial-layer=""
              className="fixed z-[95] max-h-[75vh] overflow-y-auto rounded-xl p-1.5 shadow-2xl"
              style={{
                top,
                left,
                width: `min(${PANEL_WIDTH}px, calc(100vw - 1rem))`,
                background: "oklch(0.14 0.01 265)",
                border: "1px solid oklch(1 0 0 / 12%)",
                // 구도잡기 창(Radix 모달)이 body 의 클릭을 꺼 두므로 판이 제 몫을 되살립니다.
                pointerEvents: "auto",
              }}
            >
              {group(t("전체 따라하기"), [FULL_TUTORIAL])}
              {group(
                page === "planner" ? t("구도잡기 기능") : t("이 페이지 기능"),
                forPage,
                t("이 화면의 튜토리얼이 없습니다"),
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
