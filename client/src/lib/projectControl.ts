import { diffControlValues } from "./controlChanges";
import { copyJsonWithinLimit, sameImmutableJson } from "./immutableJson";
import { controlDetailSchema, projectControlValue, type ControlDetail } from "./controlProjection";
import { z } from "zod";
import { relinkCutCharacterPrompts } from "@/lib/cutCharacterLinks";
import { relinkCharacterBlueprintPrompts } from "@/lib/characterBlueprintPrompt";
import { CHARACTER_BLUEPRINT_GROUPS } from "@/lib/blueprint";
import { appendPromptHistory } from "@/lib/promptHistory";
import { withStoryboardPrompt } from "@/lib/storyboardPromptHistory";
import { applyAppPromptResult } from "@/lib/appPromptRequest";
import { withCutVideoPrompt } from "@/lib/cutVideoPromptHistory";
import { loadProjects, listLocalProjects, getLocalProject, saveLocalProjectAndConfirm } from "@/lib/localProjectStore";
import { readProject, writeProjectAndConfirm } from "@/lib/projectWrite";
import { newProjectDraft, newCharacter, newBackground, newScene, newCut, uid, type ProjectDraft, type Character, type Background } from "@/lib/projectTypes";

const id = z.string().min(1).max(200);
const text = z.string().max(100_000);
const name = z.string().trim().min(1).max(300);
const prompts = { promptKo: text.optional(), promptEn: text.optional(), negativeKo: text.optional(), negativeEn: text.optional() };
const characterBlueprintIds = new Set(CHARACTER_BLUEPRINT_GROUPS.flatMap((group) => group.options.map((item) => item.id)));
const characterBlueprint = z.array(z.string().refine((value) => characterBlueprintIds.has(value), "모르는 캐릭터 구성 항목입니다.")).max(100);
const projectFields = z.object({ title: name.optional(), logline: text.optional(), synopsis: text.optional(), tone: text.optional(), runtime: text.optional(), storyboardNote: text.optional() }).strict();
const characterFields = z.object({ name: name.optional(), role: text.optional(), gender: text.optional(), description: text.optional(), heightCm: z.number().finite().min(1).max(1000).optional(), build: z.enum(["slim", "average", "athletic", "broad"]).optional(), kind: z.enum(["human", "animal", "creature"]).optional(), blueprint: characterBlueprint.optional(), ...prompts }).strict();
const backgroundFields = z.object({ name: name.optional(), location: text.optional(), description: text.optional(), spaceKind: z.enum(["interior", "exterior"]).optional(), ...prompts }).strict();
const sceneFields = z.object({ title: text.optional(), summary: text.optional(), storyboardPromptKo: text.optional(), storyboardPromptEn: text.optional() }).strict();
const cutFields = z.object({ title: text.optional(), description: text.optional(), acting: text.optional(), actingEn: text.optional(), backgroundMotion: text.optional(), backgroundMotionEn: text.optional(), vfx: text.optional(), vfxEn: text.optional(), plannedSeconds: z.number().finite().positive().max(3600).optional(), characterIds: z.array(id).max(100).optional(), backgroundId: id.optional(), useComposition: z.boolean().optional(), useRefVideo: z.boolean().optional(), videoPromptKo: text.optional(), videoPromptEn: text.optional(), ...prompts }).strict();
export const appPromptTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), id }).strict(),
  z.object({ kind: z.literal("background"), id }).strict(),
  z.object({ kind: z.literal("cutImage"), sceneId: id, cutId: id }).strict(),
  z.object({ kind: z.literal("cutVideo"), sceneId: id, cutId: id }).strict(),
  z.object({ kind: z.literal("sceneVideo"), sceneId: id }).strict(),
]);
const appPromptResultSchema = z.object({
  ko: text.min(1), en: text.min(1), negativeKo: text, negativeEn: text,
}).strict();

