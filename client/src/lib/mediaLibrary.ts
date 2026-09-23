import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { rememberMagnificSentFiles } from "@/lib/magnificBridge";
import { toast } from "sonner";
import { isDesktopApp } from "@/lib/llm";
import { PANORAMA_DIR, SIX_FACES_DIR } from "@/lib/faceSets";
import { MOTION_MASK_ACTION } from "@/lib/motionMask";
import { ASSET_UPLOAD_CHUNK_BYTES, uploadProjectAsset } from "@/lib/assetUpload";

/**
 * 그림·영상 파일을 폴더와 주고받는 창구.
 *
 * # 이 앱의 규칙 하나
 *
 * **폴더가 원본입니다.** 앱이 들고 있는 목록은 폴더를 비추는 거울일 뿐이에요.
 * 그래서 화면에서 뺀 것은 폴더에서도 지워야 하고, 이름을 바꾸면 파일 이름도
 * 따라가야 합니다. 그러지 않으면 다음에 폴더를 읽을 때 지운 것이 되살아나거나
 * 같은 그림이 두 개로 늘어납니다.
 *
 * # blob 주소를 믿지 마세요
 *
 * 브라우저가 만드는 `blob:` 주소는 **앱을 닫으면 죽습니다.** 화면에 그림이
 * 보인다고 안심하면 안 됩니다. 다시 열었을 때 빈 칸이 되는 버그가 이것 때문에
 * 여러 번 났습니다. 늘 `assetSrc(filePath) || thumb` 순서로 쓰세요 —
 * 저장된 파일이 먼저입니다.
 *
 * 사고로 잃은 원본을 기록에 남은 호출부에서 역산해 다시 쓴 파일입니다.
 */

const SETTINGS_KEY = "ai-video-storage.media-library.v1";

/*
  ── 웹뷰 저장소 바깥의 거울 ───────────────────────────────────────────────

  **`localStorage` 는 origin 단위로 갈립니다.** 설치본과 개발 서버는 웹뷰 origin 이
  달라서 저장소를 통째로 따로 씁니다. 그래서 설치하고 처음 열면 **저장 폴더부터 다시
  잡아야** 했고(그전까지 프로젝트 목록이 텅 빈 채로 보입니다), BGM 기록도 안 보였습니다.
  웹뷰 캐시를 비우는 일에도 같이 날아갑니다.

  그래서 같은 값을 앱 데이터 폴더의 파일에 한 벌 더 둡니다(`read_app_settings` ·
  `write_app_settings`). 역할을 나눠 두는 것이 요점입니다.

  - `localStorage` — **화면이 곧장(동기로) 읽는 쪽.** `getMediaLibrarySettings()` 를
    부르는 곳이 스무 곳이 넘고 대부분 렌더 도중이라, 이 함수는 비동기가 될 수 없습니다.
  - 거울 파일 — **origin 을 건너 살아남는 쪽.** 앱을 켤 때 한 번 읽어 `localStorage`
    를 채웁니다.

  칸(섹션)마다 다루는 법이 달라서 «누가 어떻게 읽고 쓰는가» 는 그 칸을 둔 파일이
  `registerMirrorSection` 으로 알려 줍니다. 여기 있는 것은 **거울 살림 한 벌**뿐입니다 —
  칸마다 읽기·쓰기·시각 비교를 따로 적으면 한 칸만 규칙이 어긋난 판이 생깁니다.
*/

/**
 * `localStorage` 쪽 값이 **언제 저장됐는지.**
 *
 * 둘 다 값을 들고 있을 때 «더 최근 것» 을 가리려면 양쪽에 시각이 있어야 합니다.
 * 저장하는 값의 모양을 건드리지 않으려고 시각만 따로 둡니다 — 예전 저장본을
 * 그대로 읽을 수 있어야 하고, 값 안에 시각을 끼워 넣으면 그 값을 쓰는 곳이
 * 전부 모르는 칸을 하나씩 더 들고 다니게 됩니다.
 */
const MIRROR_STAMP_KEY = "ai-video-storage.mirror-saved-at.v1";

/** 거울 파일 안의 칸 하나. */
interface MirrorEntry {
  /** 저장한 때(ms). */
  savedAt: number;
  value: unknown;
}

interface MirrorFile {
  entries: Record<string, MirrorEntry>;
}

/** 거울에 칸을 둔 쪽이 알려 주는 «다루는 법». */
export interface MirrorSectionSpec<T> {
  /** 지금 `localStorage` 에 있는 값. 없으면 null. */
  read(): T | null;
  /** 거울에서 가져온 값을 `localStorage` 에 씁니다. */
  write(value: T): void;
  /**
   * 양쪽에 값이 있을 때 하나로 만듭니다. **없으면 더 최근 쪽이 통째로 이깁니다.**
   *
   * 저장 폴더처럼 «하나를 고르는 값» 은 최근 것이 이기면 그만입니다. 그런데 BGM
   * 기록처럼 **모음**은 한쪽이 통째로 이기면 다른 origin 에서 적은 곡이 사라집니다 —
   * 그런 칸은 합치는 법을 같이 줍니다.
   */
  merge?(mine: T, theirs: T): T;
}

const mirrorSections = new Map<string, MirrorSectionSpec<unknown>>();

/**
 * 거울에 칸 하나를 겁니다. 모듈이 읽히는 때(모듈 최상위)에 부르세요.
 *
 * 늦게 건 칸도 곧바로 맞춰 줍니다 — 읽기가 이미 끝난 뒤에 등록되면(동적 import 로
 * 늦게 읽히는 모듈) 그 칸만 조용히 안 채워지는 판이 생깁니다.
 */
export function registerMirrorSection<T>(section: string, spec: MirrorSectionSpec<T>) {
  const stored = spec as unknown as MirrorSectionSpec<unknown>;
  mirrorSections.set(section, stored);
  if (settingsHydrated && isDesktopApp()) hydrateSection(section, stored);
}

/** 파일에서 읽어 둔 거울 한 벌. 쓸 때는 이것을 통째로 다시 씁니다. */
let mirrorFile: MirrorFile = { entries: {} };

