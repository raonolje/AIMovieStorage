/**
 * BGM 프로젝트.
 *
 * 영상 프로젝트와 따로 둡니다. 음악은 컷 단위가 아니라 작품 전체의 흐름을 타고,
 * 만드는 도구도 영상과 다릅니다 — **Suno**(밖에서 뽑아 오는 것)와 **로컬 음악
 * 모델**(앱이 직접 돌리는 것) 둘입니다. (지시 116)
 *
 *
 *
 * 로컬 쪽이 **ComfyUI 가 아닌** 까닭: 미니맥스의 **MiniMax-Music3** 가 2026-08-13 에
 * 오픈 웨이트로 나와서, 컴피UI 를 거치지 않고 우리가 직접 돌립니다
 * (`lib/localEngines.ts`). ACE-Step 은 그것이 무거운 기계를 위한 대안으로 남깁니다.
 */

const STORAGE_KEY = "ai-video-storage.bgm-projects.v1";

import type { SavedPromptEntry } from "@/lib/promptHistory";
import { queueMirrorWrite, queueMirrorWriteAndConfirm, registerMirrorSection } from "@/lib/mediaLibrary";

export interface BgmTrack {
  id: string;
  /** 이 곡의 쓰임. "오프닝", "추격 장면" 처럼 */
  name: string;
  /** 어느 장면에 깔릴지 */
  usage: string;
  mood: string[];
  genre: string[];
  instruments: string[];
  /** BPM. 빈 문자열이면 모델이 알아서 정합니다. */
  tempo: string;
  /** 초 단위 길이 */
  durationSeconds: string;
  /** 가사. 인스트루멘털이면 비워 둡니다. (옛 한 칸 — 한글 칸으로 읽습니다) */
  lyrics: string;
  /**
   * **곡 스타일**과 **가사**를 한글·영문 두 벌로 둡니다.
   *
   *
   * 생성기에 넣는 것은 영문이고(태그 어휘가 영어), 한글은 사람이 읽고 고치는 자리입니다.
   */
  styleKo?: string;
  styleEn?: string;
  lyricsKo?: string;
  lyricsEn?: string;
  /**
   * **제외할 스타일**(Suno 의 Exclude Styles). 네거티브 프롬프트가 아니라 «이 스타일은 빼라» 는 목록입니다.
   * 로컬 모델에는 이런 칸이 없어 프롬프트 끝에 «avoid …» 로 붙습니다.
   */
  excludeStyles?: string;
  /** 보컬·시대·프로덕션 태그 — 스타일 문장을 만드는 재료입니다. */
  vocals?: string[];
  era?: string[];
  production?: string[];
  /** 곡 구조 — [intro][verse][chorus] 처럼 가사 틀을 만들 때 씁니다. */
  structure?: string[];
  instrumental: boolean;
  /** 참고할 곡·아티스트. 저작권 때문에 직접 모방 지시는 피하고 특징만 적습니다. */
  reference: string;
  /** 자유 서술 */
  notes: string;
  targetTool: BgmToolId;
  promptKo: string;
  promptEn: string;
  /**
   * **받아 둔 스타일·가사 이력**.
   *
   * 곡도 여러 번 받아 보고 고르는 일이라, 앞서 받은 것을 잃으면 «아까 그게 나았는데» 가 됩니다.
   * 인물·장소 카드와 **같은 부품**(`PromptHistoryShelf`)을 씁니다.
   */
  promptHistory?: SavedPromptEntry[];
  /** 생성 결과 파일 경로 */
  resultPaths: string[];
  updatedAt: number;
}

export interface BgmProject {
  id: string;
  name: string;
  description: string;
  /** 연결된 영상 프로젝트 이름. 비워 둘 수 있습니다. */
  linkedProject: string;
  tracks: BgmTrack[];
  createdAt: number;
  updatedAt: number;
  /** 같은 외부 생성 요청을 다시 받아도 작품을 두 벌 만들지 않기 위한 표입니다. */
  controllerCreation?: { fingerprint: string };
}

