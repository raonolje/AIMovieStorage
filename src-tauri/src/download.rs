//! **파일 하나를 안전하게 받는 한 벌** — 이어받기 · 크기·sha256 확인 · 제자리로 옮기기.
//!
//! # 왜 한 벌인가
//!
//! 2026-09-18 점검에서, 엔진 가중치(`upscale.rs`)와 로라(`lora.rs`)가 **받는 코드를 따로**
//! 들고 있는 것을 찾았습니다. 엔진 쪽에는 그동안 겪은 사고가 전부 반영돼 있었지만
//! (이어받기, 416 되짚기, 다 받고 끊긴 임시 파일, 해시 확인) 로라 쪽에는 **하나도** 없었습니다.
//! 로라는 파일 하나가 수 GB 라, 90% 에서 끊기면 처음부터 다시 받아야 했습니다.
//!
//! 두 곳이 다른 것은 «진행을 어디로 알리는가» 뿐이라, 그것만 함수로 받습니다.
//!
//! # 반쪽짜리 파일을 원래 자리에 만들지 않습니다
//!
//! 받는 동안에는 `<이름>.내려받는중` 에 씁니다. 중간에 앱이 꺼져 조각이 남아도 목록에는
//! 안 뜨고(확장자가 다릅니다), 다음에 **이어받습니다.** 다 받아 크기·해시를 확인한 뒤에야
//! 제 이름이 됩니다.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::{err, Res};

/// 받는 동안 쓰는 이름의 꼬리.
///
/// **목록을 만드는 쪽이 이 상수를 봐야 합니다.** 예전에 로라는 꼬리를 `.받는중` 으로
/// 따로 정해 두고 목록도 그 글자로 걸렀는데, 받는 코드를 한 벌로 모으며 꼬리가 바뀌면
/// 목록 거르개가 조용히 헛돌아 **반쪽짜리 파일이 목록에 뜹니다**(고르면 로딩 실패).
/// 두 곳이 같은 상수를 보면 그럴 일이 없습니다.
pub const PARTIAL_SUFFIX: &str = "내려받는중";

/// 받다 만 조각인가. 목록을 만들 때 이것으로 거릅니다.
pub fn is_partial(file_name: &str) -> bool {
    file_name.ends_with(&format!(".{PARTIAL_SUFFIX}"))
}

/// 진행을 알리는 간격. 조각마다 알리면 화면이 그리다 지칩니다.
const REPORT_EVERY: Duration = Duration::from_millis(400);

/// 받을 것 하나.
pub struct Download<'a> {
    pub url: &'a str,
    /// 다 받으면 놓일 자리. 부모 폴더는 여기서 만듭니다.
    pub dest: &'a Path,
    /// 사람에게 보일 이름(오류 문구에 들어갑니다).
    pub label: &'a str,
    pub expected_sha: Option<&'a str>,
    pub expected_size: Option<u64>,
    /// 401·403 일 때 대신 띄울 안내. 없으면 상태 코드만 알립니다.
    ///
    /// Civitai 는 일부 로라에 로그인을 요구하는데, 「받지 못했습니다」 만 띄우면
    /// 사람은 네트워크 탓인 줄 압니다.
    pub login_hint: Option<&'a str>,
    /// 함께 보낼 `Authorization: Bearer …` 값(Civitai API 키·허깅페이스 토큰).
    ///
    /// Civitai 는 상당수 로라를 로그인한
    /// 계정에만 내주는데, 프로그램에 허용된 로그인은 API 키뿐입니다. 설정에 한 번 넣어 두면
    /// 받을 때마다 여기로 붙습니다. 값은 오류 문구·로그에 절대 안 적습니다.
    pub bearer: Option<String>,
}

/// 진행 상황 한 번.
pub struct Beat {
    /// 0~100. 서버가 크기를 안 알려 주면 None.
    pub percent: Option<f64>,
    pub written: u64,
    pub total: Option<u64>,
    /// 해시를 확인하는 중이면 true — 이때는 받는 것이 아니라 읽는 중입니다.
    pub verifying: bool,
}

pub fn human(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / 1024.0 / 1024.0 / 1024.0)
    } else if bytes >= 1024 * 1024 {
        format!("{} MB", bytes / 1024 / 1024)
    } else {
        format!("{} KB", bytes / 1024)
    }
}

pub(crate) fn sha256_of(path: &Path) -> Res<String> {
    sha256_cancellable(path, &|| false)
}

