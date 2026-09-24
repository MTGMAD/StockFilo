//! Alpaca JSON → normalized DTOs.
//!
//! Everything Alpaca-shaped stops here. Values are carried across verbatim;
//! nothing is computed, defaulted, or inferred, so a field Alpaca omits stays
//! `None` all the way to the UI.

use super::super::types::{RemoteAccount, RemoteActivity, RemoteOrder, RemotePosition};
use super::super::date_only;
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

/// One element of `GET /v2/orders?nested=true`, plus its legs.
///
/// A bracket/OCO/OTO order arrives with its take-profit and stop-loss legs
/// nested under `legs`; each leg has its own status, so they are flattened
/// into rows of their own (tagged with `parent_id`) rather than hidden inside
/// the parent — a working stop-loss must show up under "Working" even when
/// its parent entry order has long since filled.
pub fn orders(v: &Value, out: &mut Vec<RemoteOrder>) {
    let Some(parent) = order(v, None) else { return };
    let parent_id = parent.id.clone();
    out.push(parent);
    if let Some(legs) = v.get("legs").and_then(|l| l.as_array()) {
        out.extend(legs.iter().filter_map(|leg| order(leg, Some(&parent_id))));
    }
}

fn order(v: &Value, parent_id: Option<&str>) -> Option<RemoteOrder> {
    Some(RemoteOrder {
        id: text(v, "id")?,
        parent_id: parent_id.map(str::to_string),
        provider_symbol: text(v, "symbol")?,
        status: text(v, "status")?.to_ascii_lowercase(),
        side: text(v, "side").map(|s| s.to_ascii_lowercase()),
        // Alpaca sends both `type` and the older `order_type`; they agree.
        order_type: text(v, "type").or_else(|| text(v, "order_type")),
        order_class: text(v, "order_class"),
        time_in_force: text(v, "time_in_force"),
        qty: num(v, "qty"),
        notional: num(v, "notional"),
        filled_qty: num(v, "filled_qty"),
        filled_avg_price: num(v, "filled_avg_price"),
        limit_price: num(v, "limit_price"),
        stop_price: num(v, "stop_price"),
        trail_price: num(v, "trail_price"),
        trail_percent: num(v, "trail_percent"),
        extended_hours: v.get("extended_hours").and_then(Value::as_bool).unwrap_or(false),
        submitted_at: text(v, "submitted_at"),
        filled_at: text(v, "filled_at"),
        canceled_at: text(v, "canceled_at"),
        expired_at: text(v, "expired_at"),
        updated_at: text(v, "updated_at"),
    })
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
    fn bracket_order_legs_become_their_own_rows() {
        let v = json!({
            "id": "parent", "symbol": "AAPL", "status": "filled", "side": "buy",
            "type": "limit", "order_class": "bracket", "qty": "10",
            "filled_qty": "10", "filled_avg_price": "180.5", "limit_price": "181",
            "extended_hours": false, "submitted_at": "2026-09-01T14:00:00Z",
            "legs": [
                { "id": "tp", "symbol": "AAPL", "status": "new", "side": "sell",
                  "type": "limit", "limit_price": "200", "qty": "10" },
                { "id": "sl", "symbol": "AAPL", "status": "HELD", "side": "sell",
                  "type": "stop", "stop_price": "170", "qty": "10" }
            ]
        });
        let mut out = Vec::new();
        orders(&v, &mut out);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].id, "parent");
        assert_eq!(out[0].parent_id, None);
        assert_eq!(out[0].filled_avg_price, Some(180.5));
        assert_eq!(out[1].parent_id.as_deref(), Some("parent"));
        assert_eq!(out[1].status, "new");
        // Status is normalized to lowercase so the UI can match on it.
        assert_eq!(out[2].status, "held");
        assert_eq!(out[2].stop_price, Some(170.0));
    }

    #[test]
    fn notional_order_keeps_qty_absent() {
        let v = json!({ "id": "n", "symbol": "SPY", "status": "accepted",
                        "type": "market", "notional": "250" });
        let mut out = Vec::new();
        orders(&v, &mut out);
        assert_eq!(out[0].qty, None);
        assert_eq!(out[0].notional, Some(250.0));
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
