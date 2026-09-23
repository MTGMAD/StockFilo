pub const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS stocks (
    ticker          TEXT PRIMARY KEY,
    name            TEXT,
    last_price      REAL,
    last_fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS purchases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker          TEXT NOT NULL,
    shares          REAL NOT NULL,
    price_per_share REAL NOT NULL,
    purchased_at    TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_ticker ON purchases(ticker);
CREATE INDEX IF NOT EXISTS idx_purchases_purchased_at ON purchases(purchased_at);
"#;

pub const MIGRATION_V2: &str = r#"
CREATE TABLE IF NOT EXISTS watchlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker     TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
"#;

pub const MIGRATION_V3: &str = r#"
CREATE TABLE IF NOT EXISTS favorites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker     TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);
"#;

pub const MIGRATION_V4: &str = r#"
ALTER TABLE stocks ADD COLUMN quote_type TEXT;
"#;

pub const MIGRATION_V5: &str = r#"
ALTER TABLE stocks ADD COLUMN daily_change_pct REAL;
"#;

pub const MIGRATION_V6: &str = r#"
ALTER TABLE watchlist ADD COLUMN watch_price REAL;
"#;

pub const MIGRATION_V7: &str = r#"
ALTER TABLE stocks ADD COLUMN target_mean_price REAL;
"#;

pub const MIGRATION_V9: &str = r#"
CREATE TABLE IF NOT EXISTS watchlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

INSERT INTO watchlists (id, name, sort_order, created_at)
    VALUES (1, 'My Watchlist', 0, strftime('%s', 'now'));

ALTER TABLE watchlist ADD COLUMN watchlist_id INTEGER NOT NULL DEFAULT 1;
"#;

pub const MIGRATION_V8: &str = r#"
CREATE TABLE IF NOT EXISTS portfolios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

INSERT INTO portfolios (id, name, sort_order, is_starred, created_at)
    VALUES (1, 'My Portfolio', 0, 1, strftime('%s', 'now'));

ALTER TABLE purchases ADD COLUMN portfolio_id INTEGER NOT NULL DEFAULT 1;

ALTER TABLE favorites RENAME TO favorites_old;

CREATE TABLE favorites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    portfolio_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ticker, portfolio_id)
);

INSERT INTO favorites (id, ticker, sort_order, portfolio_id)
    SELECT id, ticker, sort_order, 1 FROM favorites_old;

DROP TABLE favorites_old;
"#;

pub const MIGRATION_V10: &str = r#"
ALTER TABLE stocks ADD COLUMN post_market_price REAL;
ALTER TABLE stocks ADD COLUMN post_market_change_pct REAL;
ALTER TABLE stocks ADD COLUMN pre_market_price REAL;
ALTER TABLE stocks ADD COLUMN pre_market_change_pct REAL;
ALTER TABLE stocks ADD COLUMN market_state TEXT;
"#;

pub const MIGRATION_V11: &str = r#"
CREATE TABLE watchlist_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT NOT NULL,
    watch_price  REAL,
    created_at   INTEGER NOT NULL,
    watchlist_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ticker, watchlist_id)
);

INSERT OR IGNORE INTO watchlist_new (id, ticker, watch_price, created_at, watchlist_id)
    SELECT id, ticker, watch_price, created_at, watchlist_id FROM watchlist;

DROP TABLE watchlist;

ALTER TABLE watchlist_new RENAME TO watchlist;
"#;

/// V12: sync change-log table.  Uses CREATE IF NOT EXISTS so it is
/// safe to call on an already-migrated database.
const MIGRATION_V12: &str = r#"
CREATE TABLE IF NOT EXISTS changes_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name   TEXT    NOT NULL,
    row_id       INTEGER NOT NULL,
    operation    TEXT    NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    payload      TEXT,
    changed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_log_changed_at ON changes_log(changed_at);

CREATE TABLE IF NOT EXISTS _sf_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

const MIGRATION_V13: &str = "ALTER TABLE stocks ADD COLUMN dividend_yield REAL;";