/**
 * 예전 데이터에 남아 있을 수 있어 `comfyui-audio`·`udio` 도 타입에는 둡니다.
 * 고르는 자리에는 안 나옵니다 — `BGM_TOOLS` 가 화면 목록입니다.
 */
export type BgmToolId =
  | "suno"
  /** 로컬 — 어느 엔진인지까지 고릅니다(). */
  | "local-minimax"
  | "local-acestep"
  /** 옛 저장본의 이름들 — 읽을 때 위 것으로 옮깁니다(`normalizeBgmTool`). */
  | "local-music"
  | "minimax-music"
  | "comfyui-audio"
  | "udio";

/** 도구 id → 로컬 엔진 id. 수노처럼 밖에서 뽑는 것은 없습니다. */
export function localEngineOfTool(tool: BgmToolId): "minimaxmusic" | "acestep" | null {
  if (tool === "local-minimax") return "minimaxmusic";
  if (tool === "local-acestep") return "acestep";
  return null;
}

/*
  ── 이 도구들이 실제로 받는 칸 ─────────────────────────────────────────
  

  찾아봤습니다(2026-09-17). — **V6 기준으로 다시 확인했습니다.**

  · **Suno v6** 커스텀 모드 — *Style*(**1,000자**), *Lyrics*(**5,000자**), *Exclude Styles*(1,000자), *Title*.
    v5 시절의 200자·3,000자가 아닙니다. 네거티브 프롬프트는 여전히 없고, 빼고 싶은 것은 **Exclude Styles**
    칸에만 적습니다(스타일 칸에 «no …» 로 섞어 쓰면 오히려 그 낱말을 불러옵니다).
    모델은 `v6`·`v6_wild`(실험적)·`v6_mini`(무료) 셋이고, v5 이하는 고르는 자리에서 내려갔습니다.
    v6 에서 달라진 것: **구간 머리말 안에 연출을 적을 수 있습니다** — `[Bridge | Female — Whispered]`
    처럼 쓰면 그 구간의 창법·악기가 실제로 바뀝니다. 스타일 칸만으로는 안 되던 일입니다.
    More Options 에 Vocal Gender·Duration·Max Mode·Weirdness·**Style Influence(기본 50%)**·Variety 가 있고,
    Style Influence 가 절반이라 스타일 문장의 절반쯤은 버려질 수 있습니다 — 중요한 말을 앞에 둡니다.
    한 번에 1~4분이 나오고, 더 길게는 Extend 로 잇습니다. 가사는 3,000자 근처가 편안하고
    그보다 길면 서두르기 시작합니다.
  · **MiniMax-Music3**(앱 탑재) — `prompt` 는 스타일 서술, `lyrics` 는 구조 태그가 든 가사.
    가사를 안 주면 파이프라인이 멈추고, 길이는 `seconds` 가 아니라 **구조 태그**가 정합니다.
  · **ACE-Step v1**(앱 탑재) — 장르·악기·bpm 을 나열한 **태그**와 가사. 가사를 비우면 연주곡.

  셋 다 «스타일 + 가사» 이므로 화면도 그 두 칸입니다. 네거티브 칸은 없앴고, 그 자리에 Suno 의 «제외할 스타일» 을 둡니다.
*/
/**
 * Suno v6 의 칸 한도. 화면 안내와 조립 양쪽이 같은 수를 봐야 해서 여기 한 곳에 둡니다.
 *
 * v5 때 적어 둔 200자·3,000자를 그대로 쓰고 있었습니다().
 * 스타일이 200자에서 잘리면 프로덕션·시대 태그가 통째로 날아갑니다.
 */
export const SUNO_STYLE_LIMIT = 1000;
export const SUNO_LYRICS_LIMIT = 5000;
/** 가사가 이보다 길면 Suno 가 서두르기 시작합니다 — 한도(5,000)보다 먼저 걸리는 실무 기준입니다. */
export const SUNO_LYRICS_COMFORT = 3000;

