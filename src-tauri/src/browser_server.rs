//! Loopback-only browser transport for the same commands used by Tauri IPC.
//! Requests must originate from Stockfolio and carry a non-simple header;
//! no CORS permissions are granted to other websites.
use axum::{body::Body, extract::{Path, State}, http::{HeaderMap, StatusCode, Uri}, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use crate::commands;

#[derive(Clone)]
struct BrowserState { app: AppHandle, port: u16 }

fn allowed_request(headers: &HeaderMap, port: u16) -> bool {
    let host = headers.get("host").and_then(|h| h.to_str().ok()).unwrap_or("");
    let origin = headers.get("origin").and_then(|h| h.to_str().ok()).unwrap_or("");
    let client = headers.get("x-stockfolio-client").and_then(|h| h.to_str().ok());
    let local_host = host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}");
    let local_origin = origin == format!("http://127.0.0.1:{port}") || origin == format!("http://localhost:{port}");
    let dev_origin = cfg!(debug_assertions) && matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420");
    (local_host || (cfg!(debug_assertions) && matches!(host, "localhost:1420" | "127.0.0.1:1420")))
        && (local_origin || dev_origin)
        && client == Some("browser")
}

async fn command(State(state): State<BrowserState>, Path(command): Path<String>, headers: HeaderMap, Json(args): Json<Value>) -> Response {
    if !allowed_request(&headers, state.port) {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "Only the local Stockfolio app may access this backend"}))).into_response();
    }
    // Keychain and SQLite calls may block; keep them off the HTTP reactor and
    // desktop UI thread while retaining the native async command behavior.
    let result = tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(dispatch(&state.app, &command, args))).await;
    match result {
        Ok(Ok(value)) => (StatusCode::OK, Json(json!({"result": value}))).into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, Json(json!({"error": error}))).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": error.to_string()}))).into_response(),
    }
}

