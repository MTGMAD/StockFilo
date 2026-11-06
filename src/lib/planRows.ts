/**
 * planRows.ts — make a retirement plan's history add up.
 *
 * Plan record-keepers report activity differently from a brokerage: no buys or
 * sells, only contribution, fee and transfer rows carrying shares. Three things
 * in those rows would otherwise read as something they aren't:
 *
 *  - A fund exchange is a transfer out of one fund and a "contribution" of the
 *    same amount into another, so it looks like new money.
 *  - A plan-only fund can arrive with no symbol at all, though every row still
 *    has shares and a price, and that price follows one fund from row to row.
 *  - A fund's price can drop with no row to say why. When a plan swaps a fund
 *    for a new one, the old rows stop with no exit and the new fund opens with
 *    a "deposit" of the balance. A split looks the same, with a "deposit" of
 *    only the extra shares: a real 16-for-1 split arrived as $15,491 of deposits
 *    that the plan's own statement doesn't have.
 *
 * All of this is worked out from the rows, never from a plan's or account's
 * name. Rows that can't be tied to anything are left alone, and the account's
 * start then reports itself as incomplete rather than guessing.
 */
import type { BrokerPosition, BrokerTransaction } from "../types";

export interface ReconciledRows {
  /** What the brokerage reported, with exchanges marked as transfers and
   *  unnamed rows showing the fund they belong to. Amounts are untouched. */
  shown: BrokerTransaction[];
  /** The same, restated so shares add up: rows from before a split in today's
   *  units, plus the entries a fund conversion leaves unreported. For
   *  calculating only: these were never reported in this form. */
  ledger: BrokerTransaction[];
}

/** Largest price move between one fund's rows. A fund's rows are at most weeks
 *  apart: real ones moved 11% across a large distribution, and the closest two
 *  different funds were 18% apart. */
const SERIES_JUMP = 0.15;
/** Below a dollar an amount's rounding swamps its implied price, so the row can
 *  join a fund but says nothing about that fund's price. */
const ROUNDING_NOISE = 1;
/** How far a fund's share total can be from a holding and still be that holding:
 *  a just-posted monthly fee that the history hasn't delivered yet. */
const SHARE_MATCH = 0.001;
/** Last row's price against a holding's price today, for the one fund left. */
const LAST_PRICE_MATCH = 0.1;
const CONVERSION_WINDOW_DAYS = 30;
/** A split's ratio from prices days apart, against the whole number it must be. */
const SPLIT_RATIO_MATCH = 0.1;
/** The shares a split must have started from, against what the holding implies. */
const SPLIT_SHARES_MATCH = 0.01;

interface Series {
  rows: BrokerTransaction[];
  price: number;
  shares: number;
  holding?: BrokerPosition;
}

export function unitPrice(t: BrokerTransaction): number | null {
  if (t.price != null && t.price > 0) return t.price;
  if (t.amount != null && t.qty) return Math.abs(t.amount / t.qty);
  return null;
}

const cents = (amount: number) => Math.round(Math.abs(amount) * 100);
const movesShares = (t: BrokerTransaction) => t.qty != null && t.qty !== 0;
const holdingKey = (p: BrokerPosition) => p.ticker ?? p.provider_symbol;

