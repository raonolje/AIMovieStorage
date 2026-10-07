//! 설치 여부로 실행을 허용하지 않도록 앱에 포함된 preset 검토와 실행 증거를 함께 비교합니다.
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::{err, Res, comfy_admission::AdmissionRequest};

const BLOCKED: &str = include_str!("../resources/comfy-blocked-preset-catalog.json");

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct ReviewedPreset {
    pub schema_version: u32,
    pub id: String,
    pub review_revision: String,
    pub graph_sha256: String,
    pub graph: Value,
    pub selection: Value,
    pub model_rule_id: String,
    pub role_id: String,
    pub operation: String,
    pub output_kind: String,
    pub registration_kinds: Vec<String>,
    pub custom_node_policy: String,
    pub download_policy: String,
    pub fixed_reference_count: usize,
    pub review: Value,
    pub weights: Vec<ReviewedWeight>,
    pub bindings: Vec<BindingRule>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct ReviewedWeight {
    pub node_id: String, pub input: String, pub category: String,
    pub name: String, pub sha256: String, pub kind: String, pub public_license: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct BindingRule {
    pub slot_id: String, pub node_id: String, pub input: String,
    pub semantic: String, pub rule: ScalarRule,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag="type", rename_all="camelCase", deny_unknown_fields)]
pub(crate) enum ScalarRule {
    Text { min: usize, max: usize },
    Lyrics { max: usize },
    Number { min: f64, max: f64, #[serde(rename="minExclusive")] min_exclusive: bool, integer: bool },
    Unsigned,
    Choice { values: Vec<Value> },
    Reference { #[serde(rename="mediaKind")] media_kind: String },
}

pub(crate) fn sha(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
pub(crate) fn value_sha(value: &Value) -> Res<String> {
    Ok(sha(&serde_json::to_vec(value).map_err(|e|err("workflow evidence hash",e))?))
}
pub(crate) fn valid_sha(value: &str) -> bool {
    value.len()==64 && value.bytes().all(|b|b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(crate) fn source_identity(owned:&Value)->Value {let mut identity=json!({"managerPid":owned["managerPid"],"launcherPid":owned["launcherPid"],"serverPid":owned["serverPid"],"nonce":owned["nonce"],"coreCommit":owned["coreCommit"],"sourceFingerprint":owned["sourceFingerprint"],"bootstrapSha256":owned["bootstrapSha256"],"baseUrl":owned["baseUrl"]});if !owned["registrySha256"].is_null(){identity["registrySha256"]=owned["registrySha256"].clone();identity["reviewedPresetIds"]=owned["reviewedPresetIds"].clone();}identity}
fn nonempty(value: &Value) -> bool { value.as_str().is_some_and(|v|!v.trim().is_empty()) }
pub(crate) fn reject_credentials(value:&Value)->Res<()> {
    match value {
        Value::Object(fields)=>for (key,value) in fields {
            let key=key.to_ascii_lowercase().replace(['_','-'],"");
            if ["apikey","password","clientsecret","secret","accesstoken","refreshtoken","bearertoken","credential","credentials","token"].contains(&key.as_str()) || (key=="authorization" && value.is_string()) {return Err("workflow_credentials_forbidden_in_manifest_or_provenance".into());}
            reject_credentials(value)?;
        },
        Value::Array(items)=>for item in items {reject_credentials(item)?;},
        _=>{},
    }Ok(())
}

/// 업로드 JSON과 디스크의 디자인 catalog는 이 함수의 allowlist로 채택하지 않습니다.
pub(crate) fn runtime_preset(graph_sha256: &str) -> Res<ReviewedPreset> {
    if let Ok(preset)=crate::comfy_reviewed_registry::packaged()?.resolve(graph_sha256){return Ok(preset);}
    let conditional:Value=serde_json::from_str(include_str!("../resources/comfy-v2-conditional-contract-review.json")).map_err(|e|err("workflow conditional presets",e))?;
    if let Some(item)=conditional["entries"].as_array().and_then(|items|items.iter().find(|item|item["workflowSha256"]==graph_sha256)) {
        return Err(format!("workflow_native_preset_not_registered: {}: 이 정확한 graph는 앱의 검토된 실행 registry에 미등록입니다. 검토된 선언형 preset을 패키징한 뒤 source/schema·weight·참조·프로젝트 허가 증거를 각각 확인해야 합니다.",item["id"].as_str().unwrap_or("unknown")));
    }
    let blocked: Value=serde_json::from_str(BLOCKED).map_err(|e|err("workflow blocked catalog",e))?;
    if let Some(item)=blocked["presets"].as_array().and_then(|items|items.iter().find(|item|item["graphSha256"]==graph_sha256)) {
        let reasons=item["blockers"].as_array().map(|items|items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        return Err(format!("workflow_native_preset_execution_review_required: {}: {reasons}",item["id"].as_str().unwrap_or("unknown")));
    }
    Err("workflow_native_execution_review_required: 선택한 그래프의 native preset 검토가 없습니다.".into())
}

fn selection_shape(selection: &Value) -> Value {
    let mut shape=selection.clone();
    if let Some(slots)=shape["slots"].as_array_mut() {
        for slot in slots { if let Some(slot)=slot.as_object_mut() { slot.remove("defaultValue"); } }
    }
    shape
}

pub(crate) fn validate_policy(preset: &ReviewedPreset) -> Res<()> {
    if preset.selection["slots"].as_array().is_some_and(|slots|slots.iter().any(|slot|slot["semantic"]=="maskVideo")){return Err("workflow_mask_video_unsupported".into());}
    if preset.schema_version!=1 || preset.id.is_empty() || preset.review_revision.is_empty()
        || !valid_sha(&preset.graph_sha256) || preset.custom_node_policy!="forbidden" || preset.download_policy!="forbidden" {
        return Err("workflow_native_preset_policy_invalid".into());
    }
    let graph=preset.graph.as_object().filter(|g|!g.is_empty()).ok_or("workflow_native_preset_graph_invalid")?;
    let roles=preset.selection["promptRoles"].as_array().ok_or("workflow_native_prompt_roles_missing")?;
    let selected=roles.iter().find(|role|role["id"]==preset.role_id).ok_or("workflow_native_prompt_role_invalid")?;
    if selected["modelRuleId"]!=preset.model_rule_id||preset.selection["selectedPromptRoleId"]!=preset.role_id{return Err("workflow_native_prompt_target_changed".into());}
    let mut role_ids=HashSet::new();let mut prompt_slots=HashSet::new();
    for role in roles {let id=role["id"].as_str().filter(|s|!s.is_empty()).ok_or("workflow_native_prompt_role_invalid")?;if !role_ids.insert(id){return Err("workflow_native_prompt_role_duplicate".into());}
      if role["modelRuleId"]!=preset.model_rule_id{return Err("workflow_native_mixed_model_roles_unsupported: 역할별 다른 모델과 shared weight 허가 연결은 별도 검토 정책이 필요합니다.".into());}
      for semantic in ["positive","negative"] {let ids=role[if semantic=="positive"{"positiveSlotIds"}else{"negativeSlotIds"}].as_array().ok_or("workflow_native_prompt_role_invalid")?;if semantic=="positive"&&ids.is_empty(){return Err("workflow_native_prompt_role_invalid".into());}for slot in ids{let slot=slot.as_str().ok_or("workflow_native_prompt_slot_invalid")?;if !prompt_slots.insert(slot)||!preset.bindings.iter().any(|binding|binding.slot_id==slot&&binding.semantic==semantic){return Err("workflow_native_prompt_slot_role_ambiguous".into());}}}
      let loaders=role["loaderNodeIds"].as_array().filter(|nodes|!nodes.is_empty()).ok_or("workflow_native_prompt_loader_missing")?;for loader in loaders{let loader=loader.as_str().ok_or("workflow_native_prompt_loader_missing")?;if !preset.weights.iter().any(|weight|weight.node_id==loader&&preset.review["reviewedNodes"][graph[loader]["class_type"].as_str().unwrap_or("")]["assets"][&weight.input]["promptModel"]==true){return Err("workflow_native_prompt_loader_missing".into());}}
    }
    let mut fields=HashSet::new();
    let mut slots=HashSet::new();
    let mut refs=0;
    for rule in &preset.bindings {
        if !fields.insert((&rule.node_id,&rule.input)) || !slots.insert(&rule.slot_id) { return Err("workflow_native_preset_duplicate_field".into()); }
        let original=graph.get(&rule.node_id).and_then(|n|n["inputs"].get(&rule.input)).ok_or("workflow_native_preset_field_missing")?;
        if !(original.is_string() || original.is_number() || original.is_boolean()) { return Err("workflow_native_preset_link_override_forbidden".into()); }
        let selected_slot=preset.selection["slots"].as_array().and_then(|slots|slots.iter().find(|slot|slot["id"]==rule.slot_id)).ok_or("workflow_native_preset_slot_missing")?;
        if selected_slot["semantic"]!=rule.semantic||selected_slot["nodeId"]!=rule.node_id||selected_slot["input"]!=rule.input||(["positive","negative"].contains(&rule.semantic.as_str())&&!prompt_slots.contains(rule.slot_id.as_str())){return Err("workflow_native_preset_slot_semantic_changed".into());}
        if let ScalarRule::Reference{media_kind}=&rule.rule{if crate::comfy_reference_contract::media_kind(&rule.semantic)!=Some(media_kind.as_str()){return Err("workflow_native_reference_semantic_kind_mismatch".into());}}
        if matches!(rule.rule,ScalarRule::Reference{..}) { refs+=1; }
    }
    if refs!=preset.fixed_reference_count { return Err("workflow_native_preset_reference_variant_invalid".into()); }
    let groups=preset.selection["referenceGroups"].as_array().ok_or("workflow_native_preset_reference_groups_missing")?;
    let mut grouped=HashSet::new();
    for group in groups {
        let ids=group["slotIds"].as_array().ok_or("workflow_native_preset_reference_variant_invalid")?;
        if group["strategy"]!="fixed-slots" || group["order"]!="explicit" || group["minItems"].as_u64()!=Some(ids.len() as u64) || group["maxItems"].as_u64()!=Some(ids.len() as u64) {
            return Err("workflow_native_reference_requires_reviewed_fixed_variant".into());
        }
        for id in ids {
            let id=id.as_str().ok_or("workflow_native_preset_reference_variant_invalid")?;
            if !grouped.insert(id) || !preset.bindings.iter().any(|r|r.slot_id==id && matches!(&r.rule,ScalarRule::Reference{media_kind} if group["mediaKind"]==*media_kind) && group["role"]==r.semantic) {
                return Err("workflow_native_preset_reference_variant_invalid".into());
            }
        }
    }
    if grouped.len()!=refs { return Err("workflow_native_preset_reference_variant_invalid".into()); }
    for (id,node) in graph {
        let class=node["class_type"].as_str().ok_or("workflow_native_preset_class_missing")?;
        let pin=&preset.review["reviewedNodes"][class];
        let module=pin["pythonModule"].as_str().ok_or("workflow_native_node_review_missing")?;
        if module!="nodes" && !module.starts_with("comfy_extras.") { return Err("workflow_native_custom_node_forbidden".into()); }
        if !valid_sha(pin["sourceSha256"].as_str().unwrap_or("")) || !valid_sha(preset.review["schemaFingerprints"][class].as_str().unwrap_or("")) { return Err("workflow_native_node_review_missing".into()); }
        for (input,value) in node["inputs"].as_object().ok_or("workflow_native_preset_inputs_invalid")? {
            if ["auto_download","download_if_missing","allow_download"].contains(&input.as_str()) && value!=&json!(false) { return Err("workflow_native_auto_download_forbidden".into()); }
            if let Some(asset)=pin["assets"].get(input) {
                if !preset.weights.iter().any(|w|w.node_id==*id && w.input==*input && w.category==asset["category"] && w.kind==asset["kind"] && value==&json!(w.name) && valid_sha(&w.sha256)) {
                    return Err("workflow_native_unknown_weight_forbidden".into());
                }
                if fields.contains(&(id,input)) { return Err("workflow_native_weight_override_forbidden".into()); }
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_trusted_grants(preset: &ReviewedPreset,manifest: &Value,trusted: &[Value]) -> Res<()> {
    let project=manifest["projectId"].as_str().filter(|s|!s.is_empty()).ok_or("workflow_trusted_project_required")?;
    let grants=manifest["weightAuthorizations"].as_array().ok_or("workflow_manifest_authorizations_missing")?;
    let mut seen=HashSet::new();
    let required=preset.weights.iter().map(|w|(&w.category,&w.name,&w.sha256)).collect::<HashSet<_>>();
    if grants.len()!=required.len() { return Err("workflow_project_authorization_untrusted_or_revoked".into()); }
    for grant in grants {
        let key=(grant["category"].as_str().unwrap_or(""),grant["name"].as_str().unwrap_or(""),grant["sha256"].as_str().unwrap_or(""));
        if !seen.insert(key) || grant["kind"]!="user-reported" || grant["projectId"]!=project || grant["modelRuleId"]!=preset.model_rule_id
            || !nonempty(&grant["evidence"]) || !nonempty(&grant["sourceThreadId"]) || !nonempty(&grant["reportedAtUtc"])
            || !trusted.contains(grant) || !preset.weights.iter().any(|w|grant["category"]==w.category && grant["name"]==w.name && grant["sha256"]==w.sha256) {
            return Err("workflow_project_authorization_untrusted_or_revoked".into());
        }
    }
    Ok(())
}

/// native_facts는 네이티브가 확인한 등록 파일 기록만 받습니다. 요청의 decodable 플래그는 채택하지 않습니다.
pub(crate) fn validate_preset(preset: &ReviewedPreset,request: &AdmissionRequest,graph_bytes: &[u8],owned: &Value,native_facts: &[Value]) -> Res<Value> {
    if owned["identityContractVersion"]!=2 || owned["serverPid"].as_u64().is_none_or(|p|p==0) || owned["managerPid"]!=std::process::id() {
        return Err("owned_backend_identity_not_ready".into());
    }
    if owned["sourceEvidence"]!="owned-child-attestation" || !valid_sha(owned["sourceFingerprint"].as_str().unwrap_or("")) || !valid_sha(owned["bootstrapSha256"].as_str().unwrap_or("")) || !nonempty(&owned["nonce"]) || owned["baseUrl"]!=request.base_url {
        return Err("workflow_loaded_source_attestation_required".into());
    }
    validate_policy(preset)?;
    let manifest=&request.manifest;
    let provenance=&request.provenance;
    if ![Some(1),Some(2)].contains(&manifest["schemaVersion"].as_u64()) {return Err("workflow_native_contract_version_unsupported".into());}
    reject_credentials(manifest)?;reject_credentials(provenance)?;
    if request.manifest_json.len()>2*1024*1024 || serde_json::from_str::<Value>(&request.manifest_json).map_err(|e|err("workflow manifest JSON",e))?!=*manifest || sha(request.manifest_json.as_bytes())!=provenance["manifestSha256"].as_str().unwrap_or("") {
        return Err("workflow_native_manifest_hash_mismatch".into());
    }
    if request.expected_workflow_sha256!=preset.graph_sha256 || manifest["workflowSha256"]!=preset.graph_sha256 || provenance["workflowSha256"]!=preset.graph_sha256 || sha(graph_bytes)!=preset.graph_sha256 {
        return Err("workflow_changed".into());
    }
    if serde_json::from_slice::<Value>(graph_bytes).map_err(|e|err("workflow admission JSON",e))?!=preset.graph { return Err("workflow_fixed_graph_changed".into()); }
    let target=&manifest["promptTarget"];
    if target["kind"]!="workflow" || target["modelRuleId"]!=preset.model_rule_id || target["roleId"]!=preset.role_id || target["workflowId"]!=manifest["workflowId"] || target["workflowSha256"]!=preset.graph_sha256
        || manifest["operation"]!=preset.operation || manifest["outputKind"]!=preset.output_kind || selection_shape(&manifest["selection"])!=preset.selection {
        return Err("workflow_native_role_or_input_variant_mismatch".into());
    }
    if manifest["modelIds"]!=json!([preset.model_rule_id]) || manifest["promptProfile"]!=preset.model_rule_id || manifest["workflowPath"]!=request.workflow_path {return Err("workflow_native_source_model_or_path_stale".into());}
    for field in ["comfyVersion","reviewVersion","pythonVersion","torchVersion"] {
        if manifest["environment"][field]!=preset.review[field] { return Err(format!("workflow_native_environment_changed: {field}")); }
    }
    if manifest["environment"]["coreCommit"]!=owned["coreCommit"] || owned["coreCommit"]!=preset.review["diskCoreCommit"] || manifest["environment"]["customNodeVersions"]!=json!({}) {
        return Err("workflow_native_environment_changed".into());
    }
    for source in preset.review["sourceFiles"].as_array().ok_or("workflow_native_source_review_missing")? {
        let module=source["module"].as_str().ok_or("workflow_native_source_review_missing")?;
        if owned["nodeSourceHashes"][module]!=source["sha256"] { return Err(format!("workflow_native_loaded_source_mismatch: {module}")); }
    }
    let needs=manifest["nodeRequirements"].as_array().ok_or("workflow_native_node_requirements_missing")?;
    let graph=preset.graph.as_object().ok_or("workflow_native_preset_graph_invalid")?;
    if needs.len()!=graph.len() { return Err("workflow_native_node_requirements_changed".into()); }
    for (id,node) in graph {
        let class=node["class_type"].as_str().ok_or("workflow_native_preset_class_missing")?;
        let pin=&preset.review["reviewedNodes"][class];
        if needs.iter().filter(|need|need["nodeId"]==id.as_str() && need["classType"]==class && need["pythonModule"]==pin["pythonModule"] && need["reviewId"]==pin["reviewId"] && need["sourceSha256"]==pin["sourceSha256"] && need["schemaSha256"]==preset.review["schemaFingerprints"][class]).count()!=1 {
            return Err("workflow_native_node_or_schema_mismatch".into());
        }
    }
    let weights=manifest["weightRequirements"].as_array().ok_or("workflow_manifest_weights_missing")?;
    let verified=owned["weights"].as_array().ok_or("workflow_native_weight_record_missing")?;
    let grants=manifest["weightAuthorizations"].as_array().ok_or("workflow_manifest_authorizations_missing")?;
    if weights.len()!=preset.weights.len() { return Err("workflow_native_unknown_weight_forbidden".into()); }
    for weight in &preset.weights {
        let matches=|w:&Value|w["category"]==weight.category && w["name"]==weight.name && w["sha256"]==weight.sha256;
        let grant=grants.iter().find(|g|matches(g) && g["projectId"]==manifest["projectId"] && g["modelRuleId"]==preset.model_rule_id && g["kind"]=="user-reported").ok_or("workflow_project_authorization_required")?;
        if verified.iter().filter(|w|matches(w)).count()!=1 || weights.iter().filter(|w|matches(w) && w["nodeId"]==weight.node_id && w["input"]==weight.input && w["kind"]==weight.kind && w["license"]=="allowed" && w["publicLicense"]==weight.public_license && w["authorization"]==*grant).count()!=1 {
            return Err("workflow_native_weight_mismatch".into());
        }
    }
    for field in ["promptTarget","projectId","weightAuthorizations","verification"] {
        if provenance[field]!=manifest[field] { return Err("workflow_native_provenance_mismatch".into()); }
    }
    if manifest.pointer("/verification/static")!=Some(&json!("passed")) || manifest.pointer("/verification/installedRequirements")!=Some(&json!("passed")) || manifest.pointer("/verification/actualGenerationRegistration")!=Some(&json!("not-run")) || manifest.pointer("/verification/executionAdmission")!=Some(&json!("required")) {
        return Err("workflow_native_provenance_mismatch".into());
    }
    if request.destination["kind"]!=preset.output_kind || !preset.registration_kinds.iter().any(|kind|request.destination["assetType"]==*kind) || !nonempty(&request.destination["baseDirectory"]) || !nonempty(&request.destination["projectName"]) {
        return Err("workflow_native_registration_kind_mismatch".into());
    }
    let assets=provenance["assets"].as_array().ok_or("workflow_native_reference_provenance_missing")?;
    if assets.len()!=preset.fixed_reference_count || native_facts.len()!=preset.fixed_reference_count { return Err("workflow_native_registered_reference_fact_required".into()); }
    for group in preset.selection["referenceGroups"].as_array().ok_or("workflow_native_preset_reference_groups_missing")? {
        let mut unique=HashSet::new();
        for id in group["slotIds"].as_array().ok_or("workflow_native_reference_variant_mismatch")? {
            let asset=assets.iter().find(|a|a["slotId"]==*id).ok_or("workflow_native_reference_provenance_missing")?;
            if !unique.insert(asset["assetId"].as_str().ok_or("workflow_native_reference_provenance_missing")?) {return Err("workflow_native_reference_replication_forbidden".into());}
        }
    }
    crate::comfy_prompt_roles::validate_bodies(&preset.selection,target,provenance)?;
    let values=provenance["values"].as_object().ok_or("workflow_native_binding_provenance_missing")?;
    if request.bindings.len()!=preset.bindings.len() || values.len()!=preset.bindings.len()-preset.fixed_reference_count { return Err("workflow_native_required_bindings_mismatch".into()); }
    let mut seen=HashSet::new();
    for binding in &request.bindings {
        if !seen.insert((&binding.node_id,&binding.input)) { return Err("workflow_native_duplicate_binding".into()); }
        let rule=preset.bindings.iter().find(|r|r.node_id==binding.node_id && r.input==binding.input).ok_or("workflow_native_unreviewed_binding")?;
        if let ScalarRule::Reference{media_kind}=&rule.rule {
            let path=binding.file_path.as_deref().ok_or("workflow_native_reference_file_required")?;
            let asset=assets.iter().find(|a|a["slotId"]==rule.slot_id).ok_or("workflow_native_reference_provenance_missing")?;
            let facts=native_facts.iter().filter(|fact|fact["slotId"]==rule.slot_id && fact["source"]=="native-registered-file-fact-v1" && fact["projectId"]==manifest["projectId"] && fact["path"]==path && fact["kind"]==*media_kind && fact["assetId"]==asset["assetId"] && fact["sha256"]==asset["sha256"] && valid_sha(fact["sha256"].as_str().unwrap_or("")) && fact["bytes"].as_u64().is_some_and(|n|n>0) && fact["decodable"]==true && fact["fullDecode"]==true).count();
            if binding.value.is_some() || facts!=1 { return Err("workflow_native_registered_reference_fact_mismatch".into()); }
            continue;
        }
        if binding.file_path.is_some() { return Err("workflow_native_reference_variant_mismatch".into()); }
        let value=binding.value.as_ref().ok_or("workflow_native_scalar_required")?;
        let valid=match &rule.rule {
            ScalarRule::Text{min,max}=>value.as_str().is_some_and(|v|v.trim().len()>=*min && v.len()<=*max),
            ScalarRule::Lyrics{max}=>value.as_str().is_some_and(|v|v=="[Instrumental]" || (!v.trim().is_empty() && v.len()<=*max && v.trim_end().ends_with("\n[end]") && v.matches("[end]").count()==1)),
            ScalarRule::Number{min,max,min_exclusive,integer}=>value.as_f64().is_some_and(|v|v.is_finite() && (v>*min || (!min_exclusive && v==*min)) && v<=*max && (!integer || v.fract()==0.0)),
            ScalarRule::Unsigned=>value.as_u64().is_some(),
            ScalarRule::Choice{values}=>values.contains(value),
            ScalarRule::Reference{..}=>false,
        };
        if !valid { return Err(format!("workflow_native_binding_outside_review: {}.{}",binding.node_id,binding.input)); }
        if values.get(&rule.slot_id)!=Some(value) || (["positive","negative"].contains(&rule.semantic.as_str()) && value.as_str()!=Some(crate::comfy_prompt_roles::slot_body(&preset.selection,target,provenance,&rule.slot_id,&rule.semantic)?.as_str())) {
            return Err("workflow_native_binding_provenance_mismatch".into());
        }
    }

    crate::comfy_reference_contract::validate_constraints(&preset.selection,provenance,native_facts,&preset.graph,&request.bindings)?;
    let contract=crate::comfy_contract_v2_guard::validate_preset_contract(preset,request,graph_bytes,owned,native_facts)?;
    let identity=source_identity(owned);
    Ok(json!({"schemaVersion":1,"contractVersion":manifest["schemaVersion"],"contract":contract,"presetId":preset.id,"reviewRevision":preset.review_revision,"policySha256":value_sha(&serde_json::to_value(preset).map_err(|e|err("workflow preset hash",e))?)?,"workflowSha256":preset.graph_sha256,"manifestSha256":provenance["manifestSha256"],"sourceIdentitySha256":value_sha(&identity)?,"coreCommit":owned["coreCommit"],"sourceFingerprint":owned["sourceFingerprint"],"projectId":manifest["projectId"],"promptTarget":target,"outputKind":preset.output_kind,"registrationKind":request.destination["assetType"],"authorizationSha256":value_sha(&manifest["weightAuthorizations"])?,"referenceFactsSha256":value_sha(&json!(native_facts))?,"bindingsSha256":value_sha(&serde_json::to_value(&request.bindings).map_err(|e|err("workflow receipt bindings",e))?)?,"provenanceSha256":value_sha(provenance)?,"destinationSha256":value_sha(&request.destination)?,"actualGeneration":"not-run"}))
}

pub(crate) fn validate_submitted_graph(preset: &ReviewedPreset,bindings: &Value,submitted: &Value) -> Res<()> {
    let mut expected=preset.graph.clone();
    for binding in bindings.as_array().ok_or("workflow_submit_bindings_missing")? {
        let node=binding["nodeId"].as_str().ok_or("workflow_submit_binding_invalid")?;
        let input=binding["input"].as_str().ok_or("workflow_submit_binding_invalid")?;
        let rule=preset.bindings.iter().find(|r|r.node_id==node && r.input==input).ok_or("workflow_submit_binding_unreviewed")?;
        let value=if matches!(rule.rule,ScalarRule::Reference{..}) {
            let value=&submitted[node]["inputs"][input];
            let name=value.as_str().ok_or("workflow_submit_reference_invalid")?;
            if !name.starts_with("aimovie-") || name.contains("..") || name.contains('/') || name.contains('\\') || name.len()>200 { return Err("workflow_submit_reference_invalid".into()); }
            value.clone()
        } else { binding["value"].clone() };
        expected[node]["inputs"][input]=value;
    }
    if expected!=*submitted { return Err("workflow_submit_graph_differs_from_reviewed_plan".into()); }
    Ok(())
}

#[cfg(test)]
#[path="comfy_preset_policy_tests.rs"]
mod tests;
