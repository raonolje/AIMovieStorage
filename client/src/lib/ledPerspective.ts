import { guideRect, type LedGuide, type LedGuideSettings } from "./ledGuides";

export type LedPoint = { x: number; y: number };
export function ledCalibration(s: LedGuideSettings, aspect: number) {
  const reference =
    s.guides.find((g) => g.id === s.perspective.referenceGuideId) ??
    s.guides[0];
  if (!reference) return null;
  const r = guideRect(reference, aspect);
  return {
    scale: r.height / reference.physicalHeightM,
    originX: r.x + r.width / 2,
    originY: r.y + r.height,
    distance: s.actor.viewerDistanceM,
  };
}
export function panelPose(s: LedGuideSettings, g: LedGuide, aspect: number) {
  const c = ledCalibration(s, aspect);
  const r = guideRect(g, aspect);
  return {
    centerXM:
      g.pose?.centerXM ??
      (c ? ((r.x + r.width / 2 - c.originX) * aspect) / c.scale : 0),
    depthM: g.pose?.depthM ?? 0,
    yawDeg: g.pose?.yawDeg ?? 0,
    baseYM: g.pose?.baseYM ?? (c ? (c.originY - r.y - r.height) / c.scale : 0),
  };
}
/** 관객에서 z=0 기준면으로 쏜 광선의 교점을 써서 두 편집기의 투시와 역보정이 일치하게 합니다. */
export function projectLedPoint(
  s: LedGuideSettings,
  aspect: number,
  p: { x: number; y: number; z: number },
): LedPoint | null {
  const c = ledCalibration(s, aspect);
  if (!c || c.distance + p.z <= 0.01) return null;
  const k = c.distance / (c.distance + p.z);
  const eye = s.perspective;
  return {
    x:
      c.originX +
      ((eye.viewerXM + (p.x - eye.viewerXM) * k) * c.scale) / aspect,
    y: c.originY - (eye.eyeHeightM + (p.y - eye.eyeHeightM) * k) * c.scale,
  };
}
export function panelWorldPoint(
  s: LedGuideSettings,
  g: LedGuide,
  aspect: number,
  u: number,
  v: number,
) {
  const pose = panelPose(s, g, aspect),
    yaw = (pose.yawDeg * Math.PI) / 180;
  const localX = ((u - 0.5) * g.physicalHeightM * g.ratioWidth) / g.ratioHeight;
  return {
    x: pose.centerXM + Math.cos(yaw) * localX,
    y: pose.baseYM + (1 - v) * g.physicalHeightM,
    z: pose.depthM + Math.sin(yaw) * localX,
  };
}
export function panelProjection(
  s: LedGuideSettings,
  g: LedGuide,
  aspect: number,
): LedPoint[] | null {
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([u, v]) =>
    projectLedPoint(s, aspect, panelWorldPoint(s, g, aspect, u, v)),
  );
  if (corners.some((p) => !p)) return null;
  const points = corners as LedPoint[];
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % 4];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  // 뒤집힌 면과 거의 옆면은 역보정할 수 없으므로 잘못된 송출 그림을 만들지 않습니다.
  return area > 1e-8 ? points : null;
}
export function perspectiveActor(s: LedGuideSettings, aspect: number) {
  const g = s.guides.find((g) => g.id === s.actor.guideId);
  if (!g || !panelProjection(s, g, aspect)) return null;
  const foot = panelWorldPoint(s, g, aspect, s.actor.x, s.actor.footY);
  foot.z -= s.actor.forwardM;
  const bottom = projectLedPoint(s, aspect, foot),
    top = projectLedPoint(s, aspect, {
      ...foot,
      y: foot.y + s.actor.heightCm / 100,
    });
  if (!bottom || !top) return null;
  const rect = guideRect(g, aspect),
    height = bottom.y - top.y;
  return {
    x: bottom.x,
    footY: bottom.y,
    height,
    relativeHeight: height / rect.height,
  };
}

