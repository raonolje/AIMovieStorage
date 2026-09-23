import { heroImageOf } from "./cutVideoPrompt";
import type { Cut } from "./projectTypes";
import type { PromptLinkInput } from "./promptLinks";

/** 영상 글의 저장·다시 잇기·전송이 같은 외형 참조를 표시하게 합니다. 이미지용 입력은 변경하지 않습니다. */
export function cutVideoLinkInput(cut: Cut, input: PromptLinkInput): PromptLinkInput {
  return { ...input, representativeImagePath: heroImageOf(cut)?.filePath };
}

/** 영상에는 컷의 완성된 외형도 필요합니다. 그림 생성용 참조 목록에는 역으로 섞지 않습니다. */
export function magnificCutVideoReferences(cut: Cut, references: readonly string[], useRefVideo: boolean): string[] {
  return [...new Set([
    useRefVideo ? cut.refVideoPath : undefined,
    heroImageOf(cut)?.filePath,
    ...references,
  ].filter((path): path is string => Boolean(path?.trim())))];
}
