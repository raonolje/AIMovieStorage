import {
  COMPOSITION_CUBE_FACES,
  isHorizonRoom,
  normalizeComposition,
  type CompositionCubeFace,
  type CompositionState,
} from "@/lib/composition";
import {
  patchRoomIn,
  placeCharacterIn,
  roomsOf,
  updateCharacterIn,
} from "@/lib/compositionEdit";
import { collectFaceSets, type FaceKey } from "@/lib/faceSets";
import type { Background, Character, Cut } from "@/lib/projectTypes";

/**
 * 컷의 «캐릭터»·«배경» 선택과 구도잡기 씬을 맞춥니다.
 *
 * # 규칙 — 열 때는 컷이 기준, 닫을 때는 씬이 기준
 *
 * 양쪽이 서로를 채우면 **한쪽이 뺀 것을 다른 쪽이 되살립니다.** 컷에서 인물을 빼도 씬에는
 * 그대로 서 있고, 저장하는 순간 씬이 컷에 그 사람을 다시 넣어 주니까요. 그래서 방향마다
 * 주인을 하나로 못 박습니다.
 *
 * - **열 때**: 컷이 주인입니다. 컷에서 고른 인물 중 씬에 없는 사람을 기본 자리에 세우고,
 * 컷에서 뺀 사람은 씬에서 **숨깁니다**(지우지 않습니다 — 자리·포즈를 잃지 않게).
 * 배경도 같습니다. 컷이 고른 배경으로 갈아 끼우고, 컷에서 뺐으면 씬에서도 뺍니다.
 * - **닫을 때(저장)**: 씬이 주인입니다. 씬에 보이는 인물이 컷의 선택이 되고, 씬에 걸린
 * 배경이 컷의 배경이 됩니다.
 *
 * 사람이 마지막에 만진 쪽이 **늘 시간상 나중**이라(컷을 고치고 → 열고, 씬을 고치고 → 닫고)
 * 이 두 규칙만으로 되살아나는 일이 없습니다.
 *
 * # 예외 세 가지 (모두 «사람이 만든 것을 지우지 않으려고»)
 *
 * 1. **첫 동기화 전**(`cutSynced` 가 없는 옛 구도)에는 숨기기·비우기를 하지 않고 더하기만
 * 합니다. 동기화가 생기기 전에 잡아 둔 구도를 여는 순간 다 사라지면 안 되니까요.
 * 2. **마네킹**은 구도잡기 안에서만 사는 인물이라 컷 선택과 무관합니다. 양방향 모두 제외.
 * 3. **밖에서 떨어뜨린 배경·HDRI** 는 프로젝트 배경이 아니라 되짚을 짝이 없습니다.
 * 씬에 그런 배경이 걸려 있으면 열 때 갈아 끼우지 않고, 저장할 때 컷 선택도 그대로 둡니다.
 */

/** 씬 배경을 되짚을 때 쓰는 그림 한 장. id 는 구도잡기 목록과 같은 `filePath || id` 입니다. */
interface BackgroundImageEntry {
  id: string;
  name: string;
  filePath?: string;
  face?: FaceKey;
  faceSet?: string;
  isPrimary?: boolean;
  isCompositeSheet?: boolean;
}

/**
 * 배경 하나의 생성 이미지.
 *
 * 구도잡기의 `usePlannerMedia.availableBackgrounds` 와 **같은 재료·같은 id** 라야 씬에
 * 걸린 그림을 되짚을 수 있습니다(그쪽도 `generatedImages` 만 봅니다).
 */
export function sceneBackgroundImages(background: Background) {
  return background.generatedImages || [];
}

/**
 * 이 배경을 씬에 걸 수 있는가 — `applyBackgroundIn` 이 성공하는 조건과 **같은 뜻**.
 *
 * 컷 타일·저장 로직이 이걸로 판단해야 «타일에는 6면짜리로 보이는데 열면 한 장만
 * 걸린다» 나 «그림 없는 배경을 골라 뒀더니 저장할 때 선택이 지워진다» 가 안 생깁니다.
 */
