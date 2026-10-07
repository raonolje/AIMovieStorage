//! **프로젝트 데이터 파일과 이름 붙은 파일** — 2026-09-18 에 `lib.rs` 에서 떼어 냈습니다.
//!
//! 프로젝트 저장본(.json) · 프롬프트 문구 라이브러리(.md) · 프리셋, 그리고 설정 화면이
//! 쓰는 폴더 허용·텍스트 파일 고르기까지. 전부 «저장 폴더 안에서만» 이라는 한 가지 규칙을
//! 지켜야 하는 일이라 한자리에 둡니다 — `..` 와 절대 경로를 막는 `data_path` 를 빠뜨린
//! 길이 하나라도 생기면 그 길로 폴더 밖이 열립니다.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::{ensure_dir, err, safe_name, LockSafe, Res};

// ─────────────────────────────────────────────────────────────────────────────
// 데이터 파일 (프로젝트 저장)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDataRequest {
    base_directory: String,
    relative_path: String,
    contents: String,
    /**
      이 창이 마지막으로 읽거나 쓴 판의 `updatedAt`.

      2026-09-21 국호 컷 1 사고: 같은 프로젝트를 연 창이 둘일 때, 한 창의 폴더 재스캔이
      **옛 초안을 통째로** project.json 에 써서 다른 창에서 고친 구도·characterRefs·@태그
      프롬프트가 날아갔습니다. 디스크의 `updatedAt` 이 이 값과 다르면 «내가 모르는 사이에
      다른 창이 썼다» 는 뜻이라 쓰지 않고 디스크 내용을 돌려줍니다.

      비교는 쓰는 쪽(TS)이 아니라 여기서 합니다 — 읽고·견주고·쓰기가 한 명령 안에 있어야
      두 창 사이에 끼어들 틈이 없습니다. 값이 없으면(새 파일·옛 project.json·«기준을 모름»)
      검사 없이 씁니다. 옛 파일까지 막으면 멀쩡한 작품이 저장을 못 하게 됩니다.
    */
    #[serde(default)]
    if_unmodified_since: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDataResult {
    path: String,
    /// 거짓이면 디스크가 더 새로워서 쓰지 않은 것입니다.
    written: bool,
    /// 쓰지 않았을 때 디스크에 있던 내용. 부른 쪽이 이것으로 화면을 다시 채웁니다.
    current: Option<String>,
}

/*
  읽기·견주기·쓰기가 한 덩어리가 되게 잠급니다. 두 창의 저장이 같은 순간에 오면
  한쪽이 읽은 뒤 다른 쪽이 쓰고, 그 뒤 앞쪽이 «안 바뀌었다» 고 믿고 덮어쓸 수 있습니다.
  프로세스 하나 안의 두 창은 이 자물쇠 하나로 한 줄에 섭니다.
*/
static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// project.json 의 «도장» 만 읽는 틀. 다른 키는 전부 흘려보냅니다.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    updated_at: Option<String>,
}

