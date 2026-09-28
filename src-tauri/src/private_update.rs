//! Private update credentials stay in the user's app config, never in a build
//! artifact, project file, or Git repository. The public edition cannot read it.

use crate::{edition, llm, Res};

#[tauri::command]
pub fn private_update_token() -> Res<Option<String>> {
    if edition::is_public() {
        return Err("공개판에서는 비공개 업데이트 인증을 사용할 수 없습니다.".into());
    }
    match llm::read_api_key("gitlab-update") {
        Ok(token) => Ok(Some(token)),
        Err(_) => Ok(None),
    }
}
