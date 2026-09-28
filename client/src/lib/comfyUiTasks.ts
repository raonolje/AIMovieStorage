import { runQueuedComfy } from "@/lib/comfyTasks";
import type { ComfyRunRequest } from "@/lib/comfyGeneration";
import { registerTaskRunner } from "@/lib/taskQueue";
import { getLocalProject } from "@/lib/localProjectStore";

export const COMFY_UI_TASK = "comfy-ui-generate";
registerTaskRunner(COMFY_UI_TASK, async (payload, report, task) => {
  const request = payload as ComfyRunRequest;
  if (getLocalProject(task.projectId)?.folder !== request.projectName)
    throw new Error("ComfyUI 작업을 접수한 뒤 프로젝트 위치가 바뀌었습니다. 원래 프로젝트를 확인하세요.");
  const result = await runQueuedComfy(request, report, task);
  // 화면을 닫아도 파일·작업 번호는 남습니다. 카드의 폴더 다시 읽기도 같은 결과를 찾습니다.
  return { paths: result.files.map(file => file.path), data: { promptId: result.promptId, files: result.files } };
});
