//! SnapTrade REST client.
//!
//! # This client is read-only by construction
//!
//! SnapTrade's own API can place trades, but nothing in this module calls a
//! trading endpoint, and [`SnapTradeClient::portal_url`] always requests
//! `connectionType: "read"` — SnapTrade's own data-only mode — so the portal
//! itself refuses to grant trading permission even before this client's own
//! guarantee applies. If a future feature genuinely needs a write call, it
//! belongs in a separate, explicitly-named module so the read-only guarantee
//! stays greppable, exactly as `alpaca/client.rs` does it.
//!
//! # Request signing
//!
//! Every request is signed per SnapTrade's documented scheme
//! (<https://docs.snaptrade.com/docs/request-signatures>): build
//! `{"content": <body or null>, "path": "/api/v1<subpath>", "query":
//! "<raw query string>"}`, serialize it as compact JSON with object keys
//! sorted alphabetically at every level, HMAC-SHA256 it with the consumer key,
//! and base64-encode the digest. Verified against a live Personal-key
//! account: `clientId`/`timestamp` are query parameters (not headers), and
//! the signature travels in a header literally named `Signature` — the
//! official SDKs' `configuration.py` is authoritative here, not the docs
//! site's prose, which paraphrases it as `PartnerSignature`/`Signature`
//! ambiguously enough to get this wrong on the first attempt.
//!
//! Stockfolio uses SnapTrade's *Personal* key tier (one person, one account —
//! see `super`'s module doc), which never sends `userId`/`userSecret`.
//!
//! Position field names (`AccountPosition`, `Instrument`) are confirmed
//! against SnapTrade's own OpenAPI spec
//! (<https://github.com/passiv/snaptrade-sdks/blob/master/api.yaml>) after an
//! earlier doc-only guess got the response envelope wrong (`results`, not a
//! bare array) and missed that `units`/`price`/`cost_basis` are decimal
//! *strings*, not numbers. Account field names are still only the docs'
//! worked example, not the formal schema — [`super::map::account`] stays
//! defensive for that reason.

use super::super::error::{BrokerError, BrokerResult};
use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const BASE_URL: &str = "https://api.snaptrade.com/api/v1";

// ── Rate limiting ──────────────────────────────────────────────────────────
//
// Personal keys get 10 requests per minute *per account* on the account-level
// endpoints (positions, balances, orders, activities…), rolling 60s window,
// separate bucket per account (<https://docs.snaptrade.com/docs/ratelimiting>).
// Several things poll the same account — the on-screen portfolio, the
// background refresh, a manual Sync — so the budget is enforced here, in one
// process-wide place, rather than hoping the callers' timers never overlap.

/// Deliberately under SnapTrade's 10, leaving headroom for clock skew
/// between our window and theirs.
const ACCOUNT_BUDGET: usize = 8;
const ACCOUNT_WINDOW: Duration = Duration::from_secs(60);
/// Activity types that change a share count — everything the Purchases view
/// shows. REI (dividend reinvestment) is a buy of shares.
const ACTIVITY_TYPES: &str = "BUY,SELL,REI";

/// Used when a 429 arrives without a parseable wait.
const DEFAULT_RETRY_SECS: u64 = 60;

#[derive(Default)]
struct AccountLimiter {
    recent: HashMap<String, VecDeque<Instant>>,
    /// Set from a 429 — SnapTrade told us when it will accept again.
    blocked_until: HashMap<String, Instant>,
}

fn limiter() -> &'static Mutex<AccountLimiter> {
    static LIMITER: OnceLock<Mutex<AccountLimiter>> = OnceLock::new();
    LIMITER.get_or_init(Default::default)
}

fn ceil_secs(d: Duration) -> u64 {
    d.as_secs() + u64::from(d.subsec_nanos() > 0)
}

impl AccountLimiter {
    /// Reserve one request for `account_id` at `now`, or return the seconds
    /// until one is free. Never sleeps — a throttled sync just skips the
    /// account until its next round.
    fn acquire(&mut self, account_id: &str, now: Instant) -> Result<(), u64> {
        if let Some(until) = self.blocked_until.get(account_id) {
            if *until > now {
                return Err(ceil_secs(*until - now).max(1));
            }
            self.blocked_until.remove(account_id);
        }
        let q = self.recent.entry(account_id.to_string()).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= ACCOUNT_WINDOW) {
            q.pop_front();
        }
        if q.len() >= ACCOUNT_BUDGET {
            let oldest = *q.front().expect("len >= budget > 0");
            return Err(ceil_secs(ACCOUNT_WINDOW - now.duration_since(oldest)).max(1));
        }
        q.push_back(now);
        Ok(())
    }

    fn block(&mut self, account_id: &str, secs: u64, now: Instant) {
        self.blocked_until
            .insert(account_id.to_string(), now + Duration::from_secs(secs));
    }
}

