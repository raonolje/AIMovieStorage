import { importProjectMediaAsset, safeFileName } from "@/lib/mediaLibrary";
import { listLocalProjects, getLocalProject, projectFolderName } from "@/lib/localProjectStore";
import { newBackground, newCharacter, uid } from "@/lib/projectTypes";
import type { RoomPreset } from "@/lib/roomPreset";
import type {
  Background,
  Character,
  GeneratedImageAsset,
  ProjectDraft,
} from "@/lib/projectTypes";

/**
 * **다른 작품에서 카드를 끌어옵니다.**
 *
 * # 구조를 바꾸지 않습니다
 *
 * «공유 보관함» 같은 것을 새로 만들지 않았습니다. 그러면 저장 구조가 통째로 바뀌고,
 * 한 카드를 두 작품이 가리키게 되어 **규칙 3**(화면에서 지우면 원본 파일도 지움)이
 * 무너집니다 — 2편에서 지웠는데 1편의 그림이 사라집니다.
 *
 * 그래서 **복사**합니다. 카드도 그림 파일도 이 작품 폴더 안으로 새로 들어옵니다.
 * 가져온 뒤에는 원래 작품과 아무 관계가 없습니다. 고쳐도 변형해도 저쪽은 그대로입니다.
 *
 * # 갈래를 섞지 않습니다
 *
 * 인물 목록에서 장소가 보이면 안 됩니다 — 고르는 자리가 흐려집니다.
 *
 * # 그림은 골라서 가져옵니다
 *
 * 카드 하나에 그림이 수십 장일 수 있습니다. 전부
 * 복사하면 폴더가 금세 불어납니다 — **고른 것만** 옮깁니다.
 */

/** 끌어올 수 있는 갈래. 섞이지 않게 부르는 쪽이 하나를 정해 넘깁니다. */
export type BorrowKind = "character" | "background" | "room";

/** 고르는 화면에 뿌릴 한 줄. 카드 알맹이는 `card` 에 그대로 들고 있습니다. */
export interface BorrowCandidate {
  projectId: string;
  projectTitle: string;
  card: Character | Background;
  /** 이 카드에 붙은 그림들. 사람이 여기서 몇 장만 고릅니다. */
  images: GeneratedImageAsset[];
  /**
   * 이 카드의 **변형들**.
   *
   * 변형도 카드처럼 그림을 여럿 들고 있으므로 **변형마다 그림을 따로** 고릅니다.
   */
  variations: { id: string; name: string; images: GeneratedImageAsset[] }[];
}

/**
 * 다른 작품들에서 이 갈래의 카드를 모읍니다. **지금 작품은 뺍니다.**
 *
 * 그림이 한 장도 없는 카드도 내놓습니다 — 설정만 적어 둔 카드를 가져와 이쪽에서
 * 뽑는 것도 쓸모가 있습니다.
 */
export function borrowCandidates(kind: BorrowKind, exceptFolder: string): BorrowCandidate[] {
  const out: BorrowCandidate[] = [];
  for (const summary of listLocalProjects()) {
    // **폴더 이름**으로 가립니다. 화면 어디서나 닿는 값이 그것뿐이라, id 를 여러 겹
    // 아래까지 내려보내지 않으려는 것입니다.
    if (projectFolderName(summary.id, summary.title) === exceptFolder) continue;
    const project = getLocalProject(summary.id);
    if (!project) continue;
    // 저장본은 «무엇이든 들어 있는 덩어리» 로 들고 있습니다 — 읽을 때 갈래만 갈라 봅니다.
    const draft = project.draft as Partial<ProjectDraft>;
    const cards = (kind === "character" ? draft.characters : draft.backgrounds) ?? [];
    for (const card of cards) {
      out.push({
        projectId: summary.id,
        projectTitle: summary.title || "이름 없는 작품",
        card,
        images: (card.generatedImages ?? []).filter(
          (image: GeneratedImageAsset) => image.filePath,
        ),
        variations: (card.variations ?? []).map((variation) => ({
          id: variation.id,
          name: variation.name,
          images: (variation.generatedImages ?? []).filter(
            (image: GeneratedImageAsset) => image.filePath,
          ),
        })),
      });
    }
  }
  return out;
}

