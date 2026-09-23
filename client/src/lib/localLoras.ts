import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isDesktopApp } from "@/lib/llm";
import {
  LOCAL_ENGINE_IDS,
  loadLoras,
  saveLoras,
  type LocalEngineId,
  type LocalLora,
  type LoraEntry,
  type LoraStyle,
} from "@/lib/localEngines";

/**
 * **받아 둔 로라** — 폴더가 진실입니다.
 *
 *
 *
 * # 왜 목록이 아니라 폴더를 믿는가
 *
 * 여태는 사용자가 어딘가에 받아 둔 파일의 **경로만** 기억했습니다. 그러면 파일을 옮기거나
 * 지웠을 때 목록은 그대로 남아, 고르는 순간에야 「없는 파일」 이 됩니다. 이제 엔진 폴더를
 * 읽어 **있는 것만** 내놓습니다(`lora_files`).
 *
 * 세기·갈래·이름 같은 **사람이 정한 값**은 여전히 우리가 기억합니다(`LoraEntry`). 둘을
 * 파일 경로로 맞붙여 한 목록으로 만듭니다 — 파일이 사라지면 그 줄도 사라집니다.
 */

export interface LoraOnDisk {
  engine: LocalEngineId;
  fileName: string;
  path: string;
  sizeBytes: number;
}

/** 폴더에 있는 로라 + 사람이 붙여 둔 값. 화면이 보는 것은 이것입니다. */
export interface LoraItem extends LoraOnDisk {
  /** 화면에 보일 이름. 안 지었으면 파일 이름. */
  name: string;
  weight: number;
  style?: LoraStyle;
  /** 이 엔진에서 **기본으로** 켤 것인가. 뽑을 때마다 고르는 것은 따로입니다. */
  enabled: boolean;
  /** 받아 온 소개 쪽. 「바로가기」 가 이걸 엽니다. */
  source?: string;
  /** 만든 사람이 적어 둔 불러오는 말. 프롬프트에 넣어야 먹습니다. */
  trigger?: string;
}

let files: LoraOnDisk[] = [];
const listeners = new Set<() => void>();
let asked = false;

function publish(next: LoraOnDisk[]) {
  files = next;
  listeners.forEach((listener) => listener());
}

// 카탈로그의 키가 아니라 «이 빌드에 실린» 목록입니다 — 공개판에서 빠진 엔진의 로라 폴더는 묻지 않습니다.
const ENGINE_IDS = LOCAL_ENGINE_IDS;

/** UI와 조종기가 같은 실제 폴더 목록을 읽습니다. 명령 경로에서는 읽기 오류를 숨기지 않습니다. */
export async function readLoraFiles(): Promise<LoraOnDisk[]> {
  if (!isDesktopApp()) throw new Error("로컬 로라 목록은 데스크톱 앱에서 읽을 수 있습니다.");
  return invoke<LoraOnDisk[]>("lora_files", { engines: ENGINE_IDS });
}

/** 폴더를 다시 읽습니다. 받기·지우기 뒤에 부릅니다. */
export async function refreshLoraFiles(): Promise<LoraOnDisk[]> {
  if (!isDesktopApp()) return files;
  try {
    publish(await readLoraFiles());
  } catch {
    publish([]);
  }
  return files;
}

const EMPTY: LoraOnDisk[] = [];

/** 받아 둔 로라 목록. 처음 쓰는 순간 폴더를 한 번 읽습니다. */
export function useLoraFiles(): LoraOnDisk[] {
  if (!asked) {
    asked = true;
    queueMicrotask(() => void refreshLoraFiles());
  }
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => files,
    () => EMPTY,
  );
}

/** 폴더에 있는 것에 사람이 정한 값을 얹습니다. 경로가 열쇠입니다. */
export function loraItems(onDisk: LoraOnDisk[], engine?: LocalEngineId): LoraItem[] {
  const saved = loadLoras();
  return onDisk
    .filter((file) => !engine || file.engine === engine)
    .map((file) => {
      const mine = saved.find((item) => item.path.trim() === file.path);
      return {
        ...file,
        name: mine?.name?.trim() || file.fileName.replace(/\.[^.]+$/, ""),
        weight: mine?.weight ?? 1,
        style: mine?.style,
        source: mine?.source,
        trigger: mine?.trigger,
        // 기본은 **꺼짐**입니다. 받아 뒀다고 전부 먹이면 화풍이 뒤섞입니다.
        enabled: mine?.enabled ?? false,
      };
    });
}

