import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { newProjectDraft, newScene, newCut, type ProjectDraft } from "./projectTypes";
const state = vi.hoisted(() => ({ draft: null as ProjectDraft | null, revision: "rev-1", run: vi.fn(), inspect: vi.fn(), writes: 0,
  baseDirectory:"D:/projects", projectFolder:"작품", attachError:false,
  settings: { baseUrl: "http://127.0.0.1:8188", image: { workflowPath: "image.json", mappings: [{nodeId:"1",input:"text",source:"prompt"}], outputNodeIds:["2"] },
    video: { workflowPath: "video.json", mappings: [{nodeId:"1",input:"text",source:"prompt"}], outputNodeIds:["2"] } } }));
vi.mock("./comfyGeneration", () => ({
  getComfyGenerationSettings: () => structuredClone(state.settings),
  inspectComfyGenerationWorkflow: state.inspect,
  prepareComfyBindings: (_config: unknown, _info: unknown, input: {values:Record<string,unknown>}) => {
    if (Object.keys(input.values).length) throw new Error("등록되지 않은 입력"); return [];
  },
  runComfyToProject: state.run,
}));
vi.mock("./projectWrite", () => ({ readProject: () => state.draft }));
vi.mock("./projectControl", () => ({ getProjectSnapshot: async () => ({revision:state.revision}),
  ProjectControlError: class extends Error { constructor(public code:string, message:string, public details:unknown) {super(message);} } }));
