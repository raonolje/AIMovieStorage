//! App-owned, loopback-only child. Never inspects, terminates or changes user servers.
use std::{collections::BTreeMap,fs,io::{Read,Write},net::TcpListener,path::{Path,PathBuf},process::{Child,Command,Stdio},sync::{Mutex,OnceLock}};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::{Res,err,ensure_inside};

use crate::comfy_reviewed_registry::{self,ReviewedWeightFile};
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct OwnedBackendRequest {pub installation_root:String,pub shared_models:String,pub port:u16,pub idle_endpoints:Vec<String>,#[serde(default)] pub preset_ids:Vec<String>}
struct OwnedChild {child:Child,base:String,root:PathBuf,record:Value,request:OwnedBackendRequest,weights:Value,ready:bool,server_pid:Option<u32>}
static CHILD:OnceLock<Mutex<Option<OwnedChild>>>=OnceLock::new();
fn children()->&'static Mutex<Option<OwnedChild>>{CHILD.get_or_init(||Mutex::new(None))}
fn hash(path:&Path)->Res<String>{let mut file=fs::File::open(path).map_err(|e|err("owned source read",e))?;let mut state=Sha256::new();let mut bytes=[0u8;65536];loop{let n=file.read(&mut bytes).map_err(|e|err("owned source hash",e))?;if n==0{break;}state.update(&bytes[..n]);}Ok(format!("{:x}",state.finalize()))}
fn local_path(raw:&str)->Res<PathBuf>{let p=PathBuf::from(raw);if !p.is_absolute()||raw.starts_with("\\\\")||raw.contains("://")||!p.is_dir(){return Err("owned_backend_existing_local_directory_required".into());}Ok(p)}
pub(crate) fn reviewed_sources_for_review(root:&Path,review:&Value)->Res<Value>{for source in review["sourceFiles"].as_array().ok_or("owned review sources")?{let module=source["module"].as_str().ok_or("owned source module")?;let path=root.join(format!("{}.py",module.replace('.',"/")));let checked=ensure_inside(root,&path)?;if hash(&checked)?!=source["sha256"].as_str().ok_or("owned source sha")?{return Err(format!("owned_source_review_mismatch: {module}"));}}Ok(review.clone())}
#[cfg(test)]fn reviewed_sources(root:&Path)->Res<Value>{let plan=comfy_reviewed_registry::packaged()?.backend_plan(&[])?;reviewed_sources_for_review(root,&plan.review)}
fn snapshot(source:&Path,target:&Path,files:&mut BTreeMap<String,String>,relative:&Path)->Res<()> {
 for entry in fs::read_dir(source.join(relative)).map_err(|e|err("owned snapshot list",e))? {
  let entry=entry.map_err(|e|err("owned snapshot entry",e))?;let kind=entry.file_type().map_err(|e|err("owned snapshot type",e))?;let name=entry.file_name();let name=name.to_string_lossy();
  if kind.is_symlink(){return Err("owned snapshot symlink forbidden".into());}
  let rel=relative.join(name.as_ref());
  if kind.is_dir(){
   if relative.as_os_str().is_empty() && !["app","api_server","comfy","comfy_extras","comfy_api","comfy_api_nodes","comfy_execution","comfy_config","alembic_db","blueprints","utils","middleware"].contains(&name.as_ref()){continue;}
   if name=="__pycache__"||name==".git"{continue;}
   fs::create_dir_all(target.join(&rel)).map_err(|e|err("owned snapshot mkdir",e))?;snapshot(source,target,files,&rel)?;
  }else if kind.is_file() && (matches!(entry.path().extension().and_then(|v|v.to_str()),Some("py"|"ini"|"sql")) || (relative.as_os_str().is_empty() && name=="requirements.txt")){
   let checked=ensure_inside(source,&entry.path())?;if fs::metadata(&checked).map_err(|e|err("owned source stat",e))?.len()>16*1024*1024{return Err("owned source too large".into());}
   let bytes=fs::read(&checked).map_err(|e|err("owned snapshot read",e))?;let sha=format!("{:x}",Sha256::digest(&bytes));
   fs::write(target.join(&rel),bytes).map_err(|e|err("owned snapshot write",e))?;files.insert(rel.to_string_lossy().replace('\\',"/"),sha);
  }
 }Ok(())
}
pub(crate) fn verified_weights_for_files(root:&Path,files:&[ReviewedWeightFile])->Res<Value>{let mut result=vec![];for file in files{let fact=serde_json::to_value(file).map_err(|e|err("owned weights",e))?;
 let category=fact["category"].as_str().ok_or("owned category")?;let name=fact["name"].as_str().ok_or("owned name")?;let path=ensure_inside(root,&root.join(category).join(name))?;let before=fs::metadata(&path).map_err(|e|err("owned weight stat",e))?;
 if before.len()!=fact["bytes"].as_u64().ok_or("owned bytes")?||hash(&path)?!=fact["sha256"].as_str().ok_or("owned weight sha")?{return Err(format!("owned_weight_hash_mismatch: {category}/{name}"));}
 let after=fs::metadata(&path).map_err(|e|err("owned weight stat",e))?;if before.len()!=after.len()||before.modified().ok()!=after.modified().ok(){return Err("owned_weight_changed_during_hash".into());}
 result.push(json!({"category":category,"name":name,"sha256":fact["sha256"],"license":"unknown","path":path,"bytes":before.len(),"modified":after.modified().ok().and_then(|v|v.duration_since(std::time::UNIX_EPOCH).ok()).map(|v|v.as_nanos().to_string())}));
 }Ok(json!(result))}
fn recheck_owned(child:&mut OwnedChild)->Res<()> {
 if child.child.try_wait().map_err(|e|err("owned child state",e))?.is_some(){return Err("owned_backend_exited: 로그를 확인하세요. 자동 재시작하지 않습니다.".into());}
 if hash(&child.root.join("bootstrap.py"))?!=child.record["bootstrapSha256"].as_str().ok_or("owned bootstrap hash missing")?{return Err("owned_bootstrap_changed".into());}
 for (name,sha) in child.record["sourceFiles"].as_object().ok_or("owned source record")?{if hash(&child.root.join("source").join(name))?!=sha.as_str().ok_or("owned source hash")?{return Err("owned_source_changed".into());}}
 for fact in child.weights.as_array().ok_or("owned weight record")?{let meta=fs::metadata(fact["path"].as_str().ok_or("owned weight path")?).map_err(|e|err("owned weight stat",e))?;let modified=meta.modified().ok().and_then(|v|v.duration_since(std::time::UNIX_EPOCH).ok()).map(|v|v.as_nanos().to_string());if meta.len()!=fact["bytes"].as_u64().unwrap_or(0)||modified.as_deref()!=fact["modified"].as_str(){return Err("owned_weight_changed: 전체 해시를 다시 확인하고 새 backend를 시작하세요.".into());}}
 Ok(())
}
pub fn owned_record(base:&str)->Res<Option<Value>>{let mut guard=children().lock().map_err(|_|"owned lock")?;if let Some(child)=guard.as_mut(){if child.base!=base{return Ok(None);}recheck_owned(child)?;return Ok(Some(json!({"identityContractVersion":2,"managerPid":child.record["managerPid"],"launcherPid":child.child.id(),"serverPid":child.server_pid,"pid":child.server_pid.unwrap_or(child.child.id()),"nonce":child.record["nonce"],"coreCommit":child.record["coreCommit"],"sourceFingerprint":child.record["sourceFingerprint"],"bootstrapSha256":child.record["bootstrapSha256"],"installationRoot":child.root.join("source"),"workRoot":child.root,"nodeSourceHashes":child.record["nodeSourceHashes"],"weights":child.weights,"baseUrl":child.base,"sourceEvidence":"owned-child-attestation","registrySha256":child.record["registrySha256"],"reviewedPresetIds":child.record["reviewedPresetIds"],"review":child.record["review"]})));}Ok(None)}
/// Only newly managed launches can use this versioned proof. Legacy endpoints
/// cannot be adopted by adding an observed PID to a record after startup.
pub fn verify_source_attestation(record:&Value,proof:&Value)->Res<u32>{
 if record["identityContractVersion"]!=json!(2)||proof["identityContractVersion"]!=json!(2){return Err("owned_launch_identity_contract_missing".into());}
 for field in ["managerPid","nonce","coreCommit","sourceFingerprint","bootstrapSha256"]{if record[field].is_null()||proof[field]!=record[field]{return Err("owned_backend_identity_mismatch".into());}}
 if !record["registrySha256"].is_null(){for field in ["registrySha256","reviewedPresetIds"]{if proof[field]!=record[field]{return Err("owned_backend_registry_identity_mismatch".into());}}}
 let process_id=|field:&Value|field.as_u64().and_then(|id|u32::try_from(id).ok()).filter(|id|*id>0).ok_or("owned_backend_pid_invalid".to_string());
 let launcher=process_id(&record["launcherPid"])?;let manager=process_id(&record["managerPid"])?;let server=process_id(&proof["pid"])?;let parent=process_id(&proof["parentPid"])?;
 if launcher==manager||server==manager{return Err("owned_backend_pid_invalid".into());}
 if server==launcher {if parent!=manager{return Err("owned_backend_parent_mismatch".into());}}
 else if !cfg!(windows)||parent!=launcher{return Err("owned_backend_parent_mismatch".into());}
 if let Some(frozen)=record["serverPid"].as_u64(){if frozen!=u64::from(server){return Err("owned_backend_server_pid_changed".into());}}
 Ok(server)
}
async fn idle(base:&str,require_memory:bool)->Res<()> {let (base,client)=crate::comfy_generation::client(base)?;let queue:Value=client.get(format!("{base}/queue")).send().await.map_err(|e|err("owned idle GET",e))?.error_for_status().map_err(|e|err("owned idle status",e))?.json().await.map_err(|e|err("owned idle JSON",e))?;
 if queue["queue_running"].as_array().map(|v|v.len())!=Some(0)||queue["queue_pending"].as_array().map(|v|v.len())!=Some(0){return Err("owned_backend_gpu_queue_busy".into());}
 if !require_memory{return Ok(());}
 let stats:Value=client.get(format!("{base}/system_stats")).send().await.map_err(|e|err("owned memory GET",e))?.json().await.map_err(|e|err("owned memory JSON",e))?;
 if stats.pointer("/system/ram_free").and_then(Value::as_u64).unwrap_or(0)<24*1024*1024*1024||stats.pointer("/devices/0/vram_free").and_then(Value::as_u64).unwrap_or(0)<4*1024*1024*1024{return Err("owned_backend_memory_not_available_or_unverified".into());}Ok(())}

pub async fn start_owned(work_root:PathBuf,mut request:OwnedBackendRequest)->Res<Value>{
 let plan=comfy_reviewed_registry::packaged()?.backend_plan(&request.preset_ids)?;request.preset_ids=plan.preset_ids.clone();
 if request.port<1024||request.idle_endpoints.is_empty()||request.idle_endpoints.len()>4{return Err("owned_backend_port_and_idle_endpoints_required".into());}
 let source=local_path(&request.installation_root)?;let models=local_path(&request.shared_models)?;let review=reviewed_sources_for_review(&source,&plan.review)?;
 {let mut guard=children().lock().map_err(|_|"owned lock")?;if let Some(child)=guard.as_mut(){if child.child.try_wait().map_err(|e|err("owned child",e))?.is_none(){if child.request.installation_root!=request.installation_root||child.request.shared_models!=request.shared_models||child.request.port!=request.port||child.request.preset_ids!=request.preset_ids||child.record["registrySha256"]!=plan.registry_sha256{return Err("owned_backend_already_running: 기존 앱 소유 작업을 확인하세요.".into());}recheck_owned(child)?;return Ok(json!({"baseUrl":child.base,"pid":child.child.id(),"state":"existing-owned","logPath":child.root.join("backend.log")}));}}}
 let head=fs::read_to_string(source.join(".git/HEAD")).map_err(|e|err("owned disk HEAD",e))?;
 let disk_commit=if let Some(reference)=head.trim().strip_prefix("ref: "){if !reference.starts_with("refs/")||reference.contains("..")||reference.contains('\\'){return Err("owned invalid disk ref".into());}fs::read_to_string(ensure_inside(&source.join(".git"),&source.join(".git").join(reference))?).map_err(|e|err("owned disk ref",e))?}else{head};
 if disk_commit.trim()!=review["diskCoreCommit"].as_str().ok_or("owned reviewed commit")?{return Err("owned_disk_commit_review_mismatch".into());}
 for endpoint in &request.idle_endpoints{idle(endpoint,true).await?;}
 let listener=TcpListener::bind(("127.0.0.1",request.port)).map_err(|e|err("owned_backend_port_in_use",e))?;
 let weights=verified_weights_for_files(&models,&plan.weights)?;
 let root=work_root.join(format!("comfy-owned-{}",uuid::Uuid::new_v4()));let target=root.join("source");fs::create_dir_all(&target).map_err(|e|err("owned root",e))?;
 let mut source_files=BTreeMap::new();snapshot(&source,&target,&mut source_files,Path::new(""))?;reviewed_sources_for_review(&target,&plan.review)?;
 let nonce=uuid::Uuid::new_v4().to_string();let source_fingerprint=format!("{:x}",Sha256::digest(serde_json::to_vec(&source_files).map_err(|e|err("owned fingerprint",e))?));
 let bootstrap=include_str!("../resources/comfy-owned-bootstrap.py");
 let record=json!({"identityContractVersion":2,"managerPid":std::process::id(),"nonce":nonce,"coreCommit":review["diskCoreCommit"],"sourceFingerprint":source_fingerprint,"sourceFiles":source_files,"nodeSourceHashes":review["nodeSourceHashes"],"bootstrapSha256":format!("{:x}",Sha256::digest(bootstrap.as_bytes())),"registrySha256":plan.registry_sha256,"reviewedPresetIds":plan.preset_ids,"review":review});
 fs::write(root.join("source-attestation.json"),serde_json::to_vec_pretty(&record).map_err(|e|err("owned attestation",e))?).map_err(|e|err("owned attestation write",e))?;
 fs::write(root.join("bootstrap.py"),bootstrap).map_err(|e|err("owned bootstrap",e))?;
 let mut mapping=serde_json::Map::new();mapping.insert("base_path".into(),json!(models));for category in ["diffusion_models","text_encoders","vae","loras","checkpoints","clip_vision","embeddings","upscale_models"]{mapping.insert(category.into(),json!(category));}
 fs::write(root.join("model-paths.json"),serde_json::to_vec(&json!({"aimoviestorage_owned":mapping})).map_err(|e|err("owned models JSON",e))?).map_err(|e|err("owned models write",e))?;
 for name in ["input","output","temp"]{fs::create_dir_all(root.join(name)).map_err(|e|err("owned media mkdir",e))?;}
 let python=source.join(if cfg!(windows){".venv/Scripts/python.exe"}else{".venv/bin/python"});if !python.is_file(){return Err("owned_backend_existing_venv_python_missing".into());}
 let log=fs::File::create(root.join("backend.log")).map_err(|e|err("owned log",e))?;
 let mut command=Command::new(&python);command.current_dir(&target).arg("-B").arg(root.join("bootstrap.py")).args(["--listen","127.0.0.1","--port"]).arg(request.port.to_string()).args(["--disable-all-custom-nodes","--disable-api-nodes","--disable-auto-launch","--lowvram","--preview-method","none","--extra-model-paths-config"]).arg(root.join("model-paths.json"));
 for name in ["input","output","temp"]{command.arg(format!("--{name}-directory")).arg(root.join(name));}
 command.env("HF_HUB_OFFLINE","1").env("TRANSFORMERS_OFFLINE","1").env("PYTHONDONTWRITEBYTECODE","1").stdin(Stdio::piped()).stdout(Stdio::from(log.try_clone().map_err(|e|err("owned log clone",e))?)).stderr(Stdio::from(log));
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 let launch=json!({"python":python,"argv":command.get_args().map(|v|v.to_string_lossy().to_string()).collect::<Vec<_>>(),"coreCommit":record["coreCommit"],"sourceFingerprint":record["sourceFingerprint"],"nodeSourceHashes":record["nodeSourceHashes"],"weights":weights,"networkPolicy":"loopback-only/offline/no-custom/no-api","actualGeneration":"not-run"});
 fs::write(root.join("launch-record.json"),serde_json::to_vec_pretty(&launch).map_err(|e|err("owned launch record",e))?).map_err(|e|err("owned launch write",e))?;
 drop(listener);let child=command.spawn().map_err(|e|err("owned_backend_spawn_denied_or_failed",e))?;let pid=child.id();let base=format!("http://127.0.0.1:{}",request.port);
 *children().lock().map_err(|_|"owned lock")?=Some(OwnedChild{child,base:base.clone(),root:root.clone(),record,request,weights,ready:false,server_pid:None});
 Ok(json!({"baseUrl":base,"pid":pid,"state":"starting","logPath":root.join("backend.log"),"launchRecord":root.join("launch-record.json"),"actualGeneration":"not-run"}))
}
#[tauri::command]
pub async fn comfy_owned_backend_start(app:tauri::AppHandle,request:OwnedBackendRequest)->Res<Value>{let root=app.path().app_data_dir().map_err(|e|err("owned app folder",e))?.join("comfy-owned");start_owned(root,request).await}
#[tauri::command]
pub async fn comfy_owned_backend_status()->Res<Value>{
 let base={let guard=children().lock().map_err(|_|"owned lock")?;guard.as_ref().map(|v|v.base.clone()).ok_or("owned_backend_not_started")?};
 let record=owned_record(&base)?.ok_or("owned_backend_not_started")?;
 let (base,client)=crate::comfy_generation::client(&base)?;
 match client.get(format!("{base}/aimoviestorage/source_attestation")).send().await {
  Ok(response)=>{
   let proof:Value=response.error_for_status().map_err(|e|err("owned attestation status",e))?.json().await.map_err(|e|err("owned attestation JSON",e))?;
   let server_pid=verify_source_attestation(&record,&proof)?;
   {let mut guard=children().lock().map_err(|_|"owned lock")?;let child=guard.as_mut().ok_or("owned_backend_not_started")?;recheck_owned(child)?;
    if child.child.id()!=record["launcherPid"].as_u64().unwrap_or(0) as u32||child.record["nonce"]!=record["nonce"]{return Err("owned_backend_identity_mismatch".into());}
    child.server_pid=Some(server_pid);child.ready=true;}
   Ok(json!({"state":"ready","record":owned_record(&base)?.ok_or("owned_backend_not_started")?}))
  },Err(_)=>Ok(json!({"state":"starting","record":record}))
 }
}
#[tauri::command]
pub async fn comfy_owned_backend_stop()->Res<Value>{
 let (base,ready)={let guard=children().lock().map_err(|_|"owned lock")?;let child=guard.as_ref().ok_or("owned_backend_not_started")?;(child.base.clone(),child.ready)};
 if ready {
  let status=comfy_owned_backend_status().await?;
  if status["state"]!="ready"{return Err("owned_backend_identity_not_ready".into());}
  idle(&base,false).await?;
  let record=owned_record(&base)?.ok_or("owned_backend_not_started")?;
  let (base,client)=crate::comfy_generation::client(&base)?;
  let response=client.post(format!("{base}/aimoviestorage/stop")).json(&json!({"nonce":record["nonce"]})).send().await.map_err(|e|err("owned normal stop",e))?;
  if !response.status().is_success(){return Err("owned_backend_normal_stop_rejected".into());}
 }
 let mut guard=children().lock().map_err(|_|"owned lock")?;let child=guard.as_mut().ok_or("owned_backend_not_started")?;
 // This handle belongs to this exact child, including while it is still starting.
 if child.child.try_wait().map_err(|e|err("owned child state",e))?.is_some(){return Ok(json!({"state":"exited","pid":child.child.id(),"forceKill":false}));}
 if let Err(error)=child.child.stdin.as_mut().ok_or("owned stdin unavailable")?.write_all(b"stop\n"){if !ready{return Err(err("owned normal stop",error));}}
 Ok(json!({"state":"normal-stop-requested","pid":child.child.id(),"forceKill":false}))
}

#[tauri::command]
pub fn comfy_owned_backend_defaults()->Res<Value>{let local=dirs::data_local_dir().ok_or("owned local data folder")?;let installation=local.join("Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI");let models=local.join("Comfy-Desktop/ComfyUI-Shared/models");Ok(json!({"installationRoot":if installation.is_dir(){Some(installation)}else{None},"sharedModels":if models.is_dir(){Some(models)}else{None},"port":8190,"presetIds":comfy_reviewed_registry::packaged()?.default_preset_ids,"idleEndpoints":["http://127.0.0.1:8188","http://127.0.0.1:8189"]}))}
#[tauri::command]
pub fn comfy_owned_music3_candidate(app:tauri::AppHandle)->Res<Value>{let root=app.path().app_data_dir().map_err(|e|err("workflow draft folder",e))?.join("comfy-workflow-drafts");fs::create_dir_all(&root).map_err(|e|err("workflow draft mkdir",e))?;let path=root.join(format!("music3-smoke-{}.api.json",uuid::Uuid::new_v4()));fs::write(&path,include_str!("../resources/comfy-music3-smoke.api.json")).map_err(|e|err("workflow draft write",e))?;Ok(json!({"workflowPath":path,"status":"experimental-not-run"}))}

#[cfg(test)]mod tests {use super::*;#[test]fn snapshot_excludes_credentials_custom_nodes_and_models(){let from=tempfile::tempdir().unwrap();let to=tempfile::tempdir().unwrap();for dir in ["comfy","custom_nodes","models","user"]{fs::create_dir_all(from.path().join(dir)).unwrap();fs::write(from.path().join(dir).join("module.py"),"x=1").unwrap();}fs::write(from.path().join(".env"),"synthetic-only").unwrap();let mut files=BTreeMap::new();snapshot(from.path(),to.path(),&mut files,Path::new("")).unwrap();assert_eq!(files.len(),1);assert!(files.contains_key("comfy/module.py"));assert!(!to.path().join(".env").exists());}#[test]fn review_is_not_automatically_refreshed(){let root=tempfile::tempdir().unwrap();assert!(reviewed_sources(root.path()).is_err());}}

#[cfg(test)]mod identity_contract_tests {
 use super::*;
 fn record()->Value{json!({"identityContractVersion":2,"managerPid":100,"launcherPid":200,"serverPid":null,"nonce":"synthetic-only","coreCommit":"reviewed","sourceFingerprint":"source-sha","bootstrapSha256":"wrapper-sha"})}
 fn proof()->Value{json!({"identityContractVersion":2,"managerPid":100,"pid":200,"parentPid":100,"nonce":"synthetic-only","coreCommit":"reviewed","sourceFingerprint":"source-sha","bootstrapSha256":"wrapper-sha"})}
 #[test]fn managed_direct_identity_requires_original_manager_parent(){
  let r=record();let p=proof();assert_eq!(verify_source_attestation(&r,&p).unwrap(),200);
  let mut wrong=p.clone();wrong["parentPid"]=json!(999);assert!(verify_source_attestation(&r,&wrong).is_err());
  for field in ["identityContractVersion","managerPid","nonce","coreCommit","sourceFingerprint","bootstrapSha256"]{
   let mut wrong=p.clone();wrong.as_object_mut().unwrap().remove(field);assert!(verify_source_attestation(&r,&wrong).is_err(),"missing {field}");
  }
  let mut legacy=p;legacy.as_object_mut().unwrap().remove("identityContractVersion");legacy.as_object_mut().unwrap().remove("parentPid");assert!(verify_source_attestation(&r,&legacy).is_err());
 }
 #[test]fn redirector_identity_is_one_hop_and_server_pid_is_frozen(){
  let mut r=record();let mut p=proof();p["pid"]=json!(300);p["parentPid"]=json!(200);
  if cfg!(windows){assert_eq!(verify_source_attestation(&r,&p).unwrap(),300);}else{assert!(verify_source_attestation(&r,&p).is_err());}
  let mut wrong=p.clone();wrong["parentPid"]=json!(100);assert!(verify_source_attestation(&r,&wrong).is_err());
  wrong=p.clone();wrong["parentPid"]=json!(250);assert!(verify_source_attestation(&r,&wrong).is_err());
  r["serverPid"]=json!(301);assert!(verify_source_attestation(&r,&p).is_err());
  wrong=p;wrong["pid"]=json!(100);assert!(verify_source_attestation(&r,&wrong).is_err());
 }
 #[test]fn packaged_registry_and_selected_preset_ids_are_bound_to_loaded_identity(){let mut r=record();let mut p=proof();r["registrySha256"]=json!("a".repeat(64));r["reviewedPresetIds"]=json!(["cpu-builtin"]);p["registrySha256"]=r["registrySha256"].clone();p["reviewedPresetIds"]=r["reviewedPresetIds"].clone();assert!(verify_source_attestation(&r,&p).is_ok());for field in ["registrySha256","reviewedPresetIds"]{let mut changed=p.clone();changed.as_object_mut().unwrap().remove(field);assert!(verify_source_attestation(&r,&changed).unwrap_err().contains("registry_identity_mismatch"));}p["reviewedPresetIds"]=json!(["unreviewed"]);assert!(verify_source_attestation(&r,&p).is_err());}
}

