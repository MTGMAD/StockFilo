import { useState, useEffect, useCallback } from "react";
import type { PositionOrder } from "../types";
import { listPositionOrder, reorderPositions } from "../lib/db";

/** Manual drag-order for a portfolio's positions list — mirrors
 *  useFavorites, but covers any ticker, not just starred ones. */
export function usePositionOrder(portfolioId: number | null) {
  const [order, setOrder] = useState<PositionOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (portfolioId == null) {
      setOrder([]);
      setLoaded(true);
      return;
    }
    const o = await listPositionOrder(portfolioId);
    setOrder(o);
    setLoaded(true);
  }, [portfolioId]);

  useEffect(() => {
    load();
  }, [load]);

  const reorder = useCallback(
    async (tickers: string[]) => {
      if (portfolioId == null) return;
      await reorderPositions(tickers, portfolioId);
      await load();
    },
    [portfolioId, load]
  );

  const orderIndex = useCallback(
    (ticker: string) => {
      const idx = order.findIndex((o) => o.ticker === ticker.toUpperCase());
      return idx;
    },
    [order]
  );

  return { order, loaded, reorder, orderIndex };
}
