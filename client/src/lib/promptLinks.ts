import { fileStemOf } from "@/components/ReferenceTagBar";
// 이름 → @태그 치환 규칙은 한 곳에만 둡니다(규칙 1) — 조사 경계와 겹낱말 보호가 거기 있습니다.
import { hideTags, tagCharacterNames } from "@/lib/compositionLegend";

/**
 * **이미 써 둔 프롬프트에서 `@태그` 만 다시 잇습니다.**
 *
 * # 왜 LLM 을 다시 부르지 않는가
 *
 * 프롬프트를 새로 받으면 네 칸이 통째로 바뀝니다 — 손으로 고쳐 둔 문장도 같이 날아갑니다.
 * 그런데 바뀐 것은 **그림 이름 하나**뿐입니다. 이름만 갈아 끼우면 되는 일에 수십 초와
 * 손댄 문장을 함께 내줄 이유가 없습니다.
 *
 * # 무엇이 «연결 부» 인가
 *
 * 마그니픽은 올린 그림을 **파일 이름**으로 부릅니다 — 프롬프트 안의 `@냥이_시트_001` 이
 * 곧 그 그림입니다(`ReferenceTagBar` 의 설명 참조). 그래서 연결 부는 두 곳입니다.
 *
 * 1. 본문 안에 흩어져 있는 `@…` 토큰 — LLM 이 문장에 박아 넣은 것.
 * 2. 맨 끝의 **참고 줄** — 우리가 붙이는 한 줄. 그림이 아직 없던 컷에는 1번이 아예
 * 없으므로, 이 줄이 처음 연결을 만들어 줍니다.
 *
 * 본문 토큰은 **인물 이름으로** 짝을 찾습니다. 파일 이름이 «인물_번호» 라는 규칙(규칙 5)
 * 덕분에 `@냥이_시트_001` 이 누구 것인지 이름만 보고 압니다. 규칙이 지켜지지 않아 짝을
 * 못 찾은 토큰은 **지우지 않고 그대로 둡니다** — 사람이 일부러 적은 말일 수 있습니다.
 */

export interface PromptLinkPerson {
  /** 인물 이름. 파일 이름의 앞머리이기도 합니다. */
  name: string;
  /** 지금 이 인물에 걸려 있는 그림 경로들. 고른 순서 그대로. */
  paths: string[];
  /**
   * 그림이 **아직 없을 때** 그 사람을 세우는 한 줄(생김새·성별·키·성격).
   */
  look?: string;
  /**
   * 본문이 이 사람을 달리 부르는 이름들 — 영문 본문의 로마자 이름(«Seo Jinwoo»).
   * 규칙은 `tagCharacterNames` 한 곳에 있습니다. 여기는 나르기만 합니다.
   */
  aliases?: string[];
}

export interface PromptLinkInput {
  people: PromptLinkPerson[];
  /** 영상 전용 외형 참조. 이미지 프롬프트는 이 값을 넘기지 않습니다. */
  representativeImagePath?: string;
  /** 구도 캡처. 있으면 참고 줄 맨 앞에 둡니다. */
  guidePath?: string;
  /** 배경 판. */
  backgroundPath?: string;
  /**
   * 배경의 이름과 생김새 — **판이 아직 없어도** 자리를 잡아 둡니다.
   */
  background?: { name: string; look?: string };
  /** 구도 그림이 아직 없을 때 구도를 글로 대신하는 한 줄. */
  guideNote?: string;
  /** 같은 것의 영문 — 영문 칸의 꼬리 줄에 한글이 섞이지 않게. */
  guideNoteEn?: string;
}

/** 참고 줄의 머리말. 이 글자로 옛 줄을 찾아 통째로 갈아 끼웁니다. */
const HEAD_KO = "참고 그림:";
const HEAD_EN = "Reference images:";

