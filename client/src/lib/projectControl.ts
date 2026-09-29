import { diffControlValues } from "./controlChanges";
import { copyJsonWithinLimit, sameImmutableJson } from "./immutableJson";
import { controlDetailSchema, projectControlValue, type ControlDetail } from "./controlProjection";
import { z } from "zod";
import { relinkCutCharacterPrompts } from "@/lib/cutCharacterLinks";
import { ensureVoicePrompt } from "@/lib/characterVoice";
import { relinkCharacterBlueprintPrompts } from "@/lib/characterBlueprintPrompt";
import { BACKGROUND_BLUEPRINT_GROUPS, CHARACTER_BLUEPRINT_GROUPS } from "@/lib/blueprint";
import { appendPromptHistory } from "@/lib/promptHistory";
import { appendAnalysisHistory } from "@/lib/promptHistory";
import { withStoryboardPrompt } from "@/lib/storyboardPromptHistory";
import { applyAppPromptResult } from "@/lib/appPromptRequest";
import { withCutVideoPrompt } from "@/lib/cutVideoPromptHistory";
import { IMAGE_ONLY_MODELS } from "@/lib/promptLibrary";
import { ERA_PRESETS, GENRE_OPTIONS, STYLE_OPTIONS } from "@/lib/projectContext";
import { targetModelOf } from "@/lib/modelRules";
import { captureRoomPreset } from "@/lib/roomPreset";
import { collectSheetSources } from "@/components/sheet/sheetSources";
import { loadProjects, listLocalProjects, getLocalProject, saveLocalProjectAndConfirm } from "@/lib/localProjectStore";
import { readProject, writeProjectAndConfirm } from "@/lib/projectWrite";
import { newProjectDraft, newCharacter, newBackground, newScene, newCut, uid, type ProjectDraft, type Character, type Background } from "@/lib/projectTypes";

