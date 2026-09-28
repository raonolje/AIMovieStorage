import type { CompositionState, ObjectComposition } from "@/lib/composition";
import { characterColorMap } from "@/lib/compositionColors";

/**
 * 구도의 «색 → 그게 무엇인가» 대조표.
 *
 * 구도 캡처는 이제 **이름표 없이** 찍힙니다(). 이름표는 생성기가 그림 속 글자로
 * 그려 버려서 컷마다 다른 낙서가 남았어요.
 *
 * 그런데 이름을 지우면 「저 회색 마네킹이 누구인가」 를 알 길이 사라집니다. 그래서
 * 화면에서 사람을 구분하던 **식별 색**(`characterColor`)과 소품 색을 그대로 글로 옮겨
 * 프롬프트에 싣습니다 — 「파란 사람은 @냥이_시트_001, 빨간 상자는 소파」.
 *
 *
 */

/** 소품 색 팔레트. 서로 헷갈리지 않게 색상환에서 고루 떨어뜨렸습니다. */
export const OBJECT_COLORS: { hex: string; ko: string; en: string }[] = [
  { hex: "#8a8fa3", ko: "회색", en: "grey" },
  { hex: "#e5484d", ko: "빨강", en: "red" },
  { hex: "#f76b15", ko: "주황", en: "orange" },
  { hex: "#f5d90a", ko: "노랑", en: "yellow" },
  { hex: "#46a758", ko: "초록", en: "green" },
  { hex: "#12a594", ko: "청록", en: "teal" },
  { hex: "#3e63dd", ko: "파랑", en: "blue" },
  { hex: "#8e4ec6", ko: "보라", en: "purple" },
  { hex: "#e93d82", ko: "분홍", en: "pink" },
  { hex: "#6b4a2f", ko: "갈색", en: "brown" },
  { hex: "#f1f3f7", ko: "흰색", en: "white" },
  { hex: "#1c1d22", ko: "검정", en: "black" },
];

/**
 * 인물 식별 색의 이름표.
 *
 * `rig.ts` 의 `BODY_COLORS` 와 **같은 값**을 적어 둡니다. 자동으로 이름을 붙이려면
 * 색 이름 사전이 필요한데, 사전은 `#5b8dd9` 를 「하늘색」 이라고도 「강청색」 이라고도
 * 부릅니다. 열두 개뿐이니 사람이 읽어 정한 이름을 그대로 씁니다.
 */
const BODY_COLOR_NAMES: Record<string, { ko: string; en: string }> = {
  "#5b8dd9": { ko: "파랑", en: "blue" },
  "#4fb3c4": { ko: "청록", en: "teal" },
  "#7a7ee0": { ko: "남보라", en: "indigo" },
  "#3f9d7a": { ko: "초록", en: "green" },
  "#e0728f": { ko: "분홍", en: "pink" },
  "#e39358": { ko: "주황", en: "orange" },
  "#d9a13f": { ko: "황금색", en: "amber" },
  "#c96fc4": { ko: "자주", en: "magenta" },
  "#9aa4b8": { ko: "회색", en: "grey" },
  "#8f9d86": { ko: "연두회색", en: "sage" },
  "#a8968a": { ko: "베이지", en: "taupe" },
  "#94909f": { ko: "보라회색", en: "lilac grey" },
};

function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * 색 하나를 사람이 읽는 이름으로.
 *
 * 표에 있으면 그 이름, 없으면(색 고르개로 아무 색이나 찍었을 때) **가장 가까운
 * 팔레트 색**의 이름을 씁니다. 「#e2534f 인 상자」 라고 적어 봐야 생성기가 그림에서
 * 그 색을 못 찾습니다 — 이름이라야 찾습니다.
 */
