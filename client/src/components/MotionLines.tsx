import { SURFACE_BOX, SURFACE_MEDIA } from "@/lib/imageSurface";
import { useEffect, useRef, useState } from "react";
import { MousePointer2, PenLine, Slash, Undo2 } from "lucide-react";
import {
  getGuideArrowGeometry,
  getGuideLinePath,
  type CompositionGuideLine,
  type GuideLineKind,
  type GuideLineTool,
  type Vector2Value,
} from "@/lib/composition";
import { uid } from "@/lib/projectTypes";

/**
 * 그림 위에 **동선**을 그리는 공용 부품.
 *
 * # 왜 그림 위에 그리는가
 *
 * 「인물이 왼쪽에서 오른쪽으로 걸어간다」를 글로 적으면 생성기가 매번 다르게 읽습니다. 프레임 위에 화살표를 그려서
 * 함께 올리면 방향이 고정됩니다.
 *
 * # 왜 부품으로 뺐는가
 *
 * 그래서 컷 전용 창이 아니라 **공용 이미지 편집 창**(자르기·표시하기·파노라마·전개도)의 한 탭으로 들어갑니다.
 * 그리는 규칙과 굽는 규칙이 여기 한 군데에만 있어야 두 자리가 갈라지지 않습니다(CLAUDE.md 규칙 1).
 *
 * # 선 세 가지
 *
 * - **카메라 동선** — 보라 점선 · **인물 동선** — 파랑 실선 · **빛 동선** — 가는 3중선
 *
 * 전부 끝에 화살촉이 붙습니다. 화살촉 방향은 마지막 한두 점의 손떨림이 아니라 일정 거리를 거슬러 잡은 평균
 * 진행 방향입니다(`composition.ts`).
 */
export const MOTION_KIND_STYLE: Record<
  GuideLineKind,
  { label: string; color: string; dash?: number[]; triple?: boolean }
> = {
  camera: { label: "카메라 동선", color: "#c084fc", dash: [10, 8] },
  character: { label: "인물 동선", color: "#38bdf8" },
  light: { label: "빛 동선", color: "#fbbf24", triple: true },
};

/** 그리기 좌표계. 실제 픽셀이 아니라 0~100 비율로 저장해 어느 해상도에서든 같습니다. */
export const MOTION_VIEW_W = 100;

