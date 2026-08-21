//! Alpaca JSON → normalized DTOs.
//!
//! Everything Alpaca-shaped stops here. Values are carried across verbatim;
//! nothing is computed, defaulted, or inferred, so a field Alpaca omits stays
//! `None` all the way to the UI.

use super::super::types::{RemoteAccount, RemoteActivity, RemotePosition};
use super::client::{num, text};
use serde_json::Value;

/// `GET /v2/account`
pub fn account(v: &Value) -> RemoteAccount {
    let number = text(v, "account_number");
    RemoteAccount {
        // Alpaca's stable identifier is the UUID in `id`; account_number is for
        // display. Fall back to the number only if `id` is somehow absent.
        id: text(v, "id")
            .or_else(|| number.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        mask: number.as_deref().map(mask_account),
        currency: text(v, "currency").unwrap_or_else(|| "USD".to_string()),
        equity: num(v, "equity"),
        cash: num(v, "cash"),
        buying_power: num(v, "buying_power"),
    }
}

/// Show only the last four characters of an account number.
fn mask_account(number: &str) -> String {
    let tail: String = number.chars().rev().take(4).collect::<Vec<_>>()
        .into_iter().rev().collect();
    format!("****{tail}")
}

/// One element of `GET /v2/positions`.
pub fn position(v: &Value) -> Option<RemotePosition> {
    let provider_symbol = text(v, "symbol")?;
    let qty = num(v, "qty")?;

    Some(RemotePosition {
        provider_symbol,
        asset_class: text(v, "asset_class"),
        qty,
        avg_entry_price: num(v, "avg_entry_price"),
        cost_basis: num(v, "cost_basis"),
        current_price: num(v, "current_price"),
        market_value: num(v, "market_value"),
        unrealized_pl: num(v, "unrealized_pl"),
        unrealized_plpc: num(v, "unrealized_plpc"),
        change_today: num(v, "change_today"),
    })
}

/// One element of `GET /v2/account/activities/FILL`.
pub fn activity(v: &Value) -> Option<RemoteActivity> {
    let external_id = text(v, "id")?;
    let provider_symbol = text(v, "symbol")?;
    let occurred_at = date_only(&text(v, "transaction_time")?)?;

    Some(RemoteActivity {
        external_id,
        kind: "fill".to_string(),
        side: text(v, "side").map(|s| s.to_ascii_lowercase()),
        provider_symbol,
        qty: num(v, "qty"),
        price: num(v, "price"),
        occurred_at,
        raw: Some(v.to_string()),
    })
}

/// RFC3339 timestamp → `YYYY-MM-DD`, matching `purchases.purchased_at`.
///
/// Takes the leading date component directly rather than parsing and
/// reformatting: Alpaca timestamps are UTC, and shifting them into local time
/// could move a fill onto the wrong calendar day.
fn date_only(ts: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_a_position_verbatim() {
        let v = json!({
            "symbol": "AAPL", "asset_class": "us_equity",
            "qty": "120", "avg_entry_price": "178.40", "cost_basis": "21408",
            "current_price": "182.11", "market_value": "21853.2",
            "unrealized_pl": "445.2", "unrealized_plpc": "0.0208",
            "change_today": "0.0135"
        });
        let p = position(&v).unwrap();
        assert_eq!(p.provider_symbol, "AAPL");
        assert_eq!(p.qty, 120.0);
        assert_eq!(p.avg_entry_price, Some(178.40));
        assert_eq!(p.cost_basis, Some(21408.0));
        assert_eq!(p.market_value, Some(21853.2));
        assert_eq!(p.unrealized_pl, Some(445.2));
        // Fractions are carried through unscaled; the caller multiplies.
        assert_eq!(p.unrealized_plpc, Some(0.0208));
    }

    #[test]
    fn absent_position_fields_stay_none() {
        let v = json!({ "symbol": "XYZ", "qty": "5" });
        let p = position(&v).unwrap();
        assert_eq!(p.qty, 5.0);
        assert_eq!(p.avg_entry_price, None);
        assert_eq!(p.current_price, None);
        assert_eq!(p.market_value, None);
    }

    #[test]
    fn position_without_symbol_or_qty_is_skipped() {
        assert!(position(&json!({ "qty": "5" })).is_none());
        assert!(position(&json!({ "symbol": "AAPL" })).is_none());
    }

    #[test]
    fn short_positions_keep_their_sign() {
        let v = json!({ "symbol": "TSLA", "qty": "-10" });
        assert_eq!(position(&v).unwrap().qty, -10.0);
    }

    #[test]
    fn maps_an_activity_to_a_calendar_day() {
        let v = json!({
            "id": "abc123", "symbol": "MSFT", "side": "BUY",
            "qty": "12", "price": "402.18",
            "transaction_time": "2025-06-02T14:31:05.123456Z"
        });
        let a = activity(&v).unwrap();
        assert_eq!(a.external_id, "abc123");
        assert_eq!(a.side, Some("buy".into()));
        assert_eq!(a.occurred_at, "2025-06-02");
        assert_eq!(a.kind, "fill");
        assert!(a.raw.is_some());
    }

    #[test]
    fn activity_with_bad_timestamp_is_skipped() {
        let v = json!({ "id": "x", "symbol": "M", "transaction_time": "nonsense" });
        assert!(activity(&v).is_none());
    }

    #[test]
    fn account_number_is_masked() {
        let v = json!({
            "id": "9f2c-uuid", "account_number": "PA3948214821",
            "currency": "USD", "equity": "10500.25", "cash": "500.25"
        });
        let a = account(&v);
        assert_eq!(a.id, "9f2c-uuid");
        assert_eq!(a.mask, Some("****4821".into()));
        assert_eq!(a.equity, Some(10500.25));
    }
}
