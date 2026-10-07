import { bgmPromptSelection,bgmPromptStamp } from "./bgmPromptRequest";
import { workflowInputSelectionSchema,workflowTargetSchema } from "./workflowRunContract";
import { z } from "zod";
import { workflowGenerateControlSchema,enqueueControlRegisteredWorkflow } from "./controlComfyWorkflow";
import { workflowEntryForTarget } from "./comfyWorkflowLibrary";
import { createBgmProject, createBgmTrack, loadBgmProjects, patchBgmTrack, saveBgmProjectsAndConfirm, updateBgmProjectsAndConfirm, type BgmProject, type BgmTrack } from "./bgmProjects";
import { appendPromptHistory } from "./promptHistory";
import { bgmRequestData } from "./bgmPromptRequest";
import { buildPromptRequestText } from "./promptRequest";
import { whenAppSettingsReady } from "./mediaLibrary";
import { diffControlValues } from "./controlChanges";
import { uid } from "./projectTypes";
import { musicLyricsResult } from "./musicPromptPolicy";
import { assertDirectGenerationEnabled } from "./generationRoutingPolicy";

const id = z.string().min(1).max(200);
const text = z.string().max(32000);
const name = z.string().trim().min(1).max(300);
const tags = z.array(z.string().max(300)).max(100);
const projectFields = z.object({ name: name.optional(), description: text.optional(), linkedProject: text.optional() }).strict();
const trackFields = z.object({
  singers: z.array(z.object({ id, name: text, timbre: text, range: text, diction: text, vibrato: text, delivery: text, parts: text }).strict()).max(100).optional(),
  leadMode: z.enum(["single", "group"]).optional(),
  name: z.string().max(300).optional(), usage: text.optional(), mood: tags.optional(), genre: tags.optional(),
  instruments: tags.optional(), tempo: z.string().max(30).optional(), durationSeconds: z.string().max(30).optional(),
  lyrics: z.string().max(16000).optional(), lyricsKo: z.string().max(16000).optional(), lyricsEn: z.string().max(16000).optional(),
  styleKo: text.optional(), styleEn: text.optional(), promptKo: text.optional(), promptEn: text.optional(),
  excludeStyles: text.optional(), vocals: tags.optional(), era: tags.optional(), production: tags.optional(),
  structure: tags.optional(), instrumental: z.boolean().optional(), reference: text.optional(), notes: text.optional(),
  targetTool: z.enum(["suno", "local-minimax", "local-acestep","comfy"]).optional(),
  promptWorkflow:workflowTargetSchema.optional(),promptWorkflowInputs:workflowInputSelectionSchema.optional(),
}).strict();
export const bgmReadSchema = z.object({ projectId: id }).strict();
export const bgmPromptPrepareSchema = bgmReadSchema.extend({ trackId: id, expectedRevision: id });
export const bgmChangesSchema = bgmReadSchema.extend({ sinceRevision: id });
export const bgmCreateSchema = projectFields.extend({ name, operationId: id });
export const bgmUpdateSchema = bgmReadSchema.extend({ expectedRevision: id, commands: z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("project.update"), fields: projectFields }).strict(),
  z.object({ type: z.literal("track.add"), id: id.optional(), fields: trackFields }).strict(),
  z.object({ type: z.literal("track.update"), id, fields: trackFields }).strict(),
])).min(1).max(100) });
export const bgmGenerateSchema=workflowGenerateControlSchema.omit({target:true,prompt:true}).extend({trackId:id,prompt:z.string().trim().min(1).max(32000).optional(),lyrics:z.string().max(16000).optional(),seconds:z.number().finite().positive().max(300).optional()});

