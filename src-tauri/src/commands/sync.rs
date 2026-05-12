use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, State};

use crate::commands::config::{load_config, save_config_to_disk, SyncTarget};
use crate::db::manager::DbManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub synced_at: i64,
    /// True when the remote was newer and the local DB file was replaced.
    /// The caller must reopen the DB connection.
    pub downloaded: bool,
}

// ── WebDAV helpers ─────────────────────────────────────────────────────────

async fn webdav_get(url: &str, username: &str, password: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();
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

async fn webdav_put(url: &str, username: &str, password: &str, body: Vec<u8>) -> Result<(), String> {
    // Ensure parent collection exists (MKCOL is idempotent — 405 Method Not Allowed
    // is returned when it already exists, which is fine).
    if let Some(parent) = url.rfind('/').map(|i| &url[..i]).filter(|p| !p.is_empty()) {
        let client = reqwest::Client::new();
        let _ = client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), parent)
            .basic_auth(username, Some(password))
            .send()
            .await;
    }

    let client = reqwest::Client::new();
    let resp = client
        .put(url)
        .basic_auth(username, Some(password))
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() && resp.status().as_u16() != 201 {
        return Err(format!("WebDAV PUT {} returned {}", url, resp.status()));
    }
    Ok(())
}

async fn webdav_head_mtime(url: &str, username: &str, password: &str) -> Option<i64> {
    let client = reqwest::Client::new();
    let resp = client
        .head(url)
        .basic_auth(username, Some(password))
        .send()
        .await
        .ok()?;

    resp.headers()
        .get("last-modified")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| chrono::DateTime::parse_from_rfc2822(s).ok())
        .map(|dt| dt.timestamp())
}

// ── Lock file management ───────────────────────────────────────────────────

/// Ensure the WebDAV URL points to a file (stockfolio.db), not a directory.
/// If the URL has no extension and doesn't already end with ".db", append
/// "/stockfolio.db" (stripping any trailing slash first).
fn normalize_webdav_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    // Check whether the last path segment looks like a filename (has a dot)
    let last_segment = trimmed.rsplit('/').next().unwrap_or("");
    if last_segment.contains('.') {
        trimmed.to_string()
    } else {
        format!("{}/stockfolio.db", trimmed)
    }
}

fn lock_url(db_url: &str) -> String {
    format!("{}.lock", db_url)
}

async fn acquire_lock(url: &str, username: &str, password: &str, device_id: &str) -> Result<(), String> {
    let payload = serde_json::json!({
        "device_id": device_id,
        "acquired_at": now_secs(),
    })
    .to_string()
    .into_bytes();

    // Check for existing (non-stale) lock
    if let Ok(existing) = webdav_get(url, username, password).await {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&existing) {
            let acquired_at = v["acquired_at"].as_i64().unwrap_or(0);
            if now_secs() - acquired_at < 120 {
                return Err("Remote is locked by another sync in progress".into());
            }
        }
    }
    webdav_put(url, username, password, payload).await
}

async fn release_lock(url: &str, username: &str, password: &str) {
    // Overwrite with an expired timestamp — best effort
    let payload = serde_json::json!({ "acquired_at": 0 }).to_string().into_bytes();
    let _ = webdav_put(url, username, password, payload).await;
}

// ── Sync algorithm ─────────────────────────────────────────────────────────