/*
  ── 그림이 아직 없는 것들의 «자리» ────────────────────────────────────
  → 「프롬프트에는 연결이 되어
  있어야… 이미지 뽑았을 때 바로 해당 이미지가 연결이 돼지」.

  여태 참고 줄은 **그림이 걸린 것만** 적었습니다. 그래서 아직 안 뽑은 인물·배경은
  프롬프트 어디에도 안 남았고, 나중에 그림이 생겨도 이어 붙일 자리가 없었습니다.

  이 줄이 그 자리입니다. 겸사겸사 **생성기에게도 쓸모**가 있습니다 — 「서진우」 라는
  이름은 생성기에 아무 뜻이 없지만 「40대 중반, 마른 체구, 각진 턱」 은 뜻이 있습니다.
  그림이 생기면 그 인물은 이 줄에서 빠져 위 참고 줄로 올라갑니다(둘 다 매번 새로 짓습니다).
*/
const PENDING_KO = "아직 그림 없음:";
const PENDING_EN = "Not yet generated:";
const OPTIONAL_KO = "첨부하지 않은 개별 인물 시트(선택 사항):";
const OPTIONAL_EN = "Optional individual sheets not attached:";

const tagOf = (path: string) => `@${fileStemOf(path)}`;

/**
 * 꼬리 줄에 들어갈 글은 **한 줄**이어야 합니다.
 *
 * 배경 카드의 설명은 「…\n시간대: 밤\n분위기: 절박하고 차가움」 처럼 여러 줄입니다(일괄 생성이 그렇게
 * 적습니다). 그대로 꼬리 줄에 넣으면 둘째 줄부터는 머리말이 없어 `stripLinkLine` 이 못 걷어 내고
 * 본문에 남습니다 — 「다시 잇기」 를 누를 때마다 「시간대: 밤」 이 한 벌씩 늘었습니다.
 */
