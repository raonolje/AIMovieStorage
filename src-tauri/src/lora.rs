//! **로라 살림** — 찾고, 받고, 폴더에 정리합니다.
//!
//!
//!
//! # 왜 폴더를 우리가 쥐는가
//!
//! 여태는 사용자가 어딘가에 받아 둔 `.safetensors` 의 **경로만** 기억했습니다. 그러면
//! 「무엇을 갖고 있는지」 를 앱이 모르고, 파일을 옮기면 조용히 끊기고, 고를 목록을 만들
//! 수도 없습니다. 이제 **엔진별 폴더**에 받아 둡니다.
//!
//! ```text
//! <앱 데이터>/local/loras/<엔진 id>/<파일>.safetensors
//! ```
//!
//! 엔진으로 폴더를 가르는 까닭은 로라가 **학습한 모델의 구조에 묶여** 있기 때문입니다.
//! Wan 로라를 LTX 에 먹이면 「키가 안 맞는다」 며 로딩이 통째로 실패합니다. 폴더가 갈려
//! 있으면 목록을 만들 때 실수할 자리가 없습니다.
//!
//! # 어디서 찾는가
//!
//! **Civitai** 한 곳입니다. 영상·그림 로라가 실제로 모여 있는 데가 거기고, 검색 API 가
//! 열쇠 없이 열려 있습니다. 거기 없는 것(허깅페이스 등)은 **주소를 직접 넣어** 받습니다 —
//! 검색을 못 한다고 받을 길까지 막을 이유는 없습니다.
//!
//! 검색을 Rust 에서 하는 까닭은 웹뷰에서 바로 부르면 CORS 에 걸리기 때문입니다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

type Res<T> = Result<T, String>;

fn err(what: &str, e: impl std::fmt::Display) -> String {
    format!("{what}: {e}")
}

/// 로라를 둘 폴더. 엔진마다 하나씩.
///
/// 엔진 id 는 `upscale::known_engine` **한 문**을 지납니다. 아는 id 만 경로가 되니 `..` 같은 경로 조작은
/// 거기서 막히고, 공개판에서 빠진 엔진은 「이 판에는 포함되지 않은 엔진입니다」 로 막힙니다. 여기서
/// 글자만 따로 거르던 때는 화면이 안 물어봐도 옛 프런트·저장된 프로젝트가 `anima` 를 들고 오면
/// 공개판이 그 로라 폴더를 만들고 받기까지 했습니다 — 설치·실행과 판 규칙이 두 벌이었던 셈입니다.
fn lora_dir(app: &AppHandle, engine: &str) -> Res<PathBuf> {
    let engine = crate::upscale::known_engine(engine)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| err("앱 데이터 폴더를 찾지 못했습니다", e))?;
    let dir = base.join("local").join("loras").join(engine);
    fs::create_dir_all(&dir).map_err(|e| err("로라 폴더를 만들지 못했습니다", e))?;
    Ok(dir)
}

/// 파일 이름에서 폴더를 벗어날 여지를 걷어냅니다. 받은 이름은 남의 것입니다.
fn safe_file(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("lora")
        .trim()
        .to_string();
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
        .collect();
    let cleaned = cleaned.trim_matches('.').to_string();
    if cleaned.is_empty() {
        "lora.safetensors".into()
    } else if cleaned.ends_with(".safetensors") || cleaned.ends_with(".ckpt") {
        cleaned
    } else {
        format!("{cleaned}.safetensors")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoraFile {
    pub engine: String,
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
}

/// 받아 둔 로라 전부. **폴더가 진실입니다** — 목록에 있는데 파일이 없으면 없는 것입니다.
#[tauri::command]
pub fn lora_files(app: AppHandle, engines: Vec<String>) -> Res<Vec<LoraFile>> {
    let mut out = Vec::new();
    for engine in engines {
        let Ok(dir) = lora_dir(&app, &engine) else { continue };
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            // 받다 만 것은 안 보여 줍니다 — 고르면 로딩이 실패합니다.
            // 꼬리는 받는 쪽이 정합니다(`download::PARTIAL_SUFFIX`) — 여기 글자로 못 박으면 갈립니다.
            if name.is_empty() || crate::download::is_partial(&name) {
                continue;
            }
            out.push(LoraFile {
                engine: engine.clone(),
                file_name: name,
                path: path.to_string_lossy().to_string(),
                size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| (a.engine.clone(), a.file_name.clone()).cmp(&(b.engine.clone(), b.file_name.clone())));
    Ok(out)
}

/// 프리셋의 허용 해시는 Python 워커와 같은 자료를 읽습니다.
fn h3_preset_for_hash(hash: &str) -> Res<Option<String>> {
    let preset: Value = serde_json::from_str(include_str!("../resources/local/h3-ref2va-preset.json"))
        .map_err(|e| err("프리셋 규약을 읽지 못했습니다", e))?;
    Ok((preset["sha256"].as_str() == Some(hash)).then(|| preset["id"].as_str().unwrap_or("").to_owned()))
}

fn selected_lora_path(dir: &Path, name: &str) -> Res<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\', ':', '\0']) || !name.ends_with(".safetensors") {
        return Err("로라 폴더 안의 safetensors 파일만 확인할 수 있습니다.".into());
    }
    let base = fs::canonicalize(dir).map_err(|e| err("로라 폴더를 읽지 못했습니다", e))?;
    let path = fs::canonicalize(base.join(name)).map_err(|e| err("로라 파일을 찾지 못했습니다", e))?;
    if path.parent() != Some(base.as_path()) || !path.is_file() {
        return Err("로라 폴더 밖의 파일은 확인할 수 없습니다.".into());
    }
    Ok(path)
}

fn hash_selected_lora(path: &Path) -> Res<String> {
    use std::io::Read;
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path).map_err(|e| err("로라를 읽지 못했습니다", e))?;
    let before = file.metadata().map_err(|e| err("로라 정보를 읽지 못했습니다", e))?;
    if before.len() == 0 { return Err("로라 파일이 비어 있습니다.".into()); }
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| err("로라 검증에 실패했습니다", e))?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    let after = fs::metadata(path).map_err(|e| err("로라가 변경되었습니다", e))?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("검증 중 로라가 바뀌었습니다. 다시 선택해 주세요.".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}

/// 선택한 H3 파일 한 개만 비동기로 검사합니다. 실행 직전에는 워커가 다시 검사합니다.
#[tauri::command]
pub async fn lora_verify_h3_preset(app: AppHandle, file_name: String) -> Res<Option<String>> {
    let dir = lora_dir(&app, "minimaxh3")?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = selected_lora_path(&dir, &file_name)?;
        h3_preset_for_hash(&hash_selected_lora(&path)?)
    }).await.map_err(|e| err("로라 검증 작업에 실패했습니다", e))?
}

