import { z } from "zod";
import { motionTracksOf } from "./compositionEdit";
import { applyCompositionMutation, compositionSessionRequestSchema, CompositionControlError } from "./compositionControl";
import { analyzeMotion, autoDecisions, cleanupCharacterIn, CLEANUP_SYSTEM, cleanupPrompt,
  type CleanupDecision, type CleanupSensitivity } from "./motionCleanup";

const sensitivity = z.enum(["low", "normal", "high"]).default("normal");
const base = compositionSessionRequestSchema.extend({ characterId: z.string().min(1).max(200), sensitivity });
export const motionCleanupPrepareSchema = base.strict();
export const motionCleanupApplySchema = base.extend({ mode: z.enum(["auto", "llm"]),
  decisions: z.array(z.object({ id: z.string().min(1).max(200), action: z.enum(["smooth", "keep"]),
    strength: z.number().finite().min(0).max(1).optional() }).strict()).max(400).optional() }).strict();

function issuesOf(state: Parameters<typeof motionTracksOf>[0], characterId: string, level: CleanupSensitivity) {
  if (!state.characters.some((item) => item.characterId === characterId))
    throw new CompositionControlError("invalid_target", "구도에 배치된 인물을 고르세요.");
  const tracks = motionTracksOf(state).filter((track) => track.targetId === characterId);
  const keys = tracks.reduce((sum, track) => sum + (track.keys.length >= 8 ? track.keys.length : 0), 0);
  if (!keys) throw new CompositionControlError("missing_mocap", "다듬을 촘촘한 모캡 키가 없습니다.");
  return { tracks, issues: analyzeMotion(tracks, level), keys };
}

/** 화면의 모캡 AI 분석과 같은 system·prompt를 Codex/Claude에 전달합니다. */
export async function prepareCompositionMotionCleanup(raw: unknown) {
  const request = motionCleanupPrepareSchema.parse(raw);
  return applyCompositionMutation({ sessionId: request.sessionId, expectedRevision: request.expectedRevision, detail: request.detail }, ({ state, context }) => {
    const { tracks, issues, keys } = issuesOf(state, request.characterId, request.sensitivity);
    const times = tracks.flatMap((track) => track.keys.map((key) => key.time));
    const duration = Math.max(...times) - Math.min(...times);
    const fps = Math.round(Math.max(...tracks.map((track) => track.keys.length)) / Math.max(0.1, duration));
    return { state, result: { characterId: request.characterId, sensitivity: request.sensitivity,
      denseKeys: keys, issueCount: issues.length, system: CLEANUP_SYSTEM,
      prompt: cleanupPrompt(issues, { name: context.characterNames?.[request.characterId] ?? request.characterId, duration, fps }),
      apply: "composition_motion_cleanup_apply에 mode=llm과 decisions 배열을 넣으세요. 누락된 후보는 앱의 자동 판단으로 채웁니다." } };
  });
}

/** 화면과 같은 분석·자동 보완·다듬기 함수로 한 번의 되돌리기 항목을 만듭니다. */
export async function applyCompositionMotionCleanup(raw: unknown) {
  const request = motionCleanupApplySchema.parse(raw);
  return applyCompositionMutation({ sessionId: request.sessionId, expectedRevision: request.expectedRevision, detail: request.detail }, ({ state }) => {
    const { issues } = issuesOf(state, request.characterId, request.sensitivity);
    if (request.mode === "llm" && !request.decisions)
      throw new CompositionControlError("missing_decisions", "LLM 분석 답의 decisions 배열을 넣으세요.");
    const known = new Set(issues.map((issue) => issue.id));
    const selected: CleanupDecision[] = (request.mode === "auto" ? [] : request.decisions ?? [])
      .filter((item) => known.has(item.id)).map((item) => ({ ...item, strength: item.strength ?? 0.3 }));
    const answered = new Set(selected.map((item) => item.id));
    const decisions = request.mode === "auto" ? autoDecisions(issues)
      : [...selected, ...autoDecisions(issues.filter((issue) => !answered.has(issue.id)))];
    const changed = cleanupCharacterIn(state, request.characterId, issues, decisions);
    return { state: changed.changed ? changed.state : state,
      result: { characterId: request.characterId, issueCount: issues.length, changedKeys: changed.changed,
        automaticFallbacks: decisions.length - selected.length } };
  });
}
