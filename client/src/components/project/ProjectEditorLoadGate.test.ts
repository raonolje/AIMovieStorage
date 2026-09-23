import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectEditorLoadState } from "@/lib/projectEditorBootstrap";
import ProjectEditorLoadGate from "./ProjectEditorLoadGate";

const fake = vi.hoisted(() => ({ state: { status: "loading" } as ProjectEditorLoadState }));
vi.mock("@/lib/projectEditorBootstrap", () => ({ createProjectEditorBootstrap: () => ({ getSnapshot: () => fake.state, subscribe: () => () => {}, start: async () => {}, cancel: () => {} }) }));
vi.mock("@/components/GlobalNav", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({ useT: () => (text: string) => text }));
vi.mock("wouter", () => ({ Link: ({ children }: { children: string }) => createElement("a", {}, children) }));
beforeEach(() => { fake.state = { status: "loading" }; });

describe("저장 프로젝트 편집기 mount 경계", () => {
  it("직접 진입 첫 화면에서는 편집·자동 저장을 품은 자식 함수를 실행하지 않는다", () => {
    const editor = vi.fn(() => createElement("div", {}, "편집기"));
    const html = renderToStaticMarkup(createElement(ProjectEditorLoadGate, { projectId: "p", children: editor }));
    expect(editor).not.toHaveBeenCalled();
    expect(html).toContain('role="status"');
    expect(html).not.toContain("편집기");
  });
  it("실패에도 편집기를 열지 않고 재시도와 목록으로 돌아갈 길을 보여준다", () => {
    fake.state = { status: "error", error: new Error("파일 읽기 실패") };
    const editor = vi.fn(() => null);
    const html = renderToStaticMarkup(createElement(ProjectEditorLoadGate, { projectId: "p", children: editor }));
    expect(editor).not.toHaveBeenCalled();
    expect(html).toContain('role="alert"');
    expect(html).toContain("다시 불러오기");
    expect(html).toContain("프로젝트 목록으로");
  });
  it("성공한 파일의 동일 객체만 편집기의 초기값으로 넘긴다", () => {
    const project = { id: "p", draft: { characters: [1, 2, 3, 4, 5] } };
    fake.state = { status: "ready", project: project as never };
    const editor = vi.fn(() => createElement("div", {}, "편집기"));
    const html = renderToStaticMarkup(createElement(ProjectEditorLoadGate, { projectId: "p", children: editor }));
    expect(editor).toHaveBeenCalledWith(project);
    expect(html).toContain("편집기");
    expect(html).not.toContain("불러오는 중");
  });
});
