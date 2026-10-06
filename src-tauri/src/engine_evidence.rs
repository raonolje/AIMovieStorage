//! 설치 완료 기록과 현재 파일 증거를 섞으면 생성 중 다운로드 가능성을 잘못 판단합니다.
use std::path::{Component, Path};
use serde_json::{json, Value};

fn nonempty(path: &Path) -> bool {
    path.metadata().map(|m| m.is_file() && m.len() > 0).unwrap_or(false)
}
fn relative(value: &str) -> bool {
    !value.is_empty() && Path::new(value).components().all(|c| matches!(c, Component::Normal(_)))
}
pub(crate) fn inspect(root: &Path, engine: &str) -> Value {
    let site = root.join(".venv/Lib/site-packages");
    let versions: Vec<String> = std::fs::read_dir(&site).into_iter().flatten().flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with("diffusers-") || !name.ends_with(".dist-info") { return None; }
            let text = std::fs::read_to_string(e.path().join("METADATA")).ok()?;
            text.lines().find_map(|l| l.strip_prefix("Version: ").map(str::to_string))
        }).collect();
    let runtime = json!({"source":"installed-distribution-metadata", "diffusersVersions":versions,
        "importVerified":false, "gpuVerified":false});
    if engine != "ltx25" {
        return json!({"runtime":runtime,"files":{"status":"not-checked", "scope":"LTX 2.5 default Diffusers only"}});
    }
    let hub = root.join("models/hub/models--Lightricks--LTX-2.5-Diffusers");
    let revision = std::fs::read_to_string(hub.join("refs/main")).unwrap_or_default().trim().to_string();
    if revision.len() != 40 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
        return json!({"runtime":runtime,"files":{"status":"missing", "missing":["refs/main"],"loadVerified":false}});
    }
    let snapshot = hub.join("snapshots").join(&revision);
    let mut missing: Vec<String> = Vec::new();
    let model_index = std::fs::read_to_string(snapshot.join("model_index.json")).ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    if model_index.as_ref().and_then(|v| v.get("_class_name")).and_then(Value::as_str) != Some("LTX2Pipeline") {
        missing.push("model_index.json: unexpected or invalid pipeline".into());
    }
    for name in ["model_index.json", "scheduler/scheduler_config.json", "tokenizer/tokenizer_config.json", "tokenizer/tokenizer.json", "processor/processor_config.json"] {
        if !nonempty(&snapshot.join(name)) { missing.push(name.into()); }
    }
    for component in ["transformer", "connectors", "text_encoder", "vae", "audio_vae", "vocoder", "duration_head"] {
        let config = format!("{component}/config.json");
        if !nonempty(&snapshot.join(&config)) { missing.push(config); }
        let basename = if component == "text_encoder" { "model" } else { "diffusion_pytorch_model" };
        let index = format!("{component}/{basename}.safetensors.index.json");
        let index_path = snapshot.join(&index);
        if index_path.exists() {
            let parsed = std::fs::read_to_string(&index_path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok());
            match parsed.as_ref().and_then(|v| v.get("weight_map")).and_then(Value::as_object) {
                Some(map) if !map.is_empty() => {
                    let unique: std::collections::BTreeSet<Option<&str>> = map.values().map(Value::as_str).collect();
                    for value in unique {
                        match value {
                            Some(file) if relative(file) => {
                                let file = format!("{component}/{file}");
                                if !nonempty(&snapshot.join(&file)) { missing.push(file); }
                            },
                            _ => missing.push(format!("{index}: invalid shard path")),
                        }
                    }
                },
                _ => missing.push(format!("{index}: invalid weight_map")),
            }
        } else {
            let weight = format!("{component}/{basename}.safetensors");
            if !nonempty(&snapshot.join(&weight)) { missing.push(weight); }
        }
    }
    missing.sort(); missing.dedup();
    json!({"runtime":runtime,"files":{"status":if missing.is_empty(){"present"}else{"missing"},
        "scope":"LTX 2.5 default single-stage Diffusers; optional enhancer/decoder and two-stage/LoRA excluded",
        "repo":"Lightricks/LTX-2.5-Diffusers","revision":revision,"missing":missing,
        "basis":"nonempty config/tokenizer/weight files and index shard references", "hashVerified":false,
        "loadVerified":false,"networkSafetyVerified":false}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_traversal() { assert!(!relative("../outside")); assert!(!relative("C:/outside")); assert!(relative("weight.safetensors")); }
    #[test] fn absent_is_missing_not_prefetch() {
        let p=std::env::temp_dir().join(format!("aistorage-evidence-absent-{}",std::process::id()));
        let result=inspect(&p,"ltx25"); assert_eq!(result["files"]["status"],"missing");
        assert_eq!(result["runtime"]["importVerified"],false);
    }
    #[test] fn other_engine_is_not_assumed_ready() {
        assert_eq!(inspect(Path::new("."),"wanvideo")["files"]["status"],"not-checked");
    }
    fn fixture(root: &Path) -> std::path::PathBuf {
        let hub=root.join("models/hub/models--Lightricks--LTX-2.5-Diffusers");
        std::fs::create_dir_all(hub.join("refs")).unwrap();
        std::fs::write(hub.join("refs/main"),"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let snapshot=hub.join("snapshots/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        std::fs::create_dir_all(&snapshot).unwrap();
        std::fs::write(snapshot.join("model_index.json"),r#"{"_class_name":"LTX2Pipeline"}"#).unwrap();
        for (folder,file) in [("scheduler","scheduler_config.json"),("tokenizer","tokenizer_config.json"),("tokenizer","tokenizer.json"),("processor","processor_config.json")] {
            std::fs::create_dir_all(snapshot.join(folder)).unwrap();
            std::fs::write(snapshot.join(folder).join(file),"{}").unwrap();
        }
        for c in ["transformer","connectors","text_encoder","vae","audio_vae","vocoder","duration_head"] {
            std::fs::create_dir_all(snapshot.join(c)).unwrap();
            std::fs::write(snapshot.join(c).join("config.json"),"{}").unwrap();
            let base=if c=="text_encoder"{"model"}else{"diffusion_pytorch_model"};
            std::fs::write(snapshot.join(c).join(format!("{base}.safetensors")),b"fixture only").unwrap();
        }
        snapshot
    }
    #[test] fn present_is_not_load_or_hash_verification() {
        let dir=tempfile::tempdir().unwrap(); fixture(dir.path());
        let result=inspect(dir.path(),"ltx25");
        assert_eq!(result["files"]["status"],"present");
        assert_eq!(result["files"]["loadVerified"],false);
        assert_eq!(result["files"]["hashVerified"],false);
    }
    #[test] fn missing_shard_and_unsafe_index_fail_closed() {
        let dir=tempfile::tempdir().unwrap();let s=fixture(dir.path());
        let index=s.join("transformer/diffusion_pytorch_model.safetensors.index.json");
        std::fs::write(&index,r#"{"weight_map":{"x":"missing.safetensors"}}"#).unwrap();
        assert_eq!(inspect(dir.path(),"ltx25")["files"]["status"],"missing");
        std::fs::write(&index,r#"{"weight_map":{"x":"../outside"}}"#).unwrap();
        assert!(inspect(dir.path(),"ltx25")["files"]["missing"].to_string().contains("invalid shard path"));
    }
    #[test] fn installed_version_is_metadata_only() {
        let dir=tempfile::tempdir().unwrap(); let site=dir.path().join(".venv/Lib/site-packages/diffusers-0.40.0.dist-info");
        std::fs::create_dir_all(&site).unwrap();std::fs::write(site.join("METADATA"),"Name: diffusers\nVersion: 0.40.0\n").unwrap();
        let result=inspect(dir.path(),"ltx25");
        assert_eq!(result["runtime"]["diffusersVersions"][0],"0.40.0");
        assert_eq!(result["runtime"]["importVerified"],false);
    }
    #[test] fn explicit_readonly_metadata_probe() {
        if let Ok(root)=std::env::var("AISTORAGE_TEST_READONLY_ENGINE_ROOT") {
            let result=inspect(Path::new(&root),"ltx25");
            assert_eq!(result["files"]["loadVerified"],false);
            println!("READONLY_EVIDENCE {}",result);
        }
    }
}
