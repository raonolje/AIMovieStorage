//! Approved native model components. Uses the existing model download service, not LoRA installation.
use crate::{Res, download, upscale};
use std::{collections::HashMap, sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}}};
use tauri::{AppHandle,Emitter};
use serde::Serialize;
const REPO: &str = "Lightricks/LTX-2.5";
fn descriptor(component: &str) -> Res<(&'static str,u64)> {
    match component {
        "transformer" => Ok(("diffusion_models/ltx-2.5-22b-dev-transformer-bf16.safetensors",42_018_190_584)),
        "text_encoder" => Ok(("text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",26_263_858_182)),
        "video_vae" => Ok(("vae/ltx-2.5-video-vae-conv-bf16.safetensors",1_452_269_922)),
        "audio_vae" => Ok(("vae/ltx-2.5-audio-vae-bf16.safetensors",364_866_540)),
        "spatial_upsampler" => Ok(("latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",995_778_752)),
        _ => Err("Unsupported native model component".into()),
    }
}
fn validate(engine:&str, repo:&str, component:&str, id:&str) -> Res<(&'static str,u64)> {
    if engine!="ltx25" || repo!=REPO || id.trim().is_empty() || id.len()>300 { return Err("Invalid approved model download request".into()); }
    descriptor(component)
}
fn transfers()-> &'static Mutex<HashMap<String,Arc<AtomicBool>>> {
    static MAP:OnceLock<Mutex<HashMap<String,Arc<AtomicBool>>>>=OnceLock::new();MAP.get_or_init(||Mutex::new(HashMap::new()))
}
struct Guard(String);impl Drop for Guard {fn drop(&mut self){if let Ok(mut map)=transfers().lock(){map.remove(&self.0);}}}
#[derive(Serialize)]#[serde(rename_all="camelCase")]
pub struct ResultFile { engine:String, component:String, file:String, path:String, size_bytes:u64, sha256:String, reused:bool, expected_sha256_verified:bool, native_contract_verified:bool }
#[tauri::command]
pub fn model_component_download_cancel(transfer_id:String)->Res<bool>{
    let map=transfers().lock().map_err(|_|"Model download state unavailable".to_string())?;
    if let Some(flag)=map.get(&transfer_id){flag.store(true,Ordering::Relaxed);return Ok(true);}Ok(false)
}
#[tauri::command]
pub async fn model_component_download(app:AppHandle,engine:String,repo:String,component:String,transfer_id:String)->Res<ResultFile>{
    let (file,size)=validate(&engine,&repo,&component,&transfer_id)?;
    let stop=Arc::new(AtomicBool::new(false));
    {let mut map=transfers().lock().map_err(|_|"Model download state unavailable".to_string())?;
        if map.contains_key(&transfer_id){return Err("This transfer is already running".into());}map.insert(transfer_id.clone(),stop.clone());}
    let _guard=Guard(transfer_id.clone());
    let root=upscale::engine_dir(&app,&engine)?.join("models").join("native");
    let dest=root.join(file);
    // Refuse symlink/reparse ancestors rather than following an altered model directory.
    let mut current=Some(dest.as_path());while let Some(p)=current {if let Ok(meta)=std::fs::symlink_metadata(p){
        #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if meta.file_attributes() & 0x400 != 0 {return Err("Model path contains a reparse point".into());}}
        if meta.file_type().is_symlink(){return Err("Model path contains a symlink".into());}
    }current=p.parent();}
    std::fs::create_dir_all(dest.parent().ok_or("Invalid model destination")?).map_err(|_|"Could not create native model directory".to_string())?;
    let _lock=download::lock_model_file(&dest)?;let reused=dest.is_file();
    let url=format!("https://huggingface.co/{REPO}/resolve/main/{file}");
    let sha=download::official_descriptor(&url,size,&||stop.load(Ordering::Relaxed)).await?;
    let cancel=Some(stop.clone());
    let result=upscale::download_model_file(&app,&engine,"native-model",file,&url,&dest,Some(&sha),Some(size),&cancel,Some((&transfer_id,&component))).await;
    let _=app.emit("model-download-progress",serde_json::json!({"transferId":transfer_id,"component":component,"percent":if result.is_ok(){Some(100.0)}else{None},"done":true,"error":result.as_ref().err()}));
    result?;
    Ok(ResultFile{engine,component,file:file.into(),path:dest.to_string_lossy().into(),size_bytes:size,sha256:sha,reused,expected_sha256_verified:true,native_contract_verified:false})
}
#[cfg(test)]mod tests{use super::*;
    #[test]fn fixed_model_roles_no_lora_or_arbitrary_paths(){
        for role in ["transformer","text_encoder","video_vae","audio_vae","spatial_upsampler"]{let(file,size)=validate("ltx25",REPO,role,"job").unwrap();assert!(!file.starts_with("loras/"));assert!(size>0);}
        for role in ["lora","../secret","transformer?token=x",""]{assert!(validate("ltx25",REPO,role,"job").is_err());}
        assert!(validate("wanvideo",REPO,"transformer","job").is_err());assert!(validate("ltx25","other/repo","transformer","job").is_err());
    }
    #[test]fn cancellation_is_separate_from_engine_generation(){let id=uuid::Uuid::new_v4().to_string();let flag=Arc::new(AtomicBool::new(false));transfers().lock().unwrap().insert(id.clone(),flag.clone());let guard=Guard(id.clone());assert!(!model_component_download_cancel("unknown".into()).unwrap());assert!(model_component_download_cancel(id.clone()).unwrap());assert!(flag.load(Ordering::Relaxed));drop(guard);assert!(!model_component_download_cancel(id).unwrap());}
}

