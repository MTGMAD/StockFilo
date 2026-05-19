use reqwest::cookie::Jar;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

// Match the user-agent to the OS TLS fingerprint to avoid Cloudflare bot detection.
#[cfg(target_os = "macos")]
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
#[cfg(not(target_os = "macos"))]
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

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
    #[serde(rename = "quoteType")]
    quote_type: Option<String>,
    #[serde(rename = "regularMarketChangePercent")]
    regular_market_change_percent: Option<f64>,
    #[serde(rename = "targetMeanPrice")]
    target_mean_price: Option<Value>,
    #[serde(rename = "postMarketPrice")]
    post_market_price: Option<f64>,
    #[serde(rename = "postMarketChangePercent")]
    post_market_change_pct: Option<f64>,
    #[serde(rename = "preMarketPrice")]
    pre_market_price: Option<f64>,
    #[serde(rename = "preMarketChangePercent")]
    pre_market_change_pct: Option<f64>,
    #[serde(rename = "marketState")]
    market_state: Option<String>,
    #[serde(rename = "earningsTimestamp")]
    earnings_timestamp: Option<Value>,
    #[serde(rename = "earningsTimestampStart")]
    earnings_timestamp_start: Option<Value>,
    #[serde(rename = "earningsTimestampEnd")]
    earnings_timestamp_end: Option<Value>,
    // Extended fields used for comparison
    #[serde(rename = "marketCap")]
    market_cap: Option<f64>,
    #[serde(rename = "trailingPE")]
    trailing_pe: Option<f64>,
    #[serde(rename = "forwardPE")]
    forward_pe: Option<f64>,
    #[serde(rename = "priceToBook")]
    price_to_book: Option<f64>,
    #[serde(rename = "beta")]
    beta: Option<f64>,
    #[serde(rename = "fiftyTwoWeekHigh")]
    fifty_two_week_high: Option<f64>,
    #[serde(rename = "fiftyTwoWeekLow")]
    fifty_two_week_low: Option<f64>,
    #[serde(rename = "dividendYield")]
    dividend_yield: Option<f64>,
    #[serde(rename = "dividendDate")]
    dividend_date: Option<Value>,
    #[serde(rename = "trailingAnnualDividendRate")]
    trailing_annual_dividend_rate: Option<Value>,
    #[serde(rename = "epsTrailingTwelveMonths")]
    eps_trailing: Option<f64>,
    #[serde(rename = "recommendationKey")]
    recommendation_key: Option<String>,
    #[serde(rename = "numberOfAnalystOpinions")]
    number_of_analyst_opinions: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct YahooQuoteSummaryResponse {
    #[serde(rename = "quoteSummary")]
    quote_summary: QuoteSummaryOuter,
}

#[derive(Debug, Deserialize)]
struct QuoteSummaryOuter {
    result: Option<Vec<QuoteSummaryResult>>,
}

#[derive(Debug, Deserialize)]
struct QuoteSummaryResult {
    #[serde(rename = "financialData")]
    financial_data: Option<FinancialData>,
}

#[derive(Debug, Deserialize)]
struct FinancialData {
    #[serde(rename = "targetMeanPrice")]
    target_mean_price: Option<Value>,
}

// ── Comparison-specific quoteSummary structs ───────────────────────────────

#[derive(Debug, Deserialize)]
struct ComparisonYahooQuoteSummaryResponse {
    #[serde(rename = "quoteSummary")]
    quote_summary: ComparisonQuoteSummaryOuter,
}

#[derive(Debug, Deserialize)]
struct ComparisonQuoteSummaryOuter {
    result: Option<Vec<ComparisonQuoteSummaryResult>>,
}

#[derive(Debug, Deserialize)]
struct ComparisonQuoteSummaryResult {
    #[serde(rename = "financialData")]
    financial_data: Option<ComparisonFinancialData>,
}

