//! Review-before-transfer sync. Time stamps never authorize a replacement.
use super::*;
use fs2::FileExt;
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Manager;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecordSummary {
    pub financial_records: u64,
    pub portfolios: u64,
    pub watchlist_items: u64,
    pub notes: u64,
    pub empty: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncPreview {
    pub confirmation_id: String,
    pub target_id: String,
    pub target_label: String,
    pub first_sync: bool,
    pub remote_exists: bool,
    pub conflict: bool,
    pub local: RecordSummary,
    pub remote: Option<RecordSummary>,
    pub upload_allowed: bool,
    pub upload_blocked_reason: Option<String>,
    pub restore: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SyncBackup {
    pub id: String,
    pub created_at: u64,
    pub size: u64,
}

#[derive(Clone)]
struct Pending {
    target: SyncTarget,
    local_fingerprint: String,
    remote_version: String,
    remote_etag: Option<String>,
    created: Instant,
    restore: bool,
}
fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    static REVIEWS: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    REVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn review_open() -> bool {
    pending().lock().map_or(true, |reviews| reviews.values().any(|review| review.created.elapsed() < Duration::from_secs(600)))
}

/// Broker syncs rewrite positions, balances and timestamps on their own
/// timers, which would stale every review. Reviews and transfers hold this
/// gate exclusively and advance its generation, so a broker sync that began
/// earlier drops its results at its next write instead of landing them.
static BROKER_GATE: tokio::sync::RwLock<u64> = tokio::sync::RwLock::const_new(0);
pub(super) async fn exclusive() -> tokio::sync::RwLockWriteGuard<'static, u64> {
    let mut generation = BROKER_GATE.write().await;
    *generation += 1;
    generation
}
pub(crate) struct BrokerWrites(u64);
impl BrokerWrites {
    /// None while a review is open: skip this round, the next tick retries.
    pub(crate) async fn begin() -> Option<Self> {
        let generation = BROKER_GATE.read().await;
        (!review_open()).then(|| Self(*generation))
    }
    /// Hold across one write. None once a review began after `begin`.
    pub(crate) async fn permit(&self) -> Option<tokio::sync::RwLockReadGuard<'static, u64>> {
        let generation = BROKER_GATE.read().await;
        (*generation == self.0 && !review_open()).then_some(generation)
    }
}

fn checksum(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn io(error: impl std::fmt::Display) -> String { error.to_string() }
fn changed() -> String { "Data changed since this review. Nothing was replaced. Refresh the review and choose again.".into() }

struct Staged(PathBuf);
impl Drop for Staged { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }
fn stage(db: &DbManager, bytes: &[u8]) -> Result<Staged, String> {
    let path = db.get_path().with_extension(format!("stage-{}.db", uuid::Uuid::new_v4()));
    durable_write(&path, bytes)?;
    Ok(Staged(path))
}
fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(path).and_then(|file| file.sync_all()).map_err(io)?;
    Ok(())
}
fn durable_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(io)?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; file.set_permissions(fs::Permissions::from_mode(0o600)).map_err(io)?; }
    file.write_all(bytes).map_err(io)?;
    file.sync_all().map_err(io)
}

pub(super) fn validate(path: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(io)?;
    check_database(&conn)?;
    crate::db::migrations::run_all(&conn).map_err(|e| format!("Cannot migrate the database: {e}"))?;
    let mut foreign_keys = conn.prepare("PRAGMA foreign_key_check").map_err(io)?;
    if foreign_keys.query([]).map_err(io)?.next().map_err(io)?.is_some() {
        return Err("The database contains broken references. Nothing was replaced.".into());
    }
    drop(foreign_keys);
    conn.execute_batch("PRAGMA journal_mode=DELETE;").map_err(io)?;
    drop(conn);
    // Windows refuses FlushFileBuffers on read-only handles (os error 5).
    fs::OpenOptions::new().write(true).open(path).and_then(|file| file.sync_all()).map_err(io)
}
fn check_database(conn: &Connection) -> Result<(), String> {
    let check: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0)).map_err(|e| format!("Invalid database: {e}"))?;
    if check != "ok" { return Err(format!("Invalid database: {check}")); }
    let tables: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('stocks','purchases')", [], |row| row.get(0)).map_err(io)?;
    if tables != 2 { return Err("The file is not a Stockfolio database".into()); }
    Ok(())
}

