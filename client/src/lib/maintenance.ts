import { invoke } from "@tauri-apps/api/core";
import { MaintenanceCoordinator } from "./maintenanceCore";
import { setMaintenanceHeld, maintenanceHeld, flushMaintenanceEditors, maintenanceActivityBlockers } from "./maintenanceGate";
import { flushTaskJournal, listPersistedTasks, listTasks } from "./taskQueue";
import { flushProjectPersistence } from "./localProjectStore";
import { flushSettingsPersistence } from "./mediaLibrary";
import { listCompositionSessions } from "./compositionControl";
import { t } from "./i18n";
import { getComfyGenerationSettings } from "./comfyGeneration";
let activeMutations = 0;
export function beginControlMutation() { activeMutations++; return () => { activeMutations--; }; }
async function inspect(allowIdleWorkers = false, windowClose = false) {
  const blockers: string[] = maintenanceActivityBlockers();
  const native = await invoke<{ blockers: string[]; workBlockers?: string[]; journalOwned?: boolean }>("maintenance_status");
  // 잠금을 못 얻은 중복 창은 작업을 실행할 수 없습니다. 다른 창의 원본 기록을 읽거나 덮어쓰지 않습니다.
  const tasks = windowClose && native.journalOwned === false ? listTasks() : await listPersistedTasks();
  if (tasks.some(task => task.status === "waiting" || task.status === "running")) blockers.push(t("작업 또는 다운로드가 남아 있습니다."));
  if (activeMutations) blockers.push(t("다른 조종 요청이 처리 중입니다."));
  // 편집기마다 비동기 폴더 정리와 개별 미저장 상태가 달라, 목록으로 돌아온 뒤에만 종료를 승인합니다.
  const path = window.location.pathname;
  if (listCompositionSessions().length || (path !== "/" && (!windowClose || path.startsWith("/project/") || path === "/new-project"))) blockers.push(t("편집 내용을 저장하고 프로젝트 목록으로 돌아온 뒤 종료해 주세요."));
  // 구버전 또는 불완전한 응답은 기존 장벽을 유지합니다. 번역 문구로 워커를 골라 빼지 않습니다.
  blockers.push(...(allowIdleWorkers && Array.isArray(native.workBlockers) ? native.workBlockers : native.blockers));
  // 일반 창 닫기는 이 앱의 작업과 저장만 책임집니다. 외부 ComfyUI는 닫거나 중단하지 않습니다.
  // 설치·유지보수 API는 전체 GPU 큐를 계속 엄격하게 확인합니다.
  if (!windowClose) {
    const comfy = await invoke<{ running: number; waiting: number }>("maintenance_comfy_queue", { baseUrl: getComfyGenerationSettings().baseUrl });
    if (comfy.running || comfy.waiting) blockers.push(t("ComfyUI 작업이 남아 있습니다."));
  }
  return blockers;
}
let workerReleaseOperationId: string | null = null;
function coordinator(windowClose = false) { return new MaintenanceCoordinator({
  inspect: () => inspect(false, windowClose),
  inspectBeforeWorkerRelease: () => inspect(true, windowClose),
  releaseIdleWorkers: async () => {
    const operationId = crypto.randomUUID(); workerReleaseOperationId = operationId;
    try { await invoke("maintenance_release_idle_workers", { operationId }); }
    finally { if (workerReleaseOperationId === operationId) workerReleaseOperationId = null; }
  },
  cancelIdleWorkerRelease: async () => {
    const operationId = workerReleaseOperationId;
    if (operationId) await invoke("maintenance_cancel_idle_workers", { operationId });
  },
  flush: async () => {
    await flushMaintenanceEditors(); await flushProjectPersistence(); await flushSettingsPersistence();
    const status = windowClose ? await invoke<{ journalOwned?: boolean }>("maintenance_status") : null;
    if (status?.journalOwned !== false) await flushTaskJournal();
  },
  hold: setMaintenanceHeld,
  now: Date.now,
  token: () => crypto.randomUUID(),
}); }
export const maintenance = coordinator();
const windowMaintenance = coordinator(true);
export async function closeAppWindow() {
  if (maintenanceHeld()) throw new Error(t("다른 종료 준비가 진행 중입니다."));
  const prepared = await windowMaintenance.prepare(true);
  await windowMaintenance.commit(prepared.token, () => invoke("maintenance_request_quit"));
}
export async function maintenanceWorkerStatus() { return invoke("maintenance_worker_status"); }
export async function maintenanceStatus() { return { ...maintenance.status(), blockers: await inspect(), workerShutdown: await maintenanceWorkerStatus(), installationReady: false, otherInstanceClosureVerified: false }; }
export async function prepareMaintenance(input: { producerSafeBoundaryConfirmed: boolean }) {
  if (maintenanceHeld()) throw new Error(t("다른 종료 준비가 진행 중입니다."));
  return maintenance.prepare(input.producerSafeBoundaryConfirmed);
}
export async function abortMaintenance() {
  const closing = windowMaintenance.status();
  if (closing.preparing || closing.closing || closing.prepared) throw new Error(t("창 닫기가 진행 중입니다."));
  await maintenance.abort(); const state = maintenance.status(); return { aborted: !state.preparing, cancellationPending: state.preparing, cancellationRequested: state.cancellationRequested };
}
export async function quitMaintenance(input: { token: string }) {
  await maintenance.commit(input.token, () => invoke("maintenance_request_quit"));
  return { ownGuiQuitRequested: true, attachedForwarderCloseSupported: true, otherInstanceClosureVerified: false, installationReady: false };
}
export async function installMaintenanceWindowGuard() {
  const { toast } = await import("sonner");
  const { listen } = await import("@tauri-apps/api/event");
  await listen("maintenance-quit-cancelled", () => { maintenance.cancelRequestedExit(); windowMaintenance.cancelRequestedExit(); toast.error(t("종료 직전 상태가 바뀌어 앱을 계속 실행합니다.")); });
  const stopEditing = (event: Event) => { if (maintenanceHeld()) { event.preventDefault(); event.stopImmediatePropagation(); } };
  for (const name of ["click", "keydown", "beforeinput", "drop", "pointerdown"]) document.addEventListener(name, stopEditing, true);
  let closing = false;
  await listen("maintenance-close-request", async () => {
    if (closing) return;
    closing = true;
    if (!window.confirm(t("이 앱의 작업과 저장 상태를 확인하고 종료할까요? 외부 ComfyUI 서버는 종료하지 않습니다."))) { closing = false; return; }
    try { await closeAppWindow(); }
    catch (error) { toast.error(String(error)); }
    finally { closing = false; }
  });
}
