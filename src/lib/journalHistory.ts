import { invoke } from "@tauri-apps/api/core";
import type { ChartData } from "../types";
import type { DailyBar } from "./journal";

// One fetch per ticker+range for the life of the window: the trade page, the
// Reports tab and the chart all ask for the same bars, and Yahoo rate-limits.
const cache = new Map<string, Promise<DailyBar[]>>();

export function getDailyBars(ticker: string, range: string): Promise<DailyBar[]> {
  const key = `${ticker}|${range}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = invoke<ChartData>("fetch_chart_command", { ticker, range, interval: "1d" })
    .then((data) => {
      const bars: DailyBar[] = [];
      for (const pt of data.points) {
        if (!Number.isFinite(pt.close)) continue;
        bars.push({
          date: new Date(pt.timestamp * 1000).toISOString().slice(0, 10),
          high: pt.high ?? pt.close,
          low: pt.low ?? pt.close,
          close: pt.close,
        });
      }
      if (bars.length === 0) throw new Error("No price history available");
      return bars;
    })
    .catch((e) => {
      cache.delete(key); // a failure shouldn't be remembered
      throw e;
    });
  cache.set(key, p);
  return p;
}