/// project.json 본문에서 `updatedAt` 만 꺼냅니다. 없거나 JSON 이 아니면 None.
///
/// `serde_json::Value` 로 통째로 트리를 세우지 않습니다 — 구도 캡처가 data URL 로 든
/// 수 MB 짜리 파일을 자동 저장(1.5초)마다 메인 스레드에서 전부 할당하면 그때마다
/// 화면이 멈칫합니다(2026-09-21 검토). 도장 하나만 읽으면 할당이 거의 없습니다.
fn stored_updated_at(text: &str) -> Option<String> {
    serde_json::from_str::<Stamp>(text).ok()?.updated_at
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFile {
    relative_path: String,
    contents: String,
}

pub fn data_path(base_directory: &str, relative_path: &str) -> Res<PathBuf> {
    // `..` 로 폴더 밖을 가리키지 못하게 막습니다.
    if relative_path.contains("..") {
        return Err("경로에 .. 는 쓸 수 없습니다.".into());
    }
    let relative = relative_path.replace('\\', "/");
    /*
      절대 경로도 막습니다. `Path::join` 은 오른쪽이 절대 경로면 왼쪽(base)을
      통째로 버려서, "C:/..." 나 "/..." 를 넘기면 저장 폴더 밖을 읽고 쓰고
      지웠습니다. `..` 검사만으로는 잡히지 않던 구멍입니다.
    */
    if Path::new(&relative).is_absolute() || relative.starts_with('/') || relative.contains(':') {
        return Err("저장 폴더 안의 상대 경로만 쓸 수 있습니다.".into());
    }
    // ensure_inside 는 canonicalize 라 아직 없는 파일(새로 저장)에는 못 씁니다.
    // `..` 와 절대 경로를 위에서 막았으니 붙이기만 하면 base 안에 머뭅니다.
    Ok(Path::new(base_directory).join(relative))
}

/// **옆 파일에 다 쓴 뒤 이름을 바꿔 갈아 끼웁니다.**
///
/// `fs::write` 는 «비우고 → 채우기» 라, 다른 프로세스(dev:desktop 창 + 조종용 exe 처럼
/// 창이 둘일 때)가 그 틈에 읽으면 반쪽짜리 JSON 을 봅니다. 그러면 `stored_updated_at`
/// 이 None 이 되어 «옛 파일» 로 오해하고 검사 없이 덮어씁니다 — 저장 자물쇠는 한
/// 프로세스 안에서만 듣습니다. 이름 바꾸기는 한 번에 일어나므로 읽는 쪽은 언제나
/// «다 쓴 파일» 아니면 «옛 파일» 만 봅니다.
///
/// 프로젝트 저장본과 앱 설정 거울이 **같이** 씁니다 — 한쪽에만 두었더니 다른 쪽이
/// 반쪽 파일을 남길 수 있는 채로 남습니다.
fn write_atomic(path: &Path, contents: &str) -> Res<()> {
    // 확장자를 갈아 끼우지 않고 **뒤에 붙입니다.** `set_extension` 은 점이 둘인 이름
    // (`a.b.json`)에서 가운데를 먹어 버려 원래 파일과 다른 이름이 됩니다.
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".writing");
    let tmp = path.with_file_name(name);
    fs::write(&tmp, contents).map_err(|e| err("파일을 쓰지 못했습니다", e))?;
    fs::rename(&tmp, path).map_err(|e| err("쓴 파일을 제자리로 옮기지 못했습니다", e))
}

#[tauri::command]
pub fn save_data_file(request: SaveDataRequest) -> Res<SaveDataResult> {
    let path = data_path(&request.base_directory, &request.relative_path)?;
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let _guard = SAVE_LOCK.lock_safe();
    let display = path.to_string_lossy().to_string();

    if let Some(expected) = request.if_unmodified_since.as_deref() {
        match fs::read_to_string(&path) {
            Ok(existing) => {
                /*
                  `updatedAt` 이 없는 옛 파일은 검사 없이 씁니다.
                  있는데 기준과 **다르면** 쓰지 않습니다. «더 새로우면» 이 아니라 «다르면» 인
                  이유: 시계가 뒤로 갔거나 백업을 되돌린 경우에도 «내가 읽은 것과 다른 파일»
                  위에 덮어쓰는 일은 없어야 합니다.
                */
                if let Some(on_disk) = stored_updated_at(&existing) {
                    if on_disk != expected {
                        return Ok(SaveDataResult {
                            path: display,
                            written: false,
                            current: Some(existing),
                        });
                    }
                }
            }
            // 아직 없는 파일은 처음 쓰는 것입니다.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            // 있는데 못 읽는 파일 위에 덮어쓰면 무엇을 지우는지 모릅니다. 저장을 미룹니다.
            Err(e) => return Err(err("저장 전에 파일을 읽지 못했습니다", e)),
        }
    }

    write_atomic(&path, &request.contents)?;
    Ok(SaveDataResult {
        path: display,
        written: true,
        current: None,
    })
}

#[tauri::command]
pub fn read_data_file(base_directory: String, relative_path: String) -> Res<Option<String>> {
    let path = data_path(&base_directory, &relative_path)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err("파일을 읽지 못했습니다", e)),
    }
}

