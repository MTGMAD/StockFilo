import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { Purchase, Stock, QuoteResult } from "../types";

const DB_URL = "sqlite:stockfilo.db";

let _db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!_db) {
    _db = await Database.load(DB_URL);
  }
  return _db;
}

// ── Purchases ──────────────────────────────────────────────────────────────

export async function listPurchases(): Promise<Purchase[]> {
  const db = await getDb();
  return db.select<Purchase[]>(
    "SELECT id, ticker, shares, price_per_share, purchased_at, created_at FROM purchases ORDER BY purchased_at DESC, created_at DESC"
  );
}

export async function addPurchase(
  ticker: string,
  shares: number,
  pricePerShare: number,
  purchasedAt: string
): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const t = ticker.toUpperCase();
  await db.execute(
    "INSERT INTO purchases (ticker, shares, price_per_share, purchased_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [t, shares, pricePerShare, purchasedAt, now]
  );
  await db.execute("INSERT OR IGNORE INTO stocks (ticker) VALUES (?)", [t]);
}

export async function updatePurchase(
  id: number,
  ticker: string,
  shares: number,
  pricePerShare: number,
  purchasedAt: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE purchases SET ticker = ?, shares = ?, price_per_share = ?, purchased_at = ? WHERE id = ?",
    [ticker.toUpperCase(), shares, pricePerShare, purchasedAt, id]
  );
}

export async function deletePurchase(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM purchases WHERE id = ?", [id]);
}

// ── Stocks / Prices ────────────────────────────────────────────────────────

export async function getCachedStocks(): Promise<Stock[]> {
  const db = await getDb();
  return db.select<Stock[]>(
    "SELECT ticker, name, last_price, last_fetched_at FROM stocks ORDER BY ticker ASC"
  );
}

export async function upsertStock(
  ticker: string,
  name: string | null,
  price: number | null
): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO stocks (ticker, name, last_price, last_fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       name = excluded.name,
       last_price = excluded.last_price,
       last_fetched_at = excluded.last_fetched_at`,
    [ticker, name, price, now]
  );
}

export async function fetchAndCachePrices(tickers: string[]): Promise<QuoteResult[]> {
  if (tickers.length === 0) return [];
  const results = await invoke<QuoteResult[]>("fetch_quotes_command", { tickers });
  for (const r of results) {
    await upsertStock(r.ticker, r.name, r.price);
  }
  return results;
}
