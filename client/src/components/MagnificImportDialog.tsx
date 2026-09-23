import { HOLDS_MAGNIFIC_IMPORT, useTutorialPanel } from "@/lib/useTutorialPanel";
import { useEffect, useState } from "react";
import { useEscapeClose } from "@/components/useEscapeClose";
import { Check, Download, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import {
  MODAL_BACKDROP,
  MODAL_BACKDROP_STYLE,
  MODAL_CARD_STYLE,
  modalCard,
} from "@/components/modalShell";
import { safeFileName, saveProjectMediaAsset, type ProjectAssetType } from "@/lib/mediaLibrary";
import { useMagnificStatus } from "@/lib/magnificMcp";

/**
 * **마그니픽에서 가져오기** — 이미 만들어 둔 것을 골라 카드에 붙입니다.
 *
 * # 왜 필요한가
 *
 * 마그니픽으로 뽑는 일은 **만드는 것과 집어 오는 것**이 갈려 있습니다. 만드는 쪽이
 * 끝나도 집어 오는 쪽이 어긋나면 결과가 앱에 안 들어옵니다 — 실제로 그런 일이 있었고
 * (기다리기 답의 한 겹을 못 뚫었습니다), 값을 치른 그림 일곱 장이 앱 밖에 남았습니다.
 *
 * 다시 뽑으면 같은 값을 두 번 냅니다. 그래서 **이미 있는 것을 끌어오는 길**을 둡니다.
 * 앞으로 집어 오는 쪽이 또 어긋나도 값을 잃지 않는 안전망이기도 합니다.
 *
 * # 내려받아 우리 폴더에 둡니다
 *
 * 주소만 적어 두면 안 됩니다 — 마그니픽 주소에는 **만료 시각이 박혀** 있어서(`exp=…`)
 * 며칠 뒤 그림이 통째로 깨집니다. 파일로 받아 프로젝트 폴더에 놓습니다.
 */

interface Creation {
  identifier: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  tool: string;
  status: string;
  createdAt: string;
}

export default function MagnificImportDialog({
  open,
  onClose,
  projectName,
  assetType,
  ownerName,
  stem,
  kind = "image",
  onPicked,
}: {
  open: boolean;
  onClose: () => void;
  projectName: string;
  assetType: ProjectAssetType;
  /** 폴더 주인(규칙 5). */
  ownerName: string;
  /** 파일 이름 앞부분. 안 주면 폴더 이름. */
  stem?: string;
  kind?: "image" | "video";
  /** 내려받아 폴더에 놓은 뒤 부릅니다. */
  onPicked: (filePath: string, name: string) => void;
}) {
  // 제 걸음이 아니면 스스로 닫습니다 — 위 라이트박스와 같은 규칙.
  useTutorialPanel({ open, holds: HOLDS_MAGNIFIC_IMPORT, onClose });
  const magnific = useMagnificStatus();
  const [items, setItems] = useState<Creation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [failed, setFailed] = useState("");

  const load = async (search = query) => {
    setLoading(true);
    setFailed("");
    try {
      setItems(await invoke<Creation[]>("magnific_recent", { limit: 36, query: search || null }));
    } catch (error) {
      setFailed(String(error));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && magnific.connected) void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, magnific.connected]);

  // Esc 로도 닫습니다 — 창마다 따로 적으면 새 창에서 또 빠집니다(규칙 1).
  useEscapeClose(open, onClose);

  if (!open) return null;

  /*
    영상 도구로 만든 것은 영상 자리에, 그림은 그림 자리에. 이름에 «video» 가 든 도구가
    영상입니다 — 마그니픽이 도구 이름을 그렇게 짓습니다(`text-to-image`·`image-to-video`).
  */
  const shown = items.filter((item) =>
    kind === "video" ? item.tool.includes("video") : !item.tool.includes("video"),
  );

  const take = async (item: Creation) => {
    setBusy(item.identifier);
    try {
      const base = `${safeFileName(stem || ownerName)}_마그니픽`;
      const extension = kind === "video" ? "mp4" : "png";
      /*
        자리를 먼저 잡고 그 위에 내려받습니다 — 폴더·이름·번호 규칙을 저장 쪽 한
        곳이 계속 쥐고 있게 하려는 것입니다(규칙 5). 내려받기는 그냥 덮어씁니다.
      */
      const saved = await saveProjectMediaAsset(
        new File([new Uint8Array(0)], `${base}.${extension}`, {
          type: kind === "video" ? "video/mp4" : "image/png",
        }),
        { projectName, assetType, ownerName, stem: base },
      );
      if (!saved?.path) throw new Error("놓을 자리를 만들지 못했습니다.");
      await invoke<string>("magnific_download", { url: item.url, outputPath: saved.path });
      onPicked(saved.path, saved.name || base);
      toast.success("마그니픽에서 가져왔습니다.", { description: saved.name || base });
      onClose();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={`${MODAL_BACKDROP} z-[85]`} style={MODAL_BACKDROP_STYLE}>
      <div className={modalCard("large")} style={MODAL_CARD_STYLE}>
        <div
          className="flex shrink-0 items-center gap-2 px-4 py-3"
          style={{ borderBottom: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" style={{ color: "oklch(0.88 0.01 265)" }}>
              마그니픽에서 가져오기
            </p>
            <p className="truncate text-[10px]" style={{ color: "oklch(0.50 0.01 265)" }}>
              이미 만들어 둔 것을 골라 이 카드에 붙입니다 — 다시 뽑지 않습니다
            </p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void load()}
            data-tour="shelf-import-search"
            placeholder="프롬프트로 찾기"
            className="w-48 shrink-0 rounded-md px-2.5 py-1.5 text-[11px] outline-none"
            style={{
              background: "oklch(0.11 0.007 265)",
              border: "1px solid oklch(1 0 0 / 10%)",
              color: "oklch(0.84 0.01 265)",
            }}
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-40"
            style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.74 0.13 200)" }}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            찾기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 hover:bg-white/10"
            style={{ color: "oklch(0.62 0.01 265)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="composition-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!magnific.connected && (
            <p className="py-8 text-center text-[11px]" style={{ color: "oklch(0.74 0.13 60)" }}>
              마그니픽에 연결되어 있지 않습니다 — 설정 → 마그니픽에서 «연결» 을 눌러 주세요.
            </p>
          )}
          {failed && (
            <p className="py-8 text-center text-[11px]" style={{ color: "oklch(0.76 0.15 25)" }}>
              {failed}
            </p>
          )}
          {magnific.connected && !failed && !loading && !shown.length && (
            <p className="py-8 text-center text-[11px]" style={{ color: "oklch(0.44 0.01 265)" }}>
              가져올 {kind === "video" ? "영상" : "그림"}이 없습니다.
            </p>
          )}

          {/* 앵커는 타일 하나가 아니라 격자 전체에 — 후보가 없는 날에도 밝힐 자리가 남습니다. */}
          <div data-tour="shelf-import-grid" className="grid grid-cols-4 gap-2">
            {shown.map((item) => (
              <button
                key={item.identifier}
                type="button"
                onClick={() => void take(item)}
                disabled={Boolean(busy)}
                title={item.name}
                className="group overflow-hidden rounded-lg text-left disabled:opacity-40"
                style={{ background: "oklch(0.11 0.007 265)", border: "1px solid oklch(1 0 0 / 8%)" }}
              >
                <span
                  className="flex aspect-video w-full items-center justify-center overflow-hidden"
                  style={{ background: "oklch(0.09 0.006 265)" }}
                >
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Download className="h-4 w-4" style={{ color: "oklch(0.40 0.01 265)" }} />
                  )}
                </span>
                <span className="block px-2 py-1.5">
                  <span
                    className="block truncate text-[10px]"
                    style={{ color: "oklch(0.70 0.01 265)" }}
                  >
                    {item.name || item.identifier}
                  </span>
                  <span
                    className="flex items-center gap-1 text-[10px]"
                    style={{ color: "oklch(0.44 0.01 265)" }}
                  >
                    {busy === item.identifier ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" /> 내려받는 중
                      </>
                    ) : (
                      <>
                        <Check className="h-3 w-3" /> 눌러서 가져오기
                      </>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <p
          className="shrink-0 px-4 py-2 text-[10px]"
          style={{ borderTop: "1px solid oklch(1 0 0 / 8%)", color: "oklch(0.44 0.01 265)" }}
        >
          파일로 내려받아 프로젝트 폴더에 놓습니다 — 마그니픽 주소에는 만료 시각이 박혀 있어
          주소만 적어 두면 며칠 뒤 그림이 깨집니다.
        </p>
      </div>
    </div>
  );
}