#[tauri::command]
pub fn delete_data_file(base_directory: String, relative_path: String) -> Res<()> {
    let path = data_path(&base_directory, &relative_path)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err("파일을 지우지 못했습니다", e)),
    }
}

/// 하위 폴더 하나와 그 안의 파일 경로들. `list_sub_folders` 가 돌려줍니다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubFolder {
    pub name: String,
    pub files: Vec<String>,
}

/// 저장 폴더 안의 프로젝트를 전부 찾습니다.
///
/// `<저장폴더>/<프로젝트>/project.json` 을 한 겹씩 뒤집니다.
#[tauri::command]
pub fn list_project_data(base_directory: String, file_name: String) -> Res<Vec<DataFile>> {
    let base = Path::new(&base_directory);
    if !base.exists() {
        return Ok(vec![]);
    }

    let mut out = vec![];
    for entry in fs::read_dir(base)
        .map_err(|e| err("저장 폴더를 읽지 못했습니다", e))?
        .flatten()
    {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let file = dir.join(&file_name);
        if let Ok(contents) = fs::read_to_string(&file) {
            let relative = format!(
                "{}/{}",
                dir.file_name().unwrap_or_default().to_string_lossy(),
                file_name
            );
            out.push(DataFile {
                relative_path: relative,
                contents,
            });
        }
    }
    Ok(out)
}

