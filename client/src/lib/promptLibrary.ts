import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "@/lib/llm";
import { PROMPT_FOLDER, joinPath, resolveUnderBase } from "@/lib/storagePaths";
import {
  DEFAULT_MODEL_GUIDES,
  DEFAULT_PLATFORM_GUIDES,
  DEFAULT_REQUEST_TEMPLATES,
  DEFAULT_TECHNIQUE_GUIDES,
} from "@/lib/promptLibraryDefaults";

/**
 * 프롬프트 가이드 · 요청 문구를 md 파일로 관리합니다.
 *
 * 코드에 문자열로 박아두면 문구를 고칠 때마다 빌드를 다시 해야 합니다.
 * 폴더에 두면 앱 안에서도, 에디터로도 고칠 수 있고 버전 관리도 됩니다.
 */

const SETTINGS_KEY = "ai-video-storage.prompt-library.v1";

/**
 * models — 영상·이미지 모델별 가이드 (무엇을 쓸지)
 * platforms — 생성 플랫폼별 가이드 (어떻게 넘길지. 레퍼런스 문법이 여기서 갈립니다)
 * techniques — 모델과 무관하게 늘 지켜야 하는 것들
 * requests — LLM 에 보낼 시스템 프롬프트
 */
export type PromptLibraryKind =
  "models" | "platforms" | "techniques" | "requests";

export const PROMPT_LIBRARY_LABELS: Record<PromptLibraryKind, string> = {
  requests: "LLM 요청 문구",
  models: "모델 가이드",
  platforms: "플랫폼 가이드",
  techniques: "기법 가이드",
};

const DEFAULTS_BY_KIND: Record<PromptLibraryKind, Record<string, string>> = {
  models: DEFAULT_MODEL_GUIDES,
  platforms: DEFAULT_PLATFORM_GUIDES,
  techniques: DEFAULT_TECHNIQUE_GUIDES,
  requests: DEFAULT_REQUEST_TEMPLATES as unknown as Record<string, string>,
};

export interface PromptLibrarySettings {
  baseDirectory: string;
}

export interface PromptDocument {
  /** 확장자를 뺀 파일 이름. 그대로 id 로 씁니다. */
  fileName: string;
  contents: string;
  /** 머리말에서 읽은 값 */
  meta: Record<string, string>;
  /** 머리말을 뺀 본문 */
  body: string;
}

export function getPromptLibrarySettings(): PromptLibrarySettings {
  if (typeof window === "undefined") return { baseDirectory: "" };
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    return saved
      ? { baseDirectory: "", ...JSON.parse(saved) }
      : { baseDirectory: "" };
  } catch {
    return { baseDirectory: "" };
  }
}

export function savePromptLibrarySettings(settings: PromptLibrarySettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * 문구가 실제로 놓이는 뿌리.
 *
 * 기본은 «기본 저장 폴더 / Prompt» 입니다. 예전에는 이 칸에 저장 폴더를
 * 그대로 넣을 수 있었고, 그러면 requests·models 폴더가 프로젝트 폴더들과
 * 나란히 최상단에 생겼습니다.
 */
export function promptBaseDirectory(): string {
  return resolveUnderBase(
    getPromptLibrarySettings().baseDirectory,
    PROMPT_FOLDER,
  );
}

function directoryFor(kind: PromptLibraryKind) {
  return joinPath(promptBaseDirectory(), kind);
}

/**
 * 머리말(front matter)을 읽습니다.
 *
 * ---
 * id: kling
 * label: Kling 3.0
 * ---
 */
export function parsePromptDocument(
  fileName: string,
  contents: string,
): PromptDocument {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fileName, contents, meta: {}, body: contents };

  const meta: Record<string, string> = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  });
  return { fileName, contents, meta, body: match[2] };
}

/**
 * 갈라진 폴더들을 미리 만들어 둡니다.
 *
 * 파일이 처음 저장될 때까지 아무것도 안 생기면, 탐색기를 열어 본 사람은
 * 설정이 안 먹은 줄 압니다.
 */
