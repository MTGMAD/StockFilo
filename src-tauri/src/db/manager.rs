use rusqlite::{Connection, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use fs2::FileExt;

use super::migrations;

pub struct DbManager {
    pub conn: Mutex<Connection>,
    pub path: Mutex<PathBuf>,
    file_lock: Mutex<std::fs::File>,
}

impl DbManager {
    /// Open (or create) the SQLite database at `path`, enable WAL mode,
    /// and apply any pending migrations.
    pub fn open(path: &Path) -> Result<Self, String> {
        let file_lock = Self::lock_file(path)?;
        let conn = Connection::open(path).map_err(|e| e.to_string())?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;

        migrations::run_all(&conn).map_err(|e| e.to_string())?;

        Ok(DbManager {
            conn: Mutex::new(conn),
            path: Mutex::new(path.to_path_buf()),
            file_lock: Mutex::new(file_lock),
        })
    }

    fn lock_file(path: &Path) -> Result<std::fs::File, String> {
        let lock = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .open(path.with_extension("stockfolio-lock")).map_err(|e| e.to_string())?;
        lock.try_lock_exclusive().map_err(|_| "This database is already open in another Stockfolio backend. Use its browser connection instead of starting a second backend.".to_string())?;
        Ok(lock)
    }

    /// Copy a consistent snapshot and switch the managed connection only after
    /// settings are saved. The destination is created atomically, never replaced.
    pub fn relocate(&self, destination: &Path, save_settings: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        let mut path = self.path.lock().map_err(|e| e.to_string())?;
        if *path == destination { return Ok(()); }
        if destination.exists() { return Err("The selected folder already contains a database. Nothing was overwritten. Use a sync target to review and import it.".into()); }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut file_lock = self.file_lock.lock().map_err(|e| e.to_string())?;
        let destination_lock = Self::lock_file(destination)?;
        let staged = destination.with_extension(format!("move-{}.db", uuid::Uuid::new_v4()));
        let result = (|| {
            conn.execute("VACUUM INTO ?1", [staged.to_string_lossy().as_ref()]).map_err(|e| e.to_string())?;
            std::fs::OpenOptions::new().write(true).open(&staged).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
            let copied = Connection::open(&staged).map_err(|e| e.to_string())?;
            let integrity: String = copied.query_row("PRAGMA quick_check", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            if integrity != "ok" { return Err("Database copy verification failed; the original database is still in use.".into()); }
            drop(copied);
            std::fs::hard_link(&staged, destination).map_err(|e| format!("Cannot create the new database safely: {e}. The original is still in use."))?;
            #[cfg(unix)]
            std::fs::File::open(destination.parent().unwrap()).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
            let new_conn = Connection::open(destination).map_err(|e| e.to_string())?;
            new_conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
            save_settings()?;
            *conn = new_conn;
            *path = destination.to_path_buf();
            *file_lock = destination_lock;
            Ok(())
        })();
        let _ = std::fs::remove_file(&staged);
        result
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

#[cfg(test)]
mod safety_tests {
    use super::*;
    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("stockfolio-manager-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap(); path
    }
    #[test]
    fn a_second_backend_cannot_open_the_same_live_database() {
        let dir = directory(); let path = dir.join("local.db");
        let db = DbManager::open(&path).unwrap();
        assert!(DbManager::open(&path).is_err());
        drop(db); assert!(DbManager::open(&path).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn relocation_never_overwrites_an_existing_destination() {
        let dir = directory(); let path = dir.join("local.db"); let destination = dir.join("existing.db");
        let db = DbManager::open(&path).unwrap(); std::fs::write(&destination, b"existing data").unwrap();
        assert!(db.relocate(&destination, || Ok(())).is_err());
        assert_eq!(std::fs::read(destination).unwrap(), b"existing data"); assert_eq!(db.get_path(), path);
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn relocation_includes_wal_records_and_switches_the_live_connection() {
        let dir = directory(); let path = dir.join("local.db"); let destination = dir.join("new.db");
        let db = DbManager::open(&path).unwrap();
        db.with_conn(|conn| conn.execute("INSERT INTO portfolios(name,sort_order,is_starred,created_at) VALUES ('Committed in WAL',0,0,1)", [])).unwrap();
        db.relocate(&destination, || Ok(())).unwrap(); assert_eq!(db.get_path(), destination);
        db.with_conn(|conn| conn.execute("UPDATE portfolios SET name='Written after moving' WHERE name='Committed in WAL'", [])).unwrap();
        drop(db);
        let new = Connection::open(&destination).unwrap();
        assert_eq!(new.query_row("SELECT COUNT(*) FROM portfolios WHERE name='Written after moving'", [], |row| row.get::<_, i64>(0)).unwrap(),1);
        let old = Connection::open(&path).unwrap();
        assert_eq!(old.query_row("SELECT COUNT(*) FROM portfolios WHERE name='Committed in WAL'", [], |row| row.get::<_, i64>(0)).unwrap(),1);
        drop(new); drop(old); std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_settings_save_keeps_the_original_connection_and_records() {
        let dir = directory(); let path = dir.join("local.db"); let destination = dir.join("new.db");
        let db = DbManager::open(&path).unwrap();
        assert!(db.relocate(&destination, || Err("settings storage unavailable".into())).is_err());
        assert_eq!(db.get_path(), path);
        assert!(db.with_conn(|conn| conn.execute("INSERT INTO portfolios(name,sort_order,is_starred,created_at) VALUES ('Still usable',0,0,1)", [])).is_ok());
        drop(db); std::fs::remove_dir_all(dir).unwrap();
    }
}