/** Each same-day, same-amount pair of shares leaving and arriving is one move. */
function markExchanges(transactions: BrokerTransaction[]): BrokerTransaction[] {
  const out = new Map<string, number>();
  for (const t of transactions) {
    if (t.kind === "transfer" && movesShares(t) && t.amount != null && t.amount < 0) {
      const key = `${t.occurred_at}|${cents(t.amount)}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return transactions.map((t) => {
    if (t.kind !== "deposit" || !movesShares(t) || t.amount == null || t.amount <= 0) return t;
    const key = `${t.occurred_at}|${cents(t.amount)}`;
    const left = out.get(key) ?? 0;
    if (left === 0) return t;
    out.set(key, left - 1);
    return { ...t, kind: "transfer" };
  });
}

/** Group unnamed rows by the fund their prices follow. Oldest first, largest
 *  first within a day, so a day's real rows set the price its noisy ones join. */
function groupByPrice(rows: BrokerTransaction[]): Series[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.occurred_at.localeCompare(b.occurred_at) ||
      Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0),
  );
  const series: Series[] = [];
  for (const t of ordered) {
    const price = unitPrice(t);
    if (price == null) continue;
    let closest: Series | null = null;
    let gap = Infinity;
    for (const s of series) {
      const g = Math.abs(Math.log(price / s.price));
      if (g < gap) {
        gap = g;
        closest = s;
      }
    }
    const noise = Math.abs(t.amount ?? 0) < ROUNDING_NOISE;
    if (!closest || (gap > SERIES_JUMP && !noise)) {
      series.push({ rows: [t], price, shares: t.qty!, holding: undefined });
      continue;
    }
    closest.rows.push(t);
    closest.shares += t.qty!;
    if (!noise) closest.price = price;
  }
  return series;
}

/** Tie each fund to a holding that no named row explains: by share count, and
 *  then by price for a last fund and a last holding that didn't match exactly
 *  (a holding with shares from before its rows begin). */
function matchHoldings(series: Series[], open: BrokerPosition[]) {
  const free = new Set(open);
  for (const s of [...series].sort((a, b) => b.shares - a.shares)) {
    const holding = [...free].find(
      (p) => Math.abs(p.qty - s.shares) <= Math.max(SHARE_MATCH * p.qty, 0.01),
    );
    if (holding) {
      s.holding = holding;
      free.delete(holding);
    }
  }
  const unmatched = series.filter((s) => !s.holding && s.shares > 0);
  const live = unmatched.filter((s) => {
    const last = free.size === 1 ? [...free][0].current_price : null;
    return last != null && Math.abs(last - s.price) / s.price <= LAST_PRICE_MATCH;
  });
  if (live.length === 1 && free.size === 1) live[0].holding = [...free][0];
}

/** The ratio if these rows are a split: the extra shares are what the old count
 *  gains, and only that old count is missing from the new fund's own rows. */
function splitRatio(oldPrice: number, newPrice: number, extra: number, missing: number): number | null {
  const ratio = Math.round(oldPrice / newPrice);
  if (ratio < 2 || Math.abs(oldPrice / newPrice / ratio - 1) > SPLIT_RATIO_MATCH) return null;
  const before = extra / (ratio - 1);
  return Math.abs(missing - before) <= before * SPLIT_SHARES_MATCH ? ratio : null;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function reconcileRows(
  positions: BrokerPosition[],
  transactions: BrokerTransaction[],
): ReconciledRows {
  // An account with real trades names its rows and reports its own moves.
  if (transactions.some((t) => t.kind === "fill")) {
    return { shown: transactions, ledger: transactions };
  }

  const marked = markExchanges(transactions);
  const unnamed = marked.filter((t) => !t.provider_symbol && movesShares(t));
  if (unnamed.length === 0) return { shown: marked, ledger: marked };

  const usedSymbols = new Set(marked.map((t) => t.provider_symbol));
  const open = positions.filter(
    (p) => !usedSymbols.has(p.provider_symbol) && !(p.ticker && usedSymbols.has(p.ticker)),
  );
  const series = groupByPrice(unnamed);
  matchHoldings(series, open);

  const relabel = new Map<BrokerTransaction, Partial<BrokerTransaction>>();
  /** How a row differs in the ledger; null leaves it out altogether. */
  const restate = new Map<BrokerTransaction, Partial<BrokerTransaction> | null>();
  const unreported: BrokerTransaction[] = [];

  series.forEach((s, i) => {
    if (s.holding) {
      const symbol = holdingKey(s.holding);
      for (const t of s.rows) {
        relabel.set(t, { ...relabel.get(t), provider_symbol: symbol, ticker: s.holding.ticker ?? null });
      }
      return;
    }
    if (s.shares <= 0) return;
    // A fund with shares, no holding and no way out. Its balance has to have
    // gone somewhere, and its rows belong to no holding either.
    const symbol = `unnamed-${i + 1}`;
    for (const t of s.rows) restate.set(t, { provider_symbol: symbol, ticker: null });

    const lastDay = s.rows[s.rows.length - 1].occurred_at;
    const successors = series.filter((next) => {
      if (next === s || !next.holding) return false;
      const days = daysBetween(lastDay, next.rows[0].occurred_at);
      return (
        days > 0 &&
        days <= CONVERSION_WINDOW_DAYS &&
        next.rows
          .filter((t) => t.occurred_at === next.rows[0].occurred_at)
          .every((t) => t.kind === "deposit")
      );
    });
    if (successors.length !== 1) return;

    // The new fund opens with the old balance. It may hold more than its rows
    // explain, and those shares can only have come across in the same move.
    const next = successors[0];
    const holding = next.holding!;
    const day = next.rows[0].occurred_at;
    const opening = next.rows.filter((t) => t.occurred_at === day);
    const missing = Math.max(0, holding.qty - next.shares);
    const missingValue = missing * next.rows[0].price!;
    const moved = opening.reduce((sum, t) => sum + (t.amount ?? 0), 0) + missingValue;
    const newSymbol = holdingKey(holding);

    for (const t of s.rows) {
      relabel.set(t, { provider_symbol: newSymbol, ticker: holding.ticker ?? null });
    }

    // A split moved no money, and it's one fund throughout: the old rows just
    // count shares in old units, and the extra shares are already in those.
    const ratio = splitRatio(
      s.price,
      unitPrice(opening[0])!,
      opening.reduce((sum, t) => sum + t.qty!, 0),
      missing,
    );
    if (ratio != null) {
      for (const t of opening) {
        relabel.set(t, { ...relabel.get(t), kind: "split" });
        restate.set(t, null);
      }
      for (const t of s.rows) {
        restate.set(t, {
          qty: t.qty! * ratio,
          price: t.price != null ? t.price / ratio : t.price,
        });
      }
      return;
    }

    for (const t of opening) {
      relabel.set(t, { ...relabel.get(t), kind: "transfer" });
    }
    const entry = {
      ...opening[0],
      id: -1 - unreported.length,
      kind: "transfer",
      occurred_at: day,
    };
    unreported.push({
      ...entry,
      provider_symbol: symbol,
      ticker: null,
      qty: -moved / s.price,
      price: s.price,
      amount: -moved,
    });
    if (missing > 0) {
      unreported.push({
        ...entry,
        id: -1 - unreported.length,
        provider_symbol: newSymbol,
        ticker: holding.ticker ?? null,
        qty: missing,
        price: next.rows[0].price,
        amount: missingValue,
      });
    }
  });

  const shown = marked.map((t) => {
    const change = relabel.get(t);
    return change ? { ...t, ...change } : t;
  });
  const ledger = marked.flatMap((t, i) => {
    const change = restate.get(t);
    if (change === null) return [];
    return [change ? { ...shown[i], ...change } : shown[i]];
  });
  return { shown, ledger: [...ledger, ...unreported] };
}
