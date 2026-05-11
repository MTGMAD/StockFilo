use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Purchase {
    pub id: i64,
    pub ticker: String,
    pub shares: f64,
    pub price_per_share: f64,
    pub purchased_at: String,
    pub created_at: i64,
    pub portfolio_id: i64,
}

#[tauri::command]
pub fn db_list_purchases(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<Purchase>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, ticker, shares, price_per_share, purchased_at, created_at, portfolio_id \
             FROM purchases WHERE portfolio_id = ?1 ORDER BY purchased_at DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![portfolio_id], |r| {
            Ok(Purchase {
                id: r.get(0)?,
                ticker: r.get(1)?,
                shares: r.get(2)?,
                price_per_share: r.get(3)?,
                purchased_at: r.get(4)?,
                created_at: r.get(5)?,
                portfolio_id: r.get(6)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub fn db_add_purchase(
    portfolio_id: i64,
    ticker: String,
    shares: f64,
    price_per_share: f64,
    purchased_at: String,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        let now = now_secs();
        let t = ticker.to_uppercase();
        conn.execute(
            "INSERT INTO purchases (ticker, shares, price_per_share, purchased_at, created_at, portfolio_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![t, shares, price_per_share, purchased_at, now, portfolio_id],
        )?;
        conn.execute("INSERT OR IGNORE INTO stocks (ticker) VALUES (?1)", params![t])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_update_purchase(
    id: i64,
    ticker: String,
    shares: f64,
    price_per_share: f64,
    purchased_at: String,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute(
            "UPDATE purchases SET ticker = ?1, shares = ?2, price_per_share = ?3, purchased_at = ?4 \
             WHERE id = ?5",
            params![ticker.to_uppercase(), shares, price_per_share, purchased_at, id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_delete_purchase(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM purchases WHERE id = ?1", params![id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_hint_stock_quote_type(
    ticker: String,
    quote_type: String,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute(
            "UPDATE stocks SET quote_type = ?1 WHERE ticker = ?2 AND (quote_type IS NULL OR quote_type = '')",
            params![quote_type, ticker.to_uppercase()],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_clear_all_purchases(state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM purchases", [])?;
        conn.execute(
            "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM watchlist)",
            [],
        )?;
        conn.execute("DELETE FROM favorites", [])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_clear_portfolio_purchases(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute(
            "DELETE FROM purchases WHERE portfolio_id = ?1",
            params![portfolio_id],
        )?;
        conn.execute(
            "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM purchases) \
             AND ticker NOT IN (SELECT ticker FROM watchlist)",
            [],
        )?;
        conn.execute(
            "DELETE FROM favorites WHERE portfolio_id = ?1",
            params![portfolio_id],
        )?;
        Ok(())
    })
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
