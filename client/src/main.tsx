import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
/*
  ── 작업 줄을 먼저 깨웁니다 ─────────────────────────────────────────────

  

  **일을 할 줄 아는 함수(러너)가 먼저 등록되어야** 줄이 이어집니다. 화면을 열어야
  등록되게 두면, 그 화면에 가기 전까지 앞서 하던 일이 줄에 선 채로 멈춰 있습니다.
  그래서 여기서 통째로 불러옵니다 — 불러오는 것만으로 제 러너를 답니다.
  일괄 생성의 러너는 살림(`bootstrapStore`)이 아니라 «돌리기»(`bootstrapRun`)에 있습니다 —
  살림만 불러오면 러너가 안 달립니다.
*/
import "./lib/bootstrapStore";
import "./lib/bootstrapRun";
import "./lib/batchRun";
import "./lib/comfyUiTasks";
import { resumeTaskQueue } from "./lib/taskQueue";
import { refreshMagnificStatus } from "./lib/magnificMcp";

createRoot(document.getElementById("root")!).render(<App />);

resumeTaskQueue();
/*
  마그니픽에 연결되어 있는지 **앱을 켤 때** 읽습니다. 설정 화면에서만 읽었더니, 그 화면을
  안 연 세션에서는 「한 번에 뽑기」 목록에 «끝까지 뽑기» 가 아예 안 떴습니다.
*/
void refreshMagnificStatus();
