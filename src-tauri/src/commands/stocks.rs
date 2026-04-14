use crate::yahoo;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Serialize)]
pub struct QuoteResult {
    pub ticker: String,
    pub price: Option<f64>,
    pub name: Option<String>,
    pub quote_type: Option<String>,
    pub daily_change_pct: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub symbol: String,
    pub name: Option<String>,
    pub exchange: Option<String>,
    pub type_disp: Option<String>,
}

/// Called from the frontend to fetch live prices for a list of tickers.
/// Returns a list of QuoteResult — tickers missing from Yahoo will have price: null.
#[tauri::command]
pub async fn fetch_quotes_command(tickers: Vec<String>) -> Result<Vec<QuoteResult>, String> {
    if tickers.is_empty() {
        return Ok(vec![]);
    }

    let upper: Vec<String> = tickers.iter().map(|t| t.to_uppercase()).collect();
    let quotes = yahoo::fetch_quotes(&upper).await?;

    let results = upper
        .into_iter()
        .map(|ticker| {
            if let Some(qd) = quotes.get(&ticker) {
                QuoteResult {
                    ticker,
                    price: Some(qd.price),
                    name: qd.name.clone(),
                    quote_type: qd.quote_type.clone(),
                    daily_change_pct: qd.daily_change_pct,
                }
            } else {
                QuoteResult { ticker, price: None, name: None, quote_type: None, daily_change_pct: None }
            }
        })
        .collect();

    Ok(results)
}

/// Called from the frontend to fetch chart data for a ticker.
#[tauri::command]
pub async fn fetch_chart_command(
    ticker: String,
    range: String,
    interval: String,
) -> Result<yahoo::ChartData, String> {
    yahoo::fetch_chart(&ticker.to_uppercase(), &range, &interval).await
}

/// Fetch recent news articles for a ticker.
#[tauri::command]
pub async fn fetch_news_command(ticker: String, count: Option<u32>) -> Result<Vec<yahoo::NewsArticle>, String> {
    yahoo::fetch_news(&ticker.to_uppercase(), count.unwrap_or(10)).await
}

/// Search for tickers by name or symbol.
#[tauri::command]
pub async fn search_tickers_command(query: String) -> Result<Vec<SearchResult>, String> {
    let results = yahoo::search_tickers(&query).await?;
    Ok(results
        .into_iter()
        .map(|r| SearchResult {
            symbol: r.symbol,
            name: r.name,
            exchange: r.exchange,
            type_disp: r.type_disp,
        })
        .collect())
}
