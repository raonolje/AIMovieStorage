/** [end]는 사용자의 저장 형식입니다. 모델의 EOS 또는 오디오 종료를 보장하지 않습니다. */
export function normalizeLyricsEnd(value: string | undefined): string {
  const body = (value ?? "").replace(/\[\s*end\s*\]/gi, "").trim();
  return body ? `${body}\n[end]` : "";
}
export function musicLyricsResult<T extends { lyrics?: string; lyricsKo?: string; lyricsEn?: string }>(result: T, instrumental: boolean): T {
  const lyricsKo = instrumental ? "" : normalizeLyricsEnd(result.lyricsKo ?? result.lyrics);
  return { ...result, ...(result.lyrics !== undefined ? { lyrics: lyricsKo } : {}), lyricsKo, lyricsEn: instrumental ? "" : normalizeLyricsEnd(result.lyricsEn) };
}
