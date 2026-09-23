//! 큰 파일은 제한된 조각으로 받고, 끝까지 확인한 임시파일만 프로젝트 에셋으로 공개합니다.
use std::{collections::HashMap, io::Write, path::PathBuf, sync::Mutex, time::{Duration, Instant}};
use tauri::{ipc::{InvokeBody, Request}, State};
use tempfile::NamedTempFile;
use crate::{asset_destination, err, next_numbered_path, LockSafe, Res, SaveAssetRequest};

const CHUNK_BYTES: usize = 4 * 1024 * 1024;
const IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
pub(crate) struct AssetUploads(Mutex<HashMap<String, PendingUpload>>);

struct PendingUpload {
    file: NamedTempFile,
    dir: PathBuf,
    stem: String,
    ext: String,
    number: Option<u32>,
    total: u64,
    received: u64,
    touched: Instant,
}

impl PendingUpload {
    fn new(request: &SaveAssetRequest, total: u64) -> Res<Self> {
        if total == 0 || total > 9_007_199_254_740_991 || !request.bytes.is_empty() {
            return Err("파일 전송 크기가 올바르지 않습니다.".into());
        }
        let (dir, stem, ext) = asset_destination(request)?;
        let file = tempfile::Builder::new().prefix(".asset-upload-").suffix(".part")
            .tempfile_in(&dir).map_err(|e| err("임시파일을 만들지 못했습니다", e))?;
        Ok(Self { file, dir, stem, ext, number: request.number, total, received: 0, touched: Instant::now() })
    }

    fn append(&mut self, offset: u64, bytes: &[u8]) -> Res<u64> {
        if offset != self.received || bytes.is_empty() || bytes.len() > CHUNK_BYTES
            || self.received.checked_add(bytes.len() as u64).is_none_or(|end| end > self.total) {
            return Err("파일 조각의 순서나 크기가 올바르지 않습니다.".into());
        }
        self.file.write_all(bytes).map_err(|e| err("파일 조각을 저장하지 못했습니다", e))?;
        self.received += bytes.len() as u64;
        self.touched = Instant::now();
        Ok(self.received)
    }

    fn finish(mut self) -> Res<String> {
        if self.received != self.total || self.file.as_file().metadata().map_err(|e| err("파일 크기를 읽지 못했습니다", e))?.len() != self.total {
            return Err("파일 전송이 끝나지 않았습니다.".into());
        }
        self.file.as_file().sync_all().map_err(|e| err("파일 저장을 완료하지 못했습니다", e))?;
        // 번호를 고르는 동안 다른 저장이 끼어들어도 기존 파일은 덮어쓰지 않습니다.
        for _ in 0..100 {
            let path = match self.number {
                Some(number) => self.dir.join(format!("{}_{number:03}.{}", self.stem, self.ext)),
                None => next_numbered_path(&self.dir, &self.stem, &self.ext),
            };
            match self.file.persist_noclobber(&path) {
                Ok(_) => return Ok(path.to_string_lossy().to_string()),
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists && self.number.is_none() => self.file = error.file,
                Err(error) => return Err(err("파일을 프로젝트 폴더에 담지 못했습니다", error.error)),
            }
        }
        Err("빈 파일 번호를 예약하지 못했습니다.".into())
    }
}

#[tauri::command]
pub(crate) fn begin_project_asset_upload(state: State<'_, AssetUploads>, request: SaveAssetRequest, total_size: u64) -> Res<String> {
    let mut pending = state.0.lock_safe();
    // 화면 새로고침 등으로 잃은 요청은 다음 가져오기 때 정리합니다.
    pending.retain(|_, upload| upload.touched.elapsed() < IDLE_LIMIT);
    if pending.len() >= 4 { return Err("진행 중인 파일 저장이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.".into()); }
    let upload = PendingUpload::new(&request, total_size)?;
    let id = uuid::Uuid::new_v4().to_string();
    pending.insert(id.clone(), upload);
    Ok(id)
}

