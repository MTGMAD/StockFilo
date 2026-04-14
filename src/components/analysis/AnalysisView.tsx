import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { TickerSummary, Purchase } from "../../types";
import { formatCurrency, formatPercent, formatShares, pnlColor, cn } from "../../lib/utils";
import { ExternalLink, Star, ChevronUp, ChevronDown } from "lucide-react";
import { MountainChart } from "./MountainChart";
import { TickerNews } from "./TickerNews";
import { useFavorites } from "../../hooks/useFavorites";

interface AnalysisViewProps {
  summaries: TickerSummary[];
  purchases: Purchase[];
}

export function AnalysisView({ summaries, purchases }: AnalysisViewProps) {
  const { favoriteTickers, isFavorite, toggle, reorder } = useFavorites();

  // Sort: favorites first (in their custom order), then the rest alphabetically
  const sorted = [...summaries].sort((a, b) => {
    const aFav = isFavorite(a.ticker);
    const bFav = isFavorite(b.ticker);
    if (aFav && bFav) {
      return favoriteTickers.indexOf(a.ticker) - favoriteTickers.indexOf(b.ticker);
    }
    if (aFav) return -1;
    if (bFav) return 1;
    return a.ticker.localeCompare(b.ticker);
  });

  const [selected, setSelected] = useState<string | null>(
    sorted.length > 0 ? sorted[0].ticker : null
  );

  const summary = sorted.find((s) => s.ticker === selected) ?? null;
  const tickerPurchases = purchases.filter((p) => p.ticker === selected);

  async function openGoogleFinance(ticker: string) {
    await open(`https://www.google.com/finance/quote/${ticker}`);
  }

  async function moveFavorite(ticker: string, direction: "up" | "down") {
    const idx = favoriteTickers.indexOf(ticker);
    if (idx < 0) return;
    const newOrder = [...favoriteTickers];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    await reorder(newOrder);
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
      <div className="w-52 border-r border-border shrink-0 overflow-y-auto">
        {sorted.map((s) => {
          const fav = isFavorite(s.ticker);
          const favIdx = favoriteTickers.indexOf(s.ticker);
          const isSelected = selected === s.ticker;

          return (
            <div
              key={s.ticker}
              className={cn(
                "flex items-center border-b border-border transition-colors group",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted"
              )}
            >
              {/* Star toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggle(s.ticker); }}
                className={cn(
                  "pl-2 pr-0 py-3 shrink-0 transition-colors",
                  fav
                    ? isSelected ? "text-yellow-200" : "text-yellow-500"
                    : isSelected ? "text-primary-foreground/40 hover:text-yellow-200" : "text-muted-foreground/40 hover:text-yellow-500"
                )}
                title={fav ? "Remove from favorites" : "Add to favorites"}
              >
                <Star className={cn("w-3.5 h-3.5", fav && "fill-current")} />
              </button>

              {/* Ticker name — main click target */}
              <button
                onClick={() => setSelected(s.ticker)}
                className="flex-1 text-left px-2 py-3 text-sm font-medium min-w-0"
              >
                <div className="truncate">{s.ticker}</div>
                {s.name && <div className="text-xs opacity-70 truncate">{s.name}</div>}
              </button>

              {/* Move buttons for favorites */}
              {fav && (
                <div className="flex flex-col pr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveFavorite(s.ticker, "up"); }}
                    disabled={favIdx === 0}
                    className={cn(
                      "p-0.5 rounded transition-colors",
                      isSelected ? "hover:bg-primary-foreground/20 disabled:opacity-30" : "hover:bg-accent disabled:opacity-30"
                    )}
                    title="Move up"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveFavorite(s.ticker, "down"); }}
                    disabled={favIdx === favoriteTickers.length - 1}
                    className={cn(
                      "p-0.5 rounded transition-colors",
                      isSelected ? "hover:bg-primary-foreground/20 disabled:opacity-30" : "hover:bg-accent disabled:opacity-30"
                    )}
                    title="Move down"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
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
          <MountainChart ticker={summary.ticker} />

          {/* News */}
          <TickerNews ticker={summary.ticker} />

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
