import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  listen: vi.fn<(...args: unknown[]) => Promise<() => void>>(async () => () => undefined),
  guard: vi.fn(async () => undefined),
  settings: vi.fn(async () => undefined),
  journal: vi.fn(async () => undefined),
  navigate: vi.fn(),
  getItem: vi.fn<() => string | null>(),
  setItem: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./maintenance", () => ({ installMaintenanceWindowGuard: mocks.guard }));
vi.mock("./mediaLibrary", () => ({ whenAppSettingsReady: mocks.settings }));
vi.mock("./taskQueue", () => ({ registerTaskJournal: mocks.journal }));
vi.mock("./projectControl", () => ({ registerProjectNavigation: mocks.navigate }));
vi.mock("./appControlRegistry", () => ({ dispatchAppControl: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getItem.mockReturnValue(null);
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, localStorage: { getItem: mocks.getItem, setItem: mocks.setItem } });
});
afterEach(() => vi.unstubAllGlobals());

describe("조종기 준비 상태와 저장 선택의 분리", () => {
  it.each([null, "true", "FALSE"])("저장값 %s는 기존 기본 켜짐을 보존한다", async (choice) => {
    mocks.getItem.mockReturnValue(choice);
    const app = await import("./appControl");
    await app.initializeAppControl(vi.fn());
    expect(mocks.invoke.mock.calls).toEqual([["control_frontend_ready"], ["control_enable", { enabled: true }]]);
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
  it("명시적인 false를 보존하고 준비 보고로 설정을 켜지 않는다", async () => {
    mocks.getItem.mockReturnValue("false");
    const app = await import("./appControl");
    await app.initializeAppControl(vi.fn());
    await app.whenAppControlReady();
    expect(mocks.invoke.mock.calls).toEqual([["control_frontend_ready"]]);
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
  it("요청 리스너의 실제 준비 전에는 native 준비 보고나 켜짐 요청을 보내지 않는다", async () => {
    let ready!: () => void;
    mocks.listen.mockImplementationOnce(() => new Promise<() => void>((resolve) => { ready = () => resolve(() => undefined); }));
    const app = await import("./appControl");
    const boot = app.initializeAppControl(vi.fn());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    expect(mocks.invoke).not.toHaveBeenCalled();
    ready();
    await boot;
    expect(mocks.invoke.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.listen.mock.invocationCallOrder[0]);
  });
  it("준비 보고 실패는 초기화 오류로 남기고 설정이나 토큰을 다시 만들지 않는다", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("native 준비 보고 실패"));
    const app = await import("./appControl");
    await expect(app.initializeAppControl(vi.fn())).rejects.toThrow("native 준비 보고 실패");
    await expect(app.whenAppControlReady()).rejects.toThrow("native 준비 보고 실패");
    expect(app.getAppControlError()).toContain("native 준비 보고 실패");
    expect(mocks.invoke.mock.calls).toEqual([["control_frontend_ready"]]);
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
});