/**
 * 사람이 정한 값이 바뀌었다고 화면에 알립니다.
 *
 * 폴더 목록은 그대로지만 **새 배열**로 내보내야 `useSyncExternalStore` 가 바뀐 것으로 보고
 * 다시 그립니다. 2026-09-22 까지는 저장만 하고 알리지 않아 세기·기본·이름 칸이 «쳐도
 * 제자리» 였습니다 — React 는 통제값(value)이 그대로면 입력을 그 값으로 되돌립니다
 * .
 */
function announceSaved() {
  publish([...files]);
}

/** 사람이 정한 값을 적어 둡니다. 폴더에 있는 파일 하나에 한 줄입니다. */
export function patchLora(path: string, patch: Partial<Omit<LoraItem, "path">>) {
  // undefined 로 온 칸은 «건드리지 않음» 입니다 — 펼쳐 넣으면 있던 값을 지웁니다.
  const given = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as typeof patch;
  const saved = loadLoras();
  const found = saved.find((item) => item.path.trim() === path);
  if (found) {
    saveLoras(
      saved.map((item) =>
        item.path.trim() === path ? { ...item, ...given, path } : item,
      ),
    );
    announceSaved();
    return;
  }
  const engine = files.find((file) => file.path === path)?.engine;
  if (!engine) return;
  const made: LoraEntry = {
    id: Math.random().toString(36).slice(2),
    name: patch.name ?? "",
    path,
    weight: patch.weight ?? 1,
    engine,
    style: patch.style,
    enabled: patch.enabled ?? false,
    source: patch.source,
    trigger: patch.trigger,
  };
  saveLoras([...saved, made]);
  announceSaved();
}

// ── 받기·지우기 ─────────────────────────────────────────────────────────────

export interface LoraHit {
  id: string;
  name: string;
  baseModel: string;
  fileName: string;
  downloadUrl: string;
  /** 소개 쪽 주소 — 「이 로라가 뭐였더라」 를 물을 데. */
  pageUrl: string;
  sizeBytes: number;
  trigger: string;
  downloads: number;
  nsfw: boolean;
  /** 어디서 찾았는가 — "civitai" | "huggingface". 화면이 표시로 답니다. */
  source: "civitai" | "huggingface";
  /** 만든 사람이 소개 글에 권장 세기. 없으면 null — 그때는 1(원래 세기)로 받습니다. */
  advisedWeight?: number | null;
}

/** 세기의 범위 — 입력 칸의 min/max 와 자르기가 같은 숫자를 봅니다(두 벌로 적지 않게). */
export const LORA_WEIGHT_RANGE = { min: 0, max: 2 } as const;

/** 세기는 범위 안, 소수 둘째 자리까지 — 칸·권장값·저장이 전부 이 하나를 지납니다. */
export function clampLoraWeight(weight: number): number {
  const rounded = Math.round(weight * 100) / 100;
  return Math.min(LORA_WEIGHT_RANGE.max, Math.max(LORA_WEIGHT_RANGE.min, rounded));
}

/**
 * 엔진마다 Civitai 에서 «이 엔진 것» 을 거르는 그물 — **한 벌**입니다.
 *
 * `bases` 는 Civitai 의 밑모델 갈래 이름(정확히 그 글자라야 걸립니다 — 2026-09-22 실측:
 * 모르는 이름이면 0개). 갈래가 없는 엔진은 `keywords` 로 밑모델·이름에 든 낱말만 봅니다.
 *
 * 예전 표는 세 엔진만 있어서 나머지는 필터 없이 나갔습니다(Pony 로라가
 * 쏟아진 까닭). 이제 **엔진마다 반드시** 한 줄이 있습니다 — 새 엔진을 더하면 타입이 잡습니다.
 */
/*
  갈래 이름은 **짐작하지 않습니다.** 2026-09-22 에 「MiniMax」·「Hailuo」 로 찔러 0개가 나와
  «갈래가 없다» 고 적었다가, 사용자가 Civitai 에서 71개를 보여 줬습니다 — 진짜 이름은
  「MiniMax H3」(띄어쓰기) 였습니다. 그래서 아래 이름은 전부 **검색 결과의 판(version)이 실제로
  달고 있던 `baseModel` 값**에서 모은 것입니다(같은 날 실측 — ltx·z-image·krea·wan·qwen·anima).
  새 엔진을 더할 때도 같은 방법으로: 그 엔진 이름으로 검색해 판의 baseModel 을 세어 보세요.
*/
/**
 * `hf` 는 허깅페이스 쪽 그물 — `search` 는
 * 검색어에 앞세울 낱말(허깅페이스는 띄어쓴 낱말을 AND 로 봅니다), `terms` 는 저장소 이름·
 * 태그에 하나라도 들어 있어야 «이 엔진 것» 으로 치는 낱말들(이름 표기가 -·_·붙임으로 제각각).
 */
