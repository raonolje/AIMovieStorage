import { z } from "zod";
import { runComfyToProject, type ComfyRunRequest } from "./comfyGeneration";
import {
  getTask, isStopping, saveTaskExternalCheckpoint, setTaskResult,
  flushTaskJournal, type QueueTask,
} from "./taskQueue";

const outputSchema = z.object({
  path: z.string().min(1), name: z.string().min(1),
  kind: z.enum(["image", "video", "audio"]), nodeId: z.string().min(1),
  sha256:z.string().optional(),bytes:z.number().optional(),provenance:z.unknown().optional(),mediaFacts:z.record(z.string(),z.unknown()).optional(),
});
const checkpointSchema = z.object({
  provider: z.literal("comfyui"),
  phase: z.enum(["prepared","submitting", "submitted", "collected", "cancelled-before-submit"]),
  promptId: z.string().min(1).optional(),
  files: z.array(outputSchema).optional(),
});

/** UI와 조종기가 같은 기록을 써야 재시작·응답 유실 때 생성을 다시 결제하지 않습니다. */
export async function runQueuedComfy(
  request: ComfyRunRequest,
  report: (change: { step?: string; progress?: number }) => void,
  task: QueueTask,
) {
  const saved = getTask(task.id)?.externalCheckpoint;
  const checkpoint = saved ? checkpointSchema.parse(saved) : undefined;
  if(checkpoint?.phase==="cancelled-before-submit")throw new Error("ComfyUI 제출 전에 취소한 작업입니다. 새 작업 번호로 명시적으로 요청하세요.");
  if (checkpoint?.phase === "submitting")
    throw new Error("ComfyUI 제출 응답을 확인하지 못했습니다. 중복 생성을 막기 위해 다시 보내지 않습니다. ComfyUI 작업 내역을 확인한 뒤 새 작업을 요청하세요.");
  if (checkpoint?.phase === "collected") {
    if (!checkpoint.promptId || !checkpoint.files?.length)
      throw new Error("ComfyUI 완료 기록이 불완전합니다. 작업 내역을 확인하세요.");
    // 등록 실패 뒤 사람이 파일을 옮기거나 고쳤을 수 있습니다. 다시 생성하지 않고
    // 같은 작업을 수집해 네이티브 영수증의 경로·SHA256 검사를 다시 거칩니다.
  }
  if (checkpoint?.phase === "submitted" && !checkpoint.promptId)
    throw new Error("ComfyUI 작업 번호를 찾지 못했습니다. 다시 제출하지 않습니다.");
  let promptId = checkpoint?.promptId;
  const save=(next:Record<string,unknown>)=>saveTaskExternalCheckpoint(task.id,{...getTask(task.id)?.externalCheckpoint,...next});
  return runComfyToProject({
    ...request,
    existingPromptId: promptId,
    clientId: `aimoviestorage-${task.id}`,
    shouldStop: () => isStopping(task.id),
    onProgress: step => report({ step }),
    onSubmitting: () => save({ provider: "comfyui", phase: "submitting" }),
    onSubmissionCancelled: () => save({ provider: "comfyui", phase: "cancelled-before-submit" }),
    onSubmitted: async id => {
      promptId = id;
      await save({ provider: "comfyui", phase: "submitted", promptId: id });
    },
    onCollected: async files => {
      await save({ provider: "comfyui", phase: "collected", promptId, files });
      // 프로젝트 등록이 실패해도 이미 만든 파일과 서버 작업 번호는 조회할 수 있어야 합니다.
      setTaskResult(task.id, { paths: files.map(file => file.path), data: { promptId, attached: false } });
      await flushTaskJournal();
    },
  });
}
