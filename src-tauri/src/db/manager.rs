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

    pub fn get_path(&self) -> PathBuf {
        self.path.lock().unwrap().clone()
    }
}
