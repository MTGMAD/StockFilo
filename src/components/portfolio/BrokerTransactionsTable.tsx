import { useState } from "react";
import type { BrokerTransaction } from "../../types";
import { cn } from "../../lib/utils";
import { sweepTickers } from "../../lib/journal";
import { Lock } from "lucide-react";

interface BrokerTransactionsTableProps {
  transactions: BrokerTransaction[];
}

function money(v: number | null): string {
  if (v == null) return "—";
  // Summing cents leaves a stray -0.000001, which would print as "-$0.00".
  return (Math.abs(v) < 0.005 ? 0 : v).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

const KIND_LABEL: Record<string, string> = {
  dividend: "Dividend",
  interest: "Interest",
  fee: "Fee",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer: "Transfer",
  tax: "Tax Withheld",
  realized: "Realized Gain/Loss",
  split: "Split",
  other: "Other",
};

/** Signed cash effect: the broker's own figure, or for a fill without one,
 *  shares × price with the side's sign (a buy is cash out). */
function cashAmount(t: BrokerTransaction): number | null {
  // A split changes the share count and nothing else, whatever amount the
  // brokerage's feed attaches to it.
  if (t.kind === "split") return null;
  if (t.amount != null) return t.amount;
  if (t.kind === "fill" && t.qty != null && t.price != null) {
    return t.side === "sell" ? t.qty * t.price : -t.qty * t.price;
  }
  return null;
}

/** A fill is its side (buy/sell), unless nobody chose to trade: the broker
 *  reinvesting a dividend, or moving cash in and out of a money-market sweep.
 *  Every other row is its kind. */
function typeOf(t: BrokerTransaction, sweeps: Set<string>): string {
  if (t.kind !== "fill" || !t.side) return t.kind;
  if (t.reinvested) return "reinvest";
  if (t.ticker && sweeps.has(t.ticker)) return "sweep";
  return t.side;
}

const TYPE_LABEL: Record<string, string> = {
  buy: "Buys",
  sell: "Sells",
  reinvest: "Reinvested",
  sweep: "Cash Sweep",
  ...KIND_LABEL,
};
const TYPE_ORDER = ["buy", "sell", "reinvest", "sweep", "dividend", "interest", "deposit", "withdrawal", "tax", "fee", "transfer", "realized", "split", "other"];

/** A reported realized gain moved no cash, so it stays out of any mix of rows;
 *  on its own chip, its total is what's being asked for. */
function sumAmounts(rows: BrokerTransaction[]): number {
  const counted = rows.some((t) => t.kind !== "realized")
    ? rows.filter((t) => t.kind !== "realized")
    : rows;
  return counted.reduce((s, t) => s + (cashAmount(t) ?? 0), 0);
}

function shares(v: number | null): string {
  if (v == null || v === 0) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/**
 * Read-only transaction history for a broker-linked portfolio.
 *
 * Shows only what the brokerage actually reported. There is no Add, Edit or
 * Delete: these rows mirror the broker, and editing them would make the
 * portfolio disagree with the account it represents.
 */
export function BrokerTransactionsTable({
  transactions,
}: BrokerTransactionsTableProps) {
  const [selectedType, setSelectedType] = useState<string>("all");

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground p-8 text-center">
        <Lock className="w-5 h-5" />
        <p className="text-sm font-medium text-foreground">
          No transaction history yet
        </p>
        <p className="text-xs max-w-sm">
          Holdings for this portfolio come from the broker's current positions.
          Dated transactions appear here once they have been fetched — sync this
          connection from Settings to pull them in.
        </p>
      </div>
    );
  }

  const sweeps = sweepTickers(transactions);
  const byType = new Map<string, BrokerTransaction[]>();
  for (const t of transactions) {
    const key = typeOf(t, sweeps);
    byType.set(key, [...(byType.get(key) ?? []), t]);
  }
  const types = [...byType.keys()].sort(
    (a, b) =>
      (TYPE_ORDER.indexOf(a) + 1 || TYPE_ORDER.length + 1) -
      (TYPE_ORDER.indexOf(b) + 1 || TYPE_ORDER.length + 1),
  );
  // A type that isn't in this portfolio's history (after switching
  // portfolios) falls back to All.
  const activeType = byType.has(selectedType) ? selectedType : "all";
  const shown = activeType === "all" ? transactions : byType.get(activeType)!;
  const chips = [
    { key: "all", label: "All", rows: transactions },
    ...types.map((key) => ({ key, label: TYPE_LABEL[key] ?? key, rows: byType.get(key)! })),
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-3 flex items-center gap-2 text-xs text-muted-foreground border-b border-border">
        <Lock className="w-3.5 h-3.5 shrink-0" />
        <span>
          Reported by your broker — read-only. Values shown are exactly as
          received; only the totals are added up here.
        </span>
      </div>

      <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-border">
        {chips.map(({ key, label, rows }) => {
          const total = sumAmounts(rows);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedType(key)}
              className={cn(
                "flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors",
                activeType === key
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-foreground/30 hover:bg-accent/40",
              )}
              title={key === "all" ? "Net cash in and out across every type" : undefined}
            >
              <span className="text-xs font-medium text-foreground">
                {label}
                <span className="ml-1 font-normal text-muted-foreground">({rows.length})</span>
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  total > 0 ? "text-positive" : total < 0 ? "text-negative" : "text-muted-foreground",
                )}
              >
                {money(total)}
              </span>
            </button>
          );
        })}
      </div>

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background">
          <tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left font-medium px-6 py-2">Date</th>
            <th className="text-left font-medium px-3 py-2">Symbol</th>
            <th className="text-left font-medium px-3 py-2">Type</th>
            <th className="text-right font-medium px-3 py-2">Shares</th>
            <th className="text-right font-medium px-3 py-2">Price</th>
            <th className="text-right font-medium px-6 py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => {
            const amount = cashAmount(t);
            return (
              <tr
                key={t.id}
                className="border-b border-border/60 hover:bg-accent/40 transition-colors"
              >
                <td className="px-6 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                  {t.occurred_at}
                  {/* Provisional: taken from the broker's real-time order book
                      because its transaction history is only refreshed daily.
                      Replaced by the history row once that arrives. */}
                  {t.external_id.startsWith("order:") && (
                    <span
                      className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary"
                      title="From today's order fills. The brokerage's transaction history confirms it within a day."
                    >
                      Live
                    </span>
                  )}
                </td>
                <td
                  className="px-3 py-2 font-medium text-foreground"
                  title={t.description ?? undefined}
                >
                  {t.provider_symbol || (
                    <span className="font-normal text-muted-foreground truncate">
                      {t.description ?? "—"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {typeOf(t, sweeps) === "reinvest" || typeOf(t, sweeps) === "sweep" ? (
                    <span className="text-xs text-muted-foreground">
                      {typeOf(t, sweeps) === "reinvest"
                        ? "Reinvested"
                        : t.side === "buy"
                          ? "Sweep in"
                          : "Sweep out"}
                    </span>
                  ) : t.side ? (
                    <span
                      className={cn(
                        "text-xs font-medium uppercase",
                        t.side === "buy" ? "text-positive" : "text-negative",
                      )}
                    >
                      {t.side}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {KIND_LABEL[t.kind] ?? t.kind}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {shares(t.qty)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {t.price ? money(t.price) : "—"}
                </td>
                <td
                  className={cn(
                    "px-6 py-2 text-right tabular-nums",
                    amount != null && amount > 0 && "text-positive",
                  )}
                >
                  {money(amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-background">
          <tr className="border-t border-border font-semibold">
            <td className="px-6 py-2" colSpan={5}>
              {activeType === "all" ? "Net total" : `Total ${(TYPE_LABEL[activeType] ?? activeType).toLowerCase()}`}
              <span className="ml-1 font-normal text-muted-foreground">({shown.length})</span>
            </td>
            <td
              className={cn(
                "px-6 py-2 text-right tabular-nums",
                sumAmounts(shown) > 0 && "text-positive",
              )}
            >
              {money(sumAmounts(shown))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
