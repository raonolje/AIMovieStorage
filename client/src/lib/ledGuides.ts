/** 두 편집기가 같은 좌표와 실측 계산을 써야 LED 크롭 위치가 달라지지 않습니다. */
export interface LedGuide {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  ratioWidth: number;
  ratioHeight: number;
  fit: "width" | "height" | "free";
  x: number;
  y: number;
  width: number;
  physicalHeightM: number;
}
export interface LedGuideSettings {
  version: 1;
  visible: boolean;
  guides: LedGuide[];
  actor: {
    visible: boolean;
    guideId: string;
    heightCm: number;
    forwardM: number;
    viewerDistanceM: number;
    x: number;
    footY: number;
    opacity: number;
  };
}
export interface LedGuidePreset {
  id: string;
  name: string;
  settings: LedGuideSettings;
}
export const LED_PRESETS_KEY = "aimoviestorage.led-guide-presets.v1";
export const LED_COLORS = [
  "#22d3ee",
  "#fb923c",
  "#a78bfa",
  "#4ade80",
  "#f472b6",
  "#facc15",
];
export const newLedId = () => crypto.randomUUID();
export function defaultLedSettings(): LedGuideSettings {
  return {
    version: 1,
    visible: true,
    guides: [],
    actor: {
      visible: false,
      guideId: "",
      heightCm: 183,
      forwardM: 2,
      viewerDistanceM: 10,
      x: 0.5,
      footY: 1,
      opacity: 0.7,
    },
  };
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : fallback;
export function normalizeLedSettings(value: unknown): LedGuideSettings {
  const d = defaultLedSettings(),
    v = obj(value),
    a = obj(v.actor),
    ids = new Set<string>();
  const guides: LedGuide[] = (Array.isArray(v.guides) ? v.guides : [])
    .slice(0, 32)
    .map((raw, index) => {
      const g = obj(raw);
      let id = typeof g.id === "string" && g.id ? g.id : `led-${index}`;
      while (ids.has(id)) id += "-copy";
      ids.add(id);
      return {
        id,
        name:
          typeof g.name === "string"
            ? g.name.slice(0, 100)
            : `LED ${index + 1}`,
        color:
          typeof g.color === "string" && /^#[0-9a-f]{6}$/i.test(g.color)
            ? g.color
            : LED_COLORS[index % LED_COLORS.length],
        visible: g.visible !== false,
        ratioWidth: num(g.ratioWidth, 16, 0.01, 100000),
        ratioHeight: num(g.ratioHeight, 9, 0.01, 100000),
        fit: g.fit === "width" || g.fit === "height" ? g.fit : "free",
        x: num(g.x, 0, -10, 10),
        y: num(g.y, 0, -10, 10),
        width: num(g.width, 0.5, 0.001, 10),
        physicalHeightM: num(g.physicalHeightM, 2.5, 0.01, 1000),
      };
    });
  return {
    version: 1,
    visible: v.visible !== false,
    guides,
    actor: {
      visible: a.visible === true,
      guideId:
        typeof a.guideId === "string" && ids.has(a.guideId)
          ? a.guideId
          : (guides[0]?.id ?? ""),
      heightCm: num(a.heightCm, d.actor.heightCm, 1, 400),
      forwardM: num(a.forwardM, 2, 0, 1000),
      viewerDistanceM: num(a.viewerDistanceM, 10, 0.01, 10000),
      x: num(a.x, 0.5, -10, 10),
      footY: num(a.footY, 1, -10, 10),
      opacity: num(a.opacity, 0.7, 0.1, 1),
    },
  };
}
export function guideRect(g: LedGuide, aspect: number) {
  const frameAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const ratio = g.ratioWidth / g.ratioHeight;
  const width =
    g.fit === "width" ? 1 : g.fit === "height" ? ratio / frameAspect : g.width;
  return { x: g.x, y: g.y, width, height: (width * frameAspect) / ratio };
}
export function fitLedGuide(
  g: LedGuide,
  fit: LedGuide["fit"],
  aspect: number,
): LedGuide {
  // 맞춤은 크기만 바꿉니다. 꺾인 영역을 표시하려고 옮긴 위치를 덮어쓰지 않습니다.
  return { ...g, width: guideRect(g, aspect).width, fit };
}
export function actorProjection(s: LedGuideSettings, aspect: number) {
  const g = s.guides.find((item) => item.id === s.actor.guideId);
  if (!g || s.actor.forwardM >= s.actor.viewerDistanceM) return null;
  const rect = guideRect(g, aspect);
  const ratio =
    ((s.actor.heightCm / 100 / g.physicalHeightM) * s.actor.viewerDistanceM) /
    (s.actor.viewerDistanceM - s.actor.forwardM);
  return {
    x: rect.x + s.actor.x * rect.width,
    footY: rect.y + s.actor.footY * rect.height,
    height: rect.height * ratio,
    relativeHeight: ratio,
  };
}
export function guideOutside(g: LedGuide, aspect: number) {
  const r = guideRect(g, aspect);
  return (
    r.x < 0 || r.y < 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001
  );
}
export function encodeLedPreset(name: string, settings: LedGuideSettings) {
  return JSON.stringify(
    {
      format: "aimoviestorage-led-guides",
      version: 1,
      name,
      settings: normalizeLedSettings(settings),
    },
    null,
    2,
  );
}
export function decodeLedPreset(text: string): {
  name: string;
  settings: LedGuideSettings;
} {
  const v = obj(JSON.parse(text));
  if (
    v.format !== "aimoviestorage-led-guides" ||
    v.version !== 1 ||
    !Array.isArray(obj(v.settings).guides)
  )
    throw new Error("LED 가이드 설정 파일이 아닙니다.");
  return {
    name: typeof v.name === "string" ? v.name : "불러온 배치",
    settings: normalizeLedSettings(v.settings),
  };
}
export function loadLedPresets(): LedGuidePreset[] {
  const raw = localStorage.getItem(LED_PRESETS_KEY);
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows))
    throw new Error("저장된 LED 배치를 읽을 수 없습니다.");
  return rows
    .map(obj)
    .filter((v) => typeof v.id === "string" && typeof v.name === "string")
    .map((v) => ({
      id: v.id as string,
      name: v.name as string,
      settings: normalizeLedSettings(v.settings),
    }));
}
export function saveLedPresets(rows: LedGuidePreset[]) {
  localStorage.setItem(LED_PRESETS_KEY, JSON.stringify(rows));
}

/** 삭제한 영역을 다시 더해도 남은 영역과 기본색이 겹치지 않게 합니다. */
export function nextLedColor(guides: LedGuide[]): string {
  const used = new Set(guides.map(g => g.color.toLowerCase()));
  const first = LED_COLORS.find(c => !used.has(c));
  if (first) return first;
  for (let index = 1; index < 100; index++) {
    const hue = (index * 137.508) % 360 / 60;
    const x = 0.65 * (1 - Math.abs(hue % 2 - 1));
    const rgb = hue < 1 ? [.65, x, 0] : hue < 2 ? [x, .65, 0] : hue < 3 ? [0, .65, x] : hue < 4 ? [0, x, .65] : hue < 5 ? [x, 0, .65] : [.65, 0, x];
    const color = "#" + rgb.map(c => Math.round((c + .25) * 255).toString(16).padStart(2, "0")).join("");
    if (!used.has(color)) return color;
  }
  return "#ffffff";
}
export function ledImageStorageKey(project: string, image: string) {
  let hash = 2166136261;
  for (let index = 0; index < image.length; index++) hash = Math.imul(hash ^ image.charCodeAt(index), 16777619);
  return `${project}:${image.length}:${(hash >>> 0).toString(16)}`;
}
