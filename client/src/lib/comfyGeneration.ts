import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "@/lib/llm";
import { getMediaLibrarySettings, queueMirrorWrite, queueMirrorWriteAndConfirm, registerMirrorSection, type ProjectAssetType } from "@/lib/mediaLibrary";

export type ComfyKind = "image" | "video";
export type ComfyValue = string | number | boolean;
export interface ComfyInputMapping {
  nodeId: string;
  input: string;
  source: "prompt" | "negative" | "reference" | "value";
  referenceKind?: "image" | "video" | "audio";
  referenceIndex?: number;
  value?: ComfyValue;
}
export interface ComfyWorkflowConfig { workflowPath: string; mappings: ComfyInputMapping[]; outputNodeIds: string[] }
export interface ComfyGenerationSettings { baseUrl: string; image: ComfyWorkflowConfig; video: ComfyWorkflowConfig }
export interface ComfyWorkflowInfo { sha256: string; nodes: { id: string; classType: string; title: string; inputs: {name: string; value: ComfyValue}[] }[] }
export interface ComfyOutput { path: string; name: string; kind: ComfyKind; nodeId: string }
export interface ComfyReference { kind: "image" | "video" | "audio"; path: string }
export interface ComfyBinding { nodeId: string; input: string; value?: ComfyValue; filePath?: string }
export interface ComfyStatus { state: "pending" | "completed" | "failed"; promptId: string; error?: string }

const KEY = "ai-video-storage.comfy-generation.v1";
const SECTION = "comfy-generation";
const emptyWorkflow = (): ComfyWorkflowConfig => ({ workflowPath: "", mappings: [], outputNodeIds: [] });
const defaults = (): ComfyGenerationSettings => ({ baseUrl: "http://127.0.0.1:8188", image: emptyWorkflow(), video: emptyWorkflow() });
const listeners = new Set<() => void>();
export const subscribeComfyGeneration = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => listeners.forEach(listener => listener());

export function normalizeComfyGenerationSettings(raw: unknown): ComfyGenerationSettings {
  const object = raw && typeof raw === "object" ? raw as Partial<ComfyGenerationSettings> : {};
  const result = defaults();
  if (typeof object.baseUrl === "string" && object.baseUrl.trim()) result.baseUrl = object.baseUrl.trim();
  for (const kind of ["image", "video"] as const) {
    const config = object[kind];
    if (!config || typeof config.workflowPath !== "string") continue;
    result[kind] = {
      workflowPath: config.workflowPath.trim(),
      mappings: Array.isArray(config.mappings) ? config.mappings.filter(item => item && typeof item.nodeId === "string" && typeof item.input === "string"
        && ["prompt", "negative", "reference", "value"].includes(item.source)).map(item => ({ ...item })) : [],
      outputNodeIds: Array.isArray(config.outputNodeIds) ? config.outputNodeIds.filter(item => typeof item === "string") : [],
    };
  }
  return result;
}

function readSettings(): ComfyGenerationSettings | null {
  if (typeof window === "undefined") return null;
  try { const saved = window.localStorage.getItem(KEY); return saved ? normalizeComfyGenerationSettings(JSON.parse(saved)) : null; } catch { return null; }
}
export function getComfyGenerationSettings(): ComfyGenerationSettings { return readSettings() ?? defaults(); }
export function saveComfyGenerationSettings(update: (current: ComfyGenerationSettings) => ComfyGenerationSettings): ComfyGenerationSettings {
  const next = normalizeComfyGenerationSettings(update(getComfyGenerationSettings()));
  window.localStorage.setItem(KEY, JSON.stringify(next)); queueMirrorWrite(SECTION, next); publish(); return next;
}
/** 외부 조종기는 파일 저장이 실패한 값을 성공으로 돌려주면 안 됩니다. */
export async function saveComfyGenerationSettingsAndConfirm(update: (current: ComfyGenerationSettings) => ComfyGenerationSettings): Promise<ComfyGenerationSettings> {
  const previous = getComfyGenerationSettings();
  const next = normalizeComfyGenerationSettings(update(previous));
  const text = JSON.stringify(next);
  window.localStorage.setItem(KEY, text); publish();
  try { await queueMirrorWriteAndConfirm(SECTION, next); }
  catch (error) {
    // 저장을 기다리는 동안 사용자가 고친 새 설정은 되돌리지 않습니다.
    if (window.localStorage.getItem(KEY) === text) {
      window.localStorage.setItem(KEY, JSON.stringify(previous)); publish();
    }
    throw error;
  }
  return next;
}
/** 설정 화면과 조종기가 같은 검사를 사용합니다. 파일 업로드나 생성은 하지 않습니다. */
export function validateComfyWorkflowConfig(config: ComfyWorkflowConfig, info: ComfyWorkflowInfo): void {
  const references: ComfyReference[] = [];
  for (const kind of ["image", "video", "audio"] as const) {
    const indices = config.mappings.filter(m => m.source === "reference" && (m.referenceKind ?? "image") === kind).map(m => m.referenceIndex ?? 0);
    if (indices.length && (!indices.every(i => Number.isInteger(i) && i >= 0 && i < 64)
      || new Set(indices).size !== Math.max(...indices) + 1))
      throw new Error("레퍼런스 순서는 갈래별로 1번부터 빠짐없이 연결하세요.");
    for (let i = 0; i <= Math.max(-1, ...indices); i++) references.push({ kind, path: "검사용 파일" });
  }
  for (const mapping of config.mappings) {
    const field = info.nodes.find(n => n.id === mapping.nodeId)?.inputs.find(f => f.name === mapping.input);
    if (["prompt", "negative"].includes(mapping.source) && typeof field?.value !== "string")
      throw new Error("프롬프트는 문자열 입력에 연결하세요.");
  }
  if (new Set(config.outputNodeIds).size !== config.outputNodeIds.length) throw new Error("결과 노드가 중복됐습니다.");
  prepareComfyBindings(config, info, { prompt: "검사용 프롬프트", negative: "검사용 부정 프롬프트", references });
}
registerMirrorSection(SECTION, { read: readSettings, write(value) { window.localStorage.setItem(KEY, JSON.stringify(normalizeComfyGenerationSettings(value))); publish(); } });

