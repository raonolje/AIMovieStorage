import { appendPromptHistory } from "@/lib/promptHistory";
import type { Scene } from "@/lib/projectTypes";

/** API·대화 조종기 어느 쪽이 다시 써도 직전 수동 편집과 받은 답을 남깁니다. */
export function withStoryboardPrompt(
  current: Scene,
  result: { ko: string; en: string },
  note: string,
): Partial<Scene> {
  let history = current.storyboardPromptHistory;
  if (current.storyboardPromptKo?.trim() || current.storyboardPromptEn?.trim()) {
    history = appendPromptHistory(history, {
      ko: current.storyboardPromptKo || "",
      en: current.storyboardPromptEn || "",
      negativeKo: "",
      negativeEn: "",
      note: "덮어쓰기 전",
    });
  }
  return {
    storyboardPromptKo: result.ko,
    storyboardPromptEn: result.en,
    storyboardPromptHistory: appendPromptHistory(history, {
      ko: result.ko,
      en: result.en,
      negativeKo: "",
      negativeEn: "",
      note,
    }),
  };
}
