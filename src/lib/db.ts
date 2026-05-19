/**
 * db.ts — All database operations.
 *
 * SQL is now executed in Rust via invoke().  This file keeps the same
 * exported function signatures so the rest of the frontend is unchanged.
 */
import { invoke } from "@tauri-apps/api/core";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  writeTextFile,
  readTextFile,
  writeFile,
  readFile,
} from "@tauri-apps/plugin-fs";
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
  Watchlist,
  DividendInfo,
} from "../types";

// ── Portfolios ─────────────────────────────────────────────────────────────

export async function listPortfolios(): Promise<Portfolio[]> {
  return invoke<Portfolio[]>("db_list_portfolios");
}

export async function createPortfolio(name: string): Promise<number> {
  return invoke<number>("db_create_portfolio", { name });
}

export async function renamePortfolio(id: number, name: string): Promise<void> {
  return invoke("db_rename_portfolio", { id, name });
}

export async function deletePortfolio(id: number): Promise<void> {
  return invoke("db_delete_portfolio", { id });
}

export async function starPortfolio(id: number): Promise<void> {
  return invoke("db_star_portfolio", { id });
}

export async function reorderPortfolios(ids: number[]): Promise<void> {
  return invoke("db_reorder_portfolios", { ids });
}

// ── Purchases ──────────────────────────────────────────────────────────────

export async function listPurchases(portfolioId: number): Promise<Purchase[]> {
  return invoke<Purchase[]>("db_list_purchases", { portfolioId });
}

export async function addPurchase(
  portfolioId: number,
  ticker: string,
  shares: number,
  pricePerShare: number,
  purchasedAt: string,
): Promise<void> {
  return invoke("db_add_purchase", {
    portfolioId,
    ticker,
    shares,
    pricePerShare,
    purchasedAt,
  });
}

export async function updatePurchase(
  id: number,
  ticker: string,
  shares: number,
  pricePerShare: number,
  purchasedAt: string,
): Promise<void> {
  return invoke("db_update_purchase", {
    id,
    ticker,
    shares,
    pricePerShare,
    purchasedAt,
  });
}

export async function deletePurchase(id: number): Promise<void> {
  return invoke("db_delete_purchase", { id });
}

export async function hintStockQuoteType(
  ticker: string,
  quoteType: string,
): Promise<void> {
  return invoke("db_hint_stock_quote_type", { ticker, quoteType });
}

export async function clearAllPurchases(): Promise<void> {
  return invoke("db_clear_all_purchases");
}

export async function clearPortfolioPurchases(id: number): Promise<void> {
  return invoke("db_clear_portfolio_purchases", { portfolioId: id });
}

// ── Stocks / Prices ────────────────────────────────────────────────────────

export async function getCachedStocks(): Promise<Stock[]> {
  return invoke<Stock[]>("db_get_cached_stocks");
}

export async function upsertStock(
  ticker: string,
  name: string | null,
  lastPrice: number | null,
  quoteType: string | null = null,
  dailyChangePct: number | null = null,
  targetMeanPrice: number | null = null,
  postMarketPrice: number | null = null,
  postMarketChangePct: number | null = null,
  preMarketPrice: number | null = null,
  preMarketChangePct: number | null = null,
  marketState: string | null = null,
  dividendYield: number | null = null,
): Promise<void> {
  return invoke("db_upsert_stock", {
    ticker,
    name,
    lastPrice,
    quoteType,
    dailyChangePct,
    targetMeanPrice,
    postMarketPrice,
    postMarketChangePct,
    preMarketPrice,
    preMarketChangePct,
    marketState,
    dividendYield,
  });
}

export async function fetchAndCachePrices(
  tickers: string[],
): Promise<QuoteResult[]> {
  if (tickers.length === 0) return [];
  const results = await invoke<QuoteResult[]>("fetch_quotes_command", {
    tickers,
  });
  for (const r of results) {
    await upsertStock(
      r.ticker,
      r.name,
      r.price,
      r.quote_type,
      r.daily_change_pct,
      r.target_mean_price,
      r.post_market_price,
      r.post_market_change_pct,
      r.pre_market_price,
      r.pre_market_change_pct,
      r.market_state,
      r.dividend_yield,
    );
  }
  return results;
}

// ── Watchlists ────────────────────────────────────────────────────────────

export async function listWatchlists(): Promise<Watchlist[]> {
  return invoke<Watchlist[]>("db_list_watchlists");
}

export async function createWatchlist(name: string): Promise<number> {
  return invoke<number>("db_create_watchlist", { name });
}

export async function renameWatchlist(id: number, name: string): Promise<void> {
  return invoke("db_rename_watchlist", { id, name });
}

export async function deleteWatchlist(id: number): Promise<void> {
  return invoke("db_delete_watchlist", { id });
}

// ── Watchlist items ────────────────────────────────────────────────────────