export function canApplyBackground(background: Background): boolean {
  const entries = backgroundImages(background);
  if (collectFaceSets(entries, { legacy: true }).length) return true;
  // 6000px 합성 시트는 배경막으로 쓸 그림이 아닙니다(applyBackgroundIn 과 같은 규칙).
  return entries.some((image) => !image.isCompositeSheet);
}

function backgroundImages(background: Background): BackgroundImageEntry[] {
  return sceneBackgroundImages(background).map((image) => ({
    id: image.filePath || image.id,
    name: image.name,
    filePath: image.filePath,
    face: image.face,
    faceSet: image.faceSet,
    isPrimary: image.isPrimary,
    isCompositeSheet: image.isCompositeSheet,
  }));
}

/**
 * 배경 그림을 **걸 수 있는** 방들 — 호리존을 뺀 전부.
 *
 * 호리존 방은 그림을 안 붙이는 방입니다. 뷰포트는 색이 이겨 면 그림을 안 그리므로, 면 id 가
 * 남아 있어도 «걸린 배경» 이 아닙니다. 아래 읽기(`hasEnvironmentImage`·`environmentBackgroundIdOf`)와 쓰기
 * (`applyBackgroundIn`)가 같은 목록을 봐야 「걸었다는데 안 보이고, 저장하니 컷 배경이 그것으로 바뀐다」 가 안 생깁니다.
 */
function imageRoomsOf(composition: CompositionState) {
  return roomsOf(composition).filter((room) => !isHorizonRoom(room));
}

/**
 * 컷의 배경을 걸 방 — 활성 방이 호리존이 아니면 그 방, 호리존이면 **호리존이 아닌 첫 방**. 없으면 null.
 *
 * 활성 방이 호리존일 때 거기에 여섯 면 id 를 심으면 뷰포트는 색이 이겨 그림을 안 보여 주는데 알림은 «걸었습니다» 라
 * 하고, 방 규칙은 그 면 비율로 스튜디오 치수를 고칩니다 — 「걸었다는데 안 보이고 방만 줄었다」.
 * `usePlannerMedia.assignFaceSet` 의 호리존 가드와 같은 뜻입니다.
 */
function backgroundRoomIdOf(composition: CompositionState): string | null {
  const rooms = imageRoomsOf(composition);
  const active = rooms.find((room) => room.id === composition.activeRoomId);
  return (active ?? rooms[0])?.id ?? null;
}

/** 씬에 배경 그림이 하나라도 걸려 있는가(호리존이 아닌 어느 방이든 여섯 면 중 하나라도). */
export function hasEnvironmentImage(composition: CompositionState): boolean {
  return imageRoomsOf(composition).some((room) =>
    COMPOSITION_CUBE_FACES.some(
      (face) => !!room.faces[face] || !!room.outerFaces?.[face],
    ),
  );
}

/**
 * 씬에 걸린 배경이 **어느 프로젝트 배경의 것인가**. 밖에서 넣은 그림이면 null.
 */
export function environmentBackgroundIdOf(
  composition: CompositionState,
  backgrounds: Background[],
): string | null {
  const owner = new Map<string, string>();
  for (const background of backgrounds) {
    for (const image of backgroundImages(background)) owner.set(image.id, background.id);
  }
  for (const room of imageRoomsOf(composition)) {
    for (const face of COMPOSITION_CUBE_FACES) {
      const id = room.faces[face] || room.outerFaces?.[face];
      const found = id ? owner.get(id) : undefined;
      if (found) return found;
    }
  }
  return null;
}

/**
 * 배경 하나를 씬에 겁니다. 6면 세트가 있으면 여섯 면을 한 번에, 없으면 대표 한 장을 정면에.
 *
 * 정면 한 장만 걸어도 «그 장소» 는 보입니다. 여섯 면을 다 요구하면 6면으로 자르지 않은
 * 배경(대부분)은 영영 씬에 못 들어갑니다.
 *
 * 걸 방이 없으면(방이 아직 없거나 호리존뿐) null — 그림이 없을 때와 같은 «못 걸었다» 입니다.
 * 예전에는 활성 방에 무조건 심었는데, 방이 없으면 조용히 아무 일도 안 하면서 «걸었다» 고 돌려줬습니다.
 */
