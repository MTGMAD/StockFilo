import { useState, useEffect, useCallback, useRef } from "react";
import type {
  BrokerPosition,
  BrokerTransaction,
  Stock,
  TickerSummary,
} from "../types";
import {
  listBrokerPositions,
  listBrokerTransactions,
  syncBrokerConnection,
} from "../lib/brokers";
import { getCachedStocks, fetchAndCachePrices } from "../lib/db";
import { buildFromPositions } from "../lib/summaries";
import { isCusip } from "../lib/utils";

/** Matches the Yahoo poll interval in usePortfolio, so both kinds feel alike. */
const POLL_INTERVAL_MS = 30_000;

/**
 * A broker-linked portfolio.
 *
 * Returns the same shape as usePortfolio so PortfolioView, the Dashboard and
 * the rank view cannot tell the difference.
 *
 * Two independent refreshes run here:
 *
 *   1. The broker sync, every 30s, which re-reads positions from the brokerage.
 *      This is what keeps prices and P&L live — those numbers are the broker's.
 *   2. A one-shot Yahoo fetch for reference data only (company name, asset
 *      type, analyst target, dividend yield), for tickers Yahoo can quote.
 */
export function useBrokerPortfolio(
  brokerAccountId: number | null,
  connectionId: string | null,
) {
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [transactions, setTransactions] = useState<BrokerTransaction[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedForRef = useRef<number | null | undefined>(undefined);

  const loadStored = useCallback(async () => {
    if (brokerAccountId == null) {
      setPositions([]);
      setTransactions([]);
      return;
    }
    const [p, t, s] = await Promise.all([
      listBrokerPositions(brokerAccountId),
      listBrokerTransactions(brokerAccountId),
      getCachedStocks(),
    ]);
    setPositions(p);
    setTransactions(t);
    setStocks(s);
  }, [brokerAccountId]);

  useEffect(() => {
    const id = brokerAccountId;
    if (id !== loadedForRef.current) setLoading(true);
    loadStored()
      .catch((e) => setError(String(e)))
      .finally(() => {
        loadedForRef.current = id;
        setLoading(false);
      });
  }, [loadStored, brokerAccountId]);

  /** Pull fresh positions from the brokerage, then re-read what was stored. */
  const syncNow = useCallback(async () => {
    if (!connectionId) return;
    try {
      await syncBrokerConnection(connectionId);
      await loadStored();
      setError(null);
    } catch (e) {
      // Keep showing the last known positions rather than blanking the view.
      setError(String(e));
    }
  }, [connectionId, loadStored]);

  // Live refresh from the broker while this portfolio is on screen.
  useEffect(() => {
    if (!connectionId || brokerAccountId == null) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await syncNow();
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connectionId, brokerAccountId, syncNow]);

  // Reference data only. Prices for these holdings come from the broker, so
  // this runs once per set of tickers rather than on a timer.
  useEffect(() => {
    const tickers = [
      ...new Set(
        positions
          .map((p) => p.ticker)
          .filter((t): t is string => !!t && !isCusip(t)),
      ),
    ];
    if (tickers.length === 0) return;

    const missing = tickers.filter(
      (t) => !stocks.some((s) => s.ticker === t && s.name),
    );
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        await fetchAndCachePrices(missing);
        if (!cancelled) setStocks(await getCachedStocks());
      } catch {
        // Reference data is a nicety — a holding still displays without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [positions, stocks]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
  }, [syncNow]);

  const summaries: TickerSummary[] = buildFromPositions(positions, stocks);

  return {
    positions,
    transactions,
    stocks,
    summaries,
    loading,
    refreshing,
    error,
    refresh,
    reload: loadStored,
  };
}
