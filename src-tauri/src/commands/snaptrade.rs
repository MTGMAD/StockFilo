//! SnapTrade connect flow.
//!
//! Deliberately separate from `commands::brokers`: SnapTrade connects through
//! a hosted browser portal, not the generic credential form, so it needs its
//! own commands rather than `broker_save_connection`. Once a brokerage is
//! connected, it becomes an ordinary `broker_connections` row and every
//! generic command — `broker_sync_connection`, `broker_list_connections`,
//! `broker_set_account_visible`, `broker_delete_connection` — works on it
//! unchanged. See `brokers::snaptrade` for how that reuse is wired.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::{AppHandle, State};

use crate::brokers::snaptrade::{self, client::SnapTradeClient, map};
use crate::commands::config::load_config;
use crate::db::manager::DbManager;
use crate::secrets;

mod discovery;

/// This app's SnapTrade developer keys — Personal tier (one clientId/
/// consumerKey per person, not per company), one pair for the whole install.
/// There is no central Stockfolio server to hold a shared key safely, so
/// each person creates their own on SnapTrade's dashboard.
const APP_KEYS_REF: &str = "snaptrade:app";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppKeys {
    client_id: String,
    consumer_key: String,
}

fn load_app_keys(app: &AppHandle) -> Result<AppKeys, String> {
    let blob = secrets::get_secret(app, APP_KEYS_REF)?
        .ok_or_else(|| "SnapTrade is not configured on this device yet.".to_string())?;
    serde_json::from_str(&blob).map_err(|e| e.to_string())
}

/// Store this app's SnapTrade developer keys on this device. Not verified
/// against SnapTrade here — the first real call (connecting) is what proves
/// them, the same way a broker's credentials are only proven by `verify`.
#[tauri::command]
pub fn snaptrade_save_app_keys(
    app: AppHandle,
    client_id: String,
    consumer_key: String,
) -> Result<(), String> {
    let blob = serde_json::to_string(&AppKeys { client_id, consumer_key })
        .map_err(|e| e.to_string())?;
    secrets::set_secret(&app, APP_KEYS_REF, &blob)
}

#[tauri::command]
pub fn snaptrade_app_keys_configured(app: AppHandle) -> bool {
    secrets::has_secret(&app, APP_KEYS_REF)
}

/// Return a fresh Connection Portal URL for the person to open in their
/// browser. No user registration step — a Personal key already has its one
/// user baked in; see `brokers::snaptrade`'s module doc.
#[tauri::command]
pub async fn snaptrade_connect(app: AppHandle) -> Result<String, String> {
    let keys = load_app_keys(&app)?;
    let client = SnapTradeClient::new(&keys.client_id, &keys.consumer_key)?;
    Ok(client.portal_url().await?)
}

/// Discover new accounts and reconnect synced accounts using non-secret IDs.
/// Credentials never determine whether an imported account already exists.
/// Returns the number of genuinely new authorizations.
#[tauri::command]
pub async fn snaptrade_sync_authorizations(
    app: AppHandle,
    state: State<'_, DbManager>,
) -> Result<usize, String> {
    let keys = load_app_keys(&app)?;
    let client = SnapTradeClient::new(&keys.client_id, &keys.consumer_key)?;
    let accounts = client.list_accounts().await?;
    let mut groups: BTreeMap<String, discovery::Authorization> = BTreeMap::new();
    for raw in &accounts {
        let auth = map::authorization_id(raw).filter(|id| !id.trim().is_empty())
            .ok_or("SnapTrade returned an account without an authorization ID. Nothing was changed.")?;
        let account = map::account(raw).ok_or("SnapTrade returned an account without an account ID. Nothing was changed.")?;
        groups.entry(auth.clone()).or_insert_with(|| discovery::Authorization {
            id: auth,
            institution: map::institution_name(raw).unwrap_or_else(|| "SnapTrade".into()),
            accounts: Vec::new(),
        }).accounts.push(account);
    }
    let groups: Vec<_> = groups.into_values().collect();
    let device_id = load_config(&app)?.device_id;
    // Serialize discovery with the database and all other browser/desktop
    // callers. Never hold this lock across the remote HTTP request above.
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id FROM broker_connections WHERE provider = 'snaptrade'").map_err(|e| e.to_string())?;
    let ids = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    drop(stmt);
    let mut known = HashMap::new();
    for id in ids {
        if let Some(blob) = secrets::get_secret(&app, &secrets::broker_reference(&id))? {
            let credentials: crate::brokers::types::Credentials = serde_json::from_str(&blob)
                .map_err(|_| "Saved SnapTrade credentials could not be read. Nothing was changed.")?;
            if let Some(auth) = credentials.get("authorization_id") { known.insert(id, auth.clone()); }
        }
    }
    let duplicates: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM broker_accounts a JOIN broker_connections c ON c.id = a.connection_id WHERE c.provider = 'snaptrade' GROUP BY a.provider_account_id HAVING COUNT(*) > 1)",
        [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    let repeated_authorizations = known.values().collect::<HashSet<_>>().len() < known.len();
    if duplicates || repeated_authorizations {
        crate::commands::sync::backup_broker_database(&app, &conn)?;
    }
    let mut touched = Vec::new();
    let result = (|| -> Result<discovery::Outcome, String> {
        let txn = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let outcome = discovery::reconcile(&txn, &groups, &known, &device_id)?;
        for (id, auth) in &outcome.bindings {
            let reference = secrets::broker_reference(id);
            let previous = secrets::get_secret(&app, &reference)?;
            touched.push((reference.clone(), previous));
            let credentials = snaptrade::credentials(&keys.client_id, &keys.consumer_key, auth);
            let blob = serde_json::to_string(&credentials).map_err(|e| e.to_string())?;
            secrets::set_secret(&app, &reference, &blob)?;
        }
        txn.commit().map_err(|e| e.to_string())?;
        Ok(outcome)
    })();
    match result {
        Ok(outcome) => {
            for id in outcome.removed { let _ = secrets::delete_secret(&app, &secrets::broker_reference(&id)); }
            Ok(outcome.created)
        }
        Err(error) => {
            // The transaction has rolled back. Restore credentials as well,
            // including removing entries created for uncommitted connections.
            let mut restore_failed = false;
            for (reference, previous) in touched.into_iter().rev() {
                let restored = match previous {
                    Some(blob) => secrets::set_secret(&app, &reference, &blob),
                    None => secrets::delete_secret(&app, &reference),
                };
                restore_failed |= restored.is_err();
            }
            if restore_failed { Err(format!("{error} Accounts were rolled back, but some device credentials could not be restored. Re-enter your SnapTrade keys and retry discovery.")) }
            else { Err(error) }
        }
    }
}
