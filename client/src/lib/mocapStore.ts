import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  assetSrc,
  importProjectMediaAsset,
  saveProjectMediaAsset,
  queueMirrorWrite,
  queueMirrorWriteAndConfirm,
  registerMirrorSection,
} from "@/lib/mediaLibrary";
import { isDesktopApp } from "@/lib/llm";
import { mediaOwnerName } from "@/lib/projectNames";
import { runLocal, stopLocalWorkers, type LocalEngineId } from "@/lib/localEngines";
import {
  assembleCapture,
  captureVideo,
  type CaptureResult,
  type SmoothingLevel,
} from "@/lib/motionCapture";
import { repairPerson, type RepairLevel } from "@/lib/motionRepair";
import { waitVideoFrameEvent } from "./videoFrameWait";
import { t } from "./i18n";
import { handTrackingSummary } from "./handTrackingSummary";

/**
 * **모션 캡처 분석 살림** — 창 밖에 삽니다.
 *
 * 사용자 2026-09-16:
 * - 「분석을 한 번에 눌러 두면 순차적으로 데이터 뽑게 해 줘… 이거 분석 오래 걸리는데 마냥 기다릴 수는 없잖아」
 * - 「모달을 닫아도 분석은 유지되는 거고」
 * - 「모달 끄고 다시 영상 올려서 캐릭터에 모션 입히기 버튼 누르니까 그동안 올리고 분석한 데이터 전부 사라졌네???
 * 프로젝트별로 관리가 되어야지, 나중에 내가 어떤 걸 분석했는지 알지」
 *
 * 그래서 목록도 진행 중인 분석도 **React 상태가 아니라 이 모듈**에 둡니다. 창이 사라져도 살아 있고, 다시 열면
 * 그대로 보입니다. 프로젝트마다 따로 담고(`byProject`), 앱을 껐다 켜도 남게 **프로젝트 폴더**에 영상과 결과를
 * 저장한 뒤 그 경로를 localStorage 에 적어 둡니다.
 *
 * 분석은 **한 번에 하나**만 돕니다(`queue`). GPU 가 하나라 둘을 같이 돌리면 둘 다 느려지거나 VRAM 이 터집니다.
 */

export const MOCAP_BUILTIN_ENGINE = "mediapipe";

export type MocapStatus = "idle" | "queued" | "running" | "done" | "error";

export interface MocapSource {
  id: string;
  name: string;
  /** 프로젝트 폴더에 저장한 영상 경로. 데스크톱이 아니면 없습니다. */
  path: string | null;
  /** 미리보기 주소 — 저장 경로가 있으면 asset, 없으면 blob. */
  previewUrl: string;
  /** 앱 안 검출기가 읽는 blob(asset 주소는 캔버스를 오염시켜 픽셀을 못 읽습니다). */
  blobUrl: string | null;
  duration: number;
  /**
   * 이 영상이 **원래 초당 몇 장**인가. 화면이 한 번 재어 적어 둡니다(`requestVideoFrameCallback`).
   *
   *
   * HTML 영상은 초당 장수를 알려 주지 않아서, 장이 넘어가는 간격을 두 번 재어 가까운 흔한 값으로 맞춥니다.
   */
  nativeFps?: number;
  engine: string;
  fps: number;
  mirror: boolean;
  /** SAM 3D Body의 손 전용 복원을 함께 실행합니다. 옛 저장본도 기본은 켬입니다. */
  hands?: boolean;
  clipStart: number;
  clipEnd: number;
  status: MocapStatus;
  /** 0~100. 진행 막대가 읽습니다. */
  percent: number;
  message: string;
  /** 분석 원본(튐 보정 전). */
  raw: CaptureResult | null;
  /** 튐 보정 세기와 그 결과 — 세기를 바꿀 때 다시 분석하지 않으려고 원본을 함께 둡니다. */
  repair: RepairLevel;
  smoothing: SmoothingLevel;
  /**
   * 디딘 발 고정(`footPlant.ts`)을 쓸까. **없으면 끈 것**입니다 — 예전에 분석해 둔 영상은
   * 이 값이 없으므로, 옵션을 붙였다고 지난 결과가 달라지면 안 됩니다.
   */
  footPlant?: boolean;
  result: CaptureResult | null;
  /** 프로젝트 폴더에 저장해 둔 결과 JSON 경로 — 앱을 다시 켜면 여기서 읽습니다. */
  resultPath: string | null;
  /** 이 영상의 분석 구간이 타임라인 몇 초에 오는가. */
  start: number;
  /** 사람 번호 → 캐릭터 id(또는 "skip"). 창이 채웁니다. */
  assign: Record<number, string>;
  formation: boolean;
  /** 언제 분석했는가(ISO). 목록에 «어떤 걸 분석했는지» 를 보여 줍니다. */
  analyzedAt: string | null;
  /** 결과 파일·목록 저장 뒤 앱이 꺼져도 같은 외부 요청을 다시 분석하지 않게 하는 표입니다. */
  completedOperation?: { id: string; kind: "body" | "hands" };
}

