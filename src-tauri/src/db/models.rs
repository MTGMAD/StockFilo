// Database row shapes — kept here for reference.
// Actual SQL queries are executed from the frontend via tauri-plugin-sql.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Stock {
    pub ticker: String,
    pub name: Option<String>,
    pub last_price: Option<f64>,
    pub last_fetched_at: Option<i64>,
    pub quote_type: Option<String>,
    pub daily_change_pct: Option<f64>,
    pub target_mean_price: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Purchase {
    pub id: i64,
    pub ticker: String,
    pub shares: f64,
    pub price_per_share: f64,
    pub purchased_at: String,
    pub created_at: i64,
}
