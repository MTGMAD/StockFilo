import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile, writeFile, readFile } from "@tauri-apps/plugin-fs";
import * as XLSX from "xlsx";
import type {
  Purchase,
  Stock,
  QuoteResult,
  WatchlistItem,
  TickerSearchResult,
  NewsArticle,
  Favorite,
  UpcomingEarningsEvent,
  Portfolio,
} from "../types";

const DB_URL = "sqlite:stockfolio.db";

let _db: Awaited<ReturnType<typeof Database.load>> | null = null;

async function getDb() {
  if (!_db) {
    _db = await Database.load(DB_URL);
  }
  return _db;
}

// ── Portfolios ─────────────────────────────────────────────────────────────

export async function listPortfolios(): Promise<Portfolio[]> {
  const db = await getDb();
  return db.select<Portfolio[]>(
    "SELECT id, name, sort_order, is_starred, created_at FROM portfolios ORDER BY sort_order ASC, created_at ASC"
  );
}

export async function createPortfolio(name: string): Promise<number> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.select<{ max_order: number | null }[]>(
    "SELECT MAX(sort_order) as max_order FROM portfolios"
  );
  const nextOrder = (rows[0]?.max_order ?? -1) + 1;
  await db.execute(
    "INSERT INTO portfolios (name, sort_order, is_starred, created_at) VALUES (?, ?, 0, ?)",
    [name, nextOrder, now]
  );
  const result = await db.select<{ id: number }[]>("SELECT last_insert_rowid() as id");
  return result[0].id;
}

export async function renamePortfolio(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE portfolios SET name = ? WHERE id = ?", [name, id]);
}

export async function deletePortfolio(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM purchases WHERE portfolio_id = ?", [id]);
  await db.execute("DELETE FROM favorites WHERE portfolio_id = ?", [id]);
  await db.execute("DELETE FROM portfolios WHERE id = ?", [id]);
  // Clean up orphaned stocks not referenced anywhere
  await db.execute(
    "DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM purchases) AND ticker NOT IN (SELECT ticker FROM watchlist)",
    []
  );
}

export async function starPortfolio(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE portfolios SET is_starred = 0", []);
  await db.execute("UPDATE portfolios SET is_starred = 1 WHERE id = ?", [id]);
}

export async function reorderPortfolios(ids: number[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < ids.length; i++) {
    await db.execute("UPDATE portfolios SET sort_order = ? WHERE id = ?", [i, ids[i]]);
  }
}

// ── Purchases ──────────────────────────────────────────────────────────────

export async function listPurchases(portfolioId: number): Promise<Purchase[]> {
  const db = await getDb();
  return db.select<Purchase[]>(
    "SELECT id, ticker, shares, price_per_share, purchased_at, created_at, portfolio_id FROM purchases WHERE portfolio_id = ? ORDER BY purchased_at DESC, created_at DESC",
    [portfolioId]
  );
}

export async function addPurchase(
  portfolioId: number,
  ticker: string,
  shares: number,
  pricePerShare: number,
  purchasedAt: string
): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const t = ticker.toUpperCase();
  await db.execute(
    "INSERT INTO purchases (portfolio_id, ticker, shares, price_per_share, purchased_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [portfolioId, t, shares, pricePerShare, purchasedAt, now]
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

export async function hintStockQuoteType(ticker: string, quoteType: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE stocks SET quote_type = ? WHERE ticker = ? AND quote_type IS NULL",
    [quoteType, ticker]
  );
}

export async function clearAllPurchases(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM purchases", []);
  await db.execute("DELETE FROM favorites", []);
  await db.execute("DELETE FROM stocks WHERE ticker NOT IN (SELECT ticker FROM watchlist)", []);
}

// ── Stocks / Prices ────────────────────────────────────────────────────────

export async function getCachedStocks(): Promise<Stock[]> {
  const db = await getDb();
  return db.select<Stock[]>(
    "SELECT ticker, name, last_price, last_fetched_at, quote_type, daily_change_pct, target_mean_price FROM stocks ORDER BY ticker ASC"
  );
}

