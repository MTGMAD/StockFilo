use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::manager::DbManager;

/// Reject writes aimed at a broker-linked portfolio.
///
/// Same rationale as the identical guard in `db_purchases.rs` and
/// `db_cash_events.rs`: broker portfolios mirror what the brokerage reports,
/// so a hand-entered sale there would be silently invisible.
fn ensure_manual_portfolio(conn: &Connection, portfolio_id: i64) -> rusqlite::Result<()> {
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
                "This portfolio mirrors a brokerage account, so sales cannot be added to it by hand."
                    .to_string(),
            ),
        )),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Sale {
    pub id: i64,
    pub portfolio_id: i64,
    pub ticker: String,
    pub shares: f64,
    pub price_per_share: f64,
    pub sold_at: String,
    pub created_at: i64,
}

fn proceeds_note(ticker: &str, shares: f64, price_per_share: f64) -> String {
    format!("Sale proceeds — {shares} sh {ticker} @ ${price_per_share:.2}")
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Pure DB logic — unit-tested directly against a Connection, independent
// of the Tauri command boundary. ─────────────────────────────────────────

fn list_sales(conn: &Connection, portfolio_id: i64) -> rusqlite::Result<Vec<Sale>> {
    let mut stmt = conn.prepare(
        "SELECT id, portfolio_id, ticker, shares, price_per_share, sold_at, created_at \
         FROM sales WHERE portfolio_id = ?1 ORDER BY sold_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![portfolio_id], |r| {
        Ok(Sale {
            id: r.get(0)?,
            portfolio_id: r.get(1)?,
            ticker: r.get(2)?,
            shares: r.get(3)?,
            price_per_share: r.get(4)?,
            sold_at: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

/// Records a sale and, in the same connection, credits its proceeds to cash
/// as a linked `cash_events` row (kind `'sale'`, `source_sale_id` pointing
/// back at the sale). Callers wrap this in a transaction (see `db_add_sale`)
/// so the two always exist or not exist together.
fn add_sale(
    conn: &Connection,
    portfolio_id: i64,
    ticker: &str,
    shares: f64,
    price_per_share: f64,
    sold_at: &str,
) -> rusqlite::Result<i64> {
    ensure_manual_portfolio(conn, portfolio_id)?;
    let now = now_secs();
    let t = ticker.trim().to_uppercase();

    conn.execute(
        "INSERT INTO sales (portfolio_id, ticker, shares, price_per_share, sold_at, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![portfolio_id, t, shares, price_per_share, sold_at, now],
    )?;
    let sale_id = conn.last_insert_rowid();

    let proceeds = shares * price_per_share;
    let note = proceeds_note(&t, shares, price_per_share);
    conn.execute(
        "INSERT INTO cash_events \
         (portfolio_id, kind, ticker, amount, occurred_at, note, created_at, source_sale_id) \
         VALUES (?1, 'sale', ?2, ?3, ?4, ?5, ?6, ?7)",
        params![portfolio_id, t, proceeds, sold_at, note, now, sale_id],
    )?;

    Ok(sale_id)
}

/// Updates a sale and its linked cash event together, so the credited
/// proceeds always match what the sale record actually says.
fn update_sale(
    conn: &Connection,
    id: i64,
    ticker: &str,
    shares: f64,
    price_per_share: f64,
    sold_at: &str,
) -> rusqlite::Result<()> {
    let t = ticker.trim().to_uppercase();

    conn.execute(
        "UPDATE sales SET ticker = ?1, shares = ?2, price_per_share = ?3, sold_at = ?4 \
         WHERE id = ?5",
        params![t, shares, price_per_share, sold_at, id],
    )?;

    let proceeds = shares * price_per_share;
    let note = proceeds_note(&t, shares, price_per_share);
    conn.execute(
        "UPDATE cash_events SET ticker = ?1, amount = ?2, occurred_at = ?3, note = ?4 \
         WHERE source_sale_id = ?5",
        params![t, proceeds, sold_at, note, id],
    )?;

    Ok(())
}

/// Deletes a sale and its linked cash event together, so proceeds never
/// outlive the sale that produced them.
fn delete_sale(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM cash_events WHERE source_sale_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM sales WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Tauri commands — thin wrappers over the pure logic above. ────────────

#[tauri::command]
pub fn db_list_sales(
    portfolio_id: i64,
    state: State<'_, DbManager>,
) -> Result<Vec<Sale>, String> {
    state.with_conn(|conn| list_sales(conn, portfolio_id))
}

#[tauri::command]
pub fn db_add_sale(
    portfolio_id: i64,
    ticker: String,
    shares: f64,
    price_per_share: f64,
    sold_at: String,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_txn(|conn| {
        add_sale(conn, portfolio_id, &ticker, shares, price_per_share, &sold_at)?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_update_sale(
    id: i64,
    ticker: String,
    shares: f64,
    price_per_share: f64,
    sold_at: String,
    state: State<'_, DbManager>,
) -> Result<(), String> {
    state.with_txn(|conn| update_sale(conn, id, &ticker, shares, price_per_share, &sold_at))
}

#[tauri::command]
pub fn db_delete_sale(id: i64, state: State<'_, DbManager>) -> Result<(), String> {
    state.with_txn(|conn| delete_sale(conn, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    /// A fresh, migrated in-memory database — portfolio id 1 ("My Portfolio")
    /// comes seeded as `source = 'manual'` from V8/V14.
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();
        conn
    }

    #[test]
    fn add_sale_credits_linked_cash_event() {
        let conn = db();
        let sale_id = add_sale(&conn, 1, "aapl", 10.0, 150.0, "2026-01-15").unwrap();

        let sales = list_sales(&conn, 1).unwrap();
        assert_eq!(sales.len(), 1);
        assert_eq!(sales[0].ticker, "AAPL", "ticker is upper-cased");
        assert_eq!(sales[0].shares, 10.0);
        assert_eq!(sales[0].price_per_share, 150.0);

        let (kind, ticker, amount, source_sale_id): (String, Option<String>, f64, Option<i64>) = conn
            .query_row(
                "SELECT kind, ticker, amount, source_sale_id FROM cash_events WHERE portfolio_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(kind, "sale");
        assert_eq!(ticker.as_deref(), Some("AAPL"));
        assert_eq!(amount, 1500.0, "proceeds = shares * price");
        assert_eq!(source_sale_id, Some(sale_id));
    }

    #[test]
    fn add_sale_rejects_broker_portfolio() {
        let conn = db();
        conn.execute(
            "INSERT INTO portfolios (id, name, sort_order, is_starred, created_at, source) \
             VALUES (2, 'Alpaca', 0, 0, 0, 'alpaca')",
            [],
        )
        .unwrap();

        let err = add_sale(&conn, 2, "AAPL", 1.0, 100.0, "2026-01-01").unwrap_err();
        assert!(matches!(err, rusqlite::Error::SqliteFailure(_, _)));

        // Nothing was written on either side of the rejected write.
        assert_eq!(list_sales(&conn, 2).unwrap().len(), 0);
        let cash_events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cash_events WHERE portfolio_id = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cash_events, 0);
    }

    #[test]
    fn update_sale_keeps_its_cash_event_in_sync() {
        let conn = db();
        let sale_id = add_sale(&conn, 1, "AAPL", 10.0, 150.0, "2026-01-15").unwrap();

        update_sale(&conn, sale_id, "MSFT", 4.0, 300.0, "2026-02-01").unwrap();

        let sales = list_sales(&conn, 1).unwrap();
        assert_eq!(sales[0].ticker, "MSFT");
        assert_eq!(sales[0].shares, 4.0);
        assert_eq!(sales[0].sold_at, "2026-02-01");

        let (ticker, amount, occurred_at): (String, f64, String) = conn
            .query_row(
                "SELECT ticker, amount, occurred_at FROM cash_events WHERE source_sale_id = ?1",
                params![sale_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(ticker, "MSFT");
        assert_eq!(amount, 1200.0, "proceeds recomputed from the new shares/price");
        assert_eq!(occurred_at, "2026-02-01");
    }

    #[test]
    fn delete_sale_removes_its_cash_event_too() {
        let conn = db();
        let sale_id = add_sale(&conn, 1, "AAPL", 10.0, 150.0, "2026-01-15").unwrap();

        delete_sale(&conn, sale_id).unwrap();

        assert_eq!(list_sales(&conn, 1).unwrap().len(), 0);
        let cash_events: i64 = conn
            .query_row("SELECT COUNT(*) FROM cash_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cash_events, 0, "the linked cash event must not outlive the sale");
    }

    #[test]
    fn deleting_a_sale_does_not_touch_unrelated_cash_events() {
        let conn = db();
        // An ordinary dividend, unrelated to any sale.
        conn.execute(
            "INSERT INTO cash_events (portfolio_id, kind, ticker, amount, occurred_at, created_at) \
             VALUES (1, 'dividend', 'VTI', 12.5, '2026-01-01', 0)",
            [],
        )
        .unwrap();
        let sale_id = add_sale(&conn, 1, "AAPL", 10.0, 150.0, "2026-01-15").unwrap();

        delete_sale(&conn, sale_id).unwrap();

        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM cash_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1, "the unrelated dividend row must survive");
    }
}
