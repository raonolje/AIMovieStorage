import {
  type CompositionObjectGroup,
  type CompositionState,
  type ObjectComposition,
  framePlaceOf,
} from "@/lib/composition";

/**
 * 구도의 **덩어리를 무엇으로 바꿔 그릴지** 적은 줄들.
 *
 * ,
 * 「각 오브젝트마다 우리가 앞에서 생성한 캐릭터 시트, 애셋 시트랑 자동으로 매칭시켜서
 * 스왑하라고 프롬프트가 생성될 수 있어야 해」.
 *
 * # 왜 «색» 으로 가리키는가
 *
 * 구도잡기에서 뽑은 그림에는 회색·노랑·파랑 덩어리가 찍혀 있습니다. 생성기에게
 * 「왼쪽 아래 물건」 이라고 하면 무엇을 가리키는지 매번 다르게 읽지만, 「노란 덩어리」 는
 * 그림에 그대로 보이는 표시라 헷갈릴 수가 없습니다. 색이 곧 이름표입니다.
 *
 * # 자리와 크기를 함께 적는 까닭
 *
 * 바꿔 그릴 물건이 **원래 덩어리만 해야** 구도가 유지됩니다. 「안개」 라고만 하면 화면을
 * 가득 채우거나 손바닥만 하게 나옵니다. 미터로 적어 두면 그 부피 안에 들어옵니다.
 */
export interface SwapLine {
  /** 화면에 보여 줄 한 줄. */
  ko: string;
  /** 프롬프트에 붙일 영문 한 줄. */
  en: string;
}

/** 소품 하나가 차지하는 부피(m). 모양마다 기준 크기가 달라 배율과 곱합니다. */
function sizeOf(item: ObjectComposition) {
  const base =
    item.kind === "sphere"
      ? { x: 1, y: 1, z: 1 }
      : item.kind === "cylinder"
        ? { x: 1, y: 1, z: 1 }
        : item.kind === "table"
          ? { x: 1.4, y: 0.75, z: 0.8 }
          : { x: 1, y: 1, z: 1 };
  return {
    x: base.x * item.scale.x,
    y: base.y * item.scale.y,
    z: base.z * item.scale.z,
  };
}

/** 여러 소품이 **함께** 차지하는 범위(m). 묶음의 부피입니다. */
function extentOf(items: ObjectComposition[]) {
  if (!items.length) return { x: 0, y: 0, z: 0 };
  let min = { x: Infinity, y: Infinity, z: Infinity };
  let max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const item of items) {
    const size = sizeOf(item);
    (["x", "y", "z"] as const).forEach((axis) => {
      const half = size[axis] / 2;
      min[axis] = Math.min(min[axis], item.position[axis] - half);
      max[axis] = Math.max(max[axis], item.position[axis] + half);
    });
  }
  return { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
}

/**
 * 「1.2 × 0.8 × 0.6 m」
 *
 * 소수 한 자리를 **늘 적습니다**(3 이 아니라 3.0). 생성기는 「3 m」 를 어림수로,
 * 「3.0 m」 를 잰 값으로 읽습니다 — 구도를 지키라는 지시라 잰 값처럼 보여야 합니다.
 */
const sizeText = (size: { x: number; y: number; z: number }) =>
  `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m`;

/** 색 이름표. 생성기에게는 «그림에 보이는 그 색» 이 가장 확실한 지시어입니다. */
const COLOR_WORDS: { hex: string; ko: string; en: string }[] = [
  { hex: "#e8c15a", ko: "노란", en: "yellow" },
  { hex: "#6fb7e8", ko: "하늘색", en: "light blue" },
  { hex: "#d98ad4", ko: "분홍", en: "pink" },
  { hex: "#7fd6a3", ko: "연두", en: "mint green" },
  { hex: "#e8906a", ko: "주황", en: "orange" },
  { hex: "#9a9ae8", ko: "보라", en: "lavender" },
];

function colorWord(hex?: string) {
  const found = COLOR_WORDS.find(
    (item) => item.hex.toLowerCase() === (hex ?? "").toLowerCase(),
  );
  return found ?? { ko: "회색", en: "grey" };
}

/**
 * 영어 복수형.
 *
 * 2026-09-18 점검에서 드러났습니다 — `${kind.en}es` 로 만들고 있어서 `spherees` ·
 * `tablees` · `cylinderes` 가 영문 프롬프트에 나갔습니다. 한국어에는 없는,
 * **영문에만 있던 오염**입니다.
 */
