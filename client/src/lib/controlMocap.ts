import { z } from "zod";
import { handTrackingSummary } from "./handTrackingSummary";
import { LOCAL_ENGINE_CATALOG, LOCAL_ENGINE_IDS, type LocalEngineId } from "./localEngines";
import { readProject } from "./projectWrite";
import { projectFolderName } from "./localProjectStore";
import { assetSrc, whenAppSettingsReady } from "./mediaLibrary";
import { listControlAssets } from "./controlMedia";
import { addMocapSource, confirmMocapSources, enqueueMocapAndWait, loadMocapResult, mocapSourcesOf, patchMocapSource, MOCAP_BUILTIN_ENGINE, type MocapSource } from "./mocapStore";
import { enqueueTaskOperation, isStopping, registerTaskRunner, stopTask, type TaskResult } from "./taskQueue";

const id = z.string().min(1).max(200);
const engines = [MOCAP_BUILTIN_ENGINE, ...LOCAL_ENGINE_IDS.filter(engine => LOCAL_ENGINE_CATALOG[engine].kind === "mocap")];
export const mocapListSchema = z.object({ projectId: id }).strict();
const optionsSchema = z.object({
  engine: z.enum(engines as [string, ...string[]]),
  fps: z.number().int().min(1).max(60).default(30),
  clipStart: z.number().min(0).max(86400).default(0),
  clipEnd: z.number().positive().max(86400).optional(),
  mirror: z.boolean().default(false),
  hands: z.boolean().default(true),
}).strict();
const analyzeBase = mocapListSchema.extend({ operationId: id, options: optionsSchema });
export const mocapAnalyzeSchema = z.union([
  analyzeBase.extend({ assetId: id }),
  analyzeBase.extend({ sourceId: id }),
]);
export const mocapHandsSchema = mocapListSchema.extend({ sourceId: id, operationId: id });
export const mocapResultSchema = mocapListSchema.extend({
  sourceId: id, personNumber: z.number().int().positive().optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(30).default(30),
});

function projectOf(projectId: string) {
  const draft = readProject(projectId);
  if (!draft) throw new Error("프로젝트를 찾지 못했습니다.");
  return { draft, folder: projectFolderName(projectId, draft.title) };
}
function localVideoPath(path: string | null): string {
  if (!path || !/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(path) ||
      (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)))
    throw new Error("현재 프로젝트에 등록된 로컬 원본 영상만 분석할 수 있습니다.");
  return path;
}
function sourceOf(folder: string, sourceId: string): MocapSource {
  const source = mocapSourcesOf(folder).find(item => item.id === sourceId);
  if (!source) throw new Error("현재 프로젝트의 모캡 원본을 찾지 못했습니다.");
  localVideoPath(source.path);
  return source;
}
function publicSource(source: MocapSource) {
  const { raw: _raw, result: _result, previewUrl: _preview, blobUrl: _blob, ...metadata } = source;
  return metadata;
}
export async function listControlMocap(projectId: string) {
  await whenAppSettingsReady();
  const { folder } = projectOf(projectId);
  return { projectId, sources: mocapSourcesOf(folder).map(publicSource), engines: engines.map(engine => ({
    id: engine, name: engine === MOCAP_BUILTIN_ENGINE ? "MediaPipe (내장)" : LOCAL_ENGINE_CATALOG[engine as LocalEngineId].name,
  })) };
}

export async function getControlMocapResult(raw: unknown) {
  const input = mocapResultSchema.parse(raw);
  await whenAppSettingsReady();
  const { folder } = projectOf(input.projectId);
  const source = sourceOf(folder, input.sourceId);
  const capture = await loadMocapResult(folder, source);
  if (!capture || !Array.isArray(capture.persons)) throw new Error("저장된 분석 결과를 읽지 못했습니다.");
  const { persons, ...metadata } = capture;
  const person = input.personNumber === undefined ? null : persons.find(item => item.number === input.personNumber);
  if (input.personNumber !== undefined && !person) throw new Error("분석 결과에서 요청한 사람을 찾지 못했습니다.");
  return { projectId: input.projectId, sourceId: source.id, resultPath: source.resultPath, capture: metadata,
    persons: persons.map(item => ({ number: item.number, sampleCount: item.samples.length,
      handSamples: item.samples.filter(sample => sample.hands?.left || sample.hands?.right).length })),
    ...(person ? { personNumber: person.number, samples: person.samples.slice(input.offset, input.offset + input.limit),
      nextOffset: input.offset + input.limit < person.samples.length ? input.offset + input.limit : null } : {}),
  };
}

function validateAnalyze(raw: unknown) {
  const input = mocapAnalyzeSchema.parse(raw);
  if (input.options.clipEnd !== undefined && input.options.clipEnd <= input.options.clipStart)
    throw new Error("분석 끝 시각은 시작 시각보다 뒤여야 합니다.");
  const { draft, folder } = projectOf(input.projectId);
  if ("sourceId" in input) sourceOf(folder, input.sourceId);
  else {
    const asset = listControlAssets(input.projectId).find(item => item.id === input.assetId && item.kind === "video");
    if (!asset) throw new Error("현재 프로젝트에서 원본 영상 에셋을 찾지 못했습니다.");
    localVideoPath(asset.path);
  }
  return { input, draft, folder };
}
function validateHands(raw: unknown) {
  const input = mocapHandsSchema.parse(raw);
  const { draft, folder } = projectOf(input.projectId);
  const source = sourceOf(folder, input.sourceId);
  if (!source.resultPath) throw new Error("먼저 몸의 관절 분석을 완료하고 결과를 저장해 주세요.");
  return { input, draft, folder, source };
}

