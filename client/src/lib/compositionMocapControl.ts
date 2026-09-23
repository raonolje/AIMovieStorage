import { z } from "zod";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";
import { applyRetargetedCaptureIn, loadCaptureRetargetRig } from "./capturedMotionApply";
import { retargetPerson } from "./motionRetarget";
import { loadMocapResult, mocapSourcesOf } from "./mocapStore";
import { whenAppSettingsReady } from "./mediaLibrary";
import { projectFolderName } from "./localProjectStore";
import { readProject } from "./projectWrite";
import type { CompositionState } from "./composition";
import type { CapturePoint, CaptureResult, CapturedPerson } from "./motionCapture";
import type { ProjectDraft } from "./projectTypes";

const id = z.string().min(1).max(200);
const seconds = z.number().finite().min(0).max(86400);
const channels = z.object({ position: z.boolean().default(true), rotation: z.boolean().default(true), pose: z.boolean().default(true) }).strict();
export const compositionApplyMocapSchema = compositionSessionRequestSchema.extend({
  projectId: id,
  sourceId: id,
  personNumber: z.number().int().positive(),
  characterId: id,
  /** 생략하면 화면에 저장한 영상별 타임라인 시작 값을 사용합니다. */
  timelineStartSeconds: seconds.optional(),
  /** 원본 영상 시각입니다. 생략하면 분석 구간 시작부터 적용합니다. */
  sourceStartSeconds: seconds.optional(),
  durationSeconds: z.number().finite().positive().max(600).optional(),
  channels: channels.default({ position: true, rotation: true, pose: true }),
}).strict();

function reject(code: string, message: string): never { throw new CompositionControlError(code, message); }

function targetGender(draft: ProjectDraft, state: CompositionState, characterId: string) {
  if (!state.characters.some(item => item.characterId === characterId))
    reject("character_not_placed", "먼저 구도에 배치된 캐릭터나 마네킹을 골라 주세요.");
  const mannequin = state.mannequins.find(item => item.id === characterId);
  const character = draft.characters.flatMap(item => [item, ...(item.alternates ?? [])]).find(item => item.id === characterId);
  if (!mannequin && !character) reject("character_not_found", "현재 프로젝트의 캐릭터나 이 구도의 마네킹이 아닙니다.");
  return mannequin?.gender ?? character?.gender;
}

function validPoints(points: CapturePoint[] | undefined, count: number) {
  return Array.isArray(points) && points.length === count && points.every(point => point &&
    [point.x, point.y, point.z, point.v].every(value => typeof value === "number" && Number.isFinite(value)));
}

/** 결과 파일은 신뢰하지 않습니다. 잘못된 좌표나 끝없는 구간이 history로 들어가지 않게 먼저 검증합니다. */
function selectedPerson(capture: CaptureResult, number: number, from: number, to: number): CapturedPerson {
  if (![capture.width, capture.height].every(value => Number.isFinite(value) && value > 0) || !Array.isArray(capture.persons))
    reject("invalid_capture", "모캡 결과의 화면 크기나 사람 목록이 올바르지 않습니다.");
  const person = capture.persons.find(item => item.number === number);
  if (!person) reject("person_not_found", "분석 결과에 해당 사람 번호가 없습니다.");
  if (!Array.isArray(person.samples)) reject("invalid_capture", "분석 결과에 관절 표본이 없습니다.");
  const samples = person.samples.filter(sample => sample && sample.time >= from && sample.time <= to).sort((a, b) => a.time - b.time);
  if (samples.length < 2) reject("empty_capture_range", "선택 구간에 관절 표본이 두 장 이상 필요합니다.");
  if (samples.length > 18000) reject("capture_too_large", "한 번에 18,000장까지 적용할 수 있습니다. durationSeconds로 구간을 나눠 주세요.");
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!Number.isFinite(sample.time) || (i > 0 && sample.time <= samples[i - 1].time) ||
        !validPoints(sample.image, 33) || !validPoints(sample.world, 33) ||
        (sample.root && ![sample.root.x, sample.root.y, sample.root.z].every(Number.isFinite)) ||
        [sample.hands?.left, sample.hands?.right].some(hand => hand && (!validPoints(hand.image, 21) || !validPoints(hand.world, 21))))
      reject("invalid_capture", "모캡 결과의 시각 또는 관절 좌표가 올바르지 않습니다.");
  }
  return { ...person, samples };
}

