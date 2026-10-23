use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::commands::config::{load_config, update_config, AppConfig, SyncTarget};
use crate::db::manager::DbManager;

// Desktop and browser sessions share a database and staging path.
mod safety;
pub use safety::{SyncPreview, SyncBackup};
pub(crate) use safety::{backup_broker_database, BrokerWrites};

static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A sync makes several sequential requests against the same WebDAV target
/// (check the lock, acquire it, GET or PUT the database, release the lock) —
/// with no timeout, one stalled connection anywhere in that chain hangs the
/// whole sync for however long the OS's own TCP timeout happens to be, often
/// several minutes, and is indistinguishable from "just a big transfer" while
/// it's happening. 30 seconds is generous for a database that is realistically
/// a few hundred KB to a few MB.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest client")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub synced_at: i64,
    /// True when the remote was newer and the local DB file was replaced.
    /// The caller must reopen the DB connection.
    pub downloaded: bool,
    pub confirmation: Option<SyncPreview>,
}

// ── WebDAV helpers ─────────────────────────────────────────────────────────

async fn webdav_get(url: &str, username: &str, password: &str) -> Result<Vec<u8>, String> {
    let client = http_client();
    let resp = client
        .get(url)
        .basic_auth(username, Some(password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("WebDAV GET {} returned {}", url, resp.status()));
    }
    resp.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

async fn webdav_metadata(url: &str, username: &str, password: &str) -> Result<(bool, Option<i64>), String> {
    let response = http_client().head(url).basic_auth(username, Some(password))
        .send().await.map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok((false, None)); }
    if !response.status().is_success() {
        return Err(format!("WebDAV HEAD returned HTTP {}", response.status().as_u16()));
    }
    let modified = response.headers().get("last-modified").and_then(|h| h.to_str().ok())
        .and_then(|date| chrono::DateTime::parse_from_rfc2822(date).ok()).map(|date| date.timestamp());
    Ok((true, modified))
}

// ── Lock file management ───────────────────────────────────────────────────

/// Ensure the WebDAV URL points to a file (stockfolio.db), not a directory.
/// If the URL has no extension and doesn't already end with ".db", append
/// "/stockfolio.db" (stripping any trailing slash first).
fn normalize_webdav_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    // Check whether the last path segment looks like a filename (has a dot)
    let last_segment = trimmed.rsplit('/').next().unwrap_or("");
    if last_segment.contains('.') {
        trimmed.to_string()
    } else {
        format!("{}/stockfolio.db", trimmed)
    }
}

fn normalize_local_path(path: &str) -> PathBuf {
    let path = PathBuf::from(path.trim());
    if path.is_file() || matches!(path.extension().and_then(|ext| ext.to_str()), Some("db" | "sqlite" | "sqlite3")) {
        path
    } else {
        path.join("stockfolio.db")
    }
}

// ── Safe local DB replacement ──────────────────────────────────────────────
//
// A downloaded database must never be written straight into the live file:
// the app's `DbManager` connection is still open against it, so an in-place
// truncate+write (or even `fs::copy`) can be read half-written by that
// connection or leave the WAL pointing at pages that no longer match the
// file — this is what corrupted the on-disk database once already. Every
// download path below writes to a *temp* file instead, then hands it to
// `install_downloaded_db`, which does the swap atomically while holding the
// connection lock, so no query can ever see a partially-replaced file.

fn wal_path(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push("-wal");
    PathBuf::from(s)
}

/// Atomically install an already-downloaded database file as the live
/// database. Holds both the path and connection locks for the whole swap,
/// so no other command can open or query the file half-replaced.
#[cfg(test)]
fn install_downloaded_db(db_state: &DbManager, temp_path: &Path) -> Result<(), String> {
    let backup_dir = db_state.get_path().parent().unwrap().join("backups");
    safety::install(db_state, temp_path, &backup_dir, None)
}

/// A standalone SQLite snapshot includes committed WAL transactions even if
/// another UI session writes while the network transfer is in progress.
struct UploadSnapshot(PathBuf);
impl Drop for UploadSnapshot {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}
fn upload_snapshot(db: &DbManager) -> Result<UploadSnapshot, String> {
    let path = db.get_path().with_extension(format!("upload-{}.db", uuid::Uuid::new_v4()));
    let snapshot = UploadSnapshot(path);
    db.with_conn(|conn| conn.execute("VACUUM INTO ?1", [snapshot.0.to_string_lossy().as_ref()]))?;
    Ok(snapshot)
}

// ── Reviewed sync commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_now(target_id: String, app: AppHandle, db_state: State<'_, DbManager>) -> Result<SyncResult, String> {
    let _guard = SYNC_LOCK.lock().await;
    let _brokers = safety::exclusive().await;
    safety::prepare(&app, &db_state, &target_id).await
}

#[tauri::command]
pub fn cancel_sync_review(confirmation_id: String) -> Result<(), String> {
    safety::cancel_review(&confirmation_id)
}