interface Store {
  byProject: Record<string, MocapSource[]>;
}

const STORAGE_KEY = "ai-video-storage.mocap.v1";

/** 저장할 때 빼는 것들 — blob 주소는 앱을 닫으면 죽고, 결과는 파일로 남깁니다. */
type Saved = Omit<MocapSource, "raw" | "result" | "blobUrl" | "previewUrl"> & {
  previewUrl?: string;
  updatedAt?: number;
  deleted?: boolean;
};
type SavedIndex = Record<string, Saved[]>;
const MOCAP_MIRROR_SECTION = "mocap-sources";
let savedIndex: SavedIndex | null = null;

let store: Store = { byProject: {} };
const listeners = new Set<() => void>();
/** 구독자에게 나눠 줄 **같은 배열**. 매번 새로 만들면 useSyncExternalStore 가 무한히 다시 그립니다. */
const snapshots = new Map<string, MocapSource[]>();
const EMPTY: MocapSource[] = [];

function emit(project: string) {
  snapshots.set(project, [...(store.byProject[project] ?? [])]);
  listeners.forEach((listener) => listener());
}

function withoutStamp(value: Saved): string {
  const { updatedAt: _stamp, ...rest } = value;
  return JSON.stringify(rest);
}

/** 아직 열지 않은 작품도 보존합니다. 진행률은 파일에 쓰지 않아 프레임마다 디스크가 바쁘지 않습니다. */
function persist() {
  const previous = loadSaved(), plain: SavedIndex = { ...previous };
  for (const [project, sources] of Object.entries(store.byProject)) {
    const before = new Map((previous[project] ?? []).map(source => [source.id, source]));
    const active = sources.filter(source => source.path).map(({ raw: _raw, result: _result, blobUrl: _blob, previewUrl: _preview, ...rest }): Saved => {
      const prior = before.get(rest.id);
      const busy = rest.status === "running" || rest.status === "queued";
      const next: Saved = { ...rest, status: busy ? "idle" : rest.status, percent: 0, message: busy ? "" : rest.message };
      delete next.updatedAt; delete next.deleted;
      return { ...next, updatedAt: prior && withoutStamp(prior) === withoutStamp(next) ? prior.updatedAt : Math.max(Date.now(), (prior?.updatedAt ?? 0) + 1) };
    });
    const ids = new Set(active.map(source => source.id));
    const removed = [...before.values()].filter(source => !ids.has(source.id)).map(source => source.deleted ? source : { ...source, deleted: true, updatedAt: Math.max(Date.now(), (source.updatedAt ?? 0) + 1) });
    plain[project] = [...active, ...removed];
  }
  if (JSON.stringify(previous) === JSON.stringify(plain)) return;
  savedIndex = plain;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plain)); } catch { /* 파일 거울은 브라우저 용량과 무관하게 저장합니다. */ }
  queueMirrorWrite(MOCAP_MIRROR_SECTION, plain);
}

