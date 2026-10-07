//! Workflow용 사실은 요청의 boolean 대신 등록 파일을 CPU로 읽어 취득합니다.
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use crate::{err, Res};

fn cpu_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command.stdin(Stdio::null()).env("CUDA_VISIBLE_DEVICES", "");
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command
}
pub(crate) fn probe_media(app: &AppHandle, path: &Path, kind: &str) -> Res<Value> {
    let data_dir = app.path().app_data_dir().map_err(|e|err("app_path",e))?;
    probe_media_in_data_dir(&data_dir, path, kind)
}

pub(crate) fn probe_media_in_data_dir(data_dir: &Path, path: &Path, kind: &str) -> Res<Value> {
    if kind == "image" {
        let image = image::ImageReader::open(path).map_err(|e|err("workflow_asset_open_failed",e))?
            .with_guessed_format().map_err(|e|err("workflow_asset_format_failed",e))?
            .decode().map_err(|e|err("workflow_asset_decode_failed",e))?;
        if image.width() == 0 || image.height() == 0 { return Err("workflow_empty_image".into()); }
        return Ok(json!({"decodable":true,"width":image.width(),"height":image.height(),"fullDecode":true,"maskConvention":image_mask_encoding(&image)}));
    }
    if !["audio","video"].contains(&kind) { return Err("workflow_asset_kind_invalid".into()); }
    let config_path = data_dir.join("local/tools/media-edit/environment.json");
    let config: Value = serde_json::from_slice(&fs::read(config_path).map_err(|e|err("workflow_cpu_probe_not_configured",e))?).map_err(|e|err("workflow_cpu_probe_config_invalid",e))?;
    let ffmpeg = PathBuf::from(config["ffmpeg"].as_str().ok_or("workflow_cpu_ffmpeg_missing")?);
    let ffprobe = config["ffprobe"].as_str().map(PathBuf::from).unwrap_or_else(||ffmpeg.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }));
    if !ffmpeg.is_file() || !ffprobe.is_file() { return Err("workflow_cpu_probe_missing: 기존 ffmpeg/ffprobe 환경을 확인하세요. 자동 설치하지 않습니다.".into()); }
    let output = cpu_command(&ffprobe).args(["-v","error","-count_frames","-show_streams","-show_format","-of","json"]).arg(path).output().map_err(|e|err("workflow_asset_probe_failed",e))?;
    if !output.status.success() || output.stdout.len() > 2 * 1024 * 1024 { return Err("workflow_asset_probe_invalid".into()); }
    let metadata: Value = serde_json::from_slice(&output.stdout).map_err(|e|err("workflow_asset_probe_json",e))?;
    let streams = metadata["streams"].as_array().ok_or("workflow_asset_streams_missing")?;
    let stream = streams.iter().find(|stream|stream["codec_type"] == kind).ok_or("workflow_asset_requested_stream_missing")?;
    let decoded = cpu_command(&ffmpeg).args(["-v","error","-xerror","-i"]).arg(path).args(["-map","0:v?","-map","0:a?","-f","null","-"]).output().map_err(|e|err("workflow_asset_decode_failed",e))?;
    if !decoded.status.success() { return Err("workflow_asset_full_decode_failed".into()); }
    let duration = metadata.pointer("/format/duration").and_then(Value::as_str).and_then(|v|v.parse::<f64>().ok()).filter(|v|v.is_finite() && *v>0.0).ok_or("workflow_asset_duration_missing")?;
    let fps = stream["avg_frame_rate"].as_str().and_then(|v|v.split_once('/')).and_then(|(a,b)|Some(a.parse::<f64>().ok()?/b.parse::<f64>().ok()?)).filter(|v|v.is_finite()&&*v>0.0);
    Ok(json!({"decodable":true,"fullDecode":true,"width":stream["width"],"height":stream["height"],"fps":fps,"durationSeconds":duration,"frameCount":if kind=="video"{measured_frame_count(stream)}else{None},"audioTracks":streams.iter().filter(|v|v["codec_type"]=="audio").count(),"metadata":metadata}))
}

// fps×duration와 컨테이너 nb_frames는 실제 읽은 프레임 수의 증거로 쓰지 않습니다.
fn measured_frame_count(stream:&Value)->Option<u64> {
    stream["nb_read_frames"].as_str().and_then(|v|v.parse().ok()).filter(|n|*n>0)
}

/// 파일에서 확인한 저장 방식만 기록합니다. 모델의 편집 방향은 검토된 슬롯 규약에서 확인합니다.
fn image_mask_encoding(image: &image::DynamicImage) -> Option<&'static str> {
    let pixels=image.to_rgba8();
    if pixels.pixels().any(|p|p[3] != 255) { return Some("alpha-inverted"); }
    if pixels.pixels().all(|p|p[0]==p[1] && p[1]==p[2]) { return Some("white-edit"); }
    None
}

#[cfg(test)]
mod mask_tests {
    use super::*;
    #[test]fn frame_count_requires_counted_frames_instead_of_duration_estimation(){
        assert_eq!(measured_frame_count(&json!({"nb_read_frames":"56"})),Some(56));
        for stream in [json!({"nb_frames":"56","duration":"2.333","avg_frame_rate":"24/1"}),json!({"nb_read_frames":"N/A"}),json!({"nb_read_frames":"0"})] {assert_eq!(measured_frame_count(&stream),None);}
    }
    #[test]
    fn mask_storage_is_observed_on_cpu_without_ambiguous_color_inference() {
        let gray=image::DynamicImage::ImageLuma8(image::GrayImage::from_raw(2,1,vec![0,255]).unwrap());
        assert_eq!(image_mask_encoding(&gray),Some("white-edit"));
        let alpha=image::DynamicImage::ImageRgba8(image::RgbaImage::from_raw(1,1,vec![255,255,255,0]).unwrap());
        assert_eq!(image_mask_encoding(&alpha),Some("alpha-inverted"));
        let color=image::DynamicImage::ImageRgb8(image::RgbImage::from_raw(1,1,vec![255,0,0]).unwrap());
        assert_eq!(image_mask_encoding(&color),None);
    }
}

#[tauri::command]
pub async fn comfy_workflow_asset_fact(app: AppHandle, project_id: String, asset_id: String, base_directory: String, project_name: String, path: String, kind: String) -> Res<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir=app.path().app_data_dir().map_err(|e|err("app_path",e))?;
        crate::comfy_registered_assets::issue(&data_dir,&project_id,&asset_id,&base_directory,&project_name,&path,&kind)
    }).await.map_err(|e|err("workflow_cpu_probe_wait",e))?
}