export async function ensurePromptFolders(): Promise<void> {
  if (!isDesktopApp()) return;
  const base = promptBaseDirectory().trim();
  if (!base) return;
  await Promise.all(
    (
      ["requests", "models", "platforms", "techniques"] as PromptLibraryKind[]
    ).map((kind) =>
      invoke("ensure_directory", { path: joinPath(base, kind) }).catch(
        () => null,
      ),
    ),
  );
  await invoke("ensure_directory", { path: joinPath(base, "user") }).catch(
    () => null,
  );
}

export async function listPromptDocuments(
  kind: PromptLibraryKind,
): Promise<PromptDocument[]> {
  const directory = directoryFor(kind);
  if (!isDesktopApp() || !directory) return [];
  const files = await invoke<{ fileName: string; contents: string }[]>(
    "list_markdown_files",
    { directory },
  );
  return files.map((file) => parsePromptDocument(file.fileName, file.contents));
}

/**
 * 화면에 보여 줄 문서 목록.
 *
 * 폴더를 아직 안 정했으면 **앱에 심어 둔 기본 문구**를 보여 줍니다.
 * 빈 목록을 보여 주면 «요청 문구가 원래 없는 것» 처럼 읽혀서, 프롬프트가
 * 어떤 글로 만들어지는지 확인할 길이 아예 없어집니다.
 *
 * `listPromptDocuments` 를 안 고치는 이유: 그쪽은 «폴더에 실제로 무엇이
 * 있나» 를 묻는 자리라(seed 가 그걸로 덮어쓸지 정합니다) 기본값을 섞으면
 * 이미 있는 파일로 착각합니다.
 */
export async function listPromptDocumentsForEditing(
  kind: PromptLibraryKind,
): Promise<{ documents: PromptDocument[]; fromFolder: boolean }> {
  const folder = await listPromptDocuments(kind).catch(() => []);
  if (folder.length) return { documents: folder, fromFolder: true };
  const documents = Object.entries(DEFAULTS_BY_KIND[kind]).map(
    ([fileName, contents]) => parsePromptDocument(fileName, contents),
  );
  return { documents, fromFolder: false };
}

export async function savePromptDocument(
  kind: PromptLibraryKind,
  fileName: string,
  contents: string,
) {
  const directory = directoryFor(kind);
  if (!directory) throw new Error("프롬프트 폴더를 먼저 설정해 주세요.");
  return invoke<string>("save_markdown_file", {
    request: { directory, fileName, contents },
  });
}


/**
 * 폴더가 비어 있으면 기본 문서를 깔아 둡니다.
 * 이미 있는 파일은 건드리지 않습니다. 사용자가 고친 걸 덮어쓰면 안 됩니다.
 */
export async function seedPromptLibrary(): Promise<
  Record<PromptLibraryKind, number>
> {
  const result: Record<PromptLibraryKind, number> = {
    models: 0,
    platforms: 0,
    techniques: 0,
    requests: 0,
  };
  if (!isDesktopApp() || !promptBaseDirectory().trim()) return result;

  for (const kind of Object.keys(DEFAULTS_BY_KIND) as PromptLibraryKind[]) {
    const existing = new Set(
      (await listPromptDocuments(kind)).map((document) => document.fileName),
    );
    for (const [fileName, contents] of Object.entries(DEFAULTS_BY_KIND[kind])) {
      if (existing.has(fileName)) continue;
      await savePromptDocument(kind, fileName, contents);
      result[kind] += 1;
    }
  }
  return result;
}

/**
 * 문서 본문의 **지문**. 바뀌었는지만 보면 되므로 짧고 빠른 것으로 충분합니다(FNV-1a).
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  const body = text.replace(/\r\n/g, "\n").trim();
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 도장 이름. 사람이 탐색기에서 봐도 뜻이 통하게 한국어입니다. */
const STAMP_KEY = "기준";

