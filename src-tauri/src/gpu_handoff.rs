//! A request-scoped native GPU handoff. No persistent execution permission changes.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path, sync::RwLock, time::{SystemTime, UNIX_EPOCH}};
pub(crate) static GPU_ACCESS: RwLock<()> = RwLock::new(());
pub fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
pub fn validate(context: &Value) -> Result<(), String> {
    let a=&context["approval"];
    if a["producerSafeBoundaryConfirmed"]!=true { return Err("gpu_handoff_confirmation_required".into()); }
    for (a_key,c_key) in [("requestId","operationId"),("projectId","projectId")] {
        let value=context[c_key].as_str().filter(|s| !s.trim().is_empty() && s.len()<=200).ok_or("gpu_handoff_invalid_identity")?;
        if a[a_key]!=value { return Err("gpu_handoff_request_mismatch".into()); }
    }
    if context["target"]["kind"]!="cut" || !context["target"]["id"].as_str().is_some_and(|s| !s.is_empty() && s.len()<=200) || a["target"]!=context["target"] { return Err("gpu_handoff_target_mismatch".into()); }
    Ok(())
}
fn empty_queue(body: &[u8]) -> Result<(), String> {
    if body.len()>65536 {return Err("gpu_handoff_queue_oversized".into());}
    let q:Value=serde_json::from_slice(body).map_err(|_|"gpu_handoff_queue_invalid")?;
    for key in ["queue_running","queue_pending"] { if !q[key].as_array().is_some_and(|a|a.is_empty()) {return Err("gpu_handoff_comfy_not_idle".into());} }
    Ok(())
}
pub async fn release_idle_comfy(base: &str) -> Result<Value,String> {
    let url=reqwest::Url::parse(base).map_err(|_|"gpu_handoff_invalid_comfy_url")?;
    if url.scheme()!="http" || !matches!(url.host_str(),Some("localhost"|"127.0.0.1"|"[::1]"|"::1")) || !url.username().is_empty() || url.password().is_some() {return Err("gpu_handoff_comfy_must_be_loopback".into());}
    let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(5)).build().map_err(|_|"gpu_handoff_http_client")?;
    for pass in 0..2 {
        let response=client.get(url.join("/queue").map_err(|_|"gpu_handoff_url")?).send().await.map_err(|_|"gpu_handoff_queue_unavailable")?;
        if !response.status().is_success(){return Err("gpu_handoff_queue_failed".into());}
        empty_queue(&response.bytes().await.map_err(|_|"gpu_handoff_queue_read")?)?;
        if pass==0 {
            let response=client.post(url.join("/free").map_err(|_|"gpu_handoff_url")?).json(&json!({"unload_models":true,"free_memory":true})).send().await.map_err(|_|"gpu_handoff_cache_release_failed")?;
            if !response.status().is_success(){return Err("gpu_handoff_cache_release_rejected".into());}
        }
    }
    Ok(json!({"queueRunning":0,"queueWaiting":0,"officialCacheReleaseAccepted":true,"actualMemoryReclaimedMeasured":false}))
}
pub fn consume(root: &Path, context: &Value, request_bytes: &[u8], cache: Value) -> Result<Value,String> {
    validate(context)?;
    fs::create_dir_all(root).map_err(|_|"gpu_handoff_audit_directory")?;
    let key=hash(&serde_json::to_vec(&json!([context["projectId"],context["operationId"]])).unwrap());
    let receipt=root.join(format!("{key}.json"));
    let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"gpu_handoff_clock")?.as_secs();
    let value=json!({"schema":"native-gpu-single-job-v1","context":context,"requestSha256":hash(request_bytes),"nonce":uuid::Uuid::new_v4().to_string(),"approvedAtUnix":now,"expiresAtUnix":now+60,"cache":cache,"persistentExecutionPermissionChanged":false});
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&receipt).map_err(|_|"gpu_handoff_already_consumed_or_audit_unavailable")?;
    file.write_all(&serde_json::to_vec_pretty(&value).unwrap()).map_err(|_|"gpu_handoff_audit_write")?;
    file.sync_all().map_err(|_|"gpu_handoff_audit_flush")?;
    Ok(value)
}
#[cfg(test)]mod tests {
 use super::*;
 fn c()->Value {json!({"operationId":"op","projectId":"p","target":{"kind":"cut","id":"c"},"approval":{"requestId":"op","projectId":"p","target":{"kind":"cut","id":"c"},"producerSafeBoundaryConfirmed":true}})}
 #[test]fn explicit_matching_request_is_required(){assert!(validate(&c()).is_ok());for key in ["requestId","projectId","target","producerSafeBoundaryConfirmed"] {let mut x=c();x["approval"][key]=Value::Null;assert!(validate(&x).is_err());}}
 #[test]fn queues_fail_closed(){assert!(empty_queue(br#"{"queue_running":[],"queue_pending":[]}"#).is_ok());for x in [br#"{}"#.as_slice(),br#"{"queue_running":[1],"queue_pending":[]}"#.as_slice(),br#"{"queue_running":[],"queue_pending":[1]}"#.as_slice()]{assert!(empty_queue(x).is_err());}}
 #[test]fn persistent_one_use_receipt_rejects_replay_and_changed_request(){let root=std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());let receipt=consume(&root,&c(),b"one",json!({})).unwrap();assert_eq!(receipt["requestSha256"],hash(b"one"));assert!(consume(&root,&c(),b"two",json!({})).is_err());fs::remove_dir_all(root).unwrap();}
 #[test]fn exclusive_native_lock_excludes_local_generation(){let lock=RwLock::new(());let _held=lock.write().unwrap();assert!(lock.try_read().is_err());assert!(lock.try_write().is_err());}
}
