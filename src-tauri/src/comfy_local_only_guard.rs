//! 입력 검사만으로 커스텀 노드 내부 fallback을 보장하지 않도록 정적 검사와 실행 거부를 분리합니다.
use std::{collections::HashSet,fs,io::Read,path::{Component,Path,PathBuf}};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::{Res,err,comfy_generation::InputBinding,comfy_preset_policy::{sha,value_sha}};

#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct BundleFile {relative_path:String,sha256:String,bytes:u64}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Bundle {registered_bundle_id:String,role:String,exact_real_path:String,tree_sha256:String,files:Vec<BundleFile>}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Enforcement {missing_asset:String,download:String,remote_fallback:String,external_network:String,arbitrary_paths:String,model_directory_writes:String,trust_remote_code:bool,loras:String,credentials:String,native_guard_sha256:String}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct LocalPolicy {schema_version:u32,policy_version:String,policy_id:String,project_id:String,model_rule_id:String,node_id:String,class_type:String,python_module:String,node_source_sha256:String,exact_package_version:String,workflow_sha256:String,v1_selection_sha256:String,bundles:Vec<Bundle>,required_enforcement:Enforcement}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LocalInspectionRequest {policy_id:String,project_id:String,workflow_path:String,selection_envelope:Value,bindings:Vec<InputBinding>}