function loadSaved(): SavedIndex {
  if (savedIndex) return savedIndex;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    savedIndex = text ? (JSON.parse(text) as SavedIndex) : {};
  } catch {
    savedIndex = {};
  }
  return savedIndex!;
}

function mergeSaved(mine: SavedIndex, theirs: SavedIndex): SavedIndex {
  const combined: SavedIndex = {};
  for (const project of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const rows = new Map((mine[project] ?? []).map(source => [source.id, source]));
    for (const source of theirs[project] ?? []) {
      const previous = rows.get(source.id);
      if (!previous || (source.updatedAt ?? 0) >= (previous.updatedAt ?? 0)) rows.set(source.id, source);
    }
    combined[project] = [...rows.values()];
  }
  return combined;
}

registerMirrorSection<SavedIndex>(MOCAP_MIRROR_SECTION, {
  read: () => {
    if (savedIndex) return savedIndex;
    try { const text = window.localStorage.getItem(STORAGE_KEY); return text ? JSON.parse(text) as SavedIndex : null; } catch { return null; }
  },
  write: value => {
    savedIndex = value;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* 읽은 파일 값은 메모리에 남깁니다. */ }
    for (const project of Object.keys(store.byProject)) {
      const current = store.byProject[project];
      const restored = (value[project] ?? []).filter(source => !source.deleted).map(source => {
        const live = current.find(item => item.id === source.id);
        if (live?.status === "running" || live?.status === "queued") return live;
        const sameResult = live?.resultPath === source.resultPath;
        return { ...source, raw: sameResult ? live?.raw ?? null : null, result: sameResult ? live?.result ?? null : null, blobUrl: live?.blobUrl ?? null, previewUrl: source.path ? assetSrc(source.path) || "" : "" };
      });
      store.byProject[project] = [...restored, ...current.filter(source => !source.path)];
      emit(project);
    }
  },
  merge: mergeSaved,
});

/** 그 프로젝트의 목록. 없으면 저장해 둔 기록을 읽어 세웁니다. */
export function mocapSourcesOf(project: string): MocapSource[] {
  if (!store.byProject[project]) {
    const saved = loadSaved()[project] ?? [];
    store.byProject[project] = saved.filter(entry => !entry.deleted).map((entry) => ({
      ...entry,
      raw: null,
      result: null,
      blobUrl: null,
      previewUrl: entry.path ? assetSrc(entry.path) || "" : "",
    }));
    snapshots.set(project, [...store.byProject[project]]);
  }
  return snapshots.get(project) ?? EMPTY;
}

export function useMocapSources(project: string): MocapSource[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mocapSourcesOf(project),
    () => mocapSourcesOf(project),
  );
}

export function patchMocapSource(
  project: string,
  id: string,
  patch: (current: MocapSource) => MocapSource,
) {
  mocapSourcesOf(project);
  const list = store.byProject[project] ?? [];
  store.byProject[project] = list.map((item) => (item.id === id ? patch(item) : item));
  emit(project);
  persist();
}

export function addMocapSource(project: string, source: MocapSource) {
  mocapSourcesOf(project);
  store.byProject[project] = [...(store.byProject[project] ?? []), source];
  emit(project);
  persist();
}

export function removeMocapSource(project: string, id: string) {
  mocapSourcesOf(project);
  store.byProject[project] = (store.byProject[project] ?? []).filter((item) => item.id !== id);
  emit(project);
  persist();
}

/**
 * 올린 영상을 **프로젝트 폴더**에 넣습니다(`<프로젝트>/mocap/<영상 이름>/`).
 *
 *
 */
