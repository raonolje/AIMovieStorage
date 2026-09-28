import { useState, type ReactNode } from "react";
import { getLocale, hasSavedLocale, LOCALES, setLocale, type Locale } from "@/lib/i18n";

const COPY: Record<Locale, { title: string; detail: string; next: string }> = {
  ko: { title: "앱 언어를 선택하세요", detail: "선택한 언어로 화면과 튜토리얼을 표시합니다. 설정에서 언제든 바꿀 수 있습니다.", next: "시작하기" },
  en: { title: "Choose your app language", detail: "The interface and tutorials will use this language. You can change it later in Settings.", next: "Continue" },
  ja: { title: "アプリの言語を選択", detail: "画面とチュートリアルの言語です。設定からいつでも変更できます。", next: "続ける" },
  zh: { title: "选择应用语言", detail: "界面和教程将使用此语言。之后可在设置中更改。", next: "继续" },
};

export default function FirstRunLanguage({ children }: { children: ReactNode }) {
  const [needsChoice, setNeedsChoice] = useState(() =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && !hasSavedLocale(),
  );
  const [selected, setSelected] = useState<Locale>(getLocale);

  if (!needsChoice) return <>{children}</>;
  const copy = COPY[selected];
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-card p-6 shadow-2xl">
        <div className="mb-5 text-xs tracking-widest text-white/50">AIMovieStorage</div>
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-white/65">{copy.detail}</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {LOCALES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={selected === id}
              onClick={() => setSelected(id)}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                selected === id ? "border-violet-400 bg-violet-500/20" : "border-white/15 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { setLocale(selected); setNeedsChoice(false); }}
          className="mt-6 w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500"
        >
          {copy.next}
        </button>
      </div>
    </main>
  );
}
