use reqwest::cookie::Jar;
use reqwest::Client;
use serde::{Deserialize, Serialize};
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

// ── Chart / historical data types ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct YahooChartResponse {
    chart: ChartOuter,
}

#[derive(Debug, Deserialize)]
struct ChartOuter {
    result: Option<Vec<ChartResult>>,
}

#[derive(Debug, Deserialize)]
struct ChartResult {
    timestamp: Option<Vec<i64>>,
    indicators: Indicators,
    meta: ChartMeta,
}

#[derive(Debug, Deserialize)]
struct ChartMeta {
    #[serde(rename = "regularMarketPrice")]
    regular_market_price: Option<f64>,
    #[serde(rename = "chartPreviousClose")]
    chart_previous_close: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Indicators {
    quote: Vec<QuoteIndicator>,
}

#[derive(Debug, Deserialize)]
struct QuoteIndicator {
    close: Option<Vec<Option<f64>>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ChartPoint {
    pub timestamp: i64,
    pub close: f64,
}

#[derive(Debug, Serialize)]
pub struct ChartData {
    pub points: Vec<ChartPoint>,
    pub previous_close: Option<f64>,
    pub current_price: Option<f64>,
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

// ── Ticker search / autocomplete ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct YahooSearchResponse {
    quotes: Option<Vec<SearchQuote>>,
}

#[derive(Debug, Deserialize)]
struct SearchQuote {
    symbol: String,
    #[serde(rename = "shortname")]
    short_name: Option<String>,
    #[serde(rename = "longname")]
    long_name: Option<String>,
    #[serde(rename = "exchDisp")]
    exchange: Option<String>,
    #[serde(rename = "typeDisp")]
    type_disp: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchResult {
    pub symbol: String,
    pub name: Option<String>,
    pub exchange: Option<String>,
    pub type_disp: Option<String>,
}

/// Search for tickers by name or symbol using Yahoo Finance's search endpoint.
pub async fn search_tickers(query: &str) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!(
        "https://query2.finance.yahoo.com/v1/finance/search?q={}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query",
        urlencoding::encode(query)
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Yahoo search API returned HTTP {status}: {body}"));
    }

    let data: YahooSearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse search response: {e}"))?;

    let results = data
        .quotes
        .unwrap_or_default()
        .into_iter()
        .map(|q| SearchResult {
            symbol: q.symbol,
            name: q.long_name.or(q.short_name),
            exchange: q.exchange,
            type_disp: q.type_disp,
        })
        .collect();

    Ok(results)
}

/// Fetch historical chart data for a single ticker.
/// `range` is one of: 1d, 5d, 1mo, 6mo, ytd, 1y, 5y, max
/// `interval` is one of: 1m, 2m, 5m, 15m, 30m, 60m, 1d, 1wk, 1mo
pub async fn fetch_chart(
    ticker: &str,
    range: &str,
    interval: &str,
) -> Result<ChartData, String> {
    let (client, crumb) = get_authenticated_client().await?;

    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval={}&crumb={}",
        urlencoding::encode(ticker),
        urlencoding::encode(range),
        urlencoding::encode(interval),
        urlencoding::encode(&crumb),
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Chart request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Yahoo chart API returned HTTP {status}: {body}"));
    }

    let data: YahooChartResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse chart response: {e}"))?;

    let result = data
        .chart
        .result
        .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
        .ok_or_else(|| "No chart data returned from Yahoo".to_string())?;

    let timestamps = result.timestamp.unwrap_or_default();
    let closes = result
        .indicators
        .quote
        .into_iter()
        .next()
        .and_then(|q| q.close)
        .unwrap_or_default();

    let points: Vec<ChartPoint> = timestamps
        .into_iter()
        .zip(closes)
        .filter_map(|(ts, close)| close.map(|c| ChartPoint { timestamp: ts, close: c }))
        .collect();

    Ok(ChartData {
        points,
        previous_close: result.meta.chart_previous_close,
        current_price: result.meta.regular_market_price,
    })
}

// ── Ticker news ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct YahooNewsSearchResponse {
    news: Option<Vec<YahooNewsArticle>>,
}

#[derive(Debug, Deserialize)]
struct YahooNewsArticle {
    title: Option<String>,
    link: Option<String>,
    publisher: Option<String>,
    thumbnail: Option<YahooNewsThumbnail>,
    #[serde(rename = "relatedTickers", default)]
    related_tickers: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct YahooNewsThumbnail {
    resolutions: Option<Vec<YahooThumbnailRes>>,
}

#[derive(Debug, Deserialize)]
struct YahooThumbnailRes {
    url: Option<String>,
    tag: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct NewsArticle {
    pub title: String,
    pub url: String,
    pub publisher: Option<String>,
    pub image_url: Option<String>,
}

/// Fetch recent news articles strictly about a specific ticker using Yahoo Finance's search endpoint.
/// Only returns articles where this ticker is the primary subject (first in relatedTickers).
pub async fn fetch_news(ticker: &str, count: u32) -> Result<Vec<NewsArticle>, String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    // Request many more articles so we have enough after strict filtering
    let fetch_count = count * 5;
    let url = format!(
        "https://query2.finance.yahoo.com/v1/finance/search?q={}&quotesCount=0&newsCount={}&listsCount=0",
        urlencoding::encode(ticker),
        fetch_count,
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("News request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Yahoo news API returned HTTP {status}: {body}"));
    }

    let data: YahooNewsSearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse news response: {e}"))?;

    let upper_ticker = ticker.to_uppercase();
    let articles = data
        .news
        .unwrap_or_default()
        .into_iter()
        .filter(|a| {
            // Only include articles where this ticker is the PRIMARY subject —
            // i.e. it appears first in relatedTickers.
            a.related_tickers
                .first()
                .map(|t| t.eq_ignore_ascii_case(&upper_ticker))
                .unwrap_or(false)
        })
        .filter_map(|a| {
            let image_url = a
                .thumbnail
                .and_then(|t| t.resolutions)
                .and_then(|rr| {
                    rr.into_iter()
                        .find(|r| r.tag.as_deref() == Some("original"))
                })
                .and_then(|r| r.url);

            Some(NewsArticle {
                title: a.title?,
                url: a.link?,
                publisher: a.publisher,
                image_url,
            })
        })
        .take(count as usize)
        .collect();

    Ok(articles)
}
