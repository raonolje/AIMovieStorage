import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

/**
 * 앱 디자인에 맞춘 **값 입력 창** — `window.prompt` 를 대신합니다.
 *
 *
 *
 * `window.prompt` 는 주소창 도메인("127.0.0.1:3000의 메시지")이 그대로 뜨고, 단위도
 * 설명도 넣을 자리가 없습니다. 무빙 각도처럼 **자주 고치는 값**일수록 앱 안에서
 * 끝나야 손이 끊기지 않습니다.
 *
 * `ConfirmDialog` 와 같은 짜임입니다 — 쓰는 쪽은 await 한 줄이고, 취소하면 null 입니다.
 *
 * const value = await promptDialog({ title: "이동량", value: "90", unit: "°" });
 * if (value === null) return;
 */

export interface PromptOptions {
  title: string;
  /** 제목 아래 설명. 「지금 −2.5m」 처럼 지금 값이나 규칙을 적습니다. */
  description?: string;
  /** 처음 채워 둘 값. 열자마자 전체가 선택돼 있어 바로 덮어쓸 수 있습니다. */
  value?: string;
  /** 입력칸 오른쪽에 붙는 단위 — `m`·`°`·`초`. 글자라 계산에는 안 들어갑니다. */
  unit?: string;
  /** 숫자만 받을지. 켜면 빈 칸이나 숫자가 아닌 값으로는 확인이 안 눌립니다. */
  numeric?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

type Pending = PromptOptions & { resolve: (value: string | null) => void };

/**
 * 화면에 떠 있는 창들. **마지막에 올사용자 것**이 답합니다.
 *
 * 하나만 두면 안 되는 까닭 — 구도잡기는 Radix Dialog 안에서 열리고, Radix 는 포커스를
 * 그 Dialog 안에 **가둡니다**(`FocusScope`). Dialog 밖(앱 뿌리)에 그린 입력칸은 눌러서
 * 포커스를 줘도 Radix 가 곧바로 되가져가, **글자를 칠 수가 없었습니다**
 * (단추는 눌리는데 타이핑만
 * 안 되는 것이 이 증상의 표시였습니다).
 *
 * 그래서 구도잡기는 **자기 Dialog 안에** 창을 하나 더 둡니다. 둘이 동시에 살아 있을 때
 * 안쪽 것이 답해야 하므로 목록의 마지막을 씁니다. 닫히면 스스로 빠지고 바깥 것이
 * 다시 맡습니다.
 */
const hosts: ((pending: Pending | null) => void)[] = [];

export function promptDialog(options: PromptOptions): Promise<string | null> {
  const notify = hosts[hosts.length - 1];
  // 창이 아직 화면에 없으면(테스트 등) 막지 말고 통과시킵니다.
  if (!notify) return Promise.resolve(options.value ?? null);
  return new Promise<string | null>((resolve) => {
    notify({ ...options, resolve });
  });
}

/** 숫자 하나를 받는 지름길. 취소하거나 숫자가 아니면 null. */
export async function promptNumber(
  options: Omit<PromptOptions, "numeric" | "value"> & { value: number },
): Promise<number | null> {
  const typed = await promptDialog({
    ...options,
    numeric: true,
    value: String(options.value),
  });
  if (typed === null) return null;
  const value = Number(typed);
  return Number.isFinite(value) ? value : null;
}

/** App 안에 한 번만 놓습니다. 어디서 promptDialog 를 불러도 여기로 뜹니다. */
export function PromptDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mine = (next: Pending | null) => {
      setPending(next);
      setText(next?.value ?? "");
    };
    hosts.push(mine);
    return () => {
      const at = hosts.indexOf(mine);
      if (at >= 0) hosts.splice(at, 1);
    };
  }, []);

  /*
    열자마자 **전체 선택**. 값을 고치러 여는 창이라 대개 통째로 갈아 끼웁니다 —
    커서만 가 있으면 매번 Ctrl+A 를 눌러야 합니다.
  */
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => inputRef.current?.select(), 0);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const answer = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  if (!pending) return null;

  const accent = "oklch(0.62 0.22 290)";
  const numeric = pending.numeric === true;
  const valid = numeric
    ? Number.isFinite(Number(text)) && text.trim() !== ""
    : true;

  return (
    <div
      /*
        **가장 위에 섭니다.**

        구도잡기(Radix Dialog)가 z-50, 관절 파이 메뉴가 z-60 입니다. 값 입력 창은 그
        위에서 답을 기다리는 창이라 무엇에도 가리면 안 됩니다 — 가리면 답을 못 하는데
        뒤도 못 만지는 «멈춘 화면» 이 됩니다.
      */
      data-tutorial-layer=""
      className="fixed inset-0 z-[2147483000] flex items-center justify-center p-6"
      style={{
        background: "oklch(0 0 0 / 68%)",
        backdropFilter: "blur(3px)",
        /*
          편집 창(Radix Dialog)이 열려 있는 동안 body 에 `pointer-events: none` 이
          걸립니다. 창 밖에 그리는 이 창은 이 한 줄이 없으면 클릭을 못 받습니다
          (까닭은 `ConfirmDialog` 의 같은 자리에 자세히 적어 두었습니다).
        */
        pointerEvents: "auto",
      }}
      /*
        여기서 일어난 눌림·키는 **여기서 끝냅니다.** Radix 는 「콘텐츠 밖에서 눌렸다」 를
        «창을 닫으라» 로 읽어서, 이 창의 「취소」 가 구도잡기 창까지 닫아 버립니다.
      */
      onPointerDownCapture={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
      /*
        **입력칸에서 친 키는 건드리지 않습니다.**

        잡는 단계(capture)에서 무조건 끊었더니 구도잡기의 한 글자 단축키(G·F·A·1·2·3,
        스페이스)는 막혔지만 **입력칸으로 가는 키까지 함께 막혔습니다** — 값을 고칠 수가
        없었어요(). 창 안의 입력칸이 목표일 때는
        그대로 흘려보내고, 그 밖에서 눌린 키만 여기서 끝냅니다.
      */
      onKeyDownCapture={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) answer(null);
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl"
        style={{
          background: "oklch(0.15 0.01 265)",
          border: `1px solid ${accent}40`,
          boxShadow: "0 24px 60px oklch(0 0 0 / 55%)",
        }}
      >
        <div className="flex gap-3 px-5 pt-5">
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: `${accent}1f`,
              border: `1px solid ${accent}45`,
            }}
          >
            <Pencil className="h-4 w-4" style={{ color: accent }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-white">
              {pending.title}
            </p>
            {pending.description && (
              <p
                className="mt-1.5 text-xs leading-relaxed"
                style={{ color: "oklch(0.60 0.01 265)" }}
              >
                {pending.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 px-5">
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            /*
              Enter 로 확인, Escape 로 취소. 바깥 capture 가 키를 이미 끊어 두어서
              여기까지는 오지만 구도잡기 창으로는 안 넘어갑니다.
            */
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid) {
                event.preventDefault();
                answer(text);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                answer(null);
              }
            }}
            // 숫자칸이라도 `text` 로 둡니다 — number 칸은 휠에 값이 바뀌어 무빙이 흔들립니다.
            inputMode={numeric ? "decimal" : "text"}
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
            style={{
              background: "oklch(0.11 0.008 265)",
              border: `1px solid ${valid ? "oklch(1 0 0 / 12%)" : "oklch(0.55 0.18 25 / 60%)"}`,
              color: "oklch(0.94 0.01 265)",
            }}
          />
          {pending.unit && (
            <span
              className="shrink-0 text-xs font-semibold"
              style={{ color: "oklch(0.60 0.01 265)" }}
            >
              {pending.unit}
            </span>
          )}
        </div>

        <div
          className="mt-5 flex justify-end gap-2 px-5 py-4"
          style={{ borderTop: "1px solid oklch(1 0 0 / 7%)" }}
        >
          <button
            type="button"
            onClick={() => answer(null)}
            className="rounded-lg px-4 py-2 text-xs font-medium transition-colors hover:bg-white/10"
            style={{
              color: "oklch(0.62 0.01 265)",
              border: "1px solid oklch(1 0 0 / 12%)",
            }}
          >
            {pending.cancelLabel || "취소"}
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => answer(text)}
            className="gradient-primary rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending.confirmLabel || "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromptDialogHost;
