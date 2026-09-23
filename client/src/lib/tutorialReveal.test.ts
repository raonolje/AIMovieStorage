import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode } from "react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { normalizeComposition } from "./composition";
import { addRoomIn, type UpdateComposition } from "./compositionEdit";
import { PLANNER_TUTORIALS } from "@/tutorials";
import { RoomList } from "@/components/composition/planner/RoomList";
import { PlannerShotBar } from "@/components/composition/planner/ShotBar";
import { revealTutorialView, tutorialDoors } from "./tutorialReveal";

// 실제 버튼의 선언과 onClick을 사용하되, 이 시험은 화면의 로컬 접힘 상태를 렌더링하지 않습니다.
vi.mock("react", async (load) => ({
  ...await load<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/i18n", async (load) => {
  const original = await load<typeof import("@/lib/i18n")>();
  return { ...original, useT: () => original.t };
});

type ButtonProps = Record<string, unknown> & { onClick?: () => void };
function button(props: ButtonProps, visible = true): HTMLElement {
  return {
    getAttribute: (key: string) => props[key] == null ? null : String(props[key]),
    hasAttribute: (key: string) => props[key] != null,
    getBoundingClientRect: () => ({ width: visible ? 100 : 0, height: visible ? 30 : 0 }),
    click: () => props.onClick?.(),
  } as unknown as HTMLElement;
}
function scopeOf(buttons: HTMLElement[]): ParentNode {
  return {
    querySelectorAll: (selector: string) => {
      const [, key, anchor] = selector.match(/^\[([\w-]+)~="([\w-]+)"\]$/)!;
      return buttons.filter((item) => item.getAttribute(key)?.split(/\s+/).includes(anchor));
    },
  } as unknown as ParentNode;
}
function buttonsIn(node: ReactNode): HTMLElement[] {
  if (Array.isArray(node)) return node.flatMap(buttonsIn);
  if (!isValidElement<ButtonProps & { children?: ReactNode }>(node)) return [];
  return [...(node.type === "button" ? [button(node.props)] : []), ...buttonsIn(node.props.children)];
}

describe("튜토리얼 보기 전환과 작품 변경의 경계", () => {
  it("방 안내와 카메라 안내를 모두 읽어도 실제 방·카메라 저장 버튼은 실행하지 않는다", () => {
    let state = addRoomIn(normalizeComposition(), "outdoor").state;
    const before = structuredClone(state);
    const update = vi.fn<UpdateComposition>((patch) => { state = patch(state); });
    const roomButtons = buttonsIn(RoomList({ state, setState: update }));
    const shotButtons = buttonsIn(PlannerShotBar({ state, setState: update }));
    let tabSwitches = 0;
    const tab = button({
      "data-tour-switch": PLANNER_TUTORIALS.flatMap((tour) => tour.steps.map((step) => step.anchor)).join(" "),
      "data-tour-switch-kind": "tab",
      onClick: () => { tabSwitches += 1; },
    });
    const scope = scopeOf([tab, ...roomButtons, ...shotButtons]);
    for (const tour of PLANNER_TUTORIALS) {
      for (const step of tour.steps) {
        if (!step.anchor) continue;
        const clicked = new Set<HTMLElement>();
        while (revealTutorialView(scope, step.anchor, clicked, false)) { /* 다단계 패널 열기 */ }
        tutorialDoors(scope, step.anchor);
      }
    }
    expect(tabSwitches).toBeGreaterThan(0);
    expect(update).not.toHaveBeenCalled();
    expect(state).toEqual(before);

    // 막아 버린 버튼이 아니라 안내만 한 것입니다. 명시적 클릭은 원래의 생성 경로를 탑니다.
    const roomDoor = tutorialDoors(scopeOf(roomButtons), "env-horizon-color")[0];
    expect(roomDoor).toBeDefined();
    roomDoor.click();
    expect(state.rooms).toHaveLength(before.rooms!.length + 1);
    const shotDoor = tutorialDoors(scopeOf(shotButtons), "bottom-clip-amount")[0];
    expect(shotDoor).toBeDefined();
    shotDoor.click();
    expect(state.cameraShots).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("곡 추가처럼 open으로 표시한 동작과 종류 없는 switch는 자동 실행하지 않는다", () => {
    const project = { tracks: [] as string[], characters: [] as string[] };
    const addTrack = button({ "data-tour-open": "bgm-chips", onClick: () => project.tracks.push("new") });
    const misplaced = button({ "data-tour-switch": "layout-character-fields", onClick: () => project.characters.push("new") });
    const scope = scopeOf([addTrack, misplaced]);
    expect(revealTutorialView(scope, "bgm-chips", new Set(), false)).toBe(false);
    expect(revealTutorialView(scope, "layout-character-fields", new Set(), false)).toBe(false);
    expect(project).toEqual({ tracks: [], characters: [] });
    expect(tutorialDoors(scope, "bgm-chips")).toEqual([addTrack]);
  });

  it("접힌 판만 펴고 다음 걸음이나 빈 결과에서 열린 판을 다시 닫지 않는다", () => {
    const props: ButtonProps = {
      "data-tour-switch": "shelf-inbox-zoom", "data-tour-switch-kind": "expand", "aria-expanded": false,
      onClick: () => { props["aria-expanded"] = !props["aria-expanded"]; },
    };
    const toggle = button(props);
    const scope = scopeOf([toggle]);
    const clicked = new Set<HTMLElement>();
    expect(revealTutorialView(scope, "shelf-inbox-zoom", clicked, false)).toBe(true);
    expect(props["aria-expanded"]).toBe(true);
    expect(revealTutorialView(scope, "shelf-inbox-zoom", clicked, false)).toBe(false);
    expect(revealTutorialView(scope, "shelf-inbox-zoom", new Set(), false)).toBe(false);
    expect(props["aria-expanded"]).toBe(true);
  });

  it("같은 앵커가 그려져 있어도 도구 탭은 한 번 맞추고 숨긴·비활성 버튼은 누르지 않는다", () => {
    const click = vi.fn();
    const attrs = { "data-tour-switch": "cropper-upscale", "data-tour-switch-kind": "tab", onClick: click };
    const tab = button(attrs);
    const scope = scopeOf([button(attrs, false), button({ ...attrs, disabled: true }), tab]);
    const clicked = new Set<HTMLElement>();
    expect(revealTutorialView(scope, "cropper-upscale", clicked, true)).toBe(true);
    expect(revealTutorialView(scope, "cropper-upscale", clicked, true)).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked.has(tab)).toBe(true);
  });

  it("실제 소스에서 자동 switch를 허용한 버튼은 검토한 탭·접기 다섯 곳뿐이다", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const expected = new Map([
      ["components/composition/planner/PlannerChrome.tsx", "tab"],
      ["components/SheetPanelCropper.tsx", "tab"],
      ["components/MagnificInboxPanel.tsx", "expand"],
      ["components/project/CutCard.tsx", "expand"],
      ["components/composition/planner/MoveTimeline.tsx", "expand"],
    ]);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) { walk(file); continue; }
        if (!file.endsWith(".tsx")) continue;
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node) => {
          if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
            if (attrs.some((attr) => attr.name.getText(source) === "data-tour-switch")) {
              const relative = file.slice(root.length + 1).replaceAll("\\", "/");
              const kind = attrs.find((attr) => attr.name.getText(source) === "data-tour-switch-kind")?.initializer;
              expect(expected.has(relative), relative).toBe(true);
              expect(kind && ts.isStringLiteral(kind) ? kind.text : null, relative).toBe(expected.get(relative));
              if (expected.get(relative) === "expand") {
                expect(attrs.some((attr) => attr.name.getText(source) === "aria-expanded"), relative).toBe(true);
              }
              found.push(relative);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    walk(root);
    expect(found.sort()).toEqual([...expected.keys()].sort());
  });
});
