//! SnapTrade adapter — a brokerage aggregator, not a single brokerage.
//!
//! # Why this doesn't look like `alpaca/`
//!
//! Every other provider here is one login unlocking one connection's worth of
//! accounts, verified through a credential form. SnapTrade is structurally
//! different: one connect flow, driven by a hosted browser portal, can link
//! many brokerages, each login exposing one or more accounts, and a person
//! picks which of those accounts they want mirrored rather than getting all
//! of them automatically. See `commands::snaptrade` for the portal/connect
//! flow this drives — that flow deliberately does not go through
//! `broker_save_connection`.
//!
//! # Personal, not Partner, keys
//!
//! SnapTrade has two API tiers. *Partner* keys are for a company's app
//! onboarding many of its own customers: you register each one explicitly
//! (`registerUser`) and get back a per-user `userSecret`. *Personal* keys are
//! for exactly Stockfolio's situation — one person, one SnapTrade account —
//! and SnapTrade resolves "the user" implicitly from the `clientId`/
//! `consumerKey` pair itself. Sending `userId`/`userSecret` on a Personal key
//! is a documented, explicit 400 ("registerUser is not available for personal
//! keys"), so this module never sends them and never calls `registerUser`.
//!
//! What *is* shared with every other provider, once a brokerage is connected:
//! each underlying brokerage becomes its own `broker_connections` row
//! (`environment` is always [`ENVIRONMENT`] — a fixed placeholder, since
//! SnapTrade has no live/paper split of its own — and `credential_ref` is
//! unique per row the normal way), so the generic sync, positions, and
//! connection-card code paths apply unchanged. `Credentials` for a SnapTrade
//! row carries this app's `client_id`/`consumer_key` (duplicated per row
//! rather than threading app-level config through the generic `Provider`
//! dispatch) plus the `authorization_id` that scopes `verify()` to this one
//! brokerage login out of everything the Personal key's account has ever
//! connected.
//!
//! # Read-only
//!
//! The portal is opened with SnapTrade's `"read"` connection type (see
//! `client.rs`), and this module never calls a trading endpoint. Positions are
//! synced; nothing is ever placed or cancelled.

pub mod client;
pub mod map;

use super::error::{BrokerError, BrokerResult};
use super::types::{
    AccountType, Credentials, OrderStatusConfig, ProviderDescriptor, RemoteAccount,
    RemoteActivity, RemoteOrder, RemotePosition,
};
use client::SnapTradeClient;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const ID: &str = "snaptrade";

/// The only "environment" SnapTrade connections have. Kept as a real value
/// (not an empty string) so it satisfies the same `UNIQUE(provider,
/// environment, credential_ref)` constraint every other provider relies on —
/// satisfied here by `credential_ref` alone being unique per row.
pub const ENVIRONMENT: &str = "read";

const CLIENT_ID: &str = "client_id";
const CONSUMER_KEY: &str = "consumer_key";
const AUTHORIZATION_ID: &str = "authorization_id";

/// SnapTrade caps order history at 90 days.
const ORDER_HISTORY_DAYS: u32 = 90;

/// How far back to look for real-time fills the daily history may not have
/// yet. A week comfortably covers a weekend plus a late history refresh.
const RECENT_FILL_DAYS: u32 = 7;

/// The activity history is Daily data (refreshed once a day by SnapTrade), so
/// re-reading it on every 30-second sync would only burn rate-limit budget.
const HISTORY_REFRESH: Duration = Duration::from_secs(30 * 60);

fn history_fetched_at() -> &'static Mutex<HashMap<String, Instant>> {
    static AT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    AT.get_or_init(Default::default)
}

pub struct SnapTrade;

impl SnapTrade {
    pub fn descriptor() -> ProviderDescriptor {
        ProviderDescriptor {
            id: ID.to_string(),
            name: "SnapTrade".to_string(),
            // Not "fields" — there is no credential form, connecting happens
            // through a hosted browser portal. Not rendered by the generic
            // connect UI at all; see `Provider::all_descriptors`.
            auth_kind: "oauth".to_string(),
            // One fixed entry rather than SnapTrade's real per-account
            // type (margin/cash/etc, reported per account, not per
            // connection) — the account-type model here is connection-scoped,
            // and a SnapTrade connection is one brokerage login covering
            // whatever mix of account types it has. Refining this to a
            // per-account chip is future work, not a schema blocker.
            account_types: vec![AccountType::new(
                ENVIRONMENT,
                "Connected",
                "cash",
            )
            .with_description("Read-only, via SnapTrade.")],
            credential_fields: Vec::new(),
            supports_positions: true,
            supports_activities: true,
            supports_orders: true,
            provides_pricing: true,
            docs_url: Some("https://snaptrade.com/".to_string()),
            logo_domain: Some("snaptrade.com".to_string()),
        }
    }

    fn client(creds: &Credentials) -> BrokerResult<SnapTradeClient> {
        let client_id = required(creds, CLIENT_ID, "SnapTrade Client ID")?;
        let consumer_key = required(creds, CONSUMER_KEY, "SnapTrade Consumer Key")?;
        SnapTradeClient::new(client_id, consumer_key)
    }

