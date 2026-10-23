use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

// ── Types ──────────────────────────────────────────────────────────────────

/// Flat struct — avoids the serde `flatten` + internally-tagged-enum
/// deserialization bug (serde/issues/1183) that silently matched WebDAV
/// targets as Path targets on read-back.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncTarget {
    pub id: String,
    pub label: String,
    /// Discriminant: "path" or "webdav"
    pub kind: String,
    // ── path target fields ──────────────────────────
    #[serde(default)]
    pub path: Option<String>,
    // ── webdav target fields ────────────────────────
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password_enc: Option<String>,
    pub last_synced_at: Option<i64>,
    pub last_sync_status: Option<String>,
    /// Legacy targets must be reviewed again after the safety upgrade.
    #[serde(default)]
    pub sync_initialized: bool,
    #[serde(default)]
    pub last_local_fingerprint: Option<String>,
    #[serde(default)]
    pub last_remote_fingerprint: Option<String>,
    /// Both copies at the last transfer, ignoring broker-refreshed data.
    #[serde(default)]
    pub last_records_fingerprint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// Unique identifier for this device/installation.
    pub device_id: String,
    /// Absolute path to the database file.  None = use default app-data location.
    pub db_path: Option<String>,
    /// Registered sync targets.
    #[serde(default)]
    pub sync_targets: Vec<SyncTarget>,
    /// How often to auto-sync (in minutes).  None or 0 = disabled.
    pub auto_sync_minutes: Option<u32>,
    /// App icon chosen in Settings.  None = the default violet icon.
    #[serde(default)]
    pub app_icon: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            device_id: Uuid::new_v4().to_string(),
            db_path: None,
            sync_targets: Vec::new(),
            auto_sync_minutes: None,
            app_icon: None,
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn read_config(path: &std::path::Path) -> Result<AppConfig, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Cannot read storage settings: {e}. The existing file has been preserved.")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let config = AppConfig::default();
            write_config(path, &config)?;
            Ok(config)
        }
        Err(e) => Err(format!("Cannot read storage settings: {e}")),
    }
}

fn write_config(path: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&json).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    read_config(&config_path(app)?)
}

pub fn save_config_to_disk(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    write_config(&config_path(app)?, config)
}

pub fn update_config(app: &AppHandle, update: impl FnOnce(&mut AppConfig)) -> Result<AppConfig, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let path = config_path(app)?;
    let mut config = read_config(&path)?;
    update(&mut config);
    write_config(&path, &config)?;
    Ok(config)
}

/// Return the resolved absolute path to the database file.
pub fn resolve_db_path(app: &AppHandle, config: &AppConfig) -> Result<PathBuf, String> {
    if let Some(ref custom) = config.db_path {
        Ok(PathBuf::from(custom))
    } else {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("stockfolio.db"))
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    load_config(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    save_config_to_disk(&app, &config)
}

/// Allocate the id and persist a target in the backend so the form closes
/// only after both the credential and current configuration are saved.
#[tauri::command]
pub async fn add_sync_target(app: AppHandle, mut target: SyncTarget, password: Option<String>) -> Result<AppConfig, String> {
    target.id = Uuid::new_v4().to_string();
    target.password_enc = None;
    target.last_synced_at = None;
    target.last_sync_status = None;
    target.sync_initialized = false;
    target.last_local_fingerprint = None;
    target.last_remote_fingerprint = None;
    target.last_records_fingerprint = None;
    if let Some(url) = &mut target.url { *url = url.trim().to_string(); }
    if let Some(username) = &mut target.username { *username = username.trim().to_string(); }
    if target.kind != "path" && target.kind != "webdav" { return Err("Unknown sync target type".into()); }
    if target.kind == "webdav" && (target.url.as_deref().unwrap_or("").is_empty() || target.username.as_deref().unwrap_or("").is_empty()) {
        return Err("WebDAV URL and username are required".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let reference = crate::secrets::sync_reference(&target.id);
        if target.kind == "webdav" {
            if let Some(password) = password.filter(|p| !p.is_empty()) {
                crate::secrets::set_secret(&app, &reference, &password)?;
            }
        }
        update_config(&app, |config| config.sync_targets.push(target))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remove_sync_target(app: AppHandle, target_id: String) -> Result<AppConfig, String> {
    let config = update_config(&app, |config| config.sync_targets.retain(|target| target.id != target_id))?;
    let _ = crate::secrets::delete_secret(&app, &crate::secrets::sync_reference(&target_id));
    Ok(config)
}

#[tauri::command]
pub fn set_auto_sync_minutes(app: AppHandle, minutes: Option<u32>) -> Result<AppConfig, String> {
    update_config(&app, |config| config.auto_sync_minutes = minutes.filter(|minutes| *minutes > 0))
}

/// Move the database to a new directory chosen by the user.
/// Returns the new absolute path.
#[tauri::command]
pub fn move_database(app: AppHandle, new_dir: String, state: tauri::State<'_, crate::db::manager::DbManager>) -> Result<String, String> {
    let target_dir = PathBuf::from(&new_dir);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let new_path = target_dir.join("stockfolio.db");

    state.relocate(&new_path, || {
        update_config(&app, |config| config.db_path = Some(new_path.to_string_lossy().into_owned())).map(|_| ())
    })?;

    Ok(new_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_path() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stockfolio-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("config.json")
    }
    #[test]
    fn first_read_persists_identity_and_targets_survive_reload() {
        let path = test_path();
        let mut config = read_config(&path).unwrap();
        let device_id = config.device_id.clone();
        assert_eq!(read_config(&path).unwrap().device_id, device_id);
        config.sync_targets.push(SyncTarget {
            id: "test".into(), label: "Cloud".into(), kind: "webdav".into(), path: None,
            url: Some("https://example.com/dav/files/user/".into()), username: Some("user".into()),
            password_enc: None, last_synced_at: None, last_sync_status: None,
            sync_initialized: false, last_local_fingerprint: None, last_remote_fingerprint: None, last_records_fingerprint: None,
        });
        write_config(&path, &config).unwrap();
        let loaded = read_config(&path).unwrap();
        assert_eq!(loaded.device_id, device_id);
        assert_eq!(loaded.sync_targets[0].kind, "webdav");
        assert_eq!(loaded.sync_targets[0].username.as_deref(), Some("user"));
        assert!(loaded.sync_targets[0].password_enc.is_none());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn malformed_config_is_reported_and_preserved() {
        let path = test_path();
        fs::write(&path, "{partial settings").unwrap();
        assert!(read_config(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{partial settings");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