function readMirrorStamps(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const saved = window.localStorage.getItem(MIRROR_STAMP_KEY);
    return saved ? (JSON.parse(saved) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMirrorStamp(section: string, savedAt: number) {
  if (typeof window === "undefined") return;
  try {
    const stamps = readMirrorStamps();
    stamps[section] = savedAt;
    window.localStorage.setItem(MIRROR_STAMP_KEY, JSON.stringify(stamps));
  } catch {
    // 저장소를 못 쓰면 시각만 없는 것입니다 — 거울은 그래도 돕니다(«없으면 0»).
  }
}

/** 파일 쓰기를 한 줄로 세웁니다. 두 칸이 같은 순간에 저장하면 뒤엣것이 앞엣것을 지웁니다. */
let mirrorWrites: Promise<void> = Promise.resolve();
const mirrorValueKey = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

/**
 * 거울 파일에 한 칸을 씁니다. 화면을 기다리게 하지 않으려고 줄에 세우기만 합니다.
 *
 * `localStorage` 쪽은 부르는 쪽이 이미 썼다고 봅니다 — 여기서 같이 쓰면 «어느 쪽이
 * 진짜인가» 가 두 군데가 됩니다.
 */
export function queueMirrorWrite(section: string, value: unknown, savedAt = Date.now()) {
  // 화면의 기존 동기 저장은 유지합니다. 확인이 필요한 외부 명령은 아래 Promise를 기다립니다.
  void queueMirrorWriteAndConfirm(section, value, savedAt).catch(() => undefined);
}

/** 해당 쓰기의 파일 반영까지 확인합니다. 뒤의 성공이 앞의 실패를 가려서는 안 됩니다. */
export function queueMirrorWriteAndConfirm(section: string, value: unknown, savedAt = Date.now()): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(value)) as unknown;
  writeMirrorStamp(section, savedAt);
  mirrorFile.entries[section] = { savedAt, value: snapshot };
  if (!isDesktopApp()) return Promise.reject(new Error("앱 데이터 파일의 저장 확인은 데스크톱 앱에서만 가능합니다."));
  const write = mirrorWrites
    // **다 읽기 전에 쓰면 아직 못 읽은 칸을 지웁니다.** 읽기가 끝난 뒤에 줄을 섭니다.
    .then(() => appSettingsReady)
    .then(async () => {
      /*
        **읽고 얹고 쓰기를 Rust 한 명령으로 맡깁니다**(`merge_app_settings`).

        예전에는 여기서 읽고·얹고·쓰기를 세 번 불렀습니다. 그 사이가 열려 있어서, 앱을
        두 벌 띄워 두면 둘이 **같은 옛 값을 동시에 읽고** 각자 얹어 쓰는 일이 났습니다 —
        A 가 BGM 을 고치고 B 가 저장 폴더만 바꿨을 뿐인데 BGM 이 되돌아갑니다.
        여기서 다시 읽는 횟수를 늘려도 그 틈은 안 없어집니다. **읽고 쓰는 사이를 잠글 수
        있는 자리는 Rust 쪽뿐**입니다(2026-09-23 검토).

        돌려받은 것은 얹은 뒤의 **파일 전체**입니다. 제 사본을 그것으로 갈아 끼워야
        다음 쓰기가 남의 칸을 덮지 않습니다.
      */
      const merged = await invoke<string>("merge_app_settings", {
        section,
        savedAt,
        value: snapshot,
      });
      const next = JSON.parse(merged) as MirrorFile;
      if (!next?.entries || mirrorValueKey(next.entries[section]?.value) !== mirrorValueKey(snapshot))
        throw new Error("앱 설정 파일에서 요청한 값을 확인하지 못했습니다. 최신 내용을 다시 읽어 주세요.");
      mirrorFile = next;
    })
    .then(() => undefined);
  // 한 쓰기가 실패해도 다음 저장은 재시도할 수 있어야 합니다. 실패는 해당 호출자에게 전달합니다.
  mirrorWrites = write.catch(() => undefined);
  return write;
}

/** 거울을 다 읽었는가. 읽기 전에는 `localStorage` 가 비어 있어도 «없다» 고 단정할 수 없습니다. */
let settingsHydrated = false;
/** 다 읽기 전에 «폴더 없음» 을 읽어 간 곳이 있는가(아래 `recoverFromEmptyRender`). */
let readEmptyBeforeHydration = false;

function applyFromMirror(section: string, spec: MirrorSectionSpec<unknown>, value: unknown, savedAt: number) {
  try {
    spec.write(value);
  } catch {
    return;
  }
  writeMirrorStamp(section, savedAt);
}

/**
 * 칸 하나를 파일과 맞춥니다. **값을 잃지 않는 것이 첫째입니다.**
 *
 * - 파일에 없고 여기에만 있으면 → **그것을 파일로 올려 둡니다**(옮기는 중인 사용자).
 * - 여기에 없고 파일에만 있으면 → 파일 것을 받습니다(새 origin — 이게 고치려던 증상입니다).
 * - 둘 다 있으면 → 합치는 법이 있으면 합치고, 없으면 **더 최근 것**이 이깁니다.
 *
 * 시각이 없는 옛 저장본은 0으로 봅니다. 그 값은 이 거울이 생기기 전에 적힌 것이고,
 * 파일에 적힌 것은 생긴 뒤에 적힌 것이라 실제로 더 나중입니다.
 */
function hydrateSection(section: string, spec: MirrorSectionSpec<unknown>) {
  let mine: unknown = null;
  try {
    mine = spec.read();
  } catch {
    mine = null;
  }
  const theirs = mirrorFile.entries[section];
  const mineAt = readMirrorStamps()[section] ?? 0;

  if (!theirs) {
    if (mine !== null) queueMirrorWrite(section, mine, mineAt || Date.now());
    return;
  }
  if (mine === null) {
    applyFromMirror(section, spec, theirs.value, theirs.savedAt);
    return;
  }
  if (spec.merge) {
    const merged = spec.merge(mine, theirs.value);
    const mergedText = JSON.stringify(merged);
    // 달라진 쪽만 씁니다 — 켤 때마다 양쪽을 쓰면 안 바뀐 목록도 새로 그려집니다.
    if (mergedText !== JSON.stringify(mine)) applyFromMirror(section, spec, merged, Date.now());
    if (mergedText !== JSON.stringify(theirs.value)) queueMirrorWrite(section, merged, Date.now());
    return;
  }
  if (theirs.savedAt > mineAt) applyFromMirror(section, spec, theirs.value, theirs.savedAt);
  else if (JSON.stringify(mine) !== JSON.stringify(theirs.value))
    queueMirrorWrite(section, mine, mineAt || Date.now());
}

/** 거울 파일을 읽어 `localStorage` 를 채웁니다. 앱을 켤 때 한 번. */
async function hydrateAppSettings(): Promise<void> {
  if (typeof window === "undefined" || !isDesktopApp()) return;

  let text: string | null = null;
  try {
    text = await invoke<string | null>("read_app_settings");
  } catch {
    // 못 읽으면 `localStorage` 만으로 갑니다 — 거울은 «있으면 좋은 것» 입니다.
    return;
  }
  if (text) {
    try {
      const parsed = JSON.parse(text) as MirrorFile;
      if (parsed && typeof parsed === "object" && parsed.entries) mirrorFile = { entries: parsed.entries };
    } catch {
      // 깨진 파일은 없는 셈 칩니다. 다음 저장에서 성한 것으로 다시 씁니다.
    }
  }

  for (const [section, spec] of mirrorSections) hydrateSection(section, spec);
}

/** 새로 그리기를 이번 실행에 이미 한 번 했다는 표. */
const RELOAD_GUARD_KEY = "ai-video-storage.settings-recovered.v1";

/**
 * **«폴더 없음» 으로 먼저 그려졌다면 한 번만 다시 그립니다.**
 *
 * 거울 읽기는 비동기라, 화면이 먼저 그려지고 그때 저장 폴더가 아직 비어 있으면
 * 프로젝트 목록이 **텅 빈 채로** 나옵니다. 뒤늦게 채워 봐야 이미 읽어 간 곳은
 * 다시 읽지 않아서, 사람 눈에는 「깔고 열었더니 작품이 다 사라졌다」 로 보입니다.
 *
 * 대개는 거울 읽기(작은 파일 하나)가 첫 목록 읽기보다 먼저 끝나서 여기까지 오지
 * 않습니다. **정말 늦은 때만** 새로 그립니다 — 이 길은 origin 하나에서 딱 한 번,
 * 앱을 켠 직후에만 지나갑니다(그다음부터는 `localStorage` 에 값이 있습니다).
 *
 * 되돌기를 도는 일이 없게 이번 실행에 한 번 지났다는 표를 남깁니다.
 */