pub(crate) fn sha256_cancellable(path: &Path, stop: &impl Fn() -> bool) -> Res<String> {
    let mut file = fs::File::open(path).map_err(|e| err("파일을 열지 못했습니다", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if stop() { return Err("멈췄습니다.".into()); }
        let read = file.read(&mut buffer).map_err(|e| err("파일을 읽지 못했습니다", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn partial_path(dest: &Path) -> std::path::PathBuf {
    dest.with_file_name(format!(
        "{}.{PARTIAL_SUFFIX}",
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("파일")
    ))
}

/// 다 받은 임시 파일을 확인하고 제자리로 옮깁니다(크기 → 해시 → 이름 바꾸기).
///
/// 받는 자리와 따로 떼어 둔 이유: «크기는 이미 맞는데 확인 전에 끊긴» 임시 파일이 있을 때
/// 이어받기를 건너뛰고 바로 이 단계로 오기 위해서입니다(아래 416 설명).
fn finish(spec: &Download, temp: &Path, beat: &impl Fn(Beat), preserve: bool, stop: &impl Fn() -> bool) -> Res<()> {
    let label = spec.label;
    if let Some(size) = spec.expected_size {
        let got = fs::metadata(temp).map(|m| m.len()).unwrap_or(0);
        if got != size {
            let _ = fs::remove_file(temp);
            return Err(format!("{label} 의 크기가 다릅니다({got} ≠ {size}). 다시 시도해 주세요."));
        }
    }
    if let Some(expected) = spec.expected_sha {
        beat(Beat { percent: None, written: 0, total: None, verifying: true });
        let actual = sha256_cancellable(temp, stop)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = fs::remove_file(temp);
            return Err(format!("{label} 의 sha256 이 다릅니다. 받다 망가졌거나 원본이 바뀌었습니다."));
        }
    }
    if stop() { return Err("멈췄습니다.".into()); }
    if preserve {
        verify_safetensors(temp)?;
        // 다른 실행이 먼저 완성한 원본을 지우지 않도록 제자리 생성은 원자적으로 합니다.
        fs::hard_link(temp, spec.dest).map_err(|_| "같은 이름의 파일이 생겼거나 완료 파일을 놓지 못했습니다. 원본은 보존했습니다.".to_string())?;
        fs::remove_file(temp).map_err(|e| err("완료한 임시 파일을 정리하지 못했습니다", e))?;
        return Ok(());
    }
    // 덮어쓸 것이 있으면 먼저 치웁니다(윈도우는 존재하는 자리로 rename 이 실패합니다).
    // 여기서는 선삭제가 안전합니다 — dest 는 앱이 받아 둔 파일이지 사용자의 그림이 아닙니다.
    let _ = fs::remove_file(spec.dest);
    fs::rename(temp, spec.dest).map_err(|e| err(&format!("{label} 을(를) 제자리에 놓지 못했습니다"), e))
}

/// 파일 하나를 받습니다. 받다 만 것이 있으면 이어받고, 다 받으면 크기·해시를 확인한 뒤
/// 제자리로 옮깁니다. 중간에 끊겨도 원래 자리에는 반쪽짜리가 생기지 않습니다.
///
/// `stop` 이 true 를 돌려주면 그 자리에서 멈춥니다 — 받다 만 것은 **남겨 둡니다**(다음에 이어받게).
pub async fn fetch(
    spec: Download<'_>,
    beat: impl Fn(Beat),
    stop: impl Fn() -> bool,
) -> Res<()> {
    fetch_inner(spec, beat, stop, false).await
}

/// 조종기에서는 기존 파일을 검증하고 덮어쓰지 않습니다. 전송 몸통은 UI와 같습니다.
pub async fn fetch_checked(spec: Download<'_>, beat: impl Fn(Beat), stop: impl Fn() -> bool) -> Res<()> {
    fetch_inner(spec, beat, stop, true).await
}

async fn fetch_inner(spec: Download<'_>, beat: impl Fn(Beat), stop: impl Fn() -> bool, preserve: bool) -> Res<()> {
    use futures_util::StreamExt;
    if stop() { return Err("멈췄습니다.".into()); }
    let label = spec.label;
    if let Some(parent) = spec.dest.parent() {
        fs::create_dir_all(parent).map_err(|e| err("받을 폴더를 만들지 못했습니다", e))?;
    }

    // 이미 제자리에 있고 크기가 맞으면 건너뜁니다(다시 설치해도 16GB 를 또 받지 않게).
    if let Ok(meta) = fs::metadata(spec.dest) {
        if spec.expected_size.map(|size| meta.len() == size).unwrap_or(meta.len() > 0) {
            if preserve {
                verify_safetensors(spec.dest)?;
                if let Some(expected) = spec.expected_sha {
                    if !sha256_cancellable(spec.dest, &stop)?.eq_ignore_ascii_case(expected) { return Err("기존 파일의 sha256이 다릅니다. 원본을 보존했습니다.".into()); }
                }
            }
            return Ok(());
        }
        if preserve { return Err("기존 파일의 크기가 다릅니다. 원본을 보존했습니다.".into()); }
    }

    let temp = partial_path(spec.dest);
    let mut have = fs::metadata(&temp).map(|m| m.len()).unwrap_or(0);
    // 이미 받은 것이 목표보다 크면 딴 파일입니다 — 버리고 처음부터.
    if let Some(size) = spec.expected_size {
        if have > size {
            let _ = fs::remove_file(&temp);
            have = 0;
        }
        /*
          «다 받았는데 확인·이름 바꾸기 전에 끊긴» 임시 파일(2026-09-09 지적).

          예전에는 이때도 `Range: bytes=<크기>-` 를 보냈고, 서버는 416 을 돌려줬습니다.
          오류로 끝나면서 임시 파일은 그대로 남으니 **다시 설치해도 매번 같은 416** 이라,
          앱 데이터 폴더에서 손으로 지우기 전에는 그 엔진을 깔 길이 없었습니다.
          크기가 이미 맞으면 요청을 아예 보내지 말고 확인·이름 바꾸기로 넘어갑니다.
        */
        if have == size && have > 0 {
            return finish(&spec, &temp, &beat, preserve, &stop);
        }
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| err("HTTP 클라이언트를 만들지 못했습니다", e))?;
    // 416(이어받을 자리가 서버가 아는 크기를 넘음)은 오류로 두지 않고 «임시 파일을 버리고
    // 처음부터» 로 **한 번만** 되짚습니다. 크기를 미리 모르는 항목(vosr 의 dinov2 zip)은
    // 위의 `have == size` 갈래로 걸러지지 않아 여기가 유일한 탈출구입니다.
    let mut restarted = false;
    let response = loop {
        let mut request = client.get(spec.url);
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        // 키가 있으면 매 요청(이어받기 포함)에 붙입니다 — 되짚어 다시 보낼 때 빠지면 두 번째부터 401 입니다.
        if let Some(token) = spec.bearer.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let pending = request.send();
        tokio::pin!(pending);
        let response = loop {
            tokio::select! {
                result = &mut pending => break result.map_err(|_| format!("{label} 요청이 실패했습니다."))?,
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    if stop() { return Err("멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".into()); }
                }
            }
        };
        let status = response.status();
        if status.as_u16() == 416 && have > 0 && !restarted {
            let _ = fs::remove_file(&temp);
            have = 0;
            restarted = true;
            continue;
        }
        if !status.is_success() {
            let code = status.as_u16();
            return Err(match (code, spec.login_hint) {
                (401 | 403, Some(hint)) => format!("HTTP {code}: {hint}"),
                _ => format!("{label} 을(를) 받지 못했습니다 ({status})."),
            });
        }
        break response;
    };
    let status = response.status();
    // 이어받기를 요청했는데 서버가 전체를 주면(206 이 아니면) 처음부터 다시 씁니다.
    let resuming = have > 0 && status.as_u16() == 206;
    if have > 0 && !resuming {
        have = 0;
    }
    let total = response.content_length().map(|len| len + have).or(spec.expected_size);

    let mut file = if resuming {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .open(&temp)
            .map_err(|e| err("이어받을 파일을 열지 못했습니다", e))?;
        file.seek(SeekFrom::Start(have))
            .map_err(|e| err("이어받을 자리를 찾지 못했습니다", e))?;
        file
    } else {
        fs::File::create(&temp).map_err(|e| err("받을 파일을 만들지 못했습니다", e))?
    };

    let mut written = have;
    let mut last_report = Instant::now();
    let mut stream = response.bytes_stream();
    loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if stop() { let _ = file.flush(); return Err("멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".into()); }
                continue;
            }
        };
        let Some(chunk) = chunk else { break };
        if stop() {
            let _ = file.flush();
            return Err("멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".into());
        }
        let chunk = chunk.map_err(|e| err(&format!("{label} 을(를) 받는 중 끊겼습니다"), e))?;
        file.write_all(&chunk).map_err(|e| err("받은 것을 쓰지 못했습니다", e))?;
        written += chunk.len() as u64;
        if last_report.elapsed() >= REPORT_EVERY {
            last_report = Instant::now();
            beat(Beat {
                percent: total.map(|t| (written as f64) * 100.0 / (t.max(1) as f64)),
                written,
                total,
                verifying: false,
            });
        }
    }
    file.flush().map_err(|e| err("받은 것을 쓰지 못했습니다", e))?;
    drop(file);

    if stop() { return Err("멈췄습니다. 받다 만 파일은 다음에 이어받습니다.".into()); }
    finish(&spec, &temp, &beat, preserve, &stop)
}

