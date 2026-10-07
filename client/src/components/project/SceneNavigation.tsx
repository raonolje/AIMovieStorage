import { useEffect, useId, useRef, useState } from "react";
import type { Scene } from "@/lib/projectTypes";
import { useT } from "@/lib/i18n";
import { sceneAtNumber, sceneTabIndex } from "@/lib/sceneEditorState";

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
  const [number, setNumber] = useState("");
  const [error, setError] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const index = scenes.findIndex(scene => scene.id === selectedId);
  useEffect(() => { setNumber(index >= 0 ? String(index + 1) : ""); setError(false); }, [selectedId, index]);
  useEffect(() => {
    // 페이지는 세로로 움직이지 않습니다. 탭 띠 안의 선택만 가시 영역에 맞춥니다.
    const container = list.current;
    const active = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !active) return;
    const reveal = () => {
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < container.scrollLeft + 4) container.scrollLeft = Math.max(0, left - 4);
      else if (right > container.scrollLeft + container.clientWidth - 4) container.scrollLeft = Math.ceil(right - container.clientWidth + 4);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selectedId, scenes]);
  const jump = () => {
    const id = sceneAtNumber(scenes, number);
    setError(!id);
    if (id) onSelect(id);
  };
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
        <div ref={list} role="tablist" aria-label={t("씬 선택")} aria-orientation="horizontal"
          className="relative flex min-w-0 flex-1 basis-full gap-1 overflow-x-auto px-1 py-1 sm:basis-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "oklch(0.50 0.10 290) oklch(1 0 0 / 4%)" }}>
          {scenes.map((scene, sceneIndex) => {
            const on = scene.id === selectedId;
            return <button key={scene.id} id={sceneTabId(scene.id)} type="button" role="tab"
              aria-selected={on} aria-controls={scenePanelId(scene.id)} tabIndex={on ? 0 : -1}
              title={`${t("씬 {n}", { n: sceneIndex + 1 })}${scene.title ? ` · ${scene.title}` : ""}`}
              onClick={() => onSelect(scene.id)}
              onKeyDown={event => {
                const next = sceneTabIndex(sceneIndex, event.key, scenes.length);
                if (next === null) return;
                event.preventDefault();
                onSelect(scenes[next].id);
                document.getElementById(sceneTabId(scenes[next].id))?.focus({ preventScroll: true });
              }}
              className="flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              style={{ background: on ? "oklch(0.62 0.22 290 / 24%)" : "oklch(1 0 0 / 3%)", border: `1px solid ${on ? "oklch(0.80 0.18 290)" : "oklch(1 0 0 / 9%)"}`, color: on ? "white" : "oklch(0.62 0.01 265)" }}>
              <span className="shrink-0">{t("씬 {n}", { n: sceneIndex + 1 })}</span>
              {scene.title && <span className="truncate font-normal">{scene.title}</span>}
            </button>;
          })}
        </div>
      </div>
      {error && <p id={errorId} role="alert" className="mt-1 text-[11px]" style={{ color: "oklch(0.80 0.14 25)" }}>
        {t("없는 씬 번호입니다. 1부터 {total}까지 입력해 주세요.", { total: scenes.length })}
      </p>}
    </div>
  );
}
