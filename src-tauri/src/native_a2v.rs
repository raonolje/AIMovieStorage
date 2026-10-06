//! 원음 조건 실험 경로는 기존 상주 LTX 환경을 바꾸지 않고 격리 프로세스로만 실행합니다.
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}, sync::Mutex, time::Instant};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use crate::{err, Res};
use crate::upscale::GenerateResult;

static RUN: Mutex<()> = Mutex::new(());
const WORKER: &str = include_str!("../resources/native_a2v/a2v_worker.py");
const ADAPTER: &str = include_str!("../resources/native_a2v/a2v_adapter.py");
const GPU_HANDOFF: &str = include_str!("../resources/native_a2v/gpu_handoff.py");
const MEMORY_BUDGET: &str = include_str!("../resources/native_a2v/memory_budget.py");

fn manifest_path(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| err("앱 데이터 경로 오류", e))?
        .join("local/engines/ltx25/native-a2v/environment-manifest.json"))
}
fn load_manifest(path: &Path) -> Res<Value> {
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| err("native_not_ready: 격리 환경 설정이 없습니다", e))?)
        .map_err(|e| err("native_not_ready: 격리 환경 설정 오류", e))
}
fn hidden(command: &mut Command) {
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    #[cfg(not(windows))] let _ = command;
}
fn python(manifest: &Value) -> Res<Command> {
    let executable = manifest["isolated_python"].as_str().ok_or("native_not_ready: isolated_python")?;
    if !Path::new(executable).is_file() { return Err("native_not_ready: 격리 Python이 없습니다".into()); }
    let mut cmd = Command::new(executable);
    hidden(&mut cmd);
    cmd.env("HF_HUB_OFFLINE", "1").env("TRANSFORMERS_OFFLINE", "1").stdin(Stdio::null());
    Ok(cmd)
}

fn blockers(manifest: &Value) -> Vec<String> {
    let mut result = Vec::new();
    if manifest["native_weight_contract_verified"] != true { result.push("native_cpu_contract_not_verified".into()); }
    if manifest["gpu_execution_authorized"] != true { result.push("separate_gpu_handoff_required".into()); }
    for key in ["isolated_python", "transformer", "text_encoder", "embeddings_projection", "audio_vae", "video_vae", "spatial_upsampler", "distilled_lora", "ffmpeg"] {
        if !manifest[key].as_str().is_some_and(|p| Path::new(p).exists()) { result.push(format!("missing_resource:{key}")); }
    }
    result
}

#[tauri::command]
pub fn native_a2v_status(app: AppHandle) -> Res<Value> {
    let manifest = match load_manifest(&manifest_path(&app)?) {
        Ok(value) => value,
        Err(_) => return Ok(json!({"ready":false,"blockers":["managed_native_environment_not_configured"],"experimental":true,"gpuQaCompleted":false,"lipSyncVerified":false})),
    };
    let errors = blockers(&manifest);
    Ok(json!({"ready":errors.is_empty(),"blockers":errors,"experimental":true,
        "gpuQaCompleted":manifest["native_gpu_qa_completed"] == true,"lipSyncVerified":false,
        "requestScopedGpuHandoffSupported":true,"gpuHandoffScope":"one explicit media_generate request; persistent execution permission unchanged",
        "offloadModes":["cpu","disk"],"defaultOffloadMode":"cpu","diskMode":"installed official block streaming; smaller host cache; measured QA still required",
        "audioSupport":"stereo PCM16 WAV; nearest-sample offset, EOF clamp; conditioning zero-padded to 8n+1 frames; original selected samples in ALAC master",
        "cancellation":"cooperative queue stop waits for isolated process completion; no force termination"}))
}