export function colorNameOf(hex?: string): { ko: string; en: string } {
  if (!hex) return { ko: "회색", en: "grey" };
  const key = hex.trim().toLowerCase();
  const known =
    BODY_COLOR_NAMES[key] || OBJECT_COLORS.find((item) => item.hex.toLowerCase() === key);
  if (known) return { ko: known.ko, en: known.en };
  const rgb = hexToRgb(key);
  if (!rgb) return { ko: "회색", en: "grey" };
  let best = OBJECT_COLORS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  OBJECT_COLORS.forEach((item) => {
    const other = hexToRgb(item.hex);
    if (!other) return;
    const distance =
      (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  });
  return { ko: best.ko, en: best.en };
}

/** 구도에 선 사람 하나 — 화면의 색과 그 사람이 누구인지. */
export interface CharacterLegendEntry {
  characterId: string;
  /** 마네킹의 몸 색(hex). 캡처 그림에서 이 색으로 서 있습니다. */
  hex: string;
  color: { ko: string; en: string };
  /** 화면 왼쪽부터가 아니라 **배치 순서**. 색을 정하는 순번과 같아야 합니다. */
  index: number;
  name: string;
  /** 카메라에서 본 좌우 자리 — 「왼쪽에 선 파란 사람」 처럼 말해 주려고 씁니다. */
  side: "왼쪽" | "가운데" | "오른쪽";
}

/**
 * 캡처 그림에 선 사람들을 색과 함께 늘어놓습니다.
 *
 * 순번은 `CompositionViewport` 가 색을 고르는 규칙과 **똑같이** 셉니다 —
 * `characters.filter(!hidden).forEach((placement, index) => characterColor(gender, index))`.
 * 여기서 한 칸이라도 어긋나면 프롬프트가 엉뚱한 사람을 가리켜, 바로 그 «캐릭터 스왑»
 * 이 깨집니다.
 */
export function characterLegend(
  composition: CompositionState | undefined,
  resolve: (characterId: string) => { name?: string; gender?: string } | undefined,
): CharacterLegendEntry[] {
  if (!composition) return [];
  // 색은 `compositionColors` 한 곳에서 정합니다 — 화면·목록·프롬프트가 같은 표를 봐야
  // «저 파란 사람» 이 통합니다. 여기서 따로 세다가 셋이 어긋났습니다(2026-09-17).
  const hexes = characterColorMap(composition, (id) => resolve(id)?.gender);
  const placed = composition.characters.filter((item) => !item.hidden);
  return placed.map((placement, index) => {
    const source = resolve(placement.characterId);
    const hex = hexes.get(placement.characterId) ?? "#9aa4b8";
    return {
      characterId: placement.characterId,
      hex,
      color: colorNameOf(hex),
      index,
      name: source?.name || placement.label || `인물 ${index + 1}`,
      side: sideOf(composition, placement.position.x, placement.position.z),
    };
  });
}

/** 구도에 놓인 소품 하나 — 색과 이름. */
export interface ObjectLegendEntry {
  id: string;
  hex: string;
  color: { ko: string; en: string };
  label: string;
  kind: ObjectComposition["kind"];
}

/** 소품 종류의 영어 이름 — 프롬프트에 「the red box」 처럼 적으려고 씁니다. */
const OBJECT_KIND_EN: Record<ObjectComposition["kind"], string> = {
  table: "table",
  crate: "crate",
  light: "light",
  box: "box",
  sphere: "sphere",
  cylinder: "cylinder",
  wall: "backdrop wall",
};

export function objectLegend(composition: CompositionState | undefined): ObjectLegendEntry[] {
  if (!composition) return [];
  return composition.objects
    // 조명은 그림에 안 나옵니다(전구 표시는 헬퍼라 캡처에서 빠집니다). 색을 말해 줘도
    // 생성기가 그림에서 찾을 것이 없어 오히려 없는 물건을 그립니다.
    .filter((item) => item.visible && item.kind !== "light")
    .map((item) => ({
      id: item.id,
      hex: item.color || "#8a8fa3",
      color: colorNameOf(item.color),
      label: item.label?.trim() || OBJECT_KIND_EN[item.kind],
      kind: item.kind,
    }));
}


/** 소품 종류의 한글 이름 — 한글 프롬프트에 「빨간 상자」 처럼 적으려고 씁니다. */
const OBJECT_KIND_KO: Record<ObjectComposition["kind"], string> = {
  table: "탁자",
  crate: "나무상자",
  light: "조명",
  box: "상자",
  sphere: "구",
  cylinder: "원기둥",
  wall: "배경 벽",
};

export function objectKindEn(kind: ObjectComposition["kind"]): string {
  return OBJECT_KIND_EN[kind];
}

export function objectKindKo(kind: ObjectComposition["kind"]): string {
  return OBJECT_KIND_KO[kind];
}

/**
 * 카메라에서 봤을 때 화면의 어느 쪽인가.
 *
 * 색만으로도 짝은 맞지만, 생성기는 색을 놓칠 때가 있습니다. 「왼쪽」 이 한 마디
 * 더 붙으면 색을 못 읽어도 자리로 짝을 맞춥니다.
 */
function sideOf(
  composition: CompositionState,
  x: number,
  z: number,
): "왼쪽" | "가운데" | "오른쪽" {
  const camera = composition.camera;
  const eye = camera.position;
  const target = camera.target;
  // 카메라가 보는 방향의 «오른쪽» 벡터(y 축과의 외적). 화면 가로축입니다.
  const fx = target.x - eye.x;
  const fz = target.z - eye.z;
  const rx = -fz;
  const rz = fx;
  const length = Math.hypot(rx, rz);
  if (length < 1e-6) return "가운데";
  const dot = ((x - eye.x) * rx + (z - eye.z) * rz) / length;
  const depth = Math.hypot(x - eye.x, z - eye.z) || 1;
  const ratio = dot / depth;
  if (ratio < -0.12) return "왼쪽";
  if (ratio > 0.12) return "오른쪽";
  return "가운데";
}

/**
 * 프롬프트 본문의 인물 이름을 마그니픽 @태그로 바꿉니다 — 「여울은」 → 「@여울_시트_001은」.
 *
 * 별도 줄에 「분홍 인물은 여울입니다 — 시트는
 * @…」 라고 적어 주는 것보다, 본문에서 그 사람을 부르는 자리마다 칩이 서 있는 편이
 * 생성기에 훨씬 잘 통합니다 — 그 문장이 곧 «이 사람을 여기 이렇게» 이니까요.
 *
 * ## 어디까지 바꾸는가
 *
 * 이름 뒤가 **문장 끝·공백·문장부호·한국어 조사**일 때만 바꿉니다. 「달」 이라는 인물이
 * 있다고 「달빛」 을 「@달_시트_001빛」 으로 만들면 안 되니까요. 조사는 마그니픽의 멘션
 * 경계 규칙(영문·숫자·밑줄·하이픈만 «이름의 연장»)이 태그로 인정하므로 붙여 둡니다
 * (Rust `with_mention_chips` 주석). 긴 이름부터 바꿔 「수」 가 「수화」 를 잘라먹지 않게 합니다.
 *
 * ## 별칭도 같은 태그로
 *
 * 2026-09-21 실측: 영문 본문은 인물을 로마자(«Seo Jinwoo (Nishimura Jin)»)로 부릅니다.
 * 한글 이름만 알던 이 함수는 그 자리를 못 찾아, 마그니픽에 갈 때 **영문 본문에는 칩이
 * 하나도 안 섰습니다.** 그래서 `aliases`(인물 카드의 «부르는 이름», `characterAliases`)
 * 도 같은 태그로 바꿉니다. 영문 별칭은 **낱말 경계**로 지킵니다 — 「Seo」 가 「Seoul」 을
 * 잘라먹으면 안 됩니다. 앞뒤 검사(`prevOk`·`nextOk`)가 한글·영문을 한 규칙으로 봅니다:
 * 바로 앞이나 뒤에 글자·숫자가 이어지면 다른 낱말입니다. 별칭이 없으면 예전과 똑같습니다.
 *
 * ## 본문을 한 번만 훑습니다
 *
 * 예전에는 인물마다 본문을 처음부터 다시 훑었습니다. 그러면 앞사람이 박아 넣은 태그 **안을**
 * 뒷사람이 다시 읽습니다 — 태그 `@서진우 (니시무라 진)_001` 속의 «니시무라 진» 이 다른 후보와
 * 맞으면 태그 안에 태그가 또 섭니다(앞이 「(」 라 낱말 경계로 보였습니다). 별칭이 생기면서
 * 이런 겹침이 흔해져, 후보 전부를 놓고 **한 번만** 훑고 넣은 태그는 다시 읽지 않습니다.
 *
 * ## 이미 서 있는 태그는 먼저 숨깁니다
 *
 * 한 번 훑기는 «이번에 넣은» 태그만 지킵니다. 그런데 이 함수는 **이미 태그가 선 글**을 다시
 * 받습니다 — 「프롬프트 작성」·「영상 프롬프트」 가 태그를 이어 둔 본문을 «구성» 이 또 넣고,
 * 「@ 다시 잇기」 를 두 번 누르면 또 돌립니다. 그때 `@서진우 (니시무라 진)_001` 안의 «니시무라 진»
 * 이 「(」 뒤라 낱말 경계로 통과해 `@서@서진우 (니시무라 진)_001 (@서진우 …)_001` 로 매번
 * 길어졌습니다(2026-09-21 실측). 경계 검사로는 못 막는 모양이라 살아 있는 태그 구간을
 * 자리표로 치우고 훑습니다(`hideTags` — `relinkBody` 와 한 벌).
 */
const NAME_TAILS = [
  "은", "는", "이", "가", "을", "를", "과", "와", "의", "에", "도", "만", "로", "으로",
  "에게", "한테", "께", "부터", "까지", "처럼", "보다", "랑", "이랑", "하고", "이가", "에서",
];

/** 본문에서 태그로 올릴 사람 하나 — 이름·별칭이 같은 태그로 갑니다. */
export interface TagPerson {
  name: string;
  tag?: string;
  /** 본문이 이 이름으로 불러도 같은 태그로. 영문 본문의 로마자 이름이 여기 옵니다. */
  aliases?: string[];
}

/**
 * 인물 카드에서 **별칭 목록**을 뽑습니다 — 프로필의 «부르는 이름» 칸(쉼표·가운뎃점으로 여럿).
 *
 * `Character` 에는 영문 이름 칸이 따로 없습니다. 설명 글에서 «(영문)» 을 짐작해 파내지 않고
 * **있는 칸만** 씁니다 — 짐작이 빗나가면 엉뚱한 낱말이 칩으로 바뀌고, 그건 읽어서는 못 찾습니다.
 * 그림 «구성»·영상 «구성»·「@ 다시 잇기」 가 이 한 벌을 씁니다(규칙 1) — 세 곳이 따로 뽑으면
 * 한 곳만 별칭을 모르는 채로 남습니다.
 */
export function characterAliases(
  person: { name?: string; profile?: { callName?: string } } | undefined,
): string[] {
  const name = (person?.name || "").trim();
  // 가운뎃점은 자판마다 다른 글자로 들어옵니다 — U+00B7(·)·U+318D(ㆍ, 천지인)·U+30FB(・). 하나만 보면 두 이름이 한 별칭으로 붙습니다(2026-09-21 검토).
  const words = (person?.profile?.callName || "")
    .split(/[,、·ㆍ・/|\n]/)
    .map((word) => word.trim())
    .filter((word) => word && word !== name);
  return [...new Set(words)];
}

/**
 * 살아 있는 `@태그` 구간을 **자리표로 숨깁니다** — 글을 손보는 동안 태그 안을 다시 읽지 않게.
 *
 * 파일 이름은 사람이 짓는 것이라 «서진우 (니시무라 진)_001» 처럼 공백·괄호가 들어옵니다. 그러면
 * 태그 한가운데에 낱말 경계가 생겨 앞머리만 읽거나(`relinkBody` 의 죽은 토큰 정규식) 속의 별칭을
 * 다시 잡습니다(`tagCharacterNames`). 정규식·경계 검사를 넓히는 대신 구간째 치웁니다 — 두 곳이
 * 따로 숨기면 한 곳만 고쳐지는 날이 옵니다(규칙 1).
 *
 * 자리표 `\u0000n\u0000` 은 글에 안 나오는 글자라 본문과 섞이지 않고, 앞뒤 검사가 «태그에 붙은
 * 글자» 로 읽어 태그 바로 옆의 이름을 또 바꾸지 않습니다. 긴 것부터 숨겨야 짧은 태그가 긴 태그의
 * 앞머리를 잘라먹지 않습니다.
 */
export function hideTags(
  text: string,
  tags: Iterable<string>,
): { guarded: string; restore: (value: string) => string } {
  const living = [...new Set(tags)]
    .filter((tag) => tag.length > 1)
    .sort((a, b) => b.length - a.length);
  const holes: string[] = [];
  let guarded = text;
  for (const tag of living) {
    if (!guarded.includes(tag)) continue;
    guarded = guarded.split(tag).join(`\u0000${holes.push(tag) - 1}\u0000`);
  }
  return {
    guarded,
    restore: (value) => value.replace(/\u0000(\d+)\u0000/g, (_, index) => holes[Number(index)]),
  };
}

export function tagCharacterNames(prompt: string, people: TagPerson[]): string {
  const raw = people
    .filter((person) => person.tag && person.name.trim())
    .flatMap((person) =>
      [person.name, ...(person.aliases ?? [])]
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => ({ word, tag: person.tag as string })),
    );
  /*
    **두 사람이 같은 말로 불리면 그 말은 안 바꿉니다.** «부르는 이름» 에는 「형」·「선생님」
    같은 호칭이 들어오기 쉬운데, 김민수도 박준호도 「형」 이면 본문의 「형」 은 누구인지
    문맥으로만 압니다. 그런데 배열 앞사람이 전부 가져가면 엉뚱한 사람 시트가 걸립니다
    (2026-09-21 검토 실측). 모호한 말은 그대로 두는 편이 틀린 태그보다 낫습니다.
  */
  const owners = new Map<string, Set<string>>();
  raw.forEach((item) => owners.set(item.word, (owners.get(item.word) ?? new Set()).add(item.tag)));
  const candidates = raw
    .filter((item) => (owners.get(item.word)?.size ?? 0) === 1)
    // 긴 것부터 — 같은 자리에서 「수」 가 「수화」 를 잘라먹지 않게.
    .sort((a, b) => b.word.length - a.word.length);
  if (!candidates.length) return prompt;
  const { guarded, restore } = hideTags(prompt, candidates.map((item) => item.tag));
  // 바로 앞이 글자(한글·영문·숫자·@)나 숨긴 태그면 다른 낱말의 한가운데입니다 — 「@여울」 을 또 바꾸는 것도 막습니다.
  const prevOk = (prevChar: string) => !prevChar || !/[\p{L}\p{N}_@\u0000]/u.test(prevChar);
  const nextOk = (after: string) => {
    const nextChar = after.charAt(0);
    return (
      !nextChar ||
      /[\s.,!?;:'"()\[\]…·—-]/.test(nextChar) ||
      NAME_TAILS.some(
        (tail) => after.startsWith(tail) && !/[가-힣]/.test(after.charAt(tail.length)),
      )
    );
  };
  let out = "";
  let rest = guarded;
  for (;;) {
    // 남은 글에서 가장 앞에 나오는 후보 자리.
    let at = -1;
    for (const item of candidates) {
      const found = rest.indexOf(item.word);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }
    if (at < 0) break;
    const before = rest.slice(0, at);
    const here = rest.slice(at);
    /*
      왼쪽 문맥은 `before` 가 비었으면 **`out` 의 끝 글자**입니다. 한 글자 건너뛴 다음 바퀴에는
      후보가 `rest` 맨 앞에 와 `before` 가 비는데, 빈 것을 «경계» 로 읽으면 방금 건너뛴 글자를
      잊습니다 — `@서진우_001` 에서 «서» 를 건너뛴 뒤 «진우» 가 새 낱말로 보여 태그 안에 태그가
      섰습니다(2026-09-21 실측).
    */
    // 그 자리에서 시작하는 후보를 긴 것부터 — 경계가 맞는 첫 것을 씁니다.
    const hit = prevOk((before || out).slice(-1))
      ? candidates.find(
          (item) => here.startsWith(item.word) && nextOk(here.slice(item.word.length)),
        )
      : undefined;
    if (hit) {
      out += before + hit.tag;
      rest = here.slice(hit.word.length);
    } else {
      // 한 글자만 넘깁니다 — 긴 이름이 경계에서 떨어져도 그 안에서 짧은 별칭이 시작할 수 있습니다.
      out += before + here.charAt(0);
      rest = here.slice(1);
    }
  }
  return restore(out + rest);
}
