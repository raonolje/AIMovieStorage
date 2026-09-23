import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { measureAspect } from "@/lib/imageSize";
import {
  assetSrc,
  fileStem,
  isVideoFile,
  listOwnerFiles,
  safeFileName,
  saveProjectMediaAsset,
  PANORAMA_DIR,
  SIX_FACES_DIR,
} from "@/lib/mediaLibrary";
import { variationStemOf } from "@/lib/assetStem";
import type { PanoramaSpace } from "@/lib/blueprint";
import { autoEquirectOf } from "@/components/project/useAutoUnfold";
import {
  COMPOSITION_CUBE_FACES,
  isPanoramaAspect,
  roomVideoFaceOf,
  type BackgroundKind,
  type CompositionCubeFace,
  type CompositionState,
  type GlbTrack,
  type RoomVideoFace,
} from "@/lib/composition";
import {
  addCustomBackgroundIn,
  addGlbTrackIn,
  createGlbTrack,
  patchCustomBackgroundIn,
  selectCustomBackgroundIn,
  activeRoomOf,
  roomFacesOf,
  roomsOf,
  renameRoomIn,
  addRoomIn,
  setRoomFaceIn,
  setRoomDimsIn,
  setRoomFaceRatioIn,
  setRoomPanoramaIn,
  setRoomSideCropIn,
  uid,
  updateGlbIn,
  type RoomFaceShell,
  type UpdateComposition,
} from "@/lib/compositionEdit";
import type { Background, FaceSetSize } from "@/lib/projectTypes";
import { fetchFaceSetSize } from "@/lib/pngMeta";
import {
  collectFaceSets,
  FACE_KEYS,
  isFaceSetMember,
  parseFaceStem,
  type FaceKey,
  type FaceSet,
} from "@/lib/faceSets";

