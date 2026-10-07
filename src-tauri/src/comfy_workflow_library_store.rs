//! 검사가 다시 실패해도 원본 graph와 이전 등록 버전이 덮어써지지 않도록 새 snapshot만 저장합니다.
use std::{fs,io::{Read,Write},path::{Path,PathBuf}};
use serde_json::{json,Value};
use tauri::Manager;
use crate::{Res,err,comfy_preset_policy::sha};
fn read_bounded(path:&Path,max:usize)->Res<Vec<u8>>{let mut bytes=Vec::new();fs::File::open(path).map_err(|e|err("workflow_library_file_read",e))?.take(max as u64+1).read_to_end(&mut bytes).map_err(|e|err("workflow_library_file_read",e))?;if bytes.len()>max{return Err("workflow_library_file_size_limit".into());}Ok(bytes)}
fn validate_api(bytes:&[u8])->Res<()> {
    let graph:Value=serde_json::from_slice(bytes).map_err(|e|err("workflow_library_invalid_json",e))?;
    let nodes=graph.as_object().filter(|g|!g.is_empty()&&g.len()<=2000).ok_or("workflow_library_api_export_required: ComfyUI의 API 형식 JSON이 필요합니다.")?;
    if graph["nodes"].is_array() || graph["links"].is_array(){return Err("workflow_library_api_export_required: 편집용 JSON의 자동 변환은 지원하지 않습니다. API 형식으로 내보내세요.".into());}
    for (id,node) in nodes {if ["__proto__","prototype","constructor"].contains(&id.as_str()) || node["class_type"].as_str().is_none_or(str::is_empty) || !node["inputs"].is_object(){return Err("workflow_library_invalid_api_graph".into());}}
    crate::comfy_preset_policy::reject_credentials(&graph)?;Ok(())
}
pub(crate) fn store_revision(root:&Path,source:&Path,expected:&str,revision_id:&str)->Res<Value>{
    if revision_id.is_empty() || revision_id.len()>200 || !revision_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){return Err("workflow_library_revision_id_invalid".into());}
    let bytes=read_bounded(source,8*1024*1024)?;if sha(&bytes)!=expected{return Err("workflow_library_source_changed: 검사 후 원본 파일이 바뀌었습니다. 다시 불러오세요.".into());}validate_api(&bytes)?;
    fs::create_dir_all(root).map_err(|e|err("workflow_library_revision_folder",e))?;let target=root.join(format!("{revision_id}.api.json"));
    if target.exists(){if fs::read(&target).map_err(|e|err("workflow_library_snapshot_read",e))?!=bytes{return Err("workflow_library_revision_conflict".into());}}
    else {let mut temp=tempfile::NamedTempFile::new_in(root).map_err(|e|err("workflow_library_snapshot_temp",e))?;temp.write_all(&bytes).map_err(|e|err("workflow_library_snapshot_write",e))?;temp.as_file().sync_all().map_err(|e|err("workflow_library_snapshot_sync",e))?;temp.persist_noclobber(&target).map_err(|e|err("workflow_library_snapshot_commit",e.error))?;}
    Ok(json!({"snapshotPath":target,"sha256":expected,"revisionId":revision_id,"originalPath":source,"originalChanged":false,"actualGenerationRegistration":"not-run"}))
}
#[tauri::command]
pub async fn comfy_workflow_store_revision(app:tauri::AppHandle,workflow_path:String,expected_sha256:String,revision_id:String)->Res<Value>{
    let root=app.path().app_data_dir().map_err(|e|err("workflow library folder",e))?.join("workflow-library/revisions");
    tauri::async_runtime::spawn_blocking(move||store_revision(&root,Path::new(&workflow_path),&expected_sha256,&revision_id)).await.map_err(|e|err("workflow snapshot CPU wait",e))?
}
fn read_selected_entry(root:&Path,relative:&str)->Res<String>{
    if !root.is_absolute() || relative.is_empty() || relative.contains([':', '\\']) || relative.starts_with('/') || relative.split('/').any(|p|p.is_empty()||p=="."||p==".."){return Err("workflow_library_selected_root_required".into());}
    let file=crate::ensure_inside(root,&root.join(relative))?;
    if file.extension().and_then(|v|v.to_str()).is_none_or(|v|!v.eq_ignore_ascii_case("json")){return Err("workflow_library_json_entry_required".into());}
    String::from_utf8(read_bounded(&file,2*1024*1024)?).map_err(|_|"workflow_library_utf8_required".into())
}
#[tauri::command]
pub async fn comfy_workflow_read_library_entry(root:String,relative_path:String)->Res<String>{tauri::async_runtime::spawn_blocking(move||read_selected_entry(Path::new(&root),&relative_path)).await.map_err(|e|err("workflow entry CPU wait",e))?}

