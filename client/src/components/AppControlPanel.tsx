import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Plug, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { isDesktopApp } from "@/lib/llm";
import { whenAppControlReady } from "@/lib/appControl";

interface ControlStatus {
  enabled: boolean;
  command: string;
  args: string[];
  edition: "public" | "private";
}

/** 연결 설정만 보여 줍니다. 다른 앱의 설정 파일을 덮어쓰지 않습니다. */
export default function AppControlPanel() {
  const t = useT();
  const desktop = isDesktopApp();
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [client, setClient] = useState<"claude" | "codex">("claude");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void invoke<ControlStatus>("control_status")
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [desktop]);

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      setStatus(await invoke<ControlStatus>("control_status"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!status || busy) return;
    setBusy(true);
    setError("");
    try {
      const enabled = !status.enabled;
      // 이벤트를 받을 편집기가 준비된 뒤에만 문을 엽니다. 먼저 열면 첫 명령이 시간 초과로 끝납니다.
      if (enabled) await whenAppControlReady();
      const result = await invoke<{ enabled: boolean }>("control_enable", {
        enabled,
      });
      setStatus((current) =>
        current ? { ...current, enabled: result.enabled } : current,
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const config = status
    ? client === "claude"
      ? JSON.stringify(
          {
            mcpServers: {
              aimoviestorage: { command: status.command, args: status.args },
            },
          },
          null,
          2,
        )
      : `[mcp_servers.aimoviestorage]\ncommand = ${JSON.stringify(status.command)}\nargs = ${JSON.stringify(status.args)}\n`
    : "";

  const copy = async () => {
    setCopied(false);
    setError("");
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
    } catch {
      setError(
        t("복사하지 못했습니다. 아래 설정을 선택해 직접 복사해 주세요."),
      );
    }
  };

  return (
    <section
      className="space-y-3 rounded-xl p-4"
      aria-labelledby="app-control-title"
      style={{
        background: "oklch(0.14 0.009 265)",
        border: "1px solid oklch(1 0 0 / 8%)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Plug
          className="h-4 w-4 shrink-0"
          style={{ color: "oklch(0.76 0.13 195)" }}
        />
        <h2 id="app-control-title" className="text-sm font-semibold text-white">
          {t("대화로 앱 조종하기")}
        </h2>
        {status && (
          <span className="rounded px-2 py-0.5 text-[10px] text-slate-300">
            {status.edition === "public" ? t("공개판") : t("비공개판")}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        {t(
          "Claude Desktop·Codex에서 대화하며 이 앱의 프로젝트를 읽고 수정합니다. 이 연결에는 별도 LLM API 키가 필요하지 않습니다.",
        )}
      </p>
      {!desktop ? (
        <p className="text-xs text-slate-400">
          {t("앱 조종기는 데스크톱 앱에서 연결할 수 있습니다.")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={busy || !status}
              aria-pressed={status?.enabled ?? false}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
              style={{
                background: status?.enabled
                  ? "oklch(0.35 0.04 195)"
                  : "oklch(0.48 0.12 195)",
              }}
            >
              {busy
                ? t("연결 상태 변경 중…")
                : status?.enabled
                  ? t("앱 조종 끄기")
                  : t("앱 조종 켜기")}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-slate-300 disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" />
              {t("상태 새로고침")}
            </button>
            <span role="status" className="text-[11px] text-slate-400">
              {status
                ? status.enabled
                  ? t("앱 조종 요청을 받을 수 있습니다.")
                  : t("앱 조종이 꺼져 있습니다.")
                : error
                  ? t("연결 상태를 확인하지 못했습니다.")
                  : t("연결 상태 확인 중…")}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {t(
              "연결한 대화에서 프로젝트를 수정하거나 생성 작업을 시작할 수 있습니다. 작업하는 동안 이 앱을 켜 두세요.",
            )}
          </p>
          {status && (
            <details className="rounded-lg border border-white/10 p-3" open>
              <summary className="cursor-pointer text-xs font-semibold text-slate-200">
                {t("대화 앱 연결 설정")}
              </summary>
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="text-[11px] text-slate-300"
                    htmlFor="app-control-client"
                  >
                    {t("연결할 대화 앱")}
                  </label>
                  <select
                    id="app-control-client"
                    value={client}
                    onChange={(event) => {
                      setClient(event.target.value as "claude" | "codex");
                      setCopied(false);
                    }}
                    className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="claude">Claude Desktop · JSON</option>
                    <option value="codex">Codex · TOML</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="ml-auto flex items-center gap-1 rounded-md bg-white/5 px-2 py-1.5 text-[11px] text-slate-200"
                  >
                    {copied ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copied
                      ? t("연결 설정을 복사했습니다.")
                      : t("연결 설정 복사")}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={config}
                  rows={client === "claude" ? 10 : 4}
                  aria-label={t("앱 조종 연결 설정")}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full rounded-md border border-white/10 bg-black/20 p-2 font-mono text-[11px] text-slate-300"
                />
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {t(
                    "이 내용을 대화 앱의 MCP 설정에 추가하세요. 기존 서버 설정은 유지하고, 설정을 바꾼 뒤 대화 앱의 연결을 다시 시작하세요.",
                  )}
                </p>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {t(
                    "공개판과 비공개판은 각각 실행 중인 앱의 연결 설정을 사용합니다. 설치 위치가 바뀌면 다시 복사하세요.",
                  )}
                </p>
                <a
                  href={
                    client === "claude"
                      ? "https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop"
                      : "https://developers.openai.com/codex/mcp"
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-cyan-300 underline"
                >
                  {t("공식 MCP 연결 안내")}
                </a>
              </div>
            </details>
          )}
        </>
      )}
      {error && (
        <p
          role="alert"
          className="break-words text-[11px] leading-relaxed text-red-300"
        >
          {error}
        </p>
      )}
    </section>
  );
}