/// Stable logical fingerprints ignore volatile quote caches and file layout.
/// Every other user table, including unknown future tables, participates.
fn fingerprint(conn: &Connection) -> Result<String, String> { hash_records(conn, |_, _| true) }
/// Written by broker refreshes on their own timers and fetched again from the
/// brokerage on the next one, so not a change a person made.
fn broker_refreshed(table: &str, column: &str) -> bool {
    match table {
        "broker_positions" | "broker_transactions" | "broker_account_snapshots" => true,
        "broker_accounts" => matches!(column, "account_mask" | "currency" | "equity" | "cash" | "buying_power" | "snapshot_at" | "history_version"),
        "broker_connections" => matches!(column, "last_synced_at" | "last_sync_status"),
        _ => false,
    }
}
/// `fingerprint` without broker-refreshed data: what a person changed.
fn records_fingerprint(conn: &Connection) -> Result<String, String> {
    hash_records(conn, |table, column| !broker_refreshed(table, column))
}
fn hash_records(conn: &Connection, keep: impl Fn(&str, &str) -> bool) -> Result<String, String> {
    let mut tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('stocks','changes_log','_sf_config') ORDER BY name").map_err(io)?;
    let names = tables.query_map([], |row| row.get::<_, String>(0)).map_err(io)?.collect::<Result<Vec<_>, _>>().map_err(io)?;
    let mut hash = Sha256::new();
    for name in names {
        let mut stmt = conn.prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\""))).map_err(io)?;
        let columns: Vec<usize> = (0..stmt.column_count()).filter(|&index| stmt.column_name(index).is_ok_and(|column| keep(&name, column))).collect();
        if columns.is_empty() { continue; }
        hash.update((name.len() as u64).to_le_bytes()); hash.update(name.as_bytes());
        let mut rows = stmt.query([]).map_err(io)?;
        let mut encoded = Vec::new();
        while let Some(row) = rows.next().map_err(io)? {
            let mut values = Vec::new();
            for &index in &columns {
                let (kind, bytes) = match row.get_ref(index).map_err(io)? {
                    ValueRef::Null => (0, Vec::new()),
                    ValueRef::Integer(value) => (1, value.to_le_bytes().to_vec()),
                    ValueRef::Real(value) => (2, value.to_bits().to_le_bytes().to_vec()),
                    ValueRef::Text(value) => (3, value.to_vec()),
                    ValueRef::Blob(value) => (4, value.to_vec()),
                };
                values.push(kind); values.extend_from_slice(&(bytes.len() as u64).to_le_bytes()); values.extend_from_slice(&bytes);
            }
            encoded.push(values);
        }
        encoded.sort();
        hash.update((encoded.len() as u64).to_le_bytes());
        for row in encoded { hash.update((row.len() as u64).to_le_bytes()); hash.update(row); }
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn summary(conn: &Connection) -> Result<RecordSummary, String> {
    fn count(conn: &Connection, table: &str) -> Result<u64, String> {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).map_err(io)
    }
    let mut financial_records = 0;
    for table in ["purchases", "sales", "cash_events", "cash_anchors", "broker_positions", "broker_transactions"] { financial_records += count(conn, table)?; }
    let notes = count(conn, "journal_notes")?;
    let watchlist_items = count(conn, "watchlist")? + count(conn, "favorites")?;
    Ok(RecordSummary { financial_records, portfolios: count(conn, "portfolios")?, watchlist_items, notes, empty: financial_records + notes + watchlist_items == 0 })
}
struct Inspection {
    fingerprint: String,
    records: String,
    broker_synced_at: Option<i64>,
    summary: RecordSummary,
}
fn inspect(path: &Path) -> Result<Inspection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(io)?;
    check_database(&conn)?;
    let broker_synced_at = conn.query_row("SELECT MAX(last_synced_at) FROM broker_connections", [], |row| row.get(0)).ok().flatten();
    Ok(Inspection { fingerprint: fingerprint(&conn)?, records: records_fingerprint(&conn)?, broker_synced_at, summary: summary(&conn)? })
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(io)?.join("backups"))
}
/// Called with the live connection locked, before duplicate account cleanup.
pub(crate) fn backup_broker_database(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    let directory = backup_dir(app)?;
    fs::create_dir_all(&directory).map_err(io)?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(io)?; }
    let staged = Staged(directory.join(format!("broker-stage-{}.tmp", uuid::Uuid::new_v4())));
    conn.execute("VACUUM INTO ?1", [staged.0.to_string_lossy().as_ref()]).map_err(io)?;
    save_backup(&directory, "broker-reconciliation", &fs::read(&staged.0).map_err(io)?)?;
    Ok(())
}
fn save_backup(directory: &Path, kind: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(directory).map_err(io)?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).map_err(io)?; }
    let name = format!("{kind}-{}-{}.db", now_secs(), uuid::Uuid::new_v4());
    let destination = directory.join(name);
    let temp = destination.with_extension("tmp");
    durable_write(&temp, bytes)?;
    let conn = Connection::open_with_flags(&temp, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(io)?;
    check_database(&conn)?;
    drop(conn);
    if checksum(&fs::read(&temp).map_err(io)?) != checksum(bytes) { return Err("Backup verification failed; nothing was replaced".into()); }
    fs::rename(&temp, &destination).map_err(io)?;
    durable_write(&destination.with_extension("db.sha256"), checksum(bytes).as_bytes())?;
    sync_directory(directory)?;
    Ok(destination)
}

fn verify_backup(path: &Path) -> Result<(), String> {
    let expected = fs::read_to_string(path.with_extension("db.sha256"))
        .map_err(|_| "This backup has no verification record. It has been preserved, but cannot be restored automatically.".to_string())?;
    let actual = checksum(&fs::read(path).map_err(io)?);
    if actual != expected.trim() { return Err("Backup checksum verification failed. The current database has not been changed.".into()); }
    Ok(())
}

/// A rename from the live database's own directory is atomic. Never copy
/// directly onto the open/live file, including on the recovery path.
pub(super) fn install(db: &DbManager, staged: &Path, backups: &Path, expected: Option<&str>) -> Result<(), String> {
    validate(staged)?;
    let path = db.path.lock().map_err(io)?;
    let mut current = db.conn.lock().map_err(io)?;
    if let Some(expected) = expected { if fingerprint(&current)? != expected { return Err(changed()); } }
    let (busy, _, _): (i64, i64, i64) = current.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(io)?;
    if busy != 0 { return Err("The local database is busy. Nothing was replaced.".into()); }
    let backup = save_backup(backups, "local", &fs::read(&*path).map_err(io)?)?;
    // Ensure replacement is on the same filesystem, even for backup restores.
    let adjacent = path.with_extension(format!("install-{}.db", uuid::Uuid::new_v4()));
    durable_write(&adjacent, &fs::read(staged).map_err(io)?)?;
    let adjacent = Staged(adjacent);
    let old = std::mem::replace(&mut *current, Connection::open_in_memory().map_err(io)?);
    drop(old);
    let reopen = |path: &Path| -> Result<Connection, String> {
        let conn = Connection::open(path).map_err(io)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(io)?;
        Ok(conn)
    };
    if let Err(error) = fs::rename(&adjacent.0, &*path) {
        *current = reopen(&path)?;
        return Err(format!("Database replacement failed: {error}. The original database is still in use."));
    }
    match sync_directory(path.parent().unwrap()).and_then(|_| reopen(&path)) {
        Ok(conn) => { *current = conn; Ok(()) }
        Err(error) => {
            let recovery = path.with_extension(format!("recover-{}.db", uuid::Uuid::new_v4()));
            durable_write(&recovery, &fs::read(&backup).map_err(io)?)?;
            fs::rename(&recovery, &*path).map_err(|e| format!("{error}; recovery backup is at {}: {e}", backup.display()))?;
            let durability = sync_directory(path.parent().unwrap());
            *current = reopen(&path)?;
            durability.map_err(|failure| format!("The previous database was reopened, but disk durability could not be confirmed: {failure}. Recovery backup: {}", backup.display()))?;
            Err(format!("Import failed; the previous database was restored: {error}"))
        }
    }
}