/// 저장 폴더 안 어느 폴더의 **하위 폴더와 그 안의 파일**을 훑습니다.
///
/// BGM 이 이것을 씁니다. 영상 프로젝트는 폴더마다 `project.json` 이 있어 그것만 읽으면
/// 되살아나는데, BGM 은 기록이 브라우저 저장소에만 있어 **폴더에 곡이 있어도 화면이
/// 비어 있었습니다.** 곡 폴더(`BGM/곡/<프로젝트>/…`)를 훑어 무엇이 있는지 알아야
/// 되살릴 수 있습니다.
///
/// 한 겹만 봅니다(`<relative_path>/<하위 폴더>/<파일>`). 더 깊게 파면 6면·파노라마처럼
/// 안에 또 폴더를 둔 갈래에서 쓸데없이 많이 읽습니다.
#[tauri::command]
pub fn list_sub_folders(
    base_directory: String,
    relative_path: String,
    extensions: Vec<String>,
) -> Res<Vec<SubFolder>> {
    let root = data_path(&base_directory, &relative_path)?;
    if !root.exists() {
        return Ok(vec![]);
    }
    let wanted: Vec<String> = extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .collect();

    let mut out = vec![];
    for entry in fs::read_dir(&root)
        .map_err(|e| err("폴더를 읽지 못했습니다", e))?
        .flatten()
    {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let mut files = vec![];
        if let Ok(inner) = fs::read_dir(&dir) {
            for item in inner.flatten() {
                let path = item.path();
                if !path.is_file() {
                    continue;
                }
                let ok = wanted.is_empty()
                    || path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| wanted.contains(&e.to_ascii_lowercase()))
                        .unwrap_or(false);
                if ok {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        }
        files.sort();
        out.push(SubFolder {
            name: dir.file_name().unwrap_or_default().to_string_lossy().to_string(),
            files,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn list_data_files(
    base_directory: String,
    relative_path: String,
    extension: String,
) -> Res<Vec<DataFile>> {
    let dir = data_path(&base_directory, &relative_path)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let wanted = extension.trim_start_matches('.').to_ascii_lowercase();

    let mut out = vec![];
    for entry in fs::read_dir(&dir)
        .map_err(|e| err("폴더를 읽지 못했습니다", e))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let matches = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase() == wanted)
            .unwrap_or(false);
        if !matches {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(&path) {
            out.push(DataFile {
                relative_path: format!(
                    "{}/{}",
                    relative_path.trim_end_matches('/'),
                    path.file_name().unwrap_or_default().to_string_lossy()
                ),
                contents,
            });
        }
    }
    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// 마크다운 (프롬프트 문구 라이브러리) · 프리셋
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedFile {
    file_name: String,
    contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNamedRequest {
    directory: String,
    file_name: String,
    contents: String,
}

pub fn list_named(directory: &str, extension: &str) -> Res<Vec<NamedFile>> {
    let dir = Path::new(directory);
    if directory.trim().is_empty() || !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(dir)
        .map_err(|e| err("폴더를 읽지 못했습니다", e))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_match = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case(extension))
            .unwrap_or(false);
        if !is_match {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(&path) {
            out.push(NamedFile {
                file_name: path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
                contents,
            });
        }
    }
    out.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(out)
}

pub fn save_named(request: SaveNamedRequest, extension: &str) -> Res<String> {
    let dir = Path::new(&request.directory);
    ensure_dir(dir)?;
    let path = dir.join(format!(
        "{}.{extension}",
        safe_name(&request.file_name)
    ));
    fs::write(&path, request.contents).map_err(|e| err("파일을 쓰지 못했습니다", e))?;
    Ok(path.to_string_lossy().to_string())
}

pub fn delete_named(directory: &str, file_name: &str, extension: &str) -> Res<()> {
    let path = Path::new(directory).join(format!("{}.{extension}", safe_name(file_name)));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err("파일을 지우지 못했습니다", e)),
    }
}

/// 프롬프트 문구를 md 파일로 관리합니다.
///
/// 코드에 문자열로 박아 두면 문구를 고칠 때마다 빌드를 다시 해야 합니다.
/// 폴더에 두면 앱 안에서도, 편집기로도 고칠 수 있습니다.
#[tauri::command]
pub fn list_markdown_files(directory: String) -> Res<Vec<NamedFile>> {
    list_named(&directory, "md")
}

#[tauri::command]
pub fn save_markdown_file(request: SaveNamedRequest) -> Res<String> {
    save_named(request, "md")
}

#[tauri::command]
pub fn delete_markdown_file(directory: String, file_name: String) -> Res<()> {
    delete_named(&directory, &file_name, "md")
}

#[tauri::command]
pub fn list_preset_files(directory: String) -> Res<Vec<NamedFile>> {
    list_named(&directory, "json")
}

#[tauri::command]
pub fn save_preset_file(request: SaveNamedRequest) -> Res<()> {
    save_named(request, "json").map(|_| ())
}

#[tauri::command]
pub fn delete_preset_file(directory: String, file_name: String) -> Res<()> {
    delete_named(&directory, &file_name, "json")
}

// ─────────────────────────────────────────────────────────────────────────────
// 앱 설정 거울 — 웹뷰 저장소 바깥에 한 벌
// ─────────────────────────────────────────────────────────────────────────────

/// 앱 설정 거울 파일 이름. 앱 데이터 폴더(`app_data_dir`) 바로 아래에 둡니다.
const APP_SETTINGS_FILE: &str = "app-settings.json";

/// 거울 파일의 자리.
///
/// # 왜 저장 폴더가 아니라 앱 데이터 폴더인가
///
/// 여기 적히는 값 가운데 하나가 **저장 폴더 경로 자체**입니다. 저장 폴더 안에 두면
/// 그 폴더를 알아야 읽을 수 있는데, 알아내려고 읽는 파일이라 앞뒤가 막힙니다.
/// 받아 둔 엔진과 API 키가 이미 이 폴더에 있어 «앱이 기억하는 것» 의 자리로 맞습니다.
///
/// # 왜 이 파일이 필요한가
///
/// 설치본과 개발 서버는 웹뷰 origin 이 달라 `localStorage` 가 통째로 갈립니다.
/// 그래서 설치하고 처음 열면 **저장 폴더부터 다시 잡아야** 했고, BGM 기록도 안
/// 보였습니다(곡 파일은 폴더 훑기로 되살아나지만, 사람이 적어 둔 프롬프트·분위기·
/// 가사는 그 길로는 못 돌아옵니다). 웹뷰 캐시를 비우는 일에도 같이 날아갑니다.
fn app_settings_path(app: &tauri::AppHandle) -> Res<PathBuf> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| err("앱 데이터 폴더를 찾지 못했습니다", e))?;
    ensure_dir(&base)?;
    Ok(base.join(APP_SETTINGS_FILE))
}

/// 거울 파일을 통째로 읽습니다. 아직 없으면 `None` — 처음 켠 것뿐이라 오류가 아닙니다.
///
/// 안을 들여다보지 않고 **글 한 덩어리**로만 주고받습니다. 어떤 칸이 있는지는
/// 프런트가 정하고, 여기는 파일 살림만 합니다 — 칸이 늘 때마다 Rust 를 고쳐야
/// 하면 한쪽만 고친 판이 생깁니다.
#[tauri::command]
pub fn read_app_settings(app: tauri::AppHandle) -> Res<Option<String>> {
    let path = app_settings_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err("앱 설정을 읽지 못했습니다", e)),
    }
}

