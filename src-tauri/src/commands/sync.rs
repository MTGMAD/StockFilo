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

    if remote_mtime > local_mtime {
        // Remote is newer — download to local
        fs::copy(remote_path, local_db_path).map_err(|e| e.to_string())?;
        Ok(SyncResult {
            success: true,
            message: "Downloaded newer database from remote path".into(),
            synced_at: now_secs(),
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
        })
    }
}

async fn sync_webdav_target(
    local_db_path: &PathBuf,
    url: &str,
    username: &str,
    password: &str,
    device_id: &str,
) -> Result<SyncResult, String> {
    let lock = lock_url(url);
    acquire_lock(&lock, username, password, device_id).await?;

    let result = async {
        let local_mtime = fs::metadata(local_db_path)
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0);

        let remote_mtime = webdav_head_mtime(url, username, password).await.unwrap_or(0);

        if remote_mtime > local_mtime {
            // Remote is newer — download
            let bytes = webdav_get(url, username, password).await?;
            let mut f = fs::File::create(local_db_path).map_err(|e| e.to_string())?;
            f.write_all(&bytes).map_err(|e| e.to_string())?;
            Ok(SyncResult {
                success: true,
                message: "Downloaded newer database from WebDAV".into(),
                synced_at: now_secs(),
            })
        } else {
            // Local is same age or newer — upload
            let bytes = fs::read(local_db_path).map_err(|e| e.to_string())?;
            webdav_put(url, username, password, bytes).await?;
            Ok(SyncResult {
                success: true,
                message: "Uploaded local database to WebDAV".into(),
                synced_at: now_secs(),
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
            sync_path_target(&local_db_path, &remote).await
        }
        "webdav" => {
            let url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url' field".to_string())?;
            let username = target.username.as_deref().unwrap_or("");
            let password = decrypt_password(target.password_enc.as_deref().unwrap_or(""), &cfg.device_id);
            sync_webdav_target(&local_db_path, url, username, &password, &cfg.device_id).await
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
            let url = target
                .url
                .as_deref()
                .ok_or_else(|| "webdav target missing 'url'".to_string())?;
            let username = target.username.as_deref().unwrap_or("");
            let password = decrypt_password(target.password_enc.as_deref().unwrap_or(""), "test");
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| e.to_string())?;
            // Test against the parent directory URL so the file doesn't need to
            // exist yet.  PROPFIND Depth:0 is the standard WebDAV auth probe.
            let dir_url = url.rfind('/').map(|i| &url[..i]).unwrap_or(url);
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
