//! 평면 합성은 GPU 엔진과 분리된 CPU 작업자입니다. 외부 입력이 실행 파일 경로를 정하지 않습니다.
use std::{fs,path::{Path,PathBuf},process::{Command,Stdio},time::{Instant,SystemTime,UNIX_EPOCH}};
use serde_json::{json,Value};
use tauri::{AppHandle,Manager};
use crate::{err,Res};

const WORKER:&str=include_str!("../resources/planar_overlay/planar_overlay.py");
const EDIT_WORKER:&str=include_str!("../resources/planar_overlay/media_edit.py");
const AAC_WORKER:&str=include_str!("../resources/planar_overlay/aac_preview.py");
const PROTECTED_WORKER:&str=include_str!("../resources/planar_overlay/protected_edit.py");
fn config(app:&AppHandle,tool:&str)->Res<Value>{
    let path=app.path().app_data_dir().map_err(|e|err("앱 경로 오류",e))?.join(format!("local/tools/{tool}/environment.json"));
    let text=fs::read_to_string(path).map_err(|e|err("planar_not_ready: 기존 CPU 환경 연결 설정이 없습니다",e))?;
    serde_json::from_str(&text).map_err(|e|err("planar_not_ready: CPU 설정 오류",e))
}
fn config_blockers(value:&Value)->Vec<String>{
    ["python","ffmpeg"].iter().filter(|key|!value[**key].as_str().is_some_and(|p|Path::new(p).is_file())).map(|key|format!("missing_cpu_tool:{key}")).collect()
}
#[tauri::command]
pub fn planar_overlay_status(app:AppHandle)->Res<Value>{
    let value=match config(&app,"planar-overlay"){Ok(v)=>v,Err(_)=>return Ok(json!({"ready":false,"blockers":["managed_cpu_environment_not_configured"],"gpuUsed":false}))};
    let errors=config_blockers(&value);
    Ok(json!({"ready":errors.is_empty(),"blockers":errors,"gpuUsed":false,"automaticTracking":false,"qualityApprovalAvailable":false}))
}
fn parse_result(stdout:&[u8])->Res<Value>{String::from_utf8_lossy(stdout).lines().rev().find_map(|s|serde_json::from_str::<Value>(s).ok()).ok_or("planar_worker_protocol_error: JSON 결과가 없습니다".into())}
fn publish(source:&Path,target:&Path)->Res<PathBuf>{
    let parent=target.parent().ok_or("invalid_output")?;let stem=target.file_stem().and_then(|s|s.to_str()).unwrap_or("화면합성");
    for index in 0..10000{
        let extension=target.extension().and_then(|s|s.to_str()).unwrap_or("mp4");
        let destination=if index==0{target.to_path_buf()}else{parent.join(format!("{stem}_{index:03}.{extension}"))};
        match fs::hard_link(source,&destination){Ok(())=>return Ok(destination),Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,Err(e)=>return Err(err("평면 합성 결과 연결 오류",e))}
    }Err("결과 파일 이름을 확보하지 못했습니다".into())
}

fn execute_cpu(conf:&Value,dir:&Path,request:&Value,code:&str)->Res<Value>{
    let request_path=dir.join("request.json");let worker=dir.join("cpu_worker.py");
    fs::write(&request_path,serde_json::to_vec(request).map_err(|e|err("요청 JSON 오류",e))?).map_err(|e|err("입력 저장 오류",e))?;
    fs::write(&worker,code).map_err(|e|err("CPU 작업자 준비 오류",e))?;
    let mut cmd=Command::new(conf["python"].as_str().ok_or("missing_cpu_python")?);
    cmd.env("OPENBLAS_NUM_THREADS","1").env("OMP_NUM_THREADS","1").env("PYTHONUTF8","1").env("CUDA_VISIBLE_DEVICES","").env("HF_HUB_OFFLINE","1").env("TRANSFORMERS_OFFLINE","1");
    cmd.arg(worker).arg("--request").arg(request_path).arg("--output-directory").arg(dir.join("render")).arg("--ffmpeg").arg(conf["ffmpeg"].as_str().ok_or("missing_cpu_ffmpeg")?).stdin(Stdio::null());
    #[cfg(windows)]{use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}
    let output=cmd.output().map_err(|e|err("CPU 작업 실행 오류",e))?;
    fs::write(dir.join("worker-stdout.log"),&output.stdout).map_err(|e|err("로그 저장 오류",e))?;fs::write(dir.join("worker-stderr.log"),&output.stderr).map_err(|e|err("로그 저장 오류",e))?;
    let result=parse_result(&output.stdout)?;
    if !output.status.success(){return Err(format!("cpu_worker_failed: {} (로그: {})",result["error"],dir.display()));}
    Ok(result)
}

