use rusqlite::{Connection, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::migrations;

pub struct DbManager {
    pub conn: Mutex<Connection>,
    pub path: Mutex<PathBuf>,
}

impl DbManager {
    /// Open (or create) the SQLite database at `path`, enable WAL mode,
    /// and apply any pending migrations.
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;

        migrations::run_all(&conn).map_err(|e| e.to_string())?;

        Ok(DbManager {
            conn: Mutex::new(conn),
            path: Mutex::new(path.to_path_buf()),
        })
    }

    /// Execute a closure that receives a `&Connection`.  Propagates both
    /// mutex-poison errors and rusqlite errors as `String`.
    pub fn with_conn<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&Connection) -> SqlResult<R>,
    {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        f(&conn).map_err(|e| e.to_string())
    }

    /// Execute a closure inside a transaction, committing on `Ok` and rolling
    /// back on `Err`.
    ///
    /// `with_conn` hands out a shared `&Connection`, which cannot start a
    /// transaction the usual way; `unchecked_transaction` is rusqlite's
    /// supported escape hatch for exactly this case.  Safe here because the
    /// connection is behind a `Mutex`, so no second transaction can overlap.
    pub fn with_txn<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&Connection) -> SqlResult<R>,
    {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let txn = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let out = f(&txn).map_err(|e| e.to_string())?;
        txn.commit().map_err(|e| e.to_string())?;
        Ok(out)
    }

    pub fn get_path(&self) -> PathBuf {
        self.path.lock().unwrap().clone()
    }
}
