import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoraOnDisk } from "./localLoras";
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./localLoras", () => ({
  readLoraFiles: state.read, LORA_WEIGHT_RANGE: { min: 0, max: 2 },
  loraItems: (files: LoraOnDisk[], engine?: string) => files.filter(file => !engine || file.engine === engine)
    .map(file => ({ ...file, name: file.fileName, weight: 1, enabled: false, trigger: "special style" })),
}));
vi.mock("./mediaLibrary", () => ({ registerMirrorSection: vi.fn() }));
const file = (engine: LoraOnDisk["engine"], fileName = "시험.safetensors", sizeBytes = 1024): LoraOnDisk =>
  ({ engine, fileName, sizeBytes, path: `private-root/loras/${engine}/${fileName}` });
beforeEach(() => { vi.resetModules(); vi.stubEnv("VITE_EDITION", "public"); state.read.mockReset().mockResolvedValue([file("minimaxh3"), file("qwenimage")]); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("조종기 로라 목록과 실행 시점 해석", () => {
  it("판에 포함된 실제 safetensors만 경로 없는 안정적인 ID로 보여준다", async () => {
    state.read.mockResolvedValue([file("minimaxh3"), file("anima"), file("qwenimage", "README.md"), file("qwenimage", "empty.safetensors", 0)]);
    const api = await import("./controlLoras");
    const first = await api.listControlLoras({});
    expect(first.loras).toHaveLength(1);
    expect(first.loras[0]).toMatchObject({ id: expect.stringMatching(/^lora-[0-9a-f]{64}$/), engine: "minimaxh3", name: "시험.safetensors", sizeBytes: 1024 });
    expect(JSON.stringify(first)).not.toContain("private-root");
    expect(first.loras[0]).not.toHaveProperty("path");
    vi.resetModules();
    const restarted = await import("./controlLoras");
    expect((await restarted.listControlLoras({})).loras[0].id).toBe(first.loras[0].id);
    await expect(restarted.listControlLoras({ engine: "anima" })).rejects.toThrow();
  });

  it("같은 엔진의 현재 파일만 해석하고 사용자 세기0을 유지한다", async () => {
    const api = await import("./controlLoras");
    const selected = (await api.listControlLoras({ engine: "minimaxh3" })).loras[0];
    expect(await api.resolveControlLoras("minimaxh3", [{ id: selected.id, weight: 0 }])).toEqual([
      { path: file("minimaxh3").path, weight: 0, trigger: "special style" },
    ]);
    await expect(api.resolveControlLoras("qwenimage", [{ id: selected.id, weight: 1 }])).rejects.toThrow("ID");
    state.read.mockResolvedValue([file("minimaxh3", "시험.safetensors", 2048)]);
    await expect(api.resolveControlLoras("minimaxh3", [{ id: selected.id, weight: 1 }])).rejects.toThrow("ID");
    state.read.mockResolvedValue([]);
    await expect(api.resolveControlLoras("minimaxh3", [{ id: selected.id, weight: 1 }])).rejects.toThrow("ID");
  });

  it("임의 경로·중복ID·유효하지 않은 세기를 거절하고 읽기 실패를 빈 목록으로 숨기지 않는다", async () => {
    const api = await import("./controlLoras");
    const id = `lora-${"a".repeat(64)}`;
    for (const value of [[{ id: "../file", weight: 1 }], [{ id, path: "C:/outside.safetensors", weight: 1 }],
      [{ id, weight: -1 }], [{ id, weight: 2.1 }], [{ id, weight: Infinity }], [{ id, weight: 1 }, { id, weight: 1 }]])
      expect(api.controlLoraSelectionSchema.safeParse(value).success).toBe(false);
    state.read.mockRejectedValue(new Error("disk unavailable"));
    await expect(api.listControlLoras({})).rejects.toThrow("disk unavailable");
    expect(await api.resolveControlLoras("minimaxh3", [])).toEqual([]);
  });
});
