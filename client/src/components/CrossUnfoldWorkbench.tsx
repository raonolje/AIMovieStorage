import { useEffect, useMemo, useRef, useState } from "react";
import { Grid2x2, Minus, Plus, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";
import type { SpaceKind } from "@/lib/blueprint";
import {
  DEFAULT_CROSS_LINES,
  backgroundColorOf,
  analyzeCrossFaces,
  assessCrossFaces,
  crossCells,
  cutCrossFaces,
  measureCrossFaces,
  detectCrossLines,
  type CrossLines,
} from "@/lib/crossUnfold";
import { crossUnfoldWarning } from "@/lib/crossUnfoldWarnings";
import type { FaceSetSize } from "@/lib/projectTypes";
import { useT } from "@/lib/i18n";
import { useUndoStack } from "@/lib/useUndoStack";
import { isTypingTarget } from "@/lib/isTypingTarget";
import { confirmDialog } from "@/components/ConfirmDialog";
import { FACE_KEYS, faceLabel } from "@/lib/faceSets";
import { loadImageForCanvas } from "@/lib/mediaLibrary";
import type {
  PanoramaFaceFile,
  PanoramaFacePlan,
} from "@/components/PanoramaWorkbench";

/**
 * 십자 전개도 한 장을 여섯 면으로 자릅니다.
 *
 * 파노라마 탭과 하는 일이 같아 보이지만 재료가 다릅니다. 파노라마는 **계산으로** 여섯 면을
 * 다시 투영하고(이음매가 어긋날 여지가 없음), 이쪽은 생성기가 이미 여섯 칸으로 그려 놓은
 * 것을 **자르기만** 합니다. 실내는 벽이 곧 면이라 이쪽이 낫습니다 — 등장방형으로 한 바퀴
 * 돌리면 곧은 벽이 휘어 버립니다.
 *
 * 자르는 자리는 회색 바탕을 재서 알아서 찾고(`detectCrossLines`), 사람이 선을 끌어
 * 고칩니다. 생성기가 「캔버스의 22분의 5 지점」 같은 지시는 못 지키기 때문입니다.
 */
/** 돋보기가 비추는 원본 픽셀 한 변. 그림 위 노란 네모와 같은 값이어야 둘이 같은 자리를 가리킵니다. */
const LOUPE_SPAN = 48;

export default function CrossUnfoldWorkbench({
  imageSrc,
  spaceKind,
  targetSize,
  progress,
  onSaveFaces,
}: {
  imageSrc: string;
  spaceKind?: SpaceKind | null;
  /** 생성할 때 사용한 방 크기. 현재 방이 바뀌었더라도 원본의 치수로 검증합니다. */
  targetSize?: FaceSetSize | null;
  /** 저장 진행 문구. 받는 쪽(`SheetPanelCropper`)이 채웁니다. */
  progress?: string | null;
  onSaveFaces?: (
    files: PanoramaFaceFile[],
    plan: PanoramaFacePlan,
  ) => Promise<void> | void;
}) {
  const t = useT();
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const history = useUndoStack<CrossLines>(DEFAULT_CROSS_LINES);
  const lines = history.value;
  const setLines = history.set;
  const [detected, setDetected] = useState<boolean | null>(null);
  const [flip, setFlip] = useState(true);
  /** 전개도의 빈칸 색. 잘라낸 칸에서 회색 테두리를 벗길 때 견줍니다. */
  const [background, setBackground] = useState<[number, number, number] | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  /*
    ── 정확히 맞추기 — 확대 · 돋보기 · 방향키 ─────────────────────────────
    , 「하단으로 더 이상 내려오지도 않아」.

    - 자동으로 찾은 자리는 이제 원본 해상도에서 마무리합니다(`refineCrossFromPixels`).
    - 그래도 손으로 고칠 때를 위해 **확대**(단추·Ctrl+휠), 끄는 동안 **8배 돋보기**, 고른 선을 **방향키로
      1 px**(Shift 면 10 px) 옮기기를 둡니다. 화면 픽셀로 끌면 원본 몇 px 씩 건너뛰어 딱 맞출 수 없습니다.
    - 그림을 창 높이에 맞춰 줄여 둡니다. 예전엔 가로에 맞춰 늘려서 세로가 창 밖으로 나가, 아래 선을 더
      끌어 내릴 자리가 화면에 없었습니다. 확대하면 판 안에서 스크롤됩니다.
  */
  const [zoom, setZoom] = useState(1);
  const [activeLine, setActiveLine] = useState<{ axis: "x" | "y"; index: number } | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const loupeRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadImageForCanvas(imageSrc)
      .then((image) => {
        if (!alive) return;
        setSource(image);
        setBackground(backgroundColorOf(image));
        const found = detectCrossLines(image);
        history.reset(found ?? DEFAULT_CROSS_LINES);
        setDetected(Boolean(found));
      })
      .catch(() => {
        if (alive) setSource(null);
      });
    return () => {
      alive = false;
    };
  }, [imageSrc]);

  const cells = useMemo(() => crossCells(lines), [lines]);
  const [inspection, setInspection] = useState<ReturnType<typeof analyzeCrossFaces> | null>(null);
  useEffect(() => {
    setInspection(null);
    if (!source) return;
    // 큰 전개도에서 선을 끌 때마다 여섯 캔버스를 만들지 않고 손이 잠시 멎었을 때 잽니다.
    const timer = window.setTimeout(() => setInspection(analyzeCrossFaces(source, lines, { flip, background, targetSize })), 180);
    return () => window.clearTimeout(timer);
  }, [source, lines, flip, background, targetSize]);
  useEffect(() => {
    const onUndo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== "z" && event.key.toLowerCase() !== "y") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key.toLowerCase() === "y" || event.shiftKey) history.redo();
      else history.undo();
    };
    // 바깥 자르기 창도 Ctrl+Z를 쓰므로 전개도 탭에서 먼저 받습니다.
    window.addEventListener("keydown", onUndo, true);
    return () => window.removeEventListener("keydown", onUndo, true);
  }, [history.undo, history.redo]);

  /*
    선 하나를 끕니다. 이웃 선을 넘지 못하게 막습니다 — 뒤집힌 칸은 너비가 음수라
    `drawImage` 가 조용히 아무것도 안 그리고, 저장은 «여섯 칸을 다 자르지 못했습니다» 로
    끝나 버립니다.
  */
  const dragLine =
    (axis: "x" | "y", index: number) => (event: React.PointerEvent) => {
      const frame = frameRef.current;
      if (!frame) return;
      event.preventDefault();
      history.mark();
      setActiveLine({ axis, index });
      const move = (pointer: PointerEvent) => {
        const rect = frame.getBoundingClientRect();
        const raw =
          axis === "x"
            ? (pointer.clientX - rect.left) / rect.width
            : (pointer.clientY - rect.top) / rect.height;
        setLoupe({
          x: Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width)),
          y: Math.min(1, Math.max(0, (pointer.clientY - rect.top) / rect.height)),
        });
        history.replace((current) => {
          const list = [...current[axis]] as number[];
          const gap = 0.01;
          const low = index > 0 ? list[index - 1] + gap : 0;
          const high = index < list.length - 1 ? list[index + 1] - gap : 1;
          list[index] = Math.min(high, Math.max(low, raw));
          return axis === "x"
            ? { ...current, x: list as CrossLines["x"] }
            : { ...current, y: list as CrossLines["y"] };
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  /** 선 하나를 원본 px 단위로 옮깁니다(방향키). 이웃 선은 못 넘습니다. */
  const nudge = (axis: "x" | "y", index: number, pixels: number) => {
    if (!source) return;
    const size = axis === "x" ? source.naturalWidth || source.width : source.naturalHeight || source.height;
    setLines((current) => {
      const list = [...current[axis]] as number[];
      const gap = 0.01;
      const low = index > 0 ? list[index - 1] + gap : 0;
      const high = index < list.length - 1 ? list[index + 1] - gap : 1;
      const snapped = Math.round(list[index] * size + pixels) / size;
      list[index] = Math.min(high, Math.max(low, snapped));
      return axis === "x"
        ? { ...current, x: list as CrossLines["x"] }
        : { ...current, y: list as CrossLines["y"] };
    });
  };
  useEffect(() => {
    if (!activeLine) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select")) return;
      const step = event.shiftKey ? 10 : 1;
      const keys: Record<string, number> =
        activeLine.axis === "x" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
      const delta = keys[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      nudge(activeLine.axis, activeLine.index, delta);
      // 돋보기도 그 선을 따라갑니다 — 방향키로 옮기는 동안 무엇이 바뀌는지 봐야 합니다.
      setLoupe((current) => {
        const value = lines[activeLine.axis][activeLine.index];
        return activeLine.axis === "x"
          ? { x: value, y: current?.y ?? 0.5 }
          : { x: current?.x ?? 0.5, y: value };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /*
    돋보기 — 원본에서 선 둘레 48 px 를 8 배로. 선은 원본 자리 그대로 그어, 판 경계와 한 줄이라도
    어긋나면 보입니다. 이미지 스무딩을 꺼야 픽셀 경계가 흐려지지 않습니다.
  */
  useEffect(() => {
    const canvas = loupeRef.current;
    if (!canvas || !source || !loupe) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const span = LOUPE_SPAN;
    const scale = canvas.width / span;
    const cx = Math.round(loupe.x * width);
    const cy = Math.round(loupe.y * height);
    const sx = cx - span / 2;
    const sy = cy - span / 2;
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#111";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, sx, sy, span, span, 0, 0, canvas.width, canvas.height);
    context.lineWidth = 1;
    lines.x.forEach((value, index) => {
      const px = Math.round(value * width);
      if (px < sx || px > sx + span) return;
      const on = activeLine?.axis === "x" && activeLine.index === index;
      context.strokeStyle = on ? "#f6d365" : "rgba(196,160,255,0.9)";
      context.beginPath();
      context.moveTo((px - sx) * scale + 0.5, 0);
      context.lineTo((px - sx) * scale + 0.5, canvas.height);
      context.stroke();
    });
    lines.y.forEach((value, index) => {
      const py = Math.round(value * height);
      if (py < sy || py > sy + span) return;
      const on = activeLine?.axis === "y" && activeLine.index === index;
      context.strokeStyle = on ? "#f6d365" : "rgba(120,220,230,0.9)";
      context.beginPath();
      context.moveTo(0, (py - sy) * scale + 0.5);
      context.lineTo(canvas.width, (py - sy) * scale + 0.5);
      context.stroke();
    });
  }, [loupe, lines, source, activeLine]);

  /**
   * 칸 하나를 원본 해상도로 잘라 캔버스에 담습니다.
   *
   * 자르기·뒤집기·회색 테두리 벗기기는 `lib/crossUnfold.ts` 한 곳에 있습니다 — 자동
   * 커팅(`useAutoUnfold`)도 같은 함수를 써야 «테두리 없어야 해» 같은 규칙이 한 벌로
   * 남습니다(공통 규칙 1).
   */
  const save = async () => {
    if (!source || !onSaveFaces) return;
    setSaving(true);
    try {
      const cut = cutCrossFaces(source, lines, { flip, background, targetSize });
      const checked = assessCrossFaces(measureCrossFaces(cut, background), targetSize);
      setInspection(checked);
      if (!checked.safe && !(await confirmDialog({
        title: t("면 비율과 경계를 확인한 뒤 저장해 주세요"),
        description: `${checked.issues.map((issue) => crossUnfoldWarning(issue, spaceKind)).join("\n")}\n${t("원본은 그대로 있습니다. 가위 → 전개도에서 선을 맞추거나, 빠진 면을 포함해 다시 생성하세요.")}`,
        confirmLabel: t("확인하고 저장"),
        cancelLabel: t("선 다시 맞추기"),
      }))) return;
      const files: PanoramaFaceFile[] = [];
      let biggest = 0;
      for (const face of FACE_KEYS) {
        const canvas = cut.find((item) => item.face === face)?.canvas;
        if (!canvas) continue;
        biggest = Math.max(biggest, canvas.width, canvas.height);
        const stem = faceLabel(face, spaceKind);
        const file = await new Promise<File | null>((resolve) => {
          canvas.toBlob(
            (blob) =>
              resolve(
                blob
                  ? new File([blob], `${stem}.png`, { type: "image/png" })
                  : null,
              ),
            "image/png",
          );
        });
        if (file) files.push({ file, stem, face });
      }
      if (files.length < 6) {
        toast.error("여섯 칸을 다 자르지 못했습니다. 선 자리를 확인해 주세요.");
        return;
      }
      /*
        업스케일은 걸지 않습니다. 파노라마는 «정사각 한 면» 이라 목표 크기가 한 숫자로 정해지는데,
        전개도의 칸은 면마다 비율이 달라서(정면 = 가로×높이, 옆면 = 깊이×높이) 한 숫자로 키우면
        방 비율이 무너집니다. 크게 쓸 면만 저장한 뒤 이미지 편집에서 따로 키웁니다.
      */
      await onSaveFaces(files, {
        faceSize: biggest,
        nativeSize: biggest,
        upscale: false,
        enlarged: false,
        capped: false,
      });
    } catch (error) {
      toast.error(t("여섯 면을 저장하지 못했습니다"), { description: String(error) });
    } finally {
      setSaving(false);
    }
  };

  /** 이 자리로 자르면 방이 어떤 비율이 되는지 — 정면 칸이 가로:높이, 왼쪽 칸이 깊이:높이입니다. */
  const ratio = useMemo(() => {
    if (!source) return null;
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const wall = (lines.y[2] - lines.y[1]) * height;
    if (wall <= 0) return null;
    return {
      width: ((lines.x[2] - lines.x[1]) * width) / wall,
      depth: ((lines.x[1] - lines.x[0]) * width) / wall,
    };
  }, [lines, source]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div
        ref={scrollRef}
        className="composition-scroll self-start overflow-auto rounded-lg"
        style={{
          maxHeight: "74vh",
          background: "oklch(0.10 0.006 265)",
          border: "1px solid oklch(1 0 0 / 10%)",
        }}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          setZoom((current) => Math.min(8, Math.max(1, Math.round((current * (event.deltaY < 0 ? 1.25 : 0.8)) * 100) / 100)));
        }}
      >
      <div
        ref={frameRef}
        data-tour="cropper-cross-lines"
        className="relative mx-auto select-none overflow-hidden"
        /*
          돋보기는 **마우스가 있는 자리**를 따라갑니다. 
          처음엔 선을 끌기 시작한 자리만 비춰서, 긴 가로선을 오른쪽에서 잡고 왼쪽 끝을 보고 있으면 돋보기는 엉뚱한
          오른쪽을 보여 줬습니다. 마우스를 올린 곳을 비추고, 그 자리를 그림 위에 노란 네모로 표시합니다.
        */
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          setLoupe({
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
          });
        }}
        style={{
          /*
            창 높이(74vh)에 들어오는 폭까지만 — 세로가 창 밖으로 나가 아래 선을 못 끌던 것.

            여기만 `lib/imageSurface` 의 공용 규칙을 안 씁니다. 이 탭은 **확대·축소(100~800%)와
            돋보기**가 있는 작업대라 크기를 `zoom` 이 쥐어야 합니다 — 공용 규칙은 «창에 맞춰 한 번
            줄인다» 이고, 여기 필요한 것은 «사람이 정한 배율» 입니다. 다만 «창 밖으로 나가지
            않는다» 는 같은 뜻이라 높이 한도는 같이 둡니다.
          */
          width: source
            ? `calc(${zoom} * min(100%, ${(74 * (source.naturalWidth || source.width)) / (source.naturalHeight || source.height)}vh))`
            : "100%",
        }}
      >
        <img src={imageSrc} alt="" className="block w-full" draggable={false} />
        {lines.x.map((value, index) => (
          <div
            key={`x${index}`}
            onPointerDown={dragLine("x", index)}
            className="absolute top-0 h-full cursor-ew-resize"
            style={{ left: `calc(${value * 100}% - 5px)`, width: 10 }}
          >
            <div
              className="mx-auto h-full"
              style={{
                width: 1,
                background:
                  activeLine?.axis === "x" && activeLine.index === index
                    ? "oklch(0.90 0.16 85)"
                    : "oklch(0.84 0.16 290)",
                boxShadow: "0 0 4px oklch(0 0 0 / 80%)",
              }}
            />
          </div>
        ))}
        {lines.y.map((value, index) => (
          <div
            key={`y${index}`}
            onPointerDown={dragLine("y", index)}
            /*
              잡는 띠(10 px) **한가운데**에 선을 긋습니다 — `flex items-center`. 예전엔 안쪽 선에 `my-auto` 만 걸었는데
              블록 흐름에서는 세로 auto 여백이 가운데로 안 모아 줘서, 가로선이 실제 자리보다 5 px 위(회색 위)에 그려졌습니다.
              돋보기는 원본 자리에 그어 맞게 보이니 둘이 달라 보였습니다(). 자르는 값 자체는 처음부터 맞았고 그리기만 틀렸습니다.
            */
            className="absolute left-0 flex w-full cursor-ns-resize items-center"
            style={{ top: `calc(${value * 100}% - 5px)`, height: 10 }}
          >
            <div
              className="w-full"
              style={{
                height: 1,
                background:
                  activeLine?.axis === "y" && activeLine.index === index
                    ? "oklch(0.90 0.16 85)"
                    : "oklch(0.80 0.16 200)",
                boxShadow: "0 0 4px oklch(0 0 0 / 80%)",
              }}
            />
          </div>
        ))}
        {/* 돋보기가 비추는 자리 — 원본 48 px 네모. 전체 그림 위에서 «지금 어디를 크게 보고 있나» 를 보여 줍니다. */}
        {loupe && source && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${(loupe.x - LOUPE_SPAN / 2 / (source.naturalWidth || source.width)) * 100}%`,
              top: `${(loupe.y - LOUPE_SPAN / 2 / (source.naturalHeight || source.height)) * 100}%`,
              width: `${(LOUPE_SPAN / (source.naturalWidth || source.width)) * 100}%`,
              height: `${(LOUPE_SPAN / (source.naturalHeight || source.height)) * 100}%`,
              border: "1.5px solid oklch(0.90 0.16 85)",
              boxShadow: "0 0 0 1px oklch(0 0 0 / 60%)",
              zIndex: 5,
            }}
          />
        )}
        {cells.map((cell) => (
          <div
            key={cell.face}
            className="pointer-events-none absolute px-1 py-0.5 text-[10px] font-semibold"
            style={{
              left: `${cell.left * 100}%`,
              top: `${cell.top * 100}%`,
              color: "oklch(0.95 0 0)",
              textShadow: "0 0 4px oklch(0 0 0 / 90%)",
            }}
          >
            {faceLabel(cell.face, spaceKind)}
          </div>
        ))}
      </div>
      </div>

      <div className="space-y-2.5" data-tour="cropper-cross-tools">
        <p
          className="text-[11px] leading-relaxed"
          style={{ color: "oklch(0.55 0.01 265)" }}
        >
          {detected === null
            ? "그림을 읽는 중입니다."
            : detected
              ? "회색 바탕을 재서 자르는 자리를 찾았습니다. 어긋나면 선을 끌어 맞추세요."
              : "자리를 못 찾았습니다 — 바탕이 회색이 아니거나 빈칸이 채워져 있습니다. 선을 끌어 직접 맞추세요."}
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(1, Math.round((current / 1.5) * 100) / 100))}
            className="rounded-md p-1.5"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
            title="축소"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-w-0 flex-1 rounded-md py-1 text-[11px] font-semibold tabular-nums"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.78 0.01 265)" }}
            title="창에 맞추기 — Ctrl+휠로도 확대·축소합니다"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(8, Math.round(current * 1.5 * 100) / 100))}
            className="rounded-md p-1.5"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.72 0.01 265)" }}
            title="확대"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        <div className="space-y-1">
          <canvas
            ref={loupeRef}
            width={240}
            height={240}
            className="block w-full rounded-md"
            style={{ background: "oklch(0.10 0.006 265)", imageRendering: "pixelated", aspectRatio: "1 / 1" }}
          />
          <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.48 0.01 265)" }}>
            {activeLine
              ? "돋보기(8배). 고른 선은 노랑 — 방향키로 원본 1 px, Shift 와 함께면 10 px 씩 옮깁니다."
              : "선을 끌거나 누르면 그 둘레를 8배로 보여 줍니다. 누른 선은 방향키로 1 px 씩 옮길 수 있습니다."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!source) return;
            const found = detectCrossLines(source);
            setLines(found ?? DEFAULT_CROSS_LINES);
            setDetected(Boolean(found));
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold"
          style={{
            background: "oklch(1 0 0 / 6%)",
            color: "oklch(0.72 0.01 265)",
          }}
        >
          <RefreshCcw className="h-3 w-3" /> 자리 다시 찾기
        </button>

        <label
          className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-[11px] leading-relaxed"
          style={{
            background: "oklch(1 0 0 / 4%)",
            color: "oklch(0.62 0.01 265)",
          }}
        >
          <input
            type="checkbox"
            checked={flip}
            onChange={(event) => setFlip(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            <b style={{ color: "oklch(0.82 0.01 265)" }}>천장·바닥 뒤집기</b>
            <br />
            전개도에서는 «정면 쪽» 이 천장 칸의 아래 끝인데 상자에 붙일 때는 위
            끝이라야 맞습니다. 생성기가 반대로 그렸으면 끄세요.
          </span>
        </label>

        {inspection && inspection.issues.length > 0 && (
          <div role="status" className="space-y-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-[11px] leading-relaxed text-amber-200">
            <b>{t("면 비율과 경계를 확인한 뒤 저장해 주세요")}</b>
            {inspection.issues.map((issue, index) => <p key={`${issue.face}-${issue.kind}-${index}`}>{crossUnfoldWarning(issue, spaceKind)}</p>)}
            <p>{t("회색 벽도 바탕으로 감지될 수 있습니다. 추정 수치를 보고 선과 원본을 함께 확인하세요.")}</p>
          </div>
        )}
        {targetSize && <p className="text-[11px] text-muted-foreground">{t("생성 기준 방: {width} × {depth} × {height} m", { width: targetSize.width, depth: targetSize.depth, height: targetSize.height })}</p>}
        {ratio && (
          <div
            className="rounded-md p-2 text-[11px] leading-relaxed"
            style={{
              background: "oklch(1 0 0 / 4%)",
              color: "oklch(0.62 0.01 265)",
            }}
          >
            이 자리로 자르면 방 비율은{" "}
            <b style={{ color: "oklch(0.80 0.16 200)" }}>
              가로 {ratio.width.toFixed(2)} : 깊이 {ratio.depth.toFixed(2)} :
              높이 1
            </b>{" "}
            입니다. 층고를 2.4 m 로 보면 {(ratio.width * 2.4).toFixed(1)} ×{" "}
            {(ratio.depth * 2.4).toFixed(1)} × 2.4 m.
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={!source || saving || !onSaveFaces}
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-semibold disabled:opacity-40"
          style={{
            background: "oklch(0.48 0.16 290)",
            color: "oklch(0.98 0 0)",
          }}
        >
          {progress ? (
            <>
              <Grid2x2 className="h-3.5 w-3.5" /> {progress}
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />{" "}
              {saving ? "자르는 중…" : "여섯 면으로 저장"}
            </>
          )}
        </button>

        <p
          className="text-[10px] leading-relaxed"
          style={{ color: "oklch(0.45 0.01 265)" }}
        >
          주인 폴더 안 <b>6면/</b> 에 «장소_정면_001» 처럼 여섯 장이 한 번호로
          저장되어 구도잡기 «6면 세트» 에 바로 걸립니다. 칸마다 비율이 달라
          업스케일은 걸지 않습니다 — 크게 쓸 면만 저장한 뒤 따로 키우세요.
        </p>
      </div>
    </div>
  );
}
