import { describe, expect, it } from "vitest";
import { assertVideoDuration } from "./videoDuration";

describe("모델 영상 길이 사전 확인", () => {
  it("Seedance 2.5의 30초와 2.0의 15초 한도를 구분한다", () => {
    expect(() => assertVideoDuration(15, "seedance-2.5")).not.toThrow();
    expect(() => assertVideoDuration(30, "seedance-2.5")).not.toThrow();
    expect(() => assertVideoDuration(15, "seedance-2.0")).not.toThrow();
    expect(() => assertVideoDuration(16, "seedance-2.0")).toThrow(/최대 15초/);
    expect(() => assertVideoDuration(69.134, "seedance-2.5")).toThrow(/최대 30초/);
  });
  it("서버 카탈로그의 별도 길이 목록을 우선하고 가장 가까운 값으로 바꾸지 않는다", () => {
    const catalog = { slug: "test", name: "시험", durations: [5, 10], resolutions: [], qualities: [], aspectRatios: [] };
    expect(() => assertVideoDuration(7, "seedance-2.5", catalog)).toThrow(/지원 길이는 5, 10초/);
    expect(() => assertVideoDuration(15, "seedance-2.5", catalog)).toThrow(/최대 10초/);
  });
  it.each([0, -1, NaN, Infinity])("잘못된 길이 %s는 전송할 수 없다", seconds => {
    expect(() => assertVideoDuration(seconds, "seedance-2.5")).toThrow(/0보다 큰/);
  });
});