function recoverFromEmptyRender() {
  if (!readEmptyBeforeHydration) return;
  if (!getMediaLibrarySettings().baseDirectory.trim()) return;
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    // 표를 못 남기면 새로 그리지 않습니다. 되돌기를 도는 것보다 한 번 더 누르는 편이 낫습니다.
    return;
  }
  window.location.reload();
}

/**
 * 거울을 다 읽을 때까지 기다립니다.
 *
 * **모듈이 읽히는 때 시작합니다** — 화면이 그려지기 전에 출발해야 «폴더 없음» 으로
 * 먼저 그려지는 일이 줄어듭니다. 칸을 등록하는 쪽(BGM 기록)이 이 파일보다 늦게
 * 읽힐 수 있어서, 모듈이 전부 읽히고 난 **다음 첫 틈**에 시작합니다.
 */
const appSettingsReady: Promise<void> = new Promise<void>((resolve) => {
  queueMicrotask(() => {
    void hydrateAppSettings()
      .catch(() => undefined)
      .then(() => {
        settingsHydrated = true;
        resolve();
        recoverFromEmptyRender();
      });
  });
});

export function whenAppSettingsReady(): Promise<void> {
  return appSettingsReady;
}

export interface MediaLibrarySettings {
  /** 작업 결과를 모아 두는 폴더. 비어 있으면 아직 안 고른 것입니다. */
  baseDirectory: string;
}

export function getMediaLibrarySettings(): MediaLibrarySettings {
  if (typeof window === "undefined") return { baseDirectory: "" };
  let settings: MediaLibrarySettings = { baseDirectory: "" };
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (saved) settings = { baseDirectory: "", ...JSON.parse(saved) };
  } catch {
    settings = { baseDirectory: "" };
  }
  /*
    거울을 아직 못 읽었는데 «폴더 없음» 을 내준 것은 **모른다고 답한 것**입니다.
    다 읽은 뒤에 폴더가 나오면 그때 화면을 한 번 새로 그립니다(`recoverFromEmptyRender`).
  */
  if (!settingsHydrated && !settings.baseDirectory.trim() && isDesktopApp())
    readEmptyBeforeHydration = true;
  return settings;
}

export function saveMediaLibrarySettings(settings: MediaLibrarySettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  // 설치본·개발 서버가 저장소를 따로 쓰므로 파일에도 같이 둡니다.
  queueMirrorWrite(MEDIA_LIBRARY_SECTION, settings);
  void allowStorageDirectory();
}

/** 거울 안에서 저장 폴더 설정이 앉는 칸 이름. */
const MEDIA_LIBRARY_SECTION = "mediaLibrary";

registerMirrorSection<MediaLibrarySettings>(MEDIA_LIBRARY_SECTION, {
  read: () => {
    if (typeof window === "undefined") return null;
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (!saved) return null;
    // 옛 저장본에 칸이 빠져 있을 수 있어 기본값을 깔고 덮습니다.
    const parsed: MediaLibrarySettings = {
      baseDirectory: "",
      ...(JSON.parse(saved) as Partial<MediaLibrarySettings>),
    };
    // 폴더를 안 고른 것은 «값이 없는 것» 과 같습니다 — 빈 값이 파일의 진짜 폴더를 이기면 안 됩니다.
    return parsed.baseDirectory.trim() ? parsed : null;
  },
  write: (value) => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  },
});

/**
 * 저장 폴더를 asset 프로토콜에 열어 줍니다.
 *
 * 이걸 안 부르면 `assetSrc()` 가 만든 주소를 웹뷰가 못 읽어서 썸네일이 전부
 * 깨진 그림이 되고, 그 주소를 fetch 하는 이미지 분석도 «Failed to fetch» 로
 * 죽습니다. 허용은 **앱을 껐다 켜면 사라지므로** 켤 때마다 한 번 불러야 합니다.
 */
export async function allowStorageDirectory(): Promise<void> {
  if (!isDesktopApp()) return;
  /*
    거울을 먼저 기다립니다. 설치하고 처음 열면 `localStorage` 가 비어 있어서, 안 기다리면
    폴더를 «없다» 고 보고 그냥 돌아갑니다 — 그 뒤 거울로 폴더가 채워져도 허용은 안 걸려
    있어서 썸네일이 전부 깨진 그림으로 뜹니다.
  */
  await appSettingsReady;
  const directory = getMediaLibrarySettings().baseDirectory.trim();
  if (!directory) return;
  await invoke("allow_storage_directory", { directory }).catch(() => null);
}

/**
 * 저장 폴더를 사람이 고릅니다. 취소하면 null 입니다.
 *
 * `startAt` 을 주면 대화상자가 거기서 열립니다. 지금 잡혀 있는 자리를
 * 넘겨 주세요 — 매번 드라이브 뿌리에서 찾아 들어가는 것이 제일 성가십니다.
 */
export async function chooseStorageDirectory(startAt?: string): Promise<string | null> {
  if (!isDesktopApp()) return null;
  return invoke<string | null>("choose_storage_directory", { directory: startAt?.trim() || null });
}

/**
 * 무엇의 어떤 파일인지.
 *
 * 이게 폴더 이름이 되어서, 나중에 탐색기로 들어가도 뭐가 뭔지 보입니다.
 * 잘라낸 칸과 생성 결과를 굳이 나눠 두는 이유는, 한 폴더에 섞이면
 * 어느 것이 시트 원본인지 알 수 없게 되기 때문입니다.
 */
export type ProjectAssetType =
  | "character-reference"
  | "character-generated"
  | "background-reference"
  | "background-generated"
  | "asset-reference"
  | "asset-generated"
  | "scene-cut"
  | "scene-video"
  // 작품 대표 그림 — `<프로젝트>/cover/…`. 주인이 없어 `ownerName` 은 빈 값입니다.
  | "project-cover"
  // 구도잡기 산출물. 컷 밑이 아니라 따로 모읍니다 — 컷을 지워도 남아야 하고,
  // 다른 컷에서 다시 쓰는 일이 잦습니다.
  | "composition-video"
  | "composition-glb"
  // 모션 캡처에 올린 영상과 분석 결과 — `<프로젝트>/mocap/<영상 이름>/…` .
  | "mocap-video"
  | "mocap-result"
  // BGM 은 영상 프로젝트와 따로 삽니다 — `<저장 폴더>/BGM/곡·업로드/…` (`lib/bgmLibrary.ts`).
  | "bgm-track"
  | "bgm-upload"
  // 시나리오·기획안 **원본 파일** — `<프로젝트>/DOCU/…` .
  // 주인(인물·장소)이 없는 갈래라 `ownerName` 을 빈 값으로 넘깁니다.
  | "document";

/** 여섯 면이 들어가는 주인 폴더 안의 하위 폴더 이름. 정의는 `faceSets.ts` 에 있고 여기서는 같이 내보냅니다. */
export { SIX_FACES_DIR, PANORAMA_DIR };