/// V14: brokerage connections.
///
/// Additive only.  Four new tables plus two defaulted columns on `portfolios`.
/// The `purchases` table is deliberately NOT modified — broker data lives in
/// its own tables and never enters the user's hand-entered purchase history.
///
/// Credentials are never stored here.  `broker_connections.credential_ref` is
/// an opaque handle into the OS keychain (see `secrets.rs`); the database file
/// is synced wholesale to WebDAV/NAS targets, so a secret in this file would be
/// a secret uploaded to that target.
const MIGRATION_V14: &str = r#"
CREATE TABLE IF NOT EXISTS broker_connections (
    id                 TEXT PRIMARY KEY,
    provider           TEXT NOT NULL,
    environment        TEXT NOT NULL DEFAULT 'live',
    label              TEXT NOT NULL,
    credential_ref     TEXT NOT NULL,
    device_id          TEXT,
    created_at         INTEGER NOT NULL,
    last_synced_at     INTEGER,
    last_sync_status   TEXT,
    auto_sync_minutes  INTEGER,
    disabled           INTEGER NOT NULL DEFAULT 0,
    UNIQUE(provider, environment, credential_ref)
);

CREATE TABLE IF NOT EXISTS broker_accounts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id       TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    account_mask        TEXT,
    currency            TEXT NOT NULL DEFAULT 'USD',
    equity              REAL,
    cash                REAL,
    snapshot_at         INTEGER,
    UNIQUE(connection_id, provider_account_id)
);

CREATE TABLE IF NOT EXISTS broker_transactions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    broker_account_id INTEGER NOT NULL,
    external_id       TEXT NOT NULL,
    kind              TEXT NOT NULL,
    side              TEXT,
    provider_symbol   TEXT NOT NULL,
    ticker            TEXT,
    qty               REAL,
    price             REAL,
    occurred_at       TEXT NOT NULL,
    raw               TEXT,
    UNIQUE(broker_account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_tx_account
    ON broker_transactions(broker_account_id, occurred_at);

CREATE TABLE IF NOT EXISTS broker_positions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    broker_account_id INTEGER NOT NULL,
    provider_symbol   TEXT NOT NULL,
    ticker            TEXT,
    asset_class       TEXT,
    qty               REAL NOT NULL,
    avg_entry_price   REAL,
    cost_basis        REAL,
    current_price     REAL,
    market_value      REAL,
    unrealized_pl     REAL,
    unrealized_plpc   REAL,
    change_today      REAL,
    snapshot_at       INTEGER NOT NULL,
    UNIQUE(broker_account_id, provider_symbol)
);

