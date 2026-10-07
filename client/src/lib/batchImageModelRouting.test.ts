import { beforeEach, describe, expect, it, vi } from "vitest";
import { newCharacter, newCut, newProjectDraft, newScene, type ProjectDraft } from "./projectTypes";
const state=vi.hoisted(()=>({draft:null as ProjectDraft|null,jobs:[] as any[],runners:new Map<string,Function>(),compose:vi.fn(),upload:vi.fn(),generate:vi.fn()}));
vi.mock("./projectWrite",()=>({readProject:()=>state.draft,writeProject:async (_id:string,draft:ProjectDraft)=>{state.draft=draft;return {draft};}}));
vi.mock("./taskQueue",()=>({registerTaskRunner:(kind:string,run:Function)=>state.runners.set(kind,run),enqueueTasks:(jobs:any[])=>{state.jobs=jobs;return jobs;},isStopping:()=>false,setTaskResult:vi.fn()}));
vi.mock("./magnificCompose",()=>({composeInMagnific:state.compose}));
vi.mock("./magnificMcp",()=>({uploadToMagnific:state.upload,generateWithMagnific:state.generate}));
vi.mock("./magnificModels",()=>({loadMagnificModels:async()=>[],fitDuration:(_models:unknown,_slug:unknown,wanted:number)=>wanted}));
vi.mock("./localProjectStore",()=>({projectFolderName:()=>"isolated-project"}));
beforeEach(()=>{
  vi.resetModules();state.runners.clear();state.jobs=[];
  const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};vi.stubGlobal("window",{localStorage:storage});vi.stubGlobal("localStorage",storage);
  state.compose.mockReset().mockResolvedValue("mock composition");state.upload.mockReset().mockResolvedValue("mock-creation");
  state.generate.mockReset().mockResolvedValue({path:"isolated/result.png",name:"result.png"});
  state.draft={...newProjectDraft(),title:"시험",batchEngines:{image:"magnific"},magnific:{imageModel:"nano-banana"},characters:[{...newCharacter(),id:"actor",name:"actor",promptModel:"gemini-nano-banana-2.1",promptEn:"Actor portrait"}],scenes:[{...newScene(),id:"scene",cuts:[{...newCut(1),id:"cut",promptModel:"gpt-image",promptEn:"Stage image",useComposition:false}]}]};
});
async function runImages(){
  const batch=await import("./batchRun");await batch.enqueueProjectGeneration("test-project",state.draft!,{images:true,videos:false});
  for(const job of state.jobs.filter(job=>[batch.CHARACTER_SHEET_TASK,batch.CUT_IMAGE_TASK].includes(job.kind)))await state.runners.get(job.kind)!(job.payload,()=>{}, {id:job.kind});
}
describe("실제 AI 미디어 일괄 모델 전달",()=>{
  it("각 카드/컷의 선택을 desktop 구성 model까지 전한다",async()=>{
    await runImages();
    expect(state.compose.mock.calls.map(([input])=>[input.requestedImageModel,input.model])).toEqual([["nano-banana-2.1","imagen-nano-banana-2-1"],["gpt-image","gpt-2"]]);
    expect(state.upload).not.toHaveBeenCalled();expect(state.generate).not.toHaveBeenCalled();
  });
  it("MCP 일괄은 exact mode를 보내고 connector 미확인 기본 옵션을 넣지 않는다",async()=>{
    state.draft!.batchEngines={image:"magnific-mcp"};state.draft!.scenes=[];
    await runImages();
    expect(state.generate.mock.calls[0][0].args).toMatchObject({mode:"imagen-nano-banana-2-1"});
    expect(state.generate.mock.calls[0][0].args).not.toHaveProperty("resolution");
    expect(state.generate.mock.calls[0][0].args).not.toHaveProperty("thinkingLevel");
  });
  it("13개 MCP 참조는 첫 업로드/생성 전에 멈추고 목록을 줄이지 않는다",async()=>{
    state.draft!.batchEngines={image:"magnific-mcp"};state.draft!.scenes=[];
    state.draft!.characters[0].references=Array.from({length:13},(_,i)=>({id:String(i),name:`ref${i}`,file:null,thumb:"",filePath:`isolated/ref${i}.png`}));
    await expect(runImages()).rejects.toThrow("reference_limit");
    expect(state.upload).not.toHaveBeenCalled();expect(state.generate).not.toHaveBeenCalled();
    expect(state.draft!.characters[0].references).toHaveLength(13);
  });
});
