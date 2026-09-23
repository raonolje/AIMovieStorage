import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineResizePane } from "@/components/composition/planner/TimelineResizePane";
import { clampTimelinePaneHeight, DEFAULT_TIMELINE_PANE_HEIGHT, draggedTimelinePaneHeight, keyedTimelinePaneHeight, readTimelinePaneHeight, rememberTimelinePaneHeight, TIMELINE_PANE_HEIGHT_KEY, timelinePaneBounds } from "./timelinePaneSize";
import { setLocale, t } from "./i18n";

afterEach(() => { vi.unstubAllGlobals(); setLocale("ko"); });

describe("구도 화면을 남기는 타임라인 높이", () => {
  it("위로 끌면 늘고 아래로 끌면 줄며 구도 영역의 한계를 넘지 않는다", () => {
    const bounds = timelinePaneBounds(800);
    expect(draggedTimelinePaneHeight(280, 500, 400, bounds)).toBe(380);
    expect(draggedTimelinePaneHeight(280, 500, 900, bounds)).toBe(160);
    expect(draggedTimelinePaneHeight(280, 500, -1000, bounds)).toBe(480);
  });

  it("창이 작아지면 표시만 제한하고 원래 높이는 다시 펼 때 쓸 수 있다", () => {
    const preferred = 450;
    expect(clampTimelinePaneHeight(preferred, timelinePaneBounds(400))).toBe(180);
    expect(clampTimelinePaneHeight(preferred, timelinePaneBounds(900))).toBe(preferred);
    for (const stage of [20, 100, 250, 400, 800, 1400]) {
      const bounds = timelinePaneBounds(stage);
      expect(bounds.min).toBeLessThanOrEqual(bounds.max);
      expect(bounds.max).toBeLessThanOrEqual(stage * 0.6);
      expect(clampTimelinePaneHeight(Infinity, bounds)).toBeLessThanOrEqual(bounds.max);
    }
  });

  it("키보드 방향키·Home·End를 같은 범위에 적용한다", () => {
    const bounds = timelinePaneBounds(800);
    expect(keyedTimelinePaneHeight(280, "ArrowUp", bounds)).toBe(300);
    expect(keyedTimelinePaneHeight(280, "ArrowDown", bounds, true)).toBe(230);
    expect(keyedTimelinePaneHeight(280, "Home", bounds)).toBe(160);
    expect(keyedTimelinePaneHeight(280, "End", bounds)).toBe(480);
    expect(keyedTimelinePaneHeight(280, "ArrowLeft", bounds)).toBeNull();
  });

  it("높이를 접힘 설정과 분리해 기억하므로 접었다 펴거나 창을 다시 열어도 유지한다", () => {
    const data = new Map<string, string>([["frameforge.timelineCollapsed", "0"]]);
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
    expect(readTimelinePaneHeight()).toBe(DEFAULT_TIMELINE_PANE_HEIGHT);
    rememberTimelinePaneHeight(370);
    data.set("frameforge.timelineCollapsed", "1");
    expect(readTimelinePaneHeight()).toBe(370);
    data.set("frameforge.timelineCollapsed", "0");
    expect(readTimelinePaneHeight()).toBe(370);
    expect([...data.keys()]).toEqual(["frameforge.timelineCollapsed", TIMELINE_PANE_HEIGHT_KEY]);
    for (const invalid of ["", "NaN", "Infinity", "-20", "0", "999999"]) {
      data.set(TIMELINE_PANE_HEIGHT_KEY, invalid);
      expect(readTimelinePaneHeight()).toBe(DEFAULT_TIMELINE_PANE_HEIGHT);
    }
  });

  it("설정 저장소가 막혀도 조절기를 렌더링하고 조작할 수 있다", () => {
    vi.stubGlobal("window", { get localStorage() { throw Error("저장 불가"); } });
    expect(readTimelinePaneHeight()).toBe(DEFAULT_TIMELINE_PANE_HEIGHT);
    expect(() => rememberTimelinePaneHeight(300)).not.toThrow();
  });

  it.each(["en", "ja", "zh"] as const)("%s 조절기는 접근 가능한 경계와 높이를 알린다", (locale) => {
    setLocale(locale);
    const html = renderToStaticMarkup(createElement(TimelineResizePane, { className: "relative" },
      createElement("div", null, Array.from({ length: 300 }, (_, index) => createElement("p", { key: index }, `track ${index}`)))));
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-valuenow="280"');
    expect(html).toContain('height:280px');
    expect(html).toContain(t("타임라인 높이 조절"));
    expect(html).not.toContain('aria-label="타임라인 높이 조절"');
    expect(html).toContain('tabindex="0"');
  });
});
