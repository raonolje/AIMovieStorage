import { composeSheet } from "@/lib/sheetCompose";
import { cutVideoSeconds, heroImageOf } from "@/lib/cutVideoPrompt";
import { describeCameraMoves } from "@/lib/cameraMoves";
import { cameraMovesOf } from "@/lib/compositionEdit";
import { describeMarksForLlm, type DrawableMark } from "@/lib/imageMarkDraw";
import { splitLinkTail } from "@/lib/promptLinks";
import type {
  Cut,
  GeneratedImageAsset,
  Scene,
  SheetPlacement,
  SheetSize,
} from "@/lib/projectTypes";

/**
 * 씬 **스토리보드 시트** — 컷 대표 그림을 한 장에 늘어놓습니다.
 *
 * # 크기는 **내용이 정합니다**
 *
 * 맞습니다. 칸이 하나뿐인 씬도 6000×6000 을 굽고 있었습니다 — 한 칸이 5,700px 까지
 * 늘어나 원본보다 커지고(없는 해상도를 만들어 낸 것), 올릴 때 토큰만 먹었습니다.
 *
 * 그래서 **칸 하나는 늘 1500×844(16:9)** 이고, 한 줄에 넷까지 놓습니다.
 * 시트 크기는 칸 수에서 나옵니다 — 1컷이면 1,780×1,270, 8컷이면 6,340×2,450쯤.
 *
 * # 글자는 시트 크기를 따라가지 않습니다
 *
 * 칸 너비가 늘 1500 이므로 글자도 늘 같은 크기입니다(칸 이름 46 · 컷 정보 40).
 * 예전에는 «긴 변 ÷ 6000» 으로 줄여, 작은 시트에서는 글이 읽히지 않았습니다.
 *
 * # 굽는 일은 캐릭터 시트와 **같은 함수**를 씁니다
 *
 * `composeSheet` 하나가 캐릭터 시트·스토리보드를 다 굽습니다. 여기서 캔버스를 따로
 * 그리면 «cover 로 자르기»·«asset:// 오염» 같은 규칙을 두 번 고치게 됩니다(공통 규칙 1).
 * 이 파일은 **칸 자리를 계산하는 일**만 합니다.
 */

/** 칸의 **긴 변**. 원본보다 키우지 않는 선입니다. */
export const CELL_LONG = 1500;
/** 한 줄에 몇 칸까지. 다섯 칸이 넘으면 가로가 너무 길어져 생성기가 칸을 못 셉니다. */
export const MAX_COLUMNS = 4;

/**
 * **칸은 작품 비율을 따릅니다.**
 *
 * 2026-09-18 점검에서 잡힌 것입니다. 칸이 16:9 로 못 박혀 있어서, 숏츠 작품(9:16)의
 * 세로 컷을 구우면 위아래가 잘린 가로 띠가 되었습니다 — 원본 컷 파일은 멀쩡한데
 * 시트만 잘린 것이라 눈치채기도 어려웠습니다. 긴 변을 1500 으로 두고 짧은 변을
 * 비율에서 냅니다.
 */
export function cellSize(aspect = "16:9"): SheetSize {
  const [w, h] = aspect.split(":").map((part) => Number(part.trim()));
  const ratio = w > 0 && h > 0 ? w / h : 16 / 9;
  return ratio >= 1
    ? { width: CELL_LONG, height: Math.round(CELL_LONG / ratio) }
    : { width: Math.round(CELL_LONG * ratio), height: CELL_LONG };
}

/** 칸 수에서 시트 크기를 냅니다. 굽기 전에 크기를 보여 주려고 따로 뺐습니다. */
export function storyboardSize(
  count: number,
  noteRoom = NOTE_ROOM,
  aspect = "16:9",
): SheetSize {
  const cell = cellSize(aspect);
  if (count <= 0) return cell;
  const columns = Math.min(MAX_COLUMNS, count);
  const rows = Math.ceil(count / columns);
  return {
    width: MARGIN * 2 + columns * cell.width + GAP * (columns - 1),
    height:
      MARGIN * 2 +
      rows * (CAPTION_ROOM + cell.height + noteRoom) +
      GAP * (rows - 1),
  };
}

