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
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::brokers::snaptrade::{self, client::SnapTradeClient, map};
use crate::brokers::store;
use crate::commands::config::load_config;
use crate::db::manager::DbManager;
use crate::secrets;

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

/// Find every brokerage authorization SnapTrade now reports that Stockfolio
/// has no connection row for yet, and create one for each — its accounts
/// start hidden, so nothing appears in the sidebar until the person opts in
/// via `broker_set_account_visible`. Safe to call any time, not just right
/// after the portal round-trip: it is also "check for new brokerages."
///
/// Returns how many new authorizations were found.
#[tauri::command]
pub async fn snaptrade_sync_authorizations(
    app: AppHandle,
    state: State<'_, DbManager>,
) -> Result<usize, String> {
    let keys = load_app_keys(&app)?;
    let client = SnapTradeClient::new(&keys.client_id, &keys.consumer_key)?;
    let accounts = client.list_accounts().await?;

    let mut by_authorization: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for acct in &accounts {
        if let Some(auth_id) = map::authorization_id(acct) {
            by_authorization.entry(auth_id).or_default().push(acct.clone());
        }
    }

    // An authorization already has a connection row if some existing
    // snaptrade row's stored credentials name it — that field is not a
    // database column (see `brokers::snaptrade`'s module doc for why), so
    // this reads it back out of the keychain rather than querying for it.
    let connection_ids: Vec<String> = state.with_conn(|conn| {
        let mut stmt =
            conn.prepare("SELECT id FROM broker_connections WHERE provider = 'snaptrade'")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<_>>()
    })?;

    let existing: HashSet<String> = connection_ids
        .into_iter()
        .filter_map(|connection_id| {
            secrets::get_secret(&app, &secrets::broker_reference(&connection_id))
                .ok()
                .flatten()
                .and_then(|blob| {
                    serde_json::from_str::<crate::brokers::types::Credentials>(&blob).ok()
                })
                .and_then(|c| c.get("authorization_id").cloned())
        })
        .collect();

    let device_id = load_config(&app).device_id;
    let mut created = 0usize;

    for (auth_id, raw_accounts) in by_authorization {
        if existing.contains(&auth_id) {
            continue;
        }

        let institution = raw_accounts
            .first()
            .and_then(map::institution_name)
            .unwrap_or_else(|| "SnapTrade".to_string());

        let connection_id = Uuid::new_v4().to_string();
        let reference = secrets::broker_reference(&connection_id);
        let creds = snaptrade::credentials(&keys.client_id, &keys.consumer_key, &auth_id);
        let blob = serde_json::to_string(&creds).map_err(|e| e.to_string())?;
        secrets::set_secret(&app, &reference, &blob)?;

        let result = state.with_txn(|conn| {
            conn.execute(
                "INSERT INTO broker_connections \
                   (id, provider, environment, label, credential_ref, device_id, created_at) \
                 VALUES (?1, 'snaptrade', ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    connection_id,
                    snaptrade::ENVIRONMENT,
                    format!("{institution} (via SnapTrade)"),
                    reference,
                    device_id,
                    store::now_secs(),
                ],
            )?;

            for raw in &raw_accounts {
                if let Some(remote) = map::account(raw) {
                    // Hidden by default — a person opts each one in.
                    store::upsert_account(conn, &connection_id, &remote, false)?;
                }
            }
            Ok(())
        });

        // Don't leave a keychain entry behind if the database write failed.
        if let Err(e) = result {
            let _ = secrets::delete_secret(&app, &reference);
            return Err(e.to_string());
        }
        created += 1;
    }

    Ok(created)
}
