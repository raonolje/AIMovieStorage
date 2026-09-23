import type { CompositionCubeFace } from "@/lib/composition";
import type { FaceSetSize } from "@/lib/projectTypes";

/** 실외는 아래쪽을 UV로 덜어 내므로, 덜기 전 원본 칸의 비율과 비교해야 합니다. */
export function crossFaceTargetRatio(face: CompositionCubeFace, size?: FaceSetSize | null): number | null {
  if (!size || ![size.width, size.depth, size.height].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (face === "top" || face === "bottom") return size.width / size.depth;
  const retained = 1 - Math.min(0.95, Math.max(0, size.cropBottom ?? 0));
  return (face === "front" || face === "back" ? size.width : size.depth) / size.height * retained;
}

interface TrimInsets { left: number; right: number; top: number; bottom: number }

/** 테두리·이음매·혼합 픽셀 제거가 각자 한도를 더 쓰거나 방 비율을 더 망가뜨리지 않게 합니다. */
export function constrainCrossTrim(width: number, height: number, requested: TrimInsets, maxRatio = 0.15, targetRatio?: number | null): TrimInsets {
  const limit = Number.isFinite(maxRatio) ? Math.min(0.15, Math.max(0, maxRatio)) : 0.15;
  const cap = (n: number, size: number) => Math.max(0, Math.min(Math.floor(size * limit), Math.floor(n)));
  const out = { left: cap(requested.left, width), right: cap(requested.right, width), top: cap(requested.top, height), bottom: cap(requested.bottom, height) };
  if (!targetRatio || !Number.isFinite(targetRatio) || targetRatio <= 0) return out;
  const distortion = (ratio: number) => Math.max(ratio / targetRatio, targetRatio / ratio);
  // 픽셀 반올림 여유만 허용합니다. 이미 잘못 잡힌 칸을 테두리 제거로 더 좁혀서는 안 됩니다.
  const allowed = Math.max(1.01, distortion(width / height));
  const w = width - out.left - out.right;
  const h = height - out.top - out.bottom;
  const restore = (a: "left" | "top", b: "right" | "bottom", total: number) => {
    const before = out[a] + out[b];
    if (!before) return;
    out[a] = Math.floor(out[a] * Math.max(0, total) / before);
    out[b] = Math.max(0, total) - out[a];
  };
  if (w / h > targetRatio * allowed) restore("top", "bottom", height - Math.min(height, Math.ceil(w / (targetRatio * allowed))));
  else if (w / h < targetRatio / allowed) restore("left", "right", width - Math.min(width, Math.ceil(h * targetRatio / allowed)));
  return out;
}

/**
 * 십자 전개도 — 한 장에 여섯 면을 펼쳐 그린 그림에서 자르는 자리.
 *
 * → 됩니다. 한 장에 십자로 펼쳐 그리면
 * 여섯 면이 **한 번의 샘플 = 한 세계**라 서로 안 싸웁니다. 따로 여섯 번 뽑으면 확산 모델에는
 * 3차원이 없어서 같은 공간의 여섯 방향이 되리라는 보장이 없습니다(`panorama.ts` 머리말과 같은 이유).
 *
 * 판 배치는 이것 하나뿐입니다(가로 십자):
 *
 * ```
 * ┌───────┐
 * │ 천장 │
 * ┌───────┼───────┼───────┬───────┐
 * │ 왼쪽 │ 정면 │ 오른쪽│ 후면 │
 * └───────┼───────┼───────┴───────┘
 * │ 바닥 │
 * └───────┘
 * ```
 *
 * 왼→오 순서가 «오른쪽으로 도는 순서» 라 이음매가 전부 이어집니다. 앱의 면 규약
 * (`panorama.ts` 의 `FACE_VECTORS`)과도 같은 순서라 옆면 넷은 손댈 것이 없습니다.
 */
export interface CrossLines {
  /** 세로 자리 다섯(0~1): 왼쪽 끝 · 왼｜정면 · 정면｜오른쪽 · 오른쪽｜후면 · 오른쪽 끝 */
  x: [number, number, number, number, number];
  /** 가로 자리 넷(0~1): 천장 위 · 천장｜벽 · 벽｜바닥 · 바닥 아래 */
  y: [number, number, number, number];
}

/** 못 알아봤을 때의 기본 자리 — 4칸 × 3줄 균등(정육면체 방을 가정). */
export const DEFAULT_CROSS_LINES: CrossLines = {
  x: [0, 0.25, 0.5, 0.75, 1],
  y: [0, 1 / 3, 2 / 3, 1],
};

/** 면 하나가 차지하는 칸(0~1 비율). */
export interface CrossCell {
  face: CompositionCubeFace;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** 옆 판과 맞닿은 변. 여기서는 이음매 한 줄을 벗깁니다(`cutCrossCell`). */
  shared?: { left?: boolean; top?: boolean; right?: boolean; bottom?: boolean };
}

/** 자르는 자리에서 여섯 칸을 만듭니다. 천장·바닥은 정면 칸의 가로를 그대로 씁니다. */
export function crossCells(lines: CrossLines): CrossCell[] {
  const [x0, x1, x2, x3, x4] = lines.x;
  const [y0, y1, y2, y3] = lines.y;
  return [
    { face: "front", left: x1, top: y1, right: x2, bottom: y2, shared: { left: true, right: true, top: true, bottom: true } },
    { face: "back", left: x3, top: y1, right: x4, bottom: y2, shared: { left: true } },
    { face: "left", left: x0, top: y1, right: x1, bottom: y2, shared: { right: true } },
    { face: "right", left: x2, top: y1, right: x3, bottom: y2, shared: { left: true, right: true } },
    { face: "top", left: x1, top: y0, right: x2, bottom: y1, shared: { bottom: true } },
    { face: "bottom", left: x1, top: y2, right: x2, bottom: y3, shared: { top: true } },
  ];
}

/**
 * 천장·바닥은 **위아래를 뒤집어야** 앱의 면 규약과 맞습니다.
 *
 * 전개도에서 천장 칸은 정면 벽 **위에** 붙어 있으므로 «정면 쪽» 이 칸의 아래 끝입니다.
 * 그런데 `panorama.ts` 의 `FACE_VECTORS.top = [a, 1, b]` 는 **위 끝이 정면**(−Z)입니다.
 * 바닥도 마찬가지로 서로 반대입니다(`bottom = [a, -1, -b]`). 좌우는 양쪽 다 같아서
 * 180° 돌리는 것이 아니라 **위아래만** 뒤집습니다.
 *
 * 생성기가 반대로 그려 놓는 일도 있어서 화면에 끄는 스위치를 둡니다.
 */
export const FLIPPED_FACES: readonly CompositionCubeFace[] = ["top", "bottom"];

/**
 * 잘라낸 칸에서 **회색 여백을 깎아냅니다.**
 *
 * 생성기가 판 사이를 붙이지 않고 회색 틈을 남기는데, 자르는 선은 그
 * 틈 한가운데를 지나므로 칸마다 틈의 절반이 테두리로 딸려 옵니다. 상자에 붙이면 여섯 면
 * 가장자리에 회색 선이 그대로 보입니다.
 *
 * 가장자리부터 «거의 전부 바탕색인 줄» 을 벗깁니다. 하늘처럼 **진짜로 회색인 면**을 깎아
 * 먹지 않도록 두 가지를 겁니다 — 한 줄의 85% 이상이 바탕색이어야 하고, 한쪽에서 최대
 * `maxRatio`(기본 15%) 까지만 벗깁니다.
 *
 * 한도를 8% → 15% 로 올린 까닭(2026-09-15 MCP 실측): 틀 칸을 바탕과 거의 같은 회색(#929292)으로 바꾼 뒤로, 생성기가 벽을
 * 칸보다 좁게 그리면 남는 칸 색 띠가 한쪽에서 8.3% 였습니다(8×6×2.8 m 외벽 — 왼쪽 벽 588 px 중 49 px). 8% 에서 멈춰 방 모서리에
 * 회색 기둥이 섰습니다. 다만 회색 벽도 같은 조건에 걸릴 수 있어 총 제거량과 방 비율을 함께 제한합니다.
 */
export function trimBackgroundEdges(
  canvas: HTMLCanvasElement,
  background: readonly [number, number, number],
  maxRatio = 0.15,
  targetRatio?: number | null,
): HTMLCanvasElement {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width < 8 || canvas.height < 8) return canvas;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const isBg = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const dr = Math.abs(data[i] - background[0]);
    const dg = Math.abs(data[i + 1] - background[1]);
    const db = Math.abs(data[i + 2] - background[2]);
    if (dr <= 20 && dg <= 20 && db <= 20) return true;
    /*
      색이 없는 회색이면 30 까지 바탕으로 봅니다 — 틀 칸 색(#929292)이 남은 띠. 2026-09-15 실측: 생성기가 바탕을 125 로 칠해
      칸 색 146 과의 차이가 21 이 되어 한 줄도 안 벗겨졌습니다. 색이 조금이라도 있는 사진 줄은 여기 안 걸립니다.
    */
    const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    return chroma <= 8 && dr <= 30 && dg <= 30 && db <= 30;
  };
  /*
    한 줄의 85% 가 바탕이면 바탕 줄로 봅니다(예전 97%). 칸 색 띠의 가장 안쪽 줄은 옆 그림의 처마·빗물받이가 걸쳐 87% 쯤이라
    97% 에서 멈추면 5 px 띠가 남았습니다(2026-09-15 외벽 실측). 밤하늘·흐린 하늘은 바탕 회색 ±30 밖이라 여기 안 걸립니다.
  */
  const rowIsBg = (y: number) => {
    let hit = 0;
    for (let x = 0; x < width; x += 1) if (isBg(x, y)) hit += 1;
    return hit >= width * 0.85;
  };
  const colIsBg = (x: number) => {
    let hit = 0;
    for (let y = 0; y < height; y += 1) if (isBg(x, y)) hit += 1;
    return hit >= height * 0.85;
  };

  const boundedRatio = Number.isFinite(maxRatio) ? Math.min(0.15, Math.max(0, maxRatio)) : 0.15;
  const maxX = Math.floor(width * boundedRatio);
  const maxY = Math.floor(height * boundedRatio);
  /*
    가장자리에서 안으로 바탕 줄을 셉니다. **맨 바깥 세 줄까지는 바탕이 아니어도 건너뜁니다** — 칸 색 띠 바깥 끝에 옆 칸과의
    이음매(밝은 줄 한두 개)가 붙어 있으면 첫 줄에서 멈춰 띠 전체가 남았습니다(2026-09-15 외벽 실측: 맨 끝 줄 76%, 그 안쪽 45 px 는
    100%). 네 번째 줄부터는 바탕이 아니면 멈춥니다.
  */
  const peel = (limit: number, isLine: (k: number) => boolean) => {
    let cut = 0;
    for (let k = 0; k < limit; k += 1) {
      if (isLine(k)) cut = k + 1;
      else if (k >= 3) break;
    }
    return cut;
  };
  let left = peel(maxX, (k) => colIsBg(k));
  let right = width - 1 - peel(maxX, (k) => colIsBg(width - 1 - k));
  let top = peel(maxY, (k) => rowIsBg(k));
  let bottom = height - 1 - peel(maxY, (k) => rowIsBg(height - 1 - k));

  /*
    ── 바탕색과 다른 **이음매 줄**도 벗깁니다 ─────────────────────────────
     나노 바나나는 칸 사이에 바탕보다 밝은 회색이나 흰 줄을
    그어 두기도 해서(실외 전개도 결과), 위의 «바탕색 줄» 검사에 안 걸리고 면 가장자리에 남았습니다.
    가장자리 몇 줄 안에서 **색이 없고(무채색) 거의 한 색인 줄**을 이음매로 봅니다. 사진의 한 줄은 하늘이라도 밝기가 조금씩
    흔들리고, 밤하늘은 남색이라 무채색 검사에 안 걸립니다. 그래도 진짜 회색 안개를 깎을 수 있어 한쪽 최대 1.5 % 까지만.
  */
  const seamLine = (count: number, at: (k: number) => number) => {
    let sum = 0;
    let sumSq = 0;
    let chroma = 0;
    for (let k = 0; k < count; k += 1) {
      const i = at(k);
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += luma;
      sumSq += luma * luma;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
    }
    const mean = sum / count;
    const spread = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    return chroma / count <= 14 && spread <= 9 && mean >= 60;
  };
  const seamCol = (x: number) => seamLine(bottom - top + 1, (k) => ((top + k) * width + x) * 4);
  const seamRow = (y: number) => seamLine(right - left + 1, (k) => (y * width + left + k) * 4);
  const seamX = Math.max(1, Math.floor(width * 0.015));
  const seamY = Math.max(1, Math.floor(height * 0.015));
  for (let n = 0; n < seamX && left < right && seamCol(left); n += 1) left += 1;
  for (let n = 0; n < seamX && right > left && seamCol(right); n += 1) right -= 1;
  for (let n = 0; n < seamY && top < bottom && seamRow(top); n += 1) top += 1;
  for (let n = 0; n < seamY && bottom > top && seamRow(bottom); n += 1) bottom -= 1;

  /*
    이음매를 벗긴 뒤에도 **맨 바깥 한두 줄**이 남습니다 — 회색 줄과 그림이 반씩 섞인 안티앨리어싱 줄이라 «한 색» 검사에 안
    걸립니다(실측 2026-09-15 실외 전개도: 벽 모서리마다 밝기 126·188 인 줄 하나, 안쪽은 40~60). 3D 방 모서리에 가는 흰 선으로
    보입니다. 바깥 줄이 두 줄 안쪽보다 밝기가 크게 다르고 색은 더 옅으면(회색이 섞였다는 뜻) 한 줄 더, 최대 두 줄 벗깁니다.
  */
  const lineStat = (count: number, at: (k: number) => number) => {
    let luma = 0;
    let chroma = 0;
    for (let k = 0; k < count; k += 1) {
      const i = at(k);
      luma += (data[i] + data[i + 1] + data[i + 2]) / 3;
      chroma += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    }
    return { luma: luma / count, chroma: chroma / count };
  };
  const statCol = (x: number) => lineStat(bottom - top + 1, (k) => ((top + k) * width + x) * 4);
  const statRow = (y: number) => lineStat(right - left + 1, (k) => (y * width + left + k) * 4);
  const blended = (edge: { luma: number; chroma: number }, inner: { luma: number; chroma: number }) =>
    Math.abs(edge.luma - inner.luma) > 20 && edge.chroma <= inner.chroma + 2;
  for (let n = 0; n < 2 && right - left > 8 && blended(statCol(left), statCol(left + 2)); n += 1) left += 1;
  for (let n = 0; n < 2 && right - left > 8 && blended(statCol(right), statCol(right - 2)); n += 1) right -= 1;
  for (let n = 0; n < 2 && bottom - top > 8 && blended(statRow(top), statRow(top + 2)); n += 1) top += 1;
  for (let n = 0; n < 2 && bottom - top > 8 && blended(statRow(bottom), statRow(bottom - 2)); n += 1) bottom -= 1;
  const bounded = constrainCrossTrim(width, height, { left, right: width - 1 - right, top, bottom: height - 1 - bottom }, maxRatio, targetRatio);
  left = bounded.left;
  top = bounded.top;
  const cutWidth = width - bounded.left - bounded.right;
  const cutHeight = height - bounded.top - bounded.bottom;
  if (cutWidth === width && cutHeight === height) return canvas;
  if (cutWidth < 8 || cutHeight < 8) return canvas;

  const trimmed = document.createElement("canvas");
  trimmed.width = cutWidth;
  trimmed.height = cutHeight;
  trimmed
    .getContext("2d")
    ?.drawImage(
      canvas,
      left,
      top,
      cutWidth,
      cutHeight,
      0,
      0,
      cutWidth,
      cutHeight,
    );
  return trimmed;
}

