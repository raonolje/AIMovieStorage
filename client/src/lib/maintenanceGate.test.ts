import { it, expect, vi } from "vitest";
import { setMaintenanceHeld, registerMaintenanceSave, flushMaintenanceEditors } from "./maintenanceGate";
import { enqueueTask, enqueueTasks, enqueueTaskOperation } from "./taskQueue";
it("모든 작업 접수 경로는 유지보수 중 러너 실행 전에 거절한다",async()=>{setMaintenanceHeld(true);const task={lane:"cpu" as const,projectId:"qa",projectTitle:"qa",kind:"qa",label:"qa",payload:{}};try{expect(()=>enqueueTask(task)).toThrow();expect(()=>enqueueTasks([task])).toThrow();await expect(enqueueTaskOperation({...task,operationId:"qa-op"})).rejects.toThrow();}finally{setMaintenanceHeld(false);}});
it("편집기 저장 Promise가 완료돼야 장벽을 통과한다",async()=>{let done!:()=>void;const save=vi.fn(()=>new Promise<void>(r=>{done=r;})),off=registerMaintenanceSave(save);let complete=false;const pending=flushMaintenanceEditors().then(()=>{complete=true;});await Promise.resolve();expect(complete).toBe(false);done();await pending;expect(complete).toBe(true);off();});
it("편집기 저장 실패는 숨기지 않는다",async()=>{const off=registerMaintenanceSave(()=>{throw Error("미저장");});try{await expect(flushMaintenanceEditors()).rejects.toThrow("미저장");}finally{off();}});

it("폴더 정리의 실패와 진행 중 상태는 실제 재시도 성공까지 남는다",async()=>{const {startMaintenanceActivity,maintenanceActivityBlockers}=await import("./maintenanceGate");const finish=startMaintenanceActivity("폴더 QA");expect(maintenanceActivityBlockers().length).toBe(1);finish(false);expect(maintenanceActivityBlockers().length).toBe(1);const again=startMaintenanceActivity("폴더 QA");again(true);expect(maintenanceActivityBlockers()).toEqual([]);});
