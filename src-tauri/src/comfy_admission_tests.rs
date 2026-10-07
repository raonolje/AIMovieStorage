use super::*;
use crate::comfy_preset_test_fixture::{fixture,music3,receipt,Fixture};
use crate::comfy_preset_test_fixture::{reviewed_v2,migrate_v2,sync_manifest};

fn submission_record(f:&Fixture,id:&str)->Value {
    let mut graph=f.preset.graph.clone();for b in &f.request.bindings{graph[&b.node_id]["inputs"][&b.input]=b.value.clone().unwrap_or(json!("aimovie-cpu.png"));}
    let mut admitted=receipt(f);if f.preset.id=="music3-instrumental-smoke"{let registry=crate::comfy_reviewed_registry::packaged().unwrap();admitted["registrySha256"]=json!(registry.digest().unwrap());admitted["registryRevision"]=json!(registry.revision);}let mut r=json!({"baseUrl":f.request.base_url,"provenance":f.request.provenance,"manifest":f.request.manifest,"manifestJson":f.request.manifest_json,"bindings":f.request.bindings,"destination":f.request.destination,"admission":admitted,"nativeReferenceFacts":f.facts,"workRoot":"C:/cpu-only","promptId":id,"submittedGraph":graph});r["receiptSha256"]=json!(receipt_digest(&r).unwrap());r
}
fn collect_request(r:&Value)->crate::comfy_generation::CollectRequest {
    let mut provenance=r["provenance"].clone();provenance["promptId"]=r["promptId"].clone();let mut d=r["destination"].clone();d["baseUrl"]=r["baseUrl"].clone();d["promptId"]=r["promptId"].clone();d["outputNodeIds"]=r["manifest"]["selection"]["outputNodeIds"].clone();d["provenance"]=provenance;serde_json::from_value(d).unwrap()
}
fn history(r:&Value)->Value {json!({r["promptId"].as_str().unwrap():{"prompt":[0,r["promptId"],r["submittedGraph"]]}})}
#[test]fn valid_reviewed_image_video_audio_receipts_match_graph_kind_and_target(){
    for kind in ["image","video","audio"]{let f=fixture(kind,0);let r=submission_record(&f,"cpu-only");let q=collect_request(&r);assert!(verify_submission_record_for_preset(&r,&q,&history(&r),&f.preset).is_ok());}
}
#[test]fn collector_rejects_different_graph_endpoint_outputs_and_registration_kind(){
    let f=fixture("video",0);let r=submission_record(&f,"cpu-only");
    let mut h=history(&r);h["cpu-only"]["prompt"][2]["3"]["inputs"]["filename_prefix"]=json!("changed");assert!(verify_submission_record_for_preset(&r,&collect_request(&r),&h,&f.preset).unwrap_err().contains("history_graph"));
    for field in ["baseUrl","kind","assetType","ownerName","projectName","baseDirectory"]{let mut q=serde_json::to_value(&r["destination"]).unwrap();q["baseUrl"]=r["baseUrl"].clone();q["promptId"]=json!("cpu-only");q["outputNodeIds"]=json!(["3"]);q["provenance"]=serde_json::to_value(collect_request(&r).provenance).unwrap();q[field]=json!("another");let q=serde_json::from_value(q).unwrap();assert!(verify_submission_record_for_preset(&r,&q,&history(&r),&f.preset).is_err());}
    let mut q=collect_request(&r);q.output_node_ids=vec!["another".into()];assert!(verify_submission_record_for_preset(&r,&q,&history(&r),&f.preset).is_err());
}
#[test]fn corrupted_receipt_or_changed_review_cannot_be_recovered(){
    let f=fixture("image",0);let mut r=submission_record(&f,"cpu-only");let q=collect_request(&r);r["admission"]["policySha256"]=json!("0".repeat(64));assert!(verify_submission_record_for_preset(&r,&q,&history(&r),&f.preset).unwrap_err().contains("digest_mismatch"));r["receiptSha256"]=json!(receipt_digest(&r).unwrap());assert!(verify_submission_record_for_preset(&r,&q,&history(&r),&f.preset).unwrap_err().contains("review_mismatch"));
}
#[test]fn file_receipts_are_atomic_idempotent_and_do_not_overwrite_conflicts(){
    let f=music3();let root=tempfile::tempdir().unwrap();let id=format!("cpu-{}",uuid::Uuid::new_v4());let mut r=submission_record(&f,&id);r["workRoot"]=json!(root.path());r.as_object_mut().unwrap().remove("receiptSha256");let graph=r["submittedGraph"].clone();record_submission(&id,r.clone(),graph.clone()).unwrap();record_submission(&id,r.clone(),graph.clone()).unwrap();let file=root.path().join("submissions").join(format!("{id}.json"));let before=fs::read(&file).unwrap();r["provenance"]["prompt"]=json!("changed");assert!(record_submission(&id,r,graph).is_err());assert_eq!(before,fs::read(&file).unwrap());
    let saved:Value=serde_json::from_slice(&before).unwrap();assert!(verify_submission_record(&saved,&collect_request(&saved),&history(&saved)).is_ok());
}
#[test]fn prompt_id_cannot_escape_receipt_directory(){assert!(valid_prompt_id("../escape").is_err());assert!(valid_prompt_id("cpu-ok").is_ok());}
#[test]fn receipt_binds_original_input_not_just_history_echo_or_a_recomputed_file_digest(){
    let f=fixture("image",0);let mut r=submission_record(&f,"cpu-only");let q=collect_request(&r);
    r["bindings"][0]["value"]=json!("modified after admission");r["submittedGraph"]["2"]["inputs"]["text"]=json!("modified after admission");r["receiptSha256"]=json!(receipt_digest(&r).unwrap());
    assert!(verify_submission_record_for_preset(&r,&q,&history(&r),&f.preset).unwrap_err().contains("admitted_request_changed"));
}
#[test]fn admission_requires_verified_server_identity(){let f=music3();let mut owned=f.owned;owned["serverPid"]=Value::Null;assert_eq!(check(&f.request,&owned).unwrap_err(),"owned_backend_identity_not_ready");}
#[test]fn untrusted_authorization_store_is_not_adopted(){let f=music3();let dir=tempfile::tempdir().unwrap();let path=dir.path().join("app-settings.json");fs::write(&path,r#"{"entries":{}}"#).unwrap();assert!(trusted_grants(&path,&f.preset,&f.request.manifest).is_err());}
fn token(f:Fixture,expired:bool)->SubmitRequest {
    let id=uuid::Uuid::new_v4().to_string();let q:SubmitRequest=serde_json::from_value(json!({"baseUrl":f.request.base_url,"workflowPath":f.request.workflow_path,"expectedWorkflowSha256":f.request.expected_workflow_sha256,"bindings":f.request.bindings,"clientId":"cpu-client","admissionToken":id})).unwrap();let created=Instant::now()-Duration::from_secs(if expired{121}else{0});admissions().lock().unwrap().insert(id,Admission{receipt:receipt(&f),request:f.request,created,trusted_path:PathBuf::from("unused-cpu")});q
}
#[test]fn admission_token_is_exact_single_use_and_expires_without_network(){let q=token(fixture("video",0),false);assert!(take_admission(&q).is_ok());assert!(take_admission(&q).is_err());let q=token(fixture("image",0),true);assert!(take_admission(&q).is_err());}
#[test]fn changed_request_consumes_token_and_cannot_retry(){
    for field in ["bindings","baseUrl","workflowPath","clientId","expectedWorkflowSha256"]{let q=token(fixture("image",0),false);let mut value=serde_json::to_value(json!({"baseUrl":q.base_url,"workflowPath":q.workflow_path,"bindings":q.bindings,"clientId":q.client_id,"expectedWorkflowSha256":q.expected_workflow_sha256,"admissionToken":q.admission_token})).unwrap();value[field]=if field=="bindings"{json!([])}else{json!("other")};let changed=serde_json::from_value(value).unwrap();assert!(take_admission(&changed).is_err());assert!(take_admission(&q).is_err());}
}
#[test]fn cancel_revokes_only_unsubmitted_admission_and_never_server_jobs(){let one=token(fixture("video",0),false);let other=token(fixture("image",0),false);let id=one.admission_token.clone().unwrap();let r=comfy_revoke_generation_admission(id.clone()).unwrap();assert_eq!(r["revoked"],true);assert_eq!(r["serverJobCancelled"],false);assert!(take_admission(&one).is_err());assert!(take_admission(&other).is_ok());assert_eq!(comfy_revoke_generation_admission(id).unwrap()["revoked"],false);}