/// 이름만 safetensors인 오류 페이지가 완료 목록에 올라가는 것을 막습니다.
pub(crate) fn verify_safetensors(path: &Path) -> Res<()> {
    let mut file = fs::File::open(path).map_err(|_| "검증할 파일을 열지 못했습니다.".to_string())?;
    let size = file.metadata().map_err(|_| "파일 크기를 읽지 못했습니다.".to_string())?.len();
    let mut prefix = [0u8; 8];
    file.read_exact(&mut prefix).map_err(|_| "safetensors 헤더가 없습니다.".to_string())?;
    let header_size = u64::from_le_bytes(prefix);
    if header_size == 0 || header_size > 16 * 1024 * 1024 || header_size + 8 >= size {
        return Err("safetensors 헤더 크기가 올바르지 않습니다.".into());
    }
    let mut bytes = vec![0; header_size as usize];
    file.read_exact(&mut bytes).map_err(|_| "safetensors 헤더가 끊겼습니다.".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "safetensors 헤더가 올바르지 않습니다.".to_string())?;
    let entries = value.as_object().ok_or("safetensors 헤더가 객체가 아닙니다.")?;
    let mut ranges = Vec::new();
    for (key, item) in entries {
        if key == "__metadata__" { continue; }
        let offsets = item["data_offsets"].as_array().filter(|a| a.len() == 2).ok_or("텐서 범위가 올바르지 않습니다.")?;
        let start = offsets[0].as_u64().ok_or("텐서 시작점이 올바르지 않습니다.")?;
        let end = offsets[1].as_u64().ok_or("텐서 끝점이 올바르지 않습니다.")?;
        if start > end || end > size - 8 - header_size || item["dtype"].as_str().is_none() || item["shape"].as_array().is_none() {
            return Err("텐서 헤더와 파일 크기가 맞지 않습니다.".into());
        }
        ranges.push((start, end));
    }
    ranges.sort_unstable();
    let mut cursor = 0;
    if ranges.is_empty() { return Err("텐서가 없습니다.".into()); }
    for (start, end) in ranges { if start != cursor { return Err("텐서 범위가 겹치거나 끊겼습니다.".into()); } cursor = end; }
    if cursor != size - 8 - header_size { return Err("텐서 데이터의 크기가 맞지 않습니다.".into()); }
    Ok(())
}

