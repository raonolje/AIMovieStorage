import { summarizeCompositionCamera } from "@/lib/composition";
import { cutVideoLinkInput } from "@/lib/cutVideoReferences";
import { cutLinkInput, cutLinkPaths } from "@/lib/promptPayloads";
import { relinkPromptText } from "@/lib/promptLinks";
import type { Background, Character, Cut } from "@/lib/projectTypes";

/**
 * 인물 선택과 프롬프트 연결을 같은 저장 변경으로 처리합니다.
 * 선택만 저장하면 이미지를 가진 인물도 본문에는 @ 없이 남아 다음 생성에서 얼굴이 바뀝니다.
 * 빈 프롬프트는 채우지 않고, 작성된 문장의 연결 부분만 갱신합니다.
 */
export function relinkCutCharacterPrompts(cut: Cut, characters: Character[], backgrounds: Background[]): Cut {
  const background = backgrounds.find((item) => item.id === cut.backgroundId);
  const summary = summarizeCompositionCamera(cut.composition, {
    heightsCm: Object.fromEntries(characters.map((item) => [item.id, item.heightCm ?? 170])),
  });
  const useComposition = cut.useComposition !== false && summary.hasComposition;
  const paths = cutLinkPaths(cut, background, useComposition);
  const imageLink = cutLinkInput({ cut, characters, background, summary, useComposition, ...paths });
  const videoLink = cutVideoLinkInput(cut, imageLink);
  const relink = (value: string | undefined, link: typeof imageLink, lang: "ko" | "en") =>
    value?.trim() ? relinkPromptText(value, link, lang) : value;
  return {
    ...cut,
    promptKo: relink(cut.promptKo, imageLink, "ko"),
    promptEn: relink(cut.promptEn, imageLink, "en"),
    videoPromptKo: relink(cut.videoPromptKo, videoLink, "ko"),
    videoPromptEn: relink(cut.videoPromptEn, videoLink, "en"),
  };
}
