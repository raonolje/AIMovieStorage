//! 외부 ComfyUI 생성. 모델·노드 번호를 추측하지 않고 사용자가 고른 API 그래프의 입력만 바꿉니다.
use std::{collections::HashSet, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path,PathBuf}, time::Duration};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::{comfy::{comfy_base, comfy_net_err}, ensure_inside, err, owner_dir, project_root, safe_name, Res};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputBinding {
    pub node_id: String,
    pub input: String,
    pub value: Option<Value>,
    pub file_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitRequest {
    pub base_url: String,
    pub workflow_path: String,
    pub bindings: Vec<InputBinding>,
    /// 같은 제출을 재시도하지 않습니다. 응답이 끊기면 이 값으로 서버 기록부터 확인합니다.
    pub client_id: String,
    pub expected_workflow_sha256: String,
    #[serde(default)]
    pub admission_token: Option<String>,
}

pub(crate) fn client(base_url: &str) -> Res<(String, reqwest::Client)> {
    let base = comfy_base(base_url);
    let parsed = reqwest::Url::parse(&base).map_err(|_| "ComfyUI 주소가 올바르지 않습니다.")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none()
        || !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("ComfyUI 주소는 계정 정보·쿼리가 없는 HTTP 또는 HTTPS 주소여야 합니다.".into());
    }
    if parsed.scheme() != "http" || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1")) || parsed.path() != "/" {
        return Err("Comfy workflow는 인증 정보 없는 loopback HTTP 서버만 사용합니다.".into());
    }
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30)).no_proxy().redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| err("ComfyUI 연결을 준비하지 못했습니다", e))?;
    Ok((base, client))
}

async fn response_json(mut response: reqwest::Response, label: &str) -> Res<Value> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| err(label, e))? {
        if bytes.len() + chunk.len() > 32 * 1024 * 1024 { return Err(format!("{label}: 응답은 32MB 이하여야 합니다.")); }
        bytes.extend_from_slice(&chunk);
    }
    let text = String::from_utf8(bytes).map_err(|e|err(label,e))?;
    if !status.is_success() {
        return Err(format!("{label} ({status}): {}", text.chars().take(600).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|e| err(label, e))
}

fn checked_workflow(path: &str) -> Res<(serde_json::Map<String, Value>, String)> {
    let mut bytes = Vec::new();
    File::open(path).map_err(|e| err("워크플로 파일을 열지 못했습니다", e))?.take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes).map_err(|e| err("워크플로 파일을 읽지 못했습니다", e))?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("워크플로 JSON 은 8 MB 이하여야 합니다.".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| err("워크플로 JSON 을 읽지 못했습니다", e))?;
    let graph = value.as_object().ok_or("워크플로 JSON 의 맨 바깥이 객체가 아닙니다.")?.clone();
    if graph.contains_key("nodes") && graph.contains_key("links") { return Err("일반 저장 JSON 입니다. Save (API Format) 로 다시 저장하세요.".into()); }
    if graph.is_empty() || graph.len() > 2000 || graph.iter().any(|(id, node)| id.is_empty()
        || node.get("class_type").and_then(Value::as_str).filter(|v| !v.is_empty()).is_none()
        || node.get("inputs").and_then(Value::as_object).is_none()) {
        return Err("각 노드에 class_type 과 inputs 가 있는 API 형식 워크플로가 필요합니다.".into());
    }
    Ok((graph, format!("{:x}", Sha256::digest(&bytes))))
}

#[tauri::command]
pub fn comfy_inspect_generation_workflow(workflow_path: String) -> Res<Value> {
    let (graph, sha256) = checked_workflow(&workflow_path)?;
    let nodes: Vec<Value> = graph.iter().map(|(id, node)| json!({
        "id": id, "classType": node["class_type"],
        "title": node.pointer("/_meta/title").and_then(Value::as_str).unwrap_or(""),
        "inputs": node["inputs"].as_object().unwrap().iter().filter(|(_, value)|
            value.is_string() || value.is_number() || value.is_boolean()).map(|(name, value)|
                json!({"name": name, "value": value})).collect::<Vec<_>>()
    })).collect();
    Ok(json!({"nodes": nodes, "sha256": sha256}))
}