export const projectCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt.apply"), target: appPromptTargetSchema, result: appPromptResultSchema }).strict(),
  z.object({ type: z.literal("project.update"), fields: projectFields }).strict(),
  z.object({ type: z.literal("character.add"), id: id.optional(), fields: characterFields.extend({ name }) }).strict(),
  z.object({ type: z.literal("character.update"), id, fields: characterFields }).strict(),
  z.object({ type: z.literal("background.add"), id: id.optional(), fields: backgroundFields.extend({ name }) }).strict(),
  z.object({ type: z.literal("background.update"), id, fields: backgroundFields }).strict(),
  z.object({ type: z.literal("scene.add"), id: id.optional(), fields: sceneFields }).strict(),
  z.object({ type: z.literal("scene.update"), id, fields: sceneFields }).strict(),
  // 인물이 없는 컷도 [] 를 명시합니다. 빠뜨린 요청을 조용히 저장하면 시트·@태그가 끊깁니다.
  z.object({ type: z.literal("cut.add"), id: id.optional(), sceneId: id, fields: cutFields.extend({ characterIds: z.array(id).max(100) }) }).strict(),
  z.object({ type: z.literal("cut.update"), id, sceneId: id, fields: cutFields }).strict(),
]);
export const projectReadSchema = z.object({ projectId: id, detail: controlDetailSchema }).strict();
export const projectUpdateSchema = projectReadSchema.extend({ expectedRevision: z.string().min(1).max(200), commands: z.array(projectCommandSchema).min(1).max(100) });
export const projectCreateSchema = projectFields.extend({ title: name, operationId: z.string().min(1).max(300), detail: controlDetailSchema });
export const projectChangesSchema = projectReadSchema.extend({ sinceRevision: z.string().min(1).max(200) });
export const projectReadJsonSchema = z.toJSONSchema(projectReadSchema);
export const projectUpdateJsonSchema = z.toJSONSchema(projectUpdateSchema);
export const projectCreateJsonSchema = z.toJSONSchema(projectCreateSchema);
export const projectChangesJsonSchema = z.toJSONSchema(projectChangesSchema);
export type ProjectCommand = z.infer<typeof projectCommandSchema>;

export class ProjectControlError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = "ProjectControlError"; }
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProjectControlError("invalid_request", "프로젝트 요청 형식이 맞지 않습니다.", parsed.error.issues);
  return parsed.data;
}
let ready: Promise<unknown> | null = null;
const ensureReady = () => ready ??= loadProjects();
const sessionId = uid();
let revisionNumber = 0;
const nextRevision = () => `${sessionId}:${++revisionNumber}`;
const HISTORY_LIMIT = 64;
const DIFF_LIMIT = 200;
const HISTORY_ENTRY_SIZE = 200_000;
export interface ProjectChange {
  revision: string;
  source: "app" | "controller";
  path: string;
  before: unknown;
  after: unknown;
  truncated?: boolean;
}
interface Observation { draft: ProjectDraft; revision: string; history: Array<{ from: string; to: string; changes: ProjectChange[]; truncated: boolean }> }
const observations = new Map<string, Observation>();
const working = new Set<string>();
interface PendingControllerEdit { applied: boolean; observed: boolean; changes: ReturnType<typeof diffControlValues> }
const pendingControllerEdits = new Map<string, PendingControllerEdit>();
let navigation: ((projectId: string) => void) | null = null;