#[derive(Debug, Deserialize)]
struct ComparisonFinancialData {
    #[serde(rename = "grossMargins")]
    gross_margins: Option<Value>,
    #[serde(rename = "operatingMargins")]
    operating_margins: Option<Value>,
    #[serde(rename = "profitMargins")]
    profit_margins: Option<Value>,
    #[serde(rename = "revenueGrowth")]
    revenue_growth: Option<Value>,
    #[serde(rename = "recommendationKey")]
    recommendation_key: Option<Value>,
    #[serde(rename = "numberOfAnalystOpinions")]
    number_of_analyst_opinions: Option<Value>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ComparisonStats {
    pub price: Option<f64>,
    pub name: Option<String>,
    pub daily_change_pct: Option<f64>,
    pub target_mean_price: Option<f64>,
    pub post_market_price: Option<f64>,
    pub post_market_change_pct: Option<f64>,
    pub pre_market_price: Option<f64>,
    pub pre_market_change_pct: Option<f64>,
    pub market_state: Option<String>,
    pub market_cap: Option<f64>,
    pub trailing_pe: Option<f64>,
    pub forward_pe: Option<f64>,
    pub price_to_book: Option<f64>,
    pub beta: Option<f64>,
    pub fifty_two_week_high: Option<f64>,
    pub fifty_two_week_low: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub eps_trailing: Option<f64>,
    pub recommendation_key: Option<String>,
    pub number_of_analyst_opinions: Option<i64>,
    pub gross_margins: Option<f64>,
    pub operating_margins: Option<f64>,
    pub profit_margins: Option<f64>,
    pub revenue_growth: Option<f64>,
}

fn value_to_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64(),
        Value::Array(arr) => arr.first().and_then(value_to_i64),
        Value::Object(map) => map.get("raw").and_then(value_to_i64),
        _ => None,
    }
}

fn value_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::Array(arr) => arr.first().and_then(value_to_f64),
        Value::Object(map) => map.get("raw").and_then(value_to_f64),
        _ => None,
    }
}