export class BgmControlError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = "BgmControlError"; }
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type BgmChange = ReturnType<typeof diffControlValues>[number] & { revision: string; source: "app" | "controller" };
interface Observation { project: BgmProject; revision: string; history: Array<{ from: string; changes: BgmChange[]; truncated: boolean }> }
const observations = new Map<string, Observation>();
const working = new Set<string>();
const session = uid();
let counter = 0;
function requireProject(projectId: string) {
  const found = loadBgmProjects().find((project) => project.id === projectId);
  if (!found) throw new BgmControlError("project_not_found", "BGM 프로젝트를 찾지 못했습니다.");
  return found;
}
function observe(project: BgmProject, source: "app" | "controller" = "app"): Observation {
  const previous = observations.get(project.id);
  if (previous && JSON.stringify(previous.project) === JSON.stringify(project)) return previous;
  const revision = `${session}:${++counter}`;
  const changes = previous ? diffControlValues(previous.project, project).map((change) => ({ ...change, revision, source })) : [];
  const next = { project: clone(project), revision, history: previous ? [...previous.history, { from: previous.revision, changes, truncated: changes.length >= 200 || changes.some((change) => change.truncated) }].slice(-64) : [] };
  observations.set(project.id, next);
  return next;
}
const snapshot = (state: Observation) => ({ projectId: state.project.id, revision: state.revision, project: clone(state.project) });
function patchTrackWithHistory(current: BgmTrack, fields: z.infer<typeof trackFields>): BgmTrack {
  const rewriting = ["styleKo", "styleEn", "promptKo", "promptEn"].some(key => key in fields);
  const normalized = rewriting ? musicLyricsResult({ ...fields, lyricsKo: fields.lyricsKo ?? fields.lyrics ?? current.lyricsKo ?? current.lyrics, lyricsEn: fields.lyricsEn ?? current.lyricsEn }, fields.instrumental ?? current.instrumental) : fields;
  const next = patchBgmTrack(current, normalized);
  if (!["styleKo", "styleEn", "promptKo", "promptEn"].some((key) => key in fields)) return next;
  let history = current.promptHistory;
  if (current.promptKo?.trim() || current.promptEn?.trim()) history = appendPromptHistory(history, {
    ko: current.promptKo || "", en: current.promptEn || "", negativeKo: "", negativeEn: "", note: "덮어쓰기 전",
  });
  return { ...next, promptModelStamp: bgmPromptStamp(next), promptHistory: appendPromptHistory(history, {
    ko: next.promptKo || "", en: next.promptEn || "", negativeKo: "", negativeEn: "", note: "대화 조종기",
  }) };
}
export async function listBgmControl() {
  await whenAppSettingsReady();
  return loadBgmProjects().map((project) => ({ id: project.id, name: project.name, description: project.description, linkedProject: project.linkedProject, trackCount: project.tracks.length, updatedAt: project.updatedAt }));
}
export async function getBgmSnapshot(projectId: string) {
  bgmReadSchema.parse({ projectId });
  await whenAppSettingsReady();
  return snapshot(observe(requireProject(projectId)));
}
/** 화면의 BGM API 버튼에 전달되는 템플릿과 곡 자료를 그대로 조종기에 돌려줍니다. */
export async function prepareBgmPrompt(raw: unknown) {
  const input = bgmPromptPrepareSchema.parse(raw);
  await whenAppSettingsReady();
  const state = observe(requireProject(input.projectId));
  if (state.revision !== input.expectedRevision) throw revisionConflict(state);
  const track = state.project.tracks.find((item) => item.id === input.trackId);
  if (!track) throw new BgmControlError("target_not_found", "프롬프트를 만들 곡을 찾지 못했습니다.");
  const parts = await buildPromptRequestText({ template: "bgm-prompt", data: bgmRequestData(track) });
  const latest = observe(requireProject(input.projectId));
  if (latest.revision !== state.revision) throw revisionConflict(latest);
  return { projectId: input.projectId, trackId: input.trackId, revision: latest.revision,
    modelId: bgmPromptSelection(track).modelId,
    generationTarget:bgmPromptSelection(track),
    stale: track.promptKo || track.promptEn ? track.promptModelStamp !== bgmPromptStamp(track) ? "현재 선택과 작성 모델이 다르거나 작성 기록이 없습니다. 기존 문장을 보존하고 재작성 시 새 모델을 반영합니다." : "" : "",
    request: [parts.fixed, parts.fresh].filter(Boolean).join("\n\n---\n\n"),
    apply: "bgm_update track.update에 styleKo/styleEn과 필요한 lyricsKo/lyricsEn을 함께 넣으세요. 판이 바뀌면 다시 준비하세요." };
}
export async function getBgmChanges(raw: unknown) {
  const input = bgmChangesSchema.parse(raw);
  await whenAppSettingsReady();
  const state = observe(requireProject(input.projectId));
  if (state.revision === input.sinceRevision) return { projectId: input.projectId, revision: state.revision, changes: [] as BgmChange[], fullSnapshotRequired: false };
  const start = state.history.findIndex((entry) => entry.from === input.sinceRevision);
  const entries = start < 0 ? [] : state.history.slice(start);
  const fullSnapshotRequired = start < 0 || entries.some((entry) => entry.truncated);
  return { projectId: input.projectId, revision: state.revision, changes: entries.flatMap((entry) => entry.changes), fullSnapshotRequired, ...(fullSnapshotRequired ? { snapshot: snapshot(state) } : {}) };
}
function revisionConflict(state: Observation) {
  return new BgmControlError("revision_conflict", "그 사이 BGM이 바뀌었습니다. 최신 내용과 변경 내역을 읽어 주세요.", { actualRevision: state.revision });
}
export async function updateBgmControl(raw: unknown) {
  const input = bgmUpdateSchema.parse(raw);
  await whenAppSettingsReady();
  if (working.has(input.projectId)) throw new BgmControlError("project_busy", "이 BGM 프로젝트의 앞선 편집을 저장 중입니다.");
  working.add(input.projectId);
  try {
    const state = observe(requireProject(input.projectId));
    if (state.revision !== input.expectedRevision) throw revisionConflict(state);
    const commands = input.commands.map((command) => command.type === "track.add" && !command.id ? { ...command, id: uid() } : command);
    const stamp = JSON.stringify(state.project);
    let applied = false;
    try {
      const saving = updateBgmProjectsAndConfirm((projects) => {
        const current = projects.find((project) => project.id === input.projectId);
        if (!current) throw new BgmControlError("project_not_found", "BGM 프로젝트를 찾지 못했습니다.");
        if (JSON.stringify(current) !== stamp) throw revisionConflict(observe(current));
        // 배치 전체를 먼저 계산합니다. 마지막 명령이 틀려도 앞부분만 저장되지 않습니다.
        let next = current;
        for (const command of commands) {
          if (command.type === "project.update") {
            if (command.fields.name && command.fields.name !== next.name && next.tracks.some((track) => track.resultPaths.length))
              throw new BgmControlError("rename_requires_ui", "음원이 있는 BGM 프로젝트의 이름은 폴더 확인이 필요합니다.");
            next = { ...next, ...command.fields };
          } else if (command.type === "track.add") {
            if (next.tracks.some((track) => track.id === command.id)) throw new BgmControlError("duplicate_id", "이미 있는 곡 열쇠입니다.");
            next = { ...next, tracks: [...next.tracks, patchTrackWithHistory({ ...createBgmTrack(), id: command.id! }, command.fields)] };
          } else {
            if (!next.tracks.some((track) => track.id === command.id)) throw new BgmControlError("target_not_found", "고칠 곡을 찾지 못했습니다.");
            next = { ...next, tracks: next.tracks.map((track) => track.id === command.id ? patchTrackWithHistory(track, command.fields) : track) };
          }
        }
        next = { ...next, updatedAt: Date.now() };
        return projects.map((project) => project.id === next.id ? next : project);
      });
      applied = true;
      observe(requireProject(input.projectId), "controller");
      await saving;
    } catch (error) {
      if (!applied) throw error;
      throw new BgmControlError("save_failed", "BGM 편집은 반영됐지만 앱 데이터 파일 저장을 확인하지 못했습니다.", { applied: true, reason: String(error), snapshot: snapshot(observe(requireProject(input.projectId))) });
    }
    return { ...snapshot(observe(requireProject(input.projectId))), persisted: true, created: commands.filter((command) => command.type === "track.add").map((command) => ({ type: command.type, id: command.id })) };
  } finally { working.delete(input.projectId); }
}
export async function createBgmControl(raw: unknown) {
  const input = bgmCreateSchema.parse(raw);
  await whenAppSettingsReady();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.operationId));
  const projectId = `control-bgm-${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (working.has(projectId)) throw new BgmControlError("project_busy", "이 BGM 프로젝트를 만드는 중입니다. 같은 요청으로 다시 확인해 주세요.");
  working.add(projectId);
  try {
    const { operationId: _operation, ...fields } = input;
    const fingerprint = JSON.stringify(fields);
    const projects = loadBgmProjects();
    const existing = projects.find((project) => project.id === projectId);
    if (existing && existing.controllerCreation?.fingerprint !== fingerprint) throw new BgmControlError("operation_conflict", "같은 생성 요청 열쇠에 다른 BGM 내용이 들어왔습니다.");
    const project = existing ?? { ...createBgmProject(fields.name), ...fields, id: projectId, controllerCreation: { fingerprint } };
    try { await saveBgmProjectsAndConfirm(existing ? projects : [...projects, project]); }
    catch (error) { throw new BgmControlError("save_failed", "BGM 프로젝트의 앱 데이터 파일 저장을 확인하지 못했습니다.", { applied: loadBgmProjects().some((entry) => entry.id === projectId), projectId, reason: String(error) }); }
    return { ...snapshot(observe(requireProject(projectId), "controller")), persisted: true, reused: Boolean(existing) };
  } finally { working.delete(projectId); }
}
export async function enqueueControlBgm(raw: unknown) {
  if(raw&&typeof raw==="object"&&"engine" in raw)assertDirectGenerationEnabled(String(raw.engine));
  const {trackId,prompt,lyrics,seconds,...input}=bgmGenerateSchema.parse(raw);
  await whenAppSettingsReady();
  const project=requireProject(input.projectId),track=project.tracks.find(item=>item.id===trackId);
  if(!track)throw new BgmControlError("target_not_found","BGM 곡을 찾지 못했습니다.");
  const entry=workflowEntryForTarget(input.workflowTarget),values={...input.values};
  if(entry.source.operation!=="music-generation")throw new Error("workflow_bgm_target_required");
  for(const [semantic,value] of [["lyrics",lyrics],["durationSeconds",seconds]] as const){
    if(value===undefined)continue;
    const slots=entry.selection.slots.filter(slot=>slot.semantic===semantic);
    if(!slots.length)throw new Error(`workflow_music_option_unsupported: ${semantic}`);
    for(const slot of slots){if(values[slot.id]!==undefined&&values[slot.id]!==value)throw new Error(`workflow_option_conflict: ${slot.id}`);values[slot.id]=value;}
  }
  return enqueueControlRegisteredWorkflow({...input,target:{kind:"bgm",id:trackId},prompt:prompt??(track.styleEn||track.styleKo||track.promptEn||track.promptKo),values});
}
