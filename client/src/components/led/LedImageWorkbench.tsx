import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import {
  defaultLedSettings,
  ledImageStorageKey,
  normalizeLedSettings,
  type LedGuideSettings,
} from "@/lib/ledGuides";
import { useUndoStack } from "@/lib/useUndoStack";
import { isTypingTarget } from "@/lib/isTypingTarget";
import LedGuideOverlay from "./LedGuideOverlay";
import LedGuidePanel from "./LedGuidePanel";
import LedPerspectivePreview from "./LedPerspectivePreview";

export default function LedImageWorkbench({
  imageSrc,
  storageKey,
}: {
  imageSrc: string;
  storageKey: string;
}) {
  const t = useT();
  const key = `aimoviestorage.led-image.v1:${ledImageStorageKey("image", storageKey)}`;
  const history = useUndoStack<LedGuideSettings>(
    () => {
      try {
        const raw = localStorage.getItem(key);
        return raw
          ? normalizeLedSettings(JSON.parse(raw))
          : defaultLedSettings();
      } catch {
        return defaultLedSettings();
      }
    },
    { limit: 50 },
  );
  const [aspect, setAspect] = useState(16 / 9);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(history.value));
    } catch {
      toast.error(
        t(
          "작업 중 LED 배치를 저장하지 못했습니다. 공용 배치 파일로 내보내 주세요.",
        ),
      );
    }
  }, [key, history.value, t]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTypingTarget(e.target)) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? history.redo() : history.undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.undo, history.redo]);
  return (
    <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-2 flex gap-2">
          <button
            className="rounded border px-2 py-1 text-xs"
            onClick={history.undo}
            disabled={!history.canUndo}
          >
            {t("되돌리기")}
          </button>
          <button
            className="rounded border px-2 py-1 text-xs"
            onClick={history.redo}
            disabled={!history.canRedo}
          >
            {t("다시 실행")}
          </button>
        </div>
        <div
          className="relative mx-auto overflow-hidden bg-black"
          style={{
            aspectRatio: String(aspect),
            width: `min(100%, calc(65vh * ${aspect}))`,
          }}
        >
          <img
            src={imageSrc}
            alt={t("LED 크롭 확인용 원본")}
            className="block h-full w-full"
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight);
            }}
          />
          <LedGuideOverlay
            settings={history.value}
            aspect={aspect}
            onChange={history.set}
          />
        </div>
        <p className="mt-2 text-xs text-white/60">
          {t(
            "원본 이미지의 전체 화면 위에서 확인합니다. 크롭 가이드는 원본을 수정하지 않습니다.",
          )}
        </p>
        {history.value.perspective.enabled && (
          <LedPerspectivePreview imageSrc={imageSrc} settings={history.value} />
        )}
      </div>
      <LedGuidePanel
        settings={history.value}
        aspect={aspect}
        onChange={history.set}
      />
    </div>
  );
}
