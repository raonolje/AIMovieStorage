import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({directory:"D:/projects"}));
vi.mock("@tauri-apps/api/core", () => ({invoke}));
vi.mock("@/lib/llm", () => ({isDesktopApp:() => true}));
vi.mock("@/lib/mediaLibrary", () => ({getMediaLibrarySettings:() => ({baseDirectory:storage.directory}),registerMirrorSection:vi.fn(),queueMirrorWrite:vi.fn()}));
import { prepareComfyBindings, runComfyToProject, type ComfyGenerationSettings, type ComfyRunRequest, type ComfyWorkflowInfo } from "./comfyGeneration";

const info: ComfyWorkflowInfo = {sha256:"verified",nodes:[
  {id:"1",classType:"CLIPTextEncode",title:"",inputs:[{name:"text",value:"old prompt"}]},
  {id:"2",classType:"LoadImage",title:"",inputs:[{name:"image",value:"old.png"}]},
  {id:"3",classType:"LoadVideo",title:"",inputs:[{name:"file",value:"old.mp4"}]},
  {id:"4",classType:"KSampler",title:"",inputs:[{name:"seed",value:123}]},
  {id:"8",classType:"SaveVideo",title:"",inputs:[]},
]};
const settings: ComfyGenerationSettings = {baseUrl:"http://127.0.0.1:8188",image:{workflowPath:"D:/image.json",mappings:[{nodeId:"1",input:"text",source:"prompt"}],outputNodeIds:[]},
  video:{workflowPath:"D:/video.json",mappings:[{nodeId:"1",input:"text",source:"prompt"},{nodeId:"2",input:"image",source:"reference",referenceKind:"image",referenceIndex:0},
    {nodeId:"3",input:"file",source:"reference",referenceKind:"video",referenceIndex:0},{nodeId:"4",input:"seed",source:"value",value:99}],outputNodeIds:["8"]}};
const request = (): ComfyRunRequest => ({kind:"video",prompt:"new prompt",references:[{kind:"video",path:"D:/camera.mp4"},{kind:"image",path:"D:/actor.png"}],
  projectName:"movie",assetType:"scene-video",ownerName:"scene",stem:"take",settings,workflowSha256:"verified"});

describe("ComfyUI 입력 연결", () => {
  it("모델을 추측하지 않고 영상과 그림 순서를 각 갈래별로 맞춥니다", () => {
    expect(prepareComfyBindings(settings.video,info,request())).toEqual([
      {nodeId:"1",input:"text",value:"new prompt"},{nodeId:"2",input:"image",filePath:"D:/actor.png"},
      {nodeId:"3",input:"file",filePath:"D:/camera.mp4"},{nodeId:"4",input:"seed",value:99},
    ]);
  });
  it("누락 레퍼런스·미등록 입력·잘못된 자료형은 전송 전에 막습니다", () => {
    expect(() => prepareComfyBindings(settings.video,info,{...request(),references:[]})).toThrow("레퍼런스");
    expect(() => prepareComfyBindings(settings.video,info,{...request(),values:{"1.text":"override"}})).toThrow("등록되지 않은");
    expect(() => prepareComfyBindings(settings.video,info,{...request(),values:{"4.seed":"not a number"}})).toThrow("형식");
    expect(() => prepareComfyBindings({...settings.video,outputNodeIds:["missing"]},info,request())).toThrow("결과 노드");
    expect(() => prepareComfyBindings(settings.video,info,{...request(),references:[...request().references!,{kind:"audio",path:"D:/song.wav"}]})).toThrow("연결되지 않은 레퍼런스");
  });
});