#[test]fn v2_all_eight_model_contracts_reach_native_receipt_and_checked_history(){
    for i in 0..8{let f=reviewed_v2(i);let r=submission_record(&f,"cpu-v2");assert_eq!(r["admission"]["contractVersion"],2);assert!(verify_submission_record_for_preset(&r,&collect_request(&r),&history(&r),&f.preset).is_ok());assert!(policy::runtime_preset(&f.preset.graph_sha256).is_err());}
}
#[test]fn v2_migrated_music3_image_video_audio_use_the_same_native_receipt_engine(){
    let mut f=music3();migrate_v2(&mut f);assert_eq!(receipt(&f)["contractVersion"],2);
    for kind in ["image","video","audio"] {for refs in 0..=2 {let mut f=fixture(kind,refs);migrate_v2(&mut f);let r=submission_record(&f,"cpu-v2-generic");assert!(verify_submission_record_for_preset(&r,&collect_request(&r),&history(&r),&f.preset).is_ok());}}
}
#[test]fn v2_unregistered_packaged_policy_remains_blocked_without_model_fallback(){let f=reviewed_v2(5);let reason=check(&f.request,&f.owned).unwrap_err();assert!(reason.contains("preset_not_registered"));assert!(!reason.contains("version_unsupported"));}
#[test]fn v2_unknown_legacy_version_or_undeclared_extension_never_falls_back(){
    let mut f=music3();f.request.manifest["schemaVersion"]=json!(3);sync_manifest(&mut f);assert!(check(&f.request,&f.owned).unwrap_err().contains("version_unsupported"));
    let mut f=fixture("video",0);f.request.manifest["selectionEnvelope"]=json!({});sync_manifest(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("undeclared_extension"));
    let mut f=fixture("video",0);migrate_v2(&mut f);f.request.manifest["selectionEnvelope"]["extensions"]=json!([{"kind":"unknown"}]);sync_manifest(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err());
}
#[test]fn v2_receipt_rejects_changed_migration_union_reference_binding_or_history(){
    for i in [1,5,7] {let f=reviewed_v2(i);let mut r=submission_record(&f,"cpu-v2");r["manifest"]["selectionEnvelope"]["migration"]["serializer"]=json!("implicit");r["receiptSha256"]=json!(receipt_digest(&r).unwrap());assert!(verify_submission_record_for_preset(&r,&collect_request(&r),&history(&r),&f.preset).unwrap_err().contains("v2_contract_changed"));}
    let mut f=reviewed_v2(5);f.request.manifest["selectionEnvelope"]["extensions"][0]["members"]=json!(["STRING","INT"]);sync_manifest(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err());
    let f=reviewed_v2(1);let r=submission_record(&f,"cpu-v2");let mut h=history(&r);h["cpu-v2"]["prompt"][2]["6"]["inputs"]["ref_images.ref_image_0"]=json!(["21",0]);assert!(verify_submission_record_for_preset(&r,&collect_request(&r),&h,&f.preset).unwrap_err().contains("history_graph"));
}
#[test]fn v2_numeric_union_accepts_int_and_float_numbers_but_not_string_or_boolean(){let mut f=reviewed_v2(5);f.request.provenance["values"]["audioFps"]=json!(24.0);f.request.bindings.iter_mut().find(|b|b.node_id=="8"&&b.input=="frame_rate").unwrap().value=Some(json!(24.0));assert_eq!(receipt(&f)["contractVersion"],2);for value in [json!("24"),json!(true),json!(24.5)]{f.request.provenance["values"]["audioFps"]=value.clone();f.request.bindings.iter_mut().find(|b|b.node_id=="8"&&b.input=="frame_rate").unwrap().value=Some(value);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err());}}

