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
