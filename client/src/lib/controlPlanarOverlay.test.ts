import { beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({invoke:vi.fn(),enqueue:vi.fn(),runner:vi.fn(),result:vi.fn(),release:vi.fn(),revision:"current",previous:null as null|Record<string,unknown>}));
vi.mock("@tauri-apps/api/core",()=>({invoke:state.invoke}));
vi.mock("./controlMedia",()=>({listControlAssets:()=>[{id:"video",path:"p/original.mp4",kind:"video"},{id:"screen",path:"p/clean.png",kind:"image"}],controlMediaTarget:()=>({stem:"컷_1",ownerName:"씬",assetType:"scene-cut"})}));
vi.mock("./projectWrite",()=>({readProject:()=>({title:"QA"})}));
vi.mock("./projectControl",()=>({getProjectSnapshot:async()=>({revision:state.revision}),ProjectControlError:class extends Error{constructor(public code:string,message:string){super(message);}}}));
vi.mock("./localProjectStore",()=>({projectFolderName:()=>"QA"}));
vi.mock("./mediaLibrary",()=>({saveProjectMediaAsset:async()=>({path:"p/reserved.mp4"}),releaseEmptyProjectAsset:state.release,safeFileName:(x:string)=>x}));
vi.mock("./taskQueue",()=>({enqueueTaskOperation:state.enqueue,registerTaskRunner:(_kind:string,fn:unknown)=>state.runner(fn),isStopping:()=>false,setTaskResult:state.result,getTaskByOperationId:()=>state.previous,whenTaskJournalReady:async()=>{}}));
import {planarOverlaySchema,validatePlanarCoordinates,enqueuePlanarOverlay} from "./controlPlanarOverlay";
const base={projectId:"p",expectedRevision:"current",operationId:"overlay-1",target:{kind:"cut" as const,id:"cut"},sourceVideoAssetId:"video",replacementAssetId:"screen",sourceSha256:"1".repeat(64),replacementSha256:"2".repeat(64),width:64,height:48,fps:16,frames:1,coordinates:[{frame:0,timeSeconds:0,quad:[[10,8],[52,8],[50,40],[8,40]]}],contentMode:"non-text" as const};
beforeEach(()=>{state.invoke.mockReset().mockResolvedValue({ready:true,blockers:[]});state.enqueue.mockReset().mockResolvedValue({jobId:"cpu-job"});state.revision="current";state.previous=null;state.release.mockReset();});
it("완료 작업을 같은 ID로 재요청해도 revision 충돌로 재생성하지 않는다",async()=>{
  state.previous={kind:"control.planar-overlay",payload:planarOverlaySchema.parse(base),projectId:"p",projectTitle:"QA",label:"화면 합성"};state.revision="changed";
  await expect(enqueuePlanarOverlay(base)).resolves.toEqual({jobId:"cpu-job"});expect(state.invoke).not.toHaveBeenCalled();
  await expect(enqueuePlanarOverlay({...base,replacementSha256:"3".repeat(64)})).rejects.toThrow("operation_conflict");
});
describe("평면 합성의 조종기 계약",()=>{
  it("CPU 대기열과 현재 프로젝트 에셋 ID를 사용한다",async()=>{await expect(enqueuePlanarOverlay(base)).resolves.toEqual({jobId:"cpu-job"});expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({lane:"cpu",kind:"control.planar-overlay",payload:base}));});
  it("변경된 revision·다른 프로젝트 에셋·준비 안 된 환경을 거절한다",async()=>{
    state.revision="new";await expect(enqueuePlanarOverlay(base)).rejects.toThrow("프로젝트가 바뀌었습니다");state.revision="current";
    await expect(enqueuePlanarOverlay({...base,sourceVideoAssetId:"foreign"})).rejects.toThrow("invalid_asset");
    state.invoke.mockResolvedValue({ready:false,blockers:["missing_cpu_tool"]});await expect(enqueuePlanarOverlay(base)).rejects.toThrow("planar_not_ready");
  });
  it("프레임 누락·반대 순서·화면 밖 좌표·잘못된 시각을 거절한다",()=>{
    for(const x of [{frames:2},{coordinates:[{...base.coordinates[0],frame:1}]},{coordinates:[{...base.coordinates[0],timeSeconds:1}]},{coordinates:[{frame:0,quad:[[10,8],[8,40],[50,40],[52,8]]}]},{coordinates:[{frame:0,quad:[[10,8],[99,8],[50,40],[8,40]]}]}])expect(()=>validatePlanarCoordinates(planarOverlaySchema.parse({...base,...x}))).toThrow();
  });
  it("S03 표지 한국사 요구를 비문자 화면으로 대체할 수 없다",()=>{
    expect(()=>validatePlanarCoordinates(planarOverlaySchema.parse({...base,target:{kind:"cut",id:"guho-cut-03-02"}}))).toThrow("한국사");
    expect(()=>validatePlanarCoordinates(planarOverlaySchema.parse({...base,target:{kind:"cut",id:"guho-cut-03-02"},contentMode:"exact-text",requiredText:"한국사"}))).not.toThrow();
    expect(planarOverlaySchema.safeParse({...base,requiredText:"가짜"}).success).toBe(false);
  });
  it("MCP 입력은 파일 경로·임의 마스크/실행 파일을 받지 않는다",()=>{for(const key of ["sourceVideo","replacementImage","python","ffmpeg","maskInsetPixels"])expect(planarOverlaySchema.safeParse({...base,[key]:"outside"}).success).toBe(false);});
});