#[test]fn g1_new_packaged_builtin_policy_uses_production_admission_single_use_durable_receipt_and_collection(){
 for kind in ["image","video","audio"]{
  let mut f=fixture(kind,0);migrate_v2(&mut f);let registry=crate::comfy_reviewed_registry::tests::registry(f.preset.clone());let plan=registry.backend_plan(&[]).unwrap();
  let root=tempfile::tempdir().unwrap();let settings=root.path().join("app-settings.json");fs::write(&settings,serde_json::to_vec(&json!({"entries":{"workflow-project-authorizations":{"value":f.request.manifest["weightAuthorizations"]}}})).unwrap()).unwrap();
  let graph_path=root.path().join("graph.json");fs::write(&graph_path,&f.bytes).unwrap();f.request.workflow_path=graph_path.to_string_lossy().into();f.request.manifest["workflowPath"]=json!(f.request.workflow_path);sync_manifest(&mut f);
  f.owned["registrySha256"]=json!(plan.registry_sha256);f.owned["reviewedPresetIds"]=json!(plan.preset_ids);f.owned["review"]=plan.review;f.owned["workRoot"]=json!(root.path());
  let submit:SubmitRequest=serde_json::from_value(json!({"baseUrl":f.request.base_url,"workflowPath":f.request.workflow_path,"expectedWorkflowSha256":f.request.expected_workflow_sha256,"bindings":f.request.bindings,"clientId":"cpu-client"})).unwrap();
  let admitted=admit_against_ready_backend(settings.clone(),f.request,&f.owned,&registry).unwrap();let mut submit=submit;submit.admission_token=Some(admitted["admissionToken"].as_str().unwrap().into());
  let admission=take_admission(&submit).unwrap();let record=consume_against_ready_backend(&submit,admission,&f.owned,&registry).unwrap();assert!(take_admission(&submit).is_err());
  let mut graph=f.preset.graph.clone();for binding in &submit.bindings{graph[&binding.node_id]["inputs"][&binding.input]=binding.value.clone().unwrap();}
  let id=format!("cpu-g1-{}",uuid::Uuid::new_v4());record_submission_against_registry(&id,record.clone(),graph.clone(),&registry).unwrap();record_submission_against_registry(&id,record,graph,&registry).unwrap();
  let saved:Value=serde_json::from_slice(&fs::read(root.path().join("submissions").join(format!("{id}.json"))).unwrap()).unwrap();let request=collect_request(&saved);verify_submission_record_against_registry(&saved,&request,&history(&saved),&registry).unwrap();
  if kind=="image"{let next:AdmissionRequest=serde_json::from_value(json!({"baseUrl":saved["baseUrl"],"workflowPath":graph_path,"expectedWorkflowSha256":saved["admission"]["workflowSha256"],"bindings":saved["bindings"],"manifest":saved["manifest"],"manifestJson":saved["manifestJson"],"provenance":saved["provenance"],"destination":saved["destination"]})).unwrap();let issued=admit_against_ready_backend(settings.clone(),next,&f.owned,&registry).unwrap();submit.admission_token=Some(issued["admissionToken"].as_str().unwrap().into());fs::write(&settings,serde_json::to_vec(&json!({"entries":{"workflow-project-authorizations":{"value":[]}}})).unwrap()).unwrap();let admission=take_admission(&submit).unwrap();assert!(consume_against_ready_backend(&submit,admission,&f.owned,&registry).is_err());assert!(take_admission(&submit).is_err());}
  let mut changed=registry.clone();changed.revision.push_str(" changed");assert!(verify_submission_record_against_registry(&saved,&request,&history(&saved),&changed).unwrap_err().contains("registry_changed"));
  let mut wrong=request;wrong.kind="other".into();assert!(verify_submission_record_against_registry(&saved,&wrong,&history(&saved),&registry).is_err());
 }
}
#[test]fn g1_unregistered_backend_policy_and_revoked_trusted_grant_fail_without_fallback(){
 let mut f=fixture("image",0);let registry=crate::comfy_reviewed_registry::tests::registry(f.preset.clone());let plan=registry.backend_plan(&[]).unwrap();f.owned["registrySha256"]=json!(plan.registry_sha256);f.owned["reviewedPresetIds"]=json!(plan.preset_ids);f.owned["review"]=plan.review;
 assert!(checked_preset_against_registry(&f.request,&f.owned,&registry).is_ok());f.owned["reviewedPresetIds"]=json!([]);assert!(checked_preset_against_registry(&f.request,&f.owned,&registry).is_err());
 let root=tempfile::tempdir().unwrap();let settings=root.path().join("settings.json");fs::write(&settings,serde_json::to_vec(&json!({"entries":{"workflow-project-authorizations":{"value":[]}}})).unwrap()).unwrap();assert!(trusted_grants(&settings,&f.preset,&f.request.manifest).is_err());
}