struct RemoteImage { bytes: Option<Vec<u8>>, etag: Option<String> }
impl RemoteImage {
    fn version(&self) -> String { self.bytes.as_ref().map(|bytes| checksum(bytes)).unwrap_or_else(|| "missing".into()) }
}
fn remote_path(target: &SyncTarget) -> Result<PathBuf, String> {
    target.path.as_deref().map(normalize_local_path).ok_or_else(|| "Sync folder is missing".into())
}
fn remote_url(target: &SyncTarget) -> Result<String, String> {
    target.url.as_deref().map(normalize_webdav_url).ok_or_else(|| "WebDAV URL is missing".into())
}
async fn remote_image(target: &SyncTarget, password: &str) -> Result<RemoteImage, String> {
    if target.kind == "path" {
        let path = remote_path(target)?;
        // Sync targets contain standalone snapshots, not another running app's WAL.
        if fs::metadata(wal_path(&path)).is_ok_and(|metadata| metadata.len() > 0) { return Err("The sync target is an open database. Choose a separate sync folder.".into()); }
        return match fs::read(path) {
            Ok(bytes) => Ok(RemoteImage { bytes: Some(bytes), etag: None }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(RemoteImage { bytes: None, etag: None }),
            Err(error) => Err(io(error)),
        };
    }
    let response = http_client().get(remote_url(target)?).basic_auth(target.username.as_deref().unwrap_or(""), Some(password)).send().await.map_err(io)?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(RemoteImage { bytes: None, etag: None }); }
    if !response.status().is_success() { return Err(format!("WebDAV GET returned HTTP {}. No database was replaced.", response.status().as_u16())); }
    let etag = response.headers().get("etag").and_then(|value| value.to_str().ok()).map(str::to_owned);
    Ok(RemoteImage { bytes: Some(response.bytes().await.map_err(io)?.to_vec()), etag })
}
fn same_target(left: &SyncTarget, right: &SyncTarget) -> bool {
    left.kind == right.kind && left.path == right.path && left.url == right.url && left.username == right.username
}
fn result(message: &str, confirmation: Option<SyncPreview>) -> SyncResult {
    SyncResult { success: confirmation.is_none(), message: message.into(), synced_at: 0, downloaded: false, confirmation }
}

fn ensure_separate_target(db: &DbManager, target: &SyncTarget) -> Result<(), String> {
    if target.kind == "path" && remote_path(target)?.canonicalize().ok().is_some_and(|remote| db.get_path().canonicalize().is_ok_and(|local| remote == local)) {
        return Err("Choose a separate sync folder. The live local database cannot also be its own sync target.".into());
    }
    Ok(())
}

async fn make_review(app: &AppHandle, db: &DbManager, target: SyncTarget, restore: bool) -> Result<SyncResult, String> {
    ensure_separate_target(db, &target)?;
    if restore { verify_backup(&remote_path(&target)?)?; }
    let cfg = load_config(app)?;
    let password = if restore { String::new() } else { resolve_password(app, &cfg, &target) };
    let local = upload_snapshot(db)?;
    let local_state = inspect(&local.0)?;
    let remote = remote_image(&target, &password).await?;
    let remote_state = if let Some(bytes) = &remote.bytes {
        let staged = stage(db, bytes)?; validate(&staged.0)?;
        Some(inspect(&staged.0)?)
    } else { None };
    if target.sync_initialized && remote_state.as_ref().is_some_and(|remote| remote.fingerprint == local_state.fingerprint) {
        return Ok(result("Local and remote records already match. No data was transferred.", None));
    }
    let (forward, conflict) = if restore { (None, false) } else { plan(&target, &local_state, remote_state.as_ref()) };
    let upload_blocked_reason = if restore { Some("Backups can only be restored to this device.".into()) }
        else if target.kind == "webdav" && remote.bytes.is_some() && !strong_etag(remote.etag.as_deref()) { Some("This server did not provide a strong file version (ETag). Protected replacement is unavailable; downloading is still safe.".into()) }
        else { None };
    let forward = forward.filter(|direction| *direction == "download" || upload_blocked_reason.is_none());
    let id = uuid::Uuid::new_v4().to_string();
    let preview = SyncPreview { confirmation_id: id.clone(), target_id: target.id.clone(), target_label: target.label.clone(), first_sync: !target.sync_initialized,
        remote_exists: remote.bytes.is_some(), conflict, local: local_state.summary, remote: remote_state.map(|state| state.summary), upload_allowed: upload_blocked_reason.is_none(), upload_blocked_reason, restore };
    {
        let mut reviews = pending().lock().map_err(io)?;
        // A newer review of the same target supersedes the old one.
        reviews.retain(|_, pending| pending.created.elapsed() < Duration::from_secs(600) && pending.target.id != target.id);
        if reviews.len() >= 128 { if let Some(oldest) = reviews.iter().min_by_key(|(_, review)| review.created).map(|(id, _)| id.clone()) { reviews.remove(&oldest); } }
        reviews.insert(id.clone(), Pending { target, local_fingerprint: local_state.fingerprint, remote_version: remote.version(), remote_etag: remote.etag, created: Instant::now(), restore });
    }
    // Only one side holds a person's changes since the last transfer, so
    // nothing can be lost: carry it across without asking. `confirm` re-checks both copies and
    // saves the same verified backups a reviewed transfer does.
    if let Some(direction) = forward {
        return confirm(app, db, &id, direction, false).await;
    }
    Ok(result("Review required. No database has been replaced.", Some(preview)))
}

/// The transfer that is safe without asking, if any, and whether both copies
/// hold changes a person made. Broker refreshes rewrite positions, balances
/// and history every few minutes and are fetched again on the next refresh,
/// so they pick the direction only when no person changed records on either
/// side, and then the most recent refresh wins. A first sync, a person's
/// changes on both sides, no remote, or an empty local database always ask.
fn plan(target: &SyncTarget, local: &Inspection, remote: Option<&Inspection>) -> (Option<&'static str>, bool) {
    if !target.sync_initialized { return (None, false); }
    let (Some(last_local), Some(last_remote)) = (target.last_local_fingerprint.as_deref(), target.last_remote_fingerprint.as_deref()) else { return (None, false) };
    let local_moved = last_local != local.fingerprint;
    let Some(remote) = remote else { return (None, local_moved) };
    let remote_moved = last_remote != remote.fingerprint;
    let edited = target.last_records_fingerprint.as_deref().map(|last| (last != local.records, last != remote.records));
    let direction = match edited {
        Some((true, true)) if local.records != remote.records => return (None, true),
        Some((true, false)) => "upload",
        Some((false, true)) => "download",
        // Last transferred before records were tracked apart from broker data.
        None if local_moved && remote_moved => return (None, true),
        _ => match (local_moved, remote_moved) {
            (true, false) => "upload",
            (false, true) => "download",
            (false, false) => return (None, false),
            (true, true) if local.broker_synced_at > remote.broker_synced_at => "upload",
            (true, true) => "download",
        },
    };
    if direction == "upload" && local.summary.empty { return (None, false); }
    (Some(direction), false)
}
fn strong_etag(etag: Option<&str>) -> bool {
    etag.is_some_and(|etag| etag.starts_with('"') && etag.ends_with('"') && !etag.contains(['\r','\n','[',']']))
}