#[cfg(test)]
mod owned_startup_probe {
 use super::*;
 #[tokio::test]
 #[ignore = "Explicitly authorized owned-child startup only; no media generation"]
 async fn reviewed_owned_backend_startup_and_normal_exit(){
  let root=PathBuf::from(std::env::var("AIMS_OWNED_STARTUP_PROBE_ROOT").expect("explicit writable proof folder"));
  assert!(root.is_absolute());fs::create_dir_all(&root).unwrap();
  let defaults=comfy_owned_backend_defaults().unwrap();
  let request:OwnedBackendRequest=serde_json::from_value(defaults).unwrap();
  let launch=start_owned(root.clone(),request).await.expect("owned startup admission");
  fs::write(root.join("owned-startup-launch.json"),serde_json::to_vec_pretty(&launch).unwrap()).unwrap();
  let mut ready=None;let mut failure=None;
  let deadline=std::time::Instant::now()+std::time::Duration::from_secs(900);
  let mut next_progress=std::time::Instant::now();
  while std::time::Instant::now()<deadline {
   tokio::time::sleep(std::time::Duration::from_secs(1)).await;
   let state=match comfy_owned_backend_status().await {Ok(value)=>value,Err(error)=>{failure=Some(error);break;}};
   if state["state"]=="ready"{ready=Some(state);break;}
   if std::time::Instant::now()>=next_progress{println!("owned startup is still loading; no generation submitted");next_progress=std::time::Instant::now()+std::time::Duration::from_secs(30);}
  }
  if let Some(value)=&ready{fs::write(root.join("owned-startup-attestation.json"),serde_json::to_vec_pretty(value).unwrap()).unwrap();}
  let stop=comfy_owned_backend_stop().await.expect("normal stop through the original owned handle");
  fs::write(root.join("owned-startup-normal-stop.json"),serde_json::to_vec_pretty(&stop).unwrap()).unwrap();
  let mut exited=false;
  for _ in 0..600 {
   tokio::time::sleep(std::time::Duration::from_millis(100)).await;
   if children().lock().unwrap().as_mut().unwrap().child.try_wait().unwrap().is_some(){exited=true;break;}
  }
  fs::write(root.join("owned-startup-exit.json"),serde_json::to_vec_pretty(&json!({"exited":exited,"ready":ready.is_some(),"startupError":failure,"forceKill":false})).unwrap()).unwrap();
  // Keep the original handle alive if a slow startup has not yet processed stop.
  while !exited {
   tokio::time::sleep(std::time::Duration::from_secs(1)).await;
   exited=children().lock().unwrap().as_mut().unwrap().child.try_wait().unwrap().is_some();
  }
  assert!(ready.is_some(),"startup not ready; normal exit was checked before reporting failure");
  println!("owned backend startup attestation and normal exit verified; no generation submitted");
 }
}

