import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import GlobalNav from "@/components/GlobalNav";
import { WORK_WIDTH } from "@/lib/layout";
import { useT } from "@/lib/i18n";
import { stepFilled } from "@/lib/stepProgress";
import type { ProjectDraft } from "@/lib/projectTypes";
import SceneNavigation, { scenePanelId } from "./SceneNavigation";

export const PROJECT_STEPS = [
  { id: 1, label: "주제 설정", hint: "장르·스타일·시대. 이후 모든 프롬프트의 머리말이 됩니다" },
  { id: 2, label: "캐릭터", hint: "인물과 레퍼런스, 캐릭터 시트" },
  { id: 3, label: "씬 구성", hint: "장면과 컷 · 이 장면에 쓸 장소·에셋도 여기서" },
  { id: 4, label: "확인", hint: "스토리보드와 한눈에 보기" },
];


/** 전역 메뉴와 진행바를 같은 고정 띠로 묶습니다. 본문 부모의 overflow에는 기대지 않습니다. */
export default function ProjectProgress({ draft, step, maxStep, goStep, selectedSceneId, onSelectScene }: {
  draft: ProjectDraft;
  step: number;
  maxStep: number;
  goStep: (step: number) => void;
  selectedSceneId: string | null;
  onSelectScene: (id: string) => void;
}) {
  const t = useT();
  const header = useRef<HTMLDivElement>(null);
  const previousScene = useRef(selectedSceneId);
  const currentScene = useRef(selectedSceneId);
  currentScene.current = selectedSceneId;
  const headerHeight = useRef(0);
  const headerScale = useRef(1);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const measure = () => {
      const panel = currentScene.current ? document.getElementById(scenePanelId(currentScene.current)) : null;
      const wasAtStart = panel && headerHeight.current > 0 && Math.abs(panel.getBoundingClientRect().top - headerHeight.current - 12 * headerScale.current) < 3;
      const height = element.getBoundingClientRect().height;
      const scale = element.offsetHeight ? height / element.offsetHeight : 1;
      element.parentElement?.style.setProperty("--scene-scroll-offset", `${element.offsetHeight + 12}px`);
      // 창 폭·확대·번호 안내로 띠 높이가 달라져도 방금 맞춘 씬 머리줄을 가리지 않습니다.
      if (wasAtStart && Math.abs(height - headerHeight.current) > 1) window.scrollBy(0, panel.getBoundingClientRect().top - height - 12 * scale);
      headerHeight.current = height;
      headerScale.current = scale;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (step === 3 && selectedSceneId && previousScene.current && previousScene.current !== selectedSceneId) {
      const height = header.current?.offsetHeight;
      if (height !== undefined) header.current?.parentElement?.style.setProperty("--scene-scroll-offset", `${height + 12}px`);
      const element = header.current;
      const panel = document.getElementById(scenePanelId(selectedSceneId));
      if (element && panel) {
        const bounds = element.getBoundingClientRect();
        const scale = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
        window.scrollBy(0, panel.getBoundingClientRect().top - bounds.bottom - 12 * scale);
      }
    }
    previousScene.current = selectedSceneId;
  }, [selectedSceneId, step]);
  return (
    <div ref={header} data-project-header className="sticky top-0 z-40" style={{ background: "oklch(0.12 0.008 265 / 97%)", backdropFilter: "blur(8px)", borderBottom: "1px solid oklch(1 0 0 / 8%)" }}>
      <div className="min-w-0 overflow-x-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "oklch(0.50 0.10 290) oklch(1 0 0 / 4%)" }}>
        <div className="min-w-max"><GlobalNav /></div>
      </div>
      <div className={WORK_WIDTH}>
        <nav aria-label={t("프로젝트 진행")} className="min-w-0 space-y-2 py-3">
          {/*
            전역 프로그래스 바.

            **동그라미와 선이 서로 다른 것을 말합니다.**

            - 동그라미 — 그 단계를 «채웠는가». 인물이 하나도 없으면 안 칠합니다
            - 선       — 어디까지 «가 봤는가». 지나갔으면 칠합니다

            둘을 갈라 놓은 이유가 있습니다. 예전에는 동그라미도 위치만 보고
            칠했습니다. 그러니까 캐릭터를 건너뛰고 배경으로 가도 캐릭터가
            «완료» 로 보였어요. 지금은 «주제 설정은 찼고, 캐릭터는 건너뛰었고,
            지금 배경에 있다» 가 한눈에 읽힙니다.

            지나온 곳은 눌러 돌아갈 수 있고, 아직 안 간 곳도 눌러 건너뛸 수 있습니다.
          */}
          <div data-tour="project-progress" className="flex items-center gap-0">
            {PROJECT_STEPS.map((item, index) => {
              const filled = stepFilled(draft, item.id);
              const on = item.id === step;
              // 「다음」 을 눌러 지나간 단계. 되돌아와 있어도 남습니다.
              const walked = Boolean(draft.progress?.[String(item.id)]);
              // 지나온 구간. 되돌아와 있어도 선은 가 본 데까지 칠해 둡니다.
              const passed = item.id < maxStep || walked;
              const skipped = passed && !filled;
              /*
                지금 작업 중이면서 아직 「다음」 을 안 누른 단계는 **반만** 칠합니다.
                「작업 중이니까 프로그래스 바가 캐릭터 절반이 유지가 되어야하고」
              */
              const half = on && !walked;
              return (
                <div key={item.id} className="flex min-w-0 items-center" style={{ flex: index === PROJECT_STEPS.length - 1 ? "0 0 auto" : "1 1 0" }}>
                  <button
                    type="button"
                    onClick={() => goStep(item.id)}
                    title={`${t(item.hint)}${on ? ` · ${t("지금 여기")}` : filled ? ` · ${t("채웠습니다")}` : skipped ? ` · ${t("건너뛰었습니다")}` : ""}`}
                    className="flex shrink-0 flex-col items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:flex-row sm:gap-2"
                    aria-current={on ? "step" : undefined}
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full"
                      style={{
                        background: filled
                          ? "oklch(0.62 0.22 290)"
                          : half
                            ? "oklch(0.62 0.22 290 / 45%)"
                            : "oklch(1 0 0 / 7%)",
                        // 지금 있는 곳은 채웠든 아니든 테두리로 짚어 줍니다.
                        border: on
                          ? "2px solid oklch(0.80 0.18 290)"
                          : skipped
                            ? "2px dashed oklch(0.62 0.14 60 / 55%)"
                            : "2px solid transparent",
                      }}
                    >
                      {filled ? (
                        <Check className="h-3.5 w-3.5" style={{ color: "white" }} />
                      ) : (
                        // 건너뛴 곳은 빈 채로 둡니다. 체크를 흐리게 넣으면
                        // 「했나 안 했나」 가 도로 헷갈립니다.
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: skipped
                              ? "oklch(0.72 0.14 60)"
                              : on
                                ? "oklch(0.80 0.18 290)"
                                : "oklch(0.32 0.01 265)",
                          }}
                        />
                      )}
                    </span>
                    <span
                      className="whitespace-nowrap text-[10px] font-semibold sm:text-xs"
                      style={{
                        color: on
                          ? "white"
                          : filled
                            ? "oklch(0.78 0.10 290)"
                            : skipped
                              ? "oklch(0.72 0.12 60)"
                              : "oklch(0.50 0.01 265)",
                      }}
                    >
                      {t(item.label)}
                    </span>
                  </button>
                  {index < PROJECT_STEPS.length - 1 && (
                    <span
                      className="mx-1 h-px min-w-1 flex-1 sm:mx-3 sm:min-w-6"
                      style={{ background: passed ? "oklch(0.62 0.22 290 / 55%)" : "oklch(1 0 0 / 10%)" }}
                    />
                  )}
                </div>
              );
            })}

            {/*
              **«저장» 단추는 걷어냈습니다.** 맞습니다.
              `useAutoSave` 가 손을 멈추면 1.5초 뒤, 창을 가릴 때, 화면을 떠날 때 세 번
              **파일로** 씁니다(브라우저 저장소가 아니라). 단계를 넘길 때도 한 번 더 씁니다.
              누를 필요가 없는 단추가 있으면 «눌러야 저장되나» 하고 누르게 됩니다.
            */}
          </div>
          {step === 3 && <SceneNavigation scenes={draft.scenes} selectedId={selectedSceneId} onSelect={onSelectScene} />}
        </nav>
      </div>
    </div>
  );
}
