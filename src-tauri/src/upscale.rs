//! 로컬 업스케일 엔진 — 설치·상주 워커·실행.
//!
//! # 왜 이렇게 만들었나
//!
//! ComfyUI 는 남이 언제든 바꾸는 환경이라, 우리가 쓰는 엔진은 **앱 데이터
//! 폴더 안에 각자 고정 환경**으로 깔고 판을 우리가 정합니다.
//!
//! ```text
//! <app_data>/upscale/
//! tools/uv.exe 고정 판 · sha256 확인
//! engines/<id>/
//! .venv/ uv venv --python 3.12
//! src/ 고정 커밋 코드 압축본을 푼 것
//! models/ 가중치 (sha256·크기 확인, 이어받기)
//! manifest.json 설치 상태(판·시각·마지막 오류)
//! logs/<id>.log 워커 stderr
//! ```
//!
//! 워커 스크립트·요구사항·URL 목록은 **앱 리소스**(`resources/upscale/`)에 있습니다.
//! 앱을 새로 깔면 스크립트는 새것, 이미 받아 둔 가중치는 그대로입니다.
//!
//! # 왜 상주 워커인가
//!
//! SeedVR2 7B fp16 은 올리는 데만 수십 초입니다. 한 장마다 프로세스를 새로 띄우면
//! 그 시간을 매번 냅니다. 그래서 엔진마다 파이썬을 하나 띄워 두고 stdin/stdout 의
//! JSON 줄로 일을 시킵니다(`resources/upscale/worker.py`).
//!
//! # 안전
//!
//! - 제거는 `upscale/engines/<id>/` 안인지 **canonicalize 로 확인한 뒤에만** 지웁니다.
//! (D 드라이브 사고의 구조가 «의도한 대상은 좁았는데 명령의 사정거리가 넓었다» 였습니다.)
//! - zip 은 경로 탈출(`..`, 절대 경로, 드라이브 문자)을 막고 풉니다.
//! - 워커 종료는 **우리가 띄우며 받아 둔 자식 핸들(PID)** 로만 합니다. 이름 기준 kill 금지.
//! - 다운로드는 `.내려받는중` 임시 파일 → 크기·해시 확인 → 이름 바꾸기.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write as _};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::comfy::UPSCALE_EXTENSIONS;
use crate::download::human;
use crate::LockSafe;
use crate::{err, next_numbered_path, safe_name, Res};

/// 엔진 **갈래** — 업스케일과 «로컬 생성» 이 같은 설치·워커 살림을 씁니다.
///
/// 설치(uv·venv·가중치 해시 확인·이어받기), 상주 워커,
/// 취소, 로그, 안전한 제거는 업스케일에서 이미 다 만들어 두었습니다. 그 살림을 그대로
/// 쓰고 **폴더 이름과 엔진 목록만** 갈래로 가릅니다 — 두 벌로 두면 한쪽만 고치는 날이 옵니다.
pub struct Family {
    /// 앱 데이터·리소스 폴더 이름.
    pub dir: &'static str,
    /// 사람에게 보일 이름(오류 문구의 「설정 → …」).
    pub label: &'static str,
    /// 프런트가 듣는 진행 이벤트 이름.
    pub event: &'static str,
    /// 아는 엔진 id. **목록에 없는 id 는 경로로도 만들지 않습니다**(경로 조작 차단).
    pub ids: &'static [&'static str],
}

pub static UPSCALE: Family = Family {
    dir: "upscale",
    label: "업스케일",
    event: "upscale-progress",
    ids: &["seedvr2", "spandrel", "nvvfx", "vosr", "upscayl"],
};

/// 로컬 생성 엔진 — 영상·이미지·음악을 이 컴퓨터에서 직접 뽑습니다.
pub static LOCAL: Family = Family {
    dir: "local",
    label: "로컬 모델",
    event: "local-progress",
    /*
      id 는 곧 **파이썬 모듈 이름**입니다(`engines/<id>.py`). 하이픈을 쓰면 import 가 안 됩니다.

      / 「미니맥스 컴피UI에서 로컬로 돌아가는데..?」 — 맞습니다.
      **MiniMax-H3**(영상+오디오, 2026-08-03)와 **MiniMax-Music3**(2026-08-13)가 오픈
      웨이트로 나왔고 diffusers 로 바로 돕니다. 컴피UI 없이 우리가 직접 돌립니다.

      Wan·ACE-Step 은 **가벼운 대안**으로 남깁니다. 미니맥스 H3 는 bf16 기준 트랜스포머
      61.7 GB + 조건화기 62.1 GB 라 호스트 RAM 이 75 GB 쯤 있어야 int8 로 돌아갑니다.
      그 문턱에 못 미치는 기계에서도 뭔가는 돌아가야 합니다.
    */
    /*
      모션 캡처(`nlf`·`sam3dbody`·`gvhmr`)도 이 갈래입니다 —  결과가 영상·그림이 아니라 JSON 한 파일일 뿐, 설치·상주 워커·`generate` 한 길은 같습니다.
    */
    ids: &[
        "minimaxh3",
        "minimaxmusic",
        "wanvideo",
        "acestep",
        "qwenimage",
        // 사용자 2026-09-17: FLUX.1 Krea · SD 3.5 를 빼고 Z-Image Turbo · Anima 로 갈았습니다.
        "zimage",
        "krea2",
        "anima",
        "ltx25",
        "nlf",
        "sam3dbody",
        "gvhmr",
    ],
};

static FAMILIES: &[&Family] = &[&UPSCALE, &LOCAL];

/// 엔진 id 로 갈래를 찾습니다. **id 는 갈래를 통틀어 하나뿐**이라야 합니다 —
/// 겹치면 폴더가 엉킵니다(같은 id 를 두 갈래에 쓰지 마세요).
pub(crate) fn family_of(id: &str) -> Res<&'static Family> {
    FAMILIES
        .iter()
        .copied()
        .find(|family| family.ids.contains(&id))
        .ok_or_else(|| format!("모르는 엔진입니다: {id}"))
}

/// 워커가 응답을 안 줄 때 기다릴 기본 시간. 8K 는 프런트가 1800 초를 넘겨 줍니다.
const DEFAULT_TIMEOUT_SECS: u64 = 1800;

/// `quit` 을 보내고 스스로 끝나기를 기다릴 시간. 지나면 자식 핸들로 종료합니다.
const QUIT_GRACE: Duration = Duration::from_secs(3);

/// 가중치 미리 받기(`prefetch`)를 기다릴 시간. 190 GB 를 느린 회선으로 받으면 하루가 넘어갑니다 —
/// 시간 초과로 끊는 것보다 «취소» 단추가 끊게 두는 편이 맞습니다(취소는 깃발로 따로 봅니다).
const PREFETCH_TIMEOUT_SECS: u64 = 48 * 3600;

/// 생성이 끝난 뒤 폴더 크기를 다시 재는 최소 간격. 영상을 연달아 뽑을 때마다 2만 파일을 걷지 않게.
const DISK_REMEASURE_AFTER_RUN_SECS: u64 = 10 * 60;

/// 상태 조회 때 «이 값은 낡았다» 로 보는 나이. 하루에 한 번이면 카드 숫자가 현실을 따라갑니다.
const DISK_STALE_SECS: u64 = 24 * 3600;

// ─────────────────────────────────────────────────────────────────────────────
// 리소스의 manifest (읽기 전용 — 우리가 손으로 정한 고정 판)
// ─────────────────────────────────────────────────────────────────────────────

fn default_models_dir() -> String {
    "models".to_string()
}

