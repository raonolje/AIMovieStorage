import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  defaultLedSettings,
  normalizeLedSettings,
  encodeLedPreset,
  decodeLedPreset,
  guideRect,
} from "./ledGuides";
import {
  correctedSourcePoint,
  panelProjection,
  panelWorldPoint,
  perspectiveActor,
  projectLedPoint,
  warpLedPixels,
  actorPositionFromScreen,
} from "./ledPerspective";
import LedGuideOverlay from "../components/led/LedGuideOverlay";

const stage = () =>
  normalizeLedSettings({
    ...defaultLedSettings(),
    perspective: {
      enabled: true,
      referenceGuideId: "front",
      viewerXM: 0,
      eyeHeightM: 1.6,
    },
    guides: [
      {
        id: "front",
        name: "정면",
        ratioWidth: 4,
        ratioHeight: 3,
        fit: "height",
        x: 0,
        y: 0,
        physicalHeightM: 3,
      },
    ],
    actor: { ...defaultLedSettings().actor, visible: true, guideId: "front" },
  });
describe("물리 LED 투시와 역보정", () => {
  it("꺾인 패널에서도 배우 드래그의 화면 좌표를 정확히 역산한다", () => {
    const s = stage();
    s.guides[0].pose = { centerXM: 1, depthM: 2, yawDeg: 45, baseYM: 0.3 };
    s.actor.x = 0.7;
    s.actor.footY = 0.9;
    const projected = perspectiveActor(s, 4 / 3)!;
    const position = actorPositionFromScreen(s, 4 / 3, {
      x: projected.x,
      y: projected.footY,
    })!;
    expect(position.x).toBeCloseTo(0.7);
    expect(position.footY).toBeCloseTo(0.9);
    const moved = actorPositionFromScreen(s, 4 / 3, {
      x: projected.x + 0.1,
      y: projected.footY - 0.05,
    })!;
    s.actor = { ...s.actor, ...moved };
    expect(perspectiveActor(s, 4 / 3)!.x).toBeCloseTo(projected.x + 0.1);
    expect(perspectiveActor(s, 4 / 3)!.footY).toBeCloseTo(
      projected.footY - 0.05,
    );
  });
  it("보정 전면 0도는 기존 크롭 사각형과 정확히 겹친다", () => {
    const s = stage(),
      g = s.guides[0],
      r = guideRect(g, 4 / 3),
      p = panelProjection(s, g, 4 / 3)!;
    expect(p[0].x).toBeCloseTo(r.x);
    expect(p[0].y).toBeCloseTo(r.y);
    expect(p[2].x).toBeCloseTo(r.x + r.width);
    expect(p[2].y).toBeCloseTo(r.y + r.height);
  });
  it("60도 패널의 먼 쪽 세로 변이 원근에 따라 짧아진다", () => {
    const s = stage(),
      g = s.guides[0];
    g.pose = { depthM: 1, yawDeg: 60, baseYM: 0 };
    const p = panelProjection(s, g, 4 / 3)!;
    expect(p[2].y - p[1].y).toBeLessThan(p[3].y - p[0].y);
    expect(p[1].x - p[0].x).toBeLessThan(1);
    const source = correctedSourcePoint(s, g, 4 / 3, 0.75, 0.25)!;
    const world = panelWorldPoint(s, g, 4 / 3, 0.75, 0.25),
      k = 10 / (10 + world.z);
    expect(source.x).toBeCloseTo(0.5 + (world.x * k) / 4);
    expect(source.y).toBeCloseTo(1 - (1.6 + (world.y - 1.6) * k) / 3);
  });
  it("관객 좌우와 눈높이 변경은 깊이가 있는 면에 반영되며 기준 평면은 유지한다", () => {
    const s = stage(),
      g = s.guides[0],
      before = panelProjection(s, g, 4 / 3);
    s.perspective.viewerXM = 2;
    s.perspective.eyeHeightM = 2;
    expect(panelProjection(s, g, 4 / 3)).toEqual(before);
    g.pose = { depthM: 2, yawDeg: 0, baseYM: 0 };
    const p = panelProjection(s, g, 4 / 3)!;
    expect(p[0].x).toBeCloseTo(1 / 6);
    expect(p[2].y).toBeCloseTo(8 / 9);
  });
  it("관객 뒤·옆면·뒷면의 패널은 보정 출력을 차단한다", () => {
    const s = stage(),
      g = s.guides[0];
    for (const pose of [
      { depthM: -11, yawDeg: 0, baseYM: 0 },
      { depthM: 0, yawDeg: 90, baseYM: 0 },
      { depthM: 0, yawDeg: 179, baseYM: 0 },
    ]) {
      g.pose = pose;
      expect(panelProjection(s, g, 4 / 3)).toBeNull();
      expect(() =>
        warpLedPixels(new Uint8ClampedArray(48), 4, 3, s, g, 4, 3),
      ).toThrow();
    }
    expect(projectLedPoint(s, 4 / 3, { x: 0, y: 0, z: -10 })).toBeNull();
  });
  it("0도 역보정은 원본 픽셀을 보존하고 영상 밖은 불투명 검정이다", () => {
    const s = stage(),
      g = s.guides[0],
      source = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < source.length; i++)
      source[i] = i % 4 === 3 ? 255 : i * 3;
    expect(warpLedPixels(source, 4, 3, s, g, 4, 3)).toEqual(source);
    g.pose = { centerXM: 100, depthM: 0, yawDeg: 0, baseYM: 0 };
    const black = warpLedPixels(source, 4, 3, s, g, 4, 3);
    expect([...black].filter((_, i) => i % 4 !== 3).every((x) => x === 0)).toBe(
      true,
    );
    expect(black[3]).toBe(255);
    expect(() => warpLedPixels(source, 4, 3, s, g, 4096, 4097)).toThrow();
  });
  it("배우 키와 깊이 및 눈높이가 실루엣의 크기와 발 위치에 반영된다", () => {
    const s = stage();
    s.guides[0].physicalHeightM = 2.5;
    const actor = perspectiveActor(s, 16 / 9)!;
    expect(actor.relativeHeight).toBeCloseTo(0.915);
    expect(actor.footY).toBeGreaterThan(1);
    s.actor.forwardM = 10;
    expect(perspectiveActor(s, 16 / 9)).toBeNull();
  });
  it("공용 프리셋은 보정 설정과 실측 위치를 보존하고 오래된 파일은 기본으로 꺼진다", () => {
    const s = stage();
    s.guides[0].pose = { centerXM: -2, depthM: 1, yawDeg: 45, baseYM: 0.2 };
    expect(decodeLedPreset(encodeLedPreset("ㄷ자 투시", s)).settings).toEqual(
      s,
    );
    expect(normalizeLedSettings({ guides: [] }).perspective.enabled).toBe(
      false,
    );
    expect(
      normalizeLedSettings({
        ...s,
        perspective: { viewerXM: Infinity, eyeHeightM: -2 },
      }).perspective,
    ).toMatchObject({ viewerXM: 0, eyeHeightM: 0 });
  });
  it("보정 옵션을 켰을 때만 관객 시점 점선이 SVG에 추가되며 원본 캔버스와 분리된다", () => {
    const s = stage(),
      render = () =>
        renderToStaticMarkup(
          createElement(LedGuideOverlay, {
            settings: s,
            aspect: 4 / 3,
            onChange: () => {},
          }),
        );
    expect(render()).toContain("data-led-perspective");
    expect(render()).not.toContain("<canvas");
    s.perspective.enabled = false;
    expect(render()).not.toContain("data-led-perspective");
  });
});
