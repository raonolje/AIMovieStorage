//! 검토된 preset별로 제출 증거를 고정하여 다른 그래프·환경·등록 대상으로 바뀌지 않게 합니다.
use std::{collections::HashMap,fs,io::{Read,Write},path::PathBuf,sync::{Mutex,OnceLock},time::{Duration,Instant}};
use serde::Deserialize;
use serde_json::{json,Value};
use tauri::Manager;
use crate::comfy_reviewed_registry::{self,ReviewedRegistry};
use crate::{Res,err,comfy_generation::{InputBinding,SubmitRequest},comfy_preset_policy::{self as policy,ReviewedPreset}};

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AdmissionRequest {pub base_url:String,pub workflow_path:String,pub expected_workflow_sha256:String,pub bindings:Vec<InputBinding>,pub manifest:Value,pub manifest_json:String,pub provenance:Value,pub destination:Value}
struct Admission {request:AdmissionRequest,receipt:Value,created:Instant,trusted_path:PathBuf}
static ADMISSIONS:OnceLock<Mutex<HashMap<String,Admission>>>=OnceLock::new();
fn admissions()->&'static Mutex<HashMap<String,Admission>> { ADMISSIONS.get_or_init(||Mutex::new(HashMap::new())) }
static SUBMISSIONS:OnceLock<Mutex<HashMap<String,Value>>>=OnceLock::new();
fn submissions()->&'static Mutex<HashMap<String,Value>> { SUBMISSIONS.get_or_init(||Mutex::new(HashMap::new())) }

fn trusted_grants(path:&PathBuf,preset:&ReviewedPreset,manifest:&Value)->Res<()> {
    let settings:Value=serde_json::from_slice(&fs::read(path).map_err(|e|err("workflow_project_authorization_store",e))?).map_err(|e|err("workflow authorization record",e))?;
    let trusted=settings.pointer("/entries/workflow-project-authorizations/value").and_then(Value::as_array).ok_or("workflow_project_authorization_missing")?;
    policy::validate_trusted_grants(preset,manifest,trusted)
}
fn graph_bytes(path:&str)->Res<Vec<u8>> {
    let mut bytes=Vec::new();
    fs::File::open(path).map_err(|e|err("workflow admission graph",e))?.take(8*1024*1024+1).read_to_end(&mut bytes).map_err(|e|err("workflow admission graph",e))?;
    if bytes.len()>8*1024*1024 {return Err("workflow_native_graph_size_limit".into());}Ok(bytes)
}
fn checked_preset_against_registry(request:&AdmissionRequest,owned:&Value,registry:&ReviewedRegistry)->Res<ReviewedPreset> {
    if owned["identityContractVersion"]!=2 || owned["serverPid"].as_u64().is_none_or(|pid|pid==0) || owned["managerPid"]!=std::process::id() { return Err("owned_backend_identity_not_ready".into()); }
    if ![Some(1),Some(2)].contains(&request.manifest["schemaVersion"].as_u64()) {
        return Err("workflow_native_contract_version_unsupported".into());
    }
    let preset=registry.resolve(&request.expected_workflow_sha256)?;
    if owned["registrySha256"]!=registry.digest()? || !owned["reviewedPresetIds"].as_array().is_some_and(|ids|ids.iter().any(|id|*id==preset.id)) {return Err("workflow_native_backend_registry_or_preset_changed".into());}
    let ids=serde_json::from_value::<Vec<String>>(owned["reviewedPresetIds"].clone()).map_err(|_|"workflow_native_backend_registry_or_preset_changed")?;
    let plan=registry.backend_plan(&ids)?;
    if owned["review"]!=plan.review {return Err("workflow_native_backend_review_changed".into());}
    Ok(preset)
}
fn checked_preset(request:&AdmissionRequest,owned:&Value)->Res<ReviewedPreset>{checked_preset_against_registry(request,owned,&comfy_reviewed_registry::packaged()?)}

#[cfg(test)]
fn check(request:&AdmissionRequest,owned:&Value)->Res<Value> {let preset=checked_preset(request,owned)?;policy::validate_preset(&preset,request,&graph_bytes(&request.workflow_path)?,owned,&[])}
fn check_with_store_against_registry(request:&AdmissionRequest,owned:&Value,settings_path:&std::path::Path,registry:&ReviewedRegistry)->Res<(Value,Vec<Value>)>{
    let preset=checked_preset_against_registry(request,owned,registry)?;
    let data_dir=settings_path.parent().ok_or("workflow_registered_library_store_missing")?;
    let facts=crate::comfy_registered_assets::for_request(data_dir,request,&preset)?;
    let mut receipt=policy::validate_preset(&preset,request,&graph_bytes(&request.workflow_path)?,owned,&facts)?;receipt["registrySha256"]=json!(registry.digest()?);receipt["registryRevision"]=json!(registry.revision);
    Ok((receipt,facts))
}

