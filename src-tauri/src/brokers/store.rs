//! Persistence for broker data.
//!
//! Provider-agnostic: it takes normalized DTOs and writes them to the broker
//! tables.  It never touches `purchases` — broker holdings are a mirror of what
//! the brokerage reports, and the purchase log stays exclusively the user's own
//! hand-entered history.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::symbols;
use super::types::{RemoteAccount, RemoteActivity, RemotePosition};

/// A position as stored, ready for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPosition {
    pub broker_account_id: i64,
    pub provider_symbol: String,
    pub ticker: Option<String>,
    pub asset_class: Option<String>,
    pub qty: f64,
    pub avg_entry_price: Option<f64>,
    pub cost_basis: Option<f64>,
    pub current_price: Option<f64>,
    pub market_value: Option<f64>,
    pub unrealized_pl: Option<f64>,
    pub unrealized_plpc: Option<f64>,
    pub change_today: Option<f64>,
    pub snapshot_at: i64,
}

/// A stored transaction, for the read-only purchases view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTransaction {
    pub id: i64,
    pub broker_account_id: i64,
    pub external_id: String,
    pub kind: String,
    pub side: Option<String>,
    pub provider_symbol: String,
    pub ticker: Option<String>,
    pub qty: Option<f64>,
    pub price: Option<f64>,
    pub occurred_at: String,
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Accounts ───────────────────────────────────────────────────────────────

/// Insert or update an account, returning its local row id.
pub fn upsert_account(
    conn: &Connection,
    connection_id: &str,
    acct: &RemoteAccount,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO broker_accounts \
           (connection_id, provider_account_id, account_mask, currency, equity, cash, snapshot_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(connection_id, provider_account_id) DO UPDATE SET \
           account_mask = excluded.account_mask, \
           currency     = excluded.currency, \
           equity       = excluded.equity, \
           cash         = excluded.cash, \
           snapshot_at  = excluded.snapshot_at",
        params![
            connection_id,
            acct.id,
            acct.mask,
            acct.currency,
            acct.equity,
            acct.cash,
            now_secs()
        ],
    )?;

    conn.query_row(
        "SELECT id FROM broker_accounts WHERE connection_id = ?1 AND provider_account_id = ?2",
        params![connection_id, acct.id],
        |r| r.get(0),
    )
}

// ── Positions ──────────────────────────────────────────────────────────────

/// Replace this account's position snapshot wholesale.
///
/// A full swap is the correct semantic for a snapshot: a position closed at the
/// brokerage has to disappear here, which an upsert alone would never do. The
/// caller runs this inside a transaction so the table is never seen empty.
pub fn replace_positions(
    conn: &Connection,
    broker_account_id: i64,
    positions: &[RemotePosition],
) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM broker_positions WHERE broker_account_id = ?1",
        params![broker_account_id],
    )?;

    let snapshot_at = now_secs();
    let mut written = 0usize;

    for p in positions {
        let ticker = symbols::to_yahoo(&p.provider_symbol, p.asset_class.as_deref());

        conn.execute(
            "INSERT INTO broker_positions \
               (broker_account_id, provider_symbol, ticker, asset_class, qty, avg_entry_price, \
                cost_basis, current_price, market_value, unrealized_pl, unrealized_plpc, \
                change_today, snapshot_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                broker_account_id,
                p.provider_symbol,
                ticker,
                p.asset_class,
                p.qty,
                p.avg_entry_price,
                p.cost_basis,
                p.current_price,
                p.market_value,
                p.unrealized_pl,
                p.unrealized_plpc,
                p.change_today,
                snapshot_at
            ],
        )?;
        written += 1;

        // Give Yahoo a cache row to fill with reference data (name, asset type,
        // analyst target, dividend yield). Prices come from the broker; this is
        // only the extras. Mirrors what db_add_purchase does for manual rows.
        if let Some(t) = ticker {
            conn.execute("INSERT OR IGNORE INTO stocks (ticker) VALUES (?1)", params![t])?;
        }
    }

    Ok(written)
}

