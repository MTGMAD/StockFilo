import { useState } from "react";
import type { TickerSummary } from "../../types";
import {
  formatCurrency,
  formatPercent,
  formatShares,
  pnlColor,
  cn,
  isCusip,
} from "../../lib/utils";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

type AssetType = "stocks" | "funds";
type SortBy = "pnlPct" | "pnlDollar" | "dailyPct" | "invested";

interface PortfolioRankViewProps {
  summaries: TickerSummary[];
  onSelectTicker?: (ticker: string) => void;
}

function isMutualFund(qt: string | null): boolean {
  const q = qt?.toUpperCase() ?? "";
  return (
    q === "MUTUALFUND" ||
    q === "UIT" ||
    q === "MONEYMARKET" ||
    q === "MONEYMARKETS"
  );
}

export function PortfolioRankView({ summaries, onSelectTicker }: PortfolioRankViewProps) {
  const [activeType, setActiveType] = useState<AssetType>("stocks");
  const [sortBy, setSortBy] = useState<SortBy>("pnlPct");

  // ── Compute portfolio-wide totals (all holdings, excl. bonds) ─────────────
  const pricedSummaries = summaries.filter((s) => !isCusip(s.ticker));
  const totalMarketValue = pricedSummaries.reduce(
    (acc, s) => acc + (s.marketValue ?? 0),
    0,
  );
  const totalInvested = pricedSummaries.reduce(
    (acc, s) => acc + s.totalInvested,
    0,
  );
  const totalPnlDollar = totalMarketValue - totalInvested;
  const totalPnlPct =
    totalInvested > 0 ? (totalPnlDollar / totalInvested) * 100 : null;

  // Approximate portfolio-level daily change: sum(dailyChangePct/100 × marketValue)
  const totalDailyChangeDollar = pricedSummaries.reduce((acc, s) => {
    if (s.dailyChangePct != null && s.marketValue != null) {
      // dailyChangePct is already the CURRENT day's change.
      // yesterday's value = marketValue / (1 + dailyChangePct/100)
      // daily $ change   = marketValue - yesterday's value
      const prevValue = s.marketValue / (1 + s.dailyChangePct / 100);
      return acc + (s.marketValue - prevValue);
    }
    return acc;
  }, 0);

  // ── Filter by asset type (exclude bonds/CDs from both tabs) ───────────────
  const stockSummaries = summaries.filter(
    (s) => !isMutualFund(s.quoteType) && !isCusip(s.ticker),
  );
  const fundSummaries = summaries.filter(
    (s) => isMutualFund(s.quoteType) && !isCusip(s.ticker),
  );
  const activeList = activeType === "stocks" ? stockSummaries : fundSummaries;

  // ── Sort: nulls always last ────────────────────────────────────────────────
  const sortValue = (s: TickerSummary): number | null => {
    if (sortBy === "pnlPct") return s.pnlPercent;
    if (sortBy === "pnlDollar") return s.pnlDollar;
    if (sortBy === "dailyPct") return s.dailyChangePct;
    return s.totalInvested; // "invested" — higher = better
  };

  const sorted = [...activeList].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // null sinks to bottom
    if (bv == null) return -1;
    return bv - av; // descending: best first
  });

  // ── P&L bar: width relative to the max absolute performer ─────────────────
  const maxAbsPnlPct = sorted.reduce((max, s) => {
    if (s.pnlPercent == null) return max;
    return Math.max(max, Math.abs(s.pnlPercent));
  }, 0);

  const barWidth = (s: TickerSummary): number => {
    if (maxAbsPnlPct === 0 || s.pnlPercent == null) return 0;
    return Math.round((Math.abs(s.pnlPercent) / maxAbsPnlPct) * 100);
  };

  const emptyLabel =
    activeType === "stocks"
      ? "No stocks in this portfolio."
      : "No mutual funds in this portfolio.";

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-5 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center">
        <SummaryPill
          label="Market Value"
          value={formatCurrency(totalMarketValue || null)}
          title="The current total market value of all your holdings (excluding bonds/CDs)."
        />
        <SummaryPill
          label="Total Invested"
          value={formatCurrency(totalInvested || null)}
          title="The total amount of money you have put into all your holdings."
        />
        <SummaryPill
          label="Unrealized Gain / Loss"
          value={
            totalMarketValue
              ? `${formatCurrency(totalPnlDollar)} (${formatPercent(totalPnlPct)})`
              : "—"
          }
          valueClass={pnlColor(totalPnlDollar)}
          title="How much your portfolio has gained or lost compared to what you paid. 'Unrealized' means you haven't sold yet."
        />
        <SummaryPill
          label="Today's Change"
          value={
            totalMarketValue
              ? `${totalDailyChangeDollar >= 0 ? "+" : ""}${formatCurrency(totalDailyChangeDollar)}`
              : "—"
          }
          valueClass={pnlColor(totalDailyChangeDollar)}
          title="Approximate dollar change in your total portfolio value since yesterday's market close."
        />
      </div>

      {/* ── Controls: asset type sub-tabs + sort buttons ───────────────────── */}
      <div className="shrink-0 border-b border-border bg-background px-5 py-2 flex flex-wrap items-center gap-3 justify-between">
        {/* Sub-tab pills */}
        <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setActiveType("stocks")}
            className={cn(
              "px-3 py-1 rounded-md text-sm font-medium transition-colors",
              activeType === "stocks"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Stocks
            {stockSummaries.length > 0 && (
              <span
                className={cn(
                  "ml-1.5 text-xs font-normal",
                  activeType === "stocks"
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60",
                )}
              >
                ({stockSummaries.length})
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveType("funds")}
            className={cn(
              "px-3 py-1 rounded-md text-sm font-medium transition-colors",
              activeType === "funds"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Mutual Funds
            {fundSummaries.length > 0 && (
              <span
                className={cn(
                  "ml-1.5 text-xs font-normal",
                  activeType === "funds"
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60",
                )}
              >
                ({fundSummaries.length})
              </span>
            )}
          </button>
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
            Sort:
          </span>
          {(
            [
              { key: "pnlPct", label: "Best Return %" },
              { key: "pnlDollar", label: "Gain / Loss $" },
              { key: "dailyPct", label: "Today's Move" },
              { key: "invested", label: "Amount Invested" },
            ] as { key: SortBy; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
                sortBy === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Ranked list ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {emptyLabel}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sorted.map((s, idx) => (
              <RankedRow
                key={s.ticker}
                rank={idx + 1}
                summary={s}
                barWidth={barWidth(s)}
                sortBy={sortBy}
                onSelect={onSelectTicker}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryPill({
  label,
  value,
  valueClass,
  title,
}: {
  label: string;
  value: string;
  valueClass?: string;
  title: string;
}) {
  return (
    <div title={title} className="flex flex-col cursor-default">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className={cn("text-sm font-semibold text-foreground", valueClass)}>
        {value}
      </span>
    </div>
  );
}

function RankedRow({
  rank,
  summary: s,
  barWidth,
  sortBy,
  onSelect,
}: {
  rank: number;
  summary: TickerSummary;
  barWidth: number;
  sortBy: SortBy;
  onSelect?: (ticker: string) => void;
}) {
  const hasPrice = s.currentPrice != null;
  const isGain = (s.pnlDollar ?? 0) > 0;
  const isLoss = (s.pnlDollar ?? 0) < 0;

  // Rank badge color
  const badgeClass = !hasPrice
    ? "bg-muted text-muted-foreground"
    : isGain
      ? "bg-positive/15 text-positive border border-positive/25"
      : isLoss
        ? "bg-negative/15 text-negative border border-negative/25"
        : "bg-muted text-muted-foreground";

  return (
    <div
      className={cn(
        "px-5 py-3.5 hover:bg-muted/30 transition-colors",
        onSelect && "cursor-pointer",
      )}
      onClick={() => onSelect?.(s.ticker)}
      title={onSelect ? `Open ${s.ticker} in Analysis` : undefined}
    >
      <div className="flex items-start gap-3">
        {/* Rank badge */}
        <div
          className={cn(
            "shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
            badgeClass,
          )}
          title={
            !hasPrice
              ? "No price data available"
              : isGain
                ? "This holding is in a gain"
                : isLoss
                  ? "This holding is in a loss"
                  : "Break even"
          }
        >
          {rank}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* Row 1: ticker, name, stale badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-foreground">{s.ticker}</span>
            {s.name && (
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                {s.name}
              </span>
            )}
            {s.isStale && hasPrice && (
              <span
                className="flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20"
                title="Price data may be out of date"
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                stale price
              </span>
            )}
          </div>

          {/* Row 2: P&L bar + P&L value */}
          <div className="flex items-center gap-3">
            {/* Bar */}
            <div
              className="flex-1 h-2 bg-muted/60 rounded-full overflow-hidden max-w-xs"
              title="Bar width shows this holding's gain/loss relative to the biggest mover in the list."
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  (s.pnlDollar ?? 0) >= 0 ? "bg-positive" : "bg-negative",
                )}
                style={{ width: `${barWidth}%` }}
              />
            </div>

            {/* P&L value — the hero number */}
            <div
              className={cn(
                "shrink-0 text-sm font-semibold",
                pnlColor(s.pnlDollar),
              )}
              title="Unrealized Gain/Loss — how much you've made or lost so far. This number is 'unrealized' because you haven't sold yet."
            >
              {s.pnlDollar != null ? (
                <>
                  {s.pnlDollar >= 0 ? "+" : ""}
                  {formatCurrency(s.pnlDollar)}{" "}
                  <span className="font-normal text-xs opacity-80">
                    ({formatPercent(s.pnlPercent)})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground text-xs">No price data</span>
              )}
            </div>
          </div>

          {/* Row 3: secondary metrics */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <MetricChip
              label="Shares"
              value={formatShares(s.totalShares)}
              title="Total number of shares you own."
            />
            <MetricChip
              label="Avg Cost"
              value={formatCurrency(s.avgCostBasis)}
              title="The average price you paid per share across all your purchases."
            />
            <MetricChip
              label="Current Price"
              value={s.currentPrice != null ? formatCurrency(s.currentPrice) : "—"}
              title="The latest market price per share."
            />
            <MetricChip
              label="Invested"
              value={formatCurrency(s.totalInvested)}
              title="Total money you put into this holding (shares × price paid for each purchase)."
            />
            <MetricChip
              label="Market Value"
              value={formatCurrency(s.marketValue)}
              title="What your shares are worth right now at the current market price."
            />
            <DailyChangeChip dailyChangePct={s.dailyChangePct} />
          </div>
        </div>

        {/* Sort highlight badge — shows the active sort value prominently on the right */}
        <SortHighlight summary={s} sortBy={sortBy} />
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title: string;
}) {
  return (
    <span title={title} className="cursor-default">
      <span className="opacity-70">{label}: </span>
      <span className="text-foreground/80 font-medium">{value}</span>
    </span>
  );
}

function DailyChangeChip({ dailyChangePct }: { dailyChangePct: number | null }) {
  if (dailyChangePct == null) return null;
  const isPos = dailyChangePct > 0;
  const isNeg = dailyChangePct < 0;
  return (
    <span
      title="How much the price changed today compared to yesterday's close."
      className={cn(
        "flex items-center gap-0.5 cursor-default",
        isPos ? "text-positive" : isNeg ? "text-negative" : "text-muted-foreground",
      )}
    >
      {isPos ? (
        <TrendingUp className="w-3 h-3" />
      ) : isNeg ? (
        <TrendingDown className="w-3 h-3" />
      ) : (
        <Minus className="w-3 h-3" />
      )}
      <span className="opacity-70">Today: </span>
      <span className="font-medium">
        {dailyChangePct >= 0 ? "+" : ""}
        {dailyChangePct.toFixed(2)}%
      </span>
    </span>
  );
}

/**
 * Shows the currently-sorted metric as a larger badge on the right side of
 * the row so users can instantly compare holdings by the same dimension.
 */
function SortHighlight({
  summary: s,
  sortBy,
}: {
  summary: TickerSummary;
  sortBy: SortBy;
}) {
  if (sortBy === "pnlPct") return null; // already shown as hero number in the bar row

  let value: string;
  let colorClass = "";
  let sublabel: string | null = null;

  if (sortBy === "pnlDollar") {
    if (s.pnlDollar == null) return null;
    value = `${s.pnlDollar >= 0 ? "+" : ""}${formatCurrency(s.pnlDollar)}`;
    colorClass = pnlColor(s.pnlDollar);
    sublabel = "Gain/Loss";
  } else if (sortBy === "dailyPct") {
    if (s.dailyChangePct == null) return null;
    value = `${s.dailyChangePct >= 0 ? "+" : ""}${s.dailyChangePct.toFixed(2)}%`;
    colorClass =
      s.dailyChangePct > 0
        ? "text-positive"
        : s.dailyChangePct < 0
          ? "text-negative"
          : "text-muted-foreground";
    sublabel = "Today";
  } else {
    // invested
    value = formatCurrency(s.totalInvested);
    sublabel = "Invested";
  }

  return (
    <div className="shrink-0 text-right min-w-[80px]">
      <div className={cn("text-sm font-semibold", colorClass)}>{value}</div>
      {sublabel && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}