export const BGM_TOOLS: { id: BgmToolId; label: string; hint: string }[] = [
  {
    id: "suno",
    label: "Suno v6 (커스텀 모드)",
    hint: "스타일 1,000자 · 가사 5,000자. 네거티브 대신 «제외할 스타일» 을 씁니다. Style Influence 가 기본 50% 라 앞에 쓴 말이 살아남습니다 — 장르 → 분위기 → 악기 → 보컬 → 프로덕션 차례로. 구간 머리말에 «[Bridge | Female — Whispered]» 처럼 연출을 적을 수 있습니다(v6).",
  },
  {
    id: "local-minimax",
    label: "로컬 — MiniMax-Music3",
    hint: "한 번에 5분짜리 완곡. 도입·전개·후렴이 이어집니다. 스타일은 영문 칸을 보내고, 길이는 가사의 구조 태그가 정합니다. 32kHz 스테레오.",
  },
  {
    id: "local-acestep",
    label: "로컬 — ACE-Step v1 (3.5B)",
    hint: "가볍고 빠른 대안. 태그로 장르·악기·bpm 을 주고, 가사를 비우면 연주곡입니다. 상업 이용 제한 없음(Apache 2.0).",
  },
];

/**
 * 옛 데이터의 도구 id 를 지금 것으로 옮깁니다.
 *
 * 예전에는 「MiniMax Music (ComfyUI)」·「ComfyUI Audio」 였습니다. 둘 다 컴피UI 를
 * 거치는 길이라 이제 없습니다 — 고르는 자리에 없는 id 가 저장돼 있으면 선택칸이
 * 빈 채로 뜹니다. 읽을 때 한 번 옮깁니다.
 */
export function normalizeBgmTool(tool: BgmToolId | undefined): BgmToolId {
  // 옛 이름은 전부 **미니맥스**로 옮깁니다 — «로컬» 하나였을 때 기본으로 돌던 엔진입니다.
  if (
    tool === "minimax-music" ||
    tool === "comfyui-audio" ||
    tool === "udio" ||
    tool === "local-music"
  )
    return "local-minimax";
  return tool ?? "suno";
}

/*
  토글을 넉넉히 둡니다().
  여기 낱말이 그대로 스타일 문장이 되므로, 생성기가 알아듣는 말로 골라 두었습니다.
*/
export const BGM_MOODS = [
  "긴장", "불안", "쓸쓸함", "따뜻함", "웅장함", "몽환적", "경쾌함", "차분함",
  "비장함", "신비로움", "그리움", "질주감", "무게감", "희망적",
  "장난스러움", "서늘함", "애틋함", "결연함", "공허함", "설렘", "나른함", "숨막힘",
];

export const BGM_GENRES = [
  "오케스트라", "앰비언트", "신스웨이브", "로파이", "일렉트로닉", "재즈", "포크",
  "록", "힙합", "시네마틱", "미니멀", "월드뮤직", "인더스트리얼", "피아노 솔로",
  "국악", "시티팝", "드림팝", "포스트록", "트랩", "드럼앤베이스", "보사노바",
  "가스펠", "블루스", "메탈", "합창곡", "칩튠", "다크 앰비언트", "발라드",
];

export const BGM_INSTRUMENTS = [
  "현악", "피아노", "신디사이저", "드럼", "베이스", "기타", "관악", "타악",
  "합창", "첼로", "바이올린", "하프", "오르간", "808 베이스", "아르페지에이터",
  "가야금", "대금", "장구", "어쿠스틱 기타", "일렉 기타", "색소폰", "트럼펫",
  "호른", "마림바", "글로켄슈필", "핸드팬", "첼레스타", "모듈러 신스", "필드 레코딩",
];

/** 보컬 — 없음(연주곡)부터 남/여/혼성·합창·속삭임까지. */
export const BGM_VOCALS = [
  "연주곡", "여성 보컬", "남성 보컬", "혼성 듀엣", "합창", "속삭이는 보컬",
  "허밍", "랩", "코러스만", "어린이 합창",
];

