use reqwest::cookie::Jar;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

#[derive(Debug, Deserialize)]
struct YahooQuoteResponse {
    #[serde(rename = "quoteResponse")]
    quote_response: QuoteResponseInner,
}

#[derive(Debug, Deserialize)]
struct QuoteResponseInner {
    result: Option<Vec<QuoteResult>>,
}

#[derive(Debug, Deserialize)]
struct QuoteResult {
    symbol: String,
    #[serde(rename = "regularMarketPrice")]
    regular_market_price: Option<f64>,
    #[serde(rename = "longName")]
    long_name: Option<String>,
    #[serde(rename = "shortName")]
    short_name: Option<String>,
}

/// Build a reqwest client with a cookie jar, obtain a Yahoo crumb token,
/// and return the authenticated (client, crumb) pair.
async fn get_authenticated_client() -> Result<(Client, String), String> {
    let jar = Arc::new(Jar::default());
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .cookie_provider(jar.clone())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    // Step 1: Hit Yahoo Finance to receive session cookies (ignore the response status)
    let _ = client
        .get("https://finance.yahoo.com/")
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("Failed to obtain Yahoo cookies: {e}"))?;

    // Step 2: Use the cookies to fetch a crumb token
    let crumb_resp = client
        .get("https://query2.finance.yahoo.com/v1/test/getcrumb")
        .send()
        .await
        .map_err(|e| format!("Failed to request crumb: {e}"))?;

    if !crumb_resp.status().is_success() {
        return Err(format!("Crumb request returned status {}", crumb_resp.status()));
    }

    let crumb = crumb_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read crumb body: {e}"))?;

    if crumb.is_empty() || crumb.contains("<!DOCTYPE") || crumb.contains('<') {
        return Err("Received invalid crumb from Yahoo Finance".to_string());
    }

    Ok((client, crumb))
}

/// Fetch current prices for a batch of tickers from Yahoo Finance.
/// Returns a map of ticker -> (price, name).
pub async fn fetch_quotes(
    tickers: &[String],
) -> Result<HashMap<String, (f64, Option<String>)>, String> {
    if tickers.is_empty() {
        return Ok(HashMap::new());
    }

    let (client, crumb) = get_authenticated_client().await?;

    let mut results: HashMap<String, (f64, Option<String>)> = HashMap::new();

    // Process in chunks of 10 to stay within Yahoo rate limits
    for chunk in tickers.chunks(10) {
        let symbols = chunk.join(",");
        let url = format!(
            "https://query1.finance.yahoo.com/v7/finance/quote?symbols={}&crumb={}&fields=regularMarketPrice,longName,shortName",
            symbols,
            urlencoding::encode(&crumb)
        );

        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Quote request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Yahoo Finance returned HTTP {status} for [{symbols}]: {body}"
            ));
        }

        let data: YahooQuoteResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Yahoo response: {e}"))?;

        if let Some(quote_results) = data.quote_response.result {
            for q in quote_results {
                if let Some(price) = q.regular_market_price {
                    let name = q.long_name.or(q.short_name);
                    results.insert(q.symbol, (price, name));
                }
            }
        }

        // Rate-limit delay between chunks
        if tickers.len() > 10 {
            sleep(Duration::from_millis(300)).await;
        }
    }

    Ok(results)
}
