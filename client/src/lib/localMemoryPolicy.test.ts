import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalMemoryPolicy, LocalRunOptions } from "./localEngines";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), desktop: true, entries: {} as Record<string, { value: unknown; savedAt: number }> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@/lib/llm", () => ({ isDesktopApp: () => native.desktop }));
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear() };
}
function newOrigin() {
  const localStorage = memoryStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage: memoryStorage(), location: { reload: vi.fn() } });
  return localStorage;
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); newOrigin(); native.entries = {}; native.desktop = true;
  native.listen.mockResolvedValue(() => {});
  native.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_app_settings") return JSON.stringify({ entries: native.entries });
    if (command === "merge_app_settings") {
      native.entries[String(args!.section)] = { value: args!.value, savedAt: Number(args!.savedAt) };
      return JSON.stringify({ entries: native.entries });
    }
    if (command === "local_run") return { output: "result.png", seconds: 1, meta: {} };
    if (command === "local_stop_workers") return;
    throw new Error(`예상하지 않은 네이티브 명령: ${command}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
async function load() {
  const api = await import("./localEngines");
  await (await import("./mediaLibrary")).whenAppSettingsReady();
  return api;
}
const settingsKey = "frameforge.localMemoryPolicy.v1";
const adaptive: LocalMemoryPolicy = { mode: "adaptive", ramPercent: 80, vramPercent: 90 };

describe("로컬 생성의 메모리 정책", () => {
  it("설정이 없거나 깨져 있으면 기본 해제이며 스냅샷 참조를 안정적으로 유지한다", async () => {
    const api = await load();
    expect(api.getLocalMemoryPolicy()).toEqual({ mode: "release", ramPercent: 85, vramPercent: 85 });
    expect(api.getLocalMemoryPolicy()).toBe(api.getLocalMemoryPolicy());
    for (const raw of ["broken", JSON.stringify({ mode: "adaptive", ramPercent: 0, vramPercent: 90 }), JSON.stringify({ mode: "adaptive", ramPercent: 85.5, vramPercent: 90 })]) {
      window.localStorage.setItem(settingsKey, raw);
      expect(api.getLocalMemoryPolicy().mode).toBe("release");
      expect(api.getLocalMemoryPolicy()).toBe(api.getLocalMemoryPolicy());
    }
  });

  it("입력 기준은 1~99 정수이며 잘못된 설정으로 기존 값을 바꾸지 않는다", async () => {
    const api = await load();
    await api.saveLocalMemoryPolicy(adaptive);
    for (const invalid of [
      { ...adaptive, mode: "unknown" }, { ...adaptive, ramPercent: 0 },
      { ...adaptive, ramPercent: 100 }, { ...adaptive, vramPercent: 85.5 },
      { ...adaptive, vramPercent: NaN },
    ]) expect(() => api.saveLocalMemoryPolicy(invalid as LocalMemoryPolicy)).toThrow();
    expect(api.getLocalMemoryPolicy()).toEqual(adaptive);
  });

  it("설정을 공통 앱 데이터 거울에 저장하고 새 origin에서도 복원한다", async () => {
    const api = await load();
    await api.saveLocalMemoryPolicy(adaptive);
    expect(native.entries.localMemoryPolicy?.value).toEqual(adaptive);
    vi.resetModules(); newOrigin();
    const restored = await load();
    expect(restored.getLocalMemoryPolicy()).toEqual(adaptive);
    expect(JSON.parse(window.localStorage.getItem(settingsKey)!)).toEqual(adaptive);
  });

  it("생성은 거울 복원을 기다리고 세 모드의 같은 규격을 Rust에 전달한다", async () => {
    native.entries.localMemoryPolicy = { value: adaptive, savedAt: 100 };
    const api = await import("./localEngines");
    // 복원 완료를 직접 기다리지 않고 바로 시작해도 저장된 정책을 사용해야 합니다.
    await api.runLocal("qwenimage", "result.png", { prompt: "시험" });
    expect(native.invoke).toHaveBeenLastCalledWith("local_run", expect.objectContaining({ opts: expect.objectContaining({ memory_policy: "adaptive", memory_ram_percent: 80, memory_vram_percent: 90, keep_worker: false }) }));
    for (const mode of ["release", "retain"] as const) {
      await api.saveLocalMemoryPolicy({ ...adaptive, mode });
      const options = { prompt: "시험", keep_worker: true, memory_policy: "retain", memory_ram_percent: 99 } as LocalRunOptions;
      await api.runLocal("wanvideo", "result.mp4", options);
      const run = native.invoke.mock.calls.filter(([command]) => command === "local_run").at(-1)!;
      expect(run[1].opts).toMatchObject({ prompt: "시험", memory_policy: mode, memory_ram_percent: 80, memory_vram_percent: 90, keep_worker: mode === "retain" });
      expect(options).toMatchObject({ keep_worker: true, memory_policy: "retain", memory_ram_percent: 99 });
    }
  });

  it("수동 워커 종료 실패를 삼키지 않아 화면에서 오류를 표시할 수 있다", async () => {
    const api = await load();
    native.invoke.mockRejectedValueOnce(new Error("종료 실패"));
    await expect(api.stopLocalWorkers()).rejects.toThrow("종료 실패");
    native.desktop = false;
    await expect(api.stopLocalWorkers()).rejects.toThrow("데스크톱");
  });

  it("앱 데이터 파일 저장 실패를 성공으로 숨기지 않는다", async () => {
    const api = await load();
    native.invoke.mockRejectedValueOnce(new Error("설정 파일 저장 실패"));
    await expect(api.saveLocalMemoryPolicy(adaptive)).rejects.toThrow("설정 파일 저장 실패");
  });
});
