//! The first executable adapter is the exact reviewed Music3 zero-reference graph.
//! Other graphs stay inspectable but need their own native execution review.
use std::{collections::HashMap,fs,path::PathBuf,sync::{Mutex,OnceLock},time::{Duration,Instant}};
use serde::Deserialize;
use serde_json::{json,Value};
use tauri::Manager;
use crate::{Res,err,comfy_generation::{InputBinding,SubmitRequest}};
const GRAPH:&str=include_str!("../resources/comfy-music3-smoke.api.json");
const GRAPH_SHA:&str="305409054b67e11de5de8c91c3ea09865d062e496dfd919244f6f0209fb5d57d";
const REVIEW:&str=include_str!("../resources/comfy-node-review-v039-owned-music3.json");
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AdmissionRequest{pub base_url:String,pub workflow_path:String,pub expected_workflow_sha256:String,pub bindings:Vec<InputBinding>,pub manifest:Value,pub manifest_json:String,pub provenance:Value,pub destination:Value}
struct Admission{request:AdmissionRequest,created:Instant,trusted_path:PathBuf}
static ADMISSIONS:OnceLock<Mutex<HashMap<String,Admission>>>=OnceLock::new();
fn admissions()->&'static Mutex<HashMap<String,Admission>>{ADMISSIONS.get_or_init(||Mutex::new(HashMap::new()))}
static SUBMISSIONS:OnceLock<Mutex<HashMap<String,Value>>>=OnceLock::new();
fn submissions()->&'static Mutex<HashMap<String,Value>>{SUBMISSIONS.get_or_init(||Mutex::new(HashMap::new()))}
fn trusted_grants(path:&PathBuf,manifest:&Value)->Res<()> {
 let settings:Value=serde_json::from_slice(&fs::read(path).map_err(|e|err("workflow_project_authorization_store",e))?).map_err(|e|err("workflow authorization record",e))?;
 let trusted=settings.pointer("/entries/workflow-project-authorizations/value").and_then(Value::as_array).ok_or("workflow_project_authorization_missing")?;
 let grants=manifest["weightAuthorizations"].as_array().ok_or("workflow_manifest_authorizations_missing")?;
 let project=manifest["projectId"].as_str().filter(|v|!v.is_empty()).ok_or("workflow_trusted_project_required")?;
 if grants.len()!=3||grants.iter().any(|grant|grant["projectId"]!=project||grant["modelRuleId"]!="minimaxmusic3"||grant["kind"]!="user-reported"||!trusted.contains(grant)){return Err("workflow_project_authorization_untrusted_or_revoked".into());}Ok(())
}
fn check(request:&AdmissionRequest,owned:&Value)->Res<()> {
 use sha2::{Digest,Sha256};
 if owned["identityContractVersion"]!=2||owned["serverPid"].as_u64().is_none_or(|pid|pid==0)||owned["managerPid"]!=std::process::id(){return Err("owned_backend_identity_not_ready".into());}
 if request.manifest_json.len()>2*1024*1024||serde_json::from_str::<Value>(&request.manifest_json).map_err(|e|err("workflow manifest JSON",e))?!=request.manifest||format!("{:x}",Sha256::digest(request.manifest_json.as_bytes()))!=request.provenance["manifestSha256"].as_str().unwrap_or(""){return Err("workflow_native_manifest_hash_mismatch".into());}
 if request.expected_workflow_sha256!=GRAPH_SHA||request.manifest["workflowSha256"]!=GRAPH_SHA||request.provenance["workflowSha256"]!=GRAPH_SHA{return Err("workflow_native_execution_review_required: 현재 Music3 고정 그래프만 실제 실행 검토를 마쳤습니다.".into());}
 let bytes=fs::read(&request.workflow_path).map_err(|e|err("workflow admission graph",e))?;if format!("{:x}",Sha256::digest(&bytes))!=GRAPH_SHA{return Err("workflow_changed".into());}
 if serde_json::from_slice::<Value>(&bytes).map_err(|e|err("workflow admission JSON",e))?!=serde_json::from_str::<Value>(GRAPH).map_err(|e|err("workflow fixed graph",e))?{return Err("workflow_fixed_graph_changed".into());}
 if request.manifest.pointer("/promptTarget/modelRuleId")!=Some(&json!("minimaxmusic3"))||request.manifest.pointer("/promptTarget/roleId")!=Some(&json!("primary"))||request.manifest.pointer("/selection/outputNodeIds")!=Some(&json!(["9"]))||request.manifest["outputKind"]!="audio"||request.manifest["operation"]!="music-generation"{return Err("workflow_native_role_mismatch".into());}
 let review:Value=serde_json::from_str(REVIEW).map_err(|e|err("workflow review",e))?;
 if request.manifest.pointer("/environment/coreCommit")!=Some(&owned["coreCommit"])||request.manifest.pointer("/environment/comfyVersion")!=Some(&review["comfyVersion"])||request.manifest.pointer("/environment/reviewVersion")!=Some(&review["reviewVersion"]){return Err("workflow_native_environment_changed".into());}
 for field in ["pythonVersion","torchVersion"] {if request.manifest["environment"][field]!=review[field]{return Err("workflow_native_environment_changed".into());}}
 let graph:Value=serde_json::from_str(GRAPH).map_err(|e|err("workflow fixed graph",e))?;
 let needs=request.manifest["nodeRequirements"].as_array().ok_or("workflow_native_node_requirements_missing")?;
 if needs.len()!=9||request.manifest.pointer("/environment/customNodeVersions")!=Some(&json!({})){return Err("workflow_native_node_requirements_changed".into());}
 for (id,node) in graph.as_object().ok_or("workflow fixed graph")? {
  let class=node["class_type"].as_str().ok_or("workflow fixed class")?;let pin=&review["reviewedNodes"][class];
  if needs.iter().filter(|need|need["nodeId"]==id.as_str()&&need["classType"]==class&&need["pythonModule"]==pin["pythonModule"]&&need["reviewId"]==pin["reviewId"]&&need["sourceSha256"]==pin["sourceSha256"]&&need["schemaSha256"]==review["schemaFingerprints"][class]).count()!=1{return Err("workflow_native_node_or_schema_mismatch".into());}
 }
 if request.provenance["promptTarget"]!=request.manifest["promptTarget"]||request.provenance["projectId"]!=request.manifest["projectId"]||request.provenance["weightAuthorizations"]!=request.manifest["weightAuthorizations"]||request.provenance["verification"]!=request.manifest["verification"]||request.manifest.pointer("/verification/actualGenerationRegistration")!=Some(&json!("not-run"))||request.manifest.pointer("/verification/executionAdmission")!=Some(&json!("required")){return Err("workflow_native_provenance_mismatch".into());}
 if request.destination["kind"]!="audio"||request.destination["assetType"]!="bgm-track"||request.destination["baseDirectory"].as_str().is_none_or(str::is_empty)||request.destination["projectName"].as_str().is_none_or(str::is_empty){return Err("workflow_native_destination_missing".into());}
 for weight in owned["weights"].as_array().ok_or("workflow_native_weight_record_missing")?{let found=request.manifest["weightRequirements"].as_array().ok_or("workflow_manifest_weights_missing")?.iter().any(|need|need["category"]==weight["category"]&&need["name"]==weight["name"]&&need["sha256"]==weight["sha256"]&&need["license"]=="allowed");let grant=request.manifest["weightAuthorizations"].as_array().ok_or("workflow_manifest_authorizations_missing")?.iter().any(|grant|grant["category"]==weight["category"]&&grant["name"]==weight["name"]&&grant["sha256"]==weight["sha256"]);if !found||!grant{return Err("workflow_native_weight_mismatch".into());}}
 let mut seen=std::collections::HashSet::new();
 for binding in &request.bindings {
  if binding.file_path.is_some()||!seen.insert((binding.node_id.clone(),binding.input.clone())){return Err("workflow_music3_reference_or_duplicate_forbidden".into());}
  let value=binding.value.as_ref().ok_or("workflow_music3_scalar_required")?;
  let valid=match (binding.node_id.as_str(),binding.input.as_str()){
   ("4","caption")=>value.as_str().is_some_and(|v|!v.trim().is_empty()&&v.len()<=32000),
   ("4","lyrics")=>value.as_str().is_some_and(|v|v=="[Instrumental]"||(!v.trim().is_empty()&&v.len()<=16000&&v.trim_end().ends_with("\n[end]")&&v.matches("[end]").count()==1)),
   ("4","max_duration")=>value.as_f64().is_some_and(|v|v>0.0&&v<=30.0),
   ("4","seed")|("7","seed")=>value.as_u64().is_some(),
   _=>false,
  };if !valid{return Err(format!("workflow_music3_unreviewed_binding: {}.{}",binding.node_id,binding.input));}
  let slot=match (binding.node_id.as_str(),binding.input.as_str()){("4","caption")=>"positive",("4","lyrics")=>"lyrics",("4","max_duration")=>"duration",("4","seed")=>"encodeSeed",("7","seed")=>"sampleSeed",_=>unreachable!()};
  if request.provenance["values"][slot]!=*value||(slot=="positive"&&request.provenance["prompt"]!=*value)||request.provenance["negative"]!=""{return Err("workflow_native_binding_provenance_mismatch".into());}
 }
 if seen.len()!=5{return Err("workflow_music3_required_bindings_missing".into());}Ok(())
}
#[tauri::command]
pub async fn comfy_admit_generation(app:tauri::AppHandle,request:AdmissionRequest)->Res<Value>{
 let path=app.path().app_data_dir().map_err(|e|err("workflow authorization folder",e))?.join("app-settings.json");
 admit_with_store(path,request).await
}
pub(crate) async fn admit_with_store(path:PathBuf,request:AdmissionRequest)->Res<Value>{
 if crate::comfy_owned_backend::comfy_owned_backend_status().await?["state"]!="ready"{return Err("owned_backend_identity_not_ready".into());}
 let owned=crate::comfy_owned_backend::owned_record(&request.base_url)?.ok_or("workflow_loaded_source_attestation_required: 앱 소유 검증 backend를 선택하세요.")?;
 check(&request,&owned)?;
 trusted_grants(&path,&request.manifest)?;
 let token=uuid::Uuid::new_v4().to_string();let mut records=admissions().lock().map_err(|_|"workflow admission lock")?;records.retain(|_,v|v.created.elapsed()<Duration::from_secs(120));records.insert(token.clone(),Admission{request,created:Instant::now(),trusted_path:path});
 Ok(json!({"admissionToken":token,"scope":"reviewed-music3-fixed-zero-reference","actualGeneration":"not-run"}))
}
pub async fn consume(request:&SubmitRequest)->Res<Value>{
 let token=request.admission_token.as_ref().ok_or("workflow_native_admission_required")?;let record=admissions().lock().map_err(|_|"workflow admission lock")?.remove(token).ok_or("workflow_native_admission_expired_or_used")?;
 if record.created.elapsed()>Duration::from_secs(120)||record.request.base_url!=request.base_url||record.request.workflow_path!=request.workflow_path||record.request.expected_workflow_sha256!=request.expected_workflow_sha256||serde_json::to_value(&record.request.bindings).map_err(|e|err("workflow bindings",e))?!=serde_json::to_value(&request.bindings).map_err(|e|err("workflow bindings",e))?{return Err("workflow_native_admission_request_changed".into());}
 if crate::comfy_owned_backend::comfy_owned_backend_status().await?["state"]!="ready"{return Err("owned_backend_identity_not_ready".into());}
 let owned=crate::comfy_owned_backend::owned_record(&request.base_url)?.ok_or("workflow_loaded_source_attestation_required")?;check(&record.request,&owned)?;trusted_grants(&record.trusted_path,&record.request.manifest)?;
 if record.request.provenance["clientId"]!=request.client_id{return Err("workflow_native_client_changed".into());}
 Ok(json!({"baseUrl":request.base_url,"provenance":record.request.provenance,"manifest":record.request.manifest,"destination":record.request.destination,"workRoot":owned["workRoot"]}))
}
pub fn record_submission(prompt_id:&str,mut record:Value,graph:Value)->Res<()> {record["submittedGraph"]=graph;record["promptId"]=json!(prompt_id);let root=PathBuf::from(record["workRoot"].as_str().ok_or("workflow submission root")?).join("submissions");fs::create_dir_all(&root).map_err(|e|err("workflow receipt folder",e))?;fs::write(root.join(format!("{prompt_id}.json")),serde_json::to_vec_pretty(&record).map_err(|e|err("workflow receipt JSON",e))?).map_err(|e|err("workflow receipt write",e))?;submissions().lock().map_err(|_|"workflow receipt lock")?.insert(prompt_id.into(),record);Ok(())}
pub fn verify_submission(request:&crate::comfy_generation::CollectRequest,history:&Value)->Res<()> {let base=&request.base_url;let prompt_id=&request.prompt_id;let mut records=submissions().lock().map_err(|_|"workflow receipt lock")?;if !records.contains_key(prompt_id){let owned=crate::comfy_owned_backend::owned_record(base)?.ok_or("workflow_submit_receipt_missing")?;let root=PathBuf::from(owned["workRoot"].as_str().ok_or("workflow submit root")?);let bytes=fs::read(root.join("submissions").join(format!("{prompt_id}.json"))).map_err(|e|err("workflow submit receipt",e))?;let record:Value=serde_json::from_slice(&bytes).map_err(|e|err("workflow submit receipt JSON",e))?;records.insert(prompt_id.into(),record);}
 let record=records.get(prompt_id).ok_or("workflow_submit_receipt_missing")?;if record["baseUrl"]!=*base||history.get(prompt_id).and_then(|v|v.pointer("/prompt/2"))!=Some(&record["submittedGraph"]){return Err("workflow_history_graph_or_endpoint_mismatch".into());}
 let mut provenance=record["provenance"].clone();provenance["promptId"]=json!(prompt_id);
 let destination=json!({"baseDirectory":request.base_directory,"projectName":request.project_name,"assetType":request.asset_type,"ownerName":request.owner_name,"stem":request.stem,"kind":request.kind});
 if request.provenance.as_ref()!=Some(&provenance)||destination!=record["destination"]||json!(request.output_node_ids)!=record.pointer("/manifest/selection/outputNodeIds").cloned().unwrap_or(Value::Null){return Err("workflow_collection_target_or_provenance_mismatch".into());}Ok(())}