/** 이 칸들의 표가 차지할 높이 — 시트 크기를 낼 때와 자리를 잡을 때가 같아야 합니다. */
export function storyboardNoteRoom(cells: StoryboardCell[], aspect = "16:9"): number {
  if (!cells.length) return NOTE_ROOM;
  const width = cellSize(aspect).width;
  return Math.max(NOTE_ROOM, ...cells.map((cell) => noteRoomOf(cutNotes(cell), width)));
}


/**
 * 영상 생성기가 한 번에 받는 최대 길이(초).
 *
 * 씬이 길면 컷 길이의 합이 이보다 큽니다. 그때는 여기서 자르고 **자랐다는 사실을
 * 사람에게 알립니다** — 말없이 10초로 넣으면 「왜 뒤가 잘렸지」 가 됩니다.
 */
export const MAX_GENERATOR_SECONDS = 10;

/** 칸 사이 여백·바깥 여백·칸 이름이 앉을 자리. **칸 1500 기준의 실제 px** 입니다. */
const MARGIN = 80;
const GAP = 60;
const CAPTION_ROOM = 70;
/** 칸 이름과 컷 정보의 글자 크기 — 칸 너비가 늘 1500 이라 이 값도 고정입니다. */
const CAPTION_FONT = 46;
const NOTE_FONT = 40;
/**
 * 칸 **아래** 컷 정보(길이·카메라·대사·연기)가 앉을 자리. 6000 기준 px.
 *
 * 칸 이름(위)과 컷 정보(아래)가 따로인 까닭 — 이름은 «이어 붙일 순서» 를 생성기에 알리는 표시이고, 정보는 **사람이 읽는 글**입니다.
 */
const NOTE_ROOM = 230;

export interface StoryboardCell {
  cut: Cut;
  image: GeneratedImageAsset;
  /** 이 칸의 그림에 그려 둔 표시(동선·구역·자리). 칸 위에 덧그리고, 글로도 프롬프트에 싣습니다. */
  marks?: StoryboardMark[];
}

/**
 * 스토리보드에 실리는 표시 하나 — `ImageMark` 를 그대로 받되 **글(note)만 더 봅니다**.
 *
 * `ImageMark` 는 화면 쪽(`ImageMarkupEditor`)의 타입이라 lib 에서 import 하면 화면이 lib 를 끌고 들어옵니다.
 * 필요한 것은 «모양·점·글» 세 가지뿐이라 꼴로만 받습니다.
 */
export type StoryboardMark = DrawableMark & { note?: string };

/** 그림 파일 경로 → 그 그림에 그려 둔 표시(`ProjectDraft.imageMarks`). */
export type StoryboardMarks = Record<string, StoryboardMark[] | undefined>;

/**
 * 이 씬에서 **시트에 실을 수 있는 컷**. 대표 그림이 있는 컷만입니다.
 *
 * 표시는 **그림 파일 경로**로 찾습니다 — 표시는 컷이 아니라 그림에 붙어 있어서, 대표를 다른 그림으로 바꾸면
 * 그 그림의 표시가 따라옵니다(`ProjectMedia.imageMarks` 의 규칙과 같습니다).
 */
export function storyboardCells(
  scene: Scene,
  imageMarks?: StoryboardMarks,
): StoryboardCell[] {
  return scene.cuts
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((cut) => {
      const image = heroImageOf(cut) ?? guideAsCell(cut);
      if (!image) return [];
      const marks = image.filePath ? imageMarks?.[image.filePath] : undefined;
      return [{ cut, image, ...(marks?.length ? { marks } : {}) }];
    });
}

