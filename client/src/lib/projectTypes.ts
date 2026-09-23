import type { CharacterProfile } from "@/lib/characterProfile";
import type { SavedPromptEntry } from "@/lib/promptHistory";
import type { ImageMark } from "@/components/ImageMarkupEditor";
import type { DrawableMark } from "@/lib/imageMarkDraw";
import type { RoomPreset } from "@/lib/roomPreset";
import { newVisualAsset, type VisualAsset } from "@/lib/visualAsset";
import type { CompositionCubeFace, CompositionState } from "@/lib/composition";

/**
 * 카드가 6면 세트를 뽑은 **공간 크기**(m)와, 구도잡기 방에 붙일 때 옆면 아래를 얼마나 버릴지.
 * `cropBottom` 은 실외 전개도만 적습니다 — 까닭은 `CompositionRoom.sideCropBottom`.
 */
export interface FaceSetSize {
  width: number;
  depth: number;
  height: number;
  cropBottom?: number;
}
import type {
  PromptVariationState,
  PromptWorkflowState,
} from "@/lib/promptWorkflow";
import type { SpaceKind } from "@/lib/blueprint";
import type { ProjectContext } from "@/lib/projectContext";
import {
  INITIAL_CHARACTER_BLUEPRINT,
  INITIAL_BACKGROUND_BLUEPRINT_BY_SPACE,
} from "@/lib/blueprint";

/**
 * 프로젝트가 들고 있는 것들.
 *
 * 원래는 9,440줄짜리 `NewProjectPage.tsx` 안에 화면 코드와 섞여 있었습니다.
 * 사고로 잃고 다시 쓰면서 **모양만 따로 빼 둡니다.** 뭘 고치려 할 때마다
 * 그 큰 파일 안을 헤매야 했고, 문자열로 자리를 찾다 엉뚱한 곳을 고치는
 * 일이 여러 번 있었습니다.
 *
 * 조각으로 확인한 것은 그대로 두고, 없는 것만 쓰임새에서 되짚어 채웠습니다.
 */

export function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 이미지
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 폴더에 저장된 그림 하나.
 *
 * `thumb` 는 화면에 바로 띄우려고 들고 있는 `blob:` 주소인데 **앱을 닫으면
 * 죽습니다.** 그래서 `filePath` 가 진짜고, 화면에 띄울 때는 늘
 * `assetSrc(filePath) || thumb` 순서로 씁니다. 이 순서를 뒤집었다가
 * 「다시 열면 그림이 빈칸」 버그가 여러 번 났습니다.
 */
export interface GeneratedImageAsset {
  id: string;
  name: string;
  thumb: string;
  file: File | null;
  filePath?: string;
  /** 대표 이미지. 목록에서 이 카드를 보여 줄 때 씁니다. */
  isPrimary?: boolean;
  sheetType?: "character" | "background";
  /**
   * 여러 장을 이어 붙여 만든 시트인지.
   *
   * 모델이 뽑아 준 그림과 성격이 달라서 목록을 나눠 보여 줍니다.
   * 대표 이미지로도 쓰지 않습니다 — 카드만 봐서는 누구인지 알 수 없어서요.
   */
  isCompositeSheet?: boolean;
  /** 합성 시트에 사람이 붙인 이름. 「겨울 의상」 처럼 무엇의 판인지 적습니다. */
  sheetLabel?: string;
  /**
   * 마그니픽 받는 자리에서 가져온 그림의 원래 파일 이름.
   *
   * 마그니픽은 UUID 나 «magnific_프롬프트_시각» 으로 내려 주고, 우리는 받으면서
   * «인물_NNN» 으로 바꿉니다. 어느 생성물이었는지 되짚을 때 이것만 남습니다.
   */
  sourceName?: string;
  /**
   * 합성 시트를 구울 때의 판(배치도·규격·칸). 시트에만 붙습니다.
   *
   * 이게 없으면 시트를 다시 열어 고칠 길이 없습니다 — 결과 그림에 판을 붙여 두면
   * 그 시트를 열어 칸만 갈아 끼우고 **같은 항목을 다시 구울** 수 있습니다.
   */
  sheet?: SheetSnapshot;
  /**
   * 6면 세트의 어느 면인지(정면·후면·왼쪽·오른쪽·위·아래). 파노라마 탭이 저장할 때 채웁니다.
   * 파일 이름(`장소_정면_001`)에서도 읽을 수 있지만, 이름 파싱 없이 알게 두는 것입니다.
   * 옛 파일은 이 칸이 없으니 `faceSets.faceOf` 가 이름으로 보완합니다.
   */
  face?: CompositionCubeFace;
  /** 세트 id `<접두>_<NNN>` — 같은 번호 여섯 장이 한 세트. `face` 와 같이 채웁니다. */
  faceSet?: string;
  /**
   * 이 여섯 면이 **어떤 크기의 공간**으로 뽑혔는지(배경 카드의 «등장방형» 칩 크기). 구도잡기가 세트를 걸 때 방을 이 크기로
   * 세웁니다. 크기는 카드에 넣었는데 구도잡기는 몰랐습니다.
   */
  faceSetSize?: FaceSetSize;
  /**
   * 자동 6면 커팅이 **이 그림을 이미 봤다**는 표시.
   *
   * 전개도가 들어오면
   * `useAutoUnfold` 가 알아서 여섯 면을 잘라 저장하는데, 그 뒤에도 전개도 원본은 목록에
   * 남습니다(다시 자르거나 선을 고칠 때의 재료). 표시가 없으면 목록이 바뀔 때마다 같은
   * 그림을 또 자릅니다.
   *
   * 자른 그림은 ISO 시각, **전개도가 아니었던 그림은 `"not-unfold"`** 입니다 — 후자도
   * 남겨 둬야 카드를 열 때마다 픽셀을 다시 재지 않습니다.
   */
  unfoldedAt?: string;
}

