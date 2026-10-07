//! Explicit, opt-in local GPU integration proof. File transport replaces only
//! WebView IPC; every operation calls the same native product implementation.
use std::{collections::HashSet,fs,path::{Path,PathBuf},process::{Command,Stdio},time::Duration};
use serde_json::{json,Value};
use crate::{Res,err};

fn write_json(path:&Path,value:&Value)->Res<()> {
 let temp=path.with_extension("pending");
 fs::write(&temp,serde_json::to_vec_pretty(value).map_err(|e|err("probe JSON",e))?).map_err(|e|err("probe write",e))?;
 fs::rename(temp,path).map_err(|e|err("probe commit",e))
}
async fn dispatch(command:&str,args:Value,root:&Path)->Res<Value> {
 let store=root.join("app-data/app-settings.json");
 let string=|key:&str|args[key].as_str().map(str::to_owned).ok_or_else(||format!("probe argument {key}"));
 match command {
  "read_app_settings"=>Ok(match fs::read_to_string(store){Ok(text)=>json!(text),Err(e)if e.kind()==std::io::ErrorKind::NotFound=>Value::Null,Err(e)=>return Err(err("probe settings",e))}),
  "merge_app_settings"=>Ok(json!(crate::datafiles::merge_app_settings_at(store,string("section")?,args["savedAt"].as_f64().ok_or("probe stamp")?,args["value"].clone())?)),
  "actual_read_journal"=>Ok(match fs::read(root.join("task-journal.json")){Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|e|err("probe journal",e))?,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>Value::Null,Err(e)=>return Err(err("probe journal",e))}),
  "actual_write_journal"=>{write_json(&root.join("task-journal.json"),&args["journal"])?;Ok(Value::Null)},
  "comfy_workflow_preflight"=>crate::comfy_generation::comfy_workflow_preflight(string("baseUrl")?,string("workflowPath")?,args["installationRoot"].as_str().map(str::to_owned)).await,
  "comfy_inspect_generation_workflow"=>crate::comfy_generation::comfy_inspect_generation_workflow(string("workflowPath")?),
  "comfy_admit_generation"=>crate::comfy_admission::admit_with_store(store,serde_json::from_value(args["request"].clone()).map_err(|e|err("probe admission",e))?).await,
  "comfy_submit_generation"=>crate::comfy_generation::comfy_submit_generation(serde_json::from_value(args["request"].clone()).map_err(|e|err("probe submission",e))?).await,
  "comfy_generation_status"=>crate::comfy_generation::comfy_generation_status(string("baseUrl")?,string("promptId")?).await,
  "comfy_collect_generation"=>serde_json::to_value(crate::comfy_generation::collect_generation_in_data_dir(root.join("app-data"),serde_json::from_value(args["request"].clone()).map_err(|e|err("probe collect",e))?).await?).map_err(|e|err("probe collected JSON",e)),
  _=>Err(format!("probe_command_not_allowed: {command}")),
 }
}