    /// Every account under one brokerage authorization — `environment` is
    /// unused (it is always [`ENVIRONMENT`]); the authorization to filter to
    /// comes from `creds`, since that is what is actually unique per
    /// connection here.
    pub async fn verify(creds: &Credentials, _environment: &str) -> BrokerResult<Vec<RemoteAccount>> {
        let client = Self::client(creds)?;
        let authorization_id = required(creds, AUTHORIZATION_ID, "SnapTrade authorization id")?;

        let accounts = client.list_accounts().await?;
        Ok(accounts
            .iter()
            .filter(|a| map::authorization_id(a).as_deref() == Some(authorization_id))
            .filter_map(map::account)
            .collect())
    }

    /// `provider_account_id` is SnapTrade's own account id — unlike Alpaca,
    /// one connection here can hold several accounts, so this cannot fetch
    /// "everything the connection can see" the way Alpaca's does.
    pub async fn positions(
        creds: &Credentials,
        _environment: &str,
        provider_account_id: &str,
    ) -> BrokerResult<Vec<RemotePosition>> {
        let client = Self::client(creds)?;
        let raw = client.positions(provider_account_id).await?;
        Ok(raw.iter().filter_map(map::position).collect())
    }

    /// Share trades for one account, from two sources:
    ///
    /// 1. The activity history — complete, but SnapTrade's *Daily* data
    ///    (refreshed once a day on every plan). Re-read at most every 30
    ///    minutes, or immediately when nothing is stored yet (`since` is None).
    /// 2. Executed orders from the last week — real-time, so a fill appears
    ///    within minutes. Stored as provisional rows (`order:` ids) that
    ///    `store::reconcile_provisional` drops once the history reports them.
    ///
    /// A throttled or unsupported order book is not fatal: history still
    /// lands, and the next sync tries again.
    pub async fn activities(
        creds: &Credentials,
        provider_account_id: &str,
        since: Option<&str>,
    ) -> BrokerResult<Vec<RemoteActivity>> {
        let client = Self::client(creds)?;
        let mut out = Vec::new();

        let history_due = since.is_none()
            || history_fetched_at()
                .lock()
                .expect("history lock")
                .get(provider_account_id)
                .is_none_or(|at| at.elapsed() >= HISTORY_REFRESH);
        if history_due {
            match client.activities(provider_account_id, since).await {
                Ok(raw) => {
                    out.extend(raw.iter().filter_map(map::activity));
                    history_fetched_at()
                        .lock()
                        .expect("history lock")
                        .insert(provider_account_id.to_string(), Instant::now());
                }
                Err(BrokerError::RateLimited(_)) => {}
                Err(e) => return Err(e),
            }
        }

        if let Ok(raw) = client
            .orders(provider_account_id, "executed", RECENT_FILL_DAYS)
            .await
        {
            out.extend(raw.iter().filter_map(map::executed_order_as_activity));
        }

        Ok(out)
    }

    /// Every order in the last 90 days (SnapTrade's cap), real-time.
    pub async fn orders(
        creds: &Credentials,
        provider_account_id: &str,
    ) -> BrokerResult<Vec<RemoteOrder>> {
        let client = Self::client(creds)?;
        let raw = client
            .orders(provider_account_id, "all", ORDER_HISTORY_DAYS)
            .await?;
        let mut orders: Vec<RemoteOrder> = raw.iter().filter_map(map::order).collect();
        // SnapTrade doesn't promise an order; newest first matches Alpaca.
        orders.sort_by(|a, b| b.submitted_at.cmp(&a.submitted_at));
        Ok(orders)
    }

    /// SnapTrade's normalized order statuses (`AccountOrderRecordStatus`).
    pub fn order_statuses() -> OrderStatusConfig {
        OrderStatusConfig::new(
            &[
                "pending", "accepted", "queued", "triggered", "activated", "partial",
                "executed", "cancel_pending", "canceled", "partial_canceled",
                "replace_pending", "replaced", "expired", "rejected", "failed",
                "stopped", "suspended", "none",
            ],
            &[
                "executed", "canceled", "partial_canceled", "replaced", "expired",
                "rejected", "failed",
            ],
            &["executed", "canceled"],
            Some(ORDER_HISTORY_DAYS),
        )
    }
}

fn required<'a>(creds: &'a Credentials, key: &str, label: &str) -> BrokerResult<&'a str> {
    creds
        .get(key)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| BrokerError::MissingCredential(label.to_string()))
}

/// Build the `Credentials` blob stored for one SnapTrade connection row.
/// Exposed for `commands::snaptrade`, which is the only caller that ever
/// assembles these fields — everywhere else only ever reads them back via
/// `Provider::verify`/`positions`.
pub fn credentials(client_id: &str, consumer_key: &str, authorization_id: &str) -> Credentials {
    let mut c = Credentials::new();
    c.insert(CLIENT_ID.to_string(), client_id.to_string());
    c.insert(CONSUMER_KEY.to_string(), consumer_key.to_string());
    c.insert(AUTHORIZATION_ID.to_string(), authorization_id.to_string());
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptor_has_no_credential_form_and_is_read_only_labelled() {
        let d = SnapTrade::descriptor();
        assert_eq!(d.auth_kind, "oauth");
        assert!(d.credential_fields.is_empty());
        assert!(d.supports_activities);
        assert!(d.supports_orders);
        assert_eq!(d.account_types.len(), 1);
        assert_eq!(d.account_types[0].kind, "cash");
    }

    #[test]
    fn missing_credential_is_named_in_the_error() {
        let creds = credentials("cid", "", "auth1");
        let err = SnapTrade::client(&creds).unwrap_err().to_string();
        assert!(err.contains("Consumer Key"), "got: {err}");
    }
}
