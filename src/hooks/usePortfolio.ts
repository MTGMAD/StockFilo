import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import type { CashEvent, Purchase, Sale, Stock, TickerSummary } from "../types";
import {
  listPurchases,
  addPurchase,
  updatePurchase,
  deletePurchase,
  listCashEvents,
  addCashEvent,
  updateCashEvent,
  deleteCashEvent,
  listSales,
  addSale,
  updateSale,
  deleteSale,
  getCachedStocks,
  fetchAndCachePrices,
} from "../lib/db";
import { isCusip } from "../lib/utils";
import { buildFromPurchases } from "../lib/summaries";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function usePortfolio(portfolioId: number | null) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [cashEvents, setCashEvents] = useState<CashEvent[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchasesRef = useRef<Purchase[]>([]);
  // Track which portfolioId's data is currently in state.
  // Ensures loading=true whenever portfolioId changes but new data hasn't arrived yet.
  const loadedForRef = useRef<number | null | undefined>(undefined);

  const loadAll = useCallback(async () => {
    if (portfolioId == null) {
      setPurchases([]);
      purchasesRef.current = [];
      setCashEvents([]);
      setSales([]);
      setLoading(false);
      return;
    }
    try {
      const [p, c, sl, s] = await Promise.all([
        listPurchases(portfolioId),
        listCashEvents(portfolioId),
        listSales(portfolioId),
        getCachedStocks(),
      ]);
      setPurchases(p);
      purchasesRef.current = p;
      setCashEvents(c);
      setSales(sl);
      setStocks(s);
    } catch (e) {
      setError(String(e));
    }
  }, [portfolioId]);

  // useLayoutEffect fires before paint — resets loading=true the moment portfolioId changes,
  // preventing a render where loading=false but data is for a different portfolioId.
  useLayoutEffect(() => {
    if (portfolioId !== loadedForRef.current) {
      setLoading(true);
    }
  }, [portfolioId]);

  useEffect(() => {
    const pid = portfolioId;
    setLoading(true);
    loadAll().finally(() => {
      loadedForRef.current = pid;
      setLoading(false);
    });
  }, [loadAll]);

  // Auto-refresh prices: fetch immediately when purchases change, then poll every 30s
  useEffect(() => {
    const tickers = [...new Set(purchases.map((p) => p.ticker))].filter((t) => !isCusip(t));
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
      const tickers = [...new Set(purchasesRef.current.map((p) => p.ticker))].filter((t) => !isCusip(t));
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
      if (portfolioId == null) return;
      await addPurchase(portfolioId, ticker, shares, price, date);
      await loadAll();
    },
    [portfolioId, loadAll]
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

  const addCashEventEntry = useCallback(
    async (
      kind: CashEvent["kind"],
      ticker: string | null,
      amount: number,
      date: string,
      note: string | null,
    ) => {
      if (portfolioId == null) return;
      await addCashEvent(portfolioId, kind, ticker, amount, date, note);
      await loadAll();
    },
    [portfolioId, loadAll]
  );

  const updateCashEventEntry = useCallback(
    async (
      id: number,
      kind: CashEvent["kind"],
      ticker: string | null,
      amount: number,
      date: string,
      note: string | null,
    ) => {
      await updateCashEvent(id, kind, ticker, amount, date, note);
      await loadAll();
    },
    [loadAll]
  );

  const removeCashEvent = useCallback(
    async (id: number) => {
      await deleteCashEvent(id);
      await loadAll();
    },
    [loadAll]
  );

  const addSaleEntry = useCallback(
    async (ticker: string, shares: number, price: number, date: string) => {
      if (portfolioId == null) return;
      await addSale(portfolioId, ticker, shares, price, date);
      await loadAll();
    },
    [portfolioId, loadAll]
  );

  const updateSaleEntry = useCallback(
    async (id: number, ticker: string, shares: number, price: number, date: string) => {
      await updateSale(id, ticker, shares, price, date);
      await loadAll();
    },
    [loadAll]
  );

  const removeSale = useCallback(
    async (id: number) => {
      await deleteSale(id);
      await loadAll();
    },
    [loadAll]
  );

  // Omitted (not 0) when there are no cash events, so an untouched portfolio
  // doesn't show a misleading "Cash $0" in the header.
  const cashTotal = cashEvents.length > 0
    ? cashEvents.reduce((sum, e) => sum + e.amount, 0)
    : null;

  const summaries: TickerSummary[] = buildFromPurchases(purchases, sales, stocks);

  return {
    purchases,
    cashEvents,
    cashTotal,
    sales,
    stocks,
    summaries,
    loading,
    refreshing,
    error,
    refresh,
    reload: loadAll,
    add,
    update,
    remove,
    addCashEvent: addCashEventEntry,
    updateCashEvent: updateCashEventEntry,
    removeCashEvent,
    addSale: addSaleEntry,
    updateSale: updateSaleEntry,
    removeSale,
  };
}

