import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {WorkflowEnvironment,WorkflowSource,WorkflowSelection,ComfyWorkflowManifest} from "./comfyWorkflowContract";
import type {AnyComfyWorkflowManifest} from "./comfyWorkflowContractV2";
import {migrateWorkflowSelectionV1ToV2,buildComfyWorkflowManifestV2} from "./comfyWorkflowInspectionV2";
import type {BgmProject} from "./bgmProjects";
import type {QueueTask} from "./taskQueue";
import registry from "./workflowEvidence/reviewed-node-registry-v039-minimal.json";
import facts from "./workflowEvidence/music3-exact-weight-facts.json";
import candidate from "./workflowEvidence/music3-instrumental-smoke.candidate.json";
const state=vi.hoisted(()=>({projects:[] as BgmProject[],entry:undefined as unknown as {source:WorkflowSource;selection:WorkflowSelection;manifest:AnyComfyWorkflowManifest},environment:undefined as unknown as WorkflowEnvironment,baseUrl:"http://127.0.0.1:8190",enqueue:vi.fn(),run:vi.fn(),save:vi.fn(),stopping:false}));
vi.mock("./mediaLibrary",()=>({registerMirrorSection:vi.fn(),queueMirrorWrite:vi.fn(),queueMirrorWriteAndConfirm:vi.fn(),getMediaLibrarySettings:()=>({baseDirectory:"D:/cpu-projects"}),safeFileName:(v:string)=>v}));
vi.mock("./projectWrite",()=>({readProject:()=>null,writeProjectAndConfirm:vi.fn()}));
vi.mock("./localProjectStore",()=>({projectFolderName:(id:string)=>id}));
vi.mock("./bgmProjects",()=>({loadBgmProjects:()=>state.projects,updateBgmProjectsAndConfirm:async(fn:(p:BgmProject[])=>BgmProject[])=>{const next=fn(state.projects);await state.save();state.projects=next;}}));
vi.mock("./comfyWorkflowLibrary",()=>({workflowEntryForTarget:()=>state.entry,readWorkflowPreflight:async()=>({text:readFileSync(resolve("client/src/lib/workflowEvidence/music3-instrumental-smoke.api.json"),"utf8"),sha256:candidate.workflowSha256}),environmentFromPreflight:()=>state.environment}));
vi.mock("./comfyGeneration",()=>({getComfyGenerationSettings:()=>({baseUrl:state.baseUrl})}));
vi.mock("./comfyTasks",()=>({runQueuedComfy:state.run}));
vi.mock("./taskQueue",()=>({enqueueTaskOperation:state.enqueue,registerTaskRunner:vi.fn(),isStopping:()=>state.stopping,whenTaskJournalReady:async()=>{},getTaskByOperationId:()=>null}));
import {buildComfyWorkflowManifest} from "./comfyWorkflowInspection";
import {prepareRegisteredWorkflow,enqueueRegisteredWorkflow,executeRegisteredWorkflow,workflowRunSchema,workflowRequestFingerprint} from "./comfyWorkflowRuntime";
const raw=()=>({projectId:"b",operationId:"cpu-op",target:{kind:"bgm",id:"track"},workflowTarget:state.entry.manifest.promptTarget,prompt:"Global Metadata: soft piano instrumental. Vocal Details: no vocals.",negative:""});
const input=()=>workflowRunSchema.parse(raw());
const task=async():Promise<QueueTask>=>({id:"job",payload:{baseUrl:state.baseUrl,baseDirectory:"D:/cpu-projects",projectName:"BGM",requestFingerprint:await workflowRequestFingerprint(await prepareRegisteredWorkflow(input()))}} as QueueTask);
const output=()=>({promptId:"prompt-cpu",files:[{path:"D:/cpu-projects/BGM/곡/CPU/music.flac",name:"music",kind:"audio",nodeId:"9",bytes:100,sha256:"a".repeat(64),mediaFacts:{decodable:true,fullDecode:true,durationSeconds:12,audioTracks:1}}]});
beforeEach(async()=>{
 vi.clearAllMocks();state.stopping=false;state.baseUrl="http://127.0.0.1:8190";state.save.mockResolvedValue(undefined);state.enqueue.mockResolvedValue({jobId:"job"});state.run.mockImplementation(async()=>output());
 state.projects=[{id:"b",name:"CPU",description:"",linkedProject:"",createdAt:0,updatedAt:0,tracks:[{...{usage:'',mood:[],genre:[],instruments:[],tempo:'',durationSeconds:'',lyrics:'',reference:'',notes:'',promptKo:'',promptEn:'',resultPaths:[],targetTool:"comfy" as const,updatedAt:0},id:"track",name:"곡",instrumental:true,lyricsKo:"",notes:"수동 메모"}]} as BgmProject];
 state.environment={comfyVersion:"0.39.0",coreCommit:registry.diskCoreCommit,pythonVersion:registry.pythonVersion,torchVersion:registry.torchVersion,customNodeVersions:{},nodeSourceHashes:registry.nodeSourceHashes,reviewVersion:registry.reviewVersion,catalog:JSON.parse(readFileSync(resolve("client/src/lib/__fixtures__/workflow-v039-music3-node-schemas.json"),"utf8")),reviewedNodes:registry.reviewedNodes as WorkflowEnvironment["reviewedNodes"],weights:facts.files.map(file=>({category:file.category,name:file.name,license:"unknown" as const,sha256:file.sha256})),projectId:"b",weightAuthorizations:facts.files.map(file=>({kind:"user-reported" as const,projectId:"b",modelRuleId:"minimaxmusic3",category:file.category,name:file.name,sha256:file.sha256,evidence:"synthetic CPU grant",sourceThreadId:"cpu-only",reportedAtUtc:"2026-10-06T18:00:00.000Z"}))};
 const source=structuredClone(candidate.source) as WorkflowSource,selection=structuredClone(candidate.selection) as WorkflowSelection,text=readFileSync(resolve("client/src/lib/workflowEvidence/music3-instrumental-smoke.api.json"),"utf8");
 const result=await buildComfyWorkflowManifest({text,source,selection,environment:state.environment,checkedAtUtc:"2026-10-06T18:00:00.000Z"});expect(result.inspection.issues).toEqual([]);state.entry={source,selection,manifest:result.manifest!};
});
describe("Music3 공통 큐·수집·등록 CPU 계약 (실제 생성 미실행)",()=>{
 it("V2 manifest가 있어도 native V1 보고이면 큐·참조·미디어 작업 전에 차단합니다",async()=>{
  const envelope=await migrateWorkflowSelectionV1ToV2(state.entry.selection);
  const built=await buildComfyWorkflowManifestV2({text:readFileSync(resolve("client/src/lib/workflowEvidence/music3-instrumental-smoke.api.json"),"utf8"),source:state.entry.source,selectionEnvelope:envelope,environment:state.environment,checkedAtUtc:"2026-10-07T05:00:00.000Z"});
  expect(built.inspection.issues).toEqual([]);state.entry.manifest=built.manifest!;
  await expect(enqueueRegisteredWorkflow(raw())).rejects.toThrow("workflow_native_contract_version_unsupported");expect(state.enqueue).not.toHaveBeenCalled();expect(state.run).not.toHaveBeenCalled();expect(state.save).not.toHaveBeenCalled();
 });
 it("무가사 원본과 모델 Instrumental 조건을 분리하고 그대로 큐에 넣습니다",async()=>{
  const prepared=await prepareRegisteredWorkflow(input());expect(prepared.adapterPlan?.bindings.find(b=>b.nodeId==="4"&&b.input==="lyrics")?.value).toBe("[Instrumental]");expect(prepared.lyricsTransforms).toMatchObject([{original:"",modelInput:"[Instrumental]",controlGuaranteed:false}]);
  await enqueueRegisteredWorkflow(raw());expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({lane:"media",kind:"comfy-workflow-generate",operationId:"cpu-op",payload:expect.objectContaining({baseUrl:state.baseUrl})}));
 });
 it("BGM에 가사를 넣거나 역할과 다른 오디오 출력을 선택하면 접수하지 않습니다",async()=>{
  await expect(enqueueRegisteredWorkflow({...raw(),values:{lyrics:"노래를 추가"}})).rejects.toThrow("instrumental_lyrics_forbidden");state.entry.source.operation="tts";await expect(enqueueRegisteredWorkflow(raw())).rejects.toThrow("output_target_mismatch");expect(state.enqueue).not.toHaveBeenCalled();
 });
 it("보컬 가사는 반복 end와 뒷설명을 정리하고 마지막 줄에 한 번 둡니다",async()=>{
  const track=state.projects[0].tracks[0];track.instrumental=false;track.lyricsKo="첫 줄 [END]\n둘째 줄\n[end]";
  const prepared=await prepareRegisteredWorkflow(input());expect(prepared.adapterPlan?.bindings.find(b=>b.input==="lyrics")?.value).toBe("첫 줄 \n둘째 줄\n[end]");
 });
 it("동일 파일 재등록은 한 개이며 생성 중 수정한 사용자 메모를 유지합니다",async()=>{
  state.run.mockImplementation(async()=>{state.projects[0].tracks[0].notes="사람이 고친 메모";return output();});
  const first=await executeRegisteredWorkflow(input(),vi.fn(),await task());await executeRegisteredWorkflow(input(),vi.fn(),await task());expect(first.data.attached).toBe(true);expect(state.projects[0].tracks[0]).toMatchObject({notes:"사람이 고친 메모",resultPaths:[output().files[0].path]});expect(Object.hasOwn(state.projects[0].tracks[0].workflowResults!,output().files[0].path)).toBe(true);
 });
 it("수집 중 중지 요청은 파일 위치를 보존하고 프로젝트 등록을 하지 않습니다",async()=>{
  state.run.mockImplementation(async()=>{state.stopping=true;return output();});const result=await executeRegisteredWorkflow(input(),vi.fn(),await task());expect(result).toMatchObject({paths:[output().files[0].path],data:{attached:false,cancelled:true}});expect(state.save).not.toHaveBeenCalled();
 });
 it("서버 변경·잘못된 노드·미디코드 결과를 성공으로 등록하지 않습니다",async()=>{
  const queued=await task();state.baseUrl="http://127.0.0.1:8191";await expect(executeRegisteredWorkflow(input(),vi.fn(),queued)).rejects.toThrow("endpoint_changed");expect(state.run).not.toHaveBeenCalled();
  state.run.mockResolvedValue({...output(),files:[{...output().files[0],nodeId:"other"}]});await expect(executeRegisteredWorkflow(input(),vi.fn(),await task())).rejects.toThrow("wrong_output_node");
  state.run.mockResolvedValue({...output(),files:[{...output().files[0],mediaFacts:{decodable:false}}]});await expect(executeRegisteredWorkflow(input(),vi.fn(),await task())).rejects.toThrow();expect(state.save).not.toHaveBeenCalled();
 });
 it("접수 뒤 BGM·보컬 변경과 원본 가사 수정은 새 입력으로 몰래 생성하지 않습니다",async()=>{
  const queued=await task();state.projects[0].tracks[0].instrumental=false;state.projects[0].tracks[0].lyricsKo="사용자가 나중에 수정";
  await expect(executeRegisteredWorkflow(input(),vi.fn(),queued)).rejects.toThrow("queued_inputs_changed");expect(state.run).not.toHaveBeenCalled();
 });
 it("거울 저장 실패는 완료·등록 성공으로 바꾸지 않습니다",async()=>{state.save.mockRejectedValue(new Error("disk full"));await expect(executeRegisteredWorkflow(input(),vi.fn(),await task())).rejects.toThrow("disk full");expect(state.projects[0].tracks[0].resultPaths).toEqual([]);});
});
