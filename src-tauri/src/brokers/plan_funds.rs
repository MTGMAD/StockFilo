//! Plan-only funds: holdings a 401(k) provider reports under its own code
//! rather than a public ticker.
//!
//! Some are a public fund under another name. TransAmerica's Y73H is
//! "Dodge & Cox Stock X", which Yahoo lists as DOXGX at the same price to the
//! cent, so it gets an alias and Yahoo supplies everything a listed fund has.
//! Others exist only inside the plan (Y8V5, "Mid Cap Growth IV R1"); no
//! outside source has them, so each sync records the broker's price, and that
//! history is their chart and daily change.

use rusqlite::{params, Connection, OptionalExtension};

use super::symbols;
use super::types::RemotePosition;
use crate::db::manager::DbManager;
use crate::yahoo;

/// How long a search that found nothing is trusted. Yahoo adds listings, but rarely.
const RETRY_NO_MATCH_SECS: i64 = 7 * 86_400;
/// A name match whose price disagreed may just be a day's NAV apart; look again tomorrow.
const RETRY_PRICE_MISMATCH_SECS: i64 = 86_400;
/// Largest gap between the plan's unit price and the public fund's NAV that
/// still counts as the same fund.
const PRICE_TOLERANCE: f64 = 0.005;

/// The outcome of one search, saved by `save_alias`.
#[derive(Debug, Clone, PartialEq)]
pub struct AliasResult {
    pub provider_symbol: String,
    /// The public ticker, or None when nothing matched.
    pub ticker: Option<String>,
    pub retry_at: Option<i64>,
}

/// Case, punctuation and "&" vs "and" vary between a plan's fund list and
/// Yahoo's; nothing else may differ.
pub fn normalize_name(s: &str) -> String {
    s.to_lowercase()
        .replace('&', " and ")
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Search results whose name is exactly the plan's fund name.
pub fn name_matches(name: &str, results: &[yahoo::SearchResult]) -> Vec<String> {
    let want = normalize_name(name);
    results
        .iter()
        .filter(|r| r.name.as_deref().map(normalize_name).as_deref() == Some(want.as_str()))
        .map(|r| r.symbol.clone())
        .collect()
}

pub fn price_matches(broker: f64, public: f64) -> bool {
    broker > 0.0 && ((public - broker) / broker).abs() <= PRICE_TOLERANCE
}

/// The ticker Yahoo knows a provider symbol by: its alias when it has one.
pub fn yahoo_ticker(
    conn: &Connection,
    provider_symbol: &str,
    asset_class: Option<&str>,
) -> rusqlite::Result<Option<String>> {
    let alias: Option<String> = conn
        .query_row(
            "SELECT ticker FROM symbol_aliases WHERE provider_symbol = ?1 AND ticker IS NOT NULL",
            params![provider_symbol],
            |r| r.get(0),
        )
        .optional()?;
    Ok(alias.or_else(|| symbols::to_yahoo(provider_symbol, asset_class)))
}

struct Candidate {
    provider_symbol: String,
    name: String,
    price: f64,
}

/// Positions worth a name search: Yahoo has already been asked about the
/// symbol and knew nothing, the broker gave a name and a price, and no
/// earlier search is still trusted.
fn candidates(conn: &Connection, positions: &[RemotePosition], now: i64) -> rusqlite::Result<Vec<Candidate>> {
    let mut out = Vec::new();
    for p in positions {
        let (Some(name), Some(price)) = (p.name.as_deref(), p.current_price) else { continue };
        if price <= 0.0 {
            continue;
        }
        let Some(ticker) = symbols::to_yahoo(&p.provider_symbol, p.asset_class.as_deref()) else { continue };
        let settled: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM symbol_aliases WHERE provider_symbol = ?1 \
               AND (ticker IS NOT NULL OR retry_at > ?2))",
            params![p.provider_symbol, now],
            |r| r.get(0),
        )?;
        if settled {
            continue;
        }
        let unknown_to_yahoo: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM stocks WHERE ticker = ?1 AND last_fetched_at IS NOT NULL \
               AND name IS NULL AND quote_type IS NULL)",
            params![ticker],
            |r| r.get(0),
        )?;
        if unknown_to_yahoo {
            out.push(Candidate { provider_symbol: p.provider_symbol.clone(), name: name.to_string(), price });
        }
    }
    Ok(out)
}

/// Looks for a public twin of each plan-only fund. Network only: the caller
/// saves the results inside its own write. A failed request is skipped, not
/// saved, so the next sync tries again.
pub async fn resolve(db: &DbManager, positions: &[RemotePosition]) -> Vec<AliasResult> {
    let now = chrono::Utc::now().timestamp();
    let Ok(cands) = db.with_conn(|conn| candidates(conn, positions, now)) else { return Vec::new() };

    let mut out = Vec::new();
    for c in cands {
        let Ok(results) = yahoo::search_tickers(&c.name).await else { continue };
        let named = name_matches(&c.name, &results);
        if named.is_empty() {
            out.push(AliasResult { provider_symbol: c.provider_symbol, ticker: None, retry_at: Some(now + RETRY_NO_MATCH_SECS) });
            continue;
        }
        let Ok(quotes) = yahoo::fetch_quotes(&named).await else { continue };
        let ticker = named
            .into_iter()
            .find(|t| quotes.get(t).is_some_and(|q| price_matches(c.price, q.price)));
        let retry_at = ticker.is_none().then_some(now + RETRY_PRICE_MISMATCH_SECS);
        out.push(AliasResult { provider_symbol: c.provider_symbol, ticker, retry_at });
    }
    out
}

