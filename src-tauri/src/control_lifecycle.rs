use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const HISTORY_LIMIT: usize = 32;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Discovery {
    pub port: u16,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub closed_sessions: Vec<String>,
}

pub(crate) fn session_id(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

impl Discovery {
    pub(crate) fn active(port: u16, token: String, previous: Option<&Self>) -> Self {
        let mut closed_sessions = previous.map(|old| old.closed_sessions.clone()).unwrap_or_default();
        closed_sessions.retain(|id| id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()));
        if closed_sessions.len() > HISTORY_LIMIT {
            closed_sessions.drain(..closed_sessions.len() - HISTORY_LIMIT);
        }
        Self { port, token, close_reason: None, closed_sessions }
    }
    pub(crate) fn close(&mut self, reason: &str) -> Result<(), String> {
        if !matches!(reason, "normal_shutdown" | "control_disabled") {
            return Err("지원하지 않는 정상 종료 이유입니다.".into());
        }
        let id = session_id(&self.token);
        if !self.closed_sessions.contains(&id) { self.closed_sessions.push(id); }
        if self.closed_sessions.len() > HISTORY_LIMIT {
            self.closed_sessions.drain(..self.closed_sessions.len() - HISTORY_LIMIT);
        }
        self.close_reason = Some(reason.into());
        Ok(())
    }
    pub(crate) fn currently_closed(&self) -> bool {
        matches!(self.close_reason.as_deref(), Some("normal_shutdown" | "control_disabled"))
            && self.closed_sessions.contains(&session_id(&self.token))
    }
}

#[derive(Default)]
pub(crate) struct ForwarderLifecycle {
    bound_session: Option<String>,
    in_flight: usize,
    stopping: bool,
}
impl ForwarderLifecycle {
    pub(crate) fn begin(&mut self) -> Result<(), String> {
        if self.stopping { return Err("이 MCP 전달기는 정상 종료 중입니다.".into()); }
        self.in_flight += 1;
        Ok(())
    }
    pub(crate) fn finish(&mut self) { self.in_flight = self.in_flight.saturating_sub(1); }
    pub(crate) fn bind(&mut self, id: String) { self.bound_session = Some(id); }
    pub(crate) fn request_stop_if_closed(&mut self, discovery: &Discovery) -> bool {
        if self.in_flight != 0 || self.stopping { return self.stopping; }
        let closed = self.bound_session.as_ref().is_some_and(|id| discovery.closed_sessions.contains(id));
        if closed { self.stopping = true; }
        closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn old_discovery_is_compatible_but_not_a_close_signal() {
        let old: Discovery = serde_json::from_str(r#"{"port":1234,"token":"old"}"#).unwrap();
        assert!(!old.currently_closed());
        let mut peer = ForwarderLifecycle::default(); peer.bind(session_id("old"));
        assert!(!peer.request_stop_if_closed(&old));
    }
    #[test] fn only_matching_session_closes_and_rejects_new_requests() {
        let mut closed = Discovery::active(1234,"ours".into(),None); closed.close("normal_shutdown").unwrap();
        let mut other = ForwarderLifecycle::default(); other.bind(session_id("other"));
        assert!(!other.request_stop_if_closed(&closed));
        let mut own = ForwarderLifecycle::default(); own.bind(session_id("ours"));
        assert!(own.request_stop_if_closed(&closed)); assert!(own.begin().is_err());
    }
    #[test] fn close_waits_for_own_request_completion() {
        let mut closed = Discovery::active(1234,"ours".into(),None); closed.close("normal_shutdown").unwrap();
        let mut peer = ForwarderLifecycle::default(); peer.bind(session_id("ours")); peer.begin().unwrap();
        assert!(!peer.request_stop_if_closed(&closed)); peer.finish(); assert!(peer.request_stop_if_closed(&closed));
    }
    #[test] fn completed_close_survives_immediate_new_gui_registration() {
        let mut old = Discovery::active(1234,"old".into(),None); old.close("normal_shutdown").unwrap();
        let next = Discovery::active(5678,"new".into(),Some(&old));
        assert!(!next.currently_closed());
        let mut old_peer = ForwarderLifecycle::default(); old_peer.bind(session_id("old")); assert!(old_peer.request_stop_if_closed(&next));
        let mut new_peer = ForwarderLifecycle::default(); new_peer.bind(session_id("new")); assert!(!new_peer.request_stop_if_closed(&next));
    }
    #[test] fn authenticated_rebind_does_not_follow_an_old_close() {
        let mut old = Discovery::active(1234,"old".into(),None); old.close("normal_shutdown").unwrap();
        let next = Discovery::active(5678,"new".into(),Some(&old));
        let mut peer = ForwarderLifecycle::default(); peer.bind(session_id("old")); peer.bind(session_id("new"));
        assert!(!peer.request_stop_if_closed(&next));
    }
    #[test] fn history_is_bounded_and_unknown_reasons_do_not_mark_closed() {
        let mut state=Discovery::active(1,"0".into(),None);
        for n in 0..40 { state.close("normal_shutdown").unwrap(); state=Discovery::active(1,(n+1).to_string(),Some(&state)); }
        assert_eq!(state.closed_sessions.len(),32); assert!(state.close("crash").is_err()); assert!(!state.currently_closed());
    }
}