/**
 * 키 이미지가 아직 없는 컷은 **구도 그림**으로 칸을 채웁니다.
 *
 * 여태는 그림 없는 컷을 **통째로 건너뛰었습니다.** 그러면 스토리보드에 컷 번호가 1·3·7 로
 * 뜀뜀이 나오고, 장면 전체를 멀티샷 프롬프트로 쓸 때 빠진 컷이 그냥 없는 일이 됩니다.
 * 마네킹 구도라도 들어가 있으면 «여기에 이런 컷이 있다» 가 남습니다.
 *
 * 가짜 자산을 만드는 까닭: 시트를 굽는 쪽(`composeSheet`)은 그림을 `GeneratedImageAsset`
 * 으로만 받습니다. 구도 그림은 컷에 파일 경로로 붙어 있어(`guideImagePath`) 그 꼴로 감쌉니다.
 */
function guideAsCell(cut: Cut): GeneratedImageAsset | null {
  /*
    파일 경로가 없어도 **data URL 이면 그립니다.** 시트를 굽는 쪽은
    `assetSrc(filePath) || thumb` 순서로 읽으므로(`sheetCompose`), 방금 찍어 아직 폴더에
    안 내려간 구도도 `thumb` 에 얹으면 그대로 들어갑니다.

    경로만 보던 탓에, 화면에는 구도가 보이는데 «스토리보드 만들기» 는 꺼져 있었습니다.
  */
  const path = cut.guideImagePath;
  const thumb = cut.guideImage;
  if (!path && !thumb) return null;
  return {
    id: `guide-${cut.id}`,
    name: `컷 ${cut.order} 구도`,
    thumb: thumb || "",
    file: null,
    ...(path ? { filePath: path } : {}),
  };
}

/**
 * 칸 자리를 계산합니다 — 왼쪽 위부터 오른쪽으로, 그다음 줄.
 *
 * 읽는 순서가 곧 **컷 순서**입니다. 생성기에게 「왼쪽 위부터 오른쪽으로 이어 붙여」
 * 라고 말할 수 있어야 해서, 줄 수를 먼저 정하고 남는 칸은 비워 둡니다(가운데 정렬로
 * 마지막 줄을 모으면 «어느 것이 다음 컷인지» 가 흐려집니다).
 */
export function storyboardPlacements(
  cells: StoryboardCell[],
  aspect = "16:9",
): SheetPlacement[] {
  if (!cells.length) return [];
  /*
    칸 크기는 **고정**입니다. 예전에는 시트(6000)에서 역산해 칸을 키웠는데, 칸이 하나뿐인
    씬에서 한 칸이 5,700px 까지 늘어나 원본보다 커졌습니다 — 없는 해상도를 만들어 낸 셈이고
    올릴 때 토큰만 먹었습니다. 이제 칸이 크기를 정하고 시트가 따라옵니다.
  */
  const cell = cellSize(aspect);
  const columns = Math.min(MAX_COLUMNS, cells.length);
  /*
    표 높이는 **칸마다 다릅니다**(대사가 긴 컷이 있으니). 줄이 어긋나지 않게 가장 높은
    것으로 모두를 맞춥니다 — 칸마다 다른 높이로 놓으면 «다음 줄이 어디서 시작하는지» 가
    흐려져, 생성기가 읽는 순서를 잃습니다.
  */
  const rows = cells.map((one) => cutNotes(one));
  const noteRoom = Math.max(NOTE_ROOM, ...rows.map((row) => noteRoomOf(row, cell.width)));
  const rowHeight = CAPTION_ROOM + cell.height + noteRoom;

  return cells.map((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: `storyboard-${item.cut.id}`,
      kind: "image" as const,
      imageId: item.image.id,
      x: MARGIN + column * (cell.width + GAP),
      // 칸 이름은 그림 **위**에 앉으므로 그 자리를 비우고 시작합니다.
      y: MARGIN + row * (rowHeight + GAP) + CAPTION_ROOM,
      width: cell.width,
      height: cell.height,
      fontSize: CAPTION_FONT,
      notesFont: NOTE_FONT,
      label: item.cut.title
        ? `컷 ${item.cut.order} · ${item.cut.title}`
        : `컷 ${item.cut.order}`,
      ...(item.marks?.length ? { marks: item.marks } : {}),
      noteRows: rows[index],
      notesRoom: noteRoom,
    };
  });
}

