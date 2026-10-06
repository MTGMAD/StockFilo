import type { BrokerTransaction, Purchase, Sale } from "../types";

/** One buy or sell, normalised from purchases/sales or broker transactions. */
export interface Fill {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  date: string; // YYYY-MM-DD — no intraday time is stored anywhere
  /** Dividend reinvestment buy: counts toward the position, never opens a trade. */
  drip?: boolean;
}

/** A round trip: opens when a position goes from flat to held, closes when it
 *  returns to flat. Long-only — the data model has no shorts. */
export interface JournalTrade {
  key: string;
  ticker: string;
  openDate: string;
  closeDate: string | null; // null while still open
  /** Date of the latest sell, closed or not. */
  lastExitDate: string | null;
  fills: Fill[];
  /** Realized P&L (FIFO) per exit fill id. */
  exitPnl: Record<string, number>;
  realizedPnl: number;
  totalBought: number;
  totalSold: number;
  avgEntry: number;
  avgExit: number | null;
  openQty: number;
  holdDays: number;
  /** "partial" = some shares sold, position still held. */
  status: "win" | "loss" | "partial" | "open";
}

const EPS = 1e-9;

export function fillsFromPurchasesAndSales(
  purchases: Purchase[],
  sales: Sale[],
): Fill[] {
  return [
    ...purchases.map<Fill>((p) => ({
      id: `p${p.id}`,
      ticker: p.ticker,
      side: "buy",
      qty: p.shares,
      price: p.price_per_share,
      date: p.purchased_at,
    })),
    ...sales.map<Fill>((s) => ({
      id: `s${s.id}`,
      ticker: s.ticker,
      side: "sell",
      qty: s.shares,
      price: s.price_per_share,
      date: s.sold_at,
    })),
  ];
}

export function fillsFromBroker(txs: BrokerTransaction[]): Fill[] {
  const out: Fill[] = [];
  for (const t of txs) {
    const side = t.side?.toLowerCase();
    if ((side !== "buy" && side !== "sell") || !t.ticker) continue;
    if (t.qty == null || t.price == null || t.qty <= 0) continue;
    out.push({
      id: `b${t.id}`,
      ticker: t.ticker,
      side,
      qty: t.qty,
      price: t.price,
      date: t.occurred_at.slice(0, 10),
      drip: t.reinvested || undefined,
    });
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000,
  );
}

/** Group fills into round-trip trades with FIFO-matched realized P&L.
 *  Same-day fills put buys first (no intraday times to order by). A sell
 *  larger than the shares held is trimmed to what was held. */
export function buildTrades(fills: Fill[]): JournalTrade[] {
  const byTicker = new Map<string, Fill[]>();
  for (const f of fills) {
    const list = byTicker.get(f.ticker) ?? [];
    list.push(f);
    byTicker.set(f.ticker, list);
  }

  const trades: JournalTrade[] = [];
  for (const [ticker, list] of byTicker) {
    list.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.side === b.side ? 0 : a.side === "buy" ? -1 : 1) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
    const perDay = new Map<string, number>();
    let cur: {
      fills: Fill[];
      lots: { qty: number; price: number }[];
      exitPnl: Record<string, number>;
    } | null = null;

    const finish = (closed: boolean) => {
      if (!cur) return;
      const buys = cur.fills.filter((f) => f.side === "buy");
      const sells = cur.fills.filter((f) => f.side === "sell");
      const totalBought = buys.reduce((s, f) => s + f.qty, 0);
      const exits = Object.keys(cur.exitPnl);
      const soldQty = sells.reduce((s, f) => s + f.qty, 0);
      const realizedPnl = exits.reduce((s, id) => s + cur!.exitPnl[id], 0);
      const openDate = cur.fills[0].date;
      const n = perDay.get(openDate) ?? 0;
      perDay.set(openDate, n + 1);
      const openQty = cur.lots.reduce((s, l) => s + l.qty, 0);
      const last = sells.length ? sells[sells.length - 1].date : null;
      trades.push({
        key: `${ticker}|${openDate}|${n}`,
        ticker,
        openDate,
        closeDate: closed ? last : null,
        lastExitDate: last,
        fills: cur.fills,
        exitPnl: cur.exitPnl,
        realizedPnl,
        totalBought,
        totalSold: soldQty,
        avgEntry:
          buys.reduce((s, f) => s + f.qty * f.price, 0) / (totalBought || 1),
        avgExit: soldQty
          ? sells.reduce((s, f) => s + f.qty * f.price, 0) / soldQty
          : null,
        openQty: closed ? 0 : openQty,
        holdDays: daysBetween(openDate, closed && last ? last : openDate),
        status: closed
          ? realizedPnl >= 0
            ? "win"
            : "loss"
          : soldQty > 0
            ? "partial"
            : "open",
      });
      cur = null;
    };

    for (const f of list) {
      if (f.side === "buy") {
        // A dividend reinvestment adds to a position you already hold; on its
        // own it isn't a trade, so it never starts one.
        if (f.drip && !cur) continue;
        cur ??= { fills: [], lots: [], exitPnl: {} };
        cur.fills.push(f);
        cur.lots.push({ qty: f.qty, price: f.price });
        continue;
      }
      if (!cur) continue; // sell with nothing held — nothing to match
      let remaining = f.qty;
      let pnl = 0;
      while (remaining > EPS && cur.lots.length) {
        const lot = cur.lots[0];
        const q = Math.min(lot.qty, remaining);
        pnl += (f.price - lot.price) * q;
        lot.qty -= q;
        remaining -= q;
        if (lot.qty <= EPS) cur.lots.shift();
      }
      cur.fills.push(f);
      cur.exitPnl[f.id] = pnl;
      if (!cur.lots.length) finish(true);
    }
    finish(false);
  }
  return trades.sort(
    (a, b) =>
      (b.closeDate ?? b.openDate).localeCompare(a.closeDate ?? a.openDate) ||
      a.ticker.localeCompare(b.ticker),
  );
}