#[cfg(test)]mod tests {
 use super::*;
 #[test]fn native_admission_requires_verified_server_identity(){
  let request:AdmissionRequest=serde_json::from_value(json!({"baseUrl":"http://127.0.0.1:8190","workflowPath":"unused","expectedWorkflowSha256":GRAPH_SHA,"bindings":[],"manifest":{},"manifestJson":"{}","provenance":{},"destination":{}})).unwrap();
  for owned in [json!({"identityContractVersion":2,"managerPid":std::process::id(),"serverPid":null}),json!({"identityContractVersion":2,"managerPid":0,"serverPid":200}),json!({"identityContractVersion":1,"managerPid":std::process::id(),"serverPid":200})]{
   assert_eq!(check(&request,&owned).unwrap_err(),"owned_backend_identity_not_ready");
  }
 }
 #[test]fn untrusted_project_grants_are_not_adopted(){let dir=tempfile::tempdir().unwrap();let path=dir.path().join("app-settings.json");fs::write(&path,r#"{"entries":{}}"#).unwrap();assert!(trusted_grants(&path,&json!({"projectId":"p","weightAuthorizations":[]})).is_err());}
 #[test]fn collector_rejects_another_destination_provenance_or_output_node(){
  let root=tempfile::tempdir().unwrap();let prompt_id=format!("cpu-{}",uuid::Uuid::new_v4());
  let provenance=json!({"workflowSha256":GRAPH_SHA,"projectId":"cpu-project","prompt":"CPU-only"});
  let destination=json!({"baseDirectory":"C:/cpu-only","projectName":"BGM","assetType":"bgm-track","ownerName":"CPU","stem":"CPU","kind":"audio"});
  record_submission(&prompt_id,json!({"baseUrl":"http://127.0.0.1:8190","workRoot":root.path(),"provenance":provenance,"manifest":{"selection":{"outputNodeIds":["9"]}},"destination":destination}),json!({"cpu":"graph"})).unwrap();
  let mut collected=provenance;collected["promptId"]=json!(prompt_id);
  let mut request:crate::comfy_generation::CollectRequest=serde_json::from_value(json!({"baseUrl":"http://127.0.0.1:8190","promptId":prompt_id,"baseDirectory":"C:/cpu-only","projectName":"BGM","assetType":"bgm-track","ownerName":"CPU","stem":"CPU","kind":"audio","outputNodeIds":["9"],"provenance":collected})).unwrap();
  let history=json!({prompt_id.clone():{"prompt":[0,prompt_id.clone(),{"cpu":"graph"}]}});
  assert!(verify_submission(&request,&history).is_ok());
  request.output_node_ids=vec!["other".into()];assert!(verify_submission(&request,&history).is_err());request.output_node_ids=vec!["9".into()];
  request.owner_name="other-project".into();assert!(verify_submission(&request,&history).is_err());request.owner_name="CPU".into();
  request.provenance.as_mut().unwrap()["prompt"]=json!("modified claim");assert!(verify_submission(&request,&history).is_err());
 }
 #[test]fn collector_requires_the_actual_submitted_graph(){
  let root=tempfile::tempdir().unwrap();let id=format!("cpu-{}",uuid::Uuid::new_v4());
  record_submission(&id,json!({"baseUrl":"http://127.0.0.1:8190","workRoot":root.path()}),json!({"original":true})).unwrap();
  let request:crate::comfy_generation::CollectRequest=serde_json::from_value(json!({"baseUrl":"http://127.0.0.1:8190","promptId":id,"baseDirectory":"C:/cpu-only","projectName":"BGM","assetType":"bgm-track","ownerName":"CPU","stem":"CPU","kind":"audio"})).unwrap();
  assert!(verify_submission(&request,&json!({id:{"prompt":[0,"id",{"other":true}]}})).unwrap_err().contains("history_graph"));
 }
}
