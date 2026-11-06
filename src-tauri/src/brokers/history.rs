//! Keep account history when two copies of the database meet.
//!
//! Sync moves a whole database file, so without this the copy that loses keeps
//! nothing of its own. Most of what a brokerage reports can't be fetched again:
//! a day's value or holdings exist only if a sync saw them that day, and
//! activity disappears once it passes the brokerage's history window.
//!
//! History is therefore only ever added to. A row one copy lacks is copied in
//! and a row both have stays. The exceptions fill gaps rather than overwrite:
//! a transaction's blank fields and an unclassified kind, and a day's value,
//! where the later sync of that day wins just as it does on a single device.
//!
//! Rows follow an account or portfolio the destination already has. Which
//! accounts exist is a person's decision that travels with the database, so a
//! connection deleted on purpose is not brought back by another copy's history.
use super::store;
use rusqlite::Connection;
use std::path::Path;

/// Columns a source must have for a table to be read. A backup from before a
/// column existed still contributes its other tables.
const TRANSACTION_COLUMNS: &[&str] = &[
    "broker_account_id", "external_id", "kind", "side", "provider_symbol", "ticker", "qty",
    "price", "occurred_at", "raw", "amount", "currency", "description",
];
const SNAPSHOT_COLUMNS: &[&str] = &[
    "broker_account_id", "as_of", "equity", "cash", "positions_value", "captured_at",
];
const POSITION_COLUMNS: &[&str] = &[
    "broker_account_id", "provider_symbol", "day", "qty", "price", "market_value",
];
const ACCOUNT_VALUE_COLUMNS: &[&str] = &[
    "portfolio_id", "as_of", "positions_value", "cash_value", "total_value", "captured_at",
];

/// New rows copied in by a merge.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct HistoryMerge {
    pub transactions: usize,
    pub snapshots: usize,
    pub positions: usize,
    pub account_values: usize,
}

impl HistoryMerge {
    fn add(&mut self, other: HistoryMerge) {
        self.transactions += other.transactions;
        self.snapshots += other.snapshots;
        self.positions += other.positions;
        self.account_values += other.account_values;
    }
}

/// A read-only SQLite URI, so a merge can never write to its source, even to
/// leave sidecar files beside a verified backup.
fn read_only_uri(path: &Path) -> String {
    let mut encoded = String::new();
    for c in path.to_string_lossy().chars() {
        match c {
            '\\' => encoded.push('/'),
            '%' => encoded.push_str("%25"),
            '?' => encoded.push_str("%3F"),
            '#' => encoded.push_str("%23"),
            _ => encoded.push(c),
        }
    }
    let root = if encoded.starts_with('/') { "" } else { "/" };
    format!("file:{root}{encoded}?immutable=1")
}

