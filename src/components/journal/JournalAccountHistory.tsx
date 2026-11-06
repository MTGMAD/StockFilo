import { useEffect, useMemo, useState } from "react";
import type {
  BrokerAccountSnapshot,
  CashAnchor,
  JournalAccountValue,
  Purchase,
} from "../../types";
import { listJournalAccountValues, saveJournalAccountValue, fetchPriceOnDate } from "../../lib/db";
import { listBrokerSnapshots } from "../../lib/brokers";
import type { Fill, IncomeEvent } from "../../lib/journal";
import { cn, formatCurrency } from "../../lib/utils";
import { shortDate } from "./journalUi";

type AccountValueRow = Omit<
  Pick<JournalAccountValue, "as_of" | "positions_value" | "cash_value" | "total_value">,
  "positions_value"
> & { positions_value: number | null };

interface JournalAccountHistoryProps {
  portfolioId: number;
  fills: Fill[];
  purchases: Purchase[];
  income: IncomeEvent[] | null;
  cashAnchor: CashAnchor | null;
  brokerAccountId: number | null;
}

function priorDate(today: string): string {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() - 1);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() - 1);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cashAtDate(
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

/** Some brokerages' balance refreshes a day behind their holdings. When a day's
 *  balance is the previous day's holdings, the holdings are the current figure;
 *  a real gap (a trade not yet settled) won't line up like that. */
function fromBrokerSnapshot(
  snapshot: BrokerAccountSnapshot,
  previous: BrokerAccountSnapshot | undefined,
): AccountValueRow {
  const cash = snapshot.cash ?? 0;
  const lagged =
    snapshot.equity != null &&
    snapshot.positions_value != null &&
    previous?.positions_value != null &&
    Math.abs(snapshot.equity - cash - previous.positions_value) < 0.05 &&
    Math.abs(snapshot.positions_value - previous.positions_value) >= 0.05;
  return {
    as_of: snapshot.as_of,
    positions_value: snapshot.positions_value,
    cash_value: snapshot.cash,
    total_value: lagged ? snapshot.positions_value! + cash : snapshot.equity,
  };
}

export function JournalAccountHistory({
  portfolioId,
  fills,
  purchases,
  income,
  cashAnchor,
  brokerAccountId,
}: JournalAccountHistoryProps) {
  const [today, setToday] = useState(localDate);
  const [rows, setRows] = useState<AccountValueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const asOf = useMemo(() => priorDate(today), [today]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday((current) => {
        const next = localDate();
        return current === next ? current : next;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);

    async function load() {
      if (brokerAccountId != null) {
        const snapshots = await listBrokerSnapshots(brokerAccountId);
        if (!cancelled) {
          setRows(
            snapshots
              .map((snapshot, i) => ({ snapshot, previous: snapshots[i - 1] }))
              .filter(({ snapshot }) => snapshot.as_of <= asOf)
              .slice(-30)
              .reverse()
              .map(({ snapshot, previous }) => fromBrokerSnapshot(snapshot, previous)),
          );
        }
        return;
      }

      const savedValues = await listJournalAccountValues(portfolioId);
      if (!cancelled) {
        setRows(savedValues.filter((row) => row.as_of <= asOf).slice(0, 30));
      }

      const sharesByTicker = new Map<string, number>();
      for (const fill of fills) {
        if (fill.date > asOf) continue;
        sharesByTicker.set(
          fill.ticker,
          (sharesByTicker.get(fill.ticker) ?? 0) +
            (fill.side === "buy" ? fill.qty : -fill.qty),
        );
      }
      const holdings = [...sharesByTicker]
        .filter(([, shares]) => shares > 1e-9)
        .map(([ticker, shares]) => ({ ticker, shares }));
      const prices: { ticker: string; value: number | null }[] = [];
      for (let i = 0; i < holdings.length; i += 4) {
        const batch = await Promise.all(
          holdings.slice(i, i + 4).map(async ({ ticker, shares }) => {
            const price = await fetchPriceOnDate(ticker, asOf);
            return { ticker, value: price == null ? null : shares * price };
          }),
        );
        prices.push(...batch);
      }
      const missing = prices.find((price) => price.value == null);
      if (missing) {
        throw new Error(`No historical closing price is available for ${missing.ticker}.`);
      }
      const positionsValue = prices.reduce((sum, price) => sum + (price.value ?? 0), 0);
      const cashValue = income
        ? cashAtDate(asOf, cashAnchor, purchases, income)
        : null;
      const totalValue = cashValue == null ? null : positionsValue + cashValue;
      await saveJournalAccountValue({
        portfolio_id: portfolioId,
        as_of: asOf,
        positions_value: positionsValue,
        cash_value: cashValue,
        total_value: totalValue,
      });
      const saved = await listJournalAccountValues(portfolioId);
      if (!cancelled) {
        setRows(saved.filter((row) => row.as_of <= asOf).slice(0, 30));
      }
    }

    load()
      .catch((cause: unknown) => {
        if (!cancelled) setError(`Couldn't load account history: ${String(cause)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [portfolioId, fills, purchases, income, cashAnchor, brokerAccountId, asOf]);

  return (
    <section className="rounded-xl border border-border p-4">
      <div className="mb-3">
        <h3 className="font-semibold">Daily account totals</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Manual portfolios use the latest close on or before the previous trading day. Brokerage portfolios use saved daily equity snapshots.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading account history…</p>
      ) : rows.length === 0 ? (
        error ? (
          <p role="alert" className="text-sm text-negative">{error}</p>
        ) : (
        <p className="text-sm text-muted-foreground">No prior-day account totals are available yet.</p>
        )
      ) : (
        <div className="overflow-x-auto">
          {error && <p role="alert" className="text-sm text-negative mb-2">{error}</p>}
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-medium py-1.5">Date</th>
                <th className="text-right font-medium px-2 py-1.5">Positions</th>
                <th className="text-right font-medium px-2 py-1.5">Cash</th>
                <th className="text-right font-medium py-1.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.as_of} className={cn("border-t border-border", row.as_of === asOf && "font-semibold")}>
                  <td className="py-2 whitespace-nowrap">{shortDate(row.as_of)}</td>
                  <td className="text-right px-2 tabular-nums">{formatCurrency(row.positions_value)}</td>
                  <td className="text-right px-2 tabular-nums">{formatCurrency(row.cash_value)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(row.total_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {brokerAccountId == null && rows.some((row) => row.total_value == null) && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Total needs a recorded cash balance. Add a cash anchor or cash activity to include cash.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
