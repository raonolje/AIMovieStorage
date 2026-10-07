import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {MaintenanceCoordinator} from "./maintenanceCore";

describe("유휴 워커 종료 준비의 저장·취소 경계", () => {
  afterEach(() => vi.useRealTimers());
  function setup() {
    let worker = true, held = false;
    const events: string[] = [];
    const inspect = vi.fn(async () => { events.push("strict"); return worker ? ["worker"] : []; });
    const pre = vi.fn(async () => { events.push("before"); return [] as string[]; });
    const flush = vi.fn(async () => { events.push("save"); });
    const release = vi.fn(async () => { events.push("release"); worker = false; });
    const cancel = vi.fn(async () => {});
    const m = new MaintenanceCoordinator({inspect, inspectBeforeWorkerRelease: pre, flush, releaseIdleWorkers: release, cancelIdleWorkerRelease: cancel, hold: value => { held = value; }, now: () => 1, token: () => "token"});
    return {m, inspect, pre, flush, release, cancel, events, held: () => held};
  }
  it("저장 완료와 전체 작업 재검사 후에만 워커를 정리하고 엄격 검사 뒤 토큰을 발급한다", async () => {
    const s=setup(); const result=await s.m.prepare(true);
    expect(s.events).toEqual(["before","save","before","release","strict"]);expect(result.token).toBe("token");expect(s.m.status().phase).toBe("ready");s.m.abort();
  });
  it("active 작업과 미저장 장벽은 워커 종료·저장보다 먼저 실패한다", async () => {
    for (const blocker of ["active job","install","prefetch","unsaved editor"]) {
      const s=setup();s.pre.mockResolvedValue([blocker]);await expect(s.m.prepare(true)).rejects.toThrow(blocker);
      expect(s.release).not.toHaveBeenCalled();expect(s.flush).not.toHaveBeenCalled();expect(s.held()).toBe(false);
    }
  });
  it("저장 실패 시 워커와 앱을 유지한다", async () => {
    const s=setup();s.flush.mockRejectedValue(Error("save failed"));await expect(s.m.prepare(true)).rejects.toThrow("save failed");expect(s.release).not.toHaveBeenCalled();expect(s.held()).toBe(false);
  });
  it("시간 초과 시 토큰 없이 편집 차단을 풀고 다음 준비를 허용한다", async () => {
    const s=setup();s.release.mockRejectedValueOnce(Error("timeout handles retained"));await expect(s.m.prepare(true)).rejects.toThrow("timeout");expect(s.m.status().prepared).toBeNull();expect(s.m.status().phase).toBe("idle");expect(s.held()).toBe(false);
    await s.m.prepare(true);s.m.abort();
  });
  it("정리 중 취소와 재진입은 첫 요청이 끝날 때까지 차단을 유지한다", async () => {
    const s=setup();let done!:()=>void;s.release.mockImplementationOnce(()=>new Promise<void>(resolve=>{done=resolve;}));
    const first=s.m.prepare(true);for(let i=0;i<8;i++)await Promise.resolve();expect(s.m.status().phase).toBe("workers");
    await expect(s.m.prepare(true)).rejects.toThrow();await s.m.abort();expect(s.cancel).toHaveBeenCalledTimes(1);expect(s.held()).toBe(true);
    done();await expect(first).rejects.toThrow("취소");expect(s.held()).toBe(false);expect(s.m.status().prepared).toBeNull();
  });
  it("취소된 저장은 완료를 기다리고 워커 정리를 시작하지 않는다", async () => {
    const s=setup();let done!:()=>void;s.flush.mockImplementationOnce(()=>new Promise<void>(resolve=>{done=resolve;}));const first=s.m.prepare(true);await Promise.resolve();await s.m.abort();expect(s.held()).toBe(true);
    done();await expect(first).rejects.toThrow("취소");expect(s.release).not.toHaveBeenCalled();expect(s.held()).toBe(false);
  });
});

const mocks=vi.hoisted(()=>({invoke:vi.fn(),tasks:vi.fn(async()=>[]),save:vi.fn(async()=>{})}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke}));
vi.mock("./taskQueue",()=>({listPersistedTasks:mocks.tasks,flushTaskJournal:mocks.save}));
vi.mock("./localProjectStore",()=>({flushProjectPersistence:mocks.save}));
vi.mock("./mediaLibrary",()=>({flushSettingsPersistence:mocks.save}));
vi.mock("./compositionControl",()=>({listCompositionSessions:()=>[]}));
vi.mock("./comfyGeneration",()=>({getComfyGenerationSettings:()=>({baseUrl:"http://127.0.0.1:8188"})}));
vi.mock("./i18n",()=>({t:(s:string)=>s}));

describe("실제 maintenance UI/controller 연결",()=>{
  beforeEach(()=>{vi.resetModules();mocks.invoke.mockReset();mocks.save.mockClear();vi.stubGlobal("window",{location:{pathname:"/"}});});
  afterEach(()=>vi.unstubAllGlobals());
  function native(workBlockers:string[]=[], missingField=false) {
    let worker=true;const events:string[]=[];
    mocks.save.mockImplementation(async()=>{events.push("save");});
    mocks.invoke.mockImplementation(async(name:string)=>{
      if(name==="maintenance_status")return {blockers:worker?["idle worker"]:[],...(missingField?{}:{workBlockers})};
      if(name==="maintenance_comfy_queue")return {running:0,waiting:0};
      if(name==="maintenance_release_idle_workers"){events.push("release");worker=false;return {blocked:false};}
      if(name==="maintenance_worker_status")return {workers:worker?[{engine:"cpu-fixture",pid:123}]:[],forcedTermination:false};
      throw Error("unexpected native action: "+name);
    });return events;
  }
  it("실제 저장 함수들이 완료된 뒤 유휴 전용 native 요청을 보내고 상태 보고를 노출한다",async()=>{
    const events=native();const module=await import("./maintenance");await module.prepareMaintenance({producerSafeBoundaryConfirmed:true});
    expect(events).toEqual(["save","save","save","release"]);const status=await module.maintenanceStatus();expect(status.workerShutdown).toEqual({workers:[],forcedTermination:false});await module.abortMaintenance();
  });
  it("native 작업·prefetch 장벽은 유휴 워커 문구와 구분하며 정리하지 않는다",async()=>{
    native(["prefetch active"]);const module=await import("./maintenance");await expect(module.prepareMaintenance({producerSafeBoundaryConfirmed:true})).rejects.toThrow("prefetch active");expect(mocks.invoke.mock.calls.some(x=>x[0]==="maintenance_release_idle_workers")).toBe(false);
  });
  it("구버전 native 응답에서 문구를 골라 장벽을 우회하지 않는다",async()=>{
    native([],true);const module=await import("./maintenance");await expect(module.prepareMaintenance({producerSafeBoundaryConfirmed:true})).rejects.toThrow("idle worker");expect(mocks.save).not.toHaveBeenCalled();
  });
  it("편집 화면에서는 워커 종료를 호출하지 않는다",async()=>{
    native();vi.stubGlobal("window",{location:{pathname:"/project/unsaved"}});const module=await import("./maintenance");await expect(module.prepareMaintenance({producerSafeBoundaryConfirmed:true})).rejects.toThrow("편집 내용을 저장");expect(mocks.save).not.toHaveBeenCalled();expect(mocks.invoke.mock.calls.some(x=>x[0]==="maintenance_release_idle_workers")).toBe(false);
  });
});
