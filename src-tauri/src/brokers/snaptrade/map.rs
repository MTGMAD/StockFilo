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

use super::super::types::{RemoteAccount, RemotePosition};

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