#[derive(Debug, Clone, Deserialize)]
struct CodeEntry {
    #[allow(dead_code)]
    #[serde(default)]
    id: String,
    url: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    sha256: Option<String>,
    /// 엔진 폴더 기준으로 풀어 놓을 자리.
    dest: String,
    /// GitHub 압축본처럼 «폴더 하나로 감싼» 것이면 그 한 겹을 벗깁니다.
    #[serde(default)]
    strip_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct ModelEntry {
    id: String,
    #[serde(default)]
    optional: bool,
    /// `models_dir` 기준 상대 경로.
    path: String,
    url: String,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct EngineManifest {
    id: String,
    name: String,
    #[serde(default)]
    purpose: String,
    #[serde(default)]
    version: String,
    /// `"python"`(uv 환경 + 워커) 또는 `"binary"`(exe 를 바로 부름).
    kind: String,
    #[serde(default)]
    python: Option<String>,
    #[serde(default)]
    experimental: bool,
    /// 빠른 어텐션(SageAttention)을 **이 PC 에 맞으면** 곁들여 깔지. 워커가 실제로
    /// `common.use_fast_attention` 을 부르는 엔진(영상 쪽)만 켭니다.
    #[serde(default)]
    fast_attention: bool,
    /// **혼자 써야 하는 엔진.** 이걸 띄우기 전에 같은 갈래의 다른 상주 워커를 내립니다.
    #[serde(default)]
    heavy: bool,
    /// 가중치를 **설치 때 통째로 미리 받는** 엔진(워커 op `prefetch`). 이 깃발이 «단추를 보일지» 와
    /// «설치 끝에 받을지» 를 한꺼번에 정합니다 — 파이썬 쪽은
    /// 엔진 모듈에 `prefetch(root, report)` 가 있어야 하고, 없으면 워커가 바로 done 을 돌려줍니다.
    #[serde(default)]
    prefetch: bool,
    #[serde(default = "default_models_dir")]
    models_dir: String,
    /// binary 엔진의 실행 파일(엔진 폴더 기준).
    #[serde(default)]
    exe: Option<String>,
    #[serde(default)]
    default_model: Option<String>,
    #[serde(default)]
    code: Vec<CodeEntry>,
    #[serde(default)]
    models: Vec<ModelEntry>,
    /// 만들어만 두면 되는 빈 파일(예: torch.hub 의 `trusted_list`).
    #[serde(default)]
    empty_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ToolSpec {
    version: String,
    url: String,
    sha256: Option<String>,
    #[serde(default)]
    size: Option<u64>,
    exe: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ToolsFile {
    uv: ToolSpec,
}

/// 설치한 뒤 엔진 폴더에 남기는 기록. 프런트의 «판·마지막 오류» 가 여기서 나옵니다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstalledRecord {
    #[serde(default)]
    version: String,
    #[serde(default)]
    installed_at: String,
    #[serde(default)]
    last_error: String,
    /// 실제로 받아 둔 가중치 id 들(선택 모델 포함).
    #[serde(default)]
    models: Vec<String>,
    /// 마지막으로 잰 엔진 폴더 크기.
    ///
    /// 상태 조회 때마다 `dir_size` 로 재귀 walk 를 하면 torch 가 든 `.venv` 하나가 파일
    /// 2만 개대라 설정 화면이 몇 초씩 멈췄습니다(2026-09-09 지적). 표시용 숫자이므로
    /// 조회는 늘 이 값을 그대로 읽고, **다시 재는 일은 조회 스레드가 아니라 뒤에서** 합니다
    /// (`remeasure_disk_in_background`) — 생성 뒤·하루 지난 뒤·미리 받기 뒤.
    ///
    /// 사용자 2026-09-22: 설치 끝에 한 번만 재 두었더니 미니맥스 카드가 「4.5 GB」 인데 폴더는
    /// 183 GB 였습니다. 그때는 venv 뿐이었고 가중치는 첫 생성 때 들어왔기 때문입니다.
    #[serde(default)]
    disk_bytes: u64,
    /// `disk_bytes` 를 잰 시각(UNIX 초). 0 이면 «잰 적 없음» — 옛 기록은 다음 조회 때 뒤에서 다시 잽니다.
    #[serde(default)]
    disk_measured_at: u64,
    /// 가중치를 통째로 받아 두었는가(`prefetch` 가 끝까지 간 뒤 true). 이 값이 아니면 카드에
    /// «가중치 미리 받기» 단추가 뜹니다 — 사용자의 기계처럼 이미 깔린 엔진에 나중에 받는 길입니다.
    #[serde(default)]
    weights_ready: bool,
}

/// 프런트(`upscale.ts`)가 받는 상태 한 줄.
#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    id: String,
    name: String,
    purpose: String,
    installed: bool,
    installing: bool,
    /// 지금 가중치를 미리 받는 중인가(`UpscaleState::prefetching`). `installing` 과 따로 두는 까닭은
    /// 프런트의 «멈추기» 단추 문구 — 예전에는 `installed` 로 골랐는데, 새로 까는 엔진은 `uv venv` 직후부터
    /// «설치됨» 이라 패키지를 받는 동안에도 「받기 멈추기」 로 보였습니다(2026-09-22 점검).
    prefetching: bool,
    version: String,
    models_ready: bool,
    disk_bytes: u64,
    /// 가중치를 통째로 받아 두었는가(설치 기록의 `weights_ready`).
    weights_ready: bool,
    /// 이 엔진이 «미리 받기» 를 아는가(manifest 의 `prefetch`). 아니면 단추를 보이지 않습니다.
    prefetch: bool,
    last_error: String,
    experimental: bool,
    external: bool,
}

/// `upscale_run` 이 돌려주는 것.
#[derive(Debug, Clone, Serialize)]
pub struct UpscaleResult {
    output: String,
    width: u32,
    height: u32,
    seconds: f64,
}

/// 프런트가 넘기는 목표 지정. **필드 이름이 snake_case 인 것은 프런트와 맞춘 것입니다.**
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct TargetSpec {
    #[serde(default)]
    long_edge: Option<u32>,
    #[serde(default)]
    scale: Option<u32>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 앱 상태
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Worker {
    pid: u32,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    /// 요청 id → 답을 기다리는 자리.
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
    /// 기동 직후 온 `ready` 한 줄.
    ready: Arc<Mutex<Option<Value>>>,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct UpscaleState {
    workers: Mutex<HashMap<String, Worker>>,
    /// 설치 중인 엔진의 취소 깃발.
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 지금 가중치를 미리 받는 중인 엔진(설치 끝의 미리 받기와 «가중치 미리 받기» 단추 둘 다).
    /// `cancels` 만으로는 설치와 미리 받기를 못 가릅니다 — 상태의 `prefetching` 이 여기서 나옵니다.
    prefetching: Mutex<HashSet<String>>,
    /// 엔진별 «한 번에 하나» 자물쇠. VRAM 을 다투면 느려지거나 죽습니다.
    queues: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// 요청 id 만드는 번호표.
    counter: AtomicU64,
}

impl UpscaleState {
    fn queue(&self, engine: &str) -> Arc<Mutex<()>> {
        let mut queues = self.queues.lock_safe();
        queues.entry(engine.to_string()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    }

    fn next_id(&self) -> String {
        format!("{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 경로
// ─────────────────────────────────────────────────────────────────────────────

/// 프런트가 준 id 를 **아는 엔진**으로 굳힙니다. 설치·실행·제거·워커 조회, 그리고 로라 폴더
/// (`lora::lora_dir`)가 전부 이 한 문을 지납니다.
///
/// 공개판(`edition.rs`)에서 빠진 엔진은 여기서 «모르는 엔진» 취급입니다 — 옛 프런트나 저장된
/// 프로젝트가 `gvhmr` 를 들고 와도 이 문에서 막혀, 리소스가 없어 엉뚱하게 실패하는 일이 없습니다.
pub(crate) fn known_engine(id: &str) -> Res<&'static str> {
    let known = family_of(id)?
        .ids
        .iter()
        .copied()
        .find(|known| *known == id)
        .ok_or_else(|| format!("모르는 엔진입니다: {id}"))?;
    if !crate::edition::includes_engine(known) {
        return Err(format!("이 판에는 포함되지 않은 엔진입니다: {id}"));
    }
    Ok(known)
}

fn data_root(app: &AppHandle, family: &Family) -> Res<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| err("앱 데이터 폴더를 찾지 못했습니다", e))?;
    Ok(base.join(family.dir))
}

/// 워커 스크립트·manifest 가 있는 리소스 폴더.
///
/// 번들에서 먼저 찾고, 없으면 개발 중(`pnpm dev:desktop`)이라 보고 크레이트 폴더를 봅니다.
/// 개발 때 리소스가 아직 복사되지 않는 경우가 있어 둘 다 봅니다.
fn resources_root(app: &AppHandle, family: &Family) -> Res<PathBuf> {
    let under = format!("resources/{}", family.dir);
    if let Ok(path) = app.path().resolve(&under, tauri::path::BaseDirectory::Resource) {
        if path.is_dir() {
            return Ok(path);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join(family.dir);
    if dev.is_dir() {
        return Ok(dev);
    }
    Err(format!("{} 워커 리소스를 찾지 못했습니다({under}).", family.label))
}

pub(crate) fn engine_dir(app: &AppHandle, id: &str) -> Res<PathBuf> {
    let id = known_engine(id)?;
    Ok(data_root(app, family_of(id)?)?.join("engines").join(id))
}

fn logs_dir(app: &AppHandle, family: &Family) -> Res<PathBuf> {
    let dir = data_root(app, family)?.join("logs");
    fs::create_dir_all(&dir).map_err(|e| err("로그 폴더를 만들지 못했습니다", e))?;
    Ok(dir)
}

fn venv_python(engine_root: &Path) -> PathBuf {
    if cfg!(windows) {
        engine_root.join(".venv").join("Scripts").join("python.exe")
    } else {
        engine_root.join(".venv").join("bin").join("python")
    }
}

fn read_manifest(app: &AppHandle, id: &str) -> Res<EngineManifest> {
    let id = known_engine(id)?;
    let path = resources_root(app, family_of(id)?)?.join("engines").join(id).join("manifest.json");
    let text = fs::read_to_string(&path).map_err(|e| err(&format!("{id} 의 manifest 를 읽지 못했습니다"), e))?;
    serde_json::from_str(&text).map_err(|e| err(&format!("{id} 의 manifest 형식이 잘못됐습니다"), e))
}

fn read_record(engine_root: &Path) -> InstalledRecord {
    fs::read_to_string(engine_root.join("manifest.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_record(engine_root: &Path, record: &InstalledRecord) -> Res<()> {
    fs::create_dir_all(engine_root).map_err(|e| err("엔진 폴더를 만들지 못했습니다", e))?;
    let text = serde_json::to_string_pretty(record).map_err(|e| err("설치 기록을 만들지 못했습니다", e))?;
    /*
      임시 파일에 쓰고 이름을 바꿉니다(2026-09-22 점검). `fs::write` 는 비우고 나서 채우는데, 이제 이 기록을
      뒤 스레드(`remeasure_disk_in_background`)도 쓰므로 비운 순간에 상태 조회가 읽으면 빈 파일 → 기본값으로
      읽혀 «설치 안 됨» 으로 보이고, 그 조회가 되받아 쓰면 진짜 기록(판·모델·weights_ready)이 기본값으로 덮입니다.
      이름 바꾸기는 한 번에 갈아 끼우므로 읽는 쪽은 늘 옛 기록이거나 새 기록입니다. 기록을 쓰는 곳은 여기 하나입니다.
    */
    // 임시 이름도 작업마다 달라야 합니다 — 고정이면 설치 스레드와 뒤에서 도는 크기 재기가
    // **같은 임시 파일**에 겹쳐 쓰고, 먼저 이름을 바꾼 쪽 때문에 나중 쪽은 바꿀 것이 없어집니다.
    let path = engine_root.join("manifest.json");
    let temp = engine_root.join(format!("manifest.json.{}.tmp", job_tag()));
    fs::write(&temp, text).map_err(|e| err("설치 기록을 쓰지 못했습니다", e))?;
    if let Err(e) = fs::rename(&temp, &path) {
        // 갈아 끼우지 못했으면 임시 파일을 치웁니다. 남으면 엔진 폴더에 찌꺼기가 쌓입니다.
        let _ = fs::remove_file(&temp);
        return Err(err("설치 기록을 갈아 끼우지 못했습니다", e));
    }
    Ok(())
}

/// 폴더 크기(재귀). 못 읽는 것은 건너뜁니다 — 상태 표시용이라 정확도보다 안 죽는 게 중요합니다.
fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    let Ok(entries) = fs::read_dir(path) else { return 0 };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            total += dir_size(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
}

// ─────────────────────────────────────────────────────────────────────────────
// 진행 이벤트
// ─────────────────────────────────────────────────────────────────────────────

fn progress(app: &AppHandle, engine: &str, stage: &str, percent: Option<f64>, message: &str) {
    // 갈래마다 이벤트 이름이 다릅니다 — 설정 화면(업스케일)과 로컬 모델 화면이 서로의
    // 진행 줄을 받아 엉뚱한 막대가 움직이면 안 됩니다.
    let event = family_of(engine).map(|f| f.event).unwrap_or(UPSCALE.event);
    let _ = app.emit(
        event,
        json!({
            "engine": engine,
            "stage": stage,
            "percent": percent,
            "message": message,
            "done": false,
            "error": Value::Null,
        }),
    );
}

fn progress_done(app: &AppHandle, engine: &str, stage: &str, error: Option<&str>) {
    let event = family_of(engine).map(|f| f.event).unwrap_or(UPSCALE.event);
    let _ = app.emit(
        event,
        json!({
            "engine": engine,
            "stage": stage,
            "percent": if error.is_some() { Value::Null } else { json!(100) },
            "message": error.unwrap_or(""),
            "done": true,
            "error": error.map(|e| json!(e)).unwrap_or(Value::Null),
        }),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 다운로드 (임시 파일 → 확인 → 이름 바꾸기, 이어받기)
// ─────────────────────────────────────────────────────────────────────────────

fn cancelled(flag: &Option<Arc<AtomicBool>>) -> bool {
    flag.as_ref().map(|f| f.load(Ordering::SeqCst)).unwrap_or(false)
}

/// 파일 하나를 받습니다 — 이어받기·크기·해시 확인은 `download.rs` 한 벌이 합니다.
/// 여기서는 «진행을 설치 화면으로 흘리는 일» 과 «취소 깃발» 만 얹습니다.
#[allow(clippy::too_many_arguments)]
async fn download_file(
    app: &AppHandle,
    engine: &str,
    stage: &str,
    label: &str,
    url: &str,
    dest: &Path,
    expected_sha: Option<&str>,
    expected_size: Option<u64>,
    cancel: &Option<Arc<AtomicBool>>,
) -> Res<()> {
    crate::download::fetch(
        crate::download::Download {
            url,
            dest,
            label,
            expected_sha,
            expected_size,
            login_hint: None,
            // 승인받은 사람만 받는 저장소(허깅페이스 게이트)는 토큰이 있어야 합니다 — 로라와 같은 한 벌.
            bearer: crate::llm::read_api_key("huggingface").ok(),
        },
        |beat| {
            if beat.verifying {
                progress(app, engine, stage, None, &format!("{label} 해시 확인"));
                return;
            }
            progress(
                app,
                engine,
                stage,
                beat.percent,
                &format!(
                    "{label} {} / {}",
                    human(beat.written),
                    beat.total.map(human).unwrap_or_else(|| "?".into())
                ),
            );
        },
        || cancelled(cancel),
    )
    .await
    // 설치 화면의 말로 바꿔 줍니다 — 「멈췄습니다」 만으로는 무엇이 멈췄는지 모릅니다.
    .map_err(|message| {
        if message.starts_with("멈췄습니다") {
            "설치를 멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".to_string()
        } else {
            message
        }
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// zip 풀기 (경로 탈출 차단)
// ─────────────────────────────────────────────────────────────────────────────

/// zip 안의 이름을 «대상 폴더 아래의 상대 경로» 로만 받아들입니다.
///
/// 절대 경로·드라이브 문자·`..` 이 하나라도 있으면 거부합니다. zip 하나가
/// `../../..` 로 시작하는 이름을 담고 있으면 대상 폴더 밖에 파일을 쓸 수 있습니다.
fn safe_entry_path(name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return None;
    }
    let mut out = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

fn extract_zip(archive_path: &Path, dest: &Path, strip_root: bool) -> Res<()> {
    let file = fs::File::open(archive_path).map_err(|e| err("압축본을 열지 못했습니다", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| err("압축본을 읽지 못했습니다", e))?;
    fs::create_dir_all(dest).map_err(|e| err("풀어 놓을 폴더를 만들지 못했습니다", e))?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| err("압축본 안을 읽지 못했습니다", e))?;
        let raw = entry.name().to_string();
        let Some(mut relative) = safe_entry_path(&raw) else {
            return Err(format!("압축본에 수상한 경로가 있습니다: {raw}"));
        };
        if strip_root {
            let mut parts = relative.components();
            parts.next();
            let rest: PathBuf = parts.collect();
            if rest.as_os_str().is_empty() {
                continue;
            }
            relative = rest;
        }
        let out_path = dest.join(&relative);
        // 한 번 더 — 심볼릭 링크 같은 것으로 밖을 가리키지 않는지.
        if !out_path.starts_with(dest) {
            return Err(format!("압축본이 대상 폴더 밖을 가리킵니다: {raw}"));
        }
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| err("폴더를 만들지 못했습니다", e))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| err("폴더를 만들지 못했습니다", e))?;
        }
        let mut out = fs::File::create(&out_path).map_err(|e| err("파일을 만들지 못했습니다", e))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| err("압축을 푸는 중 실패했습니다", e))?;
    }
    Ok(())
}

/// 지울 폴더가 «정말 이 엔진 폴더 안» 인지. 엔진 뿌리 자체는 거부합니다.
///
/// (D 드라이브 사고의 구조가 «의도한 대상은 좁았는데 명령의 사정거리가 넓었다» 였습니다.
/// 제거 명령과 같은 확인을 여기서도 합니다.)
fn inside_engine(engine_root: &Path, path: &Path) -> bool {
    path != engine_root && path.starts_with(engine_root) && path.components().count() > engine_root.components().count()
}

/// 코드 압축본을 **임시 폴더에 푼 뒤** 다 됐을 때만 제자리로 옮깁니다.
///
/// 대상 폴더에 바로 풀면 중간에 멈췄을 때 «비어 있지 않은 반쪽 트리» 가 남고, 그 뒤로는
/// 재설치가 코드 단계를 건너뛰어 고칠 길이 없었습니다(`code_ready` 설명 참조).
fn extract_code(archive_path: &Path, engine_root: &Path, dest: &Path, strip_root: bool) -> Res<()> {
    let staging = dest.with_file_name(format!(
        "{}.푸는중",
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("코드")
    ));
    if !inside_engine(engine_root, &staging) || !inside_engine(engine_root, dest) {
        return Err("코드를 풀 자리가 엔진 폴더 안이 아닙니다. 그만둡니다.".into());
    }
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| err("먼저 풀다 만 폴더를 치우지 못했습니다", e))?;
    }
    extract_zip(archive_path, &staging, strip_root)?;
    // 표식은 **마지막에** 씁니다 — 이 줄까지 왔다는 것이 곧 «끝까지 풀렸다» 입니다.
    fs::write(staging.join(CODE_DONE_MARK), b"").map_err(|e| err("압축 풀기 표식을 쓰지 못했습니다", e))?;
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| err("옛 코드 폴더를 치우지 못했습니다", e))?;
    }
    fs::rename(&staging, dest).map_err(|e| err("푼 코드를 제자리에 놓지 못했습니다", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// uv
// ─────────────────────────────────────────────────────────────────────────────

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — 설치 중에 검은 창이 깜빡이지 않게.
        command.creation_flags(0x0800_0000);
    }
    command
}

/// 우리가 띄운 «워커가 아닌» 자식들(uv·Upscayl). 정리는 **이 핸들로만** — 이름 기준 kill 금지.
///
/// 왜 따로 들고 있나(2026-09-09 지적): 이 자식들은 `workers` 에 없어서 앱을 닫을 때 정리
/// 대상이 아니었습니다. 설치 중에 앱을 닫으면 uv 가 고아로 남아 3 GB 를 계속 받았고,
/// Upscayl 이 매달리면 GPU 를 문 채 남았습니다.
static SIDE_CHILDREN: OnceLock<Mutex<Vec<(u64, Arc<Mutex<Child>>)>>> = OnceLock::new();
static SIDE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn side_children() -> &'static Mutex<Vec<(u64, Arc<Mutex<Child>>)>> {
    SIDE_CHILDREN.get_or_init(|| Mutex::new(Vec::new()))
}

fn register_side_child(child: Arc<Mutex<Child>>) -> u64 {
    let key = SIDE_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    side_children().lock_safe().push((key, child));
    key
}

fn unregister_side_child(key: u64) {
    side_children().lock_safe().retain(|(id, _)| *id != key);
}

/// 앱이 꺼질 때 — 남은 uv·Upscayl 자식을 우리가 받아 둔 핸들로만 끊습니다.
fn kill_side_children() {
    let children: Vec<(u64, Arc<Mutex<Child>>)> = side_children().lock_safe().drain(..).collect();
    for (_, child) in children {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 외부 명령을 돌리고 stdout+stderr 를 로그에 남깁니다. 실패하면 마지막 줄들을 오류로 올립니다.
///
/// `output()` 으로 끝까지 블로킹하던 것을 `spawn()` + 폴링으로 바꾼 이유(2026-09-09 지적):
/// 「패키지를 설치하는 중 (torch 는 3 GB 가 넘습니다)」 동안 «취소» 가 전혀 먹지 않았고,
/// Upscayl 이 매달리면 프런트가 넘긴 시간 제한이 무시된 채 엔진 큐를 영원히 쥐었습니다.
/// 이제 취소 깃발과 시간 제한을 여기서 보고, 끊을 때는 **우리가 받아 둔 자식 핸들로만** 끊습니다.
///
/// 파이프를 읽는 스레드를 따로 두는 이유: 폴링하면서 파이프를 안 읽으면 uv 처럼 출력이 많은
/// 명령이 파이프 버퍼가 차는 순간 그대로 멈춰 버립니다.

/// 오류문에서 **깨진 깃 캐시 자리**를 뽑습니다. uv 캐시 안일 때만 — 밖이면 빈 목록.
///
/// uv 는 깃 의존성을 두 곳에 둡니다.
///
/// <LOCALAPPDATA>/uv/cache/git-v0/db/<해시> 받아 둔 저장소
/// <LOCALAPPDATA>/uv/cache/git-v0/checkouts/<해시>/<커밋> 그 커밋을 편 자리
///
/// 2026-09-16 사용자 기계에서 이 둘이 **함께** 깨져 있었습니다. db 는 3월에 받다 만 것이라 HEAD 가 가리키는 ref 가 없었고
/// (직접 클론해 보면 `remote HEAD refers to nonexistent ref, unable to checkout`), 그래서 체크아웃은 매번 `.git` 만
/// 남기고 실패했습니다. 다음 설치는 그 `.git` 을 보고 「이미 있고 비어 있지 않다」 며 멈췄습니다.
///
/// 체크아웃만 지워서는 안 됩니다 — 깨진 db 에서 다시 펴면 같은 일이 되풀이됩니다. **둘 다** 지우면 uv 가 깃허브에서
/// 새로 받습니다(실측: 지운 뒤 같은 명령이 바로 통과).
///
/// **캐시 안만** 지웁니다 — 경로에 `/uv/cache/git-v0/` 가 들어 있고 실재하는 폴더여야 합니다.
fn stale_git_dirs(message: &str) -> Vec<PathBuf> {
    if !message.contains("already exists and is not an empty directory")
        && !message.contains("Git operation failed")
    {
        return vec![];
    }
    let mut found: Vec<PathBuf> = vec![];
    /*
      git 은 경로를 작은따옴표로 싸서 알려 주지만, **홀수 번째가 따옴표 안**이라고 셀 수는 없습니다 —
      같은 문장의 `didn't` 아포스트로피가 짝을 한 칸 밀어 버립니다(2026-09-16: 그 탓에 이 복구가 한 번도 안 돌았습니다).
      그래서 조각을 전부 보고 «캐시 안에 실재하는 폴더» 만 고릅니다.
    */
    for part in message.split('\'') {
        let candidate = part.trim().trim_matches('`').trim();
        let lower = candidate.replace('\\', "/").to_lowercase();
        if !lower.contains("/uv/cache/git-v0/") {
            continue;
        }
        let path = PathBuf::from(candidate);
        if path.is_dir() && !found.contains(&path) {
            found.push(path);
        }
    }
    found
}

/// **uv 로 패키지를 까는 일은 한 번에 하나씩.**
///
/// 사용자 2026-09-16: 엔진 셋(ACE-Step·MiniMax-H3·Music3)의 설치를 함께 눌렀더니 셋 다 같은 오류로 멈췄습니다.
/// uv 캐시(`<LOCALAPPDATA>/uv/cache`)는 **엔진들이 함께 쓰는 자리**입니다. H3 와 Music3 는 같은 `diffusers` 커밋을
/// 받는데, 두 프로세스가 같은 체크아웃 폴더에 동시에 클론하면 한쪽이 만든 폴더를 다른 쪽이 「이미 있고 비어 있지 않다」 며
/// 거부합니다. 앞서 넣은 «받다 만 캐시 지우고 다시» 도 이 경우에는 지우자마자 옆 프로세스가 다시 만들어 소용이 없습니다.
///
/// 받는 일 자체가 네트워크·디스크를 다 쓰는 일이라 동시에 해서 빨라질 것도 없습니다. 차례로 합니다.
static UV_INSTALL_LOCK: Mutex<()> = Mutex::new(());

/// 폴더를 지웁니다. **읽기 전용 파일이 있어도** — git 의 `.git/objects` 는 읽기 전용이라 그냥 지우면
/// 「액세스가 거부되었습니다」 로 막힙니다. 한 번 지워 보고, 막히면 나무를 걸으며 표시를 걷고 다시 지웁니다.
fn remove_tree_forced(dir: &Path) -> std::io::Result<()> {
    match fs::remove_dir_all(dir) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {}
    }
    fn clear_readonly(path: &Path) {
        if let Ok(meta) = fs::metadata(path) {
            let mut perms = meta.permissions();
            if perms.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perms.set_readonly(false);
                let _ = fs::set_permissions(path, perms);
            }
        }
    }
    fn walk(dir: &Path) {
        clear_readonly(dir);
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path);
            } else {
                clear_readonly(&path);
            }
        }
    }
    walk(dir);
    fs::remove_dir_all(dir)
}

/// `uv pip install` — 깃 캐시가 깨졌으면 **한 번 스스로 고치고 다시** 합니다.
fn run_uv_install(uv: &Path, args: &[String], log: &Path, cancel: &Arc<AtomicBool>) -> Res<()> {
    let first = run_tool(uv, args, None, log, "uv pip install", Some(cancel), None);
    let Err(message) = first else {
        return Ok(());
    };
    let stale = stale_git_dirs(&message);
    if stale.is_empty() {
        return Err(message);
    }
    for dir in &stale {
        append_log(log, &format!("깨진 깃 캐시를 지우고 다시 받습니다: {}
", dir.display()));
        remove_tree_forced(dir).map_err(|e| err("깨진 깃 캐시를 지우지 못했습니다", e))?;
    }
    run_tool(uv, args, None, log, "uv pip install", Some(cancel), None)
}

fn run_tool(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
    log: &Path,
    what: &str,
    cancel: Option<&Arc<AtomicBool>>,
    timeout: Option<Duration>,
) -> Res<()> {
    let mut command = hidden_command(program);
    command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let mut child = command.spawn().map_err(|e| err(&format!("{what} 을(를) 실행하지 못했습니다"), e))?;

    let collected = Arc::new(Mutex::new(String::new()));
    let mut readers = Vec::new();
    for pipe in [
        child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>),
        child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let sink = collected.clone();
        readers.push(std::thread::spawn(move || {
            read_lines_lossy(pipe, |line| {
                let mut text = sink.lock_safe();
                text.push_str(line);
                text.push('\n');
            });
        }));
    }

    let handle = Arc::new(Mutex::new(child));
    let key = register_side_child(handle.clone());
    let deadline = timeout.map(|limit| Instant::now() + limit);
    let mut stopped: Option<String> = None;
    let mut status = None;
    loop {
        {
            let mut child = handle.lock_safe();
            match child.try_wait() {
                Ok(Some(code)) => {
                    status = Some(code);
                    break;
                }
                Ok(None) => {}
                Err(e) => {
                    stopped = Some(err(&format!("{what} 의 상태를 읽지 못했습니다"), e));
                    break;
                }
            }
            if cancel.map(|flag| flag.load(Ordering::SeqCst)).unwrap_or(false) {
                let _ = child.kill();
                let _ = child.wait();
                stopped = Some("설치를 멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".to_string());
                break;
            }
            if deadline.map(|end| Instant::now() >= end).unwrap_or(false) {
                let _ = child.kill();
                let _ = child.wait();
                stopped = Some(format!(
                    "{what} 이(가) {}초 안에 끝나지 않아 끊었습니다. 로그를 보세요: {}",
                    timeout.map(|limit| limit.as_secs()).unwrap_or(0),
                    log.display()
                ));
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    unregister_side_child(key);
    for reader in readers {
        let _ = reader.join();
    }

    let mut text = String::new();
    text.push_str(&format!("$ {} {}\n", program.display(), args.join(" ")));
    text.push_str(&collected.lock_safe().clone());
    append_log(log, &text);
    if let Some(message) = stopped {
        return Err(message);
    }
    if status.map(|code| code.success()).unwrap_or(false) {
        return Ok(());
    }
    let tail: Vec<&str> = text.lines().rev().take(12).collect();
    let tail: Vec<&str> = tail.into_iter().rev().collect();
    Err(format!(
        "{what} 이(가) 실패했습니다.\n{}\n자세한 것은 로그: {}",
        tail.join("\n"),
        log.display()
    ))
}

/// 파이프를 **바이트로** 읽어 한 줄씩 넘깁니다. UTF-8 이 아닌 바이트는 «�» 로 바꿉니다.
///
/// 왜 `BufReader::lines()` 를 쓰지 않는가: `lines()` 는 UTF-8 이 아닌 바이트를 만나면 `Err` 를
/// 돌려주고, 우리는 거기서 `break` 했습니다. upscayl-bin 의 출력에 그런 바이트가 있습니다.
///
/// 어디에 있는지를 2026-09-09 에 다시 재현해 바로잡았습니다. 예전 주석은 «시작하며 찍는 저작권
/// 줄의 ©» 라고 했지만 **그런 줄은 없습니다** — 인자 없이 돌린 사용법 출력 1341바이트에 128 이상
/// 바이트가 0개입니다. 문제의 바이트는 **끝쪽 진행률 줄 안**에 있습니다: `\xa9\xa3\xa9\xa3100.00\r`.
///
/// 그래서 옛 `lines()` 가 실제로 삼키던 것은 **성공 실행의 마무리 3줄**(`100.00` · 빈 줄 ·
/// `🙌 Upscayled Successfully!`)이었고, 실패 실행에서는 그 바이트가 맨 끝 조각이라 «마지막 12줄»
/// 이 사라지지는 않았습니다. 즉 그때그때 그 바이트가 어디에 섞이느냐에 달린 문제라, 다음에
/// 중간으로 옮겨 오면 정작 원인 줄까지 사라집니다.
/// 로그는 «글자가 정확한 것» 보다 «남아 있는 것» 이 중요합니다.
fn read_lines_lossy<R: Read>(pipe: R, mut on_line: impl FnMut(&str)) {
    let mut reader = BufReader::new(pipe);
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => break,
            Ok(_) => {
                // 줄 끝(\r\n·\n)만 떼어 냅니다. 진행 막대의 \r 은 안쪽에 그대로 둡니다.
                while matches!(buffer.last(), Some(b'\n') | Some(b'\r')) {
                    buffer.pop();
                }
                on_line(&String::from_utf8_lossy(&buffer));
            }
            // 파이프가 끊긴 것 — 여기서 멈추는 것은 맞습니다(글자 문제가 아니라서).
            Err(_) => break,
        }
    }
}

fn append_log(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(text.as_bytes());
        let _ = file.write_all(b"\n");
    }
}

/// `tools/uv.exe` 를 확보합니다. 이미 있으면 그대로. 판이 바뀌면 새로 받습니다.
async fn ensure_uv(app: &AppHandle, engine: &str, cancel: &Option<Arc<AtomicBool>>) -> Res<PathBuf> {
    // uv 와 tools.json 은 **갈래를 가리지 않는 한 벌**입니다. 로컬 갈래가 따로 두면
    // 같은 exe 를 두 번 받고 판도 따로 놀게 됩니다.
    let tools_json = resources_root(app, &UPSCALE)?.join("tools.json");
    let text = fs::read_to_string(&tools_json).map_err(|e| err("tools.json 을 읽지 못했습니다", e))?;
    let tools: ToolsFile = serde_json::from_str(&text).map_err(|e| err("tools.json 형식이 잘못됐습니다", e))?;

    let tools_dir = data_root(app, &UPSCALE)?.join("tools");
    let exe = tools_dir.join(&tools.uv.exe);
    let stamp = tools_dir.join("uv.version");
    let installed = fs::read_to_string(&stamp).unwrap_or_default();
    if exe.is_file() && installed.trim() == tools.uv.version {
        return Ok(exe);
    }

    progress(app, engine, "uv", None, &format!("uv {} 를 받는 중", tools.uv.version));
    let archive = tools_dir.join("uv.zip");
    download_file(
        app,
        engine,
        "uv",
        "uv",
        &tools.uv.url,
        &archive,
        tools.uv.sha256.as_deref(),
        tools.uv.size,
        cancel,
    )
    .await?;
    progress(app, engine, "uv", None, "uv 를 푸는 중");
    extract_zip(&archive, &tools_dir, false)?;
    let _ = fs::remove_file(&archive);
    if !exe.is_file() {
        return Err("uv 실행 파일을 찾지 못했습니다.".into());
    }
    let _ = fs::write(&stamp, &tools.uv.version);
    Ok(exe)
}

// ─────────────────────────────────────────────────────────────────────────────
// 설치
// ─────────────────────────────────────────────────────────────────────────────

fn models_root(engine_root: &Path, manifest: &EngineManifest) -> PathBuf {
    let mut path = engine_root.to_path_buf();
    for part in manifest.models_dir.split('/') {
        if !part.is_empty() && part != "." && part != ".." {
            path.push(part);
        }
    }
    path
}

fn wanted_models<'a>(manifest: &'a EngineManifest, extra: &[String]) -> Vec<&'a ModelEntry> {
    manifest
        .models
        .iter()
        .filter(|model| !model.optional || extra.iter().any(|want| want == &model.id))
        .collect()
}

fn models_ready(engine_root: &Path, manifest: &EngineManifest) -> bool {
    let root = models_root(engine_root, manifest);
    manifest.models.iter().filter(|model| !model.optional).all(|model| {
        let path = root.join(&model.path);
        match fs::metadata(&path) {
            Ok(meta) => model.size.map(|size| meta.len() == size).unwrap_or(meta.len() > 0),
            Err(_) => false,
        }
    })
}

/// 압축을 **끝까지** 푼 뒤에만 남기는 표식. 이 파일이 있어야 «코드 준비됨» 입니다.
const CODE_DONE_MARK: &str = ".압축풀기_완료";

/// `code[].dest` 는 **엔진 뿌리 기준**입니다(`models[].path`·`empty_files` 는 models_dir 기준 —
/// 기준이 둘이라 헷갈리기 쉽습니다. manifest 를 고칠 때 여기를 보세요).
fn code_dest(engine_root: &Path, entry: &CodeEntry) -> Option<PathBuf> {
    safe_entry_path(&entry.dest).map(|safe| engine_root.join(safe))
}

/*
  코드가 다 풀렸는지 «폴더가 비어 있지 않은가» 로 보면 안 됩니다(2026-09-09 지적).

  `extract_zip` 은 항목을 하나씩 대상 폴더에 바로 풀기 때문에, 디스크가 차거나 압축본이
  잘렸거나 앱이 꺼져 중간에 멈추면 «비어 있지 않은 반쪽 트리» 가 남습니다. 그 뒤로는
  «설치» 를 눌러도 코드 단계를 통째로 건너뛰고 검증에서 import 오류만 반복했습니다 —
  제거 말고는 빠져나갈 길이 없었습니다.

  그래서 (1) 임시 폴더에 풀고 성공했을 때만 최종 이름으로 옮기고, (2) 그 자리에 표식을
  남깁니다. 표식이 없으면 반쪽으로 보고 다시 풉니다. 이 변경 전에 깐 엔진은 표식이 없어
  코드 압축본(수 MB)을 한 번 다시 받습니다 — 가중치(GB)는 크기·해시로 걸러져 그대로입니다.
*/
fn code_ready(engine_root: &Path, manifest: &EngineManifest) -> bool {
    manifest.code.iter().all(|entry| {
        code_dest(engine_root, entry).map(|dest| dest.join(CODE_DONE_MARK).is_file()).unwrap_or(false)
    })
}

fn is_installed(engine_root: &Path, manifest: &EngineManifest) -> bool {
    if !code_ready(engine_root, manifest) || !models_ready(engine_root, manifest) {
        return false;
    }
    match manifest.kind.as_str() {
        "binary" => manifest
            .exe
            .as_ref()
            .map(|exe| engine_root.join(exe.replace('\\', "/")).is_file())
            .unwrap_or(false),
        _ => venv_python(engine_root).is_file(),
    }
}

async fn install_engine(
    app: AppHandle,
    id: String,
    extra_models: Vec<String>,
    cancel: Arc<AtomicBool>,
) -> Res<()> {
    let engine = known_engine(&id)?;
    let manifest = read_manifest(&app, engine)?;
    let root = engine_dir(&app, engine)?;
    let family = family_of(engine)?;
    let log = logs_dir(&app, family)?.join(format!("{engine}.log"));
    let cancel_opt = Some(cancel.clone());
    fs::create_dir_all(&root).map_err(|e| err("엔진 폴더를 만들지 못했습니다", e))?;
    append_log(&log, &format!("\n===== 설치 시작 {} =====", chrono_now()));

    let check = |flag: &Arc<AtomicBool>| -> Res<()> {
        if flag.load(Ordering::SeqCst) {
            Err("설치를 멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".to_string())
        } else {
            Ok(())
        }
    };

    // 1) 파이썬 환경 — binary 엔진(upscayl)은 건너뜁니다.
    if manifest.kind != "binary" {
        check(&cancel)?;
        let uv = ensure_uv(&app, engine, &cancel_opt).await?;

        check(&cancel)?;
        let python = venv_python(&root);
        if !python.is_file() {
            progress(&app, engine, "python", None, "파이썬 3.12 환경을 만드는 중");
            let version = manifest.python.clone().unwrap_or_else(|| "3.12".to_string());
            let args = vec![
                "venv".to_string(),
                "--python".to_string(),
                version,
                root.join(".venv").to_string_lossy().to_string(),
            ];
            let uv2 = uv.clone();
            let log2 = log.clone();
            let cancel2 = cancel.clone();
            tauri::async_runtime::spawn_blocking(move || {
                run_tool(&uv2, &args, None, &log2, "uv venv", Some(&cancel2), None)
            })
            .await
            .map_err(|e| err("uv venv 를 기다리지 못했습니다", e))??;
        }

        // 2) 패키지 — 판을 전부 고정한 requirements.txt 를 그대로 씁니다.
        check(&cancel)?;
        progress(&app, engine, "deps", None, "패키지를 설치하는 중 (torch 는 3 GB 가 넘습니다)");
        let requirements = resources_root(&app, family)?.join("engines").join(engine).join("requirements.txt");
        if requirements.is_file() {
            // --index-strategy unsafe-best-match 가 필요한 이유(2026-09-09 실측):
            // PyTorch 의 cu128 인덱스는 packaging 같은 흔한 꾸러미도 옛 판으로 함께 미러합니다.
            // uv 는 기본으로 «먼저 찾은 인덱스만» 보기 때문에 packaging 을 거기서 찾고
            // «그 판이 없다» 며 멈춥니다. 우리 requirements.txt 는 판을 전부 못 박아 두어서
            // 여러 인덱스를 같이 봐도 «다른 것이 딸려 오는» 일이 없습니다.
            let args = vec![
                "pip".to_string(),
                "install".to_string(),
                "--index-strategy".to_string(),
                "unsafe-best-match".to_string(),
                "--python".to_string(),
                python.to_string_lossy().to_string(),
                "-r".to_string(),
                requirements.to_string_lossy().to_string(),
            ];
            let uv2 = uv.clone();
            let log2 = log.clone();
            // 취소 깃발을 여기까지 내려보냅니다 — 예전에는 3 GB 를 받는 동안 «취소» 가 먹지 않았습니다.
            let cancel2 = cancel.clone();
            /*
              다른 엔진이 먼저 깔고 있으면 **기다립니다**(위 `UV_INSTALL_LOCK`). 기다리는 동안 화면이 멈춘 것처럼 보이지 않게
              차례를 기다린다는 것을 먼저 알립니다.
            */
            if UV_INSTALL_LOCK.try_lock().is_err() {
                progress(&app, engine, "deps", None, "다른 엔진 설치가 끝나기를 기다리는 중 (uv 캐시를 함께 씁니다)");
            }
            tauri::async_runtime::spawn_blocking(move || {
                let _turn = UV_INSTALL_LOCK.lock_safe();
                // 차례를 기다리는 사이에 «설치 멈추기» 를 눌렀을 수 있습니다 — 그때는 시작하지 않습니다.
                if cancel2.load(Ordering::SeqCst) {
                    return Err("설치를 멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".to_string());
                }
                run_uv_install(&uv2, &args, &log2, &cancel2)
            })
            .await
            .map_err(|e| err("패키지 설치를 기다리지 못했습니다", e))??;
        }

        // 2-b) 빠른 어텐션 — **있으면 좋고, 없어도 됩니다.**
        //
        // 맞았습니다. 처음에는 커뮤니티 휠 주소를
        // requirements.txt 에 못 박아 두었는데, 그러면 엔비디아가 아니거나 sm_80 보다 낮은 GPU,
        // 윈도우가 아닌 PC 에서 **엔진 설치가 통째로 실패합니다.** 그래서 필수 꾸러미를 다 깐 뒤
        // 그 PC 의 토치를 직접 물어보고(`fast_attention.py`) 맞는 휠이 있을 때만 깝니다.
        //
        // 여기서 실패해도 **설치를 실패로 만들지 않습니다.** `common.use_fast_attention` 이
        // 다음 순위(flash_hub·_native_cudnn)로 내려가기 때문에 느려질 뿐 그림은 나옵니다.
        check(&cancel)?;
        let picker = resources_root(&app, family)?.join("fast_attention.py");
        if manifest.fast_attention && picker.is_file() {
            let chosen = root.join("requirements-fast.txt");
            progress(&app, engine, "deps", None, "이 GPU 에 맞는 빠른 어텐션을 찾는 중");
            let uv2 = uv.clone();
            let log2 = log.clone();
            let cancel2 = cancel.clone();
            let python2 = python.clone();
            let picker2 = picker.clone();
            let chosen2 = chosen.clone();
            let outcome = tauri::async_runtime::spawn_blocking(move || {
                let probe = vec![
                    picker2.to_string_lossy().to_string(),
                    chosen2.to_string_lossy().to_string(),
                ];
                run_tool(&python2, &probe, None, &log2, "빠른 어텐션 확인", Some(&cancel2), None)?;
                // 주석만 남았으면 이 PC 에는 맞는 휠이 없다는 뜻입니다.
                let text = fs::read_to_string(&chosen2).unwrap_or_default();
                if !text.lines().any(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#')) {
                    return Ok(false);
                }
                let args = vec![
                    "pip".to_string(),
                    "install".to_string(),
                    "--python".to_string(),
                    python2.to_string_lossy().to_string(),
                    "-r".to_string(),
                    chosen2.to_string_lossy().to_string(),
                ];
                let _turn = UV_INSTALL_LOCK.lock_safe();
                run_uv_install(&uv2, &args, &log2, &cancel2).map(|_| true)
            })
            .await;
            match outcome {
                Ok(Ok(true)) => append_log(&log, "빠른 어텐션(SageAttention)을 깔았습니다.\n"),
                Ok(Ok(false)) => append_log(&log, "이 PC 에는 맞는 빠른 어텐션 휠이 없어 건너뜁니다.\n"),
                Ok(Err(message)) => append_log(
                    &log,
                    &format!("빠른 어텐션은 건너뜁니다(설치를 막지 않습니다): {message}\n"),
                ),
                Err(e) => append_log(&log, &format!("빠른 어텐션 확인을 기다리지 못했습니다: {e}\n")),
            }
            // 위에서 실패를 전부 삼키므로, «설치 멈추기» 를 눌렀을 때는 여기서 멈춰 줘야 합니다.
            check(&cancel)?;
        }
    }

    // 3) 코드(고정 커밋 압축본)
    let downloads = root.join("download");
    for (index, entry) in manifest.code.iter().enumerate() {
        check(&cancel)?;
        let dest = code_dest(&root, entry).ok_or("manifest 의 코드 자리가 올바르지 않습니다.")?;
        if dest.join(CODE_DONE_MARK).is_file() {
            continue;
        }
        let label = format!("코드 {}/{}", index + 1, manifest.code.len());
        progress(&app, engine, "code", None, &format!("{label} 을(를) 받는 중"));
        let archive = downloads.join(format!("{}.zip", entry.id));
        download_file(
            &app,
            engine,
            "code",
            &label,
            &entry.url,
            &archive,
            entry.sha256.as_deref(),
            entry.size,
            &cancel_opt,
        )
        .await?;
        progress(&app, engine, "code", None, &format!("{label} 을(를) 푸는 중"));
        let archive2 = archive.clone();
        let dest2 = dest.clone();
        let root2 = root.clone();
        let strip = entry.strip_root;
        tauri::async_runtime::spawn_blocking(move || extract_code(&archive2, &root2, &dest2, strip))
            .await
            .map_err(|e| err("압축 푸는 것을 기다리지 못했습니다", e))??;
        let _ = fs::remove_file(&archive);
    }

    // 4) 가중치
    let model_root = models_root(&root, &manifest);
    let wanted = wanted_models(&manifest, &extra_models);
    let total = wanted.len();
    let mut got: Vec<String> = Vec::new();
    for (index, model) in wanted.iter().enumerate() {
        check(&cancel)?;
        let label = format!("가중치 {}/{} ({})", index + 1, total, model.id);
        progress(&app, engine, "models", None, &label);
        download_file(
            &app,
            engine,
            "models",
            &label,
            &model.url,
            &model_root.join(&model.path),
            model.sha256.as_deref(),
            model.size,
            &cancel_opt,
        )
        .await?;
        got.push(model.id.clone());
    }

    /*
      torch.hub 처럼 «있기만 하면 되는» 표식 파일.

      **자리는 `models_dir` 기준입니다**(`models[].path` 와 같은 기준). 엔진 뿌리 기준인 것은
      `code[].dest` 뿐입니다. 2026-09-09 에 이 둘을 섞어 보고 vosr 의 값에 `preset/ckpts/` 를
      한 겹 더 붙인 적이 있습니다 — 그러면 `engines/vosr/preset/ckpts/preset/ckpts/…` 라는
      쓰레기 경로가 생기고 정작 torch 가 보는 자리에는 파일이 없습니다.
    */
    for relative in &manifest.empty_files {
        if let Some(safe) = safe_entry_path(relative) {
            let path = model_root.join(safe);
            if !path.exists() {
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&path, b"");
            }
        }
    }