fn valid_sha(v:&str)->bool {v.len()==64 && v.bytes().all(|b|b.is_ascii_digit() || (b'a'..=b'f').contains(&b))}
fn safe_relative(v:&str)->bool {
    !v.is_empty() && v.is_ascii() && !v.bytes().any(|b|b<32) && !v.contains([':', '\\', '%','{','}']) && !v.starts_with('/') && v.split('/').all(|part|!part.is_empty() && part!="." && part!=".." && !part.ends_with(['.',' ']) && !["con","prn","aux","nul","com1","com2","com3","com4","com5","com6","com7","com8","com9","lpt1","lpt2","lpt3","lpt4","lpt5","lpt6","lpt7","lpt8","lpt9"].contains(&part.split('.').next().unwrap_or("").to_ascii_lowercase().as_str()))
}
fn safe_local_root(v:&str)->bool {
    Path::new(v).is_absolute() && !v.starts_with(['\\','/']) && !v.contains("://") && !v.contains(['%','{','}','\0']) && v.replace('\\',"/").split('/').all(|p|p!="..")
}
fn normalized_path(p:&Path)->String {
    let text=p.to_string_lossy().replace('\\',"/");
    let text=text.strip_prefix("//?/").unwrap_or(&text);
    if cfg!(windows){text.to_ascii_lowercase()}else{text.into()}
}
fn reject_reparse(path:&Path)->Res<()> {
    let mut prefix=PathBuf::new();
    for component in path.components(){prefix.push(component.as_os_str());if matches!(component,Component::Prefix(_)|Component::RootDir){continue;}
        let meta=fs::symlink_metadata(&prefix).map_err(|e|err("native_local_bundle_missing",e))?;
        if meta.file_type().is_symlink(){return Err("native_local_reparse_path_forbidden".into());}
        #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("native_local_reparse_path_forbidden".into());}}
    }Ok(())
}
fn hash_exact_file(path:&Path,expected:&BundleFile)->Res<()> {
    reject_reparse(path)?;
    let before=fs::metadata(path).map_err(|e|err("native_local_bundle_missing",e))?;
    if !before.is_file() || before.len()!=expected.bytes || expected.bytes==0{return Err("native_local_file_size_mismatch".into());}
    let mut file=fs::File::open(path).map_err(|e|err("native_local_file_open",e))?;let mut hasher=Sha256::new();let mut buffer=[0u8;65536];
    loop{let n=file.read(&mut buffer).map_err(|e|err("native_local_file_read",e))?;if n==0{break;}hasher.update(&buffer[..n]);}
    if format!("{:x}",hasher.finalize())!=expected.sha256{return Err("native_local_file_full_hash_mismatch".into());}
    let after=fs::metadata(path).map_err(|e|err("native_local_file_stat",e))?;
    if before.len()!=after.len() || before.modified().ok()!=after.modified().ok(){return Err("native_local_file_changed_during_check".into());}Ok(())
}
fn exact_tree(root:&Path,allowed:&HashSet<String>)->Res<()> {
    let mut pending=vec![root.to_path_buf()];let mut found=HashSet::new();let mut visited=0;
    while let Some(dir)=pending.pop(){for entry in fs::read_dir(&dir).map_err(|e|err("native_local_tree_read",e))?{
        let entry=entry.map_err(|e|err("native_local_tree_read",e))?;let path=entry.path();visited+=1;if visited>8192{return Err("native_local_tree_size_limit".into());}reject_reparse(&path)?;
        let kind=entry.file_type().map_err(|e|err("native_local_tree_stat",e))?;
        if kind.is_dir(){pending.push(path);}else if kind.is_file(){let name=path.strip_prefix(root).map_err(|_|"native_local_external_path_forbidden")?.to_string_lossy().replace('\\',"/");if !allowed.contains(&name){return Err("native_local_unreviewed_bundle_file".into());}found.insert(name);}else{return Err("native_local_special_file_forbidden".into());}
    }}if found!=*allowed{return Err("native_local_bundle_file_missing".into());}Ok(())
}
pub(crate) fn inspect_bundle(bundle:&Bundle)->Res<Value> {
    if bundle.registered_bundle_id.is_empty() || !["diffusers-model","tts-model","tts-tokenizer"].contains(&bundle.role.as_str()) || !safe_local_root(&bundle.exact_real_path) || !valid_sha(&bundle.tree_sha256) || bundle.files.is_empty() || bundle.files.len()>2048{return Err("native_local_bundle_policy_invalid".into());}
    let root=PathBuf::from(&bundle.exact_real_path);reject_reparse(&root)?;let real=fs::canonicalize(&root).map_err(|e|err("native_local_bundle_missing",e))?;
    if normalized_path(&real)!=normalized_path(&root){return Err("native_local_exact_real_path_mismatch".into());}
    let mut seen=HashSet::new();let mut allowed=HashSet::new();
    for file in &bundle.files {
        let lower=file.relative_path.to_ascii_lowercase();let extension=lower.rsplit('.').next().unwrap_or("");
        if !safe_relative(&file.relative_path) || !["safetensors","json","txt","model"].contains(&extension) || lower.split('/').any(|part|[".git",".env",".hf_token","token","credentials"].iter().any(|v|part==*v || part.starts_with(&format!("{v}.")))) || !valid_sha(&file.sha256) || !seen.insert(lower){return Err("native_local_unsafe_or_duplicate_bundle_file".into());}
        allowed.insert(file.relative_path.clone());hash_exact_file(&root.join(&file.relative_path),file)?;
    }
    let mut sorted=bundle.files.clone();sorted.sort_by(|a,b|a.relative_path.cmp(&b.relative_path));
    // 파일·필드 순서를 고정한 export digest만 채택하여 다른 직렬화 규약으로 자동 우회하지 않습니다.
    if sha(&serde_json::to_vec(&sorted).map_err(|e|err("native local tree hash",e))?)!=bundle.tree_sha256{return Err("native_local_tree_hash_or_serializer_mismatch".into());}
    exact_tree(&root,&allowed)?;
    Ok(json!({"registeredBundleId":bundle.registered_bundle_id,"role":bundle.role,"treeSha256":bundle.tree_sha256,"fullFileHashes":"passed","directoryWrites":0,"downloads":0}))
}