/// Stores a search result. A found alias also re-points the symbol's
/// existing rows, so nothing waits for the next sync to pick it up.
pub fn save_alias(conn: &Connection, a: &AliasResult, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO symbol_aliases (provider_symbol, ticker, retry_at, checked_at) \
         VALUES (?1, ?2, ?3, ?4)",
        params![a.provider_symbol, a.ticker, a.retry_at, now],
    )?;
    if let Some(ref t) = a.ticker {
        conn.execute("UPDATE broker_positions SET ticker = ?1 WHERE provider_symbol = ?2", params![t, a.provider_symbol])?;
        conn.execute("UPDATE broker_transactions SET ticker = ?1 WHERE provider_symbol = ?2", params![t, a.provider_symbol])?;
        conn.execute("INSERT OR IGNORE INTO stocks (ticker) VALUES (?1)", params![t])?;
    }
    Ok(())
}

/// One price per symbol per day; the day's last sync wins.
pub fn record_price(conn: &Connection, provider_symbol: &str, day: &str, price: f64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO broker_position_prices (provider_symbol, day, price) VALUES (?1, ?2, ?3)",
        params![provider_symbol, day, price],
    )?;
    Ok(())
}

/// Recorded prices for the holding Yahoo knows as `ticker` (its provider
/// symbol, or a symbol whose position carries that ticker), oldest first.
pub fn history(conn: &Connection, ticker: &str, since_day: Option<&str>) -> rusqlite::Result<Vec<(String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT day, AVG(price) FROM broker_position_prices \
         WHERE (provider_symbol = ?1 \
                OR provider_symbol IN (SELECT provider_symbol FROM broker_positions WHERE ticker = ?1)) \
           AND (?2 IS NULL OR day >= ?2) \
         GROUP BY day ORDER BY day",
    )?;
    let rows = stmt.query_map(params![ticker, since_day], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn result(symbol: &str, name: &str) -> yahoo::SearchResult {
        yahoo::SearchResult { symbol: symbol.into(), name: Some(name.into()), exchange: None, type_disp: None }
    }

    #[test]
    fn names_match_across_punctuation_and_ampersands() {
        assert_eq!(normalize_name("Dodge & Cox Stock X"), normalize_name("DODGE AND COX STOCK X"));
        assert_ne!(normalize_name("Dodge & Cox Stock X"), normalize_name("Dodge & Cox Stock I"));
    }

    #[test]
    fn only_the_exact_share_class_matches() {
        let results = [result("DODGX", "Dodge & Cox Stock I"), result("DOXGX", "Dodge & Cox Stock X")];
        assert_eq!(name_matches("Dodge & Cox Stock X", &results), vec!["DOXGX".to_string()]);
        assert!(name_matches("Mid Cap Growth IV R1", &results).is_empty());
    }

    #[test]
    fn price_must_agree_within_half_a_percent() {
        assert!(price_matches(17.900004, 17.90));
        assert!(!price_matches(17.90, 18.10));
        assert!(!price_matches(0.0, 17.90));
    }

    #[test]
    fn an_alias_repoints_the_symbol_and_is_used_from_then_on() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();
        conn.execute(
            "INSERT INTO broker_positions (broker_account_id, provider_symbol, ticker, qty, snapshot_at) \
             VALUES (1, 'Y73H', 'Y73H', 10, 0)",
            [],
        )
        .unwrap();
        assert_eq!(yahoo_ticker(&conn, "Y73H", Some("mutualfund")).unwrap().as_deref(), Some("Y73H"));

        let found = AliasResult { provider_symbol: "Y73H".into(), ticker: Some("DOXGX".into()), retry_at: None };
        save_alias(&conn, &found, 100).unwrap();
        assert_eq!(yahoo_ticker(&conn, "Y73H", Some("mutualfund")).unwrap().as_deref(), Some("DOXGX"));
        let stored: String = conn.query_row("SELECT ticker FROM broker_positions", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, "DOXGX");
    }

    #[test]
    fn history_is_found_by_provider_symbol_or_by_ticker() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run_all(&conn).unwrap();
        record_price(&conn, "Y8V5", "2026-11-01", 9.40).unwrap();
        record_price(&conn, "Y8V5", "2026-11-02", 9.50).unwrap();
        record_price(&conn, "Y8V5", "2026-11-02", 9.52).unwrap();
        assert_eq!(
            history(&conn, "Y8V5", None).unwrap(),
            vec![("2026-11-01".to_string(), 9.40), ("2026-11-02".to_string(), 9.52)]
        );
        assert_eq!(history(&conn, "Y8V5", Some("2026-11-02")).unwrap().len(), 1);
    }
}