pub fn list_positions(
    conn: &Connection,
    broker_account_id: i64,
) -> rusqlite::Result<Vec<StoredPosition>> {
    let mut stmt = conn.prepare(
        "SELECT broker_account_id, provider_symbol, ticker, asset_class, qty, avg_entry_price, \
                cost_basis, current_price, market_value, unrealized_pl, unrealized_plpc, \
                change_today, snapshot_at \
         FROM broker_positions WHERE broker_account_id = ?1 \
         ORDER BY market_value DESC, provider_symbol ASC",
    )?;
    let rows = stmt.query_map(params![broker_account_id], |r| {
        Ok(StoredPosition {
            broker_account_id: r.get(0)?,
            provider_symbol: r.get(1)?,
            ticker: r.get(2)?,
            asset_class: r.get(3)?,
            qty: r.get(4)?,
            avg_entry_price: r.get(5)?,
            cost_basis: r.get(6)?,
            current_price: r.get(7)?,
            market_value: r.get(8)?,
            unrealized_pl: r.get(9)?,
            unrealized_plpc: r.get(10)?,
            change_today: r.get(11)?,
            snapshot_at: r.get(12)?,
        })
    })?;
    rows.collect()
}

// ── Transactions ───────────────────────────────────────────────────────────

/// Append activities. Idempotent on `(broker_account_id, external_id)`, so
/// re-syncing an overlapping window never duplicates a row.
///
/// Returns how many rows were genuinely new.
pub fn append_transactions(
    conn: &Connection,
    broker_account_id: i64,
    activities: &[RemoteActivity],
) -> rusqlite::Result<usize> {
    let mut inserted = 0usize;

    for a in activities {
        let ticker = symbols::to_yahoo(&a.provider_symbol, None);
        let n = conn.execute(
            "INSERT OR IGNORE INTO broker_transactions \
               (broker_account_id, external_id, kind, side, provider_symbol, ticker, \
                qty, price, occurred_at, raw) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                broker_account_id,
                a.external_id,
                a.kind,
                a.side,
                a.provider_symbol,
                ticker,
                a.qty,
                a.price,
                a.occurred_at,
                a.raw
            ],
        )?;
        inserted += n;
    }

    Ok(inserted)
}

pub fn list_transactions(
    conn: &Connection,
    broker_account_id: i64,
) -> rusqlite::Result<Vec<StoredTransaction>> {
    let mut stmt = conn.prepare(
        "SELECT id, broker_account_id, external_id, kind, side, provider_symbol, ticker, \
                qty, price, occurred_at \
         FROM broker_transactions WHERE broker_account_id = ?1 \
         ORDER BY occurred_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![broker_account_id], |r| {
        Ok(StoredTransaction {
            id: r.get(0)?,
            broker_account_id: r.get(1)?,
            external_id: r.get(2)?,
            kind: r.get(3)?,
            side: r.get(4)?,
            provider_symbol: r.get(5)?,
            ticker: r.get(6)?,
            qty: r.get(7)?,
            price: r.get(8)?,
            occurred_at: r.get(9)?,
        })
    })?;
    rows.collect()
}

/// Most recent activity date already stored, as a sync watermark.
pub fn latest_activity_date(
    conn: &Connection,
    broker_account_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT MAX(occurred_at) FROM broker_transactions WHERE broker_account_id = ?1",
        params![broker_account_id],
        |r| r.get::<_, Option<String>>(0),
    )
}

// ── Portfolio linkage ──────────────────────────────────────────────────────

/// Find the portfolio linked to an account, if one exists.
pub fn linked_portfolio(
    conn: &Connection,
    broker_account_id: i64,
) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM portfolios WHERE broker_account_id = ?1",
        params![broker_account_id],
        |r| r.get(0),
    )
    .optional()
}

/// Create the portfolio that mirrors a broker account, or return the existing
/// one. Named for the account so it is recognisable in the sidebar.
pub fn ensure_portfolio(
    conn: &Connection,
    broker_account_id: i64,
    provider: &str,
    name: &str,
) -> rusqlite::Result<i64> {
    if let Some(id) = linked_portfolio(conn, broker_account_id)? {
        return Ok(id);
    }

    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM portfolios",
        [],
        |r| r.get(0),
    )?;

    conn.execute(
        "INSERT INTO portfolios (name, sort_order, is_starred, created_at, source, broker_account_id) \
         VALUES (?1, ?2, 0, ?3, ?4, ?5)",
        params![name, next_order, now_secs(), provider, broker_account_id],
    )?;

    Ok(conn.last_insert_rowid())
}