#[cfg(test)]
mod checked_download_tests {
    use super::*;
    fn tensor_file(path: &Path) -> u64 {
        let header = br#"{"x":{"dtype":"U8","shape":[4],"data_offsets":[0,4]}}"#;
        let mut bytes = (header.len() as u64).to_le_bytes().to_vec(); bytes.extend(header); bytes.extend([1,2,3,4]);
        fs::write(path, &bytes).unwrap(); bytes.len() as u64
    }
    #[tokio::test]
    async fn existing_checked_file_is_verified_without_network() {
        let dir = tempfile::tempdir().unwrap(); let dest = dir.path().join("x.safetensors"); let size = tensor_file(&dest);
        let hash = sha256_of(&dest).unwrap();
        let spec = Download {url:"http://127.0.0.1:1/not-used",dest:&dest,label:"시험",expected_sha:Some(&hash),expected_size:Some(size),login_hint:None,bearer:None};
        assert!(fetch_checked(spec, |_| {}, || false).await.is_ok()); assert_eq!(sha256_of(&dest).unwrap(),hash);
    }
    #[tokio::test]
    async fn wrong_existing_size_preserves_original() {
        let dir = tempfile::tempdir().unwrap(); let dest = dir.path().join("x.safetensors"); let size = tensor_file(&dest); let before = fs::read(&dest).unwrap();
        let spec = Download {url:"http://127.0.0.1:1",dest:&dest,label:"시험",expected_sha:None,expected_size:Some(size+1),login_hint:None,bearer:None};
        assert!(fetch_checked(spec, |_| {}, || false).await.is_err()); assert_eq!(fs::read(dest).unwrap(),before);
    }
    #[tokio::test]
    async fn wrong_existing_hash_preserves_original() {
        let dir = tempfile::tempdir().unwrap(); let dest = dir.path().join("x.safetensors"); let size = tensor_file(&dest); let before = fs::read(&dest).unwrap(); let wrong="0".repeat(64);
        let spec = Download {url:"http://127.0.0.1:1",dest:&dest,label:"시험",expected_sha:Some(&wrong),expected_size:Some(size),login_hint:None,bearer:None};
        assert!(fetch_checked(spec, |_| {}, || false).await.is_err()); assert_eq!(fs::read(dest).unwrap(),before);
    }
    #[tokio::test]
    async fn complete_partial_promotes_without_network() {
        let dir=tempfile::tempdir().unwrap(); let dest=dir.path().join("x.safetensors"); let temp=partial_path(&dest); let size=tensor_file(&temp);
        let spec=Download {url:"http://127.0.0.1:1",dest:&dest,label:"시험",expected_sha:None,expected_size:Some(size),login_hint:None,bearer:None};
        assert!(fetch_checked(spec, |_| {}, || false).await.is_ok()); assert!(dest.exists()); assert!(!temp.exists());
    }
    #[test]
    fn finish_never_overwrites_a_racing_original() {
        let dir=tempfile::tempdir().unwrap(); let dest=dir.path().join("x.safetensors"); let temp=partial_path(&dest); let size=tensor_file(&temp); fs::write(&dest,b"keep").unwrap();
        let spec=Download {url:"unused",dest:&dest,label:"시험",expected_sha:None,expected_size:Some(size),login_hint:None,bearer:None};
        assert!(finish(&spec,&temp,&|_| {},true,&||false).is_err()); assert_eq!(fs::read(dest).unwrap(),b"keep"); assert!(temp.exists());
    }
    #[test]
    fn corrupt_or_missing_tensor_data_never_promotes() {
        let dir=tempfile::tempdir().unwrap(); let dest=dir.path().join("x.safetensors"); let temp=partial_path(&dest); fs::write(&temp,b"<html>error</html>").unwrap(); let size=fs::metadata(&temp).unwrap().len();
        let spec=Download {url:"unused",dest:&dest,label:"시험",expected_sha:None,expected_size:Some(size),login_hint:None,bearer:None};
        assert!(finish(&spec,&temp,&|_| {},true,&||false).is_err()); assert!(!dest.exists());
        tensor_file(&temp); let bytes=fs::read(&temp).unwrap(); fs::write(&temp,&bytes[..bytes.len()-1]).unwrap(); assert!(verify_safetensors(&temp).is_err());
    }
    #[tokio::test]
    async fn cancel_preserves_complete_partial() {
        let dir=tempfile::tempdir().unwrap(); let dest=dir.path().join("x.safetensors"); let temp=partial_path(&dest); let size=tensor_file(&temp);
        let spec=Download {url:"http://127.0.0.1:1",dest:&dest,label:"시험",expected_sha:None,expected_size:Some(size),login_hint:None,bearer:None};
        assert!(fetch_checked(spec, |_| {}, || true).await.is_err()); assert!(temp.exists()); assert!(!dest.exists());
        assert!(sha256_cancellable(&temp,&||true).is_err());
    }
    #[tokio::test]
    async fn forbidden_status_is_reported_once_without_retry() {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let addr=listener.local_addr().unwrap();
        let server=std::thread::spawn(move|| {let (mut socket,_)=listener.accept().unwrap();let mut request=[0;2048];socket.read(&mut request).unwrap();socket.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();});
        let dir=tempfile::tempdir().unwrap();let dest=dir.path().join("x.safetensors");let url=format!("http://{addr}/x");
        let spec=Download {url:&url,dest:&dest,label:"시험",expected_sha:None,expected_size:Some(4),login_hint:Some("접근 거부"),bearer:None};
        assert_eq!(fetch_checked(spec, |_| {}, ||false).await.unwrap_err(),"HTTP 403: 접근 거부");server.join().unwrap();assert!(!dest.exists());
    }
}

