import { describe, expect, it, vi } from "vitest";
vi.mock("./llmActivity",()=>({abandonLlmResumes:vi.fn()}));
const tick=()=>new Promise<void>(done=>setTimeout(done,0));
describe("download and media scheduling",()=>{
    it("serializes downloads while GPU media continues independently; same operation is reused",async()=>{
        vi.resetModules();const q=await import("./taskQueue");await q.registerTaskJournal({read:async()=>null,write:async()=>{}});
        const releases:(()=>void)[]=[];let gpuRelease!:()=>void;
        q.registerTaskRunner("test.download",()=>new Promise<void>(done=>releases.push(done)));
        q.registerTaskRunner("test.gpu",()=>new Promise<void>(done=>{gpuRelease=done;}));
        const base={projectId:"qa",projectTitle:"qa",label:"qa",payload:{}};
        const first=await q.enqueueTaskOperation({...base,lane:"download",kind:"test.download",operationId:"download-first"});
        const second=await q.enqueueTaskOperation({...base,lane:"download",kind:"test.download",operationId:"download-second"});
        const gpu=await q.enqueueTaskOperation({...base,lane:"media",kind:"test.gpu",operationId:"gpu"});await tick();
        expect(q.getTask(first.jobId)?.status).toBe("running");expect(q.getTask(second.jobId)?.status).toBe("waiting");expect(q.getTask(gpu.jobId)?.status).toBe("running");
        expect(await q.enqueueTaskOperation({...base,lane:"download",kind:"test.download",operationId:"download-first"})).toEqual({jobId:first.jobId,reused:true});
        releases.shift()!();await tick();expect(q.getTask(second.jobId)?.status).toBe("running");expect(q.getTask(gpu.jobId)?.status).toBe("running");releases.shift()!();gpuRelease();await tick();
    });
});