/** 앱 변경은 수동 편집과 자동 결과를 포함합니다. 키 입력마다의 행위 로그나 작성자 추정은 하지 않습니다. */
function observe(projectId: string, draft: ProjectDraft, source: "app" | "controller" = "app"): Observation {
  // 화면의 patch·컷/구도 저장은 바뀐 경로를 새 객체로 만듭니다. 전체 모캡을 복제하면
  // 요약 조회만으로도 수백 MB 문자열·사본이 생깁니다. 큰 불변 가지는 공유하되 루트는
  // 얕게 남겨 같은 루트 객체의 제목/배열 교체도 다음 조회에서 놓치지 않습니다.
  const copy = { ...draft };
  const previous = observations.get(projectId);
  if (!previous) {
    const made = { draft: copy, revision: nextRevision(), history: [] };
    observations.set(projectId, made);
    return made;
  }
  if (sameImmutableJson(previous.draft, copy)) return previous;
  const revision = nextRevision();
  const pending = pendingControllerEdits.get(projectId);
  const attributePending = source === "app" && pending?.applied && !pending.observed;
  const changes = diffControlValues(previous.draft, copy).map((change) => {
    // 파일 쓰기를 기다리는 동안 UI 수정과 조회가 들어올 수 있습니다. 실제 최신 판에서
    // 그 요청과 일치하는 변경만 구분하며, 저장 완료 후 옛 판을 재관찰해 되감지 않습니다.
    const controllerChange = attributePending && pending.changes.some((expected) =>
      expected.path === change.path && sameImmutableJson(expected.before, change.before)
      && sameImmutableJson(expected.after, change.after));
    return { ...change, revision, source: controllerChange ? "controller" as const : source };
  });
  if (attributePending) pending.observed = true;
  // 200개 항목 각각이 작아도 64판을 쌓으면 다시 커집니다. 기록 전체의 상한도 두고
  // 넘친 판은 전체 상태 재조회를 요구합니다. 실제 초안과 충돌 검사는 줄이지 않습니다.
  const bounded = copyJsonWithinLimit(changes, HISTORY_ENTRY_SIZE);
  const next = { draft: copy, revision, history: [...previous.history, { from: previous.revision, to: revision,
    changes: bounded.value ?? [], truncated: bounded.exceeded || changes.length >= DIFF_LIMIT || changes.some((change) => change.truncated) }].slice(-HISTORY_LIMIT) };
  observations.set(projectId, next);
  return next;
}
function requireDraft(projectId: string) {
  const draft = readProject(projectId);
  if (!draft) throw new ProjectControlError("project_not_found", "프로젝트를 찾지 못했습니다. 목록을 다시 읽어 주세요.");
  return draft;
}
function snapshot(projectId: string, state: Observation, detail: ControlDetail = "full") {
  const projected = projectControlValue(state.draft, detail);
  return { projectId, revision: state.revision, draft: projected.value, projection: projected.projection };
}
export async function listProjectsControl() {
  await ensureReady();
  return listLocalProjects().map((item) => ({ ...item, title: readProject(item.id)?.title ?? item.title }));
}
export async function getProjectSnapshot(projectId: string, detail: ControlDetail = "full") {
  await ensureReady();
  const request = parse(projectReadSchema, { projectId, detail });
  return snapshot(projectId, observe(projectId, requireDraft(request.projectId)), request.detail);
}
export async function getProjectChanges(input: unknown) {
  const request = parse(projectChangesSchema, input);
  await ensureReady();
  const state = observe(request.projectId, requireDraft(request.projectId));
  if (request.sinceRevision === state.revision) return { projectId: request.projectId, revision: state.revision, changes: [] as ProjectChange[], fullSnapshotRequired: false };
  const start = state.history.findIndex((entry) => entry.from === request.sinceRevision);
  const entries = start < 0 ? [] : state.history.slice(start);
  const fullSnapshotRequired = start < 0 || entries.some((entry) => entry.truncated);
  const projected = projectControlValue(entries.flatMap((entry) => entry.changes), request.detail);
  return { projectId: request.projectId, revision: state.revision, changes: projected.value, projection: projected.projection,
    fullSnapshotRequired: fullSnapshotRequired || projected.projection.truncated,
    ...(fullSnapshotRequired ? { snapshot: snapshot(request.projectId, state, request.detail) } : {}) };
}
function replaceById<T extends { id: string }>(items: T[], target: string, update: (item: T) => T): T[] {
  if (!items.some((item) => item.id === target)) throw new ProjectControlError("target_not_found", `대상 ${target} 을 찾지 못했습니다.`);
  return items.map((item) => item.id === target ? update(item) : item);
}
function checkNewId(draft: ProjectDraft, target: string) {
  const all = [...draft.characters, ...draft.backgrounds, ...draft.scenes, ...draft.scenes.flatMap((scene) => scene.cuts)];
  if (all.some((item) => item.id === target)) throw new ProjectControlError("duplicate_id", `이미 쓰고 있는 대상 열쇠입니다: ${target}`);
}
function checkOwnerRename(owner: Character | Background, nextName?: string) {
  if (!nextName || nextName === owner.name) return;
  if ([owner.generatedImages, owner.refImages, owner.variations, owner.assets, owner.alternates].some((items) => items?.length))
    throw new ProjectControlError("rename_requires_ui", "그림이나 변형이 있는 인물·장소의 이름은 앱에서 바꿔 주세요. 폴더 이름 확인이 필요합니다.");
}
function checkCutReferences(draft: ProjectDraft, fields: z.infer<typeof cutFields>) {
  if (fields.characterIds?.some((value) => !draft.characters.some((item) => item.id === value))) throw new ProjectControlError("invalid_reference", "컷에서 참조할 인물을 찾지 못했습니다.");
  if (fields.backgroundId && !draft.backgrounds.some((item) => item.id === fields.backgroundId)) throw new ProjectControlError("invalid_reference", "컷에서 참조할 장소를 찾지 못했습니다.");
}
function checkKoreanPrompt(value: string, field: string) {
  if (!value.trim()) return;
  // @파일명·모델 ID에는 영문이 섞일 수 있습니다. 그 부분을 빼고 본문이
  // 대부분 영어면 한글 칸을 채웠다고 보지 않습니다.
  const prose = value.replace(/@[^\s,;]+/g, "");
  const korean = (prose.match(/[가-힣]/g) ?? []).length;
  const latin = (prose.match(/[A-Za-z]/g) ?? []).length;
  if (!korean || korean / (korean + latin) < 0.4)
    throw new ProjectControlError("korean_prompt_required", `${field}에는 한국어로 쓴 프롬프트를 넣어 주세요.`);
}
function checkCutPromptLanguages(current: ReturnType<typeof newCut>, fields: z.infer<typeof cutFields>) {
  const next = { ...current, ...fields };
  for (const [ko, en] of [["promptKo", "promptEn"], ["negativeKo", "negativeEn"], ["videoPromptKo", "videoPromptEn"]] as const) {
    if (!(ko in fields) && !(en in fields)) continue;
    if (Boolean(next[ko]?.trim()) !== Boolean(next[en]?.trim()))
      throw new ProjectControlError("bilingual_prompt_required", `컷의 ${ko}와 ${en}을 함께 채우거나 함께 비워 주세요.`);
    checkKoreanPrompt(next[ko] ?? "", `컷의 ${ko}`);
  }
}
function checkCharacterPromptLanguages(current: Character, fields: z.infer<typeof characterFields>) {
  const next = { ...current, ...fields };
  for (const [ko, en] of [["promptKo", "promptEn"], ["negativeKo", "negativeEn"]] as const) {
    if (!(ko in fields) && !(en in fields)) continue;
    if (Boolean(next[ko]?.trim()) !== Boolean(next[en]?.trim()))
      throw new ProjectControlError("bilingual_prompt_required", `캐릭터의 ${ko}와 ${en}을 함께 채우거나 함께 비워 주세요.`);
    checkKoreanPrompt(next[ko] ?? "", `캐릭터의 ${ko}`);
  }
}
function checkScenePromptLanguages(current: ReturnType<typeof newScene>, fields: z.infer<typeof sceneFields>) {
  if (!("storyboardPromptKo" in fields) && !("storyboardPromptEn" in fields)) return;
  const next = { ...current, ...fields };
  if (Boolean(next.storyboardPromptKo?.trim()) !== Boolean(next.storyboardPromptEn?.trim()))
    throw new ProjectControlError("bilingual_prompt_required", "장면의 스토리보드 한글·영문 프롬프트를 함께 채우거나 함께 비워 주세요.");
  checkKoreanPrompt(next.storyboardPromptKo ?? "", "장면의 스토리보드 한글 프롬프트");
}

