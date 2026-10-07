use super::*;
use std::{fs, io::{BufRead, BufReader}, process::{Command, Stdio}, sync::Mutex};

#[test]
fn owned_cpu_worker_fixture() {
    let Ok(mode)=std::env::var("AIMOVIE_CPU_GRACE_FIXTURE") else{return};
    let input=std::io::stdin();let mut reader=BufReader::new(input.lock());let mut line=String::new();
    reader.read_line(&mut line).unwrap();assert!(line.contains("quit_idle"));
    let mut rest=String::new();reader.read_line(&mut rest).unwrap();assert!(rest.is_empty(),"정상 종료는 소유 stdin EOF도 보냅니다");
    if mode=="slow" { std::thread::sleep(Duration::from_millis(3200)); }
    if mode=="blocked" {
        let signal=std::env::var("AIMOVIE_CPU_GRACE_SIGNAL").unwrap();let deadline=Instant::now()+Duration::from_secs(5);
        while !std::path::Path::new(&signal).exists()&&Instant::now()<deadline { std::thread::sleep(Duration::from_millis(10)); }
    }
}
fn fixture(mode:&str)->(UpscaleState,Worker,tempfile::TempDir) {
    let dir=tempfile::tempdir().unwrap();
    let mut child=Command::new(std::env::current_exe().unwrap())
        .args(["--exact","upscale::graceful::tests::owned_cpu_worker_fixture","--nocapture"])
        .env("AIMOVIE_CPU_GRACE_FIXTURE",mode).env("AIMOVIE_CPU_GRACE_SIGNAL",dir.path().join("finish"))
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
    let stdin=child.stdin.take().unwrap();let worker=Worker{pid:child.id(),child:Arc::new(Mutex::new(child)),stdin:Arc::new(Mutex::new(Some(stdin))),
        quit_requested:Arc::new(AtomicBool::new(false)),pending:Arc::new(Mutex::new(Default::default())),ready:Arc::new(Mutex::new(None)),alive:Arc::new(AtomicBool::new(true))};
    let state=UpscaleState::default();state.workers.lock_safe().insert("spandrel".into(),worker.clone());(state,worker,dir)
}
fn finish(state:&UpscaleState,worker:&Worker,dir:&tempfile::TempDir) {
    fs::write(dir.path().join("finish"),b"owned CPU fixture only").unwrap();
    let report=release_idle(state,None,"finish",Duration::from_secs(3)).unwrap();require_complete(&report).unwrap();
    assert!(worker.child.lock_safe().try_wait().unwrap().is_some());
}