export interface ReferenceImage {
  id: string;
  name: string;
  thumb: string;
  file: File | null;
  filePath?: string;
  /**
   * 부모 시트에서 물려받은 레퍼런스인지.
   *
   * 변형은 «원본과 같은 인물» 이어야 해서 부모 시트가 정체성 기준입니다.
   * 사람이 실수로 지워도 다시 세워 둡니다.
   */
  isParentReference?: boolean;
  /**
   * 다른 카드(원본 인물)의 파일을 빌려 쓰는 레퍼런스.
   *
   * 변형 창의 «이 캐릭터의 생성 이미지·레퍼런스» 줄에서 집어넣은 것입니다. 이 카드
   * 목록에서 빼도 파일은 원본 인물 것이라 지우면 안 됩니다 — 규칙 3(화면 삭제 = 파일
   * 삭제)의 예외입니다. 사용자가 부모 레퍼런스를 빼려다 «파일도 삭제» 경고를 봤습니다.
   */
  sharedFile?: boolean;
  /** 이 그림이 무엇인지 적어 둔 꼬리표. 프롬프트에서 이 이름으로 가리킵니다. */
  label?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시트 배치
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 시트 위에 놓인 것 하나.
 *
 * 그림일 수도 있고 글 상자(캐릭터 프로필)일 수도 있습니다. 좌표·크기는 **그 배치도
 * 규격(캔버스)의 실제 px** 입니다 — 화면에서 어떤 배율로 보고 있든 결과가 같습니다.
 *
 * 예전에는 «긴 변 = 6000» 기준이었고 굽는 순간 규격에 맞춰 통째로 줄였습니다. 그러면
 * 4000 시트는 6000 시트를 축소한 같은 그림이라 규격을 바꾸는 뜻이 없었습니다
 * (「이미지는 출력된 사이즈로 들어가야해」). 옛 값은 `SheetLayout.coords`
 * 가 없는 것으로 알아보고 `layoutToPx` 로 한 번 바꿉니다.
 */
export interface SheetPlacement {
  id: string;
  kind?: "image" | "profile";
  /** 그림일 때. 어느 이미지를 놓았는지 */
  imageId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * 글자 크기. 시트의 절대 px 입니다(상자와 같은 좌표계).
   *
   * 상자 크기에 따라 자동으로 커지게 했더니, 글 상자를 넓히면 글씨까지
   * 같이 커져서 배치를 잡을 수가 없었습니다. 상자 크기와 글자 크기는
   * 따로 두는 것이 맞습니다.
   */
  fontSize?: number;
  /**
   * 칸 아래에 **표로** 적을 줄들. 있으면 `notes` 대신 이것을 그립니다.
   *
   * 줄글로 늘어놓으면 «5.0초 · 고정 / 수화안 / 대사·연기: …»
   * 가 한 덩어리로 보여 무엇이 무엇인지 가려지지 않습니다.
   */
  noteRows?: { label: string; value: string }[];
  /**
   * 칸 **아래 컷 정보**의 글자 크기(시트 절대 px). 안 주면 칸 이름의 0.72배입니다.
   *
   * 시트를 작게 뽑으면 글자도 같이 줄어드는데, 읽으라고 적은 글은 시트 크기와 무관하게
   * 읽혀야 합니다. 스토리보드가 칸 너비에 맞춰 직접 정해 넘깁니다.
   */
  notesFont?: number;
  /**
   * 칸 이름 — «전신», «표정».
   *
   * 시트 밑에 캡션으로 찍히고, 배치도를 다른 인물에 써도 남습니다. 예전에는 그림의
   * 파일 이름이 칸 위에 붙어 그림을 가렸고 바꿀 수도 없었습니다 .
   */
  label?: string;
  /**
   * 이 칸의 그림 위에 **덧그릴 표시**(동선·구역·자리).
   *
   * 표시는 그림에 구워 넣지 않고 **칸에 올릴 때** 그립니다 — 원본 그림은 표시 없이 남아야 다음 컷의 레퍼런스로 다시 쓰고,
   * 표시만 고쳐 다시 굽는 일도 됩니다. 저장된 배치도(`sheetLayouts`)에는 보통 없고, 스토리보드가 구울 때 채웁니다.
   */
  marks?: DrawableMark[];
  /**
   * 칸 **아래**에 적을 글줄 — 스토리보드의 컷 정보(길이·카메라·대사·연기).
   *
   * 캡션(`label`)은 한 줄짜리 «칸 이름»
   * 이라 컷 정보를 담기엔 좁습니다.
   */
  notes?: string[];
  /** 글줄에 내줄 높이(px). 칸 자리를 잡는 쪽이 정합니다 — 없으면 안 그립니다. */
  notesRoom?: number;
}

/** 굽는 규격(px). 없으면 6000×6000 */
export interface SheetSize {
  width: number;
  height: number;
}

/**
 * 배치도 한 판. **프로젝트 공용** 입니다(`ProjectDraft.sheetLayouts`).
 *
 * 칸의 자리·크기·이름만 들고, 어느 그림이 어느 칸에 들어가는지는 인물마다
 * `sheetFills` 에 따로 둡니다. 그래야 한 배치도를 다른 인물의 시트에서 그대로
 * 골라 쓸 수 있습니다 .
 *
 * 좌표계는 **규격(`size`)의 실제 px** 입니다. 그림을 넣으면 칸이 그 그림의 뽑힌 크기
 * (naturalWidth × naturalHeight)가 되고, 규격을 바꿔도 칸의 px 는 그대로입니다.
 */
export interface SheetLayout {
  id: string;
  name: string;
  placements: SheetPlacement[];
  /** 배치도마다 규격 . 없으면 6000×6000 */
  size?: SheetSize;
  /** 칸 이름을 시트에 굽는가. 기본 true */
  captions?: boolean;
  /**
   * 좌표계 표시. `"px"` 면 칸 좌표·크기·글자가 규격의 실제 px.
   * **없으면 옛 «긴 변 6000 기준»** 배치도라 `layoutToPx` 로 바꿔야 합니다(2026-09-08 이전 저장분).
   */
  coords?: "px";
}

/**
 * 시트 한 장을 구울 때의 판. 다시 열어 고치려고 결과 그림에 붙여 둡니다
 * .
 * 여기의 placements 는 imageId 까지 든 스냅샷입니다.
 */
export interface SheetSnapshot {
  layoutId?: string;
  layoutName?: string;
  size: SheetSize;
  placements: SheetPlacement[];
  captions?: boolean;
  /** `SheetLayout.coords` 와 같음. 없으면 옛 «긴 변 6000 기준» 스냅샷 */
  coords?: "px";
}

/**
 * 배치도의 칸에 어느 그림을 넣었는지. `layoutId → placementId → imageId`.
 *
 * 배치도는 프로젝트 공용이라 그림은 여기(인물 쪽)에 둡니다. 다른 인물의 imageId 는
 * 이 인물의 그림 풀에 없으니 시트 창에서 자연히 «빈 칸» 으로 보입니다.
 */
export type SheetFills = Record<string, Record<string, string>>;

// ─────────────────────────────────────────────────────────────────────────────
// 캐릭터
// ─────────────────────────────────────────────────────────────────────────────

export interface CharacterVariation extends PromptVariationState<
  ReferenceImage,
  GeneratedImageAsset
> {
  /** 시트 배치도. 복제해서 칸 몇 개만 갈아 끼울 수 있습니다. */
  sheetLayouts?: SheetLayout[];
}

export interface Character extends PromptWorkflowState<
  ReferenceImage,
  GeneratedImageAsset
> {
  id: string;
  name: string;
  role: string;
  gender: string;
  heightCm: number;
  build: "slim" | "average" | "athletic" | "broad";
  kind: "human" | "animal" | "creature";
  description: string;
  refType: "none" | "upload";
  thumb: string | null;
  thumbFile: File | null;
  /** 레퍼런스 이미지. PromptWorkflowState 의 references 와 같은 것을 가리킵니다. */
  refImages: ReferenceImage[];
  variations: CharacterVariation[];
  assets: VisualAsset[];
  /**
   * 다른 원본 — 같은 인물의 «어린 시절» «노인 버전» 처럼 원본부터 다시 그려야 하는 모습.
   *
   * 변형은 «같은 시트에서 옷·표정만 바꾼 것» 이라 정체성 기준이
   * 부모 시트에 묶이는데, 어린 시절은 시트 자체가 달라야 하니 변형으로는 안 됩니다.
   *
   * 각 원본은 제 변형 계보를 가집니다. 파일은 주인 폴더 안(규칙 5)에 «냥이_어린시절_001»
   * 로 — 보유 에셋과 같은 자리 규칙입니다. **한 단계만** — 다른 원본의 다른 원본은 그리지
   * 않습니다(구조가 재귀로 깊어지면 폴더 읽기·이름 바꾸기가 어느 층인지 못 가립니다).
   * 옛 데이터에는 없어서 물음표가 붙습니다.
   */
  alternates?: Character[];
  /**
   * 성격·말투·습관.
   *
   * 6000×6000 시트의 빈 자리에 적어 넣습니다. 영상 모델이 이 인물을 연기할 때
   * 읽는 것이라, 그림만으로는 알 수 없는 것을 담습니다.
   */
  profile?: CharacterProfile;
  /**
   * **옛 데이터 호환용.** 시트 창을 열 때 프로젝트 배치도(`ProjectDraft.sheetLayouts`)로
   * 올라가고 여기는 비워집니다.
   *
   * 배치도가 인물마다 갇혀 있어 다른 인물에서 못 골랐습니다.
   * 그림은 `sheetFills` 로 옮겨 갑니다.
   */
  sheetLayouts?: SheetLayout[];
  /** 프로젝트 배치도의 칸에 이 인물의 어느 그림을 넣었는지 */
  sheetFills?: SheetFills;
}

// ─────────────────────────────────────────────────────────────────────────────
// 배경
// ─────────────────────────────────────────────────────────────────────────────

export interface BackgroundVariation extends PromptVariationState<
  ReferenceImage,
  GeneratedImageAsset
> {
  sheetLayouts?: SheetLayout[];
}

export interface Background extends PromptWorkflowState<
  ReferenceImage,
  GeneratedImageAsset
> {
  id: string;
  name: string;
  location: string;
  description: string;
  /**
   * 실내인지 실외인지.
   *
   * 마스터 이미지의 종류가 여기서 갈립니다. 실외는 조감도가 통하지만
   * 실내는 지붕에 막혀 아무것도 안 보입니다.
   */
  spaceKind?: SpaceKind;
  /**
   * 이 카드가 **무엇을 위해** 만들어졌는가. 없으면 보통 장소입니다.
   *
   * - `"wall"` — 구도잡기의 «벽» 한 장에 붙일 그림. 방에 거는 장소가 아니라서 방의 장소 목록에는 안 뜹니다.
   * - `"dome"` — 실외 돔에 두를 파노라마. 실외 방 목록에만 뜹니다.
   *
   * 목록을 거르는 데만 씁니다 — 카드 자체는 여느 장소와 똑같이 프롬프트·그림·폴더를 씁니다(공통 규칙 1).
   */
  usage?: "wall" | "dome";
  thumb: string | null;
  thumbFile: File | null;
  refImages: ReferenceImage[];
  variations: BackgroundVariation[];
  assets: VisualAsset[];
  /**
   * 다른 원본 — 같은 장소의 «겨울» «백 년 전» 처럼 마스터부터 다시 그려야 하는 모습.
   * 캐릭터의 `alternates` 와 같은 규칙(규칙 1) — 한 단계만, 파일은 주인 폴더 안. 옛 데이터에는 없음.
   */
  alternates?: Background[];
  /**
   * 표시를 읽어 올 대상 이미지.
   *
   * 표시 자체는 그림 파일 쪽에 붙어 있습니다(ProjectDraft.imageMarks).
   * 여기서는 «어느 그림의 표시를 쓸지» 만 고릅니다. 배경 카드가 표시를
   * 들고 있으면, 같은 공간에서 앵커만 옮겨 다른 씬을 만들 때마다 원본의
   * 표시를 지웠다 다시 찍어야 합니다.
   */
  faceMarkSourceId?: string;
  /** 옛 데이터 호환용 — 시트 창을 열 때 프로젝트 배치도로 올라감. `Character.sheetLayouts` 와 같음 */
  sheetLayouts?: SheetLayout[];
  /** 프로젝트 배치도의 칸에 이 장소의 어느 그림을 넣었는지 */
  sheetFills?: SheetFills;
}

// ─────────────────────────────────────────────────────────────────────────────
// 씬과 컷
// ─────────────────────────────────────────────────────────────────────────────

export interface SceneVideoAsset {
  id: string;
  name: string;
  filePath?: string;
  thumb?: string;
  /**
   * **대표 영상.** 여러 번 뽑아 본 것 중 «이게 그 장면이다» 하나입니다.
   *
   * 그림 선반의 «별» 과 같은 뜻이고, 한 선반에 하나뿐입니다.
   */
  isPrimary?: boolean;
}

export interface Cut {
  id: string;
  order: number;
  title: string;
  description: string;
  /** 이 컷에 나오는 인물들 */
  characterIds: string[];
  backgroundId?: string;
  /** 구도잡기에서 잡아 둔 3차원 배치 */
  composition?: CompositionState;
  /** 구도잡기에서 찍어 낸 참고 그림 */
  guideImage?: string;
  /**
   * 구도 그림을 프로젝트 폴더에 저장한 경로.
   *
   * `guideImage` 는 캡처 직후의 data URL 이라 **마그니픽에 못 보냅니다** — 보내는 길이
   * 파일 경로를 요구합니다(클립보드에 파일로 넣어야 이미지 노드가 됩니다). 한 번 저장해
   * 두면 같은 컷을 다시 보낼 때 또 저장하지 않습니다.
   */
  guideImagePath?: string;
  /**
   * 같은 카메라에서 **배경만** 그린 그림(과 그 저장 경로).
   *
   * 생성기에 파노라마 원본을 주면 등장방형 왜곡을 그대로 따라 그리고 화각이 안 맞아
   * 배경을 제 나름대로 다시 해석합니다. 이 플레이트는 그 컷의 카메라로
   * 이미 올바르게 잘린 그림이라 왜곡이 없고, 컷마다 같은 3D 세트에서 나오므로 배경이
   * 컷 사이에서 달라지지 않습니다.
   */
  plateImage?: string;
  plateImagePath?: string;
  promptKo?: string;
  promptEn?: string;
  negativeKo?: string;
  negativeEn?: string;
  /**
   * 받아 둔 컷 프롬프트들.
   *
   * 캐릭터·배경 카드에는 예전부터 있었는데(`PromptWorkflow.promptHistory`) 컷만 없어서,
   * 「프롬프트 작성」 을 한 번 더 누르면 앞의 판이 그 자리에서 사라졌습니다. 컷 프롬프트도
   * 돈을 내고 받는 것이고, 그 위에 손으로 고친 문장이 얹혀 있습니다.
   */
  promptHistory?: SavedPromptEntry[];
  /**
   * 구도잡기에서 뽑은 **레퍼런스 영상**(mp4)의 저장 경로와 길이(초).
   *
   * 예전에는 영상을 만들어 폴더에 저장하고 **끝**이었습니다 — 컷은 그 영상이 있는지도
   * 몰랐습니다. 경로를 컷에 적어 두면 「이 컷을 영상으로」 를 누를 때 그대로 레퍼런스로
   * 올릴 수 있고, 길이가 곧 생성 영상의 러닝타임이 됩니다.
   */
  /**
   * 기획 단계에서 잡아 둔 **컷 길이**(초).
   *
   * 「AI 로 일괄 생성」 이 컷마다 적어 줍니다. 구도잡기를 열기 전에는 잴 것이 없어서,
   * 영상 프롬프트가 늘 5초로 나가던 자리를 이 값이 메웁니다. 구도잡기에서 타임라인을
   * 잡으면 **그쪽이 이깁니다** — 잰 값이 적어 둔 값보다 셉니다(`cutVideoSeconds`).
   */
  plannedSeconds?: number;
  refVideoPath?: string;
  refVideoSeconds?: number;
  /**
   * 이 컷에서 **구도를 쓸 것인가.** 안 적었으면 씁니다(구도가 있을 때).
   *
   * 끄면 구도 그림·배경 플레이트를 레퍼런스로 안 올리고, 프롬프트에서 «@배치도를 그대로 맞추세요» 문장도 빠집니다 —
   * 인물 시트와 글만으로 뽑습니다. 씬마다 «작업 방식» 을 고르게 하던 것을 이 스위치가 대신합니다.
   */
  useComposition?: boolean;
  /**
   * 영상 프롬프트에서 **구도잡기 레퍼런스 영상을 쓸 것인가.** 안 적었으면 씁니다(영상이 있을 때).
   *
   * 끄면 카메라 움직임을 글로 적습니다(`buildCutVideoPrompt` 의 `hasRefVideo`) — 레퍼런스 영상과 글이 겹치면
   * 두 지시가 싸워 오히려 어긋나서, 둘 중 하나만 씁니다.
   */
  useRefVideo?: boolean;
  /**
   * 인물마다 **레퍼런스로 올릴 그림**(파일 경로). 비면 시트 한 장을 자동으로 고릅니다.
   *
   * 한 인물에 전신·클로즈업을 같이 올리는 일이 잦아 **여러 장**입니다.
   */
  characterRefs?: Record<string, string[]>;
  /**
   * **영상용** 프롬프트. 컷 프롬프트(그림용)와 따로 둡니다.
   *
   * 글이 다릅니다 — 그림은 «한순간» 을 적고, 영상은 «무엇이 어떻게 움직이는가» 를
   * 적습니다. 한 칸에 섞으면 그림을 뽑을 때 동작 설명이 섞여 들어가 흐릿해집니다.
   */
  videoPromptKo?: string;
  videoPromptEn?: string;
  /**
   * **대사 · 연기 지시**. 영상 프롬프트에 그대로 실립니다.
   *
   * 구도잡기는 «어디서 어떻게 움직이는가» 만 압니다 — 무슨 말을 하고 어떤 표정인지는 여기 적습니다.
   */
  acting?: string;
  /**
   * 같은 연기 지시의 **영어**. 「프롬프트 말로」 단추가 만들어 둡니다.
   *
   * 번역기를 «누르면 한국어 칸만 고쳐 주는 것» 으로 두면, 정작 생성기에 가는 영문에는
   * 여전히 한국어가 실립니다 — 고생해서 다듬은 말이 무시되는 것입니다. 그래서 영어판을
   * **받아서 들고 있다가** 영문 프롬프트에 그대로 씁니다. 한 번 눌러 두면 계속 쓰입니다.
   */
  actingEn?: string;
  images: GeneratedImageAsset[];
  videos: SceneVideoAsset[];
  /**
   * 연출 토글. 스타일·촬영·색감에서 고른 것들이 한 배열에 들어갑니다.
   *
   * 샷 크기·앵글·무빙은 여기 **없습니다.** 구도잡기가 재기 때문에
   * 두 곳에 두면 반드시 어긋납니다.
   */
  styleTags?: string[];
  /**
   * **배경이 원래 하고 있는 움직임** — 흐르는 구름, 지나가는 차, 물결, 빗줄기,
   * 바람에 흔들리는 나뭇가지.
   *
   * # 왜 `vfx` 와 칸을 나눴는가
   *
   * `vfx` 는 «없던 것을 더하는 효과» 입니다(폭발·연기·불꽃). 이쪽은 **그 장소가 가만히
   * 있어도 하고 있는 움직임** 입니다. 한 칸에 섞으면 프롬프트에서 둘이 한 줄이 되고,
   * 대개 글이 긴 쪽이 짧은 쪽을 먹습니다 — 「폭발」 한 낱말이 「창밖 풍경이 흐른다」 를
   * 지웁니다.
   *
   * # 왜 아예 필요한가
   *
   * 구도잡기가 뽑는 레퍼런스 영상은 배경이 **정지 그림**입니다(면 텍스처·돔 파노라마).
   * 영상 모델은 프레임 내내 안 변하는 구역을 「여기는 원래 안 움직인다」 로 읽습니다.
   * 그래서 밤 고속도로를 달리는 차 안 컷인데 창밖 풍경이 통째로 얼어붙습니다. 그림으로는
   * 전할 길이 없으므로 **글로 못 박아야** 풀립니다.
   *
   * 옛 저장본에는 없는 칸입니다 — `undefined` 면 프롬프트에 아무 줄도 안 실립니다.
   */
  backgroundMotion?: string;
  /** 같은 배경 움직임 서술의 **영어**. `actingEn` 과 같은 까닭입니다. */
  backgroundMotionEn?: string;
  /**
   * VFX 서술.
   *
   * 영상으로 뽑을 때 필요합니다. 비·불꽃·연기처럼 그림만으로는 안 되는 것들.
   * 스토리보드에도 이 값이 실립니다.
   *
   * 환경이 스스로 하는 움직임은 `backgroundMotion` 입니다 — 위의 주석 참고.
   */
  vfx?: string;
  /** 같은 효과 서술의 **영어**. `actingEn` 과 같은 까닭입니다. */
  vfxEn?: string;
  /**
   * 이 컷의 프롬프트를 만들 때 함께 실을 기법 가이드 id.
   *
   * 연기 지시·카메라 무빙·VFX 같은 것들입니다. 전부 싣지 않는 이유는
   * 요청문이 길어질수록 토큰이 늘고 정작 중요한 지시가 묻히기 때문입니다.
   * 대사 없는 풍경 컷에 연기 지시를 실을 이유가 없습니다. (지시 131)
   */
  techniques?: string[];
}

export interface Scene {
  id: string;
  title: string;
  summary: string;
  cuts: Cut[];
  /**
   * 이 장면의 **스토리보드 시트**(6000×6000)와 그것으로 지은 영상 프롬프트.
   *
   * 컷의 대표 그림을 모아 굽습니다(`lib/storyboardSheet.ts`). 컷 그림이 바뀌면 다시
   * 구워야 하므로 «언제 구웠는지»(`storyboardAt`)를 같이 들고, 그 뒤에 바뀐 컷이 있으면
   * 화면에서 다시 굽자고 알립니다.
   */
  storyboardPath?: string;
  storyboardThumb?: string;
  storyboardAt?: string;
  storyboardPromptKo?: string;
  storyboardPromptEn?: string;
  /**
   * 이 장면의 영상. 컷 영상이 아니라 **장면 하나를 통째로** 뽑은 것입니다.
   */
  videos?: SceneVideoAsset[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 저장돼 있던 «돌고 있음» 표시를 전부 끄고, 빠진 칸을 기본값으로 채웁니다.
 *
 * analysisLoading·promptLoading 이 그대로 저장되면 다음에 열었을 때 카드가
 * 계속 돕니다. 요청은 앱을 껐다 켜면 어차피 죽은 것이라, 열 때 끄는 것이 맞습니다.
 *
 * **이것은 «읽는 자리의 즉석 보정» 입니다.** 저장본의 판 매기기(`lib/projectMigrate.ts`)가
 * 생겼으니 언젠가는 그쪽 걸음으로 옮겨 가야 합니다 — 지금 옮기면 회귀가 나서, 저 파일의
 * «아직 옮기지 않은 보정 목록» 에 적어만 두었습니다.
 */
export function settleLoading(draft: ProjectDraft): ProjectDraft {
  type Loadable = {
    analysisLoading?: boolean;
    promptLoading?: boolean;
    variations?: unknown[];
  };
  const calm = <E>(entity: E): E => {
    const bag = entity as Loadable;
    return {
      ...entity,
      analysisLoading: false,
      promptLoading: false,
      ...(bag.variations
        ? { variations: bag.variations.map((item) => calm(item)) }
        : {}),
    };
  };
  // 보유 에셋(assets)이 없는 옛 프로젝트 파일을 열면 `assets.length` 에서 터졌습니다(검토 2026-09-08).
  // 여는 순간 빈 배열로 채우고, 에셋 안의 로딩 표시도 같이 끕니다.
  // 다른 원본(alternates)도 같은 이유로 빈 배열을 보장합니다 — 안의 원본은 인물 모양 그대로라
  // 그 안의 assets 도 빈 배열로 채워야 같은 카드 코드가 터지지 않습니다(한 단계만이라 재귀는 여기서 끝).
  const withAssets = <E extends { assets?: unknown[]; alternates?: unknown[] }>(
    entity: E,
  ): E => ({
    ...entity,
    assets: (entity.assets ?? []).map((asset) => calm(asset)),
    alternates: (entity.alternates ?? []).map((alternate) => {
      const calmed = calm(alternate) as { assets?: unknown[] };
      return {
        ...calmed,
        assets: (calmed.assets ?? []).map((asset) => calm(asset)),
      };
    }),
  });
  /*
    **빠진 칸은 기본값으로 채웁니다.**

    폴더가 원본이라(CLAUDE.md) 프로젝트 파일은 옛 판일 수도, 손으로 만든 것일 수도 있습니다. 그런 파일에는
    `refImages` 같은 배열이 통째로 없을 수 있는데, 화면은 그 배열을 그냥 훑습니다 — 2026-09-17 에 실제로
    캐릭터 탭 전체가 «Cannot read properties of undefined (reading 'filter')» 로 안 열렸습니다.
    카드 하나가 덜 채워졌다고 탭이 통째로 죽으면 안 되므로, **열 때 한 번** 기본값 위에 얹습니다.
    저장된 값이 늘 이깁니다 — 여기서 채우는 것은 «없는 칸» 뿐입니다.
  */
  const filled = <E extends object>(made: E, saved: unknown): E => ({
    ...made,
    ...(saved as E),
  });
  return {
    ...draft,
    characters: (draft.characters || []).map((item) =>
      withAssets(calm(filled(newCharacter(), item))),
    ),
    backgrounds: (draft.backgrounds || []).map((item) =>
      withAssets(calm(filled(newBackground((item as Background).spaceKind), item))),
    ),
    sharedAssets: (draft.sharedAssets || []).map((item) =>
      calm(filled(newVisualAsset(), item)),
    ),
    progress: migrateProgress(draft.progress),
  };
}

/**
 * 진행 표시를 **네 단계**로 옮깁니다.
 *
 * 그래서 단계가 «주제 · 캐릭터 · 배경 · 씬 · 확인» 다섯에서
 * «주제 · 캐릭터 · 씬(장소 포함) · 확인» 넷이 됐습니다.
 *
 * 옛 저장본의 진행 표시는 옛 번호(3=배경, 4=씬, 5=확인)라 그대로 두면 씬을 지나갔는데 확인이 칠해집니다.
 * 3·4 는 새 3(씬)으로, 5 는 새 4(확인)로 옮깁니다. 이미 네 단계로 저장된 것은 그대로 둡니다(5가 없으면 옮길 것도 없습니다).
 */
export function migrateProgress(progress?: StepProgress): StepProgress | undefined {
  if (!progress || !progress["5"]) return progress;
  const moved: StepProgress = { "1": Boolean(progress["1"]), "2": Boolean(progress["2"]) };
  if (progress["3"] || progress["4"]) moved["3"] = true;
  if (progress["5"]) moved["4"] = true;
  return moved;
}

/**
 * 단계마다 「다음을 눌러 지나갔는가」.
 *
 * 내용이 있는지(stepFilled)와 **다른 것**입니다. 캐릭터를 하나도 안 만들고
 * 「다음」 을 눌러 배경으로 갔다면, 캐릭터는 비었지만 «지나간» 단계입니다.
 * 그래야 프로그래스 바가 「건너뛰었다」 를 그릴 수 있습니다.
 *
 * 지금 작업 중인 단계는 **반만 칠합니다** — 「다음」 을 누른 단계는 지나간 것으로,
 * 지금 붙들고 있는 단계는 작업 중이니 절반만 칠합니다.
 */
export interface StepProgress {
  [step: string]: boolean;
}

/**
 * 프로젝트 하나.
 *
 * `ProjectContext` 를 그대로 물려받습니다. 그래야 `summarizeProjectContext(draft)`
 * 를 바로 부를 수 있습니다. 장르·스타일·시대를 두 곳에 따로 두었다가 한쪽만
 * 고쳐서 프롬프트에 옛 값이 나가는 일이 없어야 합니다.
 */
/**
 * 마그니픽 후보함에서 처리한 파일 하나의 기록.
 *
 * 동기화 폴더의 파일은 지워도 마그니픽이 다시 내려받으므로 파일을 건드리지 않고
 * «채택했다 / 숨겼다» 만 여기에 적어 후보 목록에서 뺍니다.
 */
export interface MagnificHandled {
  status: "adopted" | "hidden";
  at: number;
  /** 왜 숨겼나. «sent-back» 은 우리가 보낸 그림이 되돌아온 것 — 사람이 숨긴 게 아닙니다. */
  reason?: "sent-back";
  /** 채택한 자리 (listMagnificTargets 의 key) */
  target?: string;
}

export interface ProjectDraft extends ProjectContext {
  title: string;
  logline?: string;
  /**
   * 줄거리. 한 줄 줄거리(logline)보다 긴 글입니다.
   *
   * 「AI 로 일괄 생성」 이 시나리오를 읽고 이 칸을 채웁니다. logline 하나에
   * 몰아넣으면 목록 화면의 한 줄 자리에 문단이 들어가 카드가 무너집니다.
   */
  synopsis?: string;
  /** 톤·분위기. 자유 문장입니다. */
  tone?: string;
  /** 분량. 「3분 단편」 처럼 적습니다. */
  runtime?: string;
  /**
   * 스토리보드 요청문으로 받아 온 글.
   *
   * 받을 곳이 없으면 요청문을 만들어 줘도 답을 앱에 되돌릴 수 없습니다.
   * 컷 카드가 아니라 여기 두는 이유는, 스토리보드가 컷 하나가 아니라
   * **컷 전체의 흐름**을 적은 것이기 때문입니다.
   */
  storyboardNote?: string;
  /**
   * genre / style 은 genres / styles 를 이어 붙인 값입니다.
   *
   * 목록 화면과 저장 파일이 예전부터 문자열 하나를 읽고 있어서 같이 들고
   * 갑니다. 고르는 건 항상 배열 쪽이고, 이 둘은 거기서 따라 만들어집니다.
   */
  genre: string;
  style: string;
  characters: Character[];
  backgrounds: Background[];
  scenes: Scene[];
  /**
   * 공용 에셋.
   *
   * 여러 캐릭터·배경이 함께 쓰는 소품입니다. 같은 가방을 인물마다 다시
   * 만들면 조금씩 달라지고, 결국 한 작품 안에 같은 물건이 여러 개가 됩니다.
   */
  sharedAssets?: VisualAsset[];
  /**
   * **작품 대표 그림** — 프로젝트 보드 카드에 뜨는 한 장(`<프로젝트>/cover/…`).
   *
   * 안 정했으면 보드가 **작품 안의 대표 그림 한 장을 알아서 찾아 씁니다**(`coverOf`) —
   * 인물·장소를 하나라도 뽑아 두었으면 카드가 비지 않습니다. 여기 값이 있으면 그것이 먼저입니다.
   */
  coverPath?: string;
  /**
   * **방 라이브러리** — 구도잡기에서 저장해 둔 방(치수·여섯 면·소품·묶음).
   *
   * 컷이 아니라 **프로젝트**가 들고 있어야 다른 씬의
   * 다른 컷에서 꺼내 씁니다(`lib/roomPreset.ts`).
   */
  roomPresets?: RoomPreset[];
  /**
   * 파일 경로 → 그 그림에 그려 둔 표시.
   *
   * 배경 카드가 아니라 **그림이** 표시를 들고 있습니다. 그래야 앵커를
   * 옮겨 다른 공간을 만들 때 원본이 깨끗하게 남습니다.
   */
  imageMarks?: Record<string, ImageMark[]>;
  progress?: StepProgress;
  /** 마그니픽 후보함 처리 기록. 키는 후보함 기준 상대 경로. */
  magnificHandled?: Record<string, MagnificHandled>;
  /**
   * 시트 배치도 — **프로젝트 공용.**
   *
   * 인물마다 배치도를 들고 있으면(옛 `Character.sheetLayouts`) 같은 칸 구성을
   * 인물 수만큼 다시 잡아야 했습니다. 그림은 인물 쪽 `sheetFills` 에 있습니다.
   */
  sheetLayouts?: SheetLayout[];
  /**
   * 「한 번에 뽑기」 가 쓸 **생성기** — 이미지와 영상 따로.
   *
   * 프로젝트에 담는 까닭은 작품마다 답이 다르기 때문입니다 — 실사는 마그니픽, 애니는
   * 로컬 로라. 앱 설정에 두면 프로젝트를 옮길 때마다 다시 골라야 하고, 한 번 잘못
   * 고른 채로 옆 작품을 통째로 뽑게 됩니다.
   *
   * 값은 `"magnific"` 이거나 로컬 엔진 id 입니다.
   */
  batchEngines?: { image?: string; video?: string };
  /**
   * 마그니픽 **MCP** 로 뽑을 때의 모델과 해상도 — 이미지·영상 따로.
   *
   * 생성기 고르기와 같은 자리(프로젝트)에 둡니다 — 작품마다 답이 다르고, 앱 설정에
   * 두면 옆 작품을 잘못된 모델로 통째로 뽑게 됩니다. 비워 두면 마그니픽이 알아서
   * 고릅니다(`mode: auto`).
   */
  /**
   * **화면 비율** — 이미지와 영상 따로.
   *
   * 여태 `16:9` 로 못 박혀 있었습니다. 숏츠를 만들려면 `9:16` 이라야 하고, 그건 작품의
   * 성격이라 **작품마다** 정합니다 — 세로 작품과 가로 작품이 한 설정을 나눠 쓸 수 없습니다.
   *
   * 마그니픽·로컬 양쪽이 같은 값을 씁니다. 마그니픽은 이 글자를 그대로 넘기고, 로컬은
   * 이 비율로 가로·세로 픽셀을 셉니다(`localSize`).
   */
  aspect?: { image?: string; video?: string };
  /**
   * 「한 번에 뽑기」 가 **로컬 엔진에 먹일 로라** — 엔진마다 고른 파일 경로들.
   *
   * 작품마다 답이 다릅니다 — 애니 작품과 실사 작품이 같은 로라를 쓸 리 없고,
   * 앱 설정 하나로 묶어 두면 옆 작품을 엉뚱한 화풍으로 통째로 뽑게 됩니다.
   *
   * 비워 두면 설정에서 «기본으로 켜 둔» 것들이 들어갑니다.
   */
  localLoras?: Record<string, string[]>;
  magnific?: {
    imageModel?: string;
    imageResolution?: string;
    imageQuality?: string;
    videoModel?: string;
    videoResolution?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 새로 만들기
// ─────────────────────────────────────────────────────────────────────────────

export function newCharacter(): Character {
  return {
    id: uid(),
    name: "",
    role: "",
    gender: "",
    heightCm: 170,
    build: "average",
    kind: "human",
    description: "",
    refType: "none",
    thumb: null,
    thumbFile: null,
    refImages: [],
    references: [],
    promptModel: "nbpro",
    promptKo: "",
    promptEn: "",
    negativeKo: "",
    negativeEn: "",
    variations: [],
    generatedImages: [],
    assets: [],
    alternates: [],
    promptHistory: [],
    analysisHistory: [],
    /**
     * 첫 시트에 켜 둘 다섯 칸.
     *
     * 칸이 적을수록 칸마다 커집니다. 열두 개로 나누면 전신이 300px 아래로
     * 떨어지고 그 안의 얼굴은 100px 이 안 됩니다. 그 얼굴을 다음 시트의
     * 기준으로 넘기면 모델이 없는 디테일을 지어냅니다.
     */
    blueprint: [...INITIAL_CHARACTER_BLUEPRINT],
  };
}

export function newBackground(spaceKind: SpaceKind = "exterior"): Background {
  return {
    id: uid(),
    name: "",
    location: "",
    description: "",
    spaceKind,
    thumb: null,
    thumbFile: null,
    refImages: [],
    references: [],
    promptModel: "nbpro",
    promptKo: "",
    promptEn: "",
    negativeKo: "",
    negativeEn: "",
    variations: [],
    generatedImages: [],
    assets: [],
    alternates: [],
    promptHistory: [],
    analysisHistory: [],
    // 1차 마스터 한 장 + 방향 표시면 시작하기 충분합니다.
    blueprint: [...INITIAL_BACKGROUND_BLUEPRINT_BY_SPACE[spaceKind]],
  };
}

export function newCut(order: number): Cut {
  return {
    id: uid(),
    order,
    title: "",
    description: "",
    characterIds: [],
    images: [],
    videos: [],
  };
}

export function newScene(): Scene {
  return { id: uid(), title: "", summary: "", cuts: [newCut(1)] };
}

export function newProjectDraft(): ProjectDraft {
  return {
    title: "",
    genre: "",
    style: "",
    genres: [],
    styles: [],
    eras: [],
    eraRanges: [],
    eraUnspecified: false,
    characters: [],
    backgrounds: [],
    scenes: [],
    sharedAssets: [],
    imageMarks: {},
  };
}