/// Seconds to wait after a 429: the account-level reset header, then the
/// customer-level one, then the body's "Expected available in N seconds".
fn retry_after_secs(headers: &reqwest::header::HeaderMap, body: &str) -> u64 {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<f64>().ok())
    };
    header("X-RateLimit-Account-Reset")
        .or_else(|| header("X-RateLimit-Reset"))
        .or_else(|| parse_expected_available(body))
        .map(|s| s.ceil().max(1.0) as u64)
        .unwrap_or(DEFAULT_RETRY_SECS)
}

fn parse_expected_available(body: &str) -> Option<f64> {
    let rest = &body[body.find("available in")? + "available in".len()..];
    let num: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    num.parse().ok()
}

#[derive(Debug)]
pub struct SnapTradeClient {
    http: reqwest::Client,
    client_id: String,
    consumer_key: String,
}

impl SnapTradeClient {
    pub fn new(client_id: &str, consumer_key: &str) -> BrokerResult<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| BrokerError::Network(e.to_string()))?;

        Ok(SnapTradeClient {
            http,
            client_id: client_id.to_string(),
            consumer_key: consumer_key.to_string(),
        })
    }

    /// Generate a Connection Portal URL for the person to open in their
    /// browser. Always requests SnapTrade's `"read"` connection type — the
    /// portal itself will not grant order-placement permission.
    ///
    /// No `userId`/`userSecret` here: those belong to SnapTrade's Partner
    /// tier (one company's app onboarding many of *its* customers, each
    /// explicitly registered via `registerUser`). Stockfolio is a personal,
    /// single-user desktop app, so it uses a Personal `clientId`/`consumerKey`
    /// pair instead — SnapTrade resolves the user implicitly from that key
    /// pair, and sending `userId`/`userSecret` on a Personal key is a
    /// documented 400 ("registerUser is not available for personal keys").
    pub async fn portal_url(&self) -> BrokerResult<String> {
        let body = serde_json::json!({ "connectionType": "read" });
        let v = self.post("/snapTrade/login", &[], Some(body)).await?;
        v.get("redirectURI")
            .or_else(|| v.get("redirectUri"))
            .and_then(|s| s.as_str())
            .map(str::to_string)
            .ok_or_else(|| BrokerError::Parse("login response had no redirect URL".into()))
    }

    /// Every account this Personal key's user has ever linked, across every
    /// brokerage connected through the portal — not scoped to one
    /// authorization. Callers filter by `brokerage_authorization`.
    pub async fn list_accounts(&self) -> BrokerResult<Vec<Value>> {
        let v = self.get("/accounts", &[]).await?;
        v.as_array()
            .cloned()
            .ok_or_else(|| BrokerError::Parse("expected an array of accounts".into()))
    }

    /// Every position currently held in one account. The response is
    /// `AllAccountPositionsResponse` — `{"results": [AccountPosition, ...],
    /// "data_freshness": {...}}`, confirmed against SnapTrade's published
    /// OpenAPI spec — not a bare array. Real-time on Personal keys.
    pub async fn positions(&self, account_id: &str) -> BrokerResult<Vec<Value>> {
        let subpath = format!("/accounts/{account_id}/positions/all");
        let v = self.account_get(account_id, &subpath, &[]).await?;
        v.get("results")
            .and_then(|r| r.as_array())
            .cloned()
            .ok_or_else(|| BrokerError::Parse("expected a `results` array of positions".into()))
    }

    /// Trade history (`GET /accounts/{id}/activities`), newest first, limited
    /// to the types that move shares. SnapTrade documents this endpoint as
    /// *Daily* data on every plan — cached, refreshed once a day — which is why
    /// the caller supplements it with executed orders (real-time).
    ///
    /// `start_date` is an inclusive `YYYY-MM-DD` lower bound. Pages by
    /// `offset`, 1000 per page.
    pub async fn activities(&self, account_id: &str, start_date: Option<&str>) -> BrokerResult<Vec<Value>> {
        const PAGE: usize = 1000;
        const MAX_PAGES: usize = 20;
        let subpath = format!("/accounts/{account_id}/activities");
        let mut out = Vec::new();
        for page in 0..MAX_PAGES {
            let offset = (page * PAGE).to_string();
            let limit = PAGE.to_string();
            let mut query: Vec<(&str, &str)> = vec![
                ("limit", &limit),
                ("offset", &offset),
                ("type", ACTIVITY_TYPES),
            ];
            if let Some(d) = start_date {
                query.push(("startDate", d));
            }
            let v = self.account_get(account_id, &subpath, &query).await?;
            let data = v
                .get("data")
                .and_then(|d| d.as_array())
                .ok_or_else(|| BrokerError::Parse("expected a `data` array of activities".into()))?;
            out.extend(data.iter().cloned());
            if data.len() < PAGE {
                break;
            }
        }
        Ok(out)
    }

    /// Orders placed in the last `days` days (SnapTrade caps this at 90),
    /// `state` = "all" | "open" | "executed". Real-time on Personal keys.
    pub async fn orders(&self, account_id: &str, state: &str, days: u32) -> BrokerResult<Vec<Value>> {
        let subpath = format!("/accounts/{account_id}/orders");
        let days = days.to_string();
        let v = self
            .account_get(account_id, &subpath, &[("state", state), ("days", &days)])
            .await?;
        v.as_array()
            .cloned()
            .ok_or_else(|| BrokerError::Parse("expected an array of orders".into()))
    }

    /// GET an account-level endpoint, which on Personal keys draws on that
    /// account's 10-per-minute bucket — see `AccountLimiter`.
    async fn account_get(
        &self,
        account_id: &str,
        subpath: &str,
        query: &[(&str, &str)],
    ) -> BrokerResult<Value> {
        limiter()
            .lock()
            .expect("limiter lock")
            .acquire(account_id, Instant::now())
            .map_err(BrokerError::RateLimited)?;

        match self.get(subpath, query).await {
            Err(BrokerError::RateLimited(secs)) => {
                limiter()
                    .lock()
                    .expect("limiter lock")
                    .block(account_id, secs, Instant::now());
                Err(BrokerError::RateLimited(secs))
            }
            other => other,
        }
    }

    // ── Transport ────────────────────────────────────────────────────────

    async fn get(&self, subpath: &str, query: &[(&str, &str)]) -> BrokerResult<Value> {
        self.call(reqwest::Method::GET, subpath, query, None).await
    }

    async fn post(
        &self,
        subpath: &str,
        query: &[(&str, &str)],
        body: Option<Value>,
    ) -> BrokerResult<Value> {
        self.call(reqwest::Method::POST, subpath, query, body).await
    }

    async fn call(
        &self,
        method: reqwest::Method,
        subpath: &str,
        extra_query: &[(&str, &str)],
        body: Option<Value>,
    ) -> BrokerResult<Value> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| BrokerError::Network(e.to_string()))?
            .as_secs()
            .to_string();

        let mut pairs: Vec<(&str, &str)> = vec![("clientId", &self.client_id), ("timestamp", &timestamp)];
        pairs.extend_from_slice(extra_query);

        let query_string = pairs
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        let signature = self.sign(subpath, &query_string, body.as_ref());

        let url = format!("{BASE_URL}{subpath}?{query_string}");
        // Per the official SDKs' auth_settings (configuration.py):  clientId
        // and timestamp are query parameters only — already folded into
        // `url` above — and the signature travels in a header literally
        // named "Signature", not "PartnerSignature". The signing *algorithm*
        // (what gets hashed) is unaffected; only this transport detail was
        // wrong in an earlier pass, sourced from doc prose rather than code.
        let mut req = self.http.request(method, &url).header("Signature", &signature);
        if let Some(b) = &body {
            req = req.json(b);
        }

        let resp = req.send().await.map_err(|e| BrokerError::Network(e.to_string()))?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let text = resp.text().await.unwrap_or_default();

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(BrokerError::RateLimited(retry_after_secs(&headers, &text)));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(BrokerError::Unauthorized);
        }
        if !status.is_success() {
            return Err(BrokerError::Api(format!("SnapTrade returned {status}: {text}")));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }

        serde_json::from_str(&text).map_err(|e| BrokerError::Parse(e.to_string()))
    }

    fn sign(&self, subpath: &str, query_string: &str, body: Option<&Value>) -> String {
        let sig_object = serde_json::json!({
            "content": body.cloned().unwrap_or(Value::Null),
            "path": format!("/api/v1{subpath}"),
            "query": query_string,
        });
        let canonical = canonical_json(&sig_object);

        // `consumer_key` is not a fixed-length key, so `new_from_slice` on
        // Hmac<Sha256> cannot fail — it accepts any key length.
        let mut mac = Hmac::<Sha256>::new_from_slice(self.consumer_key.as_bytes())
            .expect("HMAC-SHA256 accepts a key of any length");
        mac.update(canonical.as_bytes());
        base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
    }
}