async fn sync_path_target(
    local_db_path: &PathBuf,
    remote_path: &PathBuf,
    never_synced: bool,
) -> Result<SyncResult, String> {
    let local_mtime = fs::metadata(local_db_path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or(0);

    let remote_mtime = if remote_path.exists() {
        fs::metadata(remote_path)
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0)
    } else {
        0
    };

    if let Some(parent) = remote_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // On first sync, always trust the remote if it exists — the local DB is
    // brand-new and has no user data, so uploading it would wipe the remote.
    let prefer_remote = remote_mtime > local_mtime || (never_synced && remote_path.exists());

    if prefer_remote {
        // Remote is authoritative — download to local
        fs::copy(remote_path, local_db_path).map_err(|e| e.to_string())?;
        Ok(SyncResult {
            success: true,
            message: "Downloaded newer database from remote path".into(),
            synced_at: now_secs(),
            downloaded: true,
        })
    } else {
        // Local is same age or newer — upload to remote
        // Back up remote first if it exists
        if remote_path.exists() {
            let bak = remote_path.with_extension("db.bak");
            let _ = fs::copy(remote_path, &bak);
        }
        fs::copy(local_db_path, remote_path).map_err(|e| e.to_string())?;
        Ok(SyncResult {
            success: true,
            message: "Uploaded local database to remote path".into(),
            synced_at: now_secs(),
            downloaded: false,
        })
    }
}

async fn sync_webdav_target(
    local_db_path: &PathBuf,
    url: &str,
    username: &str,
    password: &str,
    device_id: &str,
    never_synced: bool,
) -> Result<SyncResult, String> {
    let lock = lock_url(url);
    acquire_lock(&lock, username, password, device_id).await?;

    let result = async {
        let local_mtime = fs::metadata(local_db_path)
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0);

        let remote_mtime = webdav_head_mtime(url, username, password).await.unwrap_or(0);
        let remote_exists = remote_mtime > 0;

        // On first sync, always trust the remote if it has any data — the local
        // DB is brand-new and has no user data, so uploading it would wipe the remote.
        let prefer_remote = remote_mtime > local_mtime || (never_synced && remote_exists);

        if prefer_remote {
            // Remote is authoritative — download
            let bytes = webdav_get(url, username, password).await?;
            let mut f = fs::File::create(local_db_path).map_err(|e| e.to_string())?;
            f.write_all(&bytes).map_err(|e| e.to_string())?;
            Ok(SyncResult {
                success: true,
                message: "Downloaded newer database from WebDAV".into(),
                synced_at: now_secs(),
                downloaded: true,
            })
        } else {
            // Local is same age or newer — upload
            let bytes = fs::read(local_db_path).map_err(|e| e.to_string())?;
            webdav_put(url, username, password, bytes).await?;
            Ok(SyncResult {
                success: true,
                message: "Uploaded local database to WebDAV".into(),
                synced_at: now_secs(),
                downloaded: false,
            })
        }
    }
    .await;

    release_lock(&lock, username, password).await;
    result
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_now(
    target_id: String,
    app: AppHandle,
    db_state: State<'_, DbManager>,
) -> Result<SyncResult, String> {
    let mut cfg = load_config(&app);

    let target = cfg
        .sync_targets
        .iter()
        .find(|t| t.id == target_id)
        .cloned()
        .ok_or_else(|| format!("Sync target '{}' not found", target_id))?;

    let local_db_path = {
        // Checkpoint WAL before copying so the copy is a consistent snapshot
        let _ = db_state.with_conn(|conn| {
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map(|_| ())
        });
        db_state.get_path()
    };

    let result = match target.kind.as_str() {
        "path" => {
            let path = target
                .path
                .as_deref()
                .ok_or_else(|| "path target missing 'path' field".to_string())?;
            let remote = PathBuf::from(path);
            let never_synced = target.last_synced_at.is_none();
            sync_path_target(&local_db_path, &remote, never_synced).await
        }
        "webdav" => {
            let raw_url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url' field".to_string())?;
            let url = normalize_webdav_url(raw_url);
            let username = target.username.as_deref().unwrap_or("");
            let password = decrypt_password(target.password_enc.as_deref().unwrap_or(""), &cfg.device_id);
            let never_synced = target.last_synced_at.is_none();
            sync_webdav_target(&local_db_path, &url, username, &password, &cfg.device_id, never_synced).await
        }
        other => Err(format!("Unknown sync target kind: {}", other)),
    };

    // Update last_synced_at regardless of outcome
    let now = now_secs();
    for t in &mut cfg.sync_targets {
        if t.id == target_id {
            t.last_synced_at = Some(now);
            t.last_sync_status = Some(match &result {
                Ok(_) => "ok".into(),
                Err(e) => e.clone(),
            });
        }
    }
    let _ = save_config_to_disk(&app, &cfg);

    // If the remote was newer and we downloaded a new DB file, reopen the
    // Rusqlite connection so the rest of the app immediately sees the new data.
    if let Ok(ref r) = result {
        if r.downloaded {
            let path_guard = db_state.path.lock().map_err(|e| e.to_string())?;
            let mut conn_guard = db_state.conn.lock().map_err(|e| e.to_string())?;
            let wal = {
                let mut p = path_guard.as_os_str().to_owned();
                p.push("-wal");
                PathBuf::from(p)
            };
            let shm = {
                let mut p = path_guard.as_os_str().to_owned();
                p.push("-shm");
                PathBuf::from(p)
            };
            let _ = fs::remove_file(&wal);
            let _ = fs::remove_file(&shm);
            use crate::db::migrations;
            use rusqlite::Connection;
            let new_conn = Connection::open(&*path_guard).map_err(|e| e.to_string())?;
            new_conn
                .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .map_err(|e| e.to_string())?;
            migrations::run_all(&new_conn).map_err(|e| e.to_string())?;
            *conn_guard = new_conn;
        }
    }

    result
}

