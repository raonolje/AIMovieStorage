//! 앱에 포함해 검토한 선언 데이터만 실행 registry로 읽습니다. entry/INDEX/native request로 정책을 등록하지 않습니다.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::{BTreeMap,HashSet};
use crate::{Res,err,comfy_preset_policy::{self as policy,ReviewedPreset}};
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ReviewedRegistry {pub schema_version:u32,pub revision:String,pub default_preset_ids:Vec<String>,pub presets:Vec<ReviewedPreset>,pub weight_files:Vec<ReviewedWeightFile>}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ReviewedWeightFile {pub category:String,pub name:String,pub sha256:String,pub bytes:u64}
pub(crate) struct BackendPlan {pub review:Value,pub weights:Vec<ReviewedWeightFile>,pub preset_ids:Vec<String>,pub registry_sha256:String}
fn safe_relative(s:&str)->bool{!s.is_empty()&&!s.contains([':', '\\'])&&!s.starts_with('/')&&s.split('/').all(|part|!part.is_empty()&&part!="."&&part!="..")}
fn source_module(s:&str)->bool{!s.is_empty()&&s.split('.').all(|part|!part.is_empty()&&part.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'))}
pub(crate) fn packaged()->Res<ReviewedRegistry>{ReviewedRegistry::from_packaged_json(include_str!("../resources/comfy-reviewed-preset-registry.json"))}
#[tauri::command]
pub fn comfy_workflow_authorization_options()->Res<Value>{authorization_options(&packaged()?)}
pub(crate) fn authorization_options(registry:&ReviewedRegistry)->Res<Value>{let presets=registry.presets.iter().map(|preset|{let files=preset.weights.iter().map(|w|((w.category.clone(),w.name.clone(),w.sha256.clone()),json!({"category":w.category,"name":w.name,"sha256":w.sha256}))).collect::<BTreeMap<_,_>>().into_values().collect::<Vec<_>>();json!({"id":preset.id,"modelRuleId":preset.model_rule_id,"files":files})}).collect::<Vec<_>>();Ok(json!({"registrySha256":registry.digest()?,"presets":presets}))}
impl ReviewedRegistry {
 pub(crate) fn from_packaged_json(text:&str)->Res<Self>{let registry:Self=serde_json::from_str(text).map_err(|e|err("workflow packaged registry",e))?;registry.validate()?;Ok(registry)}
 fn validate(&self)->Res<()> {
  if self.schema_version!=1||self.revision.trim().is_empty()||self.presets.is_empty()||self.presets.len()>256{return Err("workflow_packaged_registry_invalid".into());}let mut ids=HashSet::new();let mut hashes=HashSet::new();
  for preset in &self.presets{policy::validate_policy(preset)?;if !ids.insert(&preset.id)||!hashes.insert(&preset.graph_sha256){return Err("workflow_packaged_registry_duplicate".into());}policy::reject_credentials(&serde_json::to_value(preset).map_err(|e|err("workflow registry policy",e))?)?;
   for source in preset.review["sourceFiles"].as_array().ok_or("workflow_registry_source_files_required")?{if !source_module(source["module"].as_str().unwrap_or(""))||!policy::valid_sha(source["sha256"].as_str().unwrap_or("")){return Err("workflow_registry_source_pin_invalid".into());}}
   for weight in &preset.weights{if !safe_relative(&weight.category)||weight.category.contains('/')||!safe_relative(&weight.name)||!weight.name.ends_with(".safetensors")||self.weight_files.iter().filter(|file|file.category==weight.category&&file.name==weight.name&&file.sha256==weight.sha256&&file.bytes>0).count()!=1{return Err("workflow_registry_exact_weight_file_required".into());}}
  }
  if self.default_preset_ids.is_empty()||self.default_preset_ids.iter().any(|id|!ids.contains(id)){return Err("workflow_registry_default_preset_invalid".into());}
  let mut names=HashSet::new();for file in &self.weight_files{if !names.insert((&file.category,&file.name))||!policy::valid_sha(&file.sha256)||file.bytes==0||!self.presets.iter().any(|p|p.weights.iter().any(|w|w.category==file.category&&w.name==file.name&&w.sha256==file.sha256)){return Err("workflow_registry_unreviewed_weight_file".into());}}Ok(())
 }
 pub(crate) fn digest(&self)->Res<String>{policy::value_sha(&serde_json::to_value(self).map_err(|e|err("workflow registry digest",e))?)}
 pub(crate) fn resolve(&self,graph_sha256:&str)->Res<ReviewedPreset>{self.presets.iter().find(|preset|preset.graph_sha256==graph_sha256).cloned().ok_or("workflow_native_preset_not_registered: 선택한 exact graph의 검토된 builtin policy가 앱 registry에 없습니다.".into())}
 pub(crate) fn backend_plan(&self,requested:&[String])->Res<BackendPlan>{
  let ids=if requested.is_empty(){self.default_preset_ids.clone()}else{requested.to_vec()};if ids.len()>32||ids.iter().collect::<HashSet<_>>().len()!=ids.len(){return Err("workflow_registry_backend_selection_invalid".into());}
  let presets=ids.iter().map(|id|self.presets.iter().find(|p|p.id==*id).ok_or("workflow_registry_backend_preset_not_reviewed".to_string())).collect::<Res<Vec<_>>>()?;
  let first=presets.first().ok_or("workflow_registry_backend_selection_required")?;let mut review=first.review.clone();review.as_object_mut().ok_or("workflow_registry_review_invalid")?.remove("contractV2");let mut sources=BTreeMap::new();let mut weights=BTreeMap::new();
  for preset in presets {for key in ["diskCoreCommit","comfyVersion","pythonVersion","torchVersion","reviewVersion"]{if preset.review[key].as_str().is_none_or(str::is_empty)||preset.review[key]!=review[key]{return Err("workflow_registry_incompatible_backend_reviews".into());}}
   for key in ["reviewedNodes","schemaFingerprints"]{let fields=preset.review[key].as_object().ok_or("workflow_registry_review_invalid")?;let destination=review[key].as_object_mut().ok_or("workflow_registry_review_invalid")?;for(name,value)in fields{if destination.get(name).is_some_and(|old|old!=value){return Err("workflow_registry_conflicting_node_or_schema_pin".into());}destination.insert(name.clone(),value.clone());}}
   for source in preset.review["sourceFiles"].as_array().ok_or("workflow_registry_source_files_required")?{let name=source["module"].as_str().ok_or("workflow_registry_source_pin_invalid")?.to_owned();if sources.get(&name).is_some_and(|old|old!=&source["sha256"]){return Err("workflow_registry_conflicting_source_pin".into());}sources.insert(name,source["sha256"].clone());}
   for weight in &preset.weights{let file=self.weight_files.iter().find(|f|f.category==weight.category&&f.name==weight.name&&f.sha256==weight.sha256).ok_or("workflow_registry_exact_weight_file_required")?;weights.insert((file.category.clone(),file.name.clone()),file.clone());}
  }
  for pin in review["reviewedNodes"].as_object().ok_or("workflow_registry_review_invalid")?.values(){if sources.get(pin["pythonModule"].as_str().unwrap_or(""))!=Some(&pin["sourceSha256"]){return Err("workflow_registry_node_source_pin_incomplete".into());}}
  review["sourceFiles"]=json!(sources.iter().map(|(name,hash)|json!({"module":name,"sha256":hash})).collect::<Vec<_>>());review["nodeSourceHashes"]=json!(sources);
  Ok(BackendPlan{review,weights:weights.into_values().collect(),preset_ids:ids,registry_sha256:self.digest()?})
 }
}
#[cfg(test)]pub(crate) mod tests{
 use super::*;
 pub(crate) fn registry(preset:ReviewedPreset)->ReviewedRegistry{let files=preset.weights.iter().map(|w|((w.category.clone(),w.name.clone(),w.sha256.clone()),json!({"category":w.category,"name":w.name,"sha256":w.sha256,"bytes":100}))).collect::<BTreeMap<_,_>>().into_values().collect::<Vec<_>>();ReviewedRegistry::from_packaged_json(&serde_json::json!({"schemaVersion":1,"revision":"CPU fixture never shipped","defaultPresetIds":[preset.id],"presets":[preset],"weightFiles":files}).to_string()).unwrap()}
 #[test]fn g1_new_reviewed_builtin_registry_entry_resolves_without_model_name_switch(){for f in [crate::comfy_preset_test_fixture::fixture("image",0),crate::comfy_preset_test_fixture::reviewed_v2(5)]{let r=registry(f.preset.clone());let resolved=r.resolve(&f.request.expected_workflow_sha256).unwrap();assert_eq!(resolved.id,f.preset.id);}}
 #[test]fn selected_backend_plan_verifies_only_exact_local_weight_facts(){let mut f=crate::comfy_preset_test_fixture::fixture("video",0);let bytes=b"CPU fixture never a real model";f.preset.weights[0].sha256=policy::sha(bytes);let mut r=registry(f.preset);r.weight_files[0].bytes=bytes.len() as u64;let plan=r.backend_plan(&[]).unwrap();assert_eq!(plan.preset_ids,r.default_preset_ids);let root=tempfile::tempdir().unwrap();let folder=root.path().join(&plan.weights[0].category);std::fs::create_dir_all(&folder).unwrap();let file=folder.join(&plan.weights[0].name);std::fs::write(&file,bytes).unwrap();let facts=crate::comfy_owned_backend::verified_weights_for_files(root.path(),&plan.weights).unwrap();assert_eq!(facts[0]["sha256"],plan.weights[0].sha256);std::fs::write(&file,b"changed").unwrap();assert!(crate::comfy_owned_backend::verified_weights_for_files(root.path(),&plan.weights).is_err());assert!(r.backend_plan(&["unknown".into()]).is_err());}
 #[test]fn unreviewed_custom_download_duplicate_or_missing_exact_weight_data_are_rejected(){let f=crate::comfy_preset_test_fixture::fixture("image",0);let r=registry(f.preset);for mutation in ["custom","download","missing","duplicate","unsafe"]{let mut value=serde_json::to_value(&r).unwrap();match mutation{"custom"=>value["presets"][0]["customNodePolicy"]=json!("allowed"),"download"=>value["presets"][0]["downloadPolicy"]=json!("allowed"),"missing"=>value["weightFiles"]=json!([]),"duplicate"=>{let first=value["presets"][0].clone();value["presets"].as_array_mut().unwrap().push(first);},_=>value["presets"][0]["review"]["sourceFiles"][0]["module"]=json!("../outside")};assert!(ReviewedRegistry::from_packaged_json(&value.to_string()).is_err(),"{mutation}");}}
 #[test]fn backend_source_review_uses_the_selected_declarative_source_hash(){let mut f=crate::comfy_preset_test_fixture::fixture("image",0);let bytes=b"# synthetic CPU source; never executed\n";let hash=policy::sha(bytes);f.preset.review["sourceFiles"][0]["sha256"]=json!(hash);for pin in f.preset.review["reviewedNodes"].as_object_mut().unwrap().values_mut(){pin["sourceSha256"]=json!(hash);}let registry=registry(f.preset);let plan=registry.backend_plan(&[]).unwrap();let root=tempfile::tempdir().unwrap();std::fs::write(root.path().join("nodes.py"),bytes).unwrap();assert!(crate::comfy_owned_backend::reviewed_sources_for_review(root.path(),&plan.review).is_ok());std::fs::write(root.path().join("nodes.py"),b"changed").unwrap();assert!(crate::comfy_owned_backend::reviewed_sources_for_review(root.path(),&plan.review).unwrap_err().contains("source_review_mismatch"));}
}
