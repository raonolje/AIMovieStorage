import { useRef, useState, type PointerEvent } from "react";
import {
  actorProjection,
  guideRect,
  type LedGuideSettings,
} from "@/lib/ledGuides";
import { useT } from "@/lib/i18n";

export default function LedGuideOverlay({
  settings,
  aspect,
  interactive = true,
  onChange,
}: {
  settings: LedGuideSettings;
  aspect: number;
  interactive?: boolean;
  onChange: (s: LedGuideSettings) => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState<LedGuideSettings | null>(null);
  const drag = useRef<{
    id: string;
    mode: "move" | "resize" | "actor";
    x: number;
    y: number;
    start: LedGuideSettings;
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const current = preview ?? settings;
  const at = (e: PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    return {
      x: (e.clientX - b.left) / b.width,
      y: (e.clientY - b.top) / b.height,
    };
  };
  const begin = (
    e: PointerEvent,
    id: string,
    mode: "move" | "resize" | "actor",
  ) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = { id, mode, ...at(e), start: settings };
    setPreview(settings);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e),
      dx = p.x - d.x,
      dy = p.y - d.y;
    if (d.mode === "actor") {
      const g = d.start.guides.find((g) => g.id === d.start.actor.guideId);
      if (!g) return;
      const r = guideRect(g, aspect);
      setPreview({
        ...d.start,
        actor: {
          ...d.start.actor,
          x: d.start.actor.x + dx / r.width,
          footY: d.start.actor.footY + dy / r.height,
        },
      });
    } else
      setPreview({
        ...d.start,
        guides: d.start.guides.map((g) => {
          if (g.id !== d.id) return g;
          const r = guideRect(g, aspect);
          return d.mode === "move"
            ? { ...g, x: g.x + dx, y: g.y + dy }
            : {
                ...g,
                fit: "free",
                width: Math.max(0.005, Math.min(10, r.width + dx)),
              };
        }),
      });
  };
  const finish = () => {
    if (drag.current && preview) onChange(preview);
    drag.current = null;
    setPreview(null);
  };
  const actor = actorProjection(current, aspect);
  if (!current.visible) return null;
  return (
    <svg
      ref={svg}
      data-led-overlay
      aria-label={t("LED 크롭 가이드와 배우 실루엣")}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: "none", zIndex: 5, overflow: "hidden" }}
      viewBox={`0 0 1000 ${1000 / aspect}`}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
    >
      {current.guides
        .filter((g) => g.visible)
        .map((g) => {
          const r = guideRect(g, aspect),
            x = r.x * 1000,
            y = (r.y * 1000) / aspect,
            width = r.width * 1000,
            height = (r.height * 1000) / aspect;
          return (
            <g key={g.id} data-led-guide={g.id}>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={g.color}
                fillOpacity=".035"
                stroke={g.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                style={{
                  pointerEvents: interactive ? "all" : "none",
                  cursor: "move",
                  touchAction: "none",
                }}
                onPointerDown={(e) => begin(e, g.id, "move")}
              />
              <text
                x={x + 6}
                y={y + 18}
                fill={g.color}
                fontSize="14"
                stroke="#101018"
                strokeWidth="3"
                paintOrder="stroke"
                style={{ pointerEvents: "none" }}
              >
                {g.name} · {g.ratioWidth}:{g.ratioHeight}
              </text>
              {interactive && (
                <rect
                  aria-label={t("가이드 크기 조절")}
                  x={x + width - 12}
                  y={y + height - 12}
                  width="14"
                  height="14"
                  fill={g.color}
                  style={{
                    pointerEvents: "all",
                    cursor: "nwse-resize",
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => begin(e, g.id, "resize")}
                />
              )}
            </g>
          );
        })}
      {current.actor.visible &&
        actor &&
        current.guides.some(
          (g) => g.id === current.actor.guideId && g.visible,
        ) &&
        (() => {
          const h = (actor.height * 1000) / aspect,
            w = h * 0.29;
          return (
            <svg
              data-led-actor
              x={actor.x * 1000 - w / 2}
              y={((actor.footY - actor.height) * 1000) / aspect}
              width={w}
              height={h}
              viewBox="0 0 100 350"
              opacity={current.actor.opacity}
              style={{
                pointerEvents: interactive ? "all" : "none",
                cursor: "move",
                touchAction: "none",
                overflow: "visible",
              }}
              onPointerDown={(e) => begin(e, "", "actor")}
            >
              <title>{t("배우 실루엣")}</title>
              <circle
                cx="50"
                cy="23"
                r="22"
                fill="#101018"
                stroke="white"
                strokeWidth="2"
              />
              <path
                d="M33 49 Q50 42 67 49 L80 68 L99 162 Q99 174 88 174 L66 94 L67 185 L82 337 Q83 348 71 348 L57 348 L50 220 L43 348 L29 348 Q17 348 18 337 L33 185 L34 94 L12 174 Q1 174 1 162 L20 68 Z"
                fill="#101018"
                stroke="white"
                strokeWidth="2"
              />
            </svg>
          );
        })()}
    </svg>
  );
}
