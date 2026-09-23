//! MCP는 켜진 앱의 편집기만 조종합니다. stdio 프로세스는 저장본을 직접 고치지 않습니다.
use crate::{LockSafe, Res};
use fs2::FileExt;
use rmcp::{
    model::*,
    service::{RequestContext, RoleServer},
    ErrorData as McpError, ServerHandler, ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Semaphore},
};

const REQUEST_LIMIT: u64 = 2 * 1024 * 1024;
const RESPONSE_LIMIT: u64 = 32 * 1024 * 1024;

fn directory() -> Res<PathBuf> {
    // 실제 작품과 실행 중인 앱의 연결 정보를 통합 시험이 건드리지 않도록 격리합니다.
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("AIMOVIESTORAGE_TEST_CONTROL_DIR") {
        let path = PathBuf::from(root);
        if !path.is_absolute() {
            return Err("시험 폴더는 절대 경로여야 합니다.".into());
        }
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        return Ok(path);
    }
    let base = dirs::config_dir().ok_or("앱 데이터 폴더를 찾지 못했습니다.")?;
    let path = base
        .join("ai-video-storage")
        .join(format!("control-{}", crate::edition::EDITION));
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn atomic_json(path: &std::path::Path, value: &Value) -> Res<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("저장 폴더가 없습니다.")?)
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(file.as_file_mut(), value).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct Discovery {
    port: u16,
    token: String,
}

struct Host {
    task: tauri::async_runtime::JoinHandle<()>,
    token: String,
    _lock: File,
}
#[derive(Default)]
pub struct ControlState {
    host: Mutex<Option<Host>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    journal: Mutex<Option<File>>,
}

#[tauri::command]
pub fn control_status(state: tauri::State<ControlState>) -> Res<Value> {
    Ok(
        json!({"enabled":state.host.lock_safe().is_some(), "command":std::env::current_exe().map_err(|e|e.to_string())?, "args":["--mcp"], "edition":crate::edition::EDITION}),
    )
}

#[tauri::command]
pub async fn control_enable(
    app: tauri::AppHandle,
    state: tauri::State<'_, ControlState>,
    enabled: bool,
) -> Res<Value> {
    // 켜기/끄기를 직렬화합니다. 실제 소켓 처리는 별도 비동기 작업입니다.
    let mut host = state.host.lock_safe();
    if !enabled {
        if let Some(old) = host.take() {
            old.task.abort();
            state.pending.lock_safe().clear();
            let path = directory()?.join("host.json");
            // 발견 파일을 지울 때까지 다른 앱이 이 판의 소유권을 가져가지 못하게 합니다.
            if let Ok(bytes) = fs::read(&path) {
                if serde_json::from_slice::<Discovery>(&bytes)
                    .is_ok_and(|entry| entry.token == old.token)
                {
                    let _ = fs::remove_file(path);
                }
            }
            drop(old);
        }
        return Ok(json!({"enabled":false}));
    }
    if host.is_some() {
        return Ok(json!({"enabled":true}));
    }
    let folder = directory()?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(folder.join("host.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "이 판의 다른 앱이 조종기를 사용하고 있습니다.")?;
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let discovery = Discovery {
        port: listener.local_addr().map_err(|e| e.to_string())?.port(),
        token: uuid::Uuid::new_v4().to_string(),
    };
    atomic_json(
        &folder.join("host.json"),
        &serde_json::to_value(&discovery).map_err(|e| e.to_string())?,
    )?;
    let pending = state.pending.clone();
    let host_token = discovery.token.clone();
    let task = tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(listener) else {
            return;
        };
        let slots = Arc::new(Semaphore::new(16));
        while let Ok((stream, _)) = listener.accept().await {
            let Ok(permit) = slots.clone().try_acquire_owned() else {
                continue;
            };
            let app = app.clone();
            let token = discovery.token.clone();
            let pending = pending.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let _ = serve_connection(stream, app, &token, pending).await;
            });
        }
    });
    *host = Some(Host {
        task,
        token: host_token,
        _lock: lock,
    });
    Ok(json!({"enabled":true}))
}

async fn serve_connection(
    stream: TcpStream,
    app: tauri::AppHandle,
    token: &str,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
) -> Res<()> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader.take(REQUEST_LIMIT));
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut line))
        .await
        .map_err(|_| "연결 시간 초과")?
        .map_err(|e| e.to_string())?;
    if !line.ends_with('\n') {
        return Err("요청이 너무 크거나 끝나지 않았습니다.".into());
    }
    let request: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if request.get("token").and_then(Value::as_str) != Some(token) {
        return Err("조종기 인증 실패".into());
    }
    if !matches!(
        request["method"].as_str(),
        Some("tools/list" | "tools/call")
    ) {
        return Err("허용하지 않은 요청입니다.".into());
    }
    // 끄고 난 뒤 이미 들어온 연결도 새 요청을 실행할 수 없습니다.
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    let emitted = {
        let state = app.state::<ControlState>();
        let host = state.host.lock_safe();
        if !host.as_ref().is_some_and(|host| host.token == token) {
            return Err("조종기 연결이 닫혔거나 바뀌었습니다.".into());
        }
        pending.lock_safe().insert(id.clone(), tx);
        app.emit(
            "app-control-request",
            json!({"id":id,"method":request["method"],"params":request["params"]}),
        )
    };
    let result = if let Err(e) = emitted {
        Err(e.to_string())
    } else {
        tokio::time::timeout(Duration::from_secs(90), rx)
            .await
            .map_err(|_| "앱 응답 시간 초과. 작업 상태를 조회한 뒤 재시도하세요.".to_string())
            .and_then(|r| r.map_err(|e| e.to_string()))
    };
    pending.lock_safe().remove(&id);
    let value = match result {
        Ok(v) => json!({"result":v}),
        Err(e) => json!({"error":e}),
    };
    let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn control_respond(state: tauri::State<ControlState>, id: String, result: Value) -> Res<()> {
    if let Some(tx) = state.pending.lock_safe().remove(&id) {
        let _ = tx.send(result);
    }
    Ok(())
}