#[cfg(test)]
mod cancellation_download_tests {
    use super::*;
    use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
    use std::io::{Read,Write};
    #[tokio::test]
    async fn stalled_response_is_cancellable_without_progress_event() {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let addr=listener.local_addr().unwrap();
        let flag=Arc::new(AtomicBool::new(false));let trigger=flag.clone();
        let server=std::thread::spawn(move||{let(mut socket,_)=listener.accept().unwrap();let mut b=[0;2048];socket.read(&mut b).unwrap();trigger.store(true,Ordering::Relaxed);std::thread::sleep(Duration::from_millis(300));});
        let dir=tempfile::tempdir().unwrap();let dest=dir.path().join("x.safetensors");let url=format!("http://{addr}/file");
        let spec=Download {url:&url,dest:&dest,label:"시험",expected_sha:None,expected_size:Some(100),login_hint:None,bearer:None};
        let started=Instant::now();assert!(fetch_checked(spec, |_|{}, ||flag.load(Ordering::Relaxed)).await.unwrap_err().contains("멈췄습니다"));assert!(started.elapsed()<Duration::from_millis(250));server.join().unwrap();assert!(!dest.exists());
    }
    #[tokio::test]
    async fn stalled_stream_keeps_partial_for_resume_on_cancel() {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let addr=listener.local_addr().unwrap();
        let flag=Arc::new(AtomicBool::new(false));let trigger=flag.clone();
        let server=std::thread::spawn(move||{let(mut socket,_)=listener.accept().unwrap();let mut b=[0;2048];socket.read(&mut b).unwrap();socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n0123456789").unwrap();std::thread::sleep(Duration::from_millis(50));trigger.store(true,Ordering::Relaxed);std::thread::sleep(Duration::from_millis(300));});
        let dir=tempfile::tempdir().unwrap();let dest=dir.path().join("x.safetensors");let url=format!("http://{addr}/file");
        let spec=Download {url:&url,dest:&dest,label:"시험",expected_sha:None,expected_size:Some(100),login_hint:None,bearer:None};
        assert!(fetch_checked(spec, |_|{}, ||flag.load(Ordering::Relaxed)).await.unwrap_err().contains("멈췄습니다"));server.join().unwrap();assert!(!dest.exists());assert_eq!(fs::read(partial_path(&dest)).unwrap(),b"0123456789");
    }
}

pub(crate) async fn official_descriptor(url: &str, expected_size: u64, stop: &impl Fn() -> bool) -> Res<String> {
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(60)).build()
        .map_err(|_| "Could not initialize official model request".to_string())?;
    let mut request = client.head(url);
    if let Ok(token) = crate::llm::read_api_key("huggingface") { request = request.bearer_auth(token); }
    let pending = request.send(); tokio::pin!(pending);
    let response = loop { tokio::select! {
        result = &mut pending => break result.map_err(|_| "Official model metadata request failed".to_string())?,
        _ = tokio::time::sleep(Duration::from_millis(100)) => if stop() { return Err("Download cancelled".into()); }
    }};
    if !response.status().is_success() && !response.status().is_redirection() {
        return Err(format!("HTTP {}: official model access rejected", response.status().as_u16()));
    }
    let size = response.headers().get("x-linked-size").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    if size != Some(expected_size) { return Err("Official model size differs from approved descriptor".into()); }
    response.headers().get("x-linked-etag").or_else(|| response.headers().get("etag"))
        .and_then(|v| v.to_str().ok()).map(|v| v.trim_matches('"').to_ascii_lowercase())
        .filter(|v| v.len()==64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| "Official model SHA256 was not supplied; weights were not downloaded".into())
}

pub(crate) fn lock_model_file(dest: &Path) -> Res<fs::File> {
    use fs2::FileExt;
    let name = dest.file_name().and_then(|n|n.to_str()).ok_or("Invalid model filename")?;
    let lock = dest.with_file_name(format!("{name}.lock.{PARTIAL_SUFFIX}"));
    let file = fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(lock)
        .map_err(|_| "Could not open model download lock".to_string())?;
    file.try_lock_exclusive().map_err(|_| "This model component is already being downloaded".to_string())?;
    Ok(file)
}
