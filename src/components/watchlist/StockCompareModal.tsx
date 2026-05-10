import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Stock, ComparisonStats, LinkOpenMode } from "../../types";
import { formatCurrency, formatPercent, pnlColor, cn } from "../../lib/utils";
import { SparkLine } from "./SparkLine";
import { TickerLogo } from "../shared/TickerLogo";
import {
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingCart,
  Info,
  RefreshCw,
  Trophy,
  AlertTriangle,
} from "lucide-react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

// ── Types ────────────────────────────────────────────────────────────────────

interface StockCompareModalProps {
  tickers: string[];
  stocks: Stock[];
  linkOpenMode: LinkOpenMode;
  onClose: () => void;
  onBuy: (ticker: string) => void;
}

// ── Color palette per stock position ─────────────────────────────────────────

const ACCENT_BORDER = [
  "border-t-blue-500",
  "border-t-emerald-500",
  "border-t-amber-500",
  "border-t-purple-500",
];
const ACCENT_TEXT = [
  "text-blue-400",
  "text-emerald-400",
  "text-amber-400",
  "text-purple-400",
];

const ACCENT_RING = [
  "ring-blue-500/50",
  "ring-emerald-500/50",
  "ring-amber-500/50",
  "ring-purple-500/50",
];
const WINNER_GLOW = [
  "bg-blue-500/10 ring-1 ring-blue-500/40",
  "bg-emerald-500/10 ring-1 ring-emerald-500/40",
  "bg-amber-500/10 ring-1 ring-amber-500/40",
  "bg-purple-500/10 ring-1 ring-purple-500/40",
];

// ── Analyst rating helpers ───────────────────────────────────────────────────

function ratingLabel(key: string | null): string {
  switch (key?.toLowerCase()) {
    case "strong_buy": return "Bullish";
    case "buy": return "Buy";
    case "hold": return "Hold";
    case "sell":
    case "strong_sell": return "Bearish";
    case "underperform": return "Bearish";
    default: return "—";
  }
}

function ratingColor(key: string | null): string {
  switch (key?.toLowerCase()) {
    case "strong_buy": return "bg-emerald-500 text-white";
    case "buy": return "bg-green-500 text-white";
    case "hold": return "bg-amber-500 text-white";
    case "sell":
    case "strong_sell":
    case "underperform": return "bg-red-500 text-white";
    default: return "bg-muted text-muted-foreground";
  }
}

function ratingScore(key: string | null): number {
  switch (key?.toLowerCase()) {
    case "strong_buy": return 5;
    case "buy": return 4;
    case "hold": return 3;
    case "underperform": return 2;
    case "sell": return 1;
    case "strong_sell": return 0;
    default: return -1;
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatLargeCap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

function formatPE(v: number | null): string {
  if (v == null || v <= 0) return "—";
  return v.toFixed(1) + "x";
}

function formatPB(v: number | null): string {
  if (v == null || v <= 0) return "—";
  return v.toFixed(2) + "x";
}

function formatBeta(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function formatMargin(v: number | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function formatDivYield(v: number | null): string {
  if (v == null || v <= 0) return "—";
  // Yahoo returns as decimal (e.g. 0.0123 = 1.23%) or already as % — normalise
  const pct = v > 1 ? v : v * 100;
  return pct.toFixed(2) + "%";
}

function formatEPS(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

// ── Tooltip component ─────────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  if (!text) return null;
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex items-center"
            aria-label="More information"
          >
            <Info className="w-3 h-3 text-muted-foreground cursor-help ml-1" />
          </button>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            sideOffset={8}
            className="z-50 max-w-xs rounded-lg bg-foreground px-3 py-2.5 text-xs font-medium text-background shadow-lg border border-foreground/20 backdrop-blur-sm"
          >
            {text}
            <RadixTooltip.Arrow className="fill-foreground" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <div className="flex gap-2 py-3 border-b border-border/50 animate-pulse">
      <div className="w-32 h-4 rounded bg-muted shrink-0" />
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="flex-1 h-4 rounded bg-muted" />
      ))}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 pt-5 pb-1">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
    </div>
  );
}

