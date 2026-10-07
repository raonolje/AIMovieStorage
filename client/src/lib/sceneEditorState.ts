/** 씬 번호는 표시 순서입니다. 복원은 ID로 하며, 삭제됐으면 이전 순서에서 가까운 생존 씬을 고릅니다. */
export interface SceneSelection {
  sceneId: string;
  index: number;
  sceneIds: string[];
}
export interface SceneEditorState {
  selection: SceneSelection | null;
  disclosures: Record<string, Record<string, boolean>>;
}
type SceneIdentity = { id: string };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const PREFIX = "ai-video-storage.scene-editor.v1.";

export function resolveSelectedScene(scenes: readonly SceneIdentity[], saved: SceneSelection | null): string | null {
  if (!scenes.length) return null;
  if (!saved) return scenes[0].id;
  if (scenes.some(scene => scene.id === saved.sceneId)) return saved.sceneId;
  const origin = saved.sceneIds.indexOf(saved.sceneId);
  if (origin >= 0) {
    // 같은 거리라면 뒤 씬, 맨 끝이었다면 앞 씬으로 갑니다.
    for (let distance = 1; distance < saved.sceneIds.length; distance++) {
      for (const index of [origin + distance, origin - distance]) {
        const id = saved.sceneIds[index];
        if (id && scenes.some(scene => scene.id === id)) return id;
      }
    }
  }
  return scenes[Math.min(Math.max(saved.index, 0), scenes.length - 1)].id;
}

export function sceneAtNumber(scenes: readonly SceneIdentity[], input: string): string | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? scenes[number - 1]?.id ?? null : null;
}

export function sceneTabIndex(index: number, key: string, count: number): number | null {
  if (!count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  return null;
}

function parseState(raw: string | null): SceneEditorState {
  const empty = { selection: null, disclosures: {} };
  if (!raw) return empty;
  try {
    const data = JSON.parse(raw);
    const s = data?.selection;
    const selection = typeof s?.sceneId === "string" && Number.isInteger(s.index) && s.index >= 0
      && Array.isArray(s.sceneIds) && s.sceneIds.every((id: unknown) => typeof id === "string") ? s : null;
    const disclosures: SceneEditorState["disclosures"] = {};
    for (const [id, value] of Object.entries(data?.disclosures ?? {})) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      disclosures[id] = Object.fromEntries(Object.entries(value).filter(([, open]) => typeof open === "boolean"));
    }
    return { selection, disclosures };
  } catch { return empty; }
}

/** UI 설정만 따로 저장합니다. 읽기 실패·용량 제한은 작업 데이터를 건드리지 않고 세션 메모리로 받칩니다. */
export function createSceneEditorStore(storage: () => PreferenceStorage | null) {
  const cache = new Map<string, SceneEditorState>();
  const listeners = new Set<() => void>();
  const get = (key: string): SceneEditorState => {
    let state = cache.get(key);
    if (!state) {
      let raw = null;
      try { if (!key.startsWith("draft:")) raw = storage()?.getItem(PREFIX + encodeURIComponent(key)) ?? null; } catch { /* 저장소가 잠겨도 화면은 엽니다. */ }
      state = parseState(raw);
      cache.set(key, state);
    }
    return state;
  };
  const update = (key: string, next: SceneEditorState) => {
    if (JSON.stringify(get(key)) === JSON.stringify(next)) return;
    cache.set(key, next);
    try { if (!key.startsWith("draft:")) storage()?.setItem(PREFIX + encodeURIComponent(key), JSON.stringify(next)); } catch { /* 세션 선택은 유지합니다. */ }
    listeners.forEach(listener => listener());
  };
  return {
    get,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    adopt: (from: string, to: string) => {
      if (!get(to).selection && !Object.keys(get(to).disclosures).length) update(to, get(from));
    },
    select: (key: string, scenes: readonly SceneIdentity[], id: string) => {
      const ids = scenes.map(scene => scene.id);
      const index = ids.indexOf(id);
      // 추가 버튼은 부모 초안과 같은 이벤트에서 선택합니다. 새 ID는 다음 렌더에 나타납니다.
      update(key, { ...get(key), selection: { sceneId: id, index: index < 0 ? ids.length : index, sceneIds: index < 0 ? [...ids, id] : ids } });
    },
    reconcile: (key: string, scenes: readonly SceneIdentity[]) => {
      const id = resolveSelectedScene(scenes, get(key).selection);
      // 최초 파일 읽기·refresh의 일시적인 빈 목록으로 저장해 둔 선택을 지우지 않습니다.
      if (id) {
        const ids = scenes.map(scene => scene.id);
        update(key, { ...get(key), selection: { sceneId: id, index: ids.indexOf(id), sceneIds: ids } });
      }
      return id;
    },
    disclose: (key: string, id: string, section: string, open: boolean) => {
      const state = get(key);
      update(key, { ...state, disclosures: { ...state.disclosures, [id]: { ...state.disclosures[id], [section]: open } } });
    },
    groups: (key: string, id: string, groups: Record<string, boolean>) => {
      const state = get(key);
      const values = Object.fromEntries(Object.entries(groups).map(([group, open]) => [`group:${group}`, open]));
      update(key, { ...state, disclosures: { ...state.disclosures, [id]: { ...state.disclosures[id], ...values } } });
    },
  };
}

export const sceneEditorStore = createSceneEditorStore(() => typeof window === "undefined" ? null : window.localStorage);

function createSessionKeyAliases() {
  const aliases = new Map<string, string>();
  const normalize = (key: string) => {
    try {
      const parts = JSON.parse(key);
      if (!Array.isArray(parts) || typeof parts[0] !== "string") return key;
      while (aliases.has(parts[0])) parts[0] = aliases.get(parts[0]);
      return JSON.stringify(parts);
    } catch { return key; }
  };
  return { normalize, adopt: (from: string, to: string) => { if (from !== to) aliases.set(from, to); } };
}

/** 씬 이동으로 컷이 해제돼도 진행 중 요청의 잠금은 유지합니다. 재시작에는 남기지 않습니다. */
export function createEditorActivityStore() {
  const active = new Set<string>();
  const listeners = new Set<() => void>();
  const scope = createSessionKeyAliases();
  return {
    get: (key: string) => active.has(scope.normalize(key)),
    adopt: (from: string, to: string) => {
      scope.adopt(from, to);
      for (const key of [...active]) { const next = scope.normalize(key); if (key !== next) { active.delete(key); active.add(next); } }
      listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (key: string, busy: boolean) => {
      key = scope.normalize(key);
      if (active.has(key) === busy) return;
      if (busy) active.add(key); else active.delete(key);
      listeners.forEach(listener => listener());
    },
  };
}
export const editorActivityStore = createEditorActivityStore();

export function createEditorSessionStore() {
  const values = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  const scope = createSessionKeyAliases();
  return {
    get: <T>(key: string, initial: T): T => {
      key = scope.normalize(key);
      if (!values.has(key)) values.set(key, initial);
      return values.get(key) as T;
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    adopt: (from: string, to: string) => {
      scope.adopt(from, to);
      for (const [key, value] of [...values]) {
        const next = scope.normalize(key);
        if (key !== next) { values.delete(key); if (!values.has(next)) values.set(next, value); }
      }
      listeners.forEach(listener => listener());
    },
    set: <T>(key: string, value: T) => { values.set(scope.normalize(key), value); listeners.forEach(listener => listener()); },
  };
}
export const editorSessionStore = createEditorSessionStore();
