//! MCP는 켜진 앱의 편집기만 조종합니다. stdio 프로세스는 저장본을 직접 고치지 않습니다.
use crate::{LockSafe, Res};
use crate::control_lifecycle::{Discovery, ForwarderLifecycle, session_id};
use crate::control_diagnostics::{ControlDiagnostic, closed_diagnostic, connection_failure, discovery_read_failure};
use fs2::FileExt;
use rmcp::{
    model::*,
    service::{RequestContext, RoleServer},
    ErrorData as McpError, ServerHandler, ServiceExt,
};
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

fn response_bytes(value: &Value, limit: usize) -> Res<Vec<u8>> {
    struct BoundedWriter {
        bytes: Vec<u8>,
        limit: usize,
        exceeded: bool,
    }
    impl Write for BoundedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
                self.exceeded = true;
                return Err(std::io::Error::other("응답 크기 제한"));
            }
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    // 끝 개행까지 수신 제한 안에 들어와야 합니다. 초과 자료를 계속 직렬화하지 않습니다.
    let mut writer = BoundedWriter {
        bytes: Vec::new(),
        limit: limit.saturating_sub(1),
        exceeded: false,
    };
    if let Err(error) = serde_json::to_writer(&mut writer, value) {
        if !writer.exceeded {
            return Err(error.to_string());
        }
        let message = "응답 자료가 너무 큽니다. detail: summary로 다시 조회하세요. 편집이 이미 적용됐을 수 있으므로 바로 반복하지 마세요.";
        writer.bytes = serde_json::to_vec(&json!({"result": {
            "isError": true,
            "content": [{"type": "text", "text": message}],
            "structuredContent": {"code": "response_too_large", "message": message, "retryDetail": "summary"}
        }})).map_err(|e| e.to_string())?;
    }
    writer.bytes.push(b'\n');
    Ok(writer.bytes)
}

fn directory() -> Res<PathBuf> {
    // 실제 작품과 실행 중인 앱의 연결 정보를 통합 시험이 건드리지 않도록 격리합니다.
    #[cfg(any(test, debug_assertions))]
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
    frontend_ready: std::sync::atomic::AtomicBool,
}

#[tauri::command]
pub fn control_frontend_ready(state: tauri::State<ControlState>) {
    // 초기화 진행 여부와 사용자가 선택한 켜짐 상태는 별개입니다. 선택이나 토큰을 바꾸지 않습니다.
    state.frontend_ready.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn control_status(state: tauri::State<ControlState>) -> Res<Value> {
    Ok(
        json!({"enabled":state.host.lock_safe().is_some(), "frontendReady":state.frontend_ready.load(std::sync::atomic::Ordering::SeqCst), "command":std::env::current_exe().map_err(|e|e.to_string())?, "args":["--mcp"], "edition":crate::edition::EDITION, "mcpLifecycle":"bound-session-normal-close-v1"}),
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
        if let Some(old) = host.as_ref() {
            publish_closed_discovery(&directory()?.join("host.json"), &old.token, "control_disabled")?;
        }
        if let Some(old) = host.take() {
            old.task.abort();
            state.pending.lock_safe().clear();
            // 완료 기록은 새 GUI에도 넘겨 같은 세션의 전달기만 정상 종료하게 합니다.
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
    let previous = read_discovery(&folder.join("host.json")).ok();
    let discovery = Discovery::active(
        listener.local_addr().map_err(|e| e.to_string())?.port(),
        uuid::Uuid::new_v4().to_string(), previous.as_ref(),
    );
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
    MAINTENANCE_CONNECTIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let _maintenance_connection = MaintenanceConnection;
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader.take(REQUEST_LIMIT));
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut line))
        .await
        .map_err(|_| ControlDiagnostic::RequestTimeout.message())?
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
        // 인증과 현재 host 일치가 확인된 뒤에만 준비 상태를 판단합니다. 오래된 endpoint는 추측하지 않습니다.
        if !state.frontend_ready.load(std::sync::atomic::Ordering::SeqCst) {
            Err(ControlDiagnostic::StartupNotReady.message())
        } else {
            pending.lock_safe().insert(id.clone(), tx);
            app.emit(
                "app-control-request",
                json!({"id":id,"method":request["method"],"params":request["params"]}),
            ).map_err(|error| error.to_string())
        }
    };
    let result = if let Err(e) = emitted {
        Err(e.to_string())
    } else {
        tokio::time::timeout(Duration::from_secs(90), rx)
            .await
            .map_err(|_| ControlDiagnostic::ResponseTimeout.message())
            .and_then(|r| r.map_err(|e| e.to_string()))
    };
    pending.lock_safe().remove(&id);
    let value = match result {
        Ok(v) => json!({"result":v}),
        Err(e) => json!({"error":e}),
    };
    let bytes = response_bytes(&value, RESPONSE_LIMIT as usize)?;
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

