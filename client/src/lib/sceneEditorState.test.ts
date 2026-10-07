import { describe, expect, it, vi } from "vitest";
import { createEditorActivityStore, createEditorSessionStore, createSceneEditorStore, resolveSelectedScene, sceneAtNumber, sceneTabIndex } from "./sceneEditorState";

const scenes = (ids: string[]) => ids.map(id => ({ id }));
function setup() {
  const files = new Map<string, string>();
  const storage = { getItem: (key: string) => files.get(key) ?? null, setItem: (key: string, value: string) => { files.set(key, value); } };
  return { files, storage, store: createSceneEditorStore(() => storage) };
}
describe("씬 하위 페이지 선택과 자동 복원", () => {
  it("빈 목록은 선택이 없고 처음 열린 작품은 첫 씬으로 시작합니다", () => {
    expect(resolveSelectedScene([], null)).toBeNull();
    expect(resolveSelectedScene(scenes(["a", "b"]), null)).toBe("a");
  });
  it("저장은 즉시 되며 새 store(재시작)도 같은 ID를 복원합니다", () => {
    const { store, storage } = setup();
    store.select("p", scenes(["a", "b", "c"]), "b");
    expect(createSceneEditorStore(() => storage).reconcile("p", scenes(["a", "b", "c"]))).toBe("b");
  });
  it("재정렬·복제·batch append와 cut 갱신에도 기존 선택 ID를 유지합니다", () => {
    const { store } = setup();
    store.select("p", scenes(["a", "b", "c"]), "b");
    expect(store.reconcile("p", scenes(["c", "a", "b", "b-copy", "ai-new"]))).toBe("b");
    expect(store.get("p").selection?.index).toBe(2);
    expect(store.reconcile("p", scenes(["c", "a", "b", "b-copy", "ai-new"]))).toBe("b");
  });
  it("삭제된 선택은 예전 순서의 가까운 생존 씬으로, 같은 거리면 뒤쪽으로 갑니다", () => {
    const { store } = setup();
    store.select("p", scenes(["a", "b", "c", "d", "e"]), "c");
    expect(store.reconcile("p", scenes(["e", "b", "d"]))).toBe("d");
    store.select("q", scenes(["a", "b", "c", "d", "e"]), "d");
    expect(store.reconcile("q", scenes(["b", "c"]))).toBe("c");
  });
  it("마지막 씬 삭제와 모든 ID 교체는 유효 범위의 위치로 복원합니다", () => {
    const { store } = setup();
    store.select("p", scenes(["a", "b", "c"]), "c");
    expect(store.reconcile("p", scenes(["a", "b"]))).toBe("b");
    expect(store.reconcile("p", scenes(["x"]))).toBe("x");
  });
  it("load/refresh의 빈 중간 상태는 이전 선택을 지우지 않습니다", () => {
    const { store, storage } = setup();
    store.select("p", scenes(["a", "b"]), "b");
    expect(store.reconcile("p", [])).toBeNull();
    const restart = createSceneEditorStore(() => storage);
    expect(restart.reconcile("p", [])).toBeNull();
    expect(restart.reconcile("p", scenes(["a", "b"]))).toBe("b");
  });
  it("작품 전환은 선택·접힘을 공유하지 않고 돌아오면 각자의 ID를 엽니다", () => {
    const { store } = setup();
    store.select("p1", scenes(["same", "b"]), "b");
    store.disclose("p1", "same", "cut", false);
    expect(store.reconcile("p2", scenes(["same", "c"]))).toBe("same");
    expect(store.get("p2").disclosures.same).toBeUndefined();
    expect(store.reconcile("p1", scenes(["same", "b"]))).toBe("b");
  });
  it("새 씬 추가는 부모 갱신과 함께 그 ID를 선택하며 원본 배열은 바꾸지 않습니다", () => {
    const { store } = setup();
    const original = scenes(["a", "b"]);
    store.select("p", original, "new");
    expect(store.reconcile("p", [...original, { id: "new" }])).toBe("new");
    expect(original).toEqual(scenes(["a", "b"]));
  });
  it("첫 저장은 임시 편집 선택을 이전하지만 기존 프로젝트 선택은 덮지 않습니다", () => {
    const { store, files } = setup();
    store.select("draft:one", scenes(["a", "b"]), "b");
    expect(files.size).toBe(0);
    store.adopt("draft:one", "p");
    expect(store.get("p").selection?.sceneId).toBe("b");
    store.select("q", scenes(["a", "b"]), "a");
    store.adopt("draft:one", "q");
    expect(store.get("q").selection?.sceneId).toBe("a");
  });
  it("직접 접은 false와 그룹 선택은 재시작에도 보존하고 새 설정은 값이 없습니다", () => {
    const { store, storage } = setup();
    store.disclose("p", "cut", "cut", false);
    store.groups("p", "cut", { style: false, lighting: true });
    const restored = createSceneEditorStore(() => storage).get("p").disclosures;
    expect(restored.cut).toEqual({ cut: false, "group:style": false, "group:lighting": true });
    expect(restored.newCut).toBeUndefined();
  });
  it("저장소 오류·손상은 예외 없이 메모리 상태와 기본 선택을 사용합니다", () => {
    const broken = createSceneEditorStore(() => ({ getItem: () => { throw Error("locked"); }, setItem: () => { throw Error("full"); } }));
    broken.select("p", scenes(["a", "b"]), "b");
    expect(broken.reconcile("p", scenes(["a", "b"]))).toBe("b");
    const corrupt = createSceneEditorStore(() => ({ getItem: () => "{bad", setItem: () => {} }));
    expect(corrupt.reconcile("p", scenes(["a"]))).toBe("a");
  });
  it("같은 정보의 갱신은 중복 저장·알림을 만들지 않습니다", () => {
    const { store } = setup(); const listener = vi.fn(); const unsubscribe = store.subscribe(listener);
    store.reconcile("p", scenes(["a", "b"]));
    store.reconcile("p", scenes(["a", "b"]));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); store.select("p", scenes(["a", "b"]), "b");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("씬 번호와 키보드 탭", () => {
  it.each(["", "0", "-1", "1.5", "3", "1e0", "abc", "Infinity", "99999999999999999999"])("없는/잘못된 번호 %s는 이동하지 않습니다", input => {
    expect(sceneAtNumber(scenes(["a", "b"]), input)).toBeNull();
  });
  it("표시 번호는 현재 순서를 사용합니다", () => {
    expect(sceneAtNumber(scenes(["b", "a"]), " 2 ")).toBe("a");
    expect(sceneAtNumber([], "1")).toBeNull();
  });
  it("좌우 순환/Home/End로 전체 씬에 접근합니다", () => {
    expect(sceneTabIndex(0, "ArrowLeft", 40)).toBe(39);
    expect(sceneTabIndex(39, "ArrowRight", 40)).toBe(0);
    expect(sceneTabIndex(21, "Home", 40)).toBe(0);
    expect(sceneTabIndex(1, "End", 40)).toBe(39);
    expect(sceneTabIndex(0, "Tab", 40)).toBeNull();
    expect(sceneTabIndex(0, "End", 0)).toBeNull();
  });
});

describe("컷 작업/생성 입력의 씬 이동 경계", () => {
  it("요청 중 최초 자동 저장으로 프로젝트 ID가 생겨도 잠금/입력을 이전하고 옛 callback으로 해제합니다", () => {
    const busy=createEditorActivityStore(),values=createEditorSessionStore();
    const before=JSON.stringify(["draft:one","cut","prompt"]),after=JSON.stringify(["saved","cut","prompt"]);
    busy.set(before,true); values.set(before,"720p");
    busy.adopt("draft:one","saved"); values.adopt("draft:one","saved");
    expect(busy.get(after)).toBe(true); expect(values.get(after,"1080p")).toBe("720p");
    busy.set(before,false); expect(busy.get(after)).toBe(false);
  });
  it("진행 중 요청 잠금은 재마운트에서도 유지하고 끝나면 해제하며 재시작에는 남기지 않습니다", () => {
    const store = createEditorActivityStore(); const listener = vi.fn(); store.subscribe(listener);
    store.set("p/cut/image", true);
    expect(store.get("p/cut/image")).toBe(true);
    expect(store.get("q/cut/image")).toBe(false);
    expect(createEditorActivityStore().get("p/cut/image")).toBe(false);
    store.set("p/cut/image", false);
    expect(store.get("p/cut/image")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("씬을 다시 열어도 컷의 생성 해상도·음악 선택은 그대로입니다", () => {
    const store = createEditorSessionStore();
    expect(store.get("p/cut/resolution", "1080p")).toBe("1080p");
    store.set("p/cut/resolution", "720p");
    store.set("p/cut/music", false);
    expect(store.get("p/cut/resolution", "1080p")).toBe("720p");
    expect(store.get("p/cut/music", true)).toBe(false);
    expect(store.get("q/cut/resolution", "1080p")).toBe("1080p");
  });
});
