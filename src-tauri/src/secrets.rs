//! Write-only secret store.
//!
//! The webview can create, delete and *enumerate* secrets, but never read a
//! value back. Provider requests carry a `{{secret:NAME}}` placeholder in their
//! headers/URL/body, and this module substitutes the real value at the very
//! last moment — and only for requests to the origin the secret was bound to.
//!
//! That binding is the point: a script injected into rendered model output
//! cannot exfiltrate a key, because it has no way to read one, and pointing a
//! request at an attacker-controlled origin simply fails to resolve.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

const PLACEHOLDER_PREFIX: &str = "{{secret:";

#[derive(Clone, Serialize, Deserialize)]
pub struct SecretEntry {
    pub value: String,
    /// Origin this secret was created for, e.g. `https://api.anthropic.com`.
    pub origin: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct SecretFile {
    #[serde(default)]
    pub secrets: HashMap<String, SecretEntry>,
}

pub struct SecretsState {
    path: PathBuf,
    inner: Mutex<SecretFile>,
}

impl SecretsState {
    /// Loads the secret file, treating any read/parse failure as "no secrets".
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("secrets.json");
        let file = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<SecretFile>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(file),
        }
    }

    pub async fn set(&self, name: String, value: String, origin: String) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        guard.secrets.insert(name, SecretEntry { value, origin });
        persist(&self.path, &guard)
    }

    pub async fn delete(&self, name: &str) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        guard.secrets.remove(name);
        persist(&self.path, &guard)
    }

    /// Names only — never values. Used by the UI to show "key is set" state.
    pub async fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.inner.lock().await.secrets.keys().cloned().collect();
        names.sort();
        names
    }

    /// Replaces `{{secret:NAME}}` occurrences in `text` with the real value,
    /// but only for secrets bound to `origin`. Unresolvable placeholders are
    /// left verbatim so the upstream API returns a clear auth error instead of
    /// silently sending a wrong key.
    pub async fn resolve(&self, text: &str, origin: &str) -> String {
        if !text.contains(PLACEHOLDER_PREFIX) {
            return text.to_string();
        }

        let guard = self.inner.lock().await;
        let mut out = String::with_capacity(text.len());
        let mut rest = text;

        while let Some(start) = rest.find(PLACEHOLDER_PREFIX) {
            out.push_str(&rest[..start]);
            let after = &rest[start + PLACEHOLDER_PREFIX.len()..];

            // An unterminated `{{secret:` means the rest of the string is not a
            // placeholder. Emit it verbatim and stop — pushing `rest` here would
            // duplicate the prefix already written above.
            let Some(end) = after.find("}}") else {
                out.push_str(&rest[start..]);
                return out;
            };

            let name = &after[..end];
            match guard
                .secrets
                .get(name)
                .filter(|entry| entry.origin == origin)
            {
                Some(entry) => out.push_str(&entry.value),
                None => out.push_str(&rest[start..start + PLACEHOLDER_PREFIX.len() + end + 2]),
            }
            rest = &after[end + 2..];
        }

        out.push_str(rest);
        out
    }
}

fn persist(path: &Path, file: &SecretFile) -> Result<(), String> {
    // Ensure the directory exists before writing. The app creates its data
    // directory during setup, but persisting must not depend on that ordering —
    // a silently failed write here would look like "the key did not save".
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    restrict_permissions(path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(0o600);
        let _ = fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

#[tauri::command]
pub async fn secret_set(
    state: tauri::State<'_, SecretsState>,
    name: String,
    value: String,
    origin: String,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("secret name must not be empty".into());
    }
    if value.is_empty() {
        return Err("secret value must not be empty".into());
    }
    state.set(name, value, origin).await
}

#[tauri::command]
pub async fn secret_delete(
    state: tauri::State<'_, SecretsState>,
    name: String,
) -> Result<(), String> {
    state.delete(&name).await
}

#[tauri::command]
pub async fn secret_names(state: tauri::State<'_, SecretsState>) -> Result<Vec<String>, String> {
    Ok(state.names().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A unique temp directory per test, so parallel tests cannot share (and
    /// therefore clobber) the same secrets file.
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    async fn state_with(entries: &[(&str, &str, &str)]) -> SecretsState {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "hmmchat-test-{}-{}",
            std::process::id(),
            unique
        ));
        let state = SecretsState::load(&dir);
        for (name, value, origin) in entries {
            state
                .set(name.to_string(), value.to_string(), origin.to_string())
                .await
                .unwrap();
        }
        state
    }

    #[tokio::test]
    async fn substitutes_for_bound_origin() {
        let state = state_with(&[("anthropic", "sk-real", "https://api.anthropic.com")]).await;
        let out = state
            .resolve("Bearer {{secret:anthropic}}", "https://api.anthropic.com")
            .await;
        assert_eq!(out, "Bearer sk-real");
    }

    #[tokio::test]
    async fn refuses_other_origins() {
        let state = state_with(&[("anthropic", "sk-real", "https://api.anthropic.com")]).await;
        let out = state
            .resolve("Bearer {{secret:anthropic}}", "https://evil.example")
            .await;
        assert_eq!(out, "Bearer {{secret:anthropic}}");
    }

    #[tokio::test]
    async fn leaves_unknown_names_verbatim() {
        let state = state_with(&[]).await;
        let out = state.resolve("{{secret:nope}}", "https://any.example").await;
        assert_eq!(out, "{{secret:nope}}");
    }

    #[tokio::test]
    async fn replaces_every_occurrence() {
        let state = state_with(&[("k", "V", "https://a.test")]).await;
        let out = state.resolve("{{secret:k}}/{{secret:k}}", "https://a.test").await;
        assert_eq!(out, "V/V");
    }

    #[tokio::test]
    async fn leaves_a_truncated_placeholder_alone() {
        // A malformed placeholder must not eat the rest of the string.
        let state = state_with(&[("k", "V", "https://a.test")]).await;
        let out = state.resolve("prefix {{secret:k tail", "https://a.test").await;
        assert_eq!(out, "prefix {{secret:k tail");
    }

    #[tokio::test]
    async fn names_exposes_names_but_never_values() {
        let state = state_with(&[("b", "sekrit", "https://a.test")]).await;
        let names = state.names().await;
        assert_eq!(names, vec!["b".to_string()]);
        // The value must not be reachable through the enumeration path.
        assert!(!format!("{names:?}").contains("sekrit"));
    }

    #[tokio::test]
    async fn delete_removes_the_secret() {
        let state = state_with(&[("k", "V", "https://a.test")]).await;
        state.delete("k").await.unwrap();
        assert!(state.names().await.is_empty());
        assert_eq!(
            state.resolve("{{secret:k}}", "https://a.test").await,
            "{{secret:k}}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_file_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;

        let state = state_with(&[("k", "V", "https://a.test")]).await;
        let mode = fs::metadata(&state.path).unwrap().permissions().mode();
        // 0o600: owner read/write only.
        assert_eq!(mode & 0o777, 0o600, "secrets file mode was {mode:o}");
    }
}
