import { useCallback, useSyncExternalStore } from "react";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import zh from "@/locales/zh.json";

/**
 * **언어 한 벌** — 한국어·영어·일본어·중국어.
 *
 * # 왜 «한국어 원문» 이 키인가
 *
 * `t("저장")` 처럼 **화면에 쓰는 한국어 문장 그대로**가 사전의 열쇠입니다. 흔한 방식대로
 * `t("settings.save")` 같은 영문 식별자를 두지 않은 이유가 셋 있습니다.
 *
 * 1. **부르는 자리를 갈아엎지 않습니다.** 이 앱의 문구는 수천 줄이 `"저장"` 처럼 박혀
 * 있습니다. 식별자 방식이면 문구마다 이름을 짓고 원문을 다른 파일로 옮겨야 해서,
 * 옮기다 빠뜨린 자리는 한국어로 남고 이름이 어긋난 자리는 빈칸으로 뜹니다.
 * 원문이 열쇠면 `t(` 로 감싸는 것이 전부라 «여덟 곳은 맞고 한 곳만 틀리다» 가
 * 생기지 않습니다.
 * 2. **한국어가 계속 원본입니다.** CLAUDE.md 의 「UI 문구는 전부 한국어」 규칙이 코드
 * 안에서 그대로 유지됩니다 — 코드를 읽으면 한국어 화면이 그대로 보이고, 번역은
 * 사전 파일이 덧씌우는 층일 뿐입니다.
 * 3. **번역이 없으면 곱게 물러납니다.** 사전에 없는 문장은 한국어 원문이 그대로 나옵니다.
 * 빈칸이나 `settings.save` 같은 식별자가 화면에 뜨는 일이 없어서, 번역이 반쯤 된
 * 상태로도 앱은 멀쩡히 돕니다(`missingKeys` 로 빠진 것을 셀 수 있습니다).
 *
 * 그래서 사전은 `{ "한국어 원문": "번역" }` 평평한 한 겹입니다. 자리표시자 `{name}` 은
 * 사전을 찾은 **뒤에** 채웁니다 — 원문에도 번역에도 같은 이름으로 들어 있어야 합니다.
 *
 * # `t()` 는 보여 주는 순간에 — 모듈 상수로 미리 번역해 두지 않습니다
 *
 * `const LABEL = t("저장")` 처럼 모듈이 읽힐 때 한 번 번역해 두면, 그 값은 앱을 켠 언어에
 * 못 박혀 설정에서 언어를 바꿔도 그 자리만 옛 언어로 남습니다. 튜토리얼 자료(`tutorials/`)가
 * 한국어 원문을 그대로 들고 있는 까닭도 이것입니다 — 띄우는 쪽이 `t(step.body)` 를 그리는
 * 순간에 부릅니다. 컴포넌트는 `useT` 로 구독해야 언어를 바꿨을 때 다시 그려집니다.
 *
 * # 이 파일이 하는 것과 안 하는 것
 *
 * 여기는 **핵심만** — 현재 언어 보관, 바꿀 때 알림, `t` 와 훅. 설정 화면의 언어 고르기와
 * 화면 곳곳을 `t(` 로 감싸는 일은 **다음 단계**에서 합니다. `t` 는 React 밖(토스트 등
 * lib 안)에서도 불러야 해서 모듈 상태로 두었고, 컴포넌트는 `useT` 로 구독해야 언어를
 * 바꿨을 때 다시 그려집니다.
 */

export type Locale = "ko" | "en" | "ja" | "zh";

export const DEFAULT_LOCALE: Locale = "ko";

/** 설정 화면의 언어 고르기가 그대로 씁니다. 이름은 그 언어 자신의 글자로 — 못 읽는 언어로 표시되면 돌아올 수 없습니다. */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "zh", label: "中文" },
];

/** 다른 옵션과 같은 관례(`ai-video-storage.<이름>.v1`). */
export const LOCALE_STORAGE_KEY = "ai-video-storage.locale.v1";

/** `toLocaleDateString` 같은 브라우저 API 에 넘길 BCP-47 태그. 중국어는 간체(대륙) 표기입니다. */
export function localeTag(locale: Locale): string {
  switch (locale) {
    case "en":
      return "en-US";
    case "ja":
      return "ja-JP";
    case "zh":
      return "zh-CN";
    default:
      return "ko-KR";
  }
}

type Dictionary = Record<string, string>;
type Vars = Record<string, string | number>;

/** 한국어는 원문 자체가 답이라 사전이 없습니다. */
const DICTIONARIES: Record<Exclude<Locale, "ko">, Dictionary> = { en, ja, zh };

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((entry) => entry.id === value);
}

/**
 * 저장소는 없을 수 있습니다(단위 시험은 node 에서 돌고, 웹뷰가 저장소를 막기도 합니다).
 * 그런 자리에서 예외를 내면 앱 전체가 첫 화면에서 죽으므로 조용히 `null` 로 받습니다.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readSavedLocale(): Locale {
  try {
    const saved = storage()?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * `<html lang>` 을 맞춥니다. 장식이 아닙니다 — 한자는 한 글자에 중국식·일본식 자형이
 * 따로 있어 브라우저가 `lang` 을 보고 글꼴을 고릅니다. 안 맞추면 일본어 화면에 중국식
 * 자형이 섞여 어색하게 보입니다. CSS `:lang()` 과 맞춤법 검사도 이걸 봅니다.
 * 값은 `localeTag` 의 BCP-47 태그(`ko-KR`) 한 벌 — 지역까지 있어야 `zh` 를 간체(대륙)로
 * 읽고, 날짜 형식과 같은 태그를 씁니다.
 */
