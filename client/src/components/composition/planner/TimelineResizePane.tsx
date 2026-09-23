import { useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import { useT } from "@/lib/i18n";
import { clampTimelinePaneHeight, draggedTimelinePaneHeight, keyedTimelinePaneHeight, readTimelinePaneHeight, rememberTimelinePaneHeight, timelinePaneBounds } from "@/lib/timelinePaneSize";

/** 높이만 바뀔 때 수천 개 모캡 키와 3D 상태를 다시 계산하지 않도록 판의 화면 상태를 따로 둡니다. */
export function TimelineResizePane({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [preferred, setPreferred] = useState(readTimelinePaneHeight);
  const preferredRef = useRef(preferred);
  const [bounds, setBounds] = useState(() => timelinePaneBounds(720));
  const height = clampTimelinePaneHeight(preferred, bounds);
  const drag = useRef<{ pointerId: number; y: number; height: number; previous: number } | null>(null);
  const change = (next: number) => { preferredRef.current = next; setPreferred(next); };

  useLayoutEffect(() => {
    const stage = ref.current?.closest<HTMLElement>("[data-composition-stage]");
    const measure = () => setBounds(timelinePaneBounds(stage?.getBoundingClientRect().height ?? window.innerHeight));
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (stage) observer?.observe(stage);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const started = drag.current;
    if (!started || event.pointerId !== started.pointerId) return;
    drag.current = null;
    if (cancel) change(started.previous);
    else rememberTimelinePaneHeight(preferredRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div {...props} ref={ref} style={{ ...props.style, height }}>
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("타임라인 높이 조절")}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={height}
      aria-controls={contentId}
      tabIndex={0}
      title={t("위아래로 끌어 타임라인 높이 조절 · 방향키 ↑↓, Home 최소, End 최대")}
      className="absolute -top-2 left-0 right-32 z-20 flex h-4 cursor-ns-resize touch-none select-none items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-cyan-400"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, y: event.clientY, height, previous: preferredRef.current };
      }}
      onPointerMove={(event) => {
        const started = drag.current;
        if (!started || event.pointerId !== started.pointerId) return;
        change(draggedTimelinePaneHeight(started.height, started.y, event.clientY, bounds));
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event)}
      onKeyDown={(event) => {
        const next = keyedTimelinePaneHeight(height, event.key, bounds, event.shiftKey);
        if (next === null) return;
        event.preventDefault(); event.stopPropagation();
        change(next); rememberTimelinePaneHeight(next);
      }}
    ><span aria-hidden="true" className="h-1 w-14 rounded-full bg-white/35" /></div>
    {/* 떠 있는 그래프·접기 단추는 바깥에 두고 실제 내용만 스크롤해야 위로 열린 판이 잘리지 않습니다. */}
    <div id={contentId} className="h-full min-h-0">{children}</div>
  </div>;
}
