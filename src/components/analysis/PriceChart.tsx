import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  AreaSeries,
  LineSeries,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2 } from "lucide-react";
import type { ChartPoint, ChartRange, ChartStyle } from "../../types";
import { getCssVar } from "../../lib/utils";
import { formatInZone, type TimeZoneChoice } from "../../lib/timezones";

/**
 * Price chart, rendered with TradingView's Lightweight Charts.
 *
 * Chosen over a general-purpose chart library for one reason above all: it has
 * a real financial time scale. A numeric axis draws overnight and weekend gaps
 * as dead horizontal space; this collapses non-trading sessions, so an intraday
 * or multi-day chart shows only the time the market was actually open.
 *
 * The library is bundled locally and makes no network requests, so it does not
 * weaken the app's offline guarantee. Its Apache-2.0 licence does require
 * attribution — see the TradingView link rendered beneath the chart in
 * MountainChart.
 *
 * Colours are read from the CSS custom properties at mount and re-applied when
 * the theme class changes, because the library takes literal colour values and
 * cannot follow a CSS variable on its own.
 */

interface PriceChartProps {
  points: ChartPoint[];
  style: ChartStyle;
  range: ChartRange;
  /** Drawn as a dashed reference line on intraday ranges. */
  previousClose: number | null;
  /** Colour for the line/area series; candles use their own up/down colours. */
  isUp: boolean;
  /** Decimal places for the price axis, matched to the visible range. */
  priceDecimals: number;
  /** Zone the time axis is rendered in; "local" follows the system. */
  timeZone: TimeZoneChoice;
  /** Changes when the view should be re-framed — a new ticker, range or style.
   *  A plain data refresh must not, or it would undo the user's zoom. */
  resetKey: string;
}

/**
 * Resolve a CSS colour to `rgb(r, g, b)`.
 *
 * The theme tokens are modern space-separated `hsl(130 28% 42%)`, which cannot
 * carry a hex alpha suffix — appending one yields an unparseable colour and the
 * canvas gradient throws, taking the whole series render with it. Letting the
 * browser normalise the value first gives numeric channels that any alpha can
 * safely be built on.
 */