#[test]fn idle_worker_exits_naturally_and_repeated_close_is_noop(){
    let (s,w,d)=fixture("idle");let r=release_idle(&s,None,"idle",Duration::from_secs(3)).unwrap();require_complete(&r).unwrap();
    assert_eq!(r["workers"][0]["state"],"exited");assert_eq!(r["forcedTermination"],false);assert!(s.workers.lock_safe().is_empty());
    let again=release_idle(&s,None,"again",Duration::from_millis(1)).unwrap();assert_eq!(again["workers"].as_array().unwrap().len(),0);finish(&s,&w,&d);
}
#[test]fn slow_worker_beyond_old_three_second_deadline_is_not_killed(){
    let (s,w,d)=fixture("slow");let r=release_idle(&s,None,"slow",Duration::from_secs(5)).unwrap();require_complete(&r).unwrap();
    assert_eq!(r["workers"][0]["exitCode"],0);assert_eq!(r["forcedTermination"],false);finish(&s,&w,&d);
}
#[test]fn timeout_preserves_child_handle_and_retries_wait_without_second_quit(){
    let (s,w,d)=fixture("blocked");let r=release_idle(&s,None,"timeout",Duration::from_millis(40)).unwrap();assert_eq!(r["blocked"],true);assert_eq!(r["workers"][0]["state"],"timed-out");
    assert!(Arc::ptr_eq(&s.workers.lock_safe()["spandrel"].child,&w.child));assert!(w.child.lock_safe().try_wait().unwrap().is_none());assert!(w.stdin.lock_safe().is_none());
    assert!(w.quit_requested.load(Ordering::SeqCst));let again=release_idle(&s,None,"timeout2",Duration::from_millis(20)).unwrap();assert_eq!(again["blocked"],true);finish(&s,&w,&d);
}
#[test]fn active_job_is_not_sent_quit_or_eof(){
    let (s,w,d)=fixture("idle");let queue=s.queue("spandrel");let guard=queue.lock_safe();let r=release_idle(&s,None,"busy",Duration::from_millis(1)).unwrap();
    assert_eq!(r["workers"][0]["state"],"job-active");assert!(w.stdin.lock_safe().is_some());assert!(!w.quit_requested.load(Ordering::SeqCst));drop(guard);finish(&s,&w,&d);
}
#[test]fn install_and_prefetch_are_not_interrupted(){
    for prefetch in [false,true]{let (s,w,d)=fixture("idle");if prefetch{s.prefetching.lock_safe().insert("spandrel".into());}else{s.cancels.lock_safe().insert("spandrel".into(),Arc::new(AtomicBool::new(false)));}
        let r=release_idle(&s,None,"install",Duration::from_millis(1)).unwrap();assert_eq!(r["workers"][0]["state"],"install-or-prefetch-active");assert!(w.stdin.lock_safe().is_some());assert!(!w.quit_requested.load(Ordering::SeqCst));s.cancels.lock_safe().clear();s.prefetching.lock_safe().clear();finish(&s,&w,&d);}
}
#[test]fn outstanding_request_is_not_interrupted(){
    let (s,w,d)=fixture("idle");let (sender,_)=std::sync::mpsc::channel();w.pending.lock_safe().insert("inflight".into(),sender);
    let r=release_idle(&s,None,"pending",Duration::from_millis(1)).unwrap();assert_eq!(r["workers"][0]["state"],"request-active");assert!(!w.quit_requested.load(Ordering::SeqCst));w.pending.lock_safe().clear();finish(&s,&w,&d);
}
#[test]fn cancelled_wait_retains_ownership_and_wrong_operation_does_not_cancel(){
    let (s,w,d)=fixture("blocked");std::thread::scope(|scope|{
        let wait=scope.spawn(||release_idle(&s,None,"cancel-me",Duration::from_secs(2)).unwrap());
        let deadline=Instant::now()+Duration::from_secs(1);while !w.quit_requested.load(Ordering::SeqCst)&&Instant::now()<deadline{std::thread::sleep(Duration::from_millis(5));}
        assert!(!cancel(&s,"other-operation"));assert!(cancel(&s,"cancel-me"));let r=wait.join().unwrap();assert_eq!(r["workers"][0]["state"],"cancelled-wait");assert_eq!(r["forcedTermination"],false);
    });assert!(s.workers.lock_safe().contains_key("spandrel"));finish(&s,&w,&d);
}
#[test]fn reentrant_shutdown_does_not_release_the_first_operation(){
    let (s,w,d)=fixture("blocked");std::thread::scope(|scope|{
        let wait=scope.spawn(||release_idle(&s,None,"first",Duration::from_secs(2)).unwrap());
        let deadline=Instant::now()+Duration::from_secs(1);while !active(&s)&&Instant::now()<deadline{std::thread::sleep(Duration::from_millis(5));}
        assert!(release_idle(&s,None,"second",Duration::from_millis(1)).is_err());assert!(active(&s));assert!(cancel(&s,"first"));wait.join().unwrap();
    });finish(&s,&w,&d);
}
#[test]fn already_exited_entry_is_removed_without_touching_another_worker(){
    let (s,w,d)=fixture("idle");let input=w.stdin.lock_safe().take();let mut input=input.unwrap();input.write_all(b"{\"op\":\"quit_idle\"}\n").unwrap();drop(input);
    w.child.lock_safe().wait().unwrap();let r=release_idle(&s,None,"exited",Duration::from_millis(1)).unwrap();assert_eq!(r["workers"][0]["state"],"already-exited");assert!(s.workers.lock_safe().is_empty());finish(&s,&w,&d);
}
#[test]fn family_cleanup_does_not_target_other_family(){
    let (s,w,d)=fixture("idle");let r=release_idle(&s,Some(&super::super::LOCAL),"local-only",Duration::from_millis(1)).unwrap();assert_eq!(r["workers"].as_array().unwrap().len(),0);assert!(w.stdin.lock_safe().is_some());finish(&s,&w,&d);
}
