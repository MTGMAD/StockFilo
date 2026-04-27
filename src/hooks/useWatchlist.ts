import { useState, useEffect, useCallback } from "react";
import type { WatchlistItem, Stock } from "../types";
import {
  listWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  setWatchlistWatchPrice,
  getCachedStocks,
  fetchAndCachePrices,
} from "../lib/db";

const POLL_INTERVAL_MS = 30_000;

export function useWatchlist(watchlistId: number | null) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (watchlistId == null) {
      setItems([]);
      return;
    }
    try {
      const [w, s] = await Promise.all([listWatchlist(watchlistId), getCachedStocks()]);
      setItems(w);
      setStocks(s);
    } catch (e) {
      setError(String(e));
    }
  }, [watchlistId]);

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

  // Backfill watch_price when rows were created without a quote at add time
  useEffect(() => {
    const missing = items.filter((i) => i.watch_price == null || i.watch_price <= 0);
    if (missing.length === 0) return;

    const stockByTicker = new Map(stocks.map((s) => [s.ticker, s]));
    const updates = missing
      .map((item) => {
        const price = stockByTicker.get(item.ticker)?.last_price;
        if (price == null || price <= 0) return null;
        return { id: item.id, price };
      })
      .filter((v): v is { id: number; price: number } => v != null);

    if (updates.length === 0) return;

    let cancelled = false;
    const runBackfill = async () => {
      try {
        await Promise.all(updates.map((u) => setWatchlistWatchPrice(u.id, u.price)));
        if (!cancelled) await loadAll();
      } catch {
        // silently continue
      }
    };

    runBackfill();
    return () => { cancelled = true; };
  }, [items, stocks, loadAll]);

  const add = useCallback(
    async (ticker: string, watchPrice: number | null = null) => {
      if (watchlistId == null) return;
      setError(null);
      try {
        await addToWatchlist(ticker, watchlistId, watchPrice);
        await loadAll();
      } catch (e) {
        setError(String(e));
      }
    },
    [watchlistId, loadAll]
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
