import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const context = vi.hoisted(() => ({ desktop: true, edition: "private" }));
const calls = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn(), install: vi.fn() }));
vi.mock("@/lib/llm", () => ({ isDesktopApp: () => context.desktop }));
vi.mock("@/lib/edition", () => ({ get EDITION() { return context.edition; } }));
vi.mock("@/lib/i18n", () => ({ t: (key: string) => key, useT: () => (key: string) => key }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: calls.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: calls.relaunch }));

import { checkForUpdate, installUpdate, updatesUnavailable } from "./appUpdate";
import UpdateBanner from "@/components/UpdateBanner";

beforeEach(() => {
  vi.clearAllMocks();
  context.desktop = true;
  context.edition = "private";
  calls.check.mockResolvedValue({
    version: "0.3.0", currentVersion: "0.2.3", body: "변경 사항",
    downloadAndInstall: calls.install,
  });
  calls.install.mockResolvedValue(undefined);
  calls.relaunch.mockResolvedValue(undefined);
});

describe("자동 업데이트 실행 경계", () => {
  it.each([
    { edition: "private", desktop: true, button: false, notice: true },
    { edition: "public", desktop: true, button: true, notice: false },
    { edition: "public", desktop: false, button: false, notice: false },
  ])("$edition / 데스크톱 $desktop 화면은 해당 판의 안내만 보여 준다", (state) => {
    Object.assign(context, state);
    const html = renderToStaticMarkup(createElement(UpdateBanner));
    expect(html.includes("<button")).toBe(state.button);
    expect(html.includes("원본 저장소에서 만든 비공개 설치본")).toBe(state.notice);
  });

  it.each([
    { edition: "private", desktop: true },
    { edition: "public", desktop: false },
  ])("$edition / 데스크톱 $desktop 환경은 조회·설치를 호출하지 않는다", async (state) => {
    Object.assign(context, state);
    expect(updatesUnavailable()).toBe(true);
    expect(await checkForUpdate()).toBeNull();
    await expect(installUpdate()).rejects.toThrow("공개판 데스크톱 앱에서만");
    expect(calls.check).not.toHaveBeenCalled();
    expect(calls.install).not.toHaveBeenCalled();
    expect(calls.relaunch).not.toHaveBeenCalled();
  });

  it("공개 데스크톱은 기존 조회·설치·재시작 경로를 유지한다", async () => {
    context.edition = "public";
    expect(updatesUnavailable()).toBe(false);
    expect(await checkForUpdate()).toEqual({ version: "0.3.0", current: "0.2.3", notes: "변경 사항" });
    await installUpdate();
    expect(calls.check).toHaveBeenCalledTimes(2);
    expect(calls.install).toHaveBeenCalledTimes(1);
    expect(calls.relaunch).toHaveBeenCalledTimes(1);
  });
});