fn run(app:AppHandle,request:Value,output_path:String,protected:bool)->Res<Value>{
    let conf=config(&app,if protected{"protected-edit"}else{"planar-overlay"})?;let blockers=config_blockers(&conf);if !blockers.is_empty(){return Err(format!("cpu_edit_not_ready: {}",blockers.join(", ")));}
    let mut keys=if protected{vec!["sourceImage","selectionMask","protectionMask"]}else{vec!["sourceVideo","replacementImage"]};
    if protected&&request["replacementImage"].is_string(){keys.push("replacementImage");}
    for key in keys{
        let path=request[key].as_str().ok_or("invalid_asset: 파일이 필요합니다")?;
        if path.contains("://")||!Path::new(path).is_file(){return Err(format!("invalid_asset:{key}"));}
    }
    let target=PathBuf::from(output_path);let parent=target.parent().filter(|p|p.is_dir()).ok_or("invalid_output: 결과 폴더")?;
    if target.extension().and_then(|s|s.to_str())!=Some(if protected{"png"}else{"mp4"}){return Err("invalid_output: 작업에 맞는 PNG/MP4가 필요합니다".into());}
    let dir=parent.join(format!(".planar-overlay-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
    fs::create_dir(&dir).map_err(|e|err("CPU 작업 폴더 오류",e))?;
    let started=Instant::now();
    let result=execute_cpu(&conf,&dir,&request,if protected{PROTECTED_WORKER}else{WORKER})?;
    if result["status"]!="generated"{return Err(format!("planar_overlay_failed: {} (로그: {})",result["error"],dir.display()));}
    let made=dir.join(if protected{"render/protected-edit.png"}else{"render/planar-overlay.mp4"});
    if !made.is_file()||result["originalUnchanged"]!=true||result["gpuUsed"]!=false||result["allLosslessOutsideZeroAlphaPixelsExact"]!=true{return Err("planar_output_invalid".into());}
    if protected&&result["protectedPixelsExact"]!=true{return Err("protected_output_invalid".into());}
    let destination=publish(&made,&target)?;
    Ok(json!({"output":destination,"seconds":started.elapsed().as_secs_f64(),"meta":{"planarOverlay":if protected{Value::Null}else{result.clone()},"protectedEdit":if protected{result}else{Value::Null},"qualityApproved":false,"primaryChanged":false,"workerArtifacts":dir}}))
}
#[tauri::command]
pub async fn planar_overlay_run(app:AppHandle,request:Value,output_path:String)->Res<Value>{tauri::async_runtime::spawn_blocking(move||run(app,request,output_path,false)).await.map_err(|e|err("CPU 평면 합성을 기다리지 못했습니다",e))?}
#[tauri::command]
pub async fn protected_edit_run(app:AppHandle,request:Value,output_path:String)->Res<Value>{tauri::async_runtime::spawn_blocking(move||run(app,request,output_path,true)).await.map_err(|e|err("CPU 보호 편집을 기다리지 못했습니다",e))?}
#[tauri::command]
pub fn protected_edit_status(app:AppHandle)->Res<Value>{
    let value=match config(&app,"protected-edit"){Ok(v)=>v,Err(_)=>return Ok(json!({"ready":false,"blockers":["managed_cpu_environment_not_configured"],"gpuUsed":false}))};
    let errors=config_blockers(&value);Ok(json!({"ready":errors.is_empty(),"blockers":errors,"gpuUsed":false,"automaticSemanticSelection":false,"qualityApprovalAvailable":false}))
}

#[tauri::command]
pub fn media_edit_status(app:AppHandle)->Res<Value>{
    let value=match config(&app,"media-edit"){Ok(v)=>v,Err(_)=>return Ok(json!({"ready":false,"blockers":["managed_cpu_environment_not_configured"],"gpuUsed":false}))};
    let errors=config_blockers(&value);
    Ok(json!({"ready":errors.is_empty(),"blockers":errors,"gpuUsed":false,"qualityApprovalAvailable":false,"operations":["frame-trim","concat","explicit-last-frame-hold"],"audioPolicies":["omit","clip-and-silence"],"defaultAudioPolicy":"clip-and-silence","audioFormat":"source-rate mono/stereo decoded PCM16; mixed specs rejected","outputCodec":"h264-rgb-lossless"}))
}
fn edit_blocking(app:AppHandle,request:Value,output_path:Option<String>)->Res<Value>{
    let conf=config(&app,"media-edit")?;let blockers=config_blockers(&conf);
    if !blockers.is_empty(){return Err(format!("media_edit_not_ready: {}",blockers.join(", ")));}
    let probe=output_path.is_none();
    let inputs:Vec<&str>=if probe{vec![request["sourceVideo"].as_str().ok_or("invalid_source_video")?]}else{
        let segments=request["segments"].as_array().filter(|v|!v.is_empty()&&v.len()<=32).ok_or("invalid_segments")?;
        segments.iter().map(|s|s["sourceVideo"].as_str().ok_or_else(||"invalid_source_video".to_string())).collect::<Res<Vec<_>>>()?
    };
    for input in inputs{if input.contains("://")||input.starts_with("\\\\")||input.starts_with("//")||!Path::new(input).is_file(){return Err("invalid_local_video".into());}}
    let target=output_path.map(PathBuf::from);
    let parent=if let Some(path)=&target{
        if path.extension().and_then(|s|s.to_str())!=Some("mp4"){return Err("invalid_output_extension".into());}
        path.parent().filter(|p|p.is_dir()).ok_or("invalid_output_folder")?.to_path_buf()
    }else{
        let path=app.path().app_data_dir().map_err(|e|err("앱 경로 오류",e))?.join("cpu-media-probes");
        fs::create_dir_all(&path).map_err(|e|err("CPU 검사 폴더 오류",e))?;path
    };
    let dir=parent.join(format!(".media-edit-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
    fs::create_dir(&dir).map_err(|e|err("CPU 편집 폴더 오류",e))?;
    let started=Instant::now();let result=execute_cpu(&conf,&dir,&request,EDIT_WORKER)?;
    if probe{
        if result["status"]!="probed"||result["sourceUnchanged"]!=true||result["gpuUsed"]!=false{return Err("media_probe_invalid".into());}
        return Ok(result);
    }
    if result["status"]!="generated"||result["originalUnchanged"]!=true||result["gpuUsed"]!=false||result["allDecodedSourceFramesExact"]!=true{return Err("media_edit_output_invalid".into());}
    if result["audioTracks"].as_u64().unwrap_or(0)>0&&result["decodedPcmExact"]!=true{return Err("media_edit_audio_invalid".into());}
    let made=dir.join("render/media-edit.mp4");if !made.is_file(){return Err("media_edit_output_missing".into());}
    let destination=publish(&made,target.as_ref().unwrap())?;
    Ok(json!({"output":destination,"seconds":started.elapsed().as_secs_f64(),"meta":{"mediaEdit":result,"workerArtifacts":dir,"qualityApproved":false,"primaryChanged":false}}))
}
#[tauri::command]
pub async fn media_edit_probe(app:AppHandle,mut request:Value)->Res<Value>{
    request.as_object_mut().ok_or("invalid_request_object")?.insert("operation".into(),json!("probe"));
    tauri::async_runtime::spawn_blocking(move||edit_blocking(app,request,None)).await.map_err(|e|err("CPU 검사를 기다리지 못했습니다",e))?
}
#[tauri::command]
pub async fn media_edit_run(app:AppHandle,mut request:Value,output_path:String)->Res<Value>{
    request.as_object_mut().ok_or("invalid_request_object")?.insert("operation".into(),json!("edit"));
    tauri::async_runtime::spawn_blocking(move||edit_blocking(app,request,Some(output_path))).await.map_err(|e|err("CPU 편집을 기다리지 못했습니다",e))?
}

#[tauri::command]
pub fn aac_preview_status(app:AppHandle)->Res<Value>{
    let value=match config(&app,"media-edit"){Ok(v)=>v,Err(_)=>return Ok(json!({"ready":false,"blockers":["managed_cpu_environment_not_configured"],"gpuUsed":false}))};
    let blockers=config_blockers(&value);
    Ok(json!({"ready":blockers.is_empty(),"blockers":blockers,"gpuUsed":false,"videoCodec":"h264 stream copy","audioCodec":"aac 192k lossy","masterPreserved":true,"qualityApproved":false}))
}
fn preview_blocking(app:AppHandle,request:Value,output_path:String)->Res<Value>{
    let conf=config(&app,"media-edit")?;if !config_blockers(&conf).is_empty(){return Err("aac_preview_not_ready".into());}
    let source=request["sourceVideo"].as_str().ok_or("invalid_source_video")?;
    if source.contains("://")||source.starts_with("\\\\")||source.starts_with("//")||!Path::new(source).is_file(){return Err("invalid_local_master".into());}
    let target=PathBuf::from(output_path);if target.extension().and_then(|v|v.to_str())!=Some("mp4"){return Err("invalid_output_extension".into());}
    let parent=target.parent().filter(|p|p.is_dir()).ok_or("invalid_output_folder")?;
    let dir=parent.join(format!(".aac-preview-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));fs::create_dir(&dir).map_err(|e|err("AAC workspace",e))?;
    let result=execute_cpu(&conf,&dir,&request,AAC_WORKER)?;
    if result["status"]!="generated"||result["originalUnchanged"]!=true||result["allVideoPacketsExact"]!=true||result["allDecodedFramesExact"]!=true||result["gpuUsed"]!=false||result["fullDecodePassed"]!=true{return Err("aac_preview_output_invalid".into());}
    let destination=publish(&dir.join("render/aac-preview.mp4"),&target)?;
    Ok(json!({"output":destination,"meta":{"aacPreview":result,"workerArtifacts":dir,"qualityApproved":false,"primaryChanged":false}}))
}
#[tauri::command]
pub async fn aac_preview_run(app:AppHandle,request:Value,output_path:String)->Res<Value>{
    tauri::async_runtime::spawn_blocking(move||preview_blocking(app,request,output_path)).await.map_err(|e|err("AAC CPU export",e))?
}
#[tauri::command]
pub async fn aac_preview_verify(source_video:String,source_sha256:String,preview_video:String,preview_sha256:String)->Res<bool>{
    tauri::async_runtime::spawn_blocking(move||{
        for (file,expected) in [(source_video,source_sha256),(preview_video,preview_sha256)]{
            if file.contains("://")||file.starts_with("\\\\")||file.starts_with("//")||!Path::new(&file).is_file(){return Err("invalid_local_preview_path".into());}
            if crate::download::sha256_of(Path::new(&file))?!=expected{return Err("preview_or_master_hash_changed".into());}
        }Ok(true)
    }).await.map_err(|e|err("AAC hash verification",e))?
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn absent_environment_is_blocked(){assert_eq!(config_blockers(&json!({})).len(),2);}
    #[test]fn failure_protocol_retains_worker_error(){assert_eq!(parse_result(b"library log\n{\"status\":\"error\",\"error\":\"source_hash_mismatch\"}\n").unwrap()["error"],"source_hash_mismatch");}
    #[test]fn image_publication_keeps_png_and_existing_file(){let dir=std::env::temp_dir().join(format!("protected-png-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&dir).unwrap();let source=dir.join("made.png");let target=dir.join("out.png");fs::write(&source,b"derivative").unwrap();fs::write(&target,b"original").unwrap();let published=publish(&source,&target).unwrap();assert_eq!(published.extension().unwrap(),"png");assert_eq!(fs::read(&target).unwrap(),b"original");}
    #[test]fn publish_preserves_reserved_or_original_file(){let dir=std::env::temp_dir().join(format!("planar-publish-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&dir).unwrap();let source=dir.join("made.mp4");let target=dir.join("out.mp4");fs::write(&source,b"derivative").unwrap();fs::write(&target,b"original").unwrap();let published=publish(&source,&target).unwrap();assert_ne!(published,target);assert_eq!(fs::read(&target).unwrap(),b"original");assert_eq!(fs::read(published).unwrap(),b"derivative");}
}
