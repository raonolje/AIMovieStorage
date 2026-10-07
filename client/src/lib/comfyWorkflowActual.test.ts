import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";

/** Opt-in live integration. No mocked generation, admission, collection or store. */
it.skipIf(!process.env.AIMS_ACTUAL_MUSIC3_ROOT)("actual Music3 common path persists BGM and task history",async()=>{
 const root=process.env.AIMS_ACTUAL_MUSIC3_ROOT!;
 const setup=JSON.parse(await fs.readFile(path.join(root,"setup.json"),"utf8"));
 const storage=new Map<string,string>();
 const localStorage={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,String(value));},removeItem:(key:string)=>{storage.delete(key);},clear:()=>storage.clear()};
 const calls:{command:string;atUtc:string}[]=[];
 let sequence=0;
 const invoke=async <T>(command:string,args:Record<string,unknown>={}):Promise<T>=>{
  calls.push({command,atUtc:new Date().toISOString()});
  const prefix=path.join(root,"ipc",String(++sequence).padStart(6,"0"));
  await fs.writeFile(prefix+".pending",JSON.stringify({command,args}));
  await fs.rename(prefix+".pending",prefix+".request.json");
  for(let count=0;count<24000;count++){
   try {const response=JSON.parse(await fs.readFile(prefix+".response.json","utf8"));if(!response.ok)throw new Error(response.error);return response.value as T;}
   catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`native proof IPC timed out: ${command}`);
 };
 Object.assign(globalThis,{localStorage,window:{localStorage,sessionStorage:localStorage,crypto:webcrypto,__TAURI_INTERNALS__:{invoke},addEventListener:()=>{},removeEventListener:()=>{},location:{reload:()=>{throw new Error("unexpected isolated-store reload");}}}});
 const media=await import("./mediaLibrary");
 await media.whenAppSettingsReady();
 const bgm=await import("./bgmProjects");
 const library=await import("./comfyWorkflowLibrary");
 const generation=await import("./comfyGeneration");
 const queue=await import("./taskQueue");
 const runtime=await import("./comfyWorkflowRuntime");
 await queue.registerTaskJournal({read:()=>invoke("actual_read_journal"),write:journal=>invoke("actual_write_journal",{journal})});
 // Selected, newly-created isolated project; never adopt grants from graph JSON.
 const project=bgm.createBgmProject("Music3 actual common-path QA");
 const track={...bgm.createBgmTrack(),name:"12 second instrumental QA",targetTool:"comfy" as const,instrumental:true,durationSeconds:"12"};
 project.tracks=[track];
 await bgm.saveBgmProjectsAndConfirm([project]);
 localStorage.setItem("ai-video-storage.media-library.v1",JSON.stringify({baseDirectory:setup.baseDirectory}));
 await media.queueMirrorWriteAndConfirm("mediaLibrary",{baseDirectory:setup.baseDirectory});
 await generation.saveComfyGenerationSettingsAndConfirm(settings=>({...settings,baseUrl:setup.baseUrl}));
 await library.recordMusic3UserAuthorization(project.id);
 const candidate=JSON.parse(await fs.readFile(new URL("./workflowEvidence/music3-instrumental-smoke.candidate.json",import.meta.url),"utf8"));
 const entry=await library.inspectAndRegisterWorkflow({source:{...candidate.source,workflowId:`actual-music3-${project.id}`,workflowPath:setup.workflowPath},selection:candidate.selection,projectId:project.id});
 await fs.writeFile(path.join(root,"inspection.json"),JSON.stringify(entry,null,2));
 expect(entry.manifest,JSON.stringify(entry.issues)).toBeDefined();
 const target=entry.manifest!.promptTarget;
 const caption="Global Metadata: cinematic ambient instrumental, 80 BPM. Vocal Details: no vocals. Arrangement: warm piano and soft strings.";
 await bgm.updateBgmProjectsAndConfirm(projects=>projects.map(item=>({...item,tracks:item.tracks.map(owner=>({...owner,promptWorkflow:target,promptEn:caption,styleEn:caption}))})));
 const input={projectId:project.id,operationId:`actual-music3-${project.id}`,target:{kind:"bgm",id:track.id},workflowTarget:target,prompt:caption,values:{duration:12,encodeSeed:7,sampleSeed:7},assets:{},referenceGroups:{},rolePrompts:{}};
 const prepared=await runtime.prepareRegisteredWorkflow(input as Parameters<typeof runtime.prepareRegisteredWorkflow>[0]);
 expect(prepared.lyricsTransforms).toEqual([expect.objectContaining({original:"",modelInput:"[Instrumental]",controlGuaranteed:false})]);
 const job=await runtime.enqueueRegisteredWorkflow(input);
 let done:ReturnType<typeof queue.getTask>=null;
 for(let count=0;count<7200;count++){
  done=queue.getTask(job.jobId);
  if(done&&["done","failed","stopped"].includes(done.status))break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 await queue.flushTaskJournal();
 await fs.writeFile(path.join(root,"task-observed.json"),JSON.stringify(done,null,2));
 expect(done?.status,done?.error).toBe("done");
 expect(done?.result?.data).toMatchObject({attached:true,workflowTarget:target});
 const journal=await queue.readTaskJournal();
 const saved=JSON.parse(await invoke<string>("read_app_settings"));
 const savedProject=saved.entries.bgmProjects.value.find((item:{id:string})=>item.id===project.id);
 const savedTrack=savedProject.tracks.find((item:{id:string})=>item.id===track.id);
 expect(savedTrack.resultPaths).toHaveLength(1);
 expect(savedTrack.lyrics).toBe("");
 const resultPath=savedTrack.resultPaths[0];
 const receipt=savedTrack.workflowResults[resultPath];
 expect(receipt).toMatchObject({workflowTarget:target,mediaFacts:{decodable:true,fullDecode:true}});
 expect(receipt.mediaFacts.durationSeconds).toBeGreaterThan(0);
 expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(journal.operations.find(item=>item.operationId===input.operationId)?.result?.data).toMatchObject({attached:true,promptId:receipt.promptId});
 const repeated=await runtime.enqueueRegisteredWorkflow(input);
 expect(repeated).toEqual({jobId:job.jobId,reused:true});
 expect(calls.filter(call=>call.command==="comfy_submit_generation")).toHaveLength(1);
 await fs.writeFile(path.join(root,"actual-proof.json"),JSON.stringify({checkedAtUtc:new Date().toISOString(),projectId:project.id,trackId:track.id,job,repeated,promptId:receipt.promptId,resultPath,sha256:receipt.sha256,bytes:receipt.bytes,mediaFacts:receipt.mediaFacts,workflowTarget:target,lyricsTransforms:prepared.lyricsTransforms,UIObserved:false,listeningObserved:false,calls},null,2));
},7_500_000);
