//! 앱의 Rust 명령 등록과 파일 작업.
//!
//! # 왜 파일 다루는 일을 전부 Rust 가 하는가
//!
//! 브라우저 쪽은 폴더를 못 만지고, blob 주소는 앱을 닫으면 죽습니다.
//! **폴더가 원본**이라는 것이 이 앱의 규칙이라, 저장·이름 바꾸기·지우기는
//! 전부 이쪽을 거칩니다.
//!
//! # 왜 LLM 호출도 Rust 인가
//!
//! 브라우저에서 직접 부르면 API 키가 개발자 도구에 그대로 보이고, 제공사
//! 서버가 CORS 로 막습니다. 키는 앱 설정 폴더에 두고 호출도 여기서 합니다.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 로컬 업스케일 엔진(설치·상주 워커·실행). ComfyUI 다리와는 별개입니다 —
/// 이 파일 아래쪽의 `comfy_*` 는 «외부 엔진» 으로 그대로 남습니다.
mod comfy;
mod asset_upload;
mod control;
pub use control::run_mcp;
mod datafiles;
mod download;
mod edition;
mod llm;
mod magnific;
mod local;
mod lora;
mod magnific_mcp;
/// 지운 것을 곧바로 없애지 않고 `.휴지통/` 에 한 단계 둡니다.
mod trash;
mod upscale;

// ─────────────────────────────────────────────────────────────────────────────
// 공용 도구
// ─────────────────────────────────────────────────────────────────────────────

pub(crate) type Res<T> = Result<T, String>;

/// **독이 묻은 자물쇠를 되살려 잠급니다.**
///
/// `Mutex` 는 잠근 스레드가 패닉하면 «독이 묻었다(poisoned)» 고 표시되고, 그 뒤의
/// `lock().unwrap()` 은 **전부 패닉**합니다. 워커 스레드 하나가 죽으면 그 자물쇠를
/// 쓰는 모든 명령이 줄줄이 죽어, 사용자 쪽에서는 「업스케일 한 번 실패한 뒤로 앱이
/// 아무것도 안 받는다」 로 보입니다. 앱을 닫을 때도 같은 자리에서 터집니다.
///
/// 여기서 지키는 값들은 **목록·손잡이 모음**이라, 중간에 패닉이 나도 «반쯤 고쳐진»
/// 상태가 될 뿐 못 읽을 값이 되지는 않습니다. 그래서 독을 무시하고 이어 갑니다.
///
/// 2026-09-18 점검: `upscale.rs` 에 이 처리가 **다섯 군데만** 있고 서른한 군데는
/// 그냥 `unwrap()` 이었습니다. 한 벌로 모읍니다(규칙 1).
pub(crate) trait LockSafe<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> LockSafe<T> for std::sync::Mutex<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(crate) fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

/// 파일 이름에 쓸 수 없는 글자를 밑줄로 바꿉니다.
///
/// 캐릭터 이름이 그대로 폴더 이름이 되기 때문에, 사람이 «냥이/겨울» 처럼
/// 적어 넣으면 경로가 갈라집니다. 한글은 그대로 둡니다 — 파일 이름이 곧
/// Magnific 태그라서 알파벳으로 바꿔 버리면 뜻을 잃습니다.
pub(crate) fn safe_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "이름없음".to_string();
    }
    let cleaned = trimmed
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect::<String>()
        .trim_matches('.')
        .to_string();
    /*
      점을 떼고 나서 한 번 더 봅니다.

      「.」「..」「...」 같은 이름은 위의 빈 검사를 통과한 뒤 여기서 빈 문자열이
      됐습니다. 빈 이름이 폴더 경로에 들어가면 `character/` 자체를 가리켜,
      인물 하나를 지우려다 **모든 인물 폴더** 가 지워집니다(2026-09-05 검증에서
      실제 재현). 이 저장소가 생긴 사고와 같은 모양이라 이중으로 막습니다.
    */
    if cleaned.is_empty() {
        return "이름없음".to_string();
    }
    cleaned
}

/// 폴더 이름으로 쓸 수 없는 소유자 이름을 걸러냅니다.
///
/// `safe_name` 이 대체 이름을 돌려주더라도, 지우기·옮기기처럼 되돌릴 수 없는
/// 명령은 «그런 인물은 없다» 로 끊는 편이 안전합니다.
fn owner_dir_name(name: &str) -> Res<String> {
    let cleaned = safe_name(name);
    if name.trim().is_empty() || cleaned.is_empty() || cleaned == "이름없음" && name.trim() != "이름없음" {
        return Err("폴더 이름으로 쓸 수 없는 이름입니다.".into());
    }
    Ok(cleaned)
}

pub(crate) fn project_root(base_directory: &str, project_name: &str) -> PathBuf {
    Path::new(base_directory).join(safe_name(project_name))
}

/// 지울 수 있는 그림·영상 확장자.
///
/// 목록에 없는 것은 지우지 않습니다. 프런트에서 경로를 잘못 넘겼을 때
/// 엉뚱한 파일이 날아가는 것을 막는 마지막 방어선입니다.
const DELETABLE: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "mp4", "mov", "webm", "avi", "mkv",
    // 음원 — BGM 프로젝트의 곡과 구도잡기 타임라인에 올린 노래가 여기 들어옵니다.
    "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus",
    "json", "txt", "md",
    // 시나리오·기획안 원본(`DOCU/`). 화면에서 지우면 폴더의 원본도 지웁니다(규칙 3).
    "pdf", "docx", "rtf", "csv",
];

pub(crate) fn extension_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| DELETABLE.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// **프로젝트 폴더 밖은 절대 건드리지 않습니다.**
///
/// 경로를 실제 경로로 펴서(심볼릭 링크·`..` 해석) 프로젝트 뿌리 안에 있는지
/// 확인합니다. 문자열 비교만 하면 `..\..\Windows` 같은 것이 통과합니다.
pub(crate) fn ensure_inside(root: &Path, target: &Path) -> Res<PathBuf> {
    let root = fs::canonicalize(root).map_err(|e| err("프로젝트 폴더를 찾지 못했습니다", e))?;
    let target = fs::canonicalize(target).map_err(|e| err("파일을 찾지 못했습니다", e))?;
    if !target.starts_with(&root) {
        return Err("프로젝트 폴더 밖의 파일은 건드리지 않습니다.".into());
    }
    Ok(target)
}