/// 거울 파일을 통째로 씁니다.
///
/// 반쪽 파일이 남으면 다음에 켤 때 JSON 이 깨져 **설정이 통째로 없는 것처럼** 보입니다.
/// 그래서 프로젝트 저장본과 같은 «옆에 쓰고 이름 바꾸기» 를 씁니다.
#[tauri::command]
pub fn write_app_settings(app: tauri::AppHandle, contents: String) -> Res<()> {
    let path = app_settings_path(&app)?;
    write_atomic(&path, &contents)
}

/// 거울 파일에 **한 칸만** 얹습니다 — 읽기·병합·쓰기가 한 덩어리입니다.
///
/// # 왜 프런트가 아니라 여기인가
///
/// 예전에는 프런트가 `read_app_settings` → 병합 → `write_app_settings` 로 **세 번** 불렀습니다.
/// 그 사이가 열려 있어서, 앱을 두 벌 띄워 두면 둘이 **같은 옛 값을 동시에 읽고** 각자 얹어
/// 쓰는 일이 났습니다. A 가 BGM 을 고치고 B 가 저장 폴더만 바꿨을 뿐인데 BGM 이 옛 값으로
/// 되돌아갑니다. 프런트에서 다시 읽는 횟수를 늘려도 그 틈은 안 없어집니다 — **읽고 쓰는
/// 사이를 잠글 수 있는 자리가 여기뿐**입니다(2026-09-23 검토).
///
/// `SAVE_LOCK` 안에서 읽고 얹고 씁니다. 프로세스 하나 안의 두 창은 이 자물쇠로 한 줄에 섭니다.
///
/// # 같은 칸을 동시에 고치면
///
/// 파일 쪽 도장(`savedAt`)이 더 나중이면 **그쪽을 둡니다.** 같은 칸을 같은 순간에 고치는 일은
/// 드물고, 그때는 나중 것이 이기는 편이 덜 놀랍습니다. 다른 칸은 서로 건드리지 않습니다.
///
/// 얹은 뒤의 **파일 전체**를 돌려줍니다 — 부르는 쪽이 제 사본을 그것으로 갈아 끼우면
/// 다음 쓰기가 남의 칸을 덮지 않습니다.
#[tauri::command]
pub fn merge_app_settings(
    app: tauri::AppHandle,
    section: String,
    saved_at: f64,
    value: serde_json::Value,
) -> Res<String> {
    merge_app_settings_at(app_settings_path(&app)?, section, saved_at, value)
}

/// Same atomic settings operation with the application's already-resolved store.
pub(crate) fn merge_app_settings_at(
    path: PathBuf,
    section: String,
    saved_at: f64,
    value: serde_json::Value,
) -> Res<String> {
    use serde_json::{json, Value};

    if section.trim().is_empty() {
        return Err("칸 이름이 비었습니다.".into());
    }
    let _guard = SAVE_LOCK.lock_safe();

    // 파일이 없거나 깨졌으면 빈 것에서 시작합니다 — 처음 켠 것뿐이라 오류가 아닙니다.
    let on_disk: Value = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| json!({})),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(err("앱 설정을 읽지 못했습니다", e)),
    };
    let merged = merge_one_entry(on_disk, &section, saved_at, value);
    let text = serde_json::to_string(&merged).map_err(|e| err("앱 설정을 적지 못했습니다", e))?;
    write_atomic(&path, &text)?;
    Ok(text)
}

