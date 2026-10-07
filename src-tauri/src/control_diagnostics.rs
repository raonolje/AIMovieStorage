//! 연결 실패를 저장된 켜짐 선택으로 오인하지 않도록 확인된 단계만 안내합니다.
use crate::control_lifecycle::Discovery;
use std::io::ErrorKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ControlDiagnostic {
    DiscoveryUnavailable,
    DiscoveryUnreadable,
    DiscoveryInvalid,
    Disabled,
    SessionClosed,
    ConnectionRefused,
    ConnectionTimeout,
    ConnectionFailed,
    StartupNotReady,
    RequestTimeout,
    RequestWriteFailed,
    ResponseTimeout,
    ResponseReadFailed,
    ResponseIncomplete,
    ResponseInvalid,
}

impl ControlDiagnostic {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::DiscoveryUnavailable => "discovery_unavailable",
            Self::DiscoveryUnreadable => "discovery_unreadable",
            Self::DiscoveryInvalid => "discovery_invalid",
            Self::Disabled => "control_disabled",
            Self::SessionClosed => "session_closed",
            Self::ConnectionRefused => "connection_refused",
            Self::ConnectionTimeout => "connection_timeout",
            Self::ConnectionFailed => "connection_failed",
            Self::StartupNotReady => "startup_not_ready",
            Self::RequestTimeout => "request_timeout",
            Self::RequestWriteFailed => "request_write_failed",
            Self::ResponseTimeout => "response_timeout",
            Self::ResponseReadFailed => "response_read_failed",
            Self::ResponseIncomplete => "response_incomplete",
            Self::ResponseInvalid => "response_invalid",
        }
    }

    pub(crate) fn message(self) -> String {
        let detail = match self {
            Self::DiscoveryUnavailable => "앱 조종 endpoint 등록을 찾지 못했습니다. 앱 실행과 초기화 완료를 확인하세요. 설정의 켜짐 여부는 확인되지 않았습니다.",
            Self::DiscoveryUnreadable => "앱 조종 endpoint 등록을 읽지 못했습니다. 파일 접근 상태를 확인하세요. 설정의 켜짐 여부는 확인되지 않았습니다.",
            Self::DiscoveryInvalid => "앱 조종 endpoint 등록 형식이 올바르지 않습니다. 설정의 켜짐 여부는 확인되지 않았습니다.",
            Self::Disabled => "마지막으로 등록된 GUI 세션에서 외부 조종기를 끈 기록이 확인됐습니다. 해당 앱에서 연결을 다시 사용하려면 설정의 앱 조종 켜기를 선택하세요.",
            Self::SessionClosed => "마지막으로 등록된 GUI 세션이 정상 종료됐습니다. 앱을 실행한 뒤 MCP를 다시 연결하세요.",
            Self::ConnectionRefused => "저장된 앱 조종 endpoint가 TCP 연결을 거부했습니다. 앱 실행·초기화와 endpoint 갱신 상태를 확인하세요. 이 오류만으로 설정이 꺼졌다고 판단할 수 없습니다.",
            Self::ConnectionTimeout => "앱 조종 endpoint의 TCP 연결 시간이 초과됐습니다. 설정의 켜짐 여부는 확인되지 않았습니다.",
            Self::ConnectionFailed => "앱 조종 endpoint의 TCP 연결에 실패했습니다. 설정의 켜짐 여부는 확인되지 않았습니다.",
            Self::StartupNotReady => "연결된 앱의 조종 요청 처리기가 아직 초기화 중입니다. 준비가 끝난 뒤 다시 연결하세요.",
            Self::RequestTimeout => "연결된 앱이 조종 요청을 받는 시간이 초과됐습니다.",
            Self::RequestWriteFailed => "연결된 앱에 조종 요청을 전송하지 못했습니다. 앱 실행 상태를 확인하세요.",
            Self::ResponseTimeout => "앱 조종 요청의 응답 시간이 초과됐습니다. 편집이 적용됐을 수 있으므로 작업 상태를 조회한 뒤 재시도하세요.",
            Self::ResponseReadFailed => "앱 조종 응답을 읽지 못했습니다. 편집이 적용됐을 수 있으므로 작업 상태를 확인하세요.",
            Self::ResponseIncomplete => "앱 조종 연결이 완전한 응답 전에 끝났습니다. 편집이 적용됐을 수 있으므로 작업 상태를 확인하세요.",
            Self::ResponseInvalid => "앱 조종 응답 형식이 올바르지 않습니다. 편집이 적용됐을 수 있으므로 작업 상태를 확인하세요.",
        };
        // 원본 IO·JSON 오류에는 경로나 자료가 들어갈 수 있어 고정 진단만 전달합니다.
        format!("[{}] {detail}", self.code())
    }
}