/// Remove everything belonging to a connection.
///
/// `keep_portfolio` converts the linked portfolio back to an empty manual one
/// rather than deleting it — used when the user disconnects but wants to keep
/// the portfolio around.
pub fn delete_connection(
    conn: &Connection,
    connection_id: &str,
    keep_portfolio: bool,
) -> rusqlite::Result<()> {
    let mut stmt =
        conn.prepare("SELECT id FROM broker_accounts WHERE connection_id = ?1")?;
    let account_ids: Vec<i64> = stmt
        .query_map(params![connection_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    for acct in account_ids {
        conn.execute(
            "DELETE FROM broker_positions WHERE broker_account_id = ?1",
            params![acct],
        )?;
        conn.execute(
            "DELETE FROM broker_transactions WHERE broker_account_id = ?1",
            params![acct],
        )?;

        if keep_portfolio {
            conn.execute(
                "UPDATE portfolios SET source = 'manual', broker_account_id = NULL \
                 WHERE broker_account_id = ?1",
                params![acct],
            )?;
        } else {
            conn.execute(
                "DELETE FROM portfolios WHERE broker_account_id = ?1",
                params![acct],
            )?;
        }
    }

    conn.execute(
        "DELETE FROM broker_accounts WHERE connection_id = ?1",
        params![connection_id],
    )?;
    conn.execute(
        "DELETE FROM broker_connections WHERE id = ?1",
        params![connection_id],
    )?;

    // Drop cache rows nothing references any more. Mirrors the cleanup in
    // db_delete_portfolio, including its guard for broker-held tickers.
    conn.execute(
        "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM purchases) \
         AND ticker NOT IN (SELECT ticker FROM watchlist) \
         AND ticker NOT IN (SELECT ticker FROM broker_positions WHERE ticker IS NOT NULL)",
        [],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();
        conn.execute(
            "INSERT INTO broker_connections (id, provider, environment, label, credential_ref, created_at) \
             VALUES ('c1', 'alpaca', 'paper', 'Alpaca Paper', 'broker:c1', 0)",
            [],
        )
        .unwrap();
        conn
    }

    fn pos(sym: &str, qty: f64, class: &str) -> RemotePosition {
        RemotePosition {
            provider_symbol: sym.into(),
            asset_class: Some(class.into()),
            qty,
            avg_entry_price: Some(100.0),
            cost_basis: Some(100.0 * qty),
            current_price: Some(110.0),
            market_value: Some(110.0 * qty),
            unrealized_pl: Some(10.0 * qty),
            unrealized_plpc: Some(0.1),
            change_today: Some(0.02),
        }
    }

    #[test]
    fn snapshot_replacement_drops_closed_positions() {
        let conn = db();
        let acct = upsert_account(
            &conn,
            "c1",
            &RemoteAccount {
                id: "A1".into(),
                mask: Some("****1234".into()),
                currency: "USD".into(),
                equity: Some(1000.0),
                cash: Some(50.0),
                buying_power: None,
            },
        )
        .unwrap();

        replace_positions(&conn, acct, &[pos("AAPL", 10.0, "us_equity"), pos("MSFT", 5.0, "us_equity")])
            .unwrap();
        assert_eq!(list_positions(&conn, acct).unwrap().len(), 2);

        // MSFT sold at the brokerage — it must vanish, not linger.
        replace_positions(&conn, acct, &[pos("AAPL", 10.0, "us_equity")]).unwrap();
        let held = list_positions(&conn, acct).unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].provider_symbol, "AAPL");
    }

    #[test]
    fn positions_seed_the_reference_cache_but_options_do_not() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto()).unwrap();

        replace_positions(
            &conn,
            acct,
            &[
                pos("AAPL", 1.0, "us_equity"),
                pos("BTC/USD", 2.0, "crypto"),
                pos("AAPL260116C00150000", 1.0, "us_option"),
            ],
        )
        .unwrap();

        let cached: Vec<String> = conn
            .prepare("SELECT ticker FROM stocks ORDER BY ticker")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(cached.contains(&"AAPL".to_string()));
        assert!(cached.contains(&"BTC-USD".to_string()), "crypto should map to Yahoo form");
        assert_eq!(cached.len(), 2, "the option must not create a cache row");

        // The option is still held and still priced by the broker.
        let held = list_positions(&conn, acct).unwrap();
        assert_eq!(held.len(), 3);
        let opt = held.iter().find(|p| p.provider_symbol.starts_with("AAPL26")).unwrap();
        assert_eq!(opt.ticker, None);
        assert_eq!(opt.current_price, Some(110.0));
    }

    fn acct_dto() -> RemoteAccount {
        RemoteAccount {
            id: "A1".into(),
            mask: None,
            currency: "USD".into(),
            equity: None,
            cash: None,
            buying_power: None,
        }
    }

    #[test]
    fn appending_activities_is_idempotent() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto()).unwrap();

        let acts = vec![
            RemoteActivity {
                external_id: "f1".into(),
                kind: "fill".into(),
                side: Some("buy".into()),
                provider_symbol: "AAPL".into(),
                qty: Some(10.0),
                price: Some(150.0),
                occurred_at: "2025-03-14".into(),
                raw: None,
            },
            RemoteActivity {
                external_id: "f2".into(),
                kind: "fill".into(),
                side: Some("buy".into()),
                provider_symbol: "AAPL".into(),
                qty: Some(5.0),
                price: Some(160.0),
                occurred_at: "2025-06-02".into(),
                raw: None,
            },
        ];

        assert_eq!(append_transactions(&conn, acct, &acts).unwrap(), 2);
        // Re-syncing the same window must add nothing.
        assert_eq!(append_transactions(&conn, acct, &acts).unwrap(), 0);
        assert_eq!(list_transactions(&conn, acct).unwrap().len(), 2);
        assert_eq!(
            latest_activity_date(&conn, acct).unwrap(),
            Some("2025-06-02".into())
        );
    }

    #[test]
    fn linked_portfolio_is_created_once_and_marked_with_its_provider() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto()).unwrap();

        let p1 = ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper (****1234)").unwrap();
        let p2 = ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper (****1234)").unwrap();
        assert_eq!(p1, p2, "must not create a second portfolio");

        let (source, linked): (String, i64) = conn
            .query_row(
                "SELECT source, broker_account_id FROM portfolios WHERE id = ?1",
                params![p1],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(source, "alpaca");
        assert_eq!(linked, acct);
    }

    #[test]
    fn disconnecting_can_keep_the_portfolio_as_manual() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto()).unwrap();
        let pid = ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper").unwrap();
        replace_positions(&conn, acct, &[pos("AAPL", 1.0, "us_equity")]).unwrap();

        delete_connection(&conn, "c1", true).unwrap();

        let (source, linked): (String, Option<i64>) = conn
            .query_row(
                "SELECT source, broker_account_id FROM portfolios WHERE id = ?1",
                params![pid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(source, "manual");
        assert_eq!(linked, None);
        assert_eq!(list_positions(&conn, acct).unwrap().len(), 0);
    }

    #[test]
    fn disconnecting_can_remove_everything() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto()).unwrap();
        let pid = ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper").unwrap();

        delete_connection(&conn, "c1", false).unwrap();

        let gone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM portfolios WHERE id = ?1",
                params![pid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0);
        let conns: i64 = conn
            .query_row("SELECT COUNT(*) FROM broker_connections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(conns, 0);
    }

    /// The whole point of the design: manual purchase history is never touched.
    #[test]
    fn purchases_are_never_written_or_deleted() {
        let conn = db();
        conn.execute(
            "INSERT INTO purchases (ticker, shares, price_per_share, purchased_at, created_at, portfolio_id) \
             VALUES ('AAPL', 10, 150, '2025-01-15', 0, 1)",
            [],
        )
        .unwrap();

        let acct = upsert_account(&conn, "c1", &acct_dto()).unwrap();
        ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper").unwrap();
        replace_positions(&conn, acct, &[pos("AAPL", 99.0, "us_equity")]).unwrap();
        delete_connection(&conn, "c1", false).unwrap();

        let (n, shares): (i64, f64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(MAX(shares),0) FROM purchases",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(n, 1, "manual purchase row was disturbed");
        assert_eq!(shares, 10.0, "manual purchase was modified");
    }
}

