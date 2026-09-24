//! SnapTrade JSON → normalized DTOs.
//!
//! Account fields come from SnapTrade's published docs example (an actual
//! response body, not a schema). Position fields come from the `AccountPosition`
//! and `Instrument` schemas in SnapTrade's own OpenAPI spec
//! (<https://github.com/passiv/snaptrade-sdks/blob/master/api.yaml>) — the
//! account shape is the less-verified of the two, so `account` stays
//! defensive (falls back gracefully rather than panicking) even though it
//! has not been cross-checked against the formal schema the way positions has.

use serde_json::Value;

use super::super::date_only;
use super::super::store::PROVISIONAL_PREFIX;
use super::super::types::{RemoteAccount, RemoteActivity, RemoteOrder, RemotePosition};

/// One account from `GET /accounts`, e.g.:
/// `{"id": "...", "brokerage_authorization": "...", "number": "Q6542138443",
///   "institution_name": "Robinhood", "balance": {"total": {"amount": 15363.23,
///   "currency": "USD"}}, ...}`
pub fn account(v: &Value) -> Option<RemoteAccount> {
    let id = v.get("id")?.as_str()?.to_string();

    let total = v.get("balance").and_then(|b| b.get("total"));
    let currency = total
        .and_then(|t| t.get("currency"))
        .and_then(|c| c.as_str())
        .unwrap_or("USD")
        .to_string();
    let equity = total.and_then(|t| t.get("amount")).and_then(Value::as_f64);

    let mask = v
        .get("number")
        .and_then(|n| n.as_str())
        .map(mask_account_number);

    Some(RemoteAccount {
        id,
        mask,
        currency,
        equity,
        // `balance.total` is net equity, not a separate cash figure — SnapTrade
        // does not appear to break the two out at the account level.
        cash: None,
        buying_power: None,
    })
}

/// The brokerage authorization (one login) this account belongs to — how a
/// SnapTrade connection is split into one `broker_connections` row per
/// underlying brokerage rather than one row for the whole SnapTrade user.
pub fn authorization_id(v: &Value) -> Option<String> {
    v.get("brokerage_authorization")
        .and_then(|s| s.as_str())
        .map(str::to_string)
}

/// The brokerage's display name, e.g. "Robinhood" — used as the connection
/// card label so a SnapTrade-linked account reads like any other brokerage,
/// not like a generic "SnapTrade" blob.
pub fn institution_name(v: &Value) -> Option<String> {
    v.get("institution_name")
        .and_then(|s| s.as_str())
        .map(str::to_string)
}

/// One `AccountPosition` from the `results` array of
/// `GET /accounts/{id}/positions/all`:
/// `{"instrument": {"kind": "stock", "symbol": "AAPL", "raw_symbol": "AAPL",
///   ...}, "units": "10.5", "price": "123.45", "cost_basis": "118.2",
///   "currency": "USD"}`.
///
/// `units`/`price`/`cost_basis` are all decimal *strings* per the schema
/// (`format: decimal`), not JSON numbers — the single most surprising thing
/// about this endpoint, and worth calling out because it is exactly the kind
/// of detail that silently produces `None` everywhere if missed. `price` and
/// `cost_basis` are both explicitly per-share.
pub fn position(v: &Value) -> Option<RemotePosition> {
    let instrument = v.get("instrument")?;
    let qty = decimal(v.get("units")?)?;
    let provider_symbol = instrument
        .get("symbol")
        .or_else(|| instrument.get("raw_symbol"))
        .and_then(|s| s.as_str())?
        .to_string();

    let avg_entry_price = v.get("cost_basis").and_then(decimal);
    let current_price = v.get("price").and_then(decimal);

    let market_value = current_price.map(|p| p * qty);
    let cost_basis = avg_entry_price.map(|p| p * qty);
    let unrealized_pl = match (market_value, cost_basis) {
        (Some(mv), Some(cb)) => Some(mv - cb),
        _ => None,
    };
    let unrealized_plpc = match (unrealized_pl, cost_basis) {
        (Some(pl), Some(cb)) if cb != 0.0 => Some(pl / cb),
        _ => None,
    };

    Some(RemotePosition {
        provider_symbol,
        asset_class: instrument.get("kind").and_then(|k| k.as_str()).map(str::to_string),
        qty,
        avg_entry_price,
        cost_basis,
        current_price,
        market_value,
        unrealized_pl,
        unrealized_plpc,
        // Not present on this endpoint — SnapTrade reports day change
        // separately (per-symbol quote), which this pass does not fetch.
        change_today: None,
    })
}

