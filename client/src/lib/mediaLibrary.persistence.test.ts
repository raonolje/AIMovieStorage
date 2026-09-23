import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ invoke: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke, convertFileSrc: (path: string) => path }));
vi.mock("./llm", () => ({ isDesktopApp: () => state.desktop }));
vi.mock("./magnificBridge", () => ({ rememberMagnificSentFiles: vi.fn() }));
function memory() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }; }
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const response = (args: { section: string; value: unknown; savedAt: number }) => JSON.stringify({ entries: { [args.section]: { value: args.value, savedAt: args.savedAt } } });

beforeEach(() => {
  vi.resetModules(); state.desktop = true;
  vi.stubGlobal("window", { localStorage: memory(), sessionStorage: memory() });
  state.invoke.mockReset().mockImplementation(async (command, args) => command === "read_app_settings" ? null : response(args));
});

describe("앱 설정 거울 저장 확인", () => {
  it("큰 HTML File 저장은 JSON 바이트 대신 제한된 바이너리 경로를 사용한다", async () => {
    const media = await import("./mediaLibrary"); await media.whenAppSettingsReady();
    media.saveMediaLibrarySettings({ baseDirectory: "/project-library" });
    await tick();
    let received = 0;
    state.invoke.mockImplementation(async (command, args) => {
      if (command === "begin_project_asset_upload") {
        expect(args.request).toMatchObject({ baseDirectory: "/project-library", projectName: "작품", assetType: "mocap-video" });
        expect(args.request).not.toHaveProperty("bytes"); return "id";
      }
      if (command === "append_project_asset_upload") { expect(args).toBeInstanceOf(Uint8Array); received += args.length; return received; }
      if (command === "finish_project_asset_upload") return "/project-library/작품/mocap/영상_001.mp4";
      throw new Error(command);
    });
    const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "source.mp4");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("전체 읽기 금지"));
    await expect(media.saveProjectMediaAsset(file, { projectName: "작품", assetType: "mocap-video", ownerName: "영상" }))
      .resolves.toEqual({ path: "/project-library/작품/mocap/영상_001.mp4", name: "영상_001" });
    expect(received).toBe(file.size);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(state.invoke.mock.calls.some(([command]) => command === "save_project_asset")).toBe(false);
  });

  it("네이티브 쓰기가 끝날 때까지 기다리고 줄을 선 순간의 값을 저장한다", async () => {
    const media = await import("./mediaLibrary"); await media.whenAppSettingsReady();
    const wait = gate();
    state.invoke.mockImplementation(async (_command, args) => { await wait.promise; return response(args); });
    const input = { title: "처음", tracks: [{ name: "곡" }] };
    let done = false;
    const saving = media.queueMirrorWriteAndConfirm("bgmProjects", input).then(() => { done = true; });
    input.title = "나중"; input.tracks[0].name = "변경";
    await tick(); expect(done).toBe(false);
    expect(state.invoke).toHaveBeenLastCalledWith("merge_app_settings", expect.objectContaining({ value: { title: "처음", tracks: [{ name: "곡" }] } }));
    wait.resolve(); await saving; expect(done).toBe(true);
  });

  it("이전 쓰기 실패를 전달하고 다음 쓰기는 같은 큐에서 계속한다", async () => {
    const media = await import("./mediaLibrary"); await media.whenAppSettingsReady();
    state.invoke.mockRejectedValueOnce(new Error("디스크 가득 참")).mockImplementation(async (_command, args) => response(args));
    const failed = media.queueMirrorWriteAndConfirm("bgmProjects", { first: true });
    const next = media.queueMirrorWriteAndConfirm("bgmProjects", { second: true });
    await expect(failed).rejects.toThrow("디스크 가득 참");
    await expect(next).resolves.toBeUndefined();
  });

  it("다른 origin의 더 최신 값이 남아 요청이 무시되면 성공으로 보지 않는다", async () => {
    const media = await import("./mediaLibrary"); await media.whenAppSettingsReady();
    state.invoke.mockResolvedValue(JSON.stringify({ entries: { bgmProjects: { savedAt: Date.now() + 1000, value: { title: "다른 값" } } } }));
    await expect(media.queueMirrorWriteAndConfirm("bgmProjects", { title: "요청" })).rejects.toThrow("요청한 값을 확인하지 못했습니다");
  });

  it("Rust가 JSON 객체 열쇠를 정렬해 돌려줘도 같은 값이면 확인한다", async () => {
    const media = await import("./mediaLibrary"); await media.whenAppSettingsReady();
    state.invoke.mockResolvedValue(JSON.stringify({ entries: { bgmProjects: { savedAt: 1, value: { a: { x: 2, y: 1 }, z: 3 } } } }));
    await expect(media.queueMirrorWriteAndConfirm("bgmProjects", { z: 3, a: { y: 1, x: 2 } })).resolves.toBeUndefined();
  });

  it("브라우저 저장을 앱 데이터 파일 저장으로 보고하지 않는다", async () => {
    state.desktop = false;
    const media = await import("./mediaLibrary");
    await expect(media.queueMirrorWriteAndConfirm("bgmProjects", [])).rejects.toThrow("데스크톱 앱");
    media.queueMirrorWrite("bgmProjects", []);
    await tick(); expect(state.invoke).not.toHaveBeenCalled();
  });
});
