import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { TickerSummary, Purchase } from "../../types";
import { formatCurrency, formatPercent, formatShares, pnlColor, cn } from "../../lib/utils";
import { ExternalLink } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface AnalysisViewProps {
  summaries: TickerSummary[];
  purchases: Purchase[];
}

export function AnalysisView({ summaries, purchases }: AnalysisViewProps) {
  const [selected, setSelected] = useState<string | null>(
    summaries.length > 0 ? summaries[0].ticker : null
  );

  const summary = summaries.find((s) => s.ticker === selected) ?? null;
  const tickerPurchases = purchases.filter((p) => p.ticker === selected);

  const chartData = summary
    ? [
        {
          name: summary.ticker,
          "Avg Cost Basis": parseFloat(summary.avgCostBasis.toFixed(2)),
          "Current Price": summary.currentPrice != null ? parseFloat(summary.currentPrice.toFixed(2)) : 0,
        },
      ]
    : [];

  async function openGoogleFinance(ticker: string) {
    await open(`https://www.google.com/finance/quote/${ticker}`);
  }

  if (summaries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No purchases yet. Add some in the Purchases view.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0">
      {/* Ticker selector */}
      <div className="w-44 border-r border-border shrink-0 overflow-y-auto">
        {summaries.map((s) => (
          <button
            key={s.ticker}
            onClick={() => setSelected(s.ticker)}
            className={cn(
              "w-full text-left px-4 py-3 text-sm font-medium border-b border-border transition-colors",
              selected === s.ticker
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )}
          >
            <div>{s.ticker}</div>
            {s.name && <div className="text-xs opacity-70 truncate">{s.name}</div>}
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {summary && (
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Ticker header */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => openGoogleFinance(summary.ticker)}
              className="flex items-center gap-2 text-2xl font-bold text-primary hover:underline"
            >
              {summary.ticker}
              <ExternalLink className="w-5 h-5 opacity-60" />
            </button>
            {summary.name && <span className="text-muted-foreground">{summary.name}</span>}
            {summary.isStale && summary.currentPrice != null && (
              <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
                stale price
              </span>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Total Shares" value={formatShares(summary.totalShares)} />
            <StatCard label="Total Invested" value={formatCurrency(summary.totalInvested)} />
            <StatCard label="Avg Cost Basis" value={formatCurrency(summary.avgCostBasis)} />
            <StatCard
              label="Current Price"
              value={summary.currentPrice != null ? formatCurrency(summary.currentPrice) : "—"}
            />
            <StatCard
              label="Market Value"
              value={formatCurrency(summary.marketValue)}
            />
            <StatCard
              label="Total P&L"
              value={
                summary.pnlDollar != null
                  ? `${formatCurrency(summary.pnlDollar)} (${formatPercent(summary.pnlPercent)})`
                  : "—"
              }
              valueClass={pnlColor(summary.pnlDollar)}
            />
          </div>

          {/* Chart */}
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Cost Basis vs Current Price
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barCategoryGap="40%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => `$${v}`}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(v as number)}
                  contentStyle={{
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                />
                <Legend />
                <Bar dataKey="Avg Cost Basis" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Current Price" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Transaction history */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Transaction History</h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Shares</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Price Paid</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {tickerPurchases.map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-3 py-2">{p.purchased_at}</td>
                    <td className="px-3 py-2 text-right">{formatShares(p.shares)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(p.price_per_share)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(p.shares * p.price_per_share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg px-4 py-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-base font-semibold text-foreground", valueClass)}>{value}</div>
    </div>
  );
}