export async function enqueueControlMocap(raw: unknown) {
  await whenAppSettingsReady();
  const { input, draft } = validateAnalyze(raw);
  return enqueueTaskOperation({ lane: "media", kind: "control.mocap", projectId: input.projectId,
    projectTitle: draft.title, label: "외부 조종 · 모션 캡처", operationId: input.operationId, payload: input });
}
export async function enqueueControlMocapHands(raw: unknown) {
  await whenAppSettingsReady();
  const { input, draft } = validateHands(raw);
  return enqueueTaskOperation({ lane: "media", kind: "control.mocap-hands", projectId: input.projectId,
    projectTitle: draft.title, label: "외부 조종 · 손가락 추가 추적", operationId: input.operationId, payload: input });
}

async function registeredAssetSource(input: z.infer<typeof mocapAnalyzeSchema>, folder: string): Promise<MocapSource> {
  if ("sourceId" in input) return sourceOf(folder, input.sourceId);
  const asset = listControlAssets(input.projectId).find(item => item.id === input.assetId && item.kind === "video");
  if (!asset) throw new Error("현재 프로젝트에서 원본 영상 에셋을 찾지 못했습니다.");
  const path = localVideoPath(asset.path);
  // 응답 유실·재시작으로 같은 에셋을 다시 요청해도 원본 목록을 복제하지 않습니다.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${input.projectId}\0${input.assetId}`));
  const sourceId = `control-mocap-${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const existing = mocapSourcesOf(folder).find(item => item.id === sourceId);
  if (existing) {
    if (existing.path !== path) throw new Error("등록한 영상 에셋의 경로가 바뀌었습니다. 원본 목록에서 sourceId로 다시 선택해 주세요.");
    return existing;
  }
  const source: MocapSource = { id: sourceId, name: asset.name, path, previewUrl: assetSrc(path), blobUrl: null,
    duration: 0, engine: input.options.engine, fps: input.options.fps, mirror: input.options.mirror, hands: input.options.hands,
    clipStart: input.options.clipStart, clipEnd: input.options.clipEnd ?? 0, status: "idle", percent: 0, message: "",
    raw: null, result: null, resultPath: null, repair: "normal", smoothing: "normal", start: 0, assign: {}, formation: true, analyzedAt: null };
  addMocapSource(folder, source);
  return source;
}
function jobResult(projectId: string, source: MocapSource): TaskResult {
  if (!source.resultPath || !source.raw || !Array.isArray(source.raw.persons)) throw new Error("분석 결과의 파일 저장을 확인하지 못했습니다.");
  return { paths: [source.resultPath], data: { projectId, sourceId: source.id, persisted: true,
    personCount: source.raw.persons.length, sampleCount: source.raw.persons.reduce((count, person) => count + person.samples.length, 0),
    handSampleCount: source.raw.persons.reduce((count, person) => count + person.samples.filter(sample => sample.hands?.left || sample.hands?.right).length, 0),
    ...(source.raw.handTracking ? { handTracking: source.raw.handTracking,
      handsOutcome: source.raw.handTracking.appliedHands ? "applied" : "unchanged",
      message: handTrackingSummary(source.raw) } : {}) } };
}

for (const kind of ["body", "hands"] as const) registerTaskRunner(kind === "body" ? "control.mocap" : "control.mocap-hands", async (raw, report, task) => {
  await whenAppSettingsReady();
  if (isStopping(task.id)) return;
  const validated = kind === "body" ? validateAnalyze(raw) : validateHands(raw);
  const { input, folder } = validated;
  const source = kind === "body" ? await registeredAssetSource(input as z.infer<typeof mocapAnalyzeSchema>, folder) : sourceOf(folder, (input as z.infer<typeof mocapHandsSchema>).sourceId);
  // 결과·목록은 저장됐지만 작업 완료 응답 전에 꺼졌던 경우, 이미 저장한 결과를 돌려줍니다.
  if (source.completedOperation?.id === input.operationId && source.completedOperation.kind === kind && source.resultPath) {
    const capture = await loadMocapResult(folder, source);
    if (!capture) throw new Error("앞서 저장한 분석 결과를 읽지 못했습니다. 같은 요청을 다시 분석하지 않습니다.");
    await confirmMocapSources();
    return jobResult(input.projectId, { ...source, raw: capture });
  }
  if (source.status === "queued" || source.status === "running") throw new Error("이 원본 영상은 이미 분석 중입니다.");
  if (kind === "body") {
    const options = (input as z.infer<typeof mocapAnalyzeSchema>).options;
    patchMocapSource(folder, source.id, current => ({ ...current, ...options, clipEnd: options.clipEnd ?? 0 }));
  }
  await confirmMocapSources();
  if (isStopping(task.id)) return;
  const abort = new AbortController();
  const timer = setInterval(() => { if (isStopping(task.id)) abort.abort(); }, 100);
  try {
    const finished = await enqueueMocapAndWait(folder, source.id, kind, {
      operationId: input.operationId, signal: abort.signal,
      onProgress: current => report({ progress: current.percent / 100, step: current.message }),
    });
    return jobResult(input.projectId, finished);
  } catch (error) {
    // 모캡 창에서 직접 누른 취소도 공용 작업 줄의 취소로 남깁니다.
    if (error instanceof DOMException && error.name === "AbortError") stopTask(task.id);
    throw error;
  } finally { clearInterval(timer); }
});
