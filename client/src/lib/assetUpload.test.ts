import { beforeEach, describe, expect, it, vi } from "vitest";
const port = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => port.invoke(...args) }));
import { ASSET_UPLOAD_CHUNK_BYTES as CHUNK, uploadProjectAsset } from "./assetUpload";

beforeEach(() => { port.invoke.mockReset(); });

describe("대용량 에셋 전송", () => {
  it("168MB 파일은 전체 배열을 만들지 않고 4MB씩 확인한 뒤 경로를 돌려준다", async () => {
    const size = 168 * 1024 * 1024 + 97;
    const ranges: number[][] = [];
    const file = {
      size, name: "sample-video.mp4", arrayBuffer: vi.fn(() => { throw new Error("전체 읽기 금지"); }),
      slice: (start: number, end: number) => {
        ranges.push([start, Math.min(end, size)]);
        return { arrayBuffer: async () => new Uint8Array(Math.min(end, size) - start).fill(start / CHUNK % 251).buffer };
      },
    } as unknown as File;
    let received = 0, inflight = 0, chunks = 0, finished = false;
    port.invoke.mockImplementation(async (command, args, options) => {
      port.invoke.mockClear(); // 시험도 큰 버퍼를 호출 기록에 쌓아 두지 않습니다.
      if (command === "begin_project_asset_upload") { expect(args.totalSize).toBe(size); return "upload-1"; }
      if (command === "append_project_asset_upload") {
        expect(inflight++).toBe(0);
        expect(args).toBeInstanceOf(Uint8Array);
        expect(args.length).toBeLessThanOrEqual(CHUNK);
        expect(args[0]).toBe(chunks % 251);
        expect(options.headers).toEqual({ "x-asset-upload-id": "upload-1", "x-asset-upload-offset": String(received) });
        await Promise.resolve();
        received += args.length; chunks++; inflight--;
        return received;
      }
      if (command === "finish_project_asset_upload") { expect(received).toBe(size); finished = true; return "/project/mocap/video.mp4"; }
      throw new Error(command);
    });
    await expect(uploadProjectAsset(file, { projectName: "작품" })).resolves.toBe("/project/mocap/video.mp4");
    expect(finished).toBe(true); expect(chunks).toBe(43);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(ranges[0]).toEqual([0, CHUNK]); expect(ranges.at(-1)).toEqual([42 * CHUNK, size]);
  });

  it.each(["chunk", "ack", "finish"])("%s 실패는 경로를 돌려주지 않고 임시 전송을 해제한다", async failure => {
    const file = new File([new Uint8Array(12)], "sample.mp4");
    port.invoke.mockImplementation(async command => {
      if (command === "begin_project_asset_upload") return "id";
      if (command === "append_project_asset_upload") {
        if (failure === "chunk") throw new Error("쓰기 실패");
        return failure === "ack" ? 11 : 12;
      }
      if (command === "finish_project_asset_upload") throw new Error("디스크 가득 참");
    });
    await expect(uploadProjectAsset(file, {})).rejects.toThrow();
    expect(port.invoke).toHaveBeenLastCalledWith("abort_project_asset_upload", { uploadId: "id" });
    if (failure !== "finish") expect(port.invoke.mock.calls.some(([command]) => command === "finish_project_asset_upload")).toBe(false);
  });

  it("실패 뒤 다음 파일은 이어 저장하며 동시에 전송하지 않는다", async () => {
    const file = new File([new Uint8Array(2)], "sample.mp4");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let begins = 0;
    port.invoke.mockImplementation(async command => {
      if (command === "begin_project_asset_upload") return `id-${++begins}`;
      if (command === "append_project_asset_upload") {
        if (begins === 1) { await gate; throw new Error("실패"); }
        return 2;
      }
      if (command === "finish_project_asset_upload") return "/project/second.mp4";
    });
    const first = uploadProjectAsset(file, {}); const failed = expect(first).rejects.toThrow("실패");
    const second = uploadProjectAsset(file, {});
    await vi.waitFor(() => expect(begins).toBe(1));
    release(); await failed;
    await expect(second).resolves.toBe("/project/second.mp4");
  });
});