export interface LoraNet {
  bases: string[];
  keywords: string[];
  hf: { search: string; terms: string[] };
}

export const CIVITAI_FILTER: Partial<Record<LocalEngineId, LoraNet>> = {
  // 우리 엔진은 Wan 2.2 A14B — 2.1 판(「Wan Video 14B t2v」)은 대개 안 맞아 2.2 두 갈래만.
  wanvideo: {
    bases: ["Wan Video 2.2 I2V-A14B", "Wan Video 2.2 T2V-A14B"],
    keywords: [],
    hf: { search: "wan2.2", terms: ["wan2.2", "wan-2.2", "wan_2.2", "wan 2.2"] },
  },
  // 2.5 판은 아직 적어(5개) 2.3·LTXV2 도 같이 봅니다 — 판마다 밑모델이 적혀 나오니 사람이 가립니다.
  ltx25: {
    bases: ["LTXV 2.5", "LTXV 2.3", "LTXV2"],
    keywords: [],
    hf: { search: "ltx", terms: ["ltx-2", "ltx2", "ltxv", "ltx_2", "lightricks/ltx"] },
  },
  qwenimage: {
    bases: ["Qwen"],
    keywords: [],
    hf: { search: "qwen-image", terms: ["qwen-image", "qwen_image", "qwenimage", "qwen/qwen-image"] },
  },
  anima: { bases: ["Anima"], keywords: [], hf: { search: "anima", terms: ["anima"] } },
  minimaxh3: {
    bases: ["MiniMax H3"],
    keywords: [],
    hf: { search: "minimax h3", terms: ["minimax-h3", "minimax_h3", "minimaxh3", "minimaxai/minimax-h3", "comfy-org/minimax-h3"] },
  },
  // Turbo 가 우리 엔진. Base 판도 대개 얹히므로 같이 봅니다.
  zimage: {
    bases: ["ZImageTurbo", "ZImageBase"],
    keywords: [],
    hf: { search: "z-image", terms: ["z-image", "zimage", "z_image"] },
  },
  krea2: { bases: ["Krea 2"], keywords: [], hf: { search: "krea", terms: ["krea-2", "krea2", "krea 2", "krea/krea"] } },
};

/**
 * 엔진의 그물. 표에 없는 엔진(음악·자세 엔진은 로라를 안 씁니다)이 어쩌다 오면
 * 엔진 id 를 낱말로 삼아 **아무거나 쏟아지지는 않게** 합니다.
 */
export function civitaiFilterFor(engine: LocalEngineId): LoraNet {
  return CIVITAI_FILTER[engine] ?? { bases: [], keywords: [engine], hf: { search: engine, terms: [engine] } };
}

/** Civitai 에 갈래가 있어 제대로 걸러지는가. 없으면 화면이 «이름으로만 거른다» 고 말해 줘야 합니다. */
export function civitaiKnowsEngine(engine: LocalEngineId): boolean {
  return civitaiFilterFor(engine).bases.length > 0;
}

export function searchLoras(query: string, filter?: LoraNet, nsfw = false): Promise<LoraHit[]> {
  return invoke<LoraHit[]>("lora_search", {
    query,
    bases: filter?.bases ?? [],
    keywords: filter?.keywords ?? [],
    // 엔진 이름 검색어 — Civitai 의 두 번째 찾기와 허깅페이스 검색에 앞세웁니다.
    // 그물을 안 걸면(«이 엔진 것만» 끔) 허깅페이스는 안 봅니다 — 엔진 낱말 없이는 온갖 저장소가 쏟아집니다.
    engineHint: filter?.hf.search ?? null,
    hfTerms: filter?.hf.terms ?? [],
    nsfw,
  });
}

/**
 * 받고, **어디서 왔는지도 함께 적어 둡니다.**
 *
 *
 * 파일 이름만 남으면 불러오는 말도 예시 그림도 다시 찾을 길이 없습니다.
 */
export async function downloadLora(
  engine: LocalEngineId,
  url: string,
  fileName: string,
  about?: { source?: string; trigger?: string; name?: string; weight?: number },
) {
  const path = await invoke<string>("lora_download", { engine, url, fileName });
  await refreshLoraFiles();
  if (about) patchLora(path, about);
  return path;
}