/** 그림의 네 귀퉁이에서 읽은 바탕색. 전개도의 빈칸 색입니다. */
export function backgroundColorOf(
  image: HTMLImageElement | HTMLCanvasElement,
): [number, number, number] | null {
  const pixels = samplePixels(image, 64);
  if (!pixels) return null;
  const { data, width, height } = pixels;
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const corners = [
    at(1, 1),
    at(width - 2, 1),
    at(1, height - 2),
    at(width - 2, height - 2),
  ];
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[1];
  return [0, 1, 2].map((channel) =>
    median(corners.map((corner) => corner[channel])),
  ) as [number, number, number];
}

/**
 * 배경이 평평한 회색인 전개도에서 자르는 자리를 **알아서 찾습니다.**
 *
 * 생성기는 「캔버스의 22분의 5 지점」 같은 지시를 못 지킵니다. 대신 빈 곳을 회색으로
 * 비워 두라는 지시는 잘 지켜서, **회색이 아닌 곳**을 재면 판 경계가 그대로 나옵니다.
 *
 * 못 찾으면 `null` — 화면은 기본 자리를 보여 주고 사람이 선을 끌어 맞춥니다.
 */
export function detectCrossLines(
  image: HTMLImageElement | HTMLCanvasElement,
  sampleWidth = 480,
): CrossLines | null {
  const pixels = samplePixels(image, sampleWidth);
  const coarse = pixels
    ? detectCrossFromPixels(pixels.data, pixels.width, pixels.height)
    : null;
  // 줄인 사본으로 찾은 자리를 원본에서 마무리합니다 — 까닭은 `refineCrossFromPixels`.
  return coarse ? refineCrossLines(image, coarse) : null;
}