/** 조종기가 네 칸을 직접 써도 API 버튼과 같은 선반에 이전 판·새 판을 남깁니다. */
function recordControlPrompt<T extends { promptKo?: string; promptEn?: string; negativeKo?: string; negativeEn?: string; promptHistory?: ReturnType<typeof appendPromptHistory> }>(
  current: T, next: T, fields: object,
): T {
  if (!["promptKo", "promptEn", "negativeKo", "negativeEn"].some((key) => key in fields)) return next;
  const body = (item: T) => ({
    ko: item.promptKo || "", en: item.promptEn || "",
    negativeKo: item.negativeKo || "", negativeEn: item.negativeEn || "",
  });
  let history = current.promptHistory;
  if (current.promptKo?.trim() || current.promptEn?.trim())
    history = appendPromptHistory(history, { ...body(current), note: "덮어쓰기 전" });
  history = appendPromptHistory(history, { ...body(next), note: "대화 조종기" });
  return { ...next, promptHistory: history };
}

/** 새 ID는 호출 바깥에서 정합니다. React가 같은 갱신 함수를 다시 계산해도 다른 카드를 만들면 안 됩니다. */
export function applyProjectCommands(current: ProjectDraft, commands: ProjectCommand[]): ProjectDraft {
  return commands.reduce((draft, command) => {
    if (command.type === "project.update") return { ...draft, ...command.fields };
    if (command.type !== "prompt.apply" && command.type.endsWith(".add")) {
      if (!command.id) throw new ProjectControlError("invalid_request", "추가할 대상의 열쇠가 없습니다.");
      checkNewId(draft, command.id);
    }
    switch (command.type) {
      case "prompt.apply": {
        checkKoreanPrompt(command.result.ko, "조종기 한글 프롬프트");
        const target = command.target;
        const exists = target.kind === "character" ? draft.characters.some((item) => item.id === target.id)
          : target.kind === "background" ? draft.backgrounds.some((item) => item.id === target.id)
          : target.kind === "sceneVideo" ? draft.scenes.some((item) => item.id === target.sceneId)
          : draft.scenes.some((scene) => scene.id === target.sceneId && scene.cuts.some((cut) => cut.id === target.cutId));
        if (!exists) throw new ProjectControlError("target_not_found", "프롬프트를 적용할 카드를 찾지 못했습니다.");
        return applyAppPromptResult(draft, target, command.result);
      }
      case "character.add": {
        const base = newCharacter();
        checkCharacterPromptLanguages(base, command.fields);
        const next = relinkCharacterBlueprintPrompts({ ...base, ...command.fields, id: command.id! });
        return { ...draft, characters: [...draft.characters, recordControlPrompt(base, next, command.fields)] };
      }
      case "character.update": return { ...draft, characters: replaceById(draft.characters, command.id, (item) => {
        checkOwnerRename(item, command.fields.name);
        checkCharacterPromptLanguages(item, command.fields);
        const next = { ...item, ...command.fields };
        const linked = command.fields.blueprint || "promptKo" in command.fields || "promptEn" in command.fields
          ? relinkCharacterBlueprintPrompts(next) : next;
        return recordControlPrompt(item, linked, command.fields);
      }) };
      case "background.add": {
        const base = newBackground(command.fields.spaceKind);
        return { ...draft, backgrounds: [...draft.backgrounds, recordControlPrompt(base, { ...base, ...command.fields, id: command.id! }, command.fields)] };
      }
      case "background.update": return { ...draft, backgrounds: replaceById(draft.backgrounds, command.id, (item) => { checkOwnerRename(item, command.fields.name); return recordControlPrompt(item, { ...item, ...command.fields }, command.fields); }) };
      case "scene.add": {
        const base = newScene();
        checkScenePromptLanguages(base, command.fields);
        const next = { ...base, ...command.fields, id: command.id!, cuts: [] };
        const prompt = "storyboardPromptKo" in command.fields || "storyboardPromptEn" in command.fields
          ? withStoryboardPrompt(base, { ko: next.storyboardPromptKo || "", en: next.storyboardPromptEn || "" }, "대화 조종기") : {};
        return { ...draft, scenes: [...draft.scenes, { ...next, ...prompt }] };
      }
      case "scene.update": return { ...draft, scenes: replaceById(draft.scenes, command.id, (item) => {
        checkScenePromptLanguages(item, command.fields);
        const next = { ...item, ...command.fields };
        return "storyboardPromptKo" in command.fields || "storyboardPromptEn" in command.fields
          ? { ...next, ...withStoryboardPrompt(item, { ko: next.storyboardPromptKo || "", en: next.storyboardPromptEn || "" }, "대화 조종기") } : next;
      }) };
      case "cut.add":
        checkCutReferences(draft, command.fields);
        checkCutPromptLanguages(newCut(1), command.fields);
        return { ...draft, scenes: replaceById(draft.scenes, command.sceneId, (scene) => {
          const base = newCut(scene.cuts.length + 1);
          const next = relinkCutCharacterPrompts({ ...base, ...command.fields, id: command.id! }, draft.characters, draft.backgrounds);
          const recorded = recordControlPrompt(base, next, command.fields);
          const video = "videoPromptKo" in command.fields || "videoPromptEn" in command.fields
            ? withCutVideoPrompt(base, { ko: recorded.videoPromptKo || "", en: recorded.videoPromptEn || "" }, "대화 조종기") : {};
          return { ...scene, cuts: [...scene.cuts, { ...recorded, ...video }] };
        }) };
      case "cut.update":
        checkCutReferences(draft, command.fields);
        return { ...draft, scenes: replaceById(draft.scenes, command.sceneId, (scene) => ({ ...scene, cuts: replaceById(scene.cuts, command.id, (cut) => {
          checkCutPromptLanguages(cut, command.fields);
          const next = { ...cut, ...command.fields };
          // 인물을 고른 요청에만 잇습니다. 길이·대사 수정만으로 옛 컷의 잘못된 캐스팅을 확정하지 않습니다.
          const linked = command.fields.characterIds ? relinkCutCharacterPrompts(next, draft.characters, draft.backgrounds) : next;
          const recorded = recordControlPrompt(cut, linked, command.fields);
          const video = "videoPromptKo" in command.fields || "videoPromptEn" in command.fields
            ? withCutVideoPrompt(cut, { ko: recorded.videoPromptKo || "", en: recorded.videoPromptEn || "" }, "대화 조종기") : {};
          return { ...recorded, ...video };
        }) })) };
    }
  }, current);
}

