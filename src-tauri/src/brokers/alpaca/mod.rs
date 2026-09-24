//! Alpaca adapter.
//!
//! Live and paper are the same code path with a different base URL — Alpaca
//! issues separate credentials for each, so they are separate connections.

pub mod client;
pub mod map;

use std::collections::HashSet;

use super::error::{BrokerError, BrokerResult};
use super::types::{
    AccountType, CredentialField, Credentials, OrderStatusConfig, ProviderDescriptor,
    RemoteAccount, RemoteActivity, RemoteOrder, RemotePosition,
};
use client::AlpacaClient;

pub const ID: &str = "alpaca";

const KEY_ID: &str = "api_key_id";
const SECRET: &str = "api_secret_key";

/// Alpaca returns at most 100 activities per page.
const PAGE_SIZE: usize = 100;

/// Stop after this many pages. At 100 fills per page this is 50,000 fills —
/// far beyond a personal account, and it guarantees a malformed `page_token`
/// response can never spin forever.
const MAX_PAGES: usize = 500;

/// Alpaca's maximum for `GET /v2/orders`.
const ORDER_PAGE_SIZE: usize = 500;

/// 100 pages × 500 = 50,000 orders — a hard stop, same reasoning as MAX_PAGES.
const MAX_ORDER_PAGES: usize = 100;

pub struct Alpaca;

impl Alpaca {
    pub fn descriptor() -> ProviderDescriptor {
        ProviderDescriptor {
            id: ID.to_string(),
            name: "Alpaca".to_string(),
            auth_kind: "fields".to_string(),
            // Alpaca's real-money environment is a margin account — that is the
            // only kind they issue — so it is labelled for what it is rather
            // than for the API endpoint behind it. A "cash" type slots in here
            // the day a provider offers one.
            account_types: vec![
                AccountType::new("live", "Margin", "margin")
                    .with_description("Your real Alpaca account, trading real money."),
                AccountType::new("paper", "Paper", "paper")
                    .with_description("Practice account with simulated money."),
            ],
            credential_fields: vec![
                CredentialField::new(KEY_ID, "API Key ID", false)
                    .with_placeholder("PK…")
                    .with_help("From Alpaca's dashboard, under API Keys."),
                CredentialField::new(SECRET, "API Secret Key", true)
                    .with_help("Shown only once when the key is generated."),
            ],
            supports_positions: true,
            supports_activities: true,
            supports_orders: true,
            provides_pricing: true,
            docs_url: Some("https://app.alpaca.markets/paper/dashboard/overview".to_string()),
            logo_domain: Some("alpaca.markets".to_string()),
        }
    }