/** 머리말에 «기준» 도장을 찍습니다 — 「이 파일은 앱 기본값 이것에서 나왔다」. */
function withStamp(contents: string, stamp: string): string {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const line = `${STAMP_KEY}: ${stamp}`;
  if (!match) return ["---", line, "---", "", contents].join("\n");
  const head = match[1]
    .split(/\r?\n/)
    .filter((item) => !item.startsWith(`${STAMP_KEY}:`))
    .concat(line)
    .join("\n");
  return ["---", head, "---", match[2]].join("\n");
}

export interface PromptSyncResult {
  /** 폴더에 없어서 새로 깐 것. */
  seeded: string[];
  /** 손댄 적 없는 옛 사본이라 새 기본값으로 갈아 끼운 것. */
  refreshed: string[];
  /** 사람이 고쳐 둔 것 — 기본값이 바뀌었지만 **건드리지 않았습니다.** */
  kept: string[];
}

/**
 * **앱이 고친 문구를 폴더에 흘려보냅니다.**
 *
 * # 왜 필요한가
 *
 * `loadRequestTemplate` 은 폴더의 사본을 먼저 읽고, 있으면 그것이 이깁니다. 그래서
 * 폴더에 옛 사본이 있으면 **앱이 아무리 문구를 고쳐도 영영 안 갑니다.** `seedPromptLibrary`
 * 는 있는 파일을 안 건드리고(손으로 고친 것을 지키려고), `resetPromptLibrary` 는 사람이
 * 눌러야 합니다 — 그런데 **언제 눌러야 하는지 알 길이 없습니다.**
 *
 * 실제로 두 번 났습니다. 배경 프롬프트 규칙을 고쳤는데 며칠 동안 안 먹었고(옛 주석),
 * 2026-09-18 에는 컷 대사·연출 칸을 붙였는데 09-15 자 사본에 가려 **한 컷도 안 들어왔습니다.**
 * 그때마다 원인을 찾는 데 한참 걸립니다 — 코드도 프롬프트도 멀쩡해 보이니까요.
 *
 * # 어떻게 가르는가
 *
 * 파일을 깔 때 머리말에 **«기준» 도장**(그때 기본값의 지문)을 찍어 둡니다.
 *
 * - 지금 본문의 지문 == 도장 → **사람이 안 건드렸습니다.** 새 기본값으로 갈아 끼웁니다.
 * - 다르면 → **사람이 고쳤습니다.** 건드리지 않고 이름만 돌려줍니다.
 *
 * 도장이 없는 옛 파일은 «고친 것» 으로 봅니다 — 지우는 쪽으로 틀리는 것보다 낫습니다.
 * 다만 본문이 이미 기본값과 같으면 도장만 찍어 둡니다(다음부터 저절로 따라옵니다).
 */
export async function syncPromptDefaults(): Promise<PromptSyncResult> {
  const out: PromptSyncResult = { seeded: [], refreshed: [], kept: [] };
  if (!isDesktopApp() || !promptBaseDirectory().trim()) return out;

  for (const kind of Object.keys(DEFAULTS_BY_KIND) as PromptLibraryKind[]) {
    const folder = new Map(
      (await listPromptDocuments(kind).catch(() => [])).map((item) => [item.fileName, item]),
    );
    for (const [fileName, contents] of Object.entries(DEFAULTS_BY_KIND[kind])) {
      const fresh = fingerprint(parsePromptDocument(fileName, contents).body);
      const mine = folder.get(fileName);
      if (!mine) {
        await savePromptDocument(kind, fileName, withStamp(contents, fresh)).catch(() => null);
        out.seeded.push(fileName);
        continue;
      }
      const now = fingerprint(mine.body);
      if (now === fresh) {
        // 이미 같습니다. 도장이 없으면 찍어만 둡니다 — 다음 개선부터 저절로 따라옵니다.
        if (mine.meta[STAMP_KEY] !== fresh)
          await savePromptDocument(kind, fileName, withStamp(contents, fresh)).catch(() => null);
        continue;
      }
      if (mine.meta[STAMP_KEY] && mine.meta[STAMP_KEY] === now) {
        await savePromptDocument(kind, fileName, withStamp(contents, fresh)).catch(() => null);
        out.refreshed.push(fileName);
        continue;
      }
      out.kept.push(fileName);
    }
  }
  return out;
}

