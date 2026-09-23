use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

/// Reject writes aimed at a broker-linked portfolio.
///
/// Same rationale as the identical guard in `db_purchases.rs`: broker
/// portfolios mirror what the brokerage reports, so a hand-entered cash event
/// there would be silently invisible — stored, but never shown — which looks
/// exactly like data loss.
fn ensure_manual_portfolio(conn: &rusqlite::Connection, portfolio_id: i64) -> rusqlite::Result<()> {
    let source: Option<String> = conn
        .query_row(
            "SELECT source FROM portfolios WHERE id = ?1",
            params![portfolio_id],
            |r| r.get(0),
        )
        .optional()?;

    match source.as_deref() {
        Some("manual") | None => Ok(()),
        Some(_) => Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
            Some(
                "This portfolio mirrors a brokerage account, so cash events cannot be added to it by hand."
                    .to_string(),
            ),
        )),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CashEvent {
    pub id: i64,
    pub portfolio_id: i64,
    /// "dividend" | "fee".
    pub kind: String,
    pub ticker: Option<String>,
    /// Signed: dividends positive, fees negative. A portfolio's cash balance
    /// is just `SUM(amount)` — see the V18 migration doc comment for why.
    pub amount: f64,
    pub occurred_at: String,
    pub note: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub fn db_list_cash_events(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<CashEvent>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, portfolio_id, kind, ticker, amount, occurred_at, note, created_at \
             FROM cash_events WHERE portfolio_id = ?1 ORDER BY occurred_at DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![portfolio_id], |r| {
            Ok(CashEvent {
                id: r.get(0)?,
                portfolio_id: r.get(1)?,
                kind: r.get(2)?,
                ticker: r.get(3)?,
                amount: r.get(4)?,
                occurred_at: r.get(5)?,
                note: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub fn db_add_cash_event(
    portfolio_id: i64,
    kind: String,
    ticker: Option<String>,
    amount: f64,
    occurred_at: String,
    note: Option<String>,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        ensure_manual_portfolio(conn, portfolio_id)?;
        let now = now_secs();
        let t = ticker.map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty());
        conn.execute(
            "INSERT INTO cash_events (portfolio_id, kind, ticker, amount, occurred_at, note, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![portfolio_id, kind, t, amount, occurred_at, note, now],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_update_cash_event(
    id: i64,
    kind: String,
    ticker: Option<String>,
    amount: f64,
    occurred_at: String,
    note: Option<String>,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        let t = ticker.map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty());
        conn.execute(
            "UPDATE cash_events SET kind = ?1, ticker = ?2, amount = ?3, occurred_at = ?4, note = ?5 \
             WHERE id = ?6",
            params![kind, t, amount, occurred_at, note, id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_delete_cash_event(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM cash_events WHERE id = ?1", params![id])?;
        Ok(())
    })
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
