import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { DailyBar, JournalTrade } from "../../lib/journal";
import { palette, rgba } from "../analysis/PriceChart";
import { openUrl } from "../../lib/openUrl";

const DAY = 86_400_000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(iso + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);

/** Daily price chart for one trade with a marker on every buy and sell. */
export function TradeChart({ trade, bars }: { trade: JournalTrade; bars: DailyBar[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const end = trade.closeDate ?? trade.lastExitDate ?? trade.fills[trade.fills.length - 1].date;
    const from = shift(trade.openDate, -30);
    const to = shift(end, 30);
    const windowBars = bars.filter((b) => b.date >= from && b.date <= to);
    const data = windowBars.length ? windowBars : bars;
    if (data.length === 0) return;

    const c = palette();
    const chart = createChart(el, {
      autoSize: true,
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
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });

    const up = (trade.avgExit ?? data[data.length - 1].close) >= trade.avgEntry;
    const line = up ? c.upRgb : c.downRgb;
    const series = chart.addSeries(AreaSeries, {
      lineColor: rgba(line, 1),
      topColor: rgba(line, 0.25),
      bottomColor: rgba(line, 0),
      lineWidth: 2,
      priceLineVisible: false,
    });
    series.setData(data.map((b) => ({ time: b.date as Time, value: b.close })));

    // Snap each fill to the bar on or just before its date (broker dates can
    // land on a non-session day); sum same-day, same-side fills into one marker.
    const barDates = data.map((b) => b.date);
    const snap = (d: string) => {
      let hit = barDates[0];
      for (const bd of barDates) {
        if (bd <= d) hit = bd;
        else break;
      }
      return hit;
    };
    const grouped = new Map<string, { time: string; side: "buy" | "sell"; qty: number; drip: boolean }>();
    for (const f of trade.fills) {
      const time = snap(f.date);
      const key = `${time}|${f.side}|${f.drip ? 1 : 0}`;
      const g = grouped.get(key) ?? { time, side: f.side, qty: 0, drip: !!f.drip };
      g.qty += f.qty;
      grouped.set(key, g);
    }
    const qtyText = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
    const markers: SeriesMarker<Time>[] = [...grouped.values()]
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((g) => ({
        time: g.time as Time,
        position: g.side === "buy" ? "belowBar" : "aboveBar",
        shape: g.side === "buy" ? "arrowUp" : "arrowDown",
        color: rgba(g.side === "buy" ? c.upRgb : c.downRgb, 1),
        text: `${g.drip ? "DRIP" : g.side === "buy" ? "Buy" : "Sell"} ${qtyText(g.qty)}`,
      }));
    createSeriesMarkers(series, markers);

    series.createPriceLine({
      price: trade.avgEntry,
      color: rgba(c.upRgb, 0.8),
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      title: "Avg entry",
    });
    if (trade.avgExit != null) {
      series.createPriceLine({
        price: trade.avgExit,
        color: rgba(c.downRgb, 0.8),
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        title: "Avg exit",
      });
    }
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [trade, bars]);

  return (
    <div>
      <div ref={ref} className="h-60 w-full" />
      <p className="text-[10px] text-muted-foreground mt-1">
        Daily closes · charting by{" "}
        <button
          type="button"
          onClick={() => openUrl("https://www.tradingview.com/", "browser")}
          className="underline"
        >
          TradingView Lightweight Charts
        </button>
      </p>
    </div>
  );
}
