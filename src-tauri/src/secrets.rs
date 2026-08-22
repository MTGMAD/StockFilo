//! Secret storage for credentials that must never reach the database.
//!
//! # Why this module exists
//!
//! `sync.rs` copies `stockfolio.db` wholesale to a folder or WebDAV target.
//! Anything written into SQLite therefore travels to that target.  Brokerage
//! API keys are trade-capable — an Alpaca key can place and cancel orders —
//! so they are stored here instead, and the database holds only an opaque
//! `credential_ref` handle.
//!
//! # Storage backends
//!
//! 1. **OS keychain** (preferred) — Windows Credential Manager, macOS Keychain,
//!    or the Secret Service on Linux, via the `keyring` crate.  The platform
//!    handles encryption at rest and access control.  Every secret lives as a
//!    field of one JSON object under a single Keychain item rather than one
//!    item per secret — seeing "grant access" prompts scale with the number
//!    of items, not the number of times an app is opened, so one item keeps
//!    that down to once instead of once per broker connection.  See the
//!    "Keychain backend" section below for the migration off the old
//!    one-item-per-secret layout.
//!
//! 2. **Encrypted file** (fallback) — for headless Linux boxes with no Secret
//!    Service available.  A randomly generated 32-byte master key is written to
//!    `secrets.key` in the app config directory with owner-only permissions,
//!    and secrets are sealed with AES-256-GCM using a CSPRNG nonce.
//!
//!    Be clear-eyed about what the fallback provides: the master key sits on
//!    the same disk as the ciphertext, so this protects against casual reading
//!    and against secrets leaking through the synced database file — not
//!    against an attacker who already has read access to the config directory.
//!    The keychain is meaningfully stronger; the fallback exists so the app
//!    still works where no keychain does.
//!
//! # Relationship to the legacy sync-password scheme
//!
//! The original AES-GCM helpers in `sync.rs` derived their key by XOR-folding
//! the plaintext `device_id` — which is stored in `config.json` right next to
//! the ciphertext — and generated nonces from `DefaultHasher` over a timestamp
//! rather than a CSPRNG.  Nonce reuse under AES-GCM is catastrophic, so that
//! scheme is retained only in `legacy_decrypt`, used once to migrate an
//! existing password onto this module.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine as _;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

/// Keychain service name.  Matches the bundle identifier in `tauri.conf.json`.
const SERVICE: &str = "com.stockfolio.app";

/// Filename of the fallback master key, stored in the app config directory.
const KEYFILE: &str = "secrets.key";

// ── Public API ─────────────────────────────────────────────────────────────

/// Store `plaintext` under `reference`, overwriting any existing value.
pub fn set_secret(app: &AppHandle, reference: &str, plaintext: &str) -> Result<(), String> {
    let mut state = vault_state().lock().unwrap();
    match vault_put(&mut state, reference, Some(plaintext)) {
        Ok(()) => return Ok(()),
        Err(e) => log_fallback("store", reference, &e),
    }
    drop(state);
    file_set(app, reference, plaintext)
}

/// Retrieve the secret stored under `reference`.
///
/// Returns `Ok(None)` when no secret exists here — which is a normal state, not
/// an error: a database synced from another device carries broker connections
/// whose credentials live in *that* machine's keychain.  Callers must surface
/// this as "add credentials on this device", never as a failure.
pub fn get_secret(app: &AppHandle, reference: &str) -> Result<Option<String>, String> {
    let mut state = vault_state().lock().unwrap();

    if let Err(e) = ensure_vault_loaded(&mut state) {
        log_fallback("read", reference, &e);
    }
    if let Some(v) = state
        .map
        .as_ref()
        .and_then(|m| m.get(reference))
        .and_then(|v| v.as_str())
    {
        return Ok(Some(v.to_string()));
    }

    // Fall back to this reference's own pre-vault keychain item. Every secret
    // used to get its own macOS/Windows Keychain entry, which meant one OS
    // authorization prompt *per credential* on every launch — reference stays
    // under this old scheme only until it is next read, at which point it
    // migrates into the single vault item and this branch stops firing for
    // it. Still holding the lock here (not just for the vault above) so a
    // second, concurrent lookup of this same reference cannot race this
    // migration and trigger its own duplicate prompt for the same old item.
    if let Ok(entry) = keyring_entry(reference) {
        match entry.get_password() {
            Ok(v) => {
                if vault_put(&mut state, reference, Some(&v)).is_ok() {
                    let _ = entry.delete_credential();
                }
                return Ok(Some(v));
            }
            Err(keyring::Error::NoEntry) => {} // fall through to the file backend
            Err(e) => log_fallback("read", reference, &e.to_string()),
        }
    }
    drop(state);
    file_get(app, reference)
}