/** 시대·질감 — «80년대 신스» 처럼 소리의 나이를 정합니다. */
export const BGM_ERAS = [
  "1960s", "1970s", "1980s", "1990s", "2000s", "현대", "미래적", "고전",
];

/** 프로덕션 — 믹스와 공간감. */
export const BGM_PRODUCTION = [
  "넓은 스테레오", "드라이", "테이프 새추레이션", "비닐 노이즈", "큰 홀 리버브",
  "로파이 필터", "사이드체인", "부드러운 리미팅", "아날로그 따뜻함", "디지털 클린",
];

/*
  ── 곡 구조 ───────────────────────────────────────────────────────────
  가사 틀이자 곡의 길이입니다(로컬 모델은 `seconds` 보다 이 태그를 따릅니다).

   맞습니다 — 한 목록에 «instrumental» 을 끼워 두었더니 보컬의 «연주곡»
  과 같은 말이 두 군데가 되었고, 연주곡인데 verse·pre-chorus 를 고를 수 있었습니다.
  둘은 **다른 목록**입니다. verse·chorus 는 부를 말이 있어야 성립하는 이름이고,
  연주곡은 주제를 내놓고 변주하다 쌓아 올립니다.

  구간 하나만 연주로 비우는 «간주» 는 노래 쪽에 `instrumental break` 로 남겼습니다 —
  그건 곡 전체의 성격이 아니라 한 구간의 이름이라 겹치지 않습니다.
*/
export const BGM_STRUCTURE = [
  "intro", "verse", "pre-chorus", "chorus", "bridge", "instrumental break",
  "drop", "breakdown", "outro",
];

/** 연주곡의 구간 — 부를 말이 없으니 이름이 다릅니다. */
export const BGM_STRUCTURE_INSTRUMENTAL = [
  "intro", "theme", "variation", "build", "drop", "breakdown", "interlude",
  "climax", "outro",
];

/** 지금 고를 수 있는 구간. 연주곡이냐 노래냐로 갈립니다. */
export function structureOptionsOf(instrumental: boolean): string[] {
  return instrumental ? BGM_STRUCTURE_INSTRUMENTAL : BGM_STRUCTURE;
}

export function createBgmTrack(): BgmTrack {
  return {
    id: Math.random().toString(36).slice(2),
    name: "",
    usage: "",
    mood: [],
    genre: [],
    instruments: [],
    tempo: "",
    // 길이는 **비워 둡니다.** 비면 생성기가 곡 구조에 맞춰 알아서 정합니다.
    durationSeconds: "",
    lyrics: "",
    // 새 곡은 **연주곡**으로 시작합니다(배경 음악이 보통 그렇습니다). 보컬 태그도 같이 맞춰
    // 둡니다 — 둘이 어긋난 채로 LLM 에 가면 모델이 어느 쪽을 믿을지 모릅니다.
    instrumental: true,
    vocals: ["연주곡"],
    reference: "",
    notes: "",
    targetTool: "suno",
    promptKo: "",
    promptEn: "",
    resultPaths: [],
    updatedAt: Date.now(),
  };
}

