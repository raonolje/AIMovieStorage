import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { scenePageBounds, scenePageForIndex } from "./sceneNavigationPages";
import { createSceneEditorStore, resolveSelectedScene } from "./sceneEditorState";
import SceneNavigation from "@/components/project/SceneNavigation";

describe("씬 다섯 개씩 표시", () => {
  it.each([1, 5, 6, 10, 11, 24])("%i개 씬은 정확한 마지막 묶음과 화살표 상태를 계산합니다", count => {
    const first = scenePageBounds(count, 0);
    expect(first.start).toBe(0);
    expect(first.end).toBe(Math.min(count, 5));
    expect(first.hasPrevious).toBe(false);
    expect(first.hasNext).toBe(count > 5);
    const last = scenePageBounds(count, 999);
    expect(last.end).toBe(count);
    expect(last.end - last.start).toBe((count - 1) % 5 + 1);
    expect(last.hasNext).toBe(false);
    expect(last.hasPrevious).toBe(count > 5);
  });
  it("빈 씬 목록은 두 화살표를 비활성화하고 탭 범위가 비어 있습니다", () => {
    expect(scenePageBounds(0, 8)).toEqual({ page: 0, pages: 0, start: 0, end: 0, hasPrevious: false, hasNext: false });
    expect(scenePageBounds(6, -1).page).toBe(0);
  });
  it.each([[0, 0], [4, 0], [5, 1], [9, 1], [10, 2], [23, 4]])("직접 이동·복원 위치 %i는 묶음 %i에 있습니다", (index, page) => {
    expect(scenePageForIndex(index)).toBe(page);
  });
  it("묶음 탐색은 저장된 선택 ID를 고치지 않고 재정렬·삭제 후 위치만 다시 계산합니다", () => {
    const scenes=Array.from({length:24}, (_,i)=>({id:`s${i+1}`}));
    const store=createSceneEditorStore(()=>null);
    store.select("A",scenes,"s6");
    expect(scenePageBounds(scenes.length,3).start).toBe(15);
    expect(store.get("A").selection?.sceneId).toBe("s6");
    const reordered=[...scenes].reverse();
    const selected=resolveSelectedScene(reordered,store.get("A").selection);
    expect(selected).toBe("s6");
    expect(scenePageForIndex(reordered.findIndex(s=>s.id===selected))).toBe(3);
    store.reconcile("A",reordered);
    const remaining=reordered.filter(s=>s.id!=="s6");
    const fallback=resolveSelectedScene(remaining,store.get("A").selection);
    expect(fallback).toBe("s5");
    expect(scenePageForIndex(remaining.findIndex(s=>s.id===fallback))).toBe(3);
  });
  it("씬 추가·복제 새 ID 선택과 프로젝트별 복원은 같은 범위 규칙을 사용합니다", () => {
    const scenes=Array.from({length:10}, (_,i)=>({id:`s${i+1}`}));
    const store=createSceneEditorStore(()=>null);
    store.select("A",scenes,"s10");store.select("B",scenes,"s2");
    const added=[...scenes,{id:"copy-new-id"}];
    expect(resolveSelectedScene(added,store.get("A").selection)).toBe("s10");
    store.select("A",added,"copy-new-id");
    expect(scenePageForIndex(added.findIndex(s=>s.id===resolveSelectedScene(added,store.get("A").selection)))).toBe(2);
    expect(scenePageForIndex(scenes.findIndex(s=>s.id===resolveSelectedScene(scenes,store.get("B").selection)))).toBe(0);
  });
  it.each([0,1,5,6,10,11,24])("실제 내비게이션 %i개 씬의 복원 그룹은 5개 이하 짧은 탭만 렌더링합니다", count => {
    const scenes=Array.from({length:count},(_,i)=>({id:`s${i+1}`,title:`긴 씬 제목 ${i+1}`}));
    const html=renderToStaticMarkup(createElement(SceneNavigation,{scenes,selectedId:scenes.at(-1)?.id??null,onSelect:()=>{}}));
    expect((html.match(/role="tab"/g)??[]).length).toBe(count?(count-1)%5+1:0);
    expect(html).not.toContain('overflow-x-auto');
    expect(html.replace(/<[^>]+>/g,'')).not.toContain('긴 씬 제목');
    if(count){expect(html).toContain(`aria-label="씬 ${count} · 긴 씬 제목 ${count}"`);expect(html).toContain(`>씬${count}</button>`);}
    expect(html).toContain('grid-cols-5');
  });
});