/** 같은 이름이 이미 있으면 «여울 (2)» 처럼 뒤에 번호를 붙입니다. */
function freeName(name: string, taken: string[]): string {
  const base = name.trim() || "이름 없음";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base} ${uid().slice(0, 4)}`;
}

export interface BorrowRequest {
  kind: BorrowKind;
  /**
   * 가져올 카드와, 그 카드에서 가져올 그림 id 들.
   *
   * `variationImageIds` 는 **변형 id → 그 변형에서 가져올 그림 id 들**. 변형을 켜고
   * 그림을 하나도 안 고르면 설정만 옵니다(이쪽에서 다시 뽑으면 됩니다).
   */
  picks: {
    candidate: BorrowCandidate;
    imageIds: string[];
    variationImageIds?: Record<string, string[]>;
  }[];
  /** 지금 작품. «이미 있는 이름» 을 여기서 봅니다. */
  draft: ProjectDraft;
  /** 지금 작품의 폴더 이름. 그림을 여기로 복사합니다. */
  projectName: string;
}

export interface BorrowResult {
  characters: Character[];
  backgrounds: Background[];
  /** 옮긴 그림 수와 못 옮긴 수. 조용히 빠뜨리지 않으려고 셉니다. */
  copied: number;
  failed: number;
}

/**
 * 고른 카드들을 **이 작품 폴더로 복사해** 새 카드로 만듭니다.
 *
 * 파일 복사는 `importProjectMediaAsset` 이 합니다 — 폴더·이름·번호 규칙을 저장 쪽
 * 한 군데가 계속 쥐고 있게 하려는 것입니다(규칙 5: 폴더는 인물당 하나).
 *
 * **못 옮긴 그림이 있어도 카드는 만듭니다.** 그림 한 장 때문에 통째로 실패하면
 * 사람이 할 수 있는 일이 없습니다 — 몇 장이 빠졌는지 알려 주고 나머지를 살립니다.
 */
export async function borrowCards(request: BorrowRequest): Promise<BorrowResult> {
  const { projectName } = request;
  const taken = (
    request.kind === "character" ? request.draft.characters : request.draft.backgrounds
  ).map((item) => item.name);

  const characters: Character[] = [];
  const backgrounds: Background[] = [];
  let copied = 0;
  let failed = 0;

  for (const pick of request.picks) {
    const source = pick.candidate.card;
    const name = freeName(source.name, [...taken, ...characters.map((c) => c.name), ...backgrounds.map((b) => b.name)]);

    /*
      **새 id 를 답니다.** 원래 id 를 그대로 쓰면 두 작품의 카드가 같은 id 를 갖게 되어,
      컷이 가리키는 인물이 어느 작품 것인지 알 수 없어집니다.
    */
    const base = request.kind === "character" ? newCharacter() : newBackground();

    const images: GeneratedImageAsset[] = [];
    for (const image of pick.candidate.images) {
      if (!pick.imageIds.includes(image.id)) continue;
      if (!image.filePath) continue;
      try {
        const saved = await importProjectMediaAsset(image.filePath, {
          projectName,
          // 끌어온 그림은 «생성본» 자리에 넣습니다 — 레퍼런스가 아니라 이미 뽑아 둔 결과입니다.
          assetType:
            request.kind === "character" ? "character-generated" : "background-generated",
          ownerName: name,
          stem: safeFileName(name),
        });
        if (!saved?.path) {
          failed += 1;
          continue;
        }
        images.push({
          ...image,
          // 그림에도 새 id 를 답니다 — 같은 id 가 두 작품에 있으면 «대표» 가 헷갈립니다.
          id: uid(),
          filePath: saved.path,
          name: saved.name,
        });
        copied += 1;
      } catch {
        failed += 1;
      }
    }
    // 대표는 **가져온 것 중에서** 다시 고릅니다. 원래 대표를 안 가져왔을 수 있습니다.
    if (images.length && !images.some((image) => image.isPrimary)) images[0].isPrimary = true;

    /*
      ── 고른 변형만 따라옵니다 ──────────────────────────────────────────
       변형이 수십 개인 카드를 통째로 복사하면 폴더가
      금세 불어나고, 대부분은 이 작품에서 안 씁니다.

      파일 이름은 «인물_변형_번호» 입니다(규칙 5). `ownerName` 은 **인물** 이름 그대로
      두고 `stem` 에만 변형 이름을 붙입니다 — 폴더는 인물당 하나여야 합니다.
    */
    const variations: NonNullable<Character["variations"]> = [];
    for (const variation of pick.candidate.variations) {
      const wanted = pick.variationImageIds?.[variation.id];
      if (!wanted) continue;
      const source = pick.candidate.card.variations?.find((item) => item.id === variation.id);
      if (!source) continue;

      const varImages: GeneratedImageAsset[] = [];
      for (const image of variation.images) {
        if (!wanted.includes(image.id) || !image.filePath) continue;
        try {
          const saved = await importProjectMediaAsset(image.filePath, {
            projectName,
            assetType:
              request.kind === "character" ? "character-generated" : "background-generated",
            ownerName: name,
            stem: `${safeFileName(name)}_${safeFileName(variation.name)}`,
          });
          if (!saved?.path) {
            failed += 1;
            continue;
          }
          varImages.push({ ...image, id: uid(), filePath: saved.path, name: saved.name });
          copied += 1;
        } catch {
          failed += 1;
        }
      }
      if (varImages.length && !varImages.some((image) => image.isPrimary))
        varImages[0].isPrimary = true;

      variations.push({
        ...source,
        id: uid(),
        generatedImages: varImages,
        /*
          **부모를 새 카드로 다시 겁니다.** 원래 부모 id 를 그대로 두면 이 작품에 없는
          카드를 가리켜 정체성 기준이 끊깁니다(규칙 6: 정체성은 하나).
        */
        parentId: base.id,
        parentVariationId: undefined,
        // 레퍼런스는 저쪽 파일을 가리킵니다 — 안 가져옵니다. 열면 부모 시트가 다시 걸립니다.
        references: [],
        analysisHistory: [],
        promptHistory: [],
      } as NonNullable<Character["variations"]>[number]);
    }

    const made = {
      ...base,
      ...source,
      id: base.id,
      name,
      generatedImages: images,
      /*
        **레퍼런스와 변형·시트는 안 따라옵니다.**

        그것들은 저쪽 작품의 파일을 가리킵니다. 그대로 두면 이쪽에서 지울 때 저쪽 그림이
        사라지고(규칙 3), 이름을 바꾸면 저쪽 파일 이름이 따라갑니다(규칙 5). 카드의 «설정과
        고른 그림» 만 가져오고, 변형은 이쪽에서 새로 만듭니다.
      */
      references: [],
      variations,
      /*
        **저쪽 작품의 파일을 가리키는 칸은 전부 비웁니다.**

        2026-09-18 점검에서 찾았습니다 — `...source` 로 통째로 베끼면서 `assets`
        (`VisualAsset.filePath`)·`alternates`(그 안의 `generatedImages.filePath`)·
        `sheetFills` 가 **그대로 따라오고 있었습니다.** 위 주석은 「안 따사용자다」 고
        적어 두었는데 코드가 달랐습니다.

        그대로 두면 이 카드를 지울 때 **1편의 원본 그림이 지워집니다**(규칙 3).
        이름을 바꾸면 저쪽 파일 이름이 따라갑니다(규칙 5).
      */
      assets: [],
      alternates: [],
      sheetFills: undefined,
      analysis: source.analysis,
      analysisHistory: [],
      promptHistory: [],
      // 어디서 왔는지 남겨 둡니다. 나중에 「이 인물은 1편 것」 을 알 수 있어야 합니다.
      borrowedFrom: `${pick.candidate.projectTitle} · ${source.name}`,
    };

    if (request.kind === "character") characters.push(made as Character);
    else backgrounds.push(made as Background);
  }

  return { characters, backgrounds, copied, failed };
}

/**
 * **다른 작품에서 방을 끌어옵니다.**
 *
 * # 적용된 것만 옵니다
 *
 * 방에는 **여섯 면과 바깥 여섯 면**이 있는데, 실제로 그림을 건 면만 값이 있습니다
 * (`faces`·`outerFaces` 는 «면 → 파일 경로» 표라 안 건 면은 칸 자체가 없습니다).
 * 그래서 그 표를 그대로 훑으면 «적용된 것만» 이 자연히 지켜집니다 — 장소 카드의
 * 그림 전부를 뒤지지 않습니다.
 *
 * # 그림도 복사합니다
 *
 * 경로만 베끼면 저쪽 작품의 파일을 가리킵니다. 이 방을 지울 때 1편의 그림이 사라지고
 * (규칙 3), 그 작품을 옮기면 이쪽 방이 빈 벽이 됩니다. 파일을 이 작품 폴더로 복사하고
 * 경로를 갈아 끼웁니다.
 *
 * # 목록이 길어지지 않습니다
 *
 * 방 라이브러리는 `draft.roomPresets` 라 **원래 작품마다 따로**입니다. 끌어온 방은 이
 * 작품의 목록에만 들어갑니다.
 */
export interface BorrowRoomCandidate {
  projectTitle: string;
  preset: RoomPreset;
  /** 실제로 그림을 건 면의 수. 목록에 「6면 중 4면」 처럼 적습니다. */
  faceCount: number;
}

export function borrowRoomCandidates(exceptFolder: string): BorrowRoomCandidate[] {
  const out: BorrowRoomCandidate[] = [];
  for (const summary of listLocalProjects()) {
    if (projectFolderName(summary.id, summary.title) === exceptFolder) continue;
    const project = getLocalProject(summary.id);
    if (!project) continue;
    const draft = project.draft as Partial<ProjectDraft>;
    for (const preset of draft.roomPresets ?? []) {
      out.push({
        projectTitle: summary.title || "이름 없는 작품",
        preset,
        faceCount:
          Object.values(preset.room.faces ?? {}).filter(Boolean).length +
          Object.values(preset.room.outerFaces ?? {}).filter(Boolean).length,
      });
    }
  }
  return out;
}

/** 면 표를 훑어 **값이 있는 칸만** 이 작품 폴더로 복사하고 새 경로로 바꿔 돌려줍니다. */
async function copyFaces(
  faces: Partial<Record<string, string>> | undefined,
  projectName: string,
  ownerName: string,
  count: { copied: number; failed: number },
): Promise<Partial<Record<string, string>>> {
  const out: Partial<Record<string, string>> = {};
  for (const [face, path] of Object.entries(faces ?? {})) {
    if (!path) continue;
    try {
      const saved = await importProjectMediaAsset(path, {
        projectName,
        assetType: "background-generated",
        ownerName,
        stem: `${safeFileName(ownerName)}_${safeFileName(face)}`,
      });
      if (saved?.path) {
        out[face] = saved.path;
        count.copied += 1;
      } else {
        count.failed += 1;
      }
    } catch {
      count.failed += 1;
    }
  }
  return out;
}

export async function borrowRooms(request: {
  picks: BorrowRoomCandidate[];
  draft: ProjectDraft;
  projectName: string;
}): Promise<{ presets: RoomPreset[]; copied: number; failed: number }> {
  const taken = (request.draft.roomPresets ?? []).map((item) => item.name);
  const presets: RoomPreset[] = [];
  const count = { copied: 0, failed: 0 };

  for (const pick of request.picks) {
    const name = freeName(pick.preset.name, [...taken, ...presets.map((item) => item.name)]);
    const faces = await copyFaces(pick.preset.room.faces, request.projectName, name, count);
    const outerFaces = await copyFaces(pick.preset.room.outerFaces, request.projectName, name, count);
    presets.push({
      ...pick.preset,
      id: uid(),
      name,
      savedAt: new Date().toISOString(),
      room: {
        ...pick.preset.room,
        id: uid(),
        name,
        faces,
        outerFaces: Object.keys(outerFaces).length ? outerFaces : undefined,
        /*
          **장소 카드 연결은 끊습니다.** `backgroundId` 는 저쪽 작품의 카드를 가리킵니다 —
          그대로 두면 이 작품에 없는 카드를 가리켜, 방을 세울 때 배경이 조용히 사라집니다.
          면 그림은 이미 복사해 왔으니 벽은 그대로 보입니다.
        */
        backgroundId: undefined,
      },
      // 소품과 묶음은 그대로 옵니다 — 세울 때 `applyRoomPresetIn` 이 새 id 를 답니다.
    });
  }
  return { presets, copied: count.copied, failed: count.failed };
}