    fn connect(creds: &Credentials, environment: &str) -> BrokerResult<AlpacaClient> {
        let key = creds
            .get(KEY_ID)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| BrokerError::MissingCredential("API Key ID".into()))?;
        let secret = creds
            .get(SECRET)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| BrokerError::MissingCredential("API Secret Key".into()))?;

        AlpacaClient::new(key, secret, environment)
    }

    /// Verify credentials and return the account they unlock.
    ///
    /// Alpaca exposes exactly one account per key pair, so this is always a
    /// single-element vector. The signature is plural because other brokerages
    /// expose several accounts behind one login.
    pub async fn verify(
        creds: &Credentials,
        environment: &str,
    ) -> BrokerResult<Vec<RemoteAccount>> {
        let client = Self::connect(creds, environment)?;
        let v = client.get_json("/v2/account", &[]).await?;
        Ok(vec![map::account(&v)])
    }

    /// `_provider_account_id` is unused here — Alpaca exposes exactly one
    /// account per key pair, so its positions endpoint already returns
    /// everything the connection can see. The parameter exists because a
    /// provider like SnapTrade can expose several accounts behind one
    /// connection and needs it to fetch the right one.
    pub async fn positions(
        creds: &Credentials,
        environment: &str,
        _provider_account_id: &str,
    ) -> BrokerResult<Vec<RemotePosition>> {
        let client = Self::connect(creds, environment)?;
        let v = client.get_json("/v2/positions", &[]).await?;

        let arr = v
            .as_array()
            .ok_or_else(|| BrokerError::Parse("expected an array of positions".into()))?;

        Ok(arr.iter().filter_map(map::position).collect())
    }

    /// Fetch FILL activities, newest first, following Alpaca's `page_token`
    /// cursor until the history is exhausted.
    ///
    /// `since` is an optional `YYYY-MM-DD` lower bound.
    pub async fn activities(
        creds: &Credentials,
        environment: &str,
        since: Option<&str>,
    ) -> BrokerResult<Vec<RemoteActivity>> {
        let client = Self::connect(creds, environment)?;
        let mut out: Vec<RemoteActivity> = Vec::new();
        let mut page_token: Option<String> = None;

        for _ in 0..MAX_PAGES {
            let mut query: Vec<(&str, String)> = vec![("page_size", PAGE_SIZE.to_string())];
            if let Some(s) = since {
                query.push(("after", s.to_string()));
            }
            if let Some(ref t) = page_token {
                query.push(("page_token", t.clone()));
            }

            let v = client
                .get_json("/v2/account/activities/FILL", &query)
                .await?;
            let arr = match v.as_array() {
                Some(a) => a,
                None => break,
            };
            if arr.is_empty() {
                break;
            }

            // The cursor is the id of the last item in the page, so capture it
            // before filtering — a row we skip must still advance the cursor.
            let last_id = arr
                .last()
                .and_then(|x| x.get("id"))
                .and_then(|x| x.as_str())
                .map(str::to_string);

            out.extend(arr.iter().filter_map(map::activity));

            if arr.len() < PAGE_SIZE {
                break;
            }
            match last_id {
                Some(id) => page_token = Some(id),
                // Without a cursor another request would repeat this page.
                None => break,
            }
        }

        Ok(out)
    }

    /// Alpaca's documented order statuses.
    pub fn order_statuses() -> OrderStatusConfig {
        OrderStatusConfig::new(
            &[
                "new", "partially_filled", "filled", "done_for_day", "canceled", "expired",
                "replaced", "pending_cancel", "pending_replace", "accepted", "pending_new",
                "accepted_for_bidding", "stopped", "rejected", "suspended", "calculated", "held",
            ],
            &["filled", "canceled", "expired", "replaced", "rejected"],
            &["filled", "canceled"],
            None,
        )
    }

    /// Every order on the account, in every status, newest first.
    ///
    /// `GET /v2/orders` has no cursor — it pages by time. Each request asks
    /// for orders submitted before the oldest one already seen, and ids are
    /// de-duplicated in case the boundary is inclusive.
    pub async fn orders(creds: &Credentials, environment: &str) -> BrokerResult<Vec<RemoteOrder>> {
        let client = Self::connect(creds, environment)?;
        let mut out: Vec<RemoteOrder> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut until: Option<String> = None;

        for _ in 0..MAX_ORDER_PAGES {
            let mut query: Vec<(&str, String)> = vec![
                ("status", "all".to_string()),
                ("limit", ORDER_PAGE_SIZE.to_string()),
                ("direction", "desc".to_string()),
                ("nested", "true".to_string()),
            ];
            if let Some(ref u) = until {
                query.push(("until", u.clone()));
            }

            let v = client.get_json("/v2/orders", &query).await?;
            let arr = v
                .as_array()
                .ok_or_else(|| BrokerError::Parse("expected an array of orders".into()))?;

            let mut added = 0usize;
            for o in arr {
                let Some(id) = o.get("id").and_then(|x| x.as_str()) else { continue };
                if seen.insert(id.to_string()) {
                    map::orders(o, &mut out);
                    added += 1;
                }
            }

            // A short page is the last one; a page of nothing but repeats means
            // the time cursor has stopped moving.
            if arr.len() < ORDER_PAGE_SIZE || added == 0 {
                break;
            }
            match arr
                .last()
                .and_then(|o| o.get("submitted_at"))
                .and_then(|x| x.as_str())
            {
                Some(ts) => until = Some(ts.to_string()),
                None => break,
            }
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds(k: &str, s: &str) -> Credentials {
        let mut c = Credentials::new();
        c.insert(KEY_ID.into(), k.into());
        c.insert(SECRET.into(), s.into());
        c
    }

    #[test]
    fn descriptor_declares_two_fields_and_both_environments() {
        let d = Alpaca::descriptor();
        assert_eq!(d.id, "alpaca");
        let ids: Vec<&str> = d.account_types.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["live", "paper"]);
        // The label describes the account, not the endpoint.
        let margin = d.account_types.iter().find(|a| a.id == "live").unwrap();
        assert_eq!(margin.label, "Margin");
        assert_eq!(margin.kind, "margin");
        let paper = d.account_types.iter().find(|a| a.id == "paper").unwrap();
        assert_eq!(paper.label, "Paper");
        assert_eq!(paper.kind, "paper");
        assert_eq!(d.credential_fields.len(), 2);
        // The secret must be flagged so the UI masks it.
        assert!(d.credential_fields.iter().any(|f| f.key == SECRET && f.secret));
        assert!(!d.credential_fields.iter().find(|f| f.key == KEY_ID).unwrap().secret);
        assert!(d.provides_pricing);
    }

    #[test]
    fn missing_credentials_are_named_in_the_error() {
        let mut c = Credentials::new();
        c.insert(KEY_ID.into(), "PK123".into());
        let err = Alpaca::connect(&c, "paper").unwrap_err().to_string();
        assert!(err.contains("API Secret Key"), "got: {err}");
    }

    #[test]
    fn blank_credentials_count_as_missing() {
        let err = Alpaca::connect(&creds("  ", "secret"), "paper")
            .unwrap_err()
            .to_string();
        assert!(err.contains("API Key ID"), "got: {err}");
    }

    #[test]
    fn environment_is_validated() {
        assert!(Alpaca::connect(&creds("k", "s"), "live").is_ok());
        assert!(Alpaca::connect(&creds("k", "s"), "paper").is_ok());
        assert!(Alpaca::connect(&creds("k", "s"), "prod").is_err());
    }
}
