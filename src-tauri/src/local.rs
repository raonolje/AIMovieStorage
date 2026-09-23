//! 로컬 생성 엔진 — 영상·이미지·음악을 이 컴퓨터에서 직접 뽑습니다.
//!
//!
//!
//! # 여기에는 살림이 없습니다
//!
//! 설치(uv·venv·가중치 해시 확인·이어받기), 상주 워커, 취소, 로그, 안전한 제거는
//! **`upscale.rs` 의 것을 그대로 씁니다**(`Family` 로 폴더와 엔진 목록만 가릅니다).
//! 이 파일은 프런트가 부르는 명령 껍데기뿐입니다 — 살림을 두 벌로 두면 한쪽만 고치는
//! 날이 오고, 그 한쪽이 «가중치를 반만 받고 설치됐다고 적는» 쪽이 됩니다.
//!
//! ```text
//! <app_data>/local/
//! engines/minimax-music/ .venv · models · manifest.json
//! engines/minimax-video/ ← 멀티 로라는 opts.loras 로 넘깁니다
//! logs/<id>.log
//! ```

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::upscale::{
    cancel_install_command, engines_status, generate_blocking, install_engine_command,
    known_engine, prefetch_weights_command, stop_workers_command, uninstall_engine_command,
    worker_info_command, EngineStatus, GenerateResult, LOCAL,
};
use crate::{err, Res};

/// 로컬 생성은 오래 걸립니다 — 영상 한 편이 수 분입니다. 업스케일보다 넉넉히.
const DEFAULT_TIMEOUT_SECS: u64 = 3600;

#[tauri::command(async)]
pub fn local_engines_status(app: AppHandle) -> Res<Vec<EngineStatus>> {
    engines_status(app, &LOCAL)
}

#[tauri::command]
pub async fn local_install_engine(
    app: AppHandle,
    id: String,
    extra_models: Option<Vec<String>>,
) -> Res<()> {
    install_engine_command(app, id, extra_models).await
}

#[tauri::command]
pub fn local_cancel_install(app: AppHandle, id: String) -> Res<()> {
    cancel_install_command(app, id)
}

/// 이미 깔린 엔진의 가중치를 지금 통째로 받아 둡니다(«가중치 미리 받기» 단추).
///
/// 미니맥스 H3 의 레퍼런스용 `transformer_ref`(62 GB)와
/// 완 I2V 판(60 GB)이 첫 생성 안에서 말없이 내려오던 것을, 미리 받아 두는 길입니다.
/// 멈추기는 설치와 같은 `local_cancel_install` 이 듣습니다.
#[tauri::command]
pub async fn local_prefetch_weights(app: AppHandle, engine: String) -> Res<()> {
    prefetch_weights_command(app, engine).await
}

#[tauri::command(async)]
pub fn local_uninstall_engine(app: AppHandle, id: String) -> Res<()> {
    uninstall_engine_command(app, id)
}

#[tauri::command]
pub fn local_worker_info(app: AppHandle, engine: String) -> Res<Option<Value>> {
    worker_info_command(app, engine)
}

#[tauri::command(async)]
pub fn local_stop_workers(app: AppHandle) -> Res<()> {
    stop_workers_command(app, &LOCAL)
}

/// 파일 하나를 만듭니다 — 영상·그림·음악 모두 이 한 길입니다.
///
/// `opts` 는 엔진이 읽습니다(프롬프트·길이·해상도·시드, 그리고 미니맥스 영상의 `loras`).
/// 우리 쪽에서 필드를 검사하지 않는 까닭: 엔진마다 받는 값이 달라, 여기서 한 벌로 정하면
/// 엔진을 하나 더할 때마다 Rust 를 고쳐야 합니다.
#[tauri::command]
pub async fn local_run(
    app: AppHandle,
    engine: String,
    output_path: String,
    opts: Option<Value>,
    timeout_secs: Option<u64>,
) -> Res<GenerateResult> {
    let engine = known_engine(&engine)?.to_string();
    let opts = opts.unwrap_or_else(|| json!({}));
    let timeout = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
    tauri::async_runtime::spawn_blocking(move || {
        generate_blocking(app, engine, output_path, opts, timeout)
    })
    .await
    .map_err(|e| err("생성을 기다리지 못했습니다", e))?
}