pub(super) async fn prepare(app: &AppHandle, db: &DbManager, id: &str) -> Result<SyncResult, String> {
    let cfg = load_config(app)?;
    let target = cfg.sync_targets.iter().find(|target| target.id == id).cloned().ok_or("Sync target not found")?;
    make_review(app, db, target, false).await
}

pub(super) fn cancel_review(id: &str) -> Result<(), String> {
    pending().lock().map_err(io)?.remove(id);
    Ok(())
}
fn take_review(id: &str) -> Result<Pending, String> {
    let review = pending().lock().map_err(io)?.remove(id).ok_or("This review expired or was already used. Refresh the review.")?;
    if review.created.elapsed() >= Duration::from_secs(600) { return Err("This review expired. Refresh it before transferring data.".into()); }
    Ok(review)
}
fn check_review(review: &Pending, local: &str, remote: &RemoteImage, direction: &str, empty: bool, allow_empty: bool) -> Result<(), String> {
    if review.local_fingerprint != local || review.remote_version != remote.version() || review.remote_etag != remote.etag { return Err(changed()); }
    if direction == "download" && remote.bytes.is_none() { return Err("No remote database exists. Nothing was replaced.".into()); }
    if direction == "upload" && review.restore { return Err("A restore review cannot authorize an upload".into()); }
    if direction == "upload" && empty && !allow_empty { return Err("Uploading an empty application requires explicit empty-database confirmation.".into()); }
    if direction == "upload" && review.target.kind == "webdav" && remote.bytes.is_some() && !strong_etag(remote.etag.as_deref()) {
        return Err("Protected upload requires a strong remote file version. Nothing was replaced.".into());
    }
    Ok(())
}

pub(super) async fn confirm(app: &AppHandle, db: &DbManager, id: &str, direction: &str, allow_empty: bool) -> Result<SyncResult, String> {
    if !matches!(direction, "upload" | "download") { return Err("Choose upload or download".into()); }
    let review = take_review(id)?;
    ensure_separate_target(db, &review.target)?;
    if review.restore { verify_backup(&remote_path(&review.target)?)?; }
    let cfg = load_config(app)?;
    if !review.restore {
        let current = cfg.sync_targets.iter().find(|target| target.id == review.target.id).ok_or("This sync target was removed")?;
        if !same_target(current, &review.target) { return Err(changed()); }
    }
    let password = if review.restore { String::new() } else { resolve_password(app, &cfg, &review.target) };
    let local = upload_snapshot(db)?;
    let local_state = inspect(&local.0)?;
    let remote = remote_image(&review.target, &password).await?;
    check_review(&review, &local_state.fingerprint, &remote, direction, local_state.summary.empty, allow_empty)?;
    let backups = backup_dir(app)?;
    let final_state;
    if direction == "download" {
        let staged = stage(db, remote.bytes.as_ref().unwrap())?;
        validate(&staged.0)?;
        final_state = inspect(&staged.0)?;
        install(db, &staged.0, &backups, Some(&review.local_fingerprint))?;
    } else {
        // Verify every recovery copy before authorizing the final replacement.
        save_backup(&backups, "local", &fs::read(&local.0).map_err(io)?)?;
        if let Some(bytes) = &remote.bytes { save_backup(&backups, "remote", bytes)?; }
        if review.target.kind == "path" { upload_path(&review, &remote, &local.0)?; }
        else { upload_webdav(&review.target, &password, &remote, fs::read(&local.0).map_err(io)?).await?; }
        final_state = local_state;
    }
    update_config(app, |config| {
        if review.restore {
            for target in &mut config.sync_targets { target.sync_initialized = false; target.last_local_fingerprint = None; target.last_remote_fingerprint = None; target.last_records_fingerprint = None; }
        } else if let Some(target) = config.sync_targets.iter_mut().find(|target| target.id == review.target.id) {
            target.sync_initialized = true; target.last_local_fingerprint = Some(final_state.fingerprint.clone()); target.last_remote_fingerprint = Some(final_state.fingerprint.clone());
            target.last_records_fingerprint = Some(final_state.records.clone());
            target.last_synced_at = Some(now_secs()); target.last_sync_status = Some("ok".into());
        }
    })?;
    Ok(SyncResult { success: true, message: if direction == "download" { "Loaded the reviewed database. A recovery backup was saved." } else { "Uploaded the approved snapshot. Recovery backups were saved." }.into(),
        synced_at: now_secs(), downloaded: direction == "download", confirmation: None })
}

fn upload_path(review: &Pending, expected: &RemoteImage, snapshot: &Path) -> Result<(), String> {
    let destination = remote_path(&review.target)?;
    let parent = destination.parent().ok_or("The sync folder has no parent")?;
    fs::create_dir_all(parent).map_err(io)?;
    let lock = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(parent.join(".stockfolio-sync.lock")).map_err(io)?;
    lock.try_lock_exclusive().map_err(|_| "Another process is writing to this sync folder. Nothing was replaced.")?;
    let current = match fs::read(&destination) { Ok(bytes) => Some(bytes), Err(error) if error.kind() == std::io::ErrorKind::NotFound => None, Err(error) => return Err(io(error)) };
    if current.as_ref().map(|bytes| checksum(bytes)) != expected.bytes.as_ref().map(|bytes| checksum(bytes)) { return Err(changed()); }
    if let Some(bytes) = current { save_backup(&parent.join(".stockfolio-backups"), "remote", &bytes)?; }
    let staged = destination.with_extension(format!("upload-{}.db", uuid::Uuid::new_v4()));
    durable_write(&staged, &fs::read(snapshot).map_err(io)?)?;
    let staged = Staged(staged);
    inspect(&staged.0)?;
    let fresh = match fs::read(&destination) { Ok(bytes) => Some(bytes), Err(error) if error.kind() == std::io::ErrorKind::NotFound => None, Err(error) => return Err(io(error)) };
    if fresh.as_ref().map(|bytes| checksum(bytes)) != expected.bytes.as_ref().map(|bytes| checksum(bytes)) { return Err(changed()); }
    // create-new uses an atomic hard link so a newly appearing remote is safe.
    if expected.bytes.is_none() { fs::hard_link(&staged.0, &destination).map_err(|e| format!("Remote creation stopped: {e}. Review the target again."))?; }
    else { fs::rename(&staged.0, &destination).map_err(io)?; }
    sync_directory(parent)
}

