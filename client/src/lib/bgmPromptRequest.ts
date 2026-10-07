import type { BgmTrack } from "./bgmProjects";
import { canonicalPromptModel, promptStamp, type PromptSelection } from "./promptModelSelection";
import { normalizeLyricsEnd } from "./musicPromptPolicy";

/** BGM 화면의 API 버튼과 외부 조종기가 공유하는 요청 재료. */
export function bgmPromptSelection(track:BgmTrack):PromptSelection {
  if(track.targetTool==="comfy")return {route:"comfy",platformId:"comfyui",modelId:canonicalPromptModel(track.promptWorkflow?.modelRuleId),workflowTarget:track.promptWorkflow,selectedId:track.promptWorkflow?.workflowId};
  return {route:track.targetTool,modelId:canonicalPromptModel(track.targetTool),platformId:track.targetTool==="suno"?"suno":"local"};
}
export function bgmPromptStamp(track:BgmTrack):string|undefined {return track.targetTool==="comfy"?promptStamp(bgmPromptSelection(track)):canonicalPromptModel(track.targetTool);}
export function bgmRequestData(track: BgmTrack) {
  return {
    generationTarget: bgmPromptSelection(track),
    singers: track.singers ?? [],
    leadMode: track.leadMode ?? "single",
    vocalConsistency: "같은 멤버의 음색·음역·발음·비브라토·창법을 유지하고 한 구간에 한 리드를 배정합니다. 프로필은 공식 화자 ID가 아니며 고유 보컬 보장은 없습니다.",
    name: track.name,
    usage: track.usage,
    mood: track.mood,
    genre: track.genre,
    instruments: track.instruments,
    vocals: track.vocals ?? [],
    era: track.era ?? [],
    production: track.production ?? [],
    structure: track.structure ?? [],
    tempo: track.tempo || null,
    durationSeconds: track.durationSeconds || null,
    instrumental: track.instrumental,
    지시: track.instrumental
      ? "연주곡입니다. lyricsKo와 lyricsEn을 빈 문자열로 주세요. 편곡과 구조는 스타일 칸에 적으세요."
      : "노래입니다. 반드시 부를 가사를 쓰고 마지막 줄에 소문자 literal [end]를 중복 없이 한 번만 넣으세요. 뒤에 설명을 붙이지 마세요. 종료 제어 보장은 아닙니다.",
    lyrics: track.instrumental ? null : normalizeLyricsEnd(track.lyricsKo || track.lyrics) || null,
    excludeStyles: track.excludeStyles || null,
    reference: track.reference || null,
    notes: track.notes || null,
    targetTool: track.targetTool,
  };
}
