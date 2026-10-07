import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enqueueTaskOperation, isStopping, registerTaskRunner } from "./taskQueue";
import { refreshLoraFiles } from "./localLoras";
import { LOCAL_ENGINE_IDS } from "./localEngines";

export const controlLoraDownloadSchema = z.object({
  operationId: z.string().trim().min(1).max(300),
  engine: z.literal("ltx25"),
  repo: z.literal("Lightricks/LTX-2.5"),
  file: z.literal("loras/ltx-2.5-22b-distilled-lora-450-bf16.safetensors"),
  expectedSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
}).strict();
export async function enqueueControlLoraDownload(raw: unknown) {
  throw new Error("legacy_lora_disabled: Comfy에 설치된 LoRA만 사용합니다. 앱 전용 LoRA 받기는 종료되었고 기존 파일은 보존됩니다.");
  const input = controlLoraDownloadSchema.parse(raw);
  if (!LOCAL_ENGINE_IDS.includes(input.engine)) throw new Error("이 빌드에서 사용할 수 없는 엔진입니다.");
  return enqueueTaskOperation({ lane: "media", kind: "control.lora.download", projectId: "settings",
    projectTitle: "로컬 모델", label: "LTX-2.5 공식 로라 받기", operationId: input.operationId, payload: input });
}
interface DownloadProgress { engine: string; file: string; percent: number | null; message: string; done: boolean; error: string | null }
interface DownloadResult { engine: string; fileName: string; sizeBytes: number; sha256: string; expectedSha256Verified: boolean; reused: boolean }
registerTaskRunner("control.lora.download", async (raw, report, task) => {
  const input = controlLoraDownloadSchema.parse(raw);
  if (isStopping(task.id)) return;
  const name = input.file.split("/").pop();
  const unlisten = await listen<DownloadProgress>("lora-progress", ({ payload }) => {
    if (payload.engine !== input.engine || payload.file !== name) return;
    report({ step: payload.message || (payload.done ? "다운로드 종료" : "받는 중"),
      progress: payload.percent === null ? undefined : Math.min(1, Math.max(0, payload.percent / 100)) });
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let cancelSent = false;
  try {
    if (isStopping(task.id)) return;
    const pending = invoke<DownloadResult>("lora_download_control", { engine: input.engine, repo: input.repo,
      file: input.file, transferId: task.id, expectedSha256: input.expectedSha256 ?? null });
    // 진행 이벤트가 없는 서버 대기·해시 검사에서도 중지 요청을 전달합니다.
    timer = setInterval(() => {
      if (isStopping(task.id) && !cancelSent) {
        cancelSent = true;
        void invoke<boolean>("lora_download_cancel", { transferId: task.id }).then(found => {
          if (!found) cancelSent = false;
        }).catch(() => { cancelSent = false; });
      }
    }, 200);
    const data = await pending;
    await refreshLoraFiles();
    return { data: { ...data, modelInstalled: false, generationEnabled: false } };
  } finally {
    if (timer !== undefined) clearInterval(timer);
    unlisten();
  }
});
