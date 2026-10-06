import { t } from "./i18n";
let held = false;
export function maintenanceHeld() { return held; }
export function setMaintenanceHeld(value: boolean) { held = value; }
export function assertMaintenanceWritable() {
  if (held) throw new Error(t("안전 종료 준비 중에는 새 작업과 변경을 시작할 수 없습니다."));
}
const saves = new Set<() => void | Promise<void>>();
export function registerMaintenanceSave(save: () => void | Promise<void>) {
  saves.add(save); return () => { saves.delete(save); };
}
export async function flushMaintenanceEditors() { for (const save of [...saves]) await save(); }

const activities = new Map<string, number>();
const failedActivities = new Set<string>();
export function startMaintenanceActivity(label: string) {
  assertMaintenanceWritable();
  activities.set(label, (activities.get(label) ?? 0) + 1);
  let finished = false;
  return (success: boolean) => {
    if (finished) return; finished = true;
    const left = (activities.get(label) ?? 1) - 1;
    if (left) activities.set(label, left); else activities.delete(label);
    if (success) failedActivities.delete(label); else failedActivities.add(label);
  };
}
export function maintenanceActivityBlockers() {
  return [...activities.keys(), ...failedActivities].map(label => t("폴더 저장 또는 정리의 완료를 확인하지 못했습니다.") + " " + label);
}
