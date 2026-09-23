//! 마그니픽 **MCP** 로 직접 뽑기.
//!
//!
//!
//! # 여태 길과 무엇이 다른가
//!
//! 여태는 마그니픽 **데스크톱 창**에 CDP 로 붙어 생성기를 «차려 놓기» 만 했습니다
//! (`magnific_cdp`). 뽑는 것은 사람이 그 창에서 눌렀고, 결과는 동기화 폴더로 돌아왔습니다.
//! «무제한» 이 웹앱 안에서만 적용되기 때문에 고른 길입니다(2026-09 조사).
//!
//! 이 모듈은 **끝까지 뽑습니다.** 사람 손이 한 번도 안 듭니다. 대신 건당 과금입니다 —
//! 라고 정했습니다. 두 길은 **함께 남습니다**: 손으로 골라 가며
//! 작업할 때는 창 쪽이, 밤새 통째로 돌릴 때는 이쪽이 맞습니다.
//!
//! # 붙는 방법
//!
//! `https://mcp.magnific.com` 은 **표준 원격 MCP 서버**입니다(claude.ai 를 거치지 않습니다).
//! 2026-09-17 에 직접 확인한 것:
//!
//! - 보호 자원 메타(`/.well-known/oauth-protected-resource`) → 인증 서버는
//! `https://auth.magnific.com/realms/mcp` (Keycloak).
//! - **익명 동적 등록**이 열려 있습니다(RFC 7591). 앱이 제 손으로 client_id 를 받습니다.
//! - **디바이스 코드 플로우**를 지원합니다. 데스크톱 앱에는 이게 제일 깔끔합니다 —
//! 되돌아올 localhost 서버를 띄울 필요가 없고, 사람은 브라우저에서 코드만 넣으면 됩니다.
//! - `offline_access` → 리프레시 토큰. 한 번 로그인하면 계속 갑니다.
//!
//! # 토큰은 어디에 두는가
//!
//! API 키와 **같은 자리**(`config_dir()/ai-video-storage/`)에 파일로 둡니다. 브라우저
//! localStorage 에 두면 개발자 도구에 그대로 보입니다.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

type Res<T> = Result<T, String>;

const MCP_URL: &str = "https://mcp.magnific.com";
const REALM: &str = "https://auth.magnific.com/realms/mcp";
/// 리프레시 토큰까지 받으려면 `offline_access` 가 있어야 합니다.
const SCOPE: &str = "openid profile email offline_access";

fn err(what: &str, e: impl std::fmt::Display) -> String {
    format!("{what}: {e}")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn store_path(name: &str) -> Res<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| "설정 폴더를 찾지 못했습니다.".to_string())?
        .join("ai-video-storage");
    fs::create_dir_all(&dir).map_err(|e| err("설정 폴더를 만들지 못했습니다", e))?;
    Ok(dir.join(name))
}

// ─────────────────────────────────────────────────────────────────────────────
// 저장해 두는 것
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    /// 동적 등록으로 받은 우리 앱의 client_id. 한 번 받으면 계속 씁니다.
    client_id: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    /// 접근 토큰이 죽는 시각(초). 만료 1분 전부터 미리 갱신합니다.
    expires_at: Option<u64>,
    /// 화면에 「누구로 연결됨」 을 적어 주려고.
    account: Option<String>,
}