/** 같은 파일을 두 번 넣지 않습니다 — 프로젝트 목록과 폴더 읽기가 같은 그림을 각각 들고 옵니다. */
function dedupeById(list: PlannerBackground[]): PlannerBackground[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * 세트를 걸 때 **카드가 적어 둔 공간 크기**로 방을 세웁니다(`GeneratedImageAsset.faceSetSize`).
 *
 * 층고(높이)만 넣으면 가로·깊이는 면 비율이 따라옵니다(`CompositionPlanner` 의 비율 효과 — 실외는 옆면 아래를 잘라 붙이므로 S×S×(S/2+눈높이) — `CompositionRoom.sideCropBottom`).
 * 카드 치수가 적힌 세트는 가로·깊이도 그 치수로 세우고 벽 비를 방에 적어 둡니다(`CompositionRoom.faceRatio` — 까닭은 거기).
 * 바깥 껍질 세트는 방 크기를 안 바꿉니다 — 안쪽이 이미 정한 크기입니다. 크기 표시가 없는 옛 세트는 그대로 둡니다.
 */
export function applyFaceSetSizeIn(
  current: CompositionState,
  set: FaceSet<PlannerBackground>,
  shell: RoomFaceShell,
): CompositionState {
  if (shell === "outer") return current;
  const sample = FACE_KEYS.map((face) => set.faces[face]?.image).find((image) => image?.faceSetSize);
  /*
    자르기·벽 비도 세트를 따라 갈아 끼웁니다 — 실외 세트를 걸었다가 크기 표시 없는 옛 세트로 바꾸면 자르기가 풀리고 그림 비율로
    돌아가야 합니다(남아 있으면 옛 세트의 벽 아래가 잘립니다).
  */
  if (!sample?.faceSetSize) return setRoomFaceRatioIn(setRoomSideCropIn(current, undefined), undefined);
  const size = sample.faceSetSize;
  const height = size.height > 0 ? size.height : null;
  const next = setRoomDimsIn(current, height ? { width: size.width, depth: size.depth, height } : {});
  const ratio = height && size.width > 0 && size.depth > 0 ? { width: size.width / height, depth: size.depth / height } : undefined;
  return setRoomFaceRatioIn(setRoomSideCropIn(next, size.cropBottom), ratio);
}

/** 크기 표시가 없는 세트 면에 주인 카드에서 지은 크기를 붙입니다(`usePlannerMedia` 의 `cardSetSizes` 주석). */
function withCardSetSizes(list: PlannerBackground[], sizes: Map<string, FaceSetSize>): PlannerBackground[] {
  if (!sizes.size) return list;
  return list.map((item) => {
    if (item.faceSetSize || !item.faceSet) return item;
    const prefix = item.faceSet.replace(/_\d{3,}$/, "");
    const size = sizes.get(prefix);
    return size ? { ...item, faceSetSize: size } : item;
  });
}

/** 배경 목록의 한 줄. 프로젝트 배경의 생성 이미지와 구도에서 직접 넣은 그림을 같은 모양으로 봅니다. */
export interface PlannerBackground {
  id: string;
  name: string;
  thumb: string;
  kind?: BackgroundKind;
  filePath?: string;
  aspect?: number;
  sourceUrl?: string;
  /** 6면 세트의 면·세트 표(파노라마 탭이 저장할 때 붙임). 없으면 `faceSets` 가 이름으로 압니다. */
  face?: FaceKey;
  faceSet?: string;
  /** 카드가 이 세트를 뽑은 공간 크기(`GeneratedImageAsset.faceSetSize`). */
  faceSetSize?: FaceSetSize;
}

/**
 * 장소 폴더에서 읽은 **영상** 한 줄 — 방의 «배경 영상» 으로 걸 수 있는 것들.
 *
 * 그림 목록과 따로 두는 까닭: 폴더 읽기는 그림과 영상을 함께 돌려주는데(`list_reference_files`),
 * 여태 전부 그림으로 보고 목록에 올렸습니다 — 장소 폴더에 mp4 가 하나라도 있으면 깨진 그림 칸이
 * 하나 생겼습니다. 갈래를 나누면서 그 칸이 «걸 수 있는 영상» 이 됩니다.
 */
export interface PlannerVideo {
  /** 파일 경로. 방의 `video.source` 에 그대로 적힙니다. */
  id: string;
  /** «장소 · 파일이름». 어느 장소에서 뽑은 것인지 목록에서 바로 보입니다. */
  name: string;
  /** `asset://` 주소 — 씬이 `<video>` 에 물립니다. */
  src: string;
}

/**
 * 구도잡기의 배경 목록과 파일 넣기(배경·파노라마·HDRI·GLB).
 *
 * 화면(환경 탭·타임라인 탭·드롭 영역)이 셋으로 나뉘어도 «파일 하나를 어디에
 * 어떻게 넣는가» 는 한 곳이어야 합니다. 폴더 저장은 수 초가 걸리므로 모든
 * 갱신은 `setState((current) => …)` 로만 합니다.
 */
export function usePlannerMedia({
  state,
  setState,
  backgrounds,
  open,
  projectName,
  sceneTitle,
  setPreviewing,
  faceShell = "inner",
}: {
  state: CompositionState;
  setState: UpdateComposition;
  backgrounds: Background[];
  /** 면을 붙일 때 **안쪽**인지 **바깥쪽**인지. 환경 탭의 토글이 넘깁니다. */
  faceShell?: RoomFaceShell;
  /** 구도잡기 창이 열려 있는가. 닫혀 있으면 폴더를 안 읽습니다(컷마다 항상 마운트됩니다). */
  open?: boolean;
  projectName?: string;
  sceneTitle?: string;
  setPreviewing: (value: boolean) => void;
}) {
  const rooms = roomsOf(state);
  const activeRoom = activeRoomOf(state);
  /*
    ── 폴더에서 직접 읽습니다 ────────────────────────────────────────────
    , 「배경 이미지 리스트도 자동으로 앞에서 만든 배경들 불러와야 하고」.

    프로젝트가 들고 있는 `generatedImages` 는 **그 배경 카드를 한 번이라도 연 뒤에** 채워집니다.
    배경 단계에 안 들르고 구도잡기부터 열면 목록이 거의 비고, 6면 세트도 마침 채워져 있던
    배경 것 하나만 보입니다.

    **폴더가 원본입니다**(`listOwnerFiles` 머리말). 창을 열 때 배경 주인 폴더의 뿌리와
    `6면/` 을 직접 읽어 채웁니다. `6면/` 은 뿌리 읽기에 딸려 오지 않아 따로 부릅니다.

    창이 닫혀 있으면 안 읽습니다 — 컷 카드마다 항상 마운트되므로, 안 그러면 작업실 목록을
    그리는 순간 «컷 수 × 배경 수» 만큼 폴더를 읽습니다.
  */
  const [folderBackgrounds, setFolderBackgrounds] = useState<
    PlannerBackground[]
  >([]);
  /**
   * 같은 읽기에서 갈라낸 **영상**들 — 방의 «배경 영상» 목록입니다.
   *
   * 폴더를 다시 읽는 것은 창을 열 때뿐이라, 여기서 만든 영상은 그 자리에서 이 목록에 더합니다
   * (`rememberRoomVideo`). 안 그러면 방금 만든 것을 걸려고 창을 닫았다 다시 열어야 합니다.
   */
  const [folderVideos, setFolderVideos] = useState<PlannerVideo[]>([]);
  const backgroundNamesKey = backgrounds.map((item) => item.name).join("|");
  useEffect(() => {
    if (!open || !projectName?.trim()) return;
    let alive = true;
    void (async () => {
      const found: PlannerBackground[] = [];
      /** 같은 읽기에서 갈라낸 영상 — 방의 «배경 영상» 으로 겁니다(`PlannerVideo` 머리말). */
      const videos: PlannerVideo[] = [];
      for (const background of backgrounds) {
        const ownerName = background.name?.trim();
        if (!ownerName) continue;
        const ask = (subdir?: typeof SIX_FACES_DIR) =>
          listOwnerFiles({
            projectName,
            assetType: "background-generated",
            ownerName,
            subdir,
          });
        const [root, faces] = await Promise.all([ask(), ask(SIX_FACES_DIR)]);
        for (const file of [...root, ...faces]) {
          const thumb = assetSrc(file.filePath);
          if (!thumb) continue;
          const stem = fileStem(file.filePath);
          // 영상은 그림 목록에 안 올립니다 — 올리면 깨진 그림 칸이 됩니다(`PlannerVideo` 머리말).
          if (isVideoFile(file.filePath)) {
            videos.push({ id: file.filePath, name: `${ownerName} · ${stem}`, src: thumb });
            continue;
          }
          const parsed = parseFaceStem(stem);
          found.push({
            id: file.filePath,
            name: `${ownerName} · ${stem}`,
            thumb,
            kind: "background" as BackgroundKind,
            filePath: file.filePath,
            face: parsed?.face,
            faceSet: parsed?.setId,
          });
        }
      }
      /*
        폴더에서 읽은 세트는 project.json 의 크기(`faceSetSize`)를 모릅니다. 세트마다 한 장만 열어 파일 안에 적힌 크기를 읽고
        그 세트 여섯 장에 붙입니다(`pngMeta` 머리말). 없으면 크기 없는 옛 세트 그대로.
      */
      const firstOfSet = new Map<string, PlannerBackground>();
      for (const item of found) if (item.faceSet && !firstOfSet.has(item.faceSet)) firstOfSet.set(item.faceSet, item);
      const sizes = new Map<string, FaceSetSize>();
      await Promise.all(
        [...firstOfSet].map(async ([setId, item]) => {
          if (!/\.png$/i.test(item.filePath || "")) return;
          const size = await fetchFaceSetSize(item.thumb);
          if (size) sizes.set(setId, size);
        }),
      );
      const sized = found.map((item) => {
        const size = item.faceSet ? sizes.get(item.faceSet) : undefined;
        return size ? { ...item, faceSetSize: size } : item;
      });
      if (!alive) return;
      setFolderBackgrounds(sized);
      /*
        폴더에 없던 것(방금 만들어 `rememberRoomVideo` 로 더해 둔 것)은 남깁니다 — 읽기가 늦게
        끝나면서 목록을 통째로 갈아 끼우면 방금 만든 영상이 사라집니다.
      */
      setFolderVideos((current) => [
        ...videos,
        ...current.filter((item) => !videos.some((found) => found.id === item.id)),
      ]);
    })();
    return () => {
      alive = false;
    };
    // 배경 이름 목록이 바뀔 때와 창을 열 때만. 배열 자체는 매 렌더 새 참조입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectName, backgroundNamesKey]);

  // ── 배경 ──────────────────────────────────────────────────────────────
  /*
    ── 크기 표시가 없는 세트는 **주인 카드의 등장방형 칩·크기**로 ────────────────────────
     전개도 작업대에서 **손으로 잘라 저장한** 세트와
    업스케일로 덮어쓴 면에는 크기 표시(`faceSetSize` · 파일 속 조각)가 없어, 세트를 걸어도 방이 앞서 걸린 세트의 크기(2.8 m)에
    머물렀습니다. 세트 이름의 접두는 «장소» 또는 «장소_변형» 이라 어느 카드에서 뽑았는지 알 수 있습니다 — 그 카드가 지금
    켜 둔 칩(«등장방형 · 실외» 한 변, 실내 가로·깊이·층고)으로 자동 커팅과 같은 크기를 짓습니다(`autoEquirectOf`).
    크기 표시가 있으면 늘 그것이 먼저입니다(뽑을 때의 크기).
  */
  const cardSetSizes = useMemo(() => {
    const map = new Map<string, FaceSetSize>();
    for (const background of backgrounds) {
      const put = (
        stem: string,
        card: { blueprint?: string[]; panoramaSpace?: PanoramaSpace; exteriorSpace?: PanoramaSpace; promptEn?: string; promptKo?: string },
      ) => {
        // 카드의 지금 프롬프트에 적힌 크기가 먼저 — 그림은 그 크기로 뽑혔습니다(`autoEquirectOf` 의 promptText).
        const size = autoEquirectOf(card.blueprint, background.spaceKind, card.panoramaSpace, card.exteriorSpace, null, `${card.promptEn ?? ""}
${card.promptKo ?? ""}`)?.stamp;
        if (!size) return;
        map.set(safeFileName(stem), size);
        map.set(safeFileName(`${stem}_외벽`), size);
      };
      if (!background.name?.trim()) continue;
      put(background.name, background);
      for (const variation of background.variations || []) put(variationStemOf(background.name, variation.name), variation);
    }
    return map;
  }, [backgrounds]);

  const availableBackgrounds = useMemo<PlannerBackground[]>(
    () => {
      // 프로젝트가 아는 줄에 크기가 없으면 폴더 파일에서 읽은 크기로 채웁니다(같은 파일 — id 가 경로).
      const folderSize = new Map(folderBackgrounds.filter((item) => item.faceSetSize).map((item) => [item.id, item.faceSetSize]));
      return withCardSetSizes(dedupeById([
        ...backgrounds
          .flatMap((background) =>
            (background.generatedImages || []).map((image) => ({
              id: image.filePath || image.id,
              name: `${background.name} · ${image.name}`,
              // blob 주소는 앱을 닫으면 죽습니다. 저장된 파일이 먼저입니다 —
              // 그러지 않으면 재시작한 뒤 배경 목록이 통째로 비어 보입니다.
              thumb: assetSrc(image.filePath) || image.thumb,
              kind: "background" as BackgroundKind,
              filePath: image.filePath,
              face: image.face,
              faceSet: image.faceSet,
              faceSetSize: image.faceSetSize ?? folderSize.get(image.filePath || image.id),
            })),
          )
          .filter((item) => item.thumb),
        // 프로젝트가 아는 것이 먼저 — 이름이 «배경 · 그림» 꼴로 더 읽기 좋습니다.
        // 폴더에서 읽은 것은 그것이 놓친 자리(카드를 한 번도 안 연 배경)를 메웁니다.
        ...folderBackgrounds,
        // 저장된 파일이 먼저, blob 은 그다음. 다시 연 뒤에는 blob 이 없습니다.
        ...state.customBackgrounds.map((item) => ({
          ...item,
          thumb: assetSrc(item.filePath) || item.thumb,
        })),
      ]), cardSetSizes);
    },
    [backgrounds, folderBackgrounds, state.customBackgrounds, cardSetSizes],
  );

  /*
    6면 세트 — 같은 번호의 여섯 면을 한 묶음으로. 

    `availableBackgrounds` 자체에서는 빼지 않습니다 — 면에 걸린 id(=파일 경로)를
    `backgroundFaceImages` 가 그 배열에서 찾아 씬에 그리므로, 빼면 세트를 걸어도 빈 면이
    됩니다. 낱장 목록(환경 탭·전체보기)에만 `listedBackgrounds` 를 씁니다.
  */
  // 여기는 배경뿐이라 `6면/` 밖(옛 프로젝트 뿌리)의 이름 인식(legacy)도 켭니다.
  const faceSets = useMemo<FaceSet<PlannerBackground>[]>(
    () => collectFaceSets(availableBackgrounds, { legacy: true }),
    [availableBackgrounds],
  );
  const listedBackgrounds = useMemo(
    () =>
      availableBackgrounds.filter(
        (item) => !isFaceSetMember(item, { legacy: true }),
      ),
    [availableBackgrounds],
  );
  /*
    이름이 «…외벽» 으로 끝나는 세트는 **바깥 껍질**로 겁니다. 배경 카드의 «방 바깥쪽 · 외벽 전개도» 가 자동으로
    잘라 «<장소>_외벽» 세트를 만듭니다(). 안쪽·바깥쪽 단추를 먼저
    바꾸지 않고 걸면 외벽이 방 안에 붙어, 방 안에서 벽돌 외벽이 보였습니다. 이름이 곧 어느 껍질인지를 말합니다.
  */
  const shellOfSet = (set: FaceSet<PlannerBackground>): RoomFaceShell =>
    /외벽$/.test(set.prefix) ? "outer" : faceShell;
  /**
   * 세트 하나를 여섯 면에 한 번에. 빠진 면은 비웁니다 — 옛 그림이 남아 다른 세트와 섞이지 않게.
   *
   * **방이 없으면 하나 세우고** 겁니다. 세트를 고른 것 자체가 «이 배경으로 방을 세우겠다» 는 뜻인데, 방이 없던 시절에는
   * 걸 자리가 없어 알림만 뜨고 아무 일도 안 일어났습니다(2026-09-16, 방을 기본으로 안 세우게 바꾼 직후).
   */
  const assignFaceSet = (set: FaceSet<PlannerBackground>) =>
    setState((current) => {
      // 호리존은 그림을 안 붙이는 방입니다. 걸어 봐야 색이 이겨 안 보이고, 면 id 만 몰래 남습니다.
      if (roomsOf(current).length && activeRoomOf(current).horizon) {
        toast.info("호리존 방에는 그림을 걸 수 없습니다 — 실내·실외 방을 고르세요.");
        return current;
      }
      const made = roomsOf(current).length ? null : addRoomIn(current, "indoor");
      const base = made ? made.state : current;
      const roomId = made ? made.id : (base.activeRoomId ?? roomsOf(base)[0]?.id ?? null);
      const hung = applyFaceSetSizeIn(
        FACE_KEYS.reduce(
          (acc, face) =>
            setRoomFaceIn(acc, face, set.faces[face]?.image.id ?? "", shellOfSet(set)),
          base,
        ),
        set,
        shellOfSet(set),
      );
      /*
        **방 이름을 세트 이름에 맞춥니다.**
        세트 접두는 그 장소 이름(«레지스탕스의 방»)이라, 방이 «방 1» 로 남아 있으면 타임라인·목록에서 어느 방이
        어느 배경인지 이름만 보고는 알 수 없습니다. 바깥벽 세트는 «…외벽» 을 떼고 씁니다 — 안팎이 같은 방입니다.
      */
      const name = set.prefix.replace(/[_ ]*외벽$/, "").trim();
      return roomId && name ? renameRoomIn(hung, roomId, name) : hung;
    });
  /** 지금 여섯 면에 걸린 것이 이 세트 그대로인가. */
  const isFaceSetAssigned = (set: FaceSet<PlannerBackground>) =>
    FACE_KEYS.every(
      (face) =>
        (roomFacesOf(activeRoom, shellOfSet(set))[face] || "") ===
        (set.faces[face]?.image.id ?? ""),
    );

  /*
    면에 걸린 **id 를 그림 주소로** 바꾼 표 — 방마다 안쪽·바깥쪽 두 벌입니다.

    이 객체는 씬 이펙트의 의존성입니다. 매 렌더마다 새로 만들면 씬이 계속 재생성되므로
    («무한 루프» 함정, CLAUDE.md) 방 전체의 면 id 를 한 줄로 이어 만든 열쇠로만 다시 셉니다.
  */
  const roomFaceKey = rooms
    .map((room) =>
      [
        room.id,
        ...COMPOSITION_CUBE_FACES.map((face) => room.faces[face] || ""),
        ...COMPOSITION_CUBE_FACES.map((face) => room.outerFaces?.[face] || ""),
        room.panorama || "",
        // 배경 영상도 같은 열쇠에. 빠뜨리면 영상을 걸어도 씬이 다시 안 붙어 화면이 그대로입니다.
        room.video ? `${room.video.face}:${room.video.source}` : "",
      ].join("|"),
    )
    .join("//");
  const roomFaceImages = useMemo(() => {
    const resolve = (
      source: Partial<Record<CompositionCubeFace, string>>,
    ): Partial<Record<CompositionCubeFace, string>> =>
      COMPOSITION_CUBE_FACES.reduce<
        Partial<Record<CompositionCubeFace, string>>
      >((faces, face) => {
        const found = availableBackgrounds.find(
          (item) => item.id === source[face],
        );
        if (found?.thumb) faces[face] = found.thumb;
        return faces;
      }, {});
    return rooms.map((room) => ({
      id: room.id,
      inner: resolve(room.faces),
      // 바깥면을 안 붙였으면 **없음**입니다 — 빈 표를 주면 껍질을 괜히 세웁니다.
      outer: room.outerFaces ? resolve(room.outerFaces) : null,
      // 파노라마 돔 — 걸려 있으면 이 방은 상자 대신 돔으로 섭니다(`CompositionRoom.panorama`).
      panorama: room.panorama ? availableBackgrounds.find((item) => item.id === room.panorama)?.thumb || null : null,
      /*
        배경 영상 — 그림과 같은 길로 «id → 주소» 를 여기서 끝냅니다(씬은 목록을 모릅니다).
        고른 영상이 목록에서 사라졌으면(파일을 지웠다든지) 없음으로 두고, 그 면은 원래 그림으로 돌아갑니다.
      */
      video: room.video?.source
        ? (() => {
            const url = folderVideos.find((item) => item.id === room.video!.source)?.src;
            // 면은 지금 방 모양에 맞춘 것으로(`roomVideoFaceOf`) — 돔으로 바꾼 방에 옛 «정면» 이 남아 있을 수 있습니다.
            return url ? { face: roomVideoFaceOf(room), url } : null;
          })()
        : null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomFaceKey, availableBackgrounds, folderVideos]);

  /**
   * 방에 방금 만든 **영상**을 목록에 더합니다. 폴더는 창을 열 때만 읽으므로, 이게 없으면
   * 방금 만든 것을 걸려고 창을 닫았다 다시 열어야 합니다.
   */
  const rememberRoomVideo = (filePath: string, name: string) => {
    const src = assetSrc(filePath);
    if (!src) return;
    setFolderVideos((current) =>
      current.some((item) => item.id === filePath)
        ? current
        : [{ id: filePath, name, src }, ...current],
    );
  };

  /**
   * 그 면에 걸린 **그림 파일 경로** — «이 면 그림으로 영상 만들기» 가 첫 프레임으로 씁니다.
   *
   * 주소(`thumb`)가 아니라 경로인 까닭: 로컬 생성기는 파일을 읽습니다(`asset://` 은 못 엽니다).
   * 돔은 파노라마 한 장이 그 자리입니다.
   */
  const faceImagePathOf = (roomId: string, face: RoomVideoFace): string | undefined => {
    const room = rooms.find((item) => item.id === roomId);
    if (!room) return undefined;
    const id = face === "panorama" ? room.panorama : room.faces[face];
    if (!id) return undefined;
    const found = availableBackgrounds.find((item) => item.id === id);
    return found?.filePath || (id.includes("\\") || id.includes("/") ? id : undefined);
  };

  /** 활성 방의 안쪽 여섯 장 — 미리보기·전개도처럼 «지금 방» 만 보면 되는 자리에서 씁니다. */
  const backgroundFaceImages = useMemo(
    () =>
      roomFaceImages.find((room) => room.id === activeRoom.id)?.inner ??
      roomFaceImages[0]?.inner ??
      {},
    [roomFaceImages, activeRoom.id],
  );

  const addCustomBackground = async (file: File, kind: BackgroundKind) => {
    /*
      같은 파일을 두 번 넣으면 목록에도 폴더에도 그대로 쌓였습니다. (지시 54)

      이름과 갈래가 같으면 이미 들어와 있는 것으로 보고, 새로 넣는 대신
      그것을 골라 줍니다. 같은 이름의 다른 그림을 일부러 넣는 일은 배경에서는
      드물고, 정말 필요하면 파일 이름을 바꿔 넣으면 됩니다.
    */
    const wanted = file.name.replace(/\.[^.]+$/, "");
    // 갱신 함수 안에서 바깥 변수를 세팅하고 바로 읽으면 실행 시점을 믿을 수 없습니다.
    // 지금 값(state)에서 바로 찾습니다.
    const found = state.customBackgrounds.find(
      (item) => item.kind === kind && item.name === wanted,
    );
    if (found) {
      setState((current) => selectCustomBackgroundIn(current, kind, found.id));
      toast.info(`${found.name} 은 이미 있습니다. 그것을 골랐습니다.`);
      return;
    }

    const id = uid("background");
    const thumb = URL.createObjectURL(file);
    const entry = {
      id,
      name: file.name.replace(/\.[^.]+$/, ""),
      thumb,
      kind,
      sourceUrl: kind === "hdri" ? thumb : undefined,
      // 확장자를 떼지 않은 이름 — 로더를 고를 때 씁니다(.hdr 과 .exr 은 형식이 다릅니다).
      fileName: file.name,
    };

    setState((current) => addCustomBackgroundIn(current, entry));

    if (kind !== "hdri") {
      void measureAspect(thumb).then((measured) => {
        if (!measured) return;
        setState((current) =>
          patchCustomBackgroundIn(current, id, { aspect: measured }),
        );
        if (kind === "panorama" && !isPanoramaAspect(measured)) {
          toast.warning(
            `이 이미지는 ${measured.toFixed(2)}:1 비율입니다. 360° 파노라마는 보통 2:1 이라 이음매가 보일 수 있습니다.`,
          );
        }
      });
    }

    // 넣은 그림은 프로젝트 폴더에도 정리해 둡니다. blob URL 은 새로고침하면 죽습니다.
    if (projectName?.trim()) {
      const saved = await saveProjectMediaAsset(file, {
        projectName,
        assetType: "background-generated",
        ownerName: sceneTitle || "구도 배경",
        /*
          **파노라마는 파노라마 폴더에.**
          앱이 뽑은 파노라마는 이미 이 하위 폴더에 들어가는데(`PANORAMA_DIR`), 밖에서 들여온 것만
          구도 배경에 섞여 다음에 열 때 실외 목록에서 자리로 못 알아봤습니다(`isInPanoramaDir`).
        */
        subdir: kind === "panorama" ? PANORAMA_DIR : undefined,
      }).catch(() => null);
      // 저장된 경로를 항목에 적어 둡니다. blob 은 저장에서 빠지므로 이것이 없으면
      // 다시 열었을 때 여섯 면·파노라마·HDRI 가 전부 빈칸이 됩니다.
      if (saved) {
        setState((current) =>
          patchCustomBackgroundIn(current, id, { filePath: saved.path }),
        );
      }
    }
  };

  // ── GLB ───────────────────────────────────────────────────────────────
  const addGlbTrack = (file: File) => {
    const track = createGlbTrack(file.name, URL.createObjectURL(file));
    setState((current) => addGlbTrackIn(current, track));
    setPreviewing(true);
    toast.success(`GLB 를 불러왔습니다 · ${file.name}`);
    return track.id;
  };

  const updateGlb = (id: string, patch: Partial<GlbTrack>) =>
    setState((current) => updateGlbIn(current, id, patch));

  /** 화면에 떨어뜨린 파일. 확장자로 종류를 가립니다. */
  const handleDroppedFile = async (file: File) => {
    const isHdr = /\.(hdr|exr)$/i.test(file.name);
    const isGlb = /\.(glb|gltf)$/i.test(file.name);

    if (isGlb) {
      const trackId = addGlbTrack(file);
      if (projectName?.trim()) {
        const saved = await saveProjectMediaAsset(file, {
          projectName,
          assetType: "composition-glb",
          ownerName: file.name.replace(/\.[^.]+$/, ""),
        }).catch(() => null);
        if (saved) {
          // 저장 경로를 트랙에 적습니다. 없으면 다시 열 때 애니메이션이 전부 사라집니다.
          updateGlb(trackId, { filePath: saved.path });
          toast.success("프로젝트 폴더에 정리했습니다 · Animation");
        }
      }
      return;
    }

    if (!isHdr && !file.type.startsWith("image/")) {
      toast.error("이미지, .hdr / .exr, .glb / .gltf 파일만 넣을 수 있습니다.");
      return;
    }

    // 2:1 근처면 파노라마로 봅니다. 아니면 큐브 면 배경으로.
    const thumb = URL.createObjectURL(file);
    const measured = isHdr ? null : await measureAspect(thumb);
    URL.revokeObjectURL(thumb);
    await addCustomBackground(
      file,
      isHdr
        ? "hdri"
        : isPanoramaAspect(measured ?? 0)
          ? "panorama"
          : "background",
    );
  };

  /*
    ── 파노라마 돔 걸기 ────────────────────────────────────────────────
    돔 반지름이 곧 «공터 경계까지의 거리» 라, 그 파노라마를 뽑은 크기(한 변 S m)로 방 가로·깊이를 맞춥니다. 크기는 세트와 같은
    길로 찾습니다 — 파일 이름의 접두(«장소»·«장소_변형») → 그 카드의 프롬프트에 적힌 크기(`cardSetSizes`). 못 찾으면 방이 20 m 보다
    작을 때만 50 m 로 넓힙니다(문서 16 의 기본 실외 크기) — 실내 크기 방에 파노라마를 걸면 둘레가 코앞에 붙습니다.
  */
  const assignPanorama = (background: PlannerBackground) => {
    const stem = background.filePath ? fileStem(background.filePath).replace(/_\d{3,}$/, "") : "";
    const size = stem ? cardSetSizes.get(safeFileName(stem)) : undefined;
    setState((state0) => {
      // 호리존에는 돔도 없습니다 — `assignFaceSet` 과 같은 까닭.
      if (roomsOf(state0).length && activeRoomOf(state0).horizon) {
        toast.info("호리존 방에는 파노라마를 걸 수 없습니다 — 실외 방을 고르세요.");
        return state0;
      }
      // 파노라마도 걸 방이 있어야 합니다 — 없으면 **실외 방**을 세웁니다(돔은 실외의 것).
      const current = roomsOf(state0).length ? state0 : addRoomIn(state0, "outdoor").state;
      const room = activeRoomOf(current);
      const side = size?.width ?? (Math.max(room.width, room.depth) < 20 ? 50 : null);
      return setRoomPanoramaIn(current, background.id, side);
    });
  };

  return {
    availableBackgrounds,
    listedBackgrounds,
    faceSets,
    assignFaceSet,
    assignPanorama,
    isFaceSetAssigned,
    backgroundFaceImages,
    roomFaceImages,
    // 방의 «배경 영상» 한 벌 — 고를 목록 · 만든 것 기억하기 · 첫 프레임으로 쓸 면 그림.
    roomVideos: folderVideos,
    rememberRoomVideo,
    faceImagePathOf,
    addCustomBackground,
    updateGlb,
    handleDroppedFile,
  };
}

export type PlannerMedia = ReturnType<typeof usePlannerMedia>;
