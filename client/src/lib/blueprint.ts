import {
  buildOutdoorAreaEnglish,
  buildOutdoorAreaKorean,
  buildOutdoorPanoramaEnglish,
  buildOutdoorPanoramaKorean,
  buildUnfoldEnglish,
  buildUnfoldKorean,
  OUTDOOR_EYE_HEIGHT,
} from "@/lib/unfoldPrompt";

export type BlueprintKind = "character" | "background" | "asset";

/**
 * 배경 칩의 역할.
 *
 * 예전에는 고른 칩 개수가 곧 «칸 수» 였습니다. 그래서 마스터 1 + 표시 2 + 빛 3 을 켜면
 * «6칸 시트» 를 시켰고, 조감도 한 장을 원했는데 격자 여섯 칸이 나왔습니다.
 * 판을 만드는 것은 `frame` 뿐이고, `overlay` 는 그 판 위에 얹는 표시, `condition` 은
 * 판 수와 무관한 조건입니다.
 */
export type BlueprintRole = "frame" | "overlay" | "condition";

export type BlueprintOption = {
  id: string;
  label: string;
  english: string;
  /**
   * 공간 유형별 영문 문장. 없으면 `english` 를 씁니다.
   *
   * 360° 파노라마는 실외면 «하늘·지평선·달», 실내면 «천장·바닥·벽·창» 을 말해야 하는데
   * 칩 하나에 문장 하나면 둘 중 하나가 틀립니다. 칩을 둘로 쪼개면 실내외 혼합 장소에서
   * 어느 쪽을 켜야 할지 사람이 골라야 하고, 옛 프로젝트의 칩 id 도 갈라집니다.
   */
  englishBy?: Partial<Record<SpaceKind, string>>;

  /*
    아래는 전부 배경 칩 전용이고 **모두 옵셔널**입니다.
    캐릭터·에셋 칩 200여 개가 같은 타입을 쓰므로, 하나라도 필수로 만들면 그쪽이 전부 타입 오류입니다.
    패널은 `result` 가 없는 칩이면 설명 줄을 그냥 건너뜁니다.
  */

  /** 완성 형태 — 한 줄. */
  result?: string;
  /** 어디에 쓰는가 — 짧게 */
  use?: string;
  /** 결과 판 수와 비율을 사람이 읽는 말로. 예 «1:1 한 장», «2×2 네 칸» */
  frame?: string;
  /**
   * 생성기 설정에 넣을 비율.
   *
   * `frame` 은 사람이 읽는 글자라 브리지가 못 읽습니다. 비율은 프롬프트 문장보다
   * **설정값**이 정확합니다(nano-banana 는 2:1 을 못 내고 21:9 가 최대).
   */
  aspect?: string;
  /**
   * 이 칩이 나오면 안 되는 것들. **본문(en)이 아니라 negative 칸으로 갑니다.**
   *
   * 미드저니는 본문의 «no text» 를 내용어로 읽어 글자를 오히려 더 그립니다. Flux 도
   * 부정문을 자주 흘립니다. 그래서 칩 문장에서 «no …» 를 전부 걷어내 이 칸에 모았습니다.
   */
  negativeEnglish?: string;
  /** 판을 만드는가·얹는 표시인가·조건인가. 없으면 `frame` 으로 봅니다(캐릭터·에셋). */
  role?: BlueprintRole;
  /** 세트 칩이 만드는 칸 수. 한 장짜리는 비워 둡니다. */
  panels?: number;
  /** 한 그룹에서 하나만 켜지는 묶음 이름. 다른 것을 켜면 앞 것이 조용히 꺼집니다. */
  exclusiveGroup?: string;
  /** 이 칩이 뜰 공간 유형. 없거나 `both` 면 항상. 실내외(mixed)에서는 전부 뜹니다. */
  spaceKind?: SpaceKind | "both";
  /** 마스터 칩이 «지도형»(위에서 본 도면·배치도·조감도)인가. 얹는 표시를 붙일 수 있는지 가릅니다. */
  mapLike?: boolean;
  /** 얹는 표시 칩이 지도형 마스터에서만 되는가. 눈높이 그림에 나침반을 얹으면 그림 속 글자가 됩니다. */
  mapOnly?: boolean;
  /** 이 칩은 글자(라벨)를 그리게 합니다 — 금지 목록에서 text·labels 를 빼야 모순이 없습니다. */
  allowsLabels?: boolean;
  /** 이 칩은 사람 형상을 그리게 합니다(크기 기준 실루엣) — 금지 목록에서 people 을 빼야 모순이 없습니다. */
  allowsPeople?: boolean;
  /** 칩을 켰을 때 그 아래에 띄우는 안내 한 줄 */
  hint?: string;
};

export type BlueprintGroup = {
  id: string;
  label: string;
  englishLabel: string;
  description: string;
  options: BlueprintOption[];
  /**
   * 이 그룹이 어느 공간 유형에서 뜰지. 없으면 항상 뜹니다.
   *
   * 실내 배경에 조감도를 권하면 지붕만 나옵니다.
   */
  spaceKinds?: SpaceKind[];
};

const option = (
  id: string,
  label: string,
  english: string,
  englishBy?: Partial<Record<SpaceKind, string>>,
): BlueprintOption => ({
  id,
  label,
  english,
  ...(englishBy ? { englishBy } : {}),
});

/**
 * «도면 + 동선» 칩 문장 안의 자리표. 그림 위에 찍은 표시를 말로 옮겨 여기에 채웁니다.
 *
 * 토큰이 그대로 생성기까지 가면 그림에 «{{marks}}» 라고 적힙니다. 그래서 채우는 쪽이
 * 아니라 **읽는 쪽**(`blueprintEnglish`)에서 무조건 치웁니다 — 표시가 없으면 기본 문장으로.
 */
export const BLUEPRINT_MARKS_TOKEN = "{{marks}}";

const MARKS_FALLBACK_EN =
  "Draw two or three numbered routes along the main walking paths, each starting at an entrance.";

/**
 * 표시 하나. `imageMarkDraw.ts` 의 `LlmMark` 가 그대로 들어맞습니다.
 *
 * 타입을 import 하지 않고 구조만 적은 이유: blueprint.ts 는 어디서나 부르는 잎사귀 모듈이라
 * 그리기 모듈 쪽으로 의존을 만들지 않는 편이 안전합니다.
 */
export type BlueprintRouteMark = {
  number: number;
  kind: "anchor" | "region";
  note: string | null;
  position: { x: number; y: number };
  facingDegrees: number | null;
};

/** 0~1 자리를 도면 위의 말로. 나침반 낱말(north 등)은 쓰지 않습니다 — 그림 속 글자가 됩니다. */
function areaOfPosition(position: { x: number; y: number }): string {
  const col = position.x < 0.34 ? "left" : position.x > 0.66 ? "right" : "centre";
  const row = position.y < 0.34 ? "top" : position.y > 0.66 ? "bottom" : "middle";
  if (col === "centre" && row === "middle") return "centre";
  if (col === "centre") return `${row} centre`;
  if (row === "middle") return col;
  return `${row}-${col}`;
}

/** 앵커 화살표 각도를 도면 기준 말로. 0 이 그림의 위쪽입니다. */
function headingOf(degrees: number): string {
  const table = ["the top", "the top-right", "the right", "the bottom-right", "the bottom", "the bottom-left", "the left", "the top-left"];
  return table[Math.round((degrees % 360) / 45) % 8];
}

/**
 * 표시 목록을 «동선» 문장으로. 「도면도 같은 실내 배경 만들어서 화살표로 이동 동선 표시」
 *
 * 자유선은 시작점 하나만 실려 오므로(`describeMarksForLlm`) 경로 모양은 note 에 기댑니다.
 * note 가 한국어여도 그대로 붙입니다 — 사용자가 적은 말이 가장 정확한 재료입니다.
 */
export function renderRouteMarksEn(marks: BlueprintRouteMark[] | null | undefined): string {
  if (!marks?.length) return MARKS_FALLBACK_EN;
  return marks
    .map((mark) => {
      const area = areaOfPosition(mark.position);
      const head =
        mark.kind === "anchor"
          ? `Route ${mark.number} starts at the ${area} of the plan`
          : `Route ${mark.number} runs through the ${area} of the plan`;
      const facing = mark.facingDegrees === null ? "" : `, heading toward ${headingOf(mark.facingDegrees)}`;
      const note = mark.note ? `: ${mark.note}` : "";
      return `${head}${facing}${note}`;
    })
    .join("; ") + ".";
}

/**
 * 앵커 파노라마가 담을 **공간의 실제 넓이**(미터).
 *
 *
 * 파노라마는 **각도만 담고 거리는 담지 않습니다**(`background-scale.md`). 넓이를 안 주면 생성기가
 * 방을 제멋대로 넓히거나 좁혀서, 여섯 면으로 잘라 구도잡기에 세웠을 때 벽이 인물과 안 맞습니다.
 * 9/12 «실측 방의 사이즈를 주고 거기에 맞춰 배경을 AI 생성» 과 같은 뜻을 파노라마에도 넣습니다.
 *
 * 가로는 마스터 그림의 좌우, 깊이는 위아래입니다(앵커를 찍은 그림과 같은 방향).
 * 높이는 천장까지 — 실외면 비워 둡니다.
 */
export interface PanoramaSpace {
  width: number;
  depth: number;
  height?: number;
}

/** 파노라마 눈높이. `PANORAMA_CAMERA_BLOCK` 의 1.6 m 와 같아야 각도 단서가 맞습니다. */
const PANORAMA_EYE_M = 1.6;

export function validPanoramaSpace(space: PanoramaSpace | null | undefined): space is PanoramaSpace {
  // 실외 정육면체는 한 변(가로)만 넣습니다 — 깊이를 따로 요구하면 실외 칸이 늘 «비었음» 이 됩니다.
  return !!space && space.width > 0;
}

/**
 * 앵커에서 앞·오른쪽·뒤·왼쪽으로 **공간 끝까지의 거리**(m).
 *
 * 앵커 자리(0~1)를 마스터 그림 위 자리로 보고 가로×깊이 사각형 안에 놓은 뒤, 화살표 방향(0 = 그림 위,
 * 시계 방향)과 그 90° 씩으로 벽까지 잽니다. 앵커가 없으면 한가운데·그림 위를 앞으로 봅니다.
 * 조감도 45° 처럼 비스듬한 마스터에서는 위아래 거리가 조금 어긋나지만, «앞이 멀고 옆이 가깝다» 는
 * 틀은 맞습니다 — 생성기에 필요한 것은 그 틀입니다.
 */
