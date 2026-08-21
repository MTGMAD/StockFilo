import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChartData, ChartRange, ChartStyle } from "../../types";
import { formatCurrency, cn } from "../../lib/utils";
import { openUrl } from "../../lib/openUrl";
import {
  loadZoneChoice,
  saveZoneChoice,
  type TimeZoneChoice,
} from "../../lib/timezones";
import { ChartStyleMenu } from "./ChartStyleMenu";
import { TimeZoneMenu } from "./TimeZoneMenu";
import { RangeMenu } from "./RangeMenu";
import { TickerLogo } from "../shared/TickerLogo";
import { hasOhlc } from "./ohlc";
import { PriceChart } from "./PriceChart";

interface MountainChartProps {
  ticker: string;
  quoteType?: string | null;
}

const RANGES: { label: string; value: ChartRange; interval: string }[] = [
  { label: "1D", value: "1d", interval: "5m" },
  { label: "5D", value: "5d", interval: "15m" },
  { label: "1M", value: "1mo", interval: "30m" },
  { label: "6M", value: "6mo", interval: "1d" },
  { label: "YTD", value: "ytd", interval: "1d" },
  { label: "1Y", value: "1y", interval: "1d" },
  { label: "5Y", value: "5y", interval: "1wk" },
  { label: "All", value: "max", interval: "1mo" },
];

// Mutual funds / UITs only price daily — intraday intervals don't work
const FUND_RANGES: { label: string; value: ChartRange; interval: string }[] = [
  { label: "1M", value: "1mo", interval: "1d" },
  { label: "6M", value: "6mo", interval: "1d" },
  { label: "YTD", value: "ytd", interval: "1d" },
  { label: "1Y", value: "1y", interval: "1d" },
  { label: "5Y", value: "5y", interval: "1wk" },
  { label: "All", value: "max", interval: "1mo" },
];

export function MountainChart({ ticker, quoteType }: MountainChartProps) {
  const isFund = quoteType === "MUTUALFUND" || quoteType === "UIT";
  const ranges = isFund ? FUND_RANGES : RANGES;
  const defaultRange = isFund ? "1mo" : "1d";

  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [style, setStyle] = useState<ChartStyle>(() => {
    const saved = localStorage.getItem("stockfolio-chart-style");
    return saved === "line" || saved === "candles" || saved === "mountain"
      ? saved
      : "mountain";
  });

  function changeStyle(s: ChartStyle) {
    setStyle(s);
    localStorage.setItem("stockfolio-chart-style", s);
  }

  // Defaults to the machine's own zone, so nothing needs configuring to read
  // correctly for the market the user actually lives in.
  const [timeZone, setTimeZone] = useState<TimeZoneChoice>(loadZoneChoice);

  function changeTimeZone(z: TimeZoneChoice) {
    setTimeZone(z);
    saveZoneChoice(z);
  }
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset range when switching between stock and fund tickers
  useEffect(() => {
    setRange(defaultRange);
  }, [defaultRange]);

  const loadChart = useCallback(async () => {
    const r = ranges.find((r) => r.value === range) ?? ranges[0];
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<ChartData>("fetch_chart_command", {
        ticker,
        range: r.value,
        interval: r.interval,
      });
      setChartData(data);
    } catch (e) {
      setError(String(e));
      setChartData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, range, ranges]);

  useEffect(() => {
    loadChart();
    // Auto-refresh for intraday ranges (stocks only, not funds)
    if (!isFund && (range === "1d" || range === "5d")) {
      const id = setInterval(loadChart, 60_000);
      return () => clearInterval(id);
    }
  }, [loadChart, range, isFund]);

  const points = chartData?.points ?? [];
  const previousClose = chartData?.previous_close ?? null;

  // Determine if the chart is up or down
  const firstPrice = points.length > 0 ? points[0].close : null;
  const lastPrice = points.length > 0 ? points[points.length - 1].close : null;
  const refPrice = previousClose ?? firstPrice;
  const isUp = lastPrice != null && refPrice != null ? lastPrice >= refPrice : true;

  // Candles need OHLC, which Yahoo omits for some instruments and intervals.
  const candlesReady = hasOhlc(points);
  const effectiveStyle: ChartStyle =
    style === "candles" && !candlesReady ? "mountain" : style;

  // Tick precision has to follow the visible price range. Two cents of spread
  // formatted with toFixed(0) renders as "$26, $26, $26" — every tick looking
  // identical, which is what a fixed precision does to a narrow intraday range.
  const lows = points.map((p) => p.low ?? p.close);
  const highs = points.map((p) => p.high ?? p.close);
  const span =
    points.length > 0 ? Math.max(...highs) - Math.min(...lows) : 0;
  const priceDecimals = span >= 50 ? 0 : span >= 5 ? 1 : span >= 0.5 ? 2 : 3;


  // Price change display
  const priceDelta =
    lastPrice != null && refPrice != null ? lastPrice - refPrice : null;
  const pctDelta =
    priceDelta != null && refPrice != null && refPrice > 0
      ? (priceDelta / refPrice) * 100
      : null;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-4">
      {/* Header: identity on the left, controls on the right. */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <TickerLogo ticker={ticker} size="lg" />
            {/* Sized so the cap height sits level with the logo rather than
                floating beside it as a caption. */}
            <span className="text-2xl font-bold text-foreground truncate tracking-tight">
              {ticker}
            </span>
          </div>

          {/* Price sits under the identity rather than beside it, so a long
              name can never push the change onto a second line. */}
          {lastPrice != null && (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-foreground tabular-nums">
                {formatCurrency(lastPrice)}
              </span>
              {priceDelta != null && pctDelta != null && (
                <span
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    isUp ? "text-positive" : "text-negative",
                  )}
                >
                  {priceDelta >= 0 ? "+" : "-"}
                  {formatCurrency(Math.abs(priceDelta))} (
                  {pctDelta >= 0 ? "+" : ""}
                  {pctDelta.toFixed(2)}%)
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <TimeZoneMenu value={timeZone} onChange={changeTimeZone} />
          <ChartStyleMenu
            value={style}
            onChange={changeStyle}
            candlesUnavailableReason={
              candlesReady
                ? null
                : "No open/high/low data for this range"
            }
          />
          <div className="w-px h-4 bg-border mx-0.5" />
          <RangeMenu ranges={ranges} value={range} onChange={setRange} />
        </div>
      </div>

      {/* Chart area. Taller than the header above it needs, so the extra height
          extends downward into the page rather than pushing the price summary
          up — the ticker, price and controls stay exactly where they were. */}
      <div className="h-[360px]">
        {loading && points.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading chart…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-500 text-sm">
            {error}
          </div>
        ) : points.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No chart data available
          </div>
        ) : (
          <PriceChart
            points={points}
            style={effectiveStyle}
            range={range}
            previousClose={previousClose}
            isUp={isUp}
            priceDecimals={priceDecimals}
            timeZone={timeZone}
            resetKey={`${ticker}|${range}|${effectiveStyle}`}
          />
        )}
      </div>

      {/* Lightweight Charts is Apache-2.0 and requires attribution with a link
          back to TradingView wherever its charts are shown. */}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={() => openUrl("https://www.tradingview.com/", "browser")}
          className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          Charts by TradingView
        </button>
      </div>
    </div>
  );
}