pub(crate) fn ensure_dir(path: &Path) -> Res<()> {
    fs::create_dir_all(path).map_err(|e| err("폴더를 만들지 못했습니다", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// 저장 폴더 고르기
// ─────────────────────────────────────────────────────────────────────────────

/// 폴더를 고릅니다.
///
/// `directory` 를 주면 **거기서 열립니다.** 지금 잡혀 있는 자리를 뻔히
/// 아는데 매번 드라이브 뿌리에서 찾아 들어가게 두면 안 됩니다.
#[tauri::command]
fn choose_storage_directory(directory: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().set_title("폴더를 고르세요");

    // 없는 경로를 주면 대화상자가 제 마음대로 다른 곳에서 엽니다.
    if let Some(start) = directory.as_deref().map(Path::new) {
        if start.is_dir() {
            dialog = dialog.set_directory(start);
        }
    }

    dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트 에셋 (그림·영상 파일)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAssetRequest {
    base_directory: String,
    project_name: String,
    /// "character-reference", "background-generated" 처럼 무엇의 어떤 파일인지.
    asset_type: String,
    /// 캐릭터·배경 이름. 이게 폴더 이름이 됩니다.
    owner_name: String,
    file_name: String,
    /// 파일 이름 앞부분. 없으면 owner_name 을 씁니다.
    stem: Option<String>,
    /// 주인 폴더 안의 하위 폴더. `6면` 과 `파노라마` 만 허용합니다 (`owner_subdir` 참고).
    subdir: Option<String>,
    /// 번호 `_NNN` 을 프런트가 정해서 줄 때. 없으면 «비어 있는 첫 번호» 를 붙입니다.
    ///
    /// 6면 세트는 여섯 파일이 **같은 번호** 여야 한 세트입니다. 이름이 `<접두>_<면>` 이라
    /// 면마다 따로 번호를 매기면, 앞 세트가 3장에서 끊겼거나 위 면 토큰이 «천장»→«하늘» 로
    /// 바뀐 뒤에는 면끼리 번호가 어긋나 한 번에 저장한 세트가 둘로 갈라졌습니다. 그래서
    /// 프런트가 세트 단위로 번호 하나를 정해 여섯 번 같은 값을 줍니다. 이미 있으면 덮어쓰지
    /// 않고 오류입니다.
    number: Option<u32>,
    #[serde(default)]
    bytes: Vec<u8>,
}

/// 파노라마에서 잘라낸 여섯 면이 들어가는 하위 폴더. 프런트 `faceSets.ts` 의 `SIX_FACES_DIR` 와 같은 값.
///
/// (2026-09-08). `ref/` 처럼
/// 주인 폴더 **안** 에 두어 이름 바꾸기·지우기가 주인 폴더 단위로 그대로 따라오게 합니다.
const SIX_FACES_DIR: &str = "6면";

/// 파노라마(돔) 원본이 들어가는 하위 폴더. 프런트 `faceSets.ts` 의 `PANORAMA_DIR` 와 같은 값.
///
///
/// 실외 방에 거는 것은 파노라마 한 장뿐인데, 한 폴더에 섞여 있으면 목록에서 가릴 길이 이름뿐이었습니다.
const PANORAMA_DIR: &str = "파노라마";

/// 하위 폴더 이름을 허용 목록으로만 받습니다.
///
/// `stem` 에 `6면/정면` 을 넣는 길은 없습니다 — `safe_name` 이 `/` 를 `_` 로 바꿉니다.
/// 그렇다고 아무 문자열이나 폴더로 받으면 `..` 로 주인 폴더 밖에 쓰게 되니, 이름을
/// 우리가 아는 것으로 좁힙니다. 새 하위 폴더가 필요하면 여기 목록에 더합니다.
fn owner_subdir(dir: &Path, subdir: Option<&str>) -> Res<PathBuf> {
    let Some(sub) = subdir.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(dir.to_path_buf());
    };
    const ALLOWED: &[&str] = &[SIX_FACES_DIR, PANORAMA_DIR];
    if sub.contains("..") || sub.contains('/') || sub.contains('\\') || !ALLOWED.contains(&sub) {
        return Err(format!("허용하지 않는 하위 폴더입니다: {sub}"));
    }
    Ok(dir.join(sub))
}

/// 갈래 이름을 «폴더 층» 으로 풉니다.
///
/// # 왜 이렇게 생겼나
///
/// 예전에는 갈래가 위, 인물이 아래였습니다.
///
/// 수화의 숲/character-reference/여울/여울_001.png
/// 수화의 숲/character-generated/여울/여울_001.png
///
/// 한 인물의 것이 갈래마다 흩어져서, 탐색기로 「여울」 을 보려면 폴더 두
/// 곳을 오가야 했습니다. 인물을 지우거나 이름을 바꿀 때도 두 곳을 건드려야
/// 했고요. 그래서 뒤집습니다 — **인물이 위, 갈래가 아래**입니다.
///
/// 수화의 숲/character/여울/ref/ref_여울_001.png
/// 수화의 숲/character/여울/여울_001.png
///
/// 생성물은 인물 폴더 바로 아래 놓습니다. 변형·시트·보유 에셋이 전부
/// 여기 모여서, 그 인물에 대한 것이 한 화면에 다 보입니다.
///
/// 돌려주는 것은 (인물 폴더까지의 경로, 그 아래 더 들어갈 폴더, 파일 접두).
fn asset_layout(category: &str) -> (&'static str, Option<&'static str>, bool) {
    match category {
        // (윗 폴더, 아랫 폴더, 파일 이름에 ref_ 를 붙이는가)
        "character-reference" => ("character", Some("ref"), true),
        "character-generated" => ("character", None, false),
        "background-reference" => ("background", Some("ref"), true),
        "background-generated" => ("background", None, false),
        // 공용 에셋은 **캐릭터 폴더 안** 「공용에셋」 에 둡니다. 사용자가 정한
        // 것입니다 — 「공용 에셋은 캐릭터 폴더에 생성해주면되고... 캐릭터 안에
        // 각 캐릭터 폴더, 공통에셋폴더」 (지시 256). 개별 인물 폴더가 아니라
        // 그 옆 자리라 인물을 지워도 같이 사라지지 않습니다.
        "asset-reference" => ("character/공용에셋", Some("ref"), true),
        "asset-generated" => ("character/공용에셋", None, false),
        "scene-cut" | "scene-video" => ("storyboard", None, false),
        /*
          **작품 대표 그림** — 프로젝트 보드 카드에 뜨는 한 장입니다().
          주인이 없는 갈래라 `cover/` 바로 아래에 놓입니다. 인물·장소 폴더에 섞으면
          이름 바꾸기(`rename_owner_tree`)의 사정거리에 들어가 엉뚱하게 따라 움직입니다.
        */
        "project-cover" => ("cover", None, false),
        /*
          BGM 은 **영상 프로젝트와 따로** 삽니다().
          프로젝트 이름을 `BGM` 으로 불러서 `<저장폴더>/BGM/곡/<BGM 프로젝트>/…` 와
          `<저장폴더>/BGM/업로드/<영상 프로젝트>/…` 두 자리가 생깁니다. 곡은 여러 영상 프로젝트에서
          돌려 쓰고, 구도잡기에 올린 음원은 어느 씬·컷의 것인지 파일 이름에 적어 둡니다.
        */
        "bgm-track" => ("곡", None, false),
        "bgm-upload" => ("업로드", None, false),
        /*
          모션 캡처에 올린 **영상**과 그 **분석 결과**. ,
          「프로젝트별로 관리가 되어야지, 나중에 내가 어떤 걸 분석했는지 알지」.
        */
        "mocap-video" | "mocap-result" => ("mocap", None, false),
        // 구도잡기 산출물은 컷 밑이 아니라 따로 모읍니다. 컷을 지워도 남아야
        // 하고, 다른 컷에서 다시 쓰는 일이 잦습니다.
        "composition-video" | "composition-glb" => ("composition", None, false),
        /*
          **시나리오·기획안 원본**().

          주인(인물·장소)이 없는 갈래라 `DOCU/` 바로 아래에 놓입니다 — 아래 `owner_dir` 이
          빈 주인을 건너뜁니다. 글은 프로젝트 파일에 들어가지만 **원본은 남겨 둡니다.**
          쪽번호가 섞였거나 표가 무너졌을 때 다시 열어 봐야 하고, 「무엇으로 만든 작품인가」 를
          나중에 되짚는 길이 그것뿐입니다.
        */
        "document" => ("DOCU", None, false),
        _ => ("etc", None, false),
    }
}

fn owner_dir(base: &str, project: &str, category: &str, owner: &str) -> PathBuf {
    let (top, sub, _) = asset_layout(category);
    let mut dir = project_root(base, project).join(top);
    /*
      주인 이름이 비면 **한 층 건너뜁니다.** 인물·장소가 없는 갈래(시나리오 원본 `DOCU/`)가
      있어서입니다. 예전에는 `safe_name("")` 이 「이름없음」 을 돌려줘 `DOCU/이름없음/` 이
      됐습니다 — 사람이 탐색기에서 보면 무엇인지 알 수 없는 폴더입니다.
    */
    if !owner.trim().is_empty() {
        dir = dir.join(safe_name(owner));
    }
    if let Some(sub) = sub {
        dir = dir.join(sub);
    }
    dir
}

/// 파일 이름 앞부분. 레퍼런스는 `ref_` 가 붙어 한눈에 갈립니다.
fn asset_stem(category: &str, stem: &str) -> String {
    let (_, _, prefixed) = asset_layout(category);
    let safe = safe_name(stem);
    if prefixed { format!("ref_{safe}") } else { safe }
}

/// 같은 이름이 있으면 뒤에 번호를 올려 붙입니다. `냥이_얼굴_001.png` → `_002`.
///
/// 덮어쓰지 않는 이유는 이 앱에서 같은 이름이 여러 장 나오는 게 정상이기
/// 때문입니다. 시트를 다시 뽑을 때마다 «겨울 의상» 이 새로 생깁니다.
pub(crate) fn next_numbered_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    for n in 1..10_000 {
        let candidate = dir.join(format!("{stem}_{n:03}.{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}_{}.{ext}", std::process::id()))
}

fn asset_destination(request: &SaveAssetRequest) -> Res<(PathBuf, String, String)> {
    let dir = owner_dir(
        &request.base_directory,
        &request.project_name,
        &request.asset_type,
        &request.owner_name,
    );
    // 6면은 `<주인>/6면/` 에. 갈래 층(`ref/`)이 있는 종류로 부르면 `ref/6면/` 이 되는데,
    // 여섯 면은 생성물이라 프런트가 늘 `-generated` 로 부릅니다.
    let dir = owner_subdir(&dir, request.subdir.as_deref())?;
    ensure_dir(&dir)?;

    let ext = Path::new(&request.file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();

    let stem = request
        .stem
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&request.owner_name);

    let full_stem = asset_stem(&request.asset_type, stem);
    Ok((dir, full_stem, ext))
}

#[tauri::command]
fn save_project_asset(request: SaveAssetRequest) -> Res<String> {
    let (dir, full_stem, ext) = asset_destination(&request)?;
    let path = match request.number {
        Some(n) => {
            let fixed = dir.join(format!("{full_stem}_{n:03}.{ext}"));
            if fixed.exists() {
                return Err(format!(
                    "같은 번호의 파일이 이미 있습니다: {}",
                    fixed.file_name().and_then(|s| s.to_str()).unwrap_or("")
                ));
            }
            fixed
        }
        None => next_numbered_path(&dir, &full_stem, &ext),
    };
    let mut file = fs::File::create(&path).map_err(|e| err("파일을 만들지 못했습니다", e))?;
    file.write_all(&request.bytes)
        .map_err(|e| err("파일을 쓰지 못했습니다", e))?;

    Ok(path.to_string_lossy().to_string())
}

/// 이미 **디스크에 있는 파일**을 프로젝트 폴더로 옮겨 담습니다.
///
///
/// 데스크톱에서 고른 영상은 경로만 기억하고 **복사를 안 하고 있었습니다** — 브라우저로
/// 열었을 때만 바이트가 앱을 지나가 `save_project_asset` 을 탔습니다. 그래서 프로젝트를
/// 통째로 옮기면 분석 결과만 남고 원본 영상은 남의 폴더에 있었습니다.
///
/// 바이트를 자바스크립트로 실어 나르지 않고 **Rust 가 바로 복사**합니다 — 영상은 수백 MB 라
/// 배열로 만들어 넘기면 메모리를 두 배로 먹습니다.
#[tauri::command]
fn import_project_asset(request: ImportAssetRequest) -> Res<String> {
    let source = Path::new(&request.source_path);
    if !source.is_file() {
        return Err(format!("파일을 찾지 못했습니다: {}", request.source_path));
    }
    let dir = owner_dir(
        &request.base_directory,
        &request.project_name,
        &request.asset_type,
        &request.owner_name,
    );
    ensure_dir(&dir)?;
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let stem = request
        .stem
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&request.owner_name);
    let path = next_numbered_path(&dir, &asset_stem(&request.asset_type, stem), &ext);
    /*
      같은 파일을 다시 담으면 번호만 올라갑니다. 옮기지 않고 **복사**하는 까닭:
      원본은 사용자의 다운로드 폴더에 있고, 그것이 사라지면 다른 프로젝트에서 다시 쓸 수 없습니다.
    */
    fs::copy(source, &path).map_err(|e| err("파일을 복사하지 못했습니다", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportAssetRequest {
    base_directory: String,
    project_name: String,
    asset_type: String,
    owner_name: String,
    stem: Option<String>,
    /// 디스크에 있는 원본 파일의 전체 경로.
    source_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceFile {
    id: String,
    name: String,
    file_path: String,
}

/// 폴더에 실제로 있는 파일을 읽어 옵니다.
///
/// **폴더가 원본입니다.** 앱이 들고 있는 목록만 보면, 탐색기에서 직접 넣은
/// 파일과 시트에서 잘라낸 칸을 놓칩니다.
///
/// `subdir` 를 주면(지금은 `6면` 만) 갈래 층(`ref/`)을 무시하고 `<주인>/<subdir>/` 를 읽습니다.
/// 여섯 면은 `-reference` 로 부르든 `-generated` 로 부르든 같은 자리에 있어야 하니까요.
/// 한 층만 읽고 재귀하지 않는 것은 그대로입니다 — 뿌리를 읽을 때 `ref/`·`6면/` 까지
/// 딸려 오면 같은 파일이 두 목록에 붙습니다.
#[tauri::command]
fn list_reference_files(
    base_directory: String,
    project_name: String,
    category: String,
    owner_name: String,
    subdir: Option<String>,
) -> Res<Vec<ReferenceFile>> {
    let dir = match subdir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(sub) => {
            let (top, _, _) = asset_layout(&category);
            let owner_root = project_root(&base_directory, &project_name)
                .join(top)
                .join(safe_name(&owner_name));
            owner_subdir(&owner_root, Some(sub))?
        }
        None => owner_dir(&base_directory, &project_name, &category, &owner_name),
    };
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut out = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| err("폴더를 읽지 못했습니다", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !extension_allowed(&path) {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let full = path.to_string_lossy().to_string();
        out.push(ReferenceFile {
            id: full.clone(),
            name,
            file_path: full,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/*
  delete_reference_file 은 지웠습니다.

  프로젝트 뿌리 개념 없이 확장자만 보고 디스크의 어떤 파일이든 지우는 명령이었고,
  화면에서는 한 번도 부르지 않았습니다. 지우기는 delete_project_media_file 처럼
  프로젝트 폴더 안인지 ensure_inside 로 확인하는 명령만 둡니다. (2026-09-05 검증)
*/

/// 프로젝트 폴더 안의 그림 하나를 지웁니다.
///
/// 화면에서 뺐는데 폴더에 남아 있으면, 다음에 폴더를 읽을 때 되살아납니다.
/// 그래서 화면에서 빼는 것과 파일을 지우는 것이 늘 같이 가야 합니다.
///
/// 다만 **곧바로 없애지는 않습니다.** 화면에서 빼는 일과 프로젝트 저장이 따로 돌아서,
/// 저장이 실패하면 «목록에는 남아 있는데 파일은 없는» 상태가 됩니다. `.휴지통/` 으로
/// 옮겨 두면 `restore_project_media_file` 로 되돌릴 수 있고, 정말 없애는 것은
/// 며칠 뒤 `empty_project_trash` 가 합니다.
#[tauri::command]
fn delete_project_media_file(
    base_directory: String,
    project_name: String,
    path: String,
) -> Res<()> {
    let root = project_root(&base_directory, &project_name);
    let target = ensure_inside(&root, Path::new(&path))?;
    if !extension_allowed(&target) {
        return Err("지울 수 있는 종류의 파일이 아닙니다.".into());
    }
    trash::move_to_trash(&root, &target)?;
    Ok(())
}

/// 생성 실패·취소의 빈 자리만 해제합니다. 일반 삭제는 결과까지 휴지통으로 옮기므로
/// 재사용하지 않습니다. 경계·종류·크기를 모두 확인한 파일 하나만 직접 치웁니다.
#[tauri::command]
fn release_empty_project_asset(
    base_directory: String,
    project_name: String,
    path: String,
) -> Res<bool> {
    let requested = Path::new(&path);
    let metadata = match fs::symlink_metadata(requested) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(err("예약 파일을 확인하지 못했습니다", error)),
    };
    if metadata.file_type().is_symlink() {
        return Err("링크는 생성 예약 파일로 정리하지 않습니다.".into());
    }
    let root = project_root(&base_directory, &project_name);
    let target = ensure_inside(&root, requested)?;
    if !extension_allowed(&target) {
        return Err("정리할 수 있는 종류의 예약 파일이 아닙니다.".into());
    }
    let metadata = fs::metadata(&target).map_err(|error| err("예약 파일을 확인하지 못했습니다", error))?;
    if !metadata.is_file() || metadata.len() != 0 {
        return Ok(false);
    }
    fs::remove_file(&target).map_err(|error| err("빈 예약 파일을 정리하지 못했습니다", error))?;
    Ok(true)
}

/// 캐릭터·배경 이름이 바뀌면 폴더 이름도 따라갑니다.
///
/// 옛 폴더 구조를 새 구조로 한 번 옮깁니다.
///
/// <프로젝트>/character-reference/여울/여울_001.png
/// → <프로젝트>/character/여울/ref/ref_여울_001.png
/// <프로젝트>/character-generated/여울/여울_001.png
/// → <프로젝트>/character/여울/여울_001.png
///
/// 갈래가 위, 인물이 아래였던 것을 **인물이 위, 갈래가 아래**로 뒤집습니다.
/// 한 인물의 것이 한 폴더에 모여야 탐색기로 봐도, 이름을 바꿔도, 지워도
/// 한 곳만 건드리면 됩니다.
///
/// 이미 옮긴 프로젝트에서는 아무 일도 하지 않습니다 (옛 폴더가 없음).
/// 돌려주는 것은 «옛 전체 경로 → 새 전체 경로» 입니다.
#[tauri::command]
fn migrate_project_layout(base_directory: String, project_name: String) -> Res<Vec<(String, String)>> {
    let root = project_root(&base_directory, &project_name);
    if !root.exists() {
        return Ok(vec![]);
    }

    const OLD: &[&str] = &[
        "character-reference",
        "character-generated",
        "background-reference",
        "background-generated",
        "asset-reference",
        "asset-generated",
        "scene-cut",
        "scene-video",
        "composition-video",
        "composition-glb",
    ];

    let mut moved = vec![];

    // 오늘 한 번 `<프로젝트>/asset/<에셋>/` 로 옮겼던 것을 사용자 지시대로
    // `<프로젝트>/character/공용에셋/<에셋>/` 로 다시 옮깁니다. 폴더째 옮기고
    // 안의 파일 짝을 돌려줍니다.
    let stray = root.join("asset");
    if stray.is_dir() {
        let target_root = root.join("character").join("공용에셋");
        if let Ok(entries) = fs::read_dir(&stray) {
            for entry in entries.flatten() {
                let from = entry.path();
                if !from.is_dir() {
                    continue;
                }
                let to = target_root.join(entry.file_name());
                if to.exists() {
                    continue;
                }
                let mut before: Vec<PathBuf> = vec![];
                collect_files(&from, &mut before);
                if ensure_dir(&target_root).is_err() || fs::rename(&from, &to).is_err() {
                    continue;
                }
                for old_path in before {
                    if let Ok(rel) = old_path.strip_prefix(&from) {
                        moved.push((
                            old_path.to_string_lossy().to_string(),
                            to.join(rel).to_string_lossy().to_string(),
                        ));
                    }
                }
            }
        }
        let _ = fs::remove_dir(&stray);
    }

    for category in OLD {
        let old_root = root.join(category);
        if !old_root.is_dir() {
            continue;
        }
        let (top, sub, prefixed) = asset_layout(category);
        let owners = match fs::read_dir(&old_root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for owner_entry in owners.flatten() {
            let owner_path = owner_entry.path();
            if !owner_path.is_dir() {
                continue;
            }
            let owner = owner_entry.file_name().to_string_lossy().to_string();
            let mut target = root.join(top).join(safe_name(&owner));
            if let Some(sub) = sub {
                target = target.join(sub);
            }
            ensure_dir(&target)?;

            let files = match fs::read_dir(&owner_path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for file_entry in files.flatten() {
                let src = file_entry.path();
                if !src.is_file() {
                    continue;
                }
                let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
                let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("png");
                // 레퍼런스에는 ref_ 를 붙입니다. 이미 붙어 있으면 그대로 둡니다.
                let named = if prefixed && !stem.starts_with("ref_") {
                    format!("ref_{stem}")
                } else {
                    stem.to_string()
                };
                let mut dst = target.join(format!("{named}.{ext}"));
                if dst.exists() {
                    dst = next_numbered_path(&target, &named, ext);
                }
                if fs::rename(&src, &dst).is_ok() {
                    moved.push((
                        src.to_string_lossy().to_string(),
                        dst.to_string_lossy().to_string(),
                    ));
                }
            }
            // 빈 껍데기만 지웁니다. 안에 무언가 남았으면 그대로 둡니다 —
            // 옮기지 못한 파일을 조용히 없애면 안 됩니다.
            let _ = fs::remove_dir(&owner_path);
        }
        let _ = fs::remove_dir(&old_root);
    }
    Ok(moved)
}

/// 이름 바꾸기 결과. 성공한 것과 실패한 것을 **둘 다** 돌려줍니다.
///
/// 예전에는 파일 하나가 막히면(마그니픽·탐색기 미리보기가 잡고 있는 등) 그 자리에서
/// `Err` 로 끊었습니다. 폴더는 이미 옮겨졌는데 화면은 옛 경로를 든 채 남아 썸네일이
/// 전부 깨졌습니다. 옮긴 것은 옮긴 대로 화면에 반영하고, 못 옮긴 것은 다음 저장 때
/// 다시 시도할 수 있게 따로 적어 줍니다.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct RenameOutcome {
    /// «옛 전체 경로 → 새 전체 경로»
    moved: Vec<(String, String)>,
    /// «지금 경로 → 이유». 파일은 그 자리에 그대로 있습니다.
    failed: Vec<(String, String)>,
}

/// 두 경로가 같은 파일·폴더를 가리키는가.
///
/// 윈도우는 대소문자를 구분하지 않아서 `Cat` → `cat` 처럼 대소문자만 바꾸면
/// «새 이름이 이미 있다» 로 보입니다. 실제 경로를 펴서 비교해야 «같은 것» 인지 압니다.
fn same_entry(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// `냥이_얼굴 정면_003` → (`냥이_얼굴 정면`, 번호 있음). 번호가 없으면 통째로 앞부분입니다.
fn stem_base(stem: &str) -> &str {
    match stem.rsplit_once('_') {
        Some((base, number)) if !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()) => base,
        _ => stem,
    }
}

/// 파일 하나의 이름을 바꿉니다. **절대 덮어쓰지 않습니다.**
///
/// - 목적지에 다른 파일이 있으면 번호를 올려 붙입니다 (`서리_얼굴 정면_002`).
/// - 목적지가 자기 자신(대소문자만 다름)이면 임시 이름을 거칩니다. 곧장 바꾸면
/// 윈도우가 «이미 있음» 으로 막습니다.
///
/// 돌려주는 것은 실제로 놓인 자리입니다.
pub(crate) fn rename_file_safely(from: &Path, to: &Path) -> Res<PathBuf> {
    if from == to {
        return Ok(from.to_path_buf());
    }
    let ext = to.extension().and_then(|e| e.to_str()).unwrap_or("png").to_string();
    let stem = to.file_stem().and_then(|s| s.to_str()).unwrap_or("파일").to_string();
    let dir = to.parent().map(Path::to_path_buf).unwrap_or_default();

    if to.exists() {
        if same_entry(from, to) {
            let temp = dir.join(format!("{stem}.__이름바꾸는중__.{ext}"));
            fs::rename(from, &temp).map_err(|e| err("파일 이름을 바꾸지 못했습니다", e))?;
            return match fs::rename(&temp, to) {
                Ok(()) => Ok(to.to_path_buf()),
                Err(e) => {
                    // 임시 이름으로 남겨 두면 파일이 «사라진» 것처럼 보입니다. 되돌립니다.
                    let _ = fs::rename(&temp, from);
                    Err(err("파일 이름을 바꾸지 못했습니다", e))
                }
            };
        }
        let unique = next_numbered_path(&dir, stem_base(&stem), &ext);
        fs::rename(from, &unique).map_err(|e| err("파일 이름을 바꾸지 못했습니다", e))?;
        return Ok(unique);
    }
    fs::rename(from, to).map_err(|e| err("파일 이름을 바꾸지 못했습니다", e))?;
    Ok(to.to_path_buf())
}

/// 인물 폴더 아래 파일을 전부 모읍니다. `ref/` 처럼 한 층 더 들어간 것까지.
///
/// 이름 바꾸기의 사정거리를 인물 폴더로 좁히려고 `magnific/`·`storyboard/`·`composition/`
/// 에는 들어가지 않습니다. 인물 폴더 안에 있을 일은 없지만, 후보함은 마그니픽이
/// 동기화하는 자리라 우리가 이름을 바꾸면 안 되고, 컷·구도 산출물은 인물 것이 아닙니다.
/// 휴지통도 건너뜁니다 — 지운 것의 이름을 따라 바꾸면 되살렸을 때 옛 이름으로 돌아옵니다.
fn collect_owner_files(dir: &Path, out: &mut Vec<PathBuf>) {
    const SKIP: &[&str] = &["magnific", "storyboard", "composition", trash::DIR];
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if SKIP.contains(&name.as_str()) {
                continue;
            }
            collect_owner_files(&path, out);
        } else if path.is_file() {
            out.push(path);
        }
    }
}

/// 빈 폴더만 지웁니다. 안에 무언가 남았으면 그대로 둡니다 — 옮기지 못한 파일을
/// 조용히 없애면 안 됩니다. 폴더를 옮기다 남은 껍데기를 치우는 용도라 재귀 삭제는 쓰지 않습니다.
fn remove_empty_dirs(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                remove_empty_dirs(&path);
            }
        }
    }
    let _ = fs::remove_dir(dir);
}

/// `<옛>_<나머지>.ext` → `<새>_<나머지>.ext`. 앞의 `ref_` 는 그대로 둡니다.
///
/// 예전 규칙은 «밑줄 + 숫자» 만 봐서 `냥이_001` 은 바뀌고 `냥이_얼굴 정면_001`·
/// `냥이_시트_001`·`냥이_겨울_001` 은 옛 이름을 그대로 들고 남았습니다. 파일 이름이
/// 곧 마그니픽 @태그라, 이름을 바꾼 뒤에도 태그는 옛 인물을 불렀습니다.
/// 이제 «옛 이름 + 밑줄» 로 시작하면 전부 따라갑니다. 규칙에 안 맞는 파일(사람이
/// 손으로 붙인 이름)은 건드리지 않습니다.
fn renamed_prefix(path: &Path, old: &str, new: &str) -> Option<PathBuf> {
    let stem = path.file_stem()?.to_str()?;
    let (prefix, rest) = match stem.strip_prefix("ref_") {
        Some(rest) => ("ref_", rest),
        None => ("", stem),
    };
    let remainder = rest.strip_prefix(old)?.strip_prefix('_')?;
    if remainder.is_empty() {
        return None;
    }
    let renamed = match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{prefix}{new}_{remainder}.{ext}"),
        None => format!("{prefix}{new}_{remainder}"),
    };
    Some(path.with_file_name(renamed))
}

/// 인물 폴더를 통째로 옮기고 그 안의 파일 이름도 함께 바꿉니다.
///
/// 예전에는 갈래마다 따로 불렀습니다. 그런데 새 구조에서는 레퍼런스가 인물
/// 폴더 **아래**에 있어서, 인물 폴더 하나만 옮기면 레퍼런스도 따라옵니다.
/// 갈래별로 부르면 두 번째 호출은 이미 없는 폴더를 찾게 되고, 그 결과를
/// «못 옮겼다» 로 읽어 화면 경로가 어긋났습니다.
///
/// character/여울/여울_001.png → character/서리/서리_001.png
/// character/여울/여울_얼굴 정면_001.png → character/서리/서리_얼굴 정면_001.png
/// character/여울/ref/ref_여울_001.png → character/서리/ref/ref_서리_001.png
///
/// 돌려주는 것은 «옛 전체 경로 → 새 전체 경로» 와, 막혀서 못 바꾼 것들입니다.
/// 화면이 들고 있는 filePath 를 이걸로 갈아 끼워야 썸네일이 안 깨집니다.
#[tauri::command]
/// `top` 은 "character" | "background" | "character/공용에셋" 중 하나입니다.
fn rename_owner_tree(
    base_directory: String,
    project_name: String,
    top: String,
    old_name: String,
    new_name: String,
) -> Res<RenameOutcome> {
    let root = project_root(&base_directory, &project_name);
    // top 은 "character/공용에셋" 처럼 두 층일 수 있습니다. 통째로 safe_name 을
    // 걸면 "/" 가 지워져 엉뚱한 폴더가 됩니다. 우리 코드가 주는 값이라 조각만 겁니다.
    let top_dir = top.split('/').fold(root.clone(), |acc, part| acc.join(safe_name(part)));
    // 빈 이름이면 from 이 top_dir 자신이 되어 character 폴더를 통째로 옮기게 됩니다.
    // 이름이 이상하면 아무것도 하지 않습니다.
    let (Ok(old_safe), Ok(new_safe)) = (owner_dir_name(&old_name), owner_dir_name(&new_name)) else {
        return Ok(RenameOutcome::default());
    };
    let from = top_dir.join(&old_safe);
    let to = top_dir.join(&new_safe);
    if !from.is_dir() || from == to || from == top_dir || to == top_dir {
        return Ok(RenameOutcome::default());
    }
    // 프로젝트 폴더 밖은 절대 건드리지 않습니다. 실제 경로로 펴서 확인합니다.
    ensure_inside(&root, &from)?;

    // 옛 자리를 먼저 적어 둡니다. 옮긴 뒤에는 읽을 수 없습니다.
    let mut before: Vec<PathBuf> = vec![];
    collect_owner_files(&from, &mut before);
    let mut outcome = RenameOutcome::default();
    // (옛 자리, 폴더를 옮긴 뒤의 자리)
    let mut landed: Vec<(PathBuf, PathBuf)> = vec![];
    let relative_of = |path: &Path| path.strip_prefix(&from).map(Path::to_path_buf).unwrap_or_default();

    if to.exists() && same_entry(&from, &to) {
        // 대소문자만 바뀐 것. 윈도우는 같은 폴더로 보므로 임시 이름을 거칩니다.
        let temp = top_dir.join(format!("{new_safe}.__이름바꾸는중__"));
        fs::rename(&from, &temp).map_err(|e| err("폴더를 옮기지 못했습니다", e))?;
        if let Err(e) = fs::rename(&temp, &to) {
            let _ = fs::rename(&temp, &from);
            return Err(err("폴더를 옮기지 못했습니다", e));
        }
        for old in &before {
            landed.push((old.clone(), to.join(relative_of(old))));
        }
    } else if to.exists() {
        // 새 이름 폴더가 이미 있으면 파일만 하나씩 옮겨 넣습니다. 통째로 옮기면
        // 그쪽에 있던 것을 덮어씁니다. 하나가 막혀도 나머지는 옮깁니다 — 막힌 것은
        // failed 에 적어 다음 저장 때 다시 시도합니다.
        for old in &before {
            let dst = to.join(relative_of(old));
            if let Some(parent) = dst.parent() {
                if let Err(reason) = ensure_dir(parent) {
                    outcome.failed.push((old.to_string_lossy().to_string(), reason));
                    continue;
                }
            }
            match rename_file_safely(old, &dst) {
                Ok(now) => landed.push((old.clone(), now)),
                Err(reason) => outcome.failed.push((old.to_string_lossy().to_string(), reason)),
            }
        }
        remove_empty_dirs(&from);
    } else {
        if let Some(parent) = to.parent() {
            ensure_dir(parent)?;
        }
        fs::rename(&from, &to).map_err(|e| err("폴더를 옮기지 못했습니다", e))?;
        for old in &before {
            landed.push((old.clone(), to.join(relative_of(old))));
        }
    }

    // 옮긴 자리에서 파일 이름의 앞부분을 바꿉니다. 실패해도 폴더는 이미 옮겨졌으니
    // «옛 자리 → 지금 자리» 는 돌려줍니다. 화면이 새 폴더의 옛 이름 파일을 가리켜야
    // 썸네일이 살아 있고, 못 바꾼 것은 failed 로 알려 다음 저장 때 다시 시도합니다.
    for (old, now) in landed {
        if !now.exists() {
            outcome
                .failed
                .push((now.to_string_lossy().to_string(), "옮긴 자리에 파일이 없습니다".to_string()));
            continue;
        }
        let final_path = match renamed_prefix(&now, &old_safe, &new_safe) {
            Some(next) => match rename_file_safely(&now, &next) {
                Ok(done) => done,
                Err(reason) => {
                    outcome.failed.push((now.to_string_lossy().to_string(), reason));
                    now
                }
            },
            None => now,
        };
        outcome.moved.push((
            old.to_string_lossy().to_string(),
            final_path.to_string_lossy().to_string(),
        ));
    }
    Ok(outcome)
}

/// 폴더 아래 파일을 전부 모읍니다 (한 층 더 들어간 `ref/` 까지).
///
/// 휴지통은 들어가지 않습니다. 지운 것이 목록에 딸려 오면 되살아난 것처럼 보입니다.
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if entry.file_name().to_string_lossy().as_ref() == trash::DIR {
                continue;
            }
            collect_files(&path, out);
        } else if path.is_file() {
            out.push(path);
        }
    }
}

/*
  rename_asset_owner 는 지웠습니다.

  옛 폴더 구조(갈래가 위, 인물이 아래) 시절의 명령이고 화면에서는 한 번도 부르지
  않았습니다. 폴더 옮기기는 rename_owner_tree 하나만 둡니다 — 같은 일을 하는 길이
  둘이면 규칙(덮어쓰지 않기·프로젝트 밖 안 건드리기)을 한쪽만 고치게 됩니다.
*/

#[tauri::command]
/// `top` 은 "character" | "background" | "asset" 중 하나입니다.
///
/// **인물 폴더를 통째로 지웁니다.** 새 구조에서는 레퍼런스도 인물 폴더
/// 아래에 있어서, 갈래별로 지우면 `ref` 만 남거나 생성물만 남습니다.
fn delete_asset_owner(
    base_directory: String,
    project_name: String,
    top: String,
    owner_name: String,
) -> Res<Option<String>> {
    let root = project_root(&base_directory, &project_name);
    let top_dir = top
        .split('/')
        .fold(root.clone(), |acc, part| acc.join(safe_name(part)));
    // 이름이 비면 `top_dir.join("")` 이 top_dir 자신이 되어 인물 폴더 전부가 지워집니다.
    let dir = top_dir.join(owner_dir_name(&owner_name)?);
    if dir == top_dir || dir == root {
        return Err("지울 대상이 인물 폴더가 아닙니다.".into());
    }
    if !dir.exists() {
        return Ok(None);
    }
    let dir = ensure_inside(&root, &dir)?;
    // 인물 폴더도 곧바로 없애지 않습니다. 한 사람의 시트·변형·에셋이 통째로 들어 있어서,
    // 잘못 눌렀을 때 잃는 것이 가장 큽니다. 파일 하나와 같은 길(`.휴지통/`)로 보냅니다.
    trash::move_to_trash(&root, &dir)?;
    Ok(Some(dir.to_string_lossy().to_string()))
}

/// 인물 폴더 안에서 `<옛 앞부분>_…` 파일들을 `<새 앞부분>_…` 으로 바꿉니다.
///
/// 두 곳에서 씁니다.
/// - 변형 이름을 바꿀 때: `냥이_겨울_001` → `냥이_밤_001`. 폴더는 그대로(부모 폴더).
/// - 인물 이름을 바꾸다 막혀서 못 바꾼 파일을 다음 저장 때 다시 시도할 때: `냥이_…` → `서리_…`.
///
/// 규칙은 rename_owner_tree 와 같은 «앞부분 + 밑줄» 입니다. 부모 것(`냥이_004`)은
/// `냥이_겨울_` 로 시작하지 않으니 변형 이름을 바꿔도 건드려지지 않습니다.
/// 하나가 막혀도 나머지는 바꾸고, 막힌 것은 failed 로 돌려줍니다.
#[tauri::command]
fn rename_stem_files(
    base_directory: String,
    project_name: String,
    top: String,
    owner_name: String,
    old_stem: String,
    new_stem: String,
) -> Res<RenameOutcome> {
    let root = project_root(&base_directory, &project_name);
    let top_dir = top.split('/').fold(root.clone(), |acc, part| acc.join(safe_name(part)));
    // 이름이 비면 top_dir 자신이 되어 인물 폴더 전부를 훑게 됩니다.
    let dir = top_dir.join(owner_dir_name(&owner_name)?);
    if dir == top_dir || dir == root || !dir.is_dir() {
        return Ok(RenameOutcome::default());
    }
    ensure_inside(&root, &dir)?;

    if old_stem.trim().is_empty() || new_stem.trim().is_empty() {
        return Ok(RenameOutcome::default());
    }
    let old = safe_name(&old_stem);
    let new = safe_name(&new_stem);
    if old == new {
        return Ok(RenameOutcome::default());
    }

    let mut files: Vec<PathBuf> = vec![];
    collect_owner_files(&dir, &mut files);
    let mut outcome = RenameOutcome::default();
    for file in files {
        let Some(next) = renamed_prefix(&file, &old, &new) else {
            continue;
        };
        match rename_file_safely(&file, &next) {
            Ok(done) => outcome.moved.push((
                file.to_string_lossy().to_string(),
                done.to_string_lossy().to_string(),
            )),
            Err(reason) => outcome.failed.push((file.to_string_lossy().to_string(), reason)),
        }
    }
    Ok(outcome)
}

// ─────────────────────────────────────────────────────────────────────────────
// 탐색기에서 보기 · 클립보드
// ─────────────────────────────────────────────────────────────────────────────

/// 탐색기를 열어 그 파일을 **선택된 상태로** 보여 줍니다.
///
/// 윈도우에서 `/select,경로` 는 통째로 한 덩어리여야 합니다. 흔히 하듯
/// `.arg("/select,").arg(path)` 로 나누거나 따옴표를 자동으로 붙이면
/// 탐색기가 인자를 못 알아듣고 그냥 내 문서를 엽니다. 그래서 raw_arg 로
/// 손수 조립합니다.
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Res<()> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("그 자리에 파일이 없습니다.".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let normalized = path.replace('/', "\\");
        let argument = if target.is_dir() {
            format!("\"{normalized}\"")
        } else {
            format!("/select,\"{normalized}\"")
        };
        std::process::Command::new("explorer")
            .raw_arg(argument)
            .spawn()
            .map_err(|e| err("탐색기를 열지 못했습니다", e))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| err("파인더를 열지 못했습니다", e))?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let dir = if target.is_dir() {
            target.to_path_buf()
        } else {
            target.parent().unwrap_or(target).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| err("파일 관리자를 열지 못했습니다", e))?;
        Ok(())
    }
}