/// Isolation between hand-entered and broker-mirrored data.
///
/// The guarantee runs both ways, and both directions are enforced in the data
/// layer rather than the UI, so no future code path can quietly break it.
#[cfg(test)]
mod isolation_tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();
        conn.execute(
            "INSERT INTO broker_connections (id, provider, environment, label, credential_ref, created_at) \
             VALUES ('c1', 'alpaca', 'paper', 'Alpaca Paper', 'broker:c1', 0)",
            [],
        )
        .unwrap();
        conn
    }

    fn account(conn: &Connection) -> i64 {
        upsert_account(
            conn,
            "c1",
            &RemoteAccount {
                id: "A1".into(),
                mask: Some("****4821".into()),
                currency: "USD".into(),
                equity: Some(1000.0),
                cash: Some(10.0),
                buying_power: None,
            },
        )
        .unwrap()
    }

    fn position(sym: &str, qty: f64) -> RemotePosition {
        RemotePosition {
            provider_symbol: sym.into(),
            asset_class: Some("us_equity".into()),
            qty,
            avg_entry_price: Some(10.0),
            cost_basis: Some(10.0 * qty),
            current_price: Some(12.0),
            market_value: Some(12.0 * qty),
            unrealized_pl: Some(2.0 * qty),
            unrealized_plpc: Some(0.2),
            change_today: Some(0.01),
        }
    }

    /// Broker positions must never appear in a manual portfolio.
    #[test]
    fn broker_data_cannot_reach_a_manual_portfolio() {
        let conn = db();
        let acct = account(&conn);
        // Portfolio 1 is the seeded manual one from migration V8.
        let manual_source: String = conn
            .query_row("SELECT source FROM portfolios WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(manual_source, "manual");

        ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper (****4821)").unwrap();
        replace_positions(&conn, acct, &[position("AAPL", 5.0)]).unwrap();

        // Positions are keyed by broker_account_id, and a manual portfolio has
        // none — so there is no join by which they could surface there.
        let manual_broker_id: Option<i64> = conn
            .query_row("SELECT broker_account_id FROM portfolios WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(manual_broker_id, None);

        let rows_for_manual: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM broker_positions bp \
                 JOIN portfolios p ON p.broker_account_id = bp.broker_account_id \
                 WHERE p.id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows_for_manual, 0);
    }

    /// A broker sync must never touch the purchase log, in either direction.
    #[test]
    fn manual_purchases_are_invisible_to_broker_portfolios() {
        let conn = db();
        let acct = account(&conn);
        let linked = ensure_portfolio(&conn, acct, "alpaca", "Alpaca — Paper").unwrap();

        conn.execute(
            "INSERT INTO purchases (ticker, shares, price_per_share, purchased_at, created_at, portfolio_id) \
             VALUES ('AAPL', 99, 1.0, '2025-01-01', 0, 1)",
            [],
        )
        .unwrap();

        replace_positions(&conn, acct, &[position("AAPL", 5.0)]).unwrap();

        // The linked portfolio's holdings come only from its own snapshot.
        let held: f64 = conn
            .query_row(
                "SELECT qty FROM broker_positions WHERE broker_account_id = ?1",
                params![acct],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(held, 5.0, "manual shares leaked into the broker snapshot");

        // And the linked portfolio owns no purchase rows.
        let purchases_on_linked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM purchases WHERE portfolio_id = ?1",
                params![linked],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(purchases_on_linked, 0);
    }

    /// Two connections must not see each other's holdings.
    #[test]
    fn accounts_do_not_share_positions() {
        let conn = db();
        conn.execute(
            "INSERT INTO broker_connections (id, provider, environment, label, credential_ref, created_at) \
             VALUES ('c2', 'alpaca', 'live', 'Alpaca Margin', 'broker:c2', 0)",
            [],
        )
        .unwrap();

        let paper = account(&conn);
        let margin = upsert_account(
            &conn,
            "c2",
            &RemoteAccount {
                id: "A2".into(),
                mask: Some("****9930".into()),
                currency: "USD".into(),
                equity: Some(50.0),
                cash: Some(1.0),
                buying_power: None,
            },
        )
        .unwrap();
        assert_ne!(paper, margin);

        replace_positions(&conn, paper, &[position("AAPL", 5.0)]).unwrap();
        replace_positions(&conn, margin, &[position("TSLA", 3.0)]).unwrap();

        let paper_syms: Vec<String> = list_positions(&conn, paper)
            .unwrap()
            .into_iter()
            .map(|p| p.provider_symbol)
            .collect();
        let margin_syms: Vec<String> = list_positions(&conn, margin)
            .unwrap()
            .into_iter()
            .map(|p| p.provider_symbol)
            .collect();
        assert_eq!(paper_syms, vec!["AAPL"]);
        assert_eq!(margin_syms, vec!["TSLA"]);

        // Re-syncing one account must not disturb the other.
        replace_positions(&conn, paper, &[position("MSFT", 1.0)]).unwrap();
        assert_eq!(list_positions(&conn, margin).unwrap().len(), 1);
    }
}
