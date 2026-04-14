import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { TickerSummary, Purchase } from "../../types";
import { formatCurrency, formatPercent, formatShares, pnlColor, cn } from "../../lib/utils";
import { ExternalLink, Star, ChevronUp, ChevronDown, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MountainChart } from "./MountainChart";
import { TickerNews } from "./TickerNews";
import { useFavorites } from "../../hooks/useFavorites";

interface AnalysisViewProps {
  summaries: TickerSummary[];
  purchases: Purchase[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string | null) => void;
}

export function AnalysisView({ summaries, purchases, selectedTicker, onSelectTicker }: AnalysisViewProps) {
  const { favoriteTickers, loaded: favoritesLoaded, isFavorite, toggle, reorder } = useFavorites();

  // Categorize tickers
  const favorites = summaries
    .filter((s) => isFavorite(s.ticker))
    .sort((a, b) => favoriteTickers.indexOf(a.ticker) - favoriteTickers.indexOf(b.ticker));

  const isMutualFund = (qt: string | null) =>
    qt === "MUTUALFUND" || qt === "UIT";

  const nonFavStocks = summaries
    .filter((s) => !isFavorite(s.ticker) && !isMutualFund(s.quoteType))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const nonFavFunds = summaries
    .filter((s) => !isFavorite(s.ticker) && isMutualFund(s.quoteType))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  // Flat ordered list for default selection logic
  const ordered = [...favorites, ...nonFavStocks, ...nonFavFunds];

  // On first app open (selectedTicker is null), pick the top favorite or first in list.
  // Wait for favorites to load before committing a default so we don't pick alphabetical first.
  const selected = selectedTicker && ordered.some((s) => s.ticker === selectedTicker)
    ? selectedTicker
    : favoritesLoaded && ordered.length > 0 ? ordered[0].ticker : null;

  // Sync back to parent if we had to resolve to a default
  useEffect(() => {
    if (selected !== null && selected !== selectedTicker) {
      onSelectTicker(selected);
    }
  }, [selected, selectedTicker, onSelectTicker]);

  const setSelected = onSelectTicker;

  const summary = ordered.find((s) => s.ticker === selected) ?? null;
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

  if (!favoritesLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0">
      {/* Ticker selector */}
      <div className="w-52 border-r border-border shrink-0 overflow-y-auto">
        {favorites.length > 0 && (
          <SectionLabel label="Favorites" />
        )}
        {favorites.map((s) => {
          const favIdx = favoriteTickers.indexOf(s.ticker);
          return (
            <TickerRow
              key={s.ticker}
              s={s}
              isSelected={selected === s.ticker}
              isFav
              favIdx={favIdx}
              favCount={favoriteTickers.length}
              onSelect={setSelected}
              onToggleFav={toggle}
              onMoveFav={moveFavorite}
            />
          );
        })}
        {nonFavStocks.length > 0 && (
          <SectionLabel label="Stocks" />
        )}
        {nonFavStocks.map((s) => (
          <TickerRow
            key={s.ticker}
            s={s}
            isSelected={selected === s.ticker}
            isFav={false}
            favIdx={-1}
            favCount={0}
            onSelect={setSelected}
            onToggleFav={toggle}
            onMoveFav={moveFavorite}
          />
        ))}
        {nonFavFunds.length > 0 && (
          <SectionLabel label="Mutual Funds & UITs" />
        )}
        {nonFavFunds.map((s) => (
          <TickerRow
            key={s.ticker}
            s={s}
            isSelected={selected === s.ticker}
            isFav={false}
            favIdx={-1}
            favCount={0}
            onSelect={setSelected}
            onToggleFav={toggle}
            onMoveFav={moveFavorite}
          />
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
          <MountainChart ticker={summary.ticker} quoteType={summary.quoteType} />

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

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 border-b border-border">
      {label}
    </div>
  );
}

function TickerRow({
  s,
  isSelected,
  isFav,
  favIdx,
  favCount,
  onSelect,
  onToggleFav,
  onMoveFav,
}: {
  s: TickerSummary;
  isSelected: boolean;
  isFav: boolean;
  favIdx: number;
  favCount: number;
  onSelect: (ticker: string) => void;
  onToggleFav: (ticker: string) => void;
  onMoveFav: (ticker: string, dir: "up" | "down") => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center border-b border-border transition-colors group",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted"
      )}
    >
      {/* Star toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFav(s.ticker); }}
        className={cn(
          "pl-2 pr-0 py-3 shrink-0 transition-colors",
          isFav
            ? isSelected ? "text-yellow-200" : "text-yellow-500"
            : isSelected ? "text-primary-foreground/40 hover:text-yellow-200" : "text-muted-foreground/40 hover:text-yellow-500"
        )}
        title={isFav ? "Remove from favorites" : "Add to favorites"}
      >
        <Star className={cn("w-3.5 h-3.5", isFav && "fill-current")} />
      </button>

      {/* Ticker name — main click target */}
      <button
        onClick={() => onSelect(s.ticker)}
        className="flex-1 text-left px-2 py-2 text-sm font-medium min-w-0"
      >
        <div className="truncate">{s.ticker}</div>
        {s.name && <div className="text-xs opacity-70 truncate">{s.name}</div>}
      </button>

      {/* Daily change indicator */}
      {s.dailyChangePct != null && (
        <div
          className={cn(
            "flex items-center gap-0.5 pr-1 shrink-0 text-xs font-medium",
            s.dailyChangePct > 0
              ? isSelected ? "text-green-200" : "text-green-500"
              : s.dailyChangePct < 0
                ? isSelected ? "text-red-300" : "text-red-500"
                : isSelected ? "text-primary-foreground/60" : "text-muted-foreground"
          )}
        >
          {s.dailyChangePct > 0 ? (
            <TrendingUp className="w-3.5 h-3.5" />
          ) : s.dailyChangePct < 0 ? (
            <TrendingDown className="w-3.5 h-3.5" />
          ) : (
            <Minus className="w-3.5 h-3.5" />
          )}
          <span>{s.dailyChangePct >= 0 ? "+" : ""}{s.dailyChangePct.toFixed(2)}%</span>
        </div>
      )}

      {/* Move buttons for favorites */}
      {isFav && (
        <div className="flex flex-col pr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveFav(s.ticker, "up"); }}
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
            onClick={(e) => { e.stopPropagation(); onMoveFav(s.ticker, "down"); }}
            disabled={favIdx === favCount - 1}
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
}
