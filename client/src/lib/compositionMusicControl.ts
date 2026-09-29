import { z } from "zod";
import { listBgmChoices } from "./bgmLibrary";
import { measureAudioSeconds } from "./audioDuration";
import { setMusicIn } from "./compositionEdit";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";

export const compositionMusicUseSchema = compositionSessionRequestSchema.extend({ path: z.string().min(1).max(4000) }).strict();

/** 파일 길이를 앱이 직접 재므로 LLM이 추측한 초 수를 타임라인에 저장하지 않습니다. */
export async function useCompositionBgm(raw: unknown) {
  const request = compositionMusicUseSchema.parse(raw);
  return applyCompositionMutation({ sessionId: request.sessionId, expectedRevision: request.expectedRevision, detail: request.detail }, async ({ state, context }) => {
    const choice = listBgmChoices().find((item) => item.path === request.path);
    if (!choice || !context.musicPaths?.includes(request.path))
      throw new CompositionControlError("invalid_asset", "BGM 목록에 등록된 곡을 골라 주세요.");
    let seconds: number;
    try { seconds = await measureAudioSeconds(choice.path); }
    catch { throw new CompositionControlError("invalid_audio", "음원 길이를 확인하지 못했습니다. 구도에 올리지 않았습니다."); }
    return { state: setMusicIn(state, { path: choice.path, name: choice.trackName, seconds, sections: [] }),
      result: { path: choice.path, name: choice.trackName, seconds } };
  });
}