    // 5) 검증 — 워커를 한 번 띄워 `ping` 이 오는지.
    check(&cancel)?;
    progress(&app, engine, "verify", None, "돌아가는지 확인하는 중");
    if manifest.kind == "binary" {
        let exe = manifest
            .exe
            .as_ref()
            .map(|exe| root.join(exe.replace('\\', "/")))
            .ok_or("manifest 에 실행 파일이 없습니다.")?;
        if !exe.is_file() {
            return Err("실행 파일을 찾지 못했습니다. 압축이 제대로 풀리지 않았습니다.".into());
        }
    } else {
        let app2 = app.clone();
        let engine2 = engine.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let state = app2.state::<UpscaleState>();
            let worker = ensure_worker(&app2, &state, &engine2)?;
            let reply = ask(&app2, &state, &engine2, &worker, json!({ "op": "ping" }), 180)?;
            if reply.get("event").and_then(|v| v.as_str()) == Some("error") {
                return Err(reply
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("워커가 답하지 않았습니다.")
                    .to_string());
            }
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| err("검증을 기다리지 못했습니다", e))??;
    }

    /*
      6) 가중치 미리 받기 — manifest 에 `prefetch: true` 인 엔진(미니맥스 H3·완)만.

       첫 생성 때 받는 방식은 그때 쓰는 덩어리만 받아서,
      레퍼런스 영상용 `transformer_ref`(62 GB)·완 I2V 판(60 GB)이 «생성 중» 안에서 말없이
      내려오게 돼 있었습니다. 검증(ping)이 지나 워커가 살아 있는 지금 받아 두면 새로 깐
      엔진은 처음부터 다 갖추고 시작합니다. 폴더 크기는 이 뒤에 재야 가중치가 들어갑니다.
    */
    let mut weights_ready = false;
    if manifest.kind != "binary" && manifest.prefetch {
        check(&cancel)?;
        let app2 = app.clone();
        let engine2 = engine.to_string();
        let cancel2 = cancel.clone();
        // 큐 자물쇠·«받는 중» 표시·진행 첫 줄·«정말 받았나» 확인은 전부 prefetch_weights 안에 있습니다(단추와 한 벌).
        weights_ready = tauri::async_runtime::spawn_blocking(move || prefetch_weights(&app2, &engine2, &cancel2))
            .await
            .map_err(|e| err("가중치 받기를 기다리지 못했습니다", e))??;
    }

    let mut record = read_record(&root);
    record.version = manifest.version.clone();
    record.installed_at = chrono_now();
    record.last_error = String::new();
    record.models = got;
    record.weights_ready = weights_ready;
    // 폴더 크기는 여기서 잽니다(상태 조회는 이 값을 읽습니다). 설치 작업 스레드라 몇 초 걸려도 창은 안 멈춥니다.
    record.disk_bytes = dir_size(&root);
    record.disk_measured_at = now_secs();
    write_record(&root, &record)?;
    append_log(&log, "===== 설치 끝 =====");
    Ok(())
}