export async function inspectComfyGenerationWorkflow(workflowPath: string): Promise<ComfyWorkflowInfo> {
  return invoke("comfy_inspect_generation_workflow", { workflowPath });
}
export async function inspectConfiguredComfyWorkflow(kind: ComfyKind): Promise<ComfyWorkflowInfo & { config: ComfyWorkflowConfig; baseUrl: string }> {
  const settings = getComfyGenerationSettings();
  if (!settings[kind].workflowPath) throw new Error("설정에서 ComfyUI 생성 워크플로를 먼저 고르세요.");
  return { ...await inspectComfyGenerationWorkflow(settings[kind].workflowPath), config: settings[kind], baseUrl: settings.baseUrl };
}

export function prepareComfyBindings(config: ComfyWorkflowConfig, info: ComfyWorkflowInfo, input: {
  prompt: string; negative?: string; references?: ComfyReference[]; values?: Record<string, ComfyValue>;
}): ComfyBinding[] {
  const seen = new Set<string>();
  const consumed = new Set<string>();
  const overrides = input.values ?? {};
  const allowed = new Set(config.mappings.filter(mapping => mapping.source === "value").map(mapping => `${mapping.nodeId}.${mapping.input}`));
  for (const name of Object.keys(overrides)) if (!allowed.has(name)) throw new Error(`설정에 등록되지 않은 ComfyUI 입력입니다: ${name}`);
  if (!config.mappings.some(mapping => mapping.source === "prompt")) throw new Error("ComfyUI 워크플로에 프롬프트 입력을 연결하세요.");
  const bindings = config.mappings.map(mapping => {
    const key = `${mapping.nodeId}.${mapping.input}`;
    if (seen.has(key)) throw new Error(`ComfyUI 입력이 중복됐습니다: ${key}`);
    seen.add(key);
    const field = info.nodes.find(node => node.id === mapping.nodeId)?.inputs.find(field => field.name === mapping.input);
    if (!field) throw new Error(`워크플로에서 입력을 찾지 못했습니다: ${key}`);
    if (mapping.source === "reference") {
      const index = mapping.referenceIndex ?? 0;
      if (!Number.isInteger(index) || index < 0 || typeof field.value !== "string") throw new Error(`레퍼런스 입력 설정이 올바르지 않습니다: ${key}`);
      const reference = (input.references ?? []).filter(ref => ref.kind === (mapping.referenceKind ?? "image"))[index];
      if (!reference?.path) throw new Error(`워크플로에 필요한 레퍼런스가 없습니다: ${mapping.referenceKind ?? "image"} ${index + 1}`);
      consumed.add(`${mapping.referenceKind ?? "image"}:${index}`);
      return { nodeId: mapping.nodeId, input: mapping.input, filePath: reference.path };
    }
    const value = mapping.source === "prompt" ? input.prompt : mapping.source === "negative" ? input.negative ?? "" : overrides[key] ?? mapping.value ?? field.value;
    if (typeof value !== typeof field.value || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`ComfyUI 입력 형식이 맞지 않습니다: ${key}`);
    return { nodeId: mapping.nodeId, input: mapping.input, value };
  });
  const indices = { image: 0, video: 0, audio: 0 };
  const unused = (input.references ?? []).filter(reference => !consumed.has(`${reference.kind}:${indices[reference.kind]++}`));
  if (unused.length) throw new Error(`워크플로에 연결되지 않은 레퍼런스가 ${unused.length}개 있습니다. 레퍼런스 선택에서 빼거나 설정에서 입력을 연결하세요.`);
  for (const id of config.outputNodeIds) if (!info.nodes.some(node => node.id === id)) throw new Error(`워크플로에서 결과 노드를 찾지 못했습니다: ${id}`);
  return bindings;
}