fn sibling_url(url: &str, name: &str) -> Result<String, String> {
    let mut parsed = reqwest::Url::parse(url).map_err(io)?;
    parsed.set_query(None); parsed.set_fragment(None);
    parsed.path_segments_mut().map_err(|_| "Invalid WebDAV URL")?.pop().push(name);
    Ok(parsed.into())
}
async fn put_new(url: &str, user: &str, password: &str, bytes: Vec<u8>) -> Result<(), String> {
    let response = http_client().put(url).basic_auth(user, Some(password)).header("If-None-Match", "*").body(bytes).send().await.map_err(io)?;
    if !response.status().is_success() { return Err(format!("Staging upload failed (HTTP {}). The live remote database was not replaced.", response.status().as_u16())); }
    Ok(())
}
async fn upload_webdav(target: &SyncTarget, password: &str, remote: &RemoteImage, bytes: Vec<u8>) -> Result<(), String> {
    let destination = remote_url(target)?;
    let user = target.username.as_deref().unwrap_or("");
    let stage_url = sibling_url(&destination, &format!(".stockfolio-upload-{}.db", uuid::Uuid::new_v4()))?;
    // Parent creation is allowed only after the user's explicit upload choice.
    let parent = destination.rsplit_once('/').ok_or("Invalid WebDAV path")?.0;
    let mkcol = reqwest::Method::from_bytes(b"MKCOL").unwrap();
    let response = http_client().request(mkcol.clone(), parent).basic_auth(user, Some(password)).send().await.map_err(io)?;
    if !(response.status().is_success() || response.status().as_u16() == 405) { return Err(format!("Cannot prepare WebDAV folder (HTTP {})", response.status().as_u16())); }
    let result = async {
        put_new(&stage_url, user, password, bytes.clone()).await?;
        let staged_response = http_client().get(&stage_url).basic_auth(user, Some(password)).send().await.map_err(io)?;
        if !staged_response.status().is_success() { return Err("Cannot verify the staged upload. Nothing was replaced.".into()); }
        let staged_etag = staged_response.headers().get("etag").and_then(|value| value.to_str().ok()).map(str::to_owned)
            .filter(|etag| strong_etag(Some(etag))).ok_or("The server cannot protect the staged upload with a strong ETag. Nothing was replaced.")?;
        if checksum(&staged_response.bytes().await.map_err(io)?) != checksum(&bytes) { return Err("Staged upload verification failed. The live remote database was not replaced.".into()); }
        if let Some(old) = &remote.bytes {
            let directory = sibling_url(&destination, ".stockfolio-backups")?;
            let response = http_client().request(mkcol, &directory).basic_auth(user, Some(password)).send().await.map_err(io)?;
            if !(response.status().is_success() || response.status().as_u16() == 405) { return Err("Cannot create the remote recovery folder. Nothing was replaced.".into()); }
            let backup_url = format!("{directory}/remote-{}-{}.db", now_secs(), uuid::Uuid::new_v4());
            put_new(&backup_url, user, password, old.clone()).await?;
            if checksum(&webdav_get(&backup_url, user, password).await?) != checksum(old) { return Err("Remote backup verification failed. Nothing was replaced.".into()); }
        }
        let mut request = http_client().request(reqwest::Method::from_bytes(b"MOVE").unwrap(), &stage_url)
            .basic_auth(user, Some(password)).header("If-Match", staged_etag).header("Destination", &destination)
            .header("Overwrite", if remote.bytes.is_some() { "T" } else { "F" });
        if remote.bytes.is_some() {
            let etag = remote.etag.as_deref().filter(|etag| strong_etag(Some(etag))).ok_or("A strong ETag is required to replace the remote database")?;
            // If-Match on MOVE protects the source, not the destination. A
            // tagged WebDAV If condition protects the destination's version.
            request = request.header("If", format!("<{destination}> ([{etag}])"));
        }
        let response = request.send().await.map_err(|e| format!("The server did not confirm the final move: {e}. Check the target before retrying; recovery backups are preserved."))?;
        if !response.status().is_success() {
            return Err(if matches!(response.status().as_u16(), 409 | 412 | 423) { changed() } else { format!("Protected replacement failed (HTTP {}). Recovery backups are preserved.", response.status().as_u16()) });
        }
        if checksum(&webdav_get(&destination, user, password).await?) != checksum(&bytes) { return Err("The server's final database could not be verified. Recovery backups are preserved; review the target before retrying.".into()); }
        Ok(())
    }.await;
    let _ = http_client().delete(&stage_url).basic_auth(user, Some(password)).send().await;
    result
}

pub(super) fn list_backups(app: &AppHandle) -> Result<Vec<SyncBackup>, String> {
    let directory = backup_dir(app)?;
    if !directory.exists() { return Ok(Vec::new()); }
    let mut backups = Vec::new();
    for entry in fs::read_dir(directory).map_err(io)? {
        let entry = entry.map_err(io)?; let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "db") || !entry.file_type().map_err(io)?.is_file() { continue; }
        let metadata = entry.metadata().map_err(io)?;
        backups.push(SyncBackup { id: entry.file_name().to_string_lossy().into_owned(), created_at: metadata.modified().map_err(io)?.duration_since(std::time::UNIX_EPOCH).map_err(io)?.as_secs(), size: metadata.len() });
    }
    backups.sort_by(|a,b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}
