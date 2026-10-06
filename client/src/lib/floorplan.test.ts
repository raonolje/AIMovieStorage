import { describe, expect, it } from "vitest";
import { normalizeComposition } from "./composition";
import { addRoomIn, upsertFloorplanWallIn } from "./compositionEdit";
import { floorplanWallPieces } from "./floorplan";
import { buildFloorplanWalls } from "@/components/composition/viewport/sceneHelpers";
import { reduceCompositionCommands } from "./compositionControlCommands";

describe("2D floorplan to 3D", () => {
  it("preserves measured wall and opening through save/reopen and controller edits", () => {
    const initial = addRoomIn(normalizeComposition(), "indoor");
    const id = initial.id;
    const wall = { id: "entry", start: { x: -2, z: 0 }, end: { x: 2, z: 0 }, thickness: 0.12, height: 2.6,
      opening: { kind: "door" as const, width: 0.9, bottom: 0, height: 2.1 } };
    const edited = upsertFloorplanWallIn(initial.state, id, wall);
    const reopened = normalizeComposition(JSON.parse(JSON.stringify(edited)));
    expect(reopened.rooms[0].floorplan?.walls[0]).toEqual(wall);
    expect(floorplanWallPieces(wall)).toHaveLength(3);
    const mesh = buildFloorplanWalls([wall]);
    expect(mesh.children).toHaveLength(3);
    const controlled = reduceCompositionCommands(reopened, [{ op: "floorplan.wall_upsert", roomId: id, wallId: "entry",
      start: { x: -2, z: 0 }, end: { x: 2, z: 0 }, thicknessMeters: 0.15, heightMeters: 2.8,
      opening: { kind: "window", widthMeters: 1.2, bottomMeters: 0.9, heightMeters: 1 } }]);
    expect(controlled.state.rooms[0].floorplan?.walls[0].opening?.kind).toBe("window");
    expect(floorplanWallPieces(controlled.state.rooms[0].floorplan!.walls[0])).toHaveLength(4);
  });
});