/// 지금 UNIX 초. 시간 라이브러리를 새로 들이지 않습니다.
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 기록에 남길 시각 — UNIX 초를 문자열로.
fn chrono_now() -> String {
    format!("{}", now_secs())
}

/// `disk_bytes` 를 다시 재야 하는가 — 마지막으로 잰 뒤 `min_age_secs` 가 지났으면.
/// `min_age_secs == 0` 이면 무조건, 잰 적이 없으면(0) 무조건 그렇습니다.
fn disk_is_stale(record: &InstalledRecord, now: u64, min_age_secs: u64) -> bool {
    now.saturating_sub(record.disk_measured_at) >= min_age_secs
}

/// 지금 뒤에서 크기를 재는 중인 엔진. 같은 폴더를 두 스레드가 동시에 걷지 않게.
static MEASURING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 엔진 폴더 크기를 **뒤에서** 다시 재어 기록에 적습니다. 지금 조회는 옛 값을 그대로 돌려줍니다.
///
/// 왜 조회 스레드에서 안 재는가: `.venv` 하나가 파일 2만 개대라 설정 화면이 몇 초씩 멈췄습니다
/// (2026-09-09 지적). 그렇다고 설치 끝에 한 번만 재면 가중치가 들어온 뒤의 크기를 영영 모릅니다
/// . 그래서 값은 즉시, 재기는 뒤에서 — 다 재면
/// «disk» 이벤트로 알려 프런트가 상태를 한 번 더 읽습니다.
///
/// 제거와의 경주(2026-09-22 점검): 걷는 스레드는 폴더를 열어 둔 채고, 다 걷고 나서 manifest.json 을 다시
/// 씁니다. 그 사이 «제거» 가 지나가면 `remove_dir_all` 이 반쯤 실패하거나, 지운 자리에 기록만 되살아나
/// 빈 폴더가 «설치됨» 으로 보입니다. 그래서 **제거는 이 엔진이 `MEASURING` 에 있는 동안 거절**하고, 여기서는
/// 다시 읽기·쓰기를 `MEASURING` 자물쇠 안에서 합니다 — 지운 뒤에 쓰는 일이 없습니다.
fn remeasure_disk_in_background(app: &AppHandle, engine: &str, min_age_secs: u64) {
    let Ok(root) = engine_dir(app, engine) else { return };
    let before = read_record(&root);
    if !disk_is_stale(&before, now_secs(), min_age_secs) {
        return;
    }
    {
        let mut measuring = MEASURING.lock_safe();
        if measuring.iter().any(|item| item == engine) {
            return;
        }
        measuring.push(engine.to_string());
    }
    let app = app.clone();
    let engine = engine.to_string();
    std::thread::spawn(move || {
        let bytes = dir_size(&root);
        let written = {
            let mut measuring = MEASURING.lock_safe();
            // 걷는 몇 초 사이 설치·받기가 기록을 고쳤을 수 있어 **다시 읽고** 크기만 얹습니다.
            // 그사이 제거됐으면(기록 파일이 없으면) 쓰지 않습니다 — 빈 폴더에 manifest.json 만 남기면 안 됩니다.
            let written = if !root.join("manifest.json").is_file() {
                false
            } else {
                let mut record = read_record(&root);
                if record.installed_at != before.installed_at {
                    // 걷는 사이 다시 설치됐습니다 — 설치가 끝에 제 크기를 적었으니 옛 폴더를 잰 값으로 덮지 않습니다.
                    log::info!("{engine} 이(가) 그사이 다시 설치돼 잰 크기를 버립니다");
                    false
                } else {
                    record.disk_bytes = bytes;
                    record.disk_measured_at = now_secs();
                    match write_record(&root, &record) {
                        Ok(()) => true,
                        Err(e) => {
                            log::warn!("{engine} 폴더 크기를 적지 못했습니다: {e}");
                            false
                        }
                    }
                }
            };
            measuring.retain(|item| item != &engine);
            written
        };
        /*
          «disk» 는 **적었을 때만** 보냅니다. 프런트는 이 신호에 상태를 다시 읽는데, 못 적었는데도 보내면
          다시 읽은 기록이 여전히 낡아 또 걷고 → 또 못 적고 → 또 보내고… 2만 파일 걷기가 끝없이 돕니다(2026-09-22 점검).
          못 적었으면 로그만 남기고 다음 조회가 올 때까지 둡니다.
        */
        if written {
            progress_done(&app, &engine, "disk", None);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 워커
// ─────────────────────────────────────────────────────────────────────────────

fn ensure_worker(app: &AppHandle, state: &UpscaleState, engine: &str) -> Res<Worker> {
    {
        let workers = state.workers.lock_safe();
        if let Some(worker) = workers.get(engine) {
            if worker.alive.load(Ordering::SeqCst) {
                return Ok(worker.clone());
            }
        }
    }
    // 죽은 것은 치우고 새로 띄웁니다.
    {
        let mut workers = state.workers.lock_safe();
        workers.remove(engine);
    }

    let family = family_of(engine)?;
    /*
      **무거운 엔진은 혼자 씁니다.**

      2026-09-18 실측: MiniMax-H3 를 올리는데 앞서 쓰던 워커들이 그대로 상주하며 65 GB 를
      쥐고 있었습니다. 상주 워커는 «다음에 빨리 시작하려고» 두는 것인데, 96 GB 카드에서도
      영상 엔진 하나가 통째로 들어가는 판이라 **빨리 시작하려다 아예 못 시작합니다.**
      그래서 무거운 엔진을 띄우기 전에 같은 갈래의 다른 상주 워커를 먼저 내립니다.
      내린 워커는 다음에 부르면 다시 뜹니다 — 느려질 뿐 잃는 것은 없습니다.
    */
    if read_manifest(app, engine).map(|m| m.heavy).unwrap_or(false) {
        let others: Vec<String> = state
            .workers
            .lock_safe()
            .keys()
            .filter(|name| name.as_str() != engine && family_of(name).map(|f| f.dir) == Ok(family.dir))
            .cloned()
            .collect();
        for other in others {
            /*
              **일하는 형제는 두어야 합니다**(2026-09-22 점검). 미리 받기는 몇 시간짜리라 그 사이 다른 무거운
              엔진으로 생성을 시작하는 것이 보통인데, 예전에는 잠금을 안 보고 내려서 받던 워커를 죽였습니다
              (받다 만 파일은 남지만 «받는 중» 이 「워커가 멈췄습니다」 로 끝납니다). 큐 자물쇠가 잡혀 있거나
              (생성·미리 받기) `cancels` 에 있으면(설치·받기 시작 직전) 건너뜁니다 — VRAM 은 그쪽이 끝나면
              돌아옵니다. `try_lock` 이라 서로 형제를 보는 두 워커가 맞물려도 기다리지 않습니다.
            */
            if state.cancels.lock_safe().contains_key(&other) {
                log::info!("{other} 은(는) 설치·받기 중이라 두었습니다");
                continue;
            }
            let queue = state.queue(&other);
            let Ok(_guard) = queue.try_lock() else {
                log::info!("{other} 은(는) 도는 중이라 두었습니다");
                continue;
            };
            log::info!("{engine} 이(가) 무거워 상주 워커 {other} 을(를) 먼저 내립니다");
            stop_worker(app, state, &other);
        }
    }
    let root = engine_dir(app, engine)?;
    let python = venv_python(&root);
    if !python.is_file() {
        return Err(format!(
            "{engine} 엔진이 설치돼 있지 않습니다. 설정 → {} 엔진에서 설치하세요.",
            family.label
        ));
    }
    let worker_py = resources_root(app, family)?.join("worker.py");
    if !worker_py.is_file() {
        return Err("워커 스크립트를 찾지 못했습니다(worker.py).".into());
    }
    let log_path = logs_dir(app, family)?.join(format!("{engine}.log"));

    let mut command = hidden_command(&python);
    command
        .arg("-u") // 버퍼링을 끕니다 — 안 그러면 진행 줄이 한참 뒤에 몰려 옵니다.
        .arg(&worker_py)
        .arg("--engine")
        .arg(engine)
        .arg("--root")
        .arg(&root)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    /*
      허깅페이스 토큰 — 설정에 넣어 두었으면 워커에 넘깁니다.

      SAM 3D Body·FLUX Krea·SD 3.5 는 **승인받은 사람만 받는 저장소**(gated)라, 토큰 없이 받으면 401 로 멈춥니다.
      예전에는 토큰을 넘기는 길이 아예 없어 그 엔진들은 설치해도 첫 생성에서 늘 실패했습니다. 토큰은 API 키와 같은 자리
      (설정 폴더의 `huggingface.key`)에 두고, 환경 변수로만 넘깁니다 — 명령줄 인자로 넘기면 작업 관리자에 그대로 보입니다.
    */
    if let Ok(token) = crate::llm::read_api_key("huggingface") {
        command.env("HF_TOKEN", token);
    }
    let mut child = command.spawn().map_err(|e| err("워커를 띄우지 못했습니다", e))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("워커 입력을 열지 못했습니다.")?;
    let stdout = child.stdout.take().ok_or("워커 출력을 열지 못했습니다.")?;
    let stderr = child.stderr.take().ok_or("워커 오류 출력을 열지 못했습니다.")?;

    let pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let ready: Arc<Mutex<Option<Value>>> = Arc::new(Mutex::new(None));
    let alive = Arc::new(AtomicBool::new(true));

    // stdout — 프로토콜.
    {
        let pending = pending.clone();
        let ready = ready.clone();
        let alive = alive.clone();
        let app = app.clone();
        let engine = engine.to_string();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let event = value.get("event").and_then(|v| v.as_str()).unwrap_or("");
                let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                match event {
                    "ready" => {
                        *ready.lock_safe() = Some(value);
                    }
                    "progress" => {
                        let percent = value.get("percent").and_then(|v| v.as_f64());
                        let message = value.get("message").and_then(|v| v.as_str()).unwrap_or("");
                        // 워커가 `stage` 를 적어 보내면 그 막대로(미리 받기는 "models" — 설치 때와
                        // 같은 막대라야 카드가 한 모양입니다). 안 적으면 생성 진행("run")입니다.
                        let stage = value.get("stage").and_then(|v| v.as_str()).unwrap_or("run");
                        progress(&app, &engine, stage, percent, message);
                    }
                    _ => {
                        if let Some(sender) = pending.lock_safe().remove(&id) {
                            let _ = sender.send(value);
                        }
                    }
                }
            }
            alive.store(false, Ordering::SeqCst);
            // 죽었으면 기다리던 쪽에 알려 줘야 시간 초과까지 서 있지 않습니다.
            let waiting: Vec<mpsc::Sender<Value>> = pending.lock_safe().drain().map(|(_, s)| s).collect();
            for sender in waiting {
                let _ = sender.send(json!({ "event": "error", "message": "워커가 멈췄습니다. 로그를 보세요." }));
            }
        });
    }

    // stderr — 로그 파일로.
    {
        let log_path = log_path.clone();
        std::thread::spawn(move || {
            // 워커 로그도 같은 이유로 바이트로 읽습니다 — 여기서 끊기면 엔진이 왜 죽었는지
            // 적힌 줄이 안 남습니다(`read_lines_lossy` 설명 참조).
            read_lines_lossy(stderr, |line| append_log(&log_path, line));
        });
    }

    let worker = Worker {
        pid,
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
        pending,
        ready,
        alive,
    };
    state.workers.lock_safe().insert(engine.to_string(), worker.clone());
    log::info!("업스케일 워커를 띄웠습니다 — {engine} (PID {pid})");
    Ok(worker)
}

/// 요청 하나를 보내고 `done`/`error` 한 줄을 기다립니다.
fn ask(
    app: &AppHandle,
    state: &UpscaleState,
    engine: &str,
    worker: &Worker,
    mut request: Value,
    timeout_secs: u64,
) -> Res<Value> {
    let id = state.next_id();
    request["id"] = json!(id);
    let (sender, receiver) = mpsc::channel::<Value>();
    worker.pending.lock_safe().insert(id.clone(), sender);

    let line = format!("{}\n", request);
    let write = {
        let mut stdin = worker.stdin.lock_safe();
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush())
    };
    if let Err(e) = write {
        worker.pending.lock_safe().remove(&id);
        return Err(err("워커에 보내지 못했습니다", e));
    }

    match receiver.recv_timeout(Duration::from_secs(timeout_secs.max(30))) {
        Ok(value) => Ok(value),
        Err(RecvTimeoutError::Timeout) => {
            worker.pending.lock_safe().remove(&id);
            // 시간이 다 됐으면 이 워커는 못 믿습니다 — 내리고 다음 요청 때 새로 띄웁니다.
            stop_worker(app, state, engine);
            Err(format!("{timeout_secs}초 안에 끝나지 않았습니다. 워커를 내렸습니다."))
        }
        Err(RecvTimeoutError::Disconnected) => {
            worker.pending.lock_safe().remove(&id);
            Err("워커가 멈췄습니다. 로그를 보세요.".into())
        }
    }
}