export async function updateProjectControl(input: unknown) {
  const request = parse(projectUpdateSchema, input);
  await ensureReady();
  if (working.has(request.projectId)) throw new ProjectControlError("project_busy", "이 프로젝트의 앞선 편집이 저장 중입니다.");
  working.add(request.projectId);
  try {
    const state = observe(request.projectId, requireDraft(request.projectId));
    if (request.expectedRevision !== state.revision) throw new ProjectControlError("revision_conflict", "그 사이 프로젝트가 바뀌었습니다. 변경 내역을 읽은 뒤 다시 적용해 주세요.", { expectedRevision: request.expectedRevision, actualRevision: state.revision });
    const commands = request.commands.map((command) => command.type !== "project.update" && command.type !== "prompt.apply" && command.type.endsWith(".add") && !command.id ? { ...command, id: uid() } : command);
    const preview = applyProjectCommands(state.draft, commands);
    const pending: PendingControllerEdit = { applied: false, observed: false, changes: diffControlValues(state.draft, preview) };
    pendingControllerEdits.set(request.projectId, pending);
    let conflicted = false;
    const outcome = await writeProjectAndConfirm(request.projectId, (current) => {
      // React 계산 중 예외를 던지면 편집 화면 전체가 닫힙니다. 아무것도 바꾸지 않고 호출자에게 충돌을 알립니다.
      if (!sameImmutableJson(current, state.draft)) { conflicted = true; return {}; }
      pending.applied = true;
      return preview;
    });
    if (conflicted) {
      const latest = observe(request.projectId, requireDraft(request.projectId));
      throw new ProjectControlError("revision_conflict", "적용 직전에 프로젝트가 바뀌었습니다. 최신 상태를 다시 읽어 주세요.", { actualRevision: latest.revision });
    }
    const latest = observe(request.projectId, requireDraft(request.projectId));
    if (!outcome.persisted) throw new ProjectControlError("save_failed", outcome.why || "편집 내용을 파일에 저장하지 못했습니다.", { applied: Boolean(outcome.draft), snapshot: snapshot(request.projectId, latest, request.detail) });
    return { ...snapshot(request.projectId, latest, request.detail), persisted: true, created: commands.flatMap((command) => command.type !== "prompt.apply" && command.type.endsWith(".add") && "id" in command ? [{ type: command.type, id: command.id }] : []) };
  } finally { working.delete(request.projectId); pendingControllerEdits.delete(request.projectId); }
}