export async function applyCompositionMocap(raw: unknown) {
  const parsed = compositionApplyMocapSchema.safeParse(raw);
  if (!parsed.success) throw new CompositionControlError("invalid_request", "모캡 적용 요청의 형식이 맞지 않습니다.", parsed.error.issues);
  const input = parsed.data;
  if (!Object.values(input.channels).some(Boolean)) reject("invalid_request", "이동·회전·관절 중 적용할 채널을 하나 이상 골라 주세요.");
  await whenAppSettingsReady();
  return applyCompositionMutation({ sessionId: input.sessionId, expectedRevision: input.expectedRevision }, async ({ state, identity }) => {
    const project = readProject(input.projectId);
    if (!project) reject("project_not_found", "프로젝트를 찾지 못했습니다.");
    const folder = projectFolderName(input.projectId, project.title);
    if (identity.projectName !== folder || !project.scenes.some(scene => scene.cuts.some(cut => cut.id === identity.cutId)))
      reject("project_mismatch", "열린 구도와 모캡 원본은 같은 프로젝트여야 합니다.");
    const gender = targetGender(project, state, input.characterId);
    const sourceOf = () => mocapSourcesOf(folder).find(item => item.id === input.sourceId);
    const initial = sourceOf();
    if (!initial) reject("source_not_found", "현재 프로젝트에 등록된 모캡 원본이 아닙니다.");
    if (initial.status === "running" || initial.status === "queued") reject("source_busy", "모캡 분석이 끝난 뒤 적용해 주세요.");
    // 경로를 요청으로 받지 않고 프로젝트 목록에서만 찾습니다. URL을 결과 파일로 읽지도 않습니다.
    if (!initial.resultPath || !/^(?:[a-z]:[\\/]|\/(?!\/))/i.test(initial.resultPath) || !/\.json$/i.test(initial.resultPath))
      reject("capture_not_saved", "먼저 분석 결과를 프로젝트에 저장해 주세요.");
    const loaded = await loadMocapResult(folder, initial);
    const source = sourceOf();
    if (!loaded || !source) reject("capture_not_found", "저장된 모캡 결과를 읽지 못했습니다.");
    const capture = source.result ?? loaded;
    const from = input.sourceStartSeconds ?? capture.start;
    const to = input.durationSeconds === undefined ? capture.end : from + input.durationSeconds;
    const start = input.timelineStartSeconds ?? source.start;
    if (![capture.start, capture.end, from, to, start].every(Number.isFinite) || capture.start < 0 || capture.end <= capture.start ||
        from < capture.start || to > capture.end || to <= from || start < 0 || start + to - from > 86400)
      reject("invalid_capture_range", "적용 구간은 분석된 시각 안에 있어야 하며 타임라인 끝은 86,400초 이하여야 합니다.");
    const person = selectedPerson(capture, input.personNumber, from, to);
    const rig = await loadCaptureRetargetRig(gender);
    const frames = retargetPerson(rig, person, capture, { smoothing: source.smoothing, footPlant: source.footPlant === true });
    if (frames.length !== person.samples.length || frames.some(frame =>
      ![frame.time, frame.yaw, frame.root.x, frame.root.y, frame.root.z,
        ...Object.values(frame.bones).flatMap(value => [value.x, value.y, value.z])].every(Number.isFinite)))
      reject("retarget_failed", "관절 회전이나 이동을 올바르게 계산하지 못했습니다.");
    const latestSource = sourceOf();
    const latestProject = readProject(input.projectId);
    if (!latestSource || (latestSource.result ?? latestSource.raw) !== capture ||
        latestSource.resultPath !== source.resultPath || latestSource.smoothing !== source.smoothing ||
        latestSource.footPlant !== source.footPlant || latestSource.start !== source.start ||
        latestSource.status === "running" || latestSource.status === "queued" ||
        !latestProject || projectFolderName(input.projectId, latestProject.title) !== folder ||
        !latestProject.scenes.some(scene => scene.cuts.some(cut => cut.id === identity.cutId)) ||
        targetGender(latestProject, state, input.characterId) !== gender)
      reject("source_changed", "준비 중 모캡 결과나 캐릭터가 바뀌었습니다. 최신 목록을 읽은 뒤 다시 적용해 주세요.");
    const next = applyRetargetedCaptureIn(state, [{ characterId: input.characterId, frames }], {
      timelineStart: start, captureStart: from, formation: source.formation,
      channels: input.channels, source: { id: source.id, name: source.name },
    });
    return { state: next, result: {
      projectId: input.projectId, sourceId: source.id, personNumber: input.personNumber, characterId: input.characterId,
      sampleCount: frames.length, sourceStartSeconds: from, sourceEndSeconds: to,
      timelineStartSeconds: start, firstKeySeconds: start + frames[0].time - from,
      lastKeySeconds: start + frames[frames.length - 1].time - from, channels: input.channels,
      mirroredDuringAnalysis: capture.mirrored ?? null,
      persisted: false, saveWith: "composition_commit",
    } };
  });
}
