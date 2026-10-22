import { describe, expect, it, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  actorProjection,
  nextLedColor,
  ledImageStorageKey,
  defaultLedSettings,
  decodeLedPreset,
  encodeLedPreset,
  fitLedGuide,
  guideRect,
  loadLedPresets,
  normalizeLedSettings,
  saveLedPresets,
  type LedGuide,
} from "./ledGuides";
import { normalizeComposition } from "./composition";
import LedGuideOverlay from "../components/led/LedGuideOverlay";

const guide = (patch: Partial<LedGuide> = {}): LedGuide => ({
  id: "front",
  name: "정면",
  color: "#22d3ee",
  visible: true,
  ratioWidth: 4,
  ratioHeight: 3,
  fit: "height",
  x: 0.15,
  y: 0.1,
  width: 0.5,
  physicalHeightM: 2.5,
  ...patch,
});
const settings = () => ({
  ...defaultLedSettings(),
  guides: [guide()],
  actor: { ...defaultLedSettings().actor, visible: true, guideId: "front" },
});
describe("LED 크롭과 무대 축척", () => {
  it("높이 맞춤과 가로 맞춤은 화면 픽셀 비율을 보존하고 이동 좌표를 유지한다", () => {
    const g = guide();
    expect(guideRect(g, 16 / 9)).toEqual({
      x: 0.15,
      y: 0.1,
      width: 0.75,
      height: 1,
    });
    const w = fitLedGuide(g, "width", 16 / 9);
    expect(guideRect(w, 16 / 9)).toEqual({
      x: 0.15,
      y: 0.1,
      width: 1,
      height: 4 / 3,
    });
    const free = fitLedGuide(g, "free", 16 / 9);
    expect(guideRect(free, 16 / 9)).toEqual(guideRect(g, 16 / 9));
    expect(guideRect(free, 9 / 16).width).toBe(0.75);
  });
  it("관객10m·LED앞2m·키183cm·LED2.5m이면 높이91.5%이며 거리를 바꾸면 자동 갱신된다", () => {
    const s = settings();
    expect(actorProjection(s, 16 / 9)?.relativeHeight).toBeCloseTo(0.915);
    s.actor.forwardM = 0;
    expect(actorProjection(s, 16 / 9)?.relativeHeight).toBeCloseTo(0.732);
    s.actor.forwardM = 10;
    expect(actorProjection(s, 16 / 9)).toBeNull();
    s.actor.forwardM = 12;
    expect(actorProjection(s, 16 / 9)).toBeNull();
  });
  it("독립 영역 이동·색과 기준 LED의 실측 높이는 서로 덮어쓰지 않는다", () => {
    const s = settings();
    s.guides.push(
      guide({
        id: "left",
        name: "왼쪽 꺾임",
        color: "#fb923c",
        x: 0.7,
        physicalHeightM: 5,
      }),
    );
    const n = normalizeLedSettings(s);
    expect(n.guides[0].x).toBe(0.15);
    expect(n.guides[1].x).toBe(0.7);
    n.actor.guideId = "left";
    expect(actorProjection(n, 16 / 9)?.relativeHeight).toBeCloseTo(0.4575);
  });
  it("이름·색·위치·실측·실루엣은 프리셋 파일과 구도 저장에서 양방향 보존된다", () => {
    const s = settings();
    const restored = decodeLedPreset(encodeLedPreset("ㄷ자 무대", s));
    expect(restored).toEqual({ name: "ㄷ자 무대", settings: s });
    expect(
      normalizeComposition({ ledGuides: restored.settings }).ledGuides,
    ).toEqual(s);
    expect(() => decodeLedPreset('{"version":2}')).toThrow();
  });
  it("잘못된 수치·색·중복 ID와 삭제된 배우 기준을 복구한다", () => {
    const s = normalizeLedSettings({
      guides: [
        guide({ ratioWidth: NaN, physicalHeightM: -1, color: "url(evil)" }),
        guide(),
      ],
      actor: { guideId: "missing", heightCm: Infinity },
    });
    expect(s.guides[0].ratioWidth).toBe(16);
    expect(s.guides[0].physicalHeightM).toBe(0.01);
    expect(s.guides[0].color).toBe("#22d3ee");
    expect(s.guides[1].id).not.toBe(s.guides[0].id);
    expect(s.actor.guideId).toBe("front");
    expect(s.actor.heightCm).toBe(183);
  });
  it("오버레이는 별도 SVG이며 숨기면 가이드와 실루엣 모두 사라진다", () => {
    const s = settings();
    const shown = renderToStaticMarkup(
      createElement(LedGuideOverlay, {
        settings: s,
        aspect: 16 / 9,
        onChange: () => {},
      }),
    );
    expect(shown).toContain("data-led-guide");
    expect(shown).toContain("data-led-actor");
    expect(shown).not.toContain("<canvas");
    s.visible = false;
    expect(
      renderToStaticMarkup(
        createElement(LedGuideOverlay, {
          settings: s,
          aspect: 16 / 9,
          onChange: () => {},
        }),
      ),
    ).toBe("");
  });
});
describe("공용 배치 보존", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, v: string) => store.set(key, v),
      },
    });
  });
  it("이미지 편집에서 저장한 공용 프리셋을 구도잡기와 같은 API로 읽는다", () => {
    const rows = [{ id: "p", name: "공연 ㄷ자", settings: settings() }];
    saveLedPresets(rows);
    expect(loadLedPresets()).toEqual(rows);
  });
});

describe("영역 추가와 이미지 구분", () => {
  it("32개 영역과 삭제 뒤 추가에서도 기본색을 재사용하지 않는다", () => {
    const guides: LedGuide[] = [];
    for (let n = 0; n < 32; n++) guides.push(guide({ id: String(n), color: nextLedColor(guides) }));
    expect(new Set(guides.map(g => g.color)).size).toBe(32);
    guides.splice(1, 1);
    expect(guides.map(g => g.color)).not.toContain(nextLedColor(guides));
  });
  it("같은 이미지 설정은 유지하고 서로 다른 이미지의 임시 설정은 구분한다", () => {
    expect(ledImageStorageKey("공연", "장면1.png")).toBe(ledImageStorageKey("공연", "장면1.png"));
    expect(ledImageStorageKey("공연", "장면1.png")).not.toBe(ledImageStorageKey("공연", "장면2.png"));
  });
});
