//! Brokerage commands.
//!
//! Nothing here names a provider — the roster lives in `brokers::Provider`, and
//! the UI drives everything from `broker_list_providers`.
//!
//! Credentials never appear in any return value. They travel in exactly once,
//! on connect, and thereafter live only in the OS keychain (`secrets.rs`).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::brokers::error::BrokerError;
use crate::brokers::store::{self, StoredPosition, StoredTransaction};
use crate::brokers::types::{Credentials, ProviderDescriptor, RemoteAccount};
use crate::brokers::Provider;
use crate::commands::config::load_config;
use crate::db::manager::DbManager;
use crate::secrets;

// ── DTOs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerAccountInfo {
    pub id: i64,
    pub provider_account_id: String,
    pub account_mask: Option<String>,
    pub currency: String,
    pub equity: Option<f64>,
    pub cash: Option<f64>,
    pub snapshot_at: Option<i64>,
    pub portfolio_id: Option<i64>,
    pub portfolio_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConnectionInfo {
    pub id: String,
    pub provider: String,
    pub provider_name: String,
    pub environment: String,
    /// Display label for the account type, e.g. "Margin" or "Paper".
    pub environment_label: String,
    /// "margin" | "paper" | "cash" — drives the chip colour in the UI.
    pub environment_kind: String,
    pub label: String,
    pub created_at: i64,
    pub last_synced_at: Option<i64>,
    pub last_sync_status: Option<String>,
    pub disabled: bool,
    /// False when the database arrived from another device via sync and the
    /// keychain here holds nothing. The UI must show this as "add credentials
    /// on this device", never as an error.
    pub has_credentials: bool,
    pub device_id: Option<String>,
    pub accounts: Vec<BrokerAccountInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerSyncResult {
    pub connection_id: String,
    pub success: bool,
    pub message: String,
    pub synced_at: i64,
    pub positions: usize,
    pub new_transactions: usize,
}

// ── Provider catalogue ─────────────────────────────────────────────────────

#[tauri::command]
pub fn broker_list_providers() -> Vec<ProviderDescriptor> {
    Provider::all_descriptors()
}

// ── Connect ────────────────────────────────────────────────────────────────

/// Verify credentials without storing anything.
#[tauri::command]
pub async fn broker_test_connection(
    provider: String,
    environment: String,
    credentials: Credentials,
) -> Result<Vec<RemoteAccount>, String> {
    let p = Provider::from_id(&provider)?;
    Ok(p.verify(&credentials, &environment).await?)
}

/// Verify, store the secret in the keychain, and create the connection plus a
/// portfolio per account.
#[tauri::command]
pub async fn broker_save_connection(
    app: AppHandle,
    provider: String,
    environment: String,
    label: Option<String>,
    credentials: Credentials,
    state: State<'_, DbManager>,
) -> Result<String, String> {
    let p = Provider::from_id(&provider)?;
    let descriptor = p.descriptor();

    // Never store credentials that do not work.
    let accounts = p.verify(&credentials, &environment).await?;
    if accounts.is_empty() {
        return Err("The brokerage reported no accounts for these credentials.".into());
    }

    let connection_id = Uuid::new_v4().to_string();
    let reference = secrets::broker_reference(&connection_id);

    let blob = serde_json::to_string(&credentials).map_err(|e| e.to_string())?;
    secrets::set_secret(&app, &reference, &blob)?;

    let device_id = load_config(&app).device_id;
    let display_label = label.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| {
        format!("{} — {}", descriptor.name, env_label(&provider, &environment))
    });

    let result = state.with_txn(|conn| {
        conn.execute(
            "INSERT INTO broker_connections \
               (id, provider, environment, label, credential_ref, device_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                connection_id,
                provider,
                environment,
                display_label,
                reference,
                device_id,
                store::now_secs()
            ],
        )?;

        for acct in &accounts {
            let acct_id = store::upsert_account(conn, &connection_id, acct)?;
            let name =
                portfolio_name(&provider, &descriptor.name, &environment, acct.mask.as_deref());
            store::ensure_portfolio(conn, acct_id, &provider, &name)?;
        }

        Ok(connection_id.clone())
    });

    // Don't leave a keychain entry behind if the database write failed.
    if result.is_err() {
        let _ = secrets::delete_secret(&app, &reference);
    }

    result
}

/// Display label for an account type, as declared by its provider.
///
/// Falls back to the raw id so an unknown value still renders as something
/// rather than vanishing.
fn env_label(provider: &str, environment: &str) -> String {
    Provider::from_id(provider)
        .ok()
        .and_then(|p| {
            p.descriptor()
                .account_types
                .into_iter()
                .find(|a| a.id == environment)
                .map(|a| a.label)
        })
        .unwrap_or_else(|| environment.to_string())
}