export interface SaveAssetOptions {
  projectName: string;
  assetType: ProjectAssetType;
  /** 캐릭터·배경 이름. 폴더 이름이 됩니다. */
  ownerName: string;
  /** 파일 이름 앞부분. 비우면 ownerName 을 씁니다. */
  stem?: string;
  /**
   * 주인 폴더 안의 하위 폴더. 6면(`SIX_FACES_DIR`)과 파노라마(`PANORAMA_DIR`)만 — Rust 가 허용 목록으로 막습니다.
   * 파노라마에서 자른 여섯 면을 `<장소>/6면/` 에 모아 낱장 여덟 장이 되지 않게 하고,
   * 돔에 두르는 파노라마 원본은 `<장소>/파노라마/` 에 따로 둡니다.
   */
  subdir?: typeof SIX_FACES_DIR | typeof PANORAMA_DIR;
  /**
   * 번호 `_NNN` 을 미리 정해서 줄 때. 6면 세트가 씁니다 — 여섯 파일은 이름(`<접두>_<면>`)이 달라
   * Rust 가 면마다 따로 «빈 첫 번호» 를 붙이면 세트가 둘로 갈립니다(`nextFaceSetNumber` 참고).
   * 그 번호의 파일이 이미 있으면 Rust 가 덮어쓰지 않고 오류를 냅니다.
   */
  number?: number;
}

/**
 * 파일 하나를 프로젝트 폴더에 넣습니다.
 *
 * 저장된 자리를 돌려줍니다. 저장 폴더를 아직 안 골랐거나 웹으로 열었으면
 * null 입니다 — 그때는 화면에만 들고 있게 됩니다.
 *
 * 이름이 겹치면 덮어쓰지 않고 뒤에 번호를 올려 붙입니다. 같은 이름이 여러 장
 * 나오는 게 이 앱에서는 정상이라서요 (시트를 다시 뽑을 때마다 생깁니다).
 */
export async function saveProjectMediaAsset(
  file: File,
  options: SaveAssetOptions,
): Promise<{ path: string; name: string } | null> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !options.projectName.trim()) return null;

  const request = {
      baseDirectory,
      projectName: options.projectName,
      assetType: options.assetType,
      ownerName: options.ownerName,
      fileName: file.name,
      stem: options.stem?.trim() || null,
      subdir: options.subdir || null,
      number: options.number ?? null,
  };
  const path = file.size > ASSET_UPLOAD_CHUNK_BYTES
    ? await uploadProjectAsset(file, request)
    : await invoke<string>("save_project_asset", {
        request: { ...request, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) },
      });
  // 저장된 이름을 함께 돌려줍니다.
  //
  // **폴더에 놓인 이름과 화면에 뜨는 이름이 같아야 합니다.** 파일 이름이 곧
  // Magnific 의 @태그라서, 화면에는 `raon_A_cute_Korean_woman_...` 이 보이는데
  // 폴더에는 `냥이_001` 이 놓이면 태그를 걸 수가 없습니다.
  return path ? { path, name: fileStem(path) } : null;
}

/**
 * **디스크에 있는 파일**을 프로젝트 폴더로 복사해 담습니다.
 *
 * 브라우저에서 고른 파일은 바이트가 앱을 지나가지만(`saveProjectMediaAsset`), 데스크톱
 * 파일 고르개는 **경로만** 줍니다. 그때는 Rust 가 바로 복사합니다 — 영상은 수백 MB 라
 * 배열로 만들어 넘기면 메모리를 두 배로 먹습니다().
 */
export async function importProjectMediaAsset(
  sourcePath: string,
  options: Omit<SaveAssetOptions, "subdir" | "number">,
): Promise<{ path: string; name: string } | null> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !options.projectName.trim()) return null;
  const path = await invoke<string>("import_project_asset", {
    request: {
      baseDirectory,
      projectName: options.projectName,
      assetType: options.assetType,
      ownerName: options.ownerName,
      stem: options.stem?.trim() || null,
      sourcePath,
    },
  });
  return path ? { path, name: fileStem(path) } : null;
}

/**
 * 이 파일이 **영상인가** — 확장자 하나로 정합니다.
 *
 * 폴더 읽기(`list_reference_files`)는 그림과 영상을 **함께** 돌려줍니다(Rust 의 `DELETABLE`).
 * 나누는 규칙을 부르는 쪽마다 적으면 한 곳만 `.mov` 를 빠뜨려, 그 화면에서만 영상이 깨진 그림으로
 * 뜹니다 — 이 저장소가 반복해 겪은 「여덟 곳은 맞고 한 곳만 틀리다」 라서 여기 한 벌만 둡니다.
 *
 * `asset://` 주소(`assetSrc`)에도 그대로 씁니다 — 경로는 통째로 인코딩되지만 꼬리의 `.mp4` 는 남습니다.
 */
export function isVideoFile(path?: string | null): boolean {
  return /\.(mp4|mov|webm|m4v|mkv|avi)(\?|#|$)/i.test(path || "");
}

/** `D:\...\냥이_001.png` → `냥이_001` */
export function fileStem(path: string): string {
  // 윈도우는 역슬래시, 나머지는 슬래시. 둘 다 자릅니다.
  const base = path.split(/[\\/]/).pop() || "";
  return base.replace(/\.[^.]+$/, "");
}

/**
 * Rust `safe_name` 과 같은 규칙. 이름이 폴더·파일 이름이 될 때 어떻게 바뀌는지
 * 화면에서도 알아야 «이 파일이 이 이름으로 저장된 것인가» 를 견줄 수 있습니다.
 *
 * 저장은 여전히 Rust 가 합니다. 이건 견주기용 거울이라, 규칙을 바꾸면 양쪽을 같이 고쳐야 합니다.
 */
export function safeFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "이름없음";
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+|\.+$/g, "");
  return cleaned || "이름없음";
}

/**
 * 파일 이름(확장자 없이)이 `<앞부분>_…` 으로 저장된 것인가. 레퍼런스의 `ref_` 는 빼고 봅니다.
 *
 * stemHasPrefix("냥이_겨울_001", "냥이_겨울") → true
 * stemHasPrefix("ref_냥이_겨울_001", "냥이_겨울") → true
 * stemHasPrefix("냥이_004", "냥이_겨울") → false (부모 것)
 */
export function stemHasPrefix(stem: string, prefix: string): boolean {
  const bare = stem.startsWith("ref_") ? stem.slice(4) : stem;
  const head = safeFileName(prefix);
  return bare.length > head.length + 1 && bare.startsWith(`${head}_`);
}

/**
 * `냥이_얼굴 정면_003` → `냥이_얼굴 정면`. 번호가 없으면 그대로.
 *
 * Rust `stem_base` 의 거울입니다 — **같은 규칙이라 바꾸면 양쪽을 같이 고쳐야 합니다.**
 * 편집 결과 이름을 지을 때 원본의 번호(`_003`)가 새 이름 가운데에 끼면
 * `냥이_클로즈업_003_지움_001` 처럼 번호가 둘이 되어 어느 것이 순번인지 알 수 없습니다.
 */
export function stemBase(stem: string): string {
  const at = stem.lastIndexOf("_");
  if (at < 0) return stem;
  const number = stem.slice(at + 1);
  return number && /^\d+$/.test(number) ? stem.slice(0, at) : stem;
}

