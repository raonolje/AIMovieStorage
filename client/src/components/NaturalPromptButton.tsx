import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { requestJsonFromLlm } from "@/lib/promptRequest";
import { hasOrders, missingSignal, plainify } from "@/lib/naturalPrompt";
import type { ProjectContextSummary } from "@/lib/projectContext";

/**
 * **프롬프트 말로 바꾸기** — 평소 말투로 적은 글을 생성기가 알아듣는 말로.
 *
 * # 왜 «안내문» 이 아니라 단추인가
 *
 * 「감정 이름만 적지 마세요」·「명령형을 쓰지 마세요」 를 문서에 적어 두는 것은 규칙을
 * **사람에게 떠넘기는** 일입니다. 적는 사람은 연출을 생각하지 프롬프트 문법을
 * 생각하지 않습니다. 「슬프게 말해」 라고 적는 것이 정상입니다.
 *
 * # 공통 단추입니다 (규칙 1)
 *
 * 대사·연기 칸에만 있고 VFX 칸에는 없으면 안 됩니다. 컷·장면·카드가 **같은 하나**를
 * 씁니다. `kind` 만 다릅니다.
 *
 * # 덮어쓰기 전에 보여 줍니다
 *
 * 바로 갈아 끼우지 않습니다 — 바꾼 글과 «무엇을 왜 바꿨는지» 를 먼저 보여 주고,
 * 사람이 «이대로» 를 눌러야 들어갑니다. 말없이 고치면 「내가 적은 것과 다른데」 가 됩니다.
 */
export default function NaturalPromptButton({
  text,
  kind,
  isVideo,
  seconds,
  shot,
  people,
  context,
  onApply,
}: {
  /** 사람이 적어 둔 글. 비어 있으면 단추가 안 보입니다. */
  text: string;
  /**
   * 무엇을 적은 글인가. 요청 문구(`natural-to-prompt.md`)가 이 값으로 다듬는 결을 바꿉니다.
   *
   * `background` 는 «환경이 스스로 하는 움직임»(구름·지나가는 차·물결)이라 `vfx` 와 다릅니다 —
   * 효과 쪽 결로 다듬으면 규모·난류·열 아지랑이 같은 폭발 낱말이 붙어 배경이 출렁입니다.
   */
  kind: "acting" | "vfx" | "background" | "scene";
  /** 영상으로 뽑을 것인가. 거짓이면 정지 그림입니다 — 적을 것이 다릅니다. */
  isVideo?: boolean;
  seconds?: number;
  /** 샷 크기. 풀샷이면 눈꺼풀을 지시해 봐야 그릴 자리가 없습니다. */
  shot?: string;
  people?: string[];
  context?: ProjectContextSummary | null;
  /**
   * 바꾼 글을 칸에 넣는 자리.
   *
   * **영어판도 함께** 넘깁니다. 한국어 칸만 고치면 정작 생성기에 가는 영문에는 여전히
   * 한국어가 실려서, 고생해서 다듬은 말이 무시됩니다(). 부르는 쪽이 영어판을 들고 있다가 영문 프롬프트에 그대로 씁니다.
   */
  onApply: (ko: string, en: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ko: string; en: string; notes: string[] } | null>(null);

  const body = text.trim();
  if (!body) return null;

  /*
    LLM 을 부르기 전에 **규칙으로 먼저** 봅니다. 명령형 말꼬리처럼 틀릴 수 없는 것은
    여기서 바로 잡히고, 그러면 기다릴 까닭이 없습니다. API 키가 없어도 이만큼은 됩니다.
  */
  const quick = plainify(body);
  const signal = missingSignal(body);
  const worthAsking = hasOrders(body) || Boolean(signal) || body.length > 8;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const made = await requestJsonFromLlm<{ ko?: string; en?: string; notes?: string[] }>({
        task: "naturalPrompt",
        template: "natural-to-prompt",
        label: `${
          kind === "acting" ? "연기" : kind === "vfx" ? "효과" : kind === "background" ? "배경 움직임" : "상황"
        } · 프롬프트 말로`,
        data: {
          text: body,
          kind,
          isVideo: Boolean(isVideo),
          seconds: seconds ?? null,
          shot: shot ?? null,
          people: people ?? [],
          project: context?.facts ?? null,
        },
      });
      const ko = (made.ko || "").trim();
      if (!ko) {
        toast.message("바꿀 것이 없습니다.");
        return;
      }
      setResult({ ko, en: (made.en || "").trim(), notes: made.notes ?? [] });
    } catch (error) {
      /*
        **실패해도 빈손으로 두지 않습니다.** 규칙으로 잡히는 만큼은 내놓습니다 —
        API 키가 없거나 요청이 끊겼을 때 아무것도 못 하면 단추가 있으나 마나입니다.
      */
      if (quick.changed.length) {
        setResult({ ko: quick.text, en: "", notes: quick.changed });
        toast.message("규칙으로 바꿀 수 있는 것만 바꿨습니다.", {
          description: String(error),
        });
      } else {
        toast.error(String(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title={
          worthAsking
            ? "평소 말투로 적은 글을 생성기가 알아듣는 말로 바꿉니다. 바꾸기 전에 보여 줍니다"
            : "적은 글이 짧습니다. 그대로 써도 됩니다"
        }
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
        style={{
          background: worthAsking ? "oklch(0.62 0.22 290 / 20%)" : "oklch(1 0 0 / 6%)",
          color: worthAsking ? "oklch(0.84 0.16 290)" : "oklch(0.55 0.01 265)",
        }}
      >
        {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
        프롬프트 말로
      </button>

      {result && (
        <div
          className="mt-1 rounded-md px-2 py-2"
          style={{
            background: "oklch(0.14 0.01 265)",
            border: "1px solid oklch(0.62 0.22 290 / 34%)",
          }}
        >
          <p className="mb-1 text-[9px] font-semibold" style={{ color: "oklch(0.72 0.06 290)" }}>
            이렇게 바꿉니다
          </p>
          <p className="mb-1.5 whitespace-pre-wrap text-[11px]" style={{ color: "oklch(0.88 0.01 265)" }}>
            {result.ko}
          </p>
          {result.notes.length > 0 && (
            <ul className="mb-1.5 space-y-0.5">
              {result.notes.map((note, index) => (
                <li key={index} className="text-[9px]" style={{ color: "oklch(0.58 0.01 265)" }}>
                  · {note}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                onApply(result.ko, result.en);
                setResult(null);
                toast.success("프롬프트 말로 바꿨습니다.");
              }}
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ background: "oklch(0.62 0.22 290 / 30%)", color: "oklch(0.88 0.16 290)" }}
            >
              이대로
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="rounded px-1.5 py-0.5 text-[9px]"
              style={{ background: "oklch(1 0 0 / 6%)", color: "oklch(0.58 0.01 265)" }}
            >
              그냥 두기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