/** 축소 사본의 픽셀. 캔버스를 만지는 곳은 여기 하나뿐이라 판정(`detectCrossFromPixels`)은 순수합니다. */
function samplePixels(
  image: HTMLImageElement | HTMLCanvasElement,
  sampleWidth: number,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const sourceWidth =
    "naturalWidth" in image ? image.naturalWidth || image.width : image.width;
  const sourceHeight =
    "naturalHeight" in image
      ? image.naturalHeight || image.height
      : image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const width = Math.max(64, Math.min(sampleWidth, sourceWidth));
  const height = Math.max(1, Math.round((width * sourceHeight) / sourceWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return {
    data: context.getImageData(0, 0, width, height).data,
    width,
    height,
  };
}

/**
 * 픽셀만 보고 자르는 자리를 찾습니다 — 캔버스를 안 만져서 그대로 시험할 수 있습니다.
 */
export function detectCrossFromPixels(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
): CrossLines | null {
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };

  /*
    바탕색은 **네 귀퉁이의 중앙값**입니다. 평균을 쓰면 귀퉁이 하나가 판에 물렸을 때
    바탕색이 그쪽으로 끌려가 판 전체가 «내용» 으로 보입니다.
  */
  const corners = [
    at(2, 2),
    at(width - 3, 2),
    at(2, height - 3),
    at(width - 3, height - 3),
  ];
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[1];
  const background = [0, 1, 2].map((channel) =>
    median(corners.map((corner) => corner[channel])),
  );

  const isContent = (x: number, y: number) => {
    const pixel = at(x, y);
    return (
      Math.abs(pixel[0] - background[0]) > 20 ||
      Math.abs(pixel[1] - background[1]) > 20 ||
      Math.abs(pixel[2] - background[2]) > 20
    );
  };

  /** 줄마다 내용이 있는 가장 왼쪽·오른쪽. 없으면 null. */
  const rows: ({ left: number; right: number } | null)[] = [];
  for (let y = 0; y < height; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (!isContent(x, y)) continue;
      if (left < 0) left = x;
      right = x;
    }
    rows.push(left < 0 ? null : { left, right });
  }

  const widthOf = (row: { left: number; right: number } | null) =>
    row ? row.right - row.left + 1 : 0;
  const widest = Math.max(...rows.map(widthOf));
  if (widest < width * 0.4) return null;

  // 벽 띠 = 내용이 가장 넓은 줄들. 네 벽이 나란히 붙어 있어 다른 줄보다 훨씬 넓습니다.
  const bandRows = rows
    .map((row, y) => (widthOf(row) >= widest * 0.85 ? y : -1))
    .filter((y) => y >= 0);
  if (!bandRows.length) return null;
  const bandTop = bandRows[0];
  const bandBottom = bandRows[bandRows.length - 1];
  const bandLeft = Math.min(...bandRows.map((y) => rows[y]!.left));
  const bandRight = Math.max(...bandRows.map((y) => rows[y]!.right));

  /** 띠 위(천장)·아래(바닥)에서 내용이 있는 줄들의 자리와 가로 범위. */
  const outside = (from: number, to: number) => {
    const list: number[] = [];
    for (let y = from; y <= to; y += 1) if (rows[y]) list.push(y);
    if (!list.length) return null;
    return {
      first: list[0],
      last: list[list.length - 1],
      left: Math.min(...list.map((y) => rows[y]!.left)),
      right: Math.max(...list.map((y) => rows[y]!.right)),
    };
  };
  const ceiling = outside(0, bandTop - 1);
  const floor = outside(bandBottom + 1, height - 1);
  const stack = ceiling ?? floor;
  if (!stack) return null;

  // 천장·바닥은 «정면» 칸 위아래에 붙습니다 — 그 가로 범위가 곧 정면 칸입니다.
  const frontLeft =
    ceiling && floor ? (ceiling.left + floor.left) / 2 : stack.left;
  const frontRight =
    ceiling && floor ? (ceiling.right + floor.right) / 2 : stack.right;
  if (frontRight - frontLeft < width * 0.08) return null;

  /*
    판 사이에 **회색 틈**이 있으면 그것이 곧 경계입니다 — 짐작할 필요가 없습니다.
    생성기는 「빈틈없이 붙여라」 를 자주 흘리는데, 흘려 준 덕에 네 칸 경계가 그대로 보입니다.
    띠 안에서 «어느 줄에도 내용이 없는 세로줄» 을 모아 틈 세 개를 찾으면 그 한가운데가 경계입니다.
  */
  const bandHasContent: boolean[] = [];
  for (let x = 0; x < width; x += 1) {
    let found = false;
    for (const y of bandRows) {
      if (isContent(x, y)) {
        found = true;
        break;
      }
    }
    bandHasContent.push(found);
  }
  const gaps: { from: number; to: number }[] = [];
  for (let x = bandLeft + 1; x < bandRight; x += 1) {
    if (bandHasContent[x]) continue;
    const from = x;
    while (x < bandRight && !bandHasContent[x]) x += 1;
    gaps.push({ from, to: x - 1 });
  }
  const gapCenters = gaps.map((gap) => (gap.from + gap.to) / 2);

  /*
    틈이 없으면(판이 정말로 맞붙었으면) 짐작합니다. 왼쪽 칸이 깊이(D), 정면 칸이 가로(W)
    라는 것을 알고 있으니 남은 폭을 그 비율로 나눕니다.
  */
  const depth = Math.max(1, frontLeft - bandLeft);
  const front = Math.max(1, frontRight - frontLeft);
  const rest = bandRight - frontRight;
  const guessedRight = frontRight + (rest * depth) / (depth + front);
  const [gapLeft, gapMid, gapRight] = gapCenters.length === 3 ? gapCenters : [];
  const leftEdge = gapCenters.length === 3 ? gapLeft : frontLeft;
  const midEdge = gapCenters.length === 3 ? gapMid : frontRight + 1;
  const rightEdge = gapCenters.length === 3 ? gapRight : guessedRight;

  const nx = (value: number) => Math.min(1, Math.max(0, value / width));
  const ny = (value: number) => Math.min(1, Math.max(0, value / height));
  return {
    x: [
      nx(bandLeft),
      nx(leftEdge),
      nx(midEdge),
      nx(rightEdge),
      nx(bandRight + 1),
    ],
    y: [
      ny(ceiling ? ceiling.first : bandTop),
      ny(bandTop),
      ny(bandBottom + 1),
      ny(floor ? floor.last + 1 : bandBottom + 1),
    ],
  };
}

