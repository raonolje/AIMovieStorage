import { heroImageOf } from "./cutVideoPrompt";
import type { Cut } from "./projectTypes";
import type { Character } from "./projectTypes";
import { cutVoiceReferences } from "./characterVoice";
import type { PromptLinkInput } from "./promptLinks";
import { musicOf } from "./compositionEdit";
import type { CutContinuity } from "./cutContinuity";

export function magnificCutAudioReference(cut: Cut, useRefVideo: boolean, musicEnabled: boolean): string | undefined {
  if (!musicEnabled || !useRefVideo || !cut.refVideoPath || !cut.composition || !musicOf(cut.composition)) return undefined;
  const audioPath = cut.refVideoAudioPath ?? cut.composition.renders?.find((render) => render.path === cut.refVideoPath)?.audioPath;
  if (!audioPath) throw new Error("선택한 구도잡기 영상에 같은 구간의 음원이 없습니다. 음악을 켠 채 레퍼런스 영상을 다시 렌더링하고 그 영상을 고르세요.");
  return audioPath;
}

/** 영상 글의 저장·다시 잇기·전송이 같은 외형 참조를 표시하게 합니다. 이미지용 입력은 변경하지 않습니다. */
export function cutVideoLinkInput(cut: Cut, input: PromptLinkInput, continuity?: CutContinuity | null, characters: readonly Character[] = []): PromptLinkInput {
  return { ...input, representativeImagePath: heroImageOf(cut)?.filePath,
    continuityVideoPath: continuity?.videoPath, continuityEndFramePath: continuity?.mode === "continue" ? continuity.endFramePath : undefined,
    voiceReferencePaths: cutVoiceReferences(cut, characters) };
}

/** 영상에는 컷의 완성된 외형도 필요합니다. 그림 생성용 참조 목록에는 역으로 섞지 않습니다. */
export function magnificCutVideoReferences(cut: Cut, references: readonly string[], useRefVideo: boolean, musicEnabled = false, continuity?: CutContinuity | null, characters: readonly Character[] = []): string[] {
  return [...new Set([
    continuity?.videoPath,
    continuity?.mode === "continue" ? continuity.endFramePath : undefined,
    useRefVideo ? cut.refVideoPath : undefined,
    magnificCutAudioReference(cut, useRefVideo, musicEnabled),
    ...cutVoiceReferences(cut, characters),
    heroImageOf(cut)?.filePath,
    ...references,
  ].filter((path): path is string => Boolean(path?.trim())))];
}
