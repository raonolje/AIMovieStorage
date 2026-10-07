import { describe, expect, it } from "vitest";
import { musicLyricsResult, normalizeLyricsEnd } from "./musicPromptPolicy";
import { buildBgmStyle, createBgmTrack } from "./bgmProjects";
import { bgmRequestData } from "./bgmPromptRequest";
import { buildPromptRequestText } from "./promptRequest";

describe("보컬/연주곡과 사용자 literal 끝 규칙",()=>{
  it.each(["함께\n[end]", "[END]\n함께\n[end]\n[end]", "함께[end] 뒤 설명", "함께\r\n[ end ]"])("마지막 한 번만 정규화하고 재정규화는 같다: %s",source=>{
    const result=normalizeLyricsEnd(source);
    expect(result.endsWith("\n[end]")).toBe(true);expect(result.match(/\[end\]/g)).toHaveLength(1);
    expect(normalizeLyricsEnd(result)).toBe(result);
  });
  it("빈 가사에 끝 태그를 만들어내지 않고 BGM 결과는 가사를 비운다",()=>{
    expect(normalizeLyricsEnd(" [end] ")).toBe("");
    expect(musicLyricsResult({lyricsKo:"노래[end]",lyricsEn:"song",lyrics:"기존"},true)).toEqual({lyrics:"",lyricsKo:"",lyricsEn:""});
    expect(buildBgmStyle({...createBgmTrack(),instrumental:true,lyrics:"노래"}).lyricsKo).toBe("");
    expect(buildBgmStyle({...createBgmTrack(),instrumental:false,lyrics:"노래[end][end]"}).lyricsKo).toBe("노래\n[end]");
  });
  it("6명의 안정된 프로필/파트를 유지하며 MiniMax 음악 모델을 대상으로 한다",()=>{
    const singers=Array.from({length:6},(_,i)=>({id:`member${i}`,name:`멤버${i}`,timbre:`distinct ${i}`,parts:`verse${i}`}));
    const data=bgmRequestData({...createBgmTrack(),targetTool:"local-minimax",instrumental:false,singers,leadMode:"group",lyrics:"함께"});
    expect(data.generationTarget.modelId).toBe("minimaxmusic");expect(data.singers).toEqual(singers);expect(data.lyrics).toBe("함께\n[end]");
  });
  it("사용자 커스텀 요청문과 별도로 필수 규칙을 붙이고 종료 제어 보장을 하지 않는다",async()=>{
    const parts=await buildPromptRequestText({template:"bgm-prompt",data:bgmRequestData({...createBgmTrack(),targetTool:"suno"})});
    expect(parts.fixed).toContain("suno-v6");expect(parts.fixed).toContain("literal [end]");expect(parts.fixed).toContain("보장");
    expect(parts.fixed).toContain("Variety");
  });
});
