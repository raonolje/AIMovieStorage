import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StructureControlPicker from "@/components/StructureControlPicker";
import { structureSourceSchema, type LocalStructureControl } from "./localStructureControl";
import { setLocale, t, type Locale } from "./i18n";

vi.mock("@/lib/mediaLibrary", () => ({ assetSrc: (path: string) => `asset:${path}` }));
afterEach(() => setLocale("ko"));

describe("구도 레퍼런스의 윤곽 입력", () => {
  it("기본 임계값과 0 세기를 보존하고 임의 파일 경로를 공개 입력으로 받지 않는다", () => {
    expect(structureSourceSchema.parse({ assetId: "cut:refVideoPath", kind: "canny", durationSeconds: 5, weight: 0, thresholds: {} }))
      .toEqual({ assetId: "cut:refVideoPath", kind: "canny", sourceStartSeconds: 0, durationSeconds: 5, weight: 0, thresholds: { low: 92, high: 200 } });
    expect(structureSourceSchema.safeParse({ assetId: "cut:refVideoPath", kind: "canny", durationSeconds: 5, path: "outside.mp4" }).success).toBe(false);
  });

  it.each<Locale>(["en", "ja", "zh"])("%s에서 구도·카메라 안내를 번역하고 선택한 구간과 원본 이름은 보존한다", (locale) => {
    setLocale(locale);
    const value: LocalStructureControl = { path: "p/직접 붙인 영상 이름.mp4", kind: "canny", sourceStartSeconds: 6.125, durationSeconds: 4.708333, weight: 0 };
    const before = structuredClone(value);
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(StructureControlPicker, { paths: [value.path], value, disabled: false, onChange }));
    for (const key of ["구도잡기 레퍼런스 · 윤곽 구조 제어", "윤곽 기준 영상", "윤곽 세기", "원본 시작(초)", "사용·생성 길이(초)"]) {
      expect(t(key)).not.toBe(key);
      expect(html).toContain(t(key));
    }
    expect(html).toContain("직접 붙인 영상 이름.mp4");
    expect(html).toContain('value="6.125"');
    expect(html).toContain('value="4.708333"');
    expect(value).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
  });
});