export function panoramaDistances(
  space: PanoramaSpace,
  marks?: BlueprintRouteMark[] | null,
): { ahead: number; right: number; behind: number; left: number } {
  const anchor = marks?.find((mark) => mark.kind === "anchor");
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp(anchor?.position.x ?? 0.5) * space.width;
  const y = clamp(anchor?.position.y ?? 0.5) * space.depth;
  const facing = anchor?.facingDegrees ?? 0;
  const reach = (degrees: number) => {
    const rad = (degrees * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const hits: number[] = [];
    if (dx > 1e-9) hits.push((space.width - x) / dx);
    if (dx < -1e-9) hits.push(-x / dx);
    if (dy > 1e-9) hits.push((space.depth - y) / dy);
    if (dy < -1e-9) hits.push(-y / dy);
    // 벽에 붙어 선 앵커는 0 m 가 되는데, 그러면 각도 단서가 90° 로 터집니다 — 30 cm 는 떨어뜨립니다.
    return Math.max(0.3, Math.round(Math.min(...hits) * 2) / 2);
  };
  return { ahead: reach(facing), right: reach(facing + 90), behind: reach(facing + 180), left: reach(facing + 270) };
}

const meters = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} m`;

/**
 * 공간 넓이를 파노라마 칩 문장 뒤에 붙일 영문으로.
 *
 * **미터만 적으면 생성기가 안 지킵니다**(9/12 전개도에서 6×5 m 를 3.3×2.6 m 로 그림). 그래서 등장방형이면
 * 그 거리에서 **보이는 각도**를 같이 적습니다 — 벽이 천장과 만나는 선이 지평선 위 몇 도(그림 높이의 몇 분의
 * 몇)인지. 등장방형은 세로 180° 가 그림 높이 전체라 각도가 곧 자리입니다. 실외는 천장이 없으니 공간 끝에 선
 * 사람 키가 몇 도로 보이는지를 씁니다. 원통은 세로 눈금이 탄젠트라 각도 단서 없이 거리만 적습니다.
 */
export function renderPanoramaSpaceEn(
  space: PanoramaSpace,
  indoor: boolean,
  marks: BlueprintRouteMark[] | null | undefined,
): string {
  const box = panoramaBoxOf(space, indoor);
  const d = panoramaDistances(box, marks);
  const size = indoor
    ? `${meters(box.width)} wide by ${meters(box.depth)} deep with a ${meters(box.height!)} ceiling`
    : `an open area about ${meters(box.width)} across in every direction`;
  const edge = indoor ? "wall" : "edge of the open area";
  const parts = [
    `Real size of the space: ${size}.`,
    `From the camera the ${edge} is about ${meters(d.ahead)} ahead, ${meters(d.right)} to the right, ${meters(d.behind)} behind and ${meters(d.left)} to the left; keep exactly these distances, do not make the space larger or smaller.`,
  ];
  const degree = (rad: number) => Math.round((rad * 180) / Math.PI);
  const share = (deg: number) => `${Math.round((deg / 180) * 100)} % of the image height`;
  if (indoor) {
    const up = (dist: number) => degree(Math.atan((box.height! - PANORAMA_EYE_M) / dist));
    const down = (dist: number) => degree(Math.atan(PANORAMA_EYE_M / dist));
    parts.push(
      `So the line where the wall ahead meets the ceiling sits about ${up(d.ahead)} degrees above the horizon (${share(up(d.ahead))}) and the line where it meets the floor about ${down(d.ahead)} degrees below; to the right ${up(d.right)} and ${down(d.right)} degrees, behind ${up(d.behind)} and ${down(d.behind)} degrees, to the left ${up(d.left)} and ${down(d.left)} degrees.`,
    );
  } else {
    // 공간 끝에 선 1.7 m 사람의 크기 — 머리는 지평선 위 0.1 m, 발은 1.6 m 아래.
    const person = (dist: number) => degree(Math.atan(0.1 / dist) + Math.atan(PANORAMA_EYE_M / dist));
    parts.push(
      `So a 1.7 m person standing at that edge would look about ${person(d.ahead)} degrees tall ahead (${share(person(d.ahead))}), ${person(d.right)} degrees to the right, ${person(d.behind)} degrees behind and ${person(d.left)} degrees to the left.`,
    );
  }
  return parts.join(" ");
}

/**
 * 칩에 맞춘 상자 치수. 실외는 **정육면체**(한 변 = 가로) —
 * 실내 층고가 비었거나 눈높이보다 낮으면 2.4 m 로 봅니다(천장이 눈 아래면 각도 단서가 뒤집힙니다).
 */
export function panoramaBoxOf(space: PanoramaSpace, indoor: boolean): Required<PanoramaSpace> {
  if (!indoor) return { width: space.width, depth: space.width, height: space.width };
  const height = space.height && space.height > PANORAMA_EYE_M ? space.height : 2.4;
  return { width: space.width, depth: space.depth, height };
}

/** 이 칩에 쓸 만큼 넓이가 찼는가 — 실내는 깊이까지, 실외는 한 변만. */
export function spaceFitsChip(chipId: string, space: PanoramaSpace | null | undefined): space is PanoramaSpace {
  if (!validPanoramaSpace(space)) return false;
  return chipId !== PANORAMA_INTERIOR_CHIP_ID || space.depth > 0;
}

/** 우리말 칩 이름 뒤에 붙일 넓이 한 줄. */
export function describePanoramaSpaceKo(space: PanoramaSpace, indoor: boolean): string {
  return indoor
    ? `가로 ${meters(space.width)} × 깊이 ${meters(space.depth)} × 층고 ${meters(panoramaBoxOf(space, true).height)}`
    : `정육면체 한 변 ${meters(space.width)}`;
}

/**
 * ── 전개도(«등장방형») 프롬프트 한 벌 — 틀·칸·카메라는 앱이, 장소만 LLM·규칙이 ─────────────────
 *
 * 마그니픽 결과가 전부 칸 틀 위에 **항공 사진**을 덮은 모양이었습니다.
 * 받은 프롬프트가 «@표시_002 와 같은 장소를 유지한다 … 구도·배치 보존» 으로 시작하고, 칸 지시는 LLM 이 한 줄로 줄여
 * 뒤에 묻었습니다. 한글 프롬프트에는 칸 지시가 아예 없었고, 올라간 것은 한글이었습니다.
 *
 * 그래서 전개도 칩은 **틀·칸·카메라 문장을 앱이 맨 앞에 못 박고**(영문·한글 둘 다, 문서 16 에서 실제로 뽑힌 문장),
 * LLM 이나 규칙 조립은 그 안의 «장소» 자리만 채웁니다. 정체성 그림은 «무엇이 있는가» 만 가져오고 시점은 안 옮깁니다.
 */
export function composeUnfoldPrompt(
  chipId: string,
  space: PanoramaSpace | null | undefined,
  mention: string | null | undefined,
  place: { en: string; ko: string },
): { en: string; ko: string } {
  const room = isRoomUnfoldChipId(chipId) && spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, space) ? panoramaBoxOf(space, true) : null;
  const shell = chipId === ROOM_OUTER_CHIP_ID ? "outer" : "inner";
  const placeEn = place.en.trim() || "the place described in the reference";
  const placeKo = place.ko.trim() || "레퍼런스의 그 장소";
  let en: string;
  let ko: string;
  if (chipId === CUBEMAP_CHIP_ID) {
    // 실외는 한 변을 넣은 실제 크기 공간 — 안 넣었으면 문서 16 에서 쓴 50 m.
    const side = space && space.width > 0 ? space.width : OUTDOOR_DEFAULT_SIDE;
    en = buildOutdoorAreaEnglish(side, placeEn);
    ko = buildOutdoorAreaKorean(side, placeKo);
  } else if (chipId === DOME_CHIP_ID) {
    // 파노라마 돔은 틀 그림이 없어 태그 문장도 없습니다.
    const side = space && space.width > 0 ? space.width : OUTDOOR_DEFAULT_SIDE;
    return { en: buildOutdoorPanoramaEnglish(side, placeEn), ko: buildOutdoorPanoramaKorean(side, placeKo) };
  } else {
    en = buildUnfoldEnglish(room, "__PLACE__", shell).replace("__PLACE__", placeEn);
    ko = buildUnfoldKorean(room, placeKo, shell);
  }
  if (mention) {
    const outdoor = chipId === CUBEMAP_CHIP_ID;
    en = withTemplateMention(en, mention, outdoor);
    // 영문 `withTemplateMention` 과 같은 뜻. 실외만 «빈 칸에 달 없음» 이 더 붙습니다(빈 칸에 달이 한 번 더 그려지던 것).
    ko = `칸 틀 ${mention} 의 칸 자리 그대로 그립니다 — 바탕보다 조금 밝은 회색 칸마다 그림 한 장, 칸의 자리·너비·높이 그대로 칸을 가장자리까지 가득 채우고, 나머지는 평평한 중간 회색으로 비워 둡니다. 그림은 딱 여섯 장, 그림 사이·둘레에 틈·줄·외곽선·테두리 없음.${outdoor ? " 가운데 줄 각 칸에서 밝은 위 절반과 조금 어두운 아래 절반이 만나는 줄이 지평선입니다. 빈 회색 칸에는 아무것도 없습니다 — 달·별·그러데이션·그림자 없음." : ""}

${ko}`;
  }
  return { en, ko };
}

/**
 * LLM 답에서 **앱의 틀 문장을 걷어 내고 장소 묘사만** 남깁니다.
 *
 * 2026-09-15 실제: 요청에 실어 보낸 칩 문장(틀·칸·옆면 규칙 전부)을 LLM 이 영문 답에 통째로 베껴 넣고 그 뒤에 장소를
 * 붙였습니다. 그걸 `composeUnfoldPrompt` 가 다시 «PLACE:» 자리에 끼우니 틀 문장이 두 번, «PLACE: the place described
 * below» 까지 겹친 프롬프트가 나갔습니다. 템플릿으로 막아도 LLM 은 어길 수 있으니, 앱이 아는 틀 문장 줄을 글자 그대로 지웁니다.
 */
export function stripUnfoldFrame(
  text: string,
  chipId: string,
  space: PanoramaSpace | null | undefined,
  mention: string | null | undefined,
): string {
  const MARK = "";
  const pieces = new Set<string>();
  for (const withMention of [mention, null]) {
    const framed = composeUnfoldPrompt(chipId, space, withMention, { en: MARK, ko: MARK });
    for (const whole of [framed.en, framed.ko])
      for (const part of whole.split(MARK))
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          // 짧은 조각(«PLACE:» 같은 것)은 장소 문장 안의 낱말까지 지울 수 있어 뺍니다. 아래에서 따로 걷습니다.
          if (trimmed.length >= 16) pieces.add(trimmed);
        }
  }
  let out = text;
  for (const piece of [...pieces].sort((a, b) => b.length - a.length)) out = out.split(piece).join("\n");
  // 칩 문장이 장소 자리에 넣어 보내는 자리 표시.
  for (const holder of ["the place described below", "the room described below", "the building described below"])
    out = out.split(holder).join("");
  return out
    .replace(/^\s*(PLACE|장소)\s*:\s*/gim, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 프롬프트 글에 적힌 **전개도 공간 크기**를 읽습니다. 못 찾으면 null.
 *
 * 그림이 담은 공간은 생성기가 읽은 프롬프트의 크기입니다 — 뽑은 뒤 카드의 크기 칸을 바꿔도 그림은 그대로라, 세트 크기는 이 값이
 * 먼저입니다(`autoEquirectOf` 의 `promptText`). 앱이 짓는 틀 문장(`buildOutdoorAreaEnglish/Korean`, `buildRoomUnfoldEnglish`,
 * `buildUnfoldKorean`)의 꼴을 그대로 봅니다.
 */
export function unfoldSpaceFromPrompt(chips: string[], text: string | null | undefined): PanoramaSpace | null {
  if (!text) return null;
  const num = String.raw`(\d+(?:\.\d+)?)`;
  if (chips.includes(CUBEMAP_CHIP_ID) || chips.includes(DOME_CHIP_ID)) {
    // «S m by S m» · «S m × S m» · 옛 문장 «가로 S m × 세로 S m». 두 수가 같은 것만(정사각 공간) — 장소 묘사 속 다른 치수에 안 걸리게.
    const pattern = new RegExp(`${num} m (?:by|×) (?:세로 )?${num} m`, "g");
    for (const hit of text.matchAll(pattern)) {
      const side = Number(hit[1]);
      if (side > 0 && side === Number(hit[2])) return { width: side, depth: side, height: side };
    }
    return null;
  }
  if (chips.includes(ROOM_INNER_CHIP_ID) || chips.includes(ROOM_OUTER_CHIP_ID)) {
    const en = new RegExp(`${num} m wide, ${num} m deep, (?:walls )?${num} m`).exec(text);
    const ko = new RegExp(`가로 ${num} m · 깊이 ${num} m · (?:층고|벽 높이) ${num} m`).exec(text);
    const hit = en ?? ko;
    if (!hit) return null;
    const [width, depth, height] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
    return width > 0 && depth > 0 && height > 0 ? { width, depth, height } : null;
  }
  return null;
}

/** 실외 등장방형의 한 변을 안 넣었을 때(m). 문서 16 §10 에서 성공한 50 m 정육면체. */
export const OUTDOOR_DEFAULT_SIDE = 50;

export { OUTDOOR_EYE_HEIGHT };

/**
 * 한 변 S m 실외 세트를 구도잡기 방에 세울 크기 — S × S × (S/2 + 눈높이), 옆면 아래 (0.5 − 눈높이/S) 를 버림.
 * 기하는 `CompositionRoom.sideCropBottom` 주석.
 */
export function outdoorFaceSetSize(side: number): { width: number; depth: number; height: number; cropBottom: number } {
  const s = side > 0 ? side : OUTDOOR_DEFAULT_SIDE;
  const eye = Math.min(OUTDOOR_EYE_HEIGHT, s / 2);
  return { width: s, depth: s, height: Math.round((s / 2 + eye) * 100) / 100, cropBottom: Math.round((0.5 - eye / s) * 10000) / 10000 };
}

/** 고른 칩 가운데 전개도 칩. 없으면 null. */
export function unfoldChipOf(selected: string[] | undefined): string | null {
  return (selected || []).find(isUnfoldChipId) ?? null;
}

/** 전개도에서 정체성 그림(항공 마스터)의 **시점을 끌어오지 않게** 막는 금지 낱말. */
export const UNFOLD_NEGATIVE_EN =
  "aerial view, bird's-eye view, drone shot, looking down onto tree tops or roofs, same composition as the reference, copied layout of the reference image, a single landscape photo instead of the grid, outlines or frames around pictures, coloured strips, walls tinted in different colours, extra pictures in the grey area, more than six pictures, a moon in the empty grey cells, the same moon repeated, tripod, camera equipment, photographer";
export const UNFOLD_NEGATIVE_KO =
  "항공 시점, 조감도, 드론 사진, 나무 꼭대기나 지붕을 내려다본 모습, 레퍼런스와 같은 구도, 칸을 무시한 풍경 사진 한 장, 그림 둘레의 테두리, 색 띠, 벽마다 다른 색으로 물듦, 회색 자리에 더 그린 그림, 여섯 장보다 많은 그림, 빈 회색 칸의 달, 되풀이된 달, 삼각대, 촬영 장비, 찍는 사람";

/** 파노라마 돔의 금지 낱말 — 칸·틀 이야기 대신 콜라주·칸 나눔·항공 시점. */
export const DOME_NEGATIVE_EN =
  "aerial view, bird's-eye view, drone shot, looking down onto tree tops or roofs, collage, split into panels, borders, frames, tilted horizon, curved horizon, giant moon, the same moon repeated, trees standing in the foreground, tripod, camera equipment, photographer";
export const DOME_NEGATIVE_KO =
  "항공 시점, 조감도, 드론 사진, 나무 꼭대기나 지붕을 내려다본 모습, 콜라주, 칸 나눔, 테두리, 액자, 기울어진 지평선, 휜 지평선, 거대한 달, 되풀이된 달, 앞쪽에 선 나무, 삼각대, 촬영 장비, 찍는 사람";

/** 전개도·돔 칩에 붙일 금지 낱말. */
export function unfoldNegativeOf(chipId: string): { en: string; ko: string } {
  return chipId === DOME_CHIP_ID ? { en: DOME_NEGATIVE_EN, ko: DOME_NEGATIVE_KO } : { en: UNFOLD_NEGATIVE_EN, ko: UNFOLD_NEGATIVE_KO };
}

/**
 * «구성» 으로 놓을 생성기의 **비율**.
 *
 * 2026-09-15 나노 바나나 결과: «구성» 이 비율을 안 넘겨 늘 16:9 로 놓였고, 4:3 큐브맵 틀이 가로로 늘어나 가운데 줄에
 * 다섯 칸 넘게 그려졌습니다. 전개도는 틀과 **같은 비율**이라야 칸이 그대로 옵니다. 마그니픽이 받는 비율 가운데 가장 가까운 것.
 */
export function backgroundComposeAspect(
  selected: string[] | undefined,
  space: PanoramaSpace | null | undefined,
): string | null {
  const chip = unfoldChipOf(selected);
  if (chip === CUBEMAP_CHIP_ID) return "4:3";
  // 파노라마는 2:1 이 맞지만 나노 바나나 프로에 없어 가장 가까운 16:9(`buildOutdoorPanoramaEnglish` 주석).
  if (chip === DOME_CHIP_ID) return "16:9";
  if (chip && spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, space)) {
    const box = panoramaBoxOf(space, true);
    const ratio = (2 * box.depth + 2 * box.width) / (2 * box.depth + box.height);
    const choices: [string, number][] = [
      ["1:1", 1],
      ["4:3", 4 / 3],
      ["3:2", 3 / 2],
      ["16:9", 16 / 9],
      ["21:9", 21 / 9],
      ["3:4", 3 / 4],
      ["2:3", 2 / 3],
      ["9:16", 9 / 16],
    ];
    return choices.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best))[0];
  }
  return backgroundAspect(selected);
}

/** 전개도 칩의 본문 — 방 칩은 방 크기가 차 있으면 실측 치수로 다시 짓습니다. */
function unfoldEnglishOf(item: BlueprintOption, text: string, space?: PanoramaSpace | null): string {
  if (item.id === CUBEMAP_CHIP_ID && space && space.width > 0)
    return buildOutdoorAreaEnglish(space.width, "the place described below");
  if (item.id === DOME_CHIP_ID && space && space.width > 0)
    return buildOutdoorPanoramaEnglish(space.width, "the place described below");
  if (!isRoomUnfoldChipId(item.id) || !spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, space)) return text;
  const outer = item.id === ROOM_OUTER_CHIP_ID;
  return buildUnfoldEnglish(
    panoramaBoxOf(space, true),
    outer ? "the building described below" : "the room described below",
    outer ? "outer" : "inner",
  );
}

/**
 * 전개도 문장이 **틀 그림을 이름으로** 부르게 합니다.
 *
 * 칩 문장은 «the attached colour
 * map» 이라고만 적어서, 마그니픽 생성기가 올라간 그림 둘(정체성 기준·틀) 중 어느 것이 칸 틀인지 몰랐고 LLM 도 태그를
 * 안 붙였습니다. 틀의 태그를 문장 맨 앞에 박아 둡니다 — 규칙 조립은 그대로 나가고, LLM 은 이 문장을 앞에 두라고 시킵니다.
 */
function withTemplateMention(text: string, mention?: string | null, outdoor = false): string {
  if (!mention) return text;
  /*
    2026-09-15 마그니픽 MCP · 나노 바나나 프로로 고른 문장입니다. 틀은 바탕과 거의 같은 회색 칸이라(`buildUnfoldTemplate`) 색 이름을
    부르지 않습니다 — 색 틀 시절에는 틀 색이 테두리로 남고 벽이 물들었습니다. «칸의 자리·너비·높이 그대로 가득» 을 빼면 그림을 칸보다
    작게 그려 칸 사이에 틈이 났습니다. 실외는 빈 회색 칸(윗줄 3열)에 달이 한 번 더 그려지는 일이 잦아 그 금지를 더합니다.
  */
  const empty = outdoor
    ? " In the middle row, the line where the lighter upper half meets the slightly darker lower half of each square is the horizon line. The empty grey cells contain nothing at all - no moon, no stars, no gradient, no shadow."
    : "";
  return `Lay the picture out exactly on the grid map ${mention}: each slightly lighter grey rectangle there is where one picture goes, and the picture fills that rectangle completely, edge to edge, keeping exactly its position, width and height; everything else stays empty flat mid-grey. Exactly six pictures, no gaps, lines, outlines or borders between or around them.${empty}

