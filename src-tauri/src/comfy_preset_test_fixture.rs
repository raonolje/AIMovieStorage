//! 네트워크·모델·GPU를 사용하지 않는 검토 정책 fixture이며 runtime allowlist가 아닙니다.
use serde_json::{json,Value};
use crate::{comfy_admission::AdmissionRequest,comfy_preset_policy::{self as policy,ReviewedPreset}};

pub struct Fixture {pub preset:ReviewedPreset,pub bytes:Vec<u8>,pub request:AdmissionRequest,pub owned:Value,pub facts:Vec<Value>}
pub fn fixture(kind:&str,refs:usize)->Fixture {
    let class=format!("CpuFixtureSave{kind}");
    let mut graph=json!({"1":{"class_type":"UNETLoader","inputs":{"unet_name":"cpu-fixture.safetensors"}},"2":{"class_type":"CpuFixtureTextEncode","inputs":{"text":"CPU only"}},"3":{"class_type":class,"inputs":{"samples":["2",0],"filename_prefix":"fixture"}}});
    let mut slots=vec![json!({"id":"positive","nodeId":"2","input":"text","semantic":"positive","required":true})];
    let mut bindings=vec![json!({"slotId":"positive","nodeId":"2","input":"text","semantic":"positive","rule":{"type":"text","min":1,"max":32000}})];
    let mut groups=vec![];
    for i in 0..refs {
        let id=format!("ref{i}");let node=format!("{}",i+4);
        graph[&node]=json!({"class_type":"CpuFixtureLoadImage","inputs":{"image":"reference.png"}});
        slots.push(json!({"id":id,"nodeId":node,"input":"image","semantic":"identityImage","required":true}));
        bindings.push(json!({"slotId":id,"nodeId":node,"input":"image","semantic":"identityImage","rule":{"type":"reference","mediaKind":"image"}}));
    }
    if refs>0 {groups.push(json!({"id":"identities","role":"identityImage","mediaKind":"image","minItems":refs,"maxItems":refs,"slotIds":(0..refs).map(|i|format!("ref{i}")).collect::<Vec<_>>(),"strategy":"fixed-slots","order":"explicit","identity":if refs==1{"single"}else{"multiple"}}));}
    let bytes=serde_json::to_vec(&graph).unwrap();let graph_sha=policy::sha(&bytes);let module_sha="a".repeat(64);let schema_sha="b".repeat(64);let weight_sha="c".repeat(64);
    let mut reviewed=serde_json::Map::new();let mut schemas=serde_json::Map::new();
    for node in graph.as_object().unwrap().values() {
        let name=node["class_type"].as_str().unwrap();reviewed.insert(name.into(),json!({"pythonModule":"nodes","reviewId":"cpu-fixture-review","sourceSha256":module_sha}));schemas.insert(name.into(),json!(schema_sha));
    }
    reviewed["UNETLoader"]["assets"]=json!({"unet_name":{"category":"diffusion_models","kind":"model","promptModel":true}});
    let operation=match kind {"image"=>"text-to-image","video"=>"text-to-video",_=>"music-generation"};
    let registration=match kind {"image"=>"character-generated","video"=>"scene-video",_=>"bgm-track"};
    let preset:ReviewedPreset=serde_json::from_value(json!({"schemaVersion":1,"id":format!("cpu-{kind}-{refs}"),"reviewRevision":"cpu-only-policy","graphSha256":graph_sha,"graph":graph,"selection":{"slots":slots,"promptRoles":[{"id":"primary","modelRuleId":"cpu-fixture-model","loaderNodeIds":["1"],"positiveSlotIds":["positive"],"negativeSlotIds":[],"negativeSupport":"unsupported"}],"selectedPromptRoleId":"primary","outputNodeIds":["3"],"referenceGroups":groups},"modelRuleId":"cpu-fixture-model","roleId":"primary","operation":operation,"outputKind":kind,"registrationKinds":[registration],"customNodePolicy":"forbidden","downloadPolicy":"forbidden","fixedReferenceCount":refs,"review":{"comfyVersion":"cpu","reviewVersion":"cpu-fixture-review","pythonVersion":"cpu-python","torchVersion":"cpu-torch","diskCoreCommit":"d".repeat(40),"reviewedNodes":reviewed,"schemaFingerprints":schemas,"sourceFiles":[{"module":"nodes","sha256":module_sha}]},"weights":[{"nodeId":"1","input":"unet_name","category":"diffusion_models","name":"cpu-fixture.safetensors","sha256":weight_sha,"kind":"model","publicLicense":"unknown"}],"bindings":bindings})).unwrap();
    from_preset(preset,bytes)
}
pub fn music3()->Fixture {
    let preset=policy::runtime_preset("305409054b67e11de5de8c91c3ea09865d062e496dfd919244f6f0209fb5d57d").unwrap();
    from_preset(preset,include_bytes!("../resources/comfy-music3-smoke.api.json").to_vec())
}
pub(crate) fn from_preset(preset:ReviewedPreset,bytes:Vec<u8>)->Fixture {
    let grants=preset.weights.iter().map(|w|json!({"kind":"user-reported","projectId":"cpu-project","modelRuleId":preset.model_rule_id,"category":w.category,"name":w.name,"sha256":w.sha256,"evidence":"CPU fixture only; not a real authorization","sourceThreadId":"cpu-fixture","reportedAtUtc":"2026-10-07T00:00:00Z"})).collect::<Vec<_>>();
    let needs=preset.graph.as_object().unwrap().iter().map(|(id,node)|{let class=node["class_type"].as_str().unwrap();let pin=&preset.review["reviewedNodes"][class];json!({"nodeId":id,"classType":class,"pythonModule":pin["pythonModule"],"reviewId":pin["reviewId"],"sourceSha256":pin["sourceSha256"],"schemaSha256":preset.review["schemaFingerprints"][class]})}).collect::<Vec<_>>();
    let weights=preset.weights.iter().map(|w|json!({"nodeId":w.node_id,"input":w.input,"category":w.category,"name":w.name,"sha256":w.sha256,"kind":w.kind,"license":"allowed","publicLicense":w.public_license,"authorization":grants.iter().find(|g|g["name"]==w.name).unwrap()})).collect::<Vec<_>>();
    let target=json!({"kind":"workflow","workflowId":"cpu-workflow","workflowSha256":preset.graph_sha256,"roleId":preset.role_id,"modelRuleId":preset.model_rule_id});
    let manifest=json!({"workflowId":"cpu-workflow","workflowSha256":preset.graph_sha256,"promptTarget":target,"projectId":"cpu-project","weightAuthorizations":grants,"selection":preset.selection,"operation":preset.operation,"outputKind":preset.output_kind,"environment":{"comfyVersion":preset.review["comfyVersion"],"reviewVersion":preset.review["reviewVersion"],"pythonVersion":preset.review["pythonVersion"],"torchVersion":preset.review["torchVersion"],"coreCommit":preset.review["diskCoreCommit"],"customNodeVersions":{}},"nodeRequirements":needs,"weightRequirements":weights,"verification":{"static":"passed","installedRequirements":"passed","actualGenerationRegistration":"not-run","executionAdmission":"required","checkedAtUtc":"2026-10-07T00:00:00Z"}});
    let mut input_bindings=vec![];let mut values=serde_json::Map::new();let mut assets=vec![];let mut facts=vec![];
    for rule in &preset.bindings {
        match &rule.rule {
            policy::ScalarRule::Reference{media_kind}=>{
                let path=format!("C:/cpu-project/{}.png",rule.slot_id);let asset=format!("asset-{}",rule.slot_id);let asset_sha="e".repeat(64);
                input_bindings.push(json!({"nodeId":rule.node_id,"input":rule.input,"filePath":path}));assets.push(json!({"slotId":rule.slot_id,"assetId":asset,"sha256":asset_sha}));
                facts.push(json!({"source":"native-registered-file-fact-v1","slotId":rule.slot_id,"assetId":asset,"projectId":"cpu-project","kind":media_kind,"path":path,"sha256":asset_sha,"bytes":100,"decodable":true,"fullDecode":true}));
            },
            _=>{
                let value=if rule.semantic=="positive" {json!("CPU only")} else {preset.graph[&rule.node_id]["inputs"][&rule.input].clone()};
                input_bindings.push(json!({"nodeId":rule.node_id,"input":rule.input,"value":value}));values.insert(rule.slot_id.clone(),value);
            }
        }
    }
    let mut manifest=manifest;manifest["schemaVersion"]=json!(1);manifest["modelIds"]=json!([preset.model_rule_id]);manifest["promptProfile"]=json!(preset.model_rule_id);manifest["workflowPath"]=json!("cpu-fixture-no-file");
    let manifest_json=serde_json::to_string(&manifest).unwrap();
    let request:AdmissionRequest=serde_json::from_value(json!({"baseUrl":"http://127.0.0.1:8190","workflowPath":"cpu-fixture-no-file","expectedWorkflowSha256":preset.graph_sha256,"bindings":input_bindings,"manifest":manifest,"manifestJson":manifest_json,"provenance":{"workflowSha256":preset.graph_sha256,"manifestSha256":policy::sha(manifest_json.as_bytes()),"promptTarget":target,"projectId":"cpu-project","weightAuthorizations":manifest["weightAuthorizations"],"verification":manifest["verification"],"prompt":"CPU only","negative":"","clientId":"cpu-client","values":values,"assets":assets},"destination":{"baseDirectory":"C:/cpu-only","projectName":"CPU","assetType":preset.registration_kinds[0],"ownerName":"CPU","stem":"CPU","kind":preset.output_kind}})).unwrap();
    let mut sources=serde_json::Map::new();for source in preset.review["sourceFiles"].as_array().unwrap(){sources.insert(source["module"].as_str().unwrap().into(),source["sha256"].clone());}
    let owned=json!({"identityContractVersion":2,"managerPid":std::process::id(),"launcherPid":std::process::id()+1,"serverPid":std::process::id()+2,"nonce":"cpu-only-no-secret","baseUrl":request.base_url,"sourceEvidence":"owned-child-attestation","sourceFingerprint":"f".repeat(64),"bootstrapSha256":"a".repeat(64),"coreCommit":preset.review["diskCoreCommit"],"nodeSourceHashes":sources,"weights":manifest["weightRequirements"],"workRoot":"C:/cpu-only"});
    let mut owned=owned;let registry=crate::comfy_reviewed_registry::packaged().unwrap();let plan=registry.backend_plan(&[]).unwrap();owned["registrySha256"]=json!(plan.registry_sha256);owned["reviewedPresetIds"]=json!(plan.preset_ids);owned["review"]=plan.review;Fixture{preset,bytes,request,owned,facts}
}
pub fn sync_manifest(f:&mut Fixture){
    f.request.manifest_json=serde_json::to_string(&f.request.manifest).unwrap();
    f.request.provenance["manifestSha256"]=json!(policy::sha(f.request.manifest_json.as_bytes()));
}
pub fn mask_fixture()->Fixture {
    let mut f=fixture("image",2);
    f.preset.selection["slots"][1]["semantic"]=json!("sourceImage");
    f.preset.selection["slots"][2]["semantic"]=json!("maskImage");
    f.preset.selection["slots"][2]["maskConvention"]=json!("white-edit");
    f.preset.selection["referenceGroups"]=json!([
        {"id":"source","role":"sourceImage","mediaKind":"image","minItems":1,"maxItems":1,"slotIds":["ref0"],"strategy":"fixed-slots","order":"explicit","identity":"none"},
        {"id":"mask","role":"maskImage","mediaKind":"image","minItems":1,"maxItems":1,"slotIds":["ref1"],"strategy":"fixed-slots","order":"explicit","identity":"none"}
    ]);
    f.preset.bindings[1].semantic="sourceImage".into();
    f.preset.bindings[2].semantic="maskImage".into();
    let mut f=from_preset(f.preset,f.bytes);
    for fact in &mut f.facts{fact["width"]=json!(256);fact["height"]=json!(256);}
    f.facts[1]["maskConvention"]=json!("white-edit");f
}
pub fn fixed_timebase_fixture(v2:bool,kind:&str)->Fixture {
    let mut f=fixture("video",1);
    let semantic=if kind=="video"{"cameraGuide"}else{"voiceReference"};
    f.preset.graph["3"]["inputs"]["fps"]=json!(24.0);
    f.preset.graph["3"]["inputs"]["length"]=json!(36);
    f.preset.selection["slots"][1]["semantic"]=json!(semantic);
    f.preset.selection["slots"][1]["alignment"]=json!("exact");
    f.preset.selection["referenceGroups"][0]["role"]=json!(semantic);
    f.preset.selection["referenceGroups"][0]["mediaKind"]=json!(kind);
    f.preset.selection["referenceGroups"][0]["identity"]=json!("none");
    f.preset.bindings[1].semantic=semantic.into();
    f.preset.bindings[1].rule=policy::ScalarRule::Reference{media_kind:kind.into()};
    f.bytes=serde_json::to_vec(&f.preset.graph).unwrap();
    f.preset.graph_sha256=policy::sha(&f.bytes);
    let mut f=from_preset(f.preset,f.bytes);
    f.facts[0]["fps"]=json!(24.0);f.facts[0]["frameCount"]=json!(36);
    f.facts[0]["durationSeconds"]=json!(1.5);
    if v2{migrate_v2(&mut f);}f
}
pub fn receipt(f:&Fixture)->Value {policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&f.facts).unwrap()}