#[tauri::command]
pub async fn comfy_admit_generation(app:tauri::AppHandle,request:AdmissionRequest)->Res<Value> {
    let path=app.path().app_data_dir().map_err(|e|err("workflow authorization folder",e))?.join("app-settings.json");
    admit_with_store(path,request).await
}
pub(crate) async fn admit_with_store(path:PathBuf,request:AdmissionRequest)->Res<Value> {
    if crate::comfy_owned_backend::comfy_owned_backend_status().await?["state"]!="ready" { return Err("owned_backend_identity_not_ready".into()); }
    let owned=crate::comfy_owned_backend::owned_record(&request.base_url)?.ok_or("workflow_loaded_source_attestation_required: 앱 소유 검증 backend를 선택하세요.")?;
    admit_against_ready_backend(path,request,&owned,&comfy_reviewed_registry::packaged()?)
}
fn admit_against_ready_backend(path:PathBuf,request:AdmissionRequest,owned:&Value,registry:&ReviewedRegistry)->Res<Value>{
    let (receipt,_)=check_with_store_against_registry(&request,owned,&path,registry)?;
    trusted_grants(&path,&registry.resolve(&request.expected_workflow_sha256)?,&request.manifest)?;
    let token=uuid::Uuid::new_v4().to_string();
    let mut records=admissions().lock().map_err(|_|"workflow admission lock")?;
    records.retain(|_,v|v.created.elapsed()<Duration::from_secs(120));
    records.insert(token.clone(),Admission{request,receipt:receipt.clone(),created:Instant::now(),trusted_path:path});
    Ok(json!({"admissionToken":token,"scope":"reviewed-preset-exact-graph-source-schema-weights-project-variant","receipt":receipt,"actualGeneration":"not-run"}))
}

/// 대기 취소는 아직 제출하지 않은 이 토큰만 폐기합니다. 서버 작업·프로세스는 종료하지 않습니다.
#[tauri::command]
pub fn comfy_revoke_generation_admission(admission_token:String)->Res<Value> {
    let revoked=admissions().lock().map_err(|_|"workflow admission lock")?.remove(&admission_token).is_some();
    Ok(json!({"revoked":revoked,"serverJobCancelled":false}))
}
fn take_admission(request:&SubmitRequest)->Res<Admission> {
    let token=request.admission_token.as_ref().ok_or("workflow_native_admission_required")?;
    let record=admissions().lock().map_err(|_|"workflow admission lock")?.remove(token).ok_or("workflow_native_admission_expired_or_used")?;
    if record.created.elapsed()>Duration::from_secs(120) || record.request.base_url!=request.base_url || record.request.workflow_path!=request.workflow_path || record.request.expected_workflow_sha256!=request.expected_workflow_sha256 || serde_json::to_value(&record.request.bindings).map_err(|e|err("workflow bindings",e))?!=serde_json::to_value(&request.bindings).map_err(|e|err("workflow bindings",e))? {
        return Err("workflow_native_admission_request_changed".into());
    }
    if record.request.provenance["clientId"]!=request.client_id { return Err("workflow_native_client_changed".into()); }
    Ok(record)
}
pub async fn consume(request:&SubmitRequest)->Res<Value> {
    let record=take_admission(request)?;
    if crate::comfy_owned_backend::comfy_owned_backend_status().await?["state"]!="ready" { return Err("owned_backend_identity_not_ready".into()); }
    let owned=crate::comfy_owned_backend::owned_record(&request.base_url)?.ok_or("workflow_loaded_source_attestation_required")?;
    consume_against_ready_backend(request,record,&owned,&comfy_reviewed_registry::packaged()?)
}
fn consume_against_ready_backend(request:&SubmitRequest,record:Admission,owned:&Value,registry:&ReviewedRegistry)->Res<Value>{
    let (fresh,facts)=check_with_store_against_registry(&record.request,owned,&record.trusted_path,registry)?;
    if fresh!=record.receipt { return Err("workflow_native_admission_environment_changed".into()); }
    trusted_grants(&record.trusted_path,&registry.resolve(&request.expected_workflow_sha256)?,&record.request.manifest)?;
    Ok(json!({"baseUrl":request.base_url,"provenance":record.request.provenance,"manifest":record.request.manifest,"manifestJson":record.request.manifest_json,"bindings":record.request.bindings,"destination":record.request.destination,"admission":fresh,"nativeReferenceFacts":facts,"workRoot":owned["workRoot"]}))
}

