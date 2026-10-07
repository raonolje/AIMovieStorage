//! 종료 확인이 늦어져도 소유 핸들을 잃거나 기존 강제 정리 fallback을 부르지 않습니다.
use super::{Family, UpscaleState, Worker};
use crate::{LockSafe, Res};
use serde_json::{json, Value};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use std::io::Write;

#[derive(Default)]
pub(super) struct ShutdownState {
    active: Option<(String, Arc<AtomicBool>)>,
    last: Option<Value>,
}

pub(super) fn active(state: &UpscaleState) -> bool { state.shutdown.lock_safe().active.is_some() }
pub(super) fn cancel(state: &UpscaleState, operation_id: &str) -> bool {
    let shutdown = state.shutdown.lock_safe();
    if let Some((id, flag)) = &shutdown.active {
        if id == operation_id { flag.store(true, Ordering::SeqCst); return true; }
    }
    false
}

pub(super) fn status(state: &UpscaleState) -> Value {
    let shutdown = state.shutdown.lock_safe();
    let operation = shutdown.active.as_ref().map(|(id, flag)| json!({"operationId":id,"cancelRequested":flag.load(Ordering::SeqCst)}));
    let last = shutdown.last.clone(); drop(shutdown);
    let snapshot = state.workers.lock_safe().iter().map(|(id,w)|(id.clone(),w.clone())).collect::<Vec<_>>();
    let workers = snapshot.into_iter().map(|(engine,w)| {
        let queue=state.queue(&engine);let busy=queue.try_lock().is_err();
        json!({"engine":engine,"pid":w.pid,"source":"app-owned-child-handle","busy":busy,
            "installing":state.cancels.lock_safe().contains_key(&engine),
            "prefetching":state.prefetching.lock_safe().contains(&engine),
            "quitRequested":w.quit_requested.load(Ordering::SeqCst),"stdoutAlive":w.alive.load(Ordering::SeqCst)})
    }).collect::<Vec<_>>();
    json!({"operation":operation,"workers":workers,"lastShutdown":last,"forcedTermination":false})
}

struct Operation<'a> { state: &'a UpscaleState, id: String }
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        let mut shutdown=self.state.shutdown.lock_safe();
        if shutdown.active.as_ref().is_some_and(|(id,_)|id==&self.id) { shutdown.active=None; }
    }
}
fn same_owned_worker(state: &UpscaleState, engine: &str, worker: &Worker) -> bool {
    state.workers.lock_safe().get(engine).is_some_and(|w|Arc::ptr_eq(&w.child,&worker.child))
}
fn remove_exited(state: &UpscaleState, engine: &str, worker: &Worker) {
    let mut workers=state.workers.lock_safe();
    if workers.get(engine).is_some_and(|w|Arc::ptr_eq(&w.child,&worker.child)) { workers.remove(engine); }
    worker.alive.store(false,Ordering::SeqCst);
}