// ─────────────────────────────────────────────────────────────────────────────
// 모션 캡처 — 영상 고르기 · 결과 파일 자리
// ─────────────────────────────────────────────────────────────────────────────

/// 영상 파일을 여러 개 고릅니다(솔로 영상을 캐릭터마다 하나씩 짝짓는 쓰임).
///
///
///
/// 브라우저의 `<input type=file>` 은 **경로를 주지 않아서** 로컬 엔진(파이썬)에 영상을 넘길 수 없습니다. 그래서 여기서 고르고,
/// 고른 파일만 asset 프로토콜로 열어 화면에서 미리 볼 수 있게 합니다(폴더째 열지 않습니다 — 고른 것만).
#[tauri::command]
pub fn choose_video_files(app: AppHandle) -> Res<Vec<String>> {
    use tauri::Manager;
    let picked = rfd::FileDialog::new()
        .set_title("모션을 가져올 영상을 고르세요")
        .add_filter("영상", &["mp4", "mov", "webm", "mkv", "avi", "m4v"])
        .pick_files()
        .unwrap_or_default();
    let mut out = Vec::new();
    for path in picked {
        if !path.is_file() {
            continue;
        }
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| err("영상을 열지 못했습니다", e))?;
        out.push(path.to_string_lossy().to_string());
    }
    Ok(out)
}

/// 음악 파일을 고릅니다(뮤직비디오 방식의 시간표).
///
/// 영상 고르기와 같은 길입니다 — 브라우저 파일 창은 경로를 주지 않아서
/// 여기서 고르고 그 파일만 asset 프로토콜로 엽니다(미리 듣기용).
#[tauri::command]
pub fn choose_audio_files(app: AppHandle) -> Res<Vec<String>> {
    use tauri::Manager;
    let picked = rfd::FileDialog::new()
        .set_title("이 장면의 음악을 고르세요")
        .add_filter("음악", &["mp3", "wav", "m4a", "flac", "ogg", "aac"])
        .pick_files()
        .unwrap_or_default();
    let mut out = Vec::new();
    for path in picked {
        if !path.is_file() {
            continue;
        }
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| err("음악을 열지 못했습니다", e))?;
        out.push(path.to_string_lossy().to_string());
    }
    Ok(out)
}

/// 모션 캡처 결과를 쓸 자리 — `<앱 데이터>/local/mocap-results/<이름>.json`.
///
/// 결과는 프로젝트 자산이 아니라 **키로 옮기기 전의 중간물**이라 프로젝트 폴더에 두지 않습니다(두면 폴더를 다시 읽을 때
/// 목록에 섞입니다). 읽고 나면 지웁니다(`read_motion_capture`).
#[tauri::command]
pub fn motion_capture_output(app: AppHandle, name: String) -> Res<String> {
    let dir = mocap_results_dir(&app)?;
    Ok(dir
        .join(format!("{}.json", crate::safe_name(&name)))
        .to_string_lossy()
        .to_string())
}

/// 결과 파일을 읽고 **지웁니다**. 결과 폴더 밖의 경로는 읽지도 지우지도 않습니다(canonicalize 로 확인).
#[tauri::command]
pub fn read_motion_capture(app: AppHandle, path: String) -> Res<String> {
    let dir = mocap_results_dir(&app)?
        .canonicalize()
        .map_err(|e| err("결과 폴더를 찾지 못했습니다", e))?;
    let file = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| err("결과 파일을 찾지 못했습니다", e))?;
    if file.parent() != Some(dir.as_path()) {
        return Err("모션 캡처 결과 폴더 밖의 파일은 읽지 않습니다.".into());
    }
    let text = std::fs::read_to_string(&file).map_err(|e| err("결과 파일을 읽지 못했습니다", e))?;
    // 우리가 만든 중간물 한 파일만 지웁니다 — 남겨 두면 분석할 때마다 수 MB 씩 쌓입니다.
    let _ = std::fs::remove_file(&file);
    Ok(text)
}

fn mocap_results_dir(app: &AppHandle) -> Res<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| err("앱 데이터 폴더를 찾지 못했습니다", e))?
        .join("local")
        .join("mocap-results");
    std::fs::create_dir_all(&dir).map_err(|e| err("결과 폴더를 만들지 못했습니다", e))?;
    Ok(dir)
}