/// 거울 한 벌에 **한 칸만** 얹습니다 — 파일을 만지지 않는 순수한 부분입니다.
///
/// 파일 살림과 갈라 둔 까닭: 틀리기 쉬운 것은 «언제 덮고 언제 두는가» 이 규칙 하나인데,
/// `AppHandle` 이 필요한 명령 안에 두면 시험할 수가 없습니다.
fn merge_one_entry(
    on_disk: serde_json::Value,
    section: &str,
    saved_at: f64,
    value: serde_json::Value,
) -> serde_json::Value {
    use serde_json::json;

    let mut root = if on_disk.is_object() { on_disk } else { json!({}) };
    let object = root.as_object_mut().expect("바로 위에서 객체로 맞췄습니다");
    let entries = object.entry("entries").or_insert_with(|| json!({}));
    if !entries.is_object() {
        *entries = json!({});
    }
    let entries = entries.as_object_mut().expect("바로 위에서 객체로 맞췄습니다");

    // 파일 쪽 도장이 더 나중이면 **그쪽을 둡니다.** 다른 칸은 손대지 않습니다.
    let theirs = entries
        .get(section)
        .and_then(|item| item.get("savedAt"))
        .and_then(|stamp| stamp.as_f64());
    if theirs.map_or(true, |stamp| stamp <= saved_at) {
        entries.insert(
            section.to_string(),
            json!({ "savedAt": saved_at, "value": value }),
        );
    }
    root
}

#[cfg(test)]
mod merge_tests {
    use super::merge_one_entry;
    use serde_json::json;

    /// 얹은 칸의 값을 꺼내 봅니다.
    fn value_of(root: &serde_json::Value, section: &str) -> serde_json::Value {
        root["entries"][section]["value"].clone()
    }

    #[test]
    fn 남의_칸은_건드리지_않습니다() {
        // A 가 bgm 을 고친 파일에, B 가 저장 폴더만 얹습니다.
        let on_disk = json!({"entries": {
            "bgm": {"savedAt": 200.0, "value": "A 가 고친 것"},
        }});
        let merged = merge_one_entry(on_disk, "folder", 100.0, json!("새 폴더"));
        assert_eq!(value_of(&merged, "bgm"), json!("A 가 고친 것"), "남의 칸이 되돌아갔습니다");
        assert_eq!(value_of(&merged, "folder"), json!("새 폴더"));
    }

    #[test]
    fn 파일_쪽이_더_나중이면_그쪽을_둡니다() {
        let on_disk = json!({"entries": {"bgm": {"savedAt": 300.0, "value": "나중 것"}}});
        let merged = merge_one_entry(on_disk, "bgm", 100.0, json!("먼저 것"));
        assert_eq!(value_of(&merged, "bgm"), json!("나중 것"));
    }

    #[test]
    fn 같은_도장이면_새것이_이깁니다() {
        // «나중 것이 이긴다» 를 도장이 같을 때까지 밀면 저장이 안 먹는 것처럼 보입니다.
        let on_disk = json!({"entries": {"bgm": {"savedAt": 100.0, "value": "옛것"}}});
        let merged = merge_one_entry(on_disk, "bgm", 100.0, json!("새것"));
        assert_eq!(value_of(&merged, "bgm"), json!("새것"));
    }

    #[test]
    fn 깨진_파일에서도_시작합니다() {
        // 파일이 배열이거나 entries 가 객체가 아니어도 설정이 통째로 막히면 안 됩니다.
        for broken in [json!([1, 2, 3]), json!({"entries": "글자"}), json!(null)] {
            let merged = merge_one_entry(broken, "bgm", 1.0, json!("값"));
            assert_eq!(value_of(&merged, "bgm"), json!("값"));
        }
    }
}

