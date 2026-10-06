/**
 * Ameriprise "Account Activity" CSV: parsing and duplicate-safe import planning.
 *
 * Pure functions only (no database, no Tauri), so both halves can be tested
 * against real exports. `importAmeripriseCSV` in db.ts reads the file, asks
 * this module what to add, and writes it.
 */
import type { CashEvent, Purchase, Sale } from "../types";
import { parseSignedAmount, type ActivityRow } from "./cash";

export interface ParsedPurchase {
  ticker: string;
  shares: number;
  price: number;
  date: string;
  reinvest: boolean;
}

export interface ParsedSale {
  ticker: string;
  shares: number;
  price: number;
  date: string;
}

export interface ParsedCashEvent {
  kind: CashEvent["kind"];
  ticker: string | null;
  amount: number;
  date: string;
}

export interface ParsedActivity {
  endDate: string | null;
  purchases: ParsedPurchase[];
  sales: ParsedSale[];
  cashEvents: ParsedCashEvent[];
  /** Every completed row's signed cash effect, for the cash calibration. */
  activity: ActivityRow[];
  /** Rows deliberately not imported, by label → count. */
  unhandled: Record<string, number>;
}

/** Collapse every run of whitespace (spaces, tabs, non-breaking spaces,
 *  embedded newlines) to one space. Exports vary in how they pad fields;
 *  nothing below may depend on exact spacing. */
