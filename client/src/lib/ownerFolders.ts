import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import {
  fileStem,
  ownerTopFolder,
  renameOwnerFolder,
  renameStemFiles,
  safeFileName,
} from "@/lib/mediaLibrary";
import type { ProjectAssetType, RenameFailure } from "@/lib/mediaLibrary";
import type { ProjectDraft } from "@/lib/projectTypes";
import { SIX_FACES_DIR, parseFaceStem } from "@/lib/faceSets";
import { sceneFolderName } from "@/lib/projectNames";

/**
 * 화면 이름과 폴더 이름을 맞춥니다.
 *
 * # 왜 필요한가
 *
 * 이름을 안 정한 채로 그림을 올리는 것이 흔합니다. 그러면 갈래 이름
 * (「인물」)으로 폴더가 생기고 파일도 `인물_001.png` 가 됩니다. 나중에
 * 「여울」 이라고 적어도 폴더에는 「인물」 이 그대로 남았습니다.
 * 폴더가 원본이라, 그 상태로 폴더를 다시 읽으면 여울의 레퍼런스를 못 찾습니다.
 *
 * # 지금 폴더 이름을 어떻게 아는가
 *
 * 따로 적어 두지 않습니다. **저장된 파일의 부모 폴더가 곧 지금 이름**입니다.
 * 별도 필드를 두면 그것과 실제 폴더가 어긋나는 날이 오고, 그때는 어느 쪽이
 * 맞는지 알 방법이 없습니다. 파일 경로는 거짓말을 안 합니다.
 *
 * # 언제 부르는가
 *
 * 저장할 때입니다. 글자를 한 자 칠 때마다 옮기면 「여」 「여울」 폴더가
 * 줄줄이 생깁니다. 저장은 «다 적었다» 는 뜻이에요. 그래도 저장은 손을 멈추면
 * 자동으로 나가므로, 이름 칸을 아직 적는 중이면(`isTyping`) 한 번 미룹니다.
 *
 * # 먼저 묻습니다
 *
 * 폴더와 파일 이름이 통째로 바뀌는 일이고, 파일 이름이 곧 마그니픽 @태그입니다.
 * 이름을 바꾸면 마그니픽에 적어 둔 `@냥이_001` 이 더는 파일을 못 찾습니다.
 * 그래서 진짜 이름에서 다른 이름으로 갈 때는 한 번 묻고, 취소하면 이름을 되돌립니다.
 */

type OwnerKind = "character" | "background" | "asset" | "scene";

/**
 * 경로에서 **인물 폴더 이름**을 뽑습니다.
 *
 * …/character/여울/여울_001.png → 여울
 * …/character/여울/ref/ref_여울_1.png → 여울
 *
 * 레퍼런스는 한 층 더 들어가 있어서, 바로 위 폴더만 보면 「ref」 가 나옵니다.
 * 그래서 `ref` 는 건너뜁니다. 파노라마에서 자른 여섯 면이 있는 `6면/` 도 같은 자리라 같이
 * 건너뜁니다 — 안 그러면 6면 파일의 주인이 «6면» 으로 읽혀 저장할 때마다 이름 바꾸기를 묻습니다.
 *
 * `top` 은 인물 폴더의 **바로 위 폴더 이름**입니다(character · background · 공용에셋).
 * 그것과 다르면 이 갈래의 폴더가 아니라고 보고 빈 문자열을 돌려줍니다 — 옛 구조에
 * 남은 `character/공용에셋/가방/…` 을 인물 폴더로 잘못 읽어 «가방 → 냥이» 로 바꾸겠냐고
 * 저장할 때마다 묻는 일이 없어야 합니다.
 */
function ownerOf(filePath: string | undefined, top: string): string {
  if (!filePath) return "";
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  let index = parts.length - 2;
  if (parts[index] === "ref" || parts[index] === "voice" || parts[index] === SIX_FACES_DIR) index -= 1;
  if (index < 1) return "";
  return parts[index - 1] === top ? parts[index] || "" : "";
}

interface Owner {
  kind: OwnerKind;
  id: string;
  name: string;
  /** 이름을 아직 안 정했을 때 쓰는 갈래 이름 */
  fallback: string;
  /** 확인 문구에 쓰는 말 — 인물·장소·에셋 */
  label: string;
  assetType: ProjectAssetType;
  images: { filePath?: string }[];
}

