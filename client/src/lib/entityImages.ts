import type { VisualAsset } from "@/lib/visualAsset";
import type { FaceKey } from "@/lib/faceSets";

/**
 * 씬 구성(컷 카드)의 «인물·장소 그림 줄» 에 보여 줄 그림을 **한 목록** 으로 모읍니다.
 *
 * 예전 컷 카드는 `generatedImages.slice(0, 2)` — 원본 앞 두 장뿐이었습니다. 변형·시트·
 * 보유 에셋·공용 에셋이 전부 빠져 있어, 2단계에서 만든 것이 3단계에서 안 보였습니다.
 *
 * 캐릭터와 배경이 같은 모양(`generatedImages` + `variations[]` + `assets[]`)이라 함수
 * 하나로 둘 다 처리합니다(규칙 1). 시트 제작 창(`EntitySheetComposer`)이 «원본 + 변형 +
 * 공용 에셋» 을 모으는 것과 같은 순서이되, 여기서는 어디서 온 것인지 배지를 붙입니다.
 */

export type PickerGroup = "root" | "variation" | "alternate" | "sheet" | "owned" | "shared";

export interface PickerImage {
  /** `filePath || id`. 같은 파일이 두 카드에 걸려 있어도 한 번만 보이게 하는 열쇠 */
  id: string;
  name: string;
  thumb: string;
  filePath?: string;
  group: PickerGroup;
  /** 타일 위에 뜨는 작은 글자 — «겨울» «원본 · 어린 시절» «시트 · 얼굴» «보유 · 단검» «공용 · 가방». 원본은 비어 있습니다 */
  badge: string;
  /** 어느 인물·장소의 것인지. 컷에 인물이 둘이면 이걸로 묶어 보여 줍니다 */
  ownerName: string;
  /** 6면 세트의 면·세트 표. 컷 카드가 `splitFaceSets` 로 세트 카드 한 장으로 접습니다 — 없으면 이름으로 압니다 */
  face?: FaceKey;
  faceSet?: string;
}

/** 모으는 쪽이 요구하는 최소 모양. `GeneratedImageAsset`·`VisualAssetImage`·`VisualAssetReference` 가 다 맞습니다 */
interface PickerSource {
  id: string;
  name: string;
  thumb: string;
  filePath?: string;
  isPrimary?: boolean;
  isCompositeSheet?: boolean;
  sheetLabel?: string;
  /** 변형의 정체성 기준은 부모 그림을 다시 가리키는 것이라 셈에서 뺍니다 */
  isParentReference?: boolean;
  face?: FaceKey;
  faceSet?: string;
}

/** 캐릭터·배경이 공통으로 갖는 칸만. 두 타입을 따로 받지 않아야 규칙 1 이 지켜집니다 */
export interface PickerEntity {
  name: string;
  generatedImages: PickerSource[];
  variations?: { name: string; generatedImages?: PickerSource[] }[];
  assets?: VisualAsset[];
  /** 다른 원본(«어린 시절» «노인»). 각각 제 변형을 가집니다 — 한 단계만이라 이 안의 alternates 는 안 봅니다 */
  alternates?: {
    name: string;
    generatedImages?: PickerSource[];
    references?: PickerSource[];
    variations?: { name: string; generatedImages?: PickerSource[]; references?: PickerSource[] }[];
  }[];
}

/** 공용 에셋 묶음의 머리줄 이름. 컷 카드가 인물 묶음과 나란히 보여 줍니다 */
export const SHARED_OWNER_NAME = "공용 에셋";

function toPicker(image: PickerSource, group: PickerGroup, badge: string, ownerName: string): PickerImage {
  return {
    id: image.filePath || image.id,
    name: image.name,
    thumb: image.thumb,
    filePath: image.filePath,
    group,
    badge,
    ownerName,
    face: image.face,
    faceSet: image.faceSet,
  };
}

/** 대표 이미지가 맨 앞. 나머지는 등록한 순서 그대로 */
function primaryFirst<T extends { isPrimary?: boolean }>(list: T[]): T[] {
  return [...list.filter((image) => image.isPrimary), ...list.filter((image) => !image.isPrimary)];
}

/**
 * 같은 파일은 한 번만, 그림이 없는 항목(썸네일도 경로도 없음)은 뺍니다.
 *
 * `thumb` 는 blob 주소라 앱을 다시 열면 죽고, `filePath` 가 진짜입니다. 둘 다 없으면
 * 아직 저장이 안 끝난 빈 칸이라 보여 줄 것이 없습니다.
 */
export function dedupePickerImages(list: PickerImage[]): PickerImage[] {
  const seen = new Set<string>();
  const out: PickerImage[] = [];
  for (const image of list) {
    if (!image.thumb && !image.filePath) continue;
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    out.push(image);
  }
  return out;
}