interface CreationDraft extends ProjectDraft { controllerCreation?: { fingerprint: string } }
export async function createProjectControl(input: unknown) {
  const request = parse(projectCreateSchema, input);
  await ensureReady();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.operationId));
  const projectId = `control-${[...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  if (working.has(projectId)) throw new ProjectControlError("project_busy", "이 프로젝트를 만드는 중입니다. 같은 요청으로 다시 확인해 주세요.");
  working.add(projectId);
  try {
    const { operationId: _operation, detail: _detail, ...fields } = request;
    const fingerprint = JSON.stringify(fields);
    const existing = getLocalProject(projectId);
    if (existing) {
      if ((existing.draft as unknown as CreationDraft).controllerCreation?.fingerprint !== fingerprint) throw new ProjectControlError("operation_conflict", "같은 생성 요청 열쇠에 다른 내용이 들어왔습니다.");
      const confirmation = await saveLocalProjectAndConfirm(requireDraft(projectId), projectId);
      if (confirmation.outcome !== "written" && confirmation.outcome !== "same") throw new ProjectControlError("save_failed", "새 프로젝트의 파일 저장을 확인하지 못했습니다.", { outcome: confirmation.outcome });
      return { ...snapshot(projectId, observe(projectId, requireDraft(projectId)), request.detail), persisted: true, reused: true };
    }
    const draft: CreationDraft = { ...newProjectDraft(), ...fields, controllerCreation: { fingerprint } };
    const saved = await saveLocalProjectAndConfirm(draft, projectId);
    if (saved.outcome !== "written" && saved.outcome !== "same") throw new ProjectControlError("save_failed", "새 프로젝트를 저장하지 못했습니다.", { outcome: saved.outcome });
    return { ...snapshot(projectId, observe(projectId, requireDraft(projectId), "controller"), request.detail), persisted: true, reused: false };
  } finally { working.delete(projectId); }
}

export function registerProjectNavigation(navigate: (projectId: string) => void): () => void {
  navigation = navigate;
  return () => { if (navigation === navigate) navigation = null; };
}
export async function openProjectControl(projectId: string) {
  const current = await getProjectSnapshot(projectId, "summary");
  if (!navigation) throw new ProjectControlError("navigation_unavailable", "프로젝트 화면 연결이 준비되지 않았습니다.");
  navigation(projectId);
  return { projectId: current.projectId, opened: true };
}