fn validate_enforcement(policy:&LocalPolicy)->Res<()> {
    let e=&policy.required_enforcement;
    if policy.schema_version!=2 || policy.policy_version!="native-local-only-v1" || policy.policy_id.is_empty() || policy.project_id.is_empty() || policy.model_rule_id.is_empty() || !valid_sha(&policy.node_source_sha256) || !valid_sha(&policy.workflow_sha256) || !valid_sha(&policy.v1_selection_sha256) || policy.exact_package_version.is_empty() || !valid_sha(&e.native_guard_sha256)
        || e.missing_asset!="fail-before-model-load" || e.download!="forbidden" || e.remote_fallback!="forbidden" || e.external_network!="deny" || e.arbitrary_paths!="forbidden" || e.model_directory_writes!="deny" || e.trust_remote_code || e.loras!="disabled" || e.credentials!="preserve-no-export" {return Err("native_local_required_enforcement_invalid".into());}
    Ok(())
}
pub(crate) fn inspect_policy(policy:&LocalPolicy,bytes:&[u8],envelope:&Value,bindings:&[InputBinding])->Res<Value> {
    validate_enforcement(policy)?;
    if bytes.len()>8*1024*1024 || sha(bytes)!=policy.workflow_sha256{return Err("native_local_exact_workflow_mismatch".into());}
    let legacy=envelope["originalV1SelectionJson"].as_str().ok_or("native_local_explicit_migration_required")?;
    if envelope["schemaVersion"]!=2 || legacy.len()>256000 || sha(legacy.as_bytes())!=policy.v1_selection_sha256 || envelope["originalV1SelectionSha256"]!=policy.v1_selection_sha256 || envelope["migration"]["legacySelectionSha256"]!=policy.v1_selection_sha256 || envelope["migration"]["fromSchemaVersion"]!=1 || envelope["migration"]["serializer"]!="exact-json-text-sha256" || serde_json::from_str::<Value>(legacy).map_err(|e|err("local legacy selection",e))?!=envelope["base"] {return Err("native_local_explicit_migration_required".into());}
    if !envelope["base"]["promptRoles"].as_array().is_some_and(|roles|roles.iter().any(|r|r["id"]==envelope["base"]["selectedPromptRoleId"] && r["modelRuleId"]==policy.model_rule_id)){return Err("native_local_model_role_mismatch".into());}
    let mut graph:Value=serde_json::from_slice(bytes).map_err(|e|err("native local graph",e))?;
    crate::comfy_preset_policy::reject_credentials(&graph)?;
    let mut seen=HashSet::new();
    for binding in bindings {
        if !seen.insert((&binding.node_id,&binding.input)) || binding.file_path.is_some(){return Err("native_local_reference_or_duplicate_binding_requires_admission".into());}
        let inputs=graph[&binding.node_id]["inputs"].as_object_mut().ok_or("native_local_binding_node_missing")?;
        let original=inputs.get(&binding.input).ok_or("native_local_binding_missing")?;
        if !(original.is_string() || original.is_number() || original.is_boolean()) || ["auto_download","allow_download","download_if_missing","model_selection","custom_model_path","model_choice","trust_remote_code"].contains(&binding.input.as_str()) || binding.input.starts_with("lora") {return Err("native_local_fixed_model_control_override_forbidden".into());}
        let value=binding.value.as_ref().ok_or("native_local_scalar_binding_required")?;
        if !(value.is_string() || value.is_number() || value.is_boolean()){return Err("native_local_scalar_binding_required".into());}inputs.insert(binding.input.clone(),value.clone());
    }
    let node=&graph[&policy.node_id];if node["class_type"]!=policy.class_type{return Err("native_local_exact_node_required".into());}let inputs=&node["inputs"];
    for node in graph.as_object().ok_or("native_local_api_graph_required")?.values(){for (key,value) in node["inputs"].as_object().ok_or("native_local_api_graph_required")?{
        if ["auto_download","allow_download","download_if_missing","trust_remote_code"].contains(&key.as_str()) && value!=false{return Err("native_local_download_or_remote_code_forbidden".into());}
        if ["repository","repo_id","model_url","token","api_key","hf_repo","pretrained_model_name_or_path","remote_model_id","download_repo"].contains(&key.as_str()) || (key=="local_files_only"&&value!=true) {return Err("native_local_unreviewed_remote_fallback_forbidden".into());}
        if (key.contains("path") || key.ends_with("directory") || key.ends_with("_dir") || key.ends_with("_url")) && value.as_str().is_some_and(|v|!v.is_empty()) {
            let exact=policy.class_type=="SDNQSampler"&&key=="custom_model_path"&&value==policy.bundles.first().map(|b|json!(b.exact_real_path)).as_ref().unwrap_or(&Value::Null);
            if !exact {return Err("native_local_unreviewed_external_path_forbidden".into());}
        }
    }}
    if policy.class_type=="SDNQSampler" {
        if policy.bundles.len()!=1 || policy.bundles[0].role!="diffusers-model" || inputs["model_selection"]!="[Custom Path]" || inputs["custom_model_path"]!=policy.bundles[0].exact_real_path || inputs["auto_download"]!=false || inputs["num_frames"]!=1 || inputs["use_quantized_matmul"]!=false || inputs["use_xformers"]!=false {return Err("native_local_sdnq_fixed_local_inputs_required".into());}
        for i in 1..=5{let prefix=if i==1{"lora".into()}else{format!("lora{i}")};if inputs[format!("{prefix}_selection")]!="[None]" || inputs[format!("{prefix}_custom_path")]!="" || inputs[format!("{prefix}_strength")].as_f64()!=Some(0.0){return Err("native_local_sdnq_loras_must_be_disabled".into());}}
    }else {
        let name=match policy.class_type.as_str(){"FB_Qwen3TTSCustomVoice"=>"Qwen3-TTS-12Hz-1.7B-CustomVoice","FB_Qwen3TTSVoiceDesign"=>"Qwen3-TTS-12Hz-1.7B-VoiceDesign","FB_Qwen3TTSVoiceClone"=>"Qwen3-TTS-12Hz-1.7B-Base",_=>return Err("native_local_custom_class_unreviewed".into())};
        let model=policy.bundles.iter().find(|b|b.role=="tts-model").ok_or("native_local_tts_exact_model_tokenizer_required")?;let tokenizer=policy.bundles.iter().find(|b|b.role=="tts-tokenizer").ok_or("native_local_tts_exact_model_tokenizer_required")?;
        if policy.bundles.len()!=2 || inputs["model_choice"]!="1.7B" || Path::new(&model.exact_real_path).file_name().and_then(|n|n.to_str())!=Some(name) || Path::new(&tokenizer.exact_real_path).file_name().and_then(|n|n.to_str())!=Some("Qwen3-TTS-Tokenizer-12Hz"){return Err("native_local_tts_exact_model_tokenizer_required".into());}
    }
    let bundles=policy.bundles.iter().map(inspect_bundle).collect::<Res<Vec<_>>>()?;
    Ok(json!({"policySatisfied":"static-input-and-file-checks-only","policySha256":value_sha(&serde_json::to_value(policy).map_err(|e|err("local policy",e))?)?,"workflowSha256":policy.workflow_sha256,"bindingSha256":value_sha(&serde_json::to_value(bindings).map_err(|e|err("local bindings",e))?)?,"bundles":bundles,"executionAdmission":false,"blockers":["custom-node-loaded-source-package-attestation-required","custom-node-outbound-and-model-directory-write-process-enforcement-missing","custom-node-remote-from-pretrained-fallback-not-proven-local-only","custom-node-exact-bundle-tree-license-or-project-authorization-evidence-required"],"modelLoads":0,"downloads":0,"directoryWrites":0}))
}