function resolveRgb(cssColor: string): [number, number, number] {
  const el = document.createElement("span");
  el.style.color = cssColor;
  el.style.display = "none";
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);

  const parts = computed.match(/-?\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return [0, 0, 0];
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function rgba([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function palette() {
  const up = resolveRgb(getCssVar("--positive"));
  const down = resolveRgb(getCssVar("--negative"));
  const text = resolveRgb(getCssVar("--muted-foreground"));
  const border = resolveRgb(getCssVar("--border"));
  return {
    text: rgba(text, 1),
    border: rgba(border, 1),
    up: rgba(up, 1),
    down: rgba(down, 1),
    upRgb: up,
    downRgb: down,
  };
}

/** Local-time labels, matching the rest of the app. Lightweight Charts renders
 *  UTC by default, which would show a 9:30 ET open as 13:30. */
function tickLabel(ts: number, range: ChartRange, zone: TimeZoneChoice): string {
  if (range === "1d") {
    return formatInZone(ts, zone, { hour: "numeric", minute: "2-digit" });
  }
  if (range === "5d") {
    return formatInZone(ts, zone, { weekday: "short", hour: "numeric" });
  }
  if (range === "1mo" || range === "6mo" || range === "ytd") {
    return formatInZone(ts, zone, { month: "short", day: "numeric" });
  }
  return formatInZone(ts, zone, { month: "short", year: "2-digit" });
}

function crosshairLabel(ts: number, range: ChartRange, zone: TimeZoneChoice): string {
  if (range === "1d" || range === "5d") {
    return formatInZone(ts, zone, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return formatInZone(ts, zone, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Time axis formatting per range.
 *
 * Deliberately no `barSpacing`: it pins bars to a fixed pixel width, which
 * overrides whatever `fitContent` worked out and leaves the series bunched
 * against the right edge with dead space to its left. `minBarSpacing` sets a
 * floor for readability without dictating the layout.
 */
function timeScaleOptions(range: ChartRange) {
  const intraday = range === "1d" || range === "5d";
  return {
    timeVisible: intraday,
    secondsVisible: false,
    minBarSpacing: 0.5,
  };
}

export function PriceChart({
  points,
  style,
  range,
  previousClose,
  isUp,
  priceDecimals,
  timeZone,
  resetKey,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The chart is created once but the formatters must see the current range,
  // so read it through a ref rather than closing over a stale value.
  const rangeRef = useRef<ChartRange>(range);
  rangeRef.current = range;
  const zoneRef = useRef<TimeZoneChoice>(timeZone);
  zoneRef.current = timeZone;
  const fittedForRef = useRef<string | null>(null);
  const [adjusted, setAdjusted] = useState(false);
  const adjustedRef = useRef(false);
  adjustedRef.current = adjusted;
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null);

  // Create the chart once, and tear it down properly on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const c = palette();
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: c.border, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.08 },
        autoScale: true,
        // Widen the hit area so the axis is comfortable to grab and drag.
        entireTextOnly: false,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        tickMarkFormatter: (t: unknown) =>
          tickLabel(t as number, rangeRef.current, zoneRef.current),
      },
      localization: {
        timeFormatter: (t: unknown) =>
          crosshairLabel(t as number, rangeRef.current, zoneRef.current),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.text, width: 1, style: LineStyle.Dashed, labelBackgroundColor: c.text },
        horzLine: { color: c.text, width: 1, style: LineStyle.Dashed, labelBackgroundColor: c.text },
      },
      // Zoom and pan the plot, and drag either axis to rescale it. Dragging
      // the price axis is what lets a chart be re-centred vertically; the
      // library drops out of auto-scale as soon as it is used.
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      width: Math.max(el.clientWidth, 1),
      height: Math.max(el.clientHeight, 1),
    });

    chartRef.current = chart;

    // Sizing is handled here rather than with the library's `autoSize`, which
    // installs its own ResizeObserver that can deliver a queued paint *after*
    // chart.remove() has disposed the canvas — "Object is disposed". Owning the
    // observer means it can be disconnected before disposal, deterministically.
    const resize = new ResizeObserver(() => {
      if (!chartRef.current) return;
      const width = Math.max(el.clientWidth, 1);
      const height = Math.max(el.clientHeight, 1);
      chart.applyOptions({ width, height });

      // Bar spacing survives a resize, so a chart first laid out at zero or
      // partial width would keep that spacing and sit squashed against the
      // right edge. Re-fit whenever the size changes — unless the user has
      // zoomed, in which case their framing is the one to respect.
      if (!adjustedRef.current) {
        chart.timeScale().fitContent();
      }
    });
    resize.observe(el);

    // Any zoom, pan or axis drag means the view is no longer auto-framed, so
    // offer a way back. Tracked from input events rather than by comparing
    // ranges, which would also fire on ordinary data updates.
    const markAdjusted = () => setAdjusted(true);
    el.addEventListener("wheel", markAdjusted, { passive: true });
    el.addEventListener("mousedown", markAdjusted);
    el.addEventListener("touchstart", markAdjusted, { passive: true });

    // The library takes literal colours, so a theme switch has to be pushed in.
    const observer = new MutationObserver(() => {
      const p = palette();
      chart.applyOptions({
        layout: { textColor: p.text },
        grid: { horzLines: { color: p.border } },
        crosshair: {
          vertLine: { color: p.text, labelBackgroundColor: p.text },
          horzLine: { color: p.text, labelBackgroundColor: p.text },
        },
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      // Order matters: stop every callback source before disposing, or a
      // queued frame will paint into a destroyed canvas.
      el.removeEventListener("wheel", markAdjusted);
      el.removeEventListener("mousedown", markAdjusted);
      el.removeEventListener("touchstart", markAdjusted);
      resize.disconnect();
      observer.disconnect();
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, []);

  // Rebuild the series whenever the style changes — a candlestick series and an
  // area series are different objects, not different options on one.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    const c = palette();
    const lineColor = isUp ? c.up : c.down;
    const priceFormat = {
      type: "price" as const,
      precision: priceDecimals,
      minMove: Math.pow(10, -priceDecimals),
    };

    if (style === "candles") {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: c.up,
        downColor: c.down,
        borderUpColor: c.up,
        borderDownColor: c.down,
        wickUpColor: c.up,
        wickDownColor: c.down,
        priceFormat,
      });
    } else if (style === "line") {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: lineColor,
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat,
      });
    } else {
      seriesRef.current = chart.addSeries(AreaSeries, {
        lineColor,
        topColor: rgba(isUp ? c.upRgb : c.downRgb, 0.3),
        bottomColor: rgba(isUp ? c.upRgb : c.downRgb, 0.02),
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat,
      });
    }
  }, [style, isUp, priceDecimals]);

  // Feed data. Kept separate from series creation so a refresh does not
  // rebuild the series and reset the user's zoom.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || points.length === 0) return;

    if (style === "candles") {
      series.setData(
        points
          .filter((p) => p.open != null && p.high != null && p.low != null)
          .map((p) => ({
            time: p.timestamp as UTCTimestamp,
            open: p.open as number,
            high: p.high as number,
            low: p.low as number,
            close: p.close,
          })),
      );
    } else {
      series.setData(
        points.map((p) => ({
          time: p.timestamp as UTCTimestamp,
          value: p.close,
        })),
      );
    }

    chart.timeScale().applyOptions(timeScaleOptions(range));

    // Re-frame only when the ticker, range or style changed. Intraday data
    // reloads every 60s, and fitting on each one would yank the chart back
    // from wherever the user had zoomed to.
    if (fittedForRef.current !== resetKey) {
      chart.timeScale().fitContent();
      chart.priceScale("right").applyOptions({ autoScale: true });
      fittedForRef.current = resetKey;
      setAdjusted(false);
    }
  }, [points, style, range, resetKey]);

  // Tick and crosshair labels are cached, so changing the zone needs an
  // explicit nudge — the formatters alone would keep returning stale text.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      timeScale: {
        tickMarkFormatter: (t: unknown) =>
          tickLabel(t as number, rangeRef.current, zoneRef.current),
      },
      localization: {
        timeFormatter: (t: unknown) =>
          crosshairLabel(t as number, rangeRef.current, zoneRef.current),
      },
    });
  }, [timeZone, range]);

  // Previous close, as a dashed marker on intraday ranges only — over months it
  // would be an arbitrary horizontal line with no meaning.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const intraday = range === "1d" || range === "5d";
    if (!intraday || previousClose == null) return;

    const line = series.createPriceLine({
      price: previousClose,
      color: getCssVar("--muted-foreground"),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "prev",
    });
    return () => {
      try {
        series.removePriceLine(line);
      } catch {
        // The series may already be gone if the style changed in the same tick.
      }
    };
  }, [previousClose, range, style, points]);

  function resetView() {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().fitContent();
    chart.priceScale("right").applyOptions({ autoScale: true });
    setAdjusted(false);
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {adjusted && (
        <button
          type="button"
          onClick={resetView}
          title="Reset zoom and price scale"
          className="absolute top-1 left-1 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-md
                     border border-border bg-background/90 backdrop-blur-sm
                     text-[10px] font-medium text-muted-foreground
                     hover:text-foreground hover:bg-background transition-colors"
        >
          <Maximize2 className="w-3 h-3" />
          Reset view
        </button>
      )}
    </div>
  );
}