/// Copy into `dest` the history in the database file at `source` that `dest`
/// lacks. All or nothing. The source must not be in use by anything else.
pub fn merge_history(dest: &Connection, source: &Path) -> rusqlite::Result<HistoryMerge> {
    dest.execute("ATTACH DATABASE ?1 AS merge_source", [read_only_uri(source)])?;
    let outcome = (|| {
        dest.execute_batch("BEGIN IMMEDIATE")?;
        match copy_rows(dest) {
            Ok(merged) => dest.execute_batch("COMMIT").map(|_| merged),
            Err(error) => {
                let _ = dest.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    })();
    let detached = dest.execute_batch("DETACH DATABASE merge_source");
    let merged = outcome?;
    detached?;
    Ok(merged)
}

fn source_has(conn: &Connection, table: &str, columns: &[&str]) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1, 'merge_source')")?;
    let present = stmt
        .query_map([table], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(columns.iter().all(|column| present.iter().any(|name| name == column)))
}

fn copy_rows(conn: &Connection) -> rusqlite::Result<HistoryMerge> {
    let mut merged = HistoryMerge::default();

    // Local ids differ between copies, so accounts match on what the brokerage
    // calls them: under the same connection, or under another connection to the
    // same provider if only one account fits.
    let has_accounts = source_has(conn, "broker_accounts", &["id", "connection_id", "provider_account_id"])?
        && source_has(conn, "broker_connections", &["id", "provider"])?;
    if has_accounts {
        conn.execute_batch(
            "CREATE TEMP TABLE merge_accounts AS
             SELECT s.id AS source_id, COALESCE(
               (SELECT d.id FROM main.broker_accounts d
                 WHERE d.connection_id = s.connection_id
                   AND d.provider_account_id = s.provider_account_id),
               (SELECT MIN(d.id) FROM main.broker_accounts d
                  JOIN main.broker_connections dc ON dc.id = d.connection_id
                 WHERE d.provider_account_id = s.provider_account_id AND dc.provider = sc.provider
                HAVING COUNT(*) = 1)
             ) AS dest_id
             FROM merge_source.broker_accounts s
             JOIN merge_source.broker_connections sc ON sc.id = s.connection_id;
             DELETE FROM temp.merge_accounts WHERE dest_id IS NULL;",
        )?;

        if source_has(conn, "broker_transactions", TRANSACTION_COLUMNS)? {
            // Today's provisional fills are this device's own stand-ins until
            // the history reports them, not history.
            merged.transactions = conn.execute(
                "INSERT OR IGNORE INTO main.broker_transactions
                   (broker_account_id, external_id, kind, side, provider_symbol, ticker, qty,
                    price, occurred_at, raw, amount, currency, description)
                 SELECT m.dest_id, t.external_id, t.kind, t.side, t.provider_symbol, t.ticker,
                        t.qty, t.price, t.occurred_at, t.raw, t.amount, t.currency, t.description
                 FROM merge_source.broker_transactions t
                 JOIN temp.merge_accounts m ON m.source_id = t.broker_account_id
                 WHERE t.external_id NOT LIKE ?1 || '%'",
                [store::PROVISIONAL_PREFIX],
            )?;
            conn.execute_batch(
                "UPDATE main.broker_transactions AS d SET
                   amount      = COALESCE(d.amount, s.amount),
                   currency    = COALESCE(d.currency, s.currency),
                   description = COALESCE(d.description, s.description),
                   kind        = CASE WHEN d.kind = 'other' THEN s.kind
                                      WHEN d.kind = 'fee' AND s.kind = 'tax' THEN s.kind
                                      ELSE d.kind END
                 FROM merge_source.broker_transactions s
                 JOIN temp.merge_accounts m ON m.source_id = s.broker_account_id
                 WHERE d.broker_account_id = m.dest_id AND d.external_id = s.external_id
                   AND ((d.amount IS NULL AND s.amount IS NOT NULL)
                     OR (d.currency IS NULL AND s.currency IS NOT NULL)
                     OR (d.description IS NULL AND s.description IS NOT NULL)
                     OR (d.kind = 'other' AND s.kind <> 'other')
                     OR (d.kind = 'fee' AND s.kind = 'tax'));",
            )?;
        }

        if source_has(conn, "broker_account_snapshots", SNAPSHOT_COLUMNS)? {
            merged.snapshots = conn.execute(
                "INSERT OR IGNORE INTO main.broker_account_snapshots
                   (broker_account_id, as_of, equity, cash, positions_value, captured_at)
                 SELECT m.dest_id, s.as_of, s.equity, s.cash, s.positions_value, s.captured_at
                 FROM merge_source.broker_account_snapshots s
                 JOIN temp.merge_accounts m ON m.source_id = s.broker_account_id",
                [],
            )?;
            conn.execute_batch(
                "UPDATE main.broker_account_snapshots AS d SET
                   equity          = COALESCE(s.equity, d.equity),
                   cash            = COALESCE(s.cash, d.cash),
                   positions_value = COALESCE(s.positions_value, d.positions_value),
                   captured_at     = s.captured_at
                 FROM merge_source.broker_account_snapshots s
                 JOIN temp.merge_accounts m ON m.source_id = s.broker_account_id
                 WHERE d.broker_account_id = m.dest_id AND d.as_of = s.as_of
                   AND s.captured_at > d.captured_at;",
            )?;
        }

        if source_has(conn, "broker_position_history", POSITION_COLUMNS)? {
            merged.positions = conn.execute(
                "INSERT OR IGNORE INTO main.broker_position_history
                   (broker_account_id, provider_symbol, day, qty, price, market_value)
                 SELECT m.dest_id, p.provider_symbol, p.day, p.qty, p.price, p.market_value
                 FROM merge_source.broker_position_history p
                 JOIN temp.merge_accounts m ON m.source_id = p.broker_account_id",
                [],
            )?;
        }

        // A copied trade may be the one a provisional row here stood in for.
        let mut stmt = conn.prepare("SELECT DISTINCT dest_id FROM temp.merge_accounts")?;
        let accounts = stmt
            .query_map([], |row| row.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for account in accounts {
            store::reconcile_provisional(conn, account)?;
        }
        conn.execute_batch("DROP TABLE temp.merge_accounts;")?;
    }

    if source_has(conn, "journal_account_values", ACCOUNT_VALUE_COLUMNS)?
        && source_has(conn, "portfolios", &["id", "name"])?
    {
        merged.account_values = conn.execute(
            "INSERT OR IGNORE INTO main.journal_account_values
               (portfolio_id, as_of, positions_value, cash_value, total_value, captured_at)
             SELECT d.id, v.as_of, v.positions_value, v.cash_value, v.total_value, v.captured_at
             FROM merge_source.journal_account_values v
             JOIN merge_source.portfolios s ON s.id = v.portfolio_id
             JOIN main.portfolios d ON d.name = s.name AND d.broker_account_id IS NULL",
            [],
        )?;
    }

    Ok(merged)
}

/// Put back history that earlier whole-file replacements dropped, from the
/// recovery copies those replacements left behind. A copy that can't be read is
/// skipped: it doesn't stop the others, and it isn't touched.
pub fn recover_from_backups(
    backups: &[std::path::PathBuf],
    mut merge_one: impl FnMut(&Path) -> Result<HistoryMerge, String>,
) -> (HistoryMerge, usize) {
    let mut total = HistoryMerge::default();
    let mut skipped = 0;
    for backup in backups {
        match merge_one(backup) {
            Ok(merged) => total.add(merged),
            Err(error) => {
                eprintln!("[history] skipped {}: {error}", backup.display());
                skipped += 1;
            }
        }
    }
    (total, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use rusqlite::params;
    use std::path::PathBuf;

    struct Copy {
        path: PathBuf,
        conn: Connection,
    }

    fn copy(dir: &Path, name: &str) -> Copy {
        let path = dir.join(name);
        let conn = Connection::open(&path).unwrap();
        migrations::run_all(&conn).unwrap();
        Copy { path, conn }
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stockfolio-history-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn account(conn: &Connection, id: i64, connection: &str, remote: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO broker_connections (id, provider, environment, label, credential_ref, created_at)
             VALUES (?1, 'snaptrade', 'read', 'Test', 'ref', 1)",
            [connection],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO broker_accounts (id, connection_id, provider_account_id) VALUES (?1, ?2, ?3)",
            params![id, connection, remote],
        )
        .unwrap();
    }

    fn tx(conn: &Connection, account: i64, external: &str, kind: &str, amount: Option<f64>) {
        conn.execute(
            "INSERT INTO broker_transactions
               (broker_account_id, external_id, kind, provider_symbol, occurred_at, amount)
             VALUES (?1, ?2, ?3, 'AAA', '2025-01-02', ?4)",
            params![account, external, kind, amount],
        )
        .unwrap();
    }

    fn snapshot(conn: &Connection, account: i64, day: &str, equity: f64, captured: i64) {
        conn.execute(
            "INSERT INTO broker_account_snapshots (broker_account_id, as_of, equity, captured_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![account, day, equity, captured],
        )
        .unwrap();
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn each_copy_gains_what_it_lacks_and_they_end_up_with_the_same_history() {
        let dir = temp_dir();
        let a = copy(&dir, "a.db");
        let b = copy(&dir, "b.db");
        // The same brokerage account under different local ids.
        account(&a.conn, 1, "conn", "remote-1");
        account(&b.conn, 7, "conn", "remote-1");
        tx(&a.conn, 1, "both", "dividend", Some(5.0));
        tx(&b.conn, 7, "both", "dividend", Some(5.0));
        tx(&a.conn, 1, "only-a", "dividend", Some(1.0));
        tx(&b.conn, 7, "only-b", "dividend", Some(2.0));
        snapshot(&a.conn, 1, "2025-01-01", 100.0, 10);
        snapshot(&b.conn, 7, "2025-01-02", 110.0, 20);
        store::record_position_day(&a.conn, 1, "AAA", "2025-01-01", 3.0, Some(10.0)).unwrap();
        store::record_position_day(&b.conn, 7, "AAA", "2025-01-02", 3.0, Some(11.0)).unwrap();

        let into_b = merge_history(&b.conn, &a.path).unwrap();
        assert_eq!(into_b, HistoryMerge { transactions: 1, snapshots: 1, positions: 1, account_values: 0 });
        let into_a = merge_history(&a.conn, &b.path).unwrap();
        assert_eq!(into_a, HistoryMerge { transactions: 1, snapshots: 1, positions: 1, account_values: 0 });
        for conn in [&a.conn, &b.conn] {
            assert_eq!(count(conn, "broker_transactions"), 3);
            assert_eq!(count(conn, "broker_account_snapshots"), 2);
            assert_eq!(count(conn, "broker_position_history"), 2);
        }
        // Running it again changes nothing.
        assert_eq!(merge_history(&a.conn, &b.path).unwrap(), HistoryMerge::default());
    }

    #[test]
    fn a_saved_row_is_never_overwritten_only_its_gaps_are_filled() {
        let dir = temp_dir();
        let a = copy(&dir, "a.db");
        let b = copy(&dir, "b.db");
        account(&a.conn, 1, "conn", "remote-1");
        account(&b.conn, 1, "conn", "remote-1");
        tx(&a.conn, 1, "same", "dividend", Some(5.0));
        tx(&b.conn, 1, "same", "fee", Some(999.0));
        tx(&a.conn, 1, "blank", "fill", None);
        tx(&b.conn, 1, "blank", "fill", Some(7.0));
        tx(&a.conn, 1, "unclassified", "other", Some(3.0));
        tx(&b.conn, 1, "unclassified", "tax", Some(3.0));

        merge_history(&a.conn, &b.path).unwrap();
        let row = |id: &str| -> (String, Option<f64>) {
            a.conn
                .query_row(
                    "SELECT kind, amount FROM broker_transactions WHERE external_id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap()
        };
        assert_eq!(row("same"), ("dividend".to_string(), Some(5.0)));
        assert_eq!(row("blank"), ("fill".to_string(), Some(7.0)));
        assert_eq!(row("unclassified"), ("tax".to_string(), Some(3.0)));
    }

    #[test]
    fn the_later_sync_of_a_day_wins_on_every_copy() {
        let dir = temp_dir();
        let a = copy(&dir, "a.db");
        let b = copy(&dir, "b.db");
        account(&a.conn, 1, "conn", "remote-1");
        account(&b.conn, 1, "conn", "remote-1");
        snapshot(&a.conn, 1, "2025-01-01", 100.0, 10);
        snapshot(&b.conn, 1, "2025-01-01", 150.0, 20);
        merge_history(&b.conn, &a.path).unwrap();
        merge_history(&a.conn, &b.path).unwrap();
        for conn in [&a.conn, &b.conn] {
            let equity: f64 = conn
                .query_row("SELECT equity FROM broker_account_snapshots", [], |r| r.get(0))
                .unwrap();
            assert_eq!(equity, 150.0);
        }
    }

    #[test]
    fn a_deleted_account_is_not_brought_back_by_another_copys_history() {
        let dir = temp_dir();
        let kept = copy(&dir, "kept.db");
        let other = copy(&dir, "other.db");
        account(&kept.conn, 1, "conn", "remote-1");
        account(&other.conn, 1, "conn", "remote-1");
        account(&other.conn, 2, "deleted-here", "remote-2");
        tx(&other.conn, 2, "theirs", "dividend", Some(1.0));
        snapshot(&other.conn, 2, "2025-01-01", 100.0, 10);

        assert_eq!(merge_history(&kept.conn, &other.path).unwrap(), HistoryMerge::default());
        assert_eq!(count(&kept.conn, "broker_accounts"), 1);
        assert_eq!(count(&kept.conn, "broker_transactions"), 0);
    }

    #[test]
    fn an_account_reconnected_under_a_new_connection_keeps_its_history() {
        let dir = temp_dir();
        let a = copy(&dir, "a.db");
        let b = copy(&dir, "b.db");
        account(&a.conn, 1, "old-login", "remote-1");
        account(&b.conn, 1, "new-login", "remote-1");
        tx(&a.conn, 1, "old-row", "dividend", Some(1.0));
        assert_eq!(merge_history(&b.conn, &a.path).unwrap().transactions, 1);
    }

    #[test]
    fn provisional_fills_stay_on_their_own_device_and_real_rows_retire_them() {
        let dir = temp_dir();
        let a = copy(&dir, "a.db");
        let b = copy(&dir, "b.db");
        account(&a.conn, 1, "conn", "remote-1");
        account(&b.conn, 1, "conn", "remote-1");
        let fill = |conn: &Connection, id: &str| {
            conn.execute(
                "INSERT INTO broker_transactions
                   (broker_account_id, external_id, kind, side, provider_symbol, qty, price, occurred_at)
                 VALUES (1, ?1, 'fill', 'buy', 'AAA', 2.0, 10.0, '2025-01-02')",
                [id],
            )
            .unwrap();
        };
        fill(&a.conn, "order:today");
        fill(&b.conn, "history-row");
        assert_eq!(merge_history(&b.conn, &a.path).unwrap().transactions, 0, "not copied");
        merge_history(&a.conn, &b.path).unwrap();
        let ids: Vec<String> = a
            .conn
            .prepare("SELECT external_id FROM broker_transactions")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(ids, vec!["history-row"], "counted once");
    }

    #[test]
    fn manual_account_values_follow_the_portfolio_by_name() {
        let dir = temp_dir();
        let a = copy(&dir, "a.db");
        let b = copy(&dir, "b.db");
        let portfolio = |conn: &Connection, id: i64, name: &str| {
            conn.execute(
                "INSERT INTO portfolios (id, name, sort_order, is_starred, created_at) VALUES (?1, ?2, 0, 0, 1)",
                params![id, name],
            )
            .unwrap();
        };
        portfolio(&a.conn, 5, "Ameriprise");
        portfolio(&b.conn, 9, "Ameriprise");
        portfolio(&b.conn, 10, "Removed elsewhere");
        for (id, day) in [(9, "2025-01-01"), (10, "2025-01-02")] {
            b.conn
                .execute(
                    "INSERT INTO journal_account_values (portfolio_id, as_of, positions_value, captured_at)
                     VALUES (?1, ?2, 100.0, 1)",
                    params![id, day],
                )
                .unwrap();
        }
        assert_eq!(merge_history(&a.conn, &b.path).unwrap().account_values, 1);
        let owner: i64 = a
            .conn
            .query_row("SELECT portfolio_id FROM journal_account_values", [], |r| r.get(0))
            .unwrap();
        assert_eq!(owner, 5);
    }

    #[test]
    fn a_backup_from_an_older_version_still_gives_what_it_has() {
        let dir = temp_dir();
        let live = copy(&dir, "live.db");
        let old = copy(&dir, "old.db");
        account(&live.conn, 1, "conn", "remote-1");
        account(&old.conn, 1, "conn", "remote-1");
        snapshot(&old.conn, 1, "2025-01-01", 100.0, 10);
        old.conn.execute_batch("DROP TABLE broker_position_history; ALTER TABLE broker_transactions DROP COLUMN description;").unwrap();
        let merged = merge_history(&live.conn, &old.path).unwrap();
        assert_eq!(merged.snapshots, 1);
        assert_eq!(merged.transactions, 0);
    }

    #[test]
    fn a_failed_merge_changes_nothing_and_the_connection_stays_usable() {
        let dir = temp_dir();
        let live = copy(&dir, "live.db");
        account(&live.conn, 1, "conn", "remote-1");
        let garbage = dir.join("garbage.db");
        std::fs::write(&garbage, b"this is not a database at all").unwrap();
        assert!(merge_history(&live.conn, &garbage).is_err());
        assert_eq!(count(&live.conn, "broker_accounts"), 1);
        // The attachment was released, so the next merge can attach again.
        let other = copy(&dir, "other.db");
        assert!(merge_history(&live.conn, &other.path).is_ok());
    }

    #[test]
    fn merging_never_writes_to_the_source_and_handles_awkward_paths() {
        let dir = temp_dir().join("a folder #1 100%?");
        std::fs::create_dir_all(&dir).unwrap();
        let live = copy(&dir, "live.db");
        let source = copy(&dir, "source.db");
        account(&live.conn, 1, "conn", "remote-1");
        account(&source.conn, 1, "conn", "remote-1");
        tx(&source.conn, 1, "row", "dividend", Some(1.0));
        source.conn.execute_batch("PRAGMA journal_mode=DELETE;").unwrap();
        let before = std::fs::read(&source.path).unwrap();
        assert_eq!(merge_history(&live.conn, &source.path).unwrap().transactions, 1);
        assert_eq!(std::fs::read(&source.path).unwrap(), before);
    }

    /// Against copies of real data: never point these at a live database.
    #[test]
    #[ignore = "requires STOCKFOLIO_TEST_DB, a copy of a real database, and STOCKFOLIO_TEST_SOURCES, a folder of copies"]
    fn merges_real_copies() {
        let db = std::env::var("STOCKFOLIO_TEST_DB").unwrap();
        let conn = Connection::open(db).unwrap();
        migrations::run_all(&conn).unwrap();
        let mut sources: Vec<PathBuf> = std::fs::read_dir(std::env::var("STOCKFOLIO_TEST_SOURCES").unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "db"))
            .collect();
        sources.sort();
        let (total, skipped) = recover_from_backups(&sources, |path| {
            merge_history(&conn, path).map_err(|e| e.to_string())
        });
        println!("merged {} copies, {skipped} unreadable: {total:?}", sources.len());
    }

    #[test]
    fn recovering_from_backups_skips_a_bad_one_and_totals_the_rest() {
        let dir = temp_dir();
        let live = copy(&dir, "live.db");
        account(&live.conn, 1, "conn", "remote-1");
        let good = copy(&dir, "good.db");
        account(&good.conn, 1, "conn", "remote-1");
        snapshot(&good.conn, 1, "2025-01-01", 100.0, 10);
        let bad = dir.join("bad.db");
        std::fs::write(&bad, b"corrupt").unwrap();
        let (total, skipped) = recover_from_backups(&[bad, good.path.clone()], |path| {
            merge_history(&live.conn, path).map_err(|e| e.to_string())
        });
        assert_eq!(skipped, 1);
        assert_eq!(total.snapshots, 1);
    }
}
