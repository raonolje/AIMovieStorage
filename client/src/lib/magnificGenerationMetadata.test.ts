import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./mediaLibrary", () => ({ assetSrc: (path: string) => `asset:${path}` }));
import { generationNotices, generationResponse, measuredDifferences, measureMagnificMedia } from "./magnificGenerationMetadata";

afterEach(() => vi.unstubAllGlobals());
describe("Magnific 요청·접수·파일 실측 구분", () => {
  it("JSON과 TOON의 modelNotice와 모델별 접수값을 그대로 보존한다", () => {
    const toon = "identifier: job\nmodelNotice: 비율 조정\nmodels[1]{slug,aspectRatio}:\n  nano-pro,16:9";
    expect(generationResponse(toon)).toEqual({ identifier: "job", modelNotice: "비율 조정", models: [{ slug: "nano-pro", aspectRatio: "16:9" }] });
    expect(generationNotices(toon)).toEqual(["비율 조정"]);
    expect(generationNotices({ models: [{ warnings: ["길이 조정"] }], modelNotice: "비율 조정" })).toEqual(["길이 조정", "비율 조정"]);
    expect(generationResponse("파싱할 수 없는 응답")).toBe("파싱할 수 없는 응답");
  });

  it("서버가 요청을 받았어도 실제 2:1→16:9 출력과 길이 차이는 별도로 알린다", () => {
    const differences = measuredDifferences({ aspectRatio: "2:1", duration: 15 }, { status: "measured", width: 5504, height: 3072, seconds: 10 });
    expect(differences).toHaveLength(2);
    expect(differences[0]).toContain("5504×3072"); expect(differences[1]).toContain("15초");
    expect(measuredDifferences({ aspectRatio: "16:9" }, { status: "measured", width: 1920, height: 1080 })).toEqual([]);
    expect(measuredDifferences({ aspectRatio: "2:1" }, { status: "unavailable" })[0]).toContain("확인한 상태가 아닙니다");
  });

  it("파일의 실제 영상 크기·길이를 읽고 측정용 비디오를 해제한다", async () => {
    class Video extends EventTarget {
      videoWidth = 1280; videoHeight = 720; duration = 5.25; preload = "";
      pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
      set src(_value: string) { queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
    }
    const video = new Video();
    vi.stubGlobal("HTMLVideoElement", Video); vi.stubGlobal("document", { createElement: () => video });
    expect(await measureMagnificMedia("output.mp4", "video")).toEqual({ status: "measured", width: 1280, height: 720, seconds: 5.25 });
    expect(video.pause).toHaveBeenCalledOnce(); expect(video.load).toHaveBeenCalledOnce(); expect(video.removeAttribute).toHaveBeenCalledWith("src");
  });
});
