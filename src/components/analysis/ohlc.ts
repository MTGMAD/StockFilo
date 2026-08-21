import type { ChartPoint } from "../../types";

/**
 * Candlestick data availability.
 *
 * Yahoo omits open/high/low for some instruments and intervals. Candles are
 * offered only when every point carries them — an incomplete candle would
 * imply prices the provider never reported.
 */
export function hasOhlc(points: ChartPoint[]): boolean {
  return (
    points.length > 0 &&
    points.every((p) => p.open != null && p.high != null && p.low != null)
  );
}