ALTER TABLE portfolios ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE portfolios ADD COLUMN broker_account_id INTEGER;
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        rows
    }

    fn table_exists(conn: &Connection, table: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn fresh_database_reaches_latest_version() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 19);
    }

    #[test]
    fn v14_creates_broker_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        for t in [
            "broker_connections",
            "broker_accounts",
            "broker_transactions",
            "broker_positions",
        ] {
            assert!(table_exists(&conn, t), "missing table {t}");
        }
    }

    /// The core backward-compatibility promise: broker data never enters the
    /// user's hand-entered purchase history, so `purchases` must be untouched.
    #[test]
    fn v14_does_not_modify_purchases() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        let cols = columns(&conn, "purchases");
        assert_eq!(
            cols,
            vec![
                "id",
                "ticker",
                "shares",
                "price_per_share",
                "purchased_at",
                "created_at",
                "portfolio_id",
            ]
        );
    }

    #[test]
    fn v18_creates_cash_events_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        assert!(table_exists(&conn, "cash_events"));
        // `source_sale_id` arrives later, in V19's rebuild — see that test
        // for the column list as of the latest schema.
        let cols = columns(&conn, "cash_events");
        assert_eq!(
            cols,
            vec![
                "id",
                "portfolio_id",
                "kind",
                "ticker",
                "amount",
                "occurred_at",
                "note",
                "created_at",
                "source_sale_id",
            ]
        );
    }

    #[test]
    fn v19_creates_sales_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        assert!(table_exists(&conn, "sales"));
        let cols = columns(&conn, "sales");
        assert_eq!(
            cols,
            vec![
                "id",
                "portfolio_id",
                "ticker",
                "shares",
                "price_per_share",
                "sold_at",
                "created_at",
            ]
        );
    }

    #[test]
    fn v19_cash_events_allows_sale_kind_and_adds_source_sale_id() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        let cols = columns(&conn, "cash_events");
        assert!(cols.contains(&"source_sale_id".to_string()));

        conn.execute(
            "INSERT INTO cash_events (portfolio_id, kind, ticker, amount, occurred_at, created_at) \
             VALUES (1, 'sale', 'AAPL', 150.0, '2026-01-01', 0)",
            [],
        )
        .expect("'sale' kind must be accepted by the rebuilt CHECK constraint");
    }

    #[test]
    fn v19_preserves_existing_cash_events_through_the_rebuild() {
        let conn = Connection::open_in_memory().unwrap();
        // Bring the database to V18 only, insert a row, then let run_all finish the rest.
        for (version, sql) in [
            (1, MIGRATION_V1),
            (2, MIGRATION_V2),
            (3, MIGRATION_V3),
            (4, MIGRATION_V4),
            (5, MIGRATION_V5),
            (6, MIGRATION_V6),
            (7, MIGRATION_V7),
            (8, MIGRATION_V8),
            (9, MIGRATION_V9),
            (10, MIGRATION_V10),
            (11, MIGRATION_V11),
            (12, MIGRATION_V12),
            (13, MIGRATION_V13),
            (14, MIGRATION_V14),
            (15, MIGRATION_V15),
            (16, MIGRATION_V16),
            (17, MIGRATION_V17),
            (18, MIGRATION_V18),
        ] {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", &version).unwrap();
        }

        conn.execute(
            "INSERT INTO cash_events (portfolio_id, kind, ticker, amount, occurred_at, note, created_at) \
             VALUES (1, 'dividend', 'VTI', 12.5, '2026-01-01', 'test note', 100)",
            [],
        )
        .unwrap();

        run_all(&conn).unwrap();

        let (kind, ticker, amount, note): (String, String, f64, String) = conn
            .query_row(
                "SELECT kind, ticker, amount, note FROM cash_events WHERE portfolio_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(kind, "dividend");
        assert_eq!(ticker, "VTI");
        assert_eq!(amount, 12.5);
        assert_eq!(note, "test note");
    }

    #[test]
    fn v19_adds_last_import_at_to_portfolios() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        assert!(columns(&conn, "portfolios").contains(&"last_import_at".to_string()));
    }

    /// Existing portfolios must come out of the migration already correct,
    /// with no backfill step and no user-visible conversion.
    #[test]
    fn existing_portfolios_default_to_manual() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();

        // The seed portfolio created back in V8, migrated through V14.
        let (source, broker): (String, Option<i64>) = conn
            .query_row(
                "SELECT source, broker_account_id FROM portfolios WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(source, "manual");
        assert_eq!(broker, None);
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_all(&conn).unwrap();
        // A second run must be a no-op, not an "duplicate column name" error.
        run_all(&conn).unwrap();
        run_all(&conn).unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 19);
    }

    /// Applies the migrations to a real database file and verifies no user data
    /// moved.  Opt-in, because it needs a database to point at:
    ///
    /// ```text
    /// STOCKFOLIO_TEST_DB=/path/to/a/COPY.db cargo test --lib -- --ignored --nocapture
    /// ```
    ///
    /// Always point this at a copy.  It writes to whatever it is given.
    #[test]
    #[ignore = "requires STOCKFOLIO_TEST_DB pointing at a copy of a real database"]
    fn migrates_a_real_database_without_data_loss() {
        let Ok(path) = std::env::var("STOCKFOLIO_TEST_DB") else {
            eprintln!("STOCKFOLIO_TEST_DB not set — skipping");
            return;
        };

        let conn = Connection::open(&path).unwrap();
        let count = |t: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
                .unwrap()
        };

        let before: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        let (p, f, w, s) = (
            count("purchases"),
            count("portfolios"),
            count("watchlist"),
            count("stocks"),
        );
        println!(
            "BEFORE v{before}: purchases={p} portfolios={f} watchlist={w} stocks={s}"
        );

        run_all(&conn).unwrap();

        let after: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        println!(
            "AFTER  v{after}: purchases={} portfolios={} watchlist={} stocks={}",
            count("purchases"),
            count("portfolios"),
            count("watchlist"),
            count("stocks")
        );

        assert_eq!(count("purchases"), p, "purchase rows changed");
        assert_eq!(count("portfolios"), f, "portfolio rows changed");
        assert_eq!(count("watchlist"), w, "watchlist rows changed");
        assert_eq!(count("stocks"), s, "stock cache rows changed");
        assert_eq!(after, 19);

        let mut stmt = conn
            .prepare("SELECT id, name, source, broker_account_id FROM portfolios ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                ))
            })
            .unwrap();
        for row in rows {
            let (id, name, source, broker) = row.unwrap();
            println!("  [{id}] {name:<26} source={source:<8} broker={broker:?}");
            assert_eq!(source, "manual", "existing portfolio was not left manual");
        }

        // Idempotent against real data too.
        run_all(&conn).unwrap();
        println!("second run: OK");
    }

    /// Simulates a real user's database sitting at V13, to prove V14 applies
    /// cleanly on top of existing data rather than only on a fresh schema.
    #[test]
    fn upgrades_a_v13_database_with_data() {
        let conn = Connection::open_in_memory().unwrap();

        // Bring it to V13 only.
        for (version, sql) in [
            (1, MIGRATION_V1),
            (2, MIGRATION_V2),
            (3, MIGRATION_V3),
            (4, MIGRATION_V4),
            (5, MIGRATION_V5),
            (6, MIGRATION_V6),
            (7, MIGRATION_V7),
            (8, MIGRATION_V8),
            (9, MIGRATION_V9),
            (10, MIGRATION_V10),
            (11, MIGRATION_V11),
            (12, MIGRATION_V12),
            (13, MIGRATION_V13),
        ] {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version).unwrap();
        }

        conn.execute(
            "INSERT INTO purchases (ticker, shares, price_per_share, purchased_at, created_at, portfolio_id) \
             VALUES ('AAPL', 10.0, 150.0, '2025-01-15', 1736899200, 1)",
            [],
        )
        .unwrap();

        run_all(&conn).unwrap();

        // The pre-existing purchase survives verbatim.
        let (ticker, shares): (String, f64) = conn
            .query_row("SELECT ticker, shares FROM purchases", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(ticker, "AAPL");
        assert_eq!(shares, 10.0);

        // And the new structures are in place.
        assert!(table_exists(&conn, "broker_positions"));
        assert!(columns(&conn, "portfolios").contains(&"source".to_string()));
    }
}