/// Remove the secret stored under `reference`.  Succeeds if it was already gone.
pub fn delete_secret(app: &AppHandle, reference: &str) -> Result<(), String> {
    let mut state = vault_state().lock().unwrap();
    if let Err(e) = vault_put(&mut state, reference, None) {
        log_fallback("delete", reference, &e);
    }
    // A pre-migration item may still exist even after the vault write above.
    if let Ok(entry) = keyring_entry(reference) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => log_fallback("delete", reference, &e.to_string()),
        }
    }
    drop(state);
    file_delete(app, reference)
}

/// True when a secret is present on this device.  Used by the UI to distinguish
/// "not configured here" from "broken".
pub fn has_secret(app: &AppHandle, reference: &str) -> bool {
    matches!(get_secret(app, reference), Ok(Some(_)))
}

// ── Keychain backend ───────────────────────────────────────────────────────
//
// Every secret used to live in its own OS Keychain item (`keyring_entry`,
// keyed by `reference`). Correct, but each *distinct* item needs its own
// "Always Allow" grant from the OS the first time an app reads it — so a
// person with a handful of broker connections got a handful of separate
// Keychain prompts on every launch, one per credential, instead of one for
// the app. `VaultState` fixes that by keeping every secret as fields of a
// single JSON object stored under one Keychain item (`VAULT_ACCOUNT`): one
// item, one prompt. `get_secret` migrates each reference out of its old
// standalone item into the vault the first time it is read after upgrading,
// so nothing already stored is lost.
//
// Every public function above holds `vault_state()`'s lock for its *entire*
// body, including the blocking OS calls — not just around a cached read. An
// earlier version only cached the read result, which closed the "N accounts
// means N slow lookups" problem but left a real gap open: two calls landing
// on an empty cache at the same time (React's StrictMode double-firing the
// startup effect in dev, plus whatever else asks at launch) would each
// independently decide the cache was cold and go to the OS in parallel, each
// capable of popping its own prompt. Holding the lock for the whole operation
// means a second caller blocks until the first one finishes and warms the
// cache, instead of racing it.

/// The one account name under which every secret is now stored, as a JSON
/// object keyed by `reference`. Distinct from any real `reference` string
/// (`broker:...`, `sync:...`, `snaptrade:...`) so it can never collide with a
/// legacy per-reference item.
const VAULT_ACCOUNT: &str = "__vault__";

fn keyring_entry(reference: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())
}

fn vault_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, VAULT_ACCOUNT).map_err(|e| e.to_string())
}

struct VaultState {
    /// `None` until first loaded this process; distinguishes "not read yet"
    /// from "read, and it was empty".
    map: Option<serde_json::Map<String, serde_json::Value>>,
}

fn vault_state() -> &'static Mutex<VaultState> {
    static STATE: OnceLock<Mutex<VaultState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(VaultState { map: None }))
}

/// Populate `state.map` from the OS keychain if this process hasn't already.
/// Callers must already hold `vault_state()`'s lock — this never locks it
/// itself, so it can't deadlock when called from inside another locked
/// section.
fn ensure_vault_loaded(state: &mut VaultState) -> Result<(), String> {
    if state.map.is_some() {
        return Ok(());
    }
    let entry = vault_entry()?;
    let map = match entry.get_password() {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(serde_json::Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        },
        Err(keyring::Error::NoEntry) => serde_json::Map::new(),
        Err(e) => return Err(e.to_string()),
    };
    state.map = Some(map);
    Ok(())
}

/// Set `reference` to `plaintext` in the vault, or remove it when `plaintext`
/// is `None`, persisting immediately. Caller must already hold the lock.
fn vault_put(state: &mut VaultState, reference: &str, plaintext: Option<&str>) -> Result<(), String> {
    ensure_vault_loaded(state)?;
    let map = state.map.as_mut().expect("just loaded above");
    match plaintext {
        Some(v) => {
            map.insert(reference.to_string(), serde_json::Value::String(v.to_string()));
        }
        None => {
            map.remove(reference);
        }
    }

    let entry = vault_entry()?;
    let text = serde_json::to_string(map).map_err(|e| e.to_string())?;
    entry.set_password(&text).map_err(|e| e.to_string())
}

fn log_fallback(op: &str, reference: &str, err: &str) {
    eprintln!(
        "[secrets] keychain {op} failed for '{reference}' ({err}); using encrypted file fallback"
    );
}

// ── Encrypted-file backend ─────────────────────────────────────────────────

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("secrets.json"))
}