/**
 * 기본 문서를 **강제로 다시 씁니다.**
 *
 * seedPromptLibrary 는 이미 있는 파일을 건드리지 않습니다. 손으로 고친 문구를
 * 업데이트가 말없이 덮어쓰면 안 되니까요. 하지만 그래서 앱이 개선한 요청 문구가
 * 영영 반영되지 않는 문제도 같이 생깁니다. 이 함수는 그때 손으로 부릅니다.
 *
 * 실제로 그 일이 있었습니다. 배경 프롬프트 규칙을 고쳤는데 폴더의 옛 md 가
 * 그대로 쓰이는 바람에, 고친 것이 며칠 동안 반영되지 않았습니다.
 */
export async function resetPromptLibrary(
  kind: PromptLibraryKind,
): Promise<number> {
  // 여기서 «직접 지정한 값» 을 보면 안 됩니다. 문구 폴더는 기본 저장 폴더에서
  // 갈라지므로, 따로 지정하지 않은 정상적인 상태에서도 빈 문자열입니다.
  // 그걸 «폴더가 없다» 로 읽어서 「되돌릴 폴더가 설정돼 있지 않습니다」 가 떴습니다.
  if (!isDesktopApp() || !promptBaseDirectory().trim()) return 0;
  let count = 0;
  for (const [fileName, contents] of Object.entries(DEFAULTS_BY_KIND[kind])) {
    await savePromptDocument(kind, fileName, contents);
    count += 1;
  }
  return count;
}

/** 고를 수 있는 플랫폼 목록. 폴더에 있는 것이 먼저고, 없으면 기본값입니다. */
/**
 * 이미지·영상 모델 목록.
 *
 * 여기 있는 id 가 `nbpro` 가 아니라 `nano-banana` 인 것은 가이드 md 의
 * 앞머리와 맞추기 위해서입니다. 예전 데이터에 `nbpro` 가 들어 있을 수 있어
 * `normalizeModelId` 로 받아 줍니다.
 */
export const IMAGE_MODELS: {
  id: string;
  label: string;
  kind: "image" | "video";
  /**
   * **마그니픽으로 바로 돌릴 수 있는가.**
   *
   * 미드저니는 디스코드로만 돌아서 우리가 «구성» 으로 보낼 수가 없습니다 — 프롬프트를
   * 복사해 손으로 넣는 자리입니다. 나머지는 마그니픽이 그 모델을 그대로 돌려 주므로
   * «구성» 단추 하나로 끝납니다. 이 표가 그 갈림길을 한곳에서 정합니다.
   */
  magnific?: string;
}[] = [
  /*
    ── 그림 모델 ────────────────────────────────────────────────────────
    

    플럭스·스테이블 디퓨전을 뺀 까닭: 둘 다 우리가 실제로 안 씁니다. 목록에 있으면
    «첫 레퍼런스 프롬프트» 에서 고를 수는 있는데 뽑을 자리가 없어, 프롬프트만 그 문법으로
    써 놓고 아무 데도 못 넣는 일이 생깁니다.

    라벨에 판 번호를 안 붙입니다 — 판이 자주 오르는데 번호를 박아 두면 가이드 md 와
    화면이 어긋난 채로 남습니다. (GPT 2.5 는 사용자가 부르는 이름 그대로 둡니다.)
  */
  {
    id: "nano-banana",
    label: "Nano Banana Pro",
    kind: "image",
    magnific: "imagen-nano-banana-2",
  },
  { id: "midjourney", label: "Midjourney", kind: "image" },
  { id: "gpt-image", label: "GPT 2.5 Image", kind: "image", magnific: "gpt-2" },
  // 마그니픽은 여기 없습니다. **모델이 아니라 플랫폼**입니다 — 그림을 만드는
  // 것이 아니라 남의 모델을 돌려 주는 자리입니다. 플랫폼 고르는 칸으로
  // 옮겼습니다. (지시 128)
  //
  // 예전에 magnific 을 골라 둔 카드는 normalizeModelId 가 첫 모델로 옮깁니다.
  { id: "seedance25", label: "Seedance 2.5", kind: "video" },
  { id: "seedance20", label: "Seedance 2.0", kind: "video" },
  { id: "kling", label: "Kling 3.0", kind: "video" },
  { id: "veo", label: "Veo 3.1", kind: "video" },
  { id: "sora", label: "Sora 2 Pro", kind: "video" },
];

