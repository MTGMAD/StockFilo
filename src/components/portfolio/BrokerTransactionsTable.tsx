import type { BrokerTransaction } from "../../types";
import { cn } from "../../lib/utils";
import { Lock } from "lucide-react";

interface BrokerTransactionsTableProps {
  transactions: BrokerTransaction[];
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function shares(v: number | null): string {
  if (v == null) return "—";
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-3 flex items-center gap-2 text-xs text-muted-foreground border-b border-border">
        <Lock className="w-3.5 h-3.5 shrink-0" />
        <span>
          Reported by your broker — read-only. Values shown are exactly as
          received; nothing is calculated or filled in.
        </span>
      </div>

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background">
          <tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left font-medium px-6 py-2">Date</th>
            <th className="text-left font-medium px-3 py-2">Symbol</th>
            <th className="text-left font-medium px-3 py-2">Side</th>
            <th className="text-right font-medium px-3 py-2">Shares</th>
            <th className="text-right font-medium px-3 py-2">Price</th>
            <th className="text-right font-medium px-6 py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const amount =
              t.qty != null && t.price != null ? t.qty * t.price : null;
            return (
              <tr
                key={t.id}
                className="border-b border-border/60 hover:bg-accent/40 transition-colors"
              >
                <td className="px-6 py-2 tabular-nums text-muted-foreground">
                  {t.occurred_at}
                </td>
                <td className="px-3 py-2 font-medium text-foreground">
                  {t.provider_symbol}
                </td>
                <td className="px-3 py-2">
                  {t.side ? (
                    <span
                      className={cn(
                        "text-xs font-medium uppercase",
                        t.side === "buy" ? "text-positive" : "text-negative",
                      )}
                    >
                      {t.side}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {shares(t.qty)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(t.price)}
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {money(amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