/// 그림을 클립보드에 넣습니다. LLM 창에 바로 붙여넣을 수 있게요.
#[tauri::command]
fn copy_image_to_clipboard(path: String) -> Res<()> {
    let decoded = image::open(&path).map_err(|e| err("이미지를 읽지 못했습니다", e))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();

    let _clipboard = magnific::clipboard_guard();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| err("클립보드를 열지 못했습니다", e))?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        })
        .map_err(|e| err("클립보드에 넣지 못했습니다", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// 마그니픽 데스크톱 연결
// ─────────────────────────────────────────────────────────────────────────────
//
// 마그니픽 데스크톱(2026-08 출시)은 웹앱을 Tauri 로 감싼 것이라 딥링크·CLI 같은
// 공식 통로가 없습니다. 그래서 두 가지로 잇습니다.
//
// 1. 보내기 — 프롬프트를 클립보드에 넣고 마그니픽 창을 앞으로 가져와 Ctrl+V.
// 캔버스(Spaces)를 눌러 두었으면 텍스트 노드가 됩니다.
// «무제한» 은 웹앱 안에서만 적용되므로 API·MCP 로 보내지 않습니다.
// 2. 후보함 — <프로젝트>/magnific/ 에 떨어진 것을 화면에 띄우고, 사람이 «채택» 한
// 것만 인물·컷 폴더로 옮겨 우리 이름(인물_NNN)을 붙입니다. A·B·C컷이 섞여 오므로
// 자동으로 옮기지 않습니다. 이름을 우리가 정하니 마그니픽의 UUID 이름은 남지 않습니다.

/// 프로젝트 후보함 `<프로젝트>/magnific/`.
///
/// 마그니픽 동기화 폴더 하나를 여기에 겁니다. A컷·B컷·C컷·영상이 전부 섞여 오므로
/// **여기서는 아무것도 자동으로 옮기지 않습니다.** 사람이 «채택» 한 것만 인물·컷
/// 폴더로 **복사**되어 우리 이름을 받습니다.
///
/// 후보함의 파일은 옮기지도 지우지도 않습니다 — 마그니픽 동기화는 내려받기 전용이라
/// «지운 파일은 다시 내려받는다» 고 스스로 밝히고 있습니다(설정 화면 안내문, 2026-09-07).
/// 옮기면 곧 되살아나 후보로 다시 뜹니다. 처리한 것은 프로젝트 파일에 적어 두고 안 보여 줍니다.
/// 마그니픽은 우리가 고른 폴더 안에 마그니픽 프로젝트 이름으로 폴더를 하나 더 만들므로
/// 하위 폴더까지 재귀로 봅니다.
fn project_inbox_dir(base: &str, project: &str) -> PathBuf {
    project_root(base, project).join("magnific")
}

const INBOX_IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const INBOX_VIDEO_EXT: &[&str] = &["mp4", "mov", "webm"];

/// 파일 지문 — 크기와 앞·뒤 256KB 의 해시.
///
/// 우리가 마그니픽에 붙여넣은 그림을 마그니픽이 생성물로 올리고, 동기화가 그것을 다시
/// 내려줍니다. 보낼 때
/// 지문을 적어 두고 후보함에서 같은 지문을 만나면 숨깁니다. 통째로 해시하면 6000
/// 시트가 수십 MB 라 10초마다 도는 스캔이 무거워져, 앞뒤 조각만 봅니다.
/// 암호용이 아니라 표준 해시로 충분합니다.
pub(crate) fn file_fingerprint(path: &Path) -> Option<String> {
    use std::collections::HashMap;
    use std::hash::{Hash, Hasher};
    use std::io::{Read, Seek, SeekFrom};
    use std::sync::{Mutex, OnceLock};

    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (u64, u64, String)>>> = OnceLock::new();
    let meta = path.metadata().ok()?;
    let size = meta.len();
    let stamp = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((cached_size, cached_stamp, digest)) = cache.lock().ok()?.get(path) {
        if *cached_size == size && *cached_stamp == stamp {
            return Some(digest.clone());
        }
    }

    const CHUNK: u64 = 256 * 1024;
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    size.hash(&mut hasher);
    let mut head = vec![0u8; CHUNK.min(size) as usize];
    file.read_exact(&mut head).ok()?;
    head.hash(&mut hasher);
    if size > CHUNK * 2 {
        file.seek(SeekFrom::End(-(CHUNK as i64))).ok()?;
        let mut tail = vec![0u8; CHUNK as usize];
        file.read_exact(&mut tail).ok()?;
        tail.hash(&mut hasher);
    }
    let digest = format!("{size}-{:016x}", hasher.finish());
    if let Ok(mut map) = cache.lock() {
        map.insert(path.to_path_buf(), (size, stamp, digest.clone()));
    }
    Some(digest)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxFile {
    file_path: String,
    /// 보낸 그림이 되돌아온 것인지 알아보는 데 씁니다.
    fingerprint: String,
    /// 후보함 기준 상대 경로. 처리 기록의 키입니다 — 마그니픽이 하위 폴더를 만들어도 안 겹칩니다.
    relative_path: String,
    name: String,
    /// "image" | "video"
    kind: String,
    modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFile {
    file_path: String,
    /// 우리가 정한 이름 (확장자 없이). 화면 이름이자 @태그입니다.
    name: String,
    /// 마그니픽이 붙였던 원래 파일 이름. 어느 생성물이었는지 되짚을 때 씁니다.
    source_name: String,
}

fn inbox_kind(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if INBOX_IMAGE_EXT.contains(&ext.as_str()) {
        Some("image")
    } else if INBOX_VIDEO_EXT.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

#[tauri::command]
fn list_project_inbox(base_directory: String, project_name: String) -> Res<Vec<InboxFile>> {
    let inbox = project_inbox_dir(&base_directory, &project_name);
    if !inbox.exists() {
        return Ok(vec![]);
    }
    let root = project_root(&base_directory, &project_name);
    let inbox = ensure_inside(&root, &inbox)?;
    let mut entries: Vec<PathBuf> = vec![];
    collect_files(&inbox, &mut entries);
    entries.sort();

    let mut out = vec![];
    for path in entries {
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let relative = path
            .strip_prefix(&inbox)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        // 숨김·임시 파일(과 그런 폴더 안의 것)은 동기화가 쓰는 중간 파일일 수 있습니다.
        if relative.split('/').any(|part| part.starts_with('.') || part.starts_with("~$")) {
            continue;
        }
        let Some(kind) = inbox_kind(&path) else { continue };
        // 방금까지 쓰고 있던 파일은 다음에. 반쯤 받은 것을 보여 주면 깨진 그림이 뜹니다.
        let meta = path.metadata().ok();
        let still_writing = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|m| m.elapsed().ok())
            .map(|age| age.as_secs() < 2)
            .unwrap_or(false);
        if still_writing {
            continue;
        }
        out.push(InboxFile {
            fingerprint: file_fingerprint(&path).unwrap_or_default(),
            modified_ms: meta
                .and_then(|m| m.modified().ok())
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            name: file_name,
            relative_path: relative,
            kind: kind.to_string(),
            file_path: path.to_string_lossy().to_string(),
        });
    }
    Ok(out)
}

/// 후보함의 파일 하나를 정한 주인 폴더로 **복사**하고 우리 이름을 붙입니다 — «채택».
///
/// 옮기지 않고 복사합니다. 마그니픽 동기화는 사라진 파일을 다시 내려받으므로 옮기면
/// 곧 되살아납니다. 후보함 밖의 파일은 건드리지 않습니다.
#[tauri::command]
fn claim_project_inbox_file(
    base_directory: String,
    project_name: String,
    file_path: String,
    category: String,
    owner_name: String,
    // 파일 이름 앞부분. 변형에 채택하면 «인물_변형» 이 옵니다. 없으면 인물 이름.
    stem: Option<String>,
) -> Res<ImportedFile> {
    let inbox = project_inbox_dir(&base_directory, &project_name);
    let inbox = ensure_inside(&project_root(&base_directory, &project_name), &inbox)?;
    let source = ensure_inside(&inbox, Path::new(&file_path))?;
    if !source.is_file() || inbox_kind(&source).is_none() {
        return Err("그 파일이 후보함에 없습니다. 이미 옮겼거나 지워졌습니다.".into());
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let source_name = source.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();

    let target_dir = owner_dir(&base_directory, &project_name, &category, &owner_name);
    ensure_dir(&target_dir)?;
    let stem = stem
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&owner_name);
    let target = next_numbered_path(&target_dir, &asset_stem(&category, stem), &ext);
    fs::copy(&source, &target).map_err(|e| err("파일을 복사하지 못했습니다", e))?;
    Ok(ImportedFile {
        file_path: target.to_string_lossy().to_string(),
        name: target.file_stem().and_then(|n| n.to_str()).unwrap_or("").to_string(),
        source_name,
    })
}

/// 후보함 폴더만 만듭니다(열지 않음). 프로젝트를 저장할 때마다 불러, 새 프로젝트에도
/// 처음부터 `magnific/` 이 있게 합니다 — 마그니픽 동기화 폴더로 바로 고를 수 있어야 하니까요.
#[tauri::command]
fn ensure_project_inbox(base_directory: String, project_name: String) -> Res<String> {
    let inbox = project_inbox_dir(&base_directory, &project_name);
    ensure_dir(&inbox)?;
    Ok(inbox.to_string_lossy().to_string())
}

/// 후보함을 만들고 탐색기로 엽니다. 마그니픽에서 이 폴더를 동기화하라고 안내할 때.
#[tauri::command]
fn open_project_inbox(base_directory: String, project_name: String) -> Res<String> {
    let inbox = project_inbox_dir(&base_directory, &project_name);
    ensure_dir(&inbox)?;
    let path = inbox.to_string_lossy().to_string();
    reveal_in_file_manager(path.clone())?;
    Ok(path)
}





// ─────────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(asset_upload::AssetUploads::default())
        .plugin(tauri_plugin_log::Builder::new().build())
        // 업스케일 워커·설치 상태를 앱이 사는 동안 들고 있습니다.
        .manage(upscale::UpscaleState::default())
        .manage(control::ControlState::default())
        .invoke_handler(tauri::generate_handler![
            control::control_status,
            control::control_enable,
            control::control_respond,
            control::control_read_journal,
            control::control_write_journal,
            choose_storage_directory,
            save_project_asset,
            asset_upload::begin_project_asset_upload,
            asset_upload::append_project_asset_upload,
            asset_upload::finish_project_asset_upload,
            asset_upload::abort_project_asset_upload,
            import_project_asset,
            list_reference_files,
            delete_project_media_file,
            release_empty_project_asset,
            rename_owner_tree,
            migrate_project_layout,
            delete_asset_owner,
            rename_stem_files,
            reveal_in_file_manager,
            copy_image_to_clipboard,
            magnific::send_prompt_to_magnific,
            magnific::send_images_to_magnific,
            magnific::magnific_compose_auto,
            magnific::magnific_compose_busy,
            list_project_inbox,
            claim_project_inbox_file,
            open_project_inbox,
            ensure_project_inbox,
            datafiles::save_data_file,
            datafiles::read_data_file,
            datafiles::delete_data_file,
            datafiles::list_project_data,
            datafiles::list_data_files,
            datafiles::list_sub_folders,
            // 앱 설정 거울 — 웹뷰 저장소는 설치본과 개발 서버가 따로 써서 설치하면 비어 있습니다.
            datafiles::read_app_settings,
            datafiles::write_app_settings,
            datafiles::merge_app_settings,
            // 지운 원본은 곧바로 없애지 않고 프로젝트 폴더 안 휴지통으로 옮깁니다.
            trash::restore_project_media_file,
            trash::empty_project_trash,
            datafiles::list_markdown_files,
            datafiles::save_markdown_file,
            datafiles::delete_markdown_file,
            datafiles::list_preset_files,
            datafiles::save_preset_file,
            datafiles::delete_preset_file,
            datafiles::allow_storage_directory,
            datafiles::ensure_directory,
            datafiles::save_text_file,
            datafiles::choose_text_file,
            llm::save_api_key,
            llm::delete_api_key,
            llm::get_api_key_status,
            llm::list_llm_models,
            llm::call_llm,
            llm::cancel_llm,
            llm::llm_resume,
            llm::llm_cancel_response,
            comfy::comfy_inspect_workflow,
            comfy::comfy_check_connection,
            comfy::comfy_upscale_image,
            upscale::upscale_engines_status,
            upscale::upscale_install_engine,
            upscale::upscale_cancel_install,
            upscale::upscale_uninstall_engine,
            upscale::upscale_worker_info,
            upscale::upscale_stop_workers,
            upscale::upscale_run,
            // 마그니픽 MCP — 창을 거치지 않고 끝까지 뽑는 길.
            magnific_mcp::magnific_status,
            magnific_mcp::magnific_login_start,
            magnific_mcp::open_external,
            magnific_mcp::magnific_login_poll,
            magnific_mcp::magnific_logout,
            magnific_mcp::magnific_check,
            magnific_mcp::magnific_call,
            magnific_mcp::magnific_upload,
            magnific_mcp::magnific_generate,
            magnific_mcp::magnific_generate_details,
            magnific_mcp::magnific_wait,
            magnific_mcp::magnific_download,
            magnific_mcp::magnific_recent,
            // 로라 살림 — 찾고 받고 폴더에 정리.
            lora::lora_files,
            lora::lora_verify_h3_preset,
            lora::lora_delete,
            lora::lora_download,
            lora::lora_import,
            lora::lora_pick_files,
            lora::lora_search,
            lora::lora_open_folder,
            local::local_engines_status,
            local::local_install_engine,
            local::local_cancel_install,
            local::local_prefetch_weights,
            local::local_uninstall_engine,
            local::local_worker_info,
            local::local_stop_workers,
            local::local_run,
            local::choose_video_files,
            local::choose_audio_files,
            local::motion_capture_output,
            local::read_motion_capture,
            local::probe_hardware,
        ])
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 「어느 판이 떴나」 를 로그 첫머리에 남깁니다 — 공개판에서 「엔진이 안 보인다」 는 보고가
            // 오면 이 한 줄로 판 문제인지 설치 문제인지 갈립니다.
            log::info!("판: {}", edition::describe());
            /*
              **자동 업데이트는 공개판에서만 켭니다.**

              

              끝점은 공개판 릴리스(`AIMovieStorage-Public_…-setup.exe`)를 가리킵니다.
              비공개판(내 PC용, 제외 엔진이 들어 있는 판)이 그것을 받아 깔면 **모션캡처·
              업스케일 엔진이 통째로 사라집니다.** 두 판은 `productName` 이 달라 설치
              자리도 갈리므로, 덮어쓰는 게 아니라 **엉뚱한 앱이 하나 더 생깁니다.**
              어느 쪽이든 사고라서 아예 등록하지 않습니다.

              등록하지 않으면 `plugins.updater` 설정도 읽히지 않습니다 — 설정이 잘못돼
              있어도 비공개판은 그대로 뜹니다(설정을 못 읽으면 앱이 아예 안 뜹니다).
            */
            if edition::is_public() {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("앱을 띄우지 못했습니다")
        .run(|app, event| {
            // 앱이 꺼질 때 업스케일 워커를 반드시 내립니다. 남으면 파이썬이 VRAM 을 문 채
            // 살아 있어서 다음에 앱을 켰을 때 «CUDA out of memory» 가 납니다.
            // 이름이 아니라 우리가 띄우며 받아 둔 자식 핸들로만 끝냅니다.
            if matches!(event, tauri::RunEvent::Exit) {
                upscale::stop_all_workers(app);
            }
        });
}

#[cfg(test)]
mod empty_reservation_tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let project = directory.path().join("시험 작품");
        fs::create_dir(&project).unwrap();
        (directory, project)
    }

    fn release(base: &Path, file: &Path) -> Res<bool> {
        release_empty_project_asset(base.to_string_lossy().into_owned(), "시험 작품".into(), file.to_string_lossy().into_owned())
    }

    #[test]
    fn removes_only_empty_file_and_repeated_release_is_safe() {
        let (base, project) = fixture();
        let file = project.join("서아_로컬_001.png");
        fs::write(&file, b"").unwrap();
        assert!(release(base.path(), &file).unwrap());
        assert!(!file.exists());
        assert!(!release(base.path(), &file).unwrap());
    }

    #[test]
    fn preserves_a_result_written_to_the_reservation() {
        let (base, project) = fixture();
        let file = project.join("서아_로컬_001.png");
        fs::write(&file, "완성 결과".as_bytes()).unwrap();
        assert!(!release(base.path(), &file).unwrap());
        assert_eq!(fs::read(&file).unwrap(), "완성 결과".as_bytes());
    }

    #[test]
    fn rejects_outside_file_even_when_empty() {
        let (base, _) = fixture();
        let file = base.path().join("다른 작품.png");
        fs::write(&file, b"").unwrap();
        assert!(release(base.path(), &file).is_err());
        assert!(file.exists());
    }

    #[test]
    fn rejects_parent_traversal_after_resolving_the_path() {
        let (base, project) = fixture();
        let file = base.path().join("다른 작품.png");
        fs::write(&file, b"").unwrap();
        assert!(release(base.path(), &project.join("..").join("다른 작품.png")).is_err());
        assert!(file.exists());
    }

    #[test]
    fn preserves_directories_and_unsupported_extensions() {
        let (base, project) = fixture();
        let directory = project.join("폴더.png");
        fs::create_dir(&directory).unwrap();
        assert!(!release(base.path(), &directory).unwrap());
        assert!(directory.is_dir());
        let file = project.join("설치.exe");
        fs::write(&file, b"").unwrap();
        assert!(release(base.path(), &file).is_err());
        assert!(file.exists());
    }
}

#[cfg(test)]
mod rename_tests {
    use super::*;

    /// 이름 바꾸기 규칙 — «옛 이름 + 밑줄» 로 시작하면 전부 따라가고, 부모 것은 안 건드립니다.
    #[test]
    fn prefix_rule_follows_every_piece() {
        let renamed = |name: &str| {
            renamed_prefix(Path::new(name), "냥이", "서리")
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        };
        assert_eq!(renamed("냥이_001.png").as_deref(), Some("서리_001.png"));
        assert_eq!(renamed("ref_냥이_001.png").as_deref(), Some("ref_서리_001.png"));
        assert_eq!(renamed("냥이_얼굴 정면_001.png").as_deref(), Some("서리_얼굴 정면_001.png"));
        assert_eq!(renamed("냥이_시트_001.png").as_deref(), Some("서리_시트_001.png"));
        assert_eq!(renamed("냥이_겨울_001.png").as_deref(), Some("서리_겨울_001.png"));
        // 규칙에 안 맞는 것은 그대로 — 손으로 붙인 이름, 다른 인물, 밑줄 없이 이어진 이름.
        assert_eq!(renamed("raon_cute_cat.png"), None);
        assert_eq!(renamed("냥이랑_001.png"), None);
        assert_eq!(renamed("냥이_.png"), None);
        assert_eq!(renamed("냥이.png"), None);
    }

    /// 변형 이름 바꾸기 — `냥이_겨울_` 로 시작하는 것만. 부모 `냥이_004` 는 그대로.
    #[test]
    fn variation_rename_leaves_parent_alone() {
        let renamed = |name: &str| {
            renamed_prefix(Path::new(name), "냥이_겨울", "냥이_밤")
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        };
        assert_eq!(renamed("냥이_겨울_001.png").as_deref(), Some("냥이_밤_001.png"));
        assert_eq!(renamed("ref_냥이_겨울_001.png").as_deref(), Some("ref_냥이_밤_001.png"));
        assert_eq!(renamed("냥이_겨울_얼굴 정면_001.png").as_deref(), Some("냥이_밤_얼굴 정면_001.png"));
        assert_eq!(renamed("냥이_004.png"), None);
        assert_eq!(renamed("냥이_겨울 외투_001.png"), None);
    }

    /// 하위 폴더는 허용 목록(6면)만. `..`·구분자·모르는 이름은 막습니다 — 주인 폴더 밖에 쓰는 길을 열지 않기 위해.
    #[test]
    fn owner_subdir_allows_only_six_faces() {
        let dir = Path::new("D:/프로젝트/background/장소");
        assert_eq!(owner_subdir(dir, None).unwrap(), dir.to_path_buf());
        assert_eq!(owner_subdir(dir, Some("")).unwrap(), dir.to_path_buf());
        assert_eq!(owner_subdir(dir, Some("6면")).unwrap(), dir.join("6면"));
        assert!(owner_subdir(dir, Some("..")).is_err());
        assert!(owner_subdir(dir, Some("6면/..")).is_err());
        assert!(owner_subdir(dir, Some("ref")).is_err());
        assert!(owner_subdir(dir, Some("magnific")).is_err());
    }

    #[test]
    fn stem_base_strips_trailing_number_only() {
        assert_eq!(stem_base("냥이_얼굴 정면_003"), "냥이_얼굴 정면");
        assert_eq!(stem_base("냥이_001"), "냥이");
        assert_eq!(stem_base("냥이_시트"), "냥이_시트");
        assert_eq!(stem_base("냥이"), "냥이");
    }

    /// 실제 폴더에서 한 바퀴 — 폴더 옮기기 + 모든 조각 이름 바꾸기 + 충돌 시 번호 올리기.
    #[test]
    fn owner_tree_rename_end_to_end() {
        // 작업 폴더 안(target/)에서만 합니다. 밖의 폴더는 시험이라도 건드리지 않습니다.
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("rename-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let owner = base.join("프로젝트").join("character").join("냥이");
        fs::create_dir_all(owner.join("ref")).unwrap();
        for name in ["냥이_001.png", "냥이_얼굴 정면_001.png", "냥이_겨울_001.png", "손으로.png"] {
            fs::write(owner.join(name), b"x").unwrap();
        }
        fs::write(owner.join("ref").join("ref_냥이_001.png"), b"x").unwrap();
        // 새 이름 폴더가 이미 있고 같은 이름 파일이 있으면 덮어쓰지 않고 번호를 올립니다.
        let existing = base.join("프로젝트").join("character").join("서리");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("서리_001.png"), b"keep").unwrap();

        let outcome = rename_owner_tree(
            base.to_string_lossy().to_string(),
            "프로젝트".into(),
            "character".into(),
            "냥이".into(),
            "서리".into(),
        )
        .unwrap();
        assert!(outcome.failed.is_empty(), "{:?}", outcome.failed);
        let names: Vec<String> = outcome
            .moved
            .iter()
            .map(|(_, to)| Path::new(to).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"서리_002.png".to_string()), "{names:?}");
        assert!(names.contains(&"서리_얼굴 정면_001.png".to_string()), "{names:?}");
        assert!(names.contains(&"서리_겨울_001.png".to_string()), "{names:?}");
        assert!(names.contains(&"ref_서리_001.png".to_string()), "{names:?}");
        assert!(names.contains(&"손으로.png".to_string()), "{names:?}");
        assert_eq!(fs::read(existing.join("서리_001.png")).unwrap(), b"keep");
        assert!(!owner.exists(), "옛 폴더는 비어서 사라져야 합니다");

        // 변형 이름 바꾸기 — 부모 것은 그대로.
        let outcome = rename_stem_files(
            base.to_string_lossy().to_string(),
            "프로젝트".into(),
            "character".into(),
            "서리".into(),
            "서리_겨울".into(),
            "서리_밤".into(),
        )
        .unwrap();
        assert_eq!(outcome.moved.len(), 1);
        assert!(existing.join("서리_밤_001.png").exists());
        assert!(existing.join("서리_002.png").exists());

        let _ = fs::remove_dir_all(&base);
    }
}