/// GPU 문맥이 깨진 오류인가 — 이런 실패는 그 프로세스를 다시 띄워야만 회복됩니다.
fn is_device_fault(message: &str) -> bool {
    let text = message.to_lowercase();
    [
        "cuda error",
        "acceleratorerror",
        "cuda_error",
        "device-side assert",
        "cublas",
        "cudnn_status",
        "out of memory",
        "illegal memory access",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

#[cfg(test)]
mod device_fault_tests {
    use super::is_device_fault;

    /// 2026-09-22 미니맥스 로그에 실제로 찍힌 줄. 이 뒤의 모든 요청이 같은 오류를 돌려줬습니다.
    #[test]
    fn spots_the_real_minimax_failure() {
        assert!(is_device_fault(
            "torch.AcceleratorError: CUDA error: unknown error"
        ));
        assert!(is_device_fault("CUDA out of memory. Tried to allocate 2.00 GiB"));
        assert!(is_device_fault("RuntimeError: CUDA error: an illegal memory access was encountered"));
    }

    /// 평범한 실패로 워커를 내리면 다음 생성이 수십 초 더 걸립니다 — 올리는 데만 2분입니다.
    #[test]
    fn leaves_ordinary_failures_alone() {
        assert!(!is_device_fault("결과 파일이 만들어지지 않았습니다."));
        assert!(!is_device_fault("프롬프트가 비었습니다"));
    }
}

/// 워커 하나를 내립니다 — `quit` 을 보내고 3초 뒤에도 살아 있으면 **우리가 띄운 자식 핸들로만** 종료.
fn stop_worker(app: &AppHandle, state: &UpscaleState, engine: &str) {
    let worker = state.workers.lock_safe().remove(engine);
    let Some(worker) = worker else { return };
    let _ = app; // 로그 밖에는 쓰지 않습니다.

    {
        // 이름이 아니라 이 자식의 stdin 으로 «끝내라» 를 보냅니다.
        if let Ok(mut stdin) = worker.stdin.lock() {
            let _ = stdin.write_all(b"{\"id\":\"quit\",\"op\":\"quit\"}\n");
            let _ = stdin.flush();
        }
    }
    let deadline = Instant::now() + QUIT_GRACE;
    loop {
        {
            let mut child = worker.child.lock_safe();
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {}
                Err(_) => break,
            }
            if Instant::now() >= deadline {
                // PID 를 이름으로 바꿔 찾지 않습니다 — 우리가 들고 있는 이 핸들만 죽입니다.
                let _ = child.kill();
                let _ = child.wait();
                log::warn!("업스케일 워커를 강제로 내렸습니다 — {engine} (PID {})", worker.pid);
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    worker.alive.store(false, Ordering::SeqCst);
}

/// 앱이 꺼질 때 부릅니다. 남은 파이썬이 VRAM 을 물고 있으면 다음에 앱이 못 뜹니다.
///
/// 워커뿐 아니라 uv·Upscayl 자식도 함께 정리합니다 — 예전에는 이 둘이 `workers` 에 없어서
/// 설치 중에 앱을 닫으면 uv 가 고아로 남아 계속 내려받았습니다.
pub fn stop_all_workers(app: &AppHandle) {
    let state = app.state::<UpscaleState>();
    let engines: Vec<String> = state.workers.lock_safe().keys().cloned().collect();
    for engine in engines {
        stop_worker(app, &state, &engine);
    }
    kill_side_children();
}

/// «미리 받는 중» 표시(`UpscaleState::prefetching`). 만들면 걸리고, 어떻게 끝나든(성공·오류·`?` 조기 반환)
/// 지워집니다 — 손으로 지우는 길을 두면 한 갈래에서 빠뜨려 단추가 영영 「받기 멈추기」 로 남습니다.
struct PrefetchMark<'a> {
    state: &'a UpscaleState,
    engine: String,
}

impl<'a> PrefetchMark<'a> {
    fn new(state: &'a UpscaleState, engine: &str) -> Self {
        state.prefetching.lock_safe().insert(engine.to_string());
        Self { state, engine: engine.to_string() }
    }
}

impl Drop for PrefetchMark<'_> {
    fn drop(&mut self) {
        self.state.prefetching.lock_safe().remove(&self.engine);
    }
}

/// 가중치를 **미리** 받습니다 — 워커를 띄워 `prefetch` 를 시키고 끝날 때까지 기다립니다.
/// 돌려주는 값은 워커가 실제로 받았는가(`done` 의 `prefetched`).
///
/// 설치 흐름(검증 뒤)과 «가중치 미리 받기» 단추가 **같이** 씁니다 —
/// 큐 자물쇠·«받는 중» 표시·진행 첫 줄·«정말 받았나» 확인까지 여기 한 벌입니다. 두 곳에 나눠 적으면
/// 한쪽만 고치는 날이 옵니다.
///
/// **받는 내내 엔진 큐 자물쇠를 쥡니다**(2026-09-22 점검). 받기는 몇 시간짜리인데 예전에는 자물쇠 없이
/// 돌아서, «워커 내리기»·허깅페이스 토큰 저장·모션 캡처 끊기(`stop_workers_command` 는 `try_lock` 이 되면
/// 노는 워커로 보고 내립니다)와 무거운 엔진의 형제 정리(`ensure_worker`)가 받는 중인 워커를 죽였습니다.
/// 자물쇠를 쥐면 그쪽이 «도는 중» 으로 보고 물러납니다. 교착은 없습니다 — 생성·설치·제거는 `cancels` 에
/// 이 엔진이 있어 자물쇠를 잡기 전에 거절하고, 이 함수는 `spawn_blocking` 안에서만 불립니다.
///
/// `ask` 는 답이 올 때까지 막혀 있어서 취소 깃발을 볼 수 없습니다. 그래서 `ask` 를 따로 스레드에
/// 두고 여기서는 반초마다 깃발을 봅니다 — 취소면 워커를 내려 받기를 끊습니다(받다 만 파일은
/// huggingface_hub 가 `.incomplete` 로 두어 다음에 이어받습니다). 진행 줄은 워커가 `stage: "models"`
/// 로 보내고 읽기 스레드가 그대로 흘려 주므로 여기서 따로 할 일이 없습니다.
fn prefetch_weights(app: &AppHandle, engine: &str, cancel: &Arc<AtomicBool>) -> Res<bool> {
    let state = app.state::<UpscaleState>();
    let queue = state.queue(engine);
    let _busy = queue.lock_safe();
    // 표시는 진행 첫 줄보다 **먼저** 겁니다 — 프런트가 그 줄을 보고 상태를 다시 읽어 단추 문구를 정하기 때문입니다.
    let _mark = PrefetchMark::new(&state, engine);
    progress(app, engine, "models", None, "가중치를 미리 받는 중 (수십~수백 GB · 이어받기 됩니다)");

    let worker = ensure_worker(app, &state, engine)?;
    let (sender, receiver) = mpsc::channel::<Res<Value>>();
    {
        let app = app.clone();
        let engine = engine.to_string();
        std::thread::spawn(move || {
            let state = app.state::<UpscaleState>();
            let reply = ask(&app, &state, &engine, &worker, json!({ "op": "prefetch" }), PREFETCH_TIMEOUT_SECS);
            let _ = sender.send(reply);
        });
    }
    let reply = loop {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(reply) => break reply?,
            Err(RecvTimeoutError::Timeout) => {
                if cancel.load(Ordering::SeqCst) {
                    stop_worker(app, &state, engine);
                    return Err("가중치 받기를 멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".into());
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err("워커가 멈췄습니다. 로그를 보세요.".into());
            }
        }
    };
    if reply.get("event").and_then(|v| v.as_str()) == Some("error") {
        return Err(reply
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("가중치를 받지 못했습니다.")
            .to_string());
    }
    /*
      워커는 엔진 모듈에 `prefetch()` 가 없으면 할 일 없이 `done` 을 보냅니다(첫 생성 때 받는 엔진의 길).
      manifest 가 «미리 받기를 안다» 고 해 놓고 모듈에 그 함수가 없으면, 예전에는 `done` 만 보고
      «다 받았다» 로 적어 버려 첫 생성이 다시 수십 GB 를 말없이 받았습니다(2026-09-22 점검). 그래서 `done` 의
      `prefetched` 를 보고, 받기로 돼 있는데 안 받았으면 오류로 냅니다 — 사람이 보는 토스트까지 갑니다.
    */
    let prefetched = reply.get("prefetched").and_then(|v| v.as_bool()).unwrap_or(false);
    if !prefetched && read_manifest(app, engine)?.prefetch {
        return Err(format!(
            "{engine} 의 워커가 가중치 미리 받기를 모릅니다(엔진 모듈에 prefetch 가 없습니다). 앱 쪽을 고쳐야 합니다."
        ));
    }
    Ok(prefetched)
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────────────────────

/// upscayl 은 파이썬이 없습니다 — exe 를 바로 부르고 결과를 목표 크기로 줄입니다.
fn run_upscayl(
    app: &AppHandle,
    manifest: &EngineManifest,
    root: &Path,
    input: &Path,
    output: &Path,
    target: &TargetSpec,
    opts: &Value,
    timeout_secs: u64,
) -> Res<(u32, u32)> {
    let exe = manifest
        .exe
        .as_ref()
        .map(|exe| root.join(exe.replace('\\', "/")))
        .ok_or("manifest 에 실행 파일이 없습니다.")?;
    if !exe.is_file() {
        return Err("Upscayl 실행 파일이 없습니다. 설정에서 다시 설치하세요.".into());
    }
    let models = models_root(root, manifest);
    let model = opts
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| manifest.default_model.clone())
        .unwrap_or_else(|| "upscayl-standard-4x".to_string());
    // 모델 이름은 파일 이름이 되므로 경로 조각이 섞이면 거부합니다.
    if model.contains('/') || model.contains('\\') || model.contains("..") {
        return Err("모델 이름이 올바르지 않습니다.".into());
    }

    /*
      부르기 **전에** 입력과 모델을 확인합니다 (2026-09-09 실측).

      upscayl-bin 은 둘 다 스스로 말해 주지 않습니다.
        - 없는 모델 이름: 0xC0000409 로 죽으면서 원인을 한 줄도 안 찍습니다 (GPU 능력 줄만).
        - 없는 입력 파일: **종료코드 0** 으로 끝나 우리가 «성공» 으로 보고, 뒤의 `image::open`
          이 터져 「Upscayl 결과를 읽지 못했습니다」라는 엉뚱한 말이 뜹니다.
      그래서 사람이 알아들을 말은 여기서 만들어야 합니다.
    */
    if !input.is_file() {
        return Err("업스케일할 그림 파일이 없습니다. 파일이 지워졌는지 확인해 주세요.".into());
    }
    for ext in ["param", "bin"] {
        let part = models.join(format!("{model}.{ext}"));
        if !part.is_file() {
            return Err(format!(
                "Upscayl 모델 「{model}」 의 {ext} 파일이 없습니다. 설정에서 Upscayl 을 다시 설치하세요."
            ));
        }
    }

    let raw = output.with_file_name(format!(
        "{}.4x.png",
        output.file_name().and_then(|n| n.to_str()).unwrap_or("결과")
    ));
    progress(app, "upscayl", "run", Some(10.0), "Upscayl 실행");
    let args: Vec<String> = vec![
        "-i".into(),
        input.to_string_lossy().to_string(),
        "-o".into(),
        raw.to_string_lossy().to_string(),
        "-n".into(),
        model,
        "-s".into(),
        "4".into(),
        "-m".into(),
        models.to_string_lossy().to_string(),
        "-f".into(),
        "png".into(),
    ];
    let log = logs_dir(app, &UPSCALE)?.join("upscayl.log");
    /*
      시간 제한을 겁니다(2026-09-09 지적).

      예전에는 «exe 는 스스로 끝난다» 며 `timeout_secs` 를 버렸습니다. upscayl-ncnn 은
      GPU·드라이버 문제로 매달리는 일이 드물지 않은데, 그러면 (1) 영원히 «업스케일 중»,
      (2) `run_blocking` 이 잡은 엔진 큐 자물쇠가 안 풀려 그 엔진으로 아무 작업도 못 하고,
      (3) 앱을 닫아도 GPU 를 문 채 남았습니다. 파이썬 엔진에는 `ask` 의 recv_timeout 이
      있는데 binary 엔진만 그 보호가 없었습니다. 이제 `run_tool` 이 자식 핸들로 끊습니다.
    */
    let result = run_tool(
        &exe,
        &args,
        Some(root),
        &log,
        "Upscayl",
        None,
        Some(Duration::from_secs(timeout_secs.max(60))),
    );
    if let Err(e) = result {
        let _ = fs::remove_file(&raw);
        return Err(e);
    }

    progress(app, "upscayl", "run", Some(80.0), "목표 크기로 맞추는 중");
    let image = image::open(&raw).map_err(|e| err("Upscayl 결과를 읽지 못했습니다", e))?;
    let source = image::image_dimensions(input).map_err(|e| err("원본 크기를 읽지 못했습니다", e))?;
    let (want_w, want_h) = resolve_target(source, target);
    let resized = if image.width() == want_w && image.height() == want_h {
        image
    } else {
        image.resize_exact(want_w, want_h, image::imageops::FilterType::Lanczos3)
    };
    let ext = output
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_else(|| "png".into());
    let format = image::ImageFormat::from_extension(&ext).unwrap_or(image::ImageFormat::Png);
    resized
        .save_with_format(output, format)
        .map_err(|e| err("결과를 쓰지 못했습니다", e))?;
    let _ = fs::remove_file(&raw);
    Ok((want_w, want_h))
}

/// 목표 긴 변 → 실제 크기(짧은 변은 비율대로 16 배수). 파이썬 `common.resolve_target` 과 같은 계산입니다.
fn resolve_target(size: (u32, u32), target: &TargetSpec) -> (u32, u32) {
    let (width, height) = (size.0.max(1) as f64, size.1.max(1) as f64);
    let round16 = |value: f64| -> u32 { (((value / 16.0).round() as i64).max(1) as u32) * 16 };
    if let Some(long_edge) = target.long_edge.filter(|v| *v > 0) {
        let long_edge = long_edge as f64;
        if width >= height {
            (round16(long_edge), round16(long_edge * height / width))
        } else {
            (round16(long_edge * width / height), round16(long_edge))
        }
    } else if let Some(scale) = target.scale.filter(|v| *v > 0) {
        (round16(width * scale as f64), round16(height * scale as f64))
    } else {
        (round16(width), round16(height))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 명령
// ─────────────────────────────────────────────────────────────────────────────

/// 엔진 상태 한 벌.
///
/// `#[tauri::command(async)]` 인 이유: Tauri v2 는 `async` 가 아닌 명령을 **메인 스레드**에서
/// 돕니다. 여기서는 엔진마다 폴더를 들여다보고, 크기를 아직 안 재 둔 엔진은 한 번 재기까지
/// 하므로 그대로 두면 설정 화면을 열 때 창이 통째로 멈췄습니다(2026-09-09 지적).
#[tauri::command(async)]
pub fn upscale_engines_status(app: AppHandle) -> Res<Vec<EngineStatus>> {
    engines_status(app, &UPSCALE)
}

pub(crate) fn engines_status(app: AppHandle, family: &'static Family) -> Res<Vec<EngineStatus>> {
    let state = app.state::<UpscaleState>();
    let installing: Vec<String> = state.cancels.lock_safe().keys().cloned().collect();
    let prefetching: Vec<String> = state.prefetching.lock_safe().iter().cloned().collect();
    let mut out = Vec::new();
    for id in family.ids {
        // 공개판에서 빠진 엔진은 목록에 아예 안 실립니다 — manifest 도 번들에 없어서 읽으면 경고만 남습니다.
        if !crate::edition::includes_engine(id) {
            continue;
        }
        let manifest = match read_manifest(&app, id) {
            Ok(manifest) => manifest,
            Err(e) => {
                log::warn!("{id} manifest: {e}");
                continue;
            }
        };
        let root = engine_dir(&app, id)?;
        let mut record = read_record(&root);
        /*
          **지난 설치가 실패했으면 «설치 안 됨»** 입니다.

           `uv venv` 까지는 되고 패키지에서 실패한 엔진이
          «파이썬이 있으니 설치됨» 으로 판정돼(빈 .venv 168 KB) 제거 단추만 떴습니다. 그러면 다시 설치할 길이
          화면에 없어, 몇 GB 를 지웠다 처음부터 받는 수밖에 없었습니다.

          기록에 실패가 남아 있으면 «설치» 로 보여 줍니다 — 다시 누르면 있는 것은 건너뛰고 못한 데서 이어 합니다.
        */
        let installed = is_installed(&root, &manifest) && record.last_error.is_empty();
        let busy = installing.iter().any(|item| item == id);
        // 설치 기록이 옛것이라 크기가 없으면 여기서 한 번만 재서 적어 둡니다. 설치·받기 중(busy)에는 걷지 않습니다 —
        // 새로 까는 엔진은 venv 가 생긴 순간부터 «설치됨» 인데 기록은 아직 없어, 프런트가 단계마다 상태를 다시 읽을 때
        // 2만 파일을 매번 걸을 뻔했습니다(2026-09-22). 설치가 끝에 제 크기를 적습니다.
        if installed && !busy && record.disk_bytes == 0 {
            record.disk_bytes = dir_size(&root);
            record.disk_measured_at = now_secs();
            let _ = write_record(&root, &record);
        } else if installed && !busy {
            // 하루 지난 값은 **뒤에서** 다시 잽니다 — 이 조회는 옛 값을 바로 돌려줍니다(2026-09-09 의 멈춤을
            // 다시 만들지 않으려고). 설치·받기 중이면 그쪽이 끝에 재므로 여기서는 손대지 않습니다.
            remeasure_disk_in_background(&app, id, DISK_STALE_SECS);
        }
        out.push(EngineStatus {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            purpose: manifest.purpose.clone(),
            installed,
            installing: busy,
            prefetching: prefetching.iter().any(|item| item == id),
            version: if record.version.is_empty() { manifest.version.clone() } else { record.version },
            models_ready: models_ready(&root, &manifest),
            disk_bytes: if installed { record.disk_bytes } else { 0 },
            weights_ready: installed && record.weights_ready,
            prefetch: manifest.prefetch,
            last_error: record.last_error,
            experimental: manifest.experimental,
            external: false,
        });
    }
    /*
      ComfyUI 는 외부 엔진 — 설치라는 개념이 없습니다. 프런트가 설정을 보고 «쓸 수 있음» 을 정합니다.
      **업스케일 갈래에만** 답니다. 로컬 생성은 라서 외부 선택지가 아예 없습니다.
    */
    if !std::ptr::eq(family, &UPSCALE) {
        return Ok(out);
    }
    out.push(EngineStatus {
        id: "comfy".into(),
        name: "외부 — ComfyUI (API)".into(),
        purpose: "ComfyUI 워크플로로 돌림".into(),
        installed: false,
        installing: false,
        prefetching: false,
        version: String::new(),
        models_ready: false,
        disk_bytes: 0,
        weights_ready: false,
        prefetch: false,
        last_error: String::new(),
        experimental: false,
        external: true,
    });
    Ok(out)
}

#[tauri::command]
pub async fn upscale_install_engine(
    app: AppHandle,
    id: String,
    extra_models: Option<Vec<String>>,
) -> Res<()> {
    install_engine_command(app, id, extra_models).await
}

pub(crate) async fn install_engine_command(
    app: AppHandle,
    id: String,
    extra_models: Option<Vec<String>>,
) -> Res<()> {
    let engine = known_engine(&id)?.to_string();
    // 같은 엔진을 두 번 설치하면 같은 파일을 두 갈래가 쓰다 망가집니다.
    let cancel = {
        let state = app.state::<UpscaleState>();
        let mut cancels = state.cancels.lock_safe();
        if cancels.contains_key(&engine) {
            return Err("이미 설치하는 중입니다.".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        cancels.insert(engine.clone(), flag.clone());
        flag
    };

    /*
      설치하려면 워커가 그 폴더를 붙잡고 있으면 안 됩니다.

      워커를 내리기 전에 **엔진 큐 자물쇠를 시험 삼아** 잡습니다. 예전에는 잠금을 안 보고
      바로 죽여서, 업스케일이 도는 중에 설치를 누르면 작업이 «워커가 멈췄습니다» 로 끊겼습니다.
      자물쇠는 이 블록에서만 잡고 놓습니다(await 를 건너 들고 갈 수 없습니다) — 그 뒤로는
      `cancels` 에 이 엔진이 있어서 `run_blocking` 이 새 작업을 물리칩니다.
    */
    {
        let state = app.state::<UpscaleState>();
        let queue = state.queue(&engine);
        match queue.try_lock() {
            Ok(_guard) => stop_worker(&app, &state, &engine),
            Err(_) => {
                state.cancels.lock_safe().remove(&engine);
                return Err("업스케일이 도는 중입니다. 끝난 뒤에 설치하세요.".into());
            }
        };
    }

    let result = install_engine(app.clone(), engine.clone(), extra_models.unwrap_or_default(), cancel).await;

    {
        let state = app.state::<UpscaleState>();
        state.cancels.lock_safe().remove(&engine);
    }
    match &result {
        Ok(()) => progress_done(&app, &engine, "verify", None),
        Err(message) => {
            let root = engine_dir(&app, &engine)?;
            let mut record = read_record(&root);
            record.last_error = message.clone();
            let _ = write_record(&root, &record);
            progress_done(&app, &engine, "verify", Some(message));
        }
    }
    result
}

#[tauri::command]
pub fn upscale_cancel_install(app: AppHandle, id: String) -> Res<()> {
    cancel_install_command(app, id)
}

pub(crate) fn cancel_install_command(app: AppHandle, id: String) -> Res<()> {
    let engine = known_engine(&id)?;
    let state = app.state::<UpscaleState>();
    let flag = state.cancels.lock_safe().get(engine).cloned();
    match flag {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        }
        None => Err("설치 중이 아닙니다.".into()),
    }
}

/// 이미 깔린 엔진의 가중치를 **지금** 미리 받습니다(«가중치 미리 받기» 단추).
///
/// 사용자의 기계처럼 이 개편 전에 깐 엔진은 설치 때 받는 길을 이미 지나쳤습니다 — 그래서 단추가
/// 따로 있어야 합니다. 취소 깃발을 설치와 같은 `cancels` 에 두어 «멈추기» 단추가 그대로 듣고,
/// 그동안 `generate_blocking` 은 «받는 중» 으로 물러납니다(설치 중일 때와 같은 문). 실패는
/// 설치 기록의 `last_error` 에 **적지 않습니다** — 거기 적으면 엔진이 «설치 안 됨» 으로 보입니다.
pub(crate) async fn prefetch_weights_command(app: AppHandle, id: String) -> Res<()> {
    let engine = known_engine(&id)?.to_string();
    let manifest = read_manifest(&app, &engine)?;
    if !manifest.prefetch {
        return Err(format!("{} 은(는) 가중치를 첫 생성 때 받는 엔진입니다.", manifest.name));
    }
    let root = engine_dir(&app, &engine)?;
    if !is_installed(&root, &manifest) {
        return Err(format!("{} 이(가) 설치돼 있지 않습니다. 먼저 설치하세요.", manifest.name));
    }
    let cancel = {
        let state = app.state::<UpscaleState>();
        let mut cancels = state.cancels.lock_safe();
        if cancels.contains_key(&engine) {
            return Err("이미 설치하거나 받는 중입니다.".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        cancels.insert(engine.clone(), flag.clone());
        flag
    };
    // 생성이 도는 중이면 거절합니다 — 워커 하나가 받기와 생성을 같이 할 수 없고, 끊으면 영상을 잃습니다.
    {
        let state = app.state::<UpscaleState>();
        let queue = state.queue(&engine);
        if queue.try_lock().is_err() {
            state.cancels.lock_safe().remove(&engine);
            return Err(format!("{} 이(가) 생성하는 중입니다. 끝난 뒤에 받으세요.", manifest.name));
        }
    }

    // 큐 자물쇠·«받는 중» 표시·진행 첫 줄·«정말 받았나» 확인은 전부 prefetch_weights 안에 있습니다(설치와 한 벌).
    let result = {
        let app2 = app.clone();
        let engine2 = engine.clone();
        let cancel2 = cancel.clone();
        tauri::async_runtime::spawn_blocking(move || prefetch_weights(&app2, &engine2, &cancel2))
            .await
            .map_err(|e| err("가중치 받기를 기다리지 못했습니다", e))
            .and_then(|inner| inner)
    };
    {
        let state = app.state::<UpscaleState>();
        state.cancels.lock_safe().remove(&engine);
    }
    match &result {
        Ok(prefetched) => {
            let mut record = read_record(&root);
            // 워커가 «받았다» 고 답한 것만 적습니다 — 받기로 돼 있는데 안 받았으면 prefetch_weights 가 Err 로 옵니다.
            record.weights_ready = *prefetched;
            write_record(&root, &record)?;
            // 수십 GB 가 들어왔으니 카드 크기도 따라가야 합니다 — 뒤에서, 바로.
            remeasure_disk_in_background(&app, &engine, 0);
            progress_done(&app, &engine, "models", None);
        }
        Err(message) => progress_done(&app, &engine, "models", Some(message)),
    }
    result.map(|_| ())
}

/// 엔진 폴더를 통째로 지웁니다.
///
/// `async` 인 이유: 21 GB(seedvr2) 폴더의 `remove_dir_all` 과 워커 종료 유예 3초를
/// 메인 스레드에서 하면 창이 그동안 얼어붙습니다.
#[tauri::command(async)]
pub fn upscale_uninstall_engine(app: AppHandle, id: String) -> Res<()> {
    uninstall_engine_command(app, id)
}

pub(crate) fn uninstall_engine_command(app: AppHandle, id: String) -> Res<()> {
    let engine = known_engine(&id)?;
    let state = app.state::<UpscaleState>();
    if state.cancels.lock_safe().contains_key(engine) {
        return Err("설치하거나 가중치를 받는 중에는 제거할 수 없습니다. 먼저 멈추세요.".into());
    }
    // 뒤에서 폴더 크기를 재는 중이면 물러납니다 — 걷는 스레드가 폴더를 열어 둔 채라 `remove_dir_all` 이
    // 반쯤 지우다 실패하고, 다 걷고 나서 기록을 다시 써 빈 폴더가 «설치됨» 으로 되살아납니다(2026-09-22 점검,
    // `remeasure_disk_in_background` 참조). 몇 초면 끝나니 다시 누르면 됩니다.
    if MEASURING.lock_safe().iter().any(|item| item == engine) {
        return Err("폴더 크기를 재는 중입니다. 몇 초 뒤 다시 제거하세요.".into());
    }
    /*
      **지우기 전에 엔진 큐 자물쇠를 잡습니다**(2026-09-09 지적).

      예전에는 잠금을 안 보고 워커부터 죽였습니다. 업스케일이 도는 중에 «제거» 를 누르면
      작업을 끊고 `.venv` 를 통째로 지웠고, 잠긴 파일 때문에 `remove_dir_all` 이 도중에
      실패하면 반쪽 폴더가 남아 그 뒤로는 재설치도 안 먹었습니다.
      지우는 동안 자물쇠를 계속 들고 있어야 새 작업이 끼어들지 않습니다.
    */
    let queue = state.queue(engine);
    let Ok(_guard) = queue.try_lock() else {
        return Err("업스케일이 도는 중입니다. 끝난 뒤에 제거하세요.".into());
    };
    stop_worker(&app, &state, engine);

    let root = engine_dir(&app, engine)?;
    if !root.exists() {
        return Ok(());
    }
    // **지우기 전에 «정말 engines/<id>/ 안인가» 를 실제 경로로 확인합니다.**
    // 링크나 상대 경로로 엉뚱한 곳을 가리키면 여기서 멈춥니다.
    let engines = data_root(&app, family_of(engine)?)?.join("engines");
    let engines_real = fs::canonicalize(&engines).map_err(|e| err("엔진 폴더를 확인하지 못했습니다", e))?;
    let root_real = fs::canonicalize(&root).map_err(|e| err("지울 폴더를 확인하지 못했습니다", e))?;
    if root_real == engines_real || !root_real.starts_with(&engines_real) {
        return Err("지울 폴더가 엔진 폴더 안이 아닙니다. 그만둡니다.".into());
    }
    if root_real.file_name().and_then(|n| n.to_str()) != Some(engine) {
        return Err("지울 폴더 이름이 엔진 이름과 다릅니다. 그만둡니다.".into());
    }
    fs::remove_dir_all(&root_real).map_err(|e| err("엔진 폴더를 지우지 못했습니다", e))?;
    log::info!("업스케일 엔진을 제거했습니다 — {engine}");
    Ok(())
}

#[tauri::command]
pub fn upscale_worker_info(app: AppHandle, engine: String) -> Res<Option<Value>> {
    worker_info_command(app, engine)
}

pub(crate) fn worker_info_command(app: AppHandle, engine: String) -> Res<Option<Value>> {
    let engine = known_engine(&engine)?;
    let state = app.state::<UpscaleState>();
    let workers = state.workers.lock_safe();
    Ok(workers.get(engine).and_then(|worker| worker.ready.lock_safe().clone()))
}

/// 상주 워커를 내립니다(설정의 «워커 내리기», 그리고 «작업 후 워커 유지» 를 껐을 때).
///
/// `async` 인 이유: 워커마다 최대 `QUIT_GRACE`(3초)를 기다리므로 메인 스레드에서 하면
/// 단추 한 번에 창이 3초 × 엔진 수만큼 얼어붙습니다.
///
/// **도는 중인 엔진은 건드리지 않습니다.** 예전에는 잠금을 안 보고 죽여서, 프런트가
/// 마지막 작업 뒤에 던진 stop 이 이미 시작된 다음 작업의 워커를 끊었습니다
/// (재현: «작업 후 워커 유지» 를 끄고 6면 세트 업스케일 → 「워커가 멈췄습니다」).
/// 가중치를 미리 받는 워커도 같은 자물쇠를 받는 내내 쥐므로 여기서 걸러집니다(2026-09-22 점검 —
/// 그 전에는 허깅페이스 토큰 저장·모션 캡처 끊기가 이 명령을 불러 몇 시간짜리 받기를 끊었습니다).
#[tauri::command(async)]
pub fn upscale_stop_workers(app: AppHandle) -> Res<()> {
    stop_workers_command(app, &UPSCALE)
}

pub(crate) fn stop_workers_command(app: AppHandle, family: &'static Family) -> Res<()> {
    let state = app.state::<UpscaleState>();
    // 다른 갈래의 워커는 건드리지 않습니다 — 업스케일 «워커 내리기» 가 로컬 생성을 끊으면 안 됩니다.
    let engines: Vec<String> = state
        .workers
        .lock_safe()
        .keys()
        .filter(|engine| family.ids.contains(&engine.as_str()))
        .cloned()
        .collect();
    let mut busy: Vec<String> = Vec::new();
    for engine in engines {
        let queue = state.queue(&engine);
        match queue.try_lock() {
            Ok(_guard) => stop_worker(&app, &state, &engine),
            Err(_) => busy.push(engine),
        };
    }
    if !busy.is_empty() {
        log::info!("업스케일이 도는 중이라 워커를 두었습니다 — {}", busy.join(", "));
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 자리 잡아 두기
// ─────────────────────────────────────────────────────────────────────────────

/// 작업마다 다른 번호표. 임시 파일 이름에 섞습니다.
static JOB_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 프로세스 번호까지 섞는 까닭: 저장 폴더 하나를 앱 두 벌이 볼 수 있어, 번호표만으로는
/// 둘 다 「1번」 에서 시작합니다.
fn job_tag() -> String {
    format!("{}-{}", std::process::id(), JOB_COUNTER.fetch_add(1, Ordering::SeqCst) + 1)
}

/// 잡아 둔 결과 자리. **빈 파일을 실제로 만들어** 그 이름이 남의 것이 되지 않게 합니다.
///
/// 왜 «고르기» 만으로는 모자랐나: 번호를 고르는 것과 결과를 놓는 것 사이가 몇 분입니다
/// (엔진이 도는 시간). 그 틈에 들어온 다음 요청이 같은 번호를 고르고, 둘 다 같은 이름으로
/// 이름 바꾸기를 해서 **먼저 끝난 결과가 사라졌습니다**.
struct Reserved {
    path: PathBuf,
    /// 결과를 제자리에 놓았는가. 놓기 전에 떨어지면 빈 껍데기를 치웁니다 —
    /// 0 바이트 파일을 인물 폴더에 남기면 폴더를 다시 읽을 때 깨진 그림으로 되살아납니다.
    kept: bool,
}

impl Reserved {
    fn keep(&mut self) {
        self.kept = true;
    }
}

impl Drop for Reserved {
    fn drop(&mut self) {
        if self.kept {
            return;
        }
        // **비어 있을 때만** 지웁니다. 엔진이 이 자리에 직접 쓴 뒤라면 그것이 유일한 결과입니다.
        if fs::metadata(&self.path).map(|m| m.len() == 0).unwrap_or(false) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// 비어 있는 다음 번호 자리를 잡습니다. 번호 규칙은 `next_numbered_path` 하나뿐이고,
/// 여기서는 그것이 고른 이름을 **원자적으로** 만들어 봅니다 — 이미 있으면 남이 먼저
/// 잡은 것이라 다음 번호로 넘어갑니다.
fn reserve_numbered_path(dir: &Path, stem: &str, ext: &str) -> Res<Reserved> {
    for _ in 0..64 {
        let candidate = next_numbered_path(dir, stem, ext);
        match fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(_) => return Ok(Reserved { path: candidate, kept: false }),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(err("결과 자리를 만들지 못했습니다", e)),
        }
    }
    Err("결과 파일 이름을 고르지 못했습니다. 같은 이름이 너무 많습니다.".into())
}

/// 부른 대로의 이름을 먼저 잡아 보고, 이미 있으면 번호를 올립니다.
/// 생성은 늘 새 파일이라 덮어쓰지 않습니다.
fn reserve_free_path(out: &Path, out_dir: &Path, stem: &str, ext: &str) -> Res<Reserved> {
    match fs::OpenOptions::new().write(true).create_new(true).open(out) {
        Ok(_) => Ok(Reserved { path: out.to_path_buf(), kept: false }),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            reserve_numbered_path(out_dir, &safe_name(stem), ext)
        }
        Err(e) => Err(err("결과 자리를 만들지 못했습니다", e)),
    }
}

/// 그림 한 장을 업스케일합니다.
///
/// - `output_path` 와 `input_path` 가 같으면 **덮어씁니다**(6면 세트는 이름이 곧 세트라 이름을 지켜야 합니다).
/// - `numbered` 면 `<폴더>/<stem>_001.<ext>` 로 새 파일을 만듭니다(덮어쓰지 않음).
/// - 결과는 언제나 `.…업스케일중` 임시 파일에 먼저 쓰고 마지막에 이름을 바꿉니다 —
/// 중간에 끊겨도 원본이 반쪽으로 덮이지 않게.
#[tauri::command]
pub async fn upscale_run(
    app: AppHandle,
    engine: String,
    input_path: String,
    output_path: String,
    target: Option<TargetSpec>,
    numbered: Option<bool>,
    opts: Option<Value>,
    timeout_secs: Option<u64>,
) -> Res<UpscaleResult> {
    let engine = known_engine(&engine)?.to_string();
    let target = target.unwrap_or_default();
    let opts = opts.unwrap_or_else(|| json!({}));
    let numbered = numbered.unwrap_or(false);
    let timeout = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);

    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(app, engine, input_path, output_path, target, numbered, opts, timeout)
    })
    .await
    .map_err(|e| err("업스케일을 기다리지 못했습니다", e))?
}

#[allow(clippy::too_many_arguments)]
fn run_blocking(
    app: AppHandle,
    engine: String,
    input_path: String,
    output_path: String,
    target: TargetSpec,
    numbered: bool,
    opts: Value,
    timeout: u64,
) -> Res<UpscaleResult> {
    let started = Instant::now();
    let source = PathBuf::from(&input_path);
    if !source.is_file() {
        return Err("업스케일할 원본 그림을 찾지 못했습니다.".into());
    }
    let out = PathBuf::from(&output_path);
    let out_ext = out
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !UPSCALE_EXTENSIONS.contains(&out_ext.as_str()) {
        return Err("결과 자리는 png·jpg·webp 그림 경로여야 합니다.".into());
    }
    let Some(out_dir) = out.parent().filter(|p| p.is_dir()) else {
        return Err("결과를 놓을 폴더가 없습니다.".into());
    };

    // 덮어쓰기는 잡을 것이 없습니다 — 그 자리는 이미 원본 그림입니다.
    let mut reserved = if numbered {
        let stem = out
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .ok_or("결과 파일 이름이 비어 있습니다.")?;
        Some(reserve_numbered_path(out_dir, &safe_name(stem), &out_ext)?)
    } else {
        None
    };
    let final_path = reserved.as_ref().map(|r| r.path.clone()).unwrap_or_else(|| out.clone());
    /*
      임시 이름은 **확장자를 끝에 남깁니다** — `.<이름>.업스케일중.<작업번호>.<확장자>`.

      예전에는 `.<이름>.업스케일중` 이라 파이썬의 `os.path.splitext` 도 Rust 의
      `ImageFormat::from_extension` 도 확장자를 «업스케일중» 으로 읽었습니다. 그래서
      jpg 를 시켜도 결과는 늘 PNG 였고(common.save_image 의 jpg 품질 95·webp 무손실 갈래가
      통째로 죽은 코드였습니다), 이름만 .jpg 인 PNG 를 마그니픽·생성기에 올렸습니다.
      앞의 점 때문에 프로젝트 폴더 훑기에는 여전히 안 잡힙니다(lib.rs 의 «.» 로 시작하면 건너뜀).
    */
    // 임시 이름에 작업 번호표를 섞는 까닭: 덮어쓰기 업스케일은 결과 이름이 늘 같아서,
    // 같은 그림을 두 번 겹쳐 돌리면 두 작업이 **같은 임시 파일**을 썼습니다.
    let final_name = final_path.file_name().and_then(|n| n.to_str()).unwrap_or("결과");
    let final_stem = final_path.file_stem().and_then(|n| n.to_str()).unwrap_or(final_name);
    let temp = out_dir.join(format!(".{final_stem}.업스케일중.{}.{out_ext}", job_tag()));

    let manifest = read_manifest(&app, &engine)?;
    let root = engine_dir(&app, &engine)?;
    if !is_installed(&root, &manifest) {
        return Err(format!("{} 이(가) 설치돼 있지 않습니다. 설정 → 업스케일 엔진에서 설치하세요.", manifest.name));
    }

    // 엔진 하나는 한 번에 한 장. VRAM 을 다투면 느려지거나 죽습니다.
    let state = app.state::<UpscaleState>();
    // 설치·제거는 큐 자물쇠를 시험 삼아 잡아 보고 도는 중이면 물러납니다(아래 명령들 참조).
    // 반대쪽도 막아야 짝이 맞습니다 — 설치가 도는 중에 새 작업이 들어오면 반쯤 깐 환경을 씁니다.
    if state.cancels.lock_safe().contains_key(&engine) {
        return Err(format!("{} 을(를) 설치하는 중입니다. 끝난 뒤에 다시 하세요.", manifest.name));
    }
    let queue = state.queue(&engine);
    let _guard = queue.lock_safe();

    let outcome: Res<(u32, u32)> = if manifest.kind == "binary" {
        run_upscayl(&app, &manifest, &root, &source, &temp, &target, &opts, timeout)
    } else {
        let worker = ensure_worker(&app, &state, &engine)?;
        let request = json!({
            "op": "upscale",
            "input": source.to_string_lossy(),
            "output": temp.to_string_lossy(),
            "target": target,
            "opts": opts,
        });
        let reply = ask(&app, &state, &engine, &worker, request, timeout)?;
        if reply.get("event").and_then(|v| v.as_str()) == Some("error") {
            Err(reply
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("업스케일에 실패했습니다.")
                .to_string())
        } else {
            Ok((
                reply.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                reply.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            ))
        }
    };

    let (width, height) = match outcome {
        Ok(size) => size,
        Err(message) => {
            // 반쪽짜리를 주인 폴더에 남기지 않습니다.
            let _ = fs::remove_file(&temp);
            return Err(message);
        }
    };
    if !temp.is_file() {
        return Err("업스케일 결과 파일이 만들어지지 않았습니다.".into());
    }
    /*
      **원본을 먼저 지우지 않습니다**(2026-09-09 지적).

      예전에는 `remove_file(final_path)` 를 먼저 했습니다. 그런데 덮어쓰기 업스케일
      (6면 세트·낱장)에서 `final_path` 는 곧 사용자의 원본 그림입니다. 지운 뒤 rename 이
      실패하면(윈도우 디펜더·탐색기 미리보기·드롭박스가 파일을 잠깐 잡는 일이 드물지
      않습니다) 이어지는 임시 파일 정리까지 겹쳐 **그림이 통째로 사라졌습니다**.
      윈도우의 `fs::rename` 은 MOVEFILE_REPLACE_EXISTING 이라 선삭제가 애초에 필요 없습니다.
      실패했을 때 임시 파일도 지우지 않습니다 — 유일하게 남은 결과라 자리를 알려 줍니다.
    */
    if let Err(e) = fs::rename(&temp, &final_path) {
        return Err(format!(
            "결과 파일로 바꾸지 못했습니다: {e}. 원본은 그대로 있고, 업스케일 결과는 여기 남겨 두었습니다 — {}",
            temp.display()
        ));
    }
    // 자리에 결과가 들어갔습니다. 이제 잡아 둔 자리를 치우면 안 됩니다.
    if let Some(slot) = reserved.as_mut() {
        slot.keep();
    }
    progress(&app, &engine, "run", Some(100.0), "받았습니다");

    Ok(UpscaleResult {
        output: final_path.to_string_lossy().to_string(),
        width,
        height,
        seconds: started.elapsed().as_secs_f64(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 목표_긴변은_짧은변을_비율대로_16배수로() {
        assert_eq!(resolve_target((1024, 512), &TargetSpec { long_edge: Some(4096), scale: None }), (4096, 2048));
        assert_eq!(resolve_target((512, 1024), &TargetSpec { long_edge: Some(4096), scale: None }), (2048, 4096));
        // 1000×750 → 긴 변 4096, 짧은 변 3072
        assert_eq!(resolve_target((1000, 750), &TargetSpec { long_edge: Some(4096), scale: None }), (4096, 3072));
    }

    #[test]
    fn 배율_지정도_16배수로() {
        assert_eq!(resolve_target((500, 500), &TargetSpec { long_edge: None, scale: Some(4) }), (2000, 2000));
    }

    #[test]
    fn 압축본의_수상한_경로는_거부한다() {
        assert!(safe_entry_path("../../밖.txt").is_none());
        assert!(safe_entry_path("/etc/passwd").is_none());
        assert!(safe_entry_path("C:/윈도우/시스템.dll").is_none());
        assert!(safe_entry_path("repo/src/파일.py").is_some());
    }

    /// vosr 의 `empty_files` 가 다시 두 겹이 되지 않게 못을 박습니다.
    ///
    /// 2026-09-09 에 값을 `preset/ckpts/torch_cache/trusted_list` 로 «고친» 적이 있는데,
    /// `empty_files` 는 `code[].dest` 와 달리 **models_dir 기준**이라 그러면
    /// `engines/vosr/preset/ckpts/preset/ckpts/…` 라는 쓰레기 경로가 생기고 정작 torch 가
    /// 보는 자리에는 파일이 없습니다. 설치를 실제로 돌리지 않아도 여기서 걸립니다.
    #[test]
    fn vosr_의_빈파일은_models_dir_기준이라_두겹이_되면_안된다() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/upscale/engines/vosr/manifest.json");
        let text = fs::read_to_string(&path).expect("vosr manifest 를 읽지 못했습니다");
        let manifest: EngineManifest = serde_json::from_str(&text).expect("vosr manifest 형식");

        let root = PathBuf::from("engines").join("vosr");
        let models = models_root(&root, &manifest);
        assert_eq!(models, root.join("preset").join("ckpts"));

        let safe = safe_entry_path(&manifest.empty_files[0]).expect("빈 파일 경로");
        let made = models.join(safe);
        assert_eq!(made, root.join("preset/ckpts/torch_cache/trusted_list"));
        assert!(!made.starts_with(root.join("preset/ckpts/preset")), "기준을 code[].dest 와 헷갈렸습니다");

        // 뿌리 기준인 것은 code[].dest 뿐 — 같은 manifest 안에서 기준이 둘입니다.
        let code = code_dest(&root, &manifest.code[1]).expect("코드 자리");
        assert_eq!(code, root.join("preset/ckpts/torch_cache/facebookresearch_dinov2_main"));
    }

    #[test]
    fn 모르는_엔진은_경로가_되지_않는다() {
        assert!(known_engine("spandrel").is_ok());
        assert!(known_engine("../../..").is_err());
        assert!(known_engine("comfy").is_err());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 로컬 생성 (영상·이미지·음악) — 설치·워커 살림은 위와 **같은 것**을 씁니다
// ─────────────────────────────────────────────────────────────────────────────

/// `local_run` 이 돌려주는 것.
#[derive(Debug, Clone, Serialize)]
pub struct GenerateResult {
    pub output: String,
    pub seconds: f64,
    /// 엔진이 덧붙인 값(실제 길이·해상도·쓴 시드 등). 화면에 그대로 보여 줍니다.
    pub meta: Value,
}

/// 로컬 엔진으로 파일 하나를 만듭니다. **막는 함수**라 `spawn_blocking` 안에서 부르세요.
///
/// 업스케일과 같은 자물쇠·같은 워커를 씁니다 — GPU 는 하나라, 영상을 뽑는 동안 업스케일이
/// 끼어들면 둘 다 느려지거나 VRAM 이 터집니다(`state.queue` 는 엔진별이지만, 무거운 엔진을
/// 동시에 올리지 않는 것은 프런트가 지킵니다).
///
/// 결과는 `.<이름>.생성중.<작업번호>.<확장자>` 임시 파일에 먼저 쓰고 마지막에 이름을 바꿉니다 —
/// 중간에 끊겨도 반쪽짜리가 프로젝트 폴더에 남지 않게.
pub(crate) fn generate_blocking(
    app: AppHandle,
    engine: String,
    output_path: String,
    opts: Value,
    timeout: u64,
) -> Res<GenerateResult> {
    let started = Instant::now();
    let engine = known_engine(&engine)?.to_string();
    let out = PathBuf::from(&output_path);
    let out_ext = out
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if out_ext.is_empty() {
        return Err("결과 자리에 확장자가 없습니다.".into());
    }
    let Some(out_dir) = out.parent().filter(|p| p.is_dir()) else {
        return Err("결과를 놓을 폴더가 없습니다.".into());
    };
    let stem = out.file_stem().and_then(|n| n.to_str()).unwrap_or("결과");
    /*
      결과 자리를 **뽑기 전에** 잡아 둡니다.

      예전에는 다 뽑은 뒤에야 `out.exists()` 를 보고 이름을 정했습니다. 영상 한 편은 몇 분이라,
      그 사이에 들어온 다음 요청도 «비어 있다» 를 보고 같은 이름을 골랐고, 나중 것이 먼저 것을
      덮었습니다. 임시 이름에도 작업 번호표를 섞습니다 — 고정 이름이면 두 작업이 서로 밟습니다.
    */
    let mut reserved = reserve_free_path(&out, out_dir, stem, &out_ext)?;
    let final_path = reserved.path.clone();
    let final_stem = final_path.file_stem().and_then(|n| n.to_str()).unwrap_or(stem);
    let temp = out_dir.join(format!(".{final_stem}.생성중.{}.{out_ext}", job_tag()));

    let manifest = read_manifest(&app, &engine)?;
    let root = engine_dir(&app, &engine)?;
    if !is_installed(&root, &manifest) {
        return Err(format!(
            "{} 이(가) 설치돼 있지 않습니다. 설정 → 로컬 모델에서 설치하세요.",
            manifest.name
        ));
    }

    let state = app.state::<UpscaleState>();
    if state.cancels.lock_safe().contains_key(&engine) {
        return Err(format!("{} 을(를) 설치하거나 가중치를 받는 중입니다. 끝난 뒤에 다시 하세요.", manifest.name));
    }
    let queue = state.queue(&engine);
    let _guard = queue.lock_safe();

    // 생성 결과가 파일에 놓인 뒤에도 CPU offload 가중치와 CUDA allocator는 프로세스에
    // 남습니다. 기본은 이 작업의 자식만 종료하며, 명시적으로 유지한 경우만 재사용합니다.
    // 큐 잠금보다 나중에 만들어야 정리가 끝난 뒤 다음 생성이 같은 엔진을 올립니다.
    let mut release = WorkerRelease {
        app: &app,
        state: &state,
        engine: &engine,
        retain: false,
    };
    let worker = ensure_worker(&app, &state, &engine)?;
    let request = json!({
        "op": "generate",
        "output": temp.to_string_lossy(),
        "opts": &opts,
    });
    let reply = ask(&app, &state, &engine, &worker, request, timeout)?;
    if reply.get("event").and_then(|v| v.as_str()) == Some("error") {
        let _ = fs::remove_file(&temp);
        let message = reply
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("생성에 실패했습니다.")
            .to_string();
        /*
          **GPU 문맥이 깨졌으면 워커를 내립니다.**

           CUDA 는 한 번
          치명적으로 어긋나면 그 프로세스의 문맥이 통째로 죽어, 살아 있는 워커에 무엇을 시켜도 같은
          오류만 돌려줍니다. 사람 눈에는 «한 번 실패한 뒤로는 전부 실패» 로 보입니다. 파이썬을 새로
          띄우는 것이 유일한 회복이라, 다음 요청이 새 문맥에서 시작하도록 여기서 내려 둡니다.
        */
        if is_device_fault(&message) {
            log::warn!("{engine}: GPU 문맥이 깨져 워커를 내립니다 — {message}");
            stop_worker(&app, &state, &engine);
        }
        return Err(message);
    }
    if !temp.is_file() {
        return Err("결과 파일이 만들어지지 않았습니다.".into());
    }
    if let Err(e) = fs::rename(&temp, &final_path) {
        return Err(format!(
            "결과 파일로 바꾸지 못했습니다: {e}. 만든 것은 여기 남겨 두었습니다 — {}",
            temp.display()
        ));
    }
    reserved.keep();
    progress(&app, &engine, "run", Some(100.0), "받았습니다");
    // 첫 생성이 가중치를 받아 왔을 수 있습니다 — 카드의 크기가 그것을 따라가게 뒤에서 다시 잽니다.
    remeasure_disk_in_background(&app, &engine, DISK_REMEASURE_AFTER_RUN_SECS);

    let mut meta = reply.clone();
    if let Some(object) = meta.as_object_mut() {
        object.remove("id");
        object.remove("event");
        object.remove("output");
        object.insert("worker_retained".into(), json!(retain_generation_worker(&opts, &reply)));
    }
    release.retain = retain_generation_worker(&opts, &reply);
    Ok(GenerateResult {
        output: final_path.to_string_lossy().to_string(),
        seconds: started.elapsed().as_secs_f64(),
        meta,
    })
}

fn retain_generation_worker(opts: &Value, reply: &Value) -> bool {
    // 옛 호출에서 필드가 빠졌을 때만 keep_worker를 읽습니다. 잘못된 새 정책은 해제합니다.
    if opts.get("memory_policy").is_none() {
        return opts.get("keep_worker").and_then(Value::as_bool) == Some(true);
    }
    match opts.get("memory_policy").and_then(Value::as_str) {
        Some("retain") => true,
        Some("adaptive") => {
            let limit = |key: &str| opts.get(key).and_then(Value::as_f64).filter(|v|v.is_finite() && v.fract() == 0.0 && *v >= 1.0 && *v <= 99.0).unwrap_or(85.0);
            let below = |key: &str, threshold: f64| reply.get("memory").and_then(|memory|memory.get(key)).and_then(Value::as_f64).is_some_and(|v|v.is_finite() && v >= 0.0 && v < threshold);
            // 사용률을 읽지 못한 판을 «여유 있음» 으로 단정하면 다시 메모리가 쌓입니다.
            below("ram_used_percent", limit("memory_ram_percent")) && below("vram_used_percent", limit("memory_vram_percent"))
        }
        Some(_) => false,
        None => false,
    }
}

struct WorkerRelease<'a> {
    app: &'a AppHandle,
    state: &'a UpscaleState,
    engine: &'a str,
    retain: bool,
}

impl Drop for WorkerRelease<'_> {
    fn drop(&mut self) {
        if !self.retain {
            progress(self.app, self.engine, "run", None, "로컬 모델 메모리를 정리합니다");
            stop_worker(self.app, self.state, self.engine);
        }
    }
}

#[cfg(test)]
mod generation_memory_tests {
    use super::retain_generation_worker;
    use serde_json::json;

    #[test]
    fn release_is_default_for_old_and_new_callers() {
        for opts in [json!({}), json!({"keep_worker":false}), json!({"keep_worker":"true"}), json!(null)] {
            assert!(!retain_generation_worker(&opts, &json!({})));
        }
        assert!(retain_generation_worker(&json!({"keep_worker":true}), &json!({})));
        for policy in [json!(null), json!(123), json!([]), json!({}), json!("invalid")] {
            assert!(!retain_generation_worker(&json!({"memory_policy":policy,"keep_worker":true}), &json!({})));
        }
    }

    #[test]
    fn adaptive_releases_on_either_limit_and_unknown_measurement() {
        let opts = json!({"memory_policy":"adaptive","memory_ram_percent":80,"memory_vram_percent":90});
        assert!(retain_generation_worker(&opts, &json!({"memory":{"ram_used_percent":79,"vram_used_percent":89}})));
        for memory in [json!({"ram_used_percent":80,"vram_used_percent":40}), json!({"ram_used_percent":40,"vram_used_percent":90}), json!({"ram_used_percent":40}), json!(null)] {
            assert!(!retain_generation_worker(&opts, &json!({"memory":memory})));
        }
        assert!(!retain_generation_worker(&json!({"memory_policy":"release","keep_worker":true}), &json!({})));
    }
}

#[cfg(test)]
mod disk_measure_tests {
    use super::{disk_is_stale, InstalledRecord, DISK_REMEASURE_AFTER_RUN_SECS, DISK_STALE_SECS};

    fn measured_at(secs: u64) -> InstalledRecord {
        InstalledRecord { disk_measured_at: secs, ..InstalledRecord::default() }
    }

    /// 옛 기록(잰 적 없음 = 0)은 어느 잣대로도 낡은 것입니다 — 카드가 이 길로 고쳐집니다.
    #[test]
    fn never_measured_is_stale() {
        let now = 1_800_000_000;
        assert!(disk_is_stale(&measured_at(0), now, DISK_STALE_SECS));
        assert!(disk_is_stale(&measured_at(0), now, DISK_REMEASURE_AFTER_RUN_SECS));
        assert!(disk_is_stale(&measured_at(0), now, 0));
    }

    /// 생성을 연달아 하면 10분 안에는 다시 재지 않습니다 — 2만 파일을 매번 걷지 않게.
    #[test]
    fn recent_measure_is_kept_within_min_age() {
        let now = 1_800_000_000;
        assert!(!disk_is_stale(&measured_at(now - 100), now, DISK_REMEASURE_AFTER_RUN_SECS));
        assert!(disk_is_stale(&measured_at(now - DISK_REMEASURE_AFTER_RUN_SECS), now, DISK_REMEASURE_AFTER_RUN_SECS));
        assert!(!disk_is_stale(&measured_at(now - 3600), now, DISK_STALE_SECS));
        assert!(disk_is_stale(&measured_at(now - DISK_STALE_SECS - 1), now, DISK_STALE_SECS));
    }

    /// `min_age 0` 은 «무조건» 입니다(미리 받기 끝). 시계가 뒤로 가도 터지지 않습니다.
    #[test]
    fn zero_min_age_always_stale_and_clock_skew_is_safe() {
        let now = 1_800_000_000;
        assert!(disk_is_stale(&measured_at(now), now, 0));
        assert!(!disk_is_stale(&measured_at(now + 10_000), now, DISK_STALE_SECS));
    }

    /// 옛 manifest.json(새 필드가 없는 것)도 그대로 읽혀야 합니다 — 안 그러면 설치가 «안 됨» 으로 보입니다.
    #[test]
    fn old_record_without_new_fields_still_parses() {
        let text = r#"{"version":"v","installed_at":"1","last_error":"","models":[],"disk_bytes":4815894120}"#;
        let record: InstalledRecord = serde_json::from_str(text).unwrap();
        assert_eq!(record.disk_bytes, 4_815_894_120);
        assert_eq!(record.disk_measured_at, 0);
        assert!(!record.weights_ready);
    }
}

#[cfg(test)]
mod git_cache_tests {
    use super::stale_git_dirs;

    /// 사용자 기계에서 실제로 나온 오류문 그대로. 두 가지를 못 박습니다.
    ///
    /// ① **`didn't` 의 아포스트로피** 때문에 따옴표 짝이 밀려 경로를 못 고르던 것(같은 실패를 세 번 보고서야 찾았습니다).
    /// ② **db 와 체크아웃을 둘 다** 골라야 하는 것 — 깨진 db 를 두고 체크아웃만 지우면 다시 펴다 또 실패합니다.
    #[test]
    fn finds_path_in_real_uv_message() {
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("uvreal-test-{}", std::process::id()))
            .join("uv")
            .join("cache")
            .join("git-v0");
        let dir = base.join("checkouts").join("76e25d04238765dd").join("dafe3733f");
        let db_dir = base.join("db").join("76e25d04238765dd");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&db_dir).unwrap();
        let checkout = dir.display().to_string();
        let db = db_dir.display().to_string();
        // 줄을 그대로 이어 붙입니다 — 실제 오류문이 이렇게 여러 줄로 접혀서 옵니다.
        let message = [
            "uv pip install 이(가) 실패했습니다.".to_string(),
            "  × Failed to download and build `diffusers @".to_string(),
            "  │ git+https://github.com/huggingface/diffusers@dafe3733f`".to_string(),
            "  ├─▶ Git operation failed".to_string(),
            // 이 줄의 `didn't` 가 따옴표 짝을 밀어 버린 범인입니다.
            r"  ╰─▶ process didn't exit successfully: `C:\Program".to_string(),
            r"      Files\Git\mingw64\bin\git.exe clone --no-hardlinks".to_string(),
            format!("      '{db}'"),
            format!("      '{checkout}'`"),
            "      (exit code: 128)".to_string(),
            "      --- stderr".to_string(),
            "      fatal: destination path".to_string(),
            format!("      '{checkout}'"),
            "      already exists and is not an empty directory.".to_string(),
        ]
        .join("\n");
        assert_eq!(
            stale_git_dirs(&message),
            vec![db_dir.clone(), dir.clone()],
            "따옴표 짝이 밀려도 db·체크아웃을 둘 다 찾아야 합니다"
        );
        let _ = std::fs::remove_dir_all(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!("uvreal-test-{}", std::process::id())),
        );
    }

    /// 캐시 **안**의 받다 만 체크아웃만 골라야 합니다 — 밖의 경로를 골랐다가는 사람 폴더를 지웁니다.
    #[test]
    fn picks_only_uv_cache_paths() {
        let outside = r"fatal: destination path 'D:\작업\중요폴더' already exists and is not an empty directory";
        assert!(stale_git_dirs(outside).is_empty(), "캐시 밖은 고르지 않습니다");
        let other = r"disk full while writing 'C:\Users\x\AppData\Local\uv\cache\git-v0\checkouts\a\b'";
        assert!(stale_git_dirs(other).is_empty(), "깃 오류가 아니면 손대지 않습니다");
        // 실제로 있는 폴더여야 고릅니다(is_dir) — 시험에서는 임시 폴더를 캐시 모양으로 만들어 봅니다.
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("uvcache-test-{}", std::process::id()))
            .join("uv")
            .join("cache")
            .join("git-v0")
            .join("checkouts")
            .join("hash")
            .join("commit");
        std::fs::create_dir_all(&base).unwrap();
        let message = format!(
            "fatal: destination path '{}' already exists and is not an empty directory",
            base.display()
        );
        assert_eq!(stale_git_dirs(&message), vec![base.clone()]);
        let _ = std::fs::remove_dir_all(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!("uvcache-test-{}", std::process::id())),
        );
    }
}