/// Compact JSON with object keys sorted alphabetically at every level, as
/// SnapTrade's signing scheme requires. Implemented by hand rather than
/// relying on `serde_json::Map`'s default ordering, which depends on whether
/// some other crate in the build enabled the `preserve_order` feature.
fn canonical_json(v: &Value) -> String {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .into_iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap_or_default(),
                        canonical_json(&map[k])
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        other => serde_json::to_string(other).unwrap_or_else(|_| "null".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact example from SnapTrade's request-signatures doc — canonical
    /// output must match byte-for-byte or the signature it feeds is wrong.
    #[test]
    fn canonical_json_matches_the_documented_example() {
        let v = serde_json::json!({
            "content": { "substring": "AAPL" },
            "path": "/api/v1/symbols",
            "query": "clientId=YOUR_CLIENT_ID&timestamp=1715123456",
        });
        assert_eq!(
            canonical_json(&v),
            r#"{"content":{"substring":"AAPL"},"path":"/api/v1/symbols","query":"clientId=YOUR_CLIENT_ID&timestamp=1715123456"}"#
        );
    }

    #[test]
    fn limiter_allows_the_budget_then_reports_the_wait() {
        let mut l = AccountLimiter::default();
        let t0 = Instant::now();
        for i in 0..ACCOUNT_BUDGET {
            assert!(l.acquire("acct", t0 + Duration::from_secs(i as u64)).is_ok());
        }
        // Next request at t0+10s: the oldest (t0) frees up at t0+60s.
        assert_eq!(l.acquire("acct", t0 + Duration::from_secs(10)), Err(50));
        // Other accounts have their own bucket.
        assert!(l.acquire("other", t0 + Duration::from_secs(10)).is_ok());
        // Once the window has rolled past the oldest request, it's free again.
        assert!(l.acquire("acct", t0 + Duration::from_secs(60)).is_ok());
    }

    #[test]
    fn limiter_honours_a_block_from_a_429() {
        let mut l = AccountLimiter::default();
        let t0 = Instant::now();
        l.block("acct", 30, t0);
        assert_eq!(l.acquire("acct", t0 + Duration::from_secs(5)), Err(25));
        assert!(l.acquire("acct", t0 + Duration::from_secs(30)).is_ok());
    }

    #[test]
    fn retry_after_prefers_the_account_header_then_the_body() {
        use reqwest::header::{HeaderMap, HeaderValue};
        let mut h = HeaderMap::new();
        h.insert("X-RateLimit-Account-Reset", HeaderValue::from_static("12"));
        h.insert("X-RateLimit-Reset", HeaderValue::from_static("40"));
        assert_eq!(retry_after_secs(&h, ""), 12);

        let body = r#""Request was throttled. Expected available in 7.2 seconds.""#;
        assert_eq!(retry_after_secs(&HeaderMap::new(), body), 8);
        assert_eq!(retry_after_secs(&HeaderMap::new(), "nope"), DEFAULT_RETRY_SECS);
    }

    #[test]
    fn canonical_json_sorts_nested_keys_too() {
        let v = serde_json::json!({ "b": 1, "a": { "z": 1, "y": 2 } });
        assert_eq!(canonical_json(&v), r#"{"a":{"y":2,"z":1},"b":1}"#);
    }

    #[test]
    fn null_content_serializes_as_null_not_omitted() {
        let v = serde_json::json!({ "content": null, "path": "/api/v1/accounts", "query": "" });
        assert_eq!(
            canonical_json(&v),
            r#"{"content":null,"path":"/api/v1/accounts","query":""}"#
        );
    }
}
