use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

// ── Watchlist structs ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Watchlist {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WatchlistItem {
    pub id: i64,
    pub ticker: String,
    pub watch_price: Option<f64>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WatchlistItemFull {
    pub id: i64,
    pub ticker: String,
    pub watch_price: Option<f64>,
    pub created_at: i64,
    pub watchlist_id: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Favorite {
    pub id: i64,
    pub ticker: String,
    pub sort_order: i64,
    pub portfolio_id: i64,
}

// ── Watchlist commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_watchlists(state: State<'_, DbManager>) -> Result<Vec<Watchlist>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, sort_order, created_at FROM watchlists \
             ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Watchlist {
                id: r.get(0)?,
                name: r.get(1)?,
                sort_order: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub fn db_create_watchlist(name: String, state: State<'_, DbManager>) -> Result<i64, String> {
    state.with_conn(|conn| {
        let now = now_secs();
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM watchlists",
            [],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO watchlists (name, sort_order, created_at) VALUES (?1, ?2, ?3)",
            params![name, next_order, now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

#[tauri::command]
pub fn db_rename_watchlist(id: i64, name: String, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("UPDATE watchlists SET name = ?1 WHERE id = ?2", params![name, id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_delete_watchlist(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM watchlist WHERE watchlist_id = ?1", params![id])?;
        conn.execute("DELETE FROM watchlists WHERE id = ?1", params![id])?;
        conn.execute(
            "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM purchases) \
             AND ticker NOT IN (SELECT ticker FROM watchlist)",
            [],
        )?;
        Ok(())
    })
}

// ── Watchlist item commands ───────────────────────────────────────────────

#[tauri::command]
pub fn db_list_watchlist_items(
    watchlist_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<WatchlistItem>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, ticker, watch_price, created_at FROM watchlist \
             WHERE watchlist_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![watchlist_id], |r| {
            Ok(WatchlistItem {
                id: r.get(0)?,
                ticker: r.get(1)?,
                watch_price: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub fn db_list_all_watchlist_items(
    state: State<'_, DbManager>,
) -> Result<Vec<WatchlistItemFull>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, ticker, watch_price, created_at, watchlist_id FROM watchlist \
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(WatchlistItemFull {
                id: r.get(0)?,
                ticker: r.get(1)?,
                watch_price: r.get(2)?,
                created_at: r.get(3)?,
                watchlist_id: r.get(4)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub fn db_add_to_watchlist(
    ticker: String,
    watchlist_id: i64,
    watch_price: Option<f64>,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        let now = now_secs();
        let t = ticker.to_uppercase();
        conn.execute(
            "INSERT OR IGNORE INTO watchlist (ticker, watch_price, created_at, watchlist_id) \
             VALUES (?1, ?2, ?3, ?4)",
            params![t, watch_price, now, watchlist_id],
        )?;
        conn.execute("INSERT OR IGNORE INTO stocks (ticker) VALUES (?1)", params![t])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_remove_from_watchlist(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute("DELETE FROM watchlist WHERE id = ?1", params![id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_set_watch_price(
    id: i64,
    watch_price: f64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute(
            "UPDATE watchlist SET watch_price = ?1 \
             WHERE id = ?2 AND (watch_price IS NULL OR watch_price <= 0)",
            params![watch_price, id],
        )?;
        Ok(())
    })
}

// ── Favorites commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_favorites(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<Favorite>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, ticker, sort_order, portfolio_id FROM favorites \
             WHERE portfolio_id = ?1 ORDER BY sort_order ASC",
        )?;
        let rows = stmt.query_map(params![portfolio_id], |r| {
            Ok(Favorite {
                id: r.get(0)?,
                ticker: r.get(1)?,
                sort_order: r.get(2)?,
                portfolio_id: r.get(3)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub fn db_add_favorite(
    ticker: String,
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        let t = ticker.to_uppercase();
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM favorites WHERE portfolio_id = ?1",
            params![portfolio_id],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO favorites (ticker, sort_order, portfolio_id) VALUES (?1, ?2, ?3)",
            params![t, next_order, portfolio_id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_remove_favorite(
    ticker: String,
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        conn.execute(
            "DELETE FROM favorites WHERE ticker = ?1 AND portfolio_id = ?2",
            params![ticker.to_uppercase(), portfolio_id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_reorder_favorites(
    tickers: Vec<String>,
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| {
        for (i, ticker) in tickers.iter().enumerate() {
            conn.execute(
                "UPDATE favorites SET sort_order = ?1 WHERE ticker = ?2 AND portfolio_id = ?3",
                params![i as i64, ticker.to_uppercase(), portfolio_id],
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
