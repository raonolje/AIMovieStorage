use super::*;
struct Fixture {dir:tempfile::TempDir,base:PathBuf,root:PathBuf,image:PathBuf}
fn fixture()->Fixture{
    let dir=tempfile::tempdir().unwrap();let base=dir.path().join("library");let root=base.join("CPU");fs::create_dir_all(&root).unwrap();let image=root.join("tiny.png");image::GrayImage::from_raw(2,1,vec![0,255]).unwrap().save(&image).unwrap();
    fs::write(dir.path().join("app-settings.json"),serde_json::to_vec(&json!({"entries":{"mediaLibrary":{"value":{"baseDirectory":base}}}})).unwrap()).unwrap();
    fs::write(root.join("project.json"),serde_json::to_vec(&json!({"id":"cpu-project","draft":{"characters":[{"id":"character-a","images":[{"id":"asset-a","filePath":image}]}],"backgrounds":[],"scenes":[],"sharedAssets":[]}})).unwrap()).unwrap();Fixture{dir,base,root,image}
}
fn fact(f:&Fixture)->Res<Value>{issue(f.dir.path(),"cpu-project","asset-a",f.base.to_str().unwrap(),"CPU",f.image.to_str().unwrap(),"image")}
#[test]fn exact_saved_registration_issues_cpu_image_identity_and_full_hash(){let f=fixture();let v=fact(&f).unwrap();assert_eq!(v["source"],"native-registered-file-fact-v1");assert_eq!(v["identityId"],"character-a");assert_eq!(v["width"],2);assert_eq!(v["fullDecode"],true);assert_eq!(v["sha256"],crate::comfy_generation::hash_file(&f.image).unwrap());}
#[test]fn id_project_path_kind_and_private_library_are_independently_checked(){let f=fixture();for (project,id,base,path,kind) in [("foreign","asset-a",f.base.to_str().unwrap(),f.image.to_str().unwrap(),"image"),("cpu-project","unregistered",f.base.to_str().unwrap(),f.image.to_str().unwrap(),"image"),("cpu-project","asset-a",f.dir.path().to_str().unwrap(),f.image.to_str().unwrap(),"image"),("cpu-project","asset-a",f.base.to_str().unwrap(),f.image.to_str().unwrap(),"audio")]{assert!(issue(f.dir.path(),project,id,base,"CPU",path,kind).is_err());}let other=f.root.join("other.png");fs::copy(&f.image,&other).unwrap();assert!(issue(f.dir.path(),"cpu-project","asset-a",f.base.to_str().unwrap(),"CPU",other.to_str().unwrap(),"image").unwrap_err().contains("path_or_kind_changed"));}
#[test]fn external_and_unregistered_file_booleans_are_never_adopted(){let f=fixture();let path=f.root.join("project.json");let mut p=read_json(&path).unwrap();p["draft"]["characters"][0]["images"][0]["filePath"]=json!(f.dir.path().join("outside.png"));p["draft"]["characters"][0]["images"][0]["decodable"]=json!(true);fs::copy(&f.image,f.dir.path().join("outside.png")).unwrap();fs::write(&path,serde_json::to_vec(&p).unwrap()).unwrap();assert!(fact(&f).is_err());}
#[test]fn revoked_or_ambiguous_asset_registration_is_blocked(){let f=fixture();let path=f.root.join("project.json");let mut p=read_json(&path).unwrap();p["draft"]["characters"][0]["images"]=json!([]);fs::write(&path,serde_json::to_vec(&p).unwrap()).unwrap();assert!(fact(&f).unwrap_err().contains("id_missing"));let mut map=BTreeMap::new();add(&mut map,"same".into(),"one.png",&None).unwrap();assert!(add(&mut map,"same".into(),"two.png",&None).unwrap_err().contains("ambiguous"));}
#[test]fn timeline_cut_fields_and_shared_media_follow_existing_registration_ids(){let draft=json!({"id":"cut-a","refVideoPath":"ref.mp4","audio":[{"name":"track","path":"registered.wav"}],"file":{"path":"excluded.wav"}});let mut map=BTreeMap::new();visit(&draft,"cut/cut-a",&None,&mut map,0).unwrap();assert_eq!(map["cut-a:refVideoPath"].kind,"video");assert_eq!(map["cut/cut-a/audio/0:audio"].kind,"audio");assert_eq!(map.len(),2);}
#[test]fn bgm_results_are_exact_project_track_and_index_not_folder_membership(){let f=fixture();let bgm=f.base.join("BGM");fs::create_dir(&bgm).unwrap();let settings=json!({"entries":{"bgmProjects":{"value":[{"id":"bgm-a","tracks":[{"id":"track-a","resultPaths":[bgm.join("registered.wav")]}]}]}}});let map=registered(&settings,&bgm,"BGM","bgm-a").unwrap();assert_eq!(map["track-a:result:0"].kind,"audio");assert!(registered(&settings,&bgm,"BGM","foreign").is_err());assert!(!map.contains_key("track-a:result:1"));}
#[test]fn native_facts_reach_common_v2_admission_and_reference_change_fails(){let f=fixture();let mut preset=crate::comfy_preset_test_fixture::fixture("image",1);crate::comfy_preset_test_fixture::migrate_v2(&mut preset);let v=fact(&f).unwrap();preset.request.bindings.iter_mut().find(|b|b.file_path.is_some()).unwrap().file_path=Some(v["path"].as_str().unwrap().into());preset.request.destination["baseDirectory"]=json!(f.base);preset.request.destination["projectName"]=json!("CPU");preset.request.provenance["assets"][0]["assetId"]=json!("asset-a");preset.request.provenance["assets"][0]["sha256"]=v["sha256"].clone();let facts=for_request(f.dir.path(),&preset.request,&preset.preset).unwrap();let receipt=policy::validate_preset(&preset.preset,&preset.request,&preset.bytes,&preset.owned,&facts).unwrap();assert_eq!(receipt["contractVersion"],2);image::GrayImage::from_raw(2,1,vec![255,0]).unwrap().save(&f.image).unwrap();let changed=for_request(f.dir.path(),&preset.request,&preset.preset).unwrap();assert!(policy::validate_preset(&preset.preset,&preset.request,&preset.bytes,&preset.owned,&changed).unwrap_err().contains("fact_mismatch"));}
#[test]fn upload_snapshot_has_exact_bytes_and_detects_changed_source_without_overwrite(){let f=fixture();let v=fact(&f).unwrap();let root=f.dir.path().join("owned-reference-snapshots");let one=pin(&root,&v).unwrap();let original=fs::read(&f.image).unwrap();assert_eq!(fs::read(&one).unwrap(),original);let two=pin(&root,&v).unwrap();assert_ne!(one,two);image::GrayImage::from_raw(2,1,vec![255,0]).unwrap().save(&f.image).unwrap();assert!(pin(&root,&v).unwrap_err().contains("changed_before_upload"));assert_eq!(fs::read(&one).unwrap(),original);assert_eq!(fs::read(&two).unwrap(),original);}
#[test]fn bogus_decode_flags_cannot_make_invalid_image_usable(){let f=fixture();fs::write(&f.image,b"not an image").unwrap();assert!(fact(&f).is_err());}
#[test]fn review_r4_native_scene_video_registration_uses_saved_id_and_scope(){let f=fixture();let file=f.root.join("project.json");let mut p=read_json(&file).unwrap();p["draft"]["scenes"]=json!([{"id":"scene-a","cuts":[],"videos":[{"id":"scene-video-1","filePath":f.root.join("result.mp4")}]}]);fs::write(file,serde_json::to_vec(&p).unwrap()).unwrap();let map=registered(&read_json(&f.dir.path().join("app-settings.json")).unwrap(),&f.root,"CPU","cpu-project").unwrap();assert!(map.contains_key("scene-video-1"));assert_eq!(map["scene-video-1"].kind,"video");assert!(registered(&json!({}),&f.root,"CPU","foreign").is_err());}

