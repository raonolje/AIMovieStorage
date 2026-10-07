//! 요청이 준 등록 boolean 대신 저장된 project.json/BGM 기록에서 ID를 다시 풀어 CPU 사실을 발급합니다.
use std::{collections::BTreeMap,fs,io::{Read,Write},path::{Path,PathBuf}};
use serde_json::{json,Value};
use crate::{Res,err,ensure_inside,comfy_preset_policy as policy};
#[derive(Clone)]
struct Registered {path:String,kind:&'static str,identity:Option<String>}
fn read_json(path:&Path)->Res<Value>{let mut bytes=Vec::new();fs::File::open(path).map_err(|e|err("workflow_registered_store_read",e))?.take(16*1024*1024+1).read_to_end(&mut bytes).map_err(|e|err("workflow_registered_store_read",e))?;if bytes.len()>16*1024*1024{return Err("workflow_registered_store_size_limit".into());}serde_json::from_slice(&bytes).map_err(|e|err("workflow_registered_store_json",e))}
fn kind(path:&str)->&'static str{match Path::new(path).extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(){"png"|"jpg"|"jpeg"|"webp"|"bmp"|"gif"=>"image","mp4"|"mov"|"webm"|"m4v"|"mkv"|"avi"=>"video","wav"|"mp3"|"ogg"|"flac"=>"audio",_=>"other"}}
fn add(map:&mut BTreeMap<String,Registered>,id:String,path:&str,identity:&Option<String>)->Res<()> {
    let value=Registered{path:path.into(),kind:kind(path),identity:identity.clone()};
    if let Some(old)=map.get(&id){if old.path!=value.path || old.kind!=value.kind || old.identity!=value.identity{return Err("workflow_registered_asset_id_ambiguous".into());}}
    map.insert(id,value);Ok(())
}
fn visit(value:&Value,key:&str,identity:&Option<String>,map:&mut BTreeMap<String,Registered>,depth:usize)->Res<()> {
    if depth>64 || map.len()>100000{return Err("workflow_registered_asset_limits".into());}
    if let Some(items)=value.as_array(){for (i,item) in items.iter().enumerate(){visit(item,&format!("{key}/{i}"),identity,map,depth+1)?;}return Ok(());}
    let Some(object)=value.as_object() else{return Ok(())};
    if let Some(path)=value["path"].as_str().filter(|p|kind(p)=="audio"){add(map,format!("{key}:audio"),path,identity)?;}
    if let Some(path)=value["filePath"].as_str(){add(map,value["id"].as_str().unwrap_or(key).into(),path,identity)?;}
    for field in ["guideImagePath","plateImagePath","refVideoPath","endFramePath","coverPath","storyboardPath"]{if let Some(path)=value[field].as_str(){let owner=value["id"].as_str().filter(|id|!id.is_empty()).unwrap_or(key);add(map,format!("{owner}:{field}"),path,identity)?;}}
    for (field,child) in object{if field!="file" && (child.is_object()||child.is_array()){visit(child,&format!("{key}/{field}"),identity,map,depth+1)?;}}
    Ok(())
}
fn registered(settings:&Value,root:&Path,project_name:&str,project_id:&str)->Res<BTreeMap<String,Registered>> {
    let mut assets=BTreeMap::new();
    let project_path=root.join("project.json");
    // BGM 폴더와 같은 이름의 영상 프로젝트가 있더라도 정확 project ID로만 선택합니다.
    if project_path.is_file(){let file=ensure_inside(root,&project_path)?;let project=read_json(&file)?;if project["id"]==project_id {
        let draft=&project["draft"];
        for item in draft["characters"].as_array().ok_or("workflow_registered_project_schema")?{visit(item,"draft",&item["id"].as_str().map(String::from),&mut assets,0)?;}
        for item in draft["backgrounds"].as_array().ok_or("workflow_registered_project_schema")?{visit(item,"draft",&None,&mut assets,0)?;}
        for scene in draft["scenes"].as_array().ok_or("workflow_registered_project_schema")?{let scene_id=scene["id"].as_str().ok_or("workflow_registered_project_schema")?;visit(&scene["videos"],&format!("scene/{scene_id}/videos"),&None,&mut assets,0)?;if let Some(path)=scene["storyboardPath"].as_str().filter(|p|!p.is_empty()){add(&mut assets,format!("{scene_id}:storyboardPath"),path,&None)?;}for cut in scene["cuts"].as_array().ok_or("workflow_registered_project_schema")?{let id=cut["id"].as_str().ok_or("workflow_registered_project_schema")?;visit(cut,&format!("cut/{id}"),&None,&mut assets,0)?;}}
        visit(&draft["sharedAssets"],"draft",&None,&mut assets,0)?;return Ok(assets);
    }}
    if project_name!="BGM"{return Err("workflow_registered_project_id_mismatch".into());}
    let projects=settings.pointer("/entries/bgmProjects/value").and_then(Value::as_array).ok_or("workflow_registered_bgm_store_missing")?;
    let matches=projects.iter().filter(|p|p["id"]==project_id).collect::<Vec<_>>();if matches.len()!=1{return Err("workflow_registered_project_id_mismatch".into());}
    for track in matches[0]["tracks"].as_array().ok_or("workflow_registered_bgm_schema")?{let id=track["id"].as_str().ok_or("workflow_registered_bgm_schema")?;for (i,path) in track["resultPaths"].as_array().ok_or("workflow_registered_bgm_schema")?.iter().enumerate(){add(&mut assets,format!("{id}:result:{i}"),path.as_str().ok_or("workflow_registered_bgm_schema")?,&None)?;}}
    Ok(assets)
}
fn local_path(path:&str)->bool{let plain=path.strip_prefix("\\\\?\\").unwrap_or(path);if path.starts_with("\\\\?\\") && (plain.len()<3 || !plain.as_bytes()[0].is_ascii_alphabetic() || &plain[1..3]!=":\\"){return false;}!plain.contains("://")&&!plain.starts_with("\\\\")&&!plain.starts_with("//")&&Path::new(path).is_absolute()}
fn checked_base(settings:&Value,requested:&str)->Res<PathBuf>{let stored=settings.pointer("/entries/mediaLibrary/value/baseDirectory").and_then(Value::as_str).filter(|p|!p.is_empty()).ok_or("workflow_registered_library_store_missing")?;for path in [stored,requested]{if !local_path(path){return Err("workflow_registered_local_library_required".into());}}
    let root=fs::canonicalize(stored).map_err(|e|err("workflow_registered_library_root",e))?;if fs::canonicalize(requested).map_err(|e|err("workflow_registered_library_root",e))?!=root{return Err("workflow_registered_library_changed".into());}Ok(root)
}
pub(crate) fn issue(data_dir:&Path,project_id:&str,asset_id:&str,base:&str,project_name:&str,claimed_path:&str,claimed_kind:&str)->Res<Value>{
    if project_id.is_empty()||asset_id.is_empty()||!local_path(claimed_path){return Err("workflow_asset_local_registered_required".into());}
    let settings=read_json(&data_dir.join("app-settings.json"))?;let base=checked_base(&settings,base)?;let root=ensure_inside(&base,&crate::project_root(base.to_str().ok_or("workflow_registered_path_utf8")?,project_name))?;
    let records=registered(&settings,&root,project_name,project_id)?;let record=records.get(asset_id).ok_or("workflow_registered_reference_id_missing")?;
    let checked=ensure_inside(&root,Path::new(&record.path))?;if record.kind!=claimed_kind||record.kind=="other"||checked!=ensure_inside(&root,Path::new(claimed_path))?{return Err("workflow_registered_reference_path_or_kind_changed".into());}
    let before=fs::metadata(&checked).map_err(|e|err("workflow_asset_stat",e))?;if !before.is_file()||before.len()==0{return Err("workflow_asset_empty_or_not_file".into());}
    let digest=crate::comfy_generation::hash_file(&checked)?;let mut fact=crate::comfy_asset_probe::probe_media_in_data_dir(data_dir,&checked,record.kind)?;
    let after=fs::metadata(&checked).map_err(|e|err("workflow_asset_stat",e))?;if before.len()!=after.len()||before.modified().ok()!=after.modified().ok()||crate::comfy_generation::hash_file(&checked)?!=digest{return Err("workflow_asset_changed_during_probe".into());}
    // 기록을 다시 읽어 등록 철회·다른 ID로 바뀐 경우도 검출합니다. 외부 graph의 증거는 채택하지 않습니다.
    let fresh=read_json(&data_dir.join("app-settings.json"))?;checked_base(&fresh,base.to_str().ok_or("workflow_registered_path_utf8")?)?;let fresh_records=registered(&fresh,&root,project_name,project_id)?;let fresh_record=fresh_records.get(asset_id).ok_or("workflow_registered_reference_id_missing")?;if fresh_record.path!=record.path||fresh_record.kind!=record.kind||fresh_record.identity!=record.identity{return Err("workflow_registered_reference_changed_during_probe".into());}
    let object=fact.as_object_mut().ok_or("workflow_asset_probe_invalid")?;
    // 원본 미디어의 자유 tags/metadata는 영수증·export로 전달하지 않습니다. 검사된 수치 사실만 사용합니다.
    object.remove("metadata");
    object.extend(json!({"source":"native-registered-file-fact-v1","assetId":asset_id,"projectId":project_id,"kind":record.kind,"path":checked,"sha256":digest,"bytes":before.len()}).as_object().unwrap().clone());if let Some(identity)=&record.identity{object.insert("identityId".into(),json!(identity));}Ok(fact)
}
pub(crate) fn for_request(data_dir:&Path,request:&crate::comfy_admission::AdmissionRequest,preset:&policy::ReviewedPreset)->Res<Vec<Value>>{
    let assets=request.provenance["assets"].as_array().ok_or("workflow_native_reference_provenance_missing")?;if assets.len()!=preset.fixed_reference_count{return Err("workflow_native_registered_reference_fact_required".into());}
    let mut facts=vec![];for asset in assets{let id=asset["slotId"].as_str().ok_or("workflow_native_reference_provenance_missing")?;let rule=preset.bindings.iter().find(|r|r.slot_id==id).ok_or("workflow_native_unreviewed_binding")?;let policy::ScalarRule::Reference{media_kind}=&rule.rule else{return Err("workflow_native_reference_variant_mismatch".into())};let binding=request.bindings.iter().find(|b|b.node_id==rule.node_id&&b.input==rule.input).ok_or("workflow_native_reference_file_required")?;
        let mut fact=issue(data_dir,request.manifest["projectId"].as_str().ok_or("workflow_project_id_required")?,asset["assetId"].as_str().ok_or("workflow_native_reference_provenance_missing")?,request.destination["baseDirectory"].as_str().ok_or("workflow_registered_library_required")?,request.destination["projectName"].as_str().ok_or("workflow_registered_project_required")?,binding.file_path.as_deref().ok_or("workflow_native_reference_file_required")?,media_kind)?;fact["slotId"]=json!(id);facts.push(fact);
    }Ok(facts)
}
/// 허가 후 업로드는 이 해시가 같은 새 snapshot만 읽습니다. 원본·이전 snapshot은 덮어쓰지 않습니다.
pub(crate) fn pin(root:&Path,fact:&Value)->Res<PathBuf>{
    let source=Path::new(fact["path"].as_str().ok_or("workflow_native_reference_file_required")?);let extension=source.extension().and_then(|s|s.to_str()).ok_or("workflow_native_reference_kind_missing")?;if kind(&source.to_string_lossy())=="other"{return Err("workflow_native_reference_kind_missing".into());}
    fs::create_dir_all(root).map_err(|e|err("workflow_reference_snapshot_folder",e))?;let mut copy=tempfile::NamedTempFile::new_in(root).map_err(|e|err("workflow_reference_snapshot_temp",e))?;let mut input=fs::File::open(source).map_err(|e|err("workflow_reference_snapshot_read",e))?;std::io::copy(&mut input,&mut copy).map_err(|e|err("workflow_reference_snapshot_copy",e))?;copy.flush().map_err(|e|err("workflow_reference_snapshot_flush",e))?;copy.as_file().sync_all().map_err(|e|err("workflow_reference_snapshot_sync",e))?;
    if copy.as_file().metadata().map_err(|e|err("workflow_reference_snapshot_stat",e))?.len()!=fact["bytes"].as_u64().ok_or("workflow_reference_snapshot_size")? || crate::comfy_generation::hash_file(copy.path())?!=fact["sha256"].as_str().ok_or("workflow_reference_snapshot_hash")?{return Err("workflow_reference_changed_before_upload".into());}
    let target=root.join(format!("{}.{extension}",uuid::Uuid::new_v4()));copy.persist_noclobber(&target).map_err(|e|err("workflow_reference_snapshot_commit",e.error))?;Ok(target)
}

#[cfg(test)]
#[path="comfy_registered_assets_tests.rs"]
mod tests;