/**
 * 편집 창이 그림에 한 일. 파일 이름 끝에 그대로 붙습니다.
 * «업스케일» 은 업스케일 엔진으로 키운 새 파일(`냥이_클로즈업_업스케일_001`) — 6면 세트의 낱장은
 * 이름을 지켜야 해서 이걸 안 쓰고 덮어씁니다(`upscale.upscaleFileInPlace`).
 */
export type EditAction =
  | "자름"
  | "지움"
  | "표시"
  | "동선"
  | "업스케일"
  // «여기는 움직인다» 흑백 마스크(`motionMask.ts`). 글자를 여기 또 적지 않는 까닭은 그 파일에.
  | typeof MOTION_MASK_ACTION;

/**
 * 편집 결과 파일 이름.
 *
 * 지움: 원본 `냥이_클로즈업_001` → `냥이_클로즈업_지움`
 * (변형 창: 접두 `냥이_겨울` + 원본 꼬리 `클로즈업` → `냥이_겨울_클로즈업_지움`)
 * 자름: 접두 + 칸 이름 → `냥이_얼굴 정면_자름` (변형 창: `냥이_겨울_얼굴 정면_자름`)
 * 표시: `냥이_클로즈업_표시` · 파노라마는 기존 규칙(`접두_면이름`) 그대로.
 *
 * 번호 `_NNN` 은 Rust 가 저장할 때 붙이고, 화면 이름 = 저장된 파일 이름 = @태그(fileStem) 는
 * 그대로입니다. `safeFileName` 도 Rust 가 저장할 때 거니 여기서는 안 겁니다.
 *
 * 원본 꼬리를 남기는 이유: 시트 한 장에서 잘라낸 칸이 여럿이라 `냥이_지움_001`·`_002` 로는
 * 어느 칸을 지운 것인지 폴더에서 알 수 없습니다. 원본이 시트 자체(`냥이_001`)면 꼬리가 비어
 * `냥이_지움` 이 됩니다.
 *
 * 변형 창의 이름 바꾸기(`stemHasPrefix`)와 Rust `renamed_prefix` 는 «접두_나머지» 규칙이라
 * 이 이름도 그대로 따라갑니다 — `냥이_겨울_클로즈업_지움_001` 은 변형 「겨울」 을 「밤」 으로
 * 바꾸면 `냥이_밤_클로즈업_지움_001` 이 됩니다.
 */
export function editedStem(input: {
  /** 파일 이름 앞부분 — 인물 이름 또는 «인물_변형» */
  prefix: string;
  /** 편집한 원본의 경로. 없으면(blob 만 있을 때) 꼬리를 생략합니다 */
  sourcePath?: string;
  ownerName: string;
  action: EditAction;
  /** 자름: 칸 이름(필수). 지움·표시: 동작 뒤에 붙일 말(선택) → `냥이_클로즈업_지움_손` */
  detail?: string;
}): string {
  const prefix = input.prefix.trim() || input.ownerName.trim() || "이미지";
  const detail = input.detail?.trim() || "";
  if (input.action === "자름") {
    return [prefix, detail, "자름"].filter(Boolean).join("_");
  }
  // 표시한 그림(`…_표시_001`)을 다시 열어 또 표시하면 꼬리에 «표시» 가 이미 있어 `…_표시_표시` 가
  // 됩니다(검토 2026-09-08). 같은 동작이 꼬리 끝에 있으면 한 번만 남깁니다.
  const tail = sourceTail(input.sourcePath, [prefix, input.ownerName]).replace(new RegExp(`(^|_)${input.action}$`), "");
  return [prefix, tail, input.action, detail].filter(Boolean).join("_");
}

/**
 * 원본 파일 이름에서 «인물(또는 접두) 다음 부분» 만 남깁니다.
 *
 * 냥이_클로즈업_001 (접두 냥이_겨울, 인물 냥이) → 클로즈업
 * ref_냥이_얼굴 정면_002 → 얼굴 정면
 * 냥이_001 → (빈 문자열 — 시트 자체)
 *
 * 접두는 긴 것부터 떼야 `냥이_겨울_클로즈업` 에서 `냥이_` 만 떼고 `겨울_클로즈업` 이 남는
 * 일이 없습니다. 폴더의 이름은 Rust `safe_name` 을 거친 것이라 견줄 때도 같은 규칙을 겁니다.
 */
function sourceTail(sourcePath: string | undefined, prefixes: string[]): string {
  if (!sourcePath) return "";
  const base = stemBase(fileStem(sourcePath)).replace(/^ref_/, "");
  const heads = [...new Set(prefixes.map((prefix) => safeFileName(prefix)).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const head of heads) {
    if (base === head) return "";
    if (base.startsWith(`${head}_`)) return base.slice(head.length + 1);
  }
  return base;
}

/**
 * 저장된 파일을 화면에 띄울 수 있는 주소로 바꿉니다.
 *
 * Tauri 는 파일을 `asset://` 주소로 내보냅니다. 경로를 `<img src>` 에 그대로
 * 넣으면 보안 때문에 막힙니다.
 */
export function assetSrc(filePath?: string | null): string {
  if (!filePath) return "";
  try {
    return convertFileSrc(filePath);
  } catch {
    return "";
  }
}

/**
 * 프로젝트 폴더 안의 그림 파일을 지웁니다.
 *
 * 화면에서 뺐는데 폴더에 남아 있으면 다음에 폴더를 읽을 때 되살아납니다.
 * 그래서 화면 삭제와 파일 삭제가 늘 같이 갑니다. (확인 창은 부르는 쪽 몫)
 * 폴더가 없거나 웹으로 열었으면 조용히 넘어갑니다 — 화면에서만 빠집니다.
 */
export async function deleteProjectMediaFile(
  projectName: string,
  filePath?: string | null,
): Promise<boolean> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !projectName.trim() || !filePath) return false;
  try {
    await invoke("delete_project_media_file", {
      baseDirectory,
      projectName,
      path: filePath,
    });
    return true;
  } catch {
    return false;
  }
}

/** 생성 실패·취소 때 남은 자리만 해제합니다. 실제 결과는 네이티브의 크기 검사로 보호합니다. */
export async function releaseEmptyProjectAsset(projectName: string, filePath: string): Promise<boolean> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !projectName.trim() || !filePath) return false;
  return invoke<boolean>("release_empty_project_asset", { baseDirectory, projectName, path: filePath });
}

/**
 * 휴지통에 둔 파일을 **원래 자리로** 되돌립니다. 되돌린 경로, 없으면 `null`.
 *
 * 지운 것은 곧바로 없어지지 않고 프로젝트 폴더 안 `.휴지통/` 에 한 단계 머뭅니다
 * (`src-tauri/src/trash.rs`). 그런데 그것을 **부르는 화면이 없어서**, 되돌릴 수 있는데도
 * 되돌릴 길이 없었습니다(2026-09-23 검토).
 *
 * 되살리기 창을 따로 두지 않는 까닭: 사람이 「아차」 하는 순간은 **지운 바로 그때**입니다.
 * 그때 말풍선에 단추 하나를 띄우는 편이, 어딘가 있는 창을 찾아가게 하는 것보다 낫습니다.
 * (며칠 지난 것을 뒤지는 일은 탐색기에서 `.휴지통/` 을 열면 됩니다.)
 */
