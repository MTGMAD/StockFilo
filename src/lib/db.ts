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
import { calibrateCash } from "./cash";
import { parseAmeripriseActivity, planAmeripriseImport, purchaseMatcher } from "./ameriprise";
import type {
  Purchase,
  CashEvent,
  Sale,
  JournalNote,
  CashAnchor,
  Stock,
  QuoteResult,
  WatchlistItem,
  TickerSearchResult,
  NewsArticle,
  Favorite,
  PositionOrder,
  UpcomingEarningsEvent,
  Portfolio,
  Watchlist,
  DividendInfo,
  AlertDirection,
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

export async function setPositionSortMode(
  portfolioId: number,
  mode: string,
): Promise<void> {
  return invoke("db_set_position_sort_mode", { portfolioId, mode });
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

// ── Cash events (dividends + fees) ──────────────────────────────────────────

export async function listCashEvents(portfolioId: number): Promise<CashEvent[]> {
  return invoke<CashEvent[]>("db_list_cash_events", { portfolioId });
}

export async function addCashEvent(
  portfolioId: number,
  kind: CashEvent["kind"],
  ticker: string | null,
  amount: number,
  occurredAt: string,
  note: string | null,
): Promise<void> {
  return invoke("db_add_cash_event", {
    portfolioId,
    kind,
    ticker,
    amount,
    occurredAt,
    note,
  });
}

export async function updateCashEvent(
  id: number,
  kind: CashEvent["kind"],
  ticker: string | null,
  amount: number,
  occurredAt: string,
  note: string | null,
): Promise<void> {
  return invoke("db_update_cash_event", {
    id,
    kind,
    ticker,
    amount,
    occurredAt,
    note,
  });
}

export async function deleteCashEvent(id: number): Promise<void> {
  return invoke("db_delete_cash_event", { id });
}

// ── Sales ────────────────────────────────────────────────────────────────

export async function listSales(portfolioId: number): Promise<Sale[]> {
  return invoke<Sale[]>("db_list_sales", { portfolioId });
}

export async function addSale(
  portfolioId: number,
  ticker: string,
  shares: number,
  pricePerShare: number,
  soldAt: string,
): Promise<void> {
  return invoke("db_add_sale", {
    portfolioId,
    ticker,
    shares,
    pricePerShare,
    soldAt,
  });
}

export async function updateSale(
  id: number,
  ticker: string,
  shares: number,
  pricePerShare: number,
  soldAt: string,
): Promise<void> {
  return invoke("db_update_sale", {
    id,
    ticker,
    shares,
    pricePerShare,
    soldAt,
  });
}

export async function deleteSale(id: number): Promise<void> {
  return invoke("db_delete_sale", { id });
}

/** Stamps "now" as the portfolio's last successful import time. */
export async function touchPortfolioImport(portfolioId: number): Promise<void> {
  return invoke("db_touch_portfolio_import", { portfolioId });
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

/**
 * Change a watchlist row's added date and its "price when added" together —
 * unlike `setWatchlistWatchPrice` above (a one-time backfill that never
 * overwrites a real price), this always writes both. `watchPrice: null`
 * records the price as unknown rather than leaving the old one stale, for a
 * date Yahoo has no session in.
 */
export async function setWatchlistAddedAt(
  id: number,
  addedAt: number,
  watchPrice: number | null,
): Promise<void> {
  return invoke("db_set_watchlist_added_at", { id, addedAt, watchPrice });
}

/** Closing price on `date` (`YYYY-MM-DD`), or null if Yahoo has no session
 *  at or before it (e.g. the ticker didn't exist yet). */
export async function fetchPriceOnDate(
  ticker: string,
  date: string,
): Promise<number | null> {
  return invoke("fetch_price_on_date_command", { ticker, date });
}

/**
 * Set or clear a watchlist row's note. Blank/whitespace-only text clears it
 * (see `db_set_watchlist_note`), so callers don't need to special-case an
 * empty string themselves.
 */
export async function updateWatchlistNote(
  id: number,
  notes: string,
): Promise<void> {
  return invoke("db_set_watchlist_note", { id, notes });
}

/**
 * One-time move of notes written before migration V17, when they lived in
 * `localStorage` keyed by ticker rather than as a column on the row. Called
 * on every watchlist load, but it is nearly free once done — the old key is
 * removed as soon as everything in it has somewhere to go, so this is only
 * ever real work the first time a given watchlist loads after upgrading.
 * A note already in the database always wins over the legacy one.
 */
export async function migrateLegacyWatchlistNotes(
  watchlistId: number,
  items: WatchlistItem[],
): Promise<number> {
  const key = `stockfolio-watchlist-notes-${watchlistId}`;
  const legacy = readLocalJson<Record<string, string>>(key, {});
  if (Object.keys(legacy).length === 0) {
    localStorage.removeItem(key);
    return 0;
  }

  let migrated = 0;
  for (const item of items) {
    if (item.notes?.trim()) continue;
    const text = legacy[item.ticker];
    if (text?.trim()) {
      await updateWatchlistNote(item.id, text);
      migrated++;
    }
  }
  localStorage.removeItem(key);
  return migrated;
}

// ── Price alerts ─────────────────────────────────────────────────────────

/**
 * Set or clear a watchlist row's price alert. `targetPrice: null` clears it
 * entirely. `direction` is computed by the caller — 'above' when the target
 * is at or above the price at the moment it's set, 'below' otherwise — since
 * only the caller knows the current price. Setting a target (even the same
 * value again) always re-arms the alert.
 */
export async function setWatchlistAlert(
  id: number,
  targetPrice: number | null,
  direction: AlertDirection | null,
): Promise<void> {
  return invoke("db_set_watchlist_alert", { id, targetPrice, direction });
}

export async function markAlertTriggered(id: number): Promise<void> {
  return invoke("db_mark_alert_triggered", {
    id,
    triggeredAt: Math.floor(Date.now() / 1000),
  });
}

export async function acknowledgeAlert(id: number): Promise<void> {
  return invoke("db_acknowledge_alert", { id });
}

export async function acknowledgeAllAlerts(): Promise<void> {
  return invoke("db_acknowledge_all_alerts");
}

/** Every watchlist row that has an alert (or ever had a target), across every watch list. */
export async function listAllWatchlistItems(): Promise<WatchlistItemFull[]> {
  return invoke<WatchlistItemFull[]>("db_list_all_watchlist_items");
}

/**
 * One-time move of buy/sell targets written before migration V25, when they
 * lived in `localStorage` per watch list rather than as columns on the row —
 * mirrors `migrateLegacyWatchlistNotes` above. A target already in the
 * database always wins over the legacy one; direction is inferred the same
 * way a freshly-set alert's is (target vs. the row's last-known price).
 */
export async function migrateLegacyWatchlistTargets(
  watchlistId: number,
  items: WatchlistItem[],
): Promise<number> {
  const key = `stockfolio-watchlist-targets-${watchlistId}`;
  const legacy = readLocalJson<Record<string, number>>(key, {});
  if (Object.keys(legacy).length === 0) {
    localStorage.removeItem(key);
    return 0;
  }

  let migrated = 0;
  for (const item of items) {
    if (item.alert_target_price != null) continue;
    const target = legacy[item.ticker];
    if (target != null && !isNaN(target) && target > 0) {
      const referencePrice = item.watch_price ?? target;
      const direction: AlertDirection = target >= referencePrice ? "above" : "below";
      await setWatchlistAlert(item.id, target, direction);
      migrated++;
    }
  }
  localStorage.removeItem(key);
  return migrated;
}

// ── Watchlist backup (all watchlists) ─────────────────────────────────────

export interface WatchlistItemFull extends WatchlistItem {
  watchlist_id: number;
}

interface WatchlistBackupEntry {
  name: string;
  sort_order: number;
  items: {
    ticker: string;
    watch_price: number | null;
    created_at: number;
    notes: string | null;
  }[];
  targets: Record<string, number>;
  /**
   * v2-only: notes used to live in `localStorage`, keyed by ticker rather
   * than tied to a row, so an old backup carries them here — as a top-level,
   * ticker-keyed map — instead of on each item. Absent from anything
   * exported after notes moved into the `watchlist` table, which is per-item
   * (see `items[].notes`) since each row now owns its own note directly.
   */
  notes?: Record<string, string>;
}

interface AllWatchlistsBackup {
  version: 2 | 3;
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
  const allItems = await listAllWatchlistItems();

  const entries: WatchlistBackupEntry[] = watchlists.map((wl) => {
    const wlItems = allItems.filter((i) => i.watchlist_id === wl.id);
    const targets: Record<string, number> = {};
    for (const item of wlItems) {
      if (item.alert_target_price != null) targets[item.ticker] = item.alert_target_price;
    }
    return {
      name: wl.name,
      sort_order: wl.sort_order,
      items: wlItems.map(({ ticker, watch_price, created_at, notes }) => ({
        ticker,
        watch_price,
        created_at,
        notes,
      })),
      // Alert targets now live in the database too (like notes), but the
      // backup keeps this shape for compatibility with older backup files.
      targets,
      // No `notes` map here — notes now live per-item (above), in the database,
      // so they travel with the rest of a WebDAV/NAS sync instead of needing a
      // manual backup/restore round-trip at all.
    };
  });

  const path = await save({
    defaultPath: `watchlists-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON Backup", extensions: ["json"] }],
  });
  if (!path) return false;
  const backup: AllWatchlistsBackup = {
    version: 3,
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

    // Targets and notes now both live in the database rather than
    // localStorage, so both merge per-row instead of as a blob — existing
    // values always win. A backup may carry notes either way: per-item
    // (current export format) or as v2's legacy ticker-keyed map.
    const noteByTicker = new Map<string, string>();
    for (const [ticker, text] of Object.entries(entry.notes ?? {})) {
      if (text.trim()) noteByTicker.set(ticker, text);
    }
    for (const item of entry.items ?? []) {
      if (item.notes?.trim()) noteByTicker.set(item.ticker, item.notes);
    }

    if (Object.keys(entry.targets ?? {}).length > 0 || noteByTicker.size > 0) {
      const current = await listWatchlist(watchlistId);
      for (const row of current) {
        if (row.alert_target_price == null) {
          const target = entry.targets?.[row.ticker];
          if (target != null && !isNaN(target) && target > 0) {
            const referencePrice = row.watch_price ?? target;
            const direction: AlertDirection = target >= referencePrice ? "above" : "below";
            await setWatchlistAlert(row.id, target, direction);
          }
        }
        if (!row.notes?.trim()) {
          const incoming = noteByTicker.get(row.ticker);
          if (incoming) await updateWatchlistNote(row.id, incoming);
        }
      }
    }
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

// ── Position order ────────────────────────────────────────────────────────
// Manual drag-order for the positions list — same idea as favorites above,
// but for any ticker, not just starred ones.

export async function listPositionOrder(
  portfolioId: number,
): Promise<PositionOrder[]> {
  return invoke<PositionOrder[]>("db_list_position_order", { portfolioId });
}

export async function reorderPositions(
  tickers: string[],
  portfolioId: number,
): Promise<void> {
  return invoke("db_reorder_positions", { tickers, portfolioId });
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

export interface ImportResult {
  imported: number;
  /** Rows that matched an existing purchase (same ticker/shares/price/date) and were left alone. */
  skipped: number;
  /** Rows recognized as a real transaction type this app doesn't capture yet
   *  (sells, transfers, interest, …), keyed by a human label → count. Absent
   *  or empty when every row either imported or was an exact duplicate. */
  unhandled?: Record<string, number>;
  /** Cash balance worked out from the file (manual accounts), when it had enough to do so. */
  cashCalibrated?: { balance: number; asOf: string };
  /** Trades already in the portfolio twice under different dates. */
  possibleDuplicates?: string[];
}







export async function importPurchasesCsv(
  portfolioId: number,
): Promise<ImportResult> {
  const path = await openDialog({
    title: "Import Purchases",
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return { imported: 0, skipped: 0 };

  const csv = await readTextFile(path as string);
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { imported: 0, skipped: 0 };

  // Detect and skip header row
  const firstLine = lines[0].toLowerCase();
  const startIdx = firstLine.includes("ticker") ? 1 : 0;

  const alreadyRecorded = purchaseMatcher(await listPurchases(portfolioId));
  let imported = 0;
  let skipped = 0;
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

    if (alreadyRecorded({ ticker: ticker, shares: shares, price: price, date: date })) {
      skipped++;
      continue;
    }

    await addPurchase(portfolioId, ticker, shares, price, date);
    imported++;
  }

  if (imported === 0 && skipped === 0 && dataLines > 0) {
    throw new Error(
      `No rows could be imported. Expected format: ticker,shares,price_per_share,purchased_at (YYYY-MM-DD). ` +
        `Found ${dataLines} data row${dataLines === 1 ? "" : "s"} but none matched the required format.`,
    );
  }

  await touchPortfolioImport(portfolioId);
  return { imported, skipped };
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
): Promise<ImportResult> {
  const path = await openDialog({
    title: "Import Purchases",
    multiple: false,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx", "xls"] }],
  });
  if (!path) return { imported: 0, skipped: 0 };

  const data = await readFile(path as string);
  const wb = XLSX.read(data, { type: "array" });

  const wsName = wb.SheetNames[0];
  if (!wsName) return { imported: 0, skipped: 0 };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], {
    header: 1,
  });
  if (rows.length === 0) return { imported: 0, skipped: 0 };

  // Detect and skip header row
  const firstRow = rows[0] as unknown[];
  const startIdx = firstRow.some((c) => String(c).toLowerCase() === "ticker")
    ? 1
    : 0;

  const alreadyRecorded = purchaseMatcher(await listPurchases(portfolioId));
  let imported = 0;
  let skipped = 0;
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

    if (alreadyRecorded({ ticker: ticker, shares: shares, price: price, date: date })) {
      skipped++;
      continue;
    }

    await addPurchase(portfolioId, ticker, shares, price, date);
    imported++;
  }

  await touchPortfolioImport(portfolioId);
  return { imported, skipped };
}

// ── Ameriprise CSV Import ─────────────────────────────────────────────────
// Handles the "Account Activity" CSV exported from Ameriprise SPS accounts.
// Imports six kinds of completed rows:
//   - BUY and dividend/capital-gain REINVESTMENTS → purchases (share acquisitions)
//   - SELL → sales (reduces the position, credits proceeds to cash)
//   - cash DIVIDEND / CAP GAIN payouts (not reinvested) → cash_events (kind: dividend)
//   - FEE rows (advisory, account, etc.) → cash_events (kind: fee)
//   - INTEREST PAYMENT rows (money-market sweep interest) → cash_events (kind: interest)
// Rows under a "Pending Transactions" section are never imported (they
// haven't settled and can still change or cancel) — they're only counted for
// the result summary, same as JOURNAL transfers, which this app doesn't
// track anywhere yet.

export async function importAmeripriseCSV(
  portfolioId: number,
): Promise<ImportResult> {
  const path = await openDialog({
    title: "Import from Ameriprise",
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return { imported: 0, skipped: 0 };

  // Parsing and duplicate matching live in ameriprise.ts (pure, tested
  // against real exports); this only reads the file and writes the result.
  const parsed = parseAmeripriseActivity(await readTextFile(path as string));
  if (
    parsed.purchases.length + parsed.sales.length + parsed.cashEvents.length === 0 &&
    Object.keys(parsed.unhandled).length === 0
  ) {
    throw new Error(
      "No importable transactions found. Expected BUY, SELL, DIVIDEND REINVEST, DIVIDEND, or FEE rows.",
    );
  }

  const [purchases, sales, cashEvents] = await Promise.all([
    listPurchases(portfolioId),
    listSales(portfolioId),
    listCashEvents(portfolioId),
  ]);
  const plan = planAmeripriseImport(parsed, { purchases, sales, cashEvents });

  for (const p of plan.purchases) {
    await addPurchase(portfolioId, p.ticker, p.shares, p.price, p.date);
    // Dividend reinvestments are always mutual funds — hint the type so the
    // ticker lands in the right sidebar section before Yahoo is asked.
    if (p.reinvest) await hintStockQuoteType(p.ticker, "MUTUALFUND");
  }
  for (const e of plan.cashEvents) {
    await addCashEvent(portfolioId, e.kind, e.ticker, e.amount, e.date, null);
  }
  for (const s of plan.sales) {
    // Reduces the position and credits its proceeds to cash in one step
    // (see db_add_sale in the Rust layer).
    await addSale(portfolioId, s.ticker, s.shares, s.price, s.date);
  }

  // Cash comes straight from the file. A file without a sweep-interest row
  // (a short export) can't state a balance, so any earlier calibration stays.
  let cashCalibrated: { balance: number; asOf: string } | undefined;
  const calibrated = calibrateCash(parsed.activity, parsed.endDate);
  if (calibrated) {
    const existing = await getCashAnchor(portfolioId);
    if (!existing || calibrated.asOf >= existing.as_of) {
      await setCashAnchor(portfolioId, calibrated.asOf, calibrated.balance);
      cashCalibrated = { balance: calibrated.balance, asOf: calibrated.asOf };
    }
  }

  await touchPortfolioImport(portfolioId);
  return {
    imported: plan.purchases.length + plan.sales.length + plan.cashEvents.length,
    skipped: plan.skipped,
    unhandled: Object.keys(parsed.unhandled).length > 0 ? parsed.unhandled : undefined,
    cashCalibrated,
    possibleDuplicates: plan.existingDuplicates.length > 0 ? plan.existingDuplicates : undefined,
  };
}

// ── Cash calibration ─────────────────────────────────────────────────────

export async function getCashAnchor(portfolioId: number): Promise<CashAnchor | null> {
  return invoke<CashAnchor | null>("db_get_cash_anchor", { portfolioId });
}

export async function setCashAnchor(
  portfolioId: number,
  asOf: string,
  balance: number,
): Promise<void> {
  return invoke("db_set_cash_anchor", { portfolioId, asOf, balance });
}

export async function clearCashAnchor(portfolioId: number): Promise<void> {
  return invoke("db_clear_cash_anchor", { portfolioId });
}

// ── Journal ──────────────────────────────────────────────────────────────

export async function listJournalNotes(
  portfolioId: number,
): Promise<JournalNote[]> {
  return invoke<JournalNote[]>("db_list_journal_notes", { portfolioId });
}

/** Upsert a journal note; one with every field blank is deleted. */
export async function setJournalNote(
  portfolioId: number,
  tradeKey: string,
  reflection: string | null,
  lesson: string | null,
  tags: string | null,
): Promise<void> {
  return invoke("db_set_journal_note", {
    portfolioId,
    tradeKey,
    reflection,
    lesson,
    tags,
  });
}
