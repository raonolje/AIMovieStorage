vi.mock("@tauri-apps/api/core",()=>({invoke:async()=>true}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  draft: null as any,
  importFile: vi.fn(),
  write: vi.fn(),
  revision: "r1",
  endFrame: vi.fn(),
  task: null as any,
}));
vi.mock("./taskQueue",()=>({getTask:()=>mock.task}));
vi.mock("./mediaLibrary", () => ({
  assetSrc: (path: string) => `asset://${path}`,
  importProjectMediaAsset: mock.importFile,
  isVideoFile: (path: string) => /\.(mp4|mov|webm)$/i.test(path),
}));
vi.mock("./controlMedia", async (load) => {
  const { z } = await import("zod");
  return { mediaTargetSchema: z.object({ kind: z.enum(["character", "background", "cut"]), id: z.string() }).strict(),
    controlMediaTarget: (_draft: unknown, target: { id: string }) => ({ ownerName: target.id, stem: target.id, assetType: "scene-cut" }) };
});
vi.mock("./projectControl", () => ({
  ProjectControlError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  getProjectSnapshot: async () => ({ revision: mock.revision }),
  checkKoreanPrompt: (value: string) => { if (value && !/[가-힣]/.test(value)) throw Error("한글 프롬프트가 아닙니다"); },
}));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => "test-project" }));
vi.mock("./projectWrite", () => ({
  readProject: () => mock.draft,
  writeProjectAndConfirm: mock.write,
}));
vi.mock("./projectTypes", () => ({ uid: () => "new-asset" }));
vi.mock("./videoEndFrame", () => ({ saveVideoEndFrame: mock.endFrame }));

import { registerControlMedia, setControlAssetPrimary } from "./controlAssetRegistration";

beforeEach(() => {
  mock.draft = { title: "Test", characters: [], backgrounds: [], scenes: [{ cuts: [{ id: "cut-1", images: [], videos: [] }] }] };
  mock.revision = "r1";
  mock.task = null;
  mock.importFile.mockReset().mockResolvedValue({ path: "C:/project/result.png", name: "result" });
  mock.endFrame.mockReset().mockResolvedValue("C:/project/result_마지막프레임.png");
  mock.write.mockReset().mockImplementation(async (_id: string, update: (draft: unknown) => object) => {
    mock.draft = { ...mock.draft, ...update(mock.draft) };
    return { persisted: true };
  });
});

