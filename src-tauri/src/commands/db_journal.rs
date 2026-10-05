use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct JournalNote {
    pub portfolio_id: i64,
    pub trade_key: String,
    pub reflection: Option<String>,
    pub lesson: Option<String>,
    pub tags: Option<String>,
    pub updated_at: i64,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn list_notes(conn: &Connection, portfolio_id: i64) -> rusqlite::Result<Vec<JournalNote>> {
    let mut stmt = conn.prepare(
        "SELECT portfolio_id, trade_key, reflection, lesson, tags, updated_at \
         FROM journal_notes WHERE portfolio_id = ?1",
    )?;
    let rows = stmt.query_map(params![portfolio_id], |r| {
        Ok(JournalNote {
            portfolio_id: r.get(0)?,
            trade_key: r.get(1)?,
            reflection: r.get(2)?,
            lesson: r.get(3)?,
            tags: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

/// Upsert a note; a note with nothing left in it is deleted rather than
/// stored as an empty row.
fn set_note(
    conn: &Connection,
    portfolio_id: i64,
    trade_key: &str,
    reflection: Option<String>,
    lesson: Option<String>,
    tags: Option<String>,
) -> rusqlite::Result<()> {
    let (reflection, lesson, tags) = (clean(reflection), clean(lesson), clean(tags));
    if reflection.is_none() && lesson.is_none() && tags.is_none() {
        conn.execute(
            "DELETE FROM journal_notes WHERE portfolio_id = ?1 AND trade_key = ?2",
            params![portfolio_id, trade_key],
        )?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO journal_notes (portfolio_id, trade_key, reflection, lesson, tags, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(portfolio_id, trade_key) DO UPDATE SET \
         reflection = excluded.reflection, lesson = excluded.lesson, \
         tags = excluded.tags, updated_at = excluded.updated_at",
        params![portfolio_id, trade_key, reflection, lesson, tags, now_secs()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn db_list_journal_notes(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<JournalNote>, String> {
    state.with_conn(|conn| list_notes(conn, portfolio_id))
}

#[tauri::command]
pub fn db_set_journal_note(
    portfolio_id: i64,
    trade_key: String,
    reflection: Option<String>,
    lesson: Option<String>,
    tags: Option<String>,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_conn(|conn| set_note(conn, portfolio_id, &trade_key, reflection, lesson, tags))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE journal_notes (portfolio_id INTEGER NOT NULL, trade_key TEXT NOT NULL, \
             reflection TEXT, lesson TEXT, tags TEXT, updated_at INTEGER NOT NULL, \
             PRIMARY KEY (portfolio_id, trade_key));",
        )
        .unwrap();
        c
    }

    #[test]
    fn upsert_then_clear() {
        let c = conn();
        set_note(&c, 1, "TNON|2026-09-10|0", Some(" good ".into()), None, Some("gap".into())).unwrap();
        set_note(&c, 1, "TNON|2026-09-10|0", Some("better".into()), Some("wait".into()), None).unwrap();
        let n = list_notes(&c, 1).unwrap();
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].reflection.as_deref(), Some("better"));
        assert_eq!(n[0].tags, None);
        set_note(&c, 1, "TNON|2026-09-10|0", Some("  ".into()), None, None).unwrap();
        assert!(list_notes(&c, 1).unwrap().is_empty());
    }
}