/// A `UniversalSymbol` (`{"symbol": "AAPL", "raw_symbol": "AAPL", ...}`) →
/// its ticker. Same field preference as positions' `instrument`, so a fill
/// and the position it built map to the same symbol.
fn universal_ticker(v: &Value) -> Option<String> {
    v.get("symbol")
        .and_then(|s| s.as_str())
        .or_else(|| v.get("raw_symbol").and_then(|s| s.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A number SnapTrade may send as a JSON number or a decimal string.
fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// "BUY" / "BUY_OPEN" / "BUY_COVER" → "buy", likewise for sells.
fn side_of(action: &str) -> Option<&'static str> {
    let a = action.to_ascii_uppercase();
    if a.starts_with("BUY") {
        Some("buy")
    } else if a.starts_with("SELL") {
        Some("sell")
    } else {
        None
    }
}

/// One `UniversalActivity` from `GET /accounts/{id}/activities`. Only share
/// trades are kept (BUY, SELL, and REI — a dividend reinvestment buys shares);
/// the request already filters to those types, this re-checks defensively.
pub fn activity(v: &Value) -> Option<RemoteActivity> {
    let external_id = text(v, "id")?;
    let side = match text(v, "type")?.to_ascii_uppercase().as_str() {
        "BUY" | "REI" => "buy",
        "SELL" => "sell",
        _ => return None,
    };
    let provider_symbol = v.get("symbol").and_then(universal_ticker)?;
    let occurred_at = date_only(&text(v, "trade_date")?)?;

    Some(RemoteActivity {
        external_id,
        kind: "fill".to_string(),
        side: Some(side.to_string()),
        provider_symbol,
        // Some brokerages sign units by direction; the side already says it.
        qty: num(v.get("units")).map(f64::abs),
        price: num(v.get("price")),
        occurred_at,
        raw: Some(v.to_string()),
    })
}

/// An executed (or partially executed) order from the real-time order book,
/// as a provisional fill — so a trade shows in Purchases within minutes
/// instead of waiting for SnapTrade's once-a-day activity history. Stock/ETF
/// orders only; option legs have no `universal_symbol`.
pub fn executed_order_as_activity(v: &Value) -> Option<RemoteActivity> {
    let id = text(v, "brokerage_order_id")?;
    let filled = num(v.get("filled_quantity")).filter(|q| *q > 0.0)?;
    let side = side_of(&text(v, "action")?)?;
    let provider_symbol = v.get("universal_symbol").and_then(universal_ticker)?;
    let when = text(v, "time_executed")
        .or_else(|| text(v, "time_updated"))
        .or_else(|| text(v, "time_placed"))?;

    Some(RemoteActivity {
        external_id: format!("{PROVISIONAL_PREFIX}{id}"),
        kind: "fill".to_string(),
        side: Some(side.to_string()),
        provider_symbol,
        qty: Some(filled.abs()),
        price: num(v.get("execution_price")),
        occurred_at: date_only(&when)?,
        raw: Some(v.to_string()),
    })
}

/// One `AccountOrderRecord` from `GET /accounts/{id}/orders`. Each record is
/// one leg; legs of a multi-leg order share `brokerage_group_order_id`.
pub fn order(v: &Value) -> Option<RemoteOrder> {
    let id = text(v, "brokerage_order_id")?;
    let provider_symbol = v
        .get("universal_symbol")
        .and_then(universal_ticker)
        .or_else(|| {
            v.get("option_symbol")
                .and_then(|o| o.get("ticker"))
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })?;
    let parent_id = text(v, "brokerage_group_order_id").filter(|g| *g != id);
    let trailing = v.get("trailing_stop");

    Some(RemoteOrder {
        id,
        parent_id,
        provider_symbol,
        status: text(v, "status")?.to_ascii_lowercase(),
        side: text(v, "action").map(|a| a.to_ascii_lowercase()),
        order_type: text(v, "order_type").map(|t| t.to_ascii_lowercase()),
        order_class: None,
        time_in_force: text(v, "time_in_force"),
        qty: num(v.get("total_quantity")),
        notional: None,
        filled_qty: num(v.get("filled_quantity")),
        filled_avg_price: num(v.get("execution_price")),
        limit_price: num(v.get("limit_price")),
        stop_price: num(v.get("stop_price")),
        trail_price: trailing.and_then(|t| num(t.get("amount"))),
        trail_percent: trailing.and_then(|t| num(t.get("percentage"))),
        extended_hours: false,
        submitted_at: text(v, "time_placed"),
        filled_at: text(v, "time_executed"),
        canceled_at: None,
        expired_at: None,
        updated_at: text(v, "time_updated"),
    })
}

/// Parse one of the endpoint's decimal-as-string fields. `nullable: true` in
/// the schema, so a JSON `null` is a normal "not reported," not a parse error.
fn decimal(v: &Value) -> Option<f64> {
    v.as_str()?.parse::<f64>().ok()
}

fn mask_account_number(n: &str) -> String {
    if n.len() <= 4 {
        format!("****{n}")
    } else {
        format!("****{}", &n[n.len() - 4..])
    }
}

#[cfg(test)]
mod order_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn history_activity_maps_buy_sell_and_reinvestment() {
        let buy = json!({ "id": "a1", "type": "BUY", "units": 10, "price": 12.5,
                          "trade_date": "2026-09-22T00:00:00Z",
                          "symbol": { "symbol": "VTI", "raw_symbol": "VTI" } });
        let a = activity(&buy).unwrap();
        assert_eq!(a.side.as_deref(), Some("buy"));
        assert_eq!(a.occurred_at, "2026-09-22");
        assert_eq!(a.qty, Some(10.0));

        let sell = json!({ "id": "a2", "type": "SELL", "units": -3, "price": 20,
                           "trade_date": "2026-09-22T00:00:00Z", "symbol": { "symbol": "VTI" } });
        let s = activity(&sell).unwrap();
        assert_eq!(s.side.as_deref(), Some("sell"));
        assert_eq!(s.qty, Some(3.0), "qty is unsigned; side carries direction");

        let rei = json!({ "id": "a3", "type": "REI", "units": 0.4, "price": 250,
                          "trade_date": "2026-09-20", "symbol": { "symbol": "VTI" } });
        assert_eq!(activity(&rei).unwrap().side.as_deref(), Some("buy"));

        let div = json!({ "id": "a4", "type": "DIVIDEND", "trade_date": "2026-09-20",
                          "symbol": { "symbol": "VTI" } });
        assert!(activity(&div).is_none());
    }

    #[test]
    fn executed_order_becomes_a_provisional_fill() {
        let o = json!({ "brokerage_order_id": "123", "status": "EXECUTED", "action": "BUY",
                        "filled_quantity": "5", "execution_price": "101.25",
                        "time_executed": "2026-09-24T14:05:00Z",
                        "universal_symbol": { "symbol": "FXAIX" } });
        let a = executed_order_as_activity(&o).unwrap();
        assert_eq!(a.external_id, "order:123");
        assert_eq!(a.qty, Some(5.0));
        assert_eq!(a.price, Some(101.25));
        assert_eq!(a.occurred_at, "2026-09-24");

        let unfilled = json!({ "brokerage_order_id": "9", "action": "BUY", "filled_quantity": "0",
                               "time_placed": "2026-09-24T14:05:00Z",
                               "universal_symbol": { "symbol": "X" } });
        assert!(executed_order_as_activity(&unfilled).is_none());
    }

    #[test]
    fn order_record_maps_status_and_legs() {
        let o = json!({ "brokerage_order_id": "leg2", "brokerage_group_order_id": "grp",
                        "status": "CANCEL_PENDING", "action": "SELL", "order_type": "StopLimit",
                        "total_quantity": "10", "filled_quantity": "0", "limit_price": "9.5",
                        "stop_price": "9.75", "time_in_force": "GTC",
                        "time_placed": "2026-09-24T14:05:00Z",
                        "universal_symbol": { "symbol": "AAPL" } });
        let r = order(&o).unwrap();
        assert_eq!(r.status, "cancel_pending");
        assert_eq!(r.side.as_deref(), Some("sell"));
        assert_eq!(r.parent_id.as_deref(), Some("grp"));
        assert_eq!(r.qty, Some(10.0));
        assert_eq!(r.stop_price, Some(9.75));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_documented_account_example() {
        let v = serde_json::json!({
            "id": "917c8734-8470-4a3e-a18f-57c3f2ee6631",
            "brokerage_authorization": "87b24961-b51e-4db8-9226-f198f6518a89",
            "name": "Robinhood Individual",
            "number": "Q6542138443",
            "institution_name": "Robinhood",
            "balance": { "total": { "amount": 15363.23, "currency": "USD" } },
        });

        let acct = account(&v).unwrap();
        assert_eq!(acct.id, "917c8734-8470-4a3e-a18f-57c3f2ee6631");
        assert_eq!(acct.mask.as_deref(), Some("****8443"));
        assert_eq!(acct.currency, "USD");
        assert_eq!(acct.equity, Some(15363.23));
        assert_eq!(
            authorization_id(&v).as_deref(),
            Some("87b24961-b51e-4db8-9226-f198f6518a89")
        );
        assert_eq!(institution_name(&v).as_deref(), Some("Robinhood"));
    }

    #[test]
    fn account_without_id_is_skipped() {
        let v = serde_json::json!({ "name": "no id here" });
        assert!(account(&v).is_none());
    }

    /// The exact shape from the `AccountPosition`/`StockInstrument` schemas —
    /// decimal fields as strings, symbol nested under `instrument`.
    #[test]
    fn maps_the_documented_position_schema() {
        let v = serde_json::json!({
            "instrument": {
                "kind": "stock",
                "id": "1ef3a5d3-4a9b-40b2-b8d1-cc35f74d6324",
                "symbol": "AAPL",
                "raw_symbol": "AAPL",
                "description": "Apple Inc.",
                "currency": "USD",
            },
            "units": "10.5",
            "price": "123.45",
            "cost_basis": "118.2",
            "currency": "USD",
        });
        let p = position(&v).unwrap();
        assert_eq!(p.provider_symbol, "AAPL");
        assert_eq!(p.qty, 10.5);
        assert_eq!(p.current_price, Some(123.45));
        assert_eq!(p.avg_entry_price, Some(118.2));
        assert_eq!(p.market_value, Some(123.45 * 10.5));
        assert_eq!(p.cost_basis, Some(118.2 * 10.5));
        assert_eq!(p.asset_class.as_deref(), Some("stock"));
    }

    #[test]
    fn falls_back_to_raw_symbol_when_symbol_is_absent() {
        let v = serde_json::json!({
            "instrument": { "kind": "crypto", "raw_symbol": "BTC" },
            "units": "1",
        });
        let p = position(&v).unwrap();
        assert_eq!(p.provider_symbol, "BTC");
        assert_eq!(p.current_price, None, "no price given, must stay unset");
    }

    #[test]
    fn null_price_and_cost_basis_stay_unset_not_zero() {
        let v = serde_json::json!({
            "instrument": { "kind": "stock", "symbol": "AAPL" },
            "units": "10.5",
            "price": null,
            "cost_basis": null,
        });
        let p = position(&v).unwrap();
        assert_eq!(p.current_price, None);
        assert_eq!(p.avg_entry_price, None);
        assert_eq!(p.market_value, None);
    }

    #[test]
    fn position_without_units_is_skipped() {
        let v = serde_json::json!({ "instrument": { "kind": "stock", "symbol": "AAPL" } });
        assert!(position(&v).is_none());
    }

    #[test]
    fn position_without_instrument_is_skipped() {
        let v = serde_json::json!({ "units": "1" });
        assert!(position(&v).is_none());
    }
}