type ImageBag = {
  voiceReferences?: { filePath?: string }[];
  references?: { filePath?: string }[];
  generatedImages?: { filePath?: string }[];
  variations?: ImageBag[];
  assets?: ImageBag[];
  alternates?: ImageBag[];
};

/**
 * 인물·장소·에셋 하나가 **자기 폴더 안에** 들고 있는 그림 전부.
 *
 * 변형과 보유 에셋(`assets`), 다른 원본(`alternates`)까지 들어갑니다. 전부 인물 폴더 안에
 * 저장되므로(규칙 5) 여기서 빠뜨리면 폴더는 옮겨졌는데 그 경로만 옛 자리를 가리켜 썸네일이 깨집니다.
 */
function imagesOf(entity: ImageBag): { filePath?: string }[] {
  return [
    ...(entity.voiceReferences || []),
    ...(entity.references || []),
    ...(entity.generatedImages || []),
    ...(entity.variations || []).flatMap(imagesOf),
    ...(entity.assets || []).flatMap(imagesOf),
    ...(entity.alternates || []).flatMap(imagesOf),
  ];
}

/** 초안 안의 «폴더를 가진 것» 을 모두 모읍니다 — 인물·장소·공용 에셋. */
function ownersOf(draft: ProjectDraft): Owner[] {
  const owners: Owner[] = [];
  for (const character of draft.characters || []) {
    owners.push({
      kind: "character",
      id: character.id,
      name: character.name,
      fallback: "인물",
      label: "인물",
      assetType: "character-reference",
      images: imagesOf(character),
    });
  }
  for (const background of draft.backgrounds || []) {
    owners.push({
      kind: "background",
      id: background.id,
      name: background.name,
      fallback: "장소",
      label: "장소",
      assetType: "background-reference",
      images: imagesOf(background),
    });
  }
  for (const asset of draft.sharedAssets || []) {
    owners.push({
      kind: "asset",
      id: asset.id,
      name: asset.name,
      fallback: "에셋",
      label: "에셋",
      assetType: "asset-reference",
      images: imagesOf(asset),
    });
  }
  /*
    ── 장면도 폴더를 가집니다 ──────────────────────────────────────────
    

    장면은 여태 이 목록에 **없었습니다.** 그래서 제목을 「레지스탕스 회합」 으로 바꿔도
    `storyboard/장면 2/` 폴더는 그대로였고, 다음에 구운 시트만 새 폴더로 가 한 장면의
    파일이 두 곳에 갈렸습니다.

    이름은 `sceneFolderName` 이 정합니다 — 제목이 비면 「장면 N」. 그 규칙이 파일을 놓는
    쪽과 같아야 «폴더 이름이 이미 맞다» 를 옳게 판단합니다.
  */
  (draft.scenes || []).forEach((scene, index) => {
    const cuts = scene.cuts || [];
    owners.push({
      kind: "scene",
      id: scene.id,
      name: sceneFolderName(scene.title, index),
      fallback: `장면 ${index + 1}`,
      label: "장면",
      // 컷 그림·시트·영상이 모두 `storyboard/<장면>/` 한 폴더에 있어 하나로 옮겨집니다.
      assetType: "scene-cut",
      images: [
        ...(scene.storyboardPath ? [{ filePath: scene.storyboardPath }] : []),
        ...(scene.videos || []).map((video) => ({ filePath: video.filePath })),
        ...cuts.flatMap((cut) => [
          { filePath: cut.guideImagePath },
          { filePath: cut.plateImagePath },
          ...(cut.images || []).map((image) => ({ filePath: image.filePath })),
          ...(cut.videos || []).map((video) => ({ filePath: video.filePath })),
        ]),
      ].filter((item) => item.filePath),
    });
  });
  return owners;
}

/**
 * 사람이 정한 이름이 아니라 앱이 임시로 붙인 폴더 이름들.
 *
 * 여기서 진짜 이름으로 가는 것은 묻지 않습니다. 「인물」 폴더는 이름을 정하기 전에
 * 그림부터 올린 흔적이지 누가 고른 이름이 아니라서요. 되돌릴 때도 이 값이 아니라
 * 빈 이름으로 되돌립니다.
 */
