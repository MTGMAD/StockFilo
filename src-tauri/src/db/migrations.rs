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