pub(crate) fn discovery_read_failure(kind: ErrorKind) -> ControlDiagnostic {
    if kind == ErrorKind::NotFound { ControlDiagnostic::DiscoveryUnavailable }
    else { ControlDiagnostic::DiscoveryUnreadable }
}

pub(crate) fn connection_failure(kind: ErrorKind) -> ControlDiagnostic {
    match kind {
        ErrorKind::ConnectionRefused => ControlDiagnostic::ConnectionRefused,
        ErrorKind::TimedOut => ControlDiagnostic::ConnectionTimeout,
        _ => ControlDiagnostic::ConnectionFailed,
    }
}

pub(crate) fn closed_diagnostic(discovery: &Discovery) -> Option<ControlDiagnostic> {
    // 이유만 남은 불완전한 기록으로 설정 변경을 유도하지 않도록 세션 종료 증거도 확인합니다.
    if !discovery.currently_closed() { return None; }
    Some(if discovery.close_reason.as_deref() == Some("control_disabled") {
        ControlDiagnostic::Disabled
    } else { ControlDiagnostic::SessionClosed })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_confirmed_disabled_session_suggests_enabling() {
        for issue in [ControlDiagnostic::DiscoveryUnavailable, ControlDiagnostic::DiscoveryUnreadable,
            ControlDiagnostic::DiscoveryInvalid, ControlDiagnostic::SessionClosed,
            ControlDiagnostic::ConnectionRefused, ControlDiagnostic::ConnectionTimeout,
            ControlDiagnostic::ConnectionFailed, ControlDiagnostic::StartupNotReady,
            ControlDiagnostic::RequestTimeout, ControlDiagnostic::RequestWriteFailed,
            ControlDiagnostic::ResponseTimeout, ControlDiagnostic::ResponseReadFailed,
            ControlDiagnostic::ResponseIncomplete, ControlDiagnostic::ResponseInvalid] {
            assert!(!issue.message().contains("앱 조종 켜기"));
            assert!(!issue.message().contains("다시 켜세요"));
        }
        assert!(ControlDiagnostic::Disabled.message().contains("앱 조종 켜기"));
    }
    #[test]
    fn refused_timeout_and_unknown_io_are_distinct() {
        assert_eq!(connection_failure(ErrorKind::ConnectionRefused).code(), "connection_refused");
        assert_eq!(connection_failure(ErrorKind::TimedOut).code(), "connection_timeout");
        assert_eq!(connection_failure(ErrorKind::PermissionDenied).code(), "connection_failed");
        assert_eq!(discovery_read_failure(ErrorKind::NotFound).code(), "discovery_unavailable");
        assert_eq!(discovery_read_failure(ErrorKind::PermissionDenied).code(), "discovery_unreadable");
    }
    #[test]
    fn missing_or_unverified_close_reason_is_not_disabled() {
        let mut entry = Discovery::active(1, "private-fixture".into(), None);
        assert_eq!(closed_diagnostic(&entry), None);
        entry.close_reason = Some("control_disabled".into());
        assert_eq!(closed_diagnostic(&entry), None);
        entry.close_reason = None;
        entry.close("control_disabled").unwrap();
        assert_eq!(closed_diagnostic(&entry), Some(ControlDiagnostic::Disabled));
        assert!(!ControlDiagnostic::Disabled.message().contains(&entry.token));
    }
    #[test]
    fn normal_close_and_old_disabled_history_do_not_mark_new_session_disabled() {
        let mut old = Discovery::active(1, "old".into(), None);
        old.close("control_disabled").unwrap();
        let mut next = Discovery::active(2, "new".into(), Some(&old));
        assert_eq!(closed_diagnostic(&next), None);
        next.close("normal_shutdown").unwrap();
        assert_eq!(closed_diagnostic(&next), Some(ControlDiagnostic::SessionClosed));
    }
}
