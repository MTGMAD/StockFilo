/**
 * manualValues.ts — a daily value for each manual portfolio.
 *
 * A brokerage reports an account's value and a sync saves it. Nothing reports
 * one for a manual portfolio, so it's worked out from its own records and the
 * market's closing prices, and saved so the history builds up whether or not
 * anyone opens the portfolio that day.
 */
import type { CashAnchor, CashEvent, Purchase } from "../types";
import {
  fetchPriceOnDate,
  getCashAnchor,
  listCashEvents,
  listJournalAccountValues,
  listPortfolios,
  listPurchases,
  listSales,
  saveJournalAccountValue,
} from "./db";
import { fillsFromPurchasesAndSales, type Fill, type IncomeEvent } from "./journal";
import { isCusip } from "./utils";

/** How many weekdays back to fill in, for an app that hasn't been open. Older
 *  days are left alone: each costs one price lookup per holding. */
const BACKFILL_WEEKDAYS = 10;
const LOOKUPS_AT_ONCE = 4;

type PriceOn = (ticker: string, date: string) => Promise<number | null>;

const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function localDate(): string {
  return dayString(new Date());
}

/** The last weekday before `today`, whose close is final. */
export function priorDate(today: string): string {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() - 1);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() - 1);
  }
  return dayString(date);
}

export function cashAtDate(
  date: string,
  anchor: CashAnchor | null,
  purchases: Purchase[],
  income: IncomeEvent[],
): number | null {
  if (anchor) {
    if (anchor.as_of > date) return null;
    const laterEvents = income
      .filter((event) => event.occurred_at > anchor.as_of && event.occurred_at <= date)
      .reduce((sum, event) => sum + event.amount, 0);
    const laterPurchases = purchases
      .filter((purchase) => purchase.purchased_at > anchor.as_of && purchase.purchased_at <= date)
      .reduce((sum, purchase) => sum + purchase.shares * purchase.price_per_share, 0);
    return Math.round((anchor.balance + laterEvents - laterPurchases) * 100) / 100;
  }
  const eventsThroughDate = income.filter((event) => event.occurred_at <= date);
  if (eventsThroughDate.length === 0) return null;
  return Math.round(eventsThroughDate.reduce((sum, event) => sum + event.amount, 0) * 100) / 100;
}

export interface ManualAccountValue {
  positions_value: number;
  cash_value: number | null;
  total_value: number | null;
}

/** A portfolio's value at one day's close. CDs, bonds and structured notes have
 *  no market quote, so they count at what was paid for them: leaving them out
 *  would read as thousands of dollars missing from the account. Any other holding
 *  with no price throws, because a partial sum would read as a drop in value. */
export async function accountValueOn(
  asOf: string,
  fills: Fill[],
  purchases: Purchase[],
  income: IncomeEvent[] | null,
  cashAnchor: CashAnchor | null,
  priceOn: PriceOn = fetchPriceOnDate,
): Promise<ManualAccountValue> {
  const sharesByTicker = new Map<string, number>();
  const bought = new Map<string, { shares: number; cost: number }>();
  for (const fill of fills) {
    if (fill.date > asOf) continue;
    sharesByTicker.set(
      fill.ticker,
      (sharesByTicker.get(fill.ticker) ?? 0) + (fill.side === "buy" ? fill.qty : -fill.qty),
    );
    if (fill.side === "buy") {
      const total = bought.get(fill.ticker) ?? { shares: 0, cost: 0 };
      bought.set(fill.ticker, {
        shares: total.shares + fill.qty,
        cost: total.cost + fill.qty * fill.price,
      });
    }
  }
  const holdings = [...sharesByTicker]
    .filter(([, shares]) => shares > 1e-9)
    .map(([ticker, shares]) => ({ ticker, shares }));

  const prices: { ticker: string; value: number | null }[] = [];
  for (let i = 0; i < holdings.length; i += LOOKUPS_AT_ONCE) {
    const batch = await Promise.all(
      holdings.slice(i, i + LOOKUPS_AT_ONCE).map(async ({ ticker, shares }) => {
        const paid = bought.get(ticker);
        const price = isCusip(ticker)
          ? paid && paid.shares > 0
            ? paid.cost / paid.shares
            : null
          : await priceOn(ticker, asOf);
        return { ticker, value: price == null ? null : shares * price };
      }),
    );
    prices.push(...batch);
  }
  const missing = prices.find((price) => price.value == null);
  if (missing) {
    throw new Error(`No historical closing price is available for ${missing.ticker}.`);
  }
  const positions_value = prices.reduce((sum, price) => sum + (price.value ?? 0), 0);
  const cash_value = income ? cashAtDate(asOf, cashAnchor, purchases, income) : null;
  return {
    positions_value,
    cash_value,
    total_value: cash_value == null ? null : positions_value + cash_value,
  };
}

/** The recent weekdays with no saved value, oldest first. Nothing before the
 *  portfolio's first fill, when it didn't hold anything yet. */
export function missingDays(today: string, saved: Set<string>, firstFill: string): string[] {
  const days: string[] = [];
  let day = priorDate(today);
  for (let i = 0; i < BACKFILL_WEEKDAYS && day >= firstFill; i++) {
    if (!saved.has(day)) days.unshift(day);
    day = priorDate(day);
  }
  return days;
}

async function capturePortfolio(
  portfolioId: number,
  today: string,
  priceOn: PriceOn,
): Promise<void> {
  const [purchases, sales, cashEvents, cashAnchor, saved] = await Promise.all([
    listPurchases(portfolioId),
    listSales(portfolioId),
    listCashEvents(portfolioId),
    getCashAnchor(portfolioId),
    listJournalAccountValues(portfolioId),
  ]);
  const fills = fillsFromPurchasesAndSales(purchases, sales);
  if (fills.length === 0) return;

  const firstFill = fills.reduce((min, f) => (f.date < min ? f.date : min), fills[0].date);
  const days = missingDays(today, new Set(saved.map((row) => row.as_of)), firstFill);
  for (const as_of of days) {
    try {
      const value = await accountValueOn(
        as_of,
        fills,
        purchases,
        cashEvents as CashEvent[],
        cashAnchor,
        priceOn,
      );
      await saveJournalAccountValue({ portfolio_id: portfolioId, as_of, ...value });
    } catch {
      // No price for that day or no network: it's still missing next time.
    }
  }
}

/** Save the daily values every manual portfolio is missing. */
export async function captureManualAccountValues(today: string = localDate()): Promise<void> {
  // A past close doesn't change, so a holding priced for one portfolio needn't
  // be looked up again for another.
  const closes = new Map<string, Promise<number | null>>();
  const priceOn: PriceOn = (ticker, date) => {
    const key = `${ticker}|${date}`;
    let price = closes.get(key);
    if (!price) {
      price = fetchPriceOnDate(ticker, date);
      closes.set(key, price);
    }
    return price;
  };
  const portfolios = await listPortfolios();
  for (const portfolio of portfolios) {
    if (portfolio.broker_account_id != null) continue;
    await capturePortfolio(portfolio.id, today, priceOn);
  }
}