/**
 * 표시를 **말**로 — 「①왼쪽 아래 자리에서 오른쪽 위로 이동: 진이 문 쪽으로 걸어간다」.
 *
 * 그린 번호와 같은 번호를 적습니다. 번호가 어긋나면 생성기가 어느 선을 말하는지 알 수 없어
 * 표시가 그냥 그림 위의 낙서가 됩니다(`describeMarksForLlm` 이 번호·자리·방향을 한 벌로 냅니다).
 */
function describeMarks(marks?: StoryboardMark[]): { ko: string; en: string } {
  if (!marks?.length) return { ko: "", en: "" };
  // 한국어는 «왼쪽 아래» 순서가 자연스럽고, 둘 다 가운데면 «가운데» 한 번만 적습니다(«가운데 가운데» 가 되지 않게).
  const spotKo = (value: { x: number; y: number }) => {
    const across = value.x < 0.34 ? "왼쪽" : value.x > 0.66 ? "오른쪽" : "";
    const down = value.y < 0.34 ? "위" : value.y > 0.66 ? "아래" : "";
    return [across, down].filter(Boolean).join(" ") || "가운데";
  };
  const spotEn = (value: { x: number; y: number }) =>
    `${value.y < 0.34 ? "upper" : value.y > 0.66 ? "lower" : "middle"} ${value.x < 0.34 ? "left" : value.x > 0.66 ? "right" : "centre"}`;
  const shapeKo = { anchor: "자리", free: "동선", rect: "구역", ellipse: "구역" };
  const shapeEn = { anchor: "position", free: "motion path", rect: "area", ellipse: "area" };

  const lines = describeMarksForLlm(marks).map((mark) => ({
    ko: `${mark.number}) ${spotKo(mark.position)} ${shapeKo[mark.shape]}${mark.facingDegrees !== null ? ` · ${mark.facingDegrees}° 쪽` : ""}${mark.note ? `: ${mark.note}` : ""}`,
    en: `${mark.number}) ${spotEn(mark.position)} ${shapeEn[mark.shape]}${mark.facingDegrees !== null ? `, facing ${mark.facingDegrees}°` : ""}${mark.note ? `: ${mark.note}` : ""}`,
  }));
  return {
    ko: `[표시 ${lines.map((line) => line.ko).join(" / ")}]`,
    en: `[marks ${lines.map((line) => line.en).join(" / ")}]`,
  };
}

/**
 * 칸 아래 적을 **컷 정보** — 길이 · 카메라 · 대사·연기 · 표시.
 *
 * 스토리보드 한 장만 보고도 촬영 순서를 읽을 수 있어야 합니다. 프롬프트 전문을 그대로 옮기면 칸 밑이 글자로 가득 차므로
 * «무엇을 몇 초 동안, 카메라는 어떻게, 무슨 말을 하는가» 만 골라 적습니다.
 */
function cutNotes(cell: StoryboardCell): { label: string; value: string }[] {
  const { cut } = cell;
  // 줄바꿈은 표 안에서 알아서 접히므로 여기서는 한 줄로 폅니다.
  const flat = (text: string) => text.split(/\s+/).join(" ").trim();
  const seconds = cutVideoSeconds(cut.composition, cut.plannedSeconds);
  const moves = cut.composition ? cameraMovesOf(cut.composition) : [];
  const camera = describeCameraMoves(moves);
  return [
    { label: "길이", value: `${seconds.toFixed(1)}초` },
    { label: "카메라", value: camera?.ko || "고정" },
    { label: "내용", value: flat(cut.description || "") },
    { label: "대사·연기", value: flat(cut.acting || "") },
    { label: "효과", value: flat(cut.vfx || "") },
    {
      label: "표시",
      value: (cell.marks ?? [])
        .map((mark, index) => `${index + 1}) ${mark.note?.trim() || "동선"}`)
        .join(" / "),
    },
  ];
}