const id = z.string().min(1).max(200);
const text = z.string().max(100_000);
const name = z.string().trim().min(1).max(300);
const prompts = { promptKo: text.optional(), promptEn: text.optional(), negativeKo: text.optional(), negativeEn: text.optional() };
const characterBlueprintIds = new Set(CHARACTER_BLUEPRINT_GROUPS.flatMap((group) => group.options.map((item) => item.id)));
const characterBlueprint = z.array(z.string().refine((value) => characterBlueprintIds.has(value), "모르는 캐릭터 구성 항목입니다.")).max(100);
const backgroundBlueprintIds = BACKGROUND_BLUEPRINT_GROUPS.flatMap((group) => group.options.map((item) => item.id)) as [string, ...string[]];
const backgroundBlueprint = z.array(z.enum(backgroundBlueprintIds)).max(100);
const imageModel = z.string().refine((value) => IMAGE_ONLY_MODELS.some((model) => model.id === value), "앱에서 지원하는 이미지 모델을 고르세요.");
const videoModel = z.string().refine((value) => targetModelOf(value)?.kind === "video", "앱에서 지원하는 영상 모델을 고르세요.");
const roomSize = z.object({ width: z.number().finite().min(0.4).max(400), depth: z.number().finite().min(0.4).max(400), height: z.number().finite().min(0.4).max(400).optional() }).strict();
const profileFields = z.object({ callName: text.optional(), age: text.optional(), mbti: text.optional(), tagline: text.optional(), personality: text.optional(), speech: text.optional(), habits: text.optional(), background: text.optional(), directing: text.optional() }).strict();
const projectFields = z.object({ title: name.optional(), logline: text.optional(), synopsis: text.optional(), tone: text.optional(), runtime: text.optional(), storyboardNote: text.optional(), videoModel: videoModel.optional(),
  genres: z.array(z.string().refine((value) => GENRE_OPTIONS.includes(value), "모르는 장르입니다.")).max(30).optional(),
  styles: z.array(z.string().refine((value) => STYLE_OPTIONS.includes(value), "모르는 스타일입니다.")).max(30).optional(),
  eras: z.array(z.string().refine((value) => ERA_PRESETS.some((item) => item.id === value), "모르는 시대입니다.")).max(30).optional(),
  eraRanges: z.array(z.object({ id, from: text, to: text }).strict()).max(100).optional(),
  eraUnspecified: z.boolean().optional(),
}).strict();
const workflowFields = { referenceMode: z.enum(["none", "keep", "blend"]).optional(), analysis: text.optional(), analysisEn: text.optional(), firstReferencePromptKo: text.optional(), firstReferencePromptEn: text.optional(), firstReferenceModel: imageModel.optional() };
const characterFields = z.object({ name: name.optional(), role: text.optional(), gender: text.optional(), description: text.optional(), voiceDescription: text.optional(), voiceDescriptionEn: text.optional(), heightCm: z.number().finite().min(1).max(1000).optional(), build: z.enum(["slim", "average", "athletic", "broad"]).optional(), kind: z.enum(["human", "animal", "creature"]).optional(), blueprint: characterBlueprint.optional(), promptModel: imageModel.optional(), ...workflowFields, ...prompts }).strict();
const backgroundFields = z.object({ name: name.optional(), location: text.optional(), description: text.optional(), spaceKind: z.enum(["interior", "exterior", "mixed"]).optional(), usage: z.enum(["wall", "dome"]).optional(), panoramaSpace: roomSize.optional(), exteriorSpace: roomSize.optional(), faceMarkSourceId: id.optional(), blueprint: backgroundBlueprint.optional(), promptModel: imageModel.optional(), ...workflowFields, ...prompts }).strict();
const sceneFields = z.object({ title: text.optional(), summary: text.optional(), storyboardPromptKo: text.optional(), storyboardPromptEn: text.optional() }).strict();
const cutFields = z.object({ cutContinuity: z.enum(["independent", "continue", "same-space-new-angle"]).optional(), title: text.optional(), description: text.optional(), acting: text.optional(), actingEn: text.optional(), backgroundMotion: text.optional(), backgroundMotionEn: text.optional(), vfx: text.optional(), vfxEn: text.optional(), plannedSeconds: z.number().finite().positive().max(3600).optional(), characterIds: z.array(id).max(100).optional(), backgroundId: id.optional(), characterRefs: z.record(id, z.array(z.string().min(1).max(4000)).max(8)).optional(), styleTags: z.array(z.string().min(1).max(200)).max(100).optional(), techniques: z.array(z.string().min(1).max(200)).max(100).optional(), useComposition: z.boolean().optional(), useRefVideo: z.boolean().optional(), videoPromptKo: text.optional(), videoPromptEn: text.optional(), ...prompts }).strict();
const referenceOwner = z.object({ kind: z.enum(["character", "background"]), id }).strict();
const sheetPlacement = z.object({ id, kind: z.enum(["image", "profile"]).optional(),
  x: z.number().int().min(0).max(12000), y: z.number().int().min(0).max(12000),
  width: z.number().int().min(1).max(12000), height: z.number().int().min(1).max(12000),
  fontSize: z.number().int().min(1).max(1000).optional(), label: z.string().max(300).optional() }).strict();