/* ─────────────────────── 이 컴퓨터가 무엇을 돌릴 수 있나 ───────────────────────
  

  그래서 «받을 수 있음/없음» 을 설치 단추 옆에 미리 적어 둡니다. 125 GB 짜리를 한 시간
  받고 나서 «VRAM 이 모자랍니다» 를 보는 것이 가장 나쁩니다.

  # 왜 크레이트를 안 쓰나

  sysinfo·nvml 을 넣으면 빌드가 무거워지고, 무엇보다 **NVIDIA 가 아닌 기계에서 링크가
  깨질 수 있습니다.** 여기서 필요한 것은 숫자 서넛뿐이라 이미 깔려 있는 명령을 읽습니다.
  읽히지 않으면 `null` 을 돌려주고 화면은 «확인 못 함» 으로 둡니다 — 틀린 숫자보다 낫습니다.
*/

/// 명령 하나를 돌려 표준출력을 받습니다. 없으면 `None` — 오류로 올리지 않습니다.
fn run_probe(program: &str, args: &[&str]) -> Option<String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 콘솔 창이 깜빡이지 않게. 설정 화면을 열 때마다 검은 창이 뜨면 앱이 고장 난 것처럼 보입니다.
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 이 컴퓨터의 GPU·RAM·빈 디스크. 못 읽은 값은 `null` 입니다.
#[tauri::command]
pub fn probe_hardware(app: AppHandle) -> Res<Value> {
    use tauri::Manager;

    // ── GPU ──────────────────────────────────────────────────────────────
    let mut gpus: Vec<Value> = Vec::new();
    if let Some(text) = run_probe(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ],
    ) {
        for line in text.lines() {
            let mut parts = line.splitn(2, ',');
            let name = parts.next().unwrap_or("").trim().to_string();
            // nvidia-smi 의 memory.total 은 **MiB** 입니다.
            let vram_mb = parts
                .next()
                .and_then(|value| value.trim().parse::<f64>().ok());
            if name.is_empty() {
                continue;
            }
            gpus.push(json!({
                "name": name,
                "vramGb": vram_mb.map(|mb| (mb / 1024.0 * 10.0).round() / 10.0),
                "vendor": "nvidia",
            }));
        }
    }
    #[cfg(windows)]
    if gpus.is_empty() {
        // NVIDIA 가 아니면 이름만이라도. AdapterRAM 은 4 GB 를 넘으면 틀린 값이 나와 안 읽습니다.
        if let Some(text) = run_probe(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_VideoController).Name",
            ],
        ) {
            for line in text.lines().filter(|line| !line.trim().is_empty()) {
                gpus.push(json!({ "name": line.trim(), "vramGb": Value::Null, "vendor": "other" }));
            }
        }
    }

    // ── 시스템 RAM ───────────────────────────────────────────────────────
    // 윈도우가 아니면 읽을 길을 아직 안 만들었습니다 — 그때는 «확인 못 함» 으로 둡니다.
    #[cfg(not(windows))]
    let ram_gb: Option<f64> = None;
    #[cfg(windows)]
    let ram_gb: Option<f64> = {
        run_probe(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ],
        )
        .and_then(|text| text.trim().parse::<f64>().ok())
        .map(|bytes| (bytes / 1_073_741_824.0 * 10.0).round() / 10.0)
    };

    // ── 엔진 폴더가 있는 드라이브의 빈 자리 ──────────────────────────────
    let engines_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| err("앱 데이터 폴더를 찾지 못했습니다", e))?
        .join("local");
    #[allow(unused_mut)]
    let mut free_gb: Option<f64> = None;
    #[cfg(windows)]
    {
        // 드라이브 문자만 넘깁니다 — 경로에 한글·공백이 있어도 안전합니다.
        let drive = engines_dir
            .to_string_lossy()
            .chars()
            .take(2)
            .collect::<String>();
        if drive.len() == 2 && drive.ends_with(':') {
            free_gb = run_probe(
                "powershell",
                &[
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "(Get-PSDrive -Name {} -ErrorAction SilentlyContinue).Free",
                        &drive[..1]
                    ),
                ],
            )
            .and_then(|text| text.trim().parse::<f64>().ok())
            .map(|bytes| (bytes / 1_073_741_824.0 * 10.0).round() / 10.0);
        }
    }

    Ok(json!({
        "gpus": gpus,
        "ramGb": ram_gb,
        "diskFreeGb": free_gb,
        "enginesDir": engines_dir.to_string_lossy(),
    }))
}
