use tauri::Manager;

mod commands;
mod db;
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
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::stocks::fetch_quotes_command,
            commands::stocks::fetch_chart_command,
            commands::stocks::search_tickers_command,
            commands::stocks::fetch_news_command,
            commands::stocks::fetch_upcoming_earnings_command,
            commands::browser::open_browser_window,
            commands::browser::open_earnings_call_in_calendar,
        ])
        .setup(|app| {
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