fn reviewed_fixture_pipeline(mut f:Fixture)->(tempfile::TempDir,Value){
 let registry=crate::comfy_reviewed_registry::tests::registry(f.preset.clone());let plan=registry.backend_plan(&[]).unwrap();let root=tempfile::tempdir().unwrap();let settings=root.path().join("app-settings.json");fs::write(&settings,serde_json::to_vec(&json!({"entries":{"workflow-project-authorizations":{"value":f.request.manifest["weightAuthorizations"]}}})).unwrap()).unwrap();let graph_path=root.path().join("graph.json");fs::write(&graph_path,&f.bytes).unwrap();f.request.workflow_path=graph_path.to_string_lossy().into();f.request.manifest["workflowPath"]=json!(f.request.workflow_path);sync_manifest(&mut f);f.owned["registrySha256"]=json!(plan.registry_sha256);f.owned["reviewedPresetIds"]=json!(plan.preset_ids);f.owned["review"]=plan.review;f.owned["workRoot"]=json!(root.path());
 let mut submit:SubmitRequest=serde_json::from_value(json!({"baseUrl":f.request.base_url,"workflowPath":f.request.workflow_path,"expectedWorkflowSha256":f.request.expected_workflow_sha256,"bindings":f.request.bindings,"clientId":"cpu-client"})).unwrap();let issued=admit_against_ready_backend(settings,f.request,&f.owned,&registry).unwrap();submit.admission_token=Some(issued["admissionToken"].as_str().unwrap().into());let admission=take_admission(&submit).unwrap();let record=consume_against_ready_backend(&submit,admission,&f.owned,&registry).unwrap();assert!(take_admission(&submit).is_err());let mut graph=f.preset.graph.clone();for binding in &submit.bindings{graph[&binding.node_id]["inputs"][&binding.input]=binding.value.clone().unwrap();}let id=format!("cpu-finding-{}",uuid::Uuid::new_v4());record_submission_against_registry(&id,record,graph,&registry).unwrap();let saved:Value=serde_json::from_slice(&fs::read(root.path().join("submissions").join(format!("{id}.json"))).unwrap()).unwrap();verify_submission_record_against_registry(&saved,&collect_request(&saved),&history(&saved),&registry).unwrap();(root,saved)
}
fn repeated_weight_fixture()->Fixture{let mut f=fixture("image",0);let mut weight=f.preset.weights[0].clone();weight.node_id="11".into();f.preset.weights.push(weight);f.preset.graph["11"]=f.preset.graph["1"].clone();f.preset.graph["3"]["inputs"]["alternate_model"]=json!(["11",0]);f.bytes=serde_json::to_vec(&f.preset.graph).unwrap();f.preset.graph_sha256=policy::sha(&f.bytes);let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);let grant=f.request.manifest["weightAuthorizations"][0].clone();f.request.manifest["weightAuthorizations"]=json!([grant.clone()]);f.request.provenance["weightAuthorizations"]=json!([grant]);f.owned["weights"]=json!([f.owned["weights"][0].clone()]);sync_manifest(&mut f);f}
#[test]fn f3_duplicate_loader_file_uses_one_trusted_grant_and_preserves_both_loader_checks(){for v2 in [false,true]{let mut f=repeated_weight_fixture();if v2{migrate_v2(&mut f);}let grants=f.request.manifest["weightAuthorizations"].as_array().unwrap();assert!(policy::validate_trusted_grants(&f.preset,&f.request.manifest,grants).is_ok());assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&[]).is_ok());let original=f.request.manifest["weightRequirements"][1]["nodeId"].clone();f.request.manifest["weightRequirements"][1]["nodeId"]=json!("wrong");sync_manifest(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&[]).is_err());f.request.manifest["weightRequirements"][1]["nodeId"]=original;sync_manifest(&mut f);let registry=crate::comfy_reviewed_registry::tests::registry(f.preset.clone());assert_eq!(crate::comfy_reviewed_registry::authorization_options(&registry).unwrap()["presets"][0]["files"].as_array().unwrap().len(),1);assert_eq!(registry.backend_plan(&[]).unwrap().weights.len(),1);let(_root,saved)=reviewed_fixture_pipeline(f);assert_eq!(saved["manifest"]["weightRequirements"].as_array().unwrap().len(),2);assert_eq!(saved["manifest"]["weightAuthorizations"].as_array().unwrap().len(),1);}}
fn multiple_roles_fixture(v2:bool)->Fixture{let mut f=fixture("image",0);f.preset.graph["12"]=f.preset.graph["2"].clone();f.preset.graph["13"]=f.preset.graph["2"].clone();f.preset.graph["3"]["inputs"]["secondary"]=json!(["12",0]);f.preset.graph["3"]["inputs"]["secondary_negative"]=json!(["13",0]);for(id,node,semantic)in [("secondaryPositive","12","positive"),("secondaryNegative","13","negative")]{f.preset.selection["slots"].as_array_mut().unwrap().push(json!({"id":id,"semantic":semantic,"nodeId":node,"input":"text","required":true}));let mut binding=f.preset.bindings[0].clone();binding.slot_id=id.into();binding.node_id=node.into();binding.semantic=semantic.into();if semantic=="negative"{binding.rule=policy::ScalarRule::Text{min:0,max:32000};}f.preset.bindings.push(binding);}f.preset.selection["promptRoles"].as_array_mut().unwrap().push(json!({"id":"secondary","modelRuleId":f.preset.model_rule_id,"loaderNodeIds":["1"],"positiveSlotIds":["secondaryPositive"],"negativeSlotIds":["secondaryNegative"],"negativeSupport":"supported"}));f.bytes=serde_json::to_vec(&f.preset.graph).unwrap();f.preset.graph_sha256=policy::sha(&f.bytes);let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);f.request.provenance["rolePrompts"]=json!({"secondary":{"positive":"blue sky","negative":"no haze"}});f.request.provenance["values"]["secondaryPositive"]=json!("blue sky");f.request.provenance["values"]["secondaryNegative"]=json!("no haze");f.request.bindings[1].value=Some(json!("blue sky"));f.request.bindings[2].value=Some(json!("no haze"));if v2{migrate_v2(&mut f);}f}
#[test]fn f4_two_roles_keep_distinct_positive_and_negative_bodies_in_v1_and_v2(){for v2 in [false,true]{let mut f=multiple_roles_fixture(v2);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&[]).is_ok());f.request.provenance["rolePrompts"]["secondary"]["positive"]=json!("changed");assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&[]).is_err());let(_root,saved)=reviewed_fixture_pipeline(multiple_roles_fixture(v2));assert_eq!(saved["submittedGraph"]["12"]["inputs"]["text"],"blue sky");assert_eq!(saved["submittedGraph"]["13"]["inputs"]["text"],"no haze");assert_eq!(saved["provenance"]["rolePrompts"]["secondary"]["positive"],"blue sky");let mut tampered=saved.clone();tampered["provenance"]["rolePrompts"]["secondary"]["positive"]=json!("changed");tampered["receiptSha256"]=json!(receipt_digest(&tampered).unwrap());assert!(verify_submission_record_for_preset(&tampered,&collect_request(&tampered),&history(&tampered),&multiple_roles_fixture(v2).preset).is_err());}}
#[test]fn f5_v2_standard_reference_semantics_include_mask_pose_depth_camera_and_voice(){for (semantic,kind) in [("poseImage","image"),("depthImage","image"),("poseVideo","video"),("depthVideo","video"),("cameraGuide","video"),("voiceReference","audio")]{let mut f=fixture("video",1);f.preset.selection["slots"][1]["semantic"]=json!(semantic);f.preset.selection["referenceGroups"][0]["role"]=json!(semantic);f.preset.selection["referenceGroups"][0]["mediaKind"]=json!(kind);f.preset.bindings[1].semantic=semantic.into();f.preset.bindings[1].rule=policy::ScalarRule::Reference{media_kind:kind.into()};let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);f.facts[0]["width"]=json!(256);f.facts[0]["height"]=json!(256);f.facts[0]["fps"]=json!(24);f.facts[0]["frameCount"]=json!(24);f.facts[0]["durationSeconds"]=json!(1);f.facts[0]["maskConvention"]=json!("white-edit");migrate_v2(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_ok(),"{semantic}");f.facts[0]["kind"]=json!("other");assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err());}}
#[test]fn f5_mask_image_v2_keeps_native_convention_and_source_dimensions(){let mut f=crate::comfy_preset_test_fixture::mask_fixture();migrate_v2(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_ok());f.facts[1]["maskConvention"]=json!("alpha-inverted");assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err());f.facts[1]["maskConvention"]=json!("white-edit");f.facts[1]["width"]=json!(512);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err());}

