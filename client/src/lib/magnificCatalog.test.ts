import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMagnificCatalog } from "./magnificCatalog";
import { assertMagnificVideoInputs, findMagnificVideoModel, mediaTypeOfPath, normalizeMagnificVideoInputContract, supportsVideoReference, videoInputKind } from "./magnificVideoInputs";

// 실제 카탈로그 중 규약 형태가 서로 다른 일곱 모델만 남긴 비식별 자료입니다.
const fixture = readFileSync(new URL("./__fixtures__/magnific-video-catalog.toon", import.meta.url), "utf8");
const models = parseMagnificCatalog(fixture);
const model = (slug: string) => models.find(item => item.slug === slug)!;
const video = [{ type: "video", url: "uploaded-video" }];
const image = { type: "image", url: "uploaded-image" };

describe("Magnific 실제 TOON 입력 규약", () => {
  it("중첩 배열·표 형식·숫자와 boolean을 보존하고 부모 필드를 오염시키지 않는다", () => {
    expect(models).toHaveLength(7);
    expect(model("kling-30").name).toBe("Kling 3.0");
    expect(supportsVideoReference(model("kling-30"))).toBe(false);
    expect(videoInputKind(model("kling-30"))).toBe("image");
    expect(model("kling-motion-control-30").details?.references).toEqual([{ type: "video", allowed: true, limit: 1 }]);
    expect(videoInputKind(model("kling-motion-control-30"))).toBe("motion");
    expect(model("bytedance-seedance-pro-2.5").durations.at(-1)).toBe(30);
  });

  it("beta/private 모델도 현재 규약으로 판단하고 알려진 별칭만 현재 slug로 찾는다", () => {
    const mini = model("bytedance-seedance-mini-2.0");
    expect(mini.details?.private).toBe(true);
    expect(supportsVideoReference(mini)).toBe(true);
    expect(() => assertMagnificVideoInputs(mini, { references: video, resolution: "720p" })).not.toThrow();
    expect(findMagnificVideoModel(models, "seedance-2-5-pro")?.slug).toBe("bytedance-seedance-pro-2.5");
    expect(findMagnificVideoModel(models, "not-in-catalog")).toBeUndefined();
  });

  it("일반 Kling에는 영상을 거절하고 Omni에는 4K 영상 제약을 적용한다", () => {
    expect(() => assertMagnificVideoInputs(model("kling-30"), { references: video })).toThrow(/video/);
    expect(() => assertMagnificVideoInputs(model("kling-omni3"), { references: video, resolution: "720p" })).not.toThrow();
    expect(() => assertMagnificVideoInputs(model("kling-omni3"), { references: video, resolution: "4K" })).toThrow(/해상도/);
    expect(() => assertMagnificVideoInputs(model("kling-omni3"), { references: [...video, ...video] })).toThrow(/최대 1개/);
  });

  it("Seedance의 시작 그림+영상 금지를 확인하고 별개 이미지 레퍼런스는 그대로 허용한다", () => {
    const seedance = model("bytedance-seedance-pro-2.5");
    expect(() => assertMagnificVideoInputs(seedance, { references: video, keyframes: { start: image } })).toThrow(/함께 사용할 수 없는/);
    const args = { references: [...video, image], resolution: "1080p" };
    const before = JSON.stringify(args);
    expect(() => assertMagnificVideoInputs(seedance, args)).not.toThrow();
    expect(JSON.stringify(args)).toBe(before);
  });

  it("필수 동반 그림·필수 시작 프레임·잘못된 Motion Control 시작 종류를 거절한다", () => {
    expect(() => assertMagnificVideoInputs(model("gemini-omni-1_1"), { references: video })).toThrow(/시각 레퍼런스/);
    expect(() => assertMagnificVideoInputs(model("gemini-omni-1_1"), { references: [...video, image] })).not.toThrow();
    const motion = model("kling-motion-control-30");
    expect(() => assertMagnificVideoInputs(motion, { references: video })).toThrow(/필수/);
    expect(() => assertMagnificVideoInputs(motion, { references: video, keyframes: { start: { type: "video", url: "v" } } })).toThrow(/종류가 카탈로그와 다릅니다/);
    expect(() => assertMagnificVideoInputs(undefined, { references: video })).toThrow(/모델을 먼저/);
  });

  it("검증된 Kling Motion Control 3.0의 시작 그림+참조 영상만 허용하고 원문/입력은 보존한다", () => {
    const motion = model("kling-motion-control-30");
    const args = { slug: motion.slug, keyframes: { start: image }, references: video, duration: 15, resolution: "1080p" };
    const before = JSON.stringify({ motion, args });
    expect(() => assertMagnificVideoInputs(motion, args)).not.toThrow();
    expect(() => assertMagnificVideoInputs(motion, { keyframes: { start: image } })).toThrow(/필수 video/);
    expect(() => assertMagnificVideoInputs(motion, { ...args, references: [...video, ...video] })).toThrow(/최대 1개/);
    expect(JSON.stringify({ motion, args })).toBe(before);
  });

  it("다른 slug 또는 변경된 Motion Control 카탈로그에는 검증 예외를 확대하지 않는다", () => {
    const original = model("kling-motion-control-30");
    const variants = [
      { ...original, slug: "another-motion-model" },
      { ...original, details: { ...original.details, mode: "motion-control-next" } },
      { ...original, details: { ...original.details, references: [{ type: "video", allowed: true, limit: 2 }] } },
      { ...original, details: { ...original.details, keyframes: { start: { assetType: "video", required: true, constraints: { duration: { max: 5000 } } } } } },
    ];
    for (const motion of variants) {
      expect(normalizeMagnificVideoInputContract(motion)).toBe(motion);
      expect(() => assertMagnificVideoInputs(motion, { references: video, keyframes: { start: { type: "video", url: "v" } } })).toThrow(/규약이 서로 달라/);
      expect(() => assertMagnificVideoInputs(motion, { references: video, keyframes: { start: image } })).toThrow();
    }
  });

  it("JSON 응답도 같은 제약을 읽고 알 수 없는 형식은 지원으로 오인하지 않는다", () => {
    const json = parseMagnificCatalog(JSON.stringify({ models: [{ slug: "new", references: [{ type: "video", allowed: true, limit: 2 }] }] }));
    expect(supportsVideoReference(json[0])).toBe(true);
    expect(mediaTypeOfPath("C:\\clips\\Dance.MP4")).toBe("video");
    expect(mediaTypeOfPath("audio.wav")).toBe("audio");
    expect(() => parseMagnificCatalog("models[2]:\n  - slug: one\n")).toThrow(/항목 수/);
  });
});