#[tauri::command]
pub(crate) fn append_project_asset_upload(state: State<'_, AssetUploads>, request: Request<'_>) -> Res<u64> {
    let id = request.headers().get("x-asset-upload-id").and_then(|value| value.to_str().ok()).ok_or("파일 전송 번호가 없습니다.")?;
    let offset = request.headers().get("x-asset-upload-offset").and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok()).ok_or("파일 전송 위치가 없습니다.")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("파일 조각은 바이너리로 보내야 합니다.".into()); };
    state.0.lock_safe().get_mut(id).ok_or("진행 중인 파일 저장을 찾지 못했습니다.")?.append(offset, bytes)
}

#[tauri::command]
pub(crate) fn finish_project_asset_upload(state: State<'_, AssetUploads>, upload_id: String) -> Res<String> {
    let upload = state.0.lock_safe().remove(&upload_id).ok_or("진행 중인 파일 저장을 찾지 못했습니다.")?;
    upload.finish()
}

#[tauri::command]
pub(crate) fn abort_project_asset_upload(state: State<'_, AssetUploads>, upload_id: String) {
    // 경로를 받지 않고 이 앱이 연 임시파일만 해제합니다. 완료된 에셋은 건드리지 않습니다.
    state.0.lock_safe().remove(&upload_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(root: &std::path::Path) -> SaveAssetRequest {
        SaveAssetRequest { base_directory: root.to_string_lossy().into(), project_name: "시험 작품".into(), asset_type: "mocap-video".into(), owner_name: "영상".into(), file_name: "source.mp4".into(), stem: None, subdir: None, number: None, bytes: vec![] }
    }

    #[test]
    fn bounded_chunks_publish_exact_bytes_only_after_finish() {
        let root = tempfile::tempdir().unwrap();
        let data: Vec<u8> = (0..CHUNK_BYTES * 2 + 173).map(|index| (index % 251) as u8).collect();
        let mut upload = PendingUpload::new(&request(root.path()), data.len() as u64).unwrap();
        let temporary = upload.file.path().to_path_buf();
        let final_path = upload.dir.join("영상_001.mp4");
        for (index, chunk) in data.chunks(CHUNK_BYTES).enumerate() {
            upload.append((index * CHUNK_BYTES) as u64, chunk).unwrap();
            assert!(!final_path.exists());
        }
        assert_eq!(PathBuf::from(upload.finish().unwrap()), final_path);
        assert_eq!(std::fs::read(final_path).unwrap(), data);
        assert!(!temporary.exists());
    }

    #[test]
    fn missing_duplicate_oversize_and_out_of_order_chunks_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let mut upload = PendingUpload::new(&request(root.path()), 8).unwrap();
        let temporary = upload.file.path().to_path_buf();
        assert!(upload.append(1, &[1]).is_err());
        assert!(upload.append(0, &vec![0; CHUNK_BYTES + 1]).is_err());
        assert!(upload.append(0, &[0; 9]).is_err());
        upload.append(0, &[1, 2]).unwrap();
        assert!(upload.append(0, &[1, 2]).is_err());
        assert!(upload.finish().is_err());
        assert!(!temporary.exists());
    }

    #[test]
    fn abort_removes_partial_and_number_collision_preserves_original() {
        let root = tempfile::tempdir().unwrap();
        let mut request = request(root.path());
        request.number = Some(1);
        let mut upload = PendingUpload::new(&request, 3).unwrap();
        let temporary = upload.file.path().to_path_buf();
        upload.append(0, &[1, 2, 3]).unwrap();
        let final_path = upload.dir.join("영상_001.mp4");
        std::fs::write(&final_path, b"original").unwrap();
        assert!(upload.finish().is_err());
        assert_eq!(std::fs::read(final_path).unwrap(), b"original");
        assert!(!temporary.exists());
        let upload = PendingUpload::new(&request, 3).unwrap();
        let temporary = upload.file.path().to_path_buf();
        drop(upload);
        assert!(!temporary.exists());
    }
}
