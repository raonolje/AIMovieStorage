import {
  ERA_PRESETS,
  GENRE_OPTIONS,
  STYLE_OPTIONS,
  summarizeProjectContext,
  type ProjectContextSummary,
} from "@/lib/projectContext";
import { CUT_TOGGLE_GROUPS, cutTogglesEnglish } from "@/lib/cutStyle";
import { normalizeProfile } from "@/lib/characterProfile";
import { safeFileName } from "@/lib/mediaLibrary";
import { buildShotComposition } from "@/lib/bootstrapShots";
import { buildRulePrompt } from "@/lib/rulePrompt";
import { summarizeBlueprint } from "@/lib/blueprint";
import { appendPromptHistory, describeRunConditions } from "@/lib/promptHistory";
import { autoRealism } from "@/lib/autoRealism";
import { buildCutVideoPrompt } from "@/lib/cutVideoPrompt";
import type { SpaceKind } from "@/lib/blueprint";
import {
  newBackground,
  newCharacter,
  newCut,
  uid,
  type Background,
  type Character,
  type Cut,
  type ProjectDraft,
  type Scene,
} from "@/lib/projectTypes";

/**
 * «AI 로 일괄 생성» 의 머리 — **LLM 없이 도는 부분만** 모아 둔 곳.
 *
 * 시나리오 한 덩어리를 넣으면 작품 정보·캐릭터·배경·씬 초안이 한 번에 들어가는
 * 기능인데, 화면과 API 호출에 섞어 두면 «제대로 채워졌는가» 를 확인할 방법이
 * 요청을 실제로 보내는 것밖에 없습니다. 요청 하나에 수십 초가 걸리고 값도 매번
 * 달라서, 그 방식으로는 채워 넣기 규칙이 맞는지 영영 못 봅니다.
 *
 * 그래서 **받아 온 JSON 을 읽는 일(parse…)과 초안에 얹는 일(applyBootstrapToDraft)을
 * 순수 함수로** 떼어 두었습니다. 시나리오 JSON 만 있으면 LLM 없이 시험할 수 있습니다.
 *
 * 두 가지를 특히 지킵니다.
 *
 * - **관대하게 읽습니다.** 모델은 키 이름을 제멋대로 바꾸고(`name`/`이름`/`title`),
 * 한 겹 더 싸서 돌려주기도 합니다(`{"result": {...}}`). 엄격하게 읽으면 답이
 * 멀쩡한데도 빈 초안이 들어갑니다 — 프롬프트 네 칸이 비어 들어갔던 사고와 같은 꼴입니다.
 * - **덧붙이기는 기존 것을 건드리지 않습니다.** 이미 적어 둔 제목·줄거리를 덮어쓰면
 * 되돌릴 길이 없습니다. 덧붙이기에서 홑값(제목·로그라인 등)은 **비어 있을 때만** 채웁니다.
 *
 * 여기서는 **폴더에 파일을 만들지도 지우지도 않습니다.** 그림은 아직 없으니까요.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 받아 오는 모양
// ─────────────────────────────────────────────────────────────────────────────

/** 1단계 결과 — 작품 정보와 «누가·어디» 목록. */
export interface BootstrapOutlineEntry {
  name: string;
  /** 한 줄 설명. 2단계에 그대로 넘겨 상세를 받습니다. */
  note: string;
}

export interface BootstrapOutline {
  title: string;
  logline: string;
  /** 줄거리. 한 줄 줄거리(logline)보다 긴 글입니다. */
  synopsis: string;
  /** 톤·분위기. 자유 문장입니다. */
  tone: string;
  /** 분량. "3분 단편" 처럼 적힙니다. */
  runtime: string;
  /** 앱의 장르 칩(GENRE_OPTIONS)으로 맞춘 것만 남습니다. */
  genres: string[];
  /** 앱의 스타일 칩(STYLE_OPTIONS)으로 맞춘 것만 남습니다. */
  styles: string[];
  /** 시대 프리셋 id 로 맞춘 것만 남습니다. */
  eras: string[];
  characters: BootstrapOutlineEntry[];
  backgrounds: BootstrapOutlineEntry[];
}

/** 2단계 결과 — 캐릭터·배경 상세와 씬·컷 초안. */
export interface BootstrapCharacter {
  name: string;
  role: string;
  gender: string;
  age: string;
  heightCm: number;
  build: Character["build"];
  kind: Character["kind"];
  description: string;
  personality: string;
  speech: string;
  habits: string;
  tagline: string;
}

export interface BootstrapBackground {
  name: string;
  location: string;
  description: string;
  spaceKind: SpaceKind;
  /** 시간대·분위기는 배경 카드에 따로 칸이 없어서 설명 뒤에 붙습니다. */
  timeOfDay: string;
  mood: string;
}

export interface BootstrapCut {
  title: string;
  description: string;
  /** 이름으로만 옵니다. id 는 초안에 얹을 때 맞춥니다. */
  characterNames: string[];
  backgroundName: string;
  /**
   * 이 컷이 몇 초짜리인가.
   *
   * 컷을 영상으로 뽑을 때
   * 러닝타임이 필요한데, 구도잡기를 열기 전에는 잴 것이 없습니다. 기획 단계에서 받아
   * 두면 «구도를 잡기 전에도» 영상 프롬프트가 그럴듯한 길이를 답니다(`cutVideoSeconds`).
   * 구도잡기에서 타임라인을 잡으면 그쪽이 이깁니다 — 잰 값이 적어 둔 값보다 셉니다.
   */
  seconds: number;
  /** 비·불꽃·연기처럼 그림만으로는 안 되는 것. 컷 카드의 VFX 칸으로 갑니다. */
  vfx: string;
  /**
   * **대사와 연기 지시** — 「이름: "대사" — 어떻게」.
   *
   * 대본에는 대사가 이미
   * 다 적혀 있는데 일괄 생성이 그 칸을 통째로 비워 두어서, 컷 72개가 **대사 없이**
   * 영상 프롬프트를 지었습니다. 대사로 가는 작품에서는 그게 알맹이가 빠진 것입니다.
   */
  acting: string;
  /**
   * 같은 지시의 **영어판**. 이것이 생성기로 갑니다.
   *
   * 대사 **원문은 한국어 그대로** 둡니다 — 요즘 모델은 한국어를 말하고, 번역하면 입모양과
   * 소리가 대본과 달라집니다. 바깥의 연기 지시만 영어입니다. 모델마다의 대사 문법
   * (콜론·대괄호·`<d>` 태그…)은 `lib/dialogueShape.ts` 가 여기서 다시 빚습니다.
   */
  actingEn: string;
  /** 연출 토글 id(`CUT_TOGGLE_GROUPS`). 라벨로 와도 id 로 맞춰 둡니다. */
  styleTags: string[];
}