function plural(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const KIND_WORDS: Record<string, { ko: string; en: string }> = {
  box: { ko: "상자", en: "box" },
  sphere: { ko: "구", en: "sphere" },
  cylinder: { ko: "원기둥", en: "cylinder" },
  table: { ko: "탁자", en: "table" },
  crate: { ko: "상자", en: "crate" },
};

const SHEET_WORDS: Record<string, { ko: string; en: string }> = {
  character: { ko: "인물 시트", en: "character sheet" },
  asset: { ko: "에셋 시트", en: "asset sheet" },
  background: { ko: "배경 시트", en: "background sheet" },
};

/**
 * 구도에 놓인 덩어리들을 «바꿔 그릴 것» 목록으로 옮깁니다.
 *
 * 뜻(`describeAs`)도 시트(`swapRef`)도 없는 덩어리는 **건너뜁니다** — 「회색 상자를
 * 회색 상자로 그려라」 는 아무 값도 없고, 프롬프트만 길어져 나머지 지시가 묻힙니다.
 */
/**
 * 구도에 선 **사람들**을 프롬프트 줄로 옮깁니다.
 *
 * 프로젝트 인물은 **이름**이 곧 시트를 가리킵니다 — 「수화」 라고 적으면 앞에서 만든
 * 수화 시트를 같이 넣으면 되니까요. 구도잡기에서 즉석으로 세운 마네킹은 시트가 없으므로
 * 「엑스트라」 로 묶습니다. 이름을 억지로 지어 주면 생성기가 «아는 사람» 으로 착각해
 * 매번 다른 얼굴을 또렷하게 그려 내는데, 지나가는 사람은 그러면 안 됩니다.
 */
export function describePeople(
  state: CompositionState,
  /** 프로젝트 인물의 id → 이름. 여기 없는 사람은 엑스트라입니다. */
  names: Record<string, string>,
  /**
   * 인물 이름 → **연기 기준** 한 줄(캐릭터 특징의 연출 메모·성격·말투).
   *
   * 2026-09-18 점검: 캐릭터 특징 칸에 「영상 프롬프트에서 이 인물의 연기 기준이 됩니다」
   * 라고 적어 두고도, 그 값을 읽는 코드가 시트 굽기밖에 없었습니다. 적어 둔 것이 아무
   * 데도 안 가는 칸이었던 셈입니다.
   */
  acting: Record<string, string> = {},
): SwapLine[] {
  const known: string[] = [];
  let extras = 0;
  for (const person of state.characters) {
    if (person.hidden) continue;
    const name = names[person.characterId];
    if (name) known.push(name);
    else extras += 1;
  }
  const lines: SwapLine[] = [];
  if (known.length)
    lines.push({
      ko: `사람: ${known.join(" · ")} — 첨부한 인물 시트 그대로 그리세요.`,
      en: `People: ${known.join(", ")} — draw them exactly as in the attached character sheets.`,
    });

  /*
    ── 화면에서의 자리를 **숫자로** ──────────────────────────────────────
    사용자 2026-09-21: Seedance 2.5 가 `THE WOMAN 화면 왼쪽, x 42%, y 44%` 처럼 숫자로
    자리를 받아 줍니다. 말로 「왼쪽에」 라고만 하면 **컷마다 조금씩 옮겨 갑니다** —
    같은 장면을 이어 붙였을 때 인물이 스르르 미끄러지는 원인입니다.

    우리는 이 값을 **이미 알고 있습니다.** 구도잡기가 3D 자리를 들고 있으니 화면에
    내리기만 하면 됩니다(`framePlaceOf`). 안 쓰고 있었을 뿐입니다.

    숫자를 못 알아듣는 모델에는 그냥 지나가는 말이라 해가 없습니다. 화면 밖으로 나간
    인물(0~100 밖)은 **적지 않습니다** — 「x 135%」 는 사실이지만 생성기에는 뜻이 없고,
    오히려 그 수를 맞추려다 화면을 비웁니다.
  */
  const spots = state.characters
    .filter((person) => !person.hidden && names[person.characterId])
    .map((person) => {
      const heightM = (person.heightCm ?? 170) / 100;
      const place = framePlaceOf(state.camera, person.position, heightM);
      return { name: names[person.characterId], ...place };
    })
    .filter((spot) => spot.xPct >= 0 && spot.xPct <= 100 && spot.yPct >= 0 && spot.yPct <= 100);
  if (spots.length)
    lines.push({
      ko:
        `화면에서의 자리(왼쪽 0% · 오른쪽 100%, 위 0% · 아래 100%) — ` +
        spots.map((s) => `${s.name} x ${s.xPct}%, y ${s.yPct}%`).join(" · ") +
        `. 이 자리를 지키세요.`,
      en:
        `Screen placement (left 0% to right 100%, top 0% to bottom 100%) — ` +
        spots.map((s) => `${s.name} at x ${s.xPct}%, y ${s.yPct}%`).join("; ") +
        `. Keep these positions.`,
    });
  known.forEach((name) => {
    const note = (acting[name] || "").trim();
    if (!note) return;
    lines.push({
      ko: `${name} 의 연기 기준 — ${note}`,
      en: `How ${name} performs — ${note}`,
    });
  });
  if (extras)
    lines.push({
      ko: `엑스트라 ${extras}명 — 얼굴이 뚜렷하지 않은 지나가는 사람으로, 자리만 맞춰 주세요.`,
      en: `${extras} extra${extras > 1 ? "s" : ""} — anonymous passers-by with no distinct faces, only their positions matter.`,
    });
  return lines;
}

export function describeObjectSwaps(state: CompositionState): SwapLine[] {
  const lines: SwapLine[] = [];
  const groups = state.objectGroups ?? [];
  const grouped = new Set<string>();

  for (const group of groups) {
    const members = state.objects.filter(
      (item) => item.visible && item.groupId === group.id,
    );
    members.forEach((item) => grouped.add(item.id));
    if (!members.length) continue;
    const line = swapLine({
      color: group.color,
      kinds: members.map((item) => item.kind),
      count: members.length,
      size: extentOf(members),
      name: group.name,
      describeAs: group.describeAs,
      swapRef: group.swapRef,
    });
    if (line) lines.push(line);
  }

  for (const item of state.objects) {
    if (!item.visible || item.kind === "light" || grouped.has(item.id))
      continue;
    const line = swapLine({
      color: item.color,
      kinds: [item.kind],
      count: 1,
      size: sizeOf(item),
      name: item.label,
      describeAs: undefined,
      swapRef: item.swapRef,
    });
    if (line) lines.push(line);
  }

  return lines;
}

function swapLine(input: {
  color?: string;
  kinds: string[];
  count: number;
  size: { x: number; y: number; z: number };
  name?: string;
  describeAs?: string;
  swapRef?: CompositionObjectGroup["swapRef"];
}): SwapLine | null {
  const { describeAs, swapRef } = input;
  if (!describeAs?.trim() && !swapRef) return null;

  const colour = colorWord(input.color);
  const kind = KIND_WORDS[input.kinds[0]] ?? KIND_WORDS.box;
  // 「노란 구 3개로 만든 덩어리」 / 「회색 상자」
  const whatKo =
    input.count > 1
      ? `${colour.ko} ${kind.ko} ${input.count}개로 만든 덩어리`
      : `${colour.ko} ${kind.ko}`;
  const whatEn =
    input.count > 1
      ? `the ${colour.en} block made of ${input.count} ${plural(kind.en)}`
      : `the ${colour.en} ${kind.en}`;

  const size = sizeText(input.size);
  if (swapRef) {
    const sheet = SHEET_WORDS[swapRef.kind] ?? SHEET_WORDS.asset;
    return {
      ko: `${whatKo}(${input.name ?? swapRef.name}) → 첨부한 «${swapRef.name}» ${sheet.ko}의 그 물건으로 바꿔 그리세요. 자리와 크기(${size})는 그대로 두세요.`,
      en: `Replace ${whatEn} with the subject from the attached ${sheet.en} "${swapRef.name}". Keep its position and size (${size}) exactly as in the layout.`,
    };
  }
  return {
    ko: `${whatKo}(${input.name ?? ""}) → ${describeAs}. 자리와 크기(${size})는 그대로 두세요.`,
    en: `Replace ${whatEn} with ${describeAs}. Keep its position and size (${size}) exactly as in the layout.`,
  };
}
