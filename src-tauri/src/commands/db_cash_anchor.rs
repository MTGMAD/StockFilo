use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

/// A manual portfolio's real cash balance on one day (see migration V27).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct CashAnchor {
    pub portfolio_id: i64,
    pub as_of: String,
    pub balance: f64,
    pub updated_at: i64,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn constraint_err(msg: &str) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some(msg.to_string()),
    )
}

fn get_anchor(conn: &Connection, portfolio_id: i64) -> rusqlite::Result<Option<CashAnchor>> {
    conn.query_row(
        "SELECT portfolio_id, as_of, balance, updated_at FROM cash_anchors WHERE portfolio_id = ?1",
        params![portfolio_id],
        |r| {
            Ok(CashAnchor {
                portfolio_id: r.get(0)?,
                as_of: r.get(1)?,
                balance: r.get(2)?,
                updated_at: r.get(3)?,
            })
        },
    )
    .optional()
}

/// Brokerage-linked portfolios report their own cash, so a hand-entered
/// balance there would be silently ignored — refuse it, like purchases/sales.
fn set_anchor(
    conn: &Connection,
    portfolio_id: i64,
    as_of: &str,
    balance: f64,
) -> rusqlite::Result<()> {
    if chrono::NaiveDate::parse_from_str(as_of, "%Y-%m-%d").is_err() {
        return Err(constraint_err("Date must look like YYYY-MM-DD."));
    }
    if !balance.is_finite() {
        return Err(constraint_err("Balance must be a number."));
    }
    let source: Option<String> = conn
        .query_row(
            "SELECT source FROM portfolios WHERE id = ?1",
            params![portfolio_id],
            |r| r.get(0),
        )
        .optional()?;
    match source.as_deref() {
        Some("manual") => {}
        Some(_) => {
            return Err(constraint_err(
                "This portfolio mirrors a brokerage account, which reports its own cash.",
            ))
        }
        None => return Err(constraint_err("Portfolio not found.")),
    }
    conn.execute(
        "INSERT INTO cash_anchors (portfolio_id, as_of, balance, updated_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(portfolio_id) DO UPDATE SET \
         as_of = excluded.as_of, balance = excluded.balance, updated_at = excluded.updated_at",
        params![portfolio_id, as_of, balance, now_secs()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn db_get_cash_anchor(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<Option<CashAnchor>, String> {
    state.with_conn(|conn| get_anchor(conn, portfolio_id))
}

#[tauri::command]
pub fn db_set_cash_anchor(
    portfolio_id: i64,
    as_of: String,
    balance: f64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| set_anchor(conn, portfolio_id, &as_of, balance))
}

#[tauri::command]
pub fn db_clear_cash_anchor(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute(
            "DELETE FROM cash_anchors WHERE portfolio_id = ?1",
            params![portfolio_id],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE portfolios (id INTEGER PRIMARY KEY, source TEXT NOT NULL);
             INSERT INTO portfolios VALUES (1, 'manual'), (2, 'alpaca');
             CREATE TABLE cash_anchors (portfolio_id INTEGER PRIMARY KEY, as_of TEXT NOT NULL, \
             balance REAL NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        c
    }

    #[test]
    fn set_replaces_and_get_returns_it() {
        let c = conn();
        assert_eq!(get_anchor(&c, 1).unwrap(), None);
        set_anchor(&c, 1, "2026-10-06", 9515.04).unwrap();
        set_anchor(&c, 1, "2026-10-07", 100.0).unwrap();
        let a = get_anchor(&c, 1).unwrap().unwrap();
        assert_eq!((a.as_of.as_str(), a.balance), ("2026-10-07", 100.0));
    }

    #[test]
    fn rejects_broker_portfolio_bad_date_and_unknown_portfolio() {
        let c = conn();
        assert!(set_anchor(&c, 2, "2026-10-06", 1.0).is_err());
        assert!(set_anchor(&c, 1, "10/06/2026", 1.0).is_err());
        assert!(set_anchor(&c, 1, "2026-10-06", f64::NAN).is_err());
        assert!(set_anchor(&c, 99, "2026-10-06", 1.0).is_err());
        assert_eq!(get_anchor(&c, 1).unwrap(), None);
    }
}