// «원본» 은 이름 없는 다른 원본의 접두(`냥이_원본`, `assetStem.ALTERNATE_PLACEHOLDER`)와 같은 낱말입니다.
const PLACEHOLDERS = new Set(["인물", "장소", "에셋", "원본", "캐릭터", "배경", "이름없음", "이름 없음", "공용 에셋", "공용에셋"]);

// ── 못 바꾼 파일을 다음 저장 때 다시 시도하기 ─────────────────────────────
//
// 폴더는 옮겨졌는데 파일 몇 개가 막혀(마그니픽·탐색기 미리보기가 잡고 있음) 옛 앞부분
// `냥이_…` 으로 남는 일이 있습니다. 폴더 이름만 보면 이미 맞아서 다시는 손대지
// 않으므로, «어느 앞부분을 못 바꿨는지» 를 따로 적어 두고 저장할 때마다 다시 시도합니다.

const PENDING_KEY = "ai-video-storage.pending-renames.v1";

interface PendingRename {
  project: string;
  assetType: ProjectAssetType;
  /** 지금 폴더(= 새) 이름 */
  ownerName: string;
  /** 파일에 남아 있는 옛 앞부분 */
  oldName: string;
}

function readPending(): PendingRename[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as PendingRename[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingRename[]) {
  try {
    if (list.length) window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* 저장소가 막혀 있으면 이번 세션 안에서만 기억합니다. */
  }
}

const samePending = (a: PendingRename, b: PendingRename) =>
  a.project === b.project && a.assetType === b.assetType && a.ownerName === b.ownerName && a.oldName === b.oldName;

/** 확인 문구에 보여 줄 파일 이름 몇 개. 「냥이_001, ref_냥이_001, 냥이_얼굴 정면_001」 */
function sampleStems(images: { filePath?: string }[], folder: string, top: string): string[] {
  const stems = images
    .filter((image) => ownerOf(image.filePath, top) === folder)
    .map((image) => fileStem(image.filePath || ""))
    .filter(Boolean);
  const unique = [...new Set(stems)];
  return unique.length ? unique.slice(0, 3) : [`${folder}_001`];
}

/** 취소했거나 거절한 이름 바꾸기. 초안의 이름을 이 값으로 되돌려야 폴더와 다시 맞습니다. */
export interface OwnerNameRevert {
  kind: OwnerKind;
  id: string;
  name: string;
}

export interface SyncOwnerFoldersResult {
  /** «옛 자리 → 새 자리». 초안의 filePath 를 이걸로 갈아 끼워야 썸네일이 안 깨집니다. */
  moved: Map<string, string>;
  /** 막혀서 못 바꾼 파일. 다음 저장 때 다시 시도합니다. */
  failed: RenameFailure[];
  reverts: OwnerNameRevert[];
  /** 이름 칸을 아직 적는 중이라 미뤘는가. 포커스가 빠져나간 뒤 다시 부르면 됩니다. */
  postponed: boolean;
}

/**
 * 어긋난 폴더를 옮기고, 옮긴 «옛 자리 → 새 자리» 를 돌려줍니다.
 *
 * `isTyping(name)` 이 참이면(그 이름을 적는 칸에 커서가 있음) 그 인물은 이번에
 * 건너뜁니다. 저장은 손을 멈추면 자동으로 나가서, 「서」 에서 잠깐 멈추면
 * 「냥이 → 서」 를 묻는 창이 뜨고, 취소하면 적던 글자까지 되돌아갑니다.
 */
export async function syncOwnerFolders(
  draft: ProjectDraft,
  projectName: string,
  options: { isTyping?: (name: string) => boolean } = {},
): Promise<SyncOwnerFoldersResult> {
  const result: SyncOwnerFoldersResult = { moved: new Map(), failed: [], reverts: [], postponed: false };
  if (!projectName.trim()) return result;

  const owners = ownersOf(draft);
  let pending = readPending();
  const pendingBefore = pending.slice();
  let pendingChanged = false;
  const desiredOf = (owner: Owner) => (owner.name || owner.fallback).trim();

  for (const owner of owners) {
    const desired = desiredOf(owner);
    if (!desired) continue;
    const desiredFolder = safeFileName(desired);
    const top = ownerTopFolder(owner.assetType).split("/").pop() || "";
    /*
      지금 폴더 이름을 모읍니다.

      새 구조에서는 레퍼런스도 인물 폴더 아래에 있어서, 갈래를 나눌 필요가
      없습니다. 인물 폴더 하나만 옮기면 그 아래가 전부 따라옵니다.
    */
    const actualNames = new Set(owner.images.map((image) => ownerOf(image.filePath, top)).filter(Boolean));
    for (const actual of actualNames) {
      if (actual === desiredFolder) continue;
      if (options.isTyping?.(owner.name)) {
        result.postponed = true;
        continue;
      }

      /*
        같은 갈래에 같은 이름이 이미 있으면 거절합니다.

        폴더가 하나로 합쳐지면 «화면에서 지우면 폴더도 지운다»(규칙 3)가 한쪽을
        지울 때 다른 쪽 파일까지 지워 버립니다. 이름을 폴더 이름으로 되돌립니다.
      */
      const taken = owners.some(
        (other) =>
          other.kind === owner.kind && other.id !== owner.id && safeFileName(desiredOf(other)) === desiredFolder,
      );
      if (taken) {
        toast.error(
          `「${desired}」 은 이미 다른 ${owner.label}의 이름입니다. 폴더가 합쳐지면 하나를 지울 때 다른 쪽 파일까지 지워져서, 이름을 되돌립니다.`,
        );
        result.reverts.push({ kind: owner.kind, id: owner.id, name: PLACEHOLDERS.has(actual) ? "" : actual });
        continue;
      }

      // 자리표시 폴더(「인물」)에서 진짜 이름으로 가는 것은 묻지 않습니다. 사람이 고른 이름이 아닙니다.
      if (!PLACEHOLDERS.has(actual)) {
        const samples = sampleStems(owner.images, actual, top);
        const ok = await confirmDialog({
          title: `「${actual}」 를 「${desired}」 로 바꿀까요?`,
          description:
            `폴더와 파일 이름(${samples.join(", ")} …)이 ${desiredFolder}_… 로 바뀌고, ` +
            "마그니픽 @태그도 새 이름을 따릅니다. 마그니픽에 적어 둔 옛 태그는 더는 파일을 찾지 못합니다.",
          confirmLabel: "바꾸기",
        });
        if (!ok) {
          result.reverts.push({ kind: owner.kind, id: owner.id, name: actual });
          continue;
        }
      }

      const outcome = await renameOwnerFolder({
        projectName,
        assetType: owner.assetType,
        oldName: actual,
        newName: desired,
      });
      outcome.moved.forEach((to, from) => result.moved.set(from, to));
      if (outcome.failed.length) {
        result.failed.push(...outcome.failed);
        const entry: PendingRename = { project: projectName, assetType: owner.assetType, ownerName: desired, oldName: actual };
        if (!pending.some((item) => samePending(item, entry))) {
          pending.push(entry);
          pendingChanged = true;
        }
      }
    }

    // 지난번에 막혀서 옛 앞부분으로 남은 파일을 다시 시도합니다. 방금 실패한 것은
    // 아직 잡혀 있을 가능성이 높아 다음 저장으로 미룹니다.
    const retries = pendingBefore.filter(
      (item) => item.project === projectName && item.assetType === owner.assetType && item.ownerName === desired,
    );
    for (const item of retries) {
      const outcome = await renameStemFiles({
        projectName,
        assetType: owner.assetType,
        ownerName: desired,
        oldStem: item.oldName,
        newStem: desired,
      });
      outcome.moved.forEach((to, from) => result.moved.set(from, to));
      if (outcome.failed.length) {
        result.failed.push(...outcome.failed);
      } else {
        pending = pending.filter((entry) => !samePending(entry, item));
        pendingChanged = true;
      }
    }
  }

  // 이제 없는 인물의 기록은 치웁니다. 남겨 두면 저장할 때마다 없는 폴더를 뒤집니다.
  const alive = new Set(owners.map((owner) => `${owner.assetType}:${desiredOf(owner)}`));
  const pruned = pending.filter((item) => item.project !== projectName || alive.has(`${item.assetType}:${item.ownerName}`));
  if (pruned.length !== pending.length) {
    pending = pruned;
    pendingChanged = true;
  }
  if (pendingChanged) writePending(pending);
  return result;
}

/** 옮긴 자리를 초안에 반영합니다. 바뀐 게 없으면 **같은 객체**를 돌려줍니다. */
export function applyMovedPaths(draft: ProjectDraft, moved: Map<string, string>): ProjectDraft {
  if (!moved.size) return draft;

  type Image = { filePath?: string; name?: string; faceSet?: string };
  type Bag = {
    voiceReferences?: Image[];
    references?: Image[];
    generatedImages?: Image[];
    variations?: Bag[];
    assets?: Bag[];
    alternates?: Bag[];
  };

  const follow = (image: Image) => {
    const to = image.filePath ? moved.get(image.filePath) : undefined;
    if (!to) return image;
    const next: Image = { ...image, filePath: to, name: fileStem(to) };
    // 6면의 `faceSet`(«<접두>_<NNN>») 은 저장 때 굳힌 값이라 이름을 따라 옮기지 않으면 옛 접두로
    // 남습니다. `faceSetIdOf` 가 이 값을 이름 파싱보다 먼저 쓰므로, 그대로 두면 세트 카드가
    // «6면 세트 #1 · 옛이름» 으로 보이고 새로 자른 세트와 접두가 갈립니다. 새 이름으로 다시
    // 계산하고, 파싱이 안 되면 비워 이름 파싱으로 넘깁니다(`face` 는 이름 바꾸기로 안 바뀝니다).
    if (image.faceSet !== undefined) {
      const parsed = parseFaceStem(fileStem(to));
      if (parsed) next.faceSet = parsed.setId;
      else delete next.faceSet;
    }
    return next;
  };
  // 갈래마다 타입이 달라서 얕게 훑습니다. 여기서 만지는 것은 filePath 와
  // name(그리고 6면의 faceSet)뿐이라, 나머지 필드는 펼치기로 그대로 넘어갑니다. 보유 에셋(assets)과
  // 다른 원본(alternates)도 인물 폴더 안에 있어 같이 따라가야 합니다.
  const walk = <E,>(entity: E): E => {
    const bag = entity as Bag;
    return {
      ...entity,
      ...(bag.voiceReferences ? { voiceReferences: bag.voiceReferences.map(follow) } : {}),
      references: (bag.references || []).map(follow),
      generatedImages: (bag.generatedImages || []).map(follow),
      ...(bag.variations ? { variations: bag.variations.map((item) => walk(item)) } : {}),
      ...(bag.assets ? { assets: bag.assets.map((item) => walk(item)) } : {}),
      ...(bag.alternates ? { alternates: bag.alternates.map((item) => walk(item)) } : {}),
    };
  };

  /*
    표시(앵커·마킹)는 **파일 경로가 열쇠**입니다. 경로가 바뀌면 열쇠도 옮겨야지,
    안 그러면 이름을 바꾼 뒤 그 그림의 표시가 전부 사라진 것처럼 보입니다.
  */
  const marks = draft.imageMarks
    ? Object.fromEntries(Object.entries(draft.imageMarks).map(([key, value]) => [moved.get(key) ?? key, value]))
    : draft.imageMarks;

  /*
    구도잡기는 배경 시트를 **파일 경로를 id 로** 기억합니다(파노라마·큐브 면,
    usePlannerMedia 의 `image.filePath || image.id`). 경로가 바뀌면 그 컷의 배경
    선택이 조용히 빠지니 같이 옮깁니다. 바뀐 게 없으면 같은 객체를 돌려줍니다.
  */
  const followId = (id: string | undefined) => (id ? (moved.get(id) ?? id) : id);
  let scenesChanged = false;
  const scenes = (draft.scenes || []).map((scene) => {
    let sceneChanged = false;
    const cuts = (scene.cuts || []).map((cut) => {
      const composition = cut.composition;
      if (!composition) return cut;
      let facesChanged = false;
      const follow = <T extends Record<string, string | undefined>>(
        source: T | undefined,
      ) =>
        source
          ? (Object.fromEntries(
              Object.entries(source).map(([face, id]) => {
                const next = followId(id);
                if (next !== id) facesChanged = true;
                return [face, next];
              }),
            ) as T)
          : source;
      /*
        방이 여럿이면 **전부** 훑습니다. 하나만 고치면 옆방의 배경만 조용히 빠져,
        「거실은 그대로인데 주방만 까맣게 됐다」 가 됩니다 — 폴더를 옮긴 뒤라
        원인을 짚기가 아주 어렵습니다.
      */
      const rooms = (composition.rooms || []).map((room) => ({
        ...room,
        faces: follow(room.faces) ?? room.faces,
        outerFaces: follow(room.outerFaces),
      }));
      // 옛 저장본(방 배열 이전)은 아직 여기 들고 있습니다 — 정규화 전이라 같이 옮깁니다.
      const legacyFaces = follow(composition.backgroundFaces);
      if (!facesChanged) return cut;
      sceneChanged = true;
      return {
        ...cut,
        composition: {
          ...composition,
          rooms,
          backgroundFaces: legacyFaces ?? composition.backgroundFaces,
        },
      };
    });
    /*
      장면 폴더를 옮겼으면 **그 안의 파일 경로도** 따라가야 합니다.
      안 따라가면 시트·구도·영상이 전부 옛 자리를 가리켜 화면이 까맣게 됩니다
      ().
    */
    const movedCuts = cuts.map((cut) => {
      const guide = followId(cut.guideImagePath);
      const plate = followId(cut.plateImagePath);
      const images = (cut.images || []).map((image) =>
        followId(image.filePath) === image.filePath
          ? image
          : { ...image, filePath: followId(image.filePath) },
      );
      const videos = (cut.videos || []).map((video) =>
        followId(video.filePath) === video.filePath
          ? video
          : { ...video, filePath: followId(video.filePath) },
      );
      const same =
        guide === cut.guideImagePath &&
        plate === cut.plateImagePath &&
        images.every((image, index) => image === (cut.images || [])[index]) &&
        videos.every((video, index) => video === (cut.videos || [])[index]);
      if (same) return cut;
      sceneChanged = true;
      return { ...cut, guideImagePath: guide, plateImagePath: plate, images, videos };
    });

    const storyboardPath = followId(scene.storyboardPath);
    const sceneVideos = (scene.videos || []).map((video) =>
      followId(video.filePath) === video.filePath
        ? video
        : { ...video, filePath: followId(video.filePath) },
    );
    const sceneMoved =
      storyboardPath !== scene.storyboardPath ||
      sceneVideos.some((video, index) => video !== (scene.videos || [])[index]);
    if (!sceneChanged && !sceneMoved) return scene;
    scenesChanged = true;
    return {
      ...scene,
      cuts: movedCuts,
      ...(storyboardPath !== scene.storyboardPath ? { storyboardPath } : {}),
      ...(sceneMoved ? { videos: sceneVideos } : {}),
    };
  });

  return {
    ...draft,
    characters: (draft.characters || []).map(walk),
    backgrounds: (draft.backgrounds || []).map(walk),
    sharedAssets: (draft.sharedAssets || []).map(walk),
    ...(marks ? { imageMarks: marks } : {}),
    ...(scenesChanged ? { scenes } : {}),
  };
}

/**
 * 취소·거절한 이름 바꾸기를 초안에 되돌립니다. 되돌릴 것이 없으면 **같은 객체**를 돌려줍니다.
 *
 * 폴더 이름이 곧 지금 이름이라, 화면 이름을 폴더 이름으로 맞춥니다. 안 맞추면
 * 다음 저장 때 또 묻습니다.
 */
export function revertOwnerNames(draft: ProjectDraft, reverts: OwnerNameRevert[]): ProjectDraft {
  if (!reverts.length) return draft;
  const names = (kind: OwnerKind) => new Map(reverts.filter((item) => item.kind === kind).map((item) => [item.id, item.name]));
  const fix = <E extends { id: string; name: string }>(list: E[] | undefined, map: Map<string, string>): E[] =>
    (list || []).map((entity) => (map.has(entity.id) ? { ...entity, name: map.get(entity.id) ?? entity.name } : entity));
  /*
    장면은 `name` 이 아니라 `title` 입니다. 되돌릴 때도 그 칸으로 돌아가야
    사람이 적은 제목이 제자리로 갑니다.
  */
  const sceneNames = names("scene");
  return {
    ...draft,
    characters: fix(draft.characters, names("character")),
    backgrounds: fix(draft.backgrounds, names("background")),
    sharedAssets: fix(draft.sharedAssets, names("asset")),
    scenes: (draft.scenes || []).map((scene) =>
      sceneNames.has(scene.id)
        ? { ...scene, title: sceneNames.get(scene.id) ?? scene.title }
        : scene,
    ),
  };
}
