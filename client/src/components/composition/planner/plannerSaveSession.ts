import type { CompositionState } from "@/lib/composition";

/** 되돌리기 기록 수가 아니라 실제 저장한 판과 견줍니다. 저장 뒤 undo하면 다시 미저장 상태입니다. */
export function createPlannerSaveSession(initial: CompositionState) {
  let baseline = JSON.stringify(initial);
  let generation = 0;
  let saving = false;
  let asking = false;
  return {
    reset(value: CompositionState) {
      baseline = JSON.stringify(value);
      generation += 1;
      asking = false;
    },
    isDirty(value: CompositionState) {
      return JSON.stringify(value) !== baseline;
    },
    get saving() { return saving; },
    get generation() { return generation; },
    async persist<T>(value: CompositionState, write: () => Promise<T>): Promise<T> {
      if (saving) throw new Error("구도를 저장하고 있습니다. 잠시 기다려 주세요.");
      const opened = generation;
      const saved = JSON.stringify(value);
      saving = true;
      try {
        const result = await write();
        // 지난 창의 늦은 응답으로 새로 연 구도를 «저장됨»으로 만들지 않습니다.
        if (generation === opened) baseline = saved;
        return result;
      } finally { saving = false; }
    },
    async requestClose(read: () => CompositionState, confirm: () => Promise<boolean>, close: () => void) {
      if (saving || asking) return false;
      const opened = generation;
      asking = true;
      try {
        if (JSON.stringify(read()) !== baseline && !(await confirm())) return false;
        if (generation !== opened || saving) return false;
        close();
        return true;
      } finally { if (generation === opened) asking = false; }
    },
  };
}
