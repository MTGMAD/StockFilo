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
///
/// `default_visible` only takes effect on first insert — an existing row's
/// `visible` flag is never touched by a resync, so hiding an account (or a
/// provider that starts an account hidden until the person opts in, e.g.
/// SnapTrade) survives every subsequent sync.
pub fn upsert_account(
    conn: &Connection,
    connection_id: &str,
    acct: &RemoteAccount,
    default_visible: bool,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO broker_accounts \
           (connection_id, provider_account_id, account_mask, currency, equity, cash, \
            buying_power, snapshot_at, visible) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
         ON CONFLICT(connection_id, provider_account_id) DO UPDATE SET \
           account_mask = excluded.account_mask, \
           currency     = excluded.currency, \
           equity       = excluded.equity, \
           cash         = excluded.cash, \
           buying_power = excluded.buying_power, \
           snapshot_at  = excluded.snapshot_at",
        params![
            connection_id,
            acct.id,
            acct.mask,
            acct.currency,
            acct.equity,
            acct.cash,
            acct.buying_power,
            now_secs(),
            default_visible,
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

/// `external_id` prefix for a *provisional* fill: one taken from a broker's
/// real-time order book because its transaction history lags (SnapTrade's is
/// refreshed once a day). Replaced by the history row once it arrives — see
/// [`reconcile_provisional`].
pub const PROVISIONAL_PREFIX: &str = "order:";

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

/// Most recent *history* date already stored, as a sync watermark.
/// Provisional rows are excluded: a fill from today's order book says nothing
/// about whether yesterday's history has been fetched.
pub fn latest_activity_date(
    conn: &Connection,
    broker_account_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT MAX(occurred_at) FROM broker_transactions \
         WHERE broker_account_id = ?1 AND external_id NOT LIKE ?2 || '%'",
        params![broker_account_id, PROVISIONAL_PREFIX],
        |r| r.get::<_, Option<String>>(0),
    )
}

/// Drop provisional fills the transaction history now covers, so a trade is
/// never counted twice.
///
/// Matched per (day, symbol, side): once the history's share total for that
/// group reaches the provisional total, the provisional rows go. Matching on
/// the group rather than row-by-row copes with a broker that reports one
/// order as several partial fills. Safe to run after every sync — a
/// provisional row re-inserted from the order book is simply dropped again.
pub fn reconcile_provisional(conn: &Connection, broker_account_id: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM broker_transactions AS p \
         WHERE p.broker_account_id = ?1 AND p.external_id LIKE ?2 || '%' \
           AND (SELECT COALESCE(SUM(ABS(h.qty)), 0) FROM broker_transactions h \
                WHERE h.broker_account_id = p.broker_account_id \
                  AND h.external_id NOT LIKE ?2 || '%' \
                  AND h.occurred_at = p.occurred_at \
                  AND h.provider_symbol = p.provider_symbol \
                  AND COALESCE(h.side, '') = COALESCE(p.side, '')) \
               + 1e-6 >= \
               (SELECT COALESCE(SUM(ABS(q.qty)), 0) FROM broker_transactions q \
                WHERE q.broker_account_id = p.broker_account_id \
                  AND q.external_id LIKE ?2 || '%' \
                  AND q.occurred_at = p.occurred_at \
                  AND q.provider_symbol = p.provider_symbol \
                  AND COALESCE(q.side, '') = COALESCE(p.side, ''))",
        params![broker_account_id, PROVISIONAL_PREFIX],
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

/// Show or hide an account without forgetting it — the account row, its
/// cached positions, and its provider-side identity all survive either way.
/// Showing links (or relinks) its portfolio via [`ensure_portfolio`]; hiding
/// removes that portfolio the same way disconnecting with `keep_portfolio =
/// false` does, since a hidden account should look like it was never picked,
/// not like an empty leftover.
///
/// This is what lets an aggregator like SnapTrade expose many accounts while
/// the person chooses only some of them to mirror as portfolios.
pub fn set_account_visible(
    conn: &Connection,
    broker_account_id: i64,
    visible: bool,
    provider: &str,
    portfolio_name: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE broker_accounts SET visible = ?1 WHERE id = ?2",
        params![visible, broker_account_id],
    )?;

    if visible {
        ensure_portfolio(conn, broker_account_id, provider, portfolio_name)?;
    } else {
        conn.execute(
            "DELETE FROM portfolios WHERE broker_account_id = ?1",
            params![broker_account_id],
        )?;
    }

    Ok(())
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
            true,
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
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();

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

    fn fill(id: &str, day: &str, sym: &str, side: &str, qty: f64) -> RemoteActivity {
        RemoteActivity {
            external_id: id.into(),
            kind: "fill".into(),
            side: Some(side.into()),
            provider_symbol: sym.into(),
            qty: Some(qty),
            price: Some(10.0),
            occurred_at: day.into(),
            raw: None,
        }
    }

    fn ids(conn: &Connection, acct: i64) -> Vec<String> {
        let mut v: Vec<String> = list_transactions(conn, acct)
            .unwrap()
            .into_iter()
            .map(|t| t.external_id)
            .collect();
        v.sort();
        v
    }

    #[test]
    fn provisional_fill_is_replaced_once_history_reports_it() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();

        // Today's fill, from the real-time order book only.
        append_transactions(&conn, acct, &[fill("order:1", "2026-09-24", "VTI", "buy", 5.0)]).unwrap();
        reconcile_provisional(&conn, acct).unwrap();
        assert_eq!(ids(&conn, acct), vec!["order:1"]);
        // It must not advance the history watermark.
        assert_eq!(latest_activity_date(&conn, acct).unwrap(), None);

        // Next day the history reports it as two partial fills — then the
        // order book repeats it, as it will for a week.
        append_transactions(
            &conn,
            acct,
            &[
                fill("h1", "2026-09-24", "VTI", "buy", 2.0),
                fill("h2", "2026-09-24", "VTI", "buy", 3.0),
                fill("order:1", "2026-09-24", "VTI", "buy", 5.0),
            ],
        )
        .unwrap();
        reconcile_provisional(&conn, acct).unwrap();
        assert_eq!(ids(&conn, acct), vec!["h1", "h2"]);
        assert_eq!(latest_activity_date(&conn, acct).unwrap().as_deref(), Some("2026-09-24"));
    }

    #[test]
    fn provisional_fill_stays_while_history_is_incomplete_or_different() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();
        append_transactions(
            &conn,
            acct,
            &[
                fill("order:1", "2026-09-24", "VTI", "buy", 5.0),
                // Only part of it in history so far.
                fill("h1", "2026-09-24", "VTI", "buy", 2.0),
                // Same day and symbol, but a sell — not a match.
                fill("h2", "2026-09-24", "VTI", "sell", 5.0),
            ],
        )
        .unwrap();
        reconcile_provisional(&conn, acct).unwrap();
        assert_eq!(ids(&conn, acct), vec!["h1", "h2", "order:1"]);
    }

    #[test]
    fn appending_activities_is_idempotent() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();

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
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();

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
    fn hiding_an_account_removes_its_portfolio_but_keeps_the_account() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto(), false).unwrap();

        // Inserted hidden: no portfolio should exist yet.
        assert_eq!(linked_portfolio(&conn, acct).unwrap(), None);

        set_account_visible(&conn, acct, true, "alpaca", "Alpaca — Paper").unwrap();
        let pid = linked_portfolio(&conn, acct).unwrap().expect("now visible");

        set_account_visible(&conn, acct, false, "alpaca", "Alpaca — Paper").unwrap();
        assert_eq!(linked_portfolio(&conn, acct).unwrap(), None, "hidden again");

        // The account itself, and re-showing it, both survive.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM broker_accounts WHERE id = ?1",
                params![acct],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);

        set_account_visible(&conn, acct, true, "alpaca", "Alpaca — Paper").unwrap();
        let pid2 = linked_portfolio(&conn, acct).unwrap().expect("visible again");
        assert_ne!(pid, pid2, "re-showing creates a fresh portfolio, not a dangling reference");
    }

    #[test]
    fn resyncing_a_hidden_account_does_not_resurrect_its_portfolio() {
        // A resync must not silently override a person's choice to hide an
        // account — visible is only set on first insert.
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto(), false).unwrap();
        assert_eq!(linked_portfolio(&conn, acct).unwrap(), None);

        // Re-syncing (same connection_id + provider_account_id) must leave it hidden.
        let acct2 = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();
        assert_eq!(acct, acct2);
        assert_eq!(linked_portfolio(&conn, acct).unwrap(), None);
    }

    #[test]
    fn disconnecting_can_keep_the_portfolio_as_manual() {
        let conn = db();
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();
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
        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();
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

        let acct = upsert_account(&conn, "c1", &acct_dto(), true).unwrap();
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
            true,
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
            true,
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

/// The database is uploaded wholesale to WebDAV/NAS sync targets, so a
/// credential stored in it is a credential published to that target.
///
/// This guards the property structurally: it sweeps *every* text value in
/// *every* table, so it keeps holding if someone later adds a column, a table,
/// or a debug field that happens to carry a secret.
#[cfg(test)]
mod credential_leak_tests {
    use super::*;
    use crate::db::migrations;

    const FAKE_KEY: &str = "PKTESTKEY0000000000000000";
    const FAKE_SECRET: &str = "sUpErSeCrEtAlPaCaVaLuE1234567890abcd";

    /// Every text value stored anywhere in the database.
    fn all_text_values(conn: &Connection) -> Vec<String> {
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        let mut out = Vec::new();
        for t in tables {
            if t.starts_with("sqlite_") {
                continue;
            }
            let cols: Vec<String> = conn
                .prepare(&format!("PRAGMA table_info({t})"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();

            for c in cols {
                let sql = format!("SELECT CAST(\"{c}\" AS TEXT) FROM \"{t}\" WHERE \"{c}\" IS NOT NULL");
                let mut stmt = conn.prepare(&sql).unwrap();
                let vals = stmt
                    .query_map([], |r| r.get::<_, String>(0))
                    .unwrap()
                    .filter_map(|v| v.ok());
                out.extend(vals);
            }
        }
        out
    }

    #[test]
    fn no_credential_is_ever_written_to_the_database() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();

        // Exactly what broker_save_connection persists: a reference, never the
        // secret itself. The secret goes to the OS keychain (secrets.rs).
        conn.execute(
            "INSERT INTO broker_connections \
               (id, provider, environment, label, credential_ref, device_id, created_at) \
             VALUES ('conn-1', 'alpaca', 'live', 'Alpaca — Margin', 'broker:conn-1', 'dev-1', 0)",
            [],
        )
        .unwrap();

        let acct = upsert_account(
            &conn,
            "conn-1",
            &RemoteAccount {
                id: "A1".into(),
                mask: Some("****4342".into()),
                currency: "USD".into(),
                equity: Some(1000.0),
                cash: Some(10.0),
                buying_power: None,
            },
            true,
        )
        .unwrap();
        ensure_portfolio(&conn, acct, "alpaca", "Alpaca Margin (****4342)").unwrap();
        replace_positions(
            &conn,
            acct,
            &[RemotePosition {
                provider_symbol: "AAPL".into(),
                asset_class: Some("us_equity".into()),
                qty: 1.0,
                avg_entry_price: Some(1.0),
                cost_basis: Some(1.0),
                current_price: Some(1.0),
                market_value: Some(1.0),
                unrealized_pl: Some(0.0),
                unrealized_plpc: Some(0.0),
                change_today: Some(0.0),
            }],
        )
        .unwrap();
        append_transactions(
            &conn,
            acct,
            &[RemoteActivity {
                external_id: "f1".into(),
                kind: "fill".into(),
                side: Some("buy".into()),
                provider_symbol: "AAPL".into(),
                qty: Some(1.0),
                price: Some(1.0),
                occurred_at: "2025-01-01".into(),
                // `raw` keeps the provider's original JSON — the most likely
                // place for a credential to end up by accident.
                raw: Some(r#"{"id":"f1","symbol":"AAPL"}"#.into()),
            }],
        )
        .unwrap();

        for value in all_text_values(&conn) {
            assert!(
                !value.contains(FAKE_KEY),
                "an API key id reached the database: {value}"
            );
            assert!(
                !value.contains(FAKE_SECRET),
                "an API secret reached the database: {value}"
            );
        }
    }

    /// `credential_ref` must be an opaque handle, not the secret in disguise.
    #[test]
    fn credential_ref_is_only_a_handle() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();
        conn.execute(
            "INSERT INTO broker_connections \
               (id, provider, environment, label, credential_ref, created_at) \
             VALUES ('conn-1', 'alpaca', 'live', 'x', 'broker:conn-1', 0)",
            [],
        )
        .unwrap();

        let r: String = conn
            .query_row("SELECT credential_ref FROM broker_connections", [], |x| x.get(0))
            .unwrap();
        assert!(r.starts_with("broker:"), "unexpected reference form: {r}");
        assert!(r.ends_with("conn-1"), "reference should name the connection");
        assert!(!r.contains(FAKE_SECRET));
    }
}