pub fn migrate_v2(f:&mut Fixture){
    let base=f.request.manifest["selection"].clone();let original=serde_json::to_string(&base).unwrap();let digest=policy::sha(original.as_bytes());
    f.request.manifest["schemaVersion"]=json!(2);f.request.manifest["policyVersion"]=json!("workflow-contract-v2.0-exact-variants");
    f.request.manifest["selectionEnvelope"]=json!({"schemaVersion":2,"base":base,"originalV1SelectionJson":original,"originalV1SelectionSha256":digest,"migration":{"fromSchemaVersion":1,"serializer":"exact-json-text-sha256","legacySelectionSha256":digest},"extensions":[]});
    f.request.manifest["rawNodeRequirements"]=f.request.manifest["nodeRequirements"].clone();f.request.manifest["extensionsSha256"]=json!(policy::value_sha(&json!([])).unwrap());sync_manifest(f);
}

/// 합성 weight·허가·owned 사실로 공통 실행 검증 함수를 시험하며 실제 registry에는 등록하지 않습니다.
pub fn reviewed_v2(index:usize)->Fixture {
    let review:Value=serde_json::from_str(include_str!("../resources/comfy-v2-conditional-contract-review.json")).unwrap();
    let schemas:Value=serde_json::from_str(include_str!("../resources/comfy-v2-reviewed-raw-schemas.json")).unwrap();
    let v=&review["entries"][index];let graph=v["graph"].clone();let selection=v["selectionEnvelope"]["base"].clone();
    let mut pins=serde_json::Map::new();let mut fingerprints=serde_json::Map::new();let mut sources=serde_json::Map::new();let mut weights=vec![];
    for (id,node) in graph.as_object().unwrap(){let class=node["class_type"].as_str().unwrap();let pin=schemas["schemas"][class]["review"].clone();pins.insert(class.into(),pin.clone());fingerprints.insert(class.into(),schemas["schemas"][class]["schemaSha256"].clone());sources.insert(pin["pythonModule"].as_str().unwrap().into(),pin["sourceSha256"].clone());
        for (input,asset) in pin["assets"].as_object().into_iter().flatten(){weights.push(json!({"nodeId":id,"input":input,"category":asset["category"],"name":node["inputs"][input],"sha256":"c".repeat(64),"kind":asset["kind"],"publicLicense":"unknown"}));}
    }
    let slots=selection["slots"].as_array().unwrap();let mut refs=0;
    let bindings=slots.iter().map(|s|{let semantic=s["semantic"].as_str().unwrap();let rule=match semantic{
        "identityImage"|"firstFrame"|"endFrame"|"sourceImage"=>{refs+=1;json!({"type":"reference","mediaKind":"image"})},
        "sourceVideo"=>{refs+=1;json!({"type":"reference","mediaKind":"video"})},
        "audio"=>{refs+=1;json!({"type":"reference","mediaKind":"audio"})},
        "positive"|"negative"=>json!({"type":"text","min":if semantic=="positive"{1}else{0},"max":32000}),
        "seed"=>json!({"type":"unsigned"}),
        _=>json!({"type":"number","min":1.0,"max":16384.0,"minExclusive":false,"integer":true}),
    };json!({"slotId":s["id"],"nodeId":s["nodeId"],"input":s["input"],"semantic":s["semantic"],"rule":rule})}).collect::<Vec<_>>();
    let mut selection_shape=selection.clone();for slot in selection_shape["slots"].as_array_mut().unwrap(){slot.as_object_mut().unwrap().remove("defaultValue");}
    let preset:ReviewedPreset=serde_json::from_value(json!({"schemaVersion":1,"id":format!("cpu-v2-{}",v["id"].as_str().unwrap()),"reviewRevision":"cpu-v2-only-not-runtime","graphSha256":v["workflowSha256"],"graph":graph,"selection":selection_shape,"modelRuleId":selection["promptRoles"][0]["modelRuleId"],"roleId":"primary","operation":"image-to-video","outputKind":"video","registrationKinds":["scene-video"],"customNodePolicy":"forbidden","downloadPolicy":"forbidden","fixedReferenceCount":refs,"review":{"comfyVersion":review["comfyVersion"],"reviewVersion":review["reviewVersion"],"pythonVersion":"cpu-python","torchVersion":"cpu-torch","diskCoreCommit":review["coreCommit"],"sourceFiles":sources.iter().map(|(module,sha)|json!({"module":module,"sha256":sha})).collect::<Vec<_>>(),"reviewedNodes":pins,"schemaFingerprints":fingerprints,"contractV2":v},"weights":weights,"bindings":bindings})).unwrap();
    let bytes=match index {
        0=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-1-identity.api.json").to_vec(),1=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-2-identity.api.json").to_vec(),2=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-4-identity.api.json").to_vec(),3=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-2-identity-video.api.json").to_vec(),4=>include_bytes!("../resources/comfy-v2-graphs/h3-ref2va-1-identity-audio.api.json").to_vec(),5=>include_bytes!("../resources/comfy-v2-graphs/ltx25-distilled-t2va.api.json").to_vec(),6=>include_bytes!("../resources/comfy-v2-graphs/ltx25-distilled-first-frame.api.json").to_vec(),_=>include_bytes!("../resources/comfy-v2-graphs/ltx25-distilled-first-last-frame.api.json").to_vec(),
    };
    let mut f=from_preset(preset,bytes);f.request.manifest["selection"]=selection;
    f.request.manifest["schemaVersion"]=json!(2);f.request.manifest["policyVersion"]=json!("workflow-contract-v2.0-exact-variants");f.request.manifest["selectionEnvelope"]=v["selectionEnvelope"].clone();f.request.manifest["nodeRequirements"]=v["rawNodeRequirements"].clone();f.request.manifest["rawNodeRequirements"]=v["rawNodeRequirements"].clone();f.request.manifest["extensionsSha256"]=json!(policy::value_sha(&v["selectionEnvelope"]["extensions"]).unwrap());
    for fact in &mut f.facts {fact["width"]=json!(if index<5{1344}else{768});fact["height"]=json!(if index<5{768}else{512});fact["fps"]=json!(24);fact["frameCount"]=json!(56);fact["durationSeconds"]=json!(56.0/24.0);fact["audioTracks"]=json!(1);}
    sync_manifest(&mut f);f
}
