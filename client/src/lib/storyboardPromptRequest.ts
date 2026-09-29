import { pickedCharacterRefs } from "@/lib/promptPayloads";
import { characterLegend, objectLegend } from "@/lib/compositionLegend";
import { cameraMovesOf } from "@/lib/compositionEdit";
import { describeCameraMoves } from "@/lib/cameraMoves";
import { cutVideoSecondsOf } from "@/lib/cutVideoPrompt";
import { fileStem } from "@/lib/mediaLibrary";
import { buildStoryboardVideoPrompt, type StoryboardCell, type StoryboardSwap } from "@/lib/storyboardSheet";
import type { Background, Character, Scene } from "@/lib/projectTypes";

export function storyboardLockNames(scene: Scene, characters: Character[]): string[] {
  return [...new Set(scene.cuts.flatMap((cut) => cut.characterIds || []))]
    .map((id) => characters.find((item) => item.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

/** 스토리보드 버튼과 대화 조종기가 같은 인물·소품·배경 @시트를 찾습니다. */
export function storyboardSwaps(cells: StoryboardCell[], characters: Character[], backgrounds: Background[]): StoryboardSwap[] {
  const out: StoryboardSwap[] = [];
  const seen = new Set<string>();
  const tagOf = (path?: string) => path ? `@${fileStem(path)}` : undefined;
  for (const cell of cells) {
    const cut = cell.cut;
    const legend = characterLegend(cut.composition, (id) => {
      const source = characters.find((item) => item.id === id);
      return source ? { name: source.name, gender: source.gender } : undefined;
    });
    const ids = legend.length ? legend.map((item) => item.characterId) : cut.characterIds;
    for (const id of ids) {
      if (seen.has(`c:${id}`)) continue;
      const source = characters.find((item) => item.id === id);
      if (!source) continue;
      seen.add(`c:${id}`);
      const picked = pickedCharacterRefs(cut, id);
      const auto = (source.generatedImages ?? []).find((item) => item.isCompositeSheet)
        ?? (source.generatedImages ?? []).find((item) => item.isPrimary);
      out.push({ kind: "character", name: source.name || "인물",
        color: legend.find((item) => item.characterId === id)?.color.ko,
        tag: tagOf(picked ? picked[0] : auto?.filePath) });
    }
    for (const item of objectLegend(cut.composition)) {
      const key = `p:${item.color.ko}:${item.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const swapRef = cut.composition?.objects.find((object) => object.id === item.id)?.swapRef;
      const asset = swapRef
        ? backgrounds.find((entry) => entry.id === swapRef.id) ?? characters.find((entry) => entry.id === swapRef.id)
        : undefined;
      out.push({ kind: "prop", name: swapRef?.name || item.label, color: item.color.ko,
        tag: tagOf((asset?.generatedImages ?? []).find((image) => image.isCompositeSheet)?.filePath
          ?? (asset?.generatedImages ?? []).find((image) => image.isPrimary)?.filePath) });
    }
    const place = backgrounds.find((item) => item.id === cut.backgroundId);
    if (place && !seen.has(`b:${place.id}`)) {
      seen.add(`b:${place.id}`);
      out.push({ kind: "background", name: place.name || "장소",
        tag: tagOf((place.generatedImages ?? []).find((image) => image.isPrimary)?.filePath
          ?? (place.generatedImages ?? [])[0]?.filePath) });
    }
  }
  return out;
}

export function storyboardRequestData(input: {
  scene: Scene;
  cells: StoryboardCell[];
  swaps: StoryboardSwap[];
  videoAspect?: string;
  lockNames: string[];
}) {
  const { scene, cells, swaps, videoAspect, lockNames } = input;
  const built = buildStoryboardVideoPrompt({
    sceneTitle: scene.title, sceneSummary: scene.summary, cells, aspect: videoAspect, lockNames,
  });
  return {
    sceneTitle: scene.title || "장면",
    sceneSummary: scene.summary || "",
    sheetTag: scene.storyboardPath ? `@${fileStem(scene.storyboardPath)}` : null,
    swaps,
    totalSeconds: Number(built.seconds.toFixed(1)),
    clamped: built.clamped,
    aspect: videoAspect || null,
    lockNames: lockNames.length ? lockNames : null,
    cuts: cells.map((cell) => {
      const moves = cell.cut.composition ? cameraMovesOf(cell.cut.composition) : [];
      return {
        order: cell.cut.order,
        title: cell.cut.title || null,
        seconds: Number(cutVideoSecondsOf(cell.cut).toFixed(1)),
        camera: describeCameraMoves(moves)?.ko ?? "고정",
        cameraEn: describeCameraMoves(moves)?.en ?? "locked-off static camera, no camera movement",
        description: cell.cut.description || null,
        acting: cell.cut.acting || null,
        vfx: cell.cut.vfx || null,
        marks: (cell.marks ?? []).map((mark, index) => `${index + 1}) ${mark.note || "동선"}`),
        fromGuide: cell.image.id.startsWith("guide-"),
      };
    }),
  };
}