export function createBgmProject(name: string): BgmProject {
  return {
    id: Math.random().toString(36).slice(2),
    name,
    description: "",
    linkedProject: "",
    tracks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function loadBgmProjects(): BgmProject[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const projects = saved ? (JSON.parse(saved) as BgmProject[]) : [];
    // 없어진 도구 id 는 읽을 때 옮깁니다 — 안 그러면 선택칸이 빈 채로 뜹니다.
    return projects.map((project) => ({
      ...project,
      tracks: (project.tracks || []).map((track) => ({
        ...track,
        targetTool: normalizeBgmTool(track.targetTool),
        resultPaths: track.resultPaths || [],
      })),
    }));
  } catch {
    return [];
  }
}

export function saveBgmProjects(projects: BgmProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  // 설치본과 개발 서버는 웹뷰 origin 이 달라 저장소를 따로 씁니다 — 파일에도 한 벌 둡니다.
  queueMirrorWrite(BGM_MIRROR_SECTION, projects);
  publishBgmProjects();
}

/** 화면과 조종기가 같은 스타일·가사 칸과 연주곡 스위치를 고쳐야 합니다. */
export function patchBgmTrack(current: BgmTrack, patch: Partial<BgmTrack>): BgmTrack {
  const next = { ...current, ...patch, updatedAt: Date.now() };
  if (patch.styleKo !== undefined) next.promptKo = patch.styleKo;
  else if (patch.promptKo !== undefined) next.styleKo = patch.promptKo;
  if (patch.styleEn !== undefined) next.promptEn = patch.styleEn;
  else if (patch.promptEn !== undefined) next.styleEn = patch.promptEn;
  if (patch.lyricsKo !== undefined) next.lyrics = patch.lyricsKo;
  else if (patch.lyrics !== undefined) next.lyricsKo = patch.lyrics;
  if (patch.instrumental !== undefined || patch.vocals !== undefined) {
    if (patch.instrumental === undefined && patch.vocals?.some((voice) => voice !== "연주곡")) next.instrumental = false;
    next.vocals = next.instrumental ? ["연주곡"] : (next.vocals ?? []).filter((voice) => voice !== "연주곡");
    next.structure = (next.structure ?? []).filter((part) => structureOptionsOf(next.instrumental).includes(part));
  }
  return next;
}

const bgmListeners = new Set<() => void>();
function publishBgmProjects() { bgmListeners.forEach((listener) => listener()); }
export function subscribeBgmProjects(listener: () => void): () => void {
  bgmListeners.add(listener);
  return () => { bgmListeners.delete(listener); };
}
/** 화면과 외부 조종이 같은 최신 목록을 고칩니다. 오래된 화면 배열로 되돌리지 않습니다. */
export function updateBgmProjects(updater: (current: BgmProject[]) => BgmProject[]): BgmProject[] {
  const next = updater(loadBgmProjects());
  saveBgmProjects(next);
  return next;
}
/** 로컬 목록은 즉시 반영하지만 성공 응답은 앱 데이터 파일에 쓰인 뒤 돌려줍니다. */
export function saveBgmProjectsAndConfirm(projects: BgmProject[]): Promise<void> {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  const saved = queueMirrorWriteAndConfirm(BGM_MIRROR_SECTION, projects);
  publishBgmProjects();
  return saved;
}
export function updateBgmProjectsAndConfirm(updater: (current: BgmProject[]) => BgmProject[]): Promise<void> {
  return saveBgmProjectsAndConfirm(updater(loadBgmProjects()));
}

/** 거울 안에서 BGM 기록이 앉는 칸 이름. */
const BGM_MIRROR_SECTION = "bgmProjects";

/**
 * 양쪽 기록을 합칩니다. **id 로 묶고, 같은 id 는 더 최근에 고친 쪽이 이깁니다.**
 *
 * 저장 폴더 설정처럼 «최근 것이 통째로 이긴다» 로 두면, 다른 origin 에서 적어 둔 곡이
 * 통째로 사라집니다. 한쪽에만 있는 것은 그냥 둡니다 — 곡 파일은 `bgmRestore` 가 폴더에서
 * 되살리지만, 사람이 적어 둔 프롬프트·분위기·가사는 이 기록에만 있어 한 번 지우면 끝입니다.
 *
 * 그래서 이 거울은 **지우기를 옮기지 않습니다.** 같은 origin 안에서는 지운 뒤 저장이
 * 곧바로 파일에도 가니 문제가 없고, origin 이 갈린 두 벌 사이에서는 잃는 쪽보다
 * 남는 쪽이 낫습니다(폴더에서 되살아나는 곡과 같은 태도입니다).
 */
function mergeBgmProjects(mine: BgmProject[], theirs: BgmProject[]): BgmProject[] {
  const merged = [...(mine || [])];
  for (const item of theirs || []) {
    const at = merged.findIndex((seen) => seen.id === item.id);
    if (at < 0) {
      merged.push(item);
      continue;
    }
    if ((item.updatedAt || 0) > (merged[at].updatedAt || 0)) merged[at] = item;
  }
  return merged;
}

registerMirrorSection<BgmProject[]>(BGM_MIRROR_SECTION, {
  read: () => {
    if (typeof window === "undefined") return null;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as BgmProject[];
    return Array.isArray(parsed) ? parsed : null;
  },
  write: (value) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    publishBgmProjects();
  },
  merge: mergeBgmProjects,
});

