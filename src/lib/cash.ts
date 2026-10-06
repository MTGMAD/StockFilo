import type { CashAnchor, CashEvent, Purchase } from "../types";

/** A completed row from an account-activity export, reduced to what cash needs. */
export interface ActivityRow {
  date: string; // YYYY-MM-DD
  description: string;
  /** Signed cash effect: buys and fees negative; sales, dividends, interest positive. */
  amount: number;
  quantity: number | null;
}

/** "$1,234.50", "-$8,041.26" and "($8,041.26)" → signed number; null if blank/garbled. */
export function parseSignedAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const negative = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  const n = parseFloat(s.replace(/[$,()\-\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const isSweepInterest = (d: string) =>
  /^INTEREST PAYMENT/i.test(d) && /MONEY MARKET/i.test(d);

export interface CalibratedCash {
  asOf: string;
  balance: number;
  /** Date of the sweep-interest row whose balance the calculation started from. */
  sweepDate: string;
}

/**
 * Cash balance implied by an activity export, with no input from the person.
 *
 * Each month-end sweep-interest row states the cash sweep's balance (its
 * Quantity, in $1 shares). Starting from the latest one and adding every
 * signed amount after it gives the balance on the export's last day. Checked
 * against twelve months of real exports, the change between consecutive
 * month-end balances matched the sum of the amounts between them to within
 * about a dollar (the sweep balance is a whole number of shares).
 *
 * Returns null when the export holds no sweep-interest row — a short export
 * can't say what the balance was, and guessing would be worse than leaving
 * the previous calibration in place.
 */
export function calibrateCash(
  rows: ActivityRow[],
  endDate: string | null,
): CalibratedCash | null {
  const sweeps = rows.filter(
    (r) => isSweepInterest(r.description) && r.quantity != null && r.quantity > 0,
  );
  if (sweeps.length === 0) return null;
  const latest = sweeps.reduce((a, b) => (b.date > a.date ? b : a));
  const lastRow = rows.reduce((m, r) => (r.date > m ? r.date : m), latest.date);
  const asOf = endDate && endDate >= lastRow ? endDate : lastRow;
  const after = rows
    .filter((r) => r.date > latest.date && r.date <= asOf)
    .reduce((s, r) => s + r.amount, 0);
  return {
    asOf,
    balance: Math.round((latest.quantity! + after) * 100) / 100,
    sweepDate: latest.date,
  };
}

export interface CashBalance {
  /** Null when there is nothing to base a balance on. */
  balance: number | null;
  /** "anchored": calibrated balance plus later activity. "events": no
   *  calibration yet, so only the sum of recorded cash events (not a real balance). */
  mode: "anchored" | "events" | "none";
}

/**
 * Cash for a manual portfolio. With a calibration, everything dated on or
 * before it is already in the balance; later cash events add to it and later
 * purchases take from it. A reinvested dividend nets to zero by itself — its
 * payout is a cash event and its purchase is the matching debit.
 */
export function computeCash(
  anchor: CashAnchor | null,
  events: CashEvent[],
  purchases: Purchase[],
): CashBalance {
  if (anchor) {
    const eventsAfter = events
      .filter((e) => e.occurred_at > anchor.as_of)
      .reduce((s, e) => s + e.amount, 0);
    const spent = purchases
      .filter((p) => p.purchased_at > anchor.as_of)
      .reduce((s, p) => s + p.shares * p.price_per_share, 0);
    return {
      balance: Math.round((anchor.balance + eventsAfter - spent) * 100) / 100,
      mode: "anchored",
    };
  }
  if (events.length > 0) {
    return { balance: events.reduce((s, e) => s + e.amount, 0), mode: "events" };
  }
  return { balance: null, mode: "none" };
}