/**
 * 찾은 자리를 **원본 해상도에서 다시 맞춥니다.**
 *
 * , 「틀이 정확하게 들어가도록 못하나?」.
 * 자리 찾기(`detectCrossFromPixels`)는 480 px 로 줄인 사본에서 돕니다 — 원본 1344 px 이면 사본 한 칸이
 * 원본 2.8 px 이라, 선이 판 경계에서 2~4 px 씩 비껴 칸에 옆 판이 한 줄 끼거나 제 판이 한 줄 잘렸습니다.
 * 원본 전체에서 찾으면 판 안의 무늬(통나무 사이 틈 같은 회색)를 바탕으로 읽어 오히려 크게 틀어집니다
 * (실측: 레지스탕스의 방_001 이 252·804 로 엉뚱하게 잡힘). 그래서 **줄인 사본으로 대강, 원본으로 마무리** 입니다.
 *
 * 선마다 원래 자리 앞뒤 몇 px(사본 한 칸의 2.5 배) 안에서 **옆 줄과 색이 가장 크게 바뀌는 자리**를 고릅니다.
 * 판 경계는 바탕→그림이든 판→판이든 한 줄 사이에 색이 통째로 바뀌는 곳이라 이 값이 가장 큽니다. 재는 범위는
 * 선이 실제로 판을 가르는 구간만 — 세로선은 벽 띠 높이, 천장·바닥 선은 정면 칸 가로(바깥 끝) 또는 벽 띠 전체
 * (천장｜벽·벽｜바닥) 입니다. 무늬의 줄(통나무 가로줄)에 끌려가지 않게 원래 자리에서 멀수록 조금씩 깎습니다.
 */
