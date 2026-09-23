import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { checkForUpdate, installUpdate, updatesUnavailable, type UpdateInfo } from "@/lib/appUpdate";
import { isDesktopApp } from "@/lib/llm";
import { useT } from "@/lib/i18n";

/*
  **새 판이 있으면 여기 뜹니다.**

  

  # 없을 때는 아무것도 안 보입니다

  「최신입니다」 를 늘 띄우면 설정 맨 위가 그 한 줄로 채워집니다. 사람이 알고 싶은 때는
  **새 판이 있을 때**뿐이고, 궁금하면 아래 「업데이트 확인」 으로 다시 봅니다.

  # 받는 동안 창을 닫으면

  설치기는 이미 내려받은 파일로 돕니다. 다만 받는 중에 닫으면 그냥 안 받은 것이 되니,
  받는 동안에는 단추를 잠가 두 번 눌리지 않게 합니다.
*/
export default function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  // 켤 때 한 번 조용히 봅니다. 실패해도 알림을 띄우지 않습니다 —
  // 네트워크가 없는 자리에서 켤 때마다 잔소리가 됩니다.
  useEffect(() => {
    let alive = true;
    void checkForUpdate()
      .then((found) => {
        if (alive) setUpdate(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const look = async () => {
    setChecking(true);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      toast.success(found ? `새 판 ${found.version} 이 있습니다.` : "최신입니다.");
    } catch (error) {
      toast.error(`업데이트를 확인하지 못했습니다: ${error}`);
    } finally {
      setChecking(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setGot(0);
    setTotal(null);
    try {
      await installUpdate((received, size) => {
        setGot(received);
        setTotal(size);
      });
      // 여기까지 오면 앱이 다시 뜨는 중입니다 — 이 뒤의 화면은 거의 안 보입니다.
    } catch (error) {
      toast.error(`업데이트하지 못했습니다: ${error}`);
      setBusy(false);
    }
  };

  // 원본판에 «최신입니다»라고 답하면 실제 설치 버전과 공개 배포 버전을 혼동하게 됩니다.
  if (updatesUnavailable()) {
    if (!isDesktopApp()) return null;
    return (
      <p className="max-w-xl text-[11px] leading-relaxed" style={{ color: "oklch(0.60 0.01 265)" }}>
        {t("비공개 원본판은 공개판 자동 업데이트를 사용하지 않습니다. 원본 저장소에서 만든 비공개 설치본으로 업데이트해 주세요.")}
      </p>
    );
  }

  const percent = total ? Math.min(100, Math.round((got / total) * 100)) : null;

  if (!update) {
    return (
      <button
        type="button"
        onClick={look}
        disabled={checking}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold disabled:opacity-40"
        style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.60 0.01 265)" }}
      >
        <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
        {checking ? "확인 중…" : "업데이트 확인"}
      </button>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg px-4 py-3"
      style={{ background: "oklch(0.22 0.06 260)", border: "1px solid oklch(0.45 0.14 260 / 50%)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white">
          새 판 {update.version} 이 나왔습니다
          <span className="ml-1.5 font-normal" style={{ color: "oklch(0.62 0.01 265)" }}>
            (지금 {update.current})
          </span>
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "oklch(0.62 0.01 265)" }}>
          {busy
            ? percent === null
              ? `받는 중… ${(got / 1e6).toFixed(1)} MB`
              : `받는 중… ${percent}%`
            : "받아서 깔고 앱이 스스로 다시 뜹니다. 관리자 권한은 묻지 않습니다."}
        </p>
        {update.notes && !busy && (
          <p
            className="mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed"
            style={{ color: "oklch(0.55 0.01 265)" }}
          >
            {update.notes}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
        style={{ background: "oklch(0.55 0.18 265)" }}
      >
        <Download className="h-3.5 w-3.5" />
        {busy ? "업데이트 중…" : "업데이트"}
      </button>
    </div>
  );
}