/// 선택 파일과 설치 서버의 상태를 읽기만 합니다. 노드 설치·업데이트·GPU 실행은 하지 않습니다.
#[tauri::command]
pub async fn comfy_workflow_preflight(base_url: String, workflow_path: String, installation_root: Option<String>) -> Res<Value> {
    let (base, client) = client(&base_url)?;
    let (_, sha256) = checked_workflow(&workflow_path)?;
    let bytes = fs::read(&workflow_path).map_err(|e| err("워크플로를 읽지 못했습니다", e))?;
    if bytes.len() > 8 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != sha256 { return Err("검사 중 워크플로가 바뀌었습니다.".into()); }
    let text = String::from_utf8(bytes).map_err(|_| "워크플로는 UTF-8 JSON이어야 합니다.")?;
    let catalog = response_json(client.get(format!("{base}/object_info")).send().await.map_err(|e| comfy_net_err(&base, e))?, "노드 규격을 읽지 못했습니다").await?;
    let stats = response_json(client.get(format!("{base}/system_stats")).send().await.map_err(|e| comfy_net_err(&base, e))?, "Comfy 상태를 읽지 못했습니다").await?;
    let queue = response_json(client.get(format!("{base}/queue")).send().await.map_err(|e| comfy_net_err(&base, e))?, "Comfy 큐를 읽지 못했습니다").await?;
    if !catalog.is_object() || stats.get("system").is_none() || !queue["queue_running"].is_array() || !queue["queue_pending"].is_array() { return Err("Comfy 서버 응답 규격이 다릅니다. 버전과 포트를 확인하세요.".into()); }
    let catalog_fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&catalog).map_err(|e| err("노드 규격 해시 실패",e))?));
    let mut node_source_hashes=serde_json::Map::new();
    let mut disk_commit=String::new();
    if let Some(root) = installation_root.filter(|v| !v.trim().is_empty()) {
        let root=Path::new(&root);
        if !root.is_absolute() || root.to_string_lossy().starts_with("\\\\") { return Err("Comfy 설치 폴더는 기존 로컬 절대 경로여야 합니다.".into()); }
        for module in ["nodes","comfy_extras.nodes_mask","comfy_extras.nodes_hunyuan","comfy_extras.nodes_wan","comfy_extras.nodes_video","comfy_extras.nodes_audio"] {
            let path=root.join(format!("{}.py",module.replace('.',"/")));
            if path.is_file() { let checked=ensure_inside(root,&path)?;node_source_hashes.insert(module.into(),json!(hash_file(&checked)?)); }
        }
        let head_path=root.join(".git/HEAD");
        if head_path.is_file() {
            let mut head=String::new();File::open(head_path).map_err(|e|err("Comfy disk HEAD",e))?.take(4096).read_to_string(&mut head).map_err(|e|err("Comfy disk HEAD",e))?;
            if let Some(reference)=head.trim().strip_prefix("ref: ") {
                if reference.starts_with("refs/") && !reference.contains("..") && !reference.contains('\\') {
                    let path=root.join(".git").join(reference);
                    if path.is_file() {let mut value=String::new();File::open(path).map_err(|e|err("Comfy disk ref",e))?.take(4096).read_to_string(&mut value).map_err(|e|err("Comfy disk ref",e))?;disk_commit=value.trim().into();}
                }
            } else { disk_commit=head.trim().into(); }
        }
    }
    // 디스크 HEAD는 실행 중 Python이 읽어 둔 commit의 증명이 아닙니다.
    let owned=crate::comfy_owned_backend::owned_record(&base)?;
    if let Some(record)=&owned {
      let proof=response_json(client.get(format!("{base}/aimoviestorage/source_attestation")).send().await.map_err(|e|err("owned source proof",e))?,"owned source proof").await?;
      if record["serverPid"].is_null(){return Err("owned_backend_identity_not_ready".into());}
      crate::comfy_owned_backend::verify_source_attestation(record,&proof)?;
      node_source_hashes=record["nodeSourceHashes"].as_object().ok_or("owned source hashes")?.clone();
    }
    let live_commit=owned.as_ref().and_then(|v|v["coreCommit"].as_str()).unwrap_or_else(||stats.pointer("/system/comfyui_commit").and_then(Value::as_str).unwrap_or(""));
    let source_evidence=if owned.is_some(){"owned-child-attestation"}else if !live_commit.is_empty() && live_commit==disk_commit {"reported-commit-matches-disk"} else {"runtime-source-unverified"};
    Ok(json!({"text":text,"sha256":sha256,"catalog":catalog,"systemStats":stats,"catalogFingerprint":catalog_fingerprint,
        "queueRunning":queue["queue_running"].as_array().unwrap().len(),"queuePending":queue["queue_pending"].as_array().unwrap().len(),
        "supportedWorkflowContractVersions":crate::comfy_contract_v2_guard::capabilities()["supportedWorkflowContractVersions"],"nativeWorkflowContractCapabilities":crate::comfy_contract_v2_guard::capabilities(),
        "baseUrl":base,"mode":"read-only","coreCommit":live_commit,"diskCoreCommit":disk_commit,"nodeSourceHashes":node_source_hashes,"sourceEvidence":source_evidence,"ownedAttestation":owned,"verifiedWeights":owned.as_ref().map(|v|v["weights"].clone()).unwrap_or(json!([]))}))
}

