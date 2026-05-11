use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Stock {
    pub ticker: String,
    pub name: Option<String>,
    pub last_price: Option<f64>,
    pub last_fetched_at: Option<i64>,
    pub quote_type: Option<String>,
    pub daily_change_pct: Option<f64>,
    pub target_mean_price: Option<f64>,
    pub post_market_price: Option<f64>,
    pub post_market_change_pct: Option<f64>,
    pub pre_market_price: Option<f64>,
    pub pre_market_change_pct: Option<f64>,
    pub market_state: Option<String>,
}

#[tauri::command]
pub fn db_get_cached_stocks(state: State<'_, DbManager>) -> Result<Vec<Stock>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT ticker, name, last_price, last_fetched_at, quote_type, daily_change_pct, \
             target_mean_price, post_market_price, post_market_change_pct, \
             pre_market_price, pre_market_change_pct, market_state FROM stocks",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Stock {
                ticker: r.get(0)?,
                name: r.get(1)?,
                last_price: r.get(2)?,
                last_fetched_at: r.get(3)?,
                quote_type: r.get(4)?,
                daily_change_pct: r.get(5)?,
                target_mean_price: r.get(6)?,
                post_market_price: r.get(7)?,
                post_market_change_pct: r.get(8)?,
                pre_market_price: r.get(9)?,
                pre_market_change_pct: r.get(10)?,
                market_state: r.get(11)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn db_upsert_stock(
    ticker: String,
    name: Option<String>,
    last_price: Option<f64>,
    quote_type: Option<String>,
    daily_change_pct: Option<f64>,
    target_mean_price: Option<f64>,
    post_market_price: Option<f64>,
    post_market_change_pct: Option<f64>,
    pre_market_price: Option<f64>,
    pre_market_change_pct: Option<f64>,
    market_state: Option<String>,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        let now = now_secs();
        conn.execute(
            "INSERT INTO stocks (ticker, name, last_price, last_fetched_at, quote_type, \
             daily_change_pct, target_mean_price, post_market_price, post_market_change_pct, \
             pre_market_price, pre_market_change_pct, market_state) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) \
             ON CONFLICT(ticker) DO UPDATE SET \
               name                  = excluded.name, \
               last_price            = excluded.last_price, \
               last_fetched_at       = excluded.last_fetched_at, \
               quote_type            = COALESCE(excluded.quote_type, stocks.quote_type), \
               daily_change_pct      = excluded.daily_change_pct, \
               target_mean_price     = excluded.target_mean_price, \
               post_market_price     = excluded.post_market_price, \
               post_market_change_pct = excluded.post_market_change_pct, \
               pre_market_price      = excluded.pre_market_price, \
               pre_market_change_pct = excluded.pre_market_change_pct, \
               market_state          = excluded.market_state",
            params![
                ticker.to_uppercase(),
                name,
                last_price,
                now,
                quote_type,
                daily_change_pct,
                target_mean_price,
                post_market_price,
                post_market_change_pct,
                pre_market_price,
                pre_market_change_pct,
                market_state,
            ],
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
