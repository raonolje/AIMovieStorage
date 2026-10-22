import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import type { LedGuideSettings } from "@/lib/ledGuides";
import { warpLedPixels } from "@/lib/ledPerspective";

export default function LedPerspectivePreview({
  imageSrc,
  settings,
}: {
  imageSrc: string;
  settings: LedGuideSettings;
}) {
  const t = useT();
  const [id, setId] = useState(settings.guides[0]?.id ?? "");
  const [width, setWidth] = useState(1024);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const guide = settings.guides.find((g) => g.id === id) ?? settings.guides[0];
  const height = guide
    ? Math.max(1, Math.round((width * guide.ratioHeight) / guide.ratioWidth))
    : 1;
  useEffect(() => {
    setReady(false);
    setError("");
    if (!guide) return;
    if (height > 4096 || width * height > 16_777_216) {
      setError("출력 높이가 4096픽셀을 넘습니다. 가로 픽셀 수를 줄이세요.");
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      try {
        // 대형 원본도 미리보기 때문에 메모리를 과도하게 쓰지 않게 읽기 크기를 제한합니다.
        const scale = Math.min(
          1,
          4096 / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const input = document.createElement("canvas");
        input.width = Math.max(1, Math.round(image.naturalWidth * scale));
        input.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = input.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error();
        ctx.drawImage(image, 0, 0, input.width, input.height);
        const pixels = warpLedPixels(
          ctx.getImageData(0, 0, input.width, input.height).data,
          input.width,
          input.height,
          settings,
          guide,
          width,
          height,
        );
        const target = canvas.current;
        if (!target) return;
        target.width = width;
        target.height = height;
        const dest = target.getContext("2d");
        if (!dest) throw new Error();
        const frame = dest.createImageData(width, height);
        frame.data.set(pixels);
        dest.putImageData(frame, 0, 0);
        setReady(true);
      } catch (e) {
        setError(
          e instanceof Error && e.message.includes("패널")
            ? e.message
            : "이미지를 보정하지 못했습니다. 로컬 원본과 출력 크기를 확인하세요.",
        );
      }
    };
    image.onerror = () => {
      if (!cancelled)
        setError("원본 이미지를 읽지 못했습니다. 로컬 이미지를 사용하세요.");
    };
    image.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc, settings, guide, width, height]);
  return (
    <section
      className="mt-4 space-y-2 rounded border border-white/20 p-3"
      data-led-warp-preview
    >
      <h3 className="text-sm">{t("패널별 투시 보정 이미지")}</h3>
      <p className="text-xs text-white/60">
        {t(
          "원본을 관객 기준의 목표 화면으로 보고, 선택한 물리 패널의 픽셀 위치에 맞춰 역보정합니다. 원본은 바꾸지 않습니다. 영역이 겹쳐도 패널별로 따로 내보냅니다.",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label={t("보정 출력 패널")}
          className="rounded border bg-black p-1"
          value={guide?.id ?? ""}
          onChange={(e) => setId(e.target.value)}
        >
          {settings.guides.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label>
          {t("출력 가로 (px)")}{" "}
          <input
            aria-label={t("출력 가로 (px)")}
            className="w-24 rounded border bg-black p-1"
            type="number"
            min={64}
            max={4096}
            step={1}
            value={width}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isInteger(n) && n >= 64 && n <= 4096) setWidth(n);
            }}
          />
        </label>
        <span>
          {width} × {height}
        </span>
        <button
          className="rounded border px-2 py-1 disabled:opacity-40"
          disabled={!ready || !!error}
          onClick={() => {
            const snapshot = canvas.current;
            if (!snapshot || !guide) return;
            snapshot.toBlob((blob) => {
              if (!blob) {
                toast.error(t("보정 이미지를 저장하지 못했습니다."));
                return;
              }
              const url = URL.createObjectURL(blob),
                link = document.createElement("a");
              link.href = url;
              link.download = `LED-${guide.name.replace(/[<>:"/\\|?*]/g, "_")}-corrected.png`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, "image/png");
          }}
        >
          {t("보정 PNG 내보내기")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-amber-300">
          {t(error)}
        </p>
      )}
      {!ready && !error && guide && (
        <p role="status" className="text-xs">
          {t("투시 보정 계산 중…")}
        </p>
      )}
      <canvas
        ref={canvas}
        aria-label={t("가이드 없는 투시 보정 출력 미리보기")}
        className={
          ready && !error ? "max-h-[45vh] max-w-full bg-black" : "hidden"
        }
      />
      <p className="text-xs text-white/50">
        {t(
          "원본 밖은 검정으로 채웁니다. 가이드와 배우 실루엣은 PNG에 포함되지 않습니다. LED 프로세서에서 같은 워핑을 중복 적용하지 마세요.",
        )}
      </p>
    </section>
  );
}