pub(super) fn release_idle(state: &UpscaleState, family: Option<&'static Family>, operation_id: &str, wait: Duration) -> Res<Value> {
    let cancel_flag=Arc::new(AtomicBool::new(false));
    {
        let mut shutdown=state.shutdown.lock_safe();
        if shutdown.active.is_some() { return Err("유휴 워커의 정상 종료 확인이 이미 진행 중입니다.".into()); }
        shutdown.active=Some((operation_id.to_owned(),cancel_flag.clone()));
    }
    let _operation=Operation{state,id:operation_id.to_owned()};
    let deadline=Instant::now()+wait;
    let mut snapshot=state.workers.lock_safe().iter()
        .filter(|(id,_)|family.map(|f|f.ids.contains(&id.as_str())).unwrap_or(true))
        .map(|(id,w)|(id.clone(),w.clone())).collect::<Vec<_>>();
    snapshot.sort_by(|a,b|a.0.cmp(&b.0));
    let queues=snapshot.iter().map(|(id,_)|state.queue(id)).collect::<Vec<_>>();
    let mut guards=Vec::new();let mut waiting=Vec::new();let mut outcomes=Vec::new();
    for ((engine,worker),queue) in snapshot.iter().zip(queues.iter()) {
        let scope=|state:&str|json!({"engine":engine,"pid":worker.pid,"state":state,"forcedTermination":false});
        if cancel_flag.load(Ordering::SeqCst) { outcomes.push(scope("cancelled-before-request"));continue; }
        if state.cancels.lock_safe().contains_key(engine)||state.prefetching.lock_safe().contains(engine) {
            outcomes.push(scope("install-or-prefetch-active"));continue;
        }
        let Ok(guard)=queue.try_lock() else { outcomes.push(scope("job-active"));continue; };
        guards.push(guard);
        if !worker.pending.lock_safe().is_empty() { outcomes.push(scope("request-active"));continue; }
        if !same_owned_worker(state,engine,worker) { outcomes.push(scope("ownership-changed"));continue; }
        let exited={worker.child.lock_safe().try_wait()};
        match exited {
            Ok(Some(code)) => { remove_exited(state,engine,worker);outcomes.push(json!({"engine":engine,"pid":worker.pid,"state":"already-exited","exitCode":code.code(),"forcedTermination":false}));continue; }
            Err(error) => { outcomes.push(json!({"engine":engine,"pid":worker.pid,"state":"exit-check-failed","message":error.to_string(),"forcedTermination":false}));continue; }
            Ok(None) => {}
        }
        // 기존 quit는 reader의 abort를 부를 수 있어, 유휴 전용 요청과 EOF만 보냅니다.
        let mut write_error=None;
        if !worker.quit_requested.swap(true,Ordering::SeqCst) {
            let input=worker.stdin.lock_safe().take();
            if let Some(mut input)=input {
                if let Err(error)=input.write_all(b"{\"id\":\"maintenance-quit\",\"op\":\"quit_idle\"}\n").and_then(|_|input.flush()) { write_error=Some(error.to_string()); }
                drop(input);
            }
        }
        waiting.push((engine.clone(),worker.clone(),write_error));
    }
    while !waiting.is_empty() {
        let mut next=Vec::new();
        for (engine,worker,write_error) in waiting {
            let exited={worker.child.lock_safe().try_wait()};
            match exited {
                Ok(Some(code)) => { remove_exited(state,&engine,&worker);outcomes.push(json!({"engine":engine,"pid":worker.pid,"state":"exited","exitCode":code.code(),"exitSuccess":code.success(),"writeError":write_error,"forcedTermination":false})); }
                Err(error) => outcomes.push(json!({"engine":engine,"pid":worker.pid,"state":"exit-check-failed","message":error.to_string(),"forcedTermination":false})),
                Ok(None) => {
                    if cancel_flag.load(Ordering::SeqCst)||Instant::now()>=deadline {
                        outcomes.push(json!({"engine":engine,"pid":worker.pid,"state":if cancel_flag.load(Ordering::SeqCst){"cancelled-wait"}else{"timed-out"},"writeError":write_error,"handleRetained":true,"forcedTermination":false}));
                    } else { next.push((engine,worker,write_error)); }
                }
            }
        }
        waiting=next;
        if !waiting.is_empty() { std::thread::sleep(Duration::from_millis(20)); }
    }
    let blocked=outcomes.iter().any(|v|!matches!(v["state"].as_str(),Some("exited"|"already-exited"))||v["exitSuccess"]==false);
    let report=json!({"operationId":operation_id,"workers":outcomes,"blocked":blocked,"cancelRequested":cancel_flag.load(Ordering::SeqCst),"remainingWorkerCount":state.workers.lock_safe().len(),"forcedTermination":false,"handlesPreservedOnTimeout":true});
    state.shutdown.lock_safe().last=Some(report.clone());
    Ok(report)
}

pub(super) fn require_complete(report: &Value) -> Res<()> {
    if report["blocked"]==false { return Ok(()); }
    let pending=report["workers"].as_array().map(|items|items.iter().filter(|v|!matches!(v["state"].as_str(),Some("exited"|"already-exited")))
        .map(|v|format!("{} ({})",v["engine"].as_str().unwrap_or("워커"),v["state"].as_str().unwrap_or("확인 불가"))).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    Err(format!("유휴 워커의 정상 종료를 확인하지 못해 앱을 유지합니다. 강제 종료하지 않았습니다. {pending}"))
}

#[cfg(test)]
#[path="upscale_graceful_tests.rs"]
mod tests;