const sheetSize = z.object({ width: z.number().int().min(512).max(12000), height: z.number().int().min(512).max(12000) }).strict();
const imageMark = z.object({ id, shape: z.enum(["rect", "ellipse", "free", "anchor"]), note: text,
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(1000),
  motion: z.boolean().optional() }).strict().superRefine((mark, context) => {
  if (mark.motion && mark.shape === "anchor") context.addIssue({ code: "custom", message: "점 앵커는 움직임 구역이 될 수 없습니다." });
  if (mark.shape !== "free" && mark.points.length !== 2) context.addIssue({ code: "custom", message: "사각형·타원·앵커에는 두 점이 필요합니다." });
});
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
  z.object({ type: z.literal("character.profile"), id, fields: profileFields }).strict(),
  z.object({ type: z.literal("background.add"), id: id.optional(), fields: backgroundFields.extend({ name }) }).strict(),
  z.object({ type: z.literal("background.update"), id, fields: backgroundFields }).strict(),
  z.object({ type: z.literal("reference.link"), owner: referenceOwner, sourceAssetId: id, position: z.enum(["first", "last"]).default("last"), label: z.string().max(500).optional() }).strict(),
  z.object({ type: z.literal("reference.move"), owner: referenceOwner, referenceId: id, position: z.number().int().min(0).max(1000) }).strict(),
  z.object({ type: z.literal("reference.label"), owner: referenceOwner, referenceId: id, label: z.string().max(500) }).strict(),
  z.object({ type: z.literal("reference.unlink"), owner: referenceOwner, referenceId: id }).strict(),
  z.object({ type: z.literal("image.marks"), assetId: id, marks: z.array(imageMark).max(200) }).strict(),
  z.object({ type: z.literal("sheet.layout.upsert"), id, name, size: sheetSize,
    captions: z.boolean().optional(), placements: z.array(sheetPlacement).min(1).max(100) }).strict(),
  z.object({ type: z.literal("sheet.fill"), owner: referenceOwner, layoutId: id,
    fills: z.record(id, id).refine((value) => Object.keys(value).length <= 100, "시트 칸은 100개까지 지정할 수 있습니다.") }).strict(),
  z.object({ type: z.literal("room_preset.save_from_cut"), sceneId: id, cutId: id, roomId: id,
    id: id.optional(), name: name.optional() }).strict(),
  z.object({ type: z.literal("room_preset.remove"), id }).strict(),
  z.object({ type: z.literal("scene.add"), id: id.optional(), fields: sceneFields }).strict(),
  z.object({ type: z.literal("scene.update"), id, fields: sceneFields }).strict(),
  z.object({ type: z.literal("scene.move"), id, position: z.number().int().min(0).max(10000) }).strict(),
  // 인물이 없는 컷도 [] 를 명시합니다. 빠뜨린 요청을 조용히 저장하면 시트·@태그가 끊깁니다.
  z.object({ type: z.literal("cut.add"), id: id.optional(), sceneId: id, fields: cutFields.extend({ characterIds: z.array(id).max(100) }) }).strict(),
  z.object({ type: z.literal("cut.update"), id, sceneId: id, fields: cutFields }).strict(),
  z.object({ type: z.literal("cut.move"), id, sceneId: id, position: z.number().int().min(0).max(10000) }).strict(),
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
type AddCommand = Extract<ProjectCommand, { type: "character.add" | "background.add" | "scene.add" | "cut.add" }>;
function isAddCommand(command: ProjectCommand): command is AddCommand {
  return command.type === "character.add" || command.type === "background.add" || command.type === "scene.add" || command.type === "cut.add";
}

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
  if (fields.characterRefs) for (const [characterId, paths] of Object.entries(fields.characterRefs)) {
    const owner = draft.characters.find((item) => item.id === characterId);
    if (!owner || (fields.characterIds && !fields.characterIds.includes(characterId)))
      throw new ProjectControlError("invalid_reference", "컷의 인물 레퍼런스는 등장 인물만 고를 수 있습니다.");
    const permitted = new Set([...owner.generatedImages, ...owner.refImages, ...owner.variations.flatMap((item) => [...item.generatedImages, ...item.references])].map((item) => item.filePath).filter(Boolean));
    if (paths.some((path) => !permitted.has(path)))
      throw new ProjectControlError("invalid_reference", "컷 인물 레퍼런스는 해당 인물의 저장된 이미지만 고를 수 있습니다.");
  }
}
function moveById<T extends { id: string }>(items: T[], target: string, position: number): T[] {
  const at = items.findIndex((item) => item.id === target);
  if (at < 0) throw new ProjectControlError("target_not_found", `대상 ${target} 을 찾지 못했습니다.`);
  if (position >= items.length) throw new ProjectControlError("invalid_position", "이동할 위치가 목록 범위를 벗어났습니다.");
  const next = [...items];
  const [item] = next.splice(at, 1);
  next.splice(position, 0, item);
  return next;
}
function checkBackgroundReferences(item: Background, fields: z.infer<typeof backgroundFields>) {
  if (fields.faceMarkSourceId && !item.generatedImages.some((image) => image.id === fields.faceMarkSourceId))
    throw new ProjectControlError("invalid_reference", "표시 원본은 이 장소의 이미지에서 고르세요.");
}
function imagePathForMark(draft: ProjectDraft, assetId: string): string {
  const assets = [
    ...draft.characters.flatMap((item) => [...item.generatedImages, ...item.references]),
    ...draft.backgrounds.flatMap((item) => [...item.generatedImages, ...item.references]),
    ...draft.scenes.flatMap((scene) => scene.cuts.flatMap((cut) => cut.images)),
  ];
  const found = assets.find((item) => item.id === assetId);
  if (!found?.filePath) throw new ProjectControlError("invalid_reference", "표시할 그림은 이 프로젝트에 저장된 이미지 ID로 고르세요.");
  return found.filePath;
}
function updateReferenceOwner(draft: ProjectDraft, owner: { kind: "character" | "background"; id: string }, update: (item: Character | Background) => Character | Background): ProjectDraft {
  if (owner.kind === "character") return { ...draft, characters: replaceById(draft.characters, owner.id, (item) => update(item) as Character) };
  return { ...draft, backgrounds: replaceById(draft.backgrounds, owner.id, (item) => update(item) as Background) };
}
function withWorkflowUpdates<T extends { analysis?: string; analysisHistory?: ReturnType<typeof appendAnalysisHistory> }>(current: T, next: T, fields: object): T {
  let updated = next;
  if ("analysis" in fields && next.analysis?.trim()) {
    let history = current.analysisHistory;
    if (current.analysis?.trim()) history = appendAnalysisHistory(history, { text: current.analysis, note: "덮어쓰기 전" });
    updated = { ...updated, analysisHistory: appendAnalysisHistory(history, { text: next.analysis, note: "대화 조종기" }) };
  }
  return updated;
}
export function checkKoreanPrompt(value: string, field: string) {
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
function checkBackgroundPromptLanguages(current: Background, fields: z.infer<typeof backgroundFields>) {
  const next = { ...current, ...fields };
  for (const [ko, en] of [["promptKo", "promptEn"], ["negativeKo", "negativeEn"]] as const) {
    if (!(ko in fields) && !(en in fields)) continue;
    if (Boolean(next[ko]?.trim()) !== Boolean(next[en]?.trim()))
      throw new ProjectControlError("bilingual_prompt_required", `장소의 ${ko}와 ${en}을 함께 채우거나 함께 비워 주세요.`);
    checkKoreanPrompt(next[ko] ?? "", `장소의 ${ko}`);
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
    if (command.type === "project.update") {
      const { videoModel: chosenVideoModel, ...fields } = command.fields;
      return { ...draft, ...fields,
        ...(fields.genres === undefined ? {} : { genre: fields.genres.join(", ") }),
        ...(fields.styles === undefined ? {} : { style: fields.styles.join(", ") }),
        ...(chosenVideoModel === undefined ? {} : { magnific: { ...draft.magnific, videoModel: chosenVideoModel } }) };
    }
    if (isAddCommand(command)) {
      if (!command.id) throw new ProjectControlError("invalid_request", "추가할 대상의 열쇠가 없습니다.");
      checkNewId(draft, command.id);
    }
    switch (command.type) {
      case "prompt.apply": {
        checkKoreanPrompt(command.result.ko, "조종기 한글 프롬프트");
        checkKoreanPrompt(command.result.negativeKo, "조종기 한글 네거티브");
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
        return { ...draft, characters: [...draft.characters, recordControlPrompt(base, withWorkflowUpdates(base, next, command.fields), command.fields)] };
      }
      case "character.update": return { ...draft, characters: replaceById(draft.characters, command.id, (item) => {
        checkOwnerRename(item, command.fields.name);
        checkCharacterPromptLanguages(item, command.fields);
        const next = { ...item, ...command.fields };
        const linked = command.fields.blueprint || "promptKo" in command.fields || "promptEn" in command.fields
          ? relinkCharacterBlueprintPrompts(next) : next;
        return recordControlPrompt(item, withWorkflowUpdates(item, linked, command.fields), command.fields);
      }) };
      case "character.profile": return { ...draft, characters: replaceById(draft.characters, command.id, (item) => ({
        ...item, profile: { callName: "", age: "", mbti: "", tagline: "", personality: "", speech: "", habits: "", background: "", directing: "", ...item.profile, ...command.fields },
      })) };
      case "background.add": {
        const base = newBackground(command.fields.spaceKind);
        checkBackgroundPromptLanguages(base, command.fields);
        checkBackgroundReferences(base, command.fields);
        const next = { ...base, ...command.fields, id: command.id! };
        return { ...draft, backgrounds: [...draft.backgrounds, recordControlPrompt(base, withWorkflowUpdates(base, next, command.fields), command.fields)] };
      }
      case "background.update": return { ...draft, backgrounds: replaceById(draft.backgrounds, command.id, (item) => {
        checkOwnerRename(item, command.fields.name);
        checkBackgroundPromptLanguages(item, command.fields);
        checkBackgroundReferences(item, command.fields);
        return recordControlPrompt(item, withWorkflowUpdates(item, { ...item, ...command.fields }, command.fields), command.fields);
      }) };
      case "reference.link": {
        const source = [...draft.characters, ...draft.backgrounds].flatMap((item) => [...item.generatedImages, ...item.references])
          .find((item) => item.id === command.sourceAssetId);
        if (!source?.filePath) throw new ProjectControlError("invalid_reference", "같은 프로젝트에 저장된 이미지 ID를 고르세요.");
        return updateReferenceOwner(draft, command.owner, (item) => {
          if (item.references.some((reference) => reference.filePath === source.filePath))
            throw new ProjectControlError("duplicate_reference", "이 이미지는 이미 레퍼런스로 연결돼 있습니다.");
          const reference = { id: uid(), name: source.name, thumb: source.thumb, file: null, filePath: source.filePath, sharedFile: true, label: command.label };
          const references = command.position === "first" ? [reference, ...item.references] : [...item.references, reference];
          return { ...item, references, ...(command.owner.kind === "character" ? { refType: "upload" as const } : {}) };
        });
      }
      case "reference.move": return updateReferenceOwner(draft, command.owner, (item) => {
        const found = item.references.find((reference) => reference.id === command.referenceId);
        if (!found) throw new ProjectControlError("target_not_found", "레퍼런스를 찾지 못했습니다.");
        const rest = item.references.filter((reference) => reference.id !== command.referenceId);
        const next = [...rest];
        next.splice(Math.min(command.position, rest.length), 0, found);
        return { ...item, references: next };
      });
      case "reference.label": return updateReferenceOwner(draft, command.owner, (item) => ({ ...item, references: replaceById(item.references, command.referenceId, (reference) => ({ ...reference, label: command.label })) }));
      case "reference.unlink": return updateReferenceOwner(draft, command.owner, (item) => {
        const found = item.references.find((reference) => reference.id === command.referenceId);
        if (!found) throw new ProjectControlError("target_not_found", "레퍼런스를 찾지 못했습니다.");
        if (!found.sharedFile) throw new ProjectControlError("file_delete_requires_ui", "원본 파일 삭제가 필요한 레퍼런스는 앱 화면에서 확인 후 제거하세요.");
        return { ...item, references: item.references.filter((reference) => reference.id !== command.referenceId) };
      });
      case "image.marks": {
        const path = imagePathForMark(draft, command.assetId);
        if (new Set(command.marks.map((mark) => mark.id)).size !== command.marks.length)
          throw new ProjectControlError("duplicate_id", "그림 표시의 열쇠가 중복되었습니다.");
        return { ...draft, imageMarks: { ...draft.imageMarks, [path]: command.marks } };
      }
      case "sheet.layout.upsert": {
        if (new Set(command.placements.map((item) => item.id)).size !== command.placements.length)
          throw new ProjectControlError("duplicate_id", "시트 칸의 열쇠가 중복되었습니다.");
        if (command.placements.some((item) => item.x + item.width > command.size.width || item.y + item.height > command.size.height))
          throw new ProjectControlError("invalid_placement", "시트 칸이 캔버스 밖으로 나갑니다.");
        const layout = { id: command.id, name: command.name, size: command.size,
          captions: command.captions ?? true, placements: command.placements, coords: "px" as const };
        const prior = draft.sheetLayouts ?? [];
        return { ...draft, sheetLayouts: prior.some((item) => item.id === command.id)
          ? prior.map((item) => item.id === command.id ? layout : item) : [...prior, layout] };
      }
      case "sheet.fill": {
        const layout = (draft.sheetLayouts ?? []).find((item) => item.id === command.layoutId);
        if (!layout) throw new ProjectControlError("target_not_found", "시트 배치도를 찾지 못했습니다.");
        const slots = new Set(layout.placements.filter((item) => item.kind !== "profile").map((item) => item.id));
        if (Object.keys(command.fills).some((slot) => !slots.has(slot)))
          throw new ProjectControlError("invalid_placement", "배치도에 없는 그림 칸입니다.");
        return updateReferenceOwner(draft, command.owner, (item) => {
          const sourceIds = new Set(collectSheetSources(item, draft.sharedAssets).map((source) => source.id));
          if (Object.values(command.fills).some((assetId) => !sourceIds.has(assetId)))
            throw new ProjectControlError("invalid_reference", "이 카드의 시트 재료 목록에 없는 이미지입니다.");
          return { ...item, sheetFills: { ...item.sheetFills, [command.layoutId]: command.fills } };
        });
      }
      case "room_preset.save_from_cut": {
        const cut = draft.scenes.find((item) => item.id === command.sceneId)?.cuts.find((item) => item.id === command.cutId);
        if (!cut?.composition) throw new ProjectControlError("missing_composition", "구도를 먼저 저장한 뒤 방을 라이브러리에 담으세요.");
        const preset = captureRoomPreset(cut.composition, command.roomId, command.name);
        if (!preset) throw new ProjectControlError("target_not_found", "저장된 구도에서 방을 찾지 못했습니다.");
        if ((draft.roomPresets ?? []).some((item) => item.id === (command.id ?? preset.id)))
          throw new ProjectControlError("duplicate_id", "이미 있는 방 라이브러리 열쇠입니다.");
        return { ...draft, roomPresets: [...(draft.roomPresets ?? []), { ...preset, id: command.id ?? preset.id }] };
      }
      case "room_preset.remove": {
        if (!(draft.roomPresets ?? []).some((item) => item.id === command.id))
          throw new ProjectControlError("target_not_found", "방 라이브러리 항목을 찾지 못했습니다.");
        return { ...draft, roomPresets: (draft.roomPresets ?? []).filter((item) => item.id !== command.id) };
      }
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
      case "scene.move": return { ...draft, scenes: moveById(draft.scenes, command.id, command.position) };
      case "cut.add":
        checkCutReferences(draft, command.fields);
        checkCutPromptLanguages(newCut(1), command.fields);
        return { ...draft, scenes: replaceById(draft.scenes, command.sceneId, (scene) => {
          if (!scene.cuts.length && command.fields.cutContinuity && command.fields.cutContinuity !== "independent")
            throw new ProjectControlError("invalid_continuity", "첫 컷은 앞 컷과 연결할 수 없습니다.");
          const base = newCut(scene.cuts.length + 1);
          const added = { ...base, ...command.fields, id: command.id! };
          const next = relinkCutCharacterPrompts(added, draft.characters, draft.backgrounds,
            { ...scene, cuts: [...scene.cuts, added] });
          if (next.videoPromptKo?.trim()) next.videoPromptKo = ensureVoicePrompt(next.videoPromptKo, { cut: next, scenes: draft.scenes.map(item => item.id === scene.id ? { ...scene, cuts: [...scene.cuts, next] } : item), characters: draft.characters, lang: "ko" });
          if (next.videoPromptEn?.trim()) next.videoPromptEn = ensureVoicePrompt(next.videoPromptEn, { cut: next, scenes: draft.scenes.map(item => item.id === scene.id ? { ...scene, cuts: [...scene.cuts, next] } : item), characters: draft.characters, lang: "en" });
          const recorded = recordControlPrompt(base, next, command.fields);
          const video = "videoPromptKo" in command.fields || "videoPromptEn" in command.fields
            ? withCutVideoPrompt(base, { ko: recorded.videoPromptKo || "", en: recorded.videoPromptEn || "" }, "대화 조종기") : {};
          return { ...scene, cuts: [...scene.cuts, { ...recorded, ...video }] };
        }) };
      case "cut.update":
        checkCutReferences(draft, command.fields);
        return { ...draft, scenes: replaceById(draft.scenes, command.sceneId, (scene) => ({ ...scene, cuts: replaceById(scene.cuts, command.id, (cut) => {
          checkCutPromptLanguages(cut, command.fields);
          if (scene.cuts[0]?.id === cut.id && command.fields.cutContinuity && command.fields.cutContinuity !== "independent")
            throw new ProjectControlError("invalid_continuity", "첫 컷은 앞 컷과 연결할 수 없습니다.");
          const next = { ...cut, ...command.fields };
          // 프롬프트·연결 방식 변경도 앱과 같은 @참조로 저장합니다. 길이·대사 수정은 기존 글을 건드리지 않습니다.
          const needsLinks = command.fields.characterIds || "videoPromptKo" in command.fields
            || "videoPromptEn" in command.fields || "cutContinuity" in command.fields;
          const linked = needsLinks ? relinkCutCharacterPrompts(next, draft.characters, draft.backgrounds,
            { ...scene, cuts: scene.cuts.map(item => item.id === cut.id ? next : item) }) : next;
          if (linked.videoPromptKo?.trim() && needsLinks) linked.videoPromptKo = ensureVoicePrompt(linked.videoPromptKo, { cut: linked, scenes: draft.scenes.map(item => item.id === scene.id ? { ...scene, cuts: scene.cuts.map(entry => entry.id === cut.id ? linked : entry) } : item), characters: draft.characters, lang: "ko" });
          if (linked.videoPromptEn?.trim() && needsLinks) linked.videoPromptEn = ensureVoicePrompt(linked.videoPromptEn, { cut: linked, scenes: draft.scenes.map(item => item.id === scene.id ? { ...scene, cuts: scene.cuts.map(entry => entry.id === cut.id ? linked : entry) } : item), characters: draft.characters, lang: "en" });
          const recorded = recordControlPrompt(cut, linked, command.fields);
          const video = "videoPromptKo" in command.fields || "videoPromptEn" in command.fields
            ? withCutVideoPrompt(cut, { ko: recorded.videoPromptKo || "", en: recorded.videoPromptEn || "" }, "대화 조종기") : {};
          return { ...recorded, ...video };
        }) })) };
      case "cut.move": return { ...draft, scenes: replaceById(draft.scenes, command.sceneId, (scene) => {
        const moved = moveById(scene.cuts, command.id, command.position);
        if (moved[0]?.cutContinuity && moved[0].cutContinuity !== "independent")
          throw new ProjectControlError("invalid_continuity", "이어지는 컷을 첫 번째로 옮기려면 먼저 독립 컷으로 바꾸세요.");
        return { ...scene, cuts: moved.map((cut, order) => ({ ...cut, order: order + 1 })) };
      }) };
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
    const commands = request.commands.map((command) => isAddCommand(command) && !command.id ? { ...command, id: uid() } : command);
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
    return { ...snapshot(request.projectId, latest, request.detail), persisted: true, created: commands.flatMap((command) => isAddCommand(command) ? [{ type: command.type, id: command.id }] : []) };
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
    const { operationId: _operation, detail: _detail, videoModel: chosenVideoModel, ...fields } = request;
    const fingerprint = JSON.stringify({ ...fields, videoModel: chosenVideoModel });
    const existing = getLocalProject(projectId);
    if (existing) {
      if ((existing.draft as unknown as CreationDraft).controllerCreation?.fingerprint !== fingerprint) throw new ProjectControlError("operation_conflict", "같은 생성 요청 열쇠에 다른 내용이 들어왔습니다.");
      const confirmation = await saveLocalProjectAndConfirm(requireDraft(projectId), projectId);
      if (confirmation.outcome !== "written" && confirmation.outcome !== "same") throw new ProjectControlError("save_failed", "새 프로젝트의 파일 저장을 확인하지 못했습니다.", { outcome: confirmation.outcome });
      return { ...snapshot(projectId, observe(projectId, requireDraft(projectId)), request.detail), persisted: true, reused: true };
    }
    const draft: CreationDraft = { ...newProjectDraft(), ...fields,
      ...(chosenVideoModel === undefined ? {} : { magnific: { videoModel: chosenVideoModel } }),
      controllerCreation: { fingerprint } };
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