/**
 * 그림을 뽑는 모델만.
 *
 * «첫 레퍼런스 프롬프트» 는 **아직 그림이 하나도 없을 때 첫 장을 뽑는** 자리라
 * 영상 모델(Kling·Veo·Sora…)을 고를 수 있으면 안 됩니다. 목록을 따로 적지 않고
 * 위에서 걸러 내는 것은, 모델이 늘 때 한쪽만 고치는 일을 막기 위해서입니다.
 */
export const IMAGE_ONLY_MODELS = IMAGE_MODELS.filter(
  (model) => model.kind === "image",
);

/** 첫 레퍼런스용 모델 값 고르기. 영상 모델이나 빈 값이면 첫 이미지 모델로 떨어집니다. */
export function normalizeImageModelId(id?: string) {
  return IMAGE_ONLY_MODELS.some((model) => model.id === id)
    ? (id as string)
    : IMAGE_ONLY_MODELS[0].id;
}

/** 예전에 쓰던 짧은 이름을 지금 id 로 옮깁니다. */
export function normalizeModelId(id?: string) {
  if (!id) return IMAGE_MODELS[0].id;
  if (id === "nbpro") return "nano-banana";
  /*
    없앤 모델을 가리키던 카드는 **나노 바나나 프로**로 옮깁니다(첫 모델).
    사용자 2026-09-14 에 플럭스·스테이블 디퓨전을 목록에서 뺐는데, 예전에 그걸 골라 둔
    카드가 빈 칸이 되면 «모델 없음» 으로 프롬프트를 지어 버립니다.
  */
  return IMAGE_MODELS.some((model) => model.id === id)
    ? id
    : IMAGE_MODELS[0].id;
}

/** 이 모델을 마그니픽으로 바로 돌릴 수 있는가. 미드저니만 못 돌립니다. */
export function magnificModelOf(id?: string) {
  const normalized = normalizeModelId(id);
  return IMAGE_MODELS.find((model) => model.id === normalized)?.magnific;
}

export function modelLabel(id?: string) {
  const normalized = normalizeModelId(id);
  return (
    IMAGE_MODELS.find((model) => model.id === normalized)?.label ?? normalized
  );
}

/**
 * 고를 수 있는 기법 목록. 폴더에 있는 것이 먼저고, 없으면 기본값입니다.
 *
 * 연기 지시·카메라 무빙·VFX 처럼 **모델과 무관하게 늘 지켜야 할 것**을
 * 담은 문서입니다. 컷마다 필요한 것만 골라 요청에 싣습니다 — 전부 실으면
 * 토큰만 늘고 정작 중요한 지시가 묻힙니다. (지시 129·131)
 */
export async function listTechniqueOptions(): Promise<
  { id: string; label: string }[]
> {
  try {
    const documents = await listPromptDocuments("techniques");
    if (documents.length) {
      return documents.map((document) => ({
        id: document.meta.id || document.fileName,
        label: document.meta.label || document.fileName,
      }));
    }
  } catch {
    // 폴더 접근 실패는 기본값으로 넘어갑니다.
  }
  return Object.entries(DEFAULT_TECHNIQUE_GUIDES).map(
    ([fileName, contents]) => {
      const meta = parsePromptDocument(fileName, contents).meta;
      return { id: meta.id || fileName, label: meta.label || fileName };
    },
  );
}

export async function listPlatformOptions(): Promise<
  { id: string; label: string }[]
