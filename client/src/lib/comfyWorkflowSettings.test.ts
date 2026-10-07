import {beforeEach,describe,expect,it,vi} from "vitest";
const native=vi.hoisted(()=>({write:vi.fn()}));
vi.mock("./mediaLibrary",()=>({registerMirrorSection:vi.fn(),queueMirrorWrite:native.write,queueMirrorWriteAndConfirm:native.write}));
import {getComfyGenerationSettings,saveComfyGenerationSettingsAndConfirm} from "./comfyGeneration";
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)};}
beforeEach(()=>{vi.stubGlobal("window",{localStorage:storage()});native.write.mockReset().mockResolvedValue(undefined);});
describe("Comfy 연결 변경의 기존 설정 보존",()=>{
 it("서버 변경을 명시 저장하고 이전 mapping을 보존하며 인증 참조 섹션에 접근하지 않습니다",async()=>{
  // 실제 credential 값이나 저장소를 읽지 않는 합성 참조입니다.
  const refs=JSON.stringify({huggingface:"opaque-reference-hf",civitai:"opaque-reference-civitai"});window.localStorage.setItem("synthetic.credentials.references",refs);
  const old={baseUrl:"http://127.0.0.1:8188",image:{workflowPath:"C:/old-image.json",mappings:[],outputNodeIds:["1"]},video:{workflowPath:"C:/old-video.json",mappings:[],outputNodeIds:["9"]}};
  window.localStorage.setItem("ai-video-storage.comfy-generation.v1",JSON.stringify(old));
  const next=await saveComfyGenerationSettingsAndConfirm(current=>({...current,baseUrl:"http://127.0.0.1:8189"}));
  expect(next.image).toEqual(old.image);expect(next.video).toEqual(old.video);expect(next.connectionHistory?.[0].baseUrl).toBe(old.baseUrl);
  expect(window.localStorage.getItem("synthetic.credentials.references")).toBe(refs);expect(native.write).toHaveBeenCalledWith("comfy-generation",expect.anything());
 });
 it("저장 실패는 이전 주소로 복원하고 public/auth URL은 쓰기 전에 거절합니다",async()=>{
  native.write.mockRejectedValueOnce(new Error("disk full"));await expect(saveComfyGenerationSettingsAndConfirm(current=>({...current,baseUrl:"http://127.0.0.1:8189"}))).rejects.toThrow("disk full");expect(getComfyGenerationSettings().baseUrl).toBe("http://127.0.0.1:8188");
  for(const baseUrl of ["http://0.0.0.0:8188","http://account:synthetic@127.0.0.1:8188","http://127.0.0.1:8188/?key=synthetic"])await expect(saveComfyGenerationSettingsAndConfirm(current=>({...current,baseUrl}))).rejects.toThrow("comfy_loopback_endpoint_required");expect(native.write).toHaveBeenCalledTimes(1);
 });
});