function applyBackgroundIn(
  current: CompositionState,
  background: Background,
): CompositionState | null {
  const roomId = backgroundRoomIdOf(current);
  if (!roomId) return null;
  const entries = backgroundImages(background);
  // 배경 갈래라 `6면/` 밖(옛 프로젝트 뿌리)의 이름 인식도 켭니다 — 구도잡기와 같은 옵션.
  const sets = collectFaceSets(entries, { legacy: true });
  const set = sets.find((item) => item.complete) ?? sets[0];
  if (set) {
    const faces: Partial<Record<CompositionCubeFace, string>> = {};
    for (const face of COMPOSITION_CUBE_FACES) {
      const entry = set.faces[face];
      if (entry) faces[face] = entry.image.id;
    }
    return patchRoomIn(current, roomId, (room) => ({ ...room, faces }));
  }

  const singles = entries.filter((image) => !image.isCompositeSheet);
  // 6000px 합성 시트는 배경막으로 쓸 그림이 아니라 위에서 뺐습니다.
  const primary = singles.find((image) => image.isPrimary) ?? singles[0];
  if (!primary) return null;
  return patchRoomIn(current, roomId, (room) => ({
    ...room,
    faces: { front: primary.id },
  }));
}

/** 그 배경에서 온 면만 비웁니다. 밖에서 넣은 그림이 섞여 있으면 남깁니다. */
function clearBackgroundIn(
  current: CompositionState,
  background: Background,
): CompositionState {
  const ids = new Set(backgroundImages(background).map((image) => image.id));
  /*
    방 **전부**를 훑습니다. 컷에서 배경 체크를 끄면 그 배경에서 온 면은 어느 방에 붙어
    있든 사라져야지, 활성 방만 비우면 옆방에 같은 그림이 남아 「껐는데 아직 보인다」 가
    됩니다.
  */
  const keep = (source: Partial<Record<CompositionCubeFace, string>>) => {
    const faces: Partial<Record<CompositionCubeFace, string>> = {};
    for (const face of COMPOSITION_CUBE_FACES) {
      const id = source[face];
      if (id && !ids.has(id)) faces[face] = id;
    }
    return faces;
  };
  return {
    ...current,
    rooms: roomsOf(current).map((room) => {
      const outer = room.outerFaces ? keep(room.outerFaces) : undefined;
      return {
        ...room,
        faces: keep(room.faces),
        outerFaces: outer && Object.keys(outer).length ? outer : undefined,
      };
    }),
  };
}

/** 이 배치가 마네킹인가. 옛 데이터에는 `isMannequin` 표가 없어 목록으로도 확인합니다. */
const mannequinChecker = (composition: CompositionState) => {
  const ids = new Set(composition.mannequins.map((item) => item.id));
  return (characterId: string, isMannequin?: boolean) => !!isMannequin || ids.has(characterId);
};

export interface CutSelectionSource {
  characterIds: string[];
  backgroundId?: string;
}

/**
 * 구도잡기를 **열 때** — 컷의 선택을 씬에 반영합니다.
 *
 * 돌려주는 구도는 컷에 바로 저장하지 않습니다. 창을 그냥 닫으면 아무 일도 없어야 하니까요.
 * 저장을 누르면 그때 `readCompositionIntoCut` 과 함께 컷에 실립니다.
 */