#[cfg(test)]mod tests{
    use super::*;
    fn graph()->Vec<u8>{br#"{"1":{"class_type":"CPUOnly","inputs":{"text":"CPU only"}}}"#.to_vec()}
    #[test]fn snapshots_preserve_original_bytes_and_previous_versions(){let dir=tempfile::tempdir().unwrap();let original=dir.path().join("original.api.json");let bytes=graph();fs::write(&original,&bytes).unwrap();let root=dir.path().join("versions");let one=store_revision(&root,&original,&sha(&bytes),"revision1").unwrap();assert_eq!(fs::read(&original).unwrap(),bytes);let next=br#"{"1":{"class_type":"CPUOnly","inputs":{"text":"changed CPU only"}}}"#;fs::write(&original,next).unwrap();store_revision(&root,&original,&sha(next),"revision2").unwrap();assert_eq!(fs::read(one["snapshotPath"].as_str().unwrap()).unwrap(),bytes);assert!(root.join("revision2.api.json").is_file());}
    #[test]fn repeated_snapshot_is_idempotent_and_conflict_never_overwrites(){let dir=tempfile::tempdir().unwrap();let original=dir.path().join("original.json");let bytes=graph();fs::write(&original,&bytes).unwrap();let root=dir.path().join("versions");store_revision(&root,&original,&sha(&bytes),"one").unwrap();store_revision(&root,&original,&sha(&bytes),"one").unwrap();fs::write(&original,br#"{"1":{"class_type":"CPUOnly","inputs":{"text":"different"}}}"#).unwrap();let next=fs::read(&original).unwrap();assert!(store_revision(&root,&original,&sha(&next),"one").unwrap_err().contains("revision_conflict"));assert_eq!(fs::read(root.join("one.api.json")).unwrap(),bytes);}
    #[test]fn changed_source_hash_fails_without_saving_any_snapshot(){let dir=tempfile::tempdir().unwrap();let original=dir.path().join("original.json");fs::write(&original,graph()).unwrap();let root=dir.path().join("versions");assert!(store_revision(&root,&original,&"0".repeat(64),"one").unwrap_err().contains("source_changed"));assert!(!root.exists());}
    #[test]fn ui_workflow_and_embedded_credentials_are_rejected_before_snapshot_write(){let dir=tempfile::tempdir().unwrap();for bytes in [br#"{"nodes":[],"links":[]}"#.as_slice(),br#"{"1":{"class_type":"CPUOnly","inputs":{"api_key":"fake-CPU-secret"}}}"#.as_slice()]{let original=dir.path().join("original.json");fs::write(&original,bytes).unwrap();let root=dir.path().join("versions");assert!(store_revision(&root,&original,&sha(bytes),"one").is_err());assert!(!root.exists());}}
    #[test]fn selected_root_only_reads_the_explicit_json_without_scanning(){let dir=tempfile::tempdir().unwrap();fs::create_dir(dir.path().join("v2")).unwrap();fs::write(dir.path().join("v2/entry.json"),b"{\"CPU\":true}").unwrap();assert_eq!(read_selected_entry(dir.path(),"v2/entry.json").unwrap(),"{\"CPU\":true}");for name in ["../outside.json","C:/external.json","v2/../../outside.json","https://cpu.invalid","v2\\entry.json"]{assert!(read_selected_entry(dir.path(),name).is_err());}}
    #[test]fn unsafe_revision_ids_cannot_escape_snapshot_directory(){let dir=tempfile::tempdir().unwrap();for id in ["../escape","C:/escape","unsafe.name",""]{assert!(store_revision(dir.path(),&PathBuf::from("unused"),"unused",id).unwrap_err().contains("revision_id_invalid"));}}
}