> {
  try {
    const documents = await listPromptDocuments("platforms");
    if (documents.length) {
      return documents.map((document) => ({
        id: document.meta.id || document.fileName,
        label: document.meta.label || document.fileName,
      }));
    }
  } catch {
    // 폴더 접근 실패는 기본값으로 넘어갑니다.
  }
  return Object.entries(DEFAULT_PLATFORM_GUIDES).map(([fileName, contents]) => {
    const meta = parsePromptDocument(fileName, contents).meta;
    return { id: meta.id || fileName, label: meta.label || fileName };
  });
}

/** 플랫폼 가이드를 읽습니다. 없으면 빈 문자열 — 가이드는 선택 사항입니다. */
export async function loadPlatformGuide(platformId: string): Promise<string> {
  try {
    const documents = await listPromptDocuments("platforms");
    const found = documents.find(
      (document) =>
        document.meta.id === platformId || document.fileName === platformId,
    );
    if (found) return found.body.trim();
  } catch {
    // 무시
  }
  const fallback = DEFAULT_PLATFORM_GUIDES[platformId];
  return fallback ? parsePromptDocument(platformId, fallback).body.trim() : "";
}

/** 고른 기법 가이드들을 이어 붙입니다. */
/**
 * 기법 문서에서 **요청에 실을 몫**만 떼어 냅니다.
 *
 * # 왜 통째로 안 보내나
 *
 * 기법 문서는 **사람이 읽는 글**입니다. 왜 그런지, 실측으로 무엇을 봤는지, 틀린 예와 맞는
 * 예까지 들어 있어 `acting.md` 가 12,916자입니다. 그런데 컷 프롬프트 템플릿 본체는 755자 —
 * **칩 하나가 본문의 열일곱 배**입니다. 칩 두 개를 켜고 컷 예순두 개를 뽑으면 그 1.7만 자가
 * 예순두 번 다시 갑니다(「국호」 실측 되풀이 181만 자).
 *
 * 모델에게 필요한 것은 «까닭» 이 아니라 **지킬 규칙**입니다. 까닭은 사람이 라이브러리에서
 * 읽으면 됩니다. 그래서 문서마다 맨 앞에 `## 핵심 규칙` 을 두고, 요청에는 그것만 싣습니다.
 *
 * 그 절이 없는 문서는 **통째로** 보냅니다 — 요약을 안 쓴 문서 때문에 규칙이 통째로 빠지는
 * 것보다, 길더라도 가는 편이 낫습니다.
 */