/**
 * 로라 하나를 지웁니다 — 폴더의 파일과, 그 파일에 붙여 둔 세기·기본 같은 값까지.
 * 기억값을 남기면 같은 이름을 다시 받았을 때 예전 «기본 켬» 이 소리 없이 되살아납니다.
 */
export async function deleteLora(engine: LocalEngineId, fileName: string) {
  const path = files.find((file) => file.engine === engine && file.fileName === fileName)?.path;
  try {
    await invoke("lora_delete", { engine, fileName });
    if (path) saveLoras(loadLoras().filter((item) => item.path.trim() !== path));
  } finally {
    // 못 지웠어도(탐색기에서 먼저 지운 뒤라든가) 폴더를 다시 읽습니다 — 안 그러면 없는 줄이 남습니다.
    await refreshLoraFiles();
  }
}

export async function importLoras(engine: LocalEngineId): Promise<number> {
  const picked = await invoke<string[]>("lora_pick_files");
  for (const source of picked) await invoke("lora_import", { engine, source });
  await refreshLoraFiles();
  return picked.length;
}

export function openLoraFolder(engine: LocalEngineId): Promise<void> {
  return invoke("lora_open_folder", { engine });
}

export interface LoraProgress {
  engine: string;
  file: string;
  percent?: number | null;
  message: string;
  done: boolean;
  error?: string | null;
}

export function onLoraProgress(handler: (event: LoraProgress) => void): () => void {
  if (!isDesktopApp()) return () => {};
  const off = listen<LoraProgress>("lora-progress", (event) => handler(event.payload));
  return () => void off.then((stop) => stop());
}

// ── 뽑을 때 무엇을 먹일까 ───────────────────────────────────────────────────

/**
 * **고른 것**을 로라로 바꿉니다. 안 골랐으면 그 엔진의 «기본으로 켠» 것들.
 *
 *
 *
 * 그래서 **고르는 자리가 둘**입니다 — 설정의 «기본으로 켜 둠» 과, 뽑는 자리에서의 «이번엔
 * 이걸로». 뒤엣것이 있으면 그것만 씁니다. 없으면 기본을 씁니다.
 */
export function lorasToRun(
  engine: LocalEngineId,
  picked: string[] | undefined,
  onDisk: LoraOnDisk[] = files,
): LocalLora[] {
  const items = loraItems(onDisk, engine);
  const use = picked?.length
    ? items.filter((item) => picked.includes(item.path))
    : items.filter((item) => item.enabled);
  return use.map((item) => ({ path: item.path, weight: item.weight, trigger: item.trigger }));
}

/**
 * 고른 것들 사이에 **화풍이 둘 이상** 섞였는가.
 *
 * 사용자 2026-09-17(앞선 날): 「시네마틱 풍이랑 애니메이션 풍은 혼용될 수 없으니까」.
 * 막지는 않습니다 — 일부러 섞는 일도 있으니 **보이게만** 합니다. 조용히 두면 결과가
 * 이상할 때 원인을 못 찾습니다.
 */
export function styleClash(items: LoraItem[]): string[] {
  const exclusive = new Set<LoraStyle>(["cinematic", "anime", "illust"]);
  const styled = items.filter((item) => item.style && exclusive.has(item.style));
  const kinds = new Set(styled.map((item) => item.style));
  return kinds.size > 1 ? styled.map((item) => item.name) : [];
}

/**
 * 로라의 **«불러오는 말»** 을 프롬프트 앞에 붙입니다.
 *
 * 안 되고
 * 있었습니다. 화면에는 「프롬프트에 넣어야 먹습니다」 라고 적어 두고, 정작 보낼 때
 * **트리거를 버리고 있었습니다.** 로라를 켜도 그 말이 한 글자도 안 갔습니다.
 *
 * 이미 프롬프트에 그 말이 있으면 또 넣지 않습니다 — 같은 말이 두 번 들어가면
 * 그쪽으로 그림이 쏠립니다.
 */
export function withLoraTriggers(
  prompt: string,
  loras: { trigger?: string }[],
): string {
  const lower = prompt.toLowerCase();
  const words = loras
    .map((item) => (item.trigger || "").trim())
    .filter((word) => word && !lower.includes(word.toLowerCase()));
  return words.length ? `${[...new Set(words)].join(", ")}, ${prompt}` : prompt;
}