// ── Metric row ────────────────────────────────────────────────────────────────

interface MetricRowProps {
  label: string;
  tooltip?: string;
  values: (string | React.ReactNode)[];
  winnerIndex: number | null;
  count: number;
}

function MetricRow({ label, tooltip, values, winnerIndex, count }: MetricRowProps) {
  return (
    <div className="flex items-start border-b border-border/40 last:border-0">
      <div className="w-36 shrink-0 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-0.5 leading-snug">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      {values.map((val, i) => (
        <div
          key={i}
          className={cn(
            "flex-1 px-3 py-2.5 text-sm font-medium text-center",
            winnerIndex === i
              ? cn("rounded-md mx-0.5", WINNER_GLOW[i])
              : "text-foreground",
          )}
          style={{ minWidth: 0 }}
        >
          <span className={winnerIndex === i ? ACCENT_TEXT[i] : undefined}>
            {val}
          </span>
          {winnerIndex === i && count > 1 && (
            <Trophy className={cn("inline w-3 h-3 ml-1", ACCENT_TEXT[i])} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── 52-week range bar ─────────────────────────────────────────────────────────

function RangeBar({
  low,
  high,
  current,
  colorIdx,
}: {
  low: number | null;
  high: number | null;
  current: number | null;
  colorIdx: number;
}) {
  const BAR_FILL = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-purple-500",
  ];

  if (low == null || high == null || current == null || high <= low) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  const pct = Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100));
  return (
    <div className="w-full px-1">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{formatCurrency(low)}</span>
        <span>{formatCurrency(high)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-visible">
        <div
          className={cn("h-full rounded-full", BAR_FILL[colorIdx])}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background shadow"
          style={{
            left: `calc(${pct}% - 6px)`,
            backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#a855f7"][colorIdx],
          }}
        />
      </div>
      <div className="text-xs text-center mt-1 font-medium text-foreground">
        {formatCurrency(current)}
        <span className="text-muted-foreground ml-1">
          ({pct.toFixed(0)}% of range)
        </span>
      </div>
    </div>
  );
}

// ── Quick Verdict ─────────────────────────────────────────────────────────────

function buildVerdict(tickers: string[], stats: ComparisonStats[]): string {
  const sentences: string[] = [];

  // Best analyst upside
  let bestUpsideIdx = -1;
  let bestUpside = -Infinity;
  stats.forEach((s, i) => {
    if (s.target_mean_price != null && s.price != null && s.price > 0) {
      const up = ((s.target_mean_price - s.price) / s.price) * 100;
      if (up > bestUpside) { bestUpside = up; bestUpsideIdx = i; }
    }
  });
  if (bestUpsideIdx !== -1 && bestUpside > 0) {
    sentences.push(`${tickers[bestUpsideIdx]} leads on analyst upside (+${bestUpside.toFixed(0)}% to 1-year target).`);
  }

  // Best profit margin
  let bestMarginIdx = -1;
  let bestMargin = -Infinity;
  stats.forEach((s, i) => {
    if (s.profit_margins != null && s.profit_margins > bestMargin) {
      bestMargin = s.profit_margins; bestMarginIdx = i;
    }
  });
  if (bestMarginIdx !== -1) {
    sentences.push(`${tickers[bestMarginIdx]} has the strongest profit margins (${(bestMargin * 100).toFixed(1)}%).`);
  }

  // Lowest beta (least risky)
  let stableIdx = -1;
  let stableDiff = Infinity;
  stats.forEach((s, i) => {
    if (s.beta != null) {
      const diff = Math.abs(s.beta - 1);
      if (diff < stableDiff) { stableDiff = diff; stableIdx = i; }
    }
  });
  if (stableIdx !== -1) {
    const beta = stats[stableIdx].beta!;
    sentences.push(`${tickers[stableIdx]} carries the ${beta < 1 ? "least" : "most predictable"} volatility with a beta of ${beta.toFixed(2)}.`);
  }

  // Best forward P/E (value)
  let bestPEIdx = -1;
  let bestPE = Infinity;
  stats.forEach((s, i) => {
    if (s.forward_pe != null && s.forward_pe > 0 && s.forward_pe < bestPE) {
      bestPE = s.forward_pe; bestPEIdx = i;
    }
  });
  if (bestPEIdx !== -1 && sentences.length < 4) {
    sentences.push(`${tickers[bestPEIdx]} offers the best value on forward P/E (${bestPE.toFixed(1)}x).`);
  }

  if (sentences.length === 0) {
    return "No sufficient data available to generate a verdict. Try refreshing the data.";
  }

  return sentences.join(" ");
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function StockCompareModal({
  tickers,
  stocks,
  onClose,
  onBuy,
}: StockCompareModalProps) {
  const [statsMap, setStatsMap] = useState<Map<string, ComparisonStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const results = await invoke<ComparisonStats[]>("fetch_comparison_stats_command", {
        tickers,
      });
      const map = new Map<string, ComparisonStats>();
      for (const r of results) map.set(r.ticker, r);
      setStatsMap(map);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(",")]);

  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const count = tickers.length;

  // Get stats in ticker order
  const statsList: ComparisonStats[] = tickers.map((t) => {
    const s = statsMap.get(t);
    if (s) return s;
    const cached = stockMap.get(t);
    return {
      ticker: t,
      price: cached?.last_price ?? null,
      name: cached?.name ?? null,
      daily_change_pct: cached?.daily_change_pct ?? null,
      target_mean_price: cached?.target_mean_price ?? null,
      post_market_price: cached?.post_market_price ?? null,
      post_market_change_pct: cached?.post_market_change_pct ?? null,
      pre_market_price: cached?.pre_market_price ?? null,
      pre_market_change_pct: cached?.pre_market_change_pct ?? null,
      market_state: cached?.market_state ?? null,
      market_cap: null, trailing_pe: null, forward_pe: null, price_to_book: null,
      beta: null, fifty_two_week_high: null, fifty_two_week_low: null,
      dividend_yield: null, eps_trailing: null, recommendation_key: null,
      number_of_analyst_opinions: null, gross_margins: null,
      operating_margins: null, profit_margins: null, revenue_growth: null,
    };
  });

  // ── Winner finding helpers ──────────────────────────────────────────────────

  function winnerByMax(vals: (number | null)[]): number | null {
    let best: number | null = null;
    let bestIdx: number | null = null;
    vals.forEach((v, i) => {
      if (v != null && (best == null || v > best)) { best = v; bestIdx = i; }
    });
    return bestIdx;
  }

  function winnerByMin(vals: (number | null)[], positiveOnly = true): number | null {
    let best: number | null = null;
    let bestIdx: number | null = null;
    vals.forEach((v, i) => {
      if (v != null && (!positiveOnly || v > 0) && (best == null || v < best)) {
        best = v; bestIdx = i;
      }
    });
    return bestIdx;
  }

  function winnerClosestToOne(vals: (number | null)[]): number | null {
    let best: number | null = null;
    let bestIdx: number | null = null;
    vals.forEach((v, i) => {
      if (v != null) {
        const d = Math.abs(v - 1);
        if (best == null || d < best) { best = d; bestIdx = i; }
      }
    });
    return bestIdx;
  }

  // ── Section values ──────────────────────────────────────────────────────────

  const prices = statsList.map((s) => s.price);
  const dailyChanges = statsList.map((s) => s.daily_change_pct);
  const marketCaps = statsList.map((s) => s.market_cap);
  const trailingPEs = statsList.map((s) => s.trailing_pe);
  const forwardPEs = statsList.map((s) => s.forward_pe);
  const pbs = statsList.map((s) => s.price_to_book);
  const targets = statsList.map((s) => s.target_mean_price);
  const upsides = statsList.map((s) =>
    s.target_mean_price != null && s.price != null && s.price > 0
      ? ((s.target_mean_price - s.price) / s.price) * 100
      : null,
  );
  const opinions = statsList.map((s) => s.number_of_analyst_opinions);
  const betas = statsList.map((s) => s.beta);
  const grossMargins = statsList.map((s) => s.gross_margins);
  const opMargins = statsList.map((s) => s.operating_margins);
  const profitMargins = statsList.map((s) => s.profit_margins);
  const revGrowths = statsList.map((s) => s.revenue_growth);
  const divYields = statsList.map((s) => s.dividend_yield);
  const eps = statsList.map((s) => s.eps_trailing);
  const ratingScores = statsList.map((s) => ratingScore(s.recommendation_key));

  const verdict = !loading && !error ? buildVerdict(tickers, statsList) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold text-foreground">Compare Stocks</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Side-by-side analysis · Live data from Yahoo Finance
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadStats}
              disabled={loading}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Stock header cards ── */}
          <div
            className="grid border-b border-border bg-muted/30"
            style={{ gridTemplateColumns: `144px repeat(${count}, 1fr)` }}
          >
            {/* empty label cell */}
            <div />
            {tickers.map((ticker, idx) => {
              const s = statsList[idx];
              const cached = stockMap.get(ticker);
              const price = s.price ?? cached?.last_price;
              const daily = s.daily_change_pct ?? cached?.daily_change_pct;
              const DailyIcon = daily == null ? null : daily > 0 ? TrendingUp : daily < 0 ? TrendingDown : Minus;
              const upside = upsides[idx];
              const rating = s.recommendation_key;

              return (
                <div
                  key={ticker}
                  className={cn(
                    "border-t-4 p-4 flex flex-col gap-2 border-l border-border",
                    ACCENT_BORDER[idx],
                  )}
                >
                  {/* Logo + ticker + name */}
                  <div className="flex items-center gap-2.5">
                    <div className={cn("rounded-full p-0.5 ring-2", ACCENT_RING[idx])}>
                      <TickerLogo ticker={ticker} size="md" />
                    </div>
                    <div className="min-w-0">
                      <div className={cn("font-bold text-lg leading-tight", ACCENT_TEXT[idx])}>
                        {ticker}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                        {s.name ?? cached?.name ?? "—"}
                      </div>
                    </div>
                  </div>

                  {/* Price + daily change */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-2xl font-bold text-foreground">
                      {price != null ? formatCurrency(price) : "—"}
                    </span>
                    {DailyIcon && daily != null && (
                      <span className={cn("flex items-center gap-0.5 text-sm font-medium", pnlColor(daily))}>
                        <DailyIcon className="w-3.5 h-3.5" />
                        {formatPercent(daily)}
                      </span>
                    )}
                  </div>

                  {/* Sparkline */}
                  <SparkLine ticker={ticker} quoteType={cached?.quote_type} />

                  {/* Analyst rating badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {rating ? (
                      <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", ratingColor(rating))}>
                        {ratingLabel(rating)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No rating</span>
                    )}
                    {s.number_of_analyst_opinions != null && (
                      <span className="text-xs text-muted-foreground">
                        {s.number_of_analyst_opinions} analysts
                      </span>
                    )}
                  </div>

                  {/* 1-year target */}
                  <div className="text-xs leading-snug">
                    <span className="text-muted-foreground">1Y Target: </span>
                    {s.target_mean_price != null ? (
                      <>
                        <span className="font-semibold text-foreground">
                          {formatCurrency(s.target_mean_price)}
                        </span>
                        {upside != null && (
                          <span className={cn("ml-1 font-medium", pnlColor(upside))}>
                            ({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Buy button */}
                  <button
                    type="button"
                    onClick={() => onBuy(ticker)}
                    className={cn(
                      "mt-auto flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-sm font-semibold transition-colors",
                      idx === 0 ? "bg-blue-500 hover:bg-blue-600 text-white" :
                      idx === 1 ? "bg-emerald-500 hover:bg-emerald-600 text-white" :
                      idx === 2 ? "bg-amber-500 hover:bg-amber-600 text-white" :
                                  "bg-purple-500 hover:bg-purple-600 text-white",
                    )}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Buy {ticker}
                  </button>
                </div>
              );
            })}
          </div>

          {/* ── Error state ── */}
          {error && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm text-foreground font-medium">Could not load comparison data</p>
              <p className="text-xs max-w-sm text-center">{error}</p>
              <button onClick={loadStats} className="btn-secondary flex items-center gap-2 text-sm">
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          )}

          {/* ── Skeleton ── */}
          {loading && !error && (
            <div className="px-4 py-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <SkeletonRow key={i} cols={count} />
              ))}
            </div>
          )}

          {/* ── Comparison table ── */}
          {!loading && !error && (
            <>
              {/* § Price & Performance */}
              <SectionHeader title="Price & Performance" />
              <div>
                <MetricRow
                  label="Current Price"
                  values={prices.map((v) => v != null ? formatCurrency(v) : "—")}
                  winnerIndex={null}
                  count={count}
                />
                <MetricRow
                  label="Today's Change"
                  tooltip="How much this stock has moved so far today."
                  values={dailyChanges.map((v) => v != null ? (
                    <span className={pnlColor(v)}>{formatPercent(v)}</span>
                  ) : "—")}
                  winnerIndex={winnerByMax(dailyChanges)}
                  count={count}
                />
                <MetricRow
                  label="Market Cap"
                  tooltip="Total market value of all outstanding shares. Larger = more established company."
                  values={marketCaps.map(formatLargeCap)}
                  winnerIndex={winnerByMax(marketCaps)}
                  count={count}
                />
              </div>

              {/* § Valuation */}
              <SectionHeader title="Valuation" />
              <div>
                <MetricRow
                  label="Trailing P/E"
                  tooltip="Price divided by last 12 months of earnings. Lower = potentially cheaper, but can signal slow growth."
                  values={trailingPEs.map(formatPE)}
                  winnerIndex={winnerByMin(trailingPEs)}
                  count={count}
                />
                <MetricRow
                  label="Forward P/E"
                  tooltip="Price divided by next 12 months of expected earnings. A key valuation signal — lower is generally better value."
                  values={forwardPEs.map(formatPE)}
                  winnerIndex={winnerByMin(forwardPEs)}
                  count={count}
                />
                <MetricRow
                  label="Price / Book"
                  tooltip="Stock price relative to book value (assets minus liabilities). Below 1 may indicate undervaluation."
                  values={pbs.map(formatPB)}
                  winnerIndex={winnerByMin(pbs)}
                  count={count}
                />
              </div>

              {/* § Analyst Consensus */}
              <SectionHeader title="Analyst Consensus" />
              <div>
                <MetricRow
                  label="Rating"
                  tooltip="Aggregated analyst recommendation: Bullish = strong buy, Buy, Hold, or Bearish = sell/avoid."
                  values={statsList.map((s) => (
                    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", ratingColor(s.recommendation_key))}>
                      {ratingLabel(s.recommendation_key)}
                    </span>
                  ))}
                  winnerIndex={winnerByMax(ratingScores.map((v) => v >= 0 ? v : null))}
                  count={count}
                />
                <MetricRow
                  label="1-Year Target"
                  tooltip="Analyst consensus price target 12 months from now."
                  values={targets.map((v) => v != null ? formatCurrency(v) : "—")}
                  winnerIndex={null}
                  count={count}
                />
                <MetricRow
                  label="Upside to Target"
                  tooltip="How much the stock could gain if it reaches the analyst target price."
                  values={upsides.map((v) => v != null ? (
                    <span className={pnlColor(v)}>
                      {v >= 0 ? "+" : ""}{v.toFixed(1)}%
                    </span>
                  ) : "—")}
                  winnerIndex={winnerByMax(upsides)}
                  count={count}
                />
                <MetricRow
                  label="# of Analysts"
                  tooltip="How many analysts cover this stock. More analysts = more reliable consensus."
                  values={opinions.map((v) => v != null ? String(v) : "—")}
                  winnerIndex={winnerByMax(opinions)}
                  count={count}
                />
              </div>

              {/* § 52-Week Range */}
              <SectionHeader title="52-Week Range" />
              <div className="px-4 py-4 border-b border-border/40">
                <div className="flex items-start">
                  <div className="w-36 shrink-0 px-0 py-1 text-xs text-muted-foreground flex items-center gap-0.5">
                    Price Position
                    <Tooltip text="Where the current price sits within the 52-week trading range. Closer to the low may indicate a buying opportunity; closer to the high means strong momentum." />
                  </div>
                  <div className="flex-1 grid gap-4" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
                    {statsList.map((s, i) => (
                      <RangeBar
                        key={tickers[i]}
                        low={s.fifty_two_week_low}
                        high={s.fifty_two_week_high}
                        current={s.price}
                        colorIdx={i}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* § Risk */}
              <SectionHeader title="Risk" />
              <div>
                <MetricRow
                  label="Beta"
                  tooltip="How much this stock moves versus the overall market (S&P 500). Beta of 1 = moves with the market. Below 1 = less volatile, above 1 = more volatile."
                  values={betas.map(formatBeta)}
                  winnerIndex={winnerClosestToOne(betas)}
                  count={count}
                />
              </div>

              {/* § Profitability */}
              <SectionHeader title="Profitability" />
              <div>
                <MetricRow
                  label="Gross Margin"
                  tooltip="Revenue minus cost of goods, as a percentage. Higher = more room to cover expenses and generate profit."
                  values={grossMargins.map(formatMargin)}
                  winnerIndex={winnerByMax(grossMargins)}
                  count={count}
                />
                <MetricRow
                  label="Operating Margin"
                  tooltip="Profit after operating costs but before interest and taxes, as a percentage. Higher = more efficient business."
                  values={opMargins.map(formatMargin)}
                  winnerIndex={winnerByMax(opMargins)}
                  count={count}
                />
                <MetricRow
                  label="Profit Margin"
                  tooltip="Net income as a percentage of revenue — the company's bottom-line profitability. Higher is better."
                  values={profitMargins.map(formatMargin)}
                  winnerIndex={winnerByMax(profitMargins)}
                  count={count}
                />
              </div>

              {/* § Growth & Income */}
              <SectionHeader title="Growth & Income" />
              <div>
                <MetricRow
                  label="Revenue Growth"
                  tooltip="Year-over-year revenue growth rate. Higher = faster-growing company."
                  values={revGrowths.map((v) => v != null ? (
                    <span className={pnlColor(v * 100)}>{formatMargin(v)}</span>
                  ) : "—")}
                  winnerIndex={winnerByMax(revGrowths)}
                  count={count}
                />
                <MetricRow
                  label="Dividend Yield"
                  tooltip="Annual dividend payment as a percentage of the stock price. Good for income investors; 0% means no dividend is paid."
                  values={divYields.map(formatDivYield)}
                  winnerIndex={winnerByMax(divYields.map((v) => v == null ? null : v > 1 ? v : v * 100))}
                  count={count}
                />
                <MetricRow
                  label="EPS (Trailing)"
                  tooltip="Earnings Per Share over the last 12 months. Higher = more profitable per share."
                  values={eps.map(formatEPS)}
                  winnerIndex={winnerByMax(eps)}
                  count={count}
                />
              </div>

              {/* § Quick Verdict */}
              <div className="px-6 py-5 border-t border-border bg-muted/20 mt-2">
                <div className="flex items-start gap-3">
                  <Trophy className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-1">Quick Verdict</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{verdict}</p>
                    <p className="text-xs text-muted-foreground/60 mt-2">
                      Based on live Yahoo Finance data. Not financial advice — always do your own research.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
