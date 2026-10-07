//! 계약 해석 기능과 실행 preset 등록을 분리하여 V2를 임의 allowlist로 승격하지 않습니다.
use serde_json::{json,Value};
use serde::Deserialize;
use crate::{Res,err,comfy_admission::AdmissionRequest,comfy_preset_policy::{sha,value_sha,ReviewedPreset}};
const REVIEW:&str=include_str!("../resources/comfy-v2-conditional-contract-review.json");
const RAW_SCHEMAS:&str=include_str!("../resources/comfy-v2-reviewed-raw-schemas.json");

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Migration {from_schema_version:u32,serializer:String,legacy_selection_sha256:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Envelope {schema_version:u32,base:Value,original_v1_selection_json:String,original_v1_selection_sha256:String,migration:Migration,reviewed_variant_id:Option<String>,extensions:Vec<Extension>}
#[derive(Deserialize)]
#[serde(tag="kind",deny_unknown_fields)]
enum Extension {
    #[serde(rename="numeric-union")]
    NumericUnion {#[serde(rename="nodeId")] node_id:String,input:String,members:Vec<String>},
    #[serde(rename="autogrow")]
    Autogrow {#[serde(rename="nodeId")] node_id:String,#[serde(rename="inputGroup")] input_group:String,#[serde(rename="referenceGroupId")] reference_group_id:String,component:String,count:usize},
}

pub(crate) fn capabilities()->Value {
    let registry=match crate::comfy_reviewed_registry::packaged(){Ok(registry)=>registry,Err(error)=>return json!({"supportedWorkflowContractVersions":[1,2],"executablePresets":[],"registryError":error,"customNodeAdmission":false})};
    let presets=registry.presets.iter().map(|preset|json!({"id":preset.id,"modelRuleId":preset.model_rule_id,"workflowSha256":preset.graph_sha256,"contractVersions":[1,2],"requires":"exact-owned-source-schema-weights-project-grant"})).collect::<Vec<_>>();
    json!({"registrySha256":registry.digest().ok(),"registryRevision":registry.revision,"supportedWorkflowContractVersions":[1,2],"contractValidationVersions":[1,2],"contractValidation":{"explicitV1Migration":true,"numericUnion":true,"fixedH3AutogrowVariants":true,"nativeReceiptVersions":[1,2]},"executablePresets":presets,"conditionalV2Inspection":true,"conditionalV2Variants":8,"v2ExecutionAdmission":"per-exact-runtime-preset-and-evidence","customNodeAdmission":false,"localOnlyInputAndFileGuardImplemented":true,"localOnlyCustomProcessGuardImplemented":false})
}
#[tauri::command]
pub fn comfy_workflow_contract_capabilities()->Value {capabilities()}

/// 통과는 구조 검사 증거입니다. 별도 native preset·loaded 환경·weight·허가 admission을 대신하지 않습니다.
pub(crate) fn inspect_contract(request:&AdmissionRequest,bytes:&[u8],owned:&Value,facts:&[Value])->Res<Value> {
    let review:Value=serde_json::from_str(REVIEW).map_err(|e|err("workflow V2 conditional review",e))?;
    let variant=review["entries"].as_array().and_then(|items|items.iter().find(|v|v["id"]==request.manifest["selectionEnvelope"]["reviewedVariantId"])).ok_or("workflow_native_v2_variant_not_reviewed")?;
    inspect_reviewed_contract(request,bytes,owned,facts,variant,&review["coreCommit"],&review["comfyVersion"])
}

pub(crate) fn validate_preset_contract(preset:&ReviewedPreset,request:&AdmissionRequest,bytes:&[u8],owned:&Value,facts:&[Value])->Res<Value> {
    match request.manifest["schemaVersion"].as_u64() {
        Some(1)=>{
            if ["selectionEnvelope","rawNodeRequirements","extensionsSha256"].iter().any(|field|request.manifest.get(field).is_some()) {return Err("workflow_native_v1_undeclared_extension".into());}
            Ok(json!({"contractVersion":1}))
        },
        Some(2)=>{
            let stored=&preset.review["contractV2"];
            let derived;
            let variant=if stored.is_object(){stored}else{
                let envelope=&request.manifest["selectionEnvelope"];
                if envelope["extensions"]!=json!([]) || !envelope["reviewedVariantId"].is_null(){return Err("workflow_native_v2_extension_review_required".into());}
                derived=json!({"id":preset.id,"workflowSha256":preset.graph_sha256,"graph":preset.graph,"selectionEnvelope":envelope,"rawNodeRequirements":request.manifest["nodeRequirements"],"inputContract":{}});
                &derived
            };
            let result=inspect_reviewed_contract(request,bytes,owned,facts,variant,&preset.review["diskCoreCommit"],&preset.review["comfyVersion"])?;
            Ok(json!({"contractVersion":2,"selectionEnvelopeSha256":value_sha(&request.manifest["selectionEnvelope"])? ,"extensionsSha256":request.manifest["extensionsSha256"],"rawNodeRequirementsSha256":result["rawRequirementsSha256"],"variantId":result["variantId"]}))
        },
        _=>Err("workflow_native_contract_version_unsupported".into()),
    }
}

fn inspect_reviewed_contract(request:&AdmissionRequest,bytes:&[u8],owned:&Value,facts:&[Value],variant:&Value,core_commit:&Value,comfy_version:&Value)->Res<Value> {
    let manifest=&request.manifest;let envelope=&manifest["selectionEnvelope"];
    if manifest["projectId"].as_str().is_none_or(str::is_empty) || request.provenance["projectId"]!=manifest["projectId"] {return Err("workflow_native_v2_trusted_project_required".into());}
    if manifest["schemaVersion"]!=2 || manifest["policyVersion"]!="workflow-contract-v2.0-exact-variants" {return Err("workflow_native_v2_version_mismatch".into());}
    let parsed:Envelope=serde_json::from_value(envelope.clone()).map_err(|_|"workflow_native_v2_envelope_or_extension_invalid")?;
    if parsed.schema_version!=2 || parsed.original_v1_selection_json.len()>256000 || parsed.original_v1_selection_json.len()<2 || parsed.extensions.len()>32 {return Err("workflow_native_v2_envelope_or_extension_invalid".into());}
    if sha(bytes)!=variant["workflowSha256"].as_str().unwrap_or("") || request.expected_workflow_sha256!=variant["workflowSha256"] || manifest["workflowSha256"]!=variant["workflowSha256"] || serde_json::from_slice::<Value>(bytes).map_err(|e|err("workflow V2 graph",e))?!=variant["graph"] {return Err("workflow_native_v2_exact_graph_mismatch".into());}
    let legacy=&parsed.original_v1_selection_json;
    if sha(legacy.as_bytes())!=parsed.original_v1_selection_sha256 || parsed.migration.legacy_selection_sha256!=parsed.original_v1_selection_sha256 || parsed.migration.from_schema_version!=1 || parsed.migration.serializer!="exact-json-text-sha256"
        || serde_json::from_str::<Value>(legacy).map_err(|e|err("workflow V2 legacy selection",e))?!=parsed.base || envelope["base"]!=variant["selectionEnvelope"]["base"] || manifest["selection"]!=envelope["base"] || envelope["originalV1SelectionSha256"]!=variant["selectionEnvelope"]["originalV1SelectionSha256"] || envelope["originalV1SelectionJson"]!=variant["selectionEnvelope"]["originalV1SelectionJson"] {return Err("workflow_native_v2_migration_or_selection_changed".into());}
    if envelope["extensions"]!=variant["selectionEnvelope"]["extensions"] || envelope["reviewedVariantId"]!=variant["selectionEnvelope"]["reviewedVariantId"] || manifest["extensionsSha256"]!=value_sha(&envelope["extensions"])? {return Err("workflow_native_v2_extensions_changed".into());}
    if manifest["rawNodeRequirements"]!=variant["rawNodeRequirements"] || manifest["nodeRequirements"]!=variant["rawNodeRequirements"] {return Err("workflow_native_v2_raw_source_or_schema_changed".into());}
    if owned["identityContractVersion"]!=2 || owned["managerPid"]!=std::process::id() || owned["serverPid"].as_u64().is_none_or(|p|p==0) || owned["sourceEvidence"]!="owned-child-attestation" || owned["coreCommit"]!=*core_commit || manifest["environment"]["coreCommit"]!=owned["coreCommit"] || manifest["environment"]["comfyVersion"]!=*comfy_version {return Err("workflow_native_v2_loaded_source_required".into());}
    for requirement in variant["rawNodeRequirements"].as_array().ok_or("workflow_native_v2_raw_source_or_schema_changed")? {
        let module=requirement["pythonModule"].as_str().ok_or("workflow_native_v2_raw_source_or_schema_changed")?;
        if owned["nodeSourceHashes"][module]!=requirement["sourceSha256"] {return Err(format!("workflow_native_v2_loaded_module_changed: {module}"));}
    }
    crate::comfy_prompt_roles::validate_bodies(&envelope["base"],&manifest["promptTarget"],&request.provenance)?;
    let slots=envelope["base"]["slots"].as_array().ok_or("workflow_native_v2_slots_missing")?;
    validate_extensions(&parsed,&variant["graph"],&manifest["rawNodeRequirements"])?;
    let asset_slots=slots.iter().filter(|slot|crate::comfy_reference_contract::media_kind(slot["semantic"].as_str().unwrap_or("")).is_some()).collect::<Vec<_>>();
    let assets=request.provenance["assets"].as_array().ok_or("workflow_native_v2_asset_provenance_missing")?;
    if assets.len()!=asset_slots.len() || facts.len()!=asset_slots.len() {return Err("workflow_native_v2_registered_asset_facts_required".into());}
    let mut fields=std::collections::HashSet::new();
    if request.bindings.len()!=slots.len() {return Err("workflow_native_v2_binding_count_changed".into());}
    let values=request.provenance["values"].as_object().ok_or("workflow_native_v2_values_missing")?;
    for slot in slots {
        let id=slot["id"].as_str().ok_or("workflow_native_v2_slots_missing")?;let node=slot["nodeId"].as_str().ok_or("workflow_native_v2_slots_missing")?;let input=slot["input"].as_str().ok_or("workflow_native_v2_slots_missing")?;
        if !fields.insert((node,input)) {return Err("workflow_native_v2_duplicate_field".into());}
        let found=request.bindings.iter().filter(|b|b.node_id==node && b.input==input).collect::<Vec<_>>();if found.len()!=1 {return Err("workflow_native_v2_binding_field_changed".into());}let binding=found[0];
        if let Some(index)=asset_slots.iter().position(|s|s["id"]==id) {
            let asset=&assets[index];let fact=facts.iter().find(|f|f["slotId"]==id).ok_or("workflow_native_v2_asset_order_changed")?;
            let kind=crate::comfy_reference_contract::media_kind(slot["semantic"].as_str().unwrap_or("")).ok_or("workflow_native_v2_reference_semantic_invalid")?;
            if asset["slotId"]!=id || fact["assetId"]!=asset["assetId"] || fact["sha256"]!=asset["sha256"] || fact["projectId"]!=manifest["projectId"] || fact["source"]!="native-registered-file-fact-v1" || fact["decodable"]!=true || fact["fullDecode"]!=true || fact["kind"]!=kind || binding.file_path.as_deref()!=fact["path"].as_str() || binding.value.is_some() {return Err("workflow_native_v2_asset_order_kind_or_native_fact_changed".into());}
        } else {
            let value=binding.value.as_ref().ok_or("workflow_native_v2_scalar_required")?;
            if binding.file_path.is_some() || values.get(id)!=Some(value) {return Err("workflow_native_v2_binding_provenance_changed".into());}
            if ["positive","negative"].contains(&slot["semantic"].as_str().unwrap_or("")) && value.as_str()!=Some(crate::comfy_prompt_roles::slot_body(&envelope["base"],&manifest["promptTarget"],&request.provenance,id,slot["semantic"].as_str().unwrap_or(""))?.as_str()) {return Err("workflow_native_v2_positive_changed".into());}
        }
    }
    let contract=&variant["inputContract"];
    for slot in slots {
        let id=slot["id"].as_str().ok_or("workflow_native_v2_slots_missing")?;let Some(value)=values.get(id) else {continue};
        if slot["semantic"]=="fps" && !contract["fps"].is_null() && value.as_f64()!=contract["fps"].as_f64() {return Err("workflow_native_v2_fixed_fps".into());}
        if slot["semantic"]=="frameCount" && contract["frames"].is_object() {
            let n=value.as_i64().ok_or("workflow_native_v2_frame_grid")?;let grid=&contract["frames"];let min=grid["min"].as_i64().ok_or("workflow_native_v2_frame_grid")?;let max=grid["max"].as_i64().ok_or("workflow_native_v2_frame_grid")?;let base=grid["gridBase"].as_i64().ok_or("workflow_native_v2_frame_grid")?;let step=grid["gridStep"].as_i64().filter(|n|*n>0).ok_or("workflow_native_v2_frame_grid")?;
            if n<min || n>max || (n-base)%step!=0 {return Err("workflow_native_v2_frame_grid".into());}
        }
        if contract["canvas"].is_object() && ["width","height"].contains(&slot["semantic"].as_str().unwrap_or("")) {
            let field=slot["semantic"].as_str().unwrap();let n=value.as_u64().filter(|n|*n>0).ok_or("workflow_native_v2_canvas_grid")?;let canvas=&contract["canvas"];let multiple=canvas["multiple"].as_u64().filter(|n|*n>0).ok_or("workflow_native_v2_canvas_grid")?;
            if n%multiple!=0 || (canvas[field].as_u64().is_some() && canvas[field]!=*value) {return Err("workflow_native_v2_canvas_grid".into());}
        }
    }
    if let Some(groups)=contract["sameValues"].as_array(){for group in groups {let ids=group.as_array().ok_or("workflow_native_v2_temporal_coupling")?;if let Some(first)=ids.first().and_then(Value::as_str){let original=values.get(first);if ids.iter().any(|id|{let actual=id.as_str().and_then(|id|values.get(id));match(original.and_then(Value::as_f64),actual.and_then(Value::as_f64)){(Some(a),Some(b))=>a!=b,_=>actual!=original}}){return Err("workflow_native_v2_temporal_coupling".into());}}}}
    let groups=envelope["base"]["referenceGroups"].as_array().ok_or("workflow_native_v2_reference_groups_missing")?;
    for group in groups {
        let ids=group["slotIds"].as_array().ok_or("workflow_native_v2_reference_groups_missing")?;let mut unique=std::collections::HashSet::new();
        if group["strategy"]!="fixed-slots" || group["order"]!="explicit" || group["minItems"].as_u64()!=Some(ids.len() as u64) || group["maxItems"].as_u64()!=Some(ids.len() as u64){return Err("workflow_native_v2_fixed_reference_variant_required".into());}
        for id in ids {
            let fact=facts.iter().find(|f|f["slotId"]==*id).ok_or("workflow_native_v2_reference_count_changed")?;if !unique.insert(fact["assetId"].as_str().unwrap_or("")){return Err("workflow_native_v2_reference_replication_forbidden".into());}
            if group["mediaKind"]=="video" && !contract["referenceVideo"].is_null() {
                let c=&contract["referenceVideo"];let n=fact["frameCount"].as_i64().ok_or("workflow_native_v2_measured_frames_required")?;let fps=c["fps"].as_f64().ok_or("workflow_native_v2_reference_video_grid")?;
                if fact["fps"].as_f64()!=Some(fps) || n<c["minFrames"].as_i64().unwrap_or(i64::MAX) || n>c["maxFrames"].as_i64().unwrap_or(0) || (n-c["gridBase"].as_i64().unwrap_or(0))%c["gridStep"].as_i64().filter(|n|*n>0).ok_or("workflow_native_v2_reference_video_grid")?!=0 || fact["durationSeconds"].as_f64().is_none_or(|s|(s-n as f64/fps).abs()>1.0/fps) {return Err("workflow_native_v2_reference_video_grid".into());}
                if c["requiresAudioTrack"]==true && fact["audioTracks"].as_u64().is_none_or(|n|n<1) {return Err("workflow_native_v2_reference_video_audio_missing".into());}
            }
            if variant["id"].as_str().is_some_and(|s|s.starts_with("ltx25")) && ["firstFrame","endFrame"].contains(&group["role"].as_str().unwrap_or("")) {
                let w=values.get("width").and_then(Value::as_u64).ok_or("workflow_native_v2_canvas_grid")?;let h=values.get("height").and_then(Value::as_u64).ok_or("workflow_native_v2_canvas_grid")?;
                if fact["width"].as_u64().is_none_or(|n|n==0) || fact["height"].as_u64().is_none_or(|n|n==0) || fact["width"].as_u64().and_then(|fw|fw.checked_mul(h))!=fact["height"].as_u64().and_then(|fh|fh.checked_mul(w)) {return Err("workflow_native_v2_keyframe_preprocessing_required".into());}
            }
        }
    }
    crate::comfy_reference_contract::validate_constraints(&envelope["base"],&request.provenance,facts,&variant["graph"],&request.bindings)?;
    Ok(json!({"structuralInspection":"passed","executionAdmission":false,"variantId":variant["id"],"reviewSha256":sha(REVIEW.as_bytes()),"rawRequirementsSha256":value_sha(&manifest["rawNodeRequirements"])?}))
}

fn validate_extensions(envelope:&Envelope,graph:&Value,requirements:&Value)->Res<()> {
    let raw:Value=serde_json::from_str(RAW_SCHEMAS).map_err(|e|err("workflow V2 raw schema review",e))?;
    let mut covered=std::collections::HashSet::new();
    for ext in &envelope.extensions {
        let node_id=match ext {Extension::NumericUnion{node_id,..}|Extension::Autogrow{node_id,..}=>node_id};
        let node=&graph[node_id];let class=node["class_type"].as_str().ok_or("workflow_native_v2_extension_node_missing")?;
        let spec=&raw["schemas"][class];let schema=&spec["schema"];
        let fingerprint=spec["fingerprintJson"].as_str().ok_or("workflow_native_v2_extension_schema_unreviewed")?;
        if sha(fingerprint.as_bytes())!=spec["schemaSha256"] || serde_json::from_str::<Value>(fingerprint).map_err(|e|err("V2 schema",e))?!=*schema || !requirements.as_array().is_some_and(|items|items.iter().any(|r|r["nodeId"]==*node_id && r["classType"]==class && r["schemaSha256"]==spec["schemaSha256"] && r["pythonModule"]==schema["pythonModule"] && r["sourceSha256"]==spec["review"]["sourceSha256"])) {return Err("workflow_native_v2_extension_schema_unreviewed".into());}
        match ext {
            Extension::NumericUnion{node_id,input,members}=>{
                if class!="LTXVEmptyLatentAudio" || input!="frame_rate" || members!=&["FLOAT".to_string(),"INT".to_string()] || schema["input"]["required"][input][0]!="FLOAT,INT" {return Err("workflow_native_v2_numeric_union_not_reviewed".into());}
                if !covered.insert(format!("{node_id}.{input}")){return Err("workflow_native_v2_duplicate_extension".into());}
            },
            Extension::Autogrow{node_id,input_group,reference_group_id,component,count}=>{
                if class!="MiniMaxH3ReferenceToVideo" || *count==0 || *count>9 || !["ref_images","ref_videos","ref_video_audios","ref_audios"].contains(&input_group.as_str()) {return Err("workflow_native_v2_autogrow_not_reviewed".into());}
                let template=&schema["input"]["optional"][input_group][1]["template"];
                let group=envelope.base["referenceGroups"].as_array().and_then(|groups|groups.iter().find(|g|g["id"]==*reference_group_id)).ok_or("workflow_native_v2_reference_count_changed")?;
                let ids=group["slotIds"].as_array().ok_or("workflow_native_v2_reference_count_changed")?;
                let prefix=template["prefix"].as_str().ok_or("workflow_native_v2_autogrow_not_reviewed")?;
                if template["min"]!=0 || template["max"].as_u64().is_none_or(|n|n<*count as u64) || group["strategy"]!="fixed-slots" || group["order"]!="explicit" || group["minItems"]!=*count || group["maxItems"]!=*count || ids.len()!=*count {return Err("workflow_native_v2_reference_count_changed".into());}
                let inputs=node["inputs"].as_object().ok_or("workflow_native_v2_autogrow_not_reviewed")?;
                let expected=(0..*count).map(|i|format!("{input_group}.{prefix}{i}")).collect::<std::collections::HashSet<_>>();
                if inputs.keys().filter(|k|*k==input_group || k.starts_with(&format!("{input_group}."))).cloned().collect::<std::collections::HashSet<_>>()!=expected {return Err("workflow_native_v2_autogrow_namespace_or_count".into());}
                for (i,id) in ids.iter().enumerate(){
                    let slot=envelope.base["slots"].as_array().and_then(|s|s.iter().find(|s|s["id"]==*id)).ok_or("workflow_native_v2_reference_order_changed")?;
                    let key=format!("{input_group}.{prefix}{i}");let link=&inputs[&key];let load=&graph[slot["nodeId"].as_str().unwrap_or("")];
                    let valid=match component.as_str(){
                        "image"=>input_group=="ref_images" && group["mediaKind"]=="image" && slot["semantic"]=="identityImage" && slot["input"]=="image" && load["class_type"]=="LoadImage" && *link==json!([slot["nodeId"],0]),
                        "audio-reference"=>input_group=="ref_audios" && group["mediaKind"]=="audio" && slot["semantic"]=="audio" && slot["input"]=="audio" && load["class_type"]=="LoadAudio" && *link==json!([slot["nodeId"],0]),
                        "video-frames"|"video-audio"=>{
                            let output=if component=="video-frames"{0}else{1};let components=&graph[link[0].as_str().unwrap_or("")];
                            input_group==if component=="video-frames"{"ref_videos"}else{"ref_video_audios"} && group["mediaKind"]=="video" && slot["semantic"]=="sourceVideo" && slot["input"]=="file" && load["class_type"]=="LoadVideo" && link.as_array().map(Vec::len)==Some(2) && link[1]==output && components["class_type"]=="GetVideoComponents" && components["inputs"]["video"]==json!([slot["nodeId"],0])
                        },
                        _=>false,
                    };
                    if !valid || !covered.insert(format!("{node_id}.{key}")){return Err("workflow_native_v2_reference_role_or_order".into());}
                }
            },
        }
    }
    if !envelope.extensions.is_empty() && envelope.reviewed_variant_id.as_deref().is_none_or(str::is_empty){return Err("workflow_native_v2_variant_not_reviewed".into());}
    for (id,node) in graph.as_object().ok_or("workflow_native_v2_graph_invalid")? {
        let schema=&raw["schemas"][node["class_type"].as_str().unwrap_or("")]["schema"];
        for key in node["inputs"].as_object().ok_or("workflow_native_v2_graph_invalid")?.keys(){
            if ((key.starts_with("ref_") && key.contains('.')) || schema["input"]["required"][key][0]=="FLOAT,INT") && !covered.contains(&format!("{id}.{key}")){return Err("workflow_native_v2_extension_not_declared".into());}
        }
    }
    Ok(())
}

#[cfg(test)]mod tests {
    use super::*;
    fn fixture(index:usize)->(AdmissionRequest,Vec<u8>,Value,Vec<Value>){
        let review:Value=serde_json::from_str(REVIEW).unwrap();let v=&review["entries"][index];let selection=&v["selectionEnvelope"]["base"];let mut values=serde_json::Map::new();let mut assets=vec![];let mut facts=vec![];let mut bindings=vec![];
        let width=selection["slots"].as_array().unwrap().iter().find(|s|s["semantic"]=="width").map(|s|s["defaultValue"].as_u64().unwrap()).unwrap_or(1344);let height=selection["slots"].as_array().unwrap().iter().find(|s|s["semantic"]=="height").map(|s|s["defaultValue"].as_u64().unwrap()).unwrap_or(768);
        for s in selection["slots"].as_array().unwrap(){let id=s["id"].as_str().unwrap();let kind=match s["semantic"].as_str().unwrap(){"identityImage"|"firstFrame"|"endFrame"|"sourceImage"=>Some("image"),"sourceVideo"=>Some("video"),"audio"=>Some("audio"),_=>None};
            if let Some(kind)=kind {let asset=format!("asset-{id}");let path=format!("C:/cpu-only/{id}");let digest="e".repeat(64);assets.push(json!({"slotId":id,"assetId":asset,"sha256":digest}));facts.push(json!({"source":"native-registered-file-fact-v1","slotId":id,"projectId":"cpu-project","kind":kind,"assetId":asset,"sha256":digest,"path":path,"bytes":100,"decodable":true,"fullDecode":true,"fps":24,"frameCount":56,"durationSeconds":56.0/24.0,"audioTracks":1,"width":width,"height":height}));bindings.push(json!({"nodeId":s["nodeId"],"input":s["input"],"filePath":path}));}
            else {let value=if s["semantic"]=="positive"{json!("CPU only")}else{s["defaultValue"].clone()};values.insert(id.into(),value.clone());bindings.push(json!({"nodeId":s["nodeId"],"input":s["input"],"value":value}));}
        }
        let primary=&selection["promptRoles"][0];let target=json!({"kind":"workflow","workflowId":"cpu-v2","workflowSha256":v["workflowSha256"],"roleId":primary["id"],"modelRuleId":primary["modelRuleId"]});
        let manifest=json!({"schemaVersion":2,"policyVersion":"workflow-contract-v2.0-exact-variants","projectId":"cpu-project","workflowSha256":v["workflowSha256"],"selectionEnvelope":v["selectionEnvelope"],"selection":selection,"promptTarget":target,"rawNodeRequirements":v["rawNodeRequirements"],"nodeRequirements":v["rawNodeRequirements"],"extensionsSha256":value_sha(&v["selectionEnvelope"]["extensions"]).unwrap(),"environment":{"coreCommit":review["coreCommit"],"comfyVersion":review["comfyVersion"]}});
        let request:AdmissionRequest=serde_json::from_value(json!({"baseUrl":"http://127.0.0.1:8190","workflowPath":"cpu-no-file","expectedWorkflowSha256":v["workflowSha256"],"bindings":bindings,"manifest":manifest,"manifestJson":manifest.to_string(),"provenance":{"projectId":"cpu-project","prompt":"CPU only","values":values,"assets":assets},"destination":{}})).unwrap();
        let mut sources=serde_json::Map::new();for r in v["rawNodeRequirements"].as_array().unwrap(){sources.insert(r["pythonModule"].as_str().unwrap().into(),r["sourceSha256"].clone());}
        let owned=json!({"identityContractVersion":2,"managerPid":std::process::id(),"serverPid":std::process::id()+1,"sourceEvidence":"owned-child-attestation","coreCommit":review["coreCommit"],"nodeSourceHashes":sources});
        // 원문 graph hash를 검사하므로 저장된 JSON을 재직렬화한 fixture는 실제 제출 경로에 쓰지 않습니다.
        let bytes=serde_json::to_vec(&v["graph"]).unwrap();(request,bytes,owned,facts)
    }
    fn valid(index:usize)->(AdmissionRequest,Vec<u8>,Value,Vec<Value>){
        let (mut r,_,o,f)=fixture(index);let review:Value=serde_json::from_str(REVIEW).unwrap();let v=&review["entries"][index];let graph=v["graph"].clone();
        // graph 원문은 별도 include_bytes! 목록으로 정확히 보존합니다.
        let bytes=match index {
            0=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-1-identity.api.json").to_vec(),
            1=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-2-identity.api.json").to_vec(),
            2=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-4-identity.api.json").to_vec(),
            3=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-2-identity-video.api.json").to_vec(),
            4=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-1-identity-audio.api.json").to_vec(),
            5=>include_bytes!("../resources/comfy-v2-graphs/ltx25-distilled-t2va.api.json").to_vec(),
            6=>include_bytes!("../resources/comfy-v2-graphs/ltx25-distilled-first-frame.api.json").to_vec(),
            _=>include_bytes!("../resources/comfy-v2-graphs/ltx25-distilled-first-last-frame.api.json").to_vec(),
        };assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(),graph);r.manifest_json=r.manifest.to_string();(r,bytes,o,f)
    }
    #[test]fn all_eight_exact_contracts_are_inspected_without_enabling_execution(){for i in 0..8{let (r,b,o,f)=valid(i);let result=inspect_contract(&r,&b,&o,&f).unwrap();assert_eq!(result["structuralInspection"],"passed");assert_eq!(result["executionAdmission"],false);}assert_eq!(capabilities()["supportedWorkflowContractVersions"],json!([1,2]));assert_eq!(capabilities()["executablePresets"].as_array().unwrap().len(),1);}
    #[test]fn v2_migration_keeps_literal_original_text_and_detects_any_change(){let (mut r,b,o,f)=valid(1);r.manifest["selectionEnvelope"]["originalV1SelectionJson"]=json!("{}");assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("migration_or_selection"));}
    #[test]fn v2_changed_source_or_raw_input_output_schema_is_blocked(){for field in ["sourceSha256","schemaSha256"]{let (mut r,b,o,f)=valid(1);r.manifest["rawNodeRequirements"][0][field]=json!("0".repeat(64));assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("raw_source_or_schema"));}}
    #[test]fn v2_loaded_identity_is_not_promoted_from_disk_or_version(){let (r,b,mut o,f)=valid(1);o["sourceEvidence"]=json!("reported-commit-matches-disk");assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("loaded_source_required"));}
    #[test]fn v2_autogrow_count_and_original_links_cannot_change(){let (mut r,b,o,f)=valid(1);r.manifest["selectionEnvelope"]["extensions"][0]["count"]=json!(3);assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("extensions_changed"));let (r,mut b,o,f)=valid(1);b.push(b' ');assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("exact_graph"));}
    #[test]fn v2_reference_order_identity_and_project_are_bound(){let (mut r,b,o,f)=valid(1);r.provenance["assets"].as_array_mut().unwrap().swap(0,1);assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("asset_order"));let (r,b,o,mut f)=valid(1);f[0]["projectId"]=json!("another");assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("native_fact_changed"));}
    #[test]fn v2_video_needs_measured_frames_and_actual_audio_tracks(){let (r,b,o,mut f)=valid(3);let video=f.iter_mut().find(|f|f["kind"]=="video").unwrap();video["frameCount"]=Value::Null;assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("measured_frames"));let (r,b,o,mut f)=valid(3);f.iter_mut().find(|f|f["kind"]=="video").unwrap()["audioTracks"]=json!(0);assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("video_audio_missing"));}
    #[test]fn v2_ltx_keyframe_requires_exact_aspect_or_registered_preprocessing(){let (r,b,o,mut f)=valid(6);f[0]["width"]=json!(999);assert!(inspect_contract(&r,&b,&o,&f).unwrap_err().contains("preprocessing_required"));}
    #[test]fn v2_numeric_union_fps_is_numeric_and_temporally_coupled(){let (mut r,b,o,f)=valid(5);let slot=r.manifest["selection"]["slots"].as_array().unwrap().iter().find(|s|s["nodeId"]=="8"&&s["input"]=="frame_rate").unwrap().clone();let id=slot["id"].as_str().unwrap();r.provenance["values"][id]=json!("24");r.bindings.iter_mut().find(|b|b.node_id=="8"&&b.input=="frame_rate").unwrap().value=Some(json!("24"));assert!(inspect_contract(&r,&b,&o,&f).is_err());}
}