export interface DaySummary {
  date: string;
  pnl: number; // realized from exits that day
  exits: number;
  fills: number;
}

export function summarizeDays(trades: JournalTrade[]): Map<string, DaySummary> {
  const days = new Map<string, DaySummary>();
  for (const t of trades) {
    for (const f of t.fills) {
      const d =
        days.get(f.date) ?? { date: f.date, pnl: 0, exits: 0, fills: 0 };
      d.fills += 1;
      if (f.side === "sell" && f.id in t.exitPnl) {
        d.pnl += t.exitPnl[f.id];
        d.exits += 1;
      }
      days.set(f.date, d);
    }
  }
  return days;
}

export interface PeriodStats {
  pnl: number;
  trades: number; // trades with a realized exit in the period
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  best: number | null;
  worst: number | null;
}

/** Stats over trades with realized exits within [from, to] (inclusive ISO
 *  dates; omit for all time). A trade counts once, dated by its latest exit,
 *  using the P&L realized so far — so a position trimmed but still held counts
 *  as a win or loss now, and moves to the later period if it is later closed
 *  out. `pnl` sums realized exits in the window itself. */
export function periodStats(
  trades: JournalTrade[],
  from?: string,
  to?: string,
): PeriodStats {
  const inRange = (d: string) =>
    (!from || d >= from) && (!to || d <= to);
  let pnl = 0;
  const closedPnls: number[] = [];
  for (const t of trades) {
    for (const f of t.fills) {
      if (f.id in t.exitPnl && inRange(f.date)) pnl += t.exitPnl[f.id];
    }
    if (t.lastExitDate && inRange(t.lastExitDate)) closedPnls.push(t.realizedPnl);
  }
  const wins = closedPnls.filter((p) => p > 0);
  const losses = closedPnls.filter((p) => p <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    pnl,
    trades: closedPnls.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closedPnls.length ? wins.length / closedPnls.length : null,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    best: closedPnls.length ? Math.max(...closedPnls) : null,
    worst: closedPnls.length ? Math.min(...closedPnls) : null,
  };
}

/** Cumulative realized P&L by day, oldest first, for the equity curve. */
export function equityCurve(
  days: Map<string, DaySummary>,
): { date: string; cum: number }[] {
  let cum = 0;
  return [...days.values()]
    .filter((d) => d.exits > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, cum: (cum += d.pnl) }));
}

// ── Tags, filters and reviews ────────────────────────────────────────────

/** Tags offered as one-click chips in the note editor. */
export const SUGGESTED_TAGS = [
  "breakout",
  "earnings",
  "dip buy",
  "plan followed",
  "fomo",
  "early exit",
  "chased",
  "no plan",
  "oversized",
];

/** Tags that mark a mistake; the Reports tab totals what they cost. */
export const MISTAKE_TAGS = new Set([
  "mistake",
  "fomo",
  "early exit",
  "chased",
  "revenge",
  "no plan",
  "oversized",
]);

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return [...seen];
}

export interface NoteLike {
  reflection: string | null;
  lesson: string | null;
  tags: string | null;
}

export type NoteMap = Map<string, NoteLike>;

export function hasNote(n: NoteLike | undefined): boolean {
  return !!n && !!(n.reflection?.trim() || n.lesson?.trim() || n.tags?.trim());
}

/** A trade is awaiting review when it has realized something but has no
 *  reflection, lesson or tag yet. */
export function needsReview(t: JournalTrade, notes: NoteMap): boolean {
  return t.lastExitDate != null && !hasNote(notes.get(t.key));
}