#[derive(Clone)]
struct AppMcp { lifecycle: Arc<Mutex<ForwarderLifecycle>> }
struct ForwarderRequest(Arc<Mutex<ForwarderLifecycle>>);
impl Drop for ForwarderRequest { fn drop(&mut self) { self.0.lock_safe().finish(); } }
impl AppMcp {
    fn begin_request(&self) -> Res<ForwarderRequest> { self.lifecycle.lock_safe().begin()?; Ok(ForwarderRequest(self.lifecycle.clone())) }
}
async fn forward(method: &str, params: Value) -> Res<(Value, String)> {
    forward_at(&directory()?.join("host.json"), method, params, Duration::from_secs(5), Duration::from_secs(95)).await
}

async fn forward_at(path: &std::path::Path, method: &str, params: Value, connect_timeout: Duration, response_timeout: Duration) -> Res<(Value, String)> {
    let discovery: Discovery = serde_json::from_slice(
        &fs::read(path).map_err(|error| discovery_read_failure(error.kind()).message())?,
    ).map_err(|_| ControlDiagnostic::DiscoveryInvalid.message())?;
    if let Some(issue) = closed_diagnostic(&discovery) { return Err(issue.message()); }
    let stream = connect_with_timeout(TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, discovery.port)), connect_timeout).await?;
    let (reader, mut writer) = stream.into_split();
    let mut bytes = serde_json::to_vec(&json!({"token":discovery.token,"method":method,"params":params}))
        .map_err(|_| ControlDiagnostic::RequestWriteFailed.message())?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await.map_err(|_| ControlDiagnostic::RequestWriteFailed.message())?;
    let mut line = String::new();
    tokio::time::timeout(response_timeout, BufReader::new(reader.take(RESPONSE_LIMIT)).read_line(&mut line))
        .await
        .map_err(|_| ControlDiagnostic::ResponseTimeout.message())?
        .map_err(|_| ControlDiagnostic::ResponseReadFailed.message())?;
    if !line.ends_with('\n') { return Err(ControlDiagnostic::ResponseIncomplete.message()); }
    let response: Value = serde_json::from_str(&line).map_err(|_| ControlDiagnostic::ResponseInvalid.message())?;
    if let Some(error) = response["error"].as_str() { return Err(error.into()); }
    Ok((response["result"].clone(), session_id(&discovery.token)))
}

async fn connect_with_timeout(connection: impl std::future::Future<Output = std::io::Result<TcpStream>>, deadline: Duration) -> Res<TcpStream> {
    tokio::time::timeout(deadline, connection).await
        .map_err(|_| ControlDiagnostic::ConnectionTimeout.message())?
        .map_err(|error| connection_failure(error.kind()).message())
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
        let _request = self.begin_request().map_err(|e| McpError::internal_error(e, None))?;
        let (value, session) = forward("tools/list", json!({})).await.map_err(|e| McpError::internal_error(e, None))?;
        self.lifecycle.lock_safe().bind(session);
        serde_json::from_value(value).map_err(|e| McpError::internal_error(e.to_string(), None))
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let _request = self.begin_request().map_err(|e| McpError::internal_error(e, None))?;
        let result = match forward(
            "tools/call",
            serde_json::to_value(request)
                .map_err(|e| McpError::invalid_params(e.to_string(), None))?,
        )
        .await
        {
            Ok((value, session)) => {
                self.lifecycle.lock_safe().bind(session);
                serde_json::from_value::<CallToolResult>(value).map_err(|e| McpError::internal_error(e.to_string(), None))?
            },
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
        };
        Ok(result.into())
    }
}