/// V15: persist buying power.
///
/// Alpaca reports it on every account fetch and it was already mapped into
/// `RemoteAccount`, but there was nowhere to store it. Nullable, because it is
/// a brokerage concept — a provider that does not report it leaves it unset
/// rather than defaulting to zero, which would read as "no buying power".
const MIGRATION_V15: &str = "ALTER TABLE broker_accounts ADD COLUMN buying_power REAL;";

/// V16: per-account visibility, for providers where one connection exposes
/// many accounts and the person picks which ones become portfolios (SnapTrade
/// aggregates many brokerages behind one login; nothing before this needed
/// the distinction because every existing provider auto-imports everything it
/// returns).  Defaults to visible so every account synced up to this point —
/// which already has a linked portfolio — is unaffected.
const MIGRATION_V16: &str =
    "ALTER TABLE broker_accounts ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;";

/// V17: watchlist notes move into the database.
///
/// They used to live entirely in `localStorage`, keyed per watchlist — which
/// meant they were the one piece of a person's data that silently did not
/// travel with a WebDAV/NAS sync, unlike everything else in this file.
/// `notes_updated_at` is separate from `created_at` (when the row was first
/// added to the watchlist) so the UI can show "edited 3h ago" against the
/// note itself; both are nullable because most rows have no note.
const MIGRATION_V17: &str = r#"
ALTER TABLE watchlist ADD COLUMN notes TEXT;
ALTER TABLE watchlist ADD COLUMN notes_updated_at INTEGER;
"#;

/// V18: cash ledger for manual portfolios — cash dividends (paid out, not
/// reinvested) and fees.
///
/// Deliberately independent of `purchases`: buying shares does not deduct
/// from it, and there is no `amount` sign convention to get backwards —
/// dividends are stored positive, fees negative, and a portfolio's cash
/// figure is just `SUM(amount)`. This mirrors how `purchases` already works
/// (an additive lot history with no sell-tracking to reconcile against), so
/// adding real double-entry accounting here would be inconsistent with the
/// rest of the manual-portfolio model rather than more correct.
///
/// `ticker` is nullable — a fee usually isn't tied to a holding, and even a
/// dividend row may arrive without one (e.g. a summarized broker export).
const MIGRATION_V18: &str = r#"
CREATE TABLE IF NOT EXISTS cash_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('dividend', 'fee')),
    ticker       TEXT,
    amount       REAL NOT NULL,
    occurred_at  TEXT NOT NULL,
    note         TEXT,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_events_portfolio ON cash_events(portfolio_id, occurred_at);
