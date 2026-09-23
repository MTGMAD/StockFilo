use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Portfolio {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub is_starred: i64,
    pub created_at: i64,
    /// 'manual' for hand-maintained portfolios, otherwise the provider id
    /// ('alpaca'). Existing rows default to 'manual' via migration V14.
    pub source: String,
    /// Set only for broker-linked portfolios.
    pub broker_account_id: Option<i64>,
    /// When a spreadsheet/Ameriprise import last completed for this
    /// portfolio. Null until the first one runs.
    pub last_import_at: Option<i64>,
}

#[tauri::command]
pub fn db_list_portfolios(state: State<'_, DbManager>) -> Result<Vec<Portfolio>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, sort_order, is_starred, created_at, source, broker_account_id, last_import_at \
             FROM portfolios ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Portfolio {
                id: r.get(0)?,
                name: r.get(1)?,
                sort_order: r.get(2)?,
                is_starred: r.get(3)?,
                created_at: r.get(4)?,
                source: r.get(5)?,
                broker_account_id: r.get(6)?,
                last_import_at: r.get(7)?,
            })
        })?;
        rows.collect()
    })
}

/// Stamps `now` as the portfolio's last successful import time. Called once
/// per import run, regardless of how many rows it added — a re-import that
/// found nothing new still counts as "an import happened".
#[tauri::command]
pub fn db_touch_portfolio_import(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        conn.execute(
            "UPDATE portfolios SET last_import_at = ?1 WHERE id = ?2",
            params![now, portfolio_id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_create_portfolio(name: String, state: State<'_, DbManager>) -> Result<i64, String> {
    state.with_conn(|conn| {
        let now = now_secs();
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM portfolios",
            [],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO portfolios (name, sort_order, is_starred, created_at) VALUES (?1, ?2, 0, ?3)",
            params![name, next_order, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

#[tauri::command]
pub fn db_rename_portfolio(id: i64, name: String, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("UPDATE portfolios SET name = ?1 WHERE id = ?2", params![name, id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_delete_portfolio(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        // A linked portfolio is owned by its connection. Deleting it here would
        // leave the connection pointing at nothing, so disconnecting has to go
        // through Settings, which also clears the stored credentials.
        let source: Option<String> = conn
            .query_row("SELECT source FROM portfolios WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?;
        if let Some(s) = source.as_deref() {
            if s != "manual" {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some(
                        "This portfolio mirrors a brokerage account. Disconnect it in Settings → Brokerage Accounts to remove it."
                            .to_string(),
                    ),
                ));
            }
        }

        conn.execute("DELETE FROM favorites WHERE portfolio_id = ?1", params![id])?;
        conn.execute("DELETE FROM purchases WHERE portfolio_id = ?1", params![id])?;
        conn.execute("DELETE FROM sales WHERE portfolio_id = ?1", params![id])?;
        conn.execute("DELETE FROM cash_events WHERE portfolio_id = ?1", params![id])?;
        conn.execute("DELETE FROM portfolios WHERE id = ?1", params![id])?;
        // Clean up orphaned stock cache entries
        conn.execute(
            "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM purchases) \
             AND ticker NOT IN (SELECT ticker FROM watchlist) \
             AND ticker NOT IN (SELECT ticker FROM broker_positions WHERE ticker IS NOT NULL)",
            [],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_star_portfolio(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("UPDATE portfolios SET is_starred = 0", [])?;
        conn.execute("UPDATE portfolios SET is_starred = 1 WHERE id = ?1", params![id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_reorder_portfolios(ids: Vec<i64>, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE portfolios SET sort_order = ?1 WHERE id = ?2",
                params![i as i64, id],
            )?;
        }
        Ok(())
    })
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