/**
 * 규칙 기반 프롬프트 조립.
 *
 * 도구마다 받아들이는 형식이 달라서 같은 재료로 다르게 씁니다.
 * Suno 는 태그 나열, 컴피UI 의 미니맥스는 노드 조건이라 역시 태그형이
 * 안정적입니다.
 */
/** 낱말을 영어로 — 태그 어휘가 영어라야 생성기가 알아듣습니다. 모르는 말은 그대로 둡니다. */
const BGM_EN: Record<string, string> = {
  // 분위기
  긴장: "tense", 불안: "uneasy", 쓸쓸함: "lonely", 따뜻함: "warm", 웅장함: "epic",
  몽환적: "dreamy", 경쾌함: "upbeat", 차분함: "calm", 비장함: "solemn", 신비로움: "mysterious",
  그리움: "nostalgic", 질주감: "driving", 무게감: "heavy", 희망적: "hopeful",
  장난스러움: "playful", 서늘함: "cold", 애틋함: "bittersweet", 결연함: "resolute",
  공허함: "empty", 설렘: "fluttering", 나른함: "languid", 숨막힘: "suffocating",
  // 장르
  오케스트라: "orchestral", 앰비언트: "ambient", 신스웨이브: "synthwave", 로파이: "lo-fi",
  일렉트로닉: "electronic", 재즈: "jazz", 포크: "folk", 록: "rock", 힙합: "hip hop",
  시네마틱: "cinematic", 미니멀: "minimalist", 월드뮤직: "world music",
  인더스트리얼: "industrial", "피아노 솔로": "solo piano", 국악: "korean traditional",
  시티팝: "city pop", 드림팝: "dream pop", 포스트록: "post-rock", 트랩: "trap",
  드럼앤베이스: "drum and bass", 보사노바: "bossa nova", 가스펠: "gospel", 블루스: "blues",
  메탈: "metal", 합창곡: "choral", 칩튠: "chiptune", "다크 앰비언트": "dark ambient", 발라드: "ballad",
  // 악기
  현악: "strings", 피아노: "piano", 신디사이저: "synthesizer", 드럼: "drums", 베이스: "bass",
  기타: "guitar", 관악: "brass", 타악: "percussion", 합창: "choir", 첼로: "cello",
  바이올린: "violin", 하프: "harp", 오르간: "organ", "808 베이스": "808 bass",
  아르페지에이터: "arpeggiator", 가야금: "gayageum", 대금: "daegeum", 장구: "janggu",
  "어쿠스틱 기타": "acoustic guitar", "일렉 기타": "electric guitar", 색소폰: "saxophone",
  트럼펫: "trumpet", 호른: "french horn", 마림바: "marimba", 글로켄슈필: "glockenspiel",
  핸드팬: "handpan", 첼레스타: "celesta", "모듈러 신스": "modular synth", "필드 레코딩": "field recording",
  // 보컬
  연주곡: "instrumental", "여성 보컬": "female vocal", "남성 보컬": "male vocal",
  "혼성 듀엣": "male and female duet", "속삭이는 보컬": "whispered vocal", 허밍: "humming",
  랩: "rap", 코러스만: "backing vocals only", "어린이 합창": "children's choir",
  // 시대
  현대: "modern", 미래적: "futuristic", 고전: "classical era",
  // 프로덕션
  "넓은 스테레오": "wide stereo", 드라이: "dry mix", "테이프 새추레이션": "tape saturation",
  "비닐 노이즈": "vinyl crackle", "큰 홀 리버브": "large hall reverb", "로파이 필터": "lo-fi filter",
  사이드체인: "sidechain pumping", "부드러운 리미팅": "gentle limiting",
  "아날로그 따뜻함": "analog warmth", "디지털 클린": "clean digital",
};