vi.mock("./localProjectStore", () => ({ projectFolderName: () => state.projectFolder }));
vi.mock("./mediaLibrary", () => ({getMediaLibrarySettings:() => ({baseDirectory:state.baseDirectory})}));
vi.mock("./upscale", () => ({checkComfy: async () => "ComfyUI 연결됨"}));
vi.mock("./llmActivity", () => ({abandonLlmResumes:vi.fn()}));
vi.mock("./controlMedia", () => ({
  mediaTargetSchema:z.object({kind:z.enum(["cut","character","background"]),id:z.string()}).strict(),
  controlMediaTarget: () => ({ownerName:"장면",stem:"컷_1",assetType:"scene-cut"}),
  listControlAssets: () => [{id:"ref",path:"작품/ref.png",kind:"image"}],
  attachControlMediaResult: async () => { if(state.attachError) throw new Error("프로젝트 등록 실패"); state.writes++; return `asset-${state.writes}`; },
}));
const request = { projectId:"p", target:{kind:"cut",id:"cut"}, expectedRevision:"rev-1", operationId:"comfy-1", kind:"video", prompt:"춤과 카메라", referenceAssetIds:["ref"] };
const files = [{path:"작품/완성.mp4", name:"완성", kind:"video", nodeId:"2"}];
const tick = () => new Promise(resolve => setTimeout(resolve,0));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); state.revision="rev-1"; state.writes=0;
  state.baseDirectory="D:/projects";state.projectFolder="작품";state.attachError=false;
  vi.stubGlobal("window", {});
  const data = new Map<string,string>();
  vi.stubGlobal("localStorage", {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});
  state.draft = {...newProjectDraft(),title:"작품",scenes:[{...newScene(),id:"scene",cuts:[{...newCut(1),id:"cut"}]}]};
  state.inspect.mockResolvedValue({sha256:"hash",nodes:[{id:"1",classType:"Text",inputs:[{name:"text",value:"PRIVATE"}]}]});
  state.run.mockImplementation(async (input) => {
    if (!input.existingPromptId) { await input.onSubmitting(); await input.onSubmitted("server-1"); }
    await input.onCollected(files); return {promptId:"server-1",files};
  });
});
async function prepare() {
  const queue = await import("./taskQueue");
  await queue.registerTaskJournal({read:async()=>null,write:async()=>{}});
  const api = await import("./controlComfy");
  return {queue,api};
}
async function finish(queue:Awaited<ReturnType<typeof prepare>>["queue"], id:string) {
  for(let i=0;i<60;i++) { await tick(); const job=queue.getTask(id)!; if(!["waiting","running"].includes(job.status)) return job; }
  throw new Error("작업이 끝나지 않았습니다.");
}
describe("ComfyUI 조종기 작업 계약", () => {
  it("수동 편집 충돌·임의 경로·다른 작품 참조·영상 대상 오류는 제출 전에 거절한다", async () => {
    const {api}=await prepare();
    await expect(api.enqueueControlComfy({...request,expectedRevision:"old"})).rejects.toMatchObject({code:"revision_conflict"});
    await expect(api.enqueueControlComfy({...request,workflowPath:"outside.json"})).rejects.toThrow();
    await expect(api.enqueueControlComfy({...request,referenceAssetIds:["other"]})).rejects.toThrow("레퍼런스");
    await expect(api.enqueueControlComfy({...request,target:{kind:"character",id:"c"}})).rejects.toThrow("컷");
    await expect(api.enqueueControlComfy({...request,values:{"secret.api_key":"value"}})).rejects.toThrow("등록되지 않은");
    expect(state.run).not.toHaveBeenCalled();
  });
  it("같은 요청의 재전송은 설정과 리비전이 달라져도 기존 작업을 반환한다", async () => {
    const {queue,api}=await prepare();
    const first=await api.enqueueControlComfy(request);
    const done=await finish(queue,first.jobId);
    expect(done.status).toBe("done");
    expect(done.result).toMatchObject({assetIds:["asset-1"],paths:["작품/완성.mp4"],data:{promptId:"server-1",attached:true}});
    expect(done.externalCheckpoint).toMatchObject({phase:"collected",promptId:"server-1",files});
    state.revision="manual-edit";
    expect(await api.enqueueControlComfy(request)).toEqual({jobId:first.jobId,reused:true});
    await expect(api.enqueueControlComfy({...request,prompt:"다른 요청"})).rejects.toThrow("다른 내용");
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.run.mock.calls[0][0]).toMatchObject({workflowSha256:"hash",references:[{kind:"image",path:"작품/ref.png"}],baseDirectory:"D:/projects",projectName:"작품",stem:"컷_1"});
  });
  it("서버가 받았는지 불명인 제출은 수동 재시도에서도 다시 생성하지 않는다", async () => {
    const {queue,api}=await prepare();
    state.run.mockImplementation(async input => { await input.onSubmitting(); throw new Error("연결 끊김"); });
    const first=await api.enqueueControlComfy(request);
    expect((await finish(queue,first.jobId)).status).toBe("failed");
    queue.retryTask(first.jobId);
    const retried=await finish(queue,first.jobId);
    expect(retried.error).toContain("중복 생성");
    expect(state.run).toHaveBeenCalledTimes(1);
  });
  it("작업 번호를 받은 뒤 재시도하면 그 번호로 결과를 조회한다", async () => {
    const {queue,api}=await prepare();
    state.run.mockImplementationOnce(async input => {await input.onSubmitting();await input.onSubmitted("server-1");throw new Error("조회 오류");});
    const first=await api.enqueueControlComfy(request);
    expect((await finish(queue,first.jobId)).status).toBe("failed");
    queue.retryTask(first.jobId);
    expect((await finish(queue,first.jobId)).status).toBe("done");
    expect(state.run.mock.calls[1][0].existingPromptId).toBe("server-1");
  });
  it("조회는 전체 그래프의 비밀값이나 파일 경로를 공개하지 않는다", async () => {
    const {api}=await prepare();
    const info=await api.getControlComfyWorkflow({kind:"image"});
    expect(info).toMatchObject({kind:"image",mappings:[{nodeId:"1",input:"text",source:"prompt",valueType:"string",valid:true}]});
    expect(JSON.stringify(info)).not.toMatch(/PRIVATE|image\.json/);
  });
  it("등록 실패 뒤 수집 완료 기록으로 재시도해도 파일 검증을 다시 거친다", async () => {
    const {queue,api}=await prepare();
    state.attachError=true;
    const first=await api.enqueueControlComfy(request);
    const failed=await finish(queue,first.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.externalCheckpoint).toMatchObject({phase:"collected",promptId:"server-1",files});
    state.attachError=false;
    state.run.mockImplementationOnce(async input => {
      expect(input.existingPromptId).toBe("server-1");
      throw new Error("결과 파일이 변경됐습니다");
    });
    queue.retryTask(first.jobId);
    const rejected=await finish(queue,first.jobId);
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toContain("파일이 변경");
    expect(state.writes).toBe(0);
    queue.retryTask(first.jobId);
    expect((await finish(queue,first.jobId)).status).toBe("done");
    expect(state.run.mock.calls.slice(1).every(call=>call[0].existingPromptId === "server-1")).toBe(true);
    expect(state.writes).toBe(1);
  });
  it.each(["storage", "project"])("접수 뒤 %s 위치 변경은 새 실행과 이어받기에서 차단한다", async change => {
    const {queue,api}=await prepare();
    state.run.mockImplementationOnce(async input => {await input.onSubmitting();await input.onSubmitted("server-1");throw new Error("조회 오류");});
    const first=await api.enqueueControlComfy(request);
    const failed=await finish(queue,first.jobId);
    expect(failed.payload).toMatchObject({baseDirectory:"D:/projects",projectFolder:"작품"});
    if(change === "storage") state.baseDirectory="E:/other"; else state.projectFolder="다른 작품";
    queue.retryTask(first.jobId);
    const rejected=await finish(queue,first.jobId);
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toContain(change === "storage" ? "저장 폴더" : "프로젝트 위치");
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.writes).toBe(0);
  });
  it.each(["storage", "project"])("큐 대기 중 %s 위치가 바뀌면 첫 제출도 하지 않는다", async change => {
    const {queue,api}=await prepare();
    let release!: ()=>void;
    queue.registerTaskRunner("test-gate",()=>new Promise<void>(resolve=>{release=resolve;}));
    const gate=await queue.enqueueTaskOperation({lane:"media",kind:"test-gate",projectId:"p",projectTitle:"작품",label:"앞 작업",operationId:"gate",payload:{}});
    for(let i=0;i<30 && !release;i++) await tick();
    expect(release).toBeTypeOf("function");
    const next=await api.enqueueControlComfy(request);
    expect(queue.getTask(next.jobId)?.status).toBe("waiting");
    if(change === "storage") state.baseDirectory="E:/other"; else state.projectFolder="다른 작품";
    release();
    expect((await finish(queue,gate.jobId)).status).toBe("done");
    const rejected=await finish(queue,next.jobId);
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toContain(change === "storage" ? "저장 폴더" : "프로젝트 위치");
    expect(state.run).not.toHaveBeenCalled();
  });
  it("작업 기록 복원이 끝난 뒤 중복 요청을 확인한다", async () => {
    const {queue,api}=await prepare();
    const first=await api.enqueueControlComfy(request);
    expect((await finish(queue,first.jobId)).status).toBe("done");
    const snapshot=await queue.readTaskJournal();
    vi.resetModules();
    const empty = new Map<string,string>();
    vi.stubGlobal("localStorage", {getItem:(key:string)=>empty.get(key)??null,setItem:(key:string,value:string)=>empty.set(key,value)});
    const restarted=await import("./taskQueue");
    let restore!: (value:typeof snapshot)=>void;
    const loaded=new Promise<typeof snapshot>(resolve=>{restore=resolve;});
    const initializing=restarted.registerTaskJournal({read:()=>loaded,write:async()=>{}});
    const restartedApi=await import("./controlComfy");
    state.revision="manually-edited";
    let settled=false;
    const pending=restartedApi.enqueueControlComfy(request).then(value=>{settled=true;return value;});
    await tick();
    expect(settled).toBe(false);
    restore(snapshot);
    await initializing;
    expect(await pending).toEqual({jobId:first.jobId,reused:true});
    expect(state.run).toHaveBeenCalledTimes(1);
  });
});