export function coreOf(body: string): string {
  const match = body.match(/^##[ \t]*핵심 규칙[ \t]*$/m);
  if (!match || match.index === undefined) return body.trim();
  const after = body.slice(match.index + match[0].length);
  const next = after.search(/^## /m);
  return (next < 0 ? after : after.slice(0, next)).trim();
}

export async function loadTechniqueGuides(ids: string[]): Promise<string> {
  if (!ids.length) return "";
  let documents: PromptDocument[] = [];
  try {
    documents = await listPromptDocuments("techniques");
  } catch {
    // 무시
  }
  const bodies = ids.map((id) => {
    const found = documents.find(
      (document) => document.meta.id === id || document.fileName === id,
    );
    if (found) return coreOf(found.body);
    const fallback = DEFAULT_TECHNIQUE_GUIDES[id];
    return fallback ? coreOf(parsePromptDocument(id, fallback).body) : "";
  });
  return bodies.filter(Boolean).join("\n\n");
}

/**
 * 요청 문구를 읽습니다. 폴더가 없거나 파일이 지워졌으면 코드에 있는 기본값을 씁니다.
 * 문구 파일이 하나 없다고 기능 전체가 멈추면 안 됩니다.
 */
/**
 * **늘 붙는 공통 규칙** — `requests/_공통규칙.md`.
 *
 * 기법 문서는 칩을 골라야 붙는데,
 * 전문가가 아닌 사람일수록 칩을 안 고릅니다. 이건 고르든 말든 붙습니다.
 *
 * 폴더에 없으면 **빈 글자**를 돌려줍니다 — 요청이 실패하면 안 되니까요.
 */
export async function loadCommonRules(): Promise<string> {
  try {
    const documents = await listPromptDocuments("requests");
    const found = documents.find((document) => document.fileName === "_공통규칙");
    if (found) return found.body.trim();
  } catch {
    // 폴더를 못 읽으면 기본값으로.
  }
  const fallback = DEFAULT_REQUEST_TEMPLATES["_공통규칙" as keyof typeof DEFAULT_REQUEST_TEMPLATES];
  return fallback ? parsePromptDocument("_공통규칙", fallback).body.trim() : "";
}

export async function loadRequestTemplate(
  fileName: keyof typeof DEFAULT_REQUEST_TEMPLATES,
): Promise<string> {
  try {
    const documents = await listPromptDocuments("requests");
    const found = documents.find((document) => document.fileName === fileName);
    if (found) return found.body.trim();
  } catch {
    // 폴더 접근 실패는 기본값으로 넘어갑니다.
  }
  return parsePromptDocument(
    fileName,
    DEFAULT_REQUEST_TEMPLATES[fileName],
  ).body.trim();
}

/** 모델 가이드를 읽습니다. 없으면 빈 문자열 — 가이드는 선택 사항입니다. */
export async function loadModelGuide(modelId: string): Promise<string> {
  try {
    const documents = await listPromptDocuments("models");
    const found = documents.find(
      (document) =>
        document.meta.id === modelId || document.fileName === modelId,
    );
    if (found) return found.body.trim();
  } catch {
    // 무시
  }
  const fallback =
    DEFAULT_MODEL_GUIDES[modelId as keyof typeof DEFAULT_MODEL_GUIDES];
  return fallback ? parsePromptDocument(modelId, fallback).body.trim() : "";
}

/** 브라우저 다운로드로 md 파일 저장 */
// ── 통째로 저장하고 되살리기 ──────────────────────────────────────────────

/**
 * 문구 전체를 파일 하나로.
 *
 * 「기본값으로」 는 앱이 심어 둔 것으로 되돌리는 버튼이라, **내가 고쳐 놓은
 * 것을 지키는 길이 없었습니다.** 요청 문구를 며칠 다듬어 놓고 폴더를 옮기거나
 * 앱을 다시 깔면 그대로 사라집니다. 그래서 한 벌을 통째로 내보내고 되살립니다.
 *
 * md 파일을 zip 으로 묶지 않고 json 한 장에 담는 이유는, 압축 라이브러리를
 * 하나 더 들이지 않으려는 것도 있지만 **어느 갈래의 파일인지가 함께 남아야**
 * 되살릴 때 제자리로 돌아가기 때문입니다.
 */
export interface PromptLibraryBundle {
  kind: "frameforge.prompt-library";
  version: 1;
  exportedAt: string;
  documents: Record<PromptLibraryKind, Record<string, string>>;
}

export async function exportPromptLibrary(): Promise<PromptLibraryBundle> {
  const documents = {} as Record<PromptLibraryKind, Record<string, string>>;
  for (const kind of [
    "requests",
    "models",
    "platforms",
    "techniques",
  ] as PromptLibraryKind[]) {
    const { documents: list } = await listPromptDocumentsForEditing(kind);
    documents[kind] = Object.fromEntries(
      list.map((item) => [item.fileName, item.contents]),
    );
  }
  return {
    kind: "frameforge.prompt-library",
    version: 1,
    exportedAt: new Date().toISOString(),
    documents,
  };
}

/** 내보낸 파일이 기본으로 놓이는 자리. 문구 폴더 안의 `user` 입니다. */
export function promptExportDirectory(): string {
  const saved = getExportFolder();
  return saved || joinPath(promptBaseDirectory(), "user");
}

const EXPORT_KEY = "ai-video-storage.prompt-export-folder.v1";

export function getExportFolder(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(EXPORT_KEY) || "";
  } catch {
    return "";
  }
}

export function setExportFolder(path: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EXPORT_KEY, path.trim());
}

/**
 * 내보냅니다.
 *
 * 데스크톱에서는 **고른 폴더에 파일로** 씁니다. 브라우저 기본 다운로드로
 * 내려받게 두었더니 «어디로 갔는지» 를 앱이 알 수 없어서, 되살릴 때 그
 * 파일을 다시 찾아 헤매야 했습니다. 저장한 자리를 그대로 돌려줍니다.
 *
 * 데스크톱이 아니면 예전처럼 다운로드로 떨어집니다.
 */