/** 그린 선을 캔버스에 **굽습니다**. 화면의 SVG 와 같은 모양이 나와야 합니다. */
export function bakeMotionLines(
  ctx: CanvasRenderingContext2D,
  lines: CompositionGuideLine[],
  scale: number,
) {
  for (const line of lines) {
    const style = MOTION_KIND_STYLE[line.kind];
    const width = (line.strokeWidth ?? 0.7) * scale * (style.triple ? 0.4 : 1);
    const arrow = getGuideArrowGeometry(line, line.strokeWidth ?? 0.7);

    const drawPath = (offset = 0) => {
      ctx.save();
      ctx.strokeStyle = style.color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (style.dash) ctx.setLineDash(style.dash.map((value) => value * scale * 0.4));
      ctx.beginPath();
      const points =
        line.tool === "freehand"
          ? [...line.points.slice(0, -1), arrow.stemEnd]
          : [line.points[0], arrow.stemEnd];
      points.forEach((point, index) => {
        const x = (point.x + arrow.normal.x * offset) * scale;
        const y = (point.y + arrow.normal.y * offset) * scale;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    };

    // 빛은 가는 3중선. 한 줄이면 다른 동선과 구분이 안 됩니다.
    if (style.triple) {
      drawPath(-1.1);
      drawPath(0);
      drawPath(1.1);
    } else {
      drawPath();
    }

    // 화살촉
    ctx.save();
    ctx.fillStyle = style.color;
    ctx.beginPath();
    arrow.points
      .split(" ")
      .map((pair) => pair.split(",").map(Number))
      .forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x * scale, y * scale);
        else ctx.lineTo(x * scale, y * scale);
      });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** 한 선을 SVG 로. 굽는 것(`bakeMotionLines`)과 모양이 같아야 «보이는 대로 저장» 이 됩니다. */
function renderLine(line: CompositionGuideLine, key: string) {
  const style = MOTION_KIND_STYLE[line.kind];
  const width = (line.strokeWidth ?? 0.7) * (style.triple ? 0.35 : 1);
  const arrow = getGuideArrowGeometry(line, line.strokeWidth ?? 0.7);
  const path = getGuideLinePath(line, arrow.stemEnd);
  const dash = style.dash?.join(" ");
  return (
    <g key={key}>
      {style.triple ? (
        [-1.1, 0, 1.1].map((offset) => (
          <path
            key={offset}
            d={path}
            fill="none"
            stroke={style.color}
            strokeWidth={width}
            strokeLinecap="round"
            transform={`translate(${arrow.normal.x * offset} ${arrow.normal.y * offset})`}
          />
        ))
      ) : (
        <path
          d={path}
          fill="none"
          stroke={style.color}
          strokeWidth={width}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <polygon points={arrow.points} fill={style.color} />
    </g>
  );
}

/**
 * 동선 그리기 화면 — 도구줄 + 그림 + 그린 선. 저장은 **부르는 쪽**이 합니다.
 *
 * 저장을 안에서 하지 않는 까닭: 파일 이름과 폴더 규칙이 자리마다 다릅니다(컷은 장면 폴더, 캐릭터는 인물 폴더 —
 * CLAUDE.md 규칙 5). 여기서는 «그린 선이 구워진 캔버스» 까지만 만들고 넘깁니다.
 */
export function MotionLinesEditor({
  src,
  busy,
  saveLabel = "동선 그림 저장",
  onSave,
  extraActions,
  note,
}: {
  src: string;
  busy?: boolean;
  saveLabel?: string;
  /** 선을 구운 blob 을 넘깁니다. 저장 자리는 부르는 쪽이 정합니다. */
  onSave: (blob: Blob) => void | Promise<void>;
  extraActions?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const [kind, setKind] = useState<GuideLineKind>("character");
  const [tool, setTool] = useState<GuideLineTool | "cursor">("freehand");
  const [strokeWidth, setStrokeWidth] = useState(0.7);
  const [lines, setLines] = useState<CompositionGuideLine[]>([]);
  const [drawing, setDrawing] = useState<CompositionGuideLine | null>(null);
  const [ratio, setRatio] = useState(9 / 16);
  const [baking, setBaking] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // 그림을 바꾸면 그리던 선은 버립니다. 다른 그림의 좌표라 안 맞습니다.
  useEffect(() => {
    setLines([]);
    setDrawing(null);
  }, [src]);

  useEffect(() => {
    if (!src) return;
    const image = new Image();
    image.onload = () => setRatio(image.naturalHeight / image.naturalWidth);
    image.src = src;
  }, [src]);

  const viewH = MOTION_VIEW_W * ratio;

  const pointOf = (event: React.PointerEvent): Vector2Value => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * MOTION_VIEW_W,
      y: ((event.clientY - rect.top) / rect.height) * viewH,
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (tool === "cursor" || !src) return;
    event.preventDefault();
    const point = pointOf(event);
    setDrawing({
      id: uid(),
      kind,
      tool: tool as GuideLineTool,
      points: [point, point],
      strokeWidth,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drawing) return;
    const point = pointOf(event);
    setDrawing((current) => {
      if (!current) return current;
      if (current.tool === "freehand")
        return { ...current, points: [...current.points, point] };
      // 직선은 시작점과 끝점만 유지합니다.
      return { ...current, points: [current.points[0], point] };
    });
  };

  const onPointerUp = () => {
    if (!drawing) return;
    // 점 하나짜리 클릭은 선이 아닙니다.
    const [a, b] = [drawing.points[0], drawing.points[drawing.points.length - 1]];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1.5)
      setLines((current) => [...current, drawing]);
    setDrawing(null);
  };

  /** 하나만 지웁니다. 전체 초기화로 실수를 통째로 날리는 것보다 안전합니다. */
  const undoOne = () => setLines((current) => current.slice(0, -1));

  // Ctrl+Z (규칙 4). 단추만 있고 키가 없어서 다른 편집 창과 달랐습니다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      undoOne();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 그림 위에 선을 구워 blob 으로 넘깁니다. 읽기는 `loadImageForCanvas` 를 쓰는 부르는 쪽 몫이 아니라 여기서 — */
  const bake = async () => {
    setBaking(true);
    try {
      const { loadImageForCanvas } = await import("@/lib/mediaLibrary");
      const image = await loadImageForCanvas(src);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      bakeMotionLines(ctx, lines, canvas.width / MOTION_VIEW_W);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((made) => (made ? resolve(made) : reject(new Error("저장 실패"))), "image/png"),
      );
      await onSave(blob);
    } finally {
      setBaking(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* ── 도구줄 ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2" data-tour="cropper-motion">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as GuideLineKind)}
          className="rounded-md px-2 py-1.5 text-[11px] outline-none"
          style={{
            background: "oklch(0.18 0.012 265)",
            border: `1px solid ${MOTION_KIND_STYLE[kind].color}66`,
            color: MOTION_KIND_STYLE[kind].color,
          }}
        >
          {Object.entries(MOTION_KIND_STYLE).map(([id, style]) => (
            <option key={id} value={id}>
              {style.label}
            </option>
          ))}
        </select>

        {(
          [
            { id: "cursor", icon: MousePointer2, hint: "구경만 하기" },
            { id: "freehand", icon: PenLine, hint: "자유선" },
            { id: "straight", icon: Slash, hint: "직선" },
          ] as const
        ).map((item) => {
          const on = tool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTool(item.id)}
              title={item.hint}
              className="rounded-md p-2"
              style={{
                background: on ? "oklch(0.62 0.22 290 / 22%)" : "oklch(1 0 0 / 5%)",
                color: on ? "oklch(0.86 0.16 290)" : "oklch(0.58 0.01 265)",
              }}
            >
              <item.icon className="h-3.5 w-3.5" />
            </button>
          );
        })}

        <button
          type="button"
          onClick={undoOne}
          disabled={!lines.length}
          title="마지막 선 하나만 지웁니다"
          className="rounded-md p-2 disabled:opacity-30"
          style={{ background: "oklch(1 0 0 / 5%)", color: "oklch(0.62 0.01 265)" }}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>

        <span className="ml-1 text-[10px]" style={{ color: "oklch(0.52 0.01 265)" }}>
          굵기
        </span>
        <input
          type="range"
          min={0.3}
          max={2}
          step={0.1}
          value={strokeWidth}
          onChange={(event) => setStrokeWidth(Number(event.target.value))}
          className="w-32"
        />

        <span className="min-w-0 flex-1" />
        {extraActions}
        <button
          type="button"
          onClick={() => void bake()}
          disabled={busy || baking || !lines.length}
          className="rounded-lg px-4 py-2 text-[11px] font-semibold text-white gradient-primary disabled:opacity-40"
        >
          {busy || baking ? "저장 중…" : saveLabel}
        </button>
      </div>

      {/* ── 그림 ────────────────────────────────────────────────────── */}
      {src && (
        <div
          className={`${SURFACE_BOX} overflow-hidden rounded-lg`}
          style={{ border: "1px solid oklch(1 0 0 / 10%)" }}
        >
          <img src={src} alt="" className={SURFACE_MEDIA} draggable={false} />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${MOTION_VIEW_W} ${viewH}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={{ cursor: tool === "cursor" ? "default" : "crosshair", touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {lines.map((line) => renderLine(line, line.id))}
            {drawing && renderLine(drawing, "__drawing__")}
          </svg>
        </div>
      )}

      <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.42 0.01 265)" }}>
        {note ??
          "마지막 선 하나만 지울 수 있습니다(Ctrl+Z). 빛 동선은 가는 3중선으로 표시됩니다. 저장하면 선이 구워진 그림이 새 파일로 남습니다."}
      </p>
    </div>
  );
}

export default MotionLinesEditor;
