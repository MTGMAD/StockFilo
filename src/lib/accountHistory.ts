/**
 * accountHistory.ts — a real gain for accounts older than their synced history.
 *
 * A brokerage only hands over so much history (about two years through
 * SnapTrade), and for holdings older than that its cost basis can be missing
 * or nonsense: $1,240 of cost on $600,689 of a fund the same account bought
 * $114,265 of inside that history. The original cost may never be obtainable,
 * but the gain since the history begins always is:
 *
 *   starting shares = shares now - what the history added
 *   starting value  = starting shares x price on the history's first day
 *   gain            = value now - starting value - money added + money taken out
 *   percent         = gain / (starting value + money added)
 *
 * Money taken out stays out of the percentage: a withdrawal doesn't shrink what
 * the account started with, and subtracting it would flatter the return.
 *
 * Nothing here looks at account type or brokerage. An account counts as older
 * than its history only because its shares don't add up without an opening
 * balance; one whose trades explain every share is left alone and keeps the
 * brokerage's own cost basis.
 */
import type { BrokerPosition, BrokerTransaction, TickerSummary } from "../types";
import { fetchPriceOnDate } from "./db";
import { unitPrice } from "./planRows";

/** What a holding or account started with and what has crossed its edge. */
export interface StartFigures {
  start: number;
  added: number;
  takenOut: number;
}

export type HistoryStart =
  | {
      complete: true;
      since: string; // YYYY-MM-DD
      account: StartFigures;
      /** Per holding, keyed by its summary ticker. */
      byTicker: Map<string, StartFigures>;
      /** Plan code in the history → ticker of the holding it is. */
      aliases: Map<string, string>;
    }
  | {
      /** Older than its history, but a starting value can't be worked out. */
      complete: false;
      since: string;
      aliases: Map<string, string>;
    };

export interface AccountGain {
  since: string;
  /** What the account held the day its history begins. */
  startValue: number;
  added: number;
  takenOut: number;
  gain: number;
  gainPct: number | null;
}

type PriceOn = (ticker: string, date: string) => Promise<number | null>;

/** Largest gap between a row's unit price and a fund's market price that still
 *  counts as the same fund. Matched funds in real plan data were within 0.09%,
 *  and the next closest at least 9% away. */
const PRICE_TOLERANCE = 0.005;
/** A rounding difference in shares, not an opening balance. */
const SHARE_TOLERANCE = 0.01;
/** A market close this far from what the brokerage reported the same day isn't
 *  the same units, whatever ticker the brokerage attached to them. */
const WRONG_UNITS = 0.1;
/** History can lag holdings by a day, so a just-reinvested dividend looks like
 *  shares from nowhere. Old holdings must be worth this share of the account
 *  before it's treated as older than its history. */
const MATERIAL_SHARE = 0.01;

const keyOf = (p: BrokerPosition) => p.ticker ?? p.provider_symbol;
/** A $1 money-market position, whose share count is really a cash balance. */
const isSweep = (p: BrokerPosition) => p.current_price === 1;

/** Plan accounts report no buys or sells: shares change through dividend, fee
 *  and exchange rows instead. In an account with trades those rows' share
 *  counts mean something else (Alpaca's dividends quote the shares held), so
 *  only trades and splits count there. */
function changesShares(t: BrokerTransaction, hasFills: boolean): boolean {
  if (t.qty == null || t.qty === 0) return false;
  if (hasFills) return t.kind === "fill" || t.kind === "split";
  return t.kind !== "realized";
}

function signedQty(t: BrokerTransaction): number {
  const qty = t.qty ?? 0;
  return t.kind === "fill" && t.side === "sell" ? -Math.abs(qty) : qty;
}

/** Ties a row to the holding it belongs to, by whichever symbol it uses. */
function rowKeyer(positions: BrokerPosition[], aliases: Map<string, string>) {
  const bySymbol = new Map(positions.map((p) => [p.provider_symbol, keyOf(p)]));
  return (t: BrokerTransaction) =>
    aliases.get(t.provider_symbol) ??
    bySymbol.get(t.provider_symbol) ??
    t.ticker ??
    t.provider_symbol;
}

/** Holdings the history can't account for: shares now minus shares it added,
 *  including funds since sold out of. */
function openingShares(
  positions: BrokerPosition[],
  transactions: BrokerTransaction[],
  aliases: Map<string, string>,
): Map<string, number> {
  const hasFills = transactions.some((t) => t.kind === "fill");
  const key = rowKeyer(positions, aliases);
  const added = new Map<string, number>();
  for (const t of transactions) {
    if (!t.provider_symbol || !changesShares(t, hasFills)) continue;
    const k = key(t);
    added.set(k, (added.get(k) ?? 0) + signedQty(t));
  }
  const opening = new Map<string, number>();
  for (const p of positions) {
    const k = keyOf(p);
    opening.set(k, p.qty - (added.get(k) ?? 0));
    added.delete(k);
  }
  for (const [k, qty] of added) opening.set(k, -qty);
  return opening;
}

/** Each holding's oldest row with a price: as close as the history gets to
 *  what the holding was worth when it begins. */
