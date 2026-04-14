import { useState, useEffect, useCallback } from "react";
import type { WatchlistItem, Stock } from "../types";
import {
  listWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getCachedStocks,
  fetchAndCachePrices,
} from "../lib/db";

const POLL_INTERVAL_MS = 30_000;

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [w, s] = await Promise.all([listWatchlist(), getCachedStocks()]);
      setItems(w);
      setStocks(s);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  // Auto-refresh prices for watchlist tickers
  useEffect(() => {
    const tickers = items.map((i) => i.ticker);
    if (tickers.length === 0) return;

    let cancelled = false;

    const fetchPrices = async () => {
      try {
        await fetchAndCachePrices(tickers);
        if (!cancelled) {
          const s = await getCachedStocks();
          if (!cancelled) setStocks(s);
        }
      } catch {
        // silently continue
      }
    };

    fetchPrices();
    const id = setInterval(fetchPrices, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [items]);

  const add = useCallback(
    async (ticker: string) => {
      setError(null);
      try {
        await addToWatchlist(ticker);
        await loadAll();
      } catch (e) {
        setError(String(e));
      }
    },
    [loadAll]
  );

  const remove = useCallback(
    async (id: number) => {
      await removeFromWatchlist(id);
      await loadAll();
    },
    [loadAll]
  );

  return { items, stocks, loading, error, add, remove, reload: loadAll };
}
