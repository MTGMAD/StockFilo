//! Alpaca REST client.
//!
//! # This client is read-only by construction
//!
//! It exposes exactly one method — [`AlpacaClient::get_json`] — and there is no
//! `post`, `put`, `patch`, or `delete` anywhere in this module.  An Alpaca
//! trading key can submit and cancel orders, so the guarantee that Stockfolio
//! never trades on your behalf rests on the fact that **the code to do so does
//! not exist**, not on a policy or a code review.
//!
//! Please do not add a write method here. If some future feature genuinely
//! needs one, it should be a separate, explicitly-named module so that the
//! read-only guarantee stays greppable.

use super::super::error::{BrokerError, BrokerResult};
use serde_json::Value;
use std::time::Duration;

const LIVE_BASE: &str = "https://api.alpaca.markets";
const PAPER_BASE: &str = "https://paper-api.alpaca.markets";

#[derive(Debug)]
pub struct AlpacaClient {
    http: reqwest::Client,
    base: String,
    key_id: String,
    secret: String,
}

impl AlpacaClient {
    pub fn new(key_id: &str, secret: &str, environment: &str) -> BrokerResult<Self> {
        let base = match environment {
            "live" => LIVE_BASE,
            "paper" => PAPER_BASE,
            other => return Err(BrokerError::UnknownEnvironment(other.to_string())),
        };

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| BrokerError::Network(e.to_string()))?;

        Ok(AlpacaClient {
            http,
            base: base.to_string(),
            key_id: key_id.to_string(),
            secret: secret.to_string(),
        })
    }

    /// Perform an authenticated GET and parse the JSON body.
    pub async fn get_json(&self, path: &str, query: &[(&str, String)]) -> BrokerResult<Value> {
        let url = format!("{}{}", self.base, path);

        let mut req = self
            .http
            .get(&url)
            .header("APCA-API-KEY-ID", &self.key_id)
            .header("APCA-API-SECRET-KEY", &self.secret)
            .header("Accept", "application/json");

        if !query.is_empty() {
            req = req.query(query);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| BrokerError::Network(e.to_string()))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(BrokerError::Unauthorized);
        }

        if !status.is_success() {
            // Alpaca returns {"message": "..."} on errors; prefer that over the
            // raw body, which is noisy in a UI.
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
                .unwrap_or_else(|| body.chars().take(200).collect());
            return Err(BrokerError::Api(format!("HTTP {status} — {detail}")));
        }

        serde_json::from_str(&body).map_err(|e| BrokerError::Parse(e.to_string()))
    }
}

// ── JSON helpers ───────────────────────────────────────────────────────────
//
// Alpaca returns numeric fields as JSON *strings* ("qty": "10.5"), and omits
// or nulls them freely. These normalize both shapes.

/// Read a number that may arrive as a string, a number, or not at all.
pub fn num(v: &Value, key: &str) -> Option<f64> {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// Read a string field, treating empty as absent.
pub fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_numbers_given_as_strings() {
        let v = json!({ "qty": "10.5", "price": 3.25, "missing": null, "blank": "" });
        assert_eq!(num(&v, "qty"), Some(10.5));
        assert_eq!(num(&v, "price"), Some(3.25));
        assert_eq!(num(&v, "missing"), None);
        assert_eq!(num(&v, "blank"), None);
        assert_eq!(num(&v, "absent"), None);
    }

    #[test]
    fn negative_and_exponent_forms_parse() {
        let v = json!({ "pl": "-1234.56", "tiny": "1e-3" });
        assert_eq!(num(&v, "pl"), Some(-1234.56));
        assert_eq!(num(&v, "tiny"), Some(0.001));
    }

    #[test]
    fn text_treats_empty_as_absent() {
        let v = json!({ "a": "x", "b": "", "c": null });
        assert_eq!(text(&v, "a"), Some("x".into()));
        assert_eq!(text(&v, "b"), None);
        assert_eq!(text(&v, "c"), None);
    }

    #[test]
    fn rejects_unknown_environment() {
        assert!(AlpacaClient::new("k", "s", "sandbox").is_err());
        assert!(AlpacaClient::new("k", "s", "live").is_ok());
        assert!(AlpacaClient::new("k", "s", "paper").is_ok());
    }
}