#[tauri::command]
pub async fn confirm_sync(confirmation_id: String, direction: String, allow_empty_upload: bool, app: AppHandle, db_state: State<'_, DbManager>) -> Result<SyncResult, String> {
    let _guard = SYNC_LOCK.lock().await;
    let _brokers = safety::exclusive().await;
    safety::confirm(&app, &db_state, &confirmation_id, &direction, allow_empty_upload).await
}

#[tauri::command]
pub fn list_sync_backups(app: AppHandle) -> Result<Vec<SyncBackup>, String> {
    safety::list_backups(&app)
}

#[tauri::command]
pub async fn prepare_restore_backup(backup_id: String, app: AppHandle, db_state: State<'_, DbManager>) -> Result<SyncResult, String> {
    let _guard = SYNC_LOCK.lock().await;
    let _brokers = safety::exclusive().await;
    safety::prepare_restore(&app, &db_state, &backup_id).await
}

#[tauri::command]
pub async fn test_sync_connection(target: SyncTarget) -> Result<bool, String> {
    match target.kind.as_str() {
        "path" => {
            let path = target
                .path
                .as_deref()
                .ok_or_else(|| "path target missing 'path' field".to_string())?;
            let p = normalize_local_path(path);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            Ok(true)
        }
        "webdav" => {
            let raw_url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url'".to_string())?;
            let url = normalize_webdav_url(raw_url);
            let username = target.username.as_deref().unwrap_or("");
            // The Add-Target form has not saved anything yet, so it passes the
            // password in the clear in `password_enc` for this probe only.
            // (Previously this ran the value through the legacy decrypt, which
            // always failed on plaintext and silently tested with an empty
            // password — making a correct password look like a bad one.)
            let password = target.password_enc.clone().unwrap_or_default();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| e.to_string())?;
            // Test against the parent directory URL so the file doesn't need to
            // exist yet.  PROPFIND Depth:0 is the standard WebDAV auth probe.
            let dir_url = url.rfind('/').map(|i| &url[..i]).unwrap_or(&url);
            let resp = client
                .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), dir_url)
                .basic_auth(username, Some(&password))
                .header("Depth", "0")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status().as_u16();
            // 207 Multi-Status = success; 200 also acceptable
            if status == 207 || status == 200 {
                Ok(true)
            } else {
                Err(format!("WebDAV PROPFIND returned HTTP {}", status))
            }
        }
        other => Err(format!("Unknown sync target kind: {}", other)),
    }
}

// ── Password storage ──────────────────────────────────────────────────────
//
// Passwords used to be AES-GCM sealed into `config.json` with a key XOR-folded
// from the plaintext `device_id` stored in that same file, using nonces derived
// from a timestamp hash rather than a CSPRNG.  Both are broken: the key was
// recoverable from the file, and AES-GCM nonce reuse leaks plaintext.
//
// They now live in the OS keychain via `secrets.rs`.  `SyncTarget.password_enc`
// is retained only so existing configs can be migrated on first use, after
// which the field is cleared.

use crate::secrets;

/// Resolve a target's password: keychain first, legacy `config.json` value as
/// a fallback, copying it into the keychain the first time it is used.
///
/// # Why the legacy value is copied, not moved
///
/// Deleting `password_enc` here would break any *already-installed* build of
/// Stockfolio still on this machine.  Those builds predate the keychain and
/// read the password straight out of `config.json`; blanking the field makes
/// their WebDAV sync fail with an auth error that looks like a server outage.
///
/// So the weakly-sealed copy is deliberately left in place. It stops being
/// written for *new* targets (see `save_sync_password`), and can be cleared
/// once the keychain-aware build has replaced the installed one — a one-line
/// change here, plus a config rewrite.
fn resolve_password(app: &AppHandle, cfg: &AppConfig, target: &SyncTarget) -> String {
    let reference = secrets::sync_reference(&target.id);

    if let Ok(Some(password)) = secrets::get_secret(app, &reference) {
        return password;
    }

    let legacy = target.password_enc.as_deref().unwrap_or("");
    if legacy.is_empty() {
        return String::new();
    }

    let password = secrets::legacy_decrypt(legacy, &cfg.device_id);
    if password.is_empty() {
        // Undecryptable — most likely sealed on a different device, since the
        // legacy key was derived from that device's id. Nothing to recover.
        return String::new();
    }

    // Copy into the keychain so future reads use it, but leave config.json
    // alone. Note that `sync_now` re-saves its own copy of the config after
    // this returns, so any edit made here would be silently reverted anyway.
    if secrets::set_secret(app, &reference, &password).is_ok() {
        eprintln!(
            "[sync] cached password for target '{}' in the keychain (legacy value retained for the installed build)",
            target.id
        );
    }

    password
}

/// Store a sync target's password. Called by the frontend after saving a target.
#[tauri::command]
pub fn save_sync_password(app: AppHandle, target_id: String, password: String) -> Result<(), String> {
    secrets::set_secret(&app, &secrets::sync_reference(&target_id), &password)
}

/// Remove a sync target's password, e.g. when the target is deleted.
#[tauri::command]
pub fn delete_sync_password(app: AppHandle, target_id: String) -> Result<(), String> {
    secrets::delete_secret(&app, &secrets::sync_reference(&target_id))
}

