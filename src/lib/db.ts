import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import type { Purchase, Stock, QuoteResult, WatchlistItem, TickerSearchResult, NewsArticle, Favorite } from "../types";

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

export async function clearAllPurchases(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM purchases", []);
  await db.execute("DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM watchlist)", []);
}

// ── Stocks / Prices ────────────────────────────────────────────────────────

export async function getCachedStocks(): Promise<Stock[]> {
  const db = await getDb();
  return db.select<Stock[]>(
    "SELECT ticker, name, last_price, last_fetched_at, quote_type, daily_change_pct FROM stocks ORDER BY ticker ASC"
  );
}

export async function upsertStock(
  ticker: string,
  name: string | null,
  price: number | null,
  quoteType: string | null = null,
  dailyChangePct: number | null = null
): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO stocks (ticker, name, last_price, last_fetched_at, quote_type, daily_change_pct)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       name = excluded.name,
       last_price = excluded.last_price,
       last_fetched_at = excluded.last_fetched_at,
       quote_type = COALESCE(excluded.quote_type, stocks.quote_type),
       daily_change_pct = excluded.daily_change_pct`,
    [ticker, name, price, now, quoteType, dailyChangePct]
  );
}

export async function fetchAndCachePrices(tickers: string[]): Promise<QuoteResult[]> {
  if (tickers.length === 0) return [];
  const results = await invoke<QuoteResult[]>("fetch_quotes_command", { tickers });
  for (const r of results) {
    await upsertStock(r.ticker, r.name, r.price, r.quote_type, r.daily_change_pct);
  }
  return results;
}

// ── Watchlist ──────────────────────────────────────────────────────────────

export async function listWatchlist(): Promise<WatchlistItem[]> {
  const db = await getDb();
  return db.select<WatchlistItem[]>(
    "SELECT id, ticker, watch_price, created_at FROM watchlist ORDER BY created_at DESC"
  );
}

export async function addToWatchlist(ticker: string, watchPrice: number | null = null): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const t = ticker.toUpperCase();
  await db.execute(
    "INSERT OR IGNORE INTO watchlist (ticker, watch_price, created_at) VALUES (?, ?, ?)",
    [t, watchPrice, now]
  );
  await db.execute("INSERT OR IGNORE INTO stocks (ticker) VALUES (?)", [t]);
}

export async function removeFromWatchlist(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM watchlist WHERE id = ?", [id]);
}

// ── Favorites ─────────────────────────────────────────────────────────────

export async function listFavorites(): Promise<Favorite[]> {
  const db = await getDb();
  return db.select<Favorite[]>(
    "SELECT id, ticker, sort_order FROM favorites ORDER BY sort_order ASC"
  );
}

export async function addFavorite(ticker: string): Promise<void> {
  const db = await getDb();
  const t = ticker.toUpperCase();
  // Put new favorite at the end (max sort_order + 1)
  const rows = await db.select<{ max_order: number | null }[]>(
    "SELECT MAX(sort_order) as max_order FROM favorites"
  );
  const nextOrder = (rows[0]?.max_order ?? -1) + 1;
  await db.execute(
    "INSERT OR IGNORE INTO favorites (ticker, sort_order) VALUES (?, ?)",
    [t, nextOrder]
  );
}

export async function removeFavorite(ticker: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM favorites WHERE ticker = ?", [ticker.toUpperCase()]);
}

export async function reorderFavorites(tickers: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < tickers.length; i++) {
    await db.execute(
      "UPDATE favorites SET sort_order = ? WHERE ticker = ?",
      [i, tickers[i].toUpperCase()]
    );
  }
}

// ── Ticker Search ─────────────────────────────────────────────────────────

export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  return invoke<TickerSearchResult[]>("search_tickers_command", { query });
}

// ── News ──────────────────────────────────────────────────────────────────

export async function fetchNews(ticker: string, count = 10): Promise<NewsArticle[]> {
  return invoke<NewsArticle[]>("fetch_news_command", { ticker: ticker.toUpperCase(), count });
}

// ── CSV Export / Import ───────────────────────────────────────────────────

function escCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportPurchasesCsv(): Promise<boolean> {
  const purchases = await listPurchases();
  const header = "ticker,shares,price_per_share,purchased_at";
  const rows = purchases.map(
    (p) => `${escCsv(p.ticker)},${p.shares},${p.price_per_share},${escCsv(p.purchased_at)}`
  );
  const csv = [header, ...rows].join("\n");

  const path = await save({
    title: "Export Purchases",
    defaultPath: "stockfilo-purchases.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;

  await writeTextFile(path, csv);
  return true;
}

export async function importPurchasesCsv(): Promise<number> {
  const path = await openDialog({
    title: "Import Purchases",
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return 0;

  const csv = await readTextFile(path as string);
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;

  // Detect and skip header row
  const firstLine = lines[0].toLowerCase();
  const startIdx = firstLine.includes("ticker") ? 1 : 0;

  let imported = 0;
  const dataLines = lines.length - startIdx;
  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 4) continue;

    const ticker = cols[0].trim().toUpperCase();
    const shares = parseFloat(cols[1]);
    const price = parseFloat(cols[2]);
    const date = cols[3].trim();

    if (!ticker || isNaN(shares) || isNaN(price) || !date) continue;
    // Basic date format validation (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    await addPurchase(ticker, shares, price, date);
    imported++;
  }

  if (imported === 0 && dataLines > 0) {
    throw new Error(
      `No rows could be imported. Expected format: ticker,shares,price_per_share,purchased_at (YYYY-MM-DD). ` +
      `Found ${dataLines} data row${dataLines === 1 ? "" : "s"} but none matched the required format.`
    );
  }

  return imported;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