export async function restoreProjectMediaFile(
  projectName: string,
  filePath?: string | null,
): Promise<string | null> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !projectName.trim() || !filePath) return null;
  try {
    return (
      (await invoke<string | null>("restore_project_media_file", {
        baseDirectory,
        projectName,
        path: filePath,
      })) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * 갈래 이름에서 **윗 폴더**를 뽑습니다.
 *
 * character-reference · character-generated → character
 *
 * 새 구조에서는 인물이 위, 갈래가 아래입니다. 그래서 이름을 바꾸거나 지울
 * 때는 갈래가 아니라 이 윗 폴더 하나만 다루면 됩니다.
 */
export function ownerTopFolder(assetType: ProjectAssetType): string {
  if (assetType.startsWith("character")) return "character";
  if (assetType.startsWith("background")) return "background";
  // 공용 에셋은 캐릭터 폴더 안 「공용에셋」 입니다. (지시 256)
  if (assetType.startsWith("asset")) return "character/공용에셋";
  if (assetType.startsWith("scene")) return "storyboard";
  if (assetType.startsWith("composition")) return "composition";
  if (assetType === "project-cover") return "cover";
  return "etc";
}

/** 이름을 못 바꾼 파일 하나. 파일은 그 자리에 그대로 있습니다. */
export interface RenameFailure {
  path: string;
  reason: string;
}

/**
 * 이름 바꾸기 결과. 성공한 것과 실패한 것을 **둘 다** 받습니다.
 *
 * 예전에는 하나가 막히면 통째로 실패로 읽어 빈 표를 돌려줬습니다. 폴더는 이미
 * 옮겨졌는데 화면은 옛 경로를 든 채라 썸네일이 전부 깨졌습니다. 옮긴 것은 옮긴
 * 대로 화면에 반영하고, 못 옮긴 것은 알려 주고 다음 저장 때 다시 시도합니다.
 */
export interface RenameOutcome {
  /** «옛 전체 경로 → 새 전체 경로» */
  moved: Map<string, string>;
  failed: RenameFailure[];
}

function toRenameOutcome(raw: { moved: [string, string][]; failed: [string, string][] }): RenameOutcome {
  const moved = new Map<string, string>();
  for (const [from, to] of raw.moved || []) moved.set(from, to);
  return { moved, failed: (raw.failed || []).map(([path, reason]) => ({ path, reason })) };
}

/**
 * 이름을 바꿨을 때 폴더를 통째로 옮기고 파일 이름도 함께 바꿉니다.
 *
 * 폴더가 원본이라, 화면 이름만 바꾸고 폴더를 두면 다음에 폴더를 읽을 때
 * 그 인물의 레퍼런스를 못 찾습니다.
 *
 * 갈래별로 두 번 부르지 않습니다. 레퍼런스가 인물 폴더 **아래**에 있어서
 * 인물 폴더 하나만 옮기면 레퍼런스도 따라옵니다.
 *
 * 파일 이름은 «옛 이름 + 밑줄» 로 시작하는 것이 전부 따라갑니다 —
 * `냥이_001`·`ref_냥이_001`·`냥이_얼굴 정면_001`·`냥이_겨울_001` 모두. 파일 이름이
 * 곧 마그니픽 @태그라, 하나라도 남으면 태그가 옛 인물을 부릅니다.
 */
export async function renameOwnerFolder(options: {
  projectName: string;
  assetType: ProjectAssetType;
  oldName: string;
  newName: string;
}): Promise<RenameOutcome> {
  const empty: RenameOutcome = { moved: new Map(), failed: [] };
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  const { projectName, assetType, oldName, newName } = options;
  if (!isDesktopApp() || !baseDirectory) return empty;
  if (!projectName.trim() || !oldName.trim() || !newName.trim()) return empty;
  if (oldName === newName) return empty;

  try {
    const raw = await invoke<{ moved: [string, string][]; failed: [string, string][] }>("rename_owner_tree", {
      baseDirectory,
      projectName,
      top: ownerTopFolder(assetType),
      oldName,
      newName,
    });
    return toRenameOutcome(raw);
  } catch (error) {
    // 폴더 자체를 못 옮긴 것. 화면은 계속 써야 하니 실패로 돌려주고 다음 저장 때 다시 시도합니다.
    return { moved: new Map(), failed: [{ path: oldName, reason: String(error) }] };
  }
}

/**
 * 인물 폴더 안에서 `<옛 앞부분>_…` 파일들을 `<새 앞부분>_…` 으로 바꿉니다. 폴더는 그대로.
 *
 * - 변형 이름을 바꿀 때: `냥이_겨울_001` → `냥이_밤_001`
 * - 인물 이름을 바꾸다 막혀 못 바꾼 파일을 다음 저장 때 다시 시도할 때: `냥이_…` → `서리_…`
 *
 * 부모 것(`냥이_004`)은 `냥이_겨울_` 로 시작하지 않으니 변형 이름을 바꿔도 건드려지지 않습니다.
 */
export async function renameStemFiles(options: {
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
  oldStem: string;
  newStem: string;
}): Promise<RenameOutcome> {
  const empty: RenameOutcome = { moved: new Map(), failed: [] };
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  const { projectName, assetType, ownerName, oldStem, newStem } = options;
  if (!isDesktopApp() || !baseDirectory) return empty;
  if (!projectName.trim() || !ownerName.trim() || !oldStem.trim() || !newStem.trim()) return empty;
  if (oldStem.trim() === newStem.trim()) return empty;

  try {
    const raw = await invoke<{ moved: [string, string][]; failed: [string, string][] }>("rename_stem_files", {
      baseDirectory,
      projectName,
      top: ownerTopFolder(assetType),
      ownerName,
      oldStem,
      newStem,
    });
    return toRenameOutcome(raw);
  } catch (error) {
    return { moved: new Map(), failed: [{ path: oldStem, reason: String(error) }] };
  }
}

/**
 * 인물·장소·에셋의 **폴더를 통째로 지웁니다.**
 *
 * 화면에서 지우면 폴더의 원본도 지웁니다 (CLAUDE.md 규칙 3). 그러지 않으면
 * 다음에 폴더를 읽을 때 되살아나고, 탐색기에는 쓰지 않는 폴더가 쌓입니다.
 *
 * 사용자가 두 번 말한 것입니다 — 「캐릭터 삭제 했는데 데이터는 그냥 남아 있네?」
 */
export async function deleteOwnerFolder(options: {
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
}): Promise<boolean> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  const { projectName, assetType, ownerName } = options;
  if (!isDesktopApp() || !baseDirectory) return false;
  if (!projectName.trim() || !ownerName.trim()) return false;
  try {
    const removed = await invoke<string | null>("delete_asset_owner", {
      baseDirectory,
      projectName,
      top: ownerTopFolder(assetType),
      ownerName,
    });
    return Boolean(removed);
  } catch {
    return false;
  }
}

/**
 * 옛 폴더 구조를 새 구조로 한 번 옮깁니다.
 *
 * 갈래가 위, 인물이 아래였던 것을 **인물이 위, 갈래가 아래**로 뒤집습니다.
 * 이미 옮긴 프로젝트에서는 아무 일도 하지 않습니다.
 */
export async function migrateProjectLayout(
  projectName: string,
): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !projectName.trim()) return moved;
  try {
    const pairs = await invoke<[string, string][]>("migrate_project_layout", {
      baseDirectory,
      projectName,
    });
    for (const [from, to] of pairs) moved.set(from, to);
  } catch {
    // 못 옮겨도 앱은 떠야 합니다. 다음에 켤 때 다시 시도합니다.
  }
  return moved;
}