fn read_discovery(path: &std::path::Path) -> Res<Discovery> {
    let bytes=fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len()>65536 { return Err("제어 등록 정보가 너무 큽니다.".into()); }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
fn publish_closed_discovery(path: &std::path::Path, token: &str, reason: &str) -> Res<()> {
    let mut entry=read_discovery(path)?;
    if entry.token!=token { return Err("다른 GUI의 제어 등록 정보를 변경하지 않습니다.".into()); }
    entry.close(reason)?;
    atomic_json(path, &serde_json::to_value(entry).map_err(|e| e.to_string())?)
}
pub(crate) fn publish_normal_shutdown(app: &tauri::AppHandle) -> Res<()> {
    let state=app.state::<ControlState>();
    let host=state.host.lock_safe();
    if let Some(host)=host.as_ref() { publish_closed_discovery(&directory()?.join("host.json"), &host.token, "normal_shutdown")?; }
    Ok(())
}
async fn wait_for_bound_gui_close(lifecycle: Arc<Mutex<ForwarderLifecycle>>, path: PathBuf) {
    let mut timer=tokio::time::interval(Duration::from_millis(100));
    loop {
        timer.tick().await;
        if let Ok(entry)=read_discovery(&path) {
            if lifecycle.lock_safe().request_stop_if_closed(&entry) { return; }
        }
        // 파일 없음/일시 오류/다른 세션/제어 포트 접속 실패를 종료 신호로 추정하지 않습니다.
    }
}
pub fn run_mcp() -> Res<()> {
    let runtime=tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let result=runtime.block_on(async {
        // GUI에 실제로 붙지 못한 headless 전달기가 EXE를 계속 잠그지 않게 합니다.
        let (tools, session)=forward("tools/list",json!({})).await?;
        serde_json::from_value::<ListToolsResult>(tools).map_err(|e|e.to_string())?;
        let lifecycle=Arc::new(Mutex::new(ForwarderLifecycle::default()));
        lifecycle.lock_safe().bind(session);
        let path=directory()?.join("host.json");
        let handler=AppMcp { lifecycle:lifecycle.clone() };
        let service=tokio::select! {
            result=handler.serve(rmcp::transport::stdio()) => result.map_err(|e|e.to_string())?,
            _=wait_for_bound_gui_close(lifecycle.clone(),path.clone()) => return Ok(()),
        };
        let cancel=service.cancellation_token();
        let monitor=tokio::spawn(async move { wait_for_bound_gui_close(lifecycle,path).await; cancel.cancel(); });
        let ended=service.waiting().await.map_err(|e|e.to_string());
        monitor.abort(); // 이 전달기가 만든 파일 감시 future만 정리합니다. 다른 프로세스에 신호를 보내지 않습니다.
        ended?;
        Ok(())
    });
    // Tokio stdin의 취소 불가능한 blocking read를 runtime Drop에서 영원히 기다리지 않습니다.
    // MCP 응답/transport 종료는 waiting()으로 먼저 기다리고, 자신의 프로세스는 main에서 정상 반환합니다.
    runtime.shutdown_background();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pending_tcp_connection_is_bounded_and_does_not_claim_disabled() {
        let result = connect_with_timeout(std::future::pending::<std::io::Result<TcpStream>>(), Duration::from_millis(10)).await;
        let error = result.unwrap_err(); assert!(error.starts_with("[connection_timeout]"));
        assert!(!error.contains("앱 조종 켜기"));
    }
    #[tokio::test]
    async fn missing_discovery_is_unknown_without_setting_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("host.json");
        let error = forward_at(&path, "tools/list", json!({}), Duration::from_secs(1), Duration::from_secs(1)).await.unwrap_err();
        assert!(error.starts_with("[discovery_unavailable]"));
        assert!(!error.contains("앱 조종 켜기"));
        assert!(!path.exists());
    }
    #[tokio::test]
    async fn malformed_discovery_does_not_export_private_input() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("host.json");
        let bytes = br#"{"token":"private-should-not-leak","port":"invalid"}"#;
        fs::write(&path, bytes).unwrap();
        let error = forward_at(&path, "tools/list", json!({}), Duration::from_secs(1), Duration::from_secs(1)).await.unwrap_err();
        assert!(error.starts_with("[discovery_invalid]"));
        assert!(!error.contains("private-should-not-leak"));
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    #[tokio::test]
    async fn confirmed_disabled_and_normal_closed_sessions_are_distinct() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("host.json");
        for (reason, code, enable_hint) in [("control_disabled", "control_disabled", true), ("normal_shutdown", "session_closed", false)] {
            let mut entry = Discovery::active(1, "private-fixture".into(), None); entry.close(reason).unwrap();
            atomic_json(&path, &serde_json::to_value(entry).unwrap()).unwrap(); let before = fs::read(&path).unwrap();
            let error = forward_at(&path, "tools/list", json!({}), Duration::from_secs(1), Duration::from_secs(1)).await.unwrap_err();
            assert!(error.starts_with(&format!("[{code}]"))); assert_eq!(error.contains("앱 조종 켜기"), enable_hint);
            assert!(!error.contains("private-fixture")); assert_eq!(fs::read(&path).unwrap(), before);
        }
    }
    #[tokio::test]
    async fn stale_refused_endpoint_does_not_claim_disabled_or_initializing() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("host.json");
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let entry = Discovery::active(listener.local_addr().unwrap().port(), "private-fixture".into(), None);
        atomic_json(&path, &serde_json::to_value(entry).unwrap()).unwrap(); drop(listener);
        let before = fs::read(&path).unwrap();
        let error = forward_at(&path, "tools/list", json!({}), Duration::from_secs(5), Duration::from_secs(1)).await.unwrap_err();
        assert!(error.starts_with("[connection_refused]"), "error={error}"); assert!(!error.contains("앱 조종 켜기"));
        assert!(!error.contains("[startup_not_ready]")); assert!(!error.contains("private-fixture"));
        assert_eq!(fs::read(&path).unwrap(), before);
    }
    async fn diagnostic_fixture(reply: Option<Vec<u8>>) -> String {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("host.json");
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        atomic_json(&path, &serde_json::to_value(Discovery::active(listener.local_addr().unwrap().port(), "fixture".into(), None)).unwrap()).unwrap();
        let bridge = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap(); let (reader, mut writer) = socket.into_split();
            let mut line = String::new(); BufReader::new(reader).read_line(&mut line).await.unwrap();
            let request: Value = serde_json::from_str(&line).unwrap(); assert_eq!(request["token"], "fixture");
            if let Some(bytes) = reply { writer.write_all(&bytes).await.unwrap(); }
            else { tokio::time::sleep(Duration::from_millis(250)).await; }
        });
        let error = forward_at(&path, "tools/list", json!({}), Duration::from_secs(1), Duration::from_millis(100)).await.unwrap_err();
        bridge.await.unwrap(); error
    }
    #[tokio::test]
    async fn confirmed_host_not_ready_is_distinct_from_response_timeout() {
        let issue = ControlDiagnostic::StartupNotReady;
        let error = diagnostic_fixture(Some(response_bytes(&json!({"error": issue.message(), "errorCode": issue.code()}), 4096).unwrap())).await;
        assert!(error.starts_with("[startup_not_ready]")); assert!(!error.contains("앱 조종 켜기"));
        let error = diagnostic_fixture(None).await;
        assert!(error.starts_with("[response_timeout]")); assert!(!error.contains("[startup_not_ready]"));
    }
    #[tokio::test]
    async fn incomplete_or_invalid_response_has_no_false_setting_advice() {
        let error = diagnostic_fixture(Some(b"{\"result\":".to_vec())).await;
        assert!(error.starts_with("[response_incomplete]")); assert!(!error.contains("앱 조종 켜기"));
        let error = diagnostic_fixture(Some(b"invalid-private-fixture\n".to_vec())).await;
        assert!(error.starts_with("[response_invalid]")); assert!(!error.contains("invalid-private-fixture"));
    }
    #[test]
    fn frontend_readiness_defaults_false_without_enabling_host() {
        let state = ControlState::default();
        assert!(!state.frontend_ready.load(std::sync::atomic::Ordering::SeqCst));
        assert!(state.host.lock_safe().is_none());
        state.frontend_ready.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(state.host.lock_safe().is_none());
    }
    #[test]
    fn oversized_response_is_a_complete_small_error_not_a_truncated_frame() {
        let value = json!({"result": {"content": [{"type": "text", "text": "가".repeat(20_000)}]}});
        let bytes = response_bytes(&value, 4096).unwrap();
        assert!(bytes.len() < 4096);
        assert_eq!(bytes.last(), Some(&b'\n'));
        let parsed: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            parsed["result"]["structuredContent"]["code"],
            "response_too_large"
        );
        assert_eq!(parsed["result"]["isError"], true);
    }
    #[test]
    fn response_boundary_counts_newline_and_utf8_bytes() {
        let value = json!({"result": "안녕"});
        let encoded = serde_json::to_vec(&value).unwrap();
        let bytes = response_bytes(&value, encoded.len() + 1).unwrap();
        assert_eq!(bytes.len(), encoded.len() + 1);
        assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), value);
    }
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
    #[test]
    fn close_marker_requires_own_registered_session() {
        let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("host.json");
        let entry=Discovery::active(1234,"owner".into(),None);
        atomic_json(&path,&serde_json::to_value(entry).unwrap()).unwrap();
        let before=fs::read(&path).unwrap();
        assert!(publish_closed_discovery(&path,"different","normal_shutdown").is_err());
        assert_eq!(fs::read(&path).unwrap(),before);
        publish_closed_discovery(&path,"owner","normal_shutdown").unwrap();
        assert!(read_discovery(&path).unwrap().currently_closed());
    }
    #[test]
    fn missing_registration_does_not_create_a_close_marker() {
        let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("host.json");
        assert!(publish_closed_discovery(&path,"owner","normal_shutdown").is_err());
        assert!(!path.exists());
    }
    // 자신의 test executable만 stdio 자식으로 쓴다. 실제 GUI/설치 IPC는 사용하지 않는다.
    #[test]
    fn stdio_child_fixture() {
        if std::env::var_os("AIMOVIESTORAGE_STDIO_FIXTURE").is_some() { run_mcp().unwrap(); }
    }
    fn wait_own_child(child: &mut std::process::Child) -> std::process::ExitStatus {
        let deadline=std::time::Instant::now()+Duration::from_secs(5);
        loop {
            if let Some(status)=child.try_wait().unwrap() { return status; }
            if std::time::Instant::now()>=deadline {
                // 실패해도 보유한 자신의 stdin EOF로만 정리한다. kill은 하지 않는다.
                drop(child.stdin.take());
                let status=child.wait().unwrap();
                panic!("own stdio child did not close before deadline; cleaned by EOF, status={status}");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn stdio_scenario(mode: &str) {
        use std::io::{BufRead, BufReader as StdReader};
        use std::process::{Command, Stdio};
        let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("host.json");
        let listener=std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).unwrap();
        atomic_json(&path,&serde_json::to_value(Discovery::active(listener.local_addr().unwrap().port(),"fixture".into(),None)).unwrap()).unwrap();
        let pending_reply=mode=="pending_reply"; let bridge_path=path.clone();
        let (boot_tx,boot_rx)=std::sync::mpsc::channel();
        let bridge=std::thread::spawn(move || {
            for index in 0..if pending_reply {2}else{1} {
                let (mut socket,_)=listener.accept().unwrap(); socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut line=String::new(); StdReader::new(socket.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request:Value=serde_json::from_str(&line).unwrap(); assert_eq!(request["token"],"fixture");
                let value=if index==0 { assert_eq!(request["method"],"tools/list"); json!({"result":{"tools":[]}}) }
                    else {
                        assert_eq!(request["method"],"tools/call");
                        publish_closed_discovery(&bridge_path,"fixture","normal_shutdown").unwrap();
                        std::thread::sleep(Duration::from_millis(250));
                        json!({"result":{"content":[{"type":"text","text":"completed"}],"structuredContent":{"completed":true}}})
                    };
                socket.write_all(&response_bytes(&value,4096).unwrap()).unwrap();
                if index==0 { boot_tx.send(()).unwrap(); }
            }
        });
        let mut child=Command::new(std::env::current_exe().unwrap())
            .args(["--exact","control::tests::stdio_child_fixture","--nocapture"])
            .env("AIMOVIESTORAGE_STDIO_FIXTURE","1").env("AIMOVIESTORAGE_TEST_CONTROL_DIR",dir.path())
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let child_pid=child.id(); let started=std::time::Instant::now();
        let (tx,rx)=std::sync::mpsc::channel(); let stdout=child.stdout.take().unwrap();
        let reader=std::thread::spawn(move || { for line in StdReader::new(stdout).lines().map_while(Result::ok) { if let Some(start)=line.find('{') { if let Ok(value)=serde_json::from_str::<Value>(&line[start..]) { let _=tx.send(value); } } } });
        boot_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        if mode=="before_initialize" {
            std::thread::sleep(Duration::from_millis(150));
            publish_closed_discovery(&path,"fixture","normal_shutdown").unwrap();
        } else {
            writeln!(child.stdin.as_mut().unwrap(),"{}",json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cpu-fixture","version":"1"}}})).unwrap();
            let init=rx.recv_timeout(Duration::from_secs(5)).unwrap(); assert_eq!(init["id"],1);
            writeln!(child.stdin.as_mut().unwrap(),"{}",json!({"jsonrpc":"2.0","method":"notifications/initialized"})).unwrap();
            if pending_reply {
                writeln!(child.stdin.as_mut().unwrap(),"{}",json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fixture","arguments":{}}})).unwrap();
                let reply=rx.recv_timeout(Duration::from_secs(5)).unwrap(); assert_eq!(reply["id"],2); assert_eq!(reply["result"]["structuredContent"]["completed"],true);
            } else { drop(child.stdin.take()); }
        }
        let stdin_still_open=child.stdin.is_some(); let status=wait_own_child(&mut child);
        drop(child.stdin.take()); reader.join().unwrap(); bridge.join().unwrap();
        assert!(status.success());
        if mode!="eof" { assert!(stdin_still_open); }
        eprintln!("owned_stdio_cpu mode={mode} pid={child_pid} parent_pid={} elapsed_ms={} stdin_open_at_natural_exit={stdin_still_open} exit={} forced_kill=false",std::process::id(),started.elapsed().as_millis(),status.code().unwrap_or(-1));
    }
    #[test] fn own_stdio_eof_exits_naturally() { stdio_scenario("eof"); }
    #[test] fn normal_gui_close_before_initialize_does_not_wait_for_stdin() { stdio_scenario("before_initialize"); }
    #[test] fn normal_gui_close_preserves_pending_reply_then_self_exits() { stdio_scenario("pending_reply"); }
}

pub(crate) fn maintenance_pending(app: &tauri::AppHandle) -> usize {
    app.state::<ControlState>().pending.lock_safe().len() + MAINTENANCE_CONNECTIONS.load(std::sync::atomic::Ordering::SeqCst)
}
static MAINTENANCE_CONNECTIONS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
struct MaintenanceConnection;
impl Drop for MaintenanceConnection { fn drop(&mut self) { MAINTENANCE_CONNECTIONS.fetch_sub(1, std::sync::atomic::Ordering::SeqCst); } }