export interface BootstrapScene {
  title: string;
  summary: string;
  characterNames: string[];
  backgroundName: string;
  cuts: BootstrapCut[];
}

export interface BootstrapDetails {
  characters: BootstrapCharacter[];
  backgrounds: BootstrapBackground[];
  scenes: BootstrapScene[];
}

/**
 * 3단계 — 컷마다 **어떻게 찍을지**와 **키 이미지 프롬프트**.
 *
 *
 *
 * 카메라 좌표는 **받지 않습니다.** 감독이 쓰는 말(샷 크기·앵글)과 사람이 서는 자리만
 * 받아, 거리와 높이는 `bootstrapShots` 가 풉니다 — 말로 시킨 좌표는 화각·키와 늘 어긋납니다.
 */
export interface BootstrapShotCut {
  order: number;
  shot: string;
  angle: string;
  outdoor: boolean;
  size: number;
  height: number;
  people: { name: string; x: number; z: number; facing: number }[];
  promptKo: string;
  promptEn: string;
}

export interface BootstrapShots {
  scenes: { title: string; cuts: BootstrapShotCut[] }[];
}

export interface BootstrapResult {
  outline: BootstrapOutline;
  details: BootstrapDetails;
  /** 3단계. 없으면 구도·프롬프트를 비워 둡니다(2단계까지만 돌렸을 때). */
  shots?: BootstrapShots;
}

export interface BootstrapApplyOptions {
  /** append — 기존 것 뒤에 붙임(기본) / replace — 캐릭터·배경·장면 목록을 비우고 새로 */
  mode: "append" | "replace";
}

// ─────────────────────────────────────────────────────────────────────────────
// 관대하게 읽기
// ─────────────────────────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

/**
 * 무엇이 오든 객체 하나로 만듭니다.
 *
 * 글자열로 온 경우(```json 펜스가 붙은 답을 그대로 넘긴 경우 포함)도 받습니다.
 * `llm.ts` 의 parseJsonResponse 와 같은 규칙이지만, 이 파일은 LLM 호출과 엮이지
 * 않아야 시험할 수 있어서 여기에 작은 판을 따로 둡니다.
 */
function toBag(value: unknown): Bag {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (fenced ? fenced[1] : trimmed).trim();
    try {
      return toBag(JSON.parse(candidate));
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return toBag(JSON.parse(candidate.slice(start, end + 1)));
        } catch {
          return {};
        }
      }
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Bag;
}