/**
 * 폴더에 실제로 있는 그림을 읽어 옵니다.
 *
 * **폴더가 원본입니다.** 앱이 들고 있는 목록만 보면, 탐색기에서 직접 넣은
 * 파일과 시트에서 잘라낸 칸을 놓칩니다. 사용자가 요청한 «양방향» 이 이것입니다 —
 * 화면에서 넣은 것은 폴더로 가고, 폴더에 있는 것은 화면으로 옵니다.
 */
export async function listOwnerFiles(options: {
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
  /**
   * 주인 폴더 안의 하위 폴더(지금은 6면). 주면 갈래 층(`ref/`)을 무시하고 `<주인>/<subdir>/` 한 층을 읽습니다.
   * 뿌리를 읽을 때 딸려 오지 않으니 6면을 폴더에서 되살리려면 따로 불러야 합니다.
   */
  subdir?: typeof SIX_FACES_DIR;
}): Promise<{ id: string; name: string; filePath: string }[]> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory) return [];
  if (!options.projectName.trim() || !options.ownerName.trim()) return [];
  try {
    return await invoke<{ id: string; name: string; filePath: string }[]>(
      "list_reference_files",
      {
        baseDirectory,
        projectName: options.projectName,
        category: options.assetType,
        ownerName: options.ownerName,
        subdir: options.subdir || null,
      },
    );
  } catch {
    return [];
  }
}

/**
 * 컷 하나가 들고 있는 그림·영상을 폴더에서 지웁니다.
 *
 * 화면에서 지우면 폴더의 원본도 지웁니다 (CLAUDE.md 규칙 3). 예전에는 씬·컷을
 * 지워도 파일이 남아 폴더에 주인 없는 그림·영상이 계속 쌓였습니다. (지시 307)
 */
export async function deleteCutFiles(
  projectName: string,
  cut: { images?: { filePath?: string }[]; videos?: { filePath?: string }[] },
): Promise<void> {
  const paths = [
    ...(cut.images || []).map((item) => item.filePath),
    ...(cut.videos || []).map((item) => item.filePath),
  ].filter((path): path is string => Boolean(path));
  await Promise.all(paths.map((path) => deleteProjectMediaFile(projectName, path)));
}

/**
 * 장면이 들고 있는 파일 — 스토리보드 시트와 씬 영상.
 *
 * 컷 파일은 `deleteCutFiles` 가 따로 지웁니다. 장면을 지울 때 이것까지 안 지우면
 * 폴더를 다시 읽을 때 되살아납니다(규칙 3).
 */
export async function deleteSceneFiles(
  projectName: string,
  scene: { storyboardPath?: string; videos?: { filePath?: string }[] },
): Promise<void> {
  const paths = [
    scene.storyboardPath,
    ...(scene.videos || []).map((item) => item.filePath),
  ].filter((path): path is string => Boolean(path));
  await Promise.all(paths.map((path) => deleteProjectMediaFile(projectName, path)));
}

/**
 * 어떤 항목(원본·변형)이 들고 있는 파일 경로 전부.
 *
 * 변형을 지울 때 «다른 것이 아직 쓰는 파일» 을 남기기 위해 씁니다. 자식 변형의
 * 정체성 기준은 부모 파일을 그대로 가리키니, 부모·형제가 쓰는 경로는 지우면 안 됩니다.
 */
export function collectFilePaths(
  entity: {
    references?: { filePath?: string }[];
    generatedImages?: { filePath?: string }[];
    variations?: { id: string; references?: { filePath?: string }[]; generatedImages?: { filePath?: string }[] }[];
  },
  exceptVariationId?: string,
): Set<string> {
  const out = new Set<string>();
  const take = (item?: { references?: { filePath?: string }[]; generatedImages?: { filePath?: string }[] }) => {
    for (const image of [...(item?.references || []), ...(item?.generatedImages || [])]) {
      if (image.filePath) out.add(image.filePath);
    }
  };
  take(entity);
  for (const variation of entity.variations || []) {
    if (variation.id !== exceptVariationId) take(variation);
  }
  return out;
}

/**
 * 변형을 지울 때 그 변형만 쓰던 파일을 폴더에서도 지웁니다. (규칙 3)
 *
 * 예전에는 상태에서만 빼고 파일은 남겨, 시트를 여러 판 돌린 인물 폴더에 «어느
 * 변형 것이었는지 알 수 없는» 그림이 쌓였습니다. keep 에 든 경로(부모·형제가
 * 아직 쓰는 것)는 건드리지 않습니다.
 */
export async function deleteVariationFiles(
  projectName: string,
  variation: { references?: { filePath?: string }[]; generatedImages?: { filePath?: string }[] },
  keep: Set<string>,
): Promise<void> {
  const paths = [...(variation.references || []), ...(variation.generatedImages || [])]
    .map((item) => item.filePath)
    .filter((path): path is string => Boolean(path) && !keep.has(path as string));
  await Promise.all([...new Set(paths)].map((path) => deleteProjectMediaFile(projectName, path)));
}

// ── 마그니픽 데스크톱 ───────────────────────────────────────────────────────
//
// 마그니픽 데스크톱에는 딥링크·CLI 가 없어서 «클립보드 + 창 앞으로 + Ctrl+V» 로
// 보내고, 결과는 <인물 폴더>/magnific/ 받는 자리에서 가져옵니다. API·MCP 는
// «무제한» 이 적용되지 않아 쓰지 않습니다. (2026-09 조사)

/** 프롬프트를 마그니픽 창에 붙여넣습니다. 돌려주는 글은 그대로 알림으로 띄웁니다. */
export async function sendPromptToMagnific(text: string): Promise<string> {
  if (!isDesktopApp()) {
    await navigator.clipboard.writeText(text);
    return "복사했습니다. 마그니픽에서 Ctrl+V 하세요.";
  }
  return invoke<string>("send_prompt_to_magnific", { text });
}

/** 폴더에 저장된 그림 파일들을 마그니픽 캔버스에 이미지 노드로 붙여넣습니다. */
export async function sendImagesToMagnific(paths: string[]): Promise<string> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory) {
    throw new Error("데스크톱 앱에서 저장 폴더를 정한 뒤에 쓸 수 있습니다.");
  }
  const real = paths.filter((path) => path && path.trim());
  if (!real.length) throw new Error("폴더에 저장된 그림만 보낼 수 있습니다.");
  const result = await invoke<{ message: string; fingerprints: string[] }>("send_images_to_magnific", {
    baseDirectory,
    paths: real,
  });
  // 마그니픽이 이 그림을 생성물로 올려 동기화로 되돌려 보냅니다. 후보함에서 알아보게 지문을 남깁니다.
  rememberMagnificSentFiles(result.fingerprints);
  return result.message;
}

/**
 * «구성» — 그림 올리기 → 업로드 id 읽기 → 원본 정리 → 그림 사본 + 이미지 생성기(프롬프트·칩) 붙여넣기.
 * 마그니픽 데스크톱을 CDP 로 조종하므로 마그니픽이 우리 앱에서 켜져 있어야 합니다(Rust 가 안내 문구를 돌려줌).
 */