/// Load the fallback master key, generating and persisting one on first use.
fn master_key(app: &AppHandle) -> Result<[u8; 32], String> {
    let path = config_dir(app)?.join(KEYFILE);

    if path.exists() {
        let raw = fs::read(&path).map_err(|e| e.to_string())?;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(raw.trim_ascii())
            .map_err(|e| format!("secrets.key is corrupt: {e}"))?;
        if decoded.len() != 32 {
            return Err("secrets.key is corrupt: expected 32 bytes".into());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|e| format!("CSPRNG unavailable: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    fs::write(&path, encoded).map_err(|e| e.to_string())?;
    restrict_permissions(&path);
    Ok(key)
}

/// Best-effort tightening of file permissions to owner-only.
#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

/// On Windows the app config directory already lives under the user profile,
/// which is ACL-protected against other standard users.  There is no portable
/// equivalent of chmod here, so this is intentionally a no-op.
#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) {}

fn read_store(app: &AppHandle) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(map)) => Ok(map),
        _ => Ok(serde_json::Map::new()),
    }
}

fn write_store(
    app: &AppHandle,
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let path = store_path(app)?;
    let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())?;
    restrict_permissions(&path);
    Ok(())
}

fn file_set(app: &AppHandle, reference: &str, plaintext: &str) -> Result<(), String> {
    let sealed = seal(&master_key(app)?, plaintext)?;
    let mut map = read_store(app)?;
    map.insert(reference.to_string(), serde_json::Value::String(sealed));
    write_store(app, &map)
}

fn file_get(app: &AppHandle, reference: &str) -> Result<Option<String>, String> {
    let map = read_store(app)?;
    match map.get(reference).and_then(|v| v.as_str()) {
        None => Ok(None),
        Some(sealed) => open(&master_key(app)?, sealed).map(Some),
    }
}

fn file_delete(app: &AppHandle, reference: &str) -> Result<(), String> {
    let mut map = read_store(app)?;
    if map.remove(reference).is_some() {
        write_store(app, &map)?;
    }
    Ok(())
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────

/// Encrypt `plaintext`, returning base64 of `nonce || ciphertext`.
fn seal(key_bytes: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key_bytes));

    // A fresh CSPRNG nonce per encryption. Reusing a nonce under AES-GCM leaks
    // plaintext and destroys authentication, so this must never be derived from
    // a clock or a hash.
    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("CSPRNG unavailable: {e}"))?;

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(|_| "encryption failed".to_string())?;

    let mut out = nonce_bytes.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

/// Reverse of [`seal`].
fn open(key_bytes: &[u8; 32], sealed: &str) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(sealed)
        .map_err(|e| format!("stored secret is not valid base64: {e}"))?;
    if data.len() < 12 {
        return Err("stored secret is truncated".into());
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key_bytes));
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| "stored secret failed authentication — wrong key or tampered".to_string())?;

    String::from_utf8(plain).map_err(|e| e.to_string())
}

// ── Legacy migration ───────────────────────────────────────────────────────

/// Decrypt a value produced by the original `sync.rs` scheme.
///
/// Retained solely to migrate existing WebDAV passwords onto this module on
/// first run.  Do not use for anything new — the key is recoverable from
/// `config.json`, which is why this migration exists in the first place.
pub fn legacy_decrypt(enc: &str, device_id: &str) -> String {
    let data = match base64::engine::general_purpose::STANDARD.decode(enc) {
        Ok(d) => d,
        Err(_) => return String::new(),
    };
    if data.len() < 12 {
        return String::new();
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);

    // The original weak derivation, reproduced exactly so old values still open.
    let seed = format!("stockfolio-sync-v1:{}", device_id);
    let mut key = [0u8; 32];
    for (i, b) in seed.as_bytes().iter().enumerate() {
        key[i % 32] ^= b;
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default()
}

/// Reference under which a sync target's password is stored.
pub fn sync_reference(target_id: &str) -> String {
    format!("sync:{target_id}")
}

/// Reference under which a broker connection's credentials are stored.
pub fn broker_reference(connection_id: &str) -> String {
    format!("broker:{connection_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_roundtrip() {
        let key = [7u8; 32];
        let sealed = seal(&key, "hunter2").unwrap();
        assert_eq!(open(&key, &sealed).unwrap(), "hunter2");
    }

    #[test]
    fn nonce_differs_between_seals() {
        let key = [7u8; 32];
        // Identical plaintext must not produce identical ciphertext, or the
        // nonce is not random and AES-GCM's guarantees are void.
        assert_ne!(seal(&key, "same").unwrap(), seal(&key, "same").unwrap());
    }

    #[test]
    fn wrong_key_is_rejected() {
        let sealed = seal(&[1u8; 32], "secret").unwrap();
        assert!(open(&[2u8; 32], &sealed).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = [7u8; 32];
        let sealed = seal(&key, "secret").unwrap();
        let mut raw = base64::engine::general_purpose::STANDARD
            .decode(&sealed)
            .unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xFF;
        let tampered = base64::engine::general_purpose::STANDARD.encode(raw);
        assert!(open(&key, &tampered).is_err());
    }
}