async fn asset(State(state): State<BrowserState>, uri: Uri) -> Response {
    let path = if uri.path() == "/" { "index.html" } else { uri.path().trim_start_matches('/') };
    if path.split('/').any(|part| part == "..") || path.contains('\\') { return StatusCode::NOT_FOUND.into_response(); }
    match state.app.asset_resolver().get(path.to_string()) {
        Some(asset) => Response::builder().header("content-type", asset.mime_type).header("x-content-type-options", "nosniff")
            .body(Body::from(asset.bytes)).unwrap(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub fn start(app: AppHandle) -> Result<(), String> {
    let port: u16 = std::env::var("STOCKFOLIO_BROWSER_PORT").unwrap_or_else(|_| "1422".into()).parse().map_err(|_| "Invalid browser port")?;
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .map_err(|e| format!("Cannot start Stockfolio browser backend on port {port}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let router = Router::new()
        .route("/api/command/{command}", post(command))
        .route("/api/health", get(|| async { Json(json!({"status": "ok"})) }))
        .fallback(get(asset))
        .with_state(BrowserState { app, port });
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).expect("browser listener");
        if let Err(error) = axum::serve(listener, router).await { eprintln!("[browser] {error}"); }
    });
    Ok(())
}

fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("Invalid argument '{name}': {e}"))
}
fn encode(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

async fn dispatch(app: &AppHandle, command: &str, args: Value) -> Result<Value, String> {
    match command {
        "choose_directory" => {
            use tauri_plugin_dialog::DialogExt;
            let title: Option<String> = arg(&args, "title")?;
            let selected = app.dialog().file().set_title(title.as_deref().unwrap_or("Choose folder")).blocking_pick_folder();
            encode(selected.map(|p| p.to_string()))
        }
        "fetch_quotes_command" => encode(commands::stocks::fetch_quotes_command(arg(&args, "tickers")?).await?),
        "fetch_chart_command" => encode(commands::stocks::fetch_chart_command(arg(&args, "ticker")?, arg(&args, "range")?, arg(&args, "interval")?).await?),
        "fetch_price_on_date_command" => encode(commands::stocks::fetch_price_on_date_command(arg(&args, "ticker")?, arg(&args, "date")?).await?),
        "search_tickers_command" => encode(commands::stocks::search_tickers_command(arg(&args, "query")?).await?),
        "fetch_news_command" => encode(commands::stocks::fetch_news_command(arg(&args, "ticker")?, arg(&args, "count")?).await?),
        "fetch_upcoming_earnings_command" => encode(commands::stocks::fetch_upcoming_earnings_command(arg(&args, "tickers")?, arg(&args, "withinDays")?).await?),
        "fetch_comparison_stats_command" => encode(commands::stocks::fetch_comparison_stats_command(arg(&args, "tickers")?).await?),
        "fetch_dividend_info_command" => encode(commands::stocks::fetch_dividend_info_command(arg(&args, "ticker")?).await?),
        "open_browser_window" => encode(commands::browser::open_browser_window(app.clone(), arg(&args, "url")?, arg(&args, "Title")?).await?),
        "open_earnings_call_in_calendar" => encode(commands::browser::open_earnings_call_in_calendar(arg(&args, "ticker")?, arg(&args, "eventAt")?).await?),
        "open_dividend_in_calendar" => encode(commands::browser::open_dividend_in_calendar(arg(&args, "ticker")?, arg(&args, "dividendDate")?).await?),
        "fetch_ticker_logo" => encode(commands::logos::fetch_ticker_logo(app.clone(), arg(&args, "ticker")?).await?),
        "fetch_brand_logo" => encode(commands::logos::fetch_brand_logo(app.clone(), arg(&args, "domain")?).await?),
        "fetch_link_preview" => encode(commands::link_preview::fetch_link_preview(app.clone(), arg(&args, "url")?).await?),
        "db_list_portfolios" => encode(commands::db_portfolios::db_list_portfolios(app.state())?),
        "db_create_portfolio" => encode(commands::db_portfolios::db_create_portfolio(arg(&args, "name")?, app.state())?),
        "db_rename_portfolio" => encode(commands::db_portfolios::db_rename_portfolio(arg(&args, "id")?, arg(&args, "name")?, app.state())?),
        "db_delete_portfolio" => encode(commands::db_portfolios::db_delete_portfolio(arg(&args, "id")?, app.state())?),
        "db_star_portfolio" => encode(commands::db_portfolios::db_star_portfolio(arg(&args, "id")?, app.state())?),
        "db_reorder_portfolios" => encode(commands::db_portfolios::db_reorder_portfolios(arg(&args, "ids")?, app.state())?),
        "db_set_position_sort_mode" => encode(commands::db_portfolios::db_set_position_sort_mode(arg(&args, "portfolioId")?, arg(&args, "mode")?, app.state())?),
        "db_touch_portfolio_import" => encode(commands::db_portfolios::db_touch_portfolio_import(arg(&args, "portfolioId")?, app.state())?),
        "db_list_purchases" => encode(commands::db_purchases::db_list_purchases(arg(&args, "portfolioId")?, app.state())?),
        "db_add_purchase" => encode(commands::db_purchases::db_add_purchase(arg(&args, "portfolioId")?, arg(&args, "ticker")?, arg(&args, "shares")?, arg(&args, "pricePerShare")?, arg(&args, "purchasedAt")?, app.state())?),
        "db_update_purchase" => encode(commands::db_purchases::db_update_purchase(arg(&args, "id")?, arg(&args, "ticker")?, arg(&args, "shares")?, arg(&args, "pricePerShare")?, arg(&args, "purchasedAt")?, app.state())?),
        "db_delete_purchase" => encode(commands::db_purchases::db_delete_purchase(arg(&args, "id")?, app.state())?),
        "db_hint_stock_quote_type" => encode(commands::db_purchases::db_hint_stock_quote_type(arg(&args, "ticker")?, arg(&args, "quoteType")?, app.state())?),
        "db_clear_all_purchases" => encode(commands::db_purchases::db_clear_all_purchases(app.state())?),
        "db_clear_portfolio_purchases" => encode(commands::db_purchases::db_clear_portfolio_purchases(arg(&args, "portfolioId")?, app.state())?),
        "db_list_cash_events" => encode(commands::db_cash_events::db_list_cash_events(arg(&args, "portfolioId")?, app.state())?),
        "db_add_cash_event" => encode(commands::db_cash_events::db_add_cash_event(arg(&args, "portfolioId")?, arg(&args, "kind")?, arg(&args, "ticker")?, arg(&args, "amount")?, arg(&args, "occurredAt")?, arg(&args, "note")?, app.state())?),
        "db_update_cash_event" => encode(commands::db_cash_events::db_update_cash_event(arg(&args, "id")?, arg(&args, "kind")?, arg(&args, "ticker")?, arg(&args, "amount")?, arg(&args, "occurredAt")?, arg(&args, "note")?, app.state())?),
        "db_delete_cash_event" => encode(commands::db_cash_events::db_delete_cash_event(arg(&args, "id")?, app.state())?),
        "db_list_sales" => encode(commands::db_sales::db_list_sales(arg(&args, "portfolioId")?, app.state())?),
        "db_add_sale" => encode(commands::db_sales::db_add_sale(arg(&args, "portfolioId")?, arg(&args, "ticker")?, arg(&args, "shares")?, arg(&args, "pricePerShare")?, arg(&args, "soldAt")?, app.state())?),
        "db_update_sale" => encode(commands::db_sales::db_update_sale(arg(&args, "id")?, arg(&args, "ticker")?, arg(&args, "shares")?, arg(&args, "pricePerShare")?, arg(&args, "soldAt")?, app.state())?),
        "db_delete_sale" => encode(commands::db_sales::db_delete_sale(arg(&args, "id")?, app.state())?),
        "db_get_cash_anchor" => encode(commands::db_cash_anchor::db_get_cash_anchor(arg(&args, "portfolioId")?, app.state())?),
        "db_set_cash_anchor" => encode(commands::db_cash_anchor::db_set_cash_anchor(arg(&args, "portfolioId")?, arg(&args, "asOf")?, arg(&args, "balance")?, app.state())?),
        "db_clear_cash_anchor" => encode(commands::db_cash_anchor::db_clear_cash_anchor(arg(&args, "portfolioId")?, app.state())?),
        "db_list_journal_notes" => encode(commands::db_journal::db_list_journal_notes(arg(&args, "portfolioId")?, app.state())?),
        "db_set_journal_note" => encode(commands::db_journal::db_set_journal_note(arg(&args, "portfolioId")?, arg(&args, "tradeKey")?, arg(&args, "reflection")?, arg(&args, "lesson")?, arg(&args, "tags")?, app.state())?),
        "db_get_cached_stocks" => encode(commands::db_stocks::db_get_cached_stocks(app.state())?),
        "db_upsert_stock" => encode(commands::db_stocks::db_upsert_stock(arg(&args, "ticker")?, arg(&args, "name")?, arg(&args, "lastPrice")?, arg(&args, "quoteType")?, arg(&args, "dailyChangePct")?, arg(&args, "targetMeanPrice")?, arg(&args, "postMarketPrice")?, arg(&args, "postMarketChangePct")?, arg(&args, "preMarketPrice")?, arg(&args, "preMarketChangePct")?, arg(&args, "marketState")?, arg(&args, "dividendYield")?, app.state())?),
        "db_list_watchlists" => encode(commands::db_watchlists::db_list_watchlists(app.state())?),
        "db_create_watchlist" => encode(commands::db_watchlists::db_create_watchlist(arg(&args, "name")?, app.state())?),
        "db_rename_watchlist" => encode(commands::db_watchlists::db_rename_watchlist(arg(&args, "id")?, arg(&args, "name")?, app.state())?),
        "db_delete_watchlist" => encode(commands::db_watchlists::db_delete_watchlist(arg(&args, "id")?, app.state())?),
        "db_list_watchlist_items" => encode(commands::db_watchlists::db_list_watchlist_items(arg(&args, "watchlistId")?, app.state())?),
        "db_list_all_watchlist_items" => encode(commands::db_watchlists::db_list_all_watchlist_items(app.state())?),
        "db_add_to_watchlist" => encode(commands::db_watchlists::db_add_to_watchlist(arg(&args, "ticker")?, arg(&args, "watchlistId")?, arg(&args, "watchPrice")?, app.state())?),
        "db_remove_from_watchlist" => encode(commands::db_watchlists::db_remove_from_watchlist(arg(&args, "id")?, app.state())?),
        "db_set_watch_price" => encode(commands::db_watchlists::db_set_watch_price(arg(&args, "id")?, arg(&args, "watchPrice")?, app.state())?),
        "db_set_watchlist_added_at" => encode(commands::db_watchlists::db_set_watchlist_added_at(arg(&args, "id")?, arg(&args, "addedAt")?, arg(&args, "watchPrice")?, app.state())?),
        "db_set_watchlist_note" => encode(commands::db_watchlists::db_set_watchlist_note(arg(&args, "id")?, arg(&args, "notes")?, app.state())?),
        "db_set_watchlist_alert" => encode(commands::db_watchlists::db_set_watchlist_alert(arg(&args, "id")?, arg(&args, "targetPrice")?, arg(&args, "direction")?, app.state())?),
        "db_mark_alert_triggered" => encode(commands::db_watchlists::db_mark_alert_triggered(arg(&args, "id")?, arg(&args, "triggeredAt")?, app.state())?),
        "db_acknowledge_alert" => encode(commands::db_watchlists::db_acknowledge_alert(arg(&args, "id")?, app.state())?),
        "db_acknowledge_all_alerts" => encode(commands::db_watchlists::db_acknowledge_all_alerts(app.state())?),
        "db_list_favorites" => encode(commands::db_watchlists::db_list_favorites(arg(&args, "portfolioId")?, app.state())?),
        "db_add_favorite" => encode(commands::db_watchlists::db_add_favorite(arg(&args, "ticker")?, arg(&args, "portfolioId")?, app.state())?),
        "db_remove_favorite" => encode(commands::db_watchlists::db_remove_favorite(arg(&args, "ticker")?, arg(&args, "portfolioId")?, app.state())?),
        "db_reorder_favorites" => encode(commands::db_watchlists::db_reorder_favorites(arg(&args, "tickers")?, arg(&args, "portfolioId")?, app.state())?),
        "db_list_position_order" => encode(commands::db_watchlists::db_list_position_order(arg(&args, "portfolioId")?, app.state())?),
        "db_reorder_positions" => encode(commands::db_watchlists::db_reorder_positions(arg(&args, "tickers")?, arg(&args, "portfolioId")?, app.state())?),
        "get_config" => encode(commands::config::get_config(app.clone())?),
        "save_config" => encode(commands::config::save_config(app.clone(), arg(&args, "config")?)?),
        "add_sync_target" => encode(commands::config::add_sync_target(app.clone(), arg(&args, "target")?, arg(&args, "password")?).await?),
        "remove_sync_target" => encode(commands::config::remove_sync_target(app.clone(), arg(&args, "targetId")?)?),
        "set_auto_sync_minutes" => encode(commands::config::set_auto_sync_minutes(app.clone(), arg(&args, "minutes")?)?),
        "move_database" => encode(commands::config::move_database(app.clone(), arg(&args, "newDir")?, app.state())?),
        "cancel_sync_review" => encode(commands::sync::cancel_sync_review(arg(&args, "confirmationId")?)?),
        "confirm_sync" => encode(commands::sync::confirm_sync(arg(&args, "confirmationId")?, arg(&args, "direction")?, arg(&args, "allowEmptyUpload")?, app.clone(), app.state()).await?),
        "list_sync_backups" => encode(commands::sync::list_sync_backups(app.clone())?),
        "prepare_restore_backup" => encode(commands::sync::prepare_restore_backup(arg(&args, "backupId")?, app.clone(), app.state()).await?),
        "sync_now" => encode(commands::sync::sync_now(arg(&args, "targetId")?, app.clone(), app.state()).await?),
        "test_sync_connection" => encode(commands::sync::test_sync_connection(arg(&args, "target")?).await?),
        "save_sync_password" => encode(commands::sync::save_sync_password(app.clone(), arg(&args, "targetId")?, arg(&args, "password")?)?),
        "delete_sync_password" => encode(commands::sync::delete_sync_password(app.clone(), arg(&args, "targetId")?)?),
        "has_sync_password" => encode(commands::sync::has_sync_password(app.clone(), arg(&args, "targetId")?)),
        "check_remote_db_exists" => encode(commands::sync::check_remote_db_exists(arg(&args, "targetId")?, app.clone()).await?),
        "import_remote_db" => encode(commands::sync::import_remote_db(arg(&args, "targetId")?, app.clone(), app.state()).await?),
        "broker_list_providers" => encode(commands::brokers::broker_list_providers()),
        "broker_test_connection" => encode(commands::brokers::broker_test_connection(arg(&args, "provider")?, arg(&args, "environment")?, arg(&args, "credentials")?).await?),
        "broker_save_connection" => encode(commands::brokers::broker_save_connection(app.clone(), arg(&args, "provider")?, arg(&args, "environment")?, arg(&args, "label")?, arg(&args, "credentials")?, app.state()).await?),
        "broker_add_credentials" => encode(commands::brokers::broker_add_credentials(app.clone(), arg(&args, "id")?, arg(&args, "credentials")?, app.state()).await?),
        "broker_list_connections" => encode(commands::brokers::broker_list_connections(app.clone(), app.state())?),
        "broker_set_account_visible" => encode(commands::brokers::broker_set_account_visible(arg(&args, "brokerAccountId")?, arg(&args, "visible")?, app.state())?),
        "broker_list_positions" => encode(commands::brokers::broker_list_positions(arg(&args, "brokerAccountId")?, app.state())?),
        "broker_list_transactions" => encode(commands::brokers::broker_list_transactions(arg(&args, "brokerAccountId")?, app.state())?),
        "broker_list_orders" => encode(commands::brokers::broker_list_orders(app.clone(), arg(&args, "brokerAccountId")?, app.state()).await?),
        "broker_update_connection" => encode(commands::brokers::broker_update_connection(arg(&args, "id")?, arg(&args, "label")?, arg(&args, "disabled")?, arg(&args, "autoSyncMinutes")?, app.state())?),
        "broker_delete_connection" => encode(commands::brokers::broker_delete_connection(app.clone(), arg(&args, "id")?, arg(&args, "keepPortfolio")?, app.state())?),
        "broker_sync_connection" => encode(commands::brokers::broker_sync_connection(app.clone(), arg(&args, "connectionId")?, app.state()).await?),
        "broker_sync_all" => encode(commands::brokers::broker_sync_all(app.clone(), app.state()).await?),
        "snaptrade_save_app_keys" => encode(commands::snaptrade::snaptrade_save_app_keys(app.clone(), arg(&args, "clientId")?, arg(&args, "consumerKey")?)?),
        "snaptrade_app_keys_configured" => encode(commands::snaptrade::snaptrade_app_keys_configured(app.clone())),
        "snaptrade_connect" => encode(commands::snaptrade::snaptrade_connect(app.clone()).await?),
        "snaptrade_sync_authorizations" => encode(commands::snaptrade::snaptrade_sync_authorizations(app.clone(), app.state()).await?),
        _ => Err(format!("Unknown Stockfolio command: {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_other_websites_and_missing_client_header() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "localhost:1420".parse().unwrap());
        headers.insert("origin", "http://localhost:1420".parse().unwrap());
        assert!(!allowed_request(&headers, 1422));
        headers.insert("x-stockfolio-client", "browser".parse().unwrap());
        assert!(allowed_request(&headers, 1422));
        headers.insert("origin", "https://example.com".parse().unwrap());
        assert!(!allowed_request(&headers, 1422));
        headers.insert("origin", "http://localhost:9999".parse().unwrap());
        assert!(!allowed_request(&headers, 1422));
    }
}
