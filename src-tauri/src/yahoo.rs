use serde::Deserialize;
use std::collections::HashMap;
use tokio::time::{sleep, Duration};

#[derive(Debug, Deserialize)]
struct YahooQuoteResponse {
    #[serde(rename = "quoteResponse")]
    quote_response: QuoteResponse,
}

#[derive(Debug, Deserialize)]
struct QuoteResponse {
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

/// Fetch current prices for a batch of tickers from Yahoo Finance.
/// Returns a map of ticker -> (price, name).
pub async fn fetch_quotes(
    tickers: &[String],
) -> Result<HashMap<String, (f64, Option<String>)>, String> {
    if tickers.is_empty() {
        return Ok(HashMap::new());
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut results: HashMap<String, (f64, Option<String>)> = HashMap::new();

    // Process in chunks of 10 to stay within Yahoo rate limits
    for chunk in tickers.chunks(10) {
        let symbols = chunk.join(",");
        let url = format!(
            "https://query1.finance.yahoo.com/v7/finance/quote?symbols={}&fields=regularMarketPrice,longName,shortName",
            symbols
        );

        match client.get(&url).send().await {
            Ok(resp) => {
                if let Ok(data) = resp.json::<YahooQuoteResponse>().await {
                    if let Some(quote_results) = data.quote_response.result {
                        for q in quote_results {
                            if let Some(price) = q.regular_market_price {
                                let name = q.long_name.or(q.short_name);
                                results.insert(q.symbol, (price, name));
                            }
                        }
                    }
                }
            }
            Err(_) => {
                // Partial failure — continue with remaining chunks
            }
        }

        // Rate-limit delay between chunks
        if tickers.len() > 10 {
            sleep(Duration::from_millis(300)).await;
        }
    }

    Ok(results)
}