function applyDocumentLang(locale: Locale) {
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = localeTag(locale);
    }
  } catch {
    // 문서가 없는 자리(시험)에서는 할 일이 없습니다.
  }
}

let current: Locale = readSavedLocale();
const listeners = new Set<() => void>();

// 앱을 켤 때 저장해 둔 언어가 곧바로 `<html lang>` 에 반영되게.
applyDocumentLang(current);

export function getLocale(): Locale {
  return current;
}

/**
 * 언어를 바꿉니다. 모르는 값은 **무시**합니다 — 저장소에 손으로 넣은 값이나 옛 판의
 * 값이 들어와도 화면이 깨지지 않게. 같은 값이면 알리지 않습니다(다시 그릴 것이 없습니다).
 */
export function setLocale(next: Locale) {
  if (!isLocale(next)) return;
  try {
    storage()?.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // 저장이 막혀도 이번 실행 동안은 바뀐 언어로 씁니다.
  }
  if (next === current) return;
  current = next;
  applyDocumentLang(next);
  for (const listener of listeners) listener();
}

/** React 밖에서 언어 바뀜을 듣고 싶을 때. 돌려주는 함수를 부르면 그만 듣습니다. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 문장 안의 자리표시자 이름 — `"{count} 씬 · {title}"` → `["count", "title"]`. 나온 차례대로, 중복 없이.
 *
 * **ASCII `\w` 만** 봅니다. 일부러입니다 — 튜토리얼 본문에는 파일 이름 꼴을 설명하는
 * `«{씬}_{cutNN}_{샷}.mp4»` 같은 글자가 있는데, 한글 이름의 중괄호는 코드가 채우는 자리가
 * 아니라 **화면에 그대로 보여야 하는 글**입니다. `\p{L}` 로 넓히면 그것까지 자리로 세어
 * 번역 검수(`tutorials.test.ts`)가 엉뚱한 것을 잡고, 번역자가 «씬» 을 번역하면 어긋납니다.
 * 코드가 채우는 자리는 전부 영문 이름(`{count}`·`{provider}`)입니다.
 *
 * `translate` 와 검수 시험이 **이 함수 하나**를 씁니다 — 자리표시자의 정의가 두 벌이면
 * 시험은 통과하는데 화면은 안 채워지는 일이 생깁니다.
 */
export function placeholderNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

function translate(locale: Locale, ko: string, vars?: Vars): string {
  let text = ko;
  if (locale !== "ko") {
    const dictionary = DICTIONARIES[locale];
    // `hasOwnProperty` 로 봅니다 — "constructor" 같은 원문이 Object 의 것을 집어 오면 안 됩니다.
    // 빈 문자열은 «아직 번역 안 됨» 으로 쳐서 원문으로 물러납니다(번역 도중의 사전도 쓸 수 있게).
    const hit = Object.prototype.hasOwnProperty.call(dictionary, ko) ? dictionary[ko] : "";
    if (typeof hit === "string" && hit.length > 0) text = hit;
  }
  if (!vars) return text;
  // 값이 없는 자리표시자는 그대로 둡니다 — 지워 버리면 무엇이 빠졌는지 화면에서 알 수 없습니다.
  for (const name of placeholderNames(text)) {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) continue;
    text = text.split(`{${name}}`).join(String(vars[name]));
  }
  return text;
}

/**
 * 한국어 원문을 지금 언어로. 사전에 없으면 원문 그대로, `{name}` 은 `vars` 로 채웁니다.
 * React 밖(토스트·lib)에서 그대로 부릅니다. 컴포넌트 안에서는 `useT` 를 쓰세요 —
 * 이 함수는 구독이 없어서 언어를 바꿔도 다시 그려지지 않습니다.
 */
export function t(ko: string, vars?: Vars): string {
  return translate(current, ko, vars);
}

/** 지금 언어. 바뀌면 다시 그립니다. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * 컴포넌트용 `t`. 언어가 바뀌면 함수 자체가 새것이 되므로 `useMemo`·`useEffect` 의
 * 의존성에 넣어도 제때 다시 셈합니다.
 */
export function useT(): (ko: string, vars?: Vars) => string {
  const locale = useLocale();
  return useCallback((ko: string, vars?: Vars) => translate(locale, ko, vars), [locale]);
}

/**
 * 검수용 — 주어진 원문 가운데 그 언어 사전에 (비어 있지 않은) 번역이 없는 것.
 * 한국어는 사전이 필요 없으므로 늘 빈 목록입니다.
 */
export function missingKeys(locale: Locale, keys: string[]): string[] {
  if (locale === "ko") return [];
  const dictionary = DICTIONARIES[locale];
  return keys.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(dictionary, key)) return true;
    const value = dictionary[key];
    return typeof value !== "string" || value.length === 0;
  });
}