fn read_saved() -> Saved {
    store_path("magnific-mcp.json")
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_saved(saved: &Saved) -> Res<()> {
    let path = store_path("magnific-mcp.json")?;
    let raw = serde_json::to_string_pretty(saved).map_err(|e| err("저장할 값을 만들지 못했습니다", e))?;
    fs::write(&path, raw).map_err(|e| err("연결 정보를 저장하지 못했습니다", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth
// ─────────────────────────────────────────────────────────────────────────────

fn http() -> Res<reqwest::Client> {
    reqwest::Client::builder()
        // 그림·영상을 받는 데 오래 걸립니다. 생성 자체는 MCP 가 기다려 주지 않고
        // 「만드는 중」 을 돌려주므로, 여기 시간은 한 번의 왕복만 덮으면 됩니다.
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| err("네트워크를 준비하지 못했습니다", e))
}

/// 우리 앱을 한 번 등록해 client_id 를 받습니다. 이미 있으면 그대로 씁니다.
async fn ensure_client_id(saved: &mut Saved) -> Res<String> {
    if let Some(id) = saved.client_id.clone() {
        return Ok(id);
    }
    let body = json!({
        "client_name": "FrameForge",
        "application_type": "native",
        "grant_types": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
        "response_types": ["code"],
        // 공개 클라이언트입니다 — 데스크톱 앱에 비밀을 숨길 자리가 없습니다.
        "token_endpoint_auth_method": "none",
    });
    let reply = http()?
        .post(format!("{REALM}/clients-registrations/openid-connect"))
        .json(&body)
        .send()
        .await
        .map_err(|e| err("마그니픽에 앱을 등록하지 못했습니다", e))?;
    let status = reply.status();
    let value: Value = reply
        .json()
        .await
        .map_err(|e| err("등록 결과를 읽지 못했습니다", e))?;
    if !status.is_success() {
        return Err(format!("마그니픽이 앱 등록을 거절했습니다({status}). {value}"));
    }
    let id = value
        .get("client_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "등록 결과에 client_id 가 없습니다.".to_string())?
        .to_string();
    saved.client_id = Some(id.clone());
    write_saved(saved)?;
    Ok(id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogin {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    /// 코드가 이미 박힌 주소. 있으면 이걸 열어 주는 쪽이 친절합니다.
    pub verification_uri_complete: Option<String>,
    pub interval: u64,
}

/// 로그인을 시작합니다. 사람은 브라우저에서 코드를 넣습니다.
#[tauri::command]
pub async fn magnific_login_start() -> Res<DeviceLogin> {
    let mut saved = read_saved();
    let client_id = ensure_client_id(&mut saved).await?;
    let reply = http()?
        .post(format!("{REALM}/protocol/openid-connect/auth/device"))
        .form(&[("client_id", client_id.as_str()), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| err("로그인을 시작하지 못했습니다", e))?;
    let status = reply.status();
    let value: Value = reply
        .json()
        .await
        .map_err(|e| err("로그인 시작 결과를 읽지 못했습니다", e))?;
    if !status.is_success() {
        return Err(format!("마그니픽이 로그인을 거절했습니다({status}). {value}"));
    }
    Ok(DeviceLogin {
        device_code: value
            .get("device_code")
            .and_then(|v| v.as_str())
            .ok_or("device_code 가 없습니다.")?
            .to_string(),
        user_code: value
            .get("user_code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        verification_uri: value
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        verification_uri_complete: value
            .get("verification_uri_complete")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        // 너무 자주 물으면 서버가 «천천히» 라고 합니다. 기본 5초.
        interval: value.get("interval").and_then(|v| v.as_u64()).unwrap_or(5),
    })
}

/// 기본 브라우저로 주소를 엽니다.
///
/// 웹뷰의 `window.open` 은 Tauri 안에서 막혀 있습니다 —
/// 앱 안에서 열어서도 안 됩니다: 로그인 쿠키가 따로 놀아 **매번 다시 로그인**하게 됩니다.
///
/// `cmd /C start` 는 `&` 를 셸이 먹어 주소가 잘립니다(OAuth 주소에는 `&` 가 늘 있습니다).
/// `rundll32 url.dll,FileProtocolHandler` 는 주소를 **인자 하나로** 그대로 넘깁니다.
#[tauri::command]
pub fn open_external(url: String) -> Res<()> {
    // 우리가 만든 인증 주소만 엽니다. 다른 것을 열 일도, 열어 줄 이유도 없습니다.
    if !url.starts_with("https://") {
        return Err("https 주소만 엽니다.".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| err("브라우저를 열지 못했습니다", e))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
            .arg(&url)
            .spawn()
            .map_err(|e| err("브라우저를 열지 못했습니다", e))?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPoll {
    /// 아직 사람이 브라우저에서 안 눌렀는가.
    pub pending: bool,
    pub connected: bool,
}

/// 사람이 브라우저에서 허락했는지 한 번 물어봅니다.
#[tauri::command]
pub async fn magnific_login_poll(device_code: String) -> Res<LoginPoll> {
    let mut saved = read_saved();
    let client_id = ensure_client_id(&mut saved).await?;
    let reply = http()?
        .post(format!("{REALM}/protocol/openid-connect/token"))
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code.as_str()),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| err("로그인을 확인하지 못했습니다", e))?;
    let status = reply.status();
    let value: Value = reply
        .json()
        .await
        .map_err(|e| err("로그인 결과를 읽지 못했습니다", e))?;

    if status.is_success() {
        keep_tokens(&mut saved, &value)?;
        return Ok(LoginPoll { pending: false, connected: true });
    }
    match value.get("error").and_then(|v| v.as_str()) {
        // 아직 안 눌렀거나, 너무 자주 물었습니다. 둘 다 «기다리는 중» 입니다.
        Some("authorization_pending") | Some("slow_down") => {
            Ok(LoginPoll { pending: true, connected: false })
        }
        Some("expired_token") => Err("로그인 시간이 지났습니다. 다시 «연결» 을 눌러 주세요.".into()),
        Some("access_denied") => Err("브라우저에서 거절했습니다.".into()),
        _ => Err(format!("로그인에 실패했습니다. {value}")),
    }
}

fn keep_tokens(saved: &mut Saved, value: &Value) -> Res<()> {
    saved.access_token = value
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(refresh) = value.get("refresh_token").and_then(|v| v.as_str()) {
        saved.refresh_token = Some(refresh.to_string());
    }
    let lives = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(300);
    saved.expires_at = Some(now() + lives);
    write_saved(saved)
}

/// 쓸 수 있는 접근 토큰. 만료가 가까우면 조용히 갱신합니다.
async fn access_token() -> Res<String> {
    let mut saved = read_saved();
    let fresh = saved
        .expires_at
        .map(|at| at > now() + 60)
        .unwrap_or(false);
    if fresh {
        if let Some(token) = saved.access_token.clone() {
            return Ok(token);
        }
    }
    let refresh = saved
        .refresh_token
        .clone()
        .ok_or_else(|| "마그니픽에 연결되어 있지 않습니다. 설정에서 «연결» 을 눌러 주세요.".to_string())?;
    let client_id = ensure_client_id(&mut saved).await?;
    let reply = http()?
        .post(format!("{REALM}/protocol/openid-connect/token"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| err("연결을 이어 가지 못했습니다", e))?;
    if !reply.status().is_success() {
        /*
          리프레시까지 죽었으면 다시 로그인하는 수밖에 없습니다. **토큰만 지우고
          client_id 는 남깁니다** — 등록을 되풀이할 이유가 없습니다.
        */
        saved.access_token = None;
        saved.refresh_token = None;
        saved.expires_at = None;
        let _ = write_saved(&saved);
        return Err("마그니픽 연결이 끊겼습니다. 설정에서 다시 «연결» 을 눌러 주세요.".into());
    }
    let value: Value = reply
        .json()
        .await
        .map_err(|e| err("갱신 결과를 읽지 못했습니다", e))?;
    keep_tokens(&mut saved, &value)?;
    saved
        .access_token
        .clone()
        .ok_or_else(|| "새 토큰을 받지 못했습니다.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub connected: bool,
    pub account: Option<String>,
}

#[tauri::command]
pub fn magnific_status() -> McpStatus {
    let saved = read_saved();
    McpStatus {
        connected: saved.refresh_token.is_some(),
        account: saved.account,
    }
}

#[tauri::command]
pub fn magnific_logout() -> Res<()> {
    let mut saved = read_saved();
    saved.access_token = None;
    saved.refresh_token = None;
    saved.expires_at = None;
    saved.account = None;
    write_saved(&saved)
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP — 도구 부르기
// ─────────────────────────────────────────────────────────────────────────────

/// JSON-RPC 한 번. 답이 SSE 로 와도 읽습니다.
///
/// 스트리머블 HTTP 는 같은 주소에 POST 하고, 서버가 `application/json` 이나
/// `text/event-stream` 중 편한 쪽으로 답합니다. 후자면 `data:` 줄에 JSON 이 들어 있습니다.
async fn rpc(token: &str, session: Option<&str>, body: Value) -> Res<Value> {
    let mut request = http()?
        .post(MCP_URL)
        .bearer_auth(token)
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", "2025-06-18")
        .json(&body);
    if let Some(id) = session {
        request = request.header("Mcp-Session-Id", id);
    }
    let reply = request
        .send()
        .await
        .map_err(|e| err("마그니픽에 말을 걸지 못했습니다", e))?;
    let status = reply.status();
    let session_id = reply
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let text = reply
        .text()
        .await
        .map_err(|e| err("마그니픽의 답을 읽지 못했습니다", e))?;
    if !status.is_success() {
        return Err(format!("마그니픽이 거절했습니다({status}). {text}"));
    }
    let mut value: Value = if text.trim_start().starts_with("event:") || text.contains("\ndata:") || text.starts_with("data:") {
        /*
          SSE 는 한 응답에 `data:` 줄이 여럿일 수 있습니다 — 서버가 «진행 중» 알림을 먼저
          흘리고 그 뒤에 진짜 답을 보냅니다. 첫 줄을 집으면 알림을 답으로 읽습니다. 그래서
          `result` 나 `error` 가 든 줄(JSON-RPC 답)을 먼저 찾고, 없을 때만 첫 줄을 씁니다.
        */
        let lines: Vec<&str> = text
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && *l != "[DONE]")
            .collect();
        let line = lines
            .iter()
            .find(|l| l.contains("\"result\"") || l.contains("\"error\""))
            .or_else(|| lines.first())
            .copied()
            .ok_or_else(|| "답에 내용이 없습니다.".to_string())?;
        serde_json::from_str(line).map_err(|e| err("답을 풀지 못했습니다", e))?
    } else if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).map_err(|e| err("답을 풀지 못했습니다", e))?
    };
    if let Some(error) = value.get("error") {
        return Err(format!("마그니픽: {}", error));
    }
    if let (Value::Object(map), Some(id)) = (&mut value, session_id) {
        map.insert("__session".into(), Value::String(id));
    }
    Ok(value)
}

/// 한 번의 대화 — 악수하고, 도구를 부르고, 끝냅니다.
///
/// 세션을 오래 들고 있지 않는 까닭: 생성 하나에 몇 분씩 걸리고 그 사이 앱이 다른 일을
/// 합니다. 세션을 붙잡아 두면 끊겼을 때 어디가 끊겼는지 알기 어려워집니다. 악수는 한 번에
/// 한 왕복이라 값이 싸요.
async fn call_tool(tool: &str, args: Value) -> Res<Value> {
    let token = access_token().await?;
    let hello = rpc(
        &token,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "FrameForge", "version": "0.1.0" },
            },
        }),
    )
    .await?;
    let session = hello
        .get("__session")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 규약대로 «준비됐다» 를 한 번 보냅니다. 답이 없는 알림입니다.
    let _ = rpc(
        &token,
        session.as_deref(),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    )
    .await;

    let reply = rpc(
        &token,
        session.as_deref(),
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": tool, "arguments": args },
        }),
    )
    .await?;

    let result = reply.get("result").cloned().unwrap_or(Value::Null);
    if result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Err(format!("마그니픽 «{tool}» 이(가) 실패했습니다. {}", text_of(&result)));
    }
    Ok(result)
}

/// 도구가 돌려준 글. 구조화된 값이 있으면 그쪽이 먼저입니다.
fn text_of(result: &Value) -> String {
    result
        .get("content")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// 도구 결과를 **JSON 하나**로 풀어 줍니다.
///
/// MCP 는 `structuredContent` 를 주기도 하고 글 안에 JSON 을 넣어 주기도 합니다. 둘 다
/// 받아 줍니다 — 서버가 어느 쪽으로 답할지 우리가 못 정합니다.
fn payload_of(result: &Value) -> Value {
    if let Some(structured) = result.get("structuredContent") {
        if !structured.is_null() {
            return structured.clone();
        }
    }
    let text = text_of(result);
    serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text))
}

