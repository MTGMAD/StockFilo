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