/**
 * 에셋(보유·공용) 하나의 그림 — 원본 생성 이미지·레퍼런스, 그리고 변형의 것.
 *
 * 레퍼런스도 넣는 이유: 에셋은 «밖에서 뽑아 온 그림» 보다 «참고로 올린 사진» 이 전부인
 * 경우가 많습니다. 정체성 기준(부모를 다시 가리키는 것)은 중복이라 뺍니다.
 */
function assetImages(asset: VisualAsset, group: "owned" | "shared", ownerName: string): PickerImage[] {
  const label = group === "owned" ? "보유" : "공용";
  const assetName = asset.name?.trim() || "에셋";
  const own = [
    ...primaryFirst(asset.generatedImages || []),
    ...(asset.references || []).filter((reference) => !reference.isParentReference),
  ].map((image) => toPicker(image, group, `${label} · ${assetName}`, ownerName));
  const variations = (asset.variations || []).flatMap((variation) =>
    [
      ...primaryFirst(variation.generatedImages || []),
      ...(variation.references || []).filter((reference) => !reference.isParentReference),
    ].map((image) =>
      toPicker(image, group, `${label} · ${assetName} › ${variation.name?.trim() || "변형"}`, ownerName),
    ),
  );
  return [...own, ...variations];
}

/**
 * 다른 원본 하나의 그림 — 생성 이미지(대표 먼저)와 부모 기준이 아닌 레퍼런스, 그다음 그 변형의 것.
 *
 * 레퍼런스도 넣는 이유는 에셋과 같습니다 — 어린 시절 사진 한 장을 올려 두고 그림은 아직
 * 안 뽑은 원본이 흔합니다. 합성 시트는 주인 시트 줄과 섞이지 않게 여기서도 뺍니다.
 */
function alternateImages(alternate: NonNullable<PickerEntity["alternates"]>[number], ownerName: string): PickerImage[] {
  const altName = alternate.name?.trim() || "이름 없음";
  const own = [
    ...primaryFirst((alternate.generatedImages || []).filter((image) => !image.isCompositeSheet)),
    ...(alternate.references || []).filter((reference) => !reference.isParentReference),
  ].map((image) => toPicker(image, "alternate", `원본 · ${altName}`, ownerName));
  const variations = (alternate.variations || []).flatMap((variation) =>
    [
      ...primaryFirst((variation.generatedImages || []).filter((image) => !image.isCompositeSheet)),
      ...(variation.references || []).filter((reference) => !reference.isParentReference),
    ].map((image) =>
      toPicker(image, "alternate", `원본 · ${altName} › ${variation.name?.trim() || "변형"}`, ownerName),
    ),
  );
  return [...own, ...variations];
}

/**
 * 인물·장소 하나의 그림 전부.
 *
 * 순서: 원본(시트 아닌 것, 대표 먼저) → 변형별 그림 → 다른 원본(각각 원본 → 그 변형) →
 * 시트(원본·변형의 합성 시트) → 보유 에셋(원본·변형). 시트를 뒤로 보내는 이유는 6000px
 * 합성물이 72px 타일에서는 알아보기 어려워 «있다» 는 것만 알면 되기 때문입니다. 배지에 시트
 * 이름을 붙입니다. 다른 원본은 «같은 인물의 다른 모습» 이라 변형 바로 다음, 에셋보다 앞입니다.
 */
export function collectEntityPickerImages(entity: PickerEntity): PickerImage[] {
  const ownerName = entity.name?.trim() || "이름 없음";
  const rootAll = entity.generatedImages || [];
  const root = primaryFirst(rootAll.filter((image) => !image.isCompositeSheet)).map((image) =>
    toPicker(image, "root", "", ownerName),
  );
  const variations = (entity.variations || []).flatMap((variation) =>
    primaryFirst((variation.generatedImages || []).filter((image) => !image.isCompositeSheet)).map((image) =>
      toPicker(image, "variation", variation.name?.trim() || "변형", ownerName),
    ),
  );
  const alternates = (entity.alternates || []).flatMap((alternate) => alternateImages(alternate, ownerName));
  const sheets = [
    ...rootAll.filter((image) => image.isCompositeSheet),
    ...(entity.variations || []).flatMap((variation) =>
      (variation.generatedImages || []).filter((image) => image.isCompositeSheet),
    ),
  ].map((image) => toPicker(image, "sheet", `시트 · ${image.sheetLabel?.trim() || image.name}`, ownerName));
  const owned = (entity.assets || []).flatMap((asset) => assetImages(asset, "owned", ownerName));
  return dedupePickerImages([...root, ...variations, ...alternates, ...sheets, ...owned]);
}

/** 공용 에셋 전부. 캐릭터 탭·배경 탭 양쪽에 뜹니다 — 공용이라는 뜻이 그것이니까요 */
export function collectSharedPickerImages(sharedAssets: VisualAsset[] | undefined): PickerImage[] {
  return dedupePickerImages(
    (sharedAssets || []).flatMap((asset) => assetImages(asset, "shared", SHARED_OWNER_NAME)),
  );
}