function oldestPrices(
  transactions: BrokerTransaction[],
  key: (t: BrokerTransaction) => string,
): Map<string, { price: number; date: string }> {
  const oldest = new Map<string, { price: number; date: string }>();
  for (const t of transactions) {
    const price = t.provider_symbol ? unitPrice(t) : null;
    if (price == null) continue;
    const k = key(t);
    const seen = oldest.get(k);
    if (!seen || t.occurred_at < seen.date) oldest.set(k, { price, date: t.occurred_at });
  }
  return oldest;
}

function hasMaterialOpening(
  positions: BrokerPosition[],
  transactions: BrokerTransaction[],
  aliases: Map<string, string>,
): boolean {
  const accountValue = positions.reduce((s, p) => s + (p.market_value ?? 0), 0);
  if (accountValue <= 0) return false;
  const byKey = new Map(positions.map((p) => [keyOf(p), p]));
  const prices = oldestPrices(transactions, rowKeyer(positions, aliases));
  let value = 0;
  for (const [k, qty] of openingShares(positions, transactions, aliases)) {
    if (qty <= SHARE_TOLERANCE) continue;
    const p = byKey.get(k);
    if (p && isSweep(p)) continue;
    value += qty * (p?.current_price ?? prices.get(k)?.price ?? 0);
  }
  return value >= accountValue * MATERIAL_SHARE;
}

/** Whether an account holds more than its history explains. Synchronous, so a
 *  bad cost basis is hidden from the first render rather than flashing up
 *  while the starting prices load. */
export function startsBeforeHistory(
  positions: BrokerPosition[],
  transactions: BrokerTransaction[],
): boolean {
  if (positions.length === 0 || transactions.length === 0) return false;
  return hasMaterialOpening(positions, transactions, new Map());
}

/**
 * Match a plan's own fund codes (OUZ2) to the tickers its positions use
 * (OIEJX) by unit price: a row's amount over its shares is the fund's price
 * that day, which no other holding shares. Only for accounts without trades,
 * where those codes appear. A code with no match is a fund since sold.
 */
async function matchPlanCodes(
  positions: BrokerPosition[],
  transactions: BrokerTransaction[],
  priceOn: PriceOn,
): Promise<Map<string, string>> {
  const aliases = new Map<string, string>();
  if (transactions.some((t) => t.kind === "fill")) return aliases;

  const named = new Set(positions.flatMap((p) => [p.provider_symbol, p.ticker]));
  const latest = new Map<string, { date: string; price: number }>();
  for (const t of transactions) {
    const price = unitPrice(t);
    if (!t.provider_symbol || price == null || named.has(t.provider_symbol)) continue;
    const seen = latest.get(t.provider_symbol);
    if (!seen || t.occurred_at > seen.date) {
      latest.set(t.provider_symbol, { date: t.occurred_at, price });
    }
  }

  const used = new Set(transactions.map((t) => t.provider_symbol));
  const open = positions.filter(
    (p) => p.ticker && !used.has(p.provider_symbol) && !used.has(p.ticker),
  );
  for (const [code, { date, price }] of latest) {
    const close: string[] = [];
    for (const p of open) {
      if (aliases.has(code) || [...aliases.values()].includes(p.ticker!)) continue;
      const market = await priceOn(p.ticker!, date);
      if (market != null && Math.abs(market - price) / price <= PRICE_TOLERANCE) {
        close.push(p.ticker!);
      }
    }
    if (close.length === 1) aliases.set(code, close[0]);
  }
  return aliases;
}

/** A plan-only fund Yahoo has never heard of simply has no price. Anything else
 *  (the network, a rate limit) throws, so the next sync can try again rather
 *  than this settling on an answer it only reached by failing. */
function orNoPrice(priceOn: PriceOn): PriceOn {
  return (ticker, date) =>
    priceOn(ticker, date).catch((e) => {
      if (/404|No data/i.test(String(e))) return null;
      throw e;
    });
}

function addFlow(figures: StartFigures, amount: number) {
  if (amount >= 0) figures.added += amount;
  else figures.takenOut -= amount;
}

