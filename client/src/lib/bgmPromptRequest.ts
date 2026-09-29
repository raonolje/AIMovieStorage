import type { BgmTrack } from "./bgmProjects";

/** BGM 화면의 API 버튼과 외부 조종기가 공유하는 요청 재료. */
export function bgmRequestData(track: BgmTrack) {
  return {
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
      ? "연주곡입니다. 노랫말을 짓지 말고 구간 태그와 연주 지시만 적으세요."
      : "노래입니다. 반드시 부를 가사를 쓰세요. instrumental·no vocals 같은 말을 스타일에 넣지 마세요.",
    lyrics: track.instrumental ? null : track.lyricsKo || track.lyrics || null,
    excludeStyles: track.excludeStyles || null,
    reference: track.reference || null,
    notes: track.notes || null,
    targetTool: track.targetTool,
  };
}
