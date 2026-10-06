import { z } from "zod";
import { listBgmChoices } from "./bgmLibrary";
import { measureAudioSeconds } from "./audioDuration";
import { analyzeMusicFile } from "./musicBeats";
import { musicOf, patchMusicIn, setMusicIn, setTimelineIn } from "./compositionEdit";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";

export const compositionMusicUseSchema = compositionSessionRequestSchema.extend({
  path: z.string().min(1).max(4000), fitTimeline: z.boolean().optional(),
}).strict();
export const compositionMusicAnalyzeSchema = compositionSessionRequestSchema;

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
    const withMusic = setMusicIn(state, { path: choice.path, name: choice.trackName, seconds, startTime: 0, sections: [] });
    return { state: request.fitTimeline ? setTimelineIn(withMusic, { duration: Math.round(seconds * 10) / 10 }) : withMusic,
      result: { path: choice.path, name: choice.trackName, seconds, fitTimeline: request.fitTimeline === true } };
  });
}

/** 화면과 같은 분석기를 사용하고, 기다리는 동안 사람이 음원을 바꾸면 옛 결과를 적용하지 않습니다. */
export async function analyzeCompositionMusic(raw: unknown) {
  const request = compositionMusicAnalyzeSchema.parse(raw);
  return applyCompositionMutation(request, async ({ state }) => {
    const music = musicOf(state);
    if (!music) throw new CompositionControlError("missing_music", "먼저 구도 타임라인에 음원을 올려 주세요.");
    const analysis = await analyzeMusicFile(music.path);
    return {
      state: patchMusicIn(state, { bpm: analysis.bpm, beatTimes: analysis.beats,
        beatConfidence: analysis.confidence, downbeatIndex: 0 }),
      result: { bpm: analysis.bpm, beatCount: analysis.beats.length, confidence: analysis.confidence,
        firstBeats: analysis.beats.slice(0, 16) },
    };
  });
}