/// Colour key for an account type. "unknown" renders unstyled rather than
/// picking a colour that might imply the wrong thing about real money.
fn env_kind(provider: &str, environment: &str) -> String {
    Provider::from_id(provider)
        .ok()
        .and_then(|p| {
            p.descriptor()
                .account_types
                .into_iter()
                .find(|a| a.id == environment)
                .map(|a| a.kind)
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn portfolio_name(
    provider: &str,
    provider_name: &str,
    environment: &str,
    mask: Option<&str>,
) -> String {
    let kind = env_label(provider, environment);
    match mask {
        Some(m) => format!("{provider_name} — {kind} ({m})"),
        None => format!("{provider_name} — {kind}"),
    }
}

// ── Read ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn broker_list_connections(
    app: AppHandle,
    state: State<'_, DbManager>,
) -> Result<Vec<BrokerConnectionInfo>, String> {
    let mut connections = state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, provider, environment, label, created_at, last_synced_at, \
                    last_sync_status, disabled, device_id \
             FROM broker_connections ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let provider: String = r.get(1)?;
            let provider_name = Provider::from_id(&provider)
                .map(|p| p.descriptor().name)
                .unwrap_or_else(|_| provider.clone());
            let environment: String = r.get(2)?;
            let environment_label = env_label(&provider, &environment);
            let environment_kind = env_kind(&provider, &environment);
            Ok(BrokerConnectionInfo {
                id: r.get(0)?,
                provider,
                provider_name,
                environment,
                environment_label,
                environment_kind,
                label: r.get(3)?,
                created_at: r.get(4)?,
                last_synced_at: r.get(5)?,
                last_sync_status: r.get(6)?,
                disabled: r.get::<_, i64>(7)? != 0,
                has_credentials: false, // filled in below
                device_id: r.get(8)?,
                accounts: Vec::new(),
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;

    for c in &mut connections {
        c.has_credentials = secrets::has_secret(&app, &secrets::broker_reference(&c.id));
        c.accounts = state.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT a.id, a.provider_account_id, a.account_mask, a.currency, a.equity, \
                        a.cash, a.snapshot_at, p.id, p.name \
                 FROM broker_accounts a \
                 LEFT JOIN portfolios p ON p.broker_account_id = a.id \
                 WHERE a.connection_id = ?1 ORDER BY a.id ASC",
            )?;
            let rows = stmt.query_map(rusqlite::params![c.id], |r| {
                Ok(BrokerAccountInfo {
                    id: r.get(0)?,
                    provider_account_id: r.get(1)?,
                    account_mask: r.get(2)?,
                    currency: r.get(3)?,
                    equity: r.get(4)?,
                    cash: r.get(5)?,
                    snapshot_at: r.get(6)?,
                    portfolio_id: r.get(7)?,
                    portfolio_name: r.get(8)?,
                })
            })?;
            rows.collect()
        })?;
    }

    Ok(connections)
}

#[tauri::command]
pub fn broker_list_positions(
    broker_account_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<StoredPosition>, String> {
    state.with_conn(|conn| store::list_positions(conn, broker_account_id))
}

#[tauri::command]
pub fn broker_list_transactions(
    broker_account_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<StoredTransaction>, String> {
    state.with_conn(|conn| store::list_transactions(conn, broker_account_id))
}

// ── Update / delete ────────────────────────────────────────────────────────

#[tauri::command]
pub fn broker_update_connection(
    id: String,
    label: Option<String>,
    disabled: Option<bool>,
    auto_sync_minutes: Option<u32>,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        if let Some(l) = &label {
            conn.execute(
                "UPDATE broker_connections SET label = ?1 WHERE id = ?2",
                rusqlite::params![l, id],
            )?;
        }
        if let Some(d) = disabled {
            conn.execute(
                "UPDATE broker_connections SET disabled = ?1 WHERE id = ?2",
                rusqlite::params![if d { 1 } else { 0 }, id],
            )?;
        }
        if let Some(m) = auto_sync_minutes {
            conn.execute(
                "UPDATE broker_connections SET auto_sync_minutes = ?1 WHERE id = ?2",
                rusqlite::params![m, id],
            )?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn broker_delete_connection(
    app: AppHandle,
    id: String,
    keep_portfolio: bool,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_txn(|conn| store::delete_connection(conn, &id, keep_portfolio))?;
    let _ = secrets::delete_secret(&app, &secrets::broker_reference(&id));
    Ok(())
}

// ── Sync ───────────────────────────────────────────────────────────────────

fn load_credentials(app: &AppHandle, connection_id: &str) -> Result<Credentials, BrokerError> {
    let reference = secrets::broker_reference(connection_id);
    let blob = secrets::get_secret(app, &reference)
        .map_err(BrokerError::Db)?
        .ok_or(BrokerError::NoCredentials)?;
    serde_json::from_str(&blob).map_err(|e| BrokerError::Parse(e.to_string()))
}

/// Refresh one connection: positions always, activity history when the provider
/// supports it.
#[tauri::command]
pub async fn broker_sync_connection(
    app: AppHandle,
    connection_id: String,
    state: State<'_, DbManager>,
) -> Result<BrokerSyncResult, String> {
    let row = state.with_conn(|conn| {
        conn.query_row(
            "SELECT provider, environment FROM broker_connections WHERE id = ?1",
            rusqlite::params![connection_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
    })?;
    let (provider, environment) = row;

    let outcome =
        sync_one(&app, &state, &connection_id, &provider, &environment).await;

    let synced_at = store::now_secs();
    let status = match &outcome {
        Ok(_) => "ok".to_string(),
        Err(e) => e.to_string(),
    };
    let _ = state.with_conn(|conn| {
        conn.execute(
            "UPDATE broker_connections SET last_synced_at = ?1, last_sync_status = ?2 WHERE id = ?3",
            rusqlite::params![synced_at, status, connection_id],
        )
    });

    match outcome {
        Ok((positions, new_transactions)) => Ok(BrokerSyncResult {
            connection_id,
            success: true,
            message: format!("{positions} positions, {new_transactions} new transactions"),
            synced_at,
            positions,
            new_transactions,
        }),
        Err(e) => Err(e.to_string()),
    }
}

async fn sync_one(
    app: &AppHandle,
    state: &State<'_, DbManager>,
    connection_id: &str,
    provider: &str,
    environment: &str,
) -> Result<(usize, usize), BrokerError> {
    let p = Provider::from_id(provider)?;
    let descriptor = p.descriptor();
    let creds = load_credentials(app, connection_id)?;

    // Accounts first — they anchor everything else.
    let accounts = p.verify(&creds, environment).await?;

    let mut total_positions = 0usize;
    let mut total_new_tx = 0usize;

    for acct in &accounts {
        let positions = if descriptor.supports_positions {
            p.positions(&creds, environment).await?
        } else {
            Vec::new()
        };

        let acct_id = state
            .with_txn(|conn| {
                let id = store::upsert_account(conn, connection_id, acct)?;
                let name =
                    portfolio_name(provider, &descriptor.name, environment, acct.mask.as_deref());
                store::ensure_portfolio(conn, id, provider, &name)?;
                store::replace_positions(conn, id, &positions)?;
                Ok(id)
            })
            .map_err(BrokerError::Db)?;

        total_positions += positions.len();

        if descriptor.supports_activities {
            // Re-fetch from the last stored day rather than the day after, so a
            // fill recorded later on a day already seen is not missed. The
            // unique index makes the overlap free.
            let since = state
                .with_conn(|conn| store::latest_activity_date(conn, acct_id))
                .map_err(BrokerError::Db)?;

            let activities = p
                .activities(&creds, environment, since.as_deref())
                .await?;

            let new_tx = state
                .with_txn(|conn| store::append_transactions(conn, acct_id, &activities))
                .map_err(BrokerError::Db)?;
            total_new_tx += new_tx;
        }
    }

    Ok((total_positions, total_new_tx))
}

/// Refresh every enabled connection that has credentials on this device.
#[tauri::command]
pub async fn broker_sync_all(
    app: AppHandle,
    state: State<'_, DbManager>,
) -> Result<Vec<BrokerSyncResult>, String> {
    let connections = state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, provider, environment FROM broker_connections WHERE disabled = 0",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;

    let mut out = Vec::new();
    for (id, provider, environment) in connections {
        // A connection synced from another device has no local credentials.
        // That is expected, not a failure — skip it silently.
        if !secrets::has_secret(&app, &secrets::broker_reference(&id)) {
            continue;
        }

        let outcome = sync_one(&app, &state, &id, &provider, &environment).await;
        let synced_at = store::now_secs();
        let status = match &outcome {
            Ok(_) => "ok".to_string(),
            Err(e) => e.to_string(),
        };
        let _ = state.with_conn(|conn| {
            conn.execute(
                "UPDATE broker_connections SET last_synced_at = ?1, last_sync_status = ?2 \
                 WHERE id = ?3",
                rusqlite::params![synced_at, status, id],
            )
        });

        out.push(match outcome {
            Ok((positions, new_transactions)) => BrokerSyncResult {
                connection_id: id,
                success: true,
                message: format!("{positions} positions, {new_transactions} new transactions"),
                synced_at,
                positions,
                new_transactions,
            },
            Err(e) => BrokerSyncResult {
                connection_id: id,
                success: false,
                message: e.to_string(),
                synced_at,
                positions: 0,
                new_transactions: 0,
            },
        });
    }

    Ok(out)
}