export async function saveMocapVideo(
  project: string,
  file: File,
): Promise<string | null> {
  if (!isDesktopApp()) return null;
  if (!project.trim()) throw new Error(t("프로젝트와 저장 폴더를 먼저 설정해 주세요."));
  /*
    올린 영상 이름을 **그대로** 폴더로 쓰고 있었습니다. 유튜브에서 받은 이름에는 이모지와
    해시태그가 줄줄이 붙어 폴더 이름이 200자를 넘었습니다(). 원래 이름은 `MocapSource.name` 에 그대로 남으니 잃지 않습니다.
  */
  const owner = mediaOwnerName(file.name);
  const saved = await saveProjectMediaAsset(file, {
    projectName: project,
    assetType: "mocap-video",
    ownerName: owner,
    stem: owner,
  });
  if (!saved?.path) throw new Error(t("프로젝트와 저장 폴더를 먼저 설정해 주세요."));
  return saved.path;
}

/**
 * 데스크톱 파일 고르개로 **경로만** 받은 영상을 프로젝트 폴더로 담습니다.
 *
 * 데스크톱에서는 저장 실패를 알립니다. 원래 경로로 대체하면 폴더에 담았다는 안내가 거짓이 됩니다.
 */
export async function importMocapVideo(
  project: string,
  sourcePath: string,
): Promise<{ path: string; name: string }> {
  const fileName = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const owner = mediaOwnerName(fileName);
  if (!isDesktopApp()) return { path: sourcePath, name: owner };
  if (!project.trim()) throw new Error(t("프로젝트와 저장 폴더를 먼저 설정해 주세요."));
  const saved = await importProjectMediaAsset(sourcePath, {
    projectName: project,
    assetType: "mocap-video",
    ownerName: owner,
    stem: owner,
  });
  if (!saved?.path) throw new Error(t("프로젝트와 저장 폴더를 먼저 설정해 주세요."));
  return { path: saved.path, name: owner };
}

/** 분석 결과를 그 영상 폴더에 JSON 으로 남깁니다 — 다시 켜도 그대로 씁니다. */
async function saveMocapResult(
  project: string,
  source: MocapSource,
  raw: CaptureResult,
): Promise<string | null> {
  if (!project.trim() || !isDesktopApp()) return null;
  // 결과도 **같은 이름**을 씁니다 — 폴더는 정리되고 파일만 원본 이름이면 짝이 안 맞습니다.
  const owner = mediaOwnerName(source.name);
  const stem = `${owner}_${source.engine}`;
  const file = new File([JSON.stringify(raw)], `${stem}.json`, { type: "application/json" });
  const saved = await saveProjectMediaAsset(file, {
    projectName: project,
    assetType: "mocap-result",
    ownerName: owner,
    stem,
  }).catch(() => null);
  return saved?.path ?? null;
}

/** 튐 보정을 먹인 결과. 세기를 바꿀 때마다 다시 분석하지 않으려고 원본에서 다시 셉니다. */
export const repairedCapture = (
  raw: CaptureResult | null,
  level: RepairLevel,
): CaptureResult | null =>
  raw ? { ...raw, persons: raw.persons.map((person) => repairPerson(person, level)) } : null;

/** 저장해 둔 결과를 읽어 옵니다(앱을 다시 켠 뒤 처음 고를 때). */
export async function loadMocapResult(
  project: string,
  source: MocapSource,
): Promise<CaptureResult | null> {
  if (source.raw) return source.raw;
  if (!source.resultPath) return null;
  try {
    const text = await (await fetch(assetSrc(source.resultPath))).text();
    const raw = JSON.parse(text) as CaptureResult;
    patchMocapSource(project, source.id, (current) => ({
      ...current,
      raw,
      result: repairedCapture(raw, current.repair),
    }));
    return raw;
  } catch {
    return null;
  }
}

// ─── 줄 서서 하나씩 ──────────────────────────────────────────────────────

interface MocapQueueEntry {
  project: string;
  id: string;
  kind: "body" | "hands";
  operationId?: string;
  resolve?: (source: MocapSource) => void;
  reject?: (error: unknown) => void;
}
const queue: MocapQueueEntry[] = [];
let running: { project: string; id: string; abort: AbortController } | null = null;

