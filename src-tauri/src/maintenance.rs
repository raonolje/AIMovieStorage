use tauri::{AppHandle, Emitter, Manager};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
static SAFE_EXIT: AtomicBool = AtomicBool::new(false);
static CLOSING: AtomicBool = AtomicBool::new(false);
pub(crate) fn closing() -> bool { CLOSING.load(Ordering::SeqCst) }
pub(crate) fn safe_exit() -> bool { SAFE_EXIT.load(Ordering::SeqCst) }
fn blockers(app: &AppHandle) -> Vec<String> {
    let mut result = crate::upscale::maintenance_blockers(app);
    if crate::asset_upload::maintenance_pending(&app.state::<crate::asset_upload::AssetUploads>()) != 0 { result.push("파일 전송이 완료되지 않았습니다.".into()); }
    if crate::native_a2v::maintenance_busy() { result.push("네이티브 영상 작업이 실행 중입니다.".into()); }
    result
}
#[tauri::command]
pub fn maintenance_status(app: AppHandle) -> Value { json!({"blockers": blockers(&app),"workBlockers":work_blockers(&app),"workerShutdown":crate::upscale::graceful_worker_status(&app), "otherInstanceClosureVerified":false}) }
pub(crate) fn work_blockers(app: &AppHandle) -> Vec<String> {
    let mut result=crate::upscale::maintenance_work_blockers(app);
    if crate::asset_upload::maintenance_pending(&app.state::<crate::asset_upload::AssetUploads>())!=0 { result.push("파일 전송이 완료되지 않았습니다.".into()); }
    if crate::native_a2v::maintenance_busy() { result.push("네이티브 영상 작업이 실행 중입니다.".into()); }
    result
}
#[tauri::command]
pub fn maintenance_worker_status(app: AppHandle) -> Value { crate::upscale::graceful_worker_status(&app) }
#[tauri::command]
pub fn maintenance_cancel_idle_workers(app: AppHandle, operation_id: String) -> Result<Value,String> {
    uuid::Uuid::parse_str(&operation_id).map_err(|_|"정상 종료 요청 번호를 확인할 수 없습니다.")?;
    Ok(json!({"cancelRequested":crate::upscale::cancel_graceful_worker_shutdown(&app,&operation_id),"forcedTermination":false}))
}
#[tauri::command]
pub async fn maintenance_release_idle_workers(app: AppHandle, operation_id: String) -> Result<Value,String> {
    uuid::Uuid::parse_str(&operation_id).map_err(|_|"정상 종료 요청 번호를 확인할 수 없습니다.")?;
    let busy=work_blockers(&app);if !busy.is_empty() { return Err(busy.join("; ")); }
    tauri::async_runtime::spawn_blocking(move||crate::upscale::release_idle_workers(&app,&operation_id)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn maintenance_request_quit(app: AppHandle) -> Result<(), String> {
    let busy = blockers(&app);
    if !busy.is_empty() { return Err(busy.join("; ")); }
    // 조종기 응답이 전달되기 전에 앱을 닫지 않습니다. 지연되면 종료 자체를 취소합니다.
    if CLOSING.swap(true, Ordering::SeqCst) { return Err("종료 요청이 이미 처리 중입니다.".into()); }
    tauri::async_runtime::spawn(async move {
        for _ in 0..100 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if crate::control::maintenance_pending(&app) == 0 {
                if blockers(&app).is_empty() {
                    if crate::control::publish_normal_shutdown(&app).is_ok() { SAFE_EXIT.store(true, Ordering::SeqCst); app.exit(0); }
                    else { CLOSING.store(false, Ordering::SeqCst); let _ = app.emit("maintenance-quit-cancelled", ()); }
                }
                else { CLOSING.store(false, Ordering::SeqCst); let _ = app.emit("maintenance-quit-cancelled", ()); }
                return;
            }
        }
        CLOSING.store(false, Ordering::SeqCst);
        let _ = app.emit("maintenance-quit-cancelled", ());
    });
    Ok(())
}

#[tauri::command]
pub async fn maintenance_comfy_queue(base_url: String) -> Result<Value, String> {
    let target = local_queue_url(&base_url)?;
    let response = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(5)).build().map_err(|_| "큐 조회를 준비하지 못했습니다.")?.get(target).send().await.map_err(|_| "ComfyUI 전체 큐를 확인하지 못했습니다.")?;
    if !response.status().is_success() { return Err("ComfyUI 큐 응답이 실패했습니다.".into()); }
    let body = response.bytes().await.map_err(|_| "ComfyUI 큐를 읽지 못했습니다.")?;
    queue_counts(&body)
}
fn local_queue_url(base_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(base_url).map_err(|_| "ComfyUI 주소를 확인할 수 없습니다.")?;
    if url.scheme() != "http" || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1")) || !url.username().is_empty() || url.password().is_some() { return Err("유지보수 조회는 기존 PC 로컬 ComfyUI만 지원합니다.".into()); }
    url.join("/queue").map_err(|_| "ComfyUI 큐 주소가 올바르지 않습니다.".into())
}
fn queue_counts(body: &[u8]) -> Result<Value, String> {
    if body.len() > 65536 { return Err("ComfyUI 큐 응답이 너무 큽니다.".into()); }
    let value: Value = serde_json::from_slice(&body).map_err(|_| "ComfyUI 큐 형식이 올바르지 않습니다.")?;
    let running = value["queue_running"].as_array().ok_or("ComfyUI 실행 큐를 확인하지 못했습니다.")?.len();
    let waiting = value["queue_pending"].as_array().ok_or("ComfyUI 대기 큐를 확인하지 못했습니다.")?.len();
    Ok(json!({"running":running,"waiting":waiting}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn remote_queue_and_credentials_are_rejected() { for url in ["https://127.0.0.1:8188", "http://example.com", "http://user:password@localhost:8188"] { assert!(local_queue_url(url).is_err()); } }
    #[test] fn only_loopback_queue_path_is_used() { assert_eq!(local_queue_url("http://127.0.0.1:8188/old").unwrap().as_str(), "http://127.0.0.1:8188/queue"); }
    #[test] fn absent_or_wrong_queue_fields_fail_closed() { for body in [br#"{}"#.as_slice(),br#"{"queue_running":[],"queue_pending":0}"#.as_slice()] { assert!(queue_counts(body).is_err()); } }
    #[test] fn both_running_and_waiting_are_counted() { assert_eq!(queue_counts(br#"{"queue_running":[1,2],"queue_pending":[3]}"#).unwrap(),json!({"running":2,"waiting":1})); }
    #[test] fn oversized_queue_is_rejected() { assert!(queue_counts(&vec![b' ';65537]).is_err()); }
}