async fn frontend_proof(root:&Path)->Res<Value> {
 let source=PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().ok_or("probe source")?.to_path_buf();
 let launch=crate::comfy_owned_backend::start_owned(root.join("owned"),serde_json::from_value(crate::comfy_owned_backend::comfy_owned_backend_defaults()?).map_err(|e|err("probe defaults",e))?).await?;
 write_json(&root.join("launch.json"),&launch)?;
 let mut ready=false;
 let deadline=std::time::Instant::now()+Duration::from_secs(900);
 while std::time::Instant::now()<deadline {
  tokio::time::sleep(Duration::from_secs(1)).await;
  let state=crate::comfy_owned_backend::comfy_owned_backend_status().await?;
  if state["state"]=="ready" {write_json(&root.join("attestation.json"),&state)?;ready=true;break;}
 }
 if !ready{return Err("probe_owned_backend_not_ready".into());}
 let graph=root.join("music3-smoke.api.json");
 fs::write(&graph,include_str!("../resources/comfy-music3-smoke.api.json")).map_err(|e|err("probe graph",e))?;
 fs::create_dir_all(root.join("app-data/local/tools/media-edit")).map_err(|e|err("probe mkdir",e))?;
 fs::create_dir_all(root.join("media/BGM")).map_err(|e|err("probe mkdir",e))?;
 // Existing CPU executables only. No environment installer or package operation.
 let ffmpeg=std::env::var("AIMS_ACTUAL_FFMPEG").map_err(|_|"explicit existing ffmpeg required")?;
 if !Path::new(&ffmpeg).is_file(){return Err("probe_existing_ffmpeg_missing".into());}
 write_json(&root.join("app-data/local/tools/media-edit/environment.json"),&json!({"ffmpeg":ffmpeg}))?;
 write_json(&root.join("setup.json"),&json!({"root":root,"workflowPath":graph,"baseUrl":launch["baseUrl"],"baseDirectory":root.join("media")}))?;
 let spool=root.join("ipc");fs::create_dir_all(&spool).map_err(|e|err("probe mkdir",e))?;
 let node=std::env::var("AIMS_ACTUAL_NODE").map_err(|_|"explicit existing node required")?;
 let mut command=Command::new(node);
 command.current_dir(&source).args(["node_modules/vitest/vitest.mjs","run","--root",".","client/src/lib/comfyWorkflowActual.test.ts","--maxWorkers=1","--minWorkers=1"])
  .env("AIMS_ACTUAL_MUSIC3_ROOT",root).stdin(Stdio::null()).stdout(fs::File::create(root.join("frontend.log")).map_err(|e|err("probe log",e))?).stderr(Stdio::inherit());
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 let mut frontend=command.spawn().map_err(|e|err("probe frontend launch",e))?;
 let mut handled=HashSet::new();let mut submissions=0;
 loop {
  for entry in fs::read_dir(&spool).map_err(|e|err("probe requests",e))? {
   let path=entry.map_err(|e|err("probe request",e))?.path();
   let name=path.file_name().and_then(|v|v.to_str()).unwrap_or("").to_string();
   if !name.ends_with(".request.json")||!handled.insert(name){continue;}
   let request:Value=serde_json::from_slice(&fs::read(&path).map_err(|e|err("probe request read",e))?).map_err(|e|err("probe request JSON",e))?;
   let command=request["command"].as_str().ok_or("probe command")?;
   let result=if command=="comfy_submit_generation"&&submissions>=1{Err("probe_single_generation_limit".into())}else{if command=="comfy_submit_generation"{submissions+=1;}dispatch(command,request["args"].clone(),root).await};
   let response=match result{Ok(value)=>json!({"ok":true,"value":value}),Err(error)=>json!({"ok":false,"error":error})};
   write_json(&path.with_file_name(path.file_name().unwrap().to_string_lossy().replace(".request.json",".response.json")),&response)?;
  }
  if let Some(status)=frontend.try_wait().map_err(|e|err("probe frontend state",e))? {
   let evidence=json!({"frontendSuccess":status.success(),"submissions":submissions,"forcedTermination":false,"mockGenerationResults":false,"transport":"test-only-file-IPC","UIObserved":false});
   write_json(&root.join("frontend-exit.json"),&evidence)?;
   if !status.success(){return Err("probe_frontend_failed: inspect preserved frontend log and receipts".into());}
   return Ok(evidence);
  }
  tokio::time::sleep(Duration::from_millis(30)).await;
 }
}

#[tokio::test]
#[ignore="Explicit project-authorized single Music3 GPU generation, isolated stores only"]
async fn music3_common_product_path_generation_registration_history() {
 let root=PathBuf::from(std::env::var("AIMS_ACTUAL_MUSIC3_ROOT").expect("explicit writable proof root"));
 assert!(root.is_absolute()&&!root.exists(),"new isolated proof root required");
 fs::create_dir_all(&root).unwrap();
 let result=frontend_proof(&root).await;
 // Even on a frontend failure, retain the original handle until normal exit.
 let mut stop_requested=false;
 loop {
  match crate::comfy_owned_backend::original_owned_exit_state().unwrap(){None|Some(true)=>break,Some(false)=>{}}
  let stop=crate::comfy_owned_backend::comfy_owned_backend_stop().await;
  write_json(&root.join("normal-stop.json"),&json!({"result":stop})).unwrap();
  if stop.is_ok(){stop_requested=true;write_json(&root.join("original-stdin-eof.json"),&crate::comfy_owned_backend::release_original_owned_stdin_after_stop().unwrap()).unwrap();crate::comfy_owned_backend::wait_for_original_owned_exit().await.unwrap();break;}
  // A failed frontend may leave its submitted GPU job running. Never kill it
  // or drop ownership; wait until the original server accepts normal stop.
  tokio::time::sleep(Duration::from_secs(2)).await;
 }
 write_json(&root.join("result.json"),&json!({"result":result,"normalExit":true,"normalStopRequested":stop_requested,"forceKill":false})).unwrap();
 assert!(result.is_ok(),"actual integration failed; preserved evidence identifies the boundary");
}