"#;

/// V19: share sales, tied back to cash; and a last-import timestamp.
///
/// `sales` mirrors `purchases` — an additive record of shares sold. A
/// ticker's current position is `SUM(purchases.shares) - SUM(sales.shares)`;
/// cost basis on what remains uses the same blended-average method this app
/// already uses everywhere (not FIFO/LIFO lot selection), computed in
/// `summaries.ts` rather than stored here.
///
/// `cash_events.kind` gains `'sale'` — SQLite can't ALTER a CHECK constraint,
/// so the table is rebuilt the same way V11 rebuilt `watchlist`. Selling
/// shares credits their proceeds to cash exactly like a dividend does. The
/// new `source_sale_id` column links a `'sale'` cash event back to the
/// `sales` row that created it, so editing or deleting a sale can keep its
/// cash entry in sync instead of it going stale or orphaned; it is NULL for
/// every other kind.
///
/// `portfolios.last_import_at` records when a spreadsheet/Ameriprise import
/// last completed for that portfolio, so Settings can show it without each
/// import function keeping its own tracking.
const MIGRATION_V19: &str = r#"
CREATE TABLE IF NOT EXISTS sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id    INTEGER NOT NULL,
    ticker          TEXT NOT NULL,
    shares          REAL NOT NULL,
    price_per_share REAL NOT NULL,
    sold_at         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_portfolio ON sales(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_sales_ticker ON sales(ticker);

CREATE TABLE cash_events_new (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id   INTEGER NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('dividend', 'fee', 'sale')),
    ticker         TEXT,
    amount         REAL NOT NULL,
    occurred_at    TEXT NOT NULL,
    note           TEXT,
    created_at     INTEGER NOT NULL,
    source_sale_id INTEGER
);

INSERT INTO cash_events_new (id, portfolio_id, kind, ticker, amount, occurred_at, note, created_at)
    SELECT id, portfolio_id, kind, ticker, amount, occurred_at, note, created_at FROM cash_events;

DROP TABLE cash_events;

ALTER TABLE cash_events_new RENAME TO cash_events;

CREATE INDEX IF NOT EXISTS idx_cash_events_portfolio ON cash_events(portfolio_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_cash_events_source_sale ON cash_events(source_sale_id);

ALTER TABLE portfolios ADD COLUMN last_import_at INTEGER;
"#;

/// Apply all migrations in order, using PRAGMA user_version to track progress.
/// Backward-compatible: if a `_sqlx_migrations` table exists (old tauri-plugin-sql
/// database), we read the max version from it and skip those migrations.
pub fn run_all(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let migrations: &[(i64, &str)] = &[
        (1, MIGRATION_V1),
        (2, MIGRATION_V2),
        (3, MIGRATION_V3),
        (4, MIGRATION_V4),
        (5, MIGRATION_V5),
        (6, MIGRATION_V6),
        (7, MIGRATION_V7),
        (8, MIGRATION_V8),
        (9, MIGRATION_V9),
        (10, MIGRATION_V10),
        (11, MIGRATION_V11),
        (12, MIGRATION_V12),
        (13, MIGRATION_V13),
        (14, MIGRATION_V14),
        (15, MIGRATION_V15),
        (16, MIGRATION_V16),
        (17, MIGRATION_V17),
        (18, MIGRATION_V18),
        (19, MIGRATION_V19),
    ];

    let user_version: i64 =
        conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

    // If user_version is 0, check for an old tauri-plugin-sql database so we
    // don't re-run migrations that already applied.
    let applied_up_to: i64 = if user_version == 0 {
        let has_sqlx: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if has_sqlx {
            conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
        } else {
            0
        }
    } else {
        user_version
    };

    for &(version, sql) in migrations {
        if version > applied_up_to {
            conn.execute_batch(sql)?;
            conn.pragma_update(None, "user_version", &version)?;
        }
    }

    Ok(())
}
