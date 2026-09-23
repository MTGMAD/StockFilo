use tauri::Manager;

mod brokers;
mod commands;
mod db;
mod secrets;
mod yahoo;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:stockfolio.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "create_initial_tables",
                            sql: db::migrations::MIGRATION_V1,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "create_watchlist_table",
                            sql: db::migrations::MIGRATION_V2,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "create_favorites_table",
                            sql: db::migrations::MIGRATION_V3,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "add_quote_type_to_stocks",
                            sql: db::migrations::MIGRATION_V4,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "add_daily_change_pct_to_stocks",
                            sql: db::migrations::MIGRATION_V5,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 6,
                            description: "add_watch_price_to_watchlist",
                            sql: db::migrations::MIGRATION_V6,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 7,
                            description: "add_target_mean_price_to_stocks",
                            sql: db::migrations::MIGRATION_V7,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 8,
                            description: "add_portfolios_and_portfolio_id",
                            sql: db::migrations::MIGRATION_V8,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 9,
                            description: "add_watchlists_table",
                            sql: db::migrations::MIGRATION_V9,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 10,
                            description: "add_extended_hours_to_stocks",
                            sql: db::migrations::MIGRATION_V10,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 11,
                            description: "fix_watchlist_unique_constraint",
                            sql: db::migrations::MIGRATION_V11,
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // ── Existing market-data / browser commands ────────────────────
            commands::stocks::fetch_quotes_command,
            commands::stocks::fetch_chart_command,
            commands::stocks::search_tickers_command,
            commands::stocks::fetch_news_command,
            commands::stocks::fetch_upcoming_earnings_command,
            commands::stocks::fetch_comparison_stats_command,
            commands::stocks::fetch_dividend_info_command,
            commands::browser::open_browser_window,
            commands::browser::open_earnings_call_in_calendar,
            commands::browser::open_dividend_in_calendar,
            commands::logos::fetch_ticker_logo,
            commands::logos::fetch_brand_logo,
            commands::link_preview::fetch_link_preview,
            // ── Portfolio DB commands ──────────────────────────────────────
            commands::db_portfolios::db_list_portfolios,
            commands::db_portfolios::db_create_portfolio,
            commands::db_portfolios::db_rename_portfolio,
            commands::db_portfolios::db_delete_portfolio,
            commands::db_portfolios::db_star_portfolio,
            commands::db_portfolios::db_reorder_portfolios,
            commands::db_portfolios::db_touch_portfolio_import,
            // ── Purchases DB commands ──────────────────────────────────────
            commands::db_purchases::db_list_purchases,
            commands::db_purchases::db_add_purchase,
            commands::db_purchases::db_update_purchase,
            commands::db_purchases::db_delete_purchase,
            commands::db_purchases::db_hint_stock_quote_type,
            commands::db_purchases::db_clear_all_purchases,
            commands::db_purchases::db_clear_portfolio_purchases,
            // ── Cash events DB commands ────────────────────────────────────
            commands::db_cash_events::db_list_cash_events,
            commands::db_cash_events::db_add_cash_event,
            commands::db_cash_events::db_update_cash_event,
            commands::db_cash_events::db_delete_cash_event,
            // ── Sales DB commands ──────────────────────────────────────────
            commands::db_sales::db_list_sales,
            commands::db_sales::db_add_sale,
            commands::db_sales::db_update_sale,
            commands::db_sales::db_delete_sale,
            // ── Stocks DB commands ─────────────────────────────────────────
            commands::db_stocks::db_get_cached_stocks,
            commands::db_stocks::db_upsert_stock,
            // ── Watchlist DB commands ──────────────────────────────────────
            commands::db_watchlists::db_list_watchlists,
            commands::db_watchlists::db_create_watchlist,
            commands::db_watchlists::db_rename_watchlist,
            commands::db_watchlists::db_delete_watchlist,
            commands::db_watchlists::db_list_watchlist_items,
            commands::db_watchlists::db_list_all_watchlist_items,
            commands::db_watchlists::db_add_to_watchlist,
            commands::db_watchlists::db_remove_from_watchlist,
            commands::db_watchlists::db_set_watch_price,
            commands::db_watchlists::db_set_watchlist_note,
            commands::db_watchlists::db_list_favorites,
            commands::db_watchlists::db_add_favorite,
            commands::db_watchlists::db_remove_favorite,
            commands::db_watchlists::db_reorder_favorites,
            // ── Config / Sync commands ─────────────────────────────────────
            commands::config::get_config,
            commands::config::save_config,
            commands::config::move_database,
            commands::sync::sync_now,
            commands::sync::test_sync_connection,
            commands::sync::save_sync_password,
            commands::sync::delete_sync_password,
            commands::sync::has_sync_password,
            commands::sync::check_remote_db_exists,
            commands::sync::import_remote_db,
            // ── Brokerage commands ─────────────────────────────────────────
            commands::brokers::broker_list_providers,
            commands::brokers::broker_test_connection,
            commands::brokers::broker_save_connection,
            commands::brokers::broker_add_credentials,
            commands::brokers::broker_list_connections,
            commands::brokers::broker_set_account_visible,
            commands::brokers::broker_list_positions,
            commands::brokers::broker_list_transactions,
            commands::brokers::broker_update_connection,
            commands::brokers::broker_delete_connection,
            commands::brokers::broker_sync_connection,
            commands::brokers::broker_sync_all,
            // ── SnapTrade commands ─────────────────────────────────────────
            commands::snaptrade::snaptrade_save_app_keys,
            commands::snaptrade::snaptrade_app_keys_configured,
            commands::snaptrade::snaptrade_connect,
            commands::snaptrade::snaptrade_sync_authorizations,
        ])
        .setup(|app| {
            // Load config and resolve DB path
            let cfg = commands::config::load_config(app.handle());
            let db_path = commands::config::resolve_db_path(app.handle(), &cfg)
                .expect("Failed to resolve database path");

            // Open rusqlite connection (runs V12 migration)
            let db_manager = db::manager::DbManager::open(&db_path)
                .expect("Failed to open database");
            app.manage(db_manager);

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
