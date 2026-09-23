import { describe, expect, it } from "vitest";
import { tuneForLocal } from "@/lib/localPrompt";

/*
  로컬 모델에는 마그니픽 캔버스가 없어 `@파일이름` 은 가리킬 것이 없습니다. 앳만 떼고 파일 이름을 남기면
  모델이 그 글자를 그림에 써 버립니다 — 특히 «_001» 같은 번호 꼬리가 그대로 남던 것.
*/
describe("tuneForLocal — @태그 걷어내기", () => {
  it("공백·괄호가 든 이름과 번호 꼬리를 함께 뗀다", () => {
    const out = tuneForLocal("qwenimage", {
      en: "@서진우 (니시무라 진)_001 grips the steering wheel while @서하나_002 looks out.",
    });
    expect(out.prompt).toBe("서진우 (니시무라 진) grips the steering wheel while 서하나 looks out.");
    expect(out.prompt).not.toContain("@");
    expect(out.prompt).not.toContain("_001");
  });

  it("꼬리 줄(참고 그림·아직 그림 없음)은 통째로 뗀다", () => {
    const out = tuneForLocal("qwenimage", {
      en: "A man drives at night.\n\nReference images: 서진우 @서진우_001\nNot yet generated: layout — two shot",
    });
    expect(out.prompt).toBe("A man drives at night.");
  });

  it("네거티브를 안 받는 엔진에는 빈 문자열을 준다", () => {
    for (const engine of ["krea2", "zimage"] as const) {
      const tuned = tuneForLocal(engine, { en: "a portrait --no text", negativeEn: "blurry" });
      expect(tuned.negative).toBe("");
      expect(tuned.prompt).not.toContain("--no");
    }
    const qwen = tuneForLocal("qwenimage", { en: "a portrait", negativeEn: "blurry" });
    expect(qwen.negative).toContain("blurry");
  });

  it("영문이 비면 한글로 물러서고 그 사실을 알린다", () => {
    const out = tuneForLocal("qwenimage", { ko: "밤 고속도로를 달리는 차" });
    expect(out.usedKorean).toBe(true);
    expect(out.prompt).toBe("밤 고속도로를 달리는 차");
  });
});

/*
  
  텍스트 인코더가 읽는 길이를 넘기면 **맨 뒤의 칸 배치 지시**가 날아갑니다 — 값을 치르기 전에 알아야 합니다.
*/
describe("tuneForLocal — 토큰 예산과 칸 수", () => {
  it("한도를 넘으면 overflow 로 알린다", () => {
    const short = tuneForLocal("qwenimage", { en: "a man drives at night" });
    expect(short.overflow).toBe(false);
    const long = tuneForLocal("qwenimage", { en: "word ".repeat(1200) });
    expect(long.overflow).toBe(true);
    expect(long.tokens).toBeGreaterThan(long.budget);
  });

  it("엔진마다 한도가 다르다 — Qwen 이 가장 넉넉하다", () => {
    expect(tuneForLocal("qwenimage", { en: "x" }).budget).toBeGreaterThan(
      tuneForLocal("krea2", { en: "x" }).budget,
    );
  });

  /*
    2026-09-22 실측에서 나온 규칙입니다. Qwen-Image 에 「full body … head to toe in frame」 으로
    칸 넉 장을 뽑았더니 **넉 장 모두 허벅지에서 잘리고** 발이 한 번도 안 나왔습니다.
    무엇이 프레임 안에 있어야 하는지 사물로 짚어 주자 머리부터 신발까지 들어왔습니다.
  */
  it("전신을 시키면 «신발까지 프레임 안에» 를 덧댄다 — 그림 엔진만", () => {
    const tuned = tuneForLocal("qwenimage", { en: "full body shot of a guard, grey backdrop" });
    expect(tuned.prompt).toContain("down to the shoes");
    expect(tuned.prompt).toContain("both feet fully visible");

    // 이미 짚어 두었으면 두 번 적지 않습니다.
    const already = tuneForLocal("qwenimage", { en: "full body, both feet and boots visible" });
    expect(already.prompt).toBe("full body, both feet and boots visible");

    // 전신이라는 말이 없으면 건드리지 않습니다.
    const portrait = tuneForLocal("qwenimage", { en: "a close-up portrait" });
    expect(portrait.prompt).toBe("a close-up portrait");

    // 영상 엔진은 그대로 — 전신이 뜻하는 바가 다릅니다.
    const video = tuneForLocal("wanvideo", { en: "full body shot of a guard walking" });
    expect(video.prompt).toBe("full body shot of a guard walking");
  });

  it("칸 수를 세어 시트 프롬프트를 가린다", () => {
    const sheet = tuneForLocal("qwenimage", {
      en: "Lay out 9 panels: panel 1 - front, panel 2 - side, panel 3 - back, panel 9 - swatch",
    });
    expect(sheet.panels).toBe(4);
    expect(tuneForLocal("qwenimage", { en: "a single portrait" }).panels).toBe(0);
  });
});
