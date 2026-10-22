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
    /// True when the broker exposes its order history (working, filled,
    /// canceled…) for display.
    pub supports_orders: bool,
    /// True when the broker quotes its own holdings. Holdings in such a
    /// portfolio are priced by the broker; Yahoo is used only for reference
    /// data the broker does not publish. False falls back to Yahoo entirely.
    pub provides_pricing: bool,
    pub docs_url: Option<String>,
    /// Domain used to look up the brokerage's icon, e.g. "alpaca.markets".
    /// A provider that omits it falls back to a lettered chip.
    pub logo_domain: Option<String>,
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
///
/// Every activity the broker reports is kept, not only trades: cash rows are
/// what "money put in vs. growth" is computed from, and a broker may stop
/// serving old history at any time.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RemoteActivity {
    /// The provider's own id for this activity. Used as the idempotency key,
    /// so re-syncing never duplicates a row.
    pub external_id: String,
    /// One of [`activity_kind`]'s constants. A type the adapter does not
    /// recognise is `OTHER`, with its original type still in `raw`.
    pub kind: String,
    /// "buy" | "sell" for fills only. Every other kind leaves it `None`, which
    /// is what keeps cash rows out of share-count and trade calculations.
    pub side: Option<String>,
    /// Empty for rows with no security, e.g. a deposit.
    pub provider_symbol: String,
    pub qty: Option<f64>,
    pub price: Option<f64>,
    /// Signed cash effect on the account, in `currency`: positive = cash in
    /// (deposit, dividend, sale), negative = cash out (withdrawal, fee, buy).
    /// `None` when the broker does not report one.
    pub amount: Option<f64>,
    pub currency: Option<String>,
    /// The broker's own text for the row, e.g. "ACH DEPOSIT".
    pub description: Option<String>,
    /// YYYY-MM-DD, matching the format `purchases.purchased_at` uses.
    pub occurred_at: String,
    /// Original JSON, so activities can be reprocessed without refetching.
    pub raw: Option<String>,
}

/// The kinds a stored activity can have. Shared by every adapter so the
/// frontend never needs to know a broker's own vocabulary.
pub mod activity_kind {
    pub const FILL: &str = "fill";
    pub const DIVIDEND: &str = "dividend";
    pub const INTEREST: &str = "interest";
    pub const FEE: &str = "fee";
    pub const DEPOSIT: &str = "deposit";
    pub const WITHDRAWAL: &str = "withdrawal";
    /// Cash or shares moved between accounts; `amount`'s sign gives direction.
    pub const TRANSFER: &str = "transfer";
    pub const SPLIT: &str = "split";
    pub const OTHER: &str = "other";
}

/// What one `activities` call returned.
#[derive(Debug, Default)]
pub struct ActivityFetch {
    pub activities: Vec<RemoteActivity>,
    /// True when the full history request (not just a real-time supplement)
    /// succeeded. A one-time backfill is only marked done on a complete fetch,
    /// so a throttled request is retried rather than silently skipped.
    pub history_complete: bool,
}

/// How one broker's order statuses should be presented. Each broker names its
/// statuses differently (Alpaca "filled", SnapTrade "executed"), so the UI
/// takes its tab list from here rather than hardcoding one broker's set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderStatusConfig {
    /// Every status the broker documents, lowercased, in display order.
    pub all: Vec<String>,
    /// Statuses after which the order can never execute again — everything
    /// else counts as "Working".
    pub terminal: Vec<String>,
    /// Shown right after "Working", before "All" (typically filled, canceled).
    pub pinned: Vec<String>,
    /// How far back the broker's order history reaches, when it is capped.
    pub history_days: Option<u32>,
}

impl OrderStatusConfig {
    pub fn new(all: &[&str], terminal: &[&str], pinned: &[&str], history_days: Option<u32>) -> Self {
        let own = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect();
        OrderStatusConfig {
            all: own(all),
            terminal: own(terminal),
            pinned: own(pinned),
            history_days,
        }
    }
}

/// An order, exactly as the broker reports it. Fetched live and never stored —
/// an order's status changes by the second while it is working, so a cached
/// copy would be wrong the moment it was written.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteOrder {
    pub id: String,
    /// Set on the legs of a bracket/OCO/OTO order; None for a standalone order.
    pub parent_id: Option<String>,
    pub provider_symbol: String,
    /// The broker's own status string, verbatim (e.g. "partially_filled").
    pub status: String,
    pub side: Option<String>,
    /// "market" | "limit" | "stop" | "stop_limit" | "trailing_stop"
    pub order_type: Option<String>,
    /// "simple" | "bracket" | "oco" | "oto"
    pub order_class: Option<String>,
    pub time_in_force: Option<String>,
    pub qty: Option<f64>,
    /// Dollar amount, for notional (fractional) orders that have no qty.
    pub notional: Option<f64>,
    pub filled_qty: Option<f64>,
    pub filled_avg_price: Option<f64>,
    pub limit_price: Option<f64>,
    pub stop_price: Option<f64>,
    pub trail_price: Option<f64>,
    pub trail_percent: Option<f64>,
    pub extended_hours: bool,
    /// RFC3339 timestamps, verbatim.
    pub submitted_at: Option<String>,
    pub filled_at: Option<String>,
    pub canceled_at: Option<String>,
    pub expired_at: Option<String>,
    pub updated_at: Option<String>,
}
