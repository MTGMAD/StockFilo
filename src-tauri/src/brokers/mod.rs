//! Brokerage integration.
//!
//! # Adding a brokerage
//!
//! 1. Create `brokers/<name>/` with `mod.rs`, `client.rs`, `map.rs`.
//! 2. Write a [`ProviderDescriptor`] — the UI builds its connect form from it,
//!    so no frontend change is needed.
//! 3. Add a variant to [`Provider`]. The compiler will list every match arm
//!    that needs filling in.
//! 4. Add symbol rules to [`symbols`] if the provider's tickers differ from
//!    Yahoo's.
//!
//! No schema change, no new commands, no React work. If a provider ever forces
//! a change outside those four steps, the abstraction has leaked and is worth
//! fixing at that moment rather than working around.
//!
//! # Why an enum instead of `dyn Trait`
//!
//! `async fn` in traits is stable but not object-safe, so `Box<dyn Provider>`
//! would mean pulling in `async-trait`. With a handful of providers an enum is
//! better anyway: no extra dependency, and exhaustive matching turns "add a
//! broker" into a list of compiler errors to work through.

pub mod alpaca;
pub mod error;
pub mod snaptrade;
pub mod store;
pub mod symbols;
pub mod types;

use error::{BrokerError, BrokerResult};
use types::{
    Credentials, OrderStatusConfig, ProviderDescriptor, RemoteAccount, RemoteActivity, RemoteOrder,
    RemotePosition,
};

/// RFC3339 timestamp → `YYYY-MM-DD`, matching `purchases.purchased_at`.
///
/// Takes the leading date component directly rather than parsing and
/// reformatting: Broker timestamps are UTC, and shifting them into local time
/// could move a fill onto the wrong calendar day.
pub(crate) fn date_only(ts: &str) -> Option<String> {
    let head: String = ts.chars().take(10).collect();
    let b = head.as_bytes();
    if b.len() == 10
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..].iter().all(u8::is_ascii_digit)
    {
        Some(head)
    } else {
        None
    }
}

#[derive(Debug)]
pub enum Provider {
    Alpaca,
    // Schwab,   <- adding a brokerage starts here
    /// Not in `all_descriptors()` — SnapTrade connects through its own portal
    /// flow (see `commands::snaptrade`), not the generic credential form, so
    /// it must stay out of that dropdown. It still resolves through `from_id`
    /// because sync, positions, and the connection-card UI are all generic
    /// over `Provider` and need it to dispatch like any other one.
    SnapTrade,
}

impl Provider {
    pub fn from_id(id: &str) -> BrokerResult<Self> {
        match id {
            alpaca::ID => Ok(Provider::Alpaca),
            snaptrade::ID => Ok(Provider::SnapTrade),
            other => Err(BrokerError::UnknownProvider(other.to_string())),
        }
    }

    /// Every provider the app can offer through the generic connect form.
    /// SnapTrade is deliberately excluded — see the enum variant's doc.
    pub fn all_descriptors() -> Vec<ProviderDescriptor> {
        vec![alpaca::Alpaca::descriptor()]
    }

    pub fn descriptor(&self) -> ProviderDescriptor {
        match self {
            Provider::Alpaca => alpaca::Alpaca::descriptor(),
            Provider::SnapTrade => snaptrade::SnapTrade::descriptor(),
        }
    }

    pub async fn verify(
        &self,
        creds: &Credentials,
        environment: &str,
    ) -> BrokerResult<Vec<RemoteAccount>> {
        match self {
            Provider::Alpaca => alpaca::Alpaca::verify(creds, environment).await,
            Provider::SnapTrade => snaptrade::SnapTrade::verify(creds, environment).await,
        }
    }

    pub async fn positions(
        &self,
        creds: &Credentials,
        environment: &str,
        provider_account_id: &str,
    ) -> BrokerResult<Vec<RemotePosition>> {
        match self {
            Provider::Alpaca => {
                alpaca::Alpaca::positions(creds, environment, provider_account_id).await
            }
            Provider::SnapTrade => {
                snaptrade::SnapTrade::positions(creds, environment, provider_account_id).await
            }
        }
    }

    /// `provider_account_id` scopes the request for providers with several
    /// accounts per connection (SnapTrade); Alpaca has one per key and
    /// ignores it.
    pub async fn activities(
        &self,
        creds: &Credentials,
        environment: &str,
        provider_account_id: &str,
        since: Option<&str>,
    ) -> BrokerResult<Vec<RemoteActivity>> {
        match self {
            Provider::Alpaca => alpaca::Alpaca::activities(creds, environment, since).await,
            Provider::SnapTrade => {
                snaptrade::SnapTrade::activities(creds, provider_account_id, since).await
            }
        }
    }

    pub async fn orders(
        &self,
        creds: &Credentials,
        environment: &str,
        provider_account_id: &str,
    ) -> BrokerResult<Vec<RemoteOrder>> {
        match self {
            Provider::Alpaca => alpaca::Alpaca::orders(creds, environment).await,
            Provider::SnapTrade => snaptrade::SnapTrade::orders(creds, provider_account_id).await,
        }
    }

    pub fn order_statuses(&self) -> OrderStatusConfig {
        match self {
            Provider::Alpaca => alpaca::Alpaca::order_statuses(),
            Provider::SnapTrade => snaptrade::SnapTrade::order_statuses(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_known_providers_and_rejects_others() {
        assert!(Provider::from_id("alpaca").is_ok());
        let err = Provider::from_id("etrade").unwrap_err().to_string();
        assert!(err.contains("etrade"), "got: {err}");
    }

    #[test]
    fn every_descriptor_is_resolvable_by_its_own_id() {
        // Guards against a provider being listed in the UI but unreachable by
        // from_id — the kind of mismatch that only shows up at connect time.
        for d in Provider::all_descriptors() {
            assert!(
                Provider::from_id(&d.id).is_ok(),
                "descriptor '{}' has no from_id mapping",
                d.id
            );
        }
    }

    /// Colours are keyed off `kind`, so an unrecognised value would render a
    /// chip with no styling at all.
    #[test]
    fn account_type_kinds_are_known() {
        const KNOWN: [&str; 3] = ["margin", "paper", "cash"];
        for d in Provider::all_descriptors() {
            for a in &d.account_types {
                assert!(
                    KNOWN.contains(&a.kind.as_str()),
                    "{} declares unknown account kind '{}'",
                    d.id,
                    a.kind
                );
                assert!(!a.label.is_empty(), "{} has an unlabelled account type", d.id);
            }
        }
    }

    #[test]
    fn descriptors_are_well_formed() {
        for d in Provider::all_descriptors() {
            assert!(!d.name.is_empty());
            assert!(!d.account_types.is_empty(), "{} has no account types", d.id);
            assert!(
                !d.credential_fields.is_empty() || d.auth_kind == "oauth",
                "{} needs credential fields or oauth",
                d.id
            );
        }
    }
}