export interface TradeFilter {
  ticker: string;
  status: "all" | "win" | "loss" | "partial" | "open";
  tag: string; // "" = any
  from: string; // inclusive ISO date of the latest exit/open; "" = any
  to: string;
  unreviewedOnly: boolean;
}

export const EMPTY_FILTER: TradeFilter = {
  ticker: "",
  status: "all",
  tag: "",
  from: "",
  to: "",
  unreviewedOnly: false,
};

export function isFilterActive(f: TradeFilter): boolean {
  return (
    f.ticker.trim() !== "" ||
    f.status !== "all" ||
    f.tag !== "" ||
    f.from !== "" ||
    f.to !== "" ||
    f.unreviewedOnly
  );
}

export function filterTrades(
  trades: JournalTrade[],
  f: TradeFilter,
  notes: NoteMap,
): JournalTrade[] {
  const ticker = f.ticker.trim().toUpperCase();
  return trades.filter((t) => {
    if (ticker && !t.ticker.toUpperCase().includes(ticker)) return false;
    if (f.status !== "all" && t.status !== f.status) return false;
    if (f.tag && !parseTags(notes.get(t.key)?.tags).includes(f.tag)) return false;
    const when = t.lastExitDate ?? t.openDate;
    if (f.from && when < f.from) return false;
    if (f.to && when > f.to) return false;
    if (f.unreviewedOnly && !needsReview(t, notes)) return false;
    return true;
  });
}

export function allTags(notes: NoteMap): string[] {
  const set = new Set<string>();
  for (const n of notes.values()) parseTags(n.tags).forEach((t) => set.add(t));
  return [...set].sort();
}

// ── Grouped reports ──────────────────────────────────────────────────────

export interface GroupRow {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** Average realized P&L per trade. */
  expectancy: number;
  pnl: number;
}

/** Trades that have realized something — the unit every report counts. */
export function realizedTrades(trades: JournalTrade[]): JournalTrade[] {
  return trades.filter((t) => t.lastExitDate != null);
}