fn valid_prompt_id(id:&str)->Res<()> {
    if id.is_empty() || id.len()>200 || !id.chars().all(|c|c.is_ascii_alphanumeric() || c=='-' || c=='_') { return Err("workflow_native_prompt_id_invalid".into()); }
    Ok(())
}
fn receipt_digest(record:&Value)->Res<String> {
    let mut plain=record.clone();plain.as_object_mut().ok_or("workflow_submit_receipt_invalid")?.remove("receiptSha256");
    policy::value_sha(&plain)
}
fn validate_record_against_registry(record:&Value,registry:&ReviewedRegistry)->Res<ReviewedPreset> {
    if record["admission"]["registrySha256"]!=registry.digest()? || record["admission"]["registryRevision"]!=registry.revision {return Err("workflow_submit_receipt_registry_changed".into());}
    let preset=registry.resolve(record["admission"]["workflowSha256"].as_str().ok_or("workflow_submit_receipt_review_missing")?)?;
    validate_record_for_preset(record,&preset)?;Ok(preset)
}
fn validate_record_for_preset(record:&Value,preset:&ReviewedPreset)->Res<()> {
    let facts=record.get("nativeReferenceFacts").cloned().unwrap_or(json!([]));
    if facts.as_array().map(Vec::len)!=Some(preset.fixed_reference_count) || record["admission"]["referenceFactsSha256"]!=policy::value_sha(&facts)? {return Err("workflow_submit_receipt_native_reference_facts_changed".into());}
    let version=record["manifest"]["schemaVersion"].as_u64().ok_or("workflow_submit_receipt_contract_version_missing")?;
    if ![1,2].contains(&version) || record["admission"]["contractVersion"]!=version || record["admission"]["contract"]["contractVersion"]!=version {return Err("workflow_submit_receipt_contract_version_mismatch".into());}
    if version==2 && (record["admission"]["contract"]["selectionEnvelopeSha256"]!=policy::value_sha(&record["manifest"]["selectionEnvelope"])? || record["admission"]["contract"]["extensionsSha256"]!=record["manifest"]["extensionsSha256"] || record["admission"]["contract"]["rawNodeRequirementsSha256"]!=policy::value_sha(&record["manifest"]["rawNodeRequirements"])?) {return Err("workflow_submit_receipt_v2_contract_changed".into());}
    for (field,record_field) in [("bindingsSha256","bindings"),("provenanceSha256","provenance"),("destinationSha256","destination")] {
        if record["admission"][field]!=policy::value_sha(&record[record_field])? {return Err("workflow_submit_receipt_admitted_request_changed".into());}
    }
    let policy_sha=policy::value_sha(&serde_json::to_value(preset).map_err(|e|err("workflow receipt policy",e))?)?;
    let manifest_json=record["manifestJson"].as_str().ok_or("workflow_submit_manifest_missing")?;
    if record["admission"]["policySha256"]!=policy_sha || record["admission"]["reviewRevision"]!=preset.review_revision || record["admission"]["presetId"]!=preset.id || record["admission"]["manifestSha256"]!=policy::sha(manifest_json.as_bytes()) || record["provenance"]["manifestSha256"]!=record["admission"]["manifestSha256"] || serde_json::from_str::<Value>(manifest_json).map_err(|e|err("workflow receipt manifest",e))?!=record["manifest"] {
        return Err("workflow_submit_receipt_review_mismatch".into());
    }
    if record["manifest"]["workflowSha256"]!=preset.graph_sha256 || record["admission"]["promptTarget"]!=record["manifest"]["promptTarget"] || record["provenance"]["promptTarget"]!=record["manifest"]["promptTarget"] || record["admission"]["projectId"]!=record["manifest"]["projectId"] || record["admission"]["authorizationSha256"]!=policy::value_sha(&record["manifest"]["weightAuthorizations"])? {
        return Err("workflow_submit_receipt_provenance_mismatch".into());
    }
    if record["destination"]["kind"]!=preset.output_kind || record["admission"]["outputKind"]!=preset.output_kind || record["destination"]["assetType"]!=record["admission"]["registrationKind"] || !preset.registration_kinds.iter().any(|kind|record["destination"]["assetType"]==*kind) {
        return Err("workflow_submit_receipt_registration_kind_mismatch".into());
    }
    policy::validate_submitted_graph(&preset,&record["bindings"],&record["submittedGraph"])?;
    Ok(())
}
pub fn record_submission(prompt_id:&str,record:Value,graph:Value)->Res<()>{record_submission_against_registry(prompt_id,record,graph,&comfy_reviewed_registry::packaged()?)}
fn record_submission_against_registry(prompt_id:&str,mut record:Value,graph:Value,registry:&ReviewedRegistry)->Res<()> {
    valid_prompt_id(prompt_id)?;
    record["submittedGraph"]=graph;record["promptId"]=json!(prompt_id);
    validate_record_against_registry(&record,registry)?;
    record["receiptSha256"]=json!(receipt_digest(&record)?);
    let root=PathBuf::from(record["workRoot"].as_str().ok_or("workflow submission root")?).join("submissions");
    fs::create_dir_all(&root).map_err(|e|err("workflow receipt folder",e))?;
    let path=root.join(format!("{prompt_id}.json"));
    let bytes=serde_json::to_vec_pretty(&record).map_err(|e|err("workflow receipt JSON",e))?;
    if path.exists() {
        if fs::read(&path).map_err(|e|err("workflow receipt read",e))?!=bytes { return Err("workflow_submit_receipt_existing_conflict".into()); }
    } else {
        let mut temp=tempfile::NamedTempFile::new_in(&root).map_err(|e|err("workflow receipt temporary",e))?;
        temp.write_all(&bytes).map_err(|e|err("workflow receipt write",e))?;
        temp.as_file().sync_all().map_err(|e|err("workflow receipt sync",e))?;
        temp.persist_noclobber(&path).map_err(|e|err("workflow receipt commit",e.error))?;
    }
    let mut records=submissions().lock().map_err(|_|"workflow receipt lock")?;
    if records.get(prompt_id).is_some_and(|previous|previous!=&record) { return Err("workflow_submit_receipt_existing_conflict".into()); }
    records.insert(prompt_id.into(),record);Ok(())
}
pub(crate) fn verify_submission_record(record:&Value,request:&crate::comfy_generation::CollectRequest,history:&Value)->Res<()> {
    verify_submission_record_against_registry(record,request,history,&comfy_reviewed_registry::packaged()?)
}
fn verify_submission_record_against_registry(record:&Value,request:&crate::comfy_generation::CollectRequest,history:&Value,registry:&ReviewedRegistry)->Res<()> {
    let preset=validate_record_against_registry(record,registry)?;
    verify_submission_record_for_preset(record,request,history,&preset)
}
fn verify_submission_record_for_preset(record:&Value,request:&crate::comfy_generation::CollectRequest,history:&Value,preset:&ReviewedPreset)->Res<()> {
    valid_prompt_id(&request.prompt_id)?;
    if record["receiptSha256"]!=receipt_digest(record)? { return Err("workflow_submit_receipt_digest_mismatch".into()); }
    validate_record_for_preset(record,preset)?;
    if record["promptId"]!=request.prompt_id || record["baseUrl"]!=request.base_url || history.get(&request.prompt_id).and_then(|v|v.pointer("/prompt/2"))!=Some(&record["submittedGraph"]) { return Err("workflow_history_graph_or_endpoint_mismatch".into()); }
    let mut provenance=record["provenance"].clone();provenance["promptId"]=json!(request.prompt_id);
    let destination=json!({"baseDirectory":request.base_directory,"projectName":request.project_name,"assetType":request.asset_type,"ownerName":request.owner_name,"stem":request.stem,"kind":request.kind});
    if request.provenance.as_ref()!=Some(&provenance) || destination!=record["destination"] || json!(request.output_node_ids)!=record.pointer("/manifest/selection/outputNodeIds").cloned().unwrap_or(Value::Null) { return Err("workflow_collection_target_or_provenance_mismatch".into()); }
    Ok(())
}
pub fn verify_submission(request:&crate::comfy_generation::CollectRequest,history:&Value)->Res<()> {
    valid_prompt_id(&request.prompt_id)?;
    let owned=crate::comfy_owned_backend::owned_record(&request.base_url)?.ok_or("workflow_loaded_source_attestation_required")?;
    let mut records=submissions().lock().map_err(|_|"workflow receipt lock")?;
    if !records.contains_key(&request.prompt_id) {
        let root=PathBuf::from(owned["workRoot"].as_str().ok_or("workflow submit root")?);
        let mut bytes=Vec::new();fs::File::open(root.join("submissions").join(format!("{}.json",request.prompt_id))).map_err(|e|err("workflow submit receipt",e))?.take(16*1024*1024+1).read_to_end(&mut bytes).map_err(|e|err("workflow submit receipt",e))?;
        if bytes.len()>16*1024*1024 { return Err("workflow_submit_receipt_size_limit".into()); }
        let record:Value=serde_json::from_slice(&bytes).map_err(|e|err("workflow submit receipt JSON",e))?;
        verify_submission_record(&record,request,history)?;
        records.insert(request.prompt_id.clone(),record);
    }
    let record=records.get(&request.prompt_id).ok_or("workflow_submit_receipt_missing")?;
    let identity=policy::source_identity(&owned);
    if record["admission"]["sourceIdentitySha256"]!=policy::value_sha(&identity)? { return Err("workflow_collection_loaded_source_identity_changed".into()); }
    verify_submission_record(record,request,history)
}

#[cfg(test)]
#[path="comfy_admission_tests.rs"]
mod tests;
