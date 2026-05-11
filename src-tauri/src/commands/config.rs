use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// Unique identifier for this device/installation.
    pub device_id: String,
    /// Absolute path to the database file.  None = use default app-data location.
    pub db_path: Option<String>,
    /// Registered sync targets.
    pub sync_targets: Vec<SyncTarget>,
    /// How often to auto-sync (in minutes).  None or 0 = disabled.
    pub auto_sync_minutes: Option<u32>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            device_id: Uuid::new_v4().to_string(),
            db_path: None,
            sync_targets: Vec::new(),
            auto_sync_minutes: None,
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    match config_path(app) {
        Ok(p) if p.exists() => {
            fs::read_to_string(&p)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        }
        _ => AppConfig::default(),
    }
}

pub fn save_config_to_disk(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let p = config_path(app)?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())
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
    Ok(load_config(&app))
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    save_config_to_disk(&app, &config)
}

/// Move the database to a new directory chosen by the user.
/// Returns the new absolute path.
#[tauri::command]
pub fn move_database(app: AppHandle, new_dir: String) -> Result<String, String> {
    let mut cfg = load_config(&app);
    let current_path = resolve_db_path(&app, &cfg)?;

    let target_dir = PathBuf::from(&new_dir);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let new_path = target_dir.join("stockfolio.db");

    if new_path == current_path {
        return Ok(new_path.to_string_lossy().into_owned());
    }

    fs::copy(&current_path, &new_path).map_err(|e| e.to_string())?;
    cfg.db_path = Some(new_path.to_string_lossy().into_owned());
    save_config_to_disk(&app, &cfg)?;

    Ok(new_path.to_string_lossy().into_owned())
}
