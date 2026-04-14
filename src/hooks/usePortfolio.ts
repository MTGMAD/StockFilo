import { useState, useEffect, useCallback, useRef } from "react";
import type { Purchase, Stock, TickerSummary } from "../types";
import {
  listPurchases,
  addPurchase,
  updatePurchase,
  deletePurchase,
  getCachedStocks,
  fetchAndCachePrices,
} from "../lib/db";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function usePortfolio() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchasesRef = useRef<Purchase[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listPurchases(), getCachedStocks()]);
      setPurchases(p);
      purchasesRef.current = p;
      setStocks(s);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  // Auto-refresh prices: fetch immediately when purchases change, then poll every 30s
  useEffect(() => {
    const tickers = [...new Set(purchases.map((p) => p.ticker))];
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
        // silently continue — stale data stays visible
      }
    };

    fetchPrices();
    const id = setInterval(fetchPrices, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [purchases]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const tickers = [...new Set(purchasesRef.current.map((p) => p.ticker))];
      await fetchAndCachePrices(tickers);
      const s = await getCachedStocks();
      setStocks(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const add = useCallback(
    async (ticker: string, shares: number, price: number, date: string) => {
      await addPurchase(ticker, shares, price, date);
      await loadAll();
    },
    [loadAll]
  );

  const update = useCallback(
    async (id: number, ticker: string, shares: number, price: number, date: string) => {
      await updatePurchase(id, ticker, shares, price, date);
      await loadAll();
    },
    [loadAll]
  );

  const remove = useCallback(
    async (id: number) => {
      await deletePurchase(id);
      await loadAll();
    },
    [loadAll]
  );

  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const STALE_THRESHOLD_SECONDS = 3600; // 1 hour
  const now = Math.floor(Date.now() / 1000);

  const summaries: TickerSummary[] = [...new Set(purchases.map((p) => p.ticker))].map(
    (ticker) => {
      const tickerPurchases = purchases.filter((p) => p.ticker === ticker);
      const totalShares = tickerPurchases.reduce((s, p) => s + p.shares, 0);
      const totalInvested = tickerPurchases.reduce(
        (s, p) => s + p.shares * p.price_per_share,
        0
      );
      const avgCostBasis = totalShares > 0 ? totalInvested / totalShares : 0;
      const stock = stockMap.get(ticker);
      const currentPrice = stock?.last_price ?? null;
      const marketValue = currentPrice != null ? totalShares * currentPrice : null;
      const pnlDollar = marketValue != null ? marketValue - totalInvested : null;
      const pnlPercent =
        pnlDollar != null && totalInvested > 0
          ? (pnlDollar / totalInvested) * 100
          : null;
      const lastFetchedAt = stock?.last_fetched_at ?? null;
      const isStale =
        lastFetchedAt == null || now - lastFetchedAt > STALE_THRESHOLD_SECONDS;

      return {
        ticker,
        name: stock?.name ?? null,
        totalShares,
        totalInvested,
        avgCostBasis,
        currentPrice,
        marketValue,
        pnlDollar,
        pnlPercent,
        isStale,
        lastFetchedAt,
        quoteType: stock?.quote_type ?? null,
      };
    }
  );

  return {
    purchases,
    stocks,
    summaries,
    loading,
    refreshing,
    error,
    refresh,
    add,
    update,
    remove,
  };
}