/** `{"result": {...}}` 처럼 한 겹 더 싸서 오는 경우를 벗깁니다. */
function unwrap(bag: Bag, ownKeys: string[]): Bag {
  if (ownKeys.some((key) => key in bag)) return bag;
  for (const key of ["result", "data", "output", "project", "bootstrap", "details", "response"]) {
    const inner = bag[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Bag;
  }
  return bag;
}

function str(bag: Bag, keys: string[]): string {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/** 숫자 한 칸 — 글자로 와도(「-0.4」) 받습니다. 못 읽으면 0. */
function num(bag: Bag, keys: string[]): number {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

/** 배열이 아니라 «쉼표로 이은 한 줄» 로 오는 일이 잦습니다. 둘 다 받습니다. */
function strList(bag: Bag, keys: string[]): string[] {
  for (const key of keys) {
    const value = bag[key];
    if (Array.isArray(value)) {
      const items = value
        .map((item) => (typeof item === "string" ? item.trim() : str(toBag(item), ["name", "이름", "label", "title"])))
        .filter(Boolean);
      if (items.length) return items;
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[,·/]|、/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/** 목록을 꺼냅니다. `{"characters": [...]}` 도 `[...]` 도 받습니다. */
function bagList(bag: Bag, keys: string[]): Bag[] {
  for (const key of keys) {
    const value = bag[key];
    if (Array.isArray(value)) return value.map((item) => toBag(item));
    // 이름을 키로 삼은 사전({"여울": {...}})으로 오는 경우 — 이름을 안으로 넣어 줍니다.
    if (value && typeof value === "object") {
      return Object.entries(value as Bag).map(([name, item]) => ({ name, ...toBag(item) }));
    }
  }
  return [];
}

function firstNumber(text: string): number | null {
  const matched = text.match(/-?\d+(\.\d+)?/);
  return matched ? Number(matched[0]) : null;
}

/** 목록의 어느 말과 걸리는지. 없으면 빈 문자열. */
function matchOption(value: string, options: string[]): string {
  const text = value.trim();
  if (!text) return "";
  const exact = options.find((option) => option === text);
  if (exact) return exact;
  const loose = options.find(
    (option) => option.includes(text) || text.includes(option),
  );
  return loose ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// 1단계 — 작품 정보와 목록
// ─────────────────────────────────────────────────────────────────────────────

function parseEntries(bag: Bag, keys: string[]): BootstrapOutlineEntry[] {
  return bagList(bag, keys)
    .map((item) => ({
      name: str(item, ["name", "이름", "title", "제목", "label"]),
      note: str(item, ["note", "설명", "description", "summary", "요약", "oneLine", "hint", "role", "역할"]),
    }))
    .filter((entry) => entry.name);
}

export function parseBootstrapOutline(raw: unknown): BootstrapOutline {
  const bag = unwrap(toBag(raw), ["title", "logline", "characters", "제목"]);

  const genres = strList(bag, ["genres", "genre", "장르"])
    .map((value) => matchOption(value, GENRE_OPTIONS))
    .filter(Boolean);
  const styles = strList(bag, ["styles", "style", "visualStyle", "스타일"])
    .map((value) => matchOption(value, STYLE_OPTIONS))
    .filter(Boolean);
  /*
    시대는 **아는 프리셋만** 받습니다.
    모르는 말을 그대로 넣으면 프롬프트 요약이 그 값을 영어로 못 옮겨 조용히
    빠집니다(projectContext.eraPointEnglish 의 사연). 못 맞춘 것은 톤·줄거리
    글 안에 남아 있으니 사람이 보고 고르면 됩니다.
  */
  const eras = strList(bag, ["eras", "era", "period", "시대"])
    .map((value) => {
      const found = ERA_PRESETS.find(
        (preset) => preset.id === value || preset.label === value || preset.label.includes(value),
      );
      return found?.id ?? "";
    })
    .filter(Boolean);

  return {
    title: str(bag, ["title", "제목", "workTitle"]),
    logline: str(bag, ["logline", "로그라인", "oneLine", "tagline", "한줄"]),
    synopsis: str(bag, ["synopsis", "줄거리", "story", "plot", "outline", "summary", "요약"]),
    tone: str(bag, ["tone", "mood", "톤", "분위기"]),
    runtime: str(bag, ["runtime", "length", "duration", "분량", "러닝타임"]),
    genres: [...new Set(genres)],
    styles: [...new Set(styles)],
    eras: [...new Set(eras)],
    characters: parseEntries(bag, ["characters", "캐릭터", "인물", "cast"]),
    backgrounds: parseEntries(bag, ["backgrounds", "배경", "장소", "locations", "places"]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2단계 — 상세와 씬·컷
// ─────────────────────────────────────────────────────────────────────────────

const BUILD_WORDS: { build: Character["build"]; words: string[] }[] = [
  { build: "slim", words: ["마른", "슬림", "호리", "가녀", "왜소", "slim", "slender", "thin", "lean"] },
  { build: "athletic", words: ["탄탄", "근육", "다부", "운동", "athletic", "muscular", "fit", "toned"] },
  { build: "broad", words: ["건장", "덩치", "우람", "육중", "뚱뚱", "broad", "heavy", "large", "burly"] },
];

function toBuild(value: string): Character["build"] {
  const text = value.toLowerCase();
  if (!text) return "average";
  for (const item of BUILD_WORDS) {
    if (item.words.some((word) => text.includes(word))) return item.build;
  }
  return "average";
}

const KIND_WORDS: { kind: Character["kind"]; words: string[] }[] = [
  { kind: "animal", words: ["동물", "짐승", "고양이", "강아지", "개", "새", "말", "animal", "beast", "cat", "dog"] },
  {
    kind: "creature",
    words: ["괴물", "요괴", "정령", "몬스터", "로봇", "유령", "신수", "creature", "monster", "spirit", "robot", "ghost"],
  },
];

function toKind(value: string): Character["kind"] {
  const text = value.toLowerCase();
  if (!text) return "human";
  for (const item of KIND_WORDS) {
    if (item.words.some((word) => text.includes(word))) return item.kind;
  }
  return "human";
}

function toSpaceKind(value: string): SpaceKind {
  const text = value.toLowerCase();
  if (/실내|내부|안|indoor|interior|inside/.test(text)) return "interior";
  if (/혼합|반실내|둘 다|both|mixed|semi/.test(text)) return "mixed";
  return "exterior";
}

/**
 * 컷 길이(초)를 읽습니다. 「4초」「4」「4.5s」 가 다 옵니다.
 *
 * 1~10초로 자릅니다 — 영상 생성기가 받는 범위이고(`cutVideoSeconds` 와 같은 규칙),
 * 「이 컷은 90초」 같은 답이 그대로 들어가면 생성기가 통째로 거절합니다.
 * 못 읽으면 0 을 돌려주고, 얹는 쪽이 «안 적힌 것» 으로 봅니다.
 */
function toCutSeconds(value: string): number {
  const matched = (value || "").match(/[\d.]+/);
  if (!matched) return 0;
  const seconds = Number(matched[0]);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(10, Math.max(1, Math.round(seconds * 2) / 2));
}

/**
 * 연출 토글을 **앱이 아는 id 로만** 남깁니다.
 *
 * 모델은 라벨(「시네마틱」)로도 id(`cinematic`)로도 답합니다. 둘 다 받되, 목록에 없는
 * 말은 버립니다 — 컷 카드의 칩은 id 로 그려서, 모르는 값이 들어가면 빈 칩이 섭니다.
 * 샷 크기·앵글·무빙은 애초에 이 목록에 없습니다(구도잡기가 잽니다).
 */
function toStyleTags(values: string[]): string[] {
  const table = new Map<string, string>();
  for (const group of CUT_TOGGLE_GROUPS) {
    for (const option of group.options) {
      table.set(option.id.toLowerCase(), option.id);
      table.set(option.label.trim().toLowerCase(), option.id);
    }
  }
  const out: string[] = [];
  for (const value of values) {
    const found = table.get((value || "").trim().toLowerCase());
    if (found && !out.includes(found)) out.push(found);
  }
  return out;
}

/**
 * 키를 cm 로.
 *
 * 「172cm」「172」「1.72m」 이 다 옵니다. m 로 온 것을 그대로 넣으면 키가 1cm 인
 * 인물이 생겨서 구도잡기에서 바닥에 붙습니다.
 *
 * **아래 한계가 5cm 인 이유.** 2단계 요청문은 「사람이 아닌 존재도 heightCm 을 적습니다」
 * 라고 시킵니다. 참새 15cm · 요정 12cm 가 정상적인 답인데 20cm 로 잘라 두었더니 그 값이
 * 버려지고 사람 기본값 170 이 들어가, 구도잡기에 **사람만 한 참새**가 섰습니다.
 * 빈 값이 아니라 «그럴듯한 거짓값» 이라 사람이 알아채지 못합니다.
 *
 * 못 읽었을 때의 기본값도 갈래를 봅니다. 사람은 170, 동물·괴물은 작은 쪽(40)으로
 * 기울입니다 — 크게 틀린 값은 그럴듯해서 지나치지만, 작게 틀린 값은 화면에서 바로 보입니다.
 */
const NON_HUMAN_HEIGHT_CM = 40;

function toHeightCm(value: string, kind: Character["kind"]): number {
  const fallback = kind === "human" ? 170 : NON_HUMAN_HEIGHT_CM;
  const number = firstNumber(value);
  if (number === null) return fallback;
  const cm = number > 0 && number < 3 ? Math.round(number * 100) : Math.round(number);
  return cm >= 5 && cm <= 400 ? cm : fallback;
}

function parseCharacter(bag: Bag): BootstrapCharacter {
  // 갈래를 먼저 정합니다 — 키의 기본값이 사람이냐 아니냐에 따라 달라집니다.
  const kind = toKind(str(bag, ["kind", "종류", "species", "type", "종족"]));
  return {
    name: str(bag, ["name", "이름", "title"]),
    role: str(bag, ["role", "역할", "position", "job", "직업"]),
    gender: str(bag, ["gender", "성별", "sex"]),
    age: str(bag, ["age", "나이", "ageRange", "나이대"]),
    heightCm: toHeightCm(str(bag, ["heightCm", "height", "키", "신장"]), kind),
    build: toBuild(str(bag, ["build", "체형", "physique", "body"])),
    kind,
    description: str(bag, ["description", "appearance", "외형", "설명", "look", "visual"]),
    personality: str(bag, ["personality", "성격", "character"]),
    speech: str(bag, ["speech", "말투", "voice", "tone"]),
    habits: str(bag, ["habits", "습관", "버릇", "quirks"]),
    tagline: str(bag, ["tagline", "한줄", "한 줄 요약", "summary", "요약"]),
  };
}

function parseBackground(bag: Bag): BootstrapBackground {
  return {
    name: str(bag, ["name", "이름", "title"]),
    location: str(bag, ["location", "장소", "place", "where"]),
    description: str(bag, ["description", "설명", "detail", "look", "visual"]),
    spaceKind: toSpaceKind(str(bag, ["spaceKind", "실내외", "indoorOutdoor", "space", "type", "종류"])),
    timeOfDay: str(bag, ["timeOfDay", "시간대", "time", "when"]),
    mood: str(bag, ["mood", "분위기", "atmosphere", "tone"]),
  };
}

function parseCut(bag: Bag): BootstrapCut {
  return {
    title: str(bag, ["title", "제목", "name", "label"]),
    description: str(bag, ["description", "설명", "action", "summary", "요약", "line", "한줄"]),
    characterNames: strList(bag, ["characters", "characterNames", "등장인물", "인물", "cast"]),
    backgroundName: str(bag, ["background", "backgroundName", "배경", "location", "장소"]),
    seconds: toCutSeconds(str(bag, ["seconds", "duration", "길이", "초", "durationSeconds"])),
    vfx: str(bag, ["vfx", "effects", "효과", "이펙트"]),
    acting: str(bag, ["acting", "dialogue", "대사", "연기", "대사연기", "line", "speech"]),
    actingEn: str(bag, ["actingEn", "dialogueEn", "acting_en", "영어대사", "actingEnglish"]),
    styleTags: toStyleTags(strList(bag, ["style", "styleTags", "연출", "tags", "톤"])),
  };
}

function parseScene(bag: Bag): BootstrapScene {
  const characterNames = strList(bag, ["characters", "characterNames", "등장인물", "인물", "cast"]);
  const backgroundName = str(bag, ["background", "backgroundName", "배경", "location", "장소"]);
  const cuts = bagList(bag, ["cuts", "컷", "shots", "panels"]).map(parseCut);
  return {
    title: str(bag, ["title", "제목", "name"]),
    summary: str(bag, ["summary", "요약", "description", "설명", "synopsis"]),
    characterNames,
    backgroundName,
    /*
      컷이 하나도 없으면 빈 컷 하나를 둡니다. 씬 카드는 컷 없이도 열리지만,
      «장면만 있고 컷이 없는 카드» 는 사람이 보기에 만들다 만 것처럼 보입니다.
    */
    cuts: cuts.length
      ? cuts
      : [
          {
            title: "",
            description: "",
            characterNames: [],
            backgroundName: "",
            seconds: 0,
            vfx: "",
            acting: "",
            actingEn: "",
            styleTags: [],
          },
        ],
  };
}

export function parseBootstrapDetails(raw: unknown): BootstrapDetails {
  const bag = unwrap(toBag(raw), ["characters", "backgrounds", "scenes", "캐릭터", "씬"]);
  return {
    characters: bagList(bag, ["characters", "캐릭터", "인물", "cast"]).map(parseCharacter).filter((item) => item.name),
    backgrounds: bagList(bag, ["backgrounds", "배경", "장소", "locations"]).map(parseBackground).filter((item) => item.name),
    scenes: bagList(bag, ["scenes", "씬", "장면", "sequences"]).map(parseScene),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 초안에 얹기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이름을 **폴더 이름으로** 바꿔 견줍니다.
 *
 * 「여울/현재」 와 「여울:현재」 는 화면에서는 다른 이름이지만 폴더는 `safeFileName` 이
 * 정리해 「여울_현재」 하나로 만듭니다. 화면 이름끼리만 견주면 이 둘이 한 폴더를 나눠
 * 쓰게 되고, 한 장을 지울 때 다른 쪽 그림까지 지워집니다(규칙 3·5).
 */
function folderKey(name: string): string {
  const trimmed = (name || "").trim();
  return trimmed ? safeFileName(trimmed) : "";
}

/**
 * 새로 만들 것과 건너뛸 것을 **갈래 안에서** 가릅니다. 미리보기와 적용이 이 하나를
 * 같이 씁니다 — 규칙을 두 곳에 적어 두었더니 화면은 「캐릭터 2」 라고 하고 실제로는
 * 3 개가 들어갔습니다(캐릭터·배경 이름을 한 자루에 섞어 세던 시절).
 *
 * 두 가지를 봅니다.
 *
 * - 이미 있는 카드 이름(`existing`) — 폴더는 인물당 하나라(규칙 5) 같은 이름이 둘이면
 * 파일이 섞입니다.
 * - **이번 답 안의 중복** — 2단계 답은 목록을 다시 적으면서 같은 이름을 두 번 넣는 일이
 * 잦습니다. 예전에는 «이미 있는 카드» 만 보아서 이쪽이 그대로 통과했고, 카드 두 장이
 * 한 폴더를 읽어 서로의 파일을 제 레퍼런스로 주웠습니다.
 */
function pickNew<T extends { name: string }>(
  items: T[],
  existing: string[],
): { made: T[]; skipped: string[] } {
  const taken = new Set(existing.map(folderKey).filter(Boolean));
  const made: T[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    const key = folderKey(item.name);
    if (!key) continue;
    if (taken.has(key)) {
      skipped.push(item.name.trim());
      continue;
    }
    taken.add(key);
    made.push(item);
  }
  return { made, skipped };
}

/**
 * 이 카드에 **폴더에 저장된 그림이 붙어 있는가.**
 *
 * 칸 이름을 하나하나 적지 않고 얕게 훑습니다 — 레퍼런스·생성 이미지·변형·에셋·다른 원본이
 * 층층이라, 목록을 적어 두면 칸이 하나 늘 때 빠뜨립니다. 여기서 빠뜨리면 «비우고 새로» 가
 * 그림 있는 카드를 지워 폴더가 고아로 남습니다.
 */
export function hasStoredImage(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 6) return false;
  if (Array.isArray(value)) return value.some((item) => hasStoredImage(item, depth + 1));
  const bag = value as Bag;
  if (typeof bag.filePath === "string" && bag.filePath.trim()) return true;
  return Object.values(bag).some((item) => hasStoredImage(item, depth + 1));
}

/**
 * «비우고 새로» 에서도 **남기는 카드** — 그림이 붙은 것.
 *
 * 목록에서만 빼면 그 인물 폴더를 지울 길이 앱에 없어집니다. 폴더를 지우는 곳은
 * 카드 삭제(`useEntityLineage` → `deleteOwnerFolder`) 하나뿐이라, 카드가 사라진 뒤에는
 * 탐색기로 가야 합니다. 게다가 새 목록에 같은 이름이 있으면 새 카드가 폴더 훑기로
 * **옛 그림을 제 레퍼런스로 조용히 주워** 오고, 그 카드를 지우면 옛 파일까지 지워집니다.
 */
export function cardsWithImages<T>(list: T[]): T[] {
  return list.filter((item) => hasStoredImage(item));
}

/** 1단계의 한 줄 설명을 2단계 상세에 보태 둡니다. 상세가 비어 있을 때만 씁니다. */
function noteFor(entries: BootstrapOutlineEntry[], name: string): string {
  return entries.find((entry) => entry.name === name)?.note ?? "";
}

function buildCharacter(
  source: BootstrapCharacter,
  note: string,
  context: ProjectContextSummary | null,
): Character {
  const created = newCharacter();
  /*
    **시트 프롬프트를 규칙으로 채워 둡니다.**

    일괄 생성이 카드를 만들어 놓고 프롬프트 칸은 비워 두었습니다. 그런데 이 카드의
    프롬프트는 **LLM 이 없어도** 지을 수 있습니다 — 고른 구성 칸과 외형 설명, 작품 설정만
    있으면 «규칙 조립» 이 하는 일과 같습니다(`buildRulePrompt`). 그래서 여기서 미리 짓습니다.
    사람이 고쳐 쓰거나 «프롬프트 작성» 으로 다시 받으면 그것이 이깁니다.
  */
  const made = buildRulePrompt({
    kind: "character",
    name: source.name,
    description: source.description || note,
    blueprint: created.blueprint,
    context,
    referenceCount: 0,
    basics: [
      source.gender,
      source.age,
      source.heightCm ? `${source.heightCm}cm` : "",
      source.build,
    ].filter(Boolean),
  });
  return {
    ...created,
    promptKo: made.ko,
    promptEn: made.en,
    negativeKo: made.negativeKo,
    negativeEn: made.negativeEn,
    /*
      ── 기록에도 남깁니다 ────────────────────────────────────────────
      

      그래서 «어떤 칸을 켜고 뽑았는가» 를 사람이 읽는 말로 적고(`summarizeBlueprint`),
      켜져 있던 칸 목록 자체도 같이 둡니다 — 되돌리면 체크까지 그때로 돌아갑니다.
    */
    promptHistory: appendPromptHistory([], {
      ko: made.ko,
      en: made.en,
      negativeKo: made.negativeKo,
      negativeEn: made.negativeEn,
      label: "AI 일괄 생성",
      note: describeRunConditions({
        extra: "AI 일괄 생성 · 규칙 조립",
        aspects: summarizeBlueprint("character", created.blueprint),
        hasAnalysis: false,
      }),
      blueprint: created.blueprint,
    }),
    name: source.name,
    role: source.role,
    gender: source.gender,
    heightCm: source.heightCm,
    build: source.build,
    kind: source.kind,
    description: source.description || note,
    profile: normalizeProfile({
      age: source.age,
      tagline: source.tagline || note,
      personality: source.personality,
      speech: source.speech,
      habits: source.habits,
    }),
  };
}

function buildBackground(
  source: BootstrapBackground,
  note: string,
  context: ProjectContextSummary | null,
): Background {
  // 새 배경의 blueprint 는 실내·실외에 따라 다릅니다. spaceKind 를 나중에 덮어쓰면
  // 그 기본 항목이 실외 것으로 남아, 실내 장소에 조감도가 켜진 채로 시작합니다.
  const created = newBackground(source.spaceKind);
  const tail = [
    source.timeOfDay ? `시간대: ${source.timeOfDay}` : "",
    source.mood ? `분위기: ${source.mood}` : "",
  ].filter(Boolean);
  const body = source.description || note;
  const description = [body, ...tail].filter(Boolean).join("\n");
  // 캐릭터와 같은 까닭으로 장소 시트 프롬프트도 미리 지어 둡니다.
  const made = buildRulePrompt({
    kind: "background",
    name: source.name,
    description,
    blueprint: created.blueprint,
    context,
    referenceCount: 0,
    spaceKind: source.spaceKind,
  });
  return {
    ...created,
    promptKo: made.ko,
    promptEn: made.en,
    negativeKo: made.negativeKo,
    negativeEn: made.negativeEn,
    // 캐릭터와 같은 까닭 — 무슨 칸을 켜고 뽑았는지까지 남깁니다.
    promptHistory: appendPromptHistory([], {
      ko: made.ko,
      en: made.en,
      negativeKo: made.negativeKo,
      negativeEn: made.negativeEn,
      label: "AI 일괄 생성",
      note: describeRunConditions({
        extra: "AI 일괄 생성 · 규칙 조립",
        aspects: summarizeBlueprint("background", created.blueprint, source.spaceKind),
        hasAnalysis: false,
      }),
      blueprint: created.blueprint,
    }),
    name: source.name,
    location: source.location || source.name,
    description,
  };
}

function buildCuts(
  scene: BootstrapScene,
  characterId: (name: string) => string | undefined,
  backgroundId: (name: string) => string | undefined,
  /** 3단계 결과에서 이 씬의 컷들 — 없으면 구도·프롬프트를 비워 둡니다. */
  shots: BootstrapShotCut[] | undefined,
  /** 인물 이름 → 키(cm). 카메라 거리를 재는 데 씁니다. */
  heightOf: (name: string) => number,
  /** 프로젝트 화면비 — 영상 프롬프트에 «화면비 9:16» 으로 실어 보냅니다. */
  aspect: string | undefined,
  /** 작품 스타일 칩 — «질감·실사» 를 자동으로 켜는 근거입니다. */
  styles: string[],
): Cut[] {
  return scene.cuts.map((cut, index) => {
    const created = newCut(index + 1);
    const names = cut.characterNames.length ? cut.characterNames : scene.characterNames;
    const background = backgroundId(cut.backgroundName) ?? backgroundId(scene.backgroundName);
    /*
      3단계가 있으면 **구도를 세우고 프롬프트를 채웁니다**.
      번호로 짝을 맞춥니다 — 답이 컷을 빠뜨렸으면 그 컷만 비고 나머지는 들어갑니다.
    */
    const plan = shots?.find((item) => item.order === index + 1);
    const people = (plan?.people ?? [])
      .map((person) => {
        const id = characterId(person.name);
        return id
          ? {
              characterId: id,
              heightCm: heightOf(person.name),
              x: person.x,
              z: person.z,
              facing: person.facing,
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const composition =
      plan && people.length
        ? buildShotComposition({
            shot: plan.shot,
            angle: plan.angle,
            place: {
              outdoor: plan.outdoor,
              size: plan.size || undefined,
              height: plan.height || undefined,
            },
            people,
          })
        : undefined;
    /*
      **영상 프롬프트도 함께 채웁니다.**

      구도가 생겼으니 카메라 무빙·인물 자리를 읽을 수 있고, 그러면 영상 프롬프트는
      **규칙으로** 지어집니다(`buildCutVideoPrompt` — 컷 카드의 «영상 프롬프트» 단추와
      같은 함수). LLM 을 한 번 더 부를 까닭이 없습니다.
    */
    /*
      ── «질감 · 실사» 는 앱이 켭니다 ──────────────────────────────────
      컷 카드의 촬영·조명·색감·질감 네 줄이 통째로
      비어 있었습니다. 앞 셋은 **판단**이라 LLM 이 고르게 했고(템플릿), 질감은 **규칙**이라
      여기서 켭니다 — 작품 스타일이 실사면 모공·눈 반사광이 늘 필요하고, 애니메이션이면
      늘 필요 없습니다. LLM 에게 62컷마다 다시 물어볼 까닭이 없습니다(`autoRealism`).
    */
    const look = autoRealism({
      styles,
      hasPeople: names.length > 0,
      // 컷 단위로 얼굴 크기를 알 길이 아직 없습니다(구도는 있어도 샷 크기는 3단계 것).
      // 켜 두면 풀샷에도 속눈썹이 붙으므로, 여기서는 «가까운 샷» 으로 안 봅니다.
      closeUp: false,
      manual: cut.styleTags,
    });
    const styleTags = [...cut.styleTags, ...look.ids.filter((id) => !cut.styleTags.includes(id))];
    const made =
      composition || cut.description
        ? buildCutVideoPrompt({
            title: cut.title,
            description: cut.description,
            composition,
            // 인물 id → 이름. 구도에 선 사람을 «여울» 로 부르려고 짝을 넘깁니다.
            characterNames: Object.fromEntries(
              names
                .map((name) => [characterId(name), name] as const)
                .filter((pair): pair is readonly [string, string] => Boolean(pair[0])),
            ),
            vfx: cut.vfx,
            // 대사·연기는 **효과보다 앞**에 실립니다(`buildCutVideoPrompt`).
            acting: cut.acting,
            actingEn: cut.actingEn,
            plannedSeconds: cut.seconds,
            // 자동으로 지을 때도 화면비와 이름을 실어 보냅니다 — 손으로 지은 것과 같은 글이 되도록.
            aspect,
            lockNames: names,
            /*
              **연출·질감을 프롬프트에도 싣습니다.** 예전에는 `styleTags` 를 컷에 켜 두기만
              하고 프롬프트에는 안 넣어서, 카드에는 «시네마틱·85mm·로우 키» 가 체크돼 있는데
              생성기로 가는 글에는 그 말이 하나도 없었습니다.
            */
            lookEn: [cutTogglesEnglish(styleTags), look.en].filter(Boolean).join(", "),
          })
        : null;
    const video = made ? { videoPromptKo: made.ko, videoPromptEn: made.en } : {};

    return {
      ...created,
      title: cut.title,
      description: cut.description,
      // 이름으로 못 찾으면 비워 둡니다. 엉뚱한 인물을 넣는 것보다 낫습니다.
      characterIds: names.map((name) => characterId(name)).filter((id): id is string => Boolean(id)),
      ...(background ? { backgroundId: background } : {}),
      // 빈 값은 **안 넣습니다.** 넣으면 `newCut` 의 기본값을 빈 문자열로 덮어씁니다.
      ...(cut.seconds ? { plannedSeconds: cut.seconds } : {}),
      ...(cut.vfx ? { vfx: cut.vfx } : {}),
      ...(cut.acting ? { acting: cut.acting } : {}),
      ...(cut.actingEn ? { actingEn: cut.actingEn } : {}),
      ...(styleTags.length ? { styleTags } : {}),
      ...(composition ? { composition } : {}),
      ...(plan?.promptKo ? { promptKo: plan.promptKo } : {}),
      ...(plan?.promptEn ? { promptEn: plan.promptEn } : {}),
      ...video,
    };
  });
}

/**
 * 받아 온 결과를 초안에 얹습니다. **`onChange` 안에서 부르는 갱신 함수**입니다.
 *
 * onChange((current) => applyBootstrapToDraft(current, result, { mode }));
 *
 * 값으로 덮어쓰면 안 되는 이유는 CLAUDE.md 에 적힌 그대로입니다 — 두 단계 요청이
 * 도는 동안 다른 칸을 만지는 것이 정상적인 사용법이고, 그 사이 변경을 지우면
 * 「분석이 사라졌다」 사고가 그대로 재현됩니다.
 *
 * **파일은 만들지도 지우지도 않습니다.** «비우고 새로» 도 목록에서만 빼고 폴더는
 * 그대로 둡니다. 그래서 **그림이 붙은 카드는 «비우고 새로» 에서도 남깁니다**
 * (`cardsWithImages` — 카드를 없애면 그 폴더를 지울 길이 앱에서 사라집니다).
 * 정말 지우려면 규칙 3 대로 캐릭터·배경 단계에서 카드를 지워야 합니다.
 */
/**
 * 3단계 답을 읽습니다. **관대하게** — 빠진 칸은 기본값으로 둡니다.
 *
 * 모르는 샷 이름이 와도 버리지 않습니다. `bootstrapShots` 가 모르는 이름은 웨이스트로
 * 보므로, 여기서 걸러 내면 그 컷만 구도가 통째로 안 생깁니다 — 틀린 샷보다 나쁩니다.
 */
export function parseBootstrapShots(raw: unknown): BootstrapShots {
  const bag = unwrap(toBag(raw), ["scenes", "씬"]);
  const scenes = Array.isArray(bag.scenes) ? bag.scenes : [];
  return {
    scenes: scenes.map((entry) => {
      const scene = toBag(entry);
      const cuts = Array.isArray(scene.cuts) ? scene.cuts : [];
      return {
        title: str(scene, ["title", "제목"]),
        cuts: cuts.map((item, index) => {
          const cut = toBag(item);
          const place = toBag(cut.place);
          const people = Array.isArray(cut.people) ? cut.people : [];
          return {
            order: num(cut, ["order", "번호"]) || index + 1,
            shot: str(cut, ["shot", "샷"]),
            angle: str(cut, ["angle", "앵글"]),
            outdoor: place.outdoor === true || str(place, ["spaceKind"]) === "실외",
            size: num(place, ["size", "한변"]) || 0,
            height: num(place, ["height", "층고"]) || 0,
            people: people.map((who) => {
              const person = toBag(who);
              return {
                name: str(person, ["name", "이름"]),
                x: num(person, ["x"]),
                z: num(person, ["z"]),
                facing: num(person, ["facing", "방향"]),
              };
            }),
            promptKo: str(cut, ["promptKo", "ko", "한글"]),
            promptEn: str(cut, ["promptEn", "en", "영문"]),
          };
        }),
      };
    }),
  };
}

export function applyBootstrapToDraft(
  current: ProjectDraft,
  result: BootstrapResult,
  options: BootstrapApplyOptions,
): Partial<ProjectDraft> {
  const { outline, details } = result;
  const replace = options.mode === "replace";

  // 씬·컷에는 파일이 붙지 않으므로 «비우고 새로» 는 그대로 비웁니다.
  const keptCharacters = replace ? cardsWithImages(current.characters) : current.characters;
  const keptBackgrounds = replace ? cardsWithImages(current.backgrounds) : current.backgrounds;
  const keptScenes = replace ? [] : current.scenes;

  /*
    시트 프롬프트를 지을 때 쓰는 **작품 설정**. 이번 답의 제목·장르·시대를 이미 얹은 뒤의
    초안으로 잽니다 — 카드보다 설정이 먼저 정해져야 「조선 후기」 같은 말이 프롬프트에 듭니다.
  */
  const context = summarizeProjectContext({
    genres: replace ? outline.genres : [...new Set([...current.genres, ...outline.genres])],
    styles: replace ? outline.styles : [...new Set([...current.styles, ...outline.styles])],
    eras: replace ? outline.eras : [...new Set([...current.eras, ...outline.eras])],
    eraRanges: current.eraRanges,
    eraUnspecified: current.eraUnspecified,
  });

  /*
    이미 있는 이름과 **이번 답 안의 중복** 을 함께 거릅니다(`pickNew`).

    폴더는 인물당 하나입니다(규칙 5). 같은 이름의 카드가 둘이면 파일이 한 폴더에
    섞여 «여울_001» 이 어느 카드 것인지 알 수 없어집니다. 덧붙이기에서 같은 이름이
    오면 새 카드를 만드는 대신 원래 카드를 그대로 두고, 씬·컷이 그 카드를 가리키게 합니다.
  */
  const madeCharacters = pickNew(details.characters, keptCharacters.map((item) => item.name)).made.map((item) =>
    buildCharacter(item, noteFor(outline.characters, item.name), context),
  );
  const madeBackgrounds = pickNew(details.backgrounds, keptBackgrounds.map((item) => item.name)).made.map((item) =>
    buildBackground(item, noteFor(outline.backgrounds, item.name), context),
  );

  const characters = [...keptCharacters, ...madeCharacters];
  const backgrounds = [...keptBackgrounds, ...madeBackgrounds];

  /*
    이름 → id.

    같은 이름이 둘이면 **먼저 있던 쪽이 이깁니다.** 덧붙이기로 같은 인물을 다시
    만들었을 때, 컷이 새 빈 카드가 아니라 이미 그림이 붙은 카드를 가리켜야 합니다.
  */
  const idByName = (list: { id: string; name: string }[]) => {
    const table = new Map<string, string>();
    for (const item of list) {
      const key = item.name.trim();
      if (key && !table.has(key)) table.set(key, item.id);
    }
    return (name: string) => table.get((name || "").trim());
  };
  const characterId = idByName(characters);
  const backgroundId = idByName(backgrounds);

  /** 인물 이름 → 키(cm). 카메라 거리를 재는 잣대입니다(없으면 170). */
  const heightOf = (name: string) =>
    characters.find((item) => item.name.trim() === (name || "").trim())?.heightCm ?? 170;

  const madeScenes: Scene[] = details.scenes.map((scene, index) => ({
    id: uid(),
    title: scene.title,
    summary: scene.summary,
    /*
      3단계 결과는 **씬 제목**으로 짝을 맞추고, 못 맞추면 순번으로 물러섭니다 —
      LLM 이 제목을 살짝 다듬는 일이 잦은데, 그 때문에 구도가 통째로 빠지면 안 됩니다.
    */
    cuts: buildCuts(
      scene,
      characterId,
      backgroundId,
      (result.shots?.scenes.find((item) => item.title.trim() === scene.title.trim()) ??
        result.shots?.scenes[index])?.cuts,
      heightOf,
      current.aspect?.image,
      // 작품 스타일 — 「실사인가 그림인가」 가 질감 칸을 가릅니다.
      replace ? outline.styles : [...new Set([...current.styles, ...outline.styles])],
    ),
  }));

  /** 덧붙이기에서는 비어 있는 칸만 채웁니다. 적어 둔 것을 덮어쓰지 않습니다. */
  const fill = (next: string, existing?: string) => {
    if (replace) return next || existing || "";
    return (existing || "").trim() ? (existing as string) : next;
  };

  const genres = replace ? outline.genres : [...new Set([...current.genres, ...outline.genres])];
  const styles = replace ? outline.styles : [...new Set([...current.styles, ...outline.styles])];
  const eras = replace ? outline.eras : [...new Set([...current.eras, ...outline.eras])];

  return {
    title: fill(outline.title, current.title),
    logline: fill(outline.logline, current.logline),
    synopsis: fill(outline.synopsis, current.synopsis),
    tone: fill(outline.tone, current.tone),
    runtime: fill(outline.runtime, current.runtime),
    genres,
    // genre·style 문자열도 같이 맞춥니다. 목록 화면과 저장 파일이 이 값을 읽습니다.
    genre: genres.join(", "),
    styles,
    style: styles.join(", "),
    eras,
    characters,
    backgrounds,
    scenes: [...keptScenes, ...madeScenes],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 미리 보기
// ─────────────────────────────────────────────────────────────────────────────

export interface BootstrapSummary {
  title: string;
  characterNames: string[];
  backgroundNames: string[];
  sceneTitles: string[];
  cutCount: number;
  /** 구도와 프롬프트가 들어간 컷 수(3단계). 0 이면 2단계까지만 돌았습니다. */
  shotCount: number;
  /**
   * 컷 길이의 합(초)과 길이가 적힌 컷 수.
   *
   * 컷 길이가 그대로 영상
   * 생성기의 러닝타임이 되므로, 적용하기 **전에** 전체 분량이 기획한 분량과 맞는지
   * 보여야 합니다 — 3분 단편을 시켰는데 컷 합이 40초면 컷이 모자란 것입니다.
   */
  totalSeconds: number;
  timedCuts: number;
  /** 씬·컷이 가리키는데 캐릭터·배경 목록에 없는 이름. 그대로 두면 연결이 비어 들어갑니다. */
  unmatchedNames: string[];
  /** 이미 앱에 있어서 새로 만들지 않는 이름(덧붙이기). 씬·컷은 원래 카드를 가리킵니다. */
  skippedNames: string[];
}

/**
 * 「무엇이 몇 개 들어가는가」. 바로 적용하지 않고 이걸 먼저 보여 줍니다.
 *
 * `existing` 을 주면 «이미 있어서 건너뛸 이름» 까지 갈라 보여 줍니다.
 * 화면이 「캐릭터 3」 이라고 했는데 둘만 생기면 실패한 줄 압니다.
 *
 * **갈래를 갈라서 셉니다.** 예전에는 캐릭터·배경 이름을 한 Set 에 합쳐 두어서,
 * 배경에 「학교」 가 있으면 새 답의 **캐릭터** 「학교」 를 «이미 있음» 으로 빼고
 * 세었습니다. 적용(`applyBootstrapToDraft`)은 갈래를 가리므로 실제로는 만들어져,
 * 「캐릭터 2」 라고 보여 주고 3 개가 들어갔습니다.
 */
export function summarizeBootstrap(
  result: BootstrapResult,
  existing?: { characters: string[]; backgrounds: string[] },
): BootstrapSummary {
  const { outline, details } = result;
  const chosenCharacters = pickNew(details.characters, existing?.characters ?? []);
  const chosenBackgrounds = pickNew(details.backgrounds, existing?.backgrounds ?? []);
  const all = [...details.characters.map((item) => item.name), ...details.backgrounds.map((item) => item.name)];
  const characterNames = chosenCharacters.made.map((item) => item.name);
  const backgroundNames = chosenBackgrounds.made.map((item) => item.name);
  // 이름 잇기는 «이미 있는 카드» 도 대상이고 갈래를 안 가립니다 — 여기서는 합쳐 봅니다.
  const known = new Set(
    [...all, ...(existing?.characters ?? []), ...(existing?.backgrounds ?? [])].map((name) => (name || "").trim()).filter(Boolean),
  );

  const unmatched = new Set<string>();
  // 3단계가 컷 몇 개를 채웠는가 — 사람이 «구도까지 왔는지» 를 알아야 적용을 결정합니다.
  const shotCount = (result.shots?.scenes ?? []).reduce(
    (total, scene) =>
      total + scene.cuts.filter((cut) => cut.people.length || cut.promptEn || cut.promptKo).length,
    0,
  );
  let cutCount = 0;
  let totalSeconds = 0;
  let timedCuts = 0;
  for (const scene of details.scenes) {
    cutCount += scene.cuts.length;
    for (const cut of scene.cuts) {
      if (cut.seconds > 0) {
        totalSeconds += cut.seconds;
        timedCuts += 1;
      }
    }
    const names = [
      ...scene.characterNames,
      scene.backgroundName,
      ...scene.cuts.flatMap((cut) => [...cut.characterNames, cut.backgroundName]),
    ];
    for (const name of names) {
      const key = (name || "").trim();
      if (key && !known.has(key)) unmatched.add(key);
    }
  }

  return {
    title: outline.title,
    characterNames,
    backgroundNames,
    sceneTitles: details.scenes.map((scene) => scene.title),
    cutCount,
    shotCount,
    totalSeconds: Math.round(totalSeconds * 10) / 10,
    timedCuts,
    unmatchedNames: [...unmatched],
    // 이번 답 안에서 이름이 겹쳐 버린 것도 여기 들어갑니다 — 왜 수가 줄었는지 보여야 합니다.
    skippedNames: [...chosenCharacters.skipped, ...chosenBackgrounds.skipped],
  };
}

/** 받아 온 것이 쓸 만한가. 셋 다 비면 적용해 봐야 아무 일도 안 일어납니다. */
export function hasBootstrapContent(result: BootstrapResult): boolean {
  return Boolean(
    result.details.characters.length ||
      result.details.backgrounds.length ||
      result.details.scenes.length ||
      result.outline.title ||
      result.outline.synopsis,
  );
}

/**
 * **1단계 목록만으로 만든 최소 상세.**
 *
 * 2단계가 실패해도 1단계는 이미 「누가 나오고 어디가 나오는가」 를 알고 있습니다
 * (`BootstrapOutline.characters` · `backgrounds` — 이름과 한 줄 설명). 예전에는 그것을
 * 통째로 버리고 빈 목록을 부었습니다 — **값은 이미 치른 답**이라 버릴 이유가 없습니다.
 *
 * 카드만 세워 두면 나머지는 카드마다 있는 「특징 정하기」·「프롬프트 작성」 으로 채울 수
 * 있습니다. 빈 화면에서 이름부터 손으로 적는 것과는 전혀 다릅니다.
 *
 * 씬은 안 만듭니다 — 1단계는 장면을 모르고, 지어내면 대본과 어긋난 씬이 목록에 남습니다.
 */
export function detailsFromOutline(outline: BootstrapOutline): BootstrapDetails {
  return {
    characters: outline.characters
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        role: "",
        gender: "",
        age: "",
        heightCm: 0,
        build: "average",
        kind: "human",
        // 한 줄 설명은 **버리지 않습니다** — 이것이 「특징 정하기」 의 재료입니다.
        description: item.note.trim(),
        personality: "",
        speech: "",
        habits: "",
        tagline: "",
      })),
    backgrounds: outline.backgrounds
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        location: "",
        description: item.note.trim(),
        // 값은 영어입니다(`"interior"`). 화면의 「실내」 는 라벨일 뿐입니다.
        spaceKind: "interior",
        timeOfDay: "",
        mood: "",
      })),
    scenes: [],
  };
}
