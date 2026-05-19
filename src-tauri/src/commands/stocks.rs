use crate::yahoo;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct QuoteResult {
    pub ticker: String,
    pub price: Option<f64>,
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

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub symbol: String,
    pub name: Option<String>,
    pub exchange: Option<String>,
    pub type_disp: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpcomingEarningsEvent {
    pub ticker: String,
    pub event_at: i64,
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
                    target_mean_price: qd.target_mean_price,
                    post_market_price: qd.post_market_price,
                    post_market_change_pct: qd.post_market_change_pct,
                    pre_market_price: qd.pre_market_price,
                    pre_market_change_pct: qd.pre_market_change_pct,
                    market_state: qd.market_state.clone(),
                    dividend_yield: qd.dividend_yield,
                }
            } else {
                QuoteResult { ticker, price: None, name: None, quote_type: None, daily_change_pct: None, target_mean_price: None, post_market_price: None, post_market_change_pct: None, pre_market_price: None, pre_market_change_pct: None, market_state: None, dividend_yield: None }
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

/// Fetch upcoming earnings-call timestamps for tickers occurring within the given day window.
#[tauri::command]
pub async fn fetch_upcoming_earnings_command(
    tickers: Vec<String>,
    within_days: Option<i64>,
) -> Result<Vec<UpcomingEarningsEvent>, String> {
    if tickers.is_empty() {
        return Ok(vec![]);
    }

    let upper: Vec<String> = tickers.iter().map(|t| t.to_uppercase()).collect();
    let events = yahoo::fetch_upcoming_earnings(&upper, within_days.unwrap_or(30)).await?;

    Ok(events
        .into_iter()
        .map(|(ticker, event_at)| UpcomingEarningsEvent { ticker, event_at })
        .collect())
}

#[derive(Debug, Serialize)]
pub struct ComparisonStatsResult {
    pub ticker: String,
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

/// Fetch extended comparison stats for up to 4 tickers (live, not cached).
#[tauri::command]
pub async fn fetch_comparison_stats_command(
    tickers: Vec<String>,
) -> Result<Vec<ComparisonStatsResult>, String> {
    if tickers.is_empty() {
        return Ok(vec![]);
    }

    let upper: Vec<String> = tickers.iter().map(|t| t.to_uppercase()).collect();
    let stats_map = yahoo::fetch_comparison_stats(&upper).await?;

    let results = upper
        .into_iter()
        .map(|ticker| {
            if let Some(s) = stats_map.get(&ticker) {
                ComparisonStatsResult {
                    ticker,
                    price: s.price,
                    name: s.name.clone(),
                    daily_change_pct: s.daily_change_pct,
                    target_mean_price: s.target_mean_price,
                    post_market_price: s.post_market_price,
                    post_market_change_pct: s.post_market_change_pct,
                    pre_market_price: s.pre_market_price,
                    pre_market_change_pct: s.pre_market_change_pct,
                    market_state: s.market_state.clone(),
                    market_cap: s.market_cap,
                    trailing_pe: s.trailing_pe,
                    forward_pe: s.forward_pe,
                    price_to_book: s.price_to_book,
                    beta: s.beta,
                    fifty_two_week_high: s.fifty_two_week_high,
                    fifty_two_week_low: s.fifty_two_week_low,
                    dividend_yield: s.dividend_yield,
                    eps_trailing: s.eps_trailing,
                    recommendation_key: s.recommendation_key.clone(),
                    number_of_analyst_opinions: s.number_of_analyst_opinions,
                    gross_margins: s.gross_margins,
                    operating_margins: s.operating_margins,
                    profit_margins: s.profit_margins,
                    revenue_growth: s.revenue_growth,
                }
            } else {
                ComparisonStatsResult {
                    ticker,
                    price: None, name: None, daily_change_pct: None, target_mean_price: None,
                    post_market_price: None, post_market_change_pct: None,
                    pre_market_price: None, pre_market_change_pct: None, market_state: None,
                    market_cap: None, trailing_pe: None, forward_pe: None, price_to_book: None,
                    beta: None, fifty_two_week_high: None, fifty_two_week_low: None,
                    dividend_yield: None, eps_trailing: None, recommendation_key: None,
                    number_of_analyst_opinions: None, gross_margins: None,
                    operating_margins: None, profit_margins: None, revenue_growth: None,
                }
            }
        })
        .collect();

    Ok(results)
}

#[derive(Debug, Serialize)]
pub struct DividendInfoResult {
    pub dividend_date: Option<i64>,
    pub dividend_amount_per_share: Option<f64>,
    pub annual_dividend_rate: Option<f64>,
    pub payout_frequency: Option<String>,
}

/// Fetch the next dividend payout date for a single ticker.
#[tauri::command]
pub async fn fetch_dividend_info_command(ticker: String) -> Result<DividendInfoResult, String> {
    let info = yahoo::fetch_dividend_info(&ticker.to_uppercase()).await?;
    Ok(DividendInfoResult {
        dividend_date: info.dividend_date,
        dividend_amount_per_share: info.dividend_amount_per_share,
        annual_dividend_rate: info.annual_dividend_rate,
        payout_frequency: info.payout_frequency,
    })
}