export async function composeMagnificAuto(input: {
  paths: string[];
  prompt: string;
  model: string;
  aspectRatio: string;
  count: number;
  /** 그림 생성기인가 영상 생성기인가. 안 넘기면 그림입니다. */
  kind?: "image" | "video";
  /** 영상일 때 러닝타임(초) — 구도잡기 타임라인이 정한 값. */
  durationSeconds?: number;
  /** Magnific 영상 구성 전용. 로컬 생성과 이미지 구성의 해상도는 바꾸지 않습니다. */
  resolution?: "720p" | "1080p";
  /** 앞 구성이 끝나기를 기다리게 됐을 때 */
  onQueued?: () => void;
}): Promise<string> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory) {
    throw new Error("데스크톱 앱에서 저장 폴더를 정한 뒤에 쓸 수 있습니다.");
  }
  // 앞 구성이 돌고 있으면 Rust 가 줄을 세웁니다. 기다리는 동안 «멈춘 것» 으로 보이지 않게 알립니다.
  if (await invoke<boolean>("magnific_compose_busy")) {
    input.onQueued?.();
  }
  const result = await invoke<{ message: string; fingerprints: string[] }>("magnific_compose_auto", {
    baseDirectory,
    paths: input.paths,
    prompt: input.prompt,
    model: input.model,
    kind: input.kind ?? "image",
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    count: input.count,
  });
  // 마그니픽이 이 그림을 생성물로 올려 동기화로 되돌려 보냅니다. 후보함에서 알아보게 지문을 남깁니다.
  rememberMagnificSentFiles(result.fingerprints);
  return result.message;
}

export interface MagnificImportedFile {
  filePath: string;
  name: string;
  sourceName: string;
}

export interface ProjectInboxFile {
  filePath: string;
  /** 크기+내용 지문. 우리가 보낸 그림이 되돌아온 것인지 알아보는 데 씁니다. */
  fingerprint: string;
  /** 후보함 기준 상대 경로 — 처리 기록의 키 */
  relativePath: string;
  name: string;
  kind: "image" | "video";
  modifiedMs: number;
}

/**
 * 프로젝트 후보함 `<프로젝트>/magnific/` 에 있는 그림·영상 목록.
 *
 * 마그니픽 동기화 폴더 하나를 여기에 겁니다. A·B·C컷이 섞여 오므로 자동으로 옮기지
 * 않고, 사람이 «채택» 한 것만 주인 폴더로 **복사**됩니다. 동기화는 지운 파일을 다시
 * 내려받으므로 후보함의 파일은 옮기지도 지우지도 않습니다.
 */
export async function listProjectInbox(options: { projectName: string }): Promise<ProjectInboxFile[]> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !options.projectName.trim()) return [];
  try {
    return await invoke<ProjectInboxFile[]>("list_project_inbox", {
      baseDirectory,
      projectName: options.projectName,
    });
  } catch {
    return [];
  }
}

/** «채택» — 후보함의 파일 하나를 정한 주인 폴더로 복사하고 우리 이름을 붙입니다. */
export async function claimProjectInboxFile(options: {
  projectName: string;
  filePath: string;
  assetType: ProjectAssetType;
  ownerName: string;
  /** 파일 이름 앞부분. 변형에 채택하면 «인물_변형». 비우면 인물 이름. */
  stem?: string;
}): Promise<MagnificImportedFile | null> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory) return null;
  try {
    return await invoke<MagnificImportedFile>("claim_project_inbox_file", {
      baseDirectory,
      projectName: options.projectName,
      filePath: options.filePath,
      category: options.assetType,
      ownerName: options.ownerName,
      stem: options.stem?.trim() || null,
    });
  } catch (error) {
    toast.error(String(error));
    return null;
  }
}

/** 후보함 폴더만 만듭니다. 프로젝트를 저장할 때마다 불러 새 프로젝트에도 처음부터 있게 합니다. */
export async function ensureProjectInbox(options: { projectName: string }): Promise<void> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory || !options.projectName.trim()) return;
  try {
    await invoke("ensure_project_inbox", { baseDirectory, projectName: options.projectName });
  } catch {
    /* 폴더 하나 못 만든 것으로 저장을 막지 않습니다. 후보함 열기에서 다시 만듭니다. */
  }
}

/** 후보함을 만들고 탐색기로 엽니다. */
export async function openProjectInbox(options: { projectName: string }): Promise<string | null> {
  const baseDirectory = getMediaLibrarySettings().baseDirectory.trim();
  if (!isDesktopApp() || !baseDirectory) {
    toast.error("데스크톱 앱에서 저장 폴더를 정한 뒤에 쓸 수 있습니다.");
    return null;
  }
  if (!options.projectName.trim()) {
    toast.error("프로젝트 제목을 먼저 정하세요. 폴더 이름이 됩니다.");
    return null;
  }
  try {
    return await invoke<string>("open_project_inbox", { baseDirectory, projectName: options.projectName });
  } catch (error) {
    toast.error(String(error));
    return null;
  }
}

/** 경로에서 파일 이름만 떼어 냅니다. */
export function fileNameOf(path?: string | null): string {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

/** 탐색기를 열어 그 파일을 선택된 상태로 보여 줍니다. */
export async function revealFile(path?: string | null) {
  if (!path || !isDesktopApp()) return;
  try {
    await invoke("reveal_in_file_manager", { path });
  } catch (error) {
    toast.error(String(error));
  }
}

/**
 * 그림을 클립보드에 넣고 알려 줍니다. LLM 창에 바로 붙여넣으라고요.
 *
 * 파일이 폴더에 있으면 Rust 쪽에 맡깁니다. 브라우저 클립보드 API 는 형식이
 * 까다롭고 권한도 물어서, 되는 쪽을 먼저 씁니다.
 */
export async function copyImageWithNotice(image: {
  name?: string;
  label?: string;
  thumb?: string;
  filePath?: string;
}) {
  const name = image.name || image.label || "이미지";
  try {
    if (image.filePath && isDesktopApp()) {
      await invoke("copy_image_to_clipboard", { path: image.filePath });
      toast.success(`${name} 를 복사했습니다. LLM 창에 붙여넣으세요.`);
      return;
    }
    const source = image.thumb;
    if (!source) {
      toast.error("복사할 이미지가 없습니다.");
      return;
    }
    const blob = await (await fetch(source)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    toast.success(`${name} 를 복사했습니다.`);
  } catch {
    toast.error("복사하지 못했습니다.");
  }
}

/**
 * 캔버스에 그릴 수 있는 그림으로 읽어 옵니다.
 *
 * `asset://` 주소를 `<img>` 에 그대로 물려 캔버스에 그리면 **캔버스가
 * 오염되어 다시 내보낼 수 없습니다.** 잘라내기·지우기·표시하기가 전부
 * 캔버스로 내보내는 기능이라, 반드시 이 함수를 거쳐야 합니다.
 *
 * 한 번 데이터로 받아 온 뒤 그것을 그림으로 만들면 오염되지 않습니다.
 */
export async function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("이미지를 읽지 못했습니다.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      image.src = objectUrl;
    });
  } finally {
    // 그림이 다 만들어진 뒤에 놓아 줍니다. 먼저 놓으면 브라우저가 못 읽습니다.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}