/**
 * 표가 차지할 높이를 **미리 잽니다**.
 *
 * 자리를 잡는 일은 캔버스 없이 하므로 글자 폭을 진짜로 잴 수가 없습니다. 한글은 글자 하나가
 * 글자 크기만큼, 로마자·숫자·공백은 그 절반쯤이라 보고 셉니다 — 넉넉히 잡아 잘리지 않게
 * 하는 것이 목적이고, 조금 남는 것은 눈에 띄지 않습니다.
 */
function noteRoomOf(
  rows: { label: string; value: string }[],
  // 칸 너비가 비율마다 다릅니다(세로 컷은 좁아서 같은 글이 더 여러 줄이 됩니다).
  cellWidth = CELL_LONG,
): number {
  const pad = Math.round(NOTE_FONT * 0.45);
  const labelWidth = Math.round(NOTE_FONT * 4.6);
  const valueWidth = cellWidth - labelWidth - pad * 2;
  const lineHeight = Math.round(NOTE_FONT * 1.35);
  let height = pad * 2;
  for (const row of rows) {
    const value = row.value.trim();
    if (!value) continue;
    /*
      한글은 글자 하나가 글자 크기만큼, 로마자·숫자·공백은 그 절반쯤 넓다고 봅니다.
      코드 포인트로 가릅니다 — 정규식에 제어문자 범위를 적으면 파일에 그 바이트가 박힙니다.
    */
    const wide = [...value].reduce(
      (total, char) => total + ((char.codePointAt(0) ?? 0) < 128 ? 0.55 : 1),
      0,
    );
    const lines = Math.max(1, Math.ceil((wide * NOTE_FONT) / valueWidth));
    height += lines * lineHeight + pad;
  }
  return height;
}

/** 씬 하나를 6000×6000 스토리보드 한 장으로 굽습니다. */
export async function composeStoryboard(
  scene: Scene,
  options?: {
    size?: SheetSize;
    captions?: boolean;
    imageMarks?: StoryboardMarks;
    /** 작품이 정한 그림 비율. 칸 모양이 여기서 나옵니다. */
    aspect?: string;
  },
): Promise<{ blob: Blob; cells: StoryboardCell[] }> {
  const cells = storyboardCells(scene, options?.imageMarks);
  if (!cells.length)
    throw new Error(
      "대표 그림이 있는 컷이 없습니다. 컷 그림을 먼저 뽑아 별을 달아 주세요.",
    );
  // 시트 크기는 **칸 수가 정합니다.** 부르는 쪽이 굳이 못 박으면 그것을 씁니다.
  const aspect = options?.aspect || "16:9";
  const size =
    options?.size ??
    storyboardSize(cells.length, storyboardNoteRoom(cells, aspect), aspect);
  const blob = await composeSheet({
    size,
    placements: storyboardPlacements(cells, aspect),
    images: cells.map((cell) => cell.image),
    basics: [],
    // 칸 이름(컷 번호)은 기본으로 굽습니다 — 생성기에게 이어 붙일 순서를 알려 주는 표시입니다.
    captions: options?.captions !== false,
  });
  return { blob, cells };
}

/**
 * 스토리보드 한 장을 **영상**으로 뽑는 프롬프트.
 *
 * 컷 영상 프롬프트와 다른 점: 여기서는 «칸을 순서대로 이어 붙여라» 가 본문입니다.
 * 칸마다의 연기·카메라는 컷 프롬프트가 이미 적어 두었으니 그대로 실어 나릅니다.
 */