fn worker_request(opts: &Value) -> Res<Value> {
    let obj = opts.as_object().ok_or("invalid_request: native options")?;
    let allowed = ["ltx_a2v", "audio_path", "audio_start_seconds", "audio_duration_seconds", "prompt", "negative", "width", "height", "seed", "fps", "image", "end_image", "loras", "references", "control", "structure_control", "motion_mask", "ltx_a2v_offload", "local_files_only", "native_gpu_handoff"];
    for (key,value) in obj {
        if !allowed.contains(&key.as_str()) { return Err(format!("unsupported_options: {key}")); }
        if ["loras","references"].contains(&key.as_str()) && !value.is_null() && value.as_array().is_none_or(|a| !a.is_empty()) { return Err(format!("unsupported_control: {key}")); }
        if ["control","structure_control","motion_mask"].contains(&key.as_str()) && !value.is_null() { return Err(format!("unsupported_control: {key}")); }
    }
    if opts["ltx_a2v"] != "experimental" { return Err("invalid_request: 명시적인 실험 경로 선택이 필요합니다".into()); }
    let offload = opts.get("ltx_a2v_offload").and_then(Value::as_str).unwrap_or("cpu");
    if !matches!(offload,"cpu"|"disk") || opts.get("ltx_a2v_offload").is_some_and(|v| !v.is_string()) { return Err("unsupported_options: ltx_a2v_offload".into()); }
    if opts.get("local_files_only").is_some_and(|v| v != &json!(true)) { return Err("invalid_request: native_always_offline".into()); }
    let duration = opts["audio_duration_seconds"].as_f64().filter(|n| n.is_finite() && *n>0. && *n<=40.).ok_or("invalid_request: audio_duration_seconds")?;
    let start = opts.get("audio_start_seconds").unwrap_or(&Value::Null).as_f64().unwrap_or(0.);
    if opts.get("audio_start_seconds").is_some() && (!opts["audio_start_seconds"].is_number() || !start.is_finite() || start<0.) { return Err("invalid_request: audio_start_seconds".into()); }
    let mut assets = Vec::new();
    let mut inputs = json!({"engine":"ltx-a2v-native","audioAssetId":"audio","audioStartSeconds":start,"audioDurationSeconds":duration,
        "offloadMode":offload,"prompt":opts["prompt"],"negativePrompt":opts.get("negative").cloned().unwrap_or(json!(""))});
    for key in ["width","height","seed","fps"] { if let Some(value)=opts.get(key) { inputs[key]=value.clone(); } }
    for (key,id,kind,input_key) in [("audio_path","audio","audio","audioAssetId"),("image","first","image","imageAssetId"),("end_image","end","image","endImageAssetId")] {
        if let Some(value)=opts.get(key).filter(|v| !v.is_null()) {
            let p=value.as_str().ok_or("invalid_asset: 로컬 파일 경로")?;
            if p.contains("://") || !Path::new(p).is_file() { return Err(format!("invalid_asset: {key}")); }
            assets.push(json!({"id":id,"projectId":"app-native-a2v","kind":kind,"filePath":p})); inputs[input_key]=json!(id);
        } else if key=="audio_path" { return Err("invalid_asset: 원음 파일이 필요합니다".into()); }
    }
    if inputs.get("endImageAssetId").is_some() && inputs.get("imageAssetId").is_none() { return Err("invalid_request: 끝 그림에는 시작 그림이 필요합니다".into()); }
    Ok(json!({"projectId":"app-native-a2v","inputs":inputs,"ownedAssets":assets}))
}

fn parse_worker(stdout: &[u8]) -> Res<Value> {
    String::from_utf8_lossy(stdout).lines().rev().find_map(|line| serde_json::from_str::<Value>(line).ok())
        .ok_or("native_worker_protocol_error: 결과 JSON이 없습니다".into())
}

