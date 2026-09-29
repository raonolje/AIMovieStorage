import { appendPromptHistory } from "@/lib/promptHistory";
import type { Cut } from "@/lib/projectTypes";

/** 영상 두 칸도 이미지 프롬프트처럼 다시 받은 판과 수동으로 다듬은 판을 남깁니다. */
export function withCutVideoPrompt(current: Cut, result: { ko: string; en: string }, note: string): Partial<Cut> {
  let history = current.videoPromptHistory;
  if (current.videoPromptKo?.trim() || current.videoPromptEn?.trim())
    history = appendPromptHistory(history, {
      ko: current.videoPromptKo || "", en: current.videoPromptEn || "",
      negativeKo: "", negativeEn: "", note: "덮어쓰기 전",
    });
  return {
    videoPromptKo: result.ko,
    videoPromptEn: result.en,
    videoPromptHistory: appendPromptHistory(history, {
      ko: result.ko, en: result.en, negativeKo: "", negativeEn: "", note,
    }),
  };
}