pub(super) async fn prepare_restore(app: &AppHandle, db: &DbManager, id: &str) -> Result<SyncResult, String> {
    if id.contains(['/', '\\']) || !id.ends_with(".db") || id.starts_with('.') { return Err("Invalid backup selection".into()); }
    let target = SyncTarget { id: format!("backup:{id}"), label: format!("Recovery backup: {id}"), kind: "path".into(), path: Some(backup_dir(app)?.join(id).to_string_lossy().into_owned()), url: None, username: None, password_enc: None,
        last_synced_at: None, last_sync_status: None, sync_initialized: false, last_local_fingerprint: None, last_remote_fingerprint: None, last_records_fingerprint: None };
    make_review(app, db, target, true).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::{Body, Bytes}, extract::State as HttpState, http::{HeaderMap, Method, StatusCode, Uri}, response::Response, Router};
    use std::sync::Arc;

    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("stockfolio-safety-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap(); path
    }
    fn target(kind: &str, location: &str) -> SyncTarget {
        SyncTarget { id: uuid::Uuid::new_v4().to_string(), label: "Test".into(), kind: kind.into(), path: (kind == "path").then(|| location.into()), url: (kind == "webdav").then(|| location.into()), username: None, password_enc: None,
            last_synced_at: None, last_sync_status: None, sync_initialized: false, last_local_fingerprint: None, last_remote_fingerprint: None, last_records_fingerprint: None }
    }
    fn review(target: SyncTarget, remote: &RemoteImage) -> Pending {
        Pending { target, local_fingerprint: "local-v1".into(), remote_version: remote.version(), remote_etag: remote.etag.clone(), created: Instant::now(), restore: false }
    }
    fn populated(db: &DbManager, name: &str) {
        db.with_conn(|conn| conn.execute("INSERT INTO portfolios (name,sort_order,is_starred,created_at) VALUES (?1,0,0,1)", [name])).unwrap();
    }
    fn state(fingerprint: &str, records: &str, broker_synced_at: Option<i64>, empty: bool) -> Inspection {
        Inspection { fingerprint: fingerprint.into(), records: records.into(), broker_synced_at,
            summary: RecordSummary { financial_records: 0, portfolios: 0, watchlist_items: 0, notes: 0, empty } }
    }
    #[test]
    fn only_a_one_sided_change_transfers_without_asking() {
        let mut t = target("webdav", "https://example.test/stockfolio.db");
        t.sync_initialized = true;
        t.last_local_fingerprint = Some("L".into()); t.last_remote_fingerprint = Some("R".into());
        let side = |fingerprint: &str| state(fingerprint, "U", None, false);
        assert_eq!(plan(&t, &side("L2"), Some(&side("R"))), (Some("upload"), false));
        assert_eq!(plan(&t, &side("L"), Some(&side("R2"))), (Some("download"), false));
        assert_eq!(plan(&t, &side("L2"), Some(&side("R2"))), (None, true), "both changed: a person decides");
        assert_eq!(plan(&t, &side("L"), Some(&side("R"))), (None, false));
        assert_eq!(plan(&t, &state("L2", "U", None, true), Some(&side("R"))), (None, false), "never push an empty database unasked");
        assert_eq!(plan(&t, &side("L2"), None), (None, true), "remote vanished: a person decides");
        t.sync_initialized = false;
        assert_eq!(plan(&t, &side("L2"), Some(&side("R"))), (None, false), "first sync always asks");
    }
    #[test]
    fn broker_refreshes_never_turn_a_one_sided_edit_into_a_conflict() {
        let mut t = target("webdav", "https://example.test/stockfolio.db");
        t.sync_initialized = true;
        t.last_local_fingerprint = Some("F".into()); t.last_remote_fingerprint = Some("F".into()); t.last_records_fingerprint = Some("U".into());
        assert_eq!(plan(&t, &state("F2", "U", Some(200), false), Some(&state("F3", "U2", Some(100), false))), (Some("download"), false), "edited remotely, refreshed here");
        assert_eq!(plan(&t, &state("F2", "U2", Some(100), false), Some(&state("F3", "U", Some(200), false))), (Some("upload"), false), "edited here, refreshed remotely");
        assert_eq!(plan(&t, &state("F2", "U", Some(200), false), Some(&state("F3", "U", Some(100), false))), (Some("upload"), false), "only refreshes: newest wins");
        assert_eq!(plan(&t, &state("F2", "U", Some(100), false), Some(&state("F3", "U", Some(200), false))), (Some("download"), false), "only refreshes: newest wins");
        assert_eq!(plan(&t, &state("F2", "U2", None, false), Some(&state("F3", "U3", None, false))), (None, true), "a person edited both copies");
        assert_eq!(plan(&t, &state("F2", "U2", None, true), Some(&state("F", "U", None, false))), (None, false), "never push an empty database unasked");
    }
    #[test]
    fn empty_application_needs_explicit_consent_regardless_of_sync_history() {
        let remote = RemoteImage { bytes: Some(b"existing remote".to_vec()), etag: Some("\"v1\"".into()) };
        let mut target = target("webdav", "https://example.test/stockfolio.db");
        target.sync_initialized = true; target.last_synced_at = Some(now_secs());
        let review = review(target, &remote);
        assert!(check_review(&review, "local-v1", &remote, "upload", true, false).unwrap_err().contains("empty"));
        assert!(check_review(&review, "local-v1", &remote, "upload", true, true).is_ok());
        assert!(check_review(&review, "local-v1", &remote, "download", true, false).is_ok());
    }
    #[test]
    fn stale_approvals_cannot_replace_local_or_remote_changes() {
        let remote = RemoteImage { bytes: Some(b"remote-v1".to_vec()), etag: Some("\"v1\"".into()) };
        let review = review(target("webdav", "https://example.test/stockfolio.db"), &remote);
        assert!(check_review(&review, "local-v2", &remote, "download", false, false).is_err());
        let changed = RemoteImage { bytes: Some(b"remote-v2".to_vec()), etag: Some("\"v2\"".into()) };
        assert!(check_review(&review, "local-v1", &changed, "upload", false, false).is_err());
        let changed_etag = RemoteImage { bytes: remote.bytes.clone(), etag: Some("\"v2\"".into()) };
        assert!(check_review(&review, "local-v1", &changed_etag, "upload", false, false).is_err());
    }
    #[test]
    fn missing_or_weak_versions_never_allow_overwriting_webdav() {
        for etag in [None, Some("W/\"v1\"".into())] {
            let remote = RemoteImage { bytes: Some(b"remote".to_vec()), etag };
            let review = review(target("webdav", "https://example.test/stockfolio.db"), &remote);
            assert!(check_review(&review, "local-v1", &remote, "upload", false, false).is_err());
        }
    }
    #[test]
    fn approvals_expire_and_cannot_be_replayed() {
        let remote = RemoteImage { bytes: None, etag: None };
        let id = uuid::Uuid::new_v4().to_string();
        pending().lock().unwrap().insert(id.clone(), review(target("path", "/tmp/example"), &remote));
        assert!(take_review(&id).is_ok()); assert!(take_review(&id).is_err());
        let id = uuid::Uuid::new_v4().to_string();
        let mut expired = review(target("path", "/tmp/example"), &remote);
        expired.created = Instant::now() - Duration::from_secs(601);
        pending().lock().unwrap().insert(id.clone(), expired);
        assert!(take_review(&id).is_err());
        let id = uuid::Uuid::new_v4().to_string();
        pending().lock().unwrap().insert(id.clone(), review(target("path", "/tmp/example"), &remote));
        cancel_review(&id).unwrap(); assert!(take_review(&id).is_err());
    }
    #[tokio::test]
    async fn broker_writes_cannot_land_during_or_after_a_review_they_overlap() {
        // Began before a review: dropped at its next write.
        let started = BrokerWrites(*BROKER_GATE.read().await);
        drop(exclusive().await);
        assert!(started.permit().await.is_none());
        // While a review is open: neither new nor current-generation syncs write.
        let remote = RemoteImage { bytes: None, etag: None };
        let id = uuid::Uuid::new_v4().to_string();
        pending().lock().unwrap().insert(id.clone(), review(target("path", "/tmp/example"), &remote));
        let current = BrokerWrites(*BROKER_GATE.read().await);
        assert!(BrokerWrites::begin().await.is_none());
        assert!(current.permit().await.is_none());
        cancel_review(&id).unwrap();
    }
    #[test]
    fn record_fingerprint_ignores_quote_cache_but_catches_user_changes() {
        let dir = directory(); let db = DbManager::open(&dir.join("local.db")).unwrap();
        let first = db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap();
        db.with_conn(|conn| conn.execute("INSERT INTO stocks(ticker,last_price) VALUES ('AAPL',100)", [])).unwrap();
        assert_eq!(first, db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap());
        populated(&db, "Another portfolio");
        assert_ne!(first, db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap());
        drop(db); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn records_fingerprint_ignores_broker_refreshes_but_not_account_choices() {
        let dir = directory(); let db = DbManager::open(&dir.join("local.db")).unwrap();
        let records = || db.with_conn(|conn| Ok(records_fingerprint(conn).unwrap())).unwrap();
        let full = || db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap();
        db.with_conn(|conn| conn.execute_batch(
            "INSERT INTO broker_connections (id, provider, environment, label, credential_ref, created_at) VALUES ('c', 'alpaca', 'live', 'Broker', 'ref', 1);
             INSERT INTO broker_accounts (connection_id, provider_account_id, equity, cash) VALUES ('c', 'a', 100, 10);")).unwrap();
        let (before, before_full) = (records(), full());
        db.with_conn(|conn| conn.execute_batch(
            "UPDATE broker_accounts SET equity = 120, cash = 5, snapshot_at = 2;
             UPDATE broker_connections SET last_synced_at = 2, last_sync_status = 'ok';
             INSERT INTO broker_positions (broker_account_id, provider_symbol, qty, snapshot_at) VALUES (1, 'AAPL', 1, 2);
             INSERT INTO broker_transactions (broker_account_id, external_id, kind, provider_symbol, occurred_at) VALUES (1, 'tx', 'buy', 'AAPL', '2026-01-01');
             INSERT INTO broker_account_snapshots (broker_account_id, as_of, captured_at) VALUES (1, '2026-01-01', 2);")).unwrap();
        assert_eq!(before, records());
        assert_ne!(before_full, full(), "transfers still carry broker data");
        db.with_conn(|conn| conn.execute("UPDATE broker_accounts SET visible = 0", [])).unwrap();
        assert_ne!(before, records());
        drop(db); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_backup_and_stale_local_records_leave_live_database_unchanged() {
        let dir = directory(); let db = DbManager::open(&dir.join("local.db")).unwrap(); populated(&db, "Original");
        let remote = DbManager::open(&dir.join("incoming.db")).unwrap(); populated(&remote, "Remote"); drop(remote);
        let before = db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap();
        let blocked = dir.join("not-a-directory"); fs::write(&blocked, b"blocked").unwrap();
        assert!(install(&db, &dir.join("incoming.db"), &blocked, Some(&before)).is_err());
        assert_eq!(before, db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap());
        populated(&db, "A concurrent edit");
        assert!(install(&db, &dir.join("incoming.db"), &dir.join("backups"), Some(&before)).is_err());
        assert_eq!(db.with_conn(|conn| conn.query_row("SELECT COUNT(*) FROM portfolios WHERE name='A concurrent edit'", [], |row| row.get::<_, i64>(0))).unwrap(), 1);
        drop(db); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn verified_backup_can_restore_exact_user_records_and_corruption_is_rejected() {
        let dir = directory(); let db = DbManager::open(&dir.join("local.db")).unwrap(); populated(&db, "Before replacement");
        let before = db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap();
        let remote = DbManager::open(&dir.join("incoming.db")).unwrap(); populated(&remote, "Imported"); drop(remote);
        install(&db, &dir.join("incoming.db"), &dir.join("backups"), Some(&before)).unwrap();
        let backup = fs::read_dir(dir.join("backups")).unwrap().map(|entry| entry.unwrap().path()).find(|path| path.extension().is_some_and(|ext| ext == "db")).unwrap();
        assert_eq!(inspect(&backup).unwrap().fingerprint, before);
        let restored = stage(&db, &fs::read(&backup).unwrap()).unwrap();
        install(&db, &restored.0, &dir.join("backups"), None).unwrap();
        assert_eq!(before, db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap());
        fs::write(&restored.0, b"truncated backup").unwrap();
        assert!(install(&db, &restored.0, &dir.join("backups"), None).is_err());
        assert_eq!(before, db.with_conn(|conn| Ok(fingerprint(conn).unwrap())).unwrap());
        drop(restored); drop(db); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn backup_checksum_rejects_changed_records_even_in_a_valid_sqlite_file() {
        let dir = directory(); let db = DbManager::open(&dir.join("local.db")).unwrap(); populated(&db, "Original records");
        let snapshot = upload_snapshot(&db).unwrap();
        let backup = save_backup(&dir.join("backups"), "local", &fs::read(&snapshot.0).unwrap()).unwrap();
        verify_backup(&backup).unwrap();
        let changed = Connection::open(&backup).unwrap();
        changed.execute("UPDATE portfolios SET name='Changed records'", []).unwrap(); drop(changed);
        assert!(inspect(&backup).is_ok());
        assert!(verify_backup(&backup).unwrap_err().contains("checksum"));
        drop(snapshot); drop(db); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn local_upload_preserves_the_previous_remote_in_a_separate_backup() {
        let dir = directory(); let local = DbManager::open(&dir.join("local.db")).unwrap(); populated(&local, "New local");
        let remote_path = dir.join("remote.db"); let remote = DbManager::open(&remote_path).unwrap(); populated(&remote, "Old remote"); drop(remote);
        let bytes = fs::read(&remote_path).unwrap(); let image = RemoteImage { bytes: Some(bytes.clone()), etag: None };
        let review = review(target("path", remote_path.to_str().unwrap()), &image);
        let snapshot = upload_snapshot(&local).unwrap();
        upload_path(&review, &image, &snapshot.0).unwrap();
        let backup = fs::read_dir(dir.join(".stockfolio-backups")).unwrap().map(|entry| entry.unwrap().path()).find(|path| path.extension().is_some_and(|ext| ext == "db")).unwrap();
        assert_eq!(checksum(&fs::read(backup).unwrap()), checksum(&bytes));
        assert_eq!(inspect(&remote_path).unwrap().fingerprint, inspect(&snapshot.0).unwrap().fingerprint);
        drop(snapshot); drop(local); fs::remove_dir_all(dir).unwrap();
    }

    #[derive(Default)]
    struct Fixture {
        live: Option<Vec<u8>>, files: HashMap<String, Vec<u8>>, version: u32,
        fail_stage: bool, corrupt_stage: bool, concurrent: Option<Vec<u8>>,
        direct_database_puts: usize, moves: usize, verified_condition: bool,
    }
    struct Dav { url: String, state: Arc<Mutex<Fixture>>, task: tokio::task::JoinHandle<()> }
    impl Drop for Dav { fn drop(&mut self) { self.task.abort(); } }
    async fn dav(fixture: Fixture) -> Dav {
        async fn request(HttpState(state): HttpState<Arc<Mutex<Fixture>>>, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
            let mut state = state.lock().unwrap(); let path = uri.path().to_string();
            let reply = |status, bytes: Vec<u8>, etag: &str| Response::builder().status(status).header("ETag", etag).body(Body::from(bytes)).unwrap();
            match method.as_str() {
                "MKCOL" => reply(StatusCode::METHOD_NOT_ALLOWED, vec![], "\"folder\""),
                "GET" => {
                    if path == "/stockfolio.db" { return reply(if state.live.is_some() { StatusCode::OK } else { StatusCode::NOT_FOUND }, state.live.clone().unwrap_or_default(), &format!("\"v{}\"", state.version)); }
                    let bytes = state.files.get(&path).cloned();
                    reply(if bytes.is_some() { StatusCode::OK } else { StatusCode::NOT_FOUND }, bytes.unwrap_or_default(), "\"stage-v1\"")
                }
                "PUT" => {
                    if path == "/stockfolio.db" { state.direct_database_puts += 1; return reply(StatusCode::INTERNAL_SERVER_ERROR, vec![], "\"error\""); }
                    if headers.get("If-None-Match").and_then(|h| h.to_str().ok()) != Some("*") { return reply(StatusCode::PRECONDITION_FAILED, vec![], "\"error\""); }
                    if state.fail_stage && path.contains(".stockfolio-upload-") { return reply(StatusCode::SERVICE_UNAVAILABLE, vec![], "\"error\""); }
                    let corrupt = state.corrupt_stage && path.contains(".stockfolio-upload-");
                    state.files.insert(path, if corrupt { b"truncated upload".to_vec() } else { body.to_vec() });
                    reply(StatusCode::CREATED, vec![], "\"stage-v1\"")
                }
                "MOVE" => {
                    if let Some(bytes) = state.concurrent.take() { state.live = Some(bytes); state.version += 1; }
                    let etag = format!("\"v{}\"", state.version);
                    if headers.get("If-Match").and_then(|h| h.to_str().ok()) != Some("\"stage-v1\"") { return reply(StatusCode::PRECONDITION_FAILED, vec![], "\"error\""); }
                    if state.live.is_some() {
                        let condition = format!("<{}> ([{etag}])", headers.get("Destination").unwrap().to_str().unwrap());
                        if headers.get("Overwrite").and_then(|h| h.to_str().ok()) != Some("T") || headers.get("If").and_then(|h| h.to_str().ok()) != Some(&condition) { return reply(StatusCode::PRECONDITION_FAILED, vec![], "\"error\""); }
                        state.verified_condition = true;
                    } else if headers.get("Overwrite").and_then(|h| h.to_str().ok()) != Some("F") { return reply(StatusCode::PRECONDITION_FAILED, vec![], "\"error\""); }
                    state.live = state.files.remove(&path); state.version += 1; state.moves += 1;
                    reply(StatusCode::CREATED, vec![], &format!("\"v{}\"", state.version))
                }
                "DELETE" => { state.files.remove(&path); reply(StatusCode::NO_CONTENT, vec![], "\"deleted\"") }
                _ => reply(StatusCode::METHOD_NOT_ALLOWED, vec![], "\"error\""),
            }
        }
        let state = Arc::new(Mutex::new(fixture));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/stockfolio.db", listener.local_addr().unwrap());
        let app = Router::new().fallback(request).with_state(state.clone());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        Dav { url, state, task }
    }
    #[tokio::test]
    async fn webdav_uses_verified_staging_backup_and_destination_version_condition() {
        let server = dav(Fixture { live: Some(b"original".to_vec()), version: 1, ..Default::default() }).await;
        let remote = RemoteImage { bytes: Some(b"original".to_vec()), etag: Some("\"v1\"".into()) };
        upload_webdav(&target("webdav", &server.url), "", &remote, b"approved upload".to_vec()).await.unwrap();
        let state = server.state.lock().unwrap();
        assert_eq!(state.live.as_deref(), Some(b"approved upload".as_slice()));
        assert_eq!(state.direct_database_puts, 0); assert_eq!(state.moves, 1); assert!(state.verified_condition);
        assert!(state.files.iter().any(|(path, bytes)| path.contains(".stockfolio-backups/") && bytes == b"original"));
    }
    #[tokio::test]
    async fn interrupted_or_corrupted_staging_never_changes_the_live_remote() {
        for corrupt in [false, true] {
            let server = dav(Fixture { live: Some(b"original".to_vec()), version: 1, fail_stage: !corrupt, corrupt_stage: corrupt, ..Default::default() }).await;
            let remote = RemoteImage { bytes: Some(b"original".to_vec()), etag: Some("\"v1\"".into()) };
            assert!(upload_webdav(&target("webdav", &server.url), "", &remote, b"approved upload".to_vec()).await.is_err());
            let state = server.state.lock().unwrap(); assert_eq!(state.live.as_deref(), Some(b"original".as_slice())); assert_eq!(state.moves, 0);
        }
    }
    #[tokio::test]
    async fn another_devices_change_during_upload_is_never_overwritten() {
        let server = dav(Fixture { live: Some(b"original".to_vec()), version: 1, concurrent: Some(b"other device edit".to_vec()), ..Default::default() }).await;
        let remote = RemoteImage { bytes: Some(b"original".to_vec()), etag: Some("\"v1\"".into()) };
        assert!(upload_webdav(&target("webdav", &server.url), "", &remote, b"approved upload".to_vec()).await.is_err());
        let state = server.state.lock().unwrap(); assert_eq!(state.live.as_deref(), Some(b"other device edit".as_slice())); assert_eq!(state.moves, 0);
    }
    #[tokio::test]
    async fn a_remote_created_after_the_review_cannot_be_overwritten() {
        let server = dav(Fixture { concurrent: Some(b"new remote".to_vec()), ..Default::default() }).await;
        let remote = RemoteImage { bytes: None, etag: None };
        assert!(upload_webdav(&target("webdav", &server.url), "", &remote, b"approved upload".to_vec()).await.is_err());
        let state = server.state.lock().unwrap(); assert_eq!(state.live.as_deref(), Some(b"new remote".as_slice())); assert_eq!(state.moves, 0);
    }
}