/// Whether a password is available on this device for the given target.
#[tauri::command]
pub fn has_sync_password(app: AppHandle, target_id: String) -> bool {
    secrets::has_secret(&app, &secrets::sync_reference(&target_id))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Remote DB discovery & import ───────────────────────────────────────────

/// Returns true if a Stockfolio database file already exists at the sync target.
#[tauri::command]
pub async fn check_remote_db_exists(target_id: String, app: AppHandle) -> Result<bool, String> {
    let cfg = load_config(&app)?;
    let target = cfg
        .sync_targets
        .iter()
        .find(|t| t.id == target_id)
        .cloned()
        .ok_or_else(|| format!("Sync target '{}' not found", target_id))?;

    match target.kind.as_str() {
        "path" => {
            let path = target
                .path
                .as_deref()
                .ok_or_else(|| "path target missing 'path' field".to_string())?;
            let p = normalize_local_path(path);
            Ok(p.is_file() && p.metadata().map(|m| m.len() > 0).unwrap_or(false))
        }
        "webdav" => {
            let raw_url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url' field".to_string())?;
            let url = normalize_webdav_url(raw_url);
            let username = target.username.as_deref().unwrap_or("");
            let password = resolve_password(&app, &cfg, &target);
            webdav_metadata(&url, username, &password).await.map(|(exists, _)| exists)
        }
        _ => Ok(false),
    }
}

/// Legacy callers can request a review, but cannot bypass confirmation.
#[tauri::command]
pub async fn import_remote_db(target_id: String, app: AppHandle, db_state: State<'_, DbManager>) -> Result<SyncResult, String> {
    sync_now(target_id, app, db_state).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stockfolio-import-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn add_portfolio(db: &DbManager, name: &str) {
        db.with_conn(|conn| conn.execute("INSERT INTO portfolios (name, sort_order, is_starred, created_at) VALUES (?1, 0, 0, 1)", [name])).unwrap();
    }
    fn has_portfolio(db: &DbManager, name: &str) -> bool {
        db.with_conn(|conn| conn.query_row("SELECT COUNT(*) FROM portfolios WHERE name=?1", [name], |row| row.get::<_, i64>(0))).unwrap() > 0
    }
    #[test]
    fn upload_snapshot_includes_committed_wal_rows() {
        let dir = test_dir();
        let local = DbManager::open(&dir.join("local.db")).unwrap();
        add_portfolio(&local, "Committed in WAL");
        let snapshot = upload_snapshot(&local).unwrap();
        let copied = DbManager::open(&snapshot.0).unwrap();
        assert!(has_portfolio(&copied, "Committed in WAL"));
        drop(copied); drop(snapshot); drop(local);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_download_keeps_the_live_database_usable() {
        let dir = test_dir();
        let local = DbManager::open(&dir.join("local.db")).unwrap();
        add_portfolio(&local, "Local sentinel");
        let incoming = dir.join("incoming.db");
        fs::write(&incoming, b"<html>Authentication required</html>").unwrap();
        assert!(install_downloaded_db(&local, &incoming).is_err());
        assert!(has_portfolio(&local, "Local sentinel"));
        add_portfolio(&local, "Still writable");
        assert!(has_portfolio(&local, "Still writable"));
        drop(local);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn import_reopens_the_database_and_preserves_a_local_backup() {
        let dir = test_dir();
        let local = DbManager::open(&dir.join("local.db")).unwrap();
        add_portfolio(&local, "Local sentinel");
        let incoming_path = dir.join("incoming.db");
        let incoming = DbManager::open(&incoming_path).unwrap();
        add_portfolio(&incoming, "Remote sentinel");
        drop(incoming);
        install_downloaded_db(&local, &incoming_path).unwrap();
        assert!(has_portfolio(&local, "Remote sentinel"));
        assert!(!has_portfolio(&local, "Local sentinel"));
        let backup = fs::read_dir(dir.join("backups")).unwrap().map(|entry| entry.unwrap().path())
            .find(|path| path.extension().is_some_and(|extension| extension == "db")).unwrap();
        let backup = DbManager::open(&backup).unwrap();
        assert!(has_portfolio(&backup, "Local sentinel"));
        drop(backup);
        drop(local);
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn remote_without_modified_header_is_still_an_existing_database() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = axum::Router::new().route("/stockfolio.db", axum::routing::head(|| async { axum::http::StatusCode::OK }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let metadata = webdav_metadata(&format!("http://{address}/stockfolio.db"), "user", "password").await.unwrap();
        assert_eq!(metadata, (true, None));
        server.abort();
    }
    #[tokio::test]
    async fn authentication_failure_is_not_treated_as_a_missing_remote() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = axum::Router::new().route("/stockfolio.db", axum::routing::head(|| async { axum::http::StatusCode::UNAUTHORIZED }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        assert!(webdav_metadata(&format!("http://{address}/stockfolio.db"), "user", "password").await.unwrap_err().contains("401"));
        server.abort();
    }
}