const toEnglish = (value: string) => BGM_EN[value] ?? value;

/**
 * 태그를 **곡 스타일**과 **가사 틀**로 조립합니다.
 *
 * 그래서 나오는 것이 프롬프트 한 덩어리가 아니라 **스타일 한 줄 + 가사 한 판**입니다.
 *
 * 스타일은 Suno 가 권하는 차례(장르 → 분위기 → 악기 → 보컬 → 프로덕션)로 적습니다 — 앞쪽을 더 세게 봅니다.
 * v6 의 Style Influence 가 기본 50% 라, 뒤에 적은 말은 실제로 버려질 수 있습니다.
 * 1,000자를 넘기지 않게 잘라 둡니다(Suno v6 의 스타일 칸 한도 — v5 의 200자가 아닙니다).
 */
export function buildBgmStyle(track: BgmTrack): {
  styleKo: string;
  styleEn: string;
  lyricsKo: string;
  lyricsEn: string;
} {
  const vocals = track.vocals ?? (track.instrumental ? ["연주곡"] : []);
  const orderKo = [
    ...track.genre,
    ...track.mood,
    ...track.instruments,
    ...vocals,
    ...(track.era ?? []),
    ...(track.production ?? []),
    track.tempo.trim() ? `${track.tempo.trim()} BPM` : "",
  ].filter(Boolean);
  const orderEn = [
    ...track.genre.map(toEnglish),
    ...track.mood.map(toEnglish),
    ...track.instruments.map(toEnglish),
    ...vocals.map(toEnglish),
    ...(track.era ?? []).map(toEnglish),
    ...(track.production ?? []).map(toEnglish),
    track.tempo.trim() ? `${track.tempo.trim()} BPM` : "",
  ].filter(Boolean);

  // 1,000자 한도(Suno v6). 넘치면 뒤에서부터 덜어 냅니다 — 앞쪽이 더 중요합니다.
  const fit = (parts: string[]) => {
    const kept: string[] = [];
    for (const part of parts) {
      const next = [...kept, part].join(", ");
      if (next.length > SUNO_STYLE_LIMIT) break;
      kept.push(part);
    }
    return kept.join(", ");
  };

  /*
    가사 틀은 **구조 태그**로 짭니다. 로컬 모델(MiniMax·ACE-Step)에서는 이 태그가 곧 길이입니다 —
    2026-09-17 에 150초를 요청하고도 22초를 받았고, 구조 태그를 넣으니 75초가 나왔습니다.
  */
  const structure = track.structure?.length
    ? track.structure
    : track.instrumental
      // 연주곡의 기본 틀 — 주제를 내놓고 변주한 뒤 정점을 찍고 내려옵니다.
      ? ["intro", "theme", "variation", "climax", "outro"]
      : ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"];
  const lyricsEn = track.instrumental
    ? structure.map((part) => `[${part}]\n[instrumental]`).join("\n")
    : (track.lyricsEn || track.lyrics || structure.map((part) => `[${part}]\n`).join("\n"));
  const lyricsKo = track.instrumental
    ? structure.map((part) => `[${part}] — 연주`).join("\n")
    : track.lyricsKo || track.lyrics || structure.map((part) => `[${part}]`).join("\n");

  return {
    styleKo: fit(orderKo),
    styleEn: fit(orderEn),
    lyricsKo,
    lyricsEn,
  };
}