#[test]fn f4_unknown_missing_body_mixed_model_and_ambiguous_slot_never_use_primary_fallback(){
 for v2 in [false,true] {for failure in ["unknown","missing","model","slot"] {
  let mut f=multiple_roles_fixture(v2);
  match failure {
   "unknown"=>f.request.provenance["rolePrompts"]["other"]=json!({"positive":"unreviewed"}),
   "missing"=>f.request.provenance["rolePrompts"].as_object_mut().unwrap().remove("secondary").map(|_|()).unwrap(),
   "model"=>f.preset.selection["promptRoles"][1]["modelRuleId"]=json!("different-model"),
   _=>f.preset.selection["promptRoles"][1]["positiveSlotIds"]=json!(["positive"])
  }
  assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&[]).is_err(),"{failure}");
 }}
}
#[test]fn f5_exact_alignment_keeps_native_video_timebase_and_audio_duration_checks(){
 for (semantic,kind) in [("cameraGuide","video"),("voiceReference","audio")] {
  let mut f=fixture("video",1);f.preset.selection["slots"][1]["semantic"]=json!(semantic);f.preset.selection["slots"][1]["alignment"]=json!("exact");f.preset.selection["referenceGroups"][0]["role"]=json!(semantic);f.preset.selection["referenceGroups"][0]["mediaKind"]=json!(kind);f.preset.bindings[1].semantic=semantic.into();f.preset.bindings[1].rule=policy::ScalarRule::Reference{media_kind:kind.into()};
  for (id,semantic,value) in [("fps","fps",24.0),("duration","durationSeconds",1.5)] {
   f.preset.graph["3"]["inputs"][id]=json!(value);f.preset.selection["slots"].as_array_mut().unwrap().push(json!({"id":id,"nodeId":"3","input":id,"semantic":semantic,"required":true}));
   let mut binding=f.preset.bindings[0].clone();binding.slot_id=id.into();binding.node_id="3".into();binding.input=id.into();binding.semantic=semantic.into();binding.rule=policy::ScalarRule::Number{min:0.0,max:1000.0,min_exclusive:true,integer:false};f.preset.bindings.push(binding);
  }
  f.bytes=serde_json::to_vec(&f.preset.graph).unwrap();f.preset.graph_sha256=policy::sha(&f.bytes);let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);f.facts[0]["fps"]=json!(24.0);f.facts[0]["durationSeconds"]=json!(1.5);migrate_v2(&mut f);
  assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_ok(),"{semantic}");
  if kind=="video" {f.facts[0]["fps"]=json!(25.0);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("timebase_mismatch"));f.facts[0]["fps"]=json!(24.0);}
  f.facts[0]["durationSeconds"]=json!(1.8);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("duration_mismatch"));
 }
}
#[test]fn f5_mask_video_is_explicitly_unsupported_without_adopting_caller_flags(){
 let mut f=fixture("video",1);f.preset.selection["slots"][1]["semantic"]=json!("maskVideo");f.preset.selection["referenceGroups"][0]["role"]=json!("maskVideo");f.preset.selection["referenceGroups"][0]["mediaKind"]=json!("video");f.preset.bindings[1].semantic="maskVideo".into();f.preset.bindings[1].rule=policy::ScalarRule::Reference{media_kind:"video".into()};let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);migrate_v2(&mut f);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("mask_video_unsupported"));
}
#[test]fn v5_f1_reviewed_fixed_graph_exact_reference_v1(){let f=crate::comfy_preset_test_fixture::fixed_timebase_fixture(false,"video");let result=policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts);assert!(result.is_ok(),"reviewed fixed fps24/length36 should match exact native video facts: {result:?}");}
#[test]fn v5_f1_reviewed_fixed_graph_exact_reference_v2(){let f=crate::comfy_preset_test_fixture::fixed_timebase_fixture(true,"video");let result=policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts);assert!(result.is_ok(),"reviewed fixed fps24/length36 should match exact native video facts: {result:?}");}
#[test]fn v5_f1_fixed_audio_duration_and_fixed_video_facts_remain_exact(){
 for v2 in [false,true]{for kind in ["video","audio"]{let mut f=crate::comfy_preset_test_fixture::fixed_timebase_fixture(v2,kind);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_ok());f.facts[0]["durationSeconds"]=json!(2.0);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("duration_mismatch"));f.facts[0]["durationSeconds"]=json!(1.5);if kind=="video"{f.facts[0]["fps"]=json!(30);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("timebase_mismatch"));}}}
}
#[test]fn v5_f1_fixed_graph_conflict_missing_invalid_and_ambiguous_reject_in_admission(){
 for v2 in [false,true]{for reason in ["conflict","missing-fps","missing-duration","invalid","ambiguous"]{
  let mut f=crate::comfy_preset_test_fixture::fixed_timebase_fixture(false,"video");
  match reason {
   "conflict"=>f.preset.graph["3"]["inputs"]["durationSeconds"]=json!(2.0),
   "missing-fps"=>{f.preset.graph["3"]["inputs"].as_object_mut().unwrap().remove("fps");},
   "missing-duration"=>{f.preset.graph["3"]["inputs"].as_object_mut().unwrap().remove("length");},
   "invalid"=>f.preset.graph["3"]["inputs"]["fps"]=json!("24"),
   _=>f.preset.graph["2"]["inputs"]["fps"]=json!(30)
  }
  f.bytes=serde_json::to_vec(&f.preset.graph).unwrap();f.preset.graph_sha256=policy::sha(&f.bytes);let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);f.facts[0]["fps"]=json!(24);f.facts[0]["durationSeconds"]=json!(1.5);if v2{migrate_v2(&mut f);}
  assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_err(),"{reason}");
 }}
}
#[test]fn v5_f1_semantic_overrides_use_actual_validated_bindings_and_reject_provenance_conflicts(){
 for v2 in [false,true]{
  let mut f=crate::comfy_preset_test_fixture::fixed_timebase_fixture(false,"video");
  for (id,field,semantic) in [("fps","fps","fps"),("frames","length","frameCount")]{
   f.preset.selection["slots"].as_array_mut().unwrap().push(json!({"id":id,"nodeId":"3","input":field,"semantic":semantic,"required":true}));let mut rule=f.preset.bindings[0].clone();rule.slot_id=id.into();rule.node_id="3".into();rule.input=field.into();rule.semantic=semantic.into();rule.rule=policy::ScalarRule::Number{min:1.0,max:1000.0,min_exclusive:false,integer:semantic=="frameCount"};f.preset.bindings.push(rule);
  }
  let mut f=crate::comfy_preset_test_fixture::from_preset(f.preset,f.bytes);for (id,value) in [("fps",30),("frames",45)]{let binding=f.preset.bindings.iter().find(|r|r.slot_id==id).unwrap();f.request.bindings.iter_mut().find(|b|b.node_id==binding.node_id&&b.input==binding.input).unwrap().value=Some(json!(value));f.request.provenance["values"][id]=json!(value);}f.facts[0]["fps"]=json!(30);f.facts[0]["durationSeconds"]=json!(1.5);if v2{migrate_v2(&mut f);}
  assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).is_ok());f.request.provenance["values"]["fps"]=json!(24);assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap_err().contains("binding_provenance_mismatch"));
 }
}