export function normalizeCell(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** M/D/YYYY or MM/DD/YYYY (any surrounding spaces) → YYYY-MM-DD. */
function toIsoDate(raw: string): string | null {
  const m = normalizeCell(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseNumber(raw: string): number | null {
  const s = raw.replace(/[\s$,]/g, "");
  if (!s) return null;
  const n = parseFloat(s.replace(/[()]/g, ""));
  if (!Number.isFinite(n)) return null;
  return s.startsWith("(") || s.startsWith("-") ? -Math.abs(n) : n;
}

/** The pseudo-symbol Ameriprise uses for the cash sweep — not a holding. */
const SWEEP_SYMBOL = "9999840";

const COLUMN_NAMES = {
  date: "transaction date",
  description: "description",
  amount: "amount",
  quantity: "quantity",
  price: "price",
  symbol: "symbol",
} as const;
type Column = keyof typeof COLUMN_NAMES;

export function parseAmeripriseActivity(text: string): ParsedActivity {
  const lines = text.split(/\r?\n/);
  const out: ParsedActivity = {
    endDate: null,
    purchases: [],
    sales: [],
    cashEvents: [],
    activity: [],
    unhandled: {},
  };
  const bump = (label: string) => {
    out.unhandled[label] = (out.unhandled[label] ?? 0) + 1;
  };

  // Columns are located by header name (the order could change), falling
  // back to the historical positions.
  let col: Record<Column, number> = {
    date: 0, description: 2, amount: 3, quantity: 4, price: 5, symbol: 6,
  };
  let sawHeader = false;
  // Pending rows haven't settled (they can still change or cancel), so they
  // are counted for the summary but never imported. A file with no section
  // labels at all imports normally.
  let section: "pending" | "completed" = "completed";

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const cells = parseCsvLine(rawLine).map(normalizeCell);
    const joined = cells.join(" ").toLowerCase();

    if (!sawHeader) {
      const end = cells.join(" ").match(/End Date:\s*(\d{4}-\d{2}-\d{2})/i);
      if (end) out.endDate = end[1];
    }

    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length === 1) {
      const label = nonEmpty[0].toLowerCase();
      if (label === "pending transactions") section = "pending";
      else if (label === "completed transactions") section = "completed";
      continue;
    }

    // Header row (each section repeats it).
    if (cells.some((c) => c.toLowerCase() === COLUMN_NAMES.date)) {
      const lower = cells.map((c) => c.toLowerCase());
      const found = { ...col };
      for (const key of Object.keys(COLUMN_NAMES) as Column[]) {
        const i = lower.indexOf(COLUMN_NAMES[key]);
        if (i >= 0) found[key] = i;
      }
      col = found;
      sawHeader = true;
      continue;
    }
    if (!sawHeader || joined.startsWith("filter criteria")) continue;

    const date = toIsoDate(cells[col.date] ?? "");
    if (!date) continue;

    const description = cells[col.description] ?? "";
    const rawAmount = cells[col.amount] ?? "";
    const quantity = parseNumber(cells[col.quantity] ?? "");
    const priceCol = parseNumber(cells[col.price] ?? "");
    const symbol = (cells[col.symbol] ?? "").toUpperCase();
    const hasSymbol = Boolean(symbol) && symbol !== SWEEP_SYMBOL;

    const isBuy = /^BUY\s*-/i.test(description);
    const reinvestPrice = description.match(/REINVEST AT\s*([\d.]+)/i);
    const isReinvest = reinvestPrice != null;
    const isSell = /^SELL\s*-/i.test(description);
    // After isReinvest, so a reinvested dividend isn't also a cash payout.
    const isCashDividend =
      !isReinvest && /DIVIDEND|CAP(?:ITAL)?\s*GAINS?/i.test(description);
    const isFee = /\bFEE\b/i.test(description);
    const isJournal = /^JOURNAL\b/i.test(description);
    const isInterest = /^INTEREST PAYMENT/i.test(description);

    if (section === "pending") {
      bump(
        isSell ? "pending sell order"
          : isBuy ? "pending buy order"
            : isReinvest || isCashDividend ? "pending dividend"
              : isFee ? "pending fee"
                : "pending transaction",
      );
      continue;
    }

    const signed = parseSignedAmount(rawAmount);
    if (signed != null) {
      out.activity.push({ date, description, amount: signed, quantity });
    }
    const magnitude = signed == null ? null : Math.abs(signed);

    if (isBuy || isReinvest) {
      if (!hasSymbol || quantity == null || Math.abs(quantity) <= 0) continue;
      const shares = Math.abs(quantity);
      // BUY: Amount/Quantity (the Price column is per $100 face for bonds).
      // Reinvest: the "REINVEST AT" price in the description.
      let price: number | null = null;
      if (isBuy) {
        price = magnitude && magnitude > 0 ? magnitude / shares : priceCol;
      } else {
        price = parseFloat(reinvestPrice![1]);
      }
      if (price == null || !Number.isFinite(price) || price <= 0) continue;
      out.purchases.push({ ticker: symbol, shares, price, date, reinvest: isReinvest });
    } else if (isSell) {
      if (!hasSymbol || quantity == null || Math.abs(quantity) <= 0) continue;
      const shares = Math.abs(quantity);
      const price = magnitude && magnitude > 0 ? magnitude / shares : priceCol;
      if (price == null || !Number.isFinite(price) || price <= 0) continue;
      out.sales.push({ ticker: symbol, shares, price, date });
    } else if (isCashDividend || isFee || isInterest) {
      if (magnitude == null || magnitude <= 0) continue;
      const kind: CashEvent["kind"] = isFee ? "fee" : isInterest ? "interest" : "dividend";
      out.cashEvents.push({
        kind,
        ticker: hasSymbol ? symbol : null,
        amount: kind === "fee" ? -magnitude : magnitude,
        date,
      });
    } else if (isJournal) {
      bump("deposit/transfer");
    } else if (rawAmount) {
      bump("other transaction");
    }
  }

  if (!sawHeader) {
    throw new Error(
      'Could not find a header row containing "Transaction Date". ' +
        "Make sure this is an Ameriprise account activity CSV.",
    );
  }
  return out;
}

// ── Duplicate-safe planning ──────────────────────────────────────────────

const DAY = 86_400_000;
const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY;

/** Same holding, same share count, same total cost — the date is not part of
 *  it. Two genuine buys with identical shares AND identical total cost on
 *  different days essentially never happen, while the same buy arriving with
 *  a different date from another export does (that is how a duplicate EIDOX
 *  purchase got in). Total cost, not per-share price, because each source
 *  rounds the price differently. */
function sameTrade(
  a: { ticker: string; shares: number; price: number },
  b: { ticker: string; shares: number; price: number },
): boolean {
  return (
    a.ticker === b.ticker &&
    Math.abs(a.shares - b.shares) < 0.0005 &&
    Math.abs(a.shares * a.price - b.shares * b.price) <= 0.02
  );
}

/** Dividends recur with identical amounts every month, so cash events do
 *  keep the date — but allow a few days' drift between exports. */
function sameCashEvent(
  a: { kind: string; ticker: string | null; amount: number; date: string },
  b: { kind: string; ticker: string | null; amount: number; date: string },
): boolean {
  return (
    a.kind === b.kind &&
    (a.ticker ?? "") === (b.ticker ?? "") &&
    Math.abs(a.amount - b.amount) < 0.005 &&
    daysApart(a.date, b.date) <= 3
  );
}

/**
 * Match each incoming row to at most one existing row; only rows left
 * unmatched are added. Matching is one-to-one, so two identical fills in one
 * file are both kept the first time and both skipped on every re-import.
 * Existing rows on the same date are preferred so a date-shifted match is
 * only used when nothing exact exists.
 */
function plan<I, E>(
  incoming: I[],
  existing: E[],
  same: (i: I, e: E) => boolean,
  dateOfI: (i: I) => string,
  dateOfE: (e: E) => string,
): { add: I[]; skipped: number } {
  const used = new Set<number>();
  const add: I[] = [];
  let skipped = 0;
  for (const row of incoming) {
    let best = -1;
    for (let k = 0; k < existing.length; k++) {
      if (used.has(k) || !same(row, existing[k])) continue;
      if (best === -1 || dateOfE(existing[k]) === dateOfI(row)) best = k;
      if (dateOfE(existing[k]) === dateOfI(row)) break;
    }
    if (best >= 0) {
      used.add(best);
      skipped++;
    } else {
      add.push(row);
    }
  }
  return { add, skipped };
}

export interface ExistingData {
  purchases: Purchase[];
  sales: Sale[];
  cashEvents: CashEvent[];
}

export interface ImportPlan {
  purchases: ParsedPurchase[];
  sales: ParsedSale[];
  cashEvents: ParsedCashEvent[];
  skipped: number;
  /** Rows already in the portfolio twice (same trade, different dates). */
  existingDuplicates: string[];
}

export function planAmeripriseImport(parsed: ParsedActivity, existing: ExistingData): ImportPlan {
  const asTrade = (p: Purchase) => ({ ticker: p.ticker, shares: p.shares, price: p.price_per_share });
  const asSale = (s: Sale) => ({ ticker: s.ticker, shares: s.shares, price: s.price_per_share });

  const pur = plan(parsed.purchases, existing.purchases, (i, e) => sameTrade(i, asTrade(e)), (i) => i.date, (e) => e.purchased_at);
  const sal = plan(parsed.sales, existing.sales, (i, e) => sameTrade(i, asSale(e)), (i) => i.date, (e) => e.sold_at);
  const cash = plan(
    parsed.cashEvents,
    // Sale proceeds are created by the sale itself, never imported directly.
    existing.cashEvents.filter((e) => e.kind !== "sale"),
    (i, e) => sameCashEvent(i, { kind: e.kind, ticker: e.ticker, amount: e.amount, date: e.occurred_at }),
    (i) => i.date,
    (e) => e.occurred_at,
  );

  return {
    purchases: pur.add,
    sales: sal.add,
    cashEvents: cash.add,
    skipped: pur.skipped + sal.skipped + cash.skipped,
    existingDuplicates: findExistingDuplicates(existing.purchases),
  };
}

/** Purchases that are the same trade recorded on two different dates. */
export function findExistingDuplicates(purchases: Purchase[]): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < purchases.length; i++) {
    if (seen.has(i)) continue;
    const a = purchases[i];
    for (let j = i + 1; j < purchases.length; j++) {
      const b = purchases[j];
      if (seen.has(j) || a.purchased_at === b.purchased_at) continue;
      if (
        sameTrade(
          { ticker: a.ticker, shares: a.shares, price: a.price_per_share },
          { ticker: b.ticker, shares: b.shares, price: b.price_per_share },
        )
      ) {
        seen.add(j);
        const cost = (a.shares * a.price_per_share).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
        out.push(`${a.ticker} ${a.shares} sh (${cost}) on ${a.purchased_at} and ${b.purchased_at}`);
      }
    }
  }
  return out;
}

/**
 * For the plain purchase importers (CSV/XLSX): returns a check that says
 * whether an incoming purchase is already recorded, using the same rules as
 * the Ameriprise import. Each existing purchase can only vouch for one
 * incoming row, so identical fills in one file are all kept the first time.
 */
export function purchaseMatcher(existing: Purchase[]) {
  const used = new Set<number>();
  return (row: { ticker: string; shares: number; price: number; date: string }): boolean => {
    let best = -1;
    for (let k = 0; k < existing.length; k++) {
      const e = existing[k];
      if (used.has(k) || !sameTrade(row, { ticker: e.ticker, shares: e.shares, price: e.price_per_share })) continue;
      if (best === -1 || e.purchased_at === row.date) best = k;
      if (e.purchased_at === row.date) break;
    }
    if (best < 0) return false;
    used.add(best);
    return true;
  };
}