export function actorPositionFromScreen(
  s: LedGuideSettings,
  aspect: number,
  point: LedPoint,
) {
  const g = s.guides.find((g) => g.id === s.actor.guideId),
    c = ledCalibration(s, aspect);
  if (!g || !c) return null;
  const pose = panelPose(s, g, aspect),
    yaw = (pose.yawDeg * Math.PI) / 180;
  const screenX = ((point.x - c.originX) * aspect) / c.scale,
    relativeX = screenX - s.perspective.viewerXM;
  const denominator = relativeX * Math.sin(yaw) - c.distance * Math.cos(yaw);
  if (Math.abs(denominator) < 1e-8) return null;
  const localX =
    (c.distance * (pose.centerXM - s.perspective.viewerXM) -
      relativeX * (c.distance + pose.depthM - s.actor.forwardM)) /
    denominator;
  const z = pose.depthM + Math.sin(yaw) * localX - s.actor.forwardM;
  if (c.distance + z <= 0.01) return null;
  const worldY =
    s.perspective.eyeHeightM +
    (((c.originY - point.y) / c.scale - s.perspective.eyeHeightM) *
      (c.distance + z)) /
      c.distance;
  return {
    x: localX / ((g.physicalHeightM * g.ratioWidth) / g.ratioHeight) + 0.5,
    footY: 1 - (worldY - pose.baseYM) / g.physicalHeightM,
  };
}

/** LED의 평평한 픽셀 주소에서 보정할 원본 위치를 직접 구합니다. 네 모서리 보간과 달리 원근 분모를 보존합니다. */
export function correctedSourcePoint(
  s: LedGuideSettings,
  g: LedGuide,
  aspect: number,
  u: number,
  v: number,
) {
  if (!panelProjection(s, g, aspect)) return null;
  return projectLedPoint(s, aspect, panelWorldPoint(s, g, aspect, u, v));
}

export function warpLedPixels(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  s: LedGuideSettings,
  g: LedGuide,
  width: number,
  height: number,
) {
  if (
    ![sourceWidth, sourceHeight, width, height].every(
      (n) => Number.isInteger(n) && n > 0,
    ) ||
    width * height > 16_777_216 ||
    source.length !== sourceWidth * sourceHeight * 4
  )
    throw new Error("이미지 크기를 확인하세요.");
  const aspect = sourceWidth / sourceHeight,
    c = ledCalibration(s, aspect);
  if (!c || !panelProjection(s, g, aspect))
    throw new Error("패널의 깊이와 각도를 확인하세요.");
  const pose = panelPose(s, g, aspect),
    yaw = (pose.yawDeg * Math.PI) / 180,
    panelWidth = (g.physicalHeightM * g.ratioWidth) / g.ratioHeight;
  const output = new Uint8ClampedArray(width * height * 4);
  const eye = s.perspective;
  for (let x = 0; x < width; x++) {
    const localX = ((x + 0.5) / width - 0.5) * panelWidth;
    const k = c.distance / (c.distance + pose.depthM + Math.sin(yaw) * localX);
    const sx =
      (c.originX +
        ((eye.viewerXM +
          (pose.centerXM + Math.cos(yaw) * localX - eye.viewerXM) * k) *
          c.scale) /
          aspect) *
        sourceWidth -
      0.5;
    for (let y = 0; y < height; y++) {
      const sy =
        (c.originY -
          (eye.eyeHeightM +
            (pose.baseYM +
              (1 - (y + 0.5) / height) * g.physicalHeightM -
              eye.eyeHeightM) *
              k) *
            c.scale) *
          sourceHeight -
        0.5;
      const at = (y * width + x) * 4;
      output[at + 3] = 255;
      // 원본 밖을 검정으로 채워 패널 가장자리에 원본 끝 픽셀이 늘어나지 않게 합니다.
      if (
        sx < -0.5 ||
        sx > sourceWidth - 0.5 ||
        sy < -0.5 ||
        sy > sourceHeight - 0.5
      )
        continue;
      const px = Math.max(0, Math.min(sourceWidth - 1, sx)),
        py = Math.max(0, Math.min(sourceHeight - 1, sy));
      const x0 = Math.floor(px),
        y0 = Math.floor(py),
        x1 = Math.min(sourceWidth - 1, x0 + 1),
        y1 = Math.min(sourceHeight - 1, y0 + 1),
        dx = px - x0,
        dy = py - y0;
      for (let channel = 0; channel < 4; channel++)
        output[at + channel] =
          source[(y0 * sourceWidth + x0) * 4 + channel] * (1 - dx) * (1 - dy) +
          source[(y0 * sourceWidth + x1) * 4 + channel] * dx * (1 - dy) +
          source[(y1 * sourceWidth + x0) * 4 + channel] * (1 - dx) * dy +
          source[(y1 * sourceWidth + x1) * 4 + channel] * dx * dy;
    }
  }
  return output;
}
