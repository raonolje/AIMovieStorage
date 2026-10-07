import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { newProjectDraft, newScene } from "@/lib/projectTypes";
import { sceneEditorStore } from "@/lib/sceneEditorState";
import StepScenes from "./StepScenes";
import CutStyleToggles from "./CutStyleToggles";
import ProjectProgress from "./ProjectProgress";
import { CUT_TOGGLE_GROUPS } from "@/lib/cutStyle";

const seen = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("./CutCard", () => ({ default: (props: Record<string, unknown>) => {
  seen.props.push(props);
  return createElement("div", { "data-cut": (props.cut as { id: string }).id });
} }));
vi.mock("./SceneStoryboard", () => ({ default: () => null }));
vi.mock("@/components/NaturalPromptButton", () => ({ default: () => null }));
vi.mock("@/components/GlobalNav", () => ({ default: () => createElement("div", {}, "전역 메뉴") }));

describe("씬 하위 페이지와 진행바", () => {
  it("선택 씬의 컷만 렌더링하며 순서/전체 scenes/다른 씬 구도 자료는 그대로 전달합니다", () => {
    seen.props = [];
    const draft = newProjectDraft();
    draft.scenes = [newScene(), newScene(), newScene()];
    draft.scenes[0].cuts[0].composition = { rooms: [] } as never;
    const html = renderToStaticMarkup(createElement(StepScenes, { draft, getCurrentDraft: () => draft, onChange: () => {}, selectedSceneId: draft.scenes[1].id, onSelectScene: () => {}, editorStateKey: "test-page-only" }));
    expect(seen.props).toHaveLength(1);
    expect(seen.props[0].cut).toBe(draft.scenes[1].cuts[0]);
    expect(seen.props[0].scenes).toBe(draft.scenes);
    expect(seen.props[0].index).toBe(1);
    expect(seen.props[0].savedShots).toHaveLength(1);
    expect(html).toContain(`data-cut="${draft.scenes[1].cuts[0].id}"`);
    expect(html).not.toContain(`data-cut="${draft.scenes[0].cuts[0].id}"`);
    expect((html.match(/role="tabpanel"/g) ?? [])).toHaveLength(3);
    expect((html.match(/ hidden=""/g) ?? [])).toHaveLength(2);
  });
  it("빈 프로젝트는 컷을 렌더링하지 않고 기존 추가 동작을 제공하며 이동을 비활성화합니다", () => {
    const draft = newProjectDraft(); draft.scenes=[]; seen.props=[];
    const html = renderToStaticMarkup(createElement(StepScenes, { draft, getCurrentDraft: () => draft, onChange: () => {}, selectedSceneId: null, onSelectScene: () => {}, editorStateKey: "test-empty" }));
    expect(seen.props).toHaveLength(0);
    expect(html).toContain("첫 장면 추가하기");
    const header = renderToStaticMarkup(createElement(ProjectProgress, { draft, step: 3, maxStep: 3, goStep: () => {}, selectedSceneId: null, onSelectScene: () => {} }));
    expect(header).toContain('type="number"');
    expect(header).toContain('type="submit" disabled=""');
  });
  it("씬 내비는 고정 진행바 안에서 씬 진행 단계 아래에 있으며 active tab만 Tab 순서에 들어갑니다", () => {
    const draft = newProjectDraft(); draft.scenes = [newScene(), newScene(), newScene()];
    const html=renderToStaticMarkup(createElement(ProjectProgress, { draft, step: 3, maxStep: 4, goStep: () => {}, selectedSceneId: draft.scenes[1].id, onSelectScene: () => {} }));
    expect(html).toContain('sticky top-0');
    expect(html.indexOf('data-tour="project-progress"')).toBeLessThan(html.indexOf('data-tour="scene-navigation"'));
    expect((html.match(/aria-selected="true"/g) ?? [])).toHaveLength(1);
    expect((html.match(/tabindex="0"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('aria-current="step"');
  });
  it("명시적인 씬 접힘은 다른 씬 이동 뒤에도 저장된 값을 사용합니다", () => {
    const draft = newProjectDraft(); draft.scenes=[newScene()]; seen.props=[];
    sceneEditorStore.disclose("test-closed", draft.scenes[0].id, "scene", false);
    const html=renderToStaticMarkup(createElement(StepScenes, { draft, getCurrentDraft: () => draft, onChange:()=>{}, selectedSceneId:draft.scenes[0].id, onSelectScene:()=>{}, editorStateKey:"test-closed" }));
    expect(html).toContain('aria-expanded="false"');
    expect(seen.props).toHaveLength(0);
  });
});

describe("컷 연출 설정 펼침 정책", () => {
  const autoLook={ids:[],en:"",why:""};
  it("새 그룹은 모두 펼치고 chip 선택/생성 기능은 활성화하지 않습니다", () => {
    const toggle=vi.fn(); const setOpen=vi.fn();
    const html=renderToStaticMarkup(createElement(CutStyleToggles,{tags:[],openGroups:{},setOpenGroups:setOpen,toggleTag:toggle,autoLook}));
    expect((html.match(/aria-expanded="true"/g) ?? [])).toHaveLength(CUT_TOGGLE_GROUPS.length);
    for (const group of CUT_TOGGLE_GROUPS) expect(html).toContain(group.options[0].label);
    expect(toggle).not.toHaveBeenCalled(); expect(setOpen).not.toHaveBeenCalled();
  });
  it("기존 false는 접힌 채 보존하고 다른 그룹은 기본으로 펼칩니다", () => {
    const html=renderToStaticMarkup(createElement(CutStyleToggles,{tags:[],openGroups:{style:false},setOpenGroups:()=>{},toggleTag:()=>{},autoLook}));
    expect((html.match(/aria-expanded="false"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain(`>${CUT_TOGGLE_GROUPS[0].options[0].label}</button>`);
  });
});