describe("chat asset registration", () => {
  it("persists verified preview master provenance without changing primary or prompts",async()=>{
    mock.draft.scenes[0].cuts[0].videos=[{id:"master",filePath:"master.mp4",isPrimary:true}];
    mock.importFile.mockResolvedValue({path:"C:/project/preview.mp4",name:"preview"});
    mock.task={kind:"control.aac-preview",status:"done",projectId:"p",result:{paths:["C:/qa/preview.mp4"],data:{sourceCutId:"cut-1",masterAssetId:"master",masterSha256:"1".repeat(64),lossyAudio:true,meta:{aacPreview:{allVideoPacketsExact:true,allDecodedFramesExact:true,originalUnchanged:true,lossyAudio:true,masterSha256:"1".repeat(64),outputSha256:"2".repeat(64)}}}}};
    const input={projectId:"p",expectedRevision:"r1",operationId:"preview-reg",target:{kind:"cut",id:"cut-1"},sourcePath:"C:/qa/preview.mp4",previewJobId:"preview-job",makePrimary:false};
    await registerControlMedia(input);
    expect(mock.draft.scenes[0].cuts[0].videos).toMatchObject([{id:"master",isPrimary:true},{isPrimary:false,previewMetadata:{masterAssetId:"master",masterSha256:"1".repeat(64),lossyAudio:true,previewJobId:"preview-job"}}]);
    await expect(registerControlMedia(input)).resolves.toMatchObject({reused:true});expect(mock.importFile).toHaveBeenCalledOnce();
    await expect(registerControlMedia({...input,makePrimary:true})).rejects.toThrow("nonprimary");
    await expect(registerControlMedia({...input,sourcePath:"other.mp4"})).rejects.toThrow("nonprimary");
  });
  it("rejects missing, failed or cancelled preview job before copying",async()=>{
    const input={projectId:"p",expectedRevision:"r1",operationId:"bad-preview",target:{kind:"cut",id:"cut-1"},sourcePath:"preview.mp4",previewJobId:"bad"};
    await expect(registerControlMedia(input)).rejects.toThrow("preview job");
    mock.task={kind:"control.aac-preview",status:"failed",projectId:"p"};await expect(registerControlMedia(input)).rejects.toThrow("preview job");expect(mock.importFile).not.toHaveBeenCalled();
  });
  it("WAV를 같은 프로젝트 인물의 입력 음원으로 복사하고 원본·카드 프롬프트를 보존한다",async()=>{
    mock.draft.characters=[{id:"mori",name:"모리",promptKo:"기존 인물",voiceReferences:[{id:"old",filePath:"old.wav",isPrimary:true}]}];
    mock.importFile.mockResolvedValue({path:"C:/project/mori.wav",name:"mori.wav"});
    const input={projectId:"p",expectedRevision:"r1",operationId:"audio-1",target:{kind:"character",id:"mori"},sourcePath:"C:/qa/input.wav",promptKo:"숙제는 들어보셨나요?"};
    const result=await registerControlMedia(input);
    expect(result).toMatchObject({assetId:"new-asset",primary:false,source:"imported",cardPromptUpdated:false});
    expect(mock.importFile).toHaveBeenCalledWith(input.sourcePath,expect.objectContaining({assetType:"character-voice"}));
    expect(mock.draft.characters[0]).toMatchObject({promptKo:"기존 인물",voiceReferences:[{id:"old",isPrimary:true},{id:"new-asset",source:"imported",importSourcePath:input.sourcePath,isPrimary:false}]});
    await expect(registerControlMedia(input)).resolves.toMatchObject({reused:true});
    expect(mock.importFile).toHaveBeenCalledOnce();
    await expect(registerControlMedia({...input,sourcePath:"another.wav"})).rejects.toThrow("원음 경로");
  });
  it("WAV의 잘못된 대상과 오래된 revision은 복사 전에 거부한다",async()=>{
    const input={projectId:"p",expectedRevision:"r1",operationId:"audio-2",target:{kind:"cut",id:"cut-1"},sourcePath:"input.wav"};
    await expect(registerControlMedia(input)).rejects.toThrow("인물");
    mock.draft.characters=[{id:"mori",name:"모리"}];mock.revision="later";
    await expect(registerControlMedia({...input,target:{kind:"character",id:"mori"}})).rejects.toThrow("최신");
    expect(mock.importFile).not.toHaveBeenCalled();
  });
  it("영상 후보는 자동 대표가 되지 않고 명시 선택 때 마지막 프레임을 함께 저장한다", async () => {
    mock.importFile.mockResolvedValue({ path: "C:/project/result.mp4", name: "result" });
    const target = { kind: "cut", id: "cut-1" };
    const added = await registerControlMedia({ projectId: "p", expectedRevision: "r1", operationId: "movie-1",
      target, sourcePath: "C:/chat/result.mp4" });
    expect(added).toMatchObject({ primary: false });
    expect(mock.endFrame).not.toHaveBeenCalled();
    await setControlAssetPrimary({ projectId: "p", expectedRevision: "r1", target, assetId: "new-asset" });
    expect(mock.draft.scenes[0].cuts[0].videos[0]).toMatchObject({ isPrimary: true,
      endFramePath: "C:/project/result_마지막프레임.png" });
    expect(mock.endFrame).toHaveBeenCalledOnce();
  });
  it("copies a candidate once, stores its prompt, and keeps a single representative", async () => {
    const request = { projectId: "p", expectedRevision: "r1", operationId: "op-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.png", promptEn: "concert wide shot" };
    const first = await registerControlMedia(request);
    expect(first).toMatchObject({ assetId: "new-asset", persisted: true, primary: true });
    expect(mock.importFile).toHaveBeenCalledOnce();
    expect(mock.draft.scenes[0].cuts[0].images).toMatchObject([{ importOperationId: "op-1", promptEn: "concert wide shot", isPrimary: true }]);
    expect(mock.draft.scenes[0].cuts[0].promptEn).toBeUndefined();
    expect(mock.draft.scenes[0].cuts[0].promptHistory).toBeUndefined();
    expect(await registerControlMedia(request)).toMatchObject({ reused: true });
    expect(mock.importFile).toHaveBeenCalledOnce();
    expect(mock.draft.scenes[0].cuts[0].promptHistory).toBeUndefined();
  });

  it("new imported prompts preserve the earlier image and video prompt versions", async () => {
    mock.draft.scenes[0].cuts[0].promptKo = "이전 그림";
    mock.draft.scenes[0].cuts[0].promptEn = "old image";
    mock.draft.scenes[0].cuts[0].videoPromptKo = "이전 영상";
    mock.draft.scenes[0].cuts[0].videoPromptEn = "old video";
    await registerControlMedia({ projectId: "p", expectedRevision: "r1", operationId: "image-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.png", promptKo: "새 그림", promptEn: "new image" });
    await registerControlMedia({ projectId: "p", expectedRevision: "r1", operationId: "video-1",
      target: { kind: "cut", id: "cut-1" }, sourcePath: "C:/chat/result.mp4", promptKo: "새 영상", promptEn: "new video" });
    const cut = mock.draft.scenes[0].cuts[0];
    expect(cut.promptHistory.map((item: { ko: string }) => item.ko)).toEqual(["새 그림", "이전 그림"]);
    expect(cut.videoPromptHistory.map((item: { ko: string }) => item.ko)).toEqual(["새 영상", "이전 영상"]);
  });

  it("selects only one primary in the target shelf", async () => {
    mock.draft.scenes[0].cuts[0].images = [{ id: "old", isPrimary: true }, { id: "new", isPrimary: false }];
    await setControlAssetPrimary({ projectId: "p", expectedRevision: "r1", target: { kind: "cut", id: "cut-1" }, assetId: "new" });
    expect(mock.draft.scenes[0].cuts[0].images.map((item: { isPrimary: boolean }) => item.isPrimary)).toEqual([false, true]);
  });
});