fn validate_bindings(graph: &serde_json::Map<String, Value>, bindings: &[InputBinding]) -> Res<()> {
    let mut seen = HashSet::new();
    for binding in bindings {
        if !seen.insert((&binding.node_id, &binding.input)) { return Err("같은 워크플로 입력이 두 번 지정됐습니다.".into()); }
        let original = graph.get(&binding.node_id).and_then(|n| n.get("inputs")).and_then(|v| v.get(&binding.input))
            .ok_or_else(|| format!("워크플로 입력을 찾지 못했습니다: {}.{}", binding.node_id, binding.input))?;
        if !(original.is_string() || original.is_number() || original.is_boolean()) {
            return Err("노드 사이 연결은 입력값으로 덮어쓸 수 없습니다.".into());
        }
        match (&binding.value, &binding.file_path) {
            (Some(value), None) if (original.is_string() && value.is_string()) || (original.is_number() && value.is_number()) || (original.is_boolean() && value.is_boolean()) => {},
            (None, Some(path)) if original.is_string() && Path::new(path).is_file() => {},
            _ => return Err(format!("입력값의 형식 또는 레퍼런스 파일을 확인하세요: {}.{}", binding.node_id, binding.input)),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn comfy_submit_generation(request: SubmitRequest) -> Res<Value> {
    let receipt=crate::comfy_admission::consume(&request).await?;
    submit_generation_checked(request,Some(receipt)).await
}
async fn submit_generation_checked(request:SubmitRequest,receipt:Option<Value>)->Res<Value> {
    let (base, client) = client(&request.base_url)?;
    let (mut graph, sha256) = checked_workflow(&request.workflow_path)?;
    if request.expected_workflow_sha256 != sha256 { return Err("검사한 뒤 ComfyUI 워크플로 파일이 변경됐습니다. 다시 검사하고 실행하세요.".into()); }
    validate_bindings(&graph, &request.bindings)?;
    if request.client_id.trim().is_empty() || request.client_id.len() > 200 { return Err("ComfyUI 작업 열쇠가 올바르지 않습니다.".into()); }
    for binding in &request.bindings {
        let value = if let Some(path) = &binding.file_path {
            let pinned=if let Some(record)=receipt.as_ref(){
                let fact=record["nativeReferenceFacts"].as_array().and_then(|facts|facts.iter().find(|fact|fact["path"]==*path)).ok_or("workflow_native_registered_reference_fact_required")?;
                crate::comfy_registered_assets::pin(&PathBuf::from(record["workRoot"].as_str().ok_or("workflow_native_reference_snapshot_root")?).join("reference-snapshots"),fact)?
            } else {
                // 이 분기는 내부 HTTP CPU fixture에서만 컴파일됩니다. production 명령은 consume 영수증이 필수입니다.
                #[cfg(test)] {let source=Path::new(path);let fact=json!({"path":path,"bytes":fs::metadata(source).map_err(|e|err("CPU fixture stat",e))?.len(),"sha256":hash_file(source)?});crate::comfy_registered_assets::pin(&source.parent().ok_or("CPU fixture parent")?.join("reference-snapshots"),&fact)?}
                #[cfg(not(test))] {return Err("workflow_native_registered_reference_fact_required".into());}
            };
            let source = pinned.as_path();
            let extension = source.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase();
            if !["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "webm", "mkv", "wav", "mp3", "flac", "ogg"].contains(&extension.as_str()) {
                return Err("ComfyUI 레퍼런스는 그림·영상·음원 파일만 올릴 수 있습니다.".into());
            }
            // 영상 전체를 RAM 에 복사하지 않습니다. 같은 이름의 다른 프로젝트 파일도 덮지 않습니다.
            let file = File::open(source).map_err(|e| err("레퍼런스를 열지 못했습니다", e))?;
            let length = file.metadata().map_err(|e| err("레퍼런스 크기를 읽지 못했습니다", e))?.len();
            if length == 0 { return Err("레퍼런스 파일이 비어 있습니다.".into()); }
            let stream = futures_util::stream::try_unfold(file, |mut file| async move {
                let mut bytes = vec![0u8; 65536];
                let count = file.read(&mut bytes)?;
                if count == 0 { Ok::<_, std::io::Error>(None) } else { bytes.truncate(count); Ok(Some((bytes, file))) }
            });
            let name = format!("aimovie-{}.{}", uuid::Uuid::new_v4(), extension);
            let part = reqwest::multipart::Part::stream_with_length(reqwest::Body::wrap_stream(stream), length).file_name(name);
            let uploaded = client.post(format!("{base}/upload/image"))
                .multipart(reqwest::multipart::Form::new().part("image", part).text("type", "input").text("overwrite", "false"))
                .timeout(Duration::from_secs(600)).send().await.map_err(|e| comfy_net_err(&base, e))?;
            let uploaded = response_json(uploaded, "레퍼런스 업로드가 실패했습니다").await?;
            let filename = uploaded.get("name").and_then(Value::as_str).ok_or("업로드 응답에 파일 이름이 없습니다.")?;
            let subfolder = uploaded.get("subfolder").and_then(Value::as_str).unwrap_or("");
            checked_remote_path(filename, subfolder, "input")?;
            json!(if subfolder.is_empty() { filename.to_string() } else { format!("{subfolder}/{filename}") })
        } else { binding.value.clone().unwrap() };
        graph[&binding.node_id]["inputs"][&binding.input] = value;
    }
    let submitted_graph=json!(graph);
    let queued = client.post(format!("{base}/prompt")).json(&json!({"prompt": submitted_graph, "client_id": request.client_id}))
        .timeout(Duration::from_secs(120)).send().await.map_err(|e| format!("{} 제출 응답이 끊겼으므로 자동 재전송하지 않습니다. ComfyUI 큐를 확인하세요.", comfy_net_err(&base, e)))?;
    let queued = response_json(queued, "ComfyUI 가 워크플로를 받지 않았습니다").await?;
    let prompt_id = queued.get("prompt_id").and_then(Value::as_str).ok_or("큐 응답에 prompt_id 가 없습니다. ComfyUI 큐를 확인한 뒤 다시 실행하세요.")?;
    if let Some(receipt)=receipt {crate::comfy_admission::record_submission(prompt_id,receipt,submitted_graph).map_err(|e|format!("작업은 접수됐지만 native 영수증 저장 실패: {prompt_id}. {e}. 다시 제출하지 마세요."))?;}
    Ok(json!({"promptId": prompt_id}))
}

fn valid_prompt_id(id: &str) -> Res<()> {
    if id.is_empty() || id.len() > 200 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("ComfyUI 작업 번호가 올바르지 않습니다.".into());
    }
    Ok(())
}

async fn history(base: &str, client: &reqwest::Client, prompt_id: &str) -> Res<Value> {
    valid_prompt_id(prompt_id)?;
    response_json(client.get(format!("{base}/history/{prompt_id}")).send().await.map_err(|e| comfy_net_err(base, e))?, "ComfyUI 작업 기록을 읽지 못했습니다").await
}

pub fn history_status(history: &Value, prompt_id: &str) -> Value {
    let Some(entry) = history.get(prompt_id) else { return json!({"state": "pending", "promptId": prompt_id}); };
    let status = entry.pointer("/status/status_str").and_then(Value::as_str).unwrap_or("");
    let messages = entry.pointer("/status/messages").and_then(Value::as_array);
    let failed_message = messages.and_then(|items| items.iter().find(|m| matches!(m.get(0).and_then(Value::as_str), Some("execution_error" | "execution_interrupted"))));
    if status == "error" || failed_message.is_some() {
        // 실제 H3 실패 응답은 current_inputs 에 거대한 텐서를 먼저 넣었습니다. 전체를 앞에서
        // 자르면 정작 예외 원인은 사라지고 텐서만 보이므로 원인·노드부터 추립니다.
        let detail = if let Some(message) = failed_message {
            let payload = message.get(1).unwrap_or(&Value::Null);
            json!({"event":message.get(0),"nodeId":payload.get("node_id"),"nodeType":payload.get("node_type"),
                "exceptionType":payload.get("exception_type"),"message":payload.get("exception_message")}).to_string()
        } else { format!("ComfyUI 실행 오류: {status}") };
        return json!({"state": "failed", "promptId": prompt_id, "error": detail.chars().take(1200).collect::<String>()});
    }
    // 빈 history 와 아직 쓰는 중인 출력은 성공이 아닙니다.
    if entry.pointer("/status/completed").and_then(Value::as_bool) == Some(true) || status == "success" {
        json!({"state": "completed", "promptId": prompt_id})
    } else { json!({"state": "pending", "promptId": prompt_id}) }
}

#[tauri::command]
pub async fn comfy_generation_status(base_url: String, prompt_id: String) -> Res<Value> {
    let (base, client) = client(&base_url)?;
    Ok(history_status(&history(&base, &client, &prompt_id).await?, &prompt_id))
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteOutput { node_id: String, filename: String, subfolder: String, file_type: String, kind: String }

fn checked_remote_path(filename: &str, subfolder: &str, file_type: &str) -> Res<()> {
    if filename.is_empty() || filename.contains(['/', '\\', ':', '\0']) || filename == "." || filename == ".."
        || subfolder.contains(['\\', ':', '\0']) || subfolder.starts_with('/')
        || subfolder.split('/').any(|part| part == ".." || part == ".")
        || !["output", "temp", "input"].contains(&file_type) {
        return Err("ComfyUI 가 잘못된 결과 파일 경로를 돌려줬습니다.".into());
    }
    Ok(())
}

fn output_kind(filename: &str) -> Option<&'static str> {
    match Path::new(filename).extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" => Some("image"),
        "mp4" | "webm" | "mov" | "mkv" => Some("video"),
        "wav" | "mp3" | "flac" | "ogg" => Some("audio"),
        _ => None,
    }
}

fn collect_outputs(history: &Value, prompt_id: &str, kind: &str, node_ids: &[String]) -> Res<Vec<RemoteOutput>> {
    if !["image", "video", "audio"].contains(&kind) { return Err("생성 갈래는 image 또는 video 여야 합니다.".into()); }
    let outputs = history.get(prompt_id).and_then(|v| v.get("outputs")).and_then(Value::as_object).ok_or("ComfyUI 결과 목록이 없습니다.")?;
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for (node_id, output) in outputs {
        if !node_ids.is_empty() && !node_ids.contains(node_id) { continue; }
        for key in ["images", "videos", "gifs", "audio"] {
            for file in output.get(key).and_then(Value::as_array).into_iter().flatten() {
                let Some(filename) = file.get("filename").and_then(Value::as_str) else { continue; };
                if output_kind(filename) != Some(kind) { continue; }
                let subfolder = file.get("subfolder").and_then(Value::as_str).unwrap_or("");
                let file_type = file.get("type").and_then(Value::as_str).unwrap_or("output");
                checked_remote_path(filename, subfolder, file_type)?;
                if !["output", "temp"].contains(&file_type) { continue; }
                if seen.insert((filename.to_string(), subfolder.to_string(), file_type.to_string())) {
                    result.push(RemoteOutput {node_id: node_id.clone(), filename: filename.into(), subfolder: subfolder.into(), file_type: file_type.into(), kind: kind.into()});
                }
            }
        }
    }
    if result.is_empty() { return Err("선택한 갈래의 결과 파일이 없습니다. 저장 노드와 출력 노드 선택을 확인하세요.".into()); }
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectRequest {
    pub base_url: String, pub prompt_id: String, pub base_directory: String, pub project_name: String,
    pub asset_type: String, pub owner_name: String, pub stem: String, pub kind: String,
    #[serde(default)] pub output_node_ids: Vec<String>,
    #[serde(default)] pub provenance: Option<Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedOutput { path: String, name: String, kind: String, node_id: String, #[serde(default)] sha256: String, #[serde(default)] bytes: u64, #[serde(default)] provenance: Option<Value>, #[serde(default)] media_facts: Value }

#[derive(Deserialize, Serialize)]
struct OutputReceipt { output: CollectedOutput, sha256: String, length: u64 }

pub(crate) fn hash_file(path: &Path) -> Res<String> {
    let mut file = File::open(path).map_err(|e| err("결과 파일을 확인하지 못했습니다", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| err("결과 파일을 읽지 못했습니다", e))?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn write_receipt(path: &Path, receipt: &OutputReceipt) -> Res<()> {
    let mut record = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| err("결과 기록을 만들지 못했습니다", e))?;
    serde_json::to_writer(&mut record, receipt).map_err(|e| err("결과 기록을 쓰지 못했습니다", e))?;
    record.as_file().sync_all().map_err(|e| err("결과 기록을 저장하지 못했습니다", e))?;
    record.persist(path).map_err(|e| err("결과 기록을 확정하지 못했습니다", e.error))?;
    Ok(())
}

fn create_inside(root: &Path, directory: &Path) -> Res<std::path::PathBuf> {
    // 폴더를 만들기 전에 기존 부모부터 검사합니다. 링크 바깥에 폴더를 만든 뒤 검사하면 이미 늦습니다.
    let ancestor = directory.ancestors().find(|path| path.exists()).ok_or("저장 폴더를 확인하지 못했습니다.")?;
    ensure_inside(root, ancestor)?;
    fs::create_dir_all(directory).map_err(|e| err("결과 폴더를 만들지 못했습니다", e))?;
    ensure_inside(root, directory)
}

fn validate_media(path: &Path, extension: &str, kind: &str) -> Res<()> {
    if kind == "image" {
        let reader = image::ImageReader::open(path).map_err(|e| err("결과 그림을 열지 못했습니다", e))?.with_guessed_format().map_err(|e| err("결과 그림 형식을 읽지 못했습니다", e))?;
        if reader.format() != image::ImageFormat::from_extension(extension) { return Err("ComfyUI 결과의 그림 형식과 확장자가 다릅니다.".into()); }
        reader.into_dimensions().map_err(|e| err("결과가 올바른 그림 파일이 아닙니다", e))?;
    } else if kind == "audio" {
        let mut header = [0u8; 12];
        let count = File::open(path).and_then(|mut f| f.read(&mut header)).map_err(|e| err("결과 음원 형식을 읽지 못했습니다",e))?;
        let valid = count >= 4 && match extension {
            "wav" => count >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WAVE",
            "flac" => &header[..4] == b"fLaC",
            "ogg" => &header[..4] == b"OggS",
            "mp3" => &header[..3] == b"ID3" || (header[0] == 0xff && header[1] & 0xe0 == 0xe0),
            _ => false,
        };
        if !valid { return Err("ComfyUI 결과가 요청한 음원 형식이 아닙니다.".into()); }
    } else {
        let mut header = [0u8; 12];
        let count = File::open(path).and_then(|mut f| f.read(&mut header)).map_err(|e| err("결과 영상 형식을 읽지 못했습니다", e))?;
        let valid = count >= 8 && match extension {
            "mp4" => &header[4..8] == b"ftyp",
            "mov" => matches!(&header[4..8], b"ftyp" | b"moov" | b"mdat" | b"wide"),
            "mkv" | "webm" => header[..4] == [0x1a,0x45,0xdf,0xa3],
            "gif" => &header[..6] == b"GIF87a" || &header[..6] == b"GIF89a",
            _ => false,
        };
        if !valid { return Err("ComfyUI 결과가 요청한 영상 형식이 아닙니다. 서버 오류 문서가 반환됐는지 확인하세요.".into()); }
    }
    Ok(())
}

#[tauri::command]
pub async fn comfy_collect_generation(app: tauri::AppHandle, request: CollectRequest) -> Res<Vec<CollectedOutput>> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir().map_err(|e|err("app_path",e))?;
    collect_generation_in_data_dir(data_dir, request).await
}

pub(crate) async fn collect_generation_in_data_dir(data_dir: std::path::PathBuf, request: CollectRequest) -> Res<Vec<CollectedOutput>> {
    valid_prompt_id(&request.prompt_id)?;
    let (base,client)=client(&request.base_url)?;
    let history=history(&base,&client,&request.prompt_id).await?;
    crate::comfy_admission::verify_submission(&request,&history)?;
    collect_generation_checked(request, |path,kind|crate::comfy_asset_probe::probe_media_in_data_dir(&data_dir,path,kind),Some(history)).await
}

async fn collect_generation_checked(request: CollectRequest, probe: impl Fn(&Path,&str)->Res<Value>, verified_history:Option<Value>) -> Res<Vec<CollectedOutput>> {
    let (base, client) = client(&request.base_url)?;
    // 검증 직후 다시 조회하면 다른 그래프가 반환될 수 있으므로 동일한 기록으로 수집합니다.
    let history = match verified_history { Some(value)=>value,None=>history(&base,&client,&request.prompt_id).await? };
    let status = history_status(&history, &request.prompt_id);
    if status["state"] != "completed" { return Err(format!("ComfyUI 생성이 완료되지 않았습니다: {status}")); }
    let outputs = collect_outputs(&history, &request.prompt_id, &request.kind, &request.output_node_ids)?;
    if request.base_directory.trim().is_empty() || request.project_name.trim().is_empty() { return Err("결과를 받을 프로젝트 저장 폴더가 필요합니다.".into()); }
    if !["character-generated", "background-generated", "asset-generated", "scene-cut", "scene-video", "project-cover", "composition-video", "character-voice", "bgm-track"].contains(&request.asset_type.as_str()) {
        return Err("ComfyUI 결과를 저장할 갈래가 올바르지 않습니다.".into());
    }
    let root = project_root(&request.base_directory, &request.project_name);
    if !root.is_dir() { return Err("결과를 받을 프로젝트 폴더가 없습니다.".into()); }
    ensure_inside(Path::new(&request.base_directory), &root)?;
    let destination = owner_dir(&request.base_directory, &request.project_name, &request.asset_type, &request.owner_name);
    let destination = create_inside(&root, &destination)?;
    // 다시 받기와 응답 재전송이 같은 결과를 두 번 등록하지 않도록 파일별 영수증을 남깁니다.
    let receipt_dir = root.join(".comfy-results");
    let receipt_dir = create_inside(&root, &receipt_dir)?;
    let key = format!("{:x}", Sha256::digest(format!("{}|{}|{}|{}|{}|{}", base, request.prompt_id, destination.display(), request.stem, request.kind, request.output_node_ids.join(","))));
    let lock = OpenOptions::new().create(true).read(true).write(true).open(receipt_dir.join(format!("{key}.lock"))).map_err(|e| err("결과 기록을 열지 못했습니다", e))?;
    lock.try_lock_exclusive().map_err(|_| "같은 ComfyUI 결과를 이미 받고 있습니다. 잠시 뒤 확인하세요.")?;
    let mut result = Vec::new();
    for (index, output) in outputs.iter().enumerate() {
        let receipt = receipt_dir.join(format!("{key}-{index}.json"));
        let previous: Option<OutputReceipt> = if receipt.is_file() {
            let saved: OutputReceipt = serde_json::from_slice(&fs::read(&receipt).map_err(|e| err("결과 기록을 읽지 못했습니다", e))?).map_err(|e| err("결과 기록이 손상됐습니다", e))?;
            let path = Path::new(&saved.output.path);
            ensure_inside(&destination, path.parent().ok_or("잘못된 결과 기록입니다.")?)?;
            if path.exists() {
                ensure_inside(&destination, path)?;
                if path.metadata().map(|m| m.is_file() && m.len() == saved.length).unwrap_or(false) && hash_file(path)? == saved.sha256 {
                    if saved.output.provenance != request.provenance { return Err("Comfy 수집 요청의 provenance가 기존 영수증과 다릅니다.".into()); }
                    probe(path,&saved.output.kind)?;
                    result.push(saved.output); continue;
                }
                return Err("이미 받은 ComfyUI 결과 파일이 변경됐습니다. 기존 파일을 덮어쓰지 않습니다.".into());
            }
            Some(saved)
        } else { None };
        let mut response = client.get(format!("{base}/view")).query(&[("filename", &output.filename), ("subfolder", &output.subfolder), ("type", &output.file_type)])
            .timeout(Duration::from_secs(600)).send().await.map_err(|e| comfy_net_err(&base, e))?;
        if !response.status().is_success() { return Err(format!("ComfyUI 결과 다운로드가 실패했습니다 ({}).", response.status())); }
        let mut temp = tempfile::NamedTempFile::new_in(&destination).map_err(|e| err("결과 임시 파일을 만들지 못했습니다", e))?;
        let mut length: u64 = 0;
        let mut hasher = Sha256::new();
        while let Some(bytes) = response.chunk().await.map_err(|e| err("결과를 받지 못했습니다", e))? {
            temp.write_all(&bytes).map_err(|e| err("결과를 저장하지 못했습니다", e))?; length += bytes.len() as u64; hasher.update(&bytes);
        }
        if length == 0 { return Err("ComfyUI 결과가 빈 파일입니다.".into()); }
        temp.flush().map_err(|e| err("결과를 저장하지 못했습니다", e))?;
        let extension = Path::new(&output.filename).extension().and_then(|v| v.to_str()).unwrap().to_ascii_lowercase();
        validate_media(temp.path(), &extension, &output.kind)?;
        let media_facts=probe(temp.path(), &output.kind)?;
        let sha256 = format!("{:x}", hasher.finalize());
        if previous.as_ref().is_some_and(|saved| saved.sha256 != sha256 || saved.length != length) { return Err("같은 ComfyUI 작업의 원격 결과 내용이 변경됐습니다. 작업 기록을 확인하세요.".into()); }
        let stem = format!("{}_ComfyUI", safe_name(&request.stem));
        let mut saved_output = None;
        for number in 1..100_000 {
            let path = if let Some(previous) = &previous { std::path::PathBuf::from(&previous.output.path) }
                else { destination.join(format!("{stem}_{number:03}.{extension}")) };
            if previous.is_none() && path.exists() { continue; }
            let saved = CollectedOutput {path: path.to_string_lossy().into(), name: path.file_stem().unwrap().to_string_lossy().into(), kind: output.kind.clone(), node_id: output.node_id.clone(), sha256: sha256.clone(), bytes: length, provenance: request.provenance.clone(), media_facts:media_facts.clone()};
            // 파일보다 영수증을 먼저 확정합니다. 이 사이 앱이 꺼져도 다음 수집은 같은 자리만 복구합니다.
            write_receipt(&receipt, &OutputReceipt {output:saved.clone(),sha256:sha256.clone(),length})?;
            match temp.persist_noclobber(&path) {
                Ok(_) => { saved_output = Some(saved); break; },
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists && previous.is_none() => { temp = error.file; },
                Err(error) => return Err(err("결과 파일을 확정하지 못했습니다", error.error)),
            }
        }
        result.push(saved_output.ok_or("결과 파일의 빈 번호를 찾지 못했습니다.")?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]async fn raw_submit_without_native_admission_is_rejected_before_network(){
      let result=comfy_submit_generation(SubmitRequest{base_url:"http://127.0.0.1:1".into(),workflow_path:"missing.json".into(),bindings:vec![],client_id:"cpu".into(),expected_workflow_sha256:"a".repeat(64),admission_token:None}).await;
      assert!(result.unwrap_err().contains("workflow_native_admission_required"));
    }
    #[test] fn linked_inputs_cannot_be_overwritten() {
        let graph = json!({"1":{"class_type":"Node", "inputs":{"link":["2",0],"seed":1,"text":"x"}}}).as_object().unwrap().clone();
        let binding = |input: &str, value| InputBinding {node_id:"1".into(), input:input.into(), value:Some(value), file_path:None};
        assert!(validate_bindings(&graph, &[binding("link", json!("replacement"))]).is_err());
        assert!(validate_bindings(&graph, &[binding("seed", json!("wrong type"))]).is_err());
        assert!(validate_bindings(&graph, &[binding("text", json!("new prompt"))]).is_ok());
        assert!(validate_bindings(&graph, &[binding("text", json!("a")),binding("text", json!("b"))]).is_err());
    }
    #[test] fn terminal_failure_is_not_a_result() {
        assert_eq!(history_status(&json!({}), "job")["state"], "pending");
        assert_eq!(history_status(&json!({"job":{"outputs":{"1":{}},"status":{"completed":false}}}), "job")["state"], "pending");
        assert_eq!(history_status(&json!({"job":{"status":{"completed":true,"messages":[["execution_interrupted",{}]]}}}), "job")["state"], "failed");
        assert_eq!(history_status(&json!({"job":{"status":{"completed":true,"status_str":"success"}}}), "job")["state"], "completed");
        let failure = history_status(&json!({"job":{"status":{"status_str":"error","messages":[["execution_error",{
            "current_inputs":{"tensor":"x".repeat(10000)},"node_id":"11","node_type":"SamplerCustomAdvanced",
            "exception_type":"TypeError","exception_message":"int8_linear() got an unexpected keyword argument 'input_act_weight'"
        }]]}}}),"job");
        let detail = failure["error"].as_str().unwrap();
        assert!(detail.contains("input_act_weight"));
        assert!(detail.contains("SamplerCustomAdvanced"));
        assert!(!detail.contains("current_inputs"));
    }
    #[test] fn outputs_preserve_all_selected_files_and_reject_escape() {
        let history = json!({"job":{"outputs":{"9":{"gifs":[{"filename":"one.mp4","type":"output"},{"filename":"two.webm","type":"temp"}]},"8":{"images":[{"filename":"preview.png"}]}}}});
        assert_eq!(collect_outputs(&history,"job","video",&[]).unwrap().len(),2);
        assert!(collect_outputs(&history,"job","video",&["8".into()]).is_err());
        assert!(checked_remote_path("../secret.png","","output").is_err());
        assert!(checked_remote_path("ok.png","../private","output").is_err());
        assert!(checked_remote_path("ok.png","C:/data","output").is_err());
        assert!(checked_remote_path("ok.png","folder/child","output").is_ok());
        let input = json!({"job":{"outputs":{"9":{"images":[{"filename":"private.png","type":"input"}]}}}});
        assert!(collect_outputs(&input,"job","image",&[]).is_err());
    }
    #[test] fn html_errors_cannot_be_saved_as_videos() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("result.tmp");
        fs::write(&file, b"<html>server error</html>").unwrap();
        assert!(validate_media(&file,"mp4","video").is_err());
        fs::write(&file, b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00").unwrap();
        assert!(validate_media(&file,"mp4","video").is_ok());
        assert_eq!(output_kind("animated.gif"), Some("image"));
        image::RgbImage::new(2,2).save_with_format(&file,image::ImageFormat::Gif).unwrap();
        assert!(validate_media(&file,"gif","image").is_ok());
        assert!(validate_media(&file,"png","image").is_err());
        let history = json!({"job":{"outputs":{"1":{"images":[{"filename":"video.mp4","type":"output"},{"filename":"preview.gif","type":"output"}],"animated":[true]}}}});
        assert_eq!(collect_outputs(&history,"job","video",&[]).unwrap()[0].filename,"video.mp4");
        assert_eq!(collect_outputs(&history,"job","image",&[]).unwrap()[0].filename,"preview.gif");
    }

    #[tokio::test]
    async fn http_upload_submit_collect_all_and_resume_without_duplicate_files() {
        use std::{net::TcpListener, sync::{Arc,Mutex}};
        let workspace = tempfile::tempdir().unwrap();
        let project = workspace.path().join("movie");
        fs::create_dir(&project).unwrap();
        let reference = workspace.path().join("ref.png");
        image::RgbImage::new(2,2).save(&reference).unwrap();
        let png = fs::read(&reference).unwrap();
        let workflow = workspace.path().join("workflow.json");
        fs::write(&workflow, json!({"1":{"class_type":"LoadImage","inputs":{"image":"old.png"}},"2":{"class_type":"Text","inputs":{"text":"old"}},"3":{"class_type":"SaveImage","inputs":{}}}).to_string()).unwrap();
        let (_, digest) = checked_workflow(workflow.to_str().unwrap()).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}",listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::<(String,Vec<u8>)>::new()));
        let captured = Arc::clone(&requests);
        // 업로드·접수·상태·수집·그림 두 장·다시 수집. 실제 HTTP 왕복에서 포트/본문/파일을 함께 검증합니다.
        let server = std::thread::spawn(move || {
            for _ in 0..5 {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0u8;4096];
                let header_end = loop {
                    let n = stream.read(&mut buffer).unwrap(); assert!(n > 0); bytes.extend_from_slice(&buffer[..n]);
                    if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") { break index+4; }
                };
                let headers = String::from_utf8_lossy(&bytes[..header_end]).to_string();
                let path = headers.lines().next().unwrap().split_whitespace().nth(1).unwrap().to_string();
                let length = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                while bytes.len() < header_end+length { let n = stream.read(&mut buffer).unwrap(); assert!(n > 0); bytes.extend_from_slice(&buffer[..n]); }
                captured.lock().unwrap().push((path.clone(),bytes[header_end..].to_vec()));
                let body = if path == "/upload/image" { br#"{"name":"uploaded.png","subfolder":"refs","type":"input"}"#.to_vec() }
                    else if path == "/prompt" { br#"{"prompt_id":"test-job"}"#.to_vec() }
                    else if path.starts_with("/view?") {png.clone()}
                    else {json!({"test-job":{"status":{"completed":true,"status_str":"success"},"outputs":{"3":{"images":[{"filename":"a.png","type":"output"},{"filename":"b.png","type":"output"}]}}}}).to_string().into_bytes()};
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let submitted = submit_generation_checked(SubmitRequest {base_url:base.clone(),workflow_path:workflow.to_string_lossy().into(),client_id:"test-client".into(),expected_workflow_sha256:digest,admission_token:None,
            bindings:vec![InputBinding{node_id:"1".into(),input:"image".into(),value:None,file_path:Some(reference.to_string_lossy().into())},InputBinding{node_id:"2".into(),input:"text".into(),value:Some(json!("new prompt")),file_path:None}]},None).await.unwrap();
        assert_eq!(submitted["promptId"],"test-job");
        assert_eq!(comfy_generation_status(base.clone(),"test-job".into()).await.unwrap()["state"],"completed");
        let request = || CollectRequest{base_url:base.clone(),prompt_id:"test-job".into(),base_directory:workspace.path().to_string_lossy().into(),project_name:"movie".into(),asset_type:"scene-cut".into(),owner_name:"scene".into(),stem:"take".into(),kind:"image".into(),output_node_ids:vec!["3".into()], provenance: None};
        let probe=|path:&Path,kind:&str| -> Res<Value> { assert_eq!(kind,"image");let image=image::ImageReader::open(path).unwrap().with_guessed_format().unwrap().decode().map_err(|e|err("test_decode",e))?;Ok(json!({"fullDecode":true,"width":image.width(),"height":image.height()})) };
        let verified_history=json!({"test-job":{"status":{"completed":true,"status_str":"success"},"outputs":{"3":{"images":[{"filename":"a.png","type":"output"},{"filename":"b.png","type":"output"}]}}}});
        let first = collect_generation_checked(request(),probe,Some(verified_history.clone())).await.unwrap();
        let second = collect_generation_checked(request(),probe,Some(verified_history)).await.unwrap();
        assert_eq!(first.len(),2);
        assert_eq!(first[0].path,second[0].path);
        assert_eq!(first[1].path,second[1].path);
        assert_ne!(first[0].path,first[1].path);
        assert_eq!(fs::read(&first[0].path).unwrap(),fs::read(reference).unwrap());
        server.join().unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.iter().filter(|(path,_)| path == "/prompt").count(),1);
        // 상태 조회 한 번 외에는 수집의 검증된 history를 새 응답으로 바꾸지 않습니다.
        assert_eq!(requests.iter().filter(|(path,_)| path.starts_with("/history/")).count(),1);
        assert_eq!(requests.iter().filter(|(path,_)| path.starts_with("/view?")).count(),2);
        let prompt: Value = serde_json::from_slice(&requests.iter().find(|(path,_)| path == "/prompt").unwrap().1).unwrap();
        assert_eq!(prompt["prompt"]["1"]["inputs"]["image"],"refs/uploaded.png");
        assert_eq!(prompt["prompt"]["2"]["inputs"]["text"],"new prompt");
    }
}
