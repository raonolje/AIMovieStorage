import { z } from "zod";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";
import { loadCaptureRetargetRig } from "./capturedMotionApply";
import { selectedPerson, targetGender } from "./compositionMocapControl";
import { applyDanceChoreographyIn } from "./musicChoreography";
import { fitDancePhrase } from "./musicChoreographyTiming";
import { musicOf } from "./compositionEdit";
import { retargetPerson } from "./motionRetarget";
import { loadMocapResult, mocapSourcesOf } from "./mocapStore";
import { whenAppSettingsReady } from "./mediaLibrary";
import { projectFolderName } from "./localProjectStore";
import { readProject } from "./projectWrite";

const id = z.string().min(1).max(200);
export const compositionApplyDanceSchema = compositionSessionRequestSchema.extend({
  projectId: id,
  sourceId: id,
  personNumber: z.number().int().positive(),
  characterIds: z.array(id).min(1).max(12),
  /** Omit to apply the phrase to every saved music section. */
  sectionIds: z.array(id).min(1).max(64).optional(),
  sourceStartSeconds: z.number().finite().min(0).optional(),
  durationSeconds: z.number().finite().positive().max(600).optional(),
}).strict();

function fail(code: string, message: string): never { throw new CompositionControlError(code, message); }

/** One saved motion phrase can drive the placed cast in sync with the editor's music sections. */
export async function applyCompositionDance(raw: unknown) {
  const parsed = compositionApplyDanceSchema.safeParse(raw);
  if (!parsed.success) fail("invalid_request", "군무 적용 요청의 형식이 맞지 않습니다.");
  const input = parsed.data;
  if (new Set(input.characterIds).size !== input.characterIds.length) fail("duplicate_character", "같은 캐릭터가 두 번 선택됐습니다.");
  await whenAppSettingsReady();
  return applyCompositionMutation({ sessionId: input.sessionId, expectedRevision: input.expectedRevision }, async ({ state, identity }) => {
    const project = readProject(input.projectId);
    if (!project) fail("project_not_found", "프로젝트를 찾지 못했습니다.");
    const folder = projectFolderName(input.projectId, project.title);
    if (identity.projectName !== folder || !project.scenes.some(scene => scene.cuts.some(cut => cut.id === identity.cutId)))
      fail("project_mismatch", "열린 구도와 모캡 원본은 같은 프로젝트여야 합니다.");
    const genders = input.characterIds.map(characterId => targetGender(project, state, characterId));
    if (new Set(genders).size > 1) fail("mixed_rigs", "서로 다른 몸 리그는 아직 한 번에 적용할 수 없습니다. 리그별로 나눠 적용하세요.");
    const music = musicOf(state);
    if (!music || music.sections.length === 0) fail("missing_music_sections", "먼저 타임라인에 음원을 놓고 박자 구간을 나누세요.");
    const sections = input.sectionIds
      ? input.sectionIds.map(id => music.sections.find(item => item.id === id) ?? fail("section_not_found", "노래 구간을 찾지 못했습니다."))
      : music.sections;
    if (new Set(sections.map(item => item.id)).size !== sections.length) fail("duplicate_section", "같은 구간이 두 번 선택됐습니다.");
    const sourceOf = () => mocapSourcesOf(folder).find(item => item.id === input.sourceId);
    const initial = sourceOf();
    if (!initial) fail("source_not_found", "프로젝트에 저장된 모캡 원본을 고르세요.");
    if (initial.status === "running" || initial.status === "queued") fail("source_busy", "모캡 분석이 끝난 뒤 적용하세요.");
    if (!initial.resultPath || !/^(?:[a-z]:[\\/]|\/(?!\/))/i.test(initial.resultPath) || !/\.json$/i.test(initial.resultPath))
      fail("capture_not_saved", "먼저 모캡 분석 결과를 프로젝트에 저장하세요.");
    const loaded = await loadMocapResult(folder, initial);
    const source = sourceOf();
    if (!loaded || !source) fail("capture_not_found", "모캡 결과를 읽지 못했습니다.");
    const capture = source.result ?? loaded;
    const from = input.sourceStartSeconds ?? capture.start;
    const to = input.durationSeconds === undefined ? capture.end : from + input.durationSeconds;
    if (![capture.start, capture.end, from, to].every(Number.isFinite) || from < capture.start || to > capture.end || to <= from)
      fail("invalid_capture_range", "동작 구간은 분석된 원본 시각 안에 있어야 합니다.");
    const person = selectedPerson(capture, input.personNumber, from, to);
    const rig = await loadCaptureRetargetRig(genders[0]);
    const frames = retargetPerson(rig, person, capture, { smoothing: source.smoothing, footPlant: source.footPlant === true });
    if (frames.length !== person.samples.length || frames.some(frame =>
      ![frame.time, frame.yaw, frame.root.x, frame.root.y, frame.root.z,
        ...Object.values(frame.bones).flatMap(value => [value.x, value.y, value.z])].every(Number.isFinite)))
      fail("retarget_failed", "동작 관절 키를 올바르게 계산하지 못했습니다.");
    const latestSource = sourceOf();
    const latestProject = readProject(input.projectId);
    if (!latestSource || (latestSource.result ?? latestSource.raw) !== capture ||
        latestSource.resultPath !== source.resultPath || latestSource.smoothing !== source.smoothing ||
        latestSource.footPlant !== source.footPlant || latestSource.status === "running" || latestSource.status === "queued" ||
        !latestProject || projectFolderName(input.projectId, latestProject.title) !== folder ||
        input.characterIds.some((id, index) => targetGender(latestProject, state, id) !== genders[index]))
      fail("source_changed", "계산 중 원본이나 캐릭터가 바뀌었습니다. 최신 구도를 다시 읽어 주세요.");
    const next = applyDanceChoreographyIn(state, input.characterIds, frames, sections, { id: source.id, name: source.name });
    return { state: next, result: { projectId: input.projectId, sourceId: source.id,
      characterIds: input.characterIds, sectionIds: sections.map(item => item.id),
      firstKeySeconds: Math.min(...sections.map(item => item.start)),
      lastKeySeconds: Math.max(...sections.map(item => item.end)),
      motionKeysPerCharacter: fitDancePhrase(frames, sections).length, channels: ["pose"],
      persisted: false, saveWith: "composition_commit" } };
  });
}
