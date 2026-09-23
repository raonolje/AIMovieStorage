import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  assetSrc,
  importProjectMediaAsset,
  saveProjectMediaAsset,
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
}

interface Store {
  byProject: Record<string, MocapSource[]>;
}

const STORAGE_KEY = "ai-video-storage.mocap.v1";

/** 저장할 때 빼는 것들 — blob 주소는 앱을 닫으면 죽고, 결과는 파일로 남깁니다. */
type Saved = Omit<MocapSource, "raw" | "result" | "blobUrl" | "previewUrl"> & {
  previewUrl?: string;
};

let store: Store = { byProject: {} };
const listeners = new Set<() => void>();
/** 구독자에게 나눠 줄 **같은 배열**. 매번 새로 만들면 useSyncExternalStore 가 무한히 다시 그립니다. */
const snapshots = new Map<string, MocapSource[]>();
const EMPTY: MocapSource[] = [];

function emit(project: string) {
  snapshots.set(project, [...(store.byProject[project] ?? [])]);
  listeners.forEach((listener) => listener());
}

function persist() {
  try {
    const plain: Record<string, Saved[]> = {};
    for (const [project, sources] of Object.entries(store.byProject)) {
      plain[project] = sources
        // 폴더에 저장된 영상만 남깁니다 — blob 만 있는 것은 다음에 열면 못 읽습니다.
        .filter((source) => source.path)
        .map(({ raw: _raw, result: _result, blobUrl: _blob, previewUrl: _preview, ...rest }) => ({
          ...rest,
          // 진행 중이던 것은 «안 한 것» 으로 적습니다 — 앱을 껐으면 그 분석은 끝난 게 아닙니다.
          status: rest.status === "running" || rest.status === "queued" ? "idle" : rest.status,
          percent: 0,
        }));
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
  } catch {
    // 저장에 실패해도 분석은 계속됩니다 — 기록이 없을 뿐입니다.
  }
}

function loadSaved(): Record<string, Saved[]> {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return text ? (JSON.parse(text) as Record<string, Saved[]>) : {};
  } catch {
    return {};
  }
}

/** 그 프로젝트의 목록. 없으면 저장해 둔 기록을 읽어 세웁니다. */
export function mocapSourcesOf(project: string): MocapSource[] {
  if (!store.byProject[project]) {
    const saved = loadSaved()[project] ?? [];
    store.byProject[project] = saved.map((entry) => ({
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
  const list = store.byProject[project] ?? [];
  store.byProject[project] = list.map((item) => (item.id === id ? patch(item) : item));
  emit(project);
  persist();
}

export function addMocapSource(project: string, source: MocapSource) {
  store.byProject[project] = [...(store.byProject[project] ?? []), source];
  emit(project);
  persist();
}

export function removeMocapSource(project: string, id: string) {
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
  if (!project.trim() || !isDesktopApp()) return null;
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
  }).catch(() => null);
  return saved?.path ?? null;
}

/**
 * 데스크톱 파일 고르개로 **경로만** 받은 영상을 프로젝트 폴더로 담습니다.
 *
 * 돌려주는 것은 «담은 경로와 정리된 이름» 입니다. 못 담으면 원래 경로를 그대로 씁니다 —
 * 분석은 되어야 하니까요(저장 폴더를 아직 안 골랐을 수 있습니다).
 */
export async function importMocapVideo(
  project: string,
  sourcePath: string,
): Promise<{ path: string; name: string }> {
  const fileName = sourcePath.split(/[\/]/).pop() ?? sourcePath;
  const owner = mediaOwnerName(fileName);
  if (!project.trim() || !isDesktopApp()) return { path: sourcePath, name: owner };
  const saved = await importProjectMediaAsset(sourcePath, {
    projectName: project,
    assetType: "mocap-video",
    ownerName: owner,
    stem: owner,
  }).catch(() => null);
  return saved ? { path: saved.path, name: owner } : { path: sourcePath, name: owner };
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

const queue: { project: string; id: string }[] = [];
let running: { project: string; id: string; abort: AbortController } | null = null;


/**
 * 분석을 **줄에 세웁니다.** 이미 서 있거나 도는 중이면 아무 일도 하지 않습니다.
 *
 *
 */
export function enqueueMocap(project: string, id: string) {
  const source = (store.byProject[project] ?? []).find((item) => item.id === id);
  if (!source || source.status === "queued" || source.status === "running") return;
  queue.push({ project, id });
  patchMocapSource(project, id, (current) => ({
    ...current,
    status: "queued",
    percent: 0,
    message: "차례를 기다립니다…",
  }));
  void pump();
}

/** 줄에서 빼거나, 도는 중이면 멈춥니다. */
export function cancelMocap(project: string, id: string) {
  const at = queue.findIndex((item) => item.project === project && item.id === id);
  if (at >= 0) queue.splice(at, 1);
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
  try {
    const raw = await analyzeOne(next.project, source, abort.signal);
    const resultPath = await saveMocapResult(next.project, source, raw);
    patchMocapSource(next.project, next.id, (current) => ({
      ...current,
      raw,
      result: repairedCapture(raw, current.repair),
      resultPath,
      status: "done",
      percent: 100,
      analyzedAt: new Date().toISOString(),
      message: raw.persons.length
        ? `사람 ${raw.persons.length}명`
        : "사람을 찾지 못했습니다. 전신이 보이는 영상인지 확인해 주세요.",
    }));
    if (!document.querySelector("[data-mocap-open]"))
      toast.success(`«${source.name}» 분석을 마쳤습니다.`, {
        description: "모션 가져오기 창을 열면 그대로 있습니다",
      });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    patchMocapSource(next.project, next.id, (current) => ({
      ...current,
      status: aborted ? "idle" : "error",
      percent: 0,
      message: aborted
        ? "분석을 취소했습니다."
        : `분석하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`,
    }));
    if (!aborted) toast.error(`«${source.name}» 분석에 실패했습니다.`);
  } finally {
    running = null;
    void pump();
  }
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
      blobUrl = URL.createObjectURL(await (await fetch(assetSrc(source.path))).blob());
      const made = blobUrl;
      patchMocapSource(project, source.id, (current) => ({ ...current, blobUrl: made }));
    }
    if (!blobUrl) throw new Error("영상을 읽지 못했습니다.");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("영상을 열지 못했습니다(코덱을 확인하세요).")),
        { once: true },
      );
      video.src = blobUrl as string;
    });
    report(0, "검출기 준비 중…");
    const { createPoseDetector } = await import("@/lib/poseLandmarker");
    const detector = await createPoseDetector();
    try {
      return await captureVideo(video, detector, {
        fps: source.fps,
        start: source.clipStart,
        end,
        mirror: source.mirror,
        signal,
        onProgress: (done, total) => report((done / total) * 100, `${done} / ${total} 장`),
      });
    } finally {
      detector.close();
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
      { prompt: "", video: source.path, fps: source.fps, start: source.clipStart, end },
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