/** 이 시트에 함께 올리는 것 하나 — 인물 시트·에셋 시트·배경. */
export interface StoryboardSwap {
  /** 「파란 사람」·「빨간 상자」 처럼 **칸에서 찾는 표시**. 없으면 이름으로만 부릅니다. */
  color?: string;
  /** 사람이 읽는 이름 — 「여울」·「제단」. */
  name: string;
  /** 올린 그림의 `@파일이름`. 마그니픽은 이것으로만 그림을 집습니다. */
  tag?: string;
  kind: "character" | "prop" | "background";
}

export function buildStoryboardVideoPrompt(input: {
  sceneTitle?: string;
  sceneSummary?: string;
  cells: StoryboardCell[];
  /**
   * 시트 자체의 `@파일이름`.
   *
   * 마그니픽은 올린 그림을 **파일 이름**으로 부릅니다 — 「첨부한」 이라고 적으면 어느 그림인지
   * 이어지지 않습니다(Seedance 의 @-레퍼런스도 같은 규칙, 그림 9·영상 3·소리 3까지).
   */
  sheetTag?: string;
  /** 이 장면에 함께 올리는 인물·소품·배경 시트들. */
  swaps?: StoryboardSwap[];
  /**
   * 영상 화면비(`"9:16"` …).
   *
   * 사용자 2026-09-18 점검에서 드러났습니다 — 씬 영상에는 화면비가 **아예 안 실리고**
   * 있었습니다. 공개 프롬프트 실측에서 가장 안 적으면서 없을 때 좋은 클립을 가장 자주
   * 망치는 항목입니다.
   */
  aspect?: string;
  /** 이 장면에 나오는 인물 이름 — 맨 뒤 «바꾸지 마세요» 문장에 박습니다. */
  lockNames?: string[];
  /** 연출·질감의 영어 한 줄(`cutTogglesEnglish` + `autoRealism`). */
  lookEn?: string;
}): { ko: string; en: string; seconds: number; clamped: boolean } {
  const { cells } = input;
  const raw = cells.reduce(
    (total, cell) =>
      total + cutVideoSeconds(cell.cut.composition, cell.cut.plannedSeconds),
    0,
  );
  const seconds = Math.min(
    MAX_GENERATOR_SECONDS,
    Math.max(1, Math.round(raw * 2) / 2),
  );

  const ko: string[] = [];
  const en: string[] = [];

  const title = input.sceneTitle?.trim();
  const summary = input.sceneSummary?.trim();
  const head = [title, summary].filter(Boolean).join(" — ");
  if (head) {
    ko.push(head);
    en.push(head);
  }

  /*
    러닝타임은 **문장에 적지 않습니다.** 길이는 생성기의 설정 칸이 정하고(`composeInMagnific` 이 초를 따로 넘깁니다), 프롬프트에
    적어 두면 설정과 어긋났을 때 어느 쪽이 맞는지 알 수 없어집니다. `seconds` 는 계속
    돌려주되 그것은 **설정 칸에 넣을 값**입니다.
  */
  const sheet = input.sheetTag?.trim();
  const board = sheet || "the storyboard sheet";
  ko.push(
    `${sheet ? `${sheet} 는` : "올린 스토리보드 시트는"} 이 장면의 컷 ${cells.length}개를 담은 배치도입니다. **왼쪽 위부터 오른쪽으로, 그다음 줄**이 컷 순서입니다. 그 순서 그대로 이어지는 한 편의 영상으로 만드세요.`,
  );
  en.push(
    `${board} is the layout sheet holding the ${cells.length} cuts of this scene. Reading order is left to right, then down - that is the cut order. Turn it into one continuous film that follows that order.`,
  );

  /*
    ── 무엇을 무엇으로 그릴까 ──────────────────────────────────────────
    

    시트의 칸은 **마네킹과 회색 상자**입니다. 그것이 누구이고 무엇인지 말해 주지 않으면
    생성기가 마네킹을 그대로 그립니다. 칸에서 찾는 길은 **색**이고(캡처에 이름표가 안 나갑니다),
    그릴 근거는 **@시트**입니다.
  */
  const swaps = input.swaps ?? [];
  const line = (item: StoryboardSwap) =>
    [item.color ? `${item.color}` : "", item.name, item.tag ? `(${item.tag})` : ""]
      .filter(Boolean)
      .join(" ");
  const people = swaps.filter((item) => item.kind === "character");
  const props = swaps.filter((item) => item.kind === "prop");
  const places = swaps.filter((item) => item.kind === "background");
  if (people.length) {
    ko.push(
      `인물: ${people.map(line).join(" · ")}. 칸의 마네킹은 **그 사람으로 바꿔 그립니다** — 얼굴·머리·옷은 괄호 안 시트 그대로이고, 자세와 자리만 칸을 따릅니다.`,
    );
    en.push(
      `Characters: ${people.map(line).join(" · ")}. Replace each mannequin in the panels with that person - face, hair and clothing exactly as in the referenced sheet; only the pose and position come from the panel.`,
    );
  }
  if (props.length) {
    ko.push(
      `소품: ${props.map(line).join(" · ")}. 칸의 회색 덩어리는 그것으로 바꿔 그립니다. 자리와 크기는 칸 그대로.`,
    );
    en.push(
      `Props: ${props.map(line).join(" · ")}. Replace the grey blocks in the panels with those objects, keeping the same position and size.`,
    );
  }
  if (places.length) {
    ko.push(
      `배경: ${places.map(line).join(" · ")}. 칸에 보이는 공간이 그곳입니다 — 새로 지어내지 말고 그 그림의 재질·빛을 따르세요.`,
    );
    en.push(
      `Background: ${places.map(line).join(" · ")}. The space seen in the panels is that place - do not invent a new one; follow the materials and light of the referenced image.`,
    );
  }

  /*
    컷 영상 프롬프트 칸에는 「영상 프롬프트」·「@ 다시 잇기」 가 단 꼬리 줄(«참고 그림: 구도 @…»·
    «아직 그림 없음: …»)이 붙어 있습니다. 그 @태그는 **컷 하나를 «구성» 으로 보낼 때** 올리는 그림의
    이름이라, 시트와 스왑 시트만 올리는 이 흐름에서는 칩이 안 서는 죽은 글자입니다 — 컷마다 한 줄씩
    들어가면 생성기가 그 글자를 그립니다(2026-09-21 점검). 본문만 씁니다. 가르는 규칙은 `splitLinkTail` 한 벌.
  */
  const bodyOf = (text: string | undefined) => splitLinkTail((text || "").trim()).body;
  cells.forEach((cell, index) => {
    const beat = bodyOf(cell.cut.videoPromptKo) || cell.cut.description?.trim();
    const beatEn = bodyOf(cell.cut.videoPromptEn) || cell.cut.description?.trim();
    const flat = (text: string) => text.split(/\s*\n+\s*/).join(" ");
    /*
      칸 위의 표시는 **글이 반**입니다. 화살표만 그려 두면 「무엇이 그쪽으로 가는가」 가 빠지고,
      글만 적으면 「화면의 어디에서」 가 빠집니다. 그려진 번호와 같은 번호로 짝을 지어 적습니다
      ().
    */
    const marks = describeMarks(cell.marks);
    /*
      **효과는 컷마다 다릅니다.**
      장면 전체에 한 번 적으면 비가 안 오는 컷에도 비가 옵니다 — 그 칸에 붙여 적습니다.
      대사·연기도 마찬가지로 그 칸의 것입니다.
    */
    const acting = cell.cut.acting?.trim();
    const vfx = cell.cut.vfx?.trim();
    /*
      **영문 칸에는 영어판을 씁니다**(「프롬프트 말로」 로 받아 둔 것). 없으면 한국어가
      그대로 가는데, 그러면 생성기가 그 부분을 통째로 무시하거나 글자로 그려 넣습니다.
    */
    const actingEn = cell.cut.actingEn?.trim() || acting;
    const vfxEn = cell.cut.vfxEn?.trim() || vfx;
    if (beat || marks.ko || acting || vfx)
      ko.push(
        [
          `컷 ${cell.cut.order}(${index + 1}번째 칸)`,
          beat ? `— ${flat(beat)}` : "",
          acting ? `대사·연기: ${flat(acting)}` : "",
          vfx ? `효과: ${flat(vfx)}` : "",
          marks.ko,
        ]
          .filter(Boolean)
          .join(" "),
      );
    if (beatEn || marks.en || acting || vfx)
      en.push(
        [
          `Cut ${cell.cut.order} (panel ${index + 1})`,
          beatEn ? `- ${flat(beatEn)}` : "",
          actingEn ? `Dialogue and acting: ${flat(actingEn)}` : "",
          vfxEn ? `Effects: ${flat(vfxEn)}` : "",
          marks.en,
        ]
          .filter(Boolean)
          .join(" "),
      );
  });

  // 표시를 구운 칸이 하나라도 있으면 «그 선은 지시지 그림이 아니다» 를 못 박습니다.
  const marked = cells.some((cell) => cell.marks?.length);
  if (marked) {
    ko.push(
      "칸 위의 색 선·타원·번호는 **움직임 지시**입니다. 무엇이 어디로 움직이고 카메라가 어떻게 도는지를 표시한 것이니, 그 움직임만 따르고 선·번호 자체는 화면에 그리지 마세요.",
    );
    en.push(
      "The coloured lines, ellipses and numbers drawn on the panels are motion directions - who or what moves where, and how the camera moves. Follow the motion, but never draw the lines or numbers themselves.",
    );
  }

  /*
    마지막은 **시트 자체가 화면에 나오는 사고**를 막습니다. 칸 이름(「컷 2」)을 구워
    두었기 때문에 더 단단히 못 박아야 합니다 — 생성기는 글자를 곧잘 따라 그립니다.
  */
  ko.push(
    "시트의 격자·흰 여백·칸 이름 글자는 결과에 나오면 안 됩니다. 각 칸은 그 순간의 화면일 뿐이고, 결과는 칸 하나를 꽉 채운 한 편의 영상입니다. 자막·로고도 넣지 마세요.",
  );
  en.push(
    "The sheet's grid, white margins and panel labels must not appear in the result. Each panel is only a frame of that moment; the output is one full-frame film, not a grid. No subtitles, no logo.",
  );

  // 연출·질감. 컷 영상과 같은 자리에 같은 말로 붙입니다.
  if (input.lookEn?.trim()) en.push(input.lookEn.trim());

  /*
    ── 형식과 잠금은 맨 뒤 ──────────────────────────────────────────────
    컷 영상(`cutVideoPrompt`)과 **같은 규칙**을 씁니다. 여기만 빠져 있었습니다.

    러닝타임을 문장에 안 적던 까닭()은
    **길이를 몰랐기 때문**입니다. 지금은 컷들을 더해 정확히 압니다. 화면비도 프로젝트가
    압니다. 아는 값을 빈칸으로 보낼 까닭이 없습니다.
  */
  if (input.aspect?.trim()) {
    ko.push(`화면비 ${input.aspect.trim()}. 가장자리까지 채웁니다.`);
    en.push(`${input.aspect.trim()} aspect ratio, filling the frame edge to edge.`);
  }

  const who = (input.lockNames ?? []).filter(Boolean);
  ko.push(
    `${who.length ? `${who.join("·")} 의 ` : ""}얼굴·머리·의상, 그리고 장소와 빛을 첨부한 시트 그대로 두세요. 끝까지 바뀌면 안 됩니다.`,
  );
  en.push(
    `Keep ${who.length ? `${who.join(" and ")}'s ` : "each character's "}face, hair and outfit, and the location and lighting, identical to the attached sheets from the first frame to the last.`,
  );

  return {
    ko: ko.join("\n\n"),
    en: en.join("\n\n"),
    seconds,
    clamped: raw > MAX_GENERATOR_SECONDS,
  };
}