export async function upsertStock(
  ticker: string,
  name: string | null,
  price: number | null,
  quoteType: string | null = null,
  dailyChangePct: number | null = null,
  targetMeanPrice: number | null = null
): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO stocks (ticker, name, last_price, last_fetched_at, quote_type, daily_change_pct, target_mean_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET
       name = excluded.name,
       last_price = excluded.last_price,
       last_fetched_at = excluded.last_fetched_at,
       quote_type = COALESCE(excluded.quote_type, stocks.quote_type),
       daily_change_pct = excluded.daily_change_pct,
       target_mean_price = excluded.target_mean_price`,
    [ticker, name, price, now, quoteType, dailyChangePct, targetMeanPrice]
  );
}

export async function fetchAndCachePrices(tickers: string[]): Promise<QuoteResult[]> {
  if (tickers.length === 0) return [];
  const results = await invoke<QuoteResult[]>("fetch_quotes_command", { tickers });
  for (const r of results) {
    await upsertStock(r.ticker, r.name, r.price, r.quote_type, r.daily_change_pct, r.target_mean_price);
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

export async function setWatchlistWatchPrice(id: number, watchPrice: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE watchlist SET watch_price = ? WHERE id = ? AND (watch_price IS NULL OR watch_price <= 0)",
    [watchPrice, id]
  );
}

// ── Favorites ─────────────────────────────────────────────────────────────

export async function listFavorites(portfolioId: number): Promise<Favorite[]> {
  const db = await getDb();
  return db.select<Favorite[]>(
    "SELECT id, ticker, sort_order, portfolio_id FROM favorites WHERE portfolio_id = ? ORDER BY sort_order ASC",
    [portfolioId]
  );
}

export async function addFavorite(ticker: string, portfolioId: number): Promise<void> {
  const db = await getDb();
  const t = ticker.toUpperCase();
  const rows = await db.select<{ max_order: number | null }[]>(
    "SELECT MAX(sort_order) as max_order FROM favorites WHERE portfolio_id = ?",
    [portfolioId]
  );
  const nextOrder = (rows[0]?.max_order ?? -1) + 1;
  await db.execute(
    "INSERT OR IGNORE INTO favorites (ticker, sort_order, portfolio_id) VALUES (?, ?, ?)",
    [t, nextOrder, portfolioId]
  );
}

export async function removeFavorite(ticker: string, portfolioId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM favorites WHERE ticker = ? AND portfolio_id = ?",
    [ticker.toUpperCase(), portfolioId]
  );
}

export async function reorderFavorites(tickers: string[], portfolioId: number): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < tickers.length; i++) {
    await db.execute(
      "UPDATE favorites SET sort_order = ? WHERE ticker = ? AND portfolio_id = ?",
      [i, tickers[i].toUpperCase(), portfolioId]
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

export async function fetchUpcomingEarnings(
  tickers: string[],
  withinDays = 30
): Promise<UpcomingEarningsEvent[]> {
  if (tickers.length === 0) return [];
  const upper = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  return invoke<UpcomingEarningsEvent[]>("fetch_upcoming_earnings_command", {
    tickers: upper,
    withinDays,
  });
}

export async function addEarningsCallToCalendar(ticker: string, eventAt: number): Promise<void> {
  await invoke("open_earnings_call_in_calendar", {
    ticker: ticker.toUpperCase(),
    eventAt,
  });
}

// ── CSV Export / Import ───────────────────────────────────────────────────

function escCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportPurchasesCsv(portfolioId: number): Promise<boolean> {
  const purchases = await listPurchases(portfolioId);
  const header = "ticker,shares,price_per_share,purchased_at";
  const rows = purchases.map(
    (p) => `${escCsv(p.ticker)},${p.shares},${p.price_per_share},${escCsv(p.purchased_at)}`
  );
  const csv = [header, ...rows].join("\n");

  const path = await save({
    title: "Export Purchases",
      defaultPath: "stockfolio-purchases.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;

  await writeTextFile(path, csv);
  return true;
}

export async function importPurchasesCsv(portfolioId: number): Promise<number> {
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

    await addPurchase(portfolioId, ticker, shares, price, date);
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

// ── XLSX Export / Import ──────────────────────────────────────────────────

export async function exportPurchasesXlsx(portfolioId: number): Promise<boolean> {
  const purchases = await listPurchases(portfolioId);

  const wsData = [
    ["ticker", "shares", "price_per_share", "purchased_at"],
    ...purchases.map((p) => [p.ticker, p.shares, p.price_per_share, p.purchased_at]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Purchases");

  const path = await save({
    title: "Export Purchases",
    defaultPath: "stockfolio-purchases.xlsx",
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
  });
  if (!path) return false;

  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  await writeFile(path, new Uint8Array(buf));
  return true;
}

export async function importPurchasesXlsx(portfolioId: number): Promise<number> {
  const path = await openDialog({
    title: "Import Purchases",
    multiple: false,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx", "xls"] }],
  });
  if (!path) return 0;

  const data = await readFile(path as string);
  const wb = XLSX.read(data, { type: "array" });

  const wsName = wb.SheetNames[0];
  if (!wsName) return 0;

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1 });
  if (rows.length === 0) return 0;

  // Detect and skip header row
  const firstRow = rows[0] as unknown[];
  const startIdx = firstRow.some((c) => String(c).toLowerCase() === "ticker") ? 1 : 0;

  let imported = 0;
  for (let i = startIdx; i < rows.length; i++) {
    const cols = rows[i] as unknown[];
    if (cols.length < 4) continue;

    const ticker = String(cols[0] ?? "").trim().toUpperCase();
    const shares = Number(cols[1]);
    const price = Number(cols[2]);
    const rawDate = cols[3];

    // SheetJS may give a numeric serial date — convert if needed
    let date: string;
    if (typeof rawDate === "number") {
      const d = XLSX.SSF.parse_date_code(rawDate);
      date = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    } else {
      date = String(rawDate ?? "").trim();
    }

    if (!ticker || isNaN(shares) || isNaN(price) || !date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    await addPurchase(portfolioId, ticker, shares, price, date);
    imported++;
  }

  return imported;
}

// ── Ameriprise CSV Import ─────────────────────────────────────────────────
// Handles the "Account Activity" CSV exported from Ameriprise SPS accounts.
// Imports BUY transactions and dividend/capital-gain reinvestments (all of
// which represent real share acquisitions).

export async function importAmeripriseCSV(portfolioId: number): Promise<number> {
  const path = await openDialog({
    title: "Import from Ameriprise",
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return 0;

  const csv = await readTextFile(path as string);
  const lines = csv.split(/\r?\n/);

  // Locate the actual data header row (contains "Transaction Date")
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes("transaction date")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find a header row containing \"Transaction Date\". " +
      "Make sure this is an Ameriprise account activity CSV."
    );
  }

  let imported = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line);
    if (cols.length < 7) continue;

    // Columns: 0=Transaction Date, 1=Account, 2=Description, 3=Amount,
    //          4=Quantity, 5=Price, 6=Symbol
    const rawDate     = cols[0].trim();   // MM/DD/YYYY
    const description = cols[2].trim();
    const rawAmount   = cols[3].trim();
    const rawQty      = cols[4].trim();
    const rawPrice    = cols[5].trim();
    const symbol      = cols[6].trim().toUpperCase();

    // Skip rows with no usable symbol (money market, fees, blank, etc.)
    if (!symbol || symbol === "9999840") continue;

    const isBuy      = /^BUY\s+-\s+/i.test(description);
    const isReinvest = /REINVEST AT ([\d.]+)/i.test(description);

    if (!isBuy && !isReinvest) continue;

    // Quantity — strip thousands separators
    const shares = parseFloat(rawQty.replace(/,/g, ""));
    if (isNaN(shares) || shares <= 0) continue;

    // Price — derived from Amount/Quantity for BUY rows (handles bonds where the
    // price column is per-$100-face-value, which would otherwise cause a 100x
    // overstatement); extracted from description for reinvests.
    let price: number;
    if (isBuy) {
      const amount = parseFloat(rawAmount.replace(/[$,()\-]/g, ""));
      if (!isNaN(amount) && amount > 0 && shares > 0) {
        price = amount / shares;
      } else {
        price = parseFloat(rawPrice.replace(/[$,]/g, ""));
      }
      if (isNaN(price) || price <= 0) continue;
    } else {
      const m = description.match(/REINVEST AT ([\d.]+)/i);
      if (!m) continue;
      price = parseFloat(m[1]);
      if (isNaN(price) || price <= 0) continue;
    }

    // Convert MM/DD/YYYY → YYYY-MM-DD
    const dateParts = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dateParts) continue;
    const date = `${dateParts[3]}-${dateParts[1]}-${dateParts[2]}`;

    await addPurchase(portfolioId, symbol, shares, price, date);

    // Dividend reinvestments are always mutual funds — hint the type so the
    // ticker appears in the right sidebar section even before Yahoo fetches it.
    if (isReinvest) {
      await hintStockQuoteType(symbol, "MUTUALFUND");
    }

    imported++;
  }

  if (imported === 0) {
    throw new Error(
      "No importable transactions found. Expected BUY or DIVIDEND REINVEST rows with a ticker symbol."
    );
  }

  return imported;
}
