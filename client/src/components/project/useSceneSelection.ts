import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { editorActivityStore, editorSessionStore, resolveSelectedScene, sceneEditorStore } from "@/lib/sceneEditorState";
import type { Scene } from "@/lib/projectTypes";

export function useSceneSelection(projectId: string | undefined, scenes: readonly Pick<Scene, "id">[]) {
  const draftKey = useRef(`draft:${crypto.randomUUID()}`);
  const key = projectId || draftKey.current;
  const previousKey = useRef(key);
  const getSnapshot = useCallback(() => sceneEditorStore.get(key), [key]);
  const state = useSyncExternalStore(sceneEditorStore.subscribe, getSnapshot, getSnapshot);
  const adopting = previousKey.current.startsWith("draft:") && previousKey.current !== key;
  const preference = adopting && !state.selection ? sceneEditorStore.get(previousKey.current).selection : state.selection;
  const selectedId = resolveSelectedScene(scenes, preference);
  useEffect(() => {
    if (adopting) {
      sceneEditorStore.adopt(previousKey.current, key);
      editorActivityStore.adopt(previousKey.current, key);
      editorSessionStore.adopt(previousKey.current, key);
    }
    previousKey.current = key;
    sceneEditorStore.reconcile(key, scenes);
  }, [key, scenes, adopting]);
  const select = useCallback((id: string) => sceneEditorStore.select(key, scenes, id), [key, scenes]);
  return { selectedId, select, stateKey: key };
}

/** 명시한 false를 초기값으로 덮지 않습니다. 새 컷·설정만 기본으로 펼쳐집니다. */
export function useEditorDisclosure(key: string, id: string, section: string) {
  const getSnapshot = useCallback(() => sceneEditorStore.get(key), [key]);
  const state = useSyncExternalStore(sceneEditorStore.subscribe, getSnapshot, getSnapshot);
  const open = state.disclosures[id]?.[section] ?? true;
  const setOpen = (next: boolean) => sceneEditorStore.disclose(key, id, section, next);
  return [open, setOpen] as const;
}

export function useEditorGroups(key: string, id: string) {
  const getSnapshot = useCallback(() => sceneEditorStore.get(key), [key]);
  const state = useSyncExternalStore(sceneEditorStore.subscribe, getSnapshot, getSnapshot);
  const groups = Object.fromEntries(Object.entries(state.disclosures[id] ?? {})
    .filter(([section]) => section.startsWith("group:"))
    .map(([section, open]) => [section.slice(6), open]));
  return [groups, (next: Record<string, boolean>) => sceneEditorStore.groups(key, id, next)] as const;
}

export function useEditorActivity(key: string, id: string, operation: string) {
  const activityKey = JSON.stringify([key, id, operation]);
  const getSnapshot = useCallback(() => editorActivityStore.get(activityKey), [activityKey]);
  const busy = useSyncExternalStore(editorActivityStore.subscribe, getSnapshot, getSnapshot);
  return [busy, (next: boolean) => editorActivityStore.set(activityKey, next)] as const;
}

/** 생성 입력의 컷별 선택도 씬 이동 전후에 같습니다. 작업 데이터나 실행 지원은 바꾸지 않습니다. */
export function useEditorSessionValue<T>(key: string, id: string, field: string, initial: T) {
  const sessionKey = JSON.stringify([key, id, field]);
  const getSnapshot = useCallback(() => editorSessionStore.get(sessionKey, initial), [sessionKey, initial]);
  const value = useSyncExternalStore(editorSessionStore.subscribe, getSnapshot, getSnapshot);
  return [value, (next: T) => editorSessionStore.set(sessionKey, next)] as const;
}