${text}`;
}

/**
 * 칩의 영문 문장. 공간 유형별 문장이 있으면 그것을, 없으면 공통 문장을 돌려줍니다.
 *
 * `marks` 를 주면 `{{marks}}` 자리에 동선 문장이 들어갑니다. 안 줘도 토큰은 반드시 사라집니다.
 * `space` 를 주면 앵커 파노라마 칩(등장방형·원통) 뒤에 공간 넓이 문장이 붙습니다.
 */
export function blueprintEnglish(
  item: BlueprintOption,
  spaceKind?: SpaceKind,
  marks?: BlueprintRouteMark[] | null,
  space?: PanoramaSpace | null,
  /** 전개도 틀 그림을 부르는 글자(마그니픽이면 `@파일이름`). 있으면 전개도 칩 문장이 그 그림을 이름으로 가리킵니다. */
  templateMention?: string | null,
): string {
  const base = (spaceKind && item.englishBy?.[spaceKind]) || item.english;
  const text = base.includes(BLUEPRINT_MARKS_TOKEN)
    ? base.replace(BLUEPRINT_MARKS_TOKEN, renderRouteMarksEn(marks))
    : base;
  if (isUnfoldChipId(item.id))
    return withTemplateMention(unfoldEnglishOf(item, text, space), templateMention, item.id === CUBEMAP_CHIP_ID);
  if (isEquirectChipId(item.id) && spaceFitsChip(item.id, space))
    return `${text}. ${renderPanoramaSpaceEn(space, item.id === PANORAMA_INTERIOR_CHIP_ID, marks)}`;
  return text;
}

export const CHARACTER_BLUEPRINT_GROUPS: BlueprintGroup[] = [
  {
    id: "identity",
    label: "정체성·체형 기준",
    englishLabel: "Identity and body continuity",
    // 키·체형은 캐릭터 기본 정보에서 그대로 가져다 씁니다.
    // 같은 값을 토글로 또 고르게 하면 둘이 어긋날 때 어느 쪽이 맞는지 알 수 없습니다.
    description: "장면이 바뀌어도 같은 인물로 읽히게 하는 기준 이미지",
    options: [
      option("body-front", "기준 전신", "canonical front full-body identity reference, 0 degrees facing camera, neutral balanced pose"),
      option("body-left", "좌측 전신", "full-body view rotated 90 degrees so the character's LEFT side faces the camera, character faces the left edge of the frame, consistent proportions"),
      // 좌측은 90°, 우측은 **270°** 로 적습니다. 둘 다 90° 라고 쓰면 한글 번역에서
      // 「패널 2도 90도, 패널 3도 90도」 가 나와 어느 쪽인지 알 수 없습니다. (지시 291)
      option("body-right", "우측 전신", "full-body view rotated 270 degrees (the opposite direction from the left-side panel) so the character's RIGHT side faces the camera, character faces the right edge of the frame, consistent proportions"),
      option("body-back", "후면 전신", "full-body view rotated 180 degrees, back of the character facing camera, showing silhouette and hairstyle continuity"),
      option("body-three-quarter", "3/4 전신", "three-quarter full-body hero reference rotated 45 degrees, readable silhouette"),
    ],
  },
  {
    id: "face-head",
    label: "얼굴·헤어 기준",
    englishLabel: "Face and hair continuity",
    description: "얼굴 정체성과 헤어스타일을 고정하는 근접 기준 이미지",
    options: [
      option("face-front", "얼굴 정면", "front face close-up, 0 degrees facing camera, neutral expression and clear facial identity"),
      option("face-left", "얼굴 좌측", "face close-up rotated 90 degrees so the character's LEFT cheek faces the camera, facing the left edge of the frame, showing nose, jawline, and hairline"),
      option("face-right", "얼굴 우측", "face close-up rotated 270 degrees (the opposite direction from the left-side panel) so the character's RIGHT cheek faces the camera, facing the right edge of the frame, showing nose, jawline, and hairline"),
      option("face-back", "헤어 후면", "magnified crop of the head from the 180-degree back view, identical hairstyle shape, parting, braid or tie, and identical non-human features such as ears or horns as the back full-body panel"),
      option("face-three-quarter", "얼굴 3/4", "three-quarter face close-up at the same portrait distance and light direction"),
      option("face-eyes", "눈·시선", "eye shape, iris detail, and characteristic gaze close-up"),
      option("face-skin", "피부·메이크업", "skin texture, complexion, and makeup continuity close-up"),
    ],
  },
  {
    id: "performance",
    label: "연기·동작 단서",
    englishLabel: "Performance and motion anchors",
    description: "영상에서 자연스러운 표정과 동작을 만들기 위한 시작 자세와 접점",
    options: [
      option("expression-neutral", "무표정", "neutral baseline expression for continuity between shots"),
      option("expression-smile", "미소", "subtle smile expression with the same facial proportions"),
      option("expression-joy", "기쁨", "open joyful expression with natural eye and mouth shapes"),
      option("expression-sadness", "슬픔", "restrained sad expression with readable eyes"),
      option("expression-anger", "분노", "controlled angry expression without changing facial identity"),
      option("expression-fear", "공포", "fearful reaction expression with believable eye direction"),
      option("expression-surprise", "놀람", "surprised reaction expression with natural facial anatomy"),
      option("expression-contempt", "경멸", "contemptuous or skeptical expression with subtle asymmetry"),
      option("expression-determined", "결연함", "determined expression with a stable focused gaze"),
      option("pose-rest", "정지 시작 자세", "neutral ready pose that works as a clean image-to-video starting frame"),
      option("pose-action", "핵심 동작 자세", "clear key pose that communicates the intended action without motion blur"),
      option("hands-front", "손 형태", "clean hand anatomy and finger-shape reference"),
      option("hands-action", "손 상호작용", "hand gesture or grip reference for interacting with a prop"),
      // 신발 "디자인" 은 의상 쪽 항목입니다. 여기는 발이 땅에 어떻게 닿는지만 봅니다.
      // 예전에는 양쪽 다 "발·신발" 이라 이름만으로는 무엇이 다른지 알 수 없었고,
      // 둘 다 켜면 거의 같은 그림이 두 칸 나왔습니다.
      option("feet-contact", "발 접지·무게중심", "close-up of how both feet meet the ground in the standing pose, weight distribution and ground contact, footwear shown only as silhouette"),
    ],
  },
  {
    id: "wardrobe",
    label: "외형·의상 연속성",
    englishLabel: "Appearance and wardrobe continuity",
    description: "컷이 바뀌어도 유지되어야 하는 외형, 의상, 소재 정보",
    options: [
      option("hair", "헤어 스타일", "hairstyle, hairline, length, and styling continuity"),
      // 메이크업은 얼굴·헤어 기준의 "피부·메이크업" 과 같은 칸이라 뺐습니다.
      // 두 곳에 두면 둘 다 켜졌을 때 같은 클로즈업이 두 칸 나옵니다.
      option("outfit-full", "의상 전체", "complete wardrobe look with all layers visible"),
      option("outfit-detail", "의상 디테일", "garment construction, fabric, seams, fastenings, and material close-up"),
      option("outfit-back", "의상 후면", "back of the complete outfit, showing closures, hood, cape, or back detail"),
      /*
        ── 장신구와 소지품은 **다른 것**입니다 ──────────────────────────
        

        여태 한 칩(「장신구·소지품」)이라 둘이 같이 딸려 왔습니다. 그런데 이 둘은
        레퍼런스로서 **정반대**입니다. 목걸이는 그 사람의 외형이라 전신·얼굴 칸에
        늘 보여야 하고, 가방은 그 사람이 아니어서 인물 칸에 있으면 생성기가
        사람과 물건을 한 덩어리로 읽습니다(같은 날 사용자의 소품 지시).

        경계는 **「손을 펴면 떨어지는가」** — 걸친 것은 인물, 드는 것은 소품.
        그래서 드는 것은 여기서 빼고 「소품·상호작용」 그룹으로 보냅니다.
      */
      option("accessory", "장신구", "worn accessories that are part of the character's body silhouette — jewelry, earrings, rings, watch, glasses, badges; these must also appear consistently in the full-body and face close-up panels, not only in their own panel"),
      option("footwear", "신발 디자인", "footwear design, material, and sole shape close-up"),
    ],
  },
  {
    id: "props",
    label: "소품·상호작용",
    englishLabel: "Props and interaction",
    // 「연기·동작 단서」의 손 항목은 «손이 어떻게 생겼나» 이고, 여기는
    // «무엇을 들고 어떻게 쓰나» 입니다. 둘을 한 그룹에 두었더니 소품을
    // 쥔 손만 나오고 소품 자체가 어떻게 생겼는지는 아무 데도 안 남았습니다.
    description: "이 인물이 늘 지니는 물건과, 그것을 다루는 모습",
    options: [
      // 옛 「장신구·소지품」 의 «소지품» 쪽이 여기로 왔습니다(위 `accessory` 주석).
      option("prop-carry", "지니는 소품", "the props this character always carries, laid out on their own — separate from the character, never held, so the sheet cannot bind object and person together"),
      option("prop-hold", "쥐는 방법", "how the character grips and carries each prop, hand position and angle"),
      option("prop-in-use", "쓰는 모습", "the character actually using the prop, showing the working posture"),
      option("prop-worn", "착용 상태", "props worn on the body such as a bag, holster, or strap, and where they sit"),
      option("prop-scale", "크기 기준", "the prop next to the character for size, so it does not grow or shrink between cuts"),
      // 소품을 뺀 판이 있어야 «소품 없는 장면» 을 뽑을 때 다시 안 만들어도 됩니다.
      option("prop-none", "소품 없는 판", "the same character with every prop removed, empty hands, for shots where nothing is carried"),
    ],
  },
  {
    id: "color",
    label: "색·재질 기준",
    englishLabel: "Color and material reference",
    // 색상 스와치는 다음 시트에서 색이 틀어졌는지 재는 «자» 입니다.
    // 이게 없으면 «조금 어두워진 것 같다» 를 눈대중으로 판단해야 합니다.
    description: "다음 시트에서 색이 틀어졌는지 잴 수 있는 기준",
    options: [
      option("color-palette", "색상 스와치", "flat color swatch strip of the character's key colors, hair, skin, and each garment layer, plain labeled patches with no shading"),
      option("material-detail", "재질 확대", "macro detail of the dominant fabrics and materials under neutral light"),
    ],
  },
];

/**
 * 공간이 실내인지 실외인지.
 *
 * 마스터 이미지의 종류가 여기서 갈립니다. 실외는 조감도가 통하지만 실내는
 * 지붕에 막혀 아무것도 안 보입니다. 천장을 걷어 낸 배치도나 단면도라야 합니다.
 */
export type SpaceKind = "exterior" | "interior" | "mixed";

export const SPACE_KIND_OPTIONS: { id: SpaceKind; label: string; hint: string }[] = [
  { id: "exterior", label: "실외", hint: "하늘이 열린 곳. 위에서 내려다볼 수 있습니다" },
  { id: "interior", label: "실내", hint: "천장이 막힌 곳. 걷어 내거나 잘라야 보입니다" },
  { id: "mixed", label: "실내외", hint: "마당 딸린 집처럼 둘이 이어진 곳" },
];

/** «2차 · 앵커에서 보기» 그룹 id. 사용 방법 토글이 이 그룹 머리 옆에 붙습니다. */
export const ANCHOR_PANORAMA_GROUP_ID = "anchor-views";
/**
 * 옛 등장방형 한 칩 id(실내·실외를 가르기 전). 옛 프로젝트·이력에 남아 있어 **읽기만** 합니다 —
 * 실내 카드면 실내 칩, 아니면 실외 칩으로(`blueprintForSpace`, `LEGACY_BACKGROUND_CHIP_ALIAS`).
 *
 * 처음 가를 때는 실외 칩이 이 id 를 물려받았는데, 그러면 «실내 카드에서 사람이 실외 칩을 고른 것» 과
 * «옛 한 칩이 남은 것» 을 가를 수 없어 실내 카드의 실외 선택이 실내로 뒤집혔습니다. 그래서 둘 다 새 id 입니다.
 */
export const LEGACY_PANORAMA_CHIP_ID = "space-panorama";
/** 실외 등장방형 칩 id(정육면체). */
export const PANORAMA_CHIP_ID = "space-panorama-exterior";
/** 실내 등장방형 칩 id(가로·깊이·층고). */
export const PANORAMA_INTERIOR_CHIP_ID = "space-panorama-interior";
/**
 * «방 바깥쪽 · 외벽 전개도» 칩 id — 방 상자의 **바깥 껍질**(건물 외벽·지붕)을 뽑습니다.
 *
 * , 「방 안쪽이랑 방 바깥쪽 면
 * 말하는 거야」. 방 바깥쪽 네 벽은 **한 자리에서 360° 로 찍는 등장방형으로는 담을 수 없습니다** — 방 밖 어디에
 * 서도 벽은 두 면까지만 보이고, 지붕은 안 보입니다. 그래서 바깥쪽은 같은 방 크기로 짓는 **외벽 전개도**(틀 그림 +
 * 프롬프트, 구도잡기 «바깥면(외벽)» 과 같은 `buildUnfoldPrompt`)입니다. 들어온 전개도는 자동으로 잘려
 * «<장소>_외벽» 세트가 되고, 구도잡기에서 그 세트를 걸면 바깥 껍질로 들어갑니다.
 */
export const ROOM_OUTER_CHIP_ID = "space-room-outer";
/** «전개도 · 실외 (큐브맵)» 칩 id — 트인 곳을 한 점에서 본 90° 여섯 장(문서 16 §6). */
export const CUBEMAP_CHIP_ID = "space-cubemap";

/**
 * «파노라마 · 실외 돔» 칩 id — 등장방형 한 장을 구도잡기의 지면 투영 돔에 감습니다(`buildPanoramaDome`).
 *
 * 한가운데에서는 이음매 없이
 * 가장 자연스럽고, 카메라가 가운데서 멀어지면 바닥이 번져서 제자리 컷용입니다. 전개도 칩과 같은 «장소만 LLM, 틀은 앱» 길을 타되
 * 틀 그림·자동 자르기는 없습니다(`isUnfoldChipId` 에는 들고, 틀·자르기 판정에서만 뺍니다).
 */
export const DOME_CHIP_ID = "space-panorama-dome";

/** 실외 크기(한 변)를 쓰는 칩인가 — 전개도 실외와 파노라마 돔. */
export const isOutdoorSpaceChipId = (id: string) => id === CUBEMAP_CHIP_ID || id === DOME_CHIP_ID;

/**
 * «전개도 · 방 안쪽» 칩 id.
 * 방 안쪽은 등장방형(360°) 말고도 전개도로 뽑을 수 있습니다 — 벽이 휘지 않고 곧게 나오는 대신 앵커 시점이 없습니다.
 * 바깥쪽 전개도와 틀 그림·치수를 같이 씁니다.
 */
export const ROOM_INNER_CHIP_ID = "space-room-inner";

/** 방 전개도(안쪽·바깥쪽) 칩인가 — 방 크기를 씁니다. */
export const isRoomUnfoldChipId = (id: string) => id === ROOM_INNER_CHIP_ID || id === ROOM_OUTER_CHIP_ID;
/** 2차 전개도 칩(실외 큐브맵·방 안쪽·방 바깥쪽)인가 — 틀 그림이 필요합니다. */
export const isUnfoldChipId = (id: string) => id === CUBEMAP_CHIP_ID || id === DOME_CHIP_ID || isRoomUnfoldChipId(id);

/**
 * 고른 칩에 맞는 **공간 크기**. 방(안쪽 등장방형·안쪽/바깥쪽 전개도)은 한 벌을 같이 쓰고, 실외는 따로입니다.
 *
 * 한 칸에 두었더니 숲(정육면체 50 m)을 넣고
 * 방 칩으로 바꾸면 방이 50×50×50 m 가 되고, 방을 12×15 로 고치면 숲이 12 m 정육면체가 됐습니다.
 */
export function spaceForChips(
  chips: string[] | undefined,
  room: PanoramaSpace | null | undefined,
  exterior: PanoramaSpace | null | undefined,
): PanoramaSpace | null {
  const list = chips || [];
  return list.includes(CUBEMAP_CHIP_ID) || list.includes(DOME_CHIP_ID) || list.includes(PANORAMA_CHIP_ID) ? exterior ?? null : room ?? null;
}
/**
 * 원통 파노라마 칩 id — **칩은 2026-09-15 에 뺐습니다**. 등장방형이 자동으로 잘리게
 * 되면서 원통(하늘·바닥을 앱이 색으로 채우고 세로 화각을 손으로 맞춰야 하는 길)은 쓸 일이 없어졌습니다.
 * 옛 저장값을 읽는 판정이 남아 있어 글자만 둡니다. 원통 그림은 여전히 가위 → 파노라마 탭에서 손으로 폅니다.
 */
export const PANORAMA_CYL_CHIP_ID = "space-panorama-cyl";

/** 등장방형(실외·실내) 칩인가. */
export const isEquirectChipId = (id: string) =>
  id === PANORAMA_CHIP_ID || id === PANORAMA_INTERIOR_CHIP_ID || id === LEGACY_PANORAMA_CHIP_ID;

/**
 * 공간 유형에 맞게 옛 등장방형 id 를 읽습니다 — 실내 카드에 남은 `space-panorama`(칩을 가르기 전 한 칩)는 실내 칩으로.
 * 저장값을 조용히 고치지 않고 **읽을 때만** 갈아 끼웁니다(사람이 칩을 누르면 그때 새 id 로 저장됩니다).
 */
export function blueprintForSpace(selected: string[] | undefined, spaceKind?: SpaceKind | null): string[] {
  const list = selected || [];
  /*
    등장방형 칩은 2026-09-15 에 걷었습니다(2차는 전개도 세 벌 — `CUBEMAP_CHIP_ID` 위 주석). 옛 저장값은 뜻이 가장 가까운
    전개도로 읽습니다: 옛 한 칩은 카드가 실내면 방 안쪽, 아니면 실외 큐브맵 / 실외 등장방형 → 큐브맵 / 방 안쪽 등장방형 → 방 안쪽.
  */
  const read = (id: string) =>
    id === LEGACY_PANORAMA_CHIP_ID
      ? spaceKind === "interior"
        ? ROOM_INNER_CHIP_ID
        : CUBEMAP_CHIP_ID
      : id === PANORAMA_CHIP_ID
        ? CUBEMAP_CHIP_ID
        : id === PANORAMA_INTERIOR_CHIP_ID
          ? ROOM_INNER_CHIP_ID
          : id;
  return list.some((id) => read(id) !== id) ? list.map(read) : list;
}

/** 파노라마·정면 계열이 함께 쓰는 금지 목록. «anchor·arrow» 는 그림 속 기호로 그려지기 때문입니다. */
const ANCHOR_NEGATIVE =
  "aerial view, bird's-eye view, top-down, overhead, drone shot, map, plan, cutaway, grid, panels, split screen, text, labels, letters, watermark, vignette, anchor symbol, arrow, compass, people";

/**
 * 고른 칩에 앵커 파노라마(등장방형·원통)가 있는지.
 *
 * 이 값이 변형 템플릿의 `panorama=yes` 를 켭니다 — «구도를 베끼지 마라» 지시가 여기 달려 있습니다.
 * 눈높이 한 장(정면 등)이나 가이드 리페인트는 파노라마가 아니므로 세지 않습니다.
 * 옛 여섯 면 칩(`space-front` 등)도 세지 않습니다.
 */
export function hasPanoramaChip(selected: string[] | undefined): boolean {
  return Boolean(
    selected?.some((id) => isEquirectChipId(id) || id === PANORAMA_CYL_CHIP_ID),
  );
}

/**
 * 배경은 두 단계로 만듭니다.
 *
 * 1차 — 그 공간 전체를 한눈에 보는 «마스터 이미지» 를 만듭니다.
 * 2차 — 그 그림 위에 앵커를 찍고, 그 지점에서 360° 파노라마를 뽑습니다. 여섯 면은
 * 앱의 파노라마 탭이 그 한 장에서 잘라냅니다.
 *
 * 이렇게 나눈 이유는, 여섯 면을 처음부터 따로 만들면 같은 장소로 안 보이기
 * 때문입니다. 먼저 하나의 공간을 정해 놓고 거기서 방향만 바꿔야 이어집니다.
 */
export const BACKGROUND_BLUEPRINT_GROUPS: BlueprintGroup[] = [
  {
    id: "master",
    label: "1차 · 전체 보기 (마스터)",
    englishLabel: "Master overview",
    /*
      예전에는 실외 그룹·실내 그룹으로 나뉘어 있었고, 마스터를 몇 개든 켤 수 있었습니다.
      그러면 조감도 + 배치도 + 진입 전경이 «칸 3개 시트» 로 조립돼 아무 데도 쓸 수 없는
      그림이 나왔습니다. 마스터는 **한 장**이라야 거기에 앵커를 찍을 수 있습니다.
      그래서 한 그룹으로 합치고 칩 단위로 실내·실외를 가르며, 하나만 켜지게 했습니다.
    */
    description: "장소 전체를 한눈에 보는 1차 한 장. 하나만 고릅니다 — 여기에 앵커를 찍습니다",
    options: [
      {
        id: "master-birdseye",
        label: "조감도 45°",
        result: "45° 위에서 내려다본 한 장. 길·건물·숲 덩어리의 배치와 높낮이가 보임",
        use: "실외 기본 마스터 · 앵커 찍기 · 구도잡기 배치",
        frame: "1:1 한 장",
        aspect: "1:1",
        role: "frame",
        exclusiveGroup: "master",
        spaceKind: "exterior",
        mapLike: true,
        // «bird's-eye» 만 두면 미드저니가 드론 사진이나 틸트시프트 미니어처로 빠집니다.
        // 「실제 장소로, 도해나 장난감 모형이 아니라」 를 문장 안에 못 박습니다.
        english:
          "One single image, oblique bird's-eye view from about 45 degrees above, the camera high enough that the whole location fits in the frame with a small margin, perspective view with the heights of buildings, terrain, paths, water and tree masses clearly readable and their relative sizes and distances easy to judge, rendered as the real place with real materials at real scale",
        negativeEnglish: "text, labels, arrows, grid, panels, borders, fisheye, tilt-shift miniature, toy model, diagram",
      },
      {
        id: "master-topdown",
        label: "항공 수직",
        result: "바로 위에서 수직으로 내려본 지도 같은 한 장. 지붕과 길만 보임",
        use: "거리·방위 재기 · 앵커 좌표 찍기 · 도면+동선의 바탕",
        frame: "1:1 한 장",
        aspect: "1:1",
        role: "frame",
        exclusiveGroup: "master",
        spaceKind: "exterior",
        mapLike: true,
        // «north at the top» 은 생성 그림에서 뜻이 없고(위가 곧 북) «N» 글자만 유도합니다.
        // «orthographic» 만으로는 45° 로 기울어지는 일이 잦아 «정확히 수직 아래» 를 덧붙입니다.
        english:
          "One single image, straight-down orthographic aerial photograph of the whole location, the camera pointing exactly straight down with no tilt, like a satellite photo: only rooftops, roads, paths, water and tree canopies are visible, soft even overcast daylight so that shadows do not hide the ground",
        negativeEnglish: "map interface, pins, road names, text, labels, grid, panels, borders, perspective tilt",
      },
      {
        id: "master-isometric",
        label: "등각 디오라마",
        result: "땅덩이를 네모나게 잘라 낸 등각 디오라마 한 장. 건물 높이와 지형이 입체로 보임",
        use: "언덕·다층처럼 높낮이가 중요한 장소 · 구도잡기 참고",
        frame: "1:1 한 장",
        aspect: "1:1",
        role: "frame",
        exclusiveGroup: "master",
        spaceKind: "exterior",
        mapLike: true,
        // 등각은 35.26° 입니다. «30도» 라고 쓰면 2점 부등각에 가까워집니다.
        english:
          "One single image, isometric diorama of the whole location cut out as a floating block of ground with straight cut edges, isometric projection from about 35 degrees above at a 45-degree corner angle, parallel lines stay parallel with no perspective convergence, buildings, terrain, paths and trees modelled at full height with real materials and real scale, plain neutral background around the block",
        negativeEnglish: "text, labels, grid, panels, toy model, tilt-shift, perspective",
      },
      {
        id: "master-floorplan",
        label: "도면",
        result: "천장을 걷고 바로 위에서 본 도면 한 장. 벽·문·창·가구 배치와 방 이름 라벨",
        use: "실내 기본 마스터 · 앵커 찍기 · 동선 계획",
        frame: "1:1 한 장",
        aspect: "1:1",
        role: "frame",
        exclusiveGroup: "master",
        spaceKind: "interior",
        mapLike: true,
        allowsLabels: true,
        // «floor plan» 만 두면 벽에 원근이 붙은 3D 렌더 도면이 나옵니다. «flat 2D» 를 못 박습니다.
        english:
          "One single image, flat 2D floor plan of the whole space seen straight down with the ceiling removed, orthographic with no perspective, walls as thick dark lines, door swings and window openings drawn, every piece of furniture and every fixture drawn from above in its exact position, floor materials lightly tinted, short English room labels",
        negativeEnglish: "people, perspective, 3D render, panels, borders",
      },
      {
        id: "master-floorplan-route",
        label: "도면 + 동선",
        result: "도면 위에 번호 붙은 화살표로 이동 경로를 그린 한 장. 시작점은 점, 끝은 화살촉",
        use: "씬의 동선 설계 · 컷 순서 정하기 — 그림에 찍은 표시(앵커·자유선·메모)가 화살표로 옮겨집니다",
        frame: "1:1 한 장",
        aspect: "1:1",
        role: "frame",
        exclusiveGroup: "master",
        spaceKind: "both",
        mapLike: true,
        allowsLabels: true,
        /*
          (2026-09-09)
          «arrow» 낱말은 파노라마 칩에서는 금지지만 여기서는 화살표가 목적입니다.
          `{{marks}}` 는 blueprintEnglish 가 반드시 치웁니다 — 남으면 그림에 글자로 그려집니다.
        */
        english: `One single image, flat 2D floor plan of the whole space seen straight down with the ceiling removed, orthographic, walls as thick dark lines, doors, windows and furniture drawn in their exact positions, floor lightly tinted, short English room labels; on top of the plan, bold coloured movement routes drawn as numbered arrows: each route starts with a filled dot and its number in a small circle, follows the walkable path around furniture and through doorways, and ends with an arrowhead. ${BLUEPRINT_MARKS_TOKEN}`,
        englishBy: {
          exterior: `One single image, straight-down site plan of the whole location, orthographic like a map, buildings as outlined footprints, roads, paths, water and tree masses drawn clearly, short English place labels; on top of the plan, bold coloured movement routes drawn as numbered arrows: each route starts with a filled dot and its number in a small circle, follows the walkable path along roads and trails, and ends with an arrowhead. ${BLUEPRINT_MARKS_TOKEN}`,
          // 실내외 혼합(마당 딸린 집)에서 실내 문장만 쓰면 마당이 통째로 사라집니다.
          mixed: `One single image, flat 2D plan seen straight down: the building with its ceiling removed as a floor plan (walls as thick dark lines, doors, windows and furniture in their exact positions) and the surrounding grounds drawn around it as a site plan in the same drawing (paths, yard, water, tree masses), short English labels; on top of the plan, bold coloured movement routes drawn as numbered arrows: each route starts with a filled dot and its number in a small circle, follows the walkable path through doorways and along the outside paths, and ends with an arrowhead. ${BLUEPRINT_MARKS_TOKEN}`,
        },
        negativeEnglish: "people, perspective, panels",
        hint: "그림에 앵커·선·메모를 찍어 두면 그 번호와 방향이 그대로 화살표 설명이 됩니다",
      },
      {
        id: "master-dollhouse",
        label: "돌하우스 컷어웨이",
        result: "천장과 앞쪽 두 벽을 걷어 낸 45° 인형집 한 장. 방 안 가구와 벽·바닥 재질이 보임",
        use: "실내외 혼합·다층 집의 기본 마스터 · 구도잡기 배치",
        frame: "1:1 한 장",
        aspect: "1:1",
        role: "frame",
        exclusiveGroup: "master",
        spaceKind: "interior",
        mapLike: true,
        // 예전 문장의 «isometric feel with little perspective» 는 «feel»·«little» 이 모호해
        // 모델마다 다르게 풀었습니다. 축측투영(axonometric)이라고 이름을 대고 원근을 0 으로 못 박습니다.
        english:
          "One single image, dollhouse cutaway of the whole interior: the ceiling and the two walls nearest the camera removed, axonometric view from about 45 degrees above at a corner angle with no perspective convergence, every room, doorway, piece of furniture and floor material visible in true proportion, plain neutral background outside the walls",
        englishBy: {
          mixed:
            "One single image, the building opened as a dollhouse cutaway (the ceiling and the two walls nearest the camera removed) with the surrounding yard, paths and trees kept intact around it, axonometric view from about 45 degrees above at a corner angle with no perspective convergence, every room and every outdoor feature visible in true proportion, plain neutral background beyond the grounds",
        },
        negativeEnglish: "text, labels, grid, panels, toy model, perspective",
      },
    ],
  },
  {
    id: ANCHOR_PANORAMA_GROUP_ID,
    /*
      이름을 «2차» 라고 부르지 않습니다. 마스터를 먼저 뽑던 시절의 차례이고,
      지금은 방에서 곧바로 전개도를 뽑습니다. 하는 일 그대로 부릅니다.
    */
    label: "전개도 · 파노라마 뽑기",
    englishLabel: "From the anchor point",
    /*
      예전에는 여기 북(정면)·남(후면)·서·동·천장·바닥 칩이 같이 있었습니다(2026-09-09 삭제).
      여섯 면을 생성기에 따로 시키면 같은 공간이라는 보장이 없고, 칩 문장의
      north/south 가 그림 위 «LOOKING NORTH» 라벨로 그려졌습니다. 파노라마 한 장을 뽑아
      앱의 파노라마 탭에서 계산으로 잘라내면 이음매·달 방위·조명이 저절로 맞습니다.
      옛 프로젝트에 남은 `space-front` 같은 id 는 blueprintLookup 이 모르는 id 를 버리므로 무시됩니다.
      («정면 한 장» 에 옛 `space-front` 를 이어 붙이지 않은 이유: 옛 여섯 면은 한꺼번에
      켜져 있어 배타 규칙이 깨지고, 화각도 90° 나침반 기준이라 뜻이 다릅니다.)
    */
    description: "등장방형(6면 — 전개도로 뽑아 자동으로 잘림) 또는 일반 배경 한 장 중 하나를 고릅니다",
    options: [
      /*
        ── 2차는 **전개도 세 벌** ──────────────────────────────────────────
         같은 날 등장방형 칩(실외·방 안쪽)을 다시 세웠다가 걷었습니다. 등장방형은 한 장을
        계산으로 다시 투영하니 이음매 자체는 맞지만, ① 생성기가 진짜 등장방형(위아래 늘어남)을 잘 못 그려 하늘·바닥이
        극점으로 뭉개지고 ② 90° 한 면이 가로의 1/4(2752 px 면 688 px)뿐이라 흐리며 ③ 방은 곧은 벽이 휘었습니다.
        문서 16 §10 에서 실제로 성공한 것이 이 세 벌(실외 50 m 정육면체 큐브맵 · 방 안쪽 · 방 바깥)입니다.

        **이름은 «등장방형» 입니다.** , 「등장방형 실외,
        등장방형 실내 안쪽면, 등장방형 실내 바깥쪽면 이렇게 3개」. 사용자에게 «등장방형» 은 투영 방식이 아니라 «6면
        배경» 이라는 뜻입니다 — 무엇으로 뽑는지(전개도)는 앱이 알아서 합니다. id 는 뽑는 방식 그대로 둡니다.
        틀 그림은 프롬프트를 만들 때 레퍼런스에 자동으로 들어갑니다(`usePromptCard.ensureUnfoldTemplate`).
      */
      {
        id: CUBEMAP_CHIP_ID,
        label: "등장방형 · 실외",
        result: "한 변 S m 실제 공간 한가운데 눈높이에서 본 네 방향·하늘 + 그 공간 땅 전체의 실측 지도를 십자로 편 4:3 한 장. 들어오면 여섯 면으로 자동으로 잘림",
        use: "들판·숲·해변처럼 트인 곳 · 구도잡기에서 S×S m 바닥 지도 위에 지평선이 눈높이로 맞는 방(높이 S/2+1.6 m, 옆면 아래는 잘라 붙임) · 칸이 정사각이라 나노 바나나로도 됨",
        frame: "4:3 십자 한 장",
        aspect: "4:3",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        english: buildOutdoorAreaEnglish(OUTDOOR_DEFAULT_SIDE, "the place described below"),
        negativeEnglish:
          "people, person, text, letters, watermark, fisheye, equirectangular, panorama stretch, tilted horizon, curved horizon, border, frame, grid, collage, contact sheet",
        hint: "틀 그림(정사각 칸 여섯)은 «프롬프트 작성»·«규칙 조립» 을 누를 때 레퍼런스에 자동으로 들어갑니다. 골목·마당처럼 둘러싸인 곳은 «등장방형 · 실내 안쪽면» 으로(문서 16 §8)",
      },
      {
        id: DOME_CHIP_ID,
        label: "파노라마 · 실외 돔",
        result: "한 변 S m 공터 한가운데 눈높이에서 찍은 360° 등장방형 파노라마 한 장(16:9). 구도잡기 «파노라마 돔» 에 걸면 바닥이 눈높이로 맞는 둥근 배경이 됨",
        use: "카메라가 제자리에 있는 컷(서 있는 대화·제자리 팬·틸트) · 이음매 없음 · 카메라가 가운데서 멀어지면 바닥이 번지니 무빙 컷은 «등장방형 · 실외» 로",
        frame: "16:9 파노라마 한 장",
        aspect: "16:9",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        english: buildOutdoorPanoramaEnglish(OUTDOOR_DEFAULT_SIDE, "the place described below"),
        negativeEnglish:
          "people, person, text, letters, watermark, collage, split panels, border, frame, tilted horizon, aerial view, drone shot, giant moon",
        hint: "틀 그림이 없고 자동으로 자르지도 않습니다. 구도잡기 환경 탭 → «배경 이미지 목록» 에서 «파노라마 돔에 걸기» 로 겁니다.",
      },
      {
        id: ROOM_INNER_CHIP_ID,
        label: "등장방형 · 실내 안쪽면",
        result: "방 안쪽 네 벽·천장·바닥을 십자로 펼친 한 장. 벽이 곧게 나옴. 들어오면 여섯 면으로 자동으로 잘림",
        use: "방 안쪽 껍질 · 벽 그림이 휘면 안 될 때 · 프롬프트를 만들 때 방 크기의 틀 그림이 레퍼런스에 자동으로 들어감",
        frame: "십자 전개도 한 장",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        english: buildUnfoldEnglish(null, "the room described below", "inner"),
        negativeEnglish:
          "perspective, vanishing point, furniture standing on the floor, people, text, letters, labels, border, panels merged",
        hint: "틀 그림(방 크기 그대로의 색 칸)은 «프롬프트 작성»·«규칙 조립» 을 누를 때 레퍼런스에 자동으로 들어가, «구성» 으로 보낼 때 함께 올라갑니다",
      },
      {
        id: ROOM_OUTER_CHIP_ID,
        label: "등장방형 · 실내 바깥쪽면",
        result: "같은 방을 밖에서 본 네 외벽·지붕·기단을 십자로 펼친 한 장. 들어오면 «장소_외벽» 여섯 면으로 자동으로 잘림",
        use: "방 바깥 껍질(구도잡기 «바깥면») · 외벽은 한 자리에서 찍는 등장방형으로 못 담아 전개도로만",
        frame: "십자 전개도 한 장",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        english: buildUnfoldEnglish(null, "the building described below", "outer"),
        negativeEnglish:
          "interior, wallpaper, furniture, perspective, vanishing point, sky, street, parked cars, plants, people, text, letters, labels, border, panels merged",
        hint: "틀 그림(방 크기 그대로의 색 칸)은 «프롬프트 작성»·«규칙 조립» 을 누를 때 레퍼런스에 자동으로 들어가, «구성» 으로 보낼 때 함께 올라갑니다",
      },
      /*
        ── 일반 배경 한 장 ─────────────────────────────────────────────────
         6면이 아니라 컷에 바로 쓰는
        눈높이 배경 한 장입니다. 같은 날 «1차 마스터» 정리 때 뺀 진입 전경·입구에서 본 전경·코너 뷰의 문장을 그대로
        옮겼습니다(마스터는 앵커를 찍는 지도라 눈높이 한 장이 거기 있을 까닭이 없었고, 여기가 제자리입니다).
        카메라가 서는 자리는 앵커(있으면)를 말로 풀어 LLM·규칙 조립이 적습니다.
      */
      {
        id: "view-eye-exterior",
        label: "일반 배경 · 실외 눈높이",
        result: "길 따라 들어오며 보이는 실외 눈높이 전경 한 장(16:9)",
        use: "확립 컷 · 캐릭터 등장 컷 · 6면이 필요 없는 컷 배경",
        frame: "16:9 한 장",
        aspect: "16:9",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        english:
          "One single image, eye-level wide establishing view of the outdoor place, the camera at a standing adult's eye height 1.6 m above the ground at the spot described below, lens level, horizon on the vertical centre of the frame, wide-angle lens about 90 degrees horizontal, the ground surface large and close in the foreground, the place ahead as it appears to someone standing there; the camera stands on the ground, never above it",
        negativeEnglish: ANCHOR_NEGATIVE,
      },
      {
        id: "view-eye-interior",
        label: "일반 배경 · 실내 눈높이",
        result: "출입문 안쪽에 서서 본 실내 눈높이 전경 한 장(16:9)",
        use: "확립 컷 · 방에 들어오는 컷",
        frame: "16:9 한 장",
        aspect: "16:9",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        english:
          "One single image, eye-level view from just inside the main entrance of the room, the camera 1.6 m above the floor, lens level, horizon on the vertical centre, wide-angle lens about 90 degrees horizontal, the floor large in the foreground, the far wall and the main furniture ahead, the side walls receding to the left and right; the camera stands on the floor, never above it",
        negativeEnglish: ANCHOR_NEGATIVE,
      },
      {
        id: "view-corner-interior",
        label: "일반 배경 · 실내 코너 뷰",
        result: "방 구석에서 대각선으로 본 눈높이 한 장. 먼 두 벽과 바닥 대부분이 한 장에(16:9)",
        use: "방 전체가 한 컷에 들어오는 배경 · 대화 컷",
        frame: "16:9 한 장",
        aspect: "16:9",
        role: "frame",
        exclusiveGroup: "panorama",
        spaceKind: "both",
        // «마주 보는 두 벽» 이라고 쓰면 무엇의 반대인지 알 수 없습니다. 코너 뷰에 보이는 것은 **먼 두 벽**입니다.
        english:
          "One single image, two-point perspective from one corner of the room looking diagonally across it, the camera 1.6 m above the floor, lens level, horizon on the vertical centre, very wide-angle lens about 100 degrees horizontal so that the two far walls and most of the floor are in frame, vertical lines kept perfectly vertical",
        negativeEnglish: ANCHOR_NEGATIVE,
      },
    ],
  },
  {
    id: "master-legend",
    label: "마스터에 함께 넣을 것",
    englishLabel: "Overlays on the master",
    /*
      2차(앵커 파노라마·정면)에는 이 표시들이 붙으면 안 됩니다. 그 그림은 구도잡기의
      **환경 맵**이 되므로 회색 사람 실루엣이나 나침반이 배경에 그대로 구워집니다.
      그래서 앵커 칩이 켜져 있으면 조립할 때 이 그룹을 통째로 뺍니다(resolveBackgroundChips).
    */
    description: "마스터 위에 얹는 표시. 눈높이 마스터에는 «사람 크기 기준» 만, 2차 앵커 그림에는 아무것도 안 들어갑니다",
    options: [
      {
        id: "master-compass",
        label: "방향 표시",
        result: "한 구석에 작은 나침반(북쪽 화살표)",
        use: "지도형 마스터에만 — 항공 수직·배치도·도면·조감도·등각",
        frame: "표시",
        role: "overlay",
        spaceKind: "both",
        mapOnly: true,
        allowsLabels: true,
        english:
          "a small clean compass rose in one corner of the image with its north arrow pointing up, drawn as a graphic overlay and not as part of the scene",
      },
      {
        id: "master-human-scale",
        label: "사람 크기 기준",
        result: "회색 사람 실루엣 하나를 실제 크기로(약 1.7 m) 세워 둠",
        use: "어느 마스터에나 됨 · 크기 재기",
        frame: "표시",
        role: "overlay",
        spaceKind: "both",
        mapOnly: false,
        allowsPeople: true,
        // «출입구 옆» 으로 못 박으면 단면·눈높이 그림에서 프레임 밖으로 나갑니다.
        english:
          "one neutral grey human silhouette standing on the ground at correct scale (about 1.7 m tall), placed where it is clearly visible, drawn as a flat scale reference and not as a character",
      },
      {
        id: "master-landmarks",
        label: "주요 오브젝트 라벨",
        result: "장소를 알아보게 하는 오브젝트 4~6개에 지시선 + 짧은 라벨",
        use: "지도형·조감도·돌하우스 마스터 · 장소 이름 정하기",
        frame: "표시",
        role: "overlay",
        spaceKind: "both",
        mapOnly: true,
        allowsLabels: true,
        english:
          "the four to six objects that make this place recognisable, each with a thin leader line to a short English callout label near the image edge",
      },
      {
        id: "legend-anchor-dots",
        label: "앵커 후보 점",
        result: "카메라가 설 만한 자리 3~5곳에 번호 붙은 동그라미",
        use: "지도형·조감도 마스터 · 앵커를 찍기 전에 후보를 보기",
        frame: "표시",
        role: "overlay",
        spaceKind: "both",
        mapOnly: true,
        allowsLabels: true,
        english:
          "three to five small numbered circular markers (1, 2, 3 ...) placed on the ground where a camera could stand, drawn as graphic overlays",
      },
      {
        id: "legend-scale-bar",
        label: "축척 막대",
        result: "한 구석에 미터 단위 축척 막대",
        use: "항공 수직·배치도·도면 (거리 재기)",
        frame: "표시",
        role: "overlay",
        spaceKind: "both",
        mapOnly: true,
        allowsLabels: true,
        english: "a graphic scale bar in metres in one corner of the image",
        hint: "설명에 실제 크기(«가로 약 80 m»)를 적어야 눈금이 맞습니다 — 없으면 모델이 지어냅니다",
      },
    ],
  },
  {
    id: "variation-set",
    label: "세트 (변주)",
    englishLabel: "Variation sets",
    description: "같은 구도를 여러 조건으로 한 장에 나란히. 하나만 고릅니다 — 칸 수는 칩이 정합니다",
    options: [
      {
        id: "set-time4",
        label: "시간대 4칸",
        result: "같은 구도를 아침·낮·저녁·밤으로 2×2 네 칸에",
        use: "씬 시간대 고르기 · 조명 기준 정하기",
        frame: "2×2 네 칸",
        aspect: "1:1",
        role: "frame",
        panels: 4,
        exclusiveGroup: "set",
        spaceKind: "both",
        english:
          "One sheet divided into a 2x2 grid of four equal panels with thin white gutters, every panel the exact same place from the exact same viewpoint and framing, only the time of day changes: panel 1 (top left) early morning, panel 2 (top right) midday, panel 3 (bottom left) sunset, panel 4 (bottom right) night; identical layout, objects and materials in all four",
        negativeEnglish: "text, labels inside the panels, different layout, moved objects",
      },
      {
        id: "set-season4",
        label: "계절 4칸",
        result: "같은 구도를 봄·여름·가을·겨울로 2×2 네 칸에",
        use: "계절이 바뀌는 이야기 · 식생·색 기준",
        frame: "2×2 네 칸",
        aspect: "1:1",
        role: "frame",
        panels: 4,
        exclusiveGroup: "set",
        spaceKind: "both",
        english:
          "One sheet divided into a 2x2 grid of four equal panels with thin white gutters, every panel the exact same place from the exact same viewpoint and framing, only the season changes: panel 1 (top left) spring, panel 2 (top right) summer, panel 3 (bottom left) autumn, panel 4 (bottom right) winter; identical layout, objects and materials in all four",
        negativeEnglish: "text, labels inside the panels, different layout, moved objects",
      },
      {
        id: "set-weather3",
        label: "날씨 3칸",
        result: "같은 구도를 맑음·비·안개로 가로 세 칸에",
        use: "날씨로 분위기 바꾸기 · 대기 기준",
        frame: "21:9 · 3칸 가로",
        aspect: "21:9",
        role: "frame",
        panels: 3,
        exclusiveGroup: "set",
        spaceKind: "both",
        // 16:9 에 가로 세 칸이면 칸 하나가 0.6:1 세로가 되어 풍경이 눌립니다.
        english:
          "One very wide image (about 21:9) divided into three equal panels side by side with thin white gutters, every panel the exact same place from the exact same viewpoint and framing, only the weather changes: panel 1 clear, panel 2 rain, panel 3 thick fog; identical layout, objects and materials in all three",
        negativeEnglish: "text, labels inside the panels, different layout, moved objects",
      },
      {
        id: "set-light2",
        label: "조명 2칸",
        result: "같은 구도를 밝음·어두움 두 칸에 (실내는 불 켬·끔, 실외는 낮·밤)",
        use: "불 켜기·끄기 컷 · 낮밤 전환",
        frame: "2칸 가로",
        aspect: "16:9",
        role: "frame",
        panels: 2,
        exclusiveGroup: "set",
        spaceKind: "both",
        english:
          "One sheet divided into two equal panels side by side with a thin white gutter, both panels the exact same place from the exact same viewpoint and framing, only the lighting changes: panel 1 daytime with the indoor lights on, panel 2 night with only lamps and window light; identical layout, objects and materials in both",
        englishBy: {
          interior:
            "One sheet divided into two equal panels side by side with a thin white gutter, both panels the exact same room from the exact same viewpoint and framing, only the lighting changes: panel 1 with all the room lights on, panel 2 with the lights off and only the light from the windows; identical layout, furniture and materials in both",
          exterior:
            "One sheet divided into two equal panels side by side with a thin white gutter, both panels the exact same place from the exact same viewpoint and framing, only the lighting changes: panel 1 daytime, panel 2 night; identical layout, objects and materials in both",
        },
        negativeEnglish: "text, labels inside the panels, different layout, moved objects",
      },
      {
        id: "set-landmarks",
        label: "랜드마크 콜아웃 시트",
        result: "가운데 전체도 + 둘레에 주요 지점 클로즈업 6칸, 번호로 짝지음",
        use: "간판·문·나무 같은 세부의 정체성 고정 · 에셋으로 뽑을 후보 고르기",
        frame: "1:1 · 가운데 전체도 + 둘레 6칸",
        aspect: "1:1",
        role: "frame",
        panels: 7,
        exclusiveGroup: "set",
        spaceKind: "both",
        allowsLabels: true,
        // 칸을 가로지르는 지시선은 셋 다 거의 못 그립니다 — 아무 데나 선을 긋고 칸 경계를 부숩니다.
        // 번호 대응이 훨씬 안정적입니다.
        english:
          "One square sheet: a large central panel showing the whole place from the master viewpoint, with six small square close-up panels arranged three down the left edge and three down the right edge, each close-up showing one recognisable object or spot of the same place, a small number 1 to 6 drawn on the central panel next to each object and the same number in the corner of its close-up panel, the same light, colours and materials in every panel",
        negativeEnglish: "leader lines crossing the panels, other text",
      },
    ],
  },
  {
    id: "light-atmosphere",
    label: "빛·날씨·시간",
    englishLabel: "Light, weather and time",
    description: "한 장짜리 그림의 조건. 판을 늘리지 않습니다",
    options: [
      /*
        예전에는 «main light direction and the shadows it casts» 같은 **명사구 조각**이었습니다.
        LLM 이 문장으로 풀어 줄 때는 통했지만, 규칙 조립(키가 없을 때)은 그대로 내보내므로
        값 없는 제목만 붙는 셈이었습니다. 스스로 서는 제약문으로 바꿔 두 경로에서 다 씁니다.
      */
      {
        id: "light-key",
        label: "주광·실루엣",
        result: "판을 늘리지 않음 — 주광 방향과 그림자를 못 박는 조건",
        use: "여섯 면·세트가 같은 빛으로 보이게",
        frame: "조건(판 없음)",
        role: "condition",
        spaceKind: "both",
        english: "one clear main light direction, every shadow cast consistently from it",
      },
      {
        id: "light-time",
        label: "시간대",
        result: "판을 늘리지 않음 — 시간대와 그때의 빛 색",
        use: "한 장짜리 그림의 시간대 고정",
        frame: "조건(판 없음)",
        role: "condition",
        spaceKind: "both",
        english: "one clearly readable time of day with the colour of light that belongs to it",
      },
      {
        id: "light-weather",
        label: "날씨·대기",
        result: "판을 늘리지 않음 — 날씨·안개·가시거리",
        use: "한 장짜리 그림의 대기 고정",
        frame: "조건(판 없음)",
        role: "condition",
        spaceKind: "both",
        english: "one clearly readable weather, with its haze and how far you can see",
      },
      {
        id: "light-material",
        label: "재질·반사 기준",
        result: "판을 늘리지 않음 — 주요 표면이 빛을 받는 방식(젖음·무광·광택)",
        use: "면마다 재질이 달라지지 않게",
        frame: "조건(판 없음)",
        role: "condition",
        spaceKind: "both",
        english:
          "each main surface catches light the way its material does, wet, matte or polished, the same way everywhere in the image",
      },
      {
        id: "light-palette",
        label: "색채 계획",
        result: "판을 늘리지 않음 — 모든 면을 묶는 색 팔레트",
        use: "여섯 면·변형의 색 통일",
        frame: "조건(판 없음)",
        role: "condition",
        spaceKind: "both",
        english: "one unified colour palette holding the whole image together",
      },
      {
        id: "plate-empty",
        label: "빈 판 (클린 플레이트)",
        result: "판을 늘리지 않음 — 사람·차·동물이 하나도 없는 빈 장소",
        use: "구도잡기는 배경 위에 인물을 나중에 올립니다 — 눈높이 마스터·2차에 특히",
        frame: "조건(판 없음)",
        role: "condition",
        spaceKind: "both",
        // 「사람 없음」 을 본문에 «no people» 로 쓰면 미드저니는 그 낱말을 내용어로 읽어 사람을 더 그립니다.
        // 본문은 «텅 빈 장소» 라고 긍정형으로만 적고, 실제 금지는 negative 칸으로 보냅니다.
        english: "the place completely empty and still, a clean plate for compositing",
        negativeEnglish: "people, crowd, figures, animals, vehicles, characters, props held by someone",
      },
    ],
  },
];

/**
 * 옛 칩 id → 지금 칩 id. **읽을 때만** 갈아 끼웁니다.
 *
 * 저장된 값 자체는 건드리지 않습니다 — 카드를 열기만 해도 값이 바뀌면 자동 저장과
 * Ctrl+Z 되돌리기 사이에 끼어들어, 아무것도 안 했는데 «되돌릴 것» 이 생깁니다.
 */
const LEGACY_BACKGROUND_CHIP_ALIAS: Record<string, string> = {
  // 옛 «항공뷰»(높은 사각 항공)는 없어졌습니다. 뜻이 가장 가까운 «항공 수직» 으로 읽습니다.
  "master-aerial-high": "master-topdown",
  // 옛 등장방형 칩들. 카드 유형을 모르는 자리(이력 이름 등)에서는 이렇게 읽습니다 — 실내 카드는 `blueprintForSpace` 가 먼저 갈아 끼웁니다.
  [LEGACY_PANORAMA_CHIP_ID]: CUBEMAP_CHIP_ID,
  // 1차 마스터에서 뺀 눈높이 한 장들은 2차 «일반 배경» 으로 옮겼습니다.
  "master-approach": "view-eye-exterior",
  "master-entrance-view": "view-eye-interior",
  "master-corner-view": "view-corner-interior",
  [PANORAMA_CHIP_ID]: CUBEMAP_CHIP_ID,
  [PANORAMA_INTERIOR_CHIP_ID]: ROOM_INNER_CHIP_ID,
};

/**
 * 공간 유형에 맞는 그룹과 칩만 보여 줍니다. 실내에 조감도를 권하면 안 됩니다.
 *
 * 그룹뿐 아니라 **칩 단위**로도 거릅니다. 마스터를 한 그룹으로 합쳤기 때문입니다.
 * 실내외(mixed)는 실외·실내 칩을 모두 보여 줍니다 — 마당 딸린 집은 둘 다 쓸 수 있습니다.
 */
export function getBackgroundGroups(spaceKind?: SpaceKind): BlueprintGroup[] {
  if (!spaceKind) return BACKGROUND_BLUEPRINT_GROUPS;
  return BACKGROUND_BLUEPRINT_GROUPS.filter(
    (group) => !group.spaceKinds || group.spaceKinds.includes(spaceKind),
  ).map((group) => {
    const options = group.options.filter(
      (item) =>
        !item.spaceKind ||
        item.spaceKind === "both" ||
        item.spaceKind === spaceKind ||
        spaceKind === "mixed",
    );
    return options.length === group.options.length ? group : { ...group, options };
  });
}

/** 배경 칩 하나를 id 로 찾습니다(옛 id 도 읽어 줍니다). 모르는 id 는 undefined. */
export function findBackgroundChip(id: string): BlueprintOption | undefined {
  return blueprintLookup("background").get(id);
}

/**
 * 요청에 실을 배경 칩을 **규칙대로 추려** 돌려줍니다.
 *
 * 화면에서는 옛 프로젝트의 값을 그대로 보여 주되(값을 조용히 고치지 않습니다),
 * 조립할 때는 여기서 정리합니다.
 * 1. 모르는 id 는 버리고, 옛 id 는 갈아 끼웁니다.
 * 2. 배타 묶음(마스터·앵커·세트)은 **먼저 켠 것 하나만** — 옛 프로젝트에 마스터가 둘 켜져 있어도 안 터집니다.
 * 3. 앵커 칩이 켜져 있으면 얹는 표시는 전부 뺍니다 — 2차 그림은 구도잡기의 환경 맵이라
 * 회색 실루엣·나침반이 배경에 그대로 구워집니다.
 * 4. 지도형이 아닌 마스터(눈높이 전경 등)에서는 나침반·축척 같은 «지도 전용» 표시를 뺍니다.
 * 5. 우선순위는 **앵커 > 세트 > 마스터**.
 * - 앵커가 켜져 있으면 마스터·세트 문장은 아예 뺍니다. 마스터가 항공 그림이면 그 문장 하나로
 * 파노라마가 다시 항공으로 끌려갑니다(docs/복원/10 §1 의 바로 그 실패).
 * - 세트와 마스터가 함께면 «마스터의 시점으로 N칸» 입니다. 마스터 문장의 «한 장» 머리를 떼고
 * «칸마다 이 시점» 으로 바꿔 넣습니다 — 안 그러면 «한 장» 과 «세 칸» 이 정면으로 부딪힙니다.
 * 6. 차례는 판 → 표시 → 조건. 카메라 문장이 맨 앞에 와야 스타일 메모로 안 읽힙니다.
 */
export function resolveBackgroundChips(selected: string[] | undefined): BlueprintOption[] {
  const lookup = blueprintLookup("background");
  const seen = new Set<string>();
  const exclusiveTaken = new Set<string>();
  const chips: BlueprintOption[] = [];

  for (const id of selected || []) {
    const chip = lookup.get(id);
    if (!chip || seen.has(chip.id)) continue;
    if (chip.exclusiveGroup) {
      if (exclusiveTaken.has(chip.exclusiveGroup)) continue;
      exclusiveTaken.add(chip.exclusiveGroup);
    }
    seen.add(chip.id);
    chips.push(chip);
  }

  const anchorOn = chips.some((chip) => chip.exclusiveGroup === "panorama");
  const setOn = chips.some((chip) => chip.exclusiveGroup === "set");
  const master = chips.find((chip) => chip.exclusiveGroup === "master");
  const mapMaster = Boolean(master?.mapLike);

  const kept = chips.filter((chip) => {
    if (chip.role === "condition") return true;
    if (chip.role === "overlay") {
      if (anchorOn) return false;
      return !(chip.mapOnly && !mapMaster);
    }
    // 판 칩: 앵커가 있으면 앵커 하나만.
    return !anchorOn || chip.exclusiveGroup === "panorama";
  });

  const rank = (chip: BlueprintOption) => {
    if (chip.role === "overlay") return 3;
    if (chip.role === "condition") return 4;
    if (chip.exclusiveGroup === "panorama") return 0;
    if (chip.exclusiveGroup === "set") return 1;
    return 2;
  };
  return kept
    .sort((a, b) => rank(a) - rank(b))
    .map((chip) => (setOn && chip.exclusiveGroup === "master" ? asPanelViewpoint(chip) : chip));
}

/** «한 장» 머리를 떼고 «칸마다 이 시점» 으로. 세트 칩과 마스터 칩이 함께 켜졌을 때만 씁니다. */
function asPanelViewpoint(chip: BlueprintOption): BlueprintOption {
  const rewrite = (text: string) =>
    `every panel uses this same viewpoint and framing: ${text.replace(/^One\s[^,]*,\s*/i, "")}`;
  return {
    ...chip,
    english: rewrite(chip.english),
    ...(chip.englishBy
      ? {
          englishBy: Object.fromEntries(
            Object.entries(chip.englishBy).map(([key, value]) => [key, rewrite(value)]),
          ) as Partial<Record<SpaceKind, string>>,
        }
      : {}),
  };
}

/** 배경이 만드는 판의 종류. «칸 N개로 나눠라» 를 시킬지 말지가 여기서 갈립니다. */
export type BackgroundFrameKind = "panorama" | "single" | "set" | "none";

export function backgroundFrameKind(selected: string[] | undefined): BackgroundFrameKind {
  const frame = resolveBackgroundChips(selected).find((chip) => chip.role === "frame");
  if (!frame) return "none";
  if (frame.exclusiveGroup === "panorama") {
    return isEquirectChipId(frame.id) || frame.id === PANORAMA_CYL_CHIP_ID ? "panorama" : "single";
  }
  /*
    "set" 은 «세트 그룹의 칩» 이 아니라 **«판을 여러 칸으로 나누는 칩»** 이라는 뜻입니다.

    예전에는 `exclusiveGroup === "set"` 으로만 갈랐습니다. 그래서 마스터 그룹에 있으면서
    `panels: 4` 인 «벽면 전개도»(master-elevations)가 "single" 이 됐고, 같은 요청 안에서
    칩 문장은 「four equal panels」 를 시키는데 규칙은 「칸으로 나누지 마세요」 를 붙였습니다
    (background-sheet.md 의 ::when frameKind=single, rulePrompt 의 oneImage).
    panelCount 만 `backgroundPanelCount` 덕에 4 로 맞게 나가 셋이 서로 다른 말을 했습니다.
    판정을 칸 수로 바꾸면 전개도도 세트 문단(«칩이 정한 칸 수와 배열 그대로»)을 탑니다.
  */
  return (frame.panels ?? 1) > 1 ? "set" : "single";
}

/** 2차 칩의 종류. 템플릿의 `::when anchorKind=…` 가 이 값을 봅니다. */
export function backgroundAnchorKind(
  selected: string[] | undefined,
): "equirect" | "cylindrical" | "unfold" | "direction" | "guide" | "none" {
  const frame = resolveBackgroundChips(selected).find((chip) => chip.exclusiveGroup === "panorama");
  if (!frame) return "none";
  if (isEquirectChipId(frame.id)) return "equirect";
  if (frame.id === PANORAMA_CYL_CHIP_ID) return "cylindrical";
  if (isUnfoldChipId(frame.id)) return "unfold";
  return frame.id === "guide-repaint" ? "guide" : "direction";
}

/** 마스터가 지도형인지 시점형인지. 얹는 표시를 붙일 수 있는지가 여기서 갈립니다. */
export function backgroundMasterKind(selected: string[] | undefined): "map" | "view" | "none" {
  const master = resolveBackgroundChips(selected).find((chip) => chip.exclusiveGroup === "master");
  if (!master) return "none";
  return master.mapLike ? "map" : "view";
}

/**
 * 판을 만드는 칩이 어느 배타 묶음의 것인가(`"master"` · `"set"` · `"panorama"` · null).
 *
 * 칸이 여럿이어도 뜻이 다릅니다 — 세트 묶음(시간대·계절·날씨)은 «같은 시점, 조건만 다름»
 * 이고, 마스터 묶음의 «벽면 전개도» 는 칸마다 **다른 벽**입니다. 규칙 문장이 이 둘을
 * 같은 말로 묶으면 전개도가 네 칸에 같은 벽을 그립니다.
 */
export function backgroundFrameGroup(selected: string[] | undefined): string | null {
  const frame = resolveBackgroundChips(selected).find((chip) => chip.role === "frame");
  return frame?.exclusiveGroup ?? null;
}

/** 결과 그림이 몇 칸인지. 판을 만드는 칩만 칸을 만듭니다 — 표시·조건 칩은 세지 않습니다. */
export function backgroundPanelCount(selected: string[] | undefined): number {
  const frame = resolveBackgroundChips(selected).find((chip) => chip.role === "frame");
  return frame?.panels ?? 1;
}

/** 고른 칩들이 요구하는 «나오면 안 되는 것». 라벨을 그리는 칩이 켜져 있으면 글자 금지는 뺍니다. */
export function backgroundNegativeEnglish(selected: string[] | undefined): string[] {
  const chips = resolveBackgroundChips(selected);
  const labelsOn = chips.some((chip) => chip.allowsLabels);
  // «사람 크기 기준» 은 회색 실루엣을 **일부러** 세웁니다. «빈 판» 의 people 금지와 부딪히면
  // 모델이 실루엣을 지우거나 반쯤 그립니다 — 크기 기준이 켜져 있으면 사람 금지를 뺍니다.
  const peopleOn = chips.some((chip) => chip.allowsPeople);
  /*
    판을 여러 칸으로 나누는 칩이 켜져 있으면 «판을 만드는 낱말» 금지를 뺍니다.

    라벨·사람은 이미 예외였는데 판만 빠져 있었습니다. 실외에서 «조감도 45°» + «시간대 4칸»
    을 켜면 본문은 「2x2 grid of four equal panels」 를 시키는데 negative 에는
    master-birdseye 가 물고 온 «grid, panels» 가 그대로 실려, 모델에 따라 칸이 사라지거나
    반만 나뉘었습니다. 정확히 라벨·사람과 같은 종류의 정면 모순입니다.
  */
  const panelsOn = chips.some((chip) => (chip.panels ?? 1) > 1);
  const words = new Set<string>();
  for (const chip of chips) {
    for (const word of (chip.negativeEnglish || "").split(",")) {
      const trimmed = word.trim();
      if (!trimmed) continue;
      // 라벨을 만드는 칩과 «글자 금지» 가 함께 가면 정면 모순입니다 — 모델마다 다르게 풉니다.
      if (labelsOn && /^(text|labels|letters)$/i.test(trimmed)) continue;
      if (peopleOn && /^(people|crowd|figures)$/i.test(trimmed)) continue;
      if (panelsOn && /^(grid|panels|split screen|split panels|collage|multiple frames|sheet)$/i.test(trimmed)) {
        continue;
      }
      words.add(trimmed);
    }
  }
  return [...words];
}

/** 고른 칩 가운데 글자(라벨)를 그리게 하는 것이 있는가. 있으면 «글자 금지» 를 빼야 모순이 없습니다. */
export function backgroundAllowsLabels(selected: string[] | undefined): boolean {
  return resolveBackgroundChips(selected).some((chip) => chip.allowsLabels);
}

/** 고른 칩이 요구하는 생성기 비율(«21:9» 등). 판을 만드는 칩이 정합니다. */
export function backgroundAspect(selected: string[] | undefined): string | null {
  const frame = resolveBackgroundChips(selected).find((chip) => chip.role === "frame");
  return frame?.aspect ?? null;
}

/** 공간 유형별로 처음 켜 둘 것. 1차 한 장 + 표시 둘이면 시작하기 충분합니다. */
export const INITIAL_BACKGROUND_BLUEPRINT_BY_SPACE: Record<SpaceKind, string[]> = {
  exterior: ["master-birdseye", "master-compass", "master-human-scale"],
  interior: ["master-floorplan", "master-compass", "master-human-scale"],
  // 돌하우스는 지도형이라 나침반이 들어가도 되지만, 실내외 혼합은 마당·실내가 섞여
  // 북쪽이 어디인지 사람도 정하기 어렵습니다. 크기 기준만 켜 둡니다.
  mixed: ["master-dollhouse", "master-human-scale"],
};

export const ASSET_BLUEPRINT_GROUPS: BlueprintGroup[] = [
  {
    id: "asset-identity",
    label: "에셋 식별 기준",
    englishLabel: "Asset identity",
    description: "이 물건을 같은 물건으로 알아보게 하는 기준 이미지",
    options: [
      option("asset-front", "정면", "front orthographic view of the object on a neutral background"),
      option("asset-side", "측면", "side view at the same distance and light direction"),
      option("asset-back", "후면", "back view showing what the front hides"),
      option("asset-three-quarter", "3/4 뷰", "three-quarter hero view that reads the whole shape at once"),
      option("asset-top", "위에서", "top-down view showing the footprint and opening"),
      option("asset-proportion", "비율·치수", "the object with its main dimensions and proportions readable, so it does not change size between cuts"),
      option("asset-silhouette", "윤곽선", "flat silhouette of the object, filled black on white, to lock the outline"),
      option("asset-signature", "핵심 특징", "close-up of the one or two details that make this object recognisable at a glance"),
    ],
  },
  {
    id: "asset-detail",
    label: "재질·제작 디테일",
    englishLabel: "Material and making",
    description: "가까이 잡히는 컷에서 무너지지 않게 하는 정보",
    options: [
      option("asset-material", "소재", "what the object is made of, shown as a clean material sample"),
      option("asset-texture", "질감 확대", "macro detail of the dominant surface texture under neutral light"),
      option("asset-color", "색상 스와치", "flat colour swatch strip of the object's key colours, plain labelled patches with no shading"),
      option("asset-wear", "사용감·낡음", "wear, scratches and dirt that show this object has been used"),
      option("asset-gloss", "광택·반사", "how the surface catches light, from matte to specular, on a neutral backdrop"),
      option("asset-parts", "구성 요소", "the object separated into its parts, showing how it is assembled"),
    ],
  },
  {
    id: "asset-function",
    label: "기능·상호작용",
    englishLabel: "Function and interaction",
    description: "이 물건이 어떻게 움직이고, 사람이 어떻게 다루는지",
    options: [
      option("asset-mechanism", "작동 구조", "how the object opens, folds, or comes apart"),
      option("asset-states", "기능 상태", "the object in each of its working states, for example closed, open, lit, empty"),
      option("asset-grip", "손·인물 상호작용", "how a hand holds or carries the object"),
      option("asset-change", "상태 변화", "before and after the object is used, side by side"),
      option("asset-scene", "사용 장면", "the object being used in a real situation, not on a studio backdrop"),
    ],
  },
  {
    id: "asset-context",
    label: "장면 매칭",
    englishLabel: "Scene matching",
    // 이게 없으면 에셋만 따로 잘 뽑아 놓고도 컷에 얹을 때 크기와 빛이
    // 안 맞아 오려 붙인 것처럼 보입니다.
    description: "컷에 얹었을 때 붕 뜨지 않게 맞추는 기준",
    options: [
      option("asset-size-ref", "크기 기준", "the object next to a neutral human figure or hand for scale"),
      option("asset-placement", "화면 내 배치", "where the object typically sits inside the frame, foreground or background"),
      option("asset-lighting", "조명 반응", "the object under the scene's lighting, showing how it takes key and rim light"),
      option("asset-match", "캐릭터·배경 매칭", "the object shown together with the character and the location it belongs to"),
    ],
  },
];

export const DEFAULT_CHARACTER_BLUEPRINT: string[] = [];

/**
 * 첫 시트에 켜 둘 다섯 칸.
 *
 * 여기 적힌 앞머리는 사고로 잃어 다시 쓴 것입니다. 이어지는 내용은
 * 원본 그대로라 뜻은 온전합니다.
 *
 * **칸을 적게 잡는 것이 핵심입니다.** 시트 한 장의 크기는 정해져 있어서,
 * 칸을 열두 개로 나누면 칸 하나가 손톱만 해집니다. 전신이 300px 아래로
 * 떨어지고, 그 안의 얼굴은 100px가 안 됩니다. 그 얼굴을 다음 시트의 정체성 기준으로
 * 넘기면 모델이 없는 디테일을 지어냅니다. 칸이 적을수록 칸마다 커지고, 커진 얼굴이
 * 곧 다음 시트의 정확도입니다.
 *
 * 다섯 칸의 역할이 각각 다릅니다.
 * - 전신 정면·후면: 실루엣과 의상 앞뒤. 옆면은 이 둘에서 대체로 유추됩니다.
 * - 얼굴 정면: 정체성 기준. 이 칸 하나만 잘라서 다음 시트에 넘기게 됩니다.
 * - 헤어 후면: 뒤통수는 유추가 안 되는 유일한 부분이라 처음에 잡아 둡니다.
 * - 색상 기준: 다음 시트에서 색이 틀어졌는지 재는 자입니다. 이게 없으면 잴 방법이 없습니다.
 *
 * 얼굴 좌우·표정·소품은 여기 넣지 않습니다. 이 시트를 레퍼런스로 걸고 따로 뽑으면
 * 그때는 얼굴이 칸 하나를 통째로 쓰므로 훨씬 정확합니다.
 */
export const INITIAL_CHARACTER_BLUEPRINT = [
  "body-front",
  /*
    사용자 2026-09-21 이 화면에서 켜 놓고 「캐릭터 레퍼런스 구성 토글 기본값 이걸로 해줘」
    라고 지정한 아홉 칸입니다. 위 다섯 칸 설명에 「옆면은 앞뒤에서 유추됩니다」 라고
    적어 두었지만, 실제로 써 보니 옆이 없으면 코 높이와 어깨 두께가 컷마다 흔들립니다.
    한 쪽(우측)만 넣어 칸 수는 아끼면서 그 흔들림을 잡습니다 — 좌측은 여전히 뺍니다.
  */
  "body-right",
  "body-back",
  "face-front",
  // 아래 넷은 사용자가 이름을 대어 지정한 것입니다.
  // 「첫 캐릭터 생성 시 헤어 후면, 눈, 피부 기본, 색상 기준 디폴트로 넣기
  // (일관성을 살리기 위해) 단 얼굴 좌측, 우측은 기본에서 빼기」
  //
  // 그래서 face-left·face-right 는 여기 없습니다. 이 넷이 다음 시트에서
  // 「같은 사람인가」 를 재는 자입니다.
  "face-back",
  "face-eyes",
  "face-skin",
  /*
    장신구는 **몸에 붙은 것**이라 처음부터 켭니다. 나중에 켜면 이미
    뽑아 둔 시트에는 목걸이가 없어서, 컷마다 있다 없다 합니다. 소지품(`prop-carry`)은
    여기 넣지 않습니다 — 그쪽은 인물과 **떼어서** 그려야 하는 것입니다.
  */
  "accessory",
  "color-palette",
];
export const DEFAULT_BACKGROUND_BLUEPRINT: string[] = [];
export const DEFAULT_ASSET_BLUEPRINT: string[] = [];

export function getBlueprintGroups(kind: BlueprintKind) {
  return kind === "character"
    ? CHARACTER_BLUEPRINT_GROUPS
    : kind === "background"
      ? BACKGROUND_BLUEPRINT_GROUPS
      : ASSET_BLUEPRINT_GROUPS;
}

export function getDefaultBlueprint(kind: BlueprintKind) {
  return kind === "character"
    ? DEFAULT_CHARACTER_BLUEPRINT
    : kind === "background"
      ? DEFAULT_BACKGROUND_BLUEPRINT
      : DEFAULT_ASSET_BLUEPRINT;
}

/**
 * 고른 항목을 목록으로 돌려줍니다.
 *
 * describeBlueprint 는 쉼표로 이어 붙인 한 줄이라, LLM 이 몇 개인지 세기 어렵습니다.
 * 항목 하나가 시트의 칸 하나라 개수가 중요합니다.
 */
export function listBlueprint(
  kind: BlueprintKind,
  selected: string[] | undefined,
  language: "ko" | "en",
  spaceKind?: SpaceKind,
  marks?: BlueprintRouteMark[] | null,
  space?: PanoramaSpace | null,
  templateMention?: string | null,
): string[] {
  const items = pickBlueprint(kind, selected);
  const panorama = (item: BlueprintOption) =>
    (isEquirectChipId(item.id) && spaceFitsChip(item.id, space)) ||
    (isRoomUnfoldChipId(item.id) && spaceFitsChip(PANORAMA_INTERIOR_CHIP_ID, space));
  return items.map((item) =>
    language === "ko"
      ? panorama(item)
        ? `${item.label} (${describePanoramaSpaceKo(space!, item.id !== PANORAMA_CHIP_ID && !isOutdoorSpaceChipId(item.id))})`
        : item.label
      : blueprintEnglish(item, spaceKind, marks, space, templateMention),
  );
}

/**
 * 고른 id 를 칩으로. 배경은 «배타 정리·표시 걸러내기» 까지 거칩니다.
 *
 * 캐릭터·에셋은 예전 그대로 — 고른 순서가 곧 칸 순서입니다.
 */
function pickBlueprint(kind: BlueprintKind, selected: string[] | undefined): BlueprintOption[] {
  const ids = selected?.length ? selected : getDefaultBlueprint(kind);
  if (kind === "background") return resolveBackgroundChips(ids);
  const lookup = blueprintLookup(kind);
  return ids.map((id) => lookup.get(id)).filter((item): item is BlueprintOption => Boolean(item));
}

/**
 * id → 칩. 목록에 없는 id 는 `undefined` 라 호출하는 쪽이 버립니다.
 *
 * 옛 프로젝트에는 지운 칩(«북(정면)» 등, 2026-09-09)의 id 가 그대로 남아 있습니다.
 * 여기서 모르는 id 를 조용히 떨어뜨리므로 터지지도, 요청에 실리지도 않습니다.
 * 뜻이 이어지는 옛 id 만 `LEGACY_BACKGROUND_CHIP_ALIAS` 로 읽어 줍니다.
 */
function blueprintLookup(kind: BlueprintKind) {
  const map = new Map(
    getBlueprintGroups(kind).flatMap((group) => group.options.map((item) => [item.id, item] as const)),
  );
  if (kind === "background") {
    for (const [oldId, newId] of Object.entries(LEGACY_BACKGROUND_CHIP_ALIAS)) {
      const chip = map.get(newId);
      if (chip && !map.has(oldId)) map.set(oldId, chip);
    }
  }
  return map;
}

/**
 * 고른 id 가운데 **지금 화면에 칩으로 보이는 것**만 셉니다(«N개 선택»).
 *
 * 예전에는 `blueprintLookup` 을 그대로 썼습니다. 그런데 배경 lookup 에는 옛 id 별칭이
 * 들어 있어서, `master-aerial-high` 는 세어지는데 그 칩(«항공 수직»)은 꺼진 것으로 그려졌고,
 * 공간유형으로 걸러진 칩(실외 프로젝트에 남은 실내 마스터)도 세어지지만 화면에 없었습니다.
 * 「보이는 칩과 숫자가 어긋나면 안 됩니다」(BlueprintTogglePanel) 라는 약속이 깨진 것입니다.
 * 패널이 그리는 것과 **같은 목록**(그룹 → 옵션)으로 셉니다.
 */
export function countKnownBlueprint(
  kind: BlueprintKind,
  selected: string[] | undefined,
  spaceKind?: SpaceKind,
): number {
  const groups = kind === "background" ? getBackgroundGroups(spaceKind) : getBlueprintGroups(kind);
  const ids = new Set(selected || []);
  return groups.reduce(
    (total, group) => total + group.options.filter((option) => ids.has(option.id)).length,
    0,
  );
}

/**
 * 고른 칸을 **id + 한국어 이름 + 영문 설명** 으로 돌려줍니다. LLM 요청에 싣는 용도입니다.
 *
 * 예전에는 id 문자열("body-left")만 실어 보냈습니다. 그러면 LLM 이 그 칸이
 * 무엇인지 스스로 짐작해야 해서, 「좌측 전신」 이 인물의 왼쪽인지 화면의
 * 왼쪽인지 헷갈렸고 헤어 후면에서 고양이 귀가 사라졌습니다. 칸마다 무엇을
 * 그려야 하는지 영문으로 정확히 적어 둔 것이 있는데 그게 안 갔던 것입니다.
 * (지시 203·205)
 */
export function detailBlueprint(
  kind: BlueprintKind,
  selected: string[] | undefined,
  spaceKind?: SpaceKind,
  marks?: BlueprintRouteMark[] | null,
  space?: PanoramaSpace | null,
  templateMention?: string | null,
): { id: string; label: string; english: string; frame?: string; role?: BlueprintRole }[] {
  return pickBlueprint(kind, selected).map((item) => ({
    id: item.id,
    label: item.label,
    english: blueprintEnglish(item, spaceKind, marks, space, templateMention),
    // 판인지 표시인지 조건인지 — LLM 이 «칸 수» 를 이 목록의 길이로 세지 않도록.
    ...(item.frame ? { frame: item.frame } : {}),
    ...(item.role ? { role: item.role } : {}),
  }));
}


/**
 * 무슨 조건으로 뽑았는지 사람이 읽는 한 줄로 만듭니다.
 *
 * 프롬프트 이력의 이름에 들어갑니다. 예전에는 «칸 4개» 였는데, 그 숫자로는
 * 조감도로 뽑았는지 항공뷰로 뽑았는지 알 수 없어서 지난 프롬프트를 골라 쓸
 * 수가 없었습니다. 한 그룹을 통째로 골랐으면 그룹 이름으로 접습니다.
 */
export function summarizeBlueprint(
  kind: BlueprintKind,
  selected: string[] | undefined,
  spaceKind?: SpaceKind,
): string {
  const ids = new Set(selected?.length ? selected : getDefaultBlueprint(kind));
  if (!ids.size) return "";

  const groups = kind === "background" ? getBackgroundGroups(spaceKind) : getBlueprintGroups(kind);
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const picked = group.options.filter((option) => ids.has(option.id));
    if (!picked.length) continue;
    if (picked.length === group.options.length) {
      // «1차 · » 같은 단계 표시는 이름에서 뺍니다. 줄만 길어집니다.
      parts.push(group.label.replace(/^\d차\s*·\s*/, ""));
      picked.forEach((option) => seen.add(option.id));
    } else {
      picked.forEach((option) => {
        parts.push(option.label);
        seen.add(option.id);
      });
    }
  }

  // 다섯 개를 넘으면 이름이 아니라 문단이 됩니다.
  if (parts.length > 5) return `${parts.slice(0, 5).join(", ")} 외 ${parts.length - 5}`;
  return parts.join(", ");
}