const oneLine = (text: string) =>
  (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 꼬리 줄의 머리말로 시작하는가 — 「참고 그림:」 「아직 그림 없음:」 과 그 영문. */
const isTailHead = (line: string) => {
  const head = line.trimStart();
  return [HEAD_KO, HEAD_EN, PENDING_KO, PENDING_EN, OPTIONAL_KO, OPTIONAL_EN].some(prefix => head.startsWith(prefix));
};

/** 지금 걸려 있는 태그 전부. 본문 토큰이 살아 있는지 판별할 때 씁니다. */
function livingTags(input: PromptLinkInput): Set<string> {
  const all = new Set<string>();
  if (input.representativeImagePath) all.add(tagOf(input.representativeImagePath));
  if (input.guidePath) all.add(tagOf(input.guidePath));
  if (input.backgroundPath) all.add(tagOf(input.backgroundPath));
  input.people.forEach((person) =>
    person.paths.forEach((path) => all.add(tagOf(path))),
  );
  all.delete("@");
  return all;
}

/** 참고 줄 한 줄을 짓습니다. 걸린 그림이 하나도 없으면 빈 문자열. */
function linkLine(input: PromptLinkInput, lang: "ko" | "en"): string {
  const parts: string[] = [];
  if (input.representativeImagePath) parts.push(`${lang === "ko" ? "대표 그림" : "representative image"} ${tagOf(input.representativeImagePath)}`);
  if (input.guidePath)
    parts.push(
      lang === "ko"
        ? `구도 ${tagOf(input.guidePath)}`
        : `layout ${tagOf(input.guidePath)}`,
    );
  if (input.backgroundPath)
    parts.push(
      lang === "ko"
        ? `배경 ${tagOf(input.backgroundPath)}`
        : `background ${tagOf(input.backgroundPath)}`,
    );
  input.people.forEach((person) => {
    const tags = person.paths.filter(Boolean).map(tagOf);
    if (tags.length) parts.push(`${oneLine(displayName(person, lang))} ${tags.join(" ")}`);
  });
  if (!parts.length) return "";
  return `${lang === "ko" ? HEAD_KO : HEAD_EN} ${parts.join(" / ")}`;
}

/** 영문 칸에서는 로마자 별칭(«Seo Jinwoo»)으로 부릅니다 — 없으면 이름 그대로. */
function displayName(person: PromptLinkPerson, lang: "ko" | "en"): string {
  const alias = person.aliases?.map((word) => word.trim()).find(Boolean);
  return lang === "en" && alias ? alias : person.name;
}

/**
 * 아직 그림이 없는 인물·배경·구도를 적는 줄.
 *
 * 이름만 적으면 생성기에 아무 뜻이 없으므로 **생김새를 함께** 적습니다. 생김새조차
 * 없으면 이름만이라도 남깁니다 — 자리가 있어야 나중에 이어 붙일 수 있습니다.
 */
function pendingLine(input: PromptLinkInput, lang: "ko" | "en"): string {
  const parts: string[] = [];
  const say = (name: string, look?: string) => {
    const text = oneLine(look || "");
    parts.push(text ? `${oneLine(name)} — ${text}` : oneLine(name));
  };
  /*
    영문 칸에는 **생김새를 안 적습니다.** 카드의 생김새는 한국어뿐이라 그대로 넣으면 영문 프롬프트에
    한글 문단이 박힙니다(). 영문 본문은
    LLM 이 이미 영어로 그 사람을 그려 두었으니 여기서는 **자리(이름)만** 잡습니다 — 그림이 오면 그
    이름이 @태그로 바뀝니다. 구도만은 영문 요약이 따로 있어(`guideNoteEn`) 그것을 씁니다.
  */
  const en = lang === "en";
  const guideNote = en ? input.guideNoteEn : input.guideNote;
  if (!input.guidePath && guideNote?.trim()) say(en ? "layout" : "구도", guideNote);
  if (!input.backgroundPath && input.background?.name)
    say(input.background.name, en ? undefined : input.background.look);
  input.people.forEach((person) => {
    if (!input.representativeImagePath && !person.paths.some(Boolean)) say(displayName(person, lang), en ? undefined : person.look);
  });
  if (!parts.length) return "";
  return `${lang === "ko" ? PENDING_KO : PENDING_EN} ${parts.join(" / ")}`;
}

/**
 * **옛 판이 남긴 여러 줄 꼬리의 나머지.** 2026-09-22 전의 `pendingLine` 은 생김새를 여러 줄 그대로 넣어,
 * 머리말이 없는 둘째 줄부터가 본문에 남았습니다. 지금 재료로 그때의 줄을 다시 지어 보고 같으면 걷어
 * 냅니다 — 재료가 바뀌었으면 못 알아보지만, 그때는 아래의 «같은 문단 하나만» 이 쌓인 것은 정리합니다.
 */
function legacyTailRests(input: PromptLinkInput): string[] {
  const parts: string[] = [];
  const say = (name: string, look?: string) => {
    const text = (look || "").trim();
    parts.push(text ? `${name} — ${text}` : name);
  };
  if (!input.guidePath && input.guideNote?.trim()) say("구도", input.guideNote);
  if (!input.backgroundPath && input.background?.name) say(input.background.name, input.background.look);
  input.people.forEach((person) => {
    if (!person.paths.some(Boolean)) say(person.name, person.look);
  });
  const rest = parts.join(" / ").split(/\r?\n/).slice(1).join("\n").trim();
  return rest ? [rest] : [];
}

/**
 * 본문과 **꼬리 줄**(참고 그림 · 아직 그림 없음)을 가릅니다.
 *
 * «구성» 이 본문의 이름을 `@태그` 로 바꿀 때 꼬리 줄까지 같이 바꾸면, 「서진우 @서진우_001」
 * 이 「@서진우_001 @서진우_001」 로 칩이 두 번 섭니다(2026-09-21 국호 씬 1 실측 — 마그니픽에
 * 붙여 넣은 페이로드에서 확인). 꼬리 줄은 이미 태그가 서 있는 줄이라 손대지 않습니다.
 */
export function splitLinkTail(text: string): { body: string; tail: string } {
  const lines = text.split(/\r?\n/);
  return {
    body: lines.filter((line) => !isTailHead(line)).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
    tail: lines.filter(isTailHead).join("\n"),
  };
}

/**
 * 머리말로 시작하는 줄을 지웁니다 — 갈아 끼우기 전에 옛 줄을 걷어 내는 일.
 *
 * 옛 판의 찌꺼기(`legacyTailRests`)와 **같은 문단이 두 번 이상** 있는 것도 여기서 정리합니다.
 * 사람이 쓴 프롬프트에 똑같은 문단이 거듭 나올 일은 없어, 그것은 잇기가 쌓은 것으로 보고 하나만
 * 남깁니다 — 이미 다섯 벌이 쌓인 컷도 한 번 누르면 깨끗해지게.
 */
function stripLinkLine(text: string, input?: PromptLinkInput): string {
  let body = text
    .split(/\r?\n/)
    .filter((line) => !isTailHead(line))
    .join("\n");
  if (input) {
    for (const rest of legacyTailRests(input)) body = body.split(rest).join("");
  }
  const seen = new Set<string>();
  const paragraphs = body.split(/\n{2,}/).filter((paragraph) => {
    const key = paragraph.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return paragraphs.join("\n\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * 본문에 박힌 죽은 `@토큰` 을 지금 태그로 바꿉니다.
 *
 * 토큰이 어느 인물 것인지는 **이름 앞머리**로 봅니다. 그 인물에게 그림이 여러 장이면
 * 첫 장으로 모읍니다 — 옛 프롬프트가 두 장을 구분해 쓰고 있었는지는 알 길이 없고,
 * 나머지는 참고 줄에 그대로 남으므로 연결이 끊기지는 않습니다.
 */
function relinkBody(text: string, input: PromptLinkInput): string {
  /*
    ── 살아 있는 태그를 **먼저 숨깁니다** ────────────────────────────────
    아래 토큰 정규식(`@[\w가-힣.\-]+`)은 공백과 괄호에서 멈춥니다. 그런데 폴더 이름이
    「서진우 (니시무라 진)」 이면 파일 이름도 「서진우 (니시무라 진)_001」 이라, 이미
    제대로 걸려 있는 태그를 앞머리 `@서진우` 까지만 읽고 «죽은 토큰» 으로 오해했습니다.
    그래서 다시 갈아 끼워 `@서진우 (니시무라 진)_001 (니시무라 진)_001` 이 됐습니다
    (2026-09-21 실측에서 잡음 — 「@ 다시 잇기」 를 두 번 누르면 매번 길어졌습니다).

    파일 이름은 사람이 짓는 것이라 어떤 글자든 들어올 수 있습니다. 정규식을 넓히는 대신
    **지금 살아 있는 태그를 통째로 자리표에 숨겨 두고**, 남은 것만 정규식으로 손봅니다.
    숨기는 일은 `hideTags` 한 벌 — `tagCharacterNames` 도 같은 까닭으로 같은 것을 씁니다.
  */
  const { guarded, restore } = hideTags(text, livingTags(input));
  /*
    ── 죽은 토큰은 **이름 전체**로 맞춥니다 ──────────────────────────────
    파일 이름은 «이름_번호» 또는 «이름_변형_번호» 라 죽은 태그도 `@이름` 으로 시작해 `_번호` 로 끝납니다.
    이름에 공백·괄호가 있어도(「서진우 (니시무라 진)」) 이름을 글자 그대로 맞추면 태그 끝까지 한 덩어리로
    잡힙니다. 여태는 `@[\w가-힣.\-]+` 하나로 앞머리만 잡았고, 그마저 「서진우」 가 「서진우 (니시무라 진)」
    로 시작하지 않아 주인을 못 찾았습니다 — 그림을 뺀 사람의 태그가 그대로 남았습니다().

    그림이 없어진 사람의 태그는 **맨 이름으로 되돌립니다.** 죽은 태그를 두면 생성기가 없는 그림을 찾고,
    이름으로 돌려 두면 «아직 그림 없음» 줄이 그 사람을 받치고 다음 그림이 오면 다시 태그가 됩니다.
    긴 이름부터 — 「수」 가 「수화」 의 태그를 잘라먹지 않게. 이름을 모르는 토큰은 그대로 둡니다.
  */
  const owners = [
    ...input.people.map((person) => {
      const first = person.paths.find(Boolean);
      return { name: person.name.trim(), replacement: first ? tagOf(first) : person.name.trim() };
    }),
    ...(input.background?.name
      ? [{
          name: input.background.name.trim(),
          replacement: input.backgroundPath ? tagOf(input.backgroundPath) : input.background.name.trim(),
        }]
      : []),
  ]
    .filter((owner) => owner.name)
    .sort((a, b) => b.name.length - a.name.length);
  let replaced = guarded;
  for (const owner of owners) {
    // 이름 뒤는 «_…_번호» 까지 — 번호가 없으면 이름만. 붙은 조사(「_001이」)는 남겨야 문장이 삽니다.
    const dead = new RegExp(`@${escapeRegExp(owner.name)}(?:[^\\n@]*?_\\d{3,})?`, "g");
    replaced = replaced.replace(dead, owner.replacement);
  }
  return restore(replaced);
}

/** 한 칸(한국어 또는 영어)의 연결 부를 다시 잇습니다. */
export function relinkPromptText(
  text: string,
  input: PromptLinkInput,
  lang: "ko" | "en",
): string {
  /*
    빈 칸에는 참고 줄만 남습니다 — 그러면 「@냥이_001」 한 줄이 프롬프트 행세를 합니다.
    비어 있는 칸은 건드리지 않고 그대로 둡니다. 채우는 것은 「프롬프트 작성」 의 일입니다.
  */
  if (!(text ?? "").trim()) return text ?? "";
  /*
    ── 순서가 중요합니다 ────────────────────────────────────────────────
    ① 옛 참고 줄을 걷어 내고 ② 본문의 죽은 @토큰을 지금 그림으로 바꾸고
    ③ **맨 이름을 태그로 올리고** ④ 참고 줄과 «아직 없음» 줄을 새로 답니다.

    ③ 이 이번에 새로 생긴 일입니다.  그림이 없던 시절에 쓴 프롬프트에는
    `@토큰` 이 **하나도 없어서** ② 가 바꿀 것을 못 찾았습니다. 본문에는 「서진우가」
    라고 맨 이름만 있었고요. 그래서 이름 자체를 태그로 올립니다 — 이게 사용자가 말한
    「이미지 뽑았을 때 바로 해당 이미지가 연결이 돼지」 입니다.
  */
  const linked = tagCharacterNames(
    relinkBody(stripLinkLine(text, input), input),
    input.people.map((person) => ({
      name: person.name,
      tag: person.paths.find(Boolean) ? tagOf(person.paths.find(Boolean) as string) : undefined,
      // 영문 본문의 로마자 이름도 같은 태그로 — 두 «구성» 이 넘기는 것과 같은 목록입니다.
      aliases: person.aliases,
    })),
  );
  const missingSheets = input.representativeImagePath ? input.people.filter(person => !person.paths.some(Boolean)) : [];
  const optional = missingSheets.length
    ? `${lang === "ko" ? OPTIONAL_KO : OPTIONAL_EN} ${missingSheets.map(person => oneLine(displayName(person, lang))).join(" / ")}`
    : "";
  const tail = [linkLine(input, lang), pendingLine(input, lang), optional].filter(Boolean);
  if (!tail.length) return linked;
  return linked ? `${linked}\n\n${tail.join("\n")}` : tail.join("\n");
}

export interface RelinkResult {
  promptKo: string;
  promptEn: string;
  /** 바뀐 것이 있는가 — 없으면 버튼이 「바꿀 게 없다」 고 말해 줍니다. */
  changed: boolean;
}

/** 두 칸을 한 번에. 컷 카드의 「@ 다시 잇기」 가 부르는 자리입니다. */
export function relinkPrompts(
  current: { promptKo?: string; promptEn?: string },
  input: PromptLinkInput,
): RelinkResult {
  const promptKo = relinkPromptText(current.promptKo ?? "", input, "ko");
  const promptEn = relinkPromptText(current.promptEn ?? "", input, "en");
  return {
    promptKo,
    promptEn,
    changed:
      promptKo !== (current.promptKo ?? "") ||
      promptEn !== (current.promptEn ?? ""),
  };
}
