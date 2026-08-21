//! Ticker logos.
//!
//! Fetched in Rust and cached on disk rather than loaded straight into an
//! `<img>` tag. Three reasons:
//!
//! 1. The app's promise is that the frontend makes no network requests of its
//!    own — market data all flows through here, and logos were the one thing
//!    reaching out directly from the webview.
//! 2. It works wherever the rest of the app works. A webview can fail to reach
//!    a host the Rust client reaches happily, and the failure is invisible.
//! 3. A cached logo renders instantly and keeps working offline.

use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Remote source. Returns a small square PNG per symbol.
const LOGO_URL: &str = "https://assets.parqet.com/logos/symbol";

/// Brand icons, looked up by domain. Used for brokerage logos, where there is
/// no ticker to key on. Requested at 128px so the icon stays crisp on a
/// high-DPI display; the service returns a real site icon rather than a
/// generated placeholder.
const BRAND_URL: &str = "https://www.google.com/s2/favicons";

/// How long to wait before retrying a symbol that had no logo. Without this a
/// portfolio full of bonds and mutual funds would re-request on every render.
const MISS_TTL_SECS: i64 = 7 * 24 * 60 * 60;

/// Reject anything implausibly large for an icon, so a redirect to some other
/// resource cannot be cached as a logo.
const MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize)]
pub struct TickerLogo {
    pub ticker: String,
    /// `data:image/png;base64,…`, or None when this symbol has no logo.
    pub data_uri: Option<String>,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logos");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Keep the filename to characters that are safe on every platform — tickers
/// can contain '/' (crypto pairs) and '.' (share classes).
fn safe_name(ticker: &str) -> String {
    ticker
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
        .collect()
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn to_data_uri(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// Fetch a ticker's logo, using the on-disk cache when possible.
///
/// Returns `Ok(None)` when the symbol simply has no logo — a normal outcome for
/// bonds, CUSIPs and many funds — so the caller can draw its initials fallback
/// without treating it as an error.
#[tauri::command]
pub async fn fetch_ticker_logo(app: AppHandle, ticker: String) -> Result<TickerLogo, String> {
    let symbol = ticker.trim().to_uppercase();
    if symbol.is_empty() {
        return Ok(TickerLogo { ticker, data_uri: None });
    }

    let dir = cache_dir(&app)?;
    let hit = dir.join(format!("{}.png", safe_name(&symbol)));
    let miss = dir.join(format!("{}.miss", safe_name(&symbol)));

    if let Ok(bytes) = fs::read(&hit) {
        if !bytes.is_empty() {
            return Ok(TickerLogo {
                ticker: symbol,
                data_uri: Some(to_data_uri(&bytes)),
            });
        }
    }

    // A recent miss is remembered so a symbol without a logo is not requested
    // again on every mount.
    if let Ok(contents) = fs::read_to_string(&miss) {
        if let Ok(at) = contents.trim().parse::<i64>() {
            if now_secs() - at < MISS_TTL_SECS {
                return Ok(TickerLogo { ticker: symbol, data_uri: None });
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{LOGO_URL}/{}?format=png", urlencoding::encode(&symbol));
    let response = client.get(&url).send().await;

    let bytes = match response {
        Ok(r) if r.status().is_success() => {
            let is_image = r
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.starts_with("image/"))
                .unwrap_or(false);
            if is_image {
                r.bytes().await.ok().map(|b| b.to_vec())
            } else {
                None
            }
        }
        // A network failure is treated the same as "no logo" for display, but is
        // deliberately not written to the miss cache — the symbol may well have
        // a logo once connectivity returns.
        Ok(_) => None,
        Err(_) => {
            return Ok(TickerLogo { ticker: symbol, data_uri: None });
        }
    };

    match bytes {
        Some(b) if !b.is_empty() && b.len() <= MAX_BYTES => {
            let _ = fs::write(&hit, &b);
            let _ = fs::remove_file(&miss);
            Ok(TickerLogo {
                ticker: symbol,
                data_uri: Some(to_data_uri(&b)),
            })
        }
        _ => {
            let _ = fs::write(&miss, now_secs().to_string());
            Ok(TickerLogo { ticker: symbol, data_uri: None })
        }
    }
}

/// Fetch a brand icon by domain, e.g. "alpaca.markets".
///
/// Same disk cache and miss handling as ticker logos, and the same reason for
/// living in Rust: the webview makes no network requests of its own, and a
/// cached icon keeps working offline.
#[tauri::command]
pub async fn fetch_brand_logo(app: AppHandle, domain: String) -> Result<TickerLogo, String> {
    let host = domain.trim().to_lowercase();
    if host.is_empty() {
        return Ok(TickerLogo { ticker: domain, data_uri: None });
    }

    let dir = cache_dir(&app)?;
    let key = format!("brand_{}", safe_name(&host));
    let hit = dir.join(format!("{key}.png"));
    let miss = dir.join(format!("{key}.miss"));

    if let Ok(bytes) = fs::read(&hit) {
        if !bytes.is_empty() {
            return Ok(TickerLogo { ticker: host, data_uri: Some(to_data_uri(&bytes)) });
        }
    }

    if let Ok(contents) = fs::read_to_string(&miss) {
        if let Ok(at) = contents.trim().parse::<i64>() {
            if now_secs() - at < MISS_TTL_SECS {
                return Ok(TickerLogo { ticker: host, data_uri: None });
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{BRAND_URL}?domain={}&sz=128", urlencoding::encode(&host));
    let bytes = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => {
            let is_image = r
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.starts_with("image/"))
                .unwrap_or(false);
            if is_image { r.bytes().await.ok().map(|b| b.to_vec()) } else { None }
        }
        Ok(_) => None,
        // A network failure is not a miss — the icon may well exist once
        // connectivity returns, so it is not written to the miss cache.
        Err(_) => return Ok(TickerLogo { ticker: host, data_uri: None }),
    };

    match bytes {
        Some(b) if !b.is_empty() && b.len() <= MAX_BYTES => {
            let _ = fs::write(&hit, &b);
            let _ = fs::remove_file(&miss);
            Ok(TickerLogo { ticker: host, data_uri: Some(to_data_uri(&b)) })
        }
        _ => {
            let _ = fs::write(&miss, now_secs().to_string());
            Ok(TickerLogo { ticker: host, data_uri: None })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_are_safe_for_awkward_symbols() {
        assert_eq!(safe_name("AAPL"), "AAPL");
        assert_eq!(safe_name("brk.b"), "BRK_B");
        // Crypto pairs would otherwise create a subdirectory.
        assert_eq!(safe_name("BTC/USD"), "BTC_USD");
        assert_eq!(safe_name("../etc"), "___ETC");
    }

    #[test]
    fn data_uri_is_well_formed() {
        let uri = to_data_uri(&[0x89, 0x50, 0x4E, 0x47]);
        assert!(uri.starts_with("data:image/png;base64,"));
        assert!(uri.ends_with("iVBORw=="));
    }
}
