import { z } from "zod";
import { ProjectControlError } from "./projectControl";
import { getComfyGenerationSettings, inspectComfyGenerationWorkflow, saveComfyGenerationSettingsAndConfirm,
  validateComfyWorkflowConfig, type ComfyGenerationSettings } from "./comfyGeneration";

const id = z.string().min(1).max(200);
export const comfySettingsSetSchema = z.object({
  expectedRevision: id, kind: z.enum(["image", "video"]),
  baseUrl: z.string().min(1).max(2000).optional(),
  workflowPath: z.string().trim().min(1).max(4000),
  mappings: z.array(z.object({ nodeId: id, input: id, source: z.enum(["prompt", "negative", "reference", "value"]),
    referenceKind: z.enum(["image", "video", "audio"]).optional(), referenceIndex: z.number().int().min(0).max(63).optional(),
    value: z.union([z.string().max(32000), z.number().finite(), z.boolean()]).optional() }).strict()).min(1).max(256),
  outputNodeIds: z.array(id).max(256),
}).strict();
async function revision(settings: ComfyGenerationSettings): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(settings)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export function requireLocalComfyUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("ComfyUI 로컬 서버 주소가 올바르지 않습니다."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("조종기 설정은 인증 정보가 없는 localhost HTTP 서버만 연결합니다.");
  return url.origin;
}
export async function getControlComfySettings() {
  const settings = getComfyGenerationSettings();
  return { revision: await revision(settings), baseUrl: settings.baseUrl,
    workflows: Object.fromEntries((["image", "video"] as const).map(kind => [kind,
      { configured: Boolean(settings[kind].workflowPath), mappings: settings[kind].mappings.length, outputNodeIds: settings[kind].outputNodeIds }])) };
}
export async function setControlComfySettings(raw: unknown) {
  const input = comfySettingsSetSchema.parse(raw);
  const before = getComfyGenerationSettings();
  const assertCurrent = async () => {
    const actualRevision = await revision(getComfyGenerationSettings());
    if (actualRevision !== input.expectedRevision)
      throw new ProjectControlError("revision_conflict", "ComfyUI 설정이 바뀌었습니다. 최신 설정을 읽고 다시 보내세요.", { actualRevision });
  };
  await assertCurrent();
  const baseUrl = requireLocalComfyUrl(input.baseUrl ?? before.baseUrl);
  const config = { workflowPath: input.workflowPath, mappings: input.mappings, outputNodeIds: input.outputNodeIds };
  const info = await inspectComfyGenerationWorkflow(config.workflowPath);
  validateComfyWorkflowConfig(config, info);
  await assertCurrent();
  const saved = await saveComfyGenerationSettingsAndConfirm(current => {
    // 해시 계산을 기다린 마지막 틈에서도 설정 화면의 편집을 덮지 않습니다.
    if (JSON.stringify(current) !== JSON.stringify(before))
      throw new ProjectControlError("revision_conflict", "저장 직전에 ComfyUI 설정이 바뀌었습니다.");
    return { ...current, baseUrl, [input.kind]: config };
  });
  return { persisted: true, revision: await revision(saved), kind: input.kind, workflowSha256: info.sha256,
    persistedLatest: JSON.stringify(saved) === JSON.stringify(getComfyGenerationSettings()) };
}