/// 화면에서 아무 도구나 부를 수 있는 통로. 연결 확인에도 씁니다.
#[tauri::command]
pub async fn magnific_call(tool: String, args: Option<Value>) -> Res<Value> {
    let result = call_tool(&tool, args.unwrap_or_else(|| json!({}))).await?;
    Ok(payload_of(&result))
}

/// 붙었는지 한 번 확인 — 도구 목록을 물어봅니다. 아무것도 만들지 않습니다.
#[tauri::command]
pub async fn magnific_check() -> Res<usize> {
    let token = access_token().await?;
    let hello = rpc(
        &token,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "FrameForge", "version": "0.1.0" },
            },
        }),
    )
    .await?;
    let session = hello.get("__session").and_then(|v| v.as_str()).map(|s| s.to_string());
    let _ = rpc(
        &token,
        session.as_deref(),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    )
    .await;
    let list = rpc(
        &token,
        session.as_deref(),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
    )
    .await?;
    Ok(list
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .map(|a| a.len())
        .unwrap_or(0))
}

// ─────────────────────────────────────────────────────────────────────────────
// 올리고 · 뽑고 · 내려받기
// ─────────────────────────────────────────────────────────────────────────────

fn mime_of(path: &str) -> Res<&'static str> {
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // 잘못된 종류로 자리를 받으면 파일 바이트가 맞아도 마지막 등록에서 거절됩니다.
    // 모르는 형식을 JPEG로 보내지 않고, 서버가 허용하는 종류만 명시합니다.
    let mime = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "m4v" => "video/x-m4v",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "glb" => "model/gltf-binary",
        _ => return Err("마그니픽에 올릴 수 없는 파일 형식입니다. 파일 확장자를 확인해 주세요.".into()),
    };
    Ok(mime)
}