/** 외부 조종에서 등록한 원본 목록도 분석 시작 전에 파일에 남깁니다. */
export async function confirmMocapSources() {
  persist();
  if (isDesktopApp()) await queueMirrorWriteAndConfirm(MOCAP_MIRROR_SECTION, loadSaved());
}

/** 같은 분석 줄을 쓰되 결과 JSON과 목록 저장을 기다립니다. UI가 취소해도 이 Promise에 전달됩니다. */
export function enqueueMocapAndWait(project: string, id: string, kind: "body" | "hands", options: {
  operationId: string;
  signal?: AbortSignal;
  onProgress?: (source: MocapSource) => void;
}): Promise<MocapSource> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("취소", "AbortError"));
  const source = mocapSourcesOf(project).find(item => item.id === id);
  if (!source) return Promise.reject(new Error("분석할 원본 영상을 찾지 못했습니다."));
  if (source.status === "queued" || source.status === "running" || (running?.project === project && running.id === id))
    return Promise.reject(new Error("이 원본 영상은 이미 분석 중입니다."));
  if (kind === "hands" && !source.raw && !source.resultPath)
    return Promise.reject(new Error("먼저 몸의 관절 분석을 완료해 주세요."));
  return new Promise<MocapSource>((resolve, reject) => {
    const progress = () => {
      const current = mocapSourcesOf(project).find(item => item.id === id);
      if (current) options.onProgress?.(current);
    };
    const cancel = () => cancelMocap(project, id);
    const cleanup = () => { listeners.delete(progress); options.signal?.removeEventListener("abort", cancel); };
    listeners.add(progress);
    options.signal?.addEventListener("abort", cancel, { once: true });
    queue.push({ project, id, kind, operationId: options.operationId,
      resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
    patchMocapSource(project, id, current => ({ ...current, status: "queued", percent: 0, message: "차례를 기다립니다…" }));
    void pump();
  });
}


/**
 * 분석을 **줄에 세웁니다.** 이미 서 있거나 도는 중이면 아무 일도 하지 않습니다.
 *
 *
 */
export function enqueueMocap(project: string, id: string, kind: "body" | "hands" = "body") {
  mocapSourcesOf(project);
  const source = (store.byProject[project] ?? []).find((item) => item.id === id);
  if (!source || source.status === "queued" || source.status === "running") return;
  if (kind === "hands" && !source.raw && !source.resultPath) return;
  queue.push({ project, id, kind });
  patchMocapSource(project, id, (current) => ({
    ...current,
    status: "queued",
    percent: 0,
    message: kind === "hands" ? "손가락 추가 추적 차례를 기다립니다…" : "차례를 기다립니다…",
  }));
  void pump();
}

/** 줄에서 빼거나, 도는 중이면 멈춥니다. */
export function cancelMocap(project: string, id: string) {
  const at = queue.findIndex((item) => item.project === project && item.id === id);
  if (at >= 0) queue.splice(at, 1)[0].reject?.(new DOMException("취소", "AbortError"));
  if (running && running.project === project && running.id === id) running.abort.abort();
  patchMocapSource(project, id, (current) =>
    current.status === "queued" || current.status === "running"
      ? { ...current, status: "idle", percent: 0, message: "분석을 취소했습니다." }
      : current,
  );
}

async function pump() {
  if (running || !queue.length) return;
  const next = queue.shift()!;
  const source = (store.byProject[next.project] ?? []).find((item) => item.id === next.id);
  if (!source) {
    next.reject?.(new Error("분석할 원본 영상이 목록에서 제거됐습니다."));
    void pump();
    return;
  }
  const abort = new AbortController();
  running = { ...next, abort };
  patchMocapSource(next.project, next.id, (current) => ({
    ...current,
    status: "running",
    percent: 0,
    message: "분석을 시작합니다…",
  }));
  let stagedRaw: CaptureResult | null = null;
  try {
    if (isDesktopApp() && !source.path) throw new Error("원본 영상을 먼저 파일로 저장해 주세요. 임시 영상만으로는 앱을 다시 켠 뒤 분석을 복원할 수 없습니다.");
    const raw = next.kind === "hands"
      ? await analyzeHands(next.project, source, abort.signal)
      : await analyzeOne(next.project, source, abort.signal);
    if (abort.signal.aborted) throw new DOMException("취소", "AbortError");
    const resultPath = await saveMocapResult(next.project, source, raw);
    if (abort.signal.aborted) throw new DOMException("취소", "AbortError");
    if (isDesktopApp() && !resultPath) throw new Error("분석 결과를 프로젝트 폴더에 저장하지 못했습니다. 이전 분석 결과는 유지합니다.");
    // 결과 파일만 남고 목록이 옛 경로를 가리키면 재시작 뒤 새 분석이 사라집니다.
    // 목록 파일까지 확인하는 동안에는 완료 표시를 하지 않습니다.
    stagedRaw = raw;
    if (!mocapSourcesOf(next.project).some(item => item.id === next.id)) throw new Error("분석할 원본 영상이 목록에서 제거됐습니다.");
    patchMocapSource(next.project, next.id, current => ({ ...current, raw, result: repairedCapture(raw, current.repair), resultPath,
      analyzedAt: new Date().toISOString(), completedOperation: next.operationId ? { id: next.operationId, kind: next.kind } : undefined }));
    // 브라우저 시연은 기존처럼 메모리에서만 분석합니다. 설치본은 목록 파일까지 확인합니다.
    if (isDesktopApp()) await queueMirrorWriteAndConfirm(MOCAP_MIRROR_SECTION, loadSaved());
    if (abort.signal.aborted) throw new DOMException("취소", "AbortError");
    patchMocapSource(next.project, next.id, (current) => ({
      ...current,
      raw,
      result: repairedCapture(raw, current.repair),
      resultPath,
      status: "done",
      percent: 100,
      message: next.kind === "hands" ? handTrackingSummary(raw) : raw.persons.length
        ? `사람 ${raw.persons.length}명`
        : "사람을 찾지 못했습니다. 전신이 보이는 영상인지 확인해 주세요.",
    }));
    next.resolve?.(mocapSourcesOf(next.project).find(item => item.id === next.id)!);
    if (!document.querySelector("[data-mocap-open]")) {
      if (next.kind === "hands" && raw.handTracking?.appliedHands === 0) toast.info(handTrackingSummary(raw));
      else toast.success(`«${source.name}» 분석을 마쳤습니다.`, {
        description: next.kind === "hands" ? handTrackingSummary(raw) : "모션 가져오기 창을 열면 그대로 있습니다",
      });
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    patchMocapSource(next.project, next.id, (current) => ({
      ...current,
      ...(stagedRaw && current.raw === stagedRaw ? { raw: source.raw, result: repairedCapture(source.raw, current.repair), resultPath: source.resultPath,
        completedOperation: source.completedOperation, analyzedAt: source.analyzedAt } : {}),
      status: aborted ? "idle" : "error",
      percent: 0,
      message: aborted
        ? "분석을 취소했습니다."
        : `분석하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`,
    }));
    next.reject?.(error);
    if (!aborted) toast.error(`«${source.name}» 분석에 실패했습니다.`);
  } finally {
    running = null;
    void pump();
  }
}

/** 몸 분석과 같은 줄에서 돌아야 검출기 두 개가 동시에 GPU를 점유하지 않습니다. */
async function analyzeHands(project: string, source: MocapSource, signal: AbortSignal): Promise<CaptureResult> {
  const raw = source.raw ?? await loadMocapResult(project, source);
  if (!raw?.persons.length) throw new Error("먼저 몸의 관절 분석을 완료해 주세요.");
  const url = source.blobUrl || (source.path ? assetSrc(source.path) : "");
  if (!url) throw new Error("손을 추적할 원본 영상을 찾지 못했습니다.");
  const { captureVideoHands } = await import("./handCapture");
  return captureVideoHands(url, raw, {
    signal, mirrored: raw.mirrored ?? source.mirror,
    onProgress: (done, total) => patchMocapSource(project, source.id, current => ({ ...current, percent: total ? done / total * 100 : 0, message: `손 추적 ${done} / ${total} 장` })),
  });
}

/** 영상 하나를 분석합니다 — 앱 안 검출기(MediaPipe) 또는 로컬 엔진. */
async function analyzeOne(
  project: string,
  source: MocapSource,
  signal: AbortSignal,
): Promise<CaptureResult> {
  const end = source.clipEnd > source.clipStart ? source.clipEnd : undefined;
  const report = (percent: number, message: string) =>
    patchMocapSource(project, source.id, (current) => ({ ...current, percent, message }));

  if (source.engine === MOCAP_BUILTIN_ENGINE) {
    /*
      분석은 **보이지 않는 영상 요소**로 합니다. 미리보기 영상으로 하면 사람이 슬라이더를 만지는 순간 장이 섞이고,
      asset 주소를 캔버스에 그리면 캔버스가 오염돼 검출기가 픽셀을 못 읽습니다(CLAUDE.md «알아 둘 함정»).
    */
    let blobUrl = source.blobUrl;
    if (!blobUrl && source.path) {
      report(0, "영상을 읽는 중…");
      blobUrl = URL.createObjectURL(await (await fetch(assetSrc(source.path), { signal })).blob());
      if (signal.aborted) { URL.revokeObjectURL(blobUrl); throw new DOMException("취소", "AbortError"); }
      const made = blobUrl;
      patchMocapSource(project, source.id, (current) => ({ ...current, blobUrl: made }));
    }
    if (!blobUrl) throw new Error("영상을 읽지 못했습니다.");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let detector: Awaited<ReturnType<typeof import("./poseLandmarker")["createPoseDetector"]>> | undefined;
    try {
      await waitVideoFrameEvent(video, "loadeddata", () => { video.src = blobUrl!; }, signal);
      report(0, "검출기 준비 중…");
      const { createPoseDetector } = await import("@/lib/poseLandmarker");
      detector = await createPoseDetector();
      if (signal.aborted) throw new DOMException("취소", "AbortError");
      return await captureVideo(video, detector, {
        fps: source.fps,
        start: source.clipStart,
        end,
        mirror: source.mirror,
        signal,
        onProgress: (done, total) => report((done / total) * 100, `${done} / ${total} 장`),
      });
    } finally {
      detector?.close();
      video.removeAttribute("src");
      video.load();
    }
  }

  if (!source.path) throw new Error("로컬 엔진은 데스크톱에서 고른 영상 파일이 있어야 돕니다.");
  const output = await invoke<string>("motion_capture_output", { name: source.id });
  // 로컬 엔진에는 «하던 일만 멈춤» 이 없어 워커를 내립니다(다음 분석 때 새로 뜸).
  const stop = () => void stopLocalWorkers();
  signal.addEventListener("abort", stop, { once: true });
  report(0, "엔진을 띄우는 중…");
  try {
    const run = await runLocal(
      source.engine as LocalEngineId,
      output,
      { prompt: "", video: source.path, fps: source.fps, start: source.clipStart, end, hands: source.hands !== false },
      {
        onProgress: (event) => report(event.percent ?? 0, event.message || "분석 중…"),
        // 3 분짜리 곡을 초당 30 장으로 여러 명 보면 한 시간을 넘길 수 있습니다.
        timeoutSecs: 4 * 3600,
      },
    );
    if (signal.aborted) throw new DOMException("취소", "AbortError");
    const text = await invoke<string>("read_motion_capture", { path: run.output });
    return assembleCapture({ ...JSON.parse(text), mirror: source.mirror });
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
