//! 앱의 **판** — 비공개(private) / 공개(public).
//!
//!
//!
//! # 왜 Rust 에서도 막나
//!
//! 공개판은 화면에서 제외 엔진을 숨기고(`client/src/lib/edition.ts`) 번들에서 워커 스크립트를
//! 뺍니다(`scripts/tauri.mjs`). 그래도 여기서 한 번 더 막는 까닭은 **옛 프런트·저장된 프로젝트**
//! 때문입니다 — 프로젝트 파일에 `anima` 가 생성기로 적혀 있거나 모션 캡처 결과에 `gvhmr` 가
//! 남아 있으면 화면을 거치지 않고 `local_run("gvhmr")` 이 들어올 수 있습니다. 리소스가 없어
//! 어차피 실패하지만, 그때의 오류는 「manifest 를 읽지 못했습니다」 라는 엉뚱한 말이 됩니다.
//! 여기서는 「이 판에는 포함되지 않은 엔진입니다」 라고 바로 답합니다.
//!
//! # 판은 컴파일 때 정해집니다
//!
//! `FRAMEFORGE_EDITION` 환경 변수를 `option_env!` 로 **컴파일 때** 읽습니다. 실행 중에 바꿀 수
//! 있는 값이면 공개판 실행 파일을 비공개판으로 «켜는» 길이 생깁니다. `build.rs` 가 이 변수의
//! 변화를 cargo 에 알려서(`rerun-if-env-changed`) 판을 바꿔 빌드하면 반드시 다시 컴파일됩니다.
//!
//! 제외 목록은 저장소 뿌리의 **`edition.json` 한 곳**입니다. `include_str!` 로 실행 파일에
//! 굽고 여기서는 읽기만 합니다 — id 를 여기 다시 적으면 두 벌이 됩니다.

use std::sync::OnceLock;

use serde::Deserialize;

/// 저장소 뿌리의 `edition.json`. 파일이 없으면 컴파일이 안 됩니다 — 그게 맞습니다.
const EDITION_JSON: &str = include_str!("../../edition.json");

/// 이 빌드의 판 이름. 빌드 스크립트가 안 심었으면(개발·사용자의 빌드) 비공개판.
pub const EDITION: &str = match option_env!("FRAMEFORGE_EDITION") {
    Some(value) => value,
    None => "private",
};

#[derive(Deserialize)]
struct Rules {
    public: PublicRules,
}

#[derive(Deserialize)]
struct PublicRules {
    #[serde(rename = "excludeEngines")]
    exclude_engines: Vec<String>,
}

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| {
        // 실행 파일에 구운 것이라 형식이 틀렸으면 개발자가 고칠 일이지 사용자가 볼 오류가 아닙니다.
        serde_json::from_str(EDITION_JSON).expect("edition.json 형식이 잘못됐습니다")
    })
}

pub fn is_public() -> bool {
    EDITION == "public"
}

/// 이 판에서 빠지는 엔진 id. 비공개판은 빈 목록.
pub fn excluded_engines() -> &'static [String] {
    if is_public() {
        &rules().public.exclude_engines
    } else {
        &[]
    }
}

/// 이 판에 그 엔진이 들어 있는가. `upscale::known_engine` 이 여기를 거칩니다 —
/// 설치·실행·제거·상태 조회와 로라 폴더(`lora::lora_dir`)가 전부 그 한 문을 지나므로 다른 곳에서
/// 또 물을 필요가 없습니다.
pub fn includes_engine(id: &str) -> bool {
    !excluded_engines().iter().any(|excluded| excluded == id)
}

/// 시작 로그 한 줄 — 「어느 판이 떴나」 를 로그에서 바로 알 수 있게.
pub fn describe() -> String {
    if is_public() {
        format!("공개판 — 제외 엔진: {}", excluded_engines().join(", "))
    } else {
        "비공개판 — 엔진 전부".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edition_json_parses_and_lists_excluded_engines() {
        let parsed = rules();
        assert!(!parsed.public.exclude_engines.is_empty());
        // 목록의 id 는 전부 실제 엔진이어야 합니다 — 오타가 있으면 그 엔진은 공개판에 그대로 실립니다.
        for id in &parsed.public.exclude_engines {
            assert!(
                crate::upscale::UPSCALE.ids.contains(&id.as_str()) || crate::upscale::LOCAL.ids.contains(&id.as_str()),
                "edition.json 의 {id} 는 아는 엔진이 아닙니다"
            );
        }
    }

    /// 판은 컴파일 상수라 한 번의 시험이 두 판을 다 못 봅니다. `FRAMEFORGE_EDITION=public cargo test`
    /// 로 한 번 더 돌리면 아래 두 갈래가 각각 밟힙니다(`build.rs` 의 rerun-if-env-changed 가 재컴파일을 보장).
    #[test]
    fn edition_follows_compile_time_flag() {
        let public = option_env!("FRAMEFORGE_EDITION") == Some("public");
        assert_eq!(is_public(), public);
        if public {
            assert!(!excluded_engines().is_empty());
            for id in excluded_engines() {
                assert!(!includes_engine(id), "{id} 는 공개판에서 빠져야 합니다");
                // 문은 하나 — 설치·실행·로라 폴더가 전부 지나는 `known_engine` 이 여기서 거절해야 합니다.
                assert!(crate::upscale::known_engine(id).is_err(), "{id} 가 known_engine 을 통과했습니다");
            }
            assert!(includes_engine("seedvr2"));
            assert!(includes_engine("sam3dbody"));
        } else {
            assert!(excluded_engines().is_empty());
            assert!(includes_engine("gvhmr"));
            assert!(crate::upscale::known_engine("gvhmr").is_ok());
        }
    }
}
