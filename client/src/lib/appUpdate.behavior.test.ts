import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const context = vi.hoisted(() => ({ desktop: true, edition: "private" }));
const calls = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn(), install: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/llm", () => ({ isDesktopApp: () => context.desktop }));
vi.mock("@/lib/edition", () => ({ get EDITION() { return context.edition; } }));
vi.mock("@/lib/i18n", () => ({ t: (key: string) => key, useT: () => (key: string) => key }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: calls.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: calls.relaunch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: calls.invoke }));

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
  calls.invoke.mockResolvedValue("read-token");
});

describe("자동 업데이트 실행 경계", () => {
  it.each([
    { edition: "private", desktop: true, button: true, notice: false },
    { edition: "public", desktop: true, button: true, notice: false },
    { edition: "public", desktop: false, button: false, notice: false },
  ])("$edition / 데스크톱 $desktop 화면은 해당 판의 안내만 보여 준다", (state) => {
    Object.assign(context, state);
    const html = renderToStaticMarkup(createElement(UpdateBanner));
    expect(html.includes("<button")).toBe(state.button);
    expect(html.includes("원본 저장소에서 만든 비공개 설치본")).toBe(state.notice);
  });

  it.each([
    { edition: "public", desktop: false },
  ])("$edition / 데스크톱 $desktop 환경은 조회·설치를 호출하지 않는다", async (state) => {
    Object.assign(context, state);
    expect(updatesUnavailable()).toBe(true);
    expect(await checkForUpdate()).toBeNull();
    await expect(installUpdate()).rejects.toThrow("데스크톱 앱에서만");
    expect(calls.check).not.toHaveBeenCalled();
    expect(calls.install).not.toHaveBeenCalled();
    expect(calls.relaunch).not.toHaveBeenCalled();
  });

  it("공개판도 조회는 유지하고 미검증 다중 인스턴스 설치는 거절한다", async () => {
    context.edition = "public";
    expect(updatesUnavailable()).toBe(false);
    expect(await checkForUpdate()).toEqual({ version: "0.3.0", current: "0.2.3", notes: "변경 사항" });
    await expect(installUpdate()).rejects.toThrow("다중 인스턴스");
    expect(calls.check).toHaveBeenCalledTimes(1);
    expect(calls.install).not.toHaveBeenCalled();
    expect(calls.relaunch).not.toHaveBeenCalled();
    expect(calls.check).toHaveBeenCalledWith({ headers: {} });
    expect(calls.invoke).not.toHaveBeenCalled();
  });

  it("비공개판 조회 인증은 유지하고 미검증 설치는 다운로드 전에 거절한다", async () => {
    expect(updatesUnavailable()).toBe(false);
    await checkForUpdate();
    await expect(installUpdate()).rejects.toThrow("다중 인스턴스");
    expect(calls.check).toHaveBeenCalledWith({ headers: { "PRIVATE-TOKEN": "read-token" } });
    expect(calls.install).not.toHaveBeenCalled();
    expect(calls.relaunch).not.toHaveBeenCalled();
  });

  it("비공개판에 토큰이 없으면 GitLab에 요청하지 않는다", async () => {
    calls.invoke.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
    await expect(installUpdate()).rejects.toThrow("GitLab 읽기 토큰");
    expect(calls.check).not.toHaveBeenCalled();
  });
});