#[tauri::command]
pub async fn test_sync_connection(target: SyncTarget) -> Result<bool, String> {
    match target.kind.as_str() {
        "path" => {
            let path = target
                .path
                .as_deref()
                .ok_or_else(|| "path target missing 'path' field".to_string())?;
            let p = PathBuf::from(path);
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
            let password = decrypt_password(target.password_enc.as_deref().unwrap_or(""), "test");
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

// ── Password encryption (AES-GCM) ─────────────────────────────────────────

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};

fn derive_key(device_id: &str) -> [u8; 32] {
    let seed = format!("stockfolio-sync-v1:{}", device_id);
    let bytes = seed.as_bytes();
    let mut key = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        key[i % 32] ^= b;
    }
    key
}

pub fn encrypt_password(plain: &str, device_id: &str) -> String {
    let key_bytes = derive_key(device_id);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce_bytes: [u8; 12] = rand_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);
    match cipher.encrypt(nonce, plain.as_bytes()) {
        Ok(ciphertext) => {
            let mut out = nonce_bytes.to_vec();
            out.extend_from_slice(&ciphertext);
            base64::engine::general_purpose::STANDARD.encode(&out)
        }
        Err(_) => String::new(),
    }
}

pub fn decrypt_password(enc: &str, device_id: &str) -> String {
    use base64::Engine;
    let data = match base64::engine::general_purpose::STANDARD.decode(enc) {
        Ok(d) => d,
        Err(_) => return String::new(),
    };
    if data.len() < 12 {
        return String::new();
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let key_bytes = derive_key(device_id);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default()
}

fn rand_nonce() -> [u8; 12] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut hasher);
    std::thread::current().id().hash(&mut hasher);
    let h1 = hasher.finish();
    std::time::SystemTime::now().hash(&mut hasher);
    let h2 = hasher.finish();
    let mut out = [0u8; 12];
    out[..8].copy_from_slice(&h1.to_le_bytes());
    out[8..].copy_from_slice(&h2.to_le_bytes()[..4]);
    out
}

