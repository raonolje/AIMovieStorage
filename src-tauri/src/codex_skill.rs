//! Ship the same skill in both editions and register it when the desktop app starts.
//! The marker protects edits made by a Codex user after installation.
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const SKILL: &str = include_str!("../../skills/aimoviestorage-control/SKILL.md");
const MARKER: &str = ".aimoviestorage-managed-sha256";

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn install_into(codex_home: &Path) -> std::io::Result<bool> {
    let folder = codex_home.join("skills").join("aimoviestorage-control");
    let skill = folder.join("SKILL.md");
    let marker = folder.join(MARKER);
    if skill.exists() {
        // A skill we did not install, or one edited since installation, belongs to its user.
        let installed = fs::read(&skill)?;
        let managed_hash = fs::read_to_string(&marker).unwrap_or_default();
        if managed_hash.trim() != digest(&installed) {
            return Ok(false);
        }
        if installed == SKILL.as_bytes() {
            return Ok(true);
        }
    }
    fs::create_dir_all(&folder)?;
    fs::write(&skill, SKILL)?;
    fs::write(marker, digest(SKILL.as_bytes()))?;
    Ok(true)
}

pub(crate) fn install_for_current_user() -> std::io::Result<bool> {
    let home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex")))
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Codex home unavailable"))?;
    install_into(&home)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_and_updates_only_managed_skill() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("skills/aimoviestorage-control/SKILL.md");
        assert!(install_into(temp.path()).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), SKILL);
        assert!(install_into(temp.path()).unwrap());
        fs::write(&file, "user customization").unwrap();
        assert!(!install_into(temp.path()).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "user customization");
    }

    #[test]
    fn leaves_unmanaged_skill_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("skills/aimoviestorage-control/SKILL.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "existing skill").unwrap();
        assert!(!install_into(temp.path()).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "existing skill");
    }
}