pub(crate) fn generate(app: AppHandle, output: String, opts: Value) -> Res<GenerateResult> {
    let _guard=RUN.try_lock().map_err(|_| "native_busy: 격리 A2V 작업이 실행 중입니다")?;
    let _exclusive=crate::gpu_handoff::GPU_ACCESS.try_write().map_err(|_|"gpu_handoff_gpu_busy")?;
    let started=Instant::now();
    let manifest_file=manifest_path(&app)?; let manifest=load_manifest(&manifest_file)?;
    let handoff=opts.get("native_gpu_handoff");
    if let Some(context)=handoff { crate::gpu_handoff::validate(context)?; }
    let errors:Vec<_>=blockers(&manifest).into_iter().filter(|b| !(handoff.is_some() && b=="separate_gpu_handoff_required")).collect(); if !errors.is_empty() { return Err(format!("native_not_ready: {}",errors.join(", "))); }
    let mut request=worker_request(&opts)?;
    if let Some(context)=handoff {request["gpuHandoffContext"]=context.clone();}
    let target=PathBuf::from(output);let parent=target.parent().filter(|p|p.is_dir()).ok_or("invalid_output: 결과 폴더")?;
    if target.extension().and_then(|s|s.to_str())!=Some("mp4") { return Err("invalid_output: MP4 결과가 필요합니다".into()); }
    // 예약 파일과 기존 결과를 덮지 않고 완성된 파일만 원자적으로 연결합니다.
    let stem=target.file_stem().and_then(|s|s.to_str()).unwrap_or("native-a2v");
    let dir=parent.join(format!(".{stem}.native-a2v-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    let (request_file,output_dir)=prepare_native_workspace(&dir,&request)?;
    let mut execution_manifest=manifest_file.clone();
    if let Some(context)=handoff {
        if !crate::upscale::maintenance_blockers(&app).is_empty() {return Err("gpu_handoff_local_workers_not_idle".into());}
        let base=context["comfyBaseUrl"].as_str().ok_or("gpu_handoff_missing_comfy_url")?;
        let cache=tauri::async_runtime::block_on(crate::gpu_handoff::release_idle_comfy(base))?;
        let receipt_root=manifest_file.parent().ok_or("gpu_handoff_manifest_parent")?.join("handoff-receipts");
        let grant=crate::gpu_handoff::consume(&receipt_root,context,&fs::read(&request_file).map_err(|e|err("handoff request",e))?,cache)?;
        let mut scoped=manifest.clone();scoped["single_job_gpu_handoff"]=grant;
        execution_manifest=dir.join("execution-environment.json");
        fs::write(&execution_manifest,serde_json::to_vec_pretty(&scoped).unwrap()).map_err(|e|err("handoff environment",e))?;
    }
    let mut command=python(&manifest)?;
    command.arg(dir.join("a2v_worker.py")).arg("--request").arg(request_file).arg("--environment").arg(execution_manifest).arg("--output-directory").arg(&output_dir).arg("--execute");
    let executed=command.output().map_err(|e|err("격리 A2V 실행 오류",e))?;
    fs::write(dir.join("worker-stdout.log"),&executed.stdout).map_err(|e|err("로그 저장 오류",e))?;
    fs::write(dir.join("worker-stderr.log"),&executed.stderr).map_err(|e|err("로그 저장 오류",e))?;
    let result=parse_worker(&executed.stdout)?;
    if !executed.status.success() || result["status"]!="generated" { return Err(format!("native_a2v_failed: {} (로그: {})",result["error"],dir.display())); }
    let made=output_dir.join("original-audio-master.mp4");
    if !made.is_file() || fs::metadata(&made).map_err(|e|err("결과 확인 오류",e))?.len()==0 || result["result"]["source_unchanged"]!=true { return Err("native_output_invalid: 결과 또는 원음 보존 확인 실패".into()); }
    let mut destination=target.clone();
    for n in 0..10_000 {
        if n>0 { destination=parent.join(format!("{stem}_{n:03}.mp4")); }
        match fs::hard_link(&made,&destination) {
            Ok(())=>return Ok(GenerateResult{output:destination.to_string_lossy().into(),seconds:started.elapsed().as_secs_f64(),meta:json!({"native_a2v":result["result"],"experimental":true,"gpuQaCompleted":manifest["native_gpu_qa_completed"]==true,"lipSyncVerified":false,"workerArtifacts":dir.to_string_lossy()})}),
            Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,
            Err(e)=>return Err(err("완성 결과 연결 오류",e)),
        }
    }
    Err("invalid_output: 결과 파일 이름을 확보하지 못했습니다".into())
}

fn prepare_native_workspace(dir: &Path, request: &Value) -> Res<(PathBuf,PathBuf)> {
    fs::create_dir(dir).map_err(|e|err("작업 폴더 생성 오류",e))?;
    fs::write(dir.join("a2v_worker.py"),WORKER).map_err(|e|err("워커 준비 오류",e))?;
    fs::write(dir.join("a2v_adapter.py"),ADAPTER).map_err(|e|err("워커 준비 오류",e))?;
    fs::write(dir.join("gpu_handoff.py"),GPU_HANDOFF).map_err(|e|err("handoff worker",e))?;
    fs::write(dir.join("memory_budget.py"),MEMORY_BUDGET).map_err(|e|err("메모리 검사 준비 오류",e))?;
    let request_file=dir.join("request.json");
    fs::write(&request_file,serde_json::to_vec(request).unwrap()).map_err(|e|err("입력 준비 오류",e))?;
    // 워커는 자기 출력 폴더를 배타적으로 만든다. 스크립트/요청 폴더와 분리한다.
    Ok((request_file,dir.join("native-output")))
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn execution_boundary_is_required() { assert!(blockers(&json!({"native_weight_contract_verified":true})).contains(&"separate_gpu_handoff_required".into())); }
    #[test] fn unsupported_controls_rejected_before_file_access() { assert!(worker_request(&json!({"ltx_a2v":"experimental","loras":[{}]})).unwrap_err().contains("unsupported_control")); }
    #[test] fn injected_option_rejected() { assert!(worker_request(&json!({"ltx_a2v":"experimental","manifest":"C:/other.json"})).unwrap_err().contains("unsupported_options")); }
    #[test] fn protocol_can_skip_native_library_chatter() { assert_eq!(parse_worker(b"library log\n{\"status\":\"error\",\"error\":\"out_of_memory\"}\n").unwrap()["error"],"out_of_memory"); }
    #[test] fn native_worker_can_create_output_after_app_preparation() {
        let parent=tempfile::tempdir().unwrap();let dir=parent.path().join("owned-workspace");
        let request=json!({"projectId":"cpu-qa"});
        let (request_file,output)=prepare_native_workspace(&dir,&request).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(request_file).unwrap()).unwrap(),request);
        assert_eq!(fs::read(dir.join("a2v_worker.py")).unwrap(),WORKER.as_bytes());
        assert_eq!(fs::read(dir.join("memory_budget.py")).unwrap(),MEMORY_BUDGET.as_bytes());
        assert!(!output.exists());
        fs::create_dir(&output).unwrap();
        assert!(prepare_native_workspace(&dir,&request).is_err());
    }
    #[test] fn disk_mode_is_forwarded_with_original_audio_contract() {
        let dir=tempfile::tempdir().unwrap();let audio=dir.path().join("input.wav");
        fs::write(&audio,b"path binding CPU fixture").unwrap();
        let request=worker_request(&json!({"ltx_a2v":"experimental","ltx_a2v_offload":"disk","local_files_only":true,"audio_path":audio,"audio_duration_seconds":2.72,"fps":16})).unwrap();
        assert_eq!(request["inputs"]["offloadMode"],"disk");
        assert_eq!(request["inputs"]["audioDurationSeconds"],2.72);
        assert_eq!(request["inputs"]["fps"],16);
    }
    #[test] fn offload_and_local_policy_cannot_be_faked() {
        for mode in [json!("none"),json!(true),json!(1)] {
            assert!(worker_request(&json!({"ltx_a2v":"experimental","ltx_a2v_offload":mode})).unwrap_err().contains("ltx_a2v_offload"));
        }
        assert!(worker_request(&json!({"ltx_a2v":"experimental","local_files_only":false})).unwrap_err().contains("always_offline"));
    }
}

pub(crate) fn maintenance_busy() -> bool { RUN.try_lock().is_err() }
