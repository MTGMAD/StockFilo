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
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BASE_URL: &str = "https://api.snaptrade.com/api/v1";

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
    /// OpenAPI spec — not a bare array.
    pub async fn positions(&self, account_id: &str) -> BrokerResult<Vec<Value>> {
        let subpath = format!("/accounts/{account_id}/positions/all");
        let v = self.get(&subpath, &[]).await?;
        v.get("results")
            .and_then(|r| r.as_array())
            .cloned()
            .ok_or_else(|| BrokerError::Parse("expected a `results` array of positions".into()))
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
        let text = resp.text().await.unwrap_or_default();

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
