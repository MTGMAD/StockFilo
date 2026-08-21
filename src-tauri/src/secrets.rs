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
//!    handles encryption at rest and access control.
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
use tauri::{AppHandle, Manager};

/// Keychain service name.  Matches the bundle identifier in `tauri.conf.json`.
const SERVICE: &str = "com.stockfolio.app";

/// Filename of the fallback master key, stored in the app config directory.
const KEYFILE: &str = "secrets.key";

// ── Public API ─────────────────────────────────────────────────────────────

/// Store `plaintext` under `reference`, overwriting any existing value.
pub fn set_secret(app: &AppHandle, reference: &str, plaintext: &str) -> Result<(), String> {
    match keyring_entry(reference) {
        Ok(entry) => match entry.set_password(plaintext) {
            Ok(()) => return Ok(()),
            Err(e) => log_fallback("store", reference, &e.to_string()),
        },
        Err(e) => log_fallback("open", reference, &e),
    }
    file_set(app, reference, plaintext)
}

/// Retrieve the secret stored under `reference`.
///
/// Returns `Ok(None)` when no secret exists here — which is a normal state, not
/// an error: a database synced from another device carries broker connections
/// whose credentials live in *that* machine's keychain.  Callers must surface
/// this as "add credentials on this device", never as a failure.
pub fn get_secret(app: &AppHandle, reference: &str) -> Result<Option<String>, String> {
    if let Ok(entry) = keyring_entry(reference) {
        match entry.get_password() {
            Ok(v) => return Ok(Some(v)),
            Err(keyring::Error::NoEntry) => {} // fall through to the file backend
            Err(e) => log_fallback("read", reference, &e.to_string()),
        }
    }
    file_get(app, reference)
}

/// Remove the secret stored under `reference`.  Succeeds if it was already gone.
pub fn delete_secret(app: &AppHandle, reference: &str) -> Result<(), String> {
    if let Ok(entry) = keyring_entry(reference) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => log_fallback("delete", reference, &e.to_string()),
        }
    }
    file_delete(app, reference)
}

/// True when a secret is present on this device.  Used by the UI to distinguish
/// "not configured here" from "broken".
pub fn has_secret(app: &AppHandle, reference: &str) -> bool {
    matches!(get_secret(app, reference), Ok(Some(_)))
}

// ── Keychain backend ───────────────────────────────────────────────────────

fn keyring_entry(reference: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())
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