export function syncCutIntoComposition(
  composition: CompositionState | undefined,
  {
    cut,
    characters,
    backgrounds,
  }: { cut: CutSelectionSource; characters: Character[]; backgrounds: Background[] },
): { composition: CompositionState; notice: string | null } {
  const base = normalizeComposition(composition);
  // 첫 동기화 전에는 지우지 않습니다 — 위 «예외 1».
  const firstTime = !base.cutSynced;
  const projectIds = new Set(characters.map((item) => item.id));
  const isMannequin = mannequinChecker(base);

  let next: CompositionState = { ...base, cutSynced: true };
  const notices: string[] = [];

  // ── 인물 ────────────────────────────────────────────────────────────────
  const wanted = cut.characterIds.filter((id) => projectIds.has(id));
  let added = 0;
  for (const id of wanted) {
    const placement = next.characters.find((item) => item.characterId === id);
    if (!placement) {
      next = placeCharacterIn(next, id);
      added += 1;
    } else if (placement.hidden) {
      // 컷에서 다시 체크한 사람은 씬에서도 되살립니다(자리·포즈는 그대로).
      next = updateCharacterIn(next, id, { hidden: false });
      added += 1;
    }
  }

  let dropped = 0;
  if (!firstTime) {
    // 갱신할 때마다 배열이 새로 만들어지므로 지금 목록을 떠서 돕니다.
    for (const placement of [...next.characters]) {
      if (placement.hidden) continue;
      if (isMannequin(placement.characterId, placement.isMannequin)) continue;
      // 프로젝트에서 지워진 인물은 컷 선택에도 없으니 여기서 판단하지 않습니다.
      if (!projectIds.has(placement.characterId)) continue;
      if (wanted.includes(placement.characterId)) continue;
      next = updateCharacterIn(next, placement.characterId, { hidden: true });
      dropped += 1;
    }
  }

  if (added) notices.push(`컷에서 고른 인물 ${added}명을 씬에 넣었습니다`);
  if (dropped) notices.push(`컷에서 뺀 인물 ${dropped}명을 씬에서 뺐습니다`);

  // ── 배경 ────────────────────────────────────────────────────────────────
  const owner = environmentBackgroundIdOf(next, backgrounds);
  const wantedBackground = cut.backgroundId
    ? backgrounds.find((item) => item.id === cut.backgroundId)
    : undefined;

  if (wantedBackground) {
    // 씬이 이미 다른 «프로젝트» 배경을 걸고 있거나 아무것도 없을 때만 갈아 끼웁니다.
    // 밖에서 떨어뜨린 그림·HDRI 는 짝이 없어 되짚을 수 없으니 그대로 둡니다(예외 3).
    const replaceable = owner !== null || !hasEnvironmentImage(next);
    if (owner !== wantedBackground.id && replaceable) {
      const applied = applyBackgroundIn(next, wantedBackground);
      const name = wantedBackground.name || "이름 없음";
      if (applied) {
        next = applied;
        notices.push(`컷의 배경 «${name}» 을 씬에 걸었습니다`);
      } else if (!canApplyBackground(wantedBackground)) {
        /*
          «프롬프트 먼저, 그림은 나중» 이 이 앱의 기본 흐름이라 «골라 뒀지만 그림이
          아직 없는 배경» 은 흔합니다. 조용히 넘기면 사람은 씬에 걸린 줄 알고,
          저장할 때 컷 선택이 지워지거나 다른 배경으로 바뀐 걸 나중에 알게 됩니다.
        */
        notices.push(`«${name}» 에 아직 그림이 없어 씬에 걸지 못했습니다`);
      } else {
        /*
          그림은 있는데 **걸 방이 없습니다** — 호리존뿐이거나 방이 아직 없는 새 컷. 까닭을 갈라 말합니다:
          호리존이면 「그림을 안 붙이는 방」 이라 알려야 사람이 실내·실외 방을 고르고, 방이 없으면
          「방을 세우면 된다」 를 알아야 합니다. 예전에는 이때도 «걸었습니다» 라 했습니다(아무 일도 없었는데).
        */
        notices.push(
          roomsOf(next).length
            ? `«${name}» 은 호리존 방에는 걸 수 없어 씬에 걸지 않았습니다 — 실내·실외 방을 고르세요`
            : `«${name}» 을 걸 방이 아직 없어 씬에 걸지 않았습니다`,
        );
      }
    }
  } else if (!firstTime && owner) {
    const previous = backgrounds.find((item) => item.id === owner);
    if (previous) {
      next = clearBackgroundIn(next, previous);
      notices.push("컷에서 뺀 배경을 씬에서도 뺐습니다");
    }
  }

  return { composition: next, notice: notices.length ? notices.join(" · ") : null };
}

