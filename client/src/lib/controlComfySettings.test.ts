import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("@/lib/mediaLibrary", () => ({ getMediaLibrarySettings: () => ({ baseDirectory: "D:/projects" }),
  queueMirrorWrite: vi.fn(), queueMirrorWriteAndConfirm: state.confirm, registerMirrorSection: vi.fn() }));
vi.mock("./projectControl", () => ({ ProjectControlError: class extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
} }));
import { getComfyGenerationSettings, saveComfyGenerationSettings } from "./comfyGeneration";
import { getControlComfySettings, setControlComfySettings } from "./controlComfySettings";
const config = { kind: "image" as const, workflowPath: "C:/work/reference-api.json", mappings: [
  { nodeId: "1", input: "prompt", source: "prompt" as const },
  { nodeId: "2", input: "image", source: "reference" as const, referenceKind: "image" as const, referenceIndex: 0 },
], outputNodeIds: ["3"] };
const info = { sha256: "workflow-hash", nodes: [
  { id: "1", classType: "SDNQSampler", inputs: [{ name: "prompt", value: "PRIVATE" }] },
  { id: "2", classType: "LoadImage", inputs: [{ name: "image", value: "PRIVATE.png" }] },
  { id: "3", classType: "SaveImage", inputs: [] },
] };
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) } });
  state.invoke.mockReset().mockResolvedValue(info);
  state.confirm.mockReset().mockResolvedValue(undefined);
});
async function request() { return { ...config, expectedRevision: (await getControlComfySettings()).revision }; }
describe("공식 Comfy 설정 저장", () => {
  it("같은 앱 설정에 저장하고 파일 확인을 기다리며 영상 설정은 보존한다", async () => {
    saveComfyGenerationSettings(current => ({ ...current, video: { workflowPath: "video.json", mappings: [], outputNodeIds: ["9"] } }));
    let release!: () => void;
    state.confirm.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = setControlComfySettings(await request());
    for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(release).toBeTypeOf("function");
    release();
    expect(await pending).toMatchObject({ persisted: true, persistedLatest: true, workflowSha256: "workflow-hash" });
    expect(getComfyGenerationSettings().video.workflowPath).toBe("video.json");
    expect(state.confirm).toHaveBeenCalledWith("comfy-generation", expect.objectContaining({ image: expect.objectContaining({ workflowPath: config.workflowPath }) }));
  });
  it("요약에 개인 경로·입력 값을 노출하지 않는다", async () => {
    await setControlComfySettings(await request());
    expect(JSON.stringify(await getControlComfySettings())).not.toMatch(/reference-api|PRIVATE/);
  });
  it("오래된 리비전은 파일 검사와 저장 전에 거절한다", async () => {
    await expect(setControlComfySettings({ ...config, expectedRevision: "old" })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(state.invoke).not.toHaveBeenCalled(); expect(state.confirm).not.toHaveBeenCalled();
  });
  it.each(["http://example.com:8188", "http://user:password@localhost:8188", "https://localhost:8188", "http://localhost:8188/path", "http://localhost:8188?token=secret"])("로컬 범위를 벗어난 주소 %s를 거절한다", async baseUrl => {
    await expect(setControlComfySettings({ ...await request(), baseUrl })).rejects.toThrow("localhost");
    expect(state.confirm).not.toHaveBeenCalled();
  });
  it("없는 입력·결과 노드와 레퍼런스 순서 누락을 저장하지 않는다", async () => {
    const input = await request();
    for (const update of [{ outputNodeIds: ["missing"] }, { mappings: [...config.mappings, config.mappings[0]] },
      { mappings: [config.mappings[0], { ...config.mappings[1], referenceIndex: 1 }] }])
      await expect(setControlComfySettings({ ...input, ...update })).rejects.toThrow();
    expect(state.confirm).not.toHaveBeenCalled();
  });
  it("검사하는 동안 설정 화면에서 바꾼 값은 덮지 않는다", async () => {
    const input = await request();
    state.invoke.mockImplementation(async () => {
      saveComfyGenerationSettings(current => ({ ...current, baseUrl: "http://localhost:9999" })); return info;
    });
    await expect(setControlComfySettings(input)).rejects.toMatchObject({ code: "revision_conflict" });
    expect(getComfyGenerationSettings().baseUrl).toContain("9999"); expect(state.confirm).not.toHaveBeenCalled();
  });
  it("파일 저장 실패는 성공이 아니며 메모리 값을 되돌린다", async () => {
    const before = getComfyGenerationSettings(); state.confirm.mockRejectedValue(new Error("disk full"));
    await expect(setControlComfySettings(await request())).rejects.toThrow("disk full");
    expect(getComfyGenerationSettings()).toEqual(before);
  });
  it("파일 저장 실패 때도 그 사이의 사용자 편집은 보존한다", async () => {
    state.confirm.mockImplementation(async () => {
      saveComfyGenerationSettings(current => ({ ...current, baseUrl: "http://localhost:9999" })); throw new Error("disk full");
    });
    await expect(setControlComfySettings(await request())).rejects.toThrow("disk full");
    expect(getComfyGenerationSettings().baseUrl).toContain("9999");
  });
});
