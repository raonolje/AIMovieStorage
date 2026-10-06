import { invoke } from "@tauri-apps/api/core";
import { MaintenanceCoordinator } from "./maintenanceCore";
import { setMaintenanceHeld, maintenanceHeld, flushMaintenanceEditors, maintenanceActivityBlockers } from "./maintenanceGate";
import { flushTaskJournal, listPersistedTasks } from "./taskQueue";
import { flushProjectPersistence } from "./localProjectStore";
import { flushSettingsPersistence } from "./mediaLibrary";
import { listCompositionSessions } from "./compositionControl";
import { t } from "./i18n";
import { getComfyGenerationSettings } from "./comfyGeneration";
let activeMutations = 0;
export function beginControlMutation() { activeMutations++; return () => { activeMutations--; }; }
async function inspect() {
  const blockers: string[] = maintenanceActivityBlockers();
  const tasks = await listPersistedTasks();
  if (tasks.some(task => task.status === "waiting" || task.status === "running")) blockers.push(t("작업 또는 다운로드가 남아 있습니다."));
  if (activeMutations) blockers.push(t("다른 조종 요청이 처리 중입니다."));
  // 편집기마다 비동기 폴더 정리와 개별 미저장 상태가 달라, 목록으로 돌아온 뒤에만 종료를 승인합니다.
  if (listCompositionSessions().length || window.location.pathname !== "/") blockers.push(t("편집 내용을 저장하고 프로젝트 목록으로 돌아온 뒤 종료해 주세요."));
  const native = await invoke<{ blockers: string[] }>("maintenance_status");
  blockers.push(...native.blockers);
  const comfy = await invoke<{ running: number; waiting: number }>("maintenance_comfy_queue", { baseUrl: getComfyGenerationSettings().baseUrl });
  if (comfy.running || comfy.waiting) blockers.push(t("ComfyUI 작업이 남아 있습니다."));
  return blockers;
}
export const maintenance = new MaintenanceCoordinator({
  inspect,
  flush: async () => { await flushMaintenanceEditors(); await flushProjectPersistence(); await flushSettingsPersistence(); await flushTaskJournal(); },
  hold: setMaintenanceHeld,
  now: Date.now,
  token: () => crypto.randomUUID(),
});
export async function maintenanceStatus() { return { ...maintenance.status(), blockers: await inspect(), installationReady: false, otherInstanceClosureVerified: false }; }
export async function prepareMaintenance(input: { producerSafeBoundaryConfirmed: boolean }) { return maintenance.prepare(input.producerSafeBoundaryConfirmed); }
export function abortMaintenance() { maintenance.abort(); return { aborted: true }; }
export async function quitMaintenance(input: { token: string }) {
  await maintenance.commit(input.token, () => invoke("maintenance_request_quit"));
  return { ownGuiQuitRequested: true, attachedForwarderCloseSupported: true, otherInstanceClosureVerified: false, installationReady: false };
}
export async function installMaintenanceWindowGuard() {
  const { toast } = await import("sonner");
  const { listen } = await import("@tauri-apps/api/event");
  await listen("maintenance-quit-cancelled", () => { maintenance.cancelRequestedExit(); toast.error(t("종료 직전 상태가 바뀌어 앱을 계속 실행합니다.")); });
  const stopEditing = (event: Event) => { if (maintenanceHeld()) { event.preventDefault(); event.stopImmediatePropagation(); } };
  for (const name of ["click", "keydown", "beforeinput", "drop", "pointerdown"]) document.addEventListener(name, stopEditing, true);
  let closing = false;
  await listen("maintenance-close-request", async () => {
    if (closing) return;
    closing = true;
    if (!window.confirm(t("모든 제작 작업을 멈춘 안전 경계임을 확인하고 앱 종료를 준비할까요?"))) { closing = false; return; }
    try { const prepared = await prepareMaintenance({ producerSafeBoundaryConfirmed: true }); await quitMaintenance(prepared); }
    catch (error) { toast.error(String(error)); }
    finally { closing = false; }
  });
}
