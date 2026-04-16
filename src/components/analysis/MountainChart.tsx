import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChartData, ChartRange } from "../../types";
import { formatCurrency, getCssVar, cn } from "../../lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

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

function formatTime(ts: number, range: ChartRange): string {
  const d = new Date(ts * 1000);
  if (range === "1d") {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (range === "5d") {
    return d.toLocaleDateString([], { weekday: "short", hour: "numeric" });
  }
  if (range === "1mo" || range === "6mo" || range === "ytd") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
}

export function MountainChart({ ticker, quoteType }: MountainChartProps) {
  const isFund = quoteType === "MUTUALFUND" || quoteType === "UIT";
  const ranges = isFund ? FUND_RANGES : RANGES;
  const defaultRange = isFund ? "1mo" : "1d";

  const [range, setRange] = useState<ChartRange>(defaultRange);
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

  const chartColor = isUp ? getCssVar("--positive") : getCssVar("--negative"); // theme-aware
  const gradientId = `mountain-gradient-${ticker}`;

  // Price change display
  const priceDelta =
    lastPrice != null && refPrice != null ? lastPrice - refPrice : null;
  const pctDelta =
    priceDelta != null && refPrice != null && refPrice > 0
      ? (priceDelta / refPrice) * 100
      : null;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-muted-foreground">
          {ticker} Price Chart
        </h3>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Price summary */}
      {lastPrice != null && (
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-bold text-foreground">
            {formatCurrency(lastPrice)}
          </span>
          {priceDelta != null && pctDelta != null && (
            <span
              className={cn(
                "text-sm font-medium",
                isUp ? "text-positive" : "text-negative"
              )}
            >
              {priceDelta >= 0 ? "+" : ""}
              {priceDelta.toFixed(2)} ({pctDelta >= 0 ? "+" : ""}
              {pctDelta.toFixed(2)}%)
            </span>
          )}
        </div>
      )}

      {/* Chart area */}
      <div className="h-[260px]">
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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="timestamp"
                tickFormatter={(ts) => formatTime(ts, range)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(v) => `$${v.toFixed(0)}`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={55}
              />
              <Tooltip
                labelFormatter={(ts) => {
                  const d = new Date((ts as number) * 1000);
                  if (range === "1d" || range === "5d") {
                    return d.toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    });
                  }
                  return d.toLocaleDateString([], {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  });
                }}
                formatter={(value) => [value != null ? formatCurrency(Number(value)) : "—", "Price"] as [string, string]}
                contentStyle={{
                  background: "var(--background)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              />
              {previousClose != null && range === "1d" && (
                <ReferenceLine
                  y={previousClose}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
              )}
              <Area
                type="monotone"
                dataKey="close"
                stroke={chartColor}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: chartColor }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
