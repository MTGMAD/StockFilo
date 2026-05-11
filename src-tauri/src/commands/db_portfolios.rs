use rusqlite::params;
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
}

#[tauri::command]
pub fn db_list_portfolios(state: State<'_, DbManager>) -> Result<Vec<Portfolio>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, sort_order, is_starred, created_at \
             FROM portfolios ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Portfolio {
                id: r.get(0)?,
                name: r.get(1)?,
                sort_order: r.get(2)?,
                is_starred: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        rows.collect()
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
        conn.execute("DELETE FROM favorites WHERE portfolio_id = ?1", params![id])?;
        conn.execute("DELETE FROM purchases WHERE portfolio_id = ?1", params![id])?;
        conn.execute("DELETE FROM portfolios WHERE id = ?1", params![id])?;
        // Clean up orphaned stock cache entries
        conn.execute(
            "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM purchases) \
             AND ticker NOT IN (SELECT ticker FROM watchlist)",
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