#[cfg(test)]
pub(crate) async fn wait_for_original_owned_exit() -> Res<()> {
 loop {
  {let mut guard=children().lock().map_err(|_|"owned lock")?;
   let child=guard.as_mut().ok_or("owned_backend_not_started")?;
   if child.child.try_wait().map_err(|e|err("owned child state",e))?.is_some(){return Ok(());}}
  tokio::time::sleep(std::time::Duration::from_millis(100)).await;
 }
}

#[cfg(test)]
pub(crate) fn original_owned_exit_state() -> Res<Option<bool>> {
 let mut guard=children().lock().map_err(|_|"owned lock")?;
 match guard.as_mut(){Some(child)=>Ok(Some(child.child.try_wait().map_err(|e|err("owned child state",e))?.is_some())),None=>Ok(None)}
}

#[cfg(test)]
pub(crate) async fn close_original_owned_stdin_for_eof() -> Res<Value> {
 let state=comfy_owned_backend_status().await?;
 if state["state"]!="ready"{return Err("owned_backend_identity_not_ready".into());}
 let base=state.pointer("/record/baseUrl").and_then(Value::as_str).ok_or("owned base")?;
 idle(base,false).await?;
 let mut guard=children().lock().map_err(|_|"owned lock")?;
 let child=guard.as_mut().ok_or("owned_backend_not_started")?;
 drop(child.child.stdin.take().ok_or("owned stdin already closed")?);
 Ok(json!({"state":"normal-eof-requested","launcherPid":child.child.id(),"serverPid":child.server_pid,"forceKill":false}))
}

#[cfg(test)]
pub(crate) fn release_original_owned_stdin_after_stop() -> Res<Value> {
 let mut guard=children().lock().map_err(|_|"owned lock")?;
 let child=guard.as_mut().ok_or("owned_backend_not_started")?;
 drop(child.child.stdin.take());
 Ok(json!({"originalStdinEOF":true,"launcherPid":child.child.id(),"serverPid":child.server_pid,"forceKill":false}))
}