#[tauri::command]
pub fn encrypt_sync_password(plain: String, device_id: String) -> String {
    encrypt_password(&plain, &device_id)
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
    let cfg = load_config(&app);
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
            let p = PathBuf::from(path);
            Ok(p.is_file() && p.metadata().map(|m| m.len() > 0).unwrap_or(false))
        }
        "webdav" => {
            let raw_url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url' field".to_string())?;
            let url = normalize_webdav_url(raw_url);
            let username = target.username.as_deref().unwrap_or("");
            let password =
                decrypt_password(target.password_enc.as_deref().unwrap_or(""), &cfg.device_id);
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| e.to_string())?;
            let resp = client
                .head(&url)
                .basic_auth(username, Some(&password))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            Ok(resp.status().is_success())
        }
        _ => Ok(false),
    }
}

/// Force-download the remote DB and replace the local database, then reopen
/// the Rusqlite connection so the rest of the app immediately uses the new data.
#[tauri::command]
pub async fn import_remote_db(
    target_id: String,
    app: AppHandle,
    db_state: State<'_, DbManager>,
) -> Result<(), String> {
    let cfg = load_config(&app);
    let target = cfg
        .sync_targets
        .iter()
        .find(|t| t.id == target_id)
        .cloned()
        .ok_or_else(|| format!("Sync target '{}' not found", target_id))?;

    let local_db_path = db_state.get_path();
    let temp_path = local_db_path
        .parent()
        .ok_or("Cannot determine DB directory")?
        .join("stockfolio.db.import_tmp");

    // Step 1 — download to a temp file (no mutex held so network I/O doesn't block queries)
    match target.kind.as_str() {
        "path" => {
            let path = target
                .path
                .as_deref()
                .ok_or_else(|| "path target missing 'path' field".to_string())?;
            let remote = PathBuf::from(path);
            if !remote.is_file() {
                return Err("No database found at the specified path".into());
            }
            fs::copy(&remote, &temp_path).map_err(|e| e.to_string())?;
        }
        "webdav" => {
            let raw_url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url' field".to_string())?;
            let url = normalize_webdav_url(raw_url);
            let username = target.username.as_deref().unwrap_or("");
            let password =
                decrypt_password(target.password_enc.as_deref().unwrap_or(""), &cfg.device_id);
            let bytes = webdav_get(&url, username, &password).await?;
            if bytes.is_empty() {
                return Err("Remote database is empty".into());
            }
            fs::write(&temp_path, bytes).map_err(|e| e.to_string())?;
        }
        other => return Err(format!("Unknown sync target kind: {}", other)),
    }

    // Step 2 — lock the connection, checkpoint WAL, swap files, reopen
    {
        let path_guard = db_state.path.lock().map_err(|e| e.to_string())?;
        let mut conn_guard = db_state.conn.lock().map_err(|e| e.to_string())?;

        // Flush WAL so the local file is a consistent snapshot before we replace it
        let _ = conn_guard.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

        // Remove stale WAL / SHM files so the new connection starts clean
        let wal = {
            let mut p = path_guard.as_os_str().to_owned();
            p.push("-wal");
            PathBuf::from(p)
        };
        let shm = {
            let mut p = path_guard.as_os_str().to_owned();
            p.push("-shm");
            PathBuf::from(p)
        };
        let _ = fs::remove_file(&wal);
        let _ = fs::remove_file(&shm);

        // Atomically replace local DB with the downloaded temp file
        fs::rename(&temp_path, &*path_guard).map_err(|e| {
            // rename can fail across mount points; fall back to copy+delete
            fs::copy(&temp_path, &*path_guard)
                .map(|_| {
                    let _ = fs::remove_file(&temp_path);
                })
                .map_err(|ce| ce.to_string())
                .unwrap_or_default();
            e.to_string()
        })?;

        // Open a fresh connection to the imported database
        use crate::db::migrations;
        use rusqlite::Connection;
        let new_conn =
            Connection::open(&*path_guard).map_err(|e| e.to_string())?;
        new_conn
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
        migrations::run_all(&new_conn).map_err(|e| e.to_string())?;

        *conn_guard = new_conn;
    }

    // Clean up temp file in case rename failed and we fell back to copy
    let _ = fs::remove_file(&temp_path);

    Ok(())
}