export function refineCrossFromPixels(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
  lines: CrossLines,
  sampleWidth = 480,
): CrossLines {
  const reach = Math.max(2, Math.ceil((2.5 * width) / Math.max(1, sampleWidth)));
  const corner = (x: number, y: number, channel: number) => data[(y * width + x) * 4 + channel];
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[1];
  const background = [0, 1, 2].map((channel) =>
    median([
      corner(2, 2, channel),
      corner(width - 3, 2, channel),
      corner(2, height - 3, channel),
      corner(width - 3, height - 3, channel),
    ]),
  );
  /** 한 점의 색 — 판 밖(가장자리 너머)은 바탕색으로 봅니다. 그래야 그림 끝에 붙은 판도 경계가 잡힙니다. */
  const color = (x: number, y: number, channel: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? background[channel] : data[(y * width + x) * 4 + channel];
  /** 줄 p-1 과 줄 p 의 색 차이(범위 평균). 가로선이면 행, 세로선이면 열. */
  const diff = (axis: "x" | "y", p: number, from: number, to: number) => {
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(axis === "x" ? height : width, Math.ceil(to));
    if (b - a < 2) return 0;
    const step = Math.max(1, Math.floor((b - a) / 400));
    let sum = 0;
    let count = 0;
    for (let q = a; q < b; q += step) {
      for (let channel = 0; channel < 3; channel += 1) {
        sum +=
          axis === "x"
            ? Math.abs(color(p, q, channel) - color(p - 1, q, channel))
            : Math.abs(color(q, p, channel) - color(q, p - 1, channel));
      }
      count += 1;
    }
    return sum / count;
  };
  const snap = (axis: "x" | "y", value: number, from: number, to: number) => {
    const size = axis === "x" ? width : height;
    const start = Math.round(value * size);
    let best = start;
    let bestScore = -Infinity;
    for (let p = Math.max(0, start - reach); p <= Math.min(size, start + reach); p += 1) {
      // 원래 자리에서 한 px 멀어질 때마다 조금씩 깎습니다 — 같은 세기면 원래 자리가 이깁니다.
      const score = diff(axis, p, from, to) - Math.abs(p - start) * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best / size;
  };

  const px = (v: number) => v * width;
  const py = (v: number) => v * height;
  const [x0, x1, x2, x3, x4] = lines.x;
  const [y0, y1, y2, y3] = lines.y;
  // 벽 띠의 세로 범위 — 위아래 가장자리는 옆 판이 섞일 수 있어 조금 안쪽만 잽니다.
  const bandFrom = py(y1) + (py(y2) - py(y1)) * 0.1;
  const bandTo = py(y2) - (py(y2) - py(y1)) * 0.1;
  const frontFrom = px(x1) + (px(x2) - px(x1)) * 0.1;
  const frontTo = px(x2) - (px(x2) - px(x1)) * 0.1;
  return {
    x: [
      snap("x", x0, bandFrom, bandTo),
      snap("x", x1, bandFrom, bandTo),
      snap("x", x2, bandFrom, bandTo),
      snap("x", x3, bandFrom, bandTo),
      snap("x", x4, bandFrom, bandTo),
    ],
    y: [
      snap("y", y0, frontFrom, frontTo),
      snap("y", y1, px(x0), px(x4)),
      snap("y", y2, px(x0), px(x4)),
      snap("y", y3, frontFrom, frontTo),
    ],
  };
}

/** 원본 픽셀(가로 최대 4096)에서 자리를 다시 맞춥니다. 캔버스를 만지는 껍데기. */
export function refineCrossLines(
  image: HTMLImageElement | HTMLCanvasElement,
  lines: CrossLines,
): CrossLines {
  const pixels = samplePixels(image, 4096);
  return pixels ? refineCrossFromPixels(pixels.data, pixels.width, pixels.height, lines) : lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// 자르기 — 화면(수동)과 자동 커팅이 **같은 함수**를 씁니다
// ─────────────────────────────────────────────────────────────────────────────

/** 잘라낸 면 하나. */
export interface CutFace {
  face: CompositionCubeFace;
  canvas: HTMLCanvasElement;
}

export interface CrossFaceMeasure {
  face: CompositionCubeFace;
  width: number;
  height: number;
  /** 회색 바탕과 다른 픽셀의 추정 비율. 회색 벽 자체도 낮게 나올 수 있어 실제 채움률은 아닙니다. */
  coverage: number | null;
}

export type CrossFaceIssue =
  | { kind: "ratio"; face: CompositionCubeFace; factor: number }
  | { kind: "coverage"; face: CompositionCubeFace; coverage: number }
  | { kind: "opposite"; face: CompositionCubeFace; other: CompositionCubeFace; factor: number };

/** 픽셀 크기만으로도 서로 마주 보는 벽이 4배 다른 잘못된 경계 추정을 걸러 냅니다. */
export function assessCrossFaces(faces: CrossFaceMeasure[], targetSize?: FaceSetSize | null) {
  const issues: CrossFaceIssue[] = [];
  for (const face of faces) {
    const target = crossFaceTargetRatio(face.face, targetSize);
    if (target && face.width > 0 && face.height > 0) {
      const ratio = face.width / face.height;
      const factor = Math.max(ratio / target, target / ratio);
      if (factor >= 1.5) issues.push({ kind: "ratio", face: face.face, factor });
    }
    if (face.coverage !== null && face.coverage < 0.7) issues.push({ kind: "coverage", face: face.face, coverage: face.coverage });
  }
  for (const [a, b] of [["front", "back"], ["left", "right"], ["top", "bottom"]] as const) {
    const first = faces.find((item) => item.face === a);
    const second = faces.find((item) => item.face === b);
    if (!first || !second || Math.min(first.width, first.height, second.width, second.height) <= 0) continue;
    const ratio = (first.width / first.height) / (second.width / second.height);
    const factor = Math.max(ratio, 1 / ratio);
    if (factor >= 1.5) issues.push({ kind: "opposite", face: a, other: b, factor });
  }
  const complete = new Set(faces.filter((f) => f.width > 0 && f.height > 0).map((f) => f.face)).size === 6;
  return { faces, issues, safe: complete && issues.length === 0 };
}

/** 파일을 쓰기 전에 자동·수동 경로가 같은 결과를 재도록 합니다. */
export function measureCrossFaces(faces: CutFace[], background?: readonly [number, number, number] | null): CrossFaceMeasure[] {
  return faces.map(({ face, canvas }) => {
    const pixels = background ? samplePixels(canvas, 96) : null;
    let coverage: number | null = null;
    if (pixels && background) {
      let content = 0;
      const { data, width, height } = pixels;
      for (let i = 0; i < data.length; i += 4) {
        const distance = Math.max(Math.abs(data[i] - background[0]), Math.abs(data[i + 1] - background[1]), Math.abs(data[i + 2] - background[2]));
        const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
        if (data[i + 3] > 0 && distance > (chroma <= 8 ? 30 : 20)) content += 1;
      }
      coverage = content / (width * height);
    }
    return { face, width: canvas.width, height: canvas.height, coverage };
  });
}

export function analyzeCrossFaces(source: HTMLImageElement | HTMLCanvasElement, lines: CrossLines, options?: Parameters<typeof cutCrossFaces>[2]) {
  const faces = cutCrossFaces(source, lines, options);
  return assessCrossFaces(measureCrossFaces(faces, options?.background), options?.targetSize);
}

/**
 * 칸 하나를 **원본 해상도로** 잘라 캔버스에 담습니다.
 *
 * 천장·바닥은 규약에 맞춰 위아래를 뒤집고(`FLIPPED_FACES`), 바탕색을 알면 가장자리의
 * 회색 테두리를 벗깁니다.
 *
 * 화면(`CrossUnfoldWorkbench`)과 자동 커팅(`useAutoUnfold`)이 이 하나를 같이 씁니다.
 * 두 벌로 두면 «회색 테두리 벗기기» 같은 규칙을 한쪽만 고치는 날이 옵니다(공통 규칙 1).
 */
export function cutCrossCell(
  source: HTMLImageElement | HTMLCanvasElement,
  cell: CrossCell,
  options?: {
    flip?: boolean;
    background?: readonly [number, number, number] | null;
    targetSize?: FaceSetSize | null;
  },
): HTMLCanvasElement | null {
  const width =
    "naturalWidth" in source ? source.naturalWidth || source.width : source.width;
  const height =
    "naturalHeight" in source
      ? source.naturalHeight || source.height
      : source.height;
  if (!width || !height) return null;

  /*
    옆 판과 **맞닿은 변은 한 줄씩 안으로** 자릅니다. 생성기는 판 사이를 붙여 그리면서 경계에 밝거나 어두운
    이음매 한 줄을 남깁니다(실측: 레지스탕스의 방_001·002 의 벽 사이 흰 세로줄). 선을 정확히 그 줄에 맞춰도
    그 줄은 어느 한쪽 칸에 들어가 상자 모서리에 가는 선으로 보입니다. 한 줄은 방 비율에 티가 안 납니다.
  */
  const inset = (on?: boolean) => (on && width >= 256 && height >= 256 ? 1 : 0);
  const left = Math.round(cell.left * width) + inset(cell.shared?.left);
  const top = Math.round(cell.top * height) + inset(cell.shared?.top);
  const right = Math.round(cell.right * width) - inset(cell.shared?.right);
  const bottom = Math.round(cell.bottom * height) - inset(cell.shared?.bottom);
  const sx = left;
  const sy = top;
  const sw = Math.max(1, right - left);
  const sh = Math.max(1, bottom - top);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (options?.flip !== false && FLIPPED_FACES.includes(cell.face)) {
    context.translate(0, sh);
    context.scale(1, -1);
  }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return options?.background
    ? trimBackgroundEdges(canvas, options.background, 0.15, crossFaceTargetRatio(cell.face, options.targetSize))
    : canvas;
}

/** 전개도 한 장에서 여섯 면을 전부 잘라 냅니다. 못 자른 면은 빠집니다. */
export function cutCrossFaces(
  source: HTMLImageElement | HTMLCanvasElement,
  lines: CrossLines,
  options?: {
    flip?: boolean;
    background?: readonly [number, number, number] | null;
    targetSize?: FaceSetSize | null;
  },
): CutFace[] {
  const out: CutFace[] = [];
  for (const cell of crossCells(lines)) {
    const canvas = cutCrossCell(source, cell, options);
    if (canvas) out.push({ face: cell.face, canvas });
  }
  return out;
}

/**
 * 이 그림이 **십자 전개도로 보이는가.**
 *
 * 자동으로 자르려면 «이건 전개도다» 를 앱이 확신해야 합니다 —
 * 잘못 보면 평범한 배경 사진을 여섯 조각으로 잘라 폴더에 흩뿌립니다.
 *
 * 세 가지를 모두 만족해야 «맞다» 고 봅니다.
 *
 * 1. `detectCrossLines` 가 자리를 찾았다 — 회색 바탕 위에 십자로 놓인 판이 있다는 뜻.
 * 2. 여섯 칸이 **전부 내용을 담고 있다** — 한 칸이라도 통째로 회색이면 전개도가 덜 그려진
 * 것이거나 애초에 전개도가 아닙니다.
 * 3. 여섯 칸이 전부 **그려진 그림**이다 — 칸마다 색이 여러 가지여야 합니다.
 * 우리가 마그니픽에 레퍼런스로 올리는 «전개도 틀»(면마다 단색으로 칠한 도면)이 짜임은
 * 전개도와 똑같아서 1·2 를 통과합니다. 실측(2026-09-15): 진짜 전개도는 칸마다 고유색이
 * 5~21 개, 틀은 **1 개**였습니다. 셋이면 충분히 갈립니다.
 * 4. 네 귀퉁이가 **바탕색** 그대로다 — 십자 배치라면 귀퉁이는 반드시 비어 있습니다.
 * 꽉 찬 사진은 여기서 걸립니다.
 *
 * 애매하면 «아니다» 쪽입니다. 놓친 전개도는 사람이 단추 한 번으로 자르면 되지만, 잘못
 * 자른 그림은 폴더에 파일 여섯 개를 남기고 세트 카드까지 만듭니다.
 */
export function looksLikeCrossUnfold(
  image: HTMLImageElement | HTMLCanvasElement,
): CrossLines | null {
  const pixels = samplePixels(image, 480);
  if (!pixels) return null;
  const lines = detectCrossFromPixels(pixels.data, pixels.width, pixels.height);
  if (!lines) return null;

  const { data, width, height } = pixels;
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[1];
  const corners = [
    at(2, 2),
    at(width - 3, 2),
    at(2, height - 3),
    at(width - 3, height - 3),
  ];
  const background = [0, 1, 2].map((channel) =>
    median(corners.map((corner) => corner[channel])),
  );
  const isContent = (x: number, y: number) => {
    const pixel = at(x, y);
    return (
      Math.abs(pixel[0] - background[0]) > 20 ||
      Math.abs(pixel[1] - background[1]) > 20 ||
      Math.abs(pixel[2] - background[2]) > 20
    );
  };

  // 2·3. 여섯 칸이 전부 «내용이 있고 여러 색으로 그려진» 칸인가. 칸 가운데를 찍어 봅니다.
  for (const cell of crossCells(lines)) {
    const x0 = Math.round(cell.left * width);
    const x1 = Math.round(cell.right * width);
    const y0 = Math.round(cell.top * height);
    const y1 = Math.round(cell.bottom * height);
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    let hit = 0;
    // 색은 32단계로 뭉뚱그려 셉니다 — 사진의 미세한 흔들림을 다른 색으로 세면 도면도 통과합니다.
    const shades = new Set<number>();
    for (let i = 1; i <= 8; i += 1) {
      for (let j = 1; j <= 8; j += 1) {
        const x = x0 + Math.round(((x1 - x0) * i) / 9);
        const y = y0 + Math.round(((y1 - y0) * j) / 9);
        if (isContent(x, y)) hit += 1;
        const pixel = at(x, y);
        shades.add(
          (pixel[0] >> 5) * 64 + (pixel[1] >> 5) * 8 + (pixel[2] >> 5),
        );
      }
    }
    // 절반 넘게 내용이라야 «그려진 칸» 이고, 색이 셋은 돼야 «도면이 아닌 그림» 입니다.
    if (hit < 32 || shades.size < 3) return null;
  }

  // 4. 네 귀퉁이가 비어 있는가 — 십자라면 반드시 그렇습니다.
  const cornerBoxes: [number, number][] = [
    [Math.round(width * 0.04), Math.round(height * 0.06)],
    [Math.round(width * 0.96), Math.round(height * 0.06)],
    [Math.round(width * 0.04), Math.round(height * 0.94)],
    [Math.round(width * 0.96), Math.round(height * 0.94)],
  ];
  for (const [x, y] of cornerBoxes) {
    if (isContent(Math.min(width - 1, x), Math.min(height - 1, y))) return null;
  }

  // 판정은 줄인 사본으로 충분하지만, 자르는 자리는 원본에서 맞춘 것이라야 합니다.
  return refineCrossLines(image, lines);
}