// Read only the public safetensors header. A server ignoring Range is rejected before its body is read.
async fn header_range(client:&reqwest::Client,url:&str,start:u64,end:u64,size:u64)->Res<Vec<u8>> {
    let mut request=client.get(url).header(reqwest::header::RANGE,format!("bytes={start}-{end}"));
    if let Ok(token)=crate::llm::read_api_key("huggingface"){request=request.bearer_auth(token);}
    let mut response=request.send().await.map_err(|_|"Native header request failed".to_string())?;
    if response.status().as_u16()!=206{return Err(format!("HTTP {}: bounded native header request requires 206",response.status().as_u16()));}
    let expected=format!("bytes {start}-{end}/{size}");
    if response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v|v.to_str().ok())!=Some(expected.as_str()){return Err("Native header range differs from request".into());}
    let length=(end-start+1) as usize;let mut data=Vec::with_capacity(length);
    while let Some(chunk)=response.chunk().await.map_err(|_|"Native header stream failed".to_string())?{
        if chunk.len()>length-data.len(){return Err("Native header exceeded bounded request".into());}data.extend_from_slice(&chunk);
    }
    if data.len()!=length{return Err("Native header was truncated".into());}Ok(data)
}
#[tauri::command]
pub async fn model_component_inspect(engine:String,repo:String,component:String)->Res<serde_json::Value>{
    let(file,size)=validate(&engine,&repo,&component,"inspect")?;
    let url=format!("https://huggingface.co/{REPO}/resolve/main/{file}");
    let sha=download::official_descriptor(&url,size,&||false).await?;
    let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::limited(5)).connect_timeout(std::time::Duration::from_secs(20)).timeout(std::time::Duration::from_secs(60)).build().map_err(|_|"Native header client failed".to_string())?;
    let prefix=header_range(&client,&url,0,7,size).await?;
    let len=u64::from_le_bytes(prefix.try_into().map_err(|_|"Invalid native header prefix")?);
    if len==0 || len>20*1024*1024 || 8+len>size{return Err("Native header length is outside the bounded contract".into());}
    let bytes=header_range(&client,&url,8,7+len,size).await?;
    let mut header:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|"Native header is not JSON".to_string())?;
    let object=header.as_object_mut().ok_or("Native header is not an object")?;
    let raw=object.remove("__metadata__").unwrap_or(serde_json::json!({}));let mut metadata=serde_json::Map::new();
    for key in ["config","model_version","gemma_source_checkpoint"]{if let Some(value)=raw.get(key){let parsed=value.as_str().and_then(|text|serde_json::from_str::<serde_json::Value>(text).ok()).unwrap_or(value.clone());metadata.insert(key.into(),parsed);}}
    Ok(serde_json::json!({"engine":engine,"component":component,"file":file,"sizeBytes":size,"sha256":sha,"metadata":metadata,"tensors":header,"weightsDownloaded":false,"nativeContractVerified":false}))
}

#[cfg(test)]mod header_http_tests {
    use super::*;use std::io::{Read,Write};
    fn server(response:Vec<u8>)->(String,std::thread::JoinHandle<()>) {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        let handle=std::thread::spawn(move||{let(mut socket,_)=listener.accept().unwrap();let mut request=[0;2048];socket.read(&mut request).unwrap();socket.write_all(&response).unwrap();});(format!("http://{address}/model"),handle)
    }
    #[tokio::test]async fn rejected_head_stops_before_weight_body(){for status in [401,403]{let(url,handle)=server(format!("HTTP/1.1 {status} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes());let error=download::official_descriptor(&url,100,&||false).await.unwrap_err();assert!(error.starts_with(&format!("HTTP {status}:")));handle.join().unwrap();}}
    #[tokio::test]async fn approved_head_requires_exact_size_and_hash(){let(url,handle)=server(format!("HTTP/1.1 302 Found\r\nx-linked-size: 100\r\nx-linked-etag: \"{}\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n","a".repeat(64)).into_bytes());assert_eq!(download::official_descriptor(&url,100,&||false).await.unwrap(),"a".repeat(64));handle.join().unwrap();let(url,handle)=server(b"HTTP/1.1 302 Found\r\nx-linked-size: 99\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec());assert!(download::official_descriptor(&url,100,&||false).await.is_err());handle.join().unwrap();}
    #[tokio::test]async fn ignored_range_never_accepts_full_weight_body(){let(url,handle)=server(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec());assert!(header_range(&reqwest::Client::new(),&url,0,7,100).await.unwrap_err().contains("requires 206"));handle.join().unwrap();}
    #[tokio::test]async fn bounded_range_is_exact(){let(url,handle)=server(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 8\r\nContent-Range: bytes 0-7/100\r\nConnection: close\r\n\r\n12345678".to_vec());assert_eq!(header_range(&reqwest::Client::new(),&url,0,7,100).await.unwrap(),b"12345678");handle.join().unwrap();}
    #[tokio::test]async fn wrong_range_and_oversized_body_are_rejected(){for response in [b"HTTP/1.1 206 Partial Content\r\nContent-Length: 8\r\nContent-Range: bytes 1-8/100\r\nConnection: close\r\n\r\n12345678".to_vec(),b"HTTP/1.1 206 Partial Content\r\nContent-Length: 9\r\nContent-Range: bytes 0-7/100\r\nConnection: close\r\n\r\n123456789".to_vec()]{let(url,handle)=server(response);assert!(header_range(&reqwest::Client::new(),&url,0,7,100).await.is_err());handle.join().unwrap();}}
}
