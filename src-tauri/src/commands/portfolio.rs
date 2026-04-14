use crate::db::models::{NewPurchase, Purchase, UpdatePurchase};
use chrono::Utc;
use tauri_plugin_sql::{DbPool, Migration, MigrationKind};

#[tauri::command]
pub async fn list_purchases(
    db: tauri::State<'_, DbPool>,
) -> Result<Vec<Purchase>, String> {
    let pool = db.get("sqlite:stockfilo.db").await.map_err(|e| e.to_string())?;
    let rows = sqlx::query_as!(
        Purchase,
        r#"SELECT id, ticker, shares, price_per_share, purchased_at, created_at FROM purchases ORDER BY purchased_at DESC, created_at DESC"#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn add_purchase(
    db: tauri::State<'_, DbPool>,
    purchase: NewPurchase,
) -> Result<i64, String> {
    let pool = db.get("sqlite:stockfilo.db").await.map_err(|e| e.to_string())?;
    let now = Utc::now().timestamp();
    let ticker = purchase.ticker.to_uppercase();

    let result = sqlx::query!(
        r#"INSERT INTO purchases (ticker, shares, price_per_share, purchased_at, created_at) VALUES (?, ?, ?, ?, ?)"#,
        ticker,
        purchase.shares,
        purchase.price_per_share,
        purchase.purchased_at,
        now
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    // Ensure a stocks row exists for this ticker
    sqlx::query!(
        r#"INSERT OR IGNORE INTO stocks (ticker) VALUES (?)"#,
        ticker
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(result.last_insert_rowid())
}

#[tauri::command]
pub async fn update_purchase(
    db: tauri::State<'_, DbPool>,
    purchase: UpdatePurchase,
) -> Result<(), String> {
    let pool = db.get("sqlite:stockfilo.db").await.map_err(|e| e.to_string())?;
    let ticker = purchase.ticker.to_uppercase();
    sqlx::query!(
        r#"UPDATE purchases SET ticker = ?, shares = ?, price_per_share = ?, purchased_at = ? WHERE id = ?"#,
        ticker,
        purchase.shares,
        purchase.price_per_share,
        purchase.purchased_at,
        purchase.id
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_purchase(
    db: tauri::State<'_, DbPool>,
    id: i64,
) -> Result<(), String> {
    let pool = db.get("sqlite:stockfilo.db").await.map_err(|e| e.to_string())?;
    sqlx::query!(r#"DELETE FROM purchases WHERE id = ?"#, id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