#[tauri::command]
pub fn lora_delete(app: AppHandle, engine: String, file_name: String) -> Res<()> {
    let dir = lora_dir(&app, &engine)?;
    /*
      **폴더 밖은 건드리지 않습니다.** 받은 이름을 그대로 믿고 지우면 `..\..` 하나로
      엉뚱한 곳이 날아갑니다(이 저장소가 그 사고 뒤에 복원된 것입니다).

      다만 `safe_file` 로 고쳐 쓰지는 않습니다 — 목록(`lora_files`)은 폴더의 이름 그대로를
      보여 주므로, 지울 때 이름을 바꾸면 「확인 창에 보인 파일」 과 「실제로 지워지는 파일」 이
      갈립니다(손으로 넣은 `foo.pt` 가 `foo.pt.safetensors` 로 바뀌어 못 지우거나 딴 것을 지움).
      그래서 폴더를 벗어날 수 있는 이름만 막고, 나머지는 있는 그대로 찾습니다.
    */
    if file_name.is_empty() || file_name == "." || file_name == ".." || file_name.contains(['/', '\\']) {
        return Err("그 로라 파일을 찾지 못했습니다.".into());
    }
    let path = dir.join(&file_name);
    if path.parent() != Some(dir.as_path()) || !path.is_file() {
        return Err("그 로라 파일을 찾지 못했습니다.".into());
    }
    fs::remove_file(&path).map_err(|e| err("로라를 지우지 못했습니다", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// 내려받기
// ─────────────────────────────────────────────────────────────────────────────

fn beat(app: &AppHandle, engine: &str, file: &str, percent: Option<f64>, message: &str) {
    let _ = app.emit(
        "lora-progress",
        json!({
            "engine": engine,
            "file": file,
            "percent": percent,
            "message": message,
            "done": false,
            "error": Value::Null,
        }),
    );
}

fn beat_done(app: &AppHandle, engine: &str, file: &str, error: Option<&str>) {
    let _ = app.emit(
        "lora-progress",
        json!({
            "engine": engine,
            "file": file,
            "percent": if error.is_some() { Value::Null } else { json!(100) },
            "message": error.unwrap_or(""),
            "done": true,
            "error": error.map(|e| json!(e)).unwrap_or(Value::Null),
        }),
    );
}

/// **실제로 받는 몸통.** 폴더·주소·파일 이름만 받고, 진행은 `beat(퍼센트, 말)` 로 돌려줍니다.
///
/// `lora_download` 에서 갈라낸 까닭: 그쪽은 `AppHandle` 로 폴더를 구하고 이벤트를 쏘는데,
/// `AppHandle` 은 앱을 띄우지 않으면 만들 수 없어서 **시험이 불가능**했습니다. 받는 흐름은
/// 앱과 무관하니 여기 두고, `cargo test` 가 진짜 Civitai 를 상대로 돌려 봅니다(`live_tests`).
///
/// 2026-09-18: 받는 일 자체는 **엔진 가중치와 같은 한 벌**(`download.rs`)이 합니다.
/// 예전에는 여기가 따로 적혀 있어서 **이어받기가 없었습니다.** 로라는 파일 하나가 수 GB 라
/// 90% 에서 끊기면 처음부터 다시 받아야 했습니다. 이제 이어받고, 다 받으면 크기를 확인한 뒤에야
/// 제 이름이 됩니다(받는 중에는 `<이름>.내려받는중` — 목록에 안 뜹니다).
async fn download_into(
    dir: &Path,
    url: &str,
    file_name: &str,
    beat: impl Fn(Option<f64>, &str),
) -> Res<PathBuf> {
    // 받은 이름은 남의 것입니다 — 부르는 쪽이 이미 걸렀어도 여기서 한 번 더(두 번 걸러도 같은 값).
    let name = safe_file(file_name);
    let dest = dir.join(&name);
    /*
      ── 주소에 맞는 키를 붙입니다 ────────────────────────────────────────
       Civitai 는 상당수 로라를 로그인한
      계정에만 내주고, 프로그램에 허용된 로그인은 API 키뿐입니다. 설정에 넣어 둔 키
      (`civitai.key`·`huggingface.key`, `llm.rs` 의 키 저장소)를 주소의 주인에 맞춰 고릅니다 —
      Civitai 키를 허깅페이스에 보내면 안 되니 호스트로 가립니다.
    */
    let host = url.split('/').nth(2).unwrap_or("").to_lowercase();
    let (provider, site) = if host.ends_with("civitai.com") {
        (Some("civitai"), "Civitai")
    } else if host.ends_with("huggingface.co") || host.ends_with("hf.co") {
        (Some("huggingface"), "허깅페이스")
    } else {
        (None, "")
    };
    let bearer = provider.and_then(|p| crate::llm::read_api_key(p).ok());
    let login_hint = match (provider, bearer.is_some()) {
        (Some("civitai"), false) => "이 로라는 Civitai 로그인이 필요합니다. 설정 → 로라 칸에 Civitai API 키를 넣으면 앱이 자동으로 로그인해 받습니다(civitai.com → 계정 → API Keys).".to_string(),
        (Some("huggingface"), false) => "이 저장소는 허깅페이스 토큰이 필요합니다. 설정 → 로라 칸에 토큰(hf_…)을 넣으면 앱이 자동으로 로그인해 받습니다.".to_string(),
        (Some(_), true) => format!("{site} 가 저장된 키를 거부했습니다(만료·권한). 설정 → 로라 칸에서 새 키로 바꿔 주세요."),
        _ => "이 파일은 로그인해야 받을 수 있습니다. 브라우저에서 직접 받은 뒤 «파일 고르기» 로 넣어 주세요.".to_string(),
    };
    crate::download::fetch(
        crate::download::Download {
            url,
            dest: &dest,
            label: &name,
            // Civitai 는 sha256·크기를 검색 결과에 주기도 하지만 주소를 직접 넣는 길도
            // 있어서, 받기 전에 «맞는 값» 을 늘 알 수는 없습니다. 아는 것만 확인합니다.
            expected_sha: None,
            expected_size: None,
            login_hint: Some(login_hint.as_str()),
            bearer,
        },
        |tick| {
            if tick.verifying {
                return;
            }
            beat(
                tick.percent,
                &format!("{} 받음", crate::download::human(tick.written)),
            );
        },
        // 로라 받기에는 아직 «멈추기» 가 없습니다. 생기면 여기에 깃발을 답니다.
        || false,
    )
    .await?;
    Ok(dest)
}

/// 주소 하나를 받아 엔진 폴더에 놓습니다. 진행은 `lora-progress` 로 흘립니다.
/// 받는 일 자체는 `download_into` 가 합니다 — 여기서는 폴더를 구하고 이벤트만 쏩니다.
#[tauri::command]
pub async fn lora_download(
    app: AppHandle,
    engine: String,
    url: String,
    file_name: String,
) -> Res<String> {
    if !url.starts_with("https://") {
        return Err("https 주소만 받습니다.".into());
    }
    let dir = lora_dir(&app, &engine)?;
    let name = safe_file(&file_name);
    let dest = dir.join(&name);
    if dest.is_file() {
        return Ok(dest.to_string_lossy().to_string());
    }

    let result = download_into(&dir, &url, &name, |percent, message| {
        beat(&app, &engine, &name, percent, message)
    })
    .await;

    match result {
        Ok(path) => {
            beat_done(&app, &engine, &name, None);
            Ok(path.to_string_lossy().to_string())
        }
        Err(message) => {
            beat_done(&app, &engine, &name, Some(&message));
            Err(message)
        }
    }
}

/// 사용자가 브라우저로 직접 받아 둔 파일을 폴더로 들입니다.
#[tauri::command]
pub fn lora_import(app: AppHandle, engine: String, source: String) -> Res<String> {
    let from = PathBuf::from(&source);
    if !from.is_file() {
        return Err("그 파일을 찾지 못했습니다.".into());
    }
    let dir = lora_dir(&app, &engine)?;
    let name = safe_file(from.file_name().and_then(|n| n.to_str()).unwrap_or("lora"));
    let dest = dir.join(&name);
    // 큰 파일이라 **복사가 아니라 이동** 이 낫지만, 원본을 없애는 일은 하지 않습니다.
    fs::copy(&from, &dest).map_err(|e| err("로라를 폴더로 들이지 못했습니다", e))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 파일 고르기 창. 웹의 `<input type=file>` 은 **경로를 안 주므로** 여기서 고릅니다.
#[tauri::command]
pub fn lora_pick_files() -> Res<Vec<String>> {
    let picked = rfd::FileDialog::new()
        .set_title("로라 파일을 고르세요")
        .add_filter("로라", &["safetensors", "ckpt"])
        .pick_files()
        .unwrap_or_default();
    Ok(picked
        .into_iter()
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

// ─────────────────────────────────────────────────────────────────────────────
// 찾기 — Civitai
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoraHit {
    pub id: String,
    pub name: String,
    /// 어느 밑모델용인가 — 「Wan Video 2.2」 처럼. 엔진과 안 맞으면 로딩이 실패합니다.
    pub base_model: String,
    pub file_name: String,
    pub download_url: String,
    /// 그 로라의 **소개 쪽** 주소. 무엇을 하는 로라인지·예시 그림·쓰는 법이 거기 있습니다.
    pub page_url: String,
    pub size_bytes: u64,
    /// 만든 사람이 적어 둔 **불러오는 말**. 이게 없으면 로라가 안 먹는 일이 흔합니다.
    pub trigger: String,
    pub downloads: u64,
    pub nsfw: bool,
    /// 어디서 찾았는가 — "civitai" | "huggingface". 화면이 표시로 답니다.
    pub source: String,
    /// 만든 사람이 소개 글에 권장 세기(「recommended strength 0.7」). 없으면 1 로 받습니다.
    pub advised_weight: Option<f64>,
}

/// HTML 태그를 걷어냅니다 — Civitai 소개 글은 HTML 이라 숫자 앞에 `<p>` 가 붙어 있습니다.
fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
}

/// 창 안에서 «세기로 믿을 만한» 첫 숫자.
///
/// 숫자라고 다 세기가 아닙니다 — 「1.2 GB」(크기)·「v1.5」(판)·「Krea 2」(엔진 이름의 정수)가
/// 같은 창에 흔히 섞입니다. 그래서 단위가 붙은 것과 v 뒤의 것은 건너뛰고, 정수는 1 만
/// 믿습니다(세기 2 를 권하는 일은 없고 「H3」「LTX 2」 의 숫자는 흔합니다). 소수는 0.05~2 —
/// 0.001 같은 값은 로라를 끄는 것이지 세기가 아닙니다.
fn plausible_weight(window: &str) -> Option<f64> {
    let chars: Vec<char> = window.chars().collect();
    let digit_at = |i: usize| chars.get(i).map_or(false, |c| c.is_ascii_digit());
    let mut i = 0;
    while i < chars.len() {
        if !(chars[i].is_ascii_digit() || (chars[i] == '.' && digit_at(i + 1))) {
            i += 1;
            continue;
        }
        let begin = i;
        let mut dotted = false;
        while i < chars.len()
            && (chars[i].is_ascii_digit() || (chars[i] == '.' && !dotted && digit_at(i + 1)))
        {
            dotted |= chars[i] == '.';
            i += 1;
        }
        let token: String = chars[begin..i].iter().collect();
        let version = begin > 0 && chars[begin - 1] == 'v';
        let rest: String = chars[i..].iter().skip_while(|c| c.is_whitespace()).take(2).collect();
        let unit = ["gb", "mb", "kb", "%", "x"].iter().any(|u| rest.starts_with(u));
        if version || unit {
            continue;
        }
        if let Ok(v) = token.parse::<f64>() {
            let fits = if dotted { (0.05..=2.0).contains(&v) } else { v == 1.0 };
            if fits {
                return Some(v);
            }
        }
    }
    None
}

/// 만든 사람이 권장한 세기를 소개 글에서 읽습니다.
///
/// 무조건 1 로 놓으면 화풍 로라는
/// 대개 세게 먹습니다. Civitai 소개는 «recommended model strength is 0.7» 처럼 적어 두므로
/// 「strength/weight/세기」 낱말 뒤 32자 창에서 세기다운 숫자(`plausible_weight`)를 찾습니다.
/// 자리가 여럿이면 **글에서 먼저 나온 자리**를 씁니다 — 낱말 순서로 고르면 「LoRA weight 0.8 …
/// denoising strength 0.35」 에서 0.35 를 집습니다. denoising·cfg·guidance 뒤의 strength 는
/// 로라 세기가 아니고, «weight_decay» 처럼 글자가 이어지는 것도 다른 말입니다.
fn advised_weight(html: &str) -> Option<f64> {
    let text = strip_tags(html).to_lowercase();
    let mut best: Option<(usize, f64)> = None;
    for key in ["strength", "weight", "세기"] {
        let mut from = 0;
        while let Some(pos) = text[from..].find(key) {
            let at = from + pos;
            let mut end = at + key.len();
            from = end;
            // 낱말 경계 — 복수형 s 만 허용합니다.
            match text[end..].chars().next() {
                Some('s') => end += 1,
                Some(c) if c == '_' || c.is_ascii_alphabetic() => continue,
                _ => {}
            }
            let before: String = text[..at].chars().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect();
            if ["denois", "cfg", "guidance"].iter().any(|w| before.contains(w)) {
                continue;
            }
            let window: String = text[end..].chars().take(32).collect();
            if let Some(v) = plausible_weight(&window) {
                if best.map_or(true, |(seen, _)| at < seen) {
                    best = Some((at, v));
                }
                // 이 낱말의 뒤 자리는 볼 것 없습니다 — 더 앞 자리를 이미 잡았습니다.
                break;
            }
        }
    }
    best.map(|(_, v)| v)
}

/// 허깅페이스 저장소 하나에서 뽑은 것 — 검색 목록에는 파일이 없어 한 번 더 가서 읽습니다.
fn hf_hits_from_repo(repo: &Value, query_terms: &[String]) -> Vec<LoraHit> {
    let id = repo.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if id.is_empty() {
        return Vec::new();
    }
    let tags: Vec<String> = repo
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|list| list.iter().filter_map(|t| t.as_str()).map(str::to_string).collect())
        .unwrap_or_default();
    // «base_model:Comfy-Org/MiniMax-H3» 같은 태그에서 밑모델을 읽습니다(:adapter:·:finetune: 꼬리는 뺌).
    let base_model = tags
        .iter()
        .filter_map(|t| t.strip_prefix("base_model:"))
        .find(|rest| !rest.contains(':'))
        .map(str::to_string)
        .unwrap_or_else(|| "Hugging Face".to_string());
    let downloads = repo.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
    let hay = format!("{} {}", id, tags.join(" ")).to_lowercase();
    if !query_terms.is_empty() && !query_terms.iter().all(|t| hay.contains(t.as_str())) {
        return Vec::new();
    }
    let mut out = Vec::new();
    for file in repo.get("siblings").and_then(|v| v.as_array()).into_iter().flatten() {
        let Some(path) = file.get("rfilename").and_then(|v| v.as_str()) else { continue };
        if !path.to_lowercase().ends_with(".safetensors") {
            continue;
        }
        // 화면의 «받아 둠» 은 hit 의 이름과 폴더의 이름을 맞대 봅니다. 받을 때 `safe_file` 로
        // 바뀌는 이름이면 받아 두고도 「받기」 로 남으니, 여기서 미리 같은 규칙을 지납니다.
        let file_name = safe_file(path);
        out.push(LoraHit {
            id: format!("hf:{id}:{path}"),
            name: format!("{id} · {file_name}"),
            base_model: base_model.clone(),
            file_name,
            download_url: format!("https://huggingface.co/{id}/resolve/main/{path}"),
            page_url: format!("https://huggingface.co/{id}"),
            size_bytes: file.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
            trigger: String::new(),
            downloads,
            nsfw: false,
            source: "huggingface".to_string(),
            // 허깅페이스 목록에는 소개 글이 안 실려 옵니다 — 세기는 카드에서 봐야 합니다.
            advised_weight: None,
        });
        // 한 저장소에 체크포인트 판이 여럿(…_ckpt500·_ema)이면 목록이 그것으로 찹니다.
        if out.len() >= 6 {
            break;
        }
    }
    out
}

/// 허깅페이스에서 로라를 찾습니다.
///
/// MiniMax-H3 로라의 상당수(터보·가속·카메라
/// 무빙)가 Civitai 가 아니라 여기 있습니다. 검색어는 AND 로 붙고, `filter=lora` 는 태그를 안 단
/// 저장소(alibaba-pai/MiniMax-H3-Acc-LoRAs)를 놓치므로 «태그로 한 번, 이름에 lora 로 한 번» 찔러
/// 합칩니다. 목록에는 파일이 없어 저장소마다 한 번 더 가서(`?blobs=true`) .safetensors 를 읽습니다.
async fn search_huggingface(
    client: &reqwest::Client,
    query: &str,
    engine_search: &str,
    engine_terms: &[String],
) -> Vec<LoraHit> {
    let search = format!("{} {}", engine_search, query.trim()).trim().to_string();
    let mut repos: Vec<Value> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for (extra, tag) in [("", Some("lora")), (" lora", None)] {
        let mut request = client
            .get("https://huggingface.co/api/models")
            .query(&[("search", format!("{search}{extra}")), ("limit", "30".into()), ("sort", "downloads".into()), ("direction", "-1".into())]);
        if let Some(tag) = tag {
            request = request.query(&[("filter", tag)]);
        }
        let Ok(reply) = request.send().await else { continue };
        let Ok(list) = reply.json::<Value>().await else { continue };
        for repo in list.as_array().into_iter().flatten() {
            let id = repo.get("id").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }
            // 엔진 이름이 저장소 이름·태그에 있어야 «이 엔진 것» 입니다.
            let tags = repo.get("tags").and_then(|v| v.as_array()).map(|l| l.iter().filter_map(|t| t.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default().to_lowercase();
            let hay = format!("{id} {tags}");
            if engine_terms.iter().any(|t| hay.contains(t.as_str())) {
                repos.push(repo.clone());
            }
        }
    }
    repos.sort_by_key(|r| std::cmp::Reverse(r.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0)));
    let query_terms: Vec<String> = query.split_whitespace().map(|w| w.to_lowercase()).collect();
    let mut out = Vec::new();
    for repo in repos.iter().take(12) {
        let Some(id) = repo.get("id").and_then(|v| v.as_str()) else { continue };
        let Ok(reply) = client.get(format!("https://huggingface.co/api/models/{id}?blobs=true")).send().await else { continue };
        let Ok(detail) = reply.json::<Value>().await else { continue };
        out.extend(hf_hits_from_repo(&detail, &query_terms));
    }
    out
}

/// Civitai 에서 로라를 찾습니다.
///
/// `bases` 는 Civitai 의 밑모델 갈래 이름들(「Wan Video 2.2 I2V-A14B」 처럼 **정확히**).
/// `keywords` 는 갈래가 없는 엔진(MiniMax-H3·Z-Image·Krea)을 위해 밑모델·이름에 든 낱말로
/// 거르는 그물입니다. 둘 다 비면 전부 봅니다.
///
/// 2026-09-22 — 두 구멍이 있었습니다. ① 화면의 엔진→갈래 표에 세 엔진만 있어
/// MiniMax-H3 는 필터 없이 나갔고(Pony 로라가 쏟아짐), ② 갈래를 걸어도 여기서 **판(version)
/// 마다 밑모델을 다시 거르지 않아** 같은 로라의 다른 밑모델 판이 섞여 들어왔습니다.
/// Civitai 는 `baseModels` 를 여러 번 받고, 모르는 이름이면 0개를 돌려줍니다(실측).
#[tauri::command]
pub async fn lora_search(
    query: String,
    bases: Option<Vec<String>>,
    keywords: Option<Vec<String>>,
    // engine_hint 는 엔진 이름 검색어(「minimax h3」) — Civitai 의 «필터 없는 두 번째 찾기» 와
    // 허깅페이스 검색 둘 다에 앞세웁니다. hf_terms 는 허깅페이스 저장소 이름·태그에 있어야 하는
    // 낱말들. 비면 허깅페이스는 안 봅니다(엔진 낱말 없이는 온갖 저장소가 쏟아집니다).
    engine_hint: Option<String>,
    hf_terms: Option<Vec<String>>,
    nsfw: Option<bool>,
) -> Res<Vec<LoraHit>> {
    let bases: Vec<String> = bases
        .unwrap_or_default()
        .into_iter()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty())
        .collect();
    let keywords: Vec<String> = keywords
        .unwrap_or_default()
        .into_iter()
        .map(|k| k.trim().to_lowercase())
        .filter(|k| !k.is_empty())
        .collect();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| err("네트워크를 준비하지 못했습니다", e))?;
    /*
      ── Civitai 는 «갈래 필터 + 검색어» 를 같이 주면 0개를 돌려줍니다 ──────────
      2026-09-22 실측: `baseModels=MiniMax H3` 만 주면 10개, `query=turbo` 만 주면 10개,
      둘을 같이 주면 0개(Wan 도 같음). 예전 코드가 늘 둘을 같이 보냈으니 검색어를 넣고
      «이 엔진 것만» 을 켜면 언제나 «찾은 것이 없습니다» 였습니다 — 그물이 아니라 API 의 성질.

      그래서 검색어가 있으면 필터를 빼고 «엔진 이름 + 검색어» 와 «검색어» 로 두 번 찾아
      합친 뒤, 아래 `fits` 가 판마다 갈래를 거릅니다. 검색어가 없을 때만 필터를 씁니다.
    */
    let hide_nsfw = !nsfw.unwrap_or(false);
    let fetch = |params: Vec<(String, String)>| {
        let client = client.clone();
        async move {
            let mut request = client
                .get("https://civitai.com/api/v1/models")
                .query(&[("types", "LORA"), ("limit", "30"), ("sort", "Most Downloaded")]);
            for (key, value) in &params {
                request = request.query(&[(key.as_str(), value.as_str())]);
            }
            if hide_nsfw {
                request = request.query(&[("nsfw", "false")]);
            }
            let reply = request.send().await.map_err(|e| err("로라를 찾지 못했습니다", e))?;
            let status = reply.status();
            let value: Value = reply.json().await.map_err(|e| err("찾은 결과를 읽지 못했습니다", e))?;
            if !status.is_success() {
                return Err(format!("로라를 찾지 못했습니다({status})."));
            }
            Ok::<Vec<Value>, String>(value.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default())
        }
    };
    let hint = engine_hint.as_deref().map(str::trim).filter(|h| !h.is_empty());
    let q = query.trim();
    let mut calls: Vec<Vec<(String, String)>> = Vec::new();
    if q.is_empty() {
        if bases.is_empty() {
            calls.push(vec![]);
        } else {
            calls.push(bases.iter().map(|b| ("baseModels".to_string(), b.clone())).collect());
            // 갈래 필터가 놓치는 것(갈래를 잘못 적은 저장소)을 엔진 이름으로 한 번 더.
            if let Some(hint) = hint {
                calls.push(vec![("query".to_string(), hint.to_string())]);
            }
        }
    } else {
        if let Some(hint) = hint.filter(|_| !bases.is_empty() || !keywords.is_empty()) {
            calls.push(vec![("query".to_string(), format!("{hint} {q}"))]);
        }
        calls.push(vec![("query".to_string(), q.to_string())]);
    }
    let mut items: Vec<Value> = Vec::new();
    let mut seen_ids = std::collections::BTreeSet::new();
    let mut first_error: Option<String> = None;
    for params in calls {
        match fetch(params).await {
            Ok(list) => {
                for model in list {
                    let id = model.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                    if seen_ids.insert(id) {
                        items.push(model);
                    }
                }
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    if items.is_empty() {
        if let Some(e) = first_error {
            return Err(e);
        }
    }
    // 판 하나가 이 엔진 것인가 — 갈래가 맞거나, 갈래가 없는 엔진이면 낱말이 들어 있거나.
    let fits = |base_model: &str, text: &str| -> bool {
        if bases.is_empty() && keywords.is_empty() {
            return true;
        }
        if bases.iter().any(|b| b.eq_ignore_ascii_case(base_model)) {
            return true;
        }
        let hay = format!("{} {}", base_model, text).to_lowercase();
        keywords.iter().any(|k| hay.contains(k.as_str()))
    };

    let mut out = Vec::new();
    for model in items.iter() {
        let name = model.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let model_nsfw = model.get("nsfw").and_then(|v| v.as_bool()).unwrap_or(false);
        /*
          판(version)마다 밑모델이 다릅니다 — 같은 로라의 «Wan 2.1 판» 과 «Wan 2.2 판» 이
          한 항목 안에 있습니다. 그래서 **판을 하나씩** 내놓습니다. 사람이 엔진에 맞는
          것을 골라야 하니까요.
        */
        for version in model
            .get("modelVersions")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let base_model = version
                .get("baseModel")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let trigger = version
                .get("trainedWords")
                .and_then(|v| v.as_array())
                .map(|words| {
                    words
                        .iter()
                        .filter_map(|w| w.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let Some(file) = version
                .get("files")
                .and_then(|v| v.as_array())
                .and_then(|files| {
                    files
                        .iter()
                        .find(|f| {
                            f.get("name")
                                .and_then(|n| n.as_str())
                                .map(|n| n.ends_with(".safetensors"))
                                .unwrap_or(false)
                        })
                        .or_else(|| files.first())
                })
            else {
                continue;
            };
            let Some(url) = file.get("downloadUrl").and_then(|v| v.as_str()) else {
                continue;
            };
            let version_name = version.get("name").and_then(|v| v.as_str()).unwrap_or("");
            // 이 판이 엔진 것이 아니면 내놓지 않습니다 — Civitai 의 갈래 필터는 «모델» 단위라 판은 섞여 옵니다.
            if !fits(&base_model, &format!("{name} {version_name}")) {
                continue;
            }
            let model_id = model.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let version_id = version.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            // 권장 세기 — 판 소개에 먼저, 없으면 모델 소개에서.
            let advised = advised_weight(version.get("description").and_then(|v| v.as_str()).unwrap_or(""))
                .or_else(|| advised_weight(model.get("description").and_then(|v| v.as_str()).unwrap_or("")));
            out.push(LoraHit {
                id: format!("{model_id}:{version_id}"),
                /*
                  판까지 찍어 둡니다 — 같은 로라의 «Wan 2.1 판» 과 «2.2 판» 이 한 쪽에
                  있어서, 모델 쪽만 열면 어느 판을 받은 것인지 알 수 없습니다.
                */
                page_url: format!("https://civitai.com/models/{model_id}?modelVersionId={version_id}"),
                name: if version_name.is_empty() {
                    name.clone()
                } else {
                    format!("{name} · {version_name}")
                },
                base_model,
                // 허깅페이스 쪽과 같은 까닭 — 폴더에 놓일 이름 그대로를 화면에 줍니다.
                file_name: safe_file(file.get("name").and_then(|v| v.as_str()).unwrap_or("lora.safetensors")),
                download_url: url.to_string(),
                // Civitai 는 KB 단위 실수로 줍니다.
                size_bytes: file
                    .get("sizeKB")
                    .and_then(|v| v.as_f64())
                    .map(|kb| (kb * 1024.0) as u64)
                    .unwrap_or(0),
                trigger,
                downloads: model
                    .get("stats")
                    .and_then(|s| s.get("downloadCount"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                nsfw: model_nsfw,
                source: "civitai".to_string(),
                advised_weight: advised,
            });
        }
    }

    // 허깅페이스도 봅니다 — 실패해도 Civitai 결과는 살립니다(두 곳 중 한 곳이 느려도 찾기는 되게).
    if let (Some(search), Some(terms)) = (engine_hint.as_deref().filter(|s| !s.trim().is_empty()), hf_terms.as_ref()) {
        let terms: Vec<String> = terms.iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
        if !terms.is_empty() {
            out.extend(search_huggingface(&client, &query, search, &terms).await);
        }
    }
    Ok(out)
}

/// 폴더를 탐색기로 엽니다 — 직접 넣고 싶을 때.
#[tauri::command]
pub fn lora_open_folder(app: AppHandle, engine: String) -> Res<()> {
    let dir = lora_dir(&app, &engine)?;
    open_dir(&dir)
}

fn open_dir(dir: &Path) -> Res<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(dir)
            .spawn()
            .map_err(|e| err("폴더를 열지 못했습니다", e))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
            .arg(dir)
            .spawn()
            .map_err(|e| err("폴더를 열지 못했습니다", e))?;
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 살아 있는 시험 — 진짜 Civitai 에 붙습니다. 평소엔 건너뛰고 `--ignored` 로만 돕니다.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 찾기 → 제일 작은 것(60MB 이하) 하나 받기 → 크기가 맞고 받다 만 조각이 안 남는지.
    ///
    /// 네트워크와 Civitai 사정에 매이므로 `#[ignore]` 입니다. 받은 파일은 %TEMP% 아래
    /// `frameforge-test/loras/` 에 둡니다 — 앱 데이터 폴더는 건드리지 않습니다.
    /// 허깅페이스 검색이 실제로 «이 엔진 것» 을 돌려주는지 — 2026-09-22
    /// MiniMax H3 는 Civitai 갈래(「MiniMax H3」)와 허깅페이스 저장소가 둘 다 있어 두 출처를 한 번에 봅니다.
    #[tokio::test]
    #[ignore]
    async fn huggingface_search_minimax_h3() {
        let hits = lora_search(
            "turbo".into(),
            Some(vec!["MiniMax H3".into()]),
            None,
            Some("minimax h3".into()),
            Some(vec!["minimax-h3".into(), "minimax_h3".into(), "minimaxh3".into()]),
            Some(false),
        )
        .await
        .expect("찾기");
        let hf: Vec<&LoraHit> = hits.iter().filter(|h| h.source == "huggingface").collect();
        let civ: Vec<&LoraHit> = hits.iter().filter(|h| h.source == "civitai").collect();
        println!("civitai {}개 · huggingface {}개", civ.len(), hf.len());
        for h in hf.iter().take(5) {
            println!("  HF  {} · {} · {} MB · {}", h.name, h.base_model, h.size_bytes / 1_000_000, h.download_url);
        }
        for h in civ.iter().take(3) {
            println!("  CIV {} · {}", h.name, h.base_model);
        }
        assert!(!hf.is_empty(), "허깅페이스에서 하나도 못 찾음");
        assert!(hf.iter().all(|h| h.download_url.contains("huggingface.co/") && h.download_url.contains("/resolve/main/")));
        assert!(hf.iter().all(|h| h.name.to_lowercase().contains("minimax") || h.base_model.to_lowercase().contains("minimax")));
        assert!(civ.iter().all(|h| h.base_model == "MiniMax H3"), "Civitai 판이 다른 갈래를 섞음");
    }

    #[tokio::test]
    #[ignore]
    async fn civitai_search_then_download_smallest() {
        let hits = lora_search("lineart".into(), None, None, None, None, Some(false))
            .await
            .expect("Civitai 검색이 실패했습니다");
        eprintln!("검색 결과 {}건", hits.len());
        assert!(!hits.is_empty(), "검색 결과가 비었습니다");

        // 작은 순으로 — 제일 작은 것이 로그인을 요구하면 그 다음 것으로 넘어갑니다.
        let mut candidates: Vec<&LoraHit> = hits
            .iter()
            .filter(|h| h.size_bytes > 0 && h.size_bytes <= 60_000_000)
            .collect();
        candidates.sort_by_key(|h| h.size_bytes);
        assert!(!candidates.is_empty(), "60MB 이하 후보가 없습니다");

        let dir = std::env::temp_dir().join("frameforge-test").join("loras");
        fs::create_dir_all(&dir).expect("시험 폴더를 만들지 못했습니다");

        let mut done: Option<(&LoraHit, PathBuf)> = None;
        for pick in candidates.iter().take(3) {
            eprintln!(
                "고른 것: {} · {} · {} bytes · {}",
                pick.name, pick.file_name, pick.size_bytes, pick.download_url
            );
            let name = safe_file(&pick.file_name);
            // 지난 시험이 남긴 것이면 새로 받아야 뜻이 있습니다.
            let _ = fs::remove_file(dir.join(&name));
            match download_into(&dir, &pick.download_url, &pick.file_name, |percent, message| {
                eprintln!("  진행 {:?} · {}", percent.map(|p| p.round()), message)
            })
            .await
            {
                Ok(path) => {
                    done = Some((pick, path));
                    break;
                }
                Err(message) => eprintln!("  못 받음: {message}"),
            }
        }
        let (pick, path) = done.expect("후보 셋 다 받지 못했습니다");

        let got = fs::metadata(&path).expect("받은 파일이 없습니다").len();
        eprintln!("받은 파일 {} · {} bytes (Civitai 가 말한 크기 {})", path.display(), got, pick.size_bytes);
        let expected = pick.size_bytes as f64;
        assert!(
            (got as f64 - expected).abs() <= expected * 0.05,
            "크기가 어긋납니다: 받은 {got} · 말한 {}",
            pick.size_bytes
        );
        let temp = dir.join(format!(
            "{}.{}",
            safe_file(&pick.file_name),
            crate::download::PARTIAL_SUFFIX
        ));
        assert!(!temp.exists(), "받다 만 조각이 남았습니다: {}", temp.display());
    }
}

#[cfg(test)]
mod advised_weight_tests {
    use super::advised_weight;

    /// 2026-09-22 Civitai 실측 문구 — 「Minimax H3 Cinematic」 로라 둘의 소개 글이 앞의 둘입니다.
    #[test]
    fn reads_recommended_strength_from_html() {
        assert_eq!(
            advised_weight("<p>The recommended model strength is 0.7; for segments with high motion, it is advisable to lower this to 0.5.</p>"),
            Some(0.7)
        );
        assert_eq!(
            advised_weight("<p>Recommended Model Strength: 0.7 for standard shots; around 0.5 for high-motion</p>"),
            Some(0.7)
        );
        assert_eq!(advised_weight("weight: 0.6-0.8 works best"), Some(0.6));
        assert_eq!(advised_weight("Strength. Use 0.7 for best results"), Some(0.7));
        assert_eq!(advised_weight("weight: 1"), Some(1.0));
        assert_eq!(advised_weight("권장 세기는 0.75 입니다"), Some(0.75));
    }

    /// 엔진 이름의 정수·판 번호는 세기가 아닙니다 — 그 뒤의 진짜 값을 찾아야 합니다.
    #[test]
    fn skips_engine_numbers_and_versions_inside_the_window() {
        assert_eq!(advised_weight("Recommended strength for Krea 2: 0.7"), Some(0.7));
        assert_eq!(advised_weight("Recommended strength for MiniMax H3: 0.7"), Some(0.7));
        assert_eq!(advised_weight("Strength v1.5 is the latest; use 0.7"), Some(0.7));
    }

    /// 글에서 먼저 나온 자리가 이깁니다 — denoising strength 는 로라 세기가 아닙니다.
    #[test]
    fn earliest_lora_mention_wins_over_denoising() {
        assert_eq!(
            advised_weight("Recommended LoRA weight: 0.8. Hires fix denoising strength: 0.35"),
            Some(0.8)
        );
        assert_eq!(advised_weight("denoising strength 0.4 ... lora weight 0.8"), Some(0.8));
    }

    #[test]
    fn ignores_sizes_configs_tiny_values_and_missing() {
        assert_eq!(advised_weight("weight 200MB, trigger word DY"), None);
        assert_eq!(advised_weight("The LoRA weights are 1.2 GB"), None);
        assert_eq!(advised_weight("training: weight_decay 0.01, lr 1e-4"), None);
        assert_eq!(advised_weight("weight 0.001"), None);
        assert_eq!(advised_weight("<p>no numbers here</p>"), None);
        assert_eq!(advised_weight("strength of this lora is truly amazing, v2"), None);
    }
}

#[cfg(test)]
mod h3_preset_tests {
    use super::*;
    #[test]
    fn only_manifest_hash_enables_the_preset() {
        let manifest: Value = serde_json::from_str(include_str!("../resources/local/h3-ref2va-preset.json")).unwrap();
        assert_eq!(h3_preset_for_hash(manifest["sha256"].as_str().unwrap()).unwrap().as_deref(), manifest["id"].as_str());
        assert_eq!(h3_preset_for_hash("old-fl2va-artifact").unwrap(), None);
    }
    #[test]
    fn selected_file_is_streamed_and_cannot_escape_engine_folder() {
        let dir = std::env::temp_dir().join(format!("h3-preset-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("선택.safetensors");
        fs::write(&path, b"abc").unwrap();
        let selected = selected_lora_path(&dir, "선택.safetensors").unwrap();
        assert_eq!(hash_selected_lora(&selected).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        for name in ["../선택.safetensors", "..\\선택.safetensors", "C:outside.safetensors", "wrong.bin", ""] {
            assert!(selected_lora_path(&dir, name).is_err());
        }
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