function rowFor(key: string, list: JournalTrade[]): GroupRow {
  const pnls = list.map((t) => t.realizedPnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return {
    key,
    trades: list.length,
    wins: wins.length,
    winRate: list.length ? wins.length / list.length : 0,
    avgWin: wins.length ? sum(wins) / wins.length : 0,
    avgLoss: losses.length ? sum(losses) / losses.length : 0,
    expectancy: list.length ? sum(pnls) / list.length : 0,
    pnl: sum(pnls),
  };
}

/** Group realized trades by one or more keys (a trade with several tags lands
 *  in each tag's group). Rows come back sorted by total P&L, best first. */
export function groupReport(
  trades: JournalTrade[],
  keysOf: (t: JournalTrade) => string[],
): GroupRow[] {
  const groups = new Map<string, JournalTrade[]>();
  for (const t of realizedTrades(trades)) {
    for (const k of keysOf(t)) {
      const list = groups.get(k) ?? [];
      list.push(t);
      groups.set(k, list);
    }
  }
  return [...groups].map(([k, l]) => rowFor(k, l)).sort((a, b) => b.pnl - a.pnl);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayOf(isoDate: string): string {
  return WEEKDAYS[new Date(isoDate + "T00:00:00Z").getUTCDay()];
}

export const WEEKDAY_ORDER = WEEKDAYS.slice(1, 6);

export function holdBucket(days: number): string {
  if (days === 0) return "Same day";
  if (days <= 6) return "1–6 days";
  if (days <= 29) return "1–4 weeks";
  if (days <= 89) return "1–3 months";
  return "3+ months";
}

export const HOLD_ORDER = ["Same day", "1–6 days", "1–4 weeks", "1–3 months", "3+ months"];

export interface MistakeCost {
  mistakeTrades: number;
  mistakePnl: number;
  otherTrades: number;
  otherPnl: number;
}

/** What trades carrying a mistake tag cost compared with the rest. */
export function mistakeCost(trades: JournalTrade[], notes: NoteMap): MistakeCost {
  const out: MistakeCost = { mistakeTrades: 0, mistakePnl: 0, otherTrades: 0, otherPnl: 0 };
  for (const t of realizedTrades(trades)) {
    const isMistake = parseTags(notes.get(t.key)?.tags).some((x) => MISTAKE_TAGS.has(x));
    if (isMistake) {
      out.mistakeTrades += 1;
      out.mistakePnl += t.realizedPnl;
    } else {
      out.otherTrades += 1;
      out.otherPnl += t.realizedPnl;
    }
  }
  return out;
}

export function pnlBuckets(
  trades: JournalTrade[],
  count = 8,
): { lo: number; hi: number; n: number }[] {
  const pnls = realizedTrades(trades).map((t) => t.realizedPnl);
  if (pnls.length === 0) return [];
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);
  if (min === max) return [{ lo: min, hi: max, n: pnls.length }];
  const step = (max - min) / count;
  const buckets = Array.from({ length: count }, (_, i) => ({
    lo: min + i * step,
    hi: min + (i + 1) * step,
    n: 0,
  }));
  for (const p of pnls) {
    buckets[Math.min(count - 1, Math.floor((p - min) / step))].n += 1;
  }
  return buckets;
}

// ── Dividends and fees ───────────────────────────────────────────────────

export interface IncomeEvent {
  kind: string;
  ticker: string | null;
  amount: number; // signed: dividends/interest positive, fees negative
  occurred_at: string;
}

/** Dividends, interest and fees for a ticker while a trade was on. Sale
 *  proceeds are excluded — they are the trade itself, not extra return. */
export function tradeIncome(t: JournalTrade, events: IncomeEvent[]): number {
  const end = t.closeDate ?? "9999-12-31";
  return events
    .filter(
      (e) =>
        e.kind !== "sale" &&
        e.ticker === t.ticker &&
        e.occurred_at >= t.openDate &&
        e.occurred_at <= end,
    )
    .reduce((s, e) => s + e.amount, 0);
}

/** All dividends/interest/fees dated within the window, any ticker. */
export function periodIncome(events: IncomeEvent[], from?: string, to?: string): number {
  return events
    .filter(
      (e) =>
        e.kind !== "sale" && (!from || e.occurred_at >= from) && (!to || e.occurred_at <= to),
    )
    .reduce((s, e) => s + e.amount, 0);
}

// ── Peak and drawdown during the hold ────────────────────────────────────

export interface DailyBar {
  date: string; // YYYY-MM-DD
  high: number;
  low: number;
  close: number;
}

export interface Excursion {
  /** Best price reached during the hold, as % above average entry. */
  mfePct: number;
  /** Worst price reached during the hold, as % below average entry (≤ 0). */
  maePct: number;
  peakPrice: number;
  /** Share of the peak gain captured by the exit; null when the trade never
   *  traded above entry. Capped at 100%, may be negative. */
  exitEfficiency: number | null;
  /** Peak gain given back by selling below the high, in dollars. */
  gaveBack: number;
}

/** Peak/drawdown from daily bars across the hold. Daily highs and lows can
 *  predate the buy or follow the sell on those days, so the numbers lean a
 *  little generous; same-day trades are skipped because they cannot be told
 *  apart from a single bar. Only trades that have exited qualify. */
export function computeExcursion(t: JournalTrade, bars: DailyBar[]): Excursion | null {
  if (t.avgExit == null) return null;
  if (t.closeDate == null || t.holdDays === 0) return null;
  const window = bars.filter((b) => b.date >= t.openDate && b.date <= t.closeDate!);
  if (window.length === 0) return null;
  const peak = Math.max(...window.map((b) => b.high));
  const trough = Math.min(...window.map((b) => b.low));
  const entry = t.avgEntry;
  const mfePct = ((peak - entry) / entry) * 100;
  const maePct = Math.min(0, ((trough - entry) / entry) * 100);
  const room = peak - entry;
  return {
    mfePct: Math.max(0, mfePct),
    maePct,
    peakPrice: peak,
    exitEfficiency: room > 0 ? Math.min(1, (t.avgExit - entry) / room) : null,
    gaveBack: Math.max(0, (peak - t.avgExit) * t.totalSold),
  };
}

/** Yahoo range wide enough to cover a date, with a margin for context. */
export function rangeCovering(fromDate: string, today = new Date()): string {
  const from = Date.parse(fromDate + "T00:00:00Z") - 45 * 86_400_000;
  const days = (today.getTime() - from) / 86_400_000;
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  if (days <= 730) return "2y";
  if (days <= 1825) return "5y";
  if (days <= 3650) return "10y";
  return "max";
}

// ── CSV export ───────────────────────────────────────────────────────────

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tradesToCsv(
  trades: JournalTrade[],
  notes: NoteMap,
  income: (t: JournalTrade) => number | null,
): string {
  const header = [
    "ticker", "status", "opened", "last_exit", "closed", "shares_bought", "shares_sold",
    "avg_entry", "avg_exit", "realized_pnl", "dividends_and_fees", "hold_days",
    "tags", "reflection", "lesson",
  ];
  const rows = trades.map((t) => {
    const n = notes.get(t.key);
    return [
      t.ticker, t.status, t.openDate, t.lastExitDate, t.closeDate, t.totalBought, t.totalSold,
      t.avgEntry.toFixed(4), t.avgExit?.toFixed(4) ?? null, t.realizedPnl.toFixed(2),
      income(t)?.toFixed(2) ?? null, t.holdDays,
      n?.tags ?? null, n?.reflection ?? null, n?.lesson ?? null,
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...rows].join("\n");
}
