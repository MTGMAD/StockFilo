use crate::yahoo;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Serialize)]
pub struct QuoteResult {
    pub ticker: String,
    pub price: Option<f64>,
    pub name: Option<String>,
}

/// Called from the frontend to fetch live prices for a list of tickers.
/// Returns a list of QuoteResult — tickers missing from Yahoo will have price: null.
#[tauri::command]
pub async fn fetch_quotes_command(tickers: Vec<String>) -> Result<Vec<QuoteResult>, String> {
    if tickers.is_empty() {
        return Ok(vec![]);
    }

    let upper: Vec<String> = tickers.iter().map(|t| t.to_uppercase()).collect();
    let quotes: HashMap<String, (f64, Option<String>)> = yahoo::fetch_quotes(&upper).await?;

    let results = upper
        .into_iter()
        .map(|ticker| {
            let (price, name) = quotes
                .get(&ticker)
                .map(|(p, n)| (Some(*p), n.clone()))
                .unwrap_or((None, None));
            QuoteResult { ticker, price, name }
        })
        .collect();

    Ok(results)
}
