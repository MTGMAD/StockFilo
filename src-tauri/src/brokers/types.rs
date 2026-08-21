//! Normalized broker DTOs.
//!
//! Nothing past this boundary is provider-shaped: adapters translate their own
//! API into these types, and everything above — commands, the store, the
//! frontend — works only in terms of them.  Adding a brokerage means writing a
//! new adapter that produces these, and changing nothing else.
//!
//! All structs are flat, with plain fields and string discriminants.  This
//! matches the convention `SyncTarget` established in `commands/config.rs`:
//! `#[serde(flatten)]` combined with internally-tagged enums silently
//! mis-deserializes across the Tauri bridge, so it is avoided throughout.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Credential values keyed by [`CredentialField::key`].
pub type Credentials = HashMap<String, String>;

/// One input on a provider's connect form.
///
/// The frontend renders whatever it is handed here, so a provider needing four
/// fields costs no React changes at all.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialField {
    pub key: String,
    pub label: String,
    /// Render as a password input and never echo the value back.
    pub secret: bool,
    pub placeholder: Option<String>,
    pub help: Option<String>,
}

impl CredentialField {
    pub fn new(key: &str, label: &str, secret: bool) -> Self {
        CredentialField {
            key: key.to_string(),
            label: label.to_string(),
            secret,
            placeholder: None,
            help: None,
        }
    }

    pub fn with_placeholder(mut self, p: &str) -> Self {
        self.placeholder = Some(p.to_string());
        self
    }

    pub fn with_help(mut self, h: &str) -> Self {
        self.help = Some(h.to_string());
        self
    }
}

/// One kind of account a provider offers.
///
/// `id` is what gets stored and what the adapter uses to pick a base URL;
/// `label` is what the person sees; `kind` drives the colour so that a
/// margin account reads the same across every brokerage.
///
/// Alpaca's real-money environment is a margin account, so it is labelled
/// "Margin" rather than "Live" — the label describes the account, not the API
/// endpoint behind it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountType {
    pub id: String,
    pub label: String,
    /// "margin" | "paper" | "cash" — the UI maps this to a colour.
    pub kind: String,
    pub description: Option<String>,
}

impl AccountType {
    pub fn new(id: &str, label: &str, kind: &str) -> Self {
        AccountType {
            id: id.to_string(),
            label: label.to_string(),
            kind: kind.to_string(),
            description: None,
        }
    }

    pub fn with_description(mut self, d: &str) -> Self {
        self.description = Some(d.to_string());
        self
    }
}

/// Everything the UI needs to know about a provider without hard-coding it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    /// "fields" today. "oauth" exists so providers like Schwab can be added
    /// later without reshaping this struct.
    pub auth_kind: String,
    /// Account types offered, in the order the UI should show them.
    pub account_types: Vec<AccountType>,
    pub credential_fields: Vec<CredentialField>,
    pub supports_positions: bool,
    pub supports_activities: bool,
    /// True when the broker quotes its own holdings. Holdings in such a
    /// portfolio are priced by the broker; Yahoo is used only for reference
    /// data the broker does not publish. False falls back to Yahoo entirely.
    pub provides_pricing: bool,
    pub docs_url: Option<String>,
}

/// An account exposed by a connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAccount {
    pub id: String,
    /// Masked display form, e.g. "****4821".
    pub mask: Option<String>,
    pub currency: String,
    pub equity: Option<f64>,
    pub cash: Option<f64>,
    pub buying_power: Option<f64>,
}

/// A currently-held position, exactly as the broker reports it.
///
/// Every figure here is the broker's own. Nothing is recomputed, and nothing is
/// filled in when the broker omits it — an absent value stays `None` and the UI
/// says so rather than showing a guess.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePosition {
    pub provider_symbol: String,
    pub asset_class: Option<String>,
    pub qty: f64,
    pub avg_entry_price: Option<f64>,
    pub cost_basis: Option<f64>,
    pub current_price: Option<f64>,
    pub market_value: Option<f64>,
    pub unrealized_pl: Option<f64>,
    /// Fraction, not percent — the caller scales it.
    pub unrealized_plpc: Option<f64>,
    /// Fraction, not percent.
    pub change_today: Option<f64>,
}

/// A single dated transaction from the broker's activity history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteActivity {
    /// The provider's own id for this activity. Used as the idempotency key,
    /// so re-syncing never duplicates a row.
    pub external_id: String,
    /// "fill" | "div" | "split" | "xfer"
    pub kind: String,
    /// "buy" | "sell", where applicable.
    pub side: Option<String>,
    pub provider_symbol: String,
    pub qty: Option<f64>,
    pub price: Option<f64>,
    /// YYYY-MM-DD, matching the format `purchases.purchased_at` uses.
    pub occurred_at: String,
    /// Original JSON, so activities can be reprocessed without refetching.
    pub raw: Option<String>,
}
