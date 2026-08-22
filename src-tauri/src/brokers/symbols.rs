//! Provider symbol → Yahoo ticker.
//!
//! Yahoo supplies only *reference* data for broker holdings — company name,
//! asset type, analyst target, dividend yield.  Prices come from the broker.
//! So a `None` here is not a failure: the position still displays with its
//! broker-reported price and P&L, just without the Yahoo extras.

/// Map a provider symbol to the ticker Yahoo knows it by.
///
/// Returns `None` for instruments Yahoo cannot quote, principally options.
pub fn to_yahoo(provider_symbol: &str, asset_class: Option<&str>) -> Option<String> {
    let s = provider_symbol.trim();
    if s.is_empty() {
        return None;
    }

    let class = asset_class.unwrap_or("").to_ascii_lowercase();

    // Options: Yahoo has no quote for an OCC contract symbol.
    if class.contains("option") || looks_like_occ(s) {
        return None;
    }

    // Crypto: Alpaca writes BTC/USD, Yahoo writes BTC-USD. Some providers
    // (SnapTrade/Coinbase among them) report crypto as the bare asset with no
    // quote currency at all, e.g. "BTC" — Yahoo has no ticker for that, only
    // for the pair, so default the unpaired case to USD rather than passing
    // a plain "BTC" through to a lookup that can never match anything.
    if class.contains("crypto") || s.contains('/') {
        let normalized = s.replace('/', "-").to_ascii_uppercase();
        return Some(if normalized.contains('-') {
            normalized
        } else {
            format!("{normalized}-USD")
        });
    }

    Some(s.to_ascii_uppercase())
}

/// Heuristic for an OCC option symbol, e.g. `AAPL260116C00150000`:
/// an underlying root, then YYMMDD, then C or P, then an 8-digit strike.
///
/// Checked structurally rather than by length alone so that long-but-ordinary
/// tickers are not mistaken for contracts.
fn looks_like_occ(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 16 {
        return false;
    }
    // The final 15 characters carry the fixed-width date/type/strike block.
    let tail = &b[b.len() - 15..];
    tail[..6].iter().all(|c| c.is_ascii_digit())
        && (tail[6] == b'C' || tail[6] == b'P')
        && tail[7..].iter().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equities_pass_through_uppercased() {
        assert_eq!(to_yahoo("aapl", Some("us_equity")), Some("AAPL".into()));
        assert_eq!(to_yahoo("BRK.B", Some("us_equity")), Some("BRK.B".into()));
    }

    #[test]
    fn crypto_slash_becomes_dash() {
        assert_eq!(to_yahoo("BTC/USD", Some("crypto")), Some("BTC-USD".into()));
        // Also inferred from the slash when the class is absent.
        assert_eq!(to_yahoo("ETH/USD", None), Some("ETH-USD".into()));
    }

    #[test]
    fn bare_crypto_asset_defaults_to_a_usd_pair() {
        // SnapTrade/Coinbase report crypto as just "BTC", with no quote
        // currency — Yahoo only has a ticker for the pair.
        assert_eq!(to_yahoo("BTC", Some("crypto")), Some("BTC-USD".into()));
        assert_eq!(to_yahoo("sol", Some("crypto")), Some("SOL-USD".into()));
    }

    #[test]
    fn options_have_no_yahoo_ticker() {
        assert_eq!(to_yahoo("AAPL260116C00150000", None), None);
        assert_eq!(to_yahoo("SPY260320P00400000", Some("us_option")), None);
        // Class alone is enough, even for an unusual symbol form.
        assert_eq!(to_yahoo("WEIRD", Some("option")), None);
    }

    #[test]
    fn ordinary_tickers_are_not_mistaken_for_contracts() {
        // Long, but not an OCC contract.
        assert_eq!(to_yahoo("GOOGL", None), Some("GOOGL".into()));
        assert_eq!(to_yahoo("ABCDEFGHIJKLMNOP", None), Some("ABCDEFGHIJKLMNOP".into()));
    }

    #[test]
    fn empty_is_none() {
        assert_eq!(to_yahoo("   ", None), None);
    }
}