#[test]
fn f5_native_png_probe_reaches_v2_mask_admission_and_rejects_changed_convention_or_shape() {
    let files=fixture();
    let mask=files.root.join("mask.png");
    image::GrayImage::from_raw(2,1,vec![0,255]).unwrap().save(&mask).unwrap();
    let project=files.root.join("project.json");
    let mut saved=read_json(&project).unwrap();
    saved["draft"]["sharedAssets"]=json!([{"id":"asset-mask","filePath":mask}]);
    fs::write(project,serde_json::to_vec(&saved).unwrap()).unwrap();
    let mut f=crate::comfy_preset_test_fixture::mask_fixture();
    f.request.destination["baseDirectory"]=json!(files.base);
    f.request.destination["projectName"]=json!("CPU");
    for (index,id,path) in [(0,"asset-a",&files.image),(1,"asset-mask",&mask)] {
        let fact=issue(files.dir.path(),"cpu-project",id,files.base.to_str().unwrap(),"CPU",path.to_str().unwrap(),"image").unwrap();
        f.request.bindings[index+1].file_path=Some(fact["path"].as_str().unwrap().into());
        f.request.provenance["assets"][index]["assetId"]=json!(id);
        f.request.provenance["assets"][index]["sha256"]=fact["sha256"].clone();
    }
    crate::comfy_preset_test_fixture::migrate_v2(&mut f);
    let facts=for_request(files.dir.path(),&f.request,&f.preset).unwrap();
    assert_eq!(facts[1]["maskConvention"],"white-edit");
    assert_eq!(facts[1]["width"],2);
    assert_eq!(facts[1]["fullDecode"],true);
    assert_eq!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&facts).unwrap()["contractVersion"],2);

    // Native decoding decides the convention; updating the submitted SHA cannot hide it.
    image::RgbaImage::from_raw(2,1,vec![255,255,255,0,255,255,255,255]).unwrap().save(&mask).unwrap();
    let changed=for_request(files.dir.path(),&f.request,&f.preset).unwrap();
    assert_eq!(changed[1]["maskConvention"],"alpha-inverted");
    f.request.provenance["assets"][1]["sha256"]=changed[1]["sha256"].clone();
    assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&changed).unwrap_err().contains("mask_convention_mismatch"));

    image::GrayImage::from_raw(3,1,vec![0,128,255]).unwrap().save(&mask).unwrap();
    let changed=for_request(files.dir.path(),&f.request,&f.preset).unwrap();
    f.request.provenance["assets"][1]["sha256"]=changed[1]["sha256"].clone();
    assert!(policy::validate_preset(&f.preset,&f.request,&f.bytes,&f.owned,&changed).unwrap_err().contains("mask_shape_mismatch"));
}
