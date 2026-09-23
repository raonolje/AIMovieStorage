import { SURFACE_BOX, SURFACE_MEDIA } from "@/lib/imageSurface";
import { Eraser, Eye, Redo2, RefreshCw, Scissors, Undo2 } from "lucide-react";
import type { RefObject } from "react";
import { ERASE_COLOR, boxRect, cropColor, type BoxMode, type CropBox } from "@/lib/cropBoxes";

/**
 * **그리기 면** — 시트를 띄우고 그 위에 자를 칸·지울 자리를 끌어 그립니다.
 *
 * 2026-09-18 에 `SheetPanelCropper.tsx` 에서 떼어 냈습니다. 그림 한 장과 그 위의
 * 상자들, 그리고 바로 아래 «자르기/지우기·되돌리기» 줄까지가 한 덩이입니다 —
 * 오른쪽의 «저장될 파일» 목록과 섞여 있으면 어느 손잡이가 그리기에 걸린 것인지
 * 읽어 낼 수가 없었습니다.
 */
export default function CropperSurface({
  surfaceRef,
  surfaceSrc,
  visible,
  previewing,
  setPreviewing,
  preview,
  eraseBoxes,
  boxes,
  previewState,
  mode,
  setMode,
  undo,
  redo,
  canUndo,
  canRedo,
  startDraw,
  moveDraw,
  endDraw,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>;
  /** 지금 띄울 그림 — 미리보기를 켜면 «지운 판» 이 옵니다(크기가 원본과 같습니다). */
  surfaceSrc: string;
  /** 그려 둔 상자 + 지금 끌고 있는 상자. */
  visible: CropBox[];
  previewing: boolean;
  setPreviewing: (next: boolean) => void;
  preview: { url?: string } | null;
  eraseBoxes: CropBox[];
  boxes: CropBox[];
  previewState: "idle" | "waiting" | "building" | "ready" | "error";
  mode: BoxMode;
  setMode: (next: BoxMode) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  startDraw: (event: React.PointerEvent) => void;
  moveDraw: (event: React.PointerEvent) => void;
  endDraw: () => void;
}) {
  return (
    <div data-tour="cropper-surface">
        <div
          ref={surfaceRef}
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerCancel={endDraw}
          /*
            **창에 들어가는 만큼만 키웁니다.**

            예전에는 `w-full` 이라 그림을 **칸 너비에 맞춰 늘였습니다.** 창이 넓으면 1024px 짜리
            세로 그림이 1450px 로 부풀어 세로가 2000px 을 넘고, 아래 띠(저장·닫기)가 화면 밖으로
            밀렸습니다. 이제 그림을 제 크기 넘게 늘리지 않고(`max-w-full`) 높이도 창 안에 묶습니다.

            상자 자리는 이 div 를 100% 로 보는 **백분율**이라, div 가 그림과 **딱 같은 크기**여야
            합니다 — 그래서 `w-fit` 으로 그림에 맞춰 줄이고 가운데로 놓습니다.
          */
          className={`${SURFACE_BOX} cursor-crosshair overflow-hidden rounded-lg`}
          style={{
            background: "oklch(0.10 0.006 265)",
            border: "1px solid oklch(1 0 0 / 10%)",
            touchAction: "none",
          }}
        >
          {/*
          미리보기를 켜면 원본 자리에 «지운 판» 이 옵니다. 크기가 원본과 같아 위에 그린
          상자가 그대로 맞고, 그 상태에서 계속 그리고 고칠 수 있습니다.
        */}
          <img
            src={surfaceSrc}
            alt=""
            draggable={false}
            className={SURFACE_MEDIA}
          />
          {visible.map((box, index) => {
            const rect = boxRect(box);
            const erasing = box.mode === "erase";
            // 지우기는 색을 하나로 고정합니다. 자르기 상자와 헷갈리면
            // 무엇이 파일로 나오는지 알 수 없게 됩니다.
            const color = erasing ? ERASE_COLOR : cropColor(index);
            return (
              <div
                key={box.id}
                className="pointer-events-none absolute"
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  border: `2px ${erasing ? "dashed" : "solid"} ${color}`,
                  // 미리보기에서는 지운 자리를 덮지 않습니다 — 덮으면 어떻게 지워졌는지 안 보입니다.
                  background:
                    erasing && !(previewing && preview?.url)
                      ? "oklch(0.55 0.20 15 / 22%)"
                      : "transparent",
                }}
              >
                <span
                  className="absolute -top-5 left-0 rounded px-1 text-[10px] font-bold text-white"
                  style={{ background: color }}
                >
                  {erasing ? "지움" : `${index + 1} ${box.name}`}
                </span>
              </div>
            );
          })}

          {/* 원본 / 미리보기 토글. 그리기 면 위에 얹혀 있으니 눌러도 상자가 그려지지 않게 막습니다. */}
          {eraseBoxes.length > 0 && (
            <div
              className="absolute right-2 top-2 z-10 flex cursor-default rounded-md p-0.5 text-[10px] font-semibold"
              style={{
                background: "oklch(0.12 0.008 265 / 88%)",
                border: "1px solid oklch(1 0 0 / 12%)",
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
            >
              {[
                { on: false, label: "원본" },
                { on: true, label: "미리보기" },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setPreviewing(item.on)}
                  className="flex items-center gap-1 rounded px-2 py-1"
                  style={{
                    background:
                      previewing === item.on
                        ? "oklch(1 0 0 / 12%)"
                        : "transparent",
                    color:
                      previewing === item.on
                        ? "oklch(0.84 0.16 290)"
                        : "oklch(0.55 0.01 265)",
                  }}
                >
                  {item.on && <Eye className="h-3 w-3" />} {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* 지금 그리면 무엇이 되는지. 손짓이 같아서 표시가 없으면 헷갈립니다. */}
          <div
            className="flex rounded-md p-0.5"
            style={{ background: "oklch(0.18 0.012 265)" }}
          >
            {[
              {
                id: "crop" as const,
                label: "자르기",
                icon: Scissors,
                tint: "oklch(0.84 0.16 290)",
              },
              {
                id: "erase" as const,
                label: "지우기",
                icon: Eraser,
                tint: "oklch(0.75 0.19 15)",
              },
            ].map((item) => {
              const on = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold"
                  style={{
                    background: on ? "oklch(1 0 0 / 10%)" : "transparent",
                    color: on ? item.tint : "oklch(0.50 0.01 265)",
                  }}
                >
                  <item.icon className="h-3 w-3" /> {item.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            data-tour="cropper-undo"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-30"
            style={{
              background: "oklch(1 0 0 / 5%)",
              color: "oklch(0.72 0.01 265)",
            }}
          >
            <Undo2 className="h-3 w-3" /> 되돌리기
            <span style={{ color: "oklch(0.45 0.01 265)" }}>Ctrl+Z</span>
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-30"
            style={{
              background: "oklch(1 0 0 / 5%)",
              color: "oklch(0.72 0.01 265)",
            }}
          >
            <Redo2 className="h-3 w-3" /> 다시 하기
            <span style={{ color: "oklch(0.45 0.01 265)" }}>
              Ctrl+Shift+Z
            </span>
          </button>
          {/* 미리보기가 지금 상자들과 맞는지. 만드는 중에 저장을 누르면 저장이 마저 굽습니다. */}
          {boxes.length > 0 && (
            <span
              className="ml-auto flex items-center gap-1 text-[10px]"
              style={{ color: "oklch(0.50 0.01 265)" }}
            >
              {previewState === "waiting" ||
              previewState === "building" ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" /> 미리보기
                  만드는 중…
                </>
              ) : previewState === "error" ? (
                <span style={{ color: "oklch(0.70 0.19 15)" }}>
                  미리보기를 만들지 못했습니다
                </span>
              ) : previewState === "ready" ? (
                "미리보기 준비됨"
              ) : null}
            </span>
          )}
        </div>
        <p
          className="mt-2 text-[11px] leading-relaxed"
          style={{ color: "oklch(0.45 0.01 265)" }}
        >
          잘라낼 칸을 사각형으로 끌어 그리세요. 여러 개를 한 번에 그릴 수
          있습니다. 자른 그림은 화면 크기가 아니라 <b>원본 해상도</b>로
          저장됩니다.{" "}
          <b style={{ color: "oklch(0.70 0.19 15)" }}>지우기</b>는 시키지
          않은 물건 — 손에 쥔 기계, 떠도는 소품 — 을 둘레 색으로 덮습니다.
          지우기가 먼저 적용되므로, 같은 창에서 지우고 바로 그 칸을
          잘라내면 잘라낸 그림에도 반영됩니다. 그린 뒤 잠시 기다리면
          오른쪽 <b>저장될 파일</b>에 결과가 미리 보이고, 그리기 면의
          «미리보기» 로 지운 판을 통째로 볼 수 있습니다.{" "}
          <b>«저장» 을 누르기 전에는 파일이 생기지 않습니다.</b>
        </p>
    </div>
  );
}
