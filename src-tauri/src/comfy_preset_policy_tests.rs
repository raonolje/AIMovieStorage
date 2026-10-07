use super::*;
use crate::comfy_preset_test_fixture::{fixture,music3,sync_manifest,receipt,Fixture};
fn validate(f:&Fixture)->Res<Value>{validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts)}
fn error(f:&Fixture,code:&str){assert!(validate(f).unwrap_err().contains(code));}

#[test]fn reviewed_image_video_audio_fixtures_use_the_same_admission_engine(){
    for kind in ["image","video","audio"]{let f=fixture(kind,0);let r=validate(&f).unwrap();assert_eq!(r["outputKind"],kind);assert_eq!(r["actualGeneration"],"not-run");assert_eq!(r["presetId"],f.preset.id);}
}
#[test]fn music3_exact_existing_review_is_preserved(){let f=music3();assert!(validate(&f).is_ok());}
#[test]fn unknown_versions_or_v2_without_explicit_migration_cannot_enter_native_policy(){let mut f=music3();f.request.manifest["schemaVersion"]=json!(3);sync_manifest(&mut f);error(&f,"contract_version_unsupported");let mut f=music3();f.request.manifest["schemaVersion"]=json!(2);sync_manifest(&mut f);assert!(validate(&f).is_err());}
#[test]fn fixed_zero_one_two_reference_variants_are_distinct(){
    let mut hashes=HashSet::new();for refs in [0,1,2]{let f=fixture("video",refs);assert!(validate(&f).is_ok());hashes.insert(f.preset.graph_sha256);}assert_eq!(hashes.len(),3);
}
#[test]fn graph_change_or_a_different_variant_is_blocked(){
    let mut f=fixture("video",1);f.bytes.push(b' ');error(&f,"workflow_changed");
    let mut f=fixture("video",1);f.request.expected_workflow_sha256=fixture("video",2).preset.graph_sha256;error(&f,"workflow_changed");
}
#[test]fn installed_version_and_disk_commit_are_not_loaded_source_proof(){
    let mut f=fixture("image",0);f.owned["sourceEvidence"]=json!("reported-commit-matches-disk");error(&f,"loaded_source_attestation_required");
}
#[test]fn missing_server_or_another_manager_is_blocked(){
    for field in ["serverPid","managerPid"]{let mut f=fixture("image",0);f.owned[field]=json!(0);error(&f,"identity_not_ready");}
}
#[test]fn manifest_or_provenance_credentials_are_not_exported_as_receipt_data(){
    for key in ["api_key","password","accessToken","authorization"] {let mut f=fixture("image",0);f.request.provenance[key]=json!("CPU fake secret must not be echoed");error(&f,"credentials_forbidden");}
    let f=music3();assert!(validate(&f).is_ok());
}
#[test]fn reference_slot_counts_do_not_authorize_duplicating_the_same_registered_asset(){
    let mut f=fixture("video",2);f.request.provenance["assets"][1]["assetId"]=f.request.provenance["assets"][0]["assetId"].clone();error(&f,"reference_replication_forbidden");
}
#[test]fn loaded_module_hash_change_is_blocked(){let mut f=fixture("image",0);f.owned["nodeSourceHashes"]["nodes"]=json!("0".repeat(64));error(&f,"loaded_source_mismatch");}
#[test]fn same_version_schema_change_is_blocked(){let mut f=fixture("image",0);f.request.manifest["nodeRequirements"][0]["schemaSha256"]=json!("0".repeat(64));sync_manifest(&mut f);error(&f,"node_or_schema_mismatch");}
#[test]fn desktop_sampler_schema_cannot_substitute_for_owned_sampler_schema(){
    let mut f=music3();let needs=f.request.manifest["nodeRequirements"].as_array_mut().unwrap();let n=needs.iter_mut().find(|n|n["classType"]=="KSampler").unwrap();n["schemaSha256"]=json!("0b796842c65ef5f6c0a003c26cd7d1adb1abca13e3ad8a17300a4eb4cb91c842");sync_manifest(&mut f);error(&f,"node_or_schema_mismatch");
}
#[test]fn environment_version_commit_and_custom_node_changes_are_blocked(){
    for field in ["coreCommit","comfyVersion","reviewVersion","pythonVersion","torchVersion"]{let mut f=fixture("image",0);f.request.manifest["environment"][field]=json!("changed");sync_manifest(&mut f);error(&f,"environment_changed");}
    let mut f=fixture("image",0);f.request.manifest["environment"]["customNodeVersions"]=json!({"installed":"1"});sync_manifest(&mut f);error(&f,"environment_changed");
}
#[test]fn custom_node_and_auto_download_policies_cannot_be_enabled(){
    let mut f=fixture("image",0);f.preset.review["reviewedNodes"]["UNETLoader"]["pythonModule"]=json!("custom_nodes.unapproved");error(&f,"custom_node_forbidden");
    let mut f=fixture("image",0);f.preset.graph["1"]["inputs"]["auto_download"]=json!(true);error(&f,"auto_download_forbidden");
}
#[test]fn unknown_weight_in_reviewed_graph_is_blocked(){let mut f=fixture("image",0);f.preset.graph["1"]["inputs"]["unet_name"]=json!("other.safetensors");error(&f,"unknown_weight_forbidden");}
#[test]fn exact_hash_name_category_and_native_fact_are_all_required(){
    for field in ["sha256","name","category"]{let mut f=fixture("image",0);f.owned["weights"][0][field]=json!("other");error(&f,"weight_mismatch");}
    let mut f=fixture("image",0);f.owned["weights"]=json!([]);error(&f,"weight_mismatch");
}
#[test]fn manifest_cannot_add_an_unknown_weight_or_change_public_license(){
    let mut f=fixture("image",0);let extra=f.request.manifest["weightRequirements"][0].clone();f.request.manifest["weightRequirements"].as_array_mut().unwrap().push(extra);sync_manifest(&mut f);error(&f,"unknown_weight_forbidden");
    let mut f=fixture("image",0);f.request.manifest["weightRequirements"][0]["publicLicense"]=json!("allowed");sync_manifest(&mut f);error(&f,"weight_mismatch");
}
#[test]fn supplied_grants_are_not_adopted_and_revocation_is_checked(){
    let f=fixture("image",0);let grants=f.request.manifest["weightAuthorizations"].as_array().unwrap();assert!(validate_trusted_grants(&f.preset,&f.request.manifest,grants).is_ok());assert!(validate_trusted_grants(&f.preset,&f.request.manifest,&[]).is_err());
    let mut changed=f.request.manifest.clone();changed["weightAuthorizations"][0]["evidence"]=json!("new uploaded assertion");assert!(validate_trusted_grants(&f.preset,&changed,grants).is_err());
}
#[test]fn project_model_file_hash_name_and_category_bound_the_grant(){
    let f=fixture("video",0);let trusted=f.request.manifest["weightAuthorizations"].as_array().unwrap();
    for field in ["projectId","modelRuleId","sha256","name","category"]{let mut m=f.request.manifest.clone();m["weightAuthorizations"][0][field]=json!("another");assert!(validate_trusted_grants(&f.preset,&m,trusted).is_err());}
}
#[test]fn grants_cannot_duplicate_or_omit_an_exact_weight(){let f=music3();let trusted=f.request.manifest["weightAuthorizations"].as_array().unwrap();let mut m=f.request.manifest.clone();m["weightAuthorizations"][1]=m["weightAuthorizations"][0].clone();assert!(validate_trusted_grants(&f.preset,&m,trusted).is_err());}
#[test]fn role_loaders_output_and_slot_semantics_are_not_guessed(){
    for field in ["roleId","modelRuleId"]{let mut f=fixture("video",0);f.request.manifest["promptTarget"][field]=json!("another");sync_manifest(&mut f);error(&f,"role_or_input_variant");}
    let mut f=fixture("video",0);f.request.manifest["selection"]["promptRoles"][0]["loaderNodeIds"]=json!(["other-loader"]);sync_manifest(&mut f);error(&f,"role_or_input_variant");
    let mut f=fixture("video",0);f.request.manifest["selection"]["slots"][0]["semantic"]=json!("value");sync_manifest(&mut f);error(&f,"role_or_input_variant");
}
#[test]fn stale_model_metadata_and_another_workflow_path_are_blocked(){
    for field in ["modelIds","promptProfile","workflowPath"]{let mut f=fixture("image",0);f.request.manifest[field]=if field=="modelIds"{json!(["another-model"])}else{json!("another")};sync_manifest(&mut f);error(&f,"source_model_or_path_stale");}
}
#[test]fn defaults_can_change_only_within_reviewed_bound_values(){
    let mut f=music3();f.request.manifest["selection"]["slots"][0]["defaultValue"]=json!("manual text retained");sync_manifest(&mut f);assert!(validate(&f).is_ok());
    let b=f.request.bindings.iter_mut().find(|b|b.input=="max_duration").unwrap();b.value=Some(json!(31));f.request.provenance["values"]["duration"]=json!(31);error(&f,"binding_outside_review");
}
#[test]fn instrumental_and_literal_lyrics_end_are_separate_rules(){
    for lyrics in ["[Instrumental]","verse\n[end]"]{let mut f=music3();f.request.bindings.iter_mut().find(|b|b.input=="lyrics").unwrap().value=Some(json!(lyrics));f.request.provenance["values"]["lyrics"]=json!(lyrics);assert!(validate(&f).is_ok());}
    for lyrics in ["","verse","verse\n[end]\n[end]","[end]\nverse"]{let mut f=music3();f.request.bindings.iter_mut().find(|b|b.input=="lyrics").unwrap().value=Some(json!(lyrics));f.request.provenance["values"]["lyrics"]=json!(lyrics);error(&f,"binding_outside_review");}
}
#[test]fn duplicate_unknown_missing_and_file_bindings_are_blocked(){
    let mut f=music3();f.request.bindings[1]=f.request.bindings[0].clone();error(&f,"duplicate_binding");
    let mut f=music3();f.request.bindings[0].input="unet_name".into();error(&f,"unreviewed_binding");
    let mut f=music3();f.request.bindings.pop();error(&f,"required_bindings_mismatch");
    let mut f=music3();f.request.bindings[0].file_path=Some("C:/unregistered.png".into());error(&f,"reference_variant_mismatch");
}
#[test]fn provenance_and_registration_kind_cannot_change(){
    let mut f=fixture("video",0);f.request.provenance["values"]["positive"]=json!("other");error(&f,"binding_provenance_mismatch");
    let mut f=fixture("video",0);f.request.destination["assetType"]=json!("bgm-track");error(&f,"registration_kind_mismatch");
    let mut f=fixture("audio",0);f.request.destination["kind"]=json!("image");error(&f,"registration_kind_mismatch");
}
#[test]fn reference_count_order_slot_and_native_cpu_facts_are_required(){
    let mut f=fixture("video",2);f.facts.swap(0,1);assert!(validate(&f).is_ok());
    f.facts[0]["slotId"]=json!("ref0");error(&f,"reference_fact_mismatch");
    let mut f=fixture("video",1);f.facts.clear();error(&f,"reference_fact_required");
    let mut f=fixture("video",1);f.request.provenance["assets"].as_array_mut().unwrap().push(json!({}));error(&f,"reference_fact_required");
}
#[test]fn uploaded_boolean_and_other_project_hash_path_kind_are_not_native_facts(){
    for field in ["source","projectId","sha256","path","kind","assetId"]{let mut f=fixture("video",1);f.facts[0][field]=json!("untrusted");error(&f,"reference_fact_mismatch");}
    let mut f=fixture("video",1);f.facts[0]["fullDecode"]=json!(false);error(&f,"reference_fact_mismatch");
}
#[test]fn optional_list_and_autogrow_variants_require_separate_native_review(){
    for strategy in ["list-input","autogrow"]{let mut f=fixture("video",1);f.preset.selection["referenceGroups"][0]["strategy"]=json!(strategy);error(&f,"requires_reviewed_fixed_variant");}
    let mut f=fixture("video",1);f.preset.selection["referenceGroups"][0]["minItems"]=json!(0);error(&f,"requires_reviewed_fixed_variant");
}
#[test]fn link_override_is_forbidden_even_in_a_new_review_policy(){
    let mut f=fixture("image",0);f.preset.bindings[0].node_id="3".into();f.preset.bindings[0].input="samples".into();error(&f,"link_override_forbidden");
}
#[test]fn submitted_graph_cannot_change_links_models_or_nonselected_inputs(){
    let f=fixture("image",0);let bindings=serde_json::to_value(&f.request.bindings).unwrap();let mut graph=f.preset.graph.clone();graph["2"]["inputs"]["text"]=json!("CPU only");assert!(validate_submitted_graph(&f.preset,&bindings,&graph).is_ok());graph["3"]["inputs"]["samples"]=json!(["1",0]);assert!(validate_submitted_graph(&f.preset,&bindings,&graph).is_err());
}
#[test]fn receipt_binds_loaded_identity_without_exporting_nonce(){
    let mut f=fixture("image",0);let r=receipt(&f);let encoded=serde_json::to_string(&r).unwrap();assert!(!encoded.contains("nonce"));assert!(!encoded.contains("cpu-only-no-secret"));f.owned["nonce"]=json!("another-launch");assert_ne!(receipt(&f)["sourceIdentitySha256"],r["sourceIdentitySha256"]);
}
#[test]fn offline_presets_remain_blocked_with_specific_reasons(){
    let catalog:Value=serde_json::from_str(BLOCKED).unwrap();assert_eq!(catalog["presets"].as_array().unwrap().len(),26);
    for p in catalog["presets"].as_array().unwrap(){let e=runtime_preset(p["graphSha256"].as_str().unwrap()).err().unwrap();assert!(e.contains(p["id"].as_str().unwrap()));if p["id"].as_str().unwrap().contains("tts"){assert!(e.contains("auto-download"));}if p["id"].as_str().unwrap().contains("sdnq"){assert!(e.contains("no-download"));}}
}
#[test]fn synthetic_reviews_do_not_become_production_registration(){let f=fixture("video",0);assert!(validate(&f).is_ok());assert!(runtime_preset(&f.preset.graph_sha256).is_err());}
