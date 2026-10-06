import type { CompositionRoom, FloorplanWall } from "./composition";

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** One shared boundary for saved plans, UI edits and controller commands. */
export function normalizeFloorplanWall(value: FloorplanWall, room: Pick<CompositionRoom, "width" | "depth" | "height">): FloorplanWall | null {
  if (!value || typeof value !== "object" || !value.start || !value.end || !value.id) return null;
  const xLimit = room.width / 2;
  const zLimit = room.depth / 2;
  const point = (p: { x: number; z: number }) => ({
    x: clamp(finite(p?.x, 0), -xLimit, xLimit),
    z: clamp(finite(p?.z, 0), -zLimit, zLimit),
  });
  const start = point(value.start);
  const end = point(value.end);
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  if (length < 0.1) return null;
  const height = clamp(finite(value.height, room.height), 0.4, room.height);
  const opening = value.opening;
  return {
    id: String(value.id).slice(0, 200), start, end,
    thickness: clamp(finite(value.thickness, 0.12), 0.03, 1), height,
    opening: opening && (opening.kind === "door" || opening.kind === "window")
      ? {
          kind: opening.kind,
          width: clamp(finite(opening.width, 0.9), 0.2, Math.max(0.2, length - 0.1)),
          bottom: clamp(finite(opening.bottom, opening.kind === "door" ? 0 : 0.9), 0, height - 0.2),
          height: clamp(finite(opening.height, opening.kind === "door" ? 2 : 1), 0.2, height),
        }
      : undefined,
  };
}

export function floorplanWallPieces(wall: FloorplanWall): { offset: number; width: number; bottom: number; height: number }[] {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
  if (!wall.opening) return [{ offset: 0, width: length, bottom: 0, height: wall.height }];
  const openingWidth = Math.min(wall.opening.width, length - 0.1);
  const flank = (length - openingWidth) / 2;
  const bottom = wall.opening.kind === "door" ? 0 : Math.min(wall.opening.bottom, wall.height - 0.2);
  const top = Math.min(wall.height, bottom + wall.opening.height);
  const pieces = [
    { offset: -(length + openingWidth) / 4, width: flank, bottom: 0, height: wall.height },
    { offset: (length + openingWidth) / 4, width: flank, bottom: 0, height: wall.height },
  ];
  if (bottom > 0) pieces.push({ offset: 0, width: openingWidth, bottom: 0, height: bottom });
  if (top < wall.height) pieces.push({ offset: 0, width: openingWidth, bottom: top, height: wall.height - top });
  return pieces;
}