fn trusted_policy(settings:&Value,id:&str,project:&str)->Res<LocalPolicy> {
    let policies=settings.pointer("/entries/workflow-native-local-only-policies/value").and_then(Value::as_array).ok_or("native_local_trusted_project_policy_missing")?;
    let matches=policies.iter().filter(|p|p["policyId"]==id && p["projectId"]==project).collect::<Vec<_>>();
    if matches.len()!=1{return Err("native_local_trusted_policy_missing_revoked_or_ambiguous".into());}
    serde_json::from_value(matches[0].clone()).map_err(|_|"native_local_trusted_policy_invalid".into())
}
/// 업로드 graph의 policy/facts를 믿지 않도록 앱의 프로젝트 기록에서만 정책을 읽습니다.
#[tauri::command]
pub async fn comfy_inspect_native_local_only(app:tauri::AppHandle,request:LocalInspectionRequest)->Res<Value> {
    let store=app.path().app_data_dir().map_err(|e|err("local policy store",e))?.join("app-settings.json");
    tauri::async_runtime::spawn_blocking(move||{
        let settings:Value=serde_json::from_slice(&fs::read(store).map_err(|e|err("local policy store",e))?).map_err(|e|err("local policy store",e))?;
        let policy=trusted_policy(&settings,&request.policy_id,&request.project_id)?;
        let mut bytes=Vec::new();fs::File::open(&request.workflow_path).map_err(|e|err("local graph",e))?.take(8*1024*1024+1).read_to_end(&mut bytes).map_err(|e|err("local graph",e))?;
        inspect_policy(&policy,&bytes,&request.selection_envelope,&request.bindings)
    }).await.map_err(|e|err("local CPU inspection",e))?
}

#[cfg(test)]
#[path="comfy_local_only_guard_tests.rs"]
mod tests;