fn extract_earnings_timestamp(q: &QuoteResult) -> Option<i64> {
    let candidates = [
        q.earnings_timestamp.as_ref(),
        q.earnings_timestamp_start.as_ref(),
        q.earnings_timestamp_end.as_ref(),
    ];

    candidates
        .into_iter()
        .flatten()
        .filter_map(value_to_i64)
        .find(|ts| *ts > 0)
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
        .user_agent(USER_AGENT)
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

pub struct QuoteData {
    pub price: f64,
    pub name: Option<String>,
    pub quote_type: Option<String>,
    pub daily_change_pct: Option<f64>,
    pub target_mean_price: Option<f64>,
    pub post_market_price: Option<f64>,
    pub post_market_change_pct: Option<f64>,
    pub pre_market_price: Option<f64>,
    pub pre_market_change_pct: Option<f64>,
    pub market_state: Option<String>,
    pub dividend_yield: Option<f64>,
}

async fn fetch_target_mean_price(
    client: &Client,
    ticker: &str,
    crumb: &str,
) -> Result<Option<f64>, String> {
    let url = format!(
        "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=financialData&crumb={}",
        urlencoding::encode(ticker),
        urlencoding::encode(crumb),
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Target estimate request failed for {ticker}: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let data: YahooQuoteSummaryResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse target estimate response for {ticker}: {e}"))?;

    Ok(data
        .quote_summary
        .result
        .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
        .and_then(|r| r.financial_data)
        .and_then(|fd| fd.target_mean_price)
        .and_then(|v| value_to_f64(&v)))
}

/// Fetch current prices for a batch of tickers from Yahoo Finance.
pub async fn fetch_quotes(
    tickers: &[String],
) -> Result<HashMap<String, QuoteData>, String> {
    if tickers.is_empty() {
        return Ok(HashMap::new());
    }

    let (client, crumb) = get_authenticated_client().await?;

    let mut results: HashMap<String, QuoteData> = HashMap::new();

    // Process in chunks of 10 to stay within Yahoo rate limits
    for chunk in tickers.chunks(10) {
        let raw_symbols = chunk.join(",");
        let symbols = chunk
            .iter()
            .map(|s| urlencoding::encode(s).into_owned())
            .collect::<Vec<_>>()
            .join(",");
        let url = format!(
            "https://query1.finance.yahoo.com/v7/finance/quote?symbols={}&crumb={}&fields=regularMarketPrice,longName,shortName,quoteType,regularMarketChangePercent,targetMeanPrice,postMarketPrice,postMarketChangePercent,preMarketPrice,preMarketChangePercent,marketState,dividendYield",
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
                "Yahoo Finance returned HTTP {status} for [{raw_symbols}]: {body}"
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
                    let target_mean_price = match q.target_mean_price.as_ref().and_then(value_to_f64) {
                        Some(price) => Some(price),
                        None => fetch_target_mean_price(&client, &q.symbol, &crumb)
                            .await
                            .unwrap_or(None),
                    };
                    results.insert(q.symbol, QuoteData {
                        price,
                        name,
                        quote_type: q.quote_type,
                        daily_change_pct: q.regular_market_change_percent,
                        target_mean_price,
                        post_market_price: q.post_market_price,
                        post_market_change_pct: q.post_market_change_pct,
                        pre_market_price: q.pre_market_price,
                        pre_market_change_pct: q.pre_market_change_pct,
                        market_state: q.market_state,
                        dividend_yield: q.dividend_yield,
                    });
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

/// Fetch extended comparison stats for up to 4 tickers (live, not cached).
pub async fn fetch_comparison_stats(
    tickers: &[String],
) -> Result<HashMap<String, ComparisonStats>, String> {
    if tickers.is_empty() {
        return Ok(HashMap::new());
    }

    let (client, crumb) = get_authenticated_client().await?;
    let mut results: HashMap<String, ComparisonStats> = HashMap::new();

    // Single batch call — comparison is at most 4 tickers
    let symbols = tickers
        .iter()
        .map(|s| urlencoding::encode(s).into_owned())
        .collect::<Vec<_>>()
        .join(",");
    let url = format!(
        "https://query1.finance.yahoo.com/v7/finance/quote?symbols={}&crumb={}&fields=regularMarketPrice,longName,shortName,quoteType,regularMarketChangePercent,targetMeanPrice,postMarketPrice,postMarketChangePercent,preMarketPrice,preMarketChangePercent,marketState,marketCap,trailingPE,forwardPE,priceToBook,beta,fiftyTwoWeekHigh,fiftyTwoWeekLow,dividendYield,epsTrailingTwelveMonths,recommendationKey,numberOfAnalystOpinions",
        symbols,
        urlencoding::encode(&crumb)
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Comparison quote request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Yahoo Finance returned HTTP {status} for comparison: {body}"));
    }

    let data: YahooQuoteResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse comparison quote response: {e}"))?;

    if let Some(quote_results) = data.quote_response.result {
        for q in quote_results {
            let price = q.regular_market_price;
            let target_mean_price = match q.target_mean_price.as_ref().and_then(value_to_f64) {
                Some(p) => Some(p),
                None => fetch_target_mean_price(&client, &q.symbol, &crumb).await.unwrap_or(None),
            };
            let name = q.long_name.or(q.short_name);
            let number_of_analyst_opinions = q.number_of_analyst_opinions.as_ref().and_then(value_to_i64);
            results.insert(q.symbol, ComparisonStats {
                price,
                name,
                daily_change_pct: q.regular_market_change_percent,
                target_mean_price,
                post_market_price: q.post_market_price,
                post_market_change_pct: q.post_market_change_pct,
                pre_market_price: q.pre_market_price,
                pre_market_change_pct: q.pre_market_change_pct,
                market_state: q.market_state,
                market_cap: q.market_cap,
                trailing_pe: q.trailing_pe,
                forward_pe: q.forward_pe,
                price_to_book: q.price_to_book,
                beta: q.beta,
                fifty_two_week_high: q.fifty_two_week_high,
                fifty_two_week_low: q.fifty_two_week_low,
                dividend_yield: q.dividend_yield,
                eps_trailing: q.eps_trailing,
                recommendation_key: q.recommendation_key,
                number_of_analyst_opinions,
                gross_margins: None,
                operating_margins: None,
                profit_margins: None,
                revenue_growth: None,
            });
        }
    }

    // Fetch financial data (margins) for each ticker via quoteSummary
    for ticker in tickers {
        if !results.contains_key(ticker) {
            continue;
        }
        let url = format!(
            "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=financialData&crumb={}",
            urlencoding::encode(ticker),
            urlencoding::encode(&crumb),
        );
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if !resp.status().is_success() {
            continue;
        }
        let data: ComparisonYahooQuoteSummaryResponse = match resp.json().await {
            Ok(d) => d,
            Err(_) => continue,
        };
        if let Some(fd) = data
            .quote_summary
            .result
            .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
            .and_then(|r| r.financial_data)
        {
            if let Some(entry) = results.get_mut(ticker) {
                entry.gross_margins = fd.gross_margins.as_ref().and_then(value_to_f64);
                entry.operating_margins = fd.operating_margins.as_ref().and_then(value_to_f64);
                entry.profit_margins = fd.profit_margins.as_ref().and_then(value_to_f64);
                entry.revenue_growth = fd.revenue_growth.as_ref().and_then(value_to_f64);
                // Use financialData as the authoritative source for analyst data;
                // the v7 quote endpoint doesn't always populate these fields.
                if let Some(rec) = fd.recommendation_key.as_ref() {
                    if let Value::String(s) = rec {
                        if !s.is_empty() {
                            entry.recommendation_key = Some(s.clone());
                        }
                    }
                }
                if entry.number_of_analyst_opinions.is_none() {
                    entry.number_of_analyst_opinions =
                        fd.number_of_analyst_opinions.as_ref().and_then(value_to_i64);
                }
            }
        }
        sleep(Duration::from_millis(150)).await;
    }

    Ok(results)
}

// ── Dividend info ─────────────────────────────────────────────────────────

/// Standalone response for a single-module calendarEvents quoteSummary call.
#[derive(Debug, Deserialize)]
struct CalendarEventsResponse {
    #[serde(rename = "quoteSummary")]
    quote_summary: CalendarEventsOuter,
}
#[derive(Debug, Deserialize)]
struct CalendarEventsOuter {
    result: Option<Vec<CalendarEventsResult>>,
}
#[derive(Debug, Deserialize)]
struct CalendarEventsResult {
    #[serde(rename = "calendarEvents")]
    calendar_events: Option<CalendarEventsFields>,
}
#[derive(Debug, Deserialize)]
struct CalendarEventsFields {
    #[serde(rename = "dividendDate")]
    dividend_date: Option<Value>,
    #[serde(rename = "exDividendDate")]
    ex_dividend_date: Option<Value>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DividendInfo {
    /// Unix timestamp of the next (or most recent) dividend date.
    pub dividend_date: Option<i64>,
    /// Most recent dividend payment amount per share, when Yahoo exposes it.
    pub dividend_amount_per_share: Option<f64>,
    /// Trailing annual dividend amount per share.
    pub annual_dividend_rate: Option<f64>,
    /// Inferred payout cadence from dividend history: monthly, quarterly, annual, etc.
    pub payout_frequency: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct DividendChartSummary {
    latest_date: Option<i64>,
    latest_amount: Option<f64>,
    annual_rate: Option<f64>,
    payout_frequency: Option<&'static str>,
}

/// Fetch the next dividend payout/ex-dividend date for a ticker.
pub async fn fetch_dividend_info(ticker: &str) -> Result<DividendInfo, String> {
    let fallback_client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let chart_summary = fetch_dividend_chart_summary(&fallback_client, ticker).await;
    if chart_summary.is_none() {
        return Ok(empty_dividend_info());
    }

    let Ok((client, crumb)) = get_authenticated_client().await else {
        return Ok(DividendInfo {
            dividend_date: chart_summary.and_then(|s| s.latest_date),
            dividend_amount_per_share: chart_summary.and_then(|s| s.latest_amount),
            annual_dividend_rate: chart_summary.and_then(|s| s.annual_rate),
            payout_frequency: chart_summary.and_then(|s| s.payout_frequency).map(str::to_string),
        });
    };

    let cal_url = format!(
        "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=calendarEvents&crumb={}",
        urlencoding::encode(ticker),
        urlencoding::encode(&crumb),
    );

    let calendar_dividend_date = match client.get(&cal_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<CalendarEventsResponse>().await {
                Ok(data) => data.quote_summary.result
                    .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
                    .and_then(|r| r.calendar_events)
                    .and_then(|ev| {
                        ev.dividend_date.as_ref().and_then(value_to_i64).filter(|&ts| ts > 0)
                            .or_else(|| {
                                ev.ex_dividend_date.as_ref().and_then(value_to_i64).filter(|&ts| ts > 0)
                            })
                    }),
                Err(_) => None,
            }
        }
        _ => None,
    };

    let quote_url = format!(
        "https://query1.finance.yahoo.com/v7/finance/quote?symbols={}&crumb={}&fields=dividendDate,trailingAnnualDividendRate,dividendYield",
        urlencoding::encode(ticker),
        urlencoding::encode(&crumb),
    );

    let (quote_dividend_date, annual_dividend_rate) = match client.get(&quote_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<YahooQuoteResponse>().await {
                Ok(data) => data.quote_response.result
                    .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
                    .map(|q| {
                        (
                            q.dividend_date.as_ref().and_then(value_to_i64).filter(|&ts| ts > 0),
                            q.trailing_annual_dividend_rate.as_ref().and_then(value_to_f64).filter(|rate| *rate > 0.0),
                        )
                    })
                    .unwrap_or((None, None)),
                Err(_) => (None, None),
            }
        }
        _ => (None, None),
    };

    Ok(DividendInfo {
        dividend_date: calendar_dividend_date
            .or(quote_dividend_date)
            .or_else(|| chart_summary.and_then(|s| s.latest_date)),
        dividend_amount_per_share: chart_summary.and_then(|s| s.latest_amount),
        annual_dividend_rate: annual_dividend_rate.or_else(|| chart_summary.and_then(|s| s.annual_rate)),
        payout_frequency: chart_summary.and_then(|s| s.payout_frequency).map(str::to_string),
    })
}

fn empty_dividend_info() -> DividendInfo {
    DividendInfo {
        dividend_date: None,
        dividend_amount_per_share: None,
        annual_dividend_rate: None,
        payout_frequency: None,
    }
}

async fn fetch_dividend_chart_summary(client: &Client, ticker: &str) -> Option<DividendChartSummary> {
    let chart_url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=2y&interval=1d&events=div",
        urlencoding::encode(ticker),
    );

    let resp = client.get(&chart_url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data = resp.json::<Value>().await.ok()?;
    extract_dividend_chart_summary(&data)
}

fn extract_dividend_chart_summary(data: &Value) -> Option<DividendChartSummary> {
    let dividends = data
        .pointer("/chart/result/0/events/dividends")
        .and_then(Value::as_object)?;

    let mut events = dividends
        .iter()
        .filter_map(|(key, event)| {
            let amount = event.get("amount").and_then(value_to_f64).filter(|amount| *amount > 0.0)?;
            let date = event
                .get("date")
                .and_then(value_to_i64)
                .or_else(|| key.parse::<i64>().ok())?;
            Some((date, amount))
        })
        .collect::<Vec<_>>();

    let payout_frequency = infer_dividend_frequency(&events);
    events.sort_by_key(|(date, _)| *date);
    let now = chrono::Utc::now().timestamp();
    let latest_past = events.iter().rev().copied().find(|(date, _)| *date <= now);
    let next_upcoming = events.iter().copied().find(|(date, _)| *date >= now);
    let is_current_payer = next_upcoming.is_some()
        || latest_past
            .map(|(date, _)| is_recent_dividend(date, payout_frequency, now))
            .unwrap_or(false);

    if !is_current_payer {
        return None;
    }

    let (latest_date, latest_amount) = next_upcoming.or(latest_past)?;
    let annual_rate = payout_frequency
        .and_then(payments_per_year)
        .map(|payments| latest_amount * payments)
        .or_else(|| {
            Some(
                events
                    .iter()
                    .rev()
                    .take(4)
                    .map(|(_, amount)| *amount)
                    .sum::<f64>(),
            )
            .filter(|rate| *rate > 0.0)
        });

    Some(DividendChartSummary {
        latest_date: Some(latest_date),
        latest_amount: Some(latest_amount),
        annual_rate,
        payout_frequency,
    })
}

fn is_recent_dividend(
    latest_date: i64,
    frequency: Option<&str>,
    now: i64,
) -> bool {
    let elapsed_days = (now - latest_date).max(0) as f64 / 86_400.0;
    elapsed_days <= active_dividend_grace_days(frequency)
}

fn active_dividend_grace_days(frequency: Option<&str>) -> f64 {
    match frequency {
        Some("monthly") => 60.0,
        Some("bimonthly") => 105.0,
        Some("quarterly") => 150.0,
        Some("semiannual") => 270.0,
        Some("annual") => 550.0,
        _ => 550.0,
    }
}

fn infer_dividend_frequency(events: &[(i64, f64)]) -> Option<&'static str> {
    if events.is_empty() {
        return None;
    }
    if events.len() == 1 {
        return Some("annual");
    }

    let mut intervals = events
        .windows(2)
        .filter_map(|pair| {
            let days = (pair[1].0 - pair[0].0) as f64 / 86_400.0;
            (days > 15.0).then_some(days)
        })
        .collect::<Vec<_>>();

    if intervals.is_empty() {
        return None;
    }

    intervals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_days = intervals[intervals.len() / 2];

    if median_days <= 45.0 {
        Some("monthly")
    } else if median_days <= 75.0 {
        Some("bimonthly")
    } else if median_days <= 120.0 {
        Some("quarterly")
    } else if median_days <= 220.0 {
        Some("semiannual")
    } else {
        Some("annual")
    }
}

fn payments_per_year(frequency: &str) -> Option<f64> {
    match frequency {
        "monthly" => Some(12.0),
        "bimonthly" => Some(6.0),
        "quarterly" => Some(4.0),
        "semiannual" => Some(2.0),
        "annual" => Some(1.0),
        _ => None,
    }
}

/// Fetch upcoming earnings events for tickers within `within_days` from now.
pub async fn fetch_upcoming_earnings(
    tickers: &[String],
    within_days: i64,
) -> Result<HashMap<String, i64>, String> {
    if tickers.is_empty() {
        return Ok(HashMap::new());
    }

    let (client, crumb) = get_authenticated_client().await?;
    let mut events: HashMap<String, i64> = HashMap::new();
    let now = chrono::Utc::now().timestamp();
    let window_end = now + within_days.max(1) * 86_400;

    for chunk in tickers.chunks(10) {
        let raw_symbols = chunk.join(",");
        let symbols = chunk
            .iter()
            .map(|s| urlencoding::encode(s).into_owned())
            .collect::<Vec<_>>()
            .join(",");
        let url = format!(
            "https://query1.finance.yahoo.com/v7/finance/quote?symbols={}&crumb={}&fields=earningsTimestamp,earningsTimestampStart,earningsTimestampEnd",
            symbols,
            urlencoding::encode(&crumb)
        );

        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Upcoming earnings request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Yahoo Finance returned HTTP {status} for earnings [{raw_symbols}]: {body}"
            ));
        }

        let data: YahooQuoteResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse upcoming earnings response: {e}"))?;

        if let Some(quote_results) = data.quote_response.result {
            for q in quote_results {
                if let Some(ts) = extract_earnings_timestamp(&q) {
                    if ts >= now && ts <= window_end {
                        events.insert(q.symbol, ts);
                    }
                }
            }
        }

        if tickers.len() > 10 {
            sleep(Duration::from_millis(200)).await;
        }
    }

    Ok(events)
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
        .user_agent(USER_AGENT)
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

#[derive(Debug, Serialize, Clone)]
pub struct NewsArticle {
    pub title: String,
    pub url: String,
    pub publisher: Option<String>,
    pub image_url: Option<String>,
}

/// Fetch recent news for a specific ticker from Yahoo Finance's RSS headline feed.
/// The feed is pre-filtered to the ticker and sorted newest-first by Yahoo.
pub async fn fetch_news(ticker: &str, count: u32) -> Result<Vec<NewsArticle>, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!(
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s={}&region=US&lang=en-US",
        urlencoding::encode(ticker),
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("News request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Yahoo news RSS returned HTTP {status}: {body}"));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read news response body: {e}"))?;

    let channel = rss::Channel::read_from(body.as_bytes())
        .map_err(|e| format!("Failed to parse RSS feed: {e}"))?;

    let articles = channel
        .items()
        .iter()
        .take(count as usize)
        .filter_map(|item| {
            let title = item.title()?.to_string();
            let url = item.link()?.to_string();
            let publisher = item.source().and_then(|s| s.title().map(|t| t.to_string()));
            let image_url = item
                .extensions()
                .get("media")
                .and_then(|m| m.get("content"))
                .and_then(|v| v.first())
                .and_then(|e| e.attrs().get("url"))
                .cloned();
            Some(NewsArticle { title, url, publisher, image_url })
        })
        .collect();

    Ok(articles)
}