export async function savePromptLibraryBundle(
  bundle: PromptLibraryBundle,
  directory?: string,
): Promise<string> {
  // 날짜만 쓰면 같은 날 두 번째 내보내기가 **앞 파일을 말없이 덮어씁니다.**
  // 백업이 백업을 지우는 셈이라, 분까지 넣어 매번 다른 파일로 남깁니다.
  // 화면에 보이는 날짜와 맞아야 하므로 현지 시각으로 찍습니다.
  const at = new Date(bundle.exportedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `_${pad(at.getHours())}${pad(at.getMinutes())}`;
  const fileName = `프롬프트문구_${stamp}`;
  const contents = JSON.stringify(bundle, null, 2);

  const target = (directory ?? promptExportDirectory()).trim();
  if (isDesktopApp() && target) {
    return invoke<string>("save_text_file", {
      request: { directory: target, fileName, contents },
      extension: "json",
    });
  }

  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return "다운로드 폴더";
}

/**
 * 되살릴 파일을 고릅니다.
 *
 * 데스크톱에서는 **내보낸 자리에서 대화상자가 열립니다.** 방금 거기 넣어
 * 놓고 사용자가 다시 찾아 들어가게 두면 안 됩니다.
 * 데스크톱이 아니면 null 을 돌려주고, 부르는 쪽이 파일 입력으로 물러섭니다.
 */
export async function choosePromptLibraryFile(
  directory?: string,
): Promise<{ path: string; contents: string } | null> {
  if (!isDesktopApp()) return null;
  const start = (directory ?? promptExportDirectory()).trim();
  const picked = await invoke<{ path: string; contents: string } | null>(
    "choose_text_file",
    {
      directory: start,
      extension: "json",
    },
  );
  return picked ?? null;
}

/** 되살립니다. 파일에 없는 문서는 건드리지 않습니다. */
export async function importPromptLibrary(bundle: unknown): Promise<number> {
  const parsed = bundle as PromptLibraryBundle;
  if (parsed?.kind !== "frameforge.prompt-library" || !parsed.documents) {
    throw new Error("이 앱에서 내보낸 문구 파일이 아닙니다.");
  }
  if (!promptBaseDirectory().trim()) {
    throw new Error(
      "먼저 기본 저장 폴더를 정해 주세요. 되살릴 자리가 없습니다.",
    );
  }
  let count = 0;
  for (const kind of Object.keys(parsed.documents) as PromptLibraryKind[]) {
    if (!DEFAULTS_BY_KIND[kind]) continue;
    for (const [fileName, contents] of Object.entries(
      parsed.documents[kind] || {},
    )) {
      if (typeof contents !== "string") continue;
      await savePromptDocument(kind, fileName, contents);
      count += 1;
    }
  }
  return count;
}

/**
 * 문서 한 장을 파일로 내보냅니다. 저장한 자리를 돌려줍니다.
 *
 * 예전에는 Blob 링크를 만들어 `click()` 했습니다. **타우리 웹뷰에서는
 * 조용히 아무 일도 안 합니다** — 라고 한 것이 이것입니다. (지시 127)
 *
 * 「전체 내보내기」 와 같은 길로 보냅니다. 어디에 떨어졌는지 앱이 알아야
 * 나중에 그 파일을 다시 찾아 헤매지 않습니다.
 */
export async function downloadPromptDocument(
  document_: PromptDocument,
  directory?: string,
): Promise<string> {
  const target = (directory ?? promptExportDirectory()).trim();
  if (!isDesktopApp() || !target) {
    throw new Error(
      "내보낼 폴더가 없습니다. 설정에서 기본 저장 폴더를 먼저 정해 주세요.",
    );
  }
  return invoke<string>("save_text_file", {
    request: {
      directory: target,
      fileName: document_.fileName,
      contents: document_.contents,
    },
    extension: "md",
  });
}
