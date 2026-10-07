import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Scene } from "@/lib/projectTypes";
import { useT } from "@/lib/i18n";
import { sceneAtNumber, sceneTabIndex } from "@/lib/sceneEditorState";
import { scenePageBounds, scenePageForIndex } from "@/lib/sceneNavigationPages";

export function sceneTabId(id: string) { return `scene-tab-${id}`; }
export function scenePanelId(id: string) { return `scene-panel-${id}`; }

export default function SceneNavigation({ scenes, selectedId, onSelect }: {
  scenes: readonly Pick<Scene, "id" | "title">[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const inputId = useId();
  const errorId = useId();
  const index = scenes.findIndex(scene => scene.id === selectedId);
  const [number, setNumber] = useState("");
  const [error, setError] = useState(false);
  const [page, setPage] = useState(() => scenePageForIndex(index));
  const pendingFocus = useRef<string | null>(null);
  const range = scenePageBounds(scenes.length, page);
  const selectedVisible = index >= range.start && index < range.end;

  useEffect(() => {
    setNumber(index >= 0 ? String(index + 1) : "");
    setError(false);
    // 복원·추가·삭제·재정렬로 선택 위치가 바뀔 때만 해당 묶음을 자동으로 보여 줍니다.
    setPage(scenePageForIndex(index));
  }, [selectedId, index]);
  useEffect(() => { setPage(current => scenePageBounds(scenes.length, current).page); }, [scenes.length]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = document.getElementById(sceneTabId(pendingFocus.current));
    if (!target) return;
    target.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [range.page, selectedId, scenes]);

  const selectIndex = (next: number, focus = false) => {
    const id = scenes[next]?.id;
    if (!id) return;
    if (focus) pendingFocus.current = id;
    setPage(scenePageForIndex(next));
    onSelect(id);
  };
  const jump = () => {
    const id = sceneAtNumber(scenes, number);
    setError(!id);
    if (id) selectIndex(scenes.findIndex(scene => scene.id === id));
  };
  const arrowStyle = { background: "oklch(0.62 0.22 290 / 14%)", color: "oklch(0.84 0.16 290)", border: "1px solid oklch(0.62 0.22 290 / 24%)" };
  const arrowClass = "flex h-7 w-6 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-30";
  return (
    <div data-tour="scene-navigation" className="min-w-0 border-t pt-2" style={{ borderColor: "oklch(0.62 0.22 290 / 20%)" }}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
        <form onSubmit={event => { event.preventDefault(); jump(); }} noValidate className="flex shrink-0 items-center gap-1.5">
          <label htmlFor={inputId} className="text-[11px] font-semibold" style={{ color: "oklch(0.78 0.10 290)" }}>{t("씬 번호")}</label>
          <input id={inputId} type="number" inputMode="numeric" min={1} max={scenes.length || undefined} step={1}
            value={number} disabled={!scenes.length} onChange={event => { setNumber(event.target.value); setError(false); }}
            aria-invalid={error} aria-describedby={error ? errorId : undefined}
            className="h-7 w-16 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
            style={{ background: "oklch(1 0 0 / 5%)", border: "1px solid oklch(0.62 0.22 290 / 28%)", color: "white" }} />
          <button type="submit" disabled={!scenes.length}
            className="h-7 rounded-md px-2.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
            style={{ background: "oklch(0.62 0.22 290 / 18%)", color: "oklch(0.84 0.16 290)", border: "1px solid oklch(0.62 0.22 290 / 28%)" }}>{t("이동")}</button>
        </form>
        <div className="flex min-w-0 flex-1 basis-full items-center gap-1 sm:basis-auto">
          <button type="button" className={arrowClass} style={arrowStyle} disabled={!range.hasPrevious}
            aria-label={t("이전 씬 5개 보기")} onClick={() => setPage(range.page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <Tooltip.Provider delayDuration={250}>
            <div role="tablist" aria-label={t("씬 선택")} aria-orientation="horizontal" className="grid min-w-0 flex-1 grid-cols-5 gap-0.5 sm:gap-1">
              {scenes.slice(range.start, range.end).map((scene, offset) => {
                const sceneIndex = range.start + offset;
                const on = scene.id === selectedId;
                const focusable = selectedVisible ? on : offset === 0;
                return <Tooltip.Root key={scene.id}>
                  <Tooltip.Trigger asChild>
                    <button id={sceneTabId(scene.id)} type="button" role="tab"
                      aria-label={`${t("씬 {n}", { n: sceneIndex + 1 })}${scene.title ? ` · ${scene.title}` : ""}`}
                      aria-selected={on} aria-controls={scenePanelId(scene.id)} tabIndex={focusable ? 0 : -1}
                      onClick={() => selectIndex(sceneIndex)}
                      onKeyDown={event => {
                        const next = sceneTabIndex(sceneIndex, event.key, scenes.length);
                        if (next === null) return;
                        event.preventDefault();
                        selectIndex(next, true);
                      }}
                      className="flex h-7 min-w-0 items-center justify-center rounded-md text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:text-[11px]"
                      style={{ background: on ? "oklch(0.62 0.22 290 / 24%)" : "oklch(1 0 0 / 3%)", border: `1px solid ${on ? "oklch(0.80 0.18 290)" : "oklch(1 0 0 / 9%)"}`, color: on ? "white" : "oklch(0.62 0.01 265)" }}>
                      {t("씬{n}", { n: sceneIndex + 1 })}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content side="bottom" sideOffset={6} collisionPadding={12} className="z-50 rounded-md px-3 py-2 text-xs shadow-lg"
                      style={{ maxWidth: "min(20rem, calc(100vw - 24px))", overflowWrap: "anywhere", background: "oklch(0.22 0.03 290)", border: "1px solid oklch(0.62 0.22 290 / 35%)", color: "white" }}>
                      {scene.title || t("씬 {n}", { n: sceneIndex + 1 })}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>;
              })}
            </div>
          </Tooltip.Provider>
          <button type="button" className={arrowClass} style={arrowStyle} disabled={!range.hasNext}
            aria-label={t("다음 씬 5개 보기")} onClick={() => setPage(range.page + 1)}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="mt-1 text-[10px]" style={{ color: "oklch(0.68 0.05 290)" }}>
        {index >= 0 && <span className="font-semibold" style={{ color: "oklch(0.84 0.16 290)" }}>{t("선택: 씬{n}", { n: index + 1 })}{" · "}</span>}
        {scenes.length ? t("표시: 씬{start}–씬{end} / {total}개", { start: range.start + 1, end: range.end, total: scenes.length }) : t("표시할 씬이 없습니다.")}
      </p>
      {error && <p id={errorId} role="alert" className="mt-1 text-[11px]" style={{ color: "oklch(0.80 0.14 25)" }}>
        {t("없는 씬 번호입니다. 1부터 {total}까지 입력해 주세요.", { total: scenes.length })}
      </p>}
    </div>
  );
}
