import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dispatchAppControl } from "./appControlRegistry";
import { registerTaskJournal } from "./taskQueue";
import { whenAppSettingsReady } from "./mediaLibrary";
import { registerProjectNavigation } from "./projectControl";

let start: Promise<void> | undefined;
let error: string | null = null;
let readyResolve: () => void;
let readyReject: (reason: unknown) => void;
const ready = new Promise<void>((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
void ready.catch(() => undefined);
export function whenAppControlReady() {
  return ready;
}
export function getAppControlError() {
  return error;
}

/** 리스너와 작업 기록이 준비된 뒤에만 설정 화면이 외부 연결을 열 수 있습니다. */
export function initializeAppControl(
  navigate: (path: string) => void,
): Promise<void> {
  if (start) return start;
  start = (async () => {
    if (!("__TAURI_INTERNALS__" in window))
      throw new Error("외부 조종기는 데스크톱 앱에서 사용할 수 있습니다.");
    await whenAppSettingsReady();
    registerProjectNavigation((projectId) =>
      navigate(`/project/${encodeURIComponent(projectId)}`),
    );
    await registerTaskJournal({
      read: () => invoke("control_read_journal"),
      write: (journal) => invoke("control_write_journal", { journal }),
    });
    await listen<{ id: string; method: string; params: unknown }>(
      "app-control-request",
      (event) => {
        void dispatchAppControl(event.payload.method, event.payload.params)
          .then((result) =>
            invoke("control_respond", { id: event.payload.id, result }),
          )
          .catch((reason) =>
            invoke("control_respond", {
              id: event.payload.id,
              result: {
                isError: true,
                content: [{ type: "text", text: String(reason) }],
              },
            }),
          )
          .catch(() => undefined);
      },
    );
    readyResolve();
  })().catch((reason) => {
    error = String(reason);
    readyReject(reason);
    throw reason;
  });
  return start;
}