/**
 * 구도잡기를 **닫을 때(저장)** — 씬에 있는 것을 컷의 선택으로 올립니다.
 *
 * 바뀐 칸만 돌려줍니다. 컷의 순서는 되도록 지킵니다 — 저장할 때마다 칩 순서가 섞이면
 * 「내가 뭘 건드렸나」 싶으니까요.
 */
export function readCompositionIntoCut(
  composition: CompositionState,
  {
    cut,
    characters,
    backgrounds,
  }: { cut: CutSelectionSource; characters: Character[]; backgrounds: Background[] },
): { patch: Partial<Cut>; notice: string | null } {
  const projectIds = new Set(characters.map((item) => item.id));
  const isMannequin = mannequinChecker(composition);
  const patch: Partial<Cut> = {};
  const notices: string[] = [];

  // ── 인물 ────────────────────────────────────────────────────────────────
  const inScene = composition.characters
    .filter(
      (item) =>
        !item.hidden &&
        !isMannequin(item.characterId, item.isMannequin) &&
        projectIds.has(item.characterId),
    )
    .map((item) => item.characterId);

  const kept = cut.characterIds.filter((id) => inScene.includes(id));
  const fresh = inScene.filter((id) => !cut.characterIds.includes(id));
  const characterIds = [...kept, ...fresh];
  const removed = cut.characterIds.filter((id) => projectIds.has(id) && !inScene.includes(id));

  if (fresh.length || removed.length || characterIds.length !== cut.characterIds.length) {
    patch.characterIds = characterIds;
    if (fresh.length) notices.push(`씬의 인물 ${fresh.length}명을 컷에서 골랐습니다`);
    if (removed.length) notices.push(`씬에서 뺀 인물 ${removed.length}명을 컷 선택에서 뺐습니다`);
  }

  // ── 배경 ────────────────────────────────────────────────────────────────
  const owner = environmentBackgroundIdOf(composition, backgrounds);
  const current = cut.backgroundId || "";
  /*
    컷이 고른 배경에 **씬에 걸 그림이 아직 없으면** 열 때 반영 자체가 안 됐습니다.
    그런 상태에서 씬을 읽으면 «사람이 씬에서 뺐다» 로 잘못 읽혀, 열었다 저장만
    해도 컷의 배경 선택이 지워지거나(그림 없는 배경 + 빈 씬) 씬에 걸려 있던 다른
    배경으로 말없이 바뀝니다. 그래서 이 경우에는 컷 선택을 아예 건드리지 않습니다.
    (인물은 그림이 없어도 `placeCharacterIn` 이 세우므로 배경에만 있는 문제입니다.)
  */
  const chosen = current ? backgrounds.find((item) => item.id === current) : undefined;
  /**
   * 컷이 고른 배경을 씬에 걸 수 있었는가. 아니면 이 아래 판단이 전부 뜻을 잃습니다.
   * 걸 **방**이 없었을 때(호리존뿐·방 없음)도 같습니다 — 열 때 못 걸었으니 씬이 비었다고 «사람이 뺐다» 가 아닙니다.
   * 호리존에서는 프롬프트가 장소를 어차피 안 싣고(`horizonOverridesLocation`), 호리존을 지우면 장소가 다시 살아나야 합니다.
   */
  const chosenApplicable =
    !chosen || (canApplyBackground(chosen) && backgroundRoomIdOf(composition) !== null);
  if (chosenApplicable && owner && owner !== current) {
    patch.backgroundId = owner;
    const name = backgrounds.find((item) => item.id === owner)?.name || "이름 없음";
    notices.push(`씬의 배경 «${name}» 을 컷에서 골랐습니다`);
  } else if (chosenApplicable && !owner && current && !hasEnvironmentImage(composition)) {
    // 씬 배경이 «비었을» 때만 컷에서도 뺍니다. 밖에서 넣은 그림이 걸려 있으면 그대로(예외 3).
    patch.backgroundId = "";
    notices.push("씬에서 뺀 배경을 컷 선택에서도 뺐습니다");
  }

  return { patch, notice: notices.length ? notices.join(" · ") : null };
}