export interface ComfyRunRequest {
  kind: ComfyKind;
  prompt: string;
  negative?: string;
  references?: ComfyReference[];
  values?: Record<string, ComfyValue>;
  projectName: string;
  assetType: ProjectAssetType;
  ownerName: string;
  stem: string;
  /** 접수할 때 고정합니다. 기다리는 동안 설정을 바꿔도 다른 서버의 작업을 읽지 않습니다. */
  settings?: ComfyGenerationSettings;
  workflowSha256?: string;
  baseDirectory?: string;
  clientId?: string;
  existingPromptId?: string;
  timeoutSecs?: number;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
  onSubmitting?: () => Promise<void>;
  onSubmitted?: (promptId: string) => Promise<void>;
  onCollected?: (files: ComfyOutput[]) => Promise<void>;
}
export async function runComfyToProject(input: ComfyRunRequest): Promise<{ promptId: string; files: ComfyOutput[] }> {
  if (!isDesktopApp()) throw new Error("ComfyUI 생성은 데스크톱 앱에서 실행하세요.");
  const settings = input.settings ?? getComfyGenerationSettings();
  const baseDirectory = input.baseDirectory?.trim() || getMediaLibrarySettings().baseDirectory.trim();
  if (!baseDirectory) throw new Error("프로젝트 저장 폴더를 먼저 설정하세요.");
  const storageKey = (path: string) => path.trim().replace(/\\/g,"/").replace(/\/+$/,"").toLowerCase();
  const assertStorage = () => {
    if (storageKey(getMediaLibrarySettings().baseDirectory) !== storageKey(baseDirectory))
      throw new Error("ComfyUI 작업을 접수한 뒤 저장 폴더가 바뀌었습니다. 원래 저장 폴더로 돌아와 결과를 이어받으세요.");
  };
  assertStorage();
  const config = settings[input.kind];
  let promptId = input.existingPromptId;
  const stopped = () => { if (input.shouldStop?.()) throw new Error("ComfyUI 결과 기다리기를 중지했습니다. 서버 작업은 계속될 수 있습니다. 작업 번호로 다시 확인하세요."); };
  if (!promptId) {
    if (!config.workflowPath) throw new Error("설정에서 ComfyUI 생성 워크플로를 먼저 고르세요.");
    const info = await inspectComfyGenerationWorkflow(config.workflowPath);
    if (input.workflowSha256 && input.workflowSha256 !== info.sha256) throw new Error("접수한 뒤 ComfyUI 워크플로 파일이 변경됐습니다. 다시 검사하고 실행하세요.");
    const bindings = prepareComfyBindings(config, info, input);
    stopped();
    assertStorage();
    input.onProgress?.("ComfyUI 에 레퍼런스와 워크플로를 보내는 중");
    await input.onSubmitting?.();
    stopped();
    assertStorage();
    const result = await invoke<{ promptId: string }>("comfy_submit_generation", { request: {
      baseUrl: settings.baseUrl, workflowPath: config.workflowPath, bindings,
      clientId: input.clientId ?? `aimoviestorage-${crypto.randomUUID()}`,
      expectedWorkflowSha256: info.sha256,
    } });
    promptId = result.promptId;
    await input.onSubmitted?.(promptId);
  }
  const deadline = Date.now() + Math.min(86400, Math.max(1, input.timeoutSecs ?? 7200)) * 1000;
  while (true) {
    stopped();
    const status = await invoke<ComfyStatus>("comfy_generation_status", { baseUrl: settings.baseUrl, promptId });
    if (status.state === "failed") throw new Error(`ComfyUI 생성이 실패했습니다 (${promptId}): ${status.error ?? "서버 실행 오류"}`);
    if (status.state === "completed") break;
    if (Date.now() > deadline) throw new Error(`ComfyUI 대기 시간이 끝났습니다. 서버 작업은 계속될 수 있습니다. 작업 번호: ${promptId}`);
    input.onProgress?.(`ComfyUI 생성 대기 · ${promptId}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  stopped();
  assertStorage();
  input.onProgress?.("ComfyUI 결과를 프로젝트 폴더에 받는 중");
  const files = await invoke<ComfyOutput[]>("comfy_collect_generation", { request: {
    baseUrl: settings.baseUrl, promptId, baseDirectory, projectName: input.projectName,
    assetType: input.assetType, ownerName: input.ownerName, stem: input.stem, kind: input.kind,
    outputNodeIds: config.outputNodeIds,
  } });
  await input.onCollected?.(files);
  return { promptId, files };
}
