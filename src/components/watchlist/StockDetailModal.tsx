import { useEffect, useState } from "react";
import type { Stock, LinkOpenMode } from "../../types";
import { formatCurrency, formatPercent, pnlColor, cn } from "../../lib/utils";
import { fetchUpcomingEarnings, addEarningsCallToCalendar } from "../../lib/db";
import { MountainChart } from "../analysis/MountainChart";
import { TickerNews } from "../analysis/TickerNews";
import { TickerLogo } from "../shared/TickerLogo";
import {
  X, TrendingUp, TrendingDown, Minus, ShoppingCart, ExternalLink,
  Target, BarChart2, Info, CalendarDays,
} from "lucide-react";
import { openUrl } from "../../lib/openUrl";

interface StockDetailModalProps {
  ticker: string;
  stock: Stock | undefined;
  watchPrice: number | null;
  linkOpenMode: LinkOpenMode;
  onClose: () => void;
  onBuy: (ticker: string) => void;
}

export function StockDetailModal({
  ticker,
  stock,
  watchPrice,
  linkOpenMode,
  onClose,
  onBuy,
}: StockDetailModalProps) {
  const [earningsAt, setEarningsAt] = useState<number | null>(null);
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch upcoming earnings for this ticker
  useEffect(() => {
    let cancelled = false;
    fetchUpcomingEarnings([ticker], 30)
      .then((events) => {
        if (cancelled) return;
        const event = events.find((e) => e.ticker === ticker);
        setEarningsAt(event?.event_at ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticker]);

  async function handleAddToCalendar() {
    if (earningsAt == null) return;
    setAddingToCalendar(true);
    setCalendarError(null);
    try {
      await addEarningsCallToCalendar(ticker, earningsAt);
    } catch {
      setCalendarError("Could not open calendar. Please try again.");
    } finally {
      setAddingToCalendar(false);
    }
  }

  function formatDateTime(unixSeconds: number): string {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(unixSeconds * 1000));
  }

  const currentPrice = stock?.last_price ?? null;
  const dailyChangePct = stock?.daily_change_pct ?? null;
  const targetMeanPrice = stock?.target_mean_price ?? null;

  const sinceWatchPct =
    watchPrice != null && currentPrice != null && watchPrice > 0
      ? ((currentPrice - watchPrice) / watchPrice) * 100
      : null;

  const upsidePct =
    targetMeanPrice != null && currentPrice != null && currentPrice > 0
      ? ((targetMeanPrice - currentPrice) / currentPrice) * 100
      : null;

  const DailyIcon =
    dailyChangePct == null ? null
    : dailyChangePct > 0 ? TrendingUp
    : dailyChangePct < 0 ? TrendingDown
    : Minus;

  async function openYahoo() {
    await openUrl(`https://finance.yahoo.com/quote/${ticker}`, linkOpenMode, `${ticker} - Yahoo Finance`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <TickerLogo ticker={ticker} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{ticker}</h2>
                {stock?.quote_type && (
                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {stock.quote_type}
                  </span>
                )}
              </div>
              {stock?.name && (
                <p className="text-sm text-muted-foreground">{stock.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {earningsAt != null && (
              <button
                onClick={handleAddToCalendar}
                disabled={addingToCalendar}
                className="btn-secondary text-xs px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                title="Add earnings call to your default calendar app"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                {addingToCalendar ? "Opening…" : `Add Earnings Call (${formatDateTime(earningsAt)})`}
              </button>
            )}
            {calendarError && (
              <span className="text-xs text-red-500">{calendarError}</span>
            )}
            <button
              onClick={openYahoo}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Open on Yahoo Finance"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Yahoo Finance
            </button>
            <button
              onClick={() => onBuy(ticker)}
              className="btn-primary flex items-center gap-1.5"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Buy
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Key metrics bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-b border-border">
            {/* Current Price */}
            <MetricCard
              label="Current Price"
              tooltip="The latest market price for this stock."
            >
              <span className="text-2xl font-bold text-foreground">
                {currentPrice != null ? formatCurrency(currentPrice) : "—"}
              </span>
              {DailyIcon && dailyChangePct != null && (
                <span className={cn("flex items-center gap-1 text-sm font-medium mt-0.5", pnlColor(dailyChangePct))}>
                  <DailyIcon className="w-3.5 h-3.5" />
                  {formatPercent(dailyChangePct)} today
                </span>
              )}
            </MetricCard>

            {/* Analyst 1Y Target */}
            <MetricCard
              label="Analyst 1-Year Target"
              tooltip="The average price target set by Wall Street analysts for the next 12 months. A higher target than the current price suggests analysts expect the stock to rise."
            >
              {targetMeanPrice != null ? (
                <>
                  <span className="text-2xl font-bold text-foreground">{formatCurrency(targetMeanPrice)}</span>
                  {upsidePct != null && (
                    <span className={cn("text-sm font-medium mt-0.5", pnlColor(upsidePct))}>
                      {upsidePct >= 0 ? "+" : ""}{formatPercent(upsidePct)} potential
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground text-sm">No analyst data</span>
              )}
            </MetricCard>

            {/* Since You Started Watching */}
            <MetricCard
              label="Since You Added"
              tooltip="How much the price has moved since you added this stock to your watchlist."
            >
              {watchPrice != null && currentPrice != null ? (
                <>
                  <span className="text-2xl font-bold text-foreground">
                    {sinceWatchPct != null ? (
                      <span className={pnlColor(sinceWatchPct)}>
                        {sinceWatchPct >= 0 ? "+" : ""}{formatPercent(sinceWatchPct)}
                      </span>
                    ) : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5">
                    Added at {formatCurrency(watchPrice)}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground text-sm">No watch price</span>
              )}
            </MetricCard>

            {/* Buy Decision Helper */}
            <MetricCard
              label="Buy Signal"
              tooltip="A simple summary comparing today's price to the analyst target. This is a guide only — always do your own research."
            >
              <BuySignal upsidePct={upsidePct} dailyChangePct={dailyChangePct} />
            </MetricCard>
          </div>

          {/* Investor primer cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-6 py-4 border-b border-border">
            <PrimerCard
              icon={<BarChart2 className="w-4 h-4 text-primary" />}
              title="Price Chart"
              body="The chart below shows price history. Look for an upward trend over time. Short-term dips are normal — focus on the long-term direction."
            />
            <PrimerCard
              icon={<Target className="w-4 h-4 text-primary" />}
              title="Analyst Target"
              body="Analysts study a company's finances and set a price target. If analysts' target is significantly above today's price, that may indicate a buying opportunity."
            />
            <PrimerCard
              icon={<Info className="w-4 h-4 text-primary" />}
              title="Do Your Research"
              body="Read recent news before buying. Understand what the company does, how it makes money, and any risks. Never invest more than you can afford to lose."
            />
          </div>

          {/* Chart */}
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <BarChart2 className="w-4 h-4" />
              Price History
            </h3>
            <MountainChart ticker={ticker} quoteType={stock?.quote_type} />
          </div>

          {/* News */}
          <div className="px-6 py-4">
            <TickerNews ticker={ticker} linkOpenMode={linkOpenMode} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background px-5 py-4 flex flex-col gap-0.5" title={tooltip}>
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
        {label}
      </span>
      {children}
    </div>
  );
}

function PrimerCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function BuySignal({
  upsidePct,
  dailyChangePct: _dailyChangePct,
}: {
  upsidePct: number | null;
  dailyChangePct: number | null;
}) {
  if (upsidePct == null) {
    return <span className="text-sm text-muted-foreground">No analyst data</span>;
  }

  if (upsidePct >= 15) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-bold text-green-500">Bullish</span>
        <span className="text-xs text-muted-foreground">Analysts see strong upside</span>
      </div>
    );
  }
  if (upsidePct >= 5) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-bold text-primary">Moderate</span>
        <span className="text-xs text-muted-foreground">Some analyst upside</span>
      </div>
    );
  }
  if (upsidePct >= -5) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-bold text-muted-foreground">Neutral</span>
        <span className="text-xs text-muted-foreground">Near analyst fair value</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-base font-bold text-red-500">Caution</span>
      <span className="text-xs text-muted-foreground">Price above analyst target</span>
    </div>
  );
}