#[tauri::command]
pub fn control_read_journal(state: tauri::State<ControlState>) -> Res<Option<Value>> {
    let mut guard = state.journal.lock_safe();
    claim_journal(&mut guard)?;
    let path = directory()?.join("control-jobs.json");
    if !path.exists() {
        return Ok(None);
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map(Some)
        .map_err(|e| format!("작업 기록을 읽지 못했습니다. 원본은 보존했습니다: {e}"))
}

#[tauri::command]
pub fn control_write_journal(state: tauri::State<ControlState>, journal: Value) -> Res<()> {
    let mut guard = state.journal.lock_safe();
    claim_journal(&mut guard)?;
    if journal["version"] != 1 || !journal["tasks"].is_array() || !journal["operations"].is_array()
    {
        return Err("알 수 없는 작업 기록 형식입니다.".into());
    }
    atomic_json(&directory()?.join("control-jobs.json"), &journal)
}

fn claim_journal(owner: &mut Option<File>) -> Res<()> {
    if owner.is_none() {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory()?.join("journal.lock"))
            .map_err(|e| e.to_string())?;
        file.try_lock_exclusive().map_err(|_| {
            "이 판의 다른 앱이 작업 줄을 사용하고 있습니다. 먼저 연 앱을 사용해 주세요."
        })?;
        *owner = Some(file);
    }
    Ok(())
}

struct AppMcp;
async fn forward(method: &str, params: Value) -> Res<Value> {
    let discovery: Discovery = serde_json::from_slice(
        &fs::read(directory()?.join("host.json"))
            .map_err(|_| "AIMovieStorage를 열고 설정에서 외부 조종기를 켜세요.")?,
    )
    .map_err(|e| e.to_string())?;
    let stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, discovery.port))
        .await
        .map_err(|_| "앱에 연결하지 못했습니다. 설정에서 외부 조종기를 다시 켜세요.")?;
    let (reader, mut writer) = stream.into_split();
    let mut bytes =
        serde_json::to_vec(&json!({"token":discovery.token,"method":method,"params":params}))
            .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await.map_err(|e| e.to_string())?;
    let mut line = String::new();
    tokio::time::timeout(
        Duration::from_secs(95),
        BufReader::new(reader.take(RESPONSE_LIMIT)).read_line(&mut line),
    )
    .await
    .map_err(|_| "앱 응답 시간 초과")?
    .map_err(|e| e.to_string())?;
    if !line.ends_with('\n') {
        return Err("앱 응답을 끝까지 받지 못했습니다.".into());
    }
    let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if let Some(error) = response["error"].as_str() {
        return Err(error.into());
    }
    Ok(response["result"].clone())
}

impl ServerHandler for AppMcp {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::default();
        info.server_info = Implementation::new("aimoviestorage", env!("CARGO_PKG_VERSION"));
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.instructions = Some("Control the open AIMovieStorage app. Inspect IDs and revision first. Before each follow-up, read changes since the last revision: the user may have edited manually. Preserve their changes, edit with expectedRevision, preview then commit. On errors, inspect state/job before retrying. Reuse job operationId for retries. No LLM API key is needed. Only tools advertised by this build are available.".into());
        info
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let value = forward("tools/list", json!({}))
            .await
            .map_err(|e| McpError::internal_error(e, None))?;
        serde_json::from_value(value).map_err(|e| McpError::internal_error(e.to_string(), None))
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let result = match forward(
            "tools/call",
            serde_json::to_value(request)
                .map_err(|e| McpError::invalid_params(e.to_string(), None))?,
        )
        .await
        {
            Ok(value) => serde_json::from_value::<CallToolResult>(value)
                .map_err(|e| McpError::internal_error(e.to_string(), None))?,
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
        };
        Ok(result.into())
    }
}

pub fn run_mcp() -> Res<()> {
    tokio::runtime::Runtime::new()
        .map_err(|e| e.to_string())?
        .block_on(async {
            let service = AppMcp
                .serve(rmcp::transport::stdio())
                .await
                .map_err(|e| e.to_string())?;
            service.waiting().await.map_err(|e| e.to_string())?;
            Ok(())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_journal_replaces_complete_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("journal.json");
        atomic_json(&path, &json!({"version":1,"tasks":[1]})).unwrap();
        atomic_json(&path, &json!({"version":1,"tasks":[2,3]})).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["tasks"],
            json!([2, 3])
        );
    }
}