export async function resolveHistoryStart(
  positions: BrokerPosition[],
  transactions: BrokerTransaction[],
  cash: number | null,
  lookUpPrice: PriceOn = cachedPriceOn,
): Promise<HistoryStart | null> {
  if (positions.length === 0 || transactions.length === 0) return null;

  const priceOn = orNoPrice(lookUpPrice);
  const aliases = await matchPlanCodes(positions, transactions, priceOn);
  if (!hasMaterialOpening(positions, transactions, aliases)) return null;

  const since = transactions.reduce(
    (min, t) => (t.occurred_at < min ? t.occurred_at : min),
    transactions[0].occurred_at,
  );
  const incomplete: HistoryStart = { complete: false, since, aliases };

  const hasFills = transactions.some((t) => t.kind === "fill");
  // Shares that belong to no fund can't be put back on any holding, and the
  // history can't say what a separately reported cash balance started at.
  if (transactions.some((t) => !t.provider_symbol && changesShares(t, hasFills))) {
    return incomplete;
  }
  if (cash != null && Math.abs(cash) >= 1) return incomplete;

  const byKey = new Map(positions.map((p) => [keyOf(p), p]));
  const key = rowKeyer(positions, aliases);
  const rowPrices = oldestPrices(transactions, key);

  const byTicker = new Map<string, StartFigures>();
  const figuresFor = (k: string) => {
    let f = byTicker.get(k);
    if (!f) byTicker.set(k, (f = { start: 0, added: 0, takenOut: 0 }));
    return f;
  };
  const account: StartFigures = { start: 0, added: 0, takenOut: 0 };

  for (const [k, qty] of openingShares(positions, transactions, aliases)) {
    const p = byKey.get(k);
    const row = rowPrices.get(k);
    // Shares that arrived and then vanished: a fund that left with no exit row,
    // whose balance the history can't say anything about.
    if (!p && qty * (row?.price ?? 0) < -1) return incomplete;
    const figures = figuresFor(k);
    if (qty <= SHARE_TOLERANCE) continue;
    // A code with no holding isn't a ticker, and could be someone else's.
    const market = p?.ticker ? await priceOn(p.ticker, since) : null;
    const sameDay = market != null && row ? await priceOn(p!.ticker!, row.date) : null;
    const trusted =
      market != null &&
      (sameDay == null || row == null || Math.abs(sameDay - row.price) / row.price <= WRONG_UNITS);
    const price = trusted ? market : p && isSweep(p) ? 1 : row?.price;
    if (price == null) return incomplete;
    figures.start = qty * price;
    account.start += figures.start;
  }

  // Money moved between holdings: a trade's cost, or an exchange. A reinvested
  // dividend isn't one, so what it earned counts toward the gain.
  for (const t of transactions) {
    let flow: number | null = null;
    if (hasFills) {
      if (t.kind === "fill" && !t.reinvested && t.qty != null && t.price != null) {
        flow = signedQty(t) * t.price;
      }
    } else if (t.provider_symbol && ["deposit", "withdrawal", "transfer"].includes(t.kind)) {
      flow = t.amount;
    }
    if (flow != null) addFlow(figuresFor(key(t)), flow);
    // Money crossing the account's edge. Tax withheld left the account too.
    const external =
      ["deposit", "withdrawal", "tax"].includes(t.kind) ||
      (t.kind === "transfer" && !t.provider_symbol);
    if (external && t.amount != null) addFlow(account, t.amount);
  }

  return { complete: true, since, account, byTicker, aliases };
}

/** Rewrite summaries so an old account's figures are measured from the start
 *  of its history, not against a cost basis that can't be trusted. */
export function applyHistoryStart(
  summaries: TickerSummary[],
  start: HistoryStart | null,
  startsBefore: boolean,
): TickerSummary[] {
  if (!start && !startsBefore) return summaries;
  return summaries.map((s) => {
    const figures = start?.complete ? (start.byTicker.get(s.ticker) ?? null) : null;
    if (!start?.complete || s.marketValue == null) {
      return { ...s, totalInvested: null, avgCostBasis: null, pnlDollar: null, pnlPercent: null };
    }
    // A money-market fund's balance swings with every sweep: what matters is
    // the net, and a percentage of what's left in it says nothing.
    const sweep = s.currentPrice === 1;
    const startValue = figures?.start ?? 0;
    const inFlow = figures?.added ?? 0;
    const outFlow = figures?.takenOut ?? 0;
    const added = sweep ? Math.max(inFlow - outFlow, 0) : inFlow;
    const takenOut = sweep ? Math.max(outFlow - inFlow, 0) : outFlow;
    const invested = startValue + added;
    const gain = s.marketValue - invested + takenOut;
    return {
      ...s,
      totalInvested: invested,
      avgCostBasis: null,
      pnlDollar: gain,
      pnlPercent: invested > 0 && !sweep ? (gain / invested) * 100 : null,
      gainSince: start.since,
      startValue,
      addedSince: added,
      takenOutSince: takenOut,
    };
  });
}

/** The whole account's gain, which unlike the summaries includes funds since
 *  sold. Null until every holding has a value. */
export function accountGain(
  summaries: TickerSummary[],
  start: HistoryStart | null,
): AccountGain | null {
  if (!start?.complete || summaries.length === 0) return null;
  let value = 0;
  for (const s of summaries) {
    if (s.marketValue == null) return null;
    value += s.marketValue;
  }
  const { start: startValue, added, takenOut } = start.account;
  const gain = value - startValue - added + takenOut;
  const invested = startValue + added;
  return {
    since: start.since,
    startValue,
    added,
    takenOut,
    gain,
    gainPct: invested > 0 ? (gain / invested) * 100 : null,
  };
}

// A past close doesn't change, and every sync re-resolves.
const closes = new Map<string, Promise<number | null>>();

function cachedPriceOn(ticker: string, date: string): Promise<number | null> {
  const key = `${ticker}|${date}`;
  const hit = closes.get(key);
  if (hit) return hit;
  const p = fetchPriceOnDate(ticker, date).catch((e) => {
    closes.delete(key); // a failure shouldn't be remembered
    throw e;
  });
  closes.set(key, p);
  return p;
}