/// 저장 폴더를 asset 프로토콜에 열어 줍니다.
///
/// # 왜 실행 중에 여는가
///
/// 웹뷰가 `convertFileSrc()` 로 만든 주소로 그림을 읽으려면 그 경로가
/// asset 프로토콜 scope 안에 있어야 합니다. 그런데 scope 는 tauri.conf 에
/// 박아 두는 정적 glob 이고, **이 앱의 저장 폴더는 사람이 실행 중에 고릅니다.**
/// 미리 적어 둘 수가 없어요.
///
/// 그래서 conf 의 scope 는 비워 두고, 폴더가 정해지는 순간 여기서 엽니다.
/// 이걸 안 부르면 썸네일이 전부 깨진 그림으로 뜨고, 그 주소를 fetch 하는
/// 이미지 분석도 «Failed to fetch» 로 죽습니다.
///
/// scope 는 앱을 껐다 켜면 사라지므로 **켤 때마다** 불러야 합니다.
#[tauri::command]
pub fn allow_storage_directory(app: tauri::AppHandle, directory: String) -> Res<()> {
    use tauri::Manager;
    let path = Path::new(&directory);
    if directory.trim().is_empty() || !path.is_dir() {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|e| err("저장 폴더를 열지 못했습니다", e))
}

/// 폴더만 미리 만들어 둡니다.
///
/// 저장 폴더를 고른 직후에 `Prompt` 와 `PosePreset` 이 눈에 보여야 합니다.
/// 파일이 처음 저장될 때까지 아무것도 안 생기면, 탐색기를 열어 본 사람은
/// «설정이 안 먹었나» 하고 다시 고르게 됩니다.
#[tauri::command]
pub fn ensure_directory(path: String) -> Res<String> {
    let dir = Path::new(&path);
    ensure_dir(dir)?;
    Ok(dir.to_string_lossy().to_string())
}

/// 사람이 고른 글 파일 하나를 읽습니다. 불러오기가 씁니다.
///
/// **시작 폴더를 받는 것이 요점입니다.** 브라우저의 `<input type=file>` 로는
/// 어디서 열릴지 정할 수 없어서, 앱이 파일을 넣어 둔 자리를 뻔히 알면서도
/// 사용자가 매번 찾아 들어가야 했습니다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    path: String,
    contents: String,
}

#[tauri::command]
pub fn choose_text_file(directory: String, extension: String) -> Res<Option<PickedFile>> {
    let allowed = ["md", "json", "txt"];
    let extension = extension.to_ascii_lowercase();
    if !allowed.contains(&extension.as_str()) {
        return Err(format!("{extension} 확장자는 열지 않습니다."));
    }

    let mut dialog = rfd::FileDialog::new()
        .set_title("불러올 파일을 고르세요")
        .add_filter(format!("{extension} 파일"), &[extension.as_str()]);

    // 폴더가 실제로 있을 때만 시작 자리로 씁니다. 없는 경로를 주면
    // 대화상자가 제 마음대로 다른 곳에서 열립니다.
    let start = Path::new(&directory);
    if !directory.trim().is_empty() && start.is_dir() {
        dialog = dialog.set_directory(start);
    }

    let Some(path) = dialog.pick_file() else {
        return Ok(None);
    };
    let contents = fs::read_to_string(&path).map_err(|e| err("파일을 읽지 못했습니다", e))?;
    Ok(Some(PickedFile {
        path: path.to_string_lossy().to_string(),
        contents,
    }))
}

/// 아무 폴더에나 글 파일 하나를 씁니다. 내보내기가 씁니다.
///
/// 확장자를 받아 두는 이유: md·json·txt 만 허용합니다. 프런트에서 넘어온
/// 문자열로 실행 파일이 만들어지는 길을 열어 두지 않습니다.
#[tauri::command]
pub fn save_text_file(request: SaveNamedRequest, extension: String) -> Res<String> {
    let allowed = ["md", "json", "txt"];
    let extension = extension.to_ascii_lowercase();
    if !allowed.contains(&extension.as_str()) {
        return Err(format!("{extension} 확장자로는 저장하지 않습니다."));
    }
    save_named(request, &extension)
}