/// 우리 폴더의 파일을 마그니픽에 올리고 **creation id** 를 받습니다.
///
/// 레퍼런스는 id 로만 겁니다 — 「첨부한 그림」 같은 말로는 아무것도 안 걸립니다.
/// 세 걸음입니다: 자리 받기(presigned PUT) → 바이트 올리기 → creation 으로 굳히기.
#[tauri::command]
pub async fn magnific_upload(path: String) -> Res<String> {
    let mime = mime_of(&path)?;
    let bytes = fs::read(&path).map_err(|e| err("올릴 파일을 읽지 못했습니다", e))?;
    let asked = call_tool("creations_request_upload", json!({ "mimeType": mime })).await?;
    let asked = payload_of(&asked);
    /*
      답의 모양이 `{uploads:[{url,path}]}` 이거나 `{url,path}` 입니다. 서버가 어느 쪽으로
      줄지 우리가 못 정하므로 둘 다 받습니다.
    */
    let one = asked
        .get("uploads")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .cloned()
        .unwrap_or(asked.clone());
    /*
      주소 칸의 이름이 `proxyUploadUrl` 입니다(2026-09-17 에 실제 답을 받아 확인).
      `url` 만 보고 있었더니 「올릴 자리를 받지 못했습니다」 로 죽었습니다. 서버가
      이름을 바꿀 여지를 두고 셋을 다 봅니다.
    */
    let put = one
        .get("proxyUploadUrl")
        .or_else(|| one.get("uploadUrl"))
        .or_else(|| one.get("url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("올릴 자리를 받지 못했습니다. {asked}"))?
        .to_string();
    let temp = one
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("올릴 자리의 경로가 없습니다. {asked}"))?
        .to_string();

    let put_reply = http()?
        .put(&put)
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .await
        .map_err(|e| err("파일을 올리지 못했습니다", e))?;
    if !put_reply.status().is_success() {
        return Err(format!("파일 올리기를 거절당했습니다({}).", put_reply.status()));
    }

    let made = call_tool(
        "creations_finalize_upload",
        // 작업용이라 라이브러리에는 안 보이게 둡니다 — 우리 폴더가 원본을 들고 있습니다.
        json!({ "path": temp, "visible": false }),
    )
    .await?;
    identifier_of(&payload_of(&made))
        .ok_or_else(|| "올린 파일의 id 를 받지 못했습니다.".to_string())
}

#[cfg(test)]
mod upload_mime_tests {
    use super::*;

    #[test]
    fn uploads_audio_with_its_real_media_type_instead_of_jpeg() {
        for (file, expected) in [
            ("노래.구간.WAV", "audio/wav"),
            ("song.mp3", "audio/mpeg"),
            ("song.M4A", "audio/mp4"),
            ("song.ogg", "audio/ogg"),
            ("song.flac", "audio/flac"),
        ] {
            assert_eq!(mime_of(file).unwrap(), expected, "{file}");
        }
    }

    #[test]
    fn keeps_supported_visual_media_types_and_gltf_binary_distinct() {
        for (file, expected) in [
            ("face.jpg", "image/jpeg"),
            ("face.JPEG", "image/jpeg"),
            ("face.png", "image/png"),
            ("face.webp", "image/webp"),
            ("outline.svg", "image/svg+xml"),
            ("dance.mp4", "video/mp4"),
            ("dance.mov", "video/quicktime"),
            ("dance.webm", "video/webm"),
            ("dance.m4v", "video/x-m4v"),
            ("character.glb", "model/gltf-binary"),
        ] {
            assert_eq!(mime_of(file).unwrap(), expected, "{file}");
        }
    }

    #[test]
    fn rejects_unknown_and_extensionless_names_without_guessing_from_directories() {
        for file in ["song.aac", "file", "folder.wav/file", ".wav", "file.", "song.wav.exe", ""] {
            assert!(mime_of(file).is_err(), "{file}");
        }
    }

    #[tokio::test]
    async fn rejects_unsupported_upload_before_file_read_or_network() {
        let error = magnific_upload("존재하지 않는 폴더/원본.unsupported".into()).await.unwrap_err();
        assert!(error.contains("파일 형식"));
        assert!(!error.contains("읽지 못했습니다"));
    }
}

/// 글 안에서 `키: 값` 을 집어냅니다 — 마그니픽이 JSON 대신 TOON 글로 답할 때.
fn from_text(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (head, tail) = line.split_once(':')?;
        if head.trim().trim_start_matches("- ") != key {
            return None;
        }
        let value = tail.trim().trim_matches('"').trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/**
답 **어디에 묻혀 있든** 찾아냅니다.

2026-09-17 에 — 그림은 마그니픽에 멀쩡히 만들어져
있는데(`status: completed`) 우리가 못 집어 왔습니다. 기다리기 답이 이렇게 옵니다.

```json
{"results":[{"identifier":"…","status":"completed","results":{"url":"…"}}]}
```

`results` 가 **두 번** 나오는데 바깥은 배열, 안쪽은 객체입니다. 앞서 쓴 코드는 배열만
파고들어서, 안쪽 객체에 있는 주소를 끝내 못 찾고 마흔 번을 헛돌았습니다.

그래서 이제 **객체든 배열이든 가리지 않고** 내려갑니다. 서버가 한 겹을 더 씌워도
버티라는 뜻입니다 — 어느 칸에 넣을지는 우리가 정하는 것이 아닙니다.
*/
fn find_str(value: &Value, keys: &[&str], want_url: bool, depth: usize) -> Option<String> {
    if depth > 6 {
        return None;
    }
    let ok = |found: &str| !found.is_empty() && (!want_url || found.starts_with("http"));
    match value {
        Value::Object(map) => {
            // 제 칸을 먼저 봅니다 — 깊은 곳의 엉뚱한 같은 이름보다 가까운 것이 맞습니다.
            for key in keys {
                if let Some(found) = map.get(*key).and_then(|v| v.as_str()) {
                    if ok(found) {
                        return Some(found.to_string());
                    }
                }
            }
            map.values().find_map(|item| find_str(item, keys, want_url, depth + 1))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_str(item, keys, want_url, depth + 1)),
        // TOON 글로 답한 경우.
        Value::String(text) => keys
            .iter()
            .find_map(|key| from_text(text, key))
            .filter(|found| ok(found)),
        _ => None,
    }
}

fn identifier_of(value: &Value) -> Option<String> {
    find_str(value, &["identifier", "creationIdentifier", "id"], false, 0)
}

fn url_of(value: &Value) -> Option<String> {
    // 영상의 url은 1080p 미리보기일 수 있습니다. 따로 제공된 원본을 저장해야 요청한 품질을 잃지 않습니다.
    find_str(value, &["downloadUrl"], true, 0)
        .or_else(|| find_str(value, &["url", "assetUrl"], true, 0))
}

/// 뽑으라고 시키고 **creation id** 를 받습니다. 기다리지는 않습니다.
#[tauri::command]
pub async fn magnific_generate(kind: String, args: Value) -> Res<String> {
    Ok(magnific_generate_details(kind, args).await?.identifier)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationDetails {
    pub identifier: String,
    /// 서버 접수 결과입니다. 파일에서 측정한 크기·길이와 같다고 가정하지 않습니다.
    pub response: Value,
}

async fn generate_with<F, Fut>(kind: String, args: Value, call: F) -> Res<GenerationDetails>
where
    F: FnOnce(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Res<Value>>,
{
    let tool = match kind.as_str() {
        "video" => "video_generate",
        "image" => "images_generate",
        _ => return Err("지원하지 않는 마그니픽 생성 종류입니다.".into()),
    };
    // 구형 문자열 명령과 상세 명령이 이 호출 한 번을 공유합니다. 응답 해석 실패로 다시 생성하지 않습니다.
    let response = payload_of(&call(tool, args).await?);
    let identifier = identifier_of(&response)
        .ok_or_else(|| format!("«{tool}» 이 결과 id 를 주지 않았습니다. 생성 여부를 마그니픽에서 확인해 주세요."))?;
    Ok(GenerationDetails { identifier, response })
}

/// 기존 문자열 명령은 유지하고 새 화면은 모델 변경 안내까지 받습니다.
#[tauri::command]
pub async fn magnific_generate_details(kind: String, args: Value) -> Res<GenerationDetails> {
    generate_with(kind, args, call_tool).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitResult {
    /// 다 됐는가. 거짓이면 조금 뒤에 다시 물으면 됩니다.
    pub done: bool,
    pub url: Option<String>,
    pub failed: bool,
    pub message: Option<String>,
    pub response: Value,
}

/// 다 됐는지 한 번 물어봅니다(최대 25초까지 붙잡고 기다립니다).
#[tauri::command]
pub async fn magnific_wait(identifier: String) -> Res<WaitResult> {
    let made = call_tool(
        "creations_wait",
        json!({ "identifiers": [identifier], "timeoutSeconds": 25 }),
    )
    .await?;
    let value = payload_of(&made);
    let url = url_of(&value);
    let text = format!("{value}");
    /*
      끝났는지는 **주소가 나왔는지**로 봅니다. 상태 글자는 도구마다 다르지만, 내려받을
      주소가 있으면 그것이 곧 «다 됐다» 입니다. 실패는 상태 칸으로 따로 봅니다 —
      글 전체에서 «error» 를 찾으면 프롬프트에 그 낱말만 있어도 실패로 읽힙니다.
    */
    let status = find_str(&value, &["status", "state"], false, 0).unwrap_or_default();
    let failed = matches!(status.as_str(), "failed" | "error" | "cancelled" | "canceled");
    Ok(WaitResult {
        done: url.is_some() || failed,
        url,
        failed,
        // 실패했을 때만 답을 통째로 붙입니다 — 까닭이 그 안에 있습니다.
        message: if failed { Some(text) } else { None },
        response: value,
    })
}

/// 다 된 결과를 우리 폴더로 내려받습니다.
#[tauri::command]
pub async fn magnific_download(url: String, output_path: String) -> Res<String> {
    let reply = http()?
        .get(&url)
        .send()
        .await
        .map_err(|e| err("결과를 내려받지 못했습니다", e))?;
    if !reply.status().is_success() {
        return Err(format!("결과를 내려받지 못했습니다({}).", reply.status()));
    }
    let bytes = reply
        .bytes()
        .await
        .map_err(|e| err("결과를 읽지 못했습니다", e))?;
    if let Some(parent) = PathBuf::from(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|e| err("놓을 폴더를 만들지 못했습니다", e))?;
    }
    fs::write(&output_path, &bytes).map_err(|e| err("결과를 저장하지 못했습니다", e))?;
    Ok(output_path)
}

// ─────────────────────────────────────────────────────────────────────────────
// 마그니픽에 이미 있는 것 가져오기
// ─────────────────────────────────────────────────────────────────────────────

/// TOON 목록을 읽습니다 — `items[N]:` 아래 `- key: value` 줄들.
///
/// 이미 값을 치르고 뽑아 둔 그림을 끌어오는 길입니다. 폴링이
/// 어긋나 못 집어 온 것들이 마그니픽에 그대로 남아 있어서, 다시 뽑으면 같은 값을 두 번 냅니다.
///
/// 마그니픽은 도구마다 JSON 으로도, **TOON 글**로도 답합니다. 목록 쪽은 글입니다. 생김새가
/// YAML 을 닮아서 **깊이로 가릅니다** — 한 건은 「2칸 + `- `」 에서 시작하고 그 칸은 정확히
/// 4칸입니다. 더 깊은 것(`metadata` 속)까지 읽으면 `prompt` 같은 것이 위로 새어 듭니다.
fn toon_items(text: &str) -> Vec<serde_json::Map<String, Value>> {
    let mut out: Vec<serde_json::Map<String, Value>> = Vec::new();
    let clean = |raw: &str| raw.trim().trim_matches('"').trim().to_string();
    for line in text.lines() {
        let indent = line.len() - line.trim_start().len();
        let body = line.trim_start();
        if indent == 2 && body.starts_with("- ") {
            out.push(serde_json::Map::new());
            if let Some((key, value)) = body[2..].split_once(':') {
                if let Some(item) = out.last_mut() {
                    item.insert(clean(key), Value::String(clean(value)));
                }
            }
            continue;
        }
        if indent == 4 {
            if let Some((key, value)) = body.split_once(':') {
                if let Some(item) = out.last_mut() {
                    item.insert(clean(key), Value::String(clean(value)));
                }
            }
        }
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Creation {
    pub identifier: String,
    pub name: String,
    pub url: String,
    pub thumbnail_url: String,
    pub tool: String,
    pub status: String,
    pub created_at: String,
}

/// 마그니픽에 만들어 둔 것들 — 새 것부터.
#[tauri::command]
pub async fn magnific_recent(limit: Option<u32>, query: Option<String>) -> Res<Vec<Creation>> {
    let mut args = json!({ "limit": limit.unwrap_or(24), "full": true });
    if let Some(query) = query.as_ref().filter(|q| !q.trim().is_empty()) {
        args["query"] = json!(query.trim());
    }
    let made = call_tool("creations_search", args).await?;
    let payload = payload_of(&made);

    /*
      글로 오면 TOON 으로, 객체로 오면 그대로 읽습니다. 어느 쪽으로 답할지 우리가 못
      정하므로 둘 다 받습니다 — 모델 목록에서 한 번 데인 자리입니다.
    */
    let rows: Vec<serde_json::Map<String, Value>> = match &payload {
        Value::String(text) => toon_items(text),
        other => other
            .get("items")
            .or_else(|| other.get("results"))
            .and_then(|v| v.as_array())
            .map(|items| items.iter().filter_map(|item| item.as_object().cloned()).collect())
            .unwrap_or_default(),
    };

    let field = |row: &serde_json::Map<String, Value>, key: &str| {
        row.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
    };
    Ok(rows
        .into_iter()
        .map(|row| {
            let thumb = field(&row, "thumbnailUrl");
            Creation {
                identifier: field(&row, "identifier"),
                name: field(&row, "name"),
                url: field(&row, "url"),
                thumbnail_url: if thumb.is_empty() { field(&row, "previewUrl") } else { thumb },
                tool: field(&row, "tool"),
                status: field(&row, "status"),
                created_at: field(&row, "createdAt"),
            }
        })
        // 아직 만드는 중인 것은 내려받을 주소가 없습니다.
        .filter(|item| !item.identifier.is_empty() && item.url.starts_with("http"))
        .collect())
}

// ─────────────────────────────────────────────────────────────────────────────
// 실제 마그니픽에 붙어 한 바퀴 돌려 보는 시험
// ─────────────────────────────────────────────────────────────────────────────

/*
  **`#[ignore]` 인 까닭**: 이 시험은 진짜 마그니픽에 그림을 올리고 `images_generate` 를
  부릅니다 — **건당 과금**입니다. 평범한 `cargo test` 가 돌 때마다 돈이 나가면 안 되므로
  일부러 빼 두고, 확인이 필요할 때만 사람이 손으로 켭니다.

      cargo test --lib magnific_mcp::live_tests -- --ignored --nocapture

  토큰은 앱이 설정 폴더에 둔 것(`magnific-mcp.json`)을 그대로 읽습니다. 연결이 안 돼
  있으면 첫 걸음에서 「연결되어 있지 않습니다」 로 멈춥니다.
*/
#[cfg(test)]
mod generation_metadata_tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn downloads_original_video_and_falls_back_for_images() {
        let video = json!({"results":[{"status":"completed","results":{
            "url":"https://example.com/preview.mp4",
            "downloadUrl":"https://example.com/original.mp4",
            "thumbnailUrl":"https://example.com/thumbnail.jpg"
        }}]});
        assert_eq!(url_of(&video).as_deref(), Some("https://example.com/original.mp4"));
        assert_eq!(url_of(&json!({"url":"https://example.com/preview.mp4","results":{"downloadUrl":"https://example.com/original.mp4"}})).as_deref(), Some("https://example.com/original.mp4"));
        assert_eq!(url_of(&json!({"results":{"url":"https://example.com/render.png"}})).as_deref(), Some("https://example.com/render.png"));
        assert_eq!(url_of(&Value::String("url: https://example.com/preview.mp4\ndownloadUrl: https://example.com/original.mp4".into())).as_deref(), Some("https://example.com/original.mp4"));
    }

    #[tokio::test]
    async fn generates_once_and_keeps_server_adjustment_metadata() {
        let calls = Cell::new(0);
        let response = json!({"identifier":"one", "modelNotice":"비율 조정", "models":[{"requested":"2:1", "accepted":"16:9"}]});
        let result = generate_with("image".into(), json!({"aspectRatio":"2:1"}), |tool, args| {
            calls.set(calls.get() + 1);
            assert_eq!(tool, "images_generate");
            assert_eq!(args["aspectRatio"], "2:1");
            let payload = response.clone();
            async move { Ok(json!({"structuredContent":payload})) }
        }).await.unwrap();
        assert_eq!(calls.get(), 1);
        assert_eq!(result.identifier, "one");
        assert_eq!(result.response, response);
    }

    #[tokio::test]
    async fn preserves_toon_and_does_not_retry_a_missing_identifier() {
        let toon = "identifier: video-one\nmodelNotice: 길이 조정\nmodels[1]{slug,duration}:\n  sample,5";
        let result = generate_with("video".into(), json!({}), |tool, _| async move {
            assert_eq!(tool, "video_generate");
            Ok(json!({"content":[{"type":"text","text":toon}]}))
        }).await.unwrap();
        assert_eq!(result.identifier, "video-one");
        assert_eq!(result.response, Value::String(toon.into()));
        let calls = Cell::new(0);
        let failed = generate_with("image".into(), json!({}), |_, _| {
            calls.set(calls.get() + 1);
            async { Ok(json!({"structuredContent":{"modelNotice":"접수 상태 확인 필요"}})) }
        }).await;
        assert!(failed.is_err());
        assert_eq!(calls.get(), 1);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 시험에 쓸 그림. 정해 둔 파일이 없으면 같은 폴더에서 10KB 넘는 png 아무거나.
    fn sample_image() -> String {
        let fixed = "D:/저장소/안경홍보/character/강아지/강아지_마그니픽_001.png";
        if fs::metadata(fixed).map(|m| m.len() >= 10 * 1024).unwrap_or(false) {
            return fixed.to_string();
        }
        let dir = PathBuf::from(fixed).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        fs::read_dir(&dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| {
                path.extension().map(|e| e.eq_ignore_ascii_case("png")).unwrap_or(false)
                    && fs::metadata(path).map(|m| m.len() >= 10 * 1024).unwrap_or(false)
            })
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| fixed.to_string())
    }

    fn head(text: &str, n: usize) -> String {
        text.chars().take(n).collect()
    }

    /// 올리기 → 뽑기(한 번만) → 기다리기 → 내려받기.
    ///
    /// `images_generate` 는 **딱 한 번**만 부릅니다. 실패해도 되풀이하지 않습니다 — 과금.
    /// 모델·해상도는 넣지 않습니다: 마그니픽이 제일 싼 기본으로 고릅니다.
    #[tokio::test]
    #[ignore]
    async fn round_trip() {
        let image = sample_image();
        eprintln!("[round_trip] 올릴 그림: {image} ({} bytes)", fs::metadata(&image).map(|m| m.len()).unwrap_or(0));

        // a. 올리기
        let uploaded = magnific_upload(image.clone())
            .await
            .unwrap_or_else(|e| panic!("올리기 실패: {e}"));
        eprintln!("[round_trip] 올린 creation id: {uploaded}");
        assert!(!uploaded.is_empty(), "올린 id 가 비었습니다");

        // b. 뽑기 — 단 한 번
        let args = json!({
            "prompt": "a simple gray studio background, one small red cube, photo",
            "aspectRatio": "1:1",
            "count": 1,
            "references": [{ "type": "image", "identifier": uploaded }],
        });
        let made = magnific_generate("image".into(), args)
            .await
            .unwrap_or_else(|e| panic!("뽑기 실패: {e}"));
        eprintln!("[round_trip] 뽑기 creation id: {made}");
        assert!(!made.is_empty(), "뽑은 id 가 비었습니다");

        // c. 기다리기 — 한 번에 최대 25초, 스무 번까지
        let mut url: Option<String> = None;
        for round in 1..=20 {
            let waited = magnific_wait(made.clone())
                .await
                .unwrap_or_else(|e| panic!("기다리기 {round}번째 실패: {e}"));
            eprintln!(
                "[round_trip] 기다리기 {round}: done={} failed={} url={}",
                waited.done,
                waited.failed,
                waited.url.as_deref().map(|u| head(u, 80)).unwrap_or_default()
            );
            if waited.failed {
                panic!("마그니픽이 실패로 답했습니다: {}", waited.message.unwrap_or_default());
            }
            if waited.done {
                url = waited.url;
                break;
            }
        }
        let url = url.expect("스무 번을 기다려도 결과 주소가 오지 않았습니다");
        eprintln!("[round_trip] 결과 주소(앞 80자): {}", head(&url, 80));

        // d. 내려받기
        let output = std::env::temp_dir()
            .join("frameforge-test")
            .join("round_trip.png")
            .to_string_lossy()
            .replace('\\', "/");
        let saved = magnific_download(url, output.clone())
            .await
            .unwrap_or_else(|e| panic!("내려받기 실패: {e}"));
        assert_eq!(saved, output);

        // e. 크기·시그니처
        let bytes = fs::read(&saved).unwrap_or_else(|e| panic!("받은 파일을 읽지 못했습니다: {e}"));
        eprintln!("[round_trip] 받은 파일: {saved} ({} bytes)", bytes.len());
        assert!(bytes.len() >= 10 * 1024, "받은 파일이 10KB 미만입니다: {} bytes", bytes.len());
        assert_eq!(&bytes[..4], &[0x89, 0x50, 0x4E, 0x47], "PNG 시그니처가 아닙니다: {:02X?}", &bytes[..4.min(bytes.len())]);
    }
}