export async function listWatchlist(
  watchlistId: number,
): Promise<WatchlistItem[]> {
  return invoke<WatchlistItem[]>("db_list_watchlist_items", { watchlistId });
}

export async function addToWatchlist(
  ticker: string,
  watchlistId: number,
  watchPrice: number | null = null,
): Promise<void> {
  return invoke("db_add_to_watchlist", { ticker, watchlistId, watchPrice });
}

export async function removeFromWatchlist(id: number): Promise<void> {
  return invoke("db_remove_from_watchlist", { id });
}

export async function setWatchlistWatchPrice(
  id: number,
  watchPrice: number,
): Promise<void> {
  return invoke("db_set_watch_price", { id, watchPrice });
}
// ── Watchlist backup (all watchlists) ─────────────────────────────────────

interface WatchlistItemFull {
  id: number;
  ticker: string;
  watch_price: number | null;
  created_at: number;
  watchlist_id: number;
}

interface WatchlistBackupEntry {
  name: string;
  sort_order: number;
  items: { ticker: string; watch_price: number | null; created_at: number }[];
  targets: Record<string, number>;
  notes: Record<string, string>;
}

interface AllWatchlistsBackup {
  version: 2;
  exported_at: number;
  watchlists: WatchlistBackupEntry[];
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function exportAllWatchlistsBackup(): Promise<boolean> {
  const watchlists = await listWatchlists();
  const allItems = await invoke<WatchlistItemFull[]>(
    "db_list_all_watchlist_items",
  );

  const entries: WatchlistBackupEntry[] = watchlists.map((wl) => ({
    name: wl.name,
    sort_order: wl.sort_order,
    items: allItems
      .filter((i) => i.watchlist_id === wl.id)
      .map(({ ticker, watch_price, created_at }) => ({
        ticker,
        watch_price,
        created_at,
      })),
    targets: readLocalJson<Record<string, number>>(
      `stockfolio-watchlist-targets-${wl.id}`,
      {},
    ),
    notes: readLocalJson<Record<string, string>>(
      `stockfolio-watchlist-notes-${wl.id}`,
      {},
    ),
  }));

  const path = await save({
    defaultPath: `watchlists-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON Backup", extensions: ["json"] }],
  });
  if (!path) return false;
  const backup: AllWatchlistsBackup = {
    version: 2,
    exported_at: Math.floor(Date.now() / 1000),
    watchlists: entries,
  };
  await writeTextFile(path, JSON.stringify(backup, null, 2));
  return true;
}

export async function importAllWatchlistsBackup(): Promise<{
  watchlistsImported: number;
  tickersImported: number;
} | null> {
  const path = await openDialog({
    filters: [{ name: "JSON Backup", extensions: ["json"] }],
    multiple: false,
  });
  if (!path) return null;
  const text = await readTextFile(path as string);
  let backup: AllWatchlistsBackup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error(
      "Could not parse backup file — make sure it is a valid Stockfolio watchlist backup.",
    );
  }
  if (!Array.isArray(backup.watchlists)) {
    throw new Error("Invalid backup file: missing watchlists array.");
  }

  let watchlistsImported = 0;
  let tickersImported = 0;

  for (const entry of backup.watchlists) {
    // Find or create the watchlist by name
    const existing = (await listWatchlists()).find(
      (w) => w.name === entry.name,
    );
    let watchlistId: number;
    if (existing) {
      watchlistId = existing.id;
    } else {
      watchlistId = await createWatchlist(entry.name);
      watchlistsImported++;
    }

    for (const item of entry.items ?? []) {
      if (!item.ticker) continue;
      await addToWatchlist(item.ticker, watchlistId, item.watch_price ?? null);
      tickersImported++;
    }

    // Merge targets (existing values win)
    const targetsKey = `stockfolio-watchlist-targets-${watchlistId}`;
    const existingTargets = readLocalJson<Record<string, number>>(
      targetsKey,
      {},
    );
    const mergedTargets = { ...entry.targets, ...existingTargets };
    localStorage.setItem(targetsKey, JSON.stringify(mergedTargets));

    // Merge notes (existing values win)
    const notesKey = `stockfolio-watchlist-notes-${watchlistId}`;
    const existingNotes = readLocalJson<Record<string, string>>(notesKey, {});
    const mergedNotes = { ...entry.notes, ...existingNotes };
    localStorage.setItem(notesKey, JSON.stringify(mergedNotes));
  }

  return { watchlistsImported, tickersImported };
}

// ── Favorites ─────────────────────────────────────────────────────────────

export async function listFavorites(portfolioId: number): Promise<Favorite[]> {
  return invoke<Favorite[]>("db_list_favorites", { portfolioId });
}

export async function addFavorite(
  ticker: string,
  portfolioId: number,
): Promise<void> {
  return invoke("db_add_favorite", { ticker, portfolioId });
}

export async function removeFavorite(
  ticker: string,
  portfolioId: number,
): Promise<void> {
  return invoke("db_remove_favorite", { ticker, portfolioId });
}

export async function reorderFavorites(
  tickers: string[],
  portfolioId: number,
): Promise<void> {
  return invoke("db_reorder_favorites", { tickers, portfolioId });
}

// ── Ticker Search ─────────────────────────────────────────────────────────

export async function searchTickers(
  query: string,
): Promise<TickerSearchResult[]> {
  return invoke<TickerSearchResult[]>("search_tickers_command", { query });
}

// ── News ──────────────────────────────────────────────────────────────────

export async function fetchNews(
  ticker: string,
  count = 10,
): Promise<NewsArticle[]> {
  return invoke<NewsArticle[]>("fetch_news_command", {
    ticker: ticker.toUpperCase(),
    count,
  });
}

export async function fetchUpcomingEarnings(
  tickers: string[],
  withinDays = 30,
): Promise<UpcomingEarningsEvent[]> {
  if (tickers.length === 0) return [];
  const upper = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  return invoke<UpcomingEarningsEvent[]>("fetch_upcoming_earnings_command", {
    tickers: upper,
    withinDays,
  });
}

export async function addEarningsCallToCalendar(
  ticker: string,
  eventAt: number,
): Promise<void> {
  await invoke("open_earnings_call_in_calendar", {
    ticker: ticker.toUpperCase(),
    eventAt,
  });
}

type RawDividendInfo = Partial<DividendInfo> & {
  dividendDate?: number | null;
  dividendAmountPerShare?: number | null;
  annualDividendRate?: number | null;
  payoutFrequency?: string | null;
};

export async function fetchDividendInfo(ticker: string): Promise<DividendInfo> {
  const info = await invoke<RawDividendInfo>("fetch_dividend_info_command", {
    ticker: ticker.toUpperCase(),
  });
  return {
    dividend_date: info.dividend_date ?? info.dividendDate ?? null,
    dividend_amount_per_share:
      info.dividend_amount_per_share ?? info.dividendAmountPerShare ?? null,
    annual_dividend_rate: info.annual_dividend_rate ?? info.annualDividendRate ?? null,
    payout_frequency: info.payout_frequency ?? info.payoutFrequency ?? null,
  };
}

export async function addDividendToCalendar(
  ticker: string,
  dividendDate: number,
): Promise<void> {
  await invoke("open_dividend_in_calendar", {
    ticker: ticker.toUpperCase(),
    dividendDate,
  });
}

// ── CSV Export / Import ───────────────────────────────────────────────────

function escCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportPurchasesCsv(
  portfolioId: number,
): Promise<boolean> {
  const purchases = await listPurchases(portfolioId);
  const header = "ticker,shares,price_per_share,purchased_at";
  const rows = purchases.map(
    (p) =>
      `${escCsv(p.ticker)},${p.shares},${p.price_per_share},${escCsv(p.purchased_at)}`,
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
        `Found ${dataLines} data row${dataLines === 1 ? "" : "s"} but none matched the required format.`,
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

export async function exportPurchasesXlsx(
  portfolioId: number,
): Promise<boolean> {
  const purchases = await listPurchases(portfolioId);

  const wsData = [
    ["ticker", "shares", "price_per_share", "purchased_at"],
    ...purchases.map((p) => [
      p.ticker,
      p.shares,
      p.price_per_share,
      p.purchased_at,
    ]),
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

export async function importPurchasesXlsx(
  portfolioId: number,
): Promise<number> {
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

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], {
    header: 1,
  });
  if (rows.length === 0) return 0;

  // Detect and skip header row
  const firstRow = rows[0] as unknown[];
  const startIdx = firstRow.some((c) => String(c).toLowerCase() === "ticker")
    ? 1
    : 0;

  let imported = 0;
  for (let i = startIdx; i < rows.length; i++) {
    const cols = rows[i] as unknown[];
    if (cols.length < 4) continue;

    const ticker = String(cols[0] ?? "")
      .trim()
      .toUpperCase();
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

export async function importAmeripriseCSV(
  portfolioId: number,
): Promise<number> {
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
      'Could not find a header row containing "Transaction Date". ' +
        "Make sure this is an Ameriprise account activity CSV.",
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
    const rawDate = cols[0].trim(); // MM/DD/YYYY
    const description = cols[2].trim();
    const rawAmount = cols[3].trim();
    const rawQty = cols[4].trim();
    const rawPrice = cols[5].trim();
    const symbol = cols[6].trim().toUpperCase();

    // Skip rows with no usable symbol (money market, fees, blank, etc.)
    if (!symbol || symbol === "9999840") continue;

    const isBuy = /^BUY\s+-\s+/i.test(description);
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
      "No importable transactions found. Expected BUY or DIVIDEND REINVEST rows with a ticker symbol.",
    );
  }

  return imported;
}
