import type { CompositionState } from "./composition";
// 외부 명령의 명시적 키 시각을 UI 커서의 자동 키로 덮지 않습니다. 파일 상태에는 표식을 저장하지 않습니다.
const controlled = new WeakSet<CompositionState>();
let editing = 0;
export function controllerEdit<T>(action: () => T): T { editing++; try { return action(); } finally { editing--; } }
export function markControllerState(state: CompositionState) { controlled.add(state); return state; }
export function isControllerState(state: CompositionState) { return editing > 0 || controlled.has(state); }