describe("ComfyUI 작업 이어받기", () => {
  beforeEach(() => { invoke.mockReset(); storage.directory="D:/projects"; });
  const files = [{path:"D:/projects/movie/take_ComfyUI_001.mp4",name:"take_ComfyUI_001",kind:"video",nodeId:"8"}];
  const respond = () => invoke.mockImplementation(async (command: string) => {
    if (command === "comfy_inspect_generation_workflow") return info;
    if (command === "comfy_submit_generation") return {promptId:"job-1"};
    if (command === "comfy_generation_status") return {state:"completed",promptId:"job-1"};
    if (command === "comfy_collect_generation") return files;
    throw new Error(command);
  });
  it("작업 기록을 먼저 저장한 뒤에만 전송하고 결과 전체를 기록합니다", async () => {
    respond();
    const events: string[] = [];
    const result = await runComfyToProject({...request(),
      onSubmitting:async () => {events.push("submitting");expect(invoke.mock.calls.some(call => call[0] === "comfy_submit_generation")).toBe(false);},
      onSubmitted:async id => {events.push(id);expect(invoke.mock.calls.some(call => call[0] === "comfy_generation_status")).toBe(false);},
      onCollected:async received => {events.push("collected");expect(received).toEqual(files);},
    });
    expect(events).toEqual(["submitting","job-1","collected"]);
    expect(result).toEqual({promptId:"job-1",files});
    expect(invoke).toHaveBeenCalledWith("comfy_submit_generation",{request:expect.objectContaining({expectedWorkflowSha256:"verified"})});
  });
  it("기존 작업 번호가 있으면 워크플로를 다시 읽거나 제출하지 않습니다", async () => {
    respond();
    await runComfyToProject({...request(),existingPromptId:"job-1"});
    expect(invoke.mock.calls.map(call => call[0])).toEqual(["comfy_generation_status","comfy_collect_generation"]);
  });
  it("시작 기록 실패·접수 뒤 워크플로 변경이면 원격 작업을 만들지 않습니다", async () => {
    respond();
    await expect(runComfyToProject({...request(),onSubmitting:async () => {throw new Error("disk full");}})).rejects.toThrow("disk full");
    expect(invoke.mock.calls.some(call => call[0] === "comfy_submit_generation")).toBe(false);
    await expect(runComfyToProject({...request(),workflowSha256:"changed"})).rejects.toThrow("변경");
    expect(invoke.mock.calls.some(call => call[0] === "comfy_submit_generation")).toBe(false);
  });
  it("명시적 서버 실패를 성공으로 보고하거나 결과를 받지 않습니다", async () => {
    invoke.mockResolvedValue({state:"failed",promptId:"job-1",error:"missing model"});
    await expect(runComfyToProject({...request(),existingPromptId:"job-1"})).rejects.toThrow("missing model");
    expect(invoke.mock.calls.map(call => call[0])).toEqual(["comfy_generation_status"]);
  });
  it("중지는 다른 사람이 돌리는 서버의 interrupt 를 호출하지 않습니다", async () => {
    await expect(runComfyToProject({...request(),existingPromptId:"job-1",shouldStop:() => true})).rejects.toThrow("계속될 수");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("저장 폴더가 바뀌면 새 제출과 이어받기를 모두 막습니다", async () => {
    await expect(runComfyToProject({...request(),baseDirectory:"E:/different"})).rejects.toThrow("저장 폴더가 바뀌었습니다");
    await expect(runComfyToProject({...request(),baseDirectory:"E:/different",existingPromptId:"job-1"})).rejects.toThrow("저장 폴더가 바뀌었습니다");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["stop","storage"])("시작 기록을 기다리는 중 %s 변경도 제출 직전에 재확인합니다", async change => {
    respond();
    let stopped=false;
    await expect(runComfyToProject({...request(),shouldStop:()=>stopped,onSubmitting:async () => {
      if(change === "stop") stopped=true; else storage.directory="E:/other";
    }})).rejects.toThrow(change === "stop" ? "중지했습니다" : "저장 폴더가 바뀌었습니다");
    expect(invoke.mock.calls.some(call=>call[0] === "comfy_submit_generation")).toBe(false);
  });
});
