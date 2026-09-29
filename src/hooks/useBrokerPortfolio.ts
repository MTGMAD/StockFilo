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
 * The broker sync itself — every 30s while this portfolio is on screen,
 * re-reading positions, cash and transactions from the brokerage — runs the
 * same way regardless of provider; that detail is always the broker's.
 * `providesPricing` (the connection's provider descriptor — true for Alpaca,
 * false for SnapTrade) only decides where *price* comes from:
 *
 *   true  — the broker quotes the market live itself, so price and P&L are
 *           read from that same sync. A one-shot Yahoo fetch still runs for
 *           reference data only (company name, asset type, analyst target,
 *           dividend yield), for tickers Yahoo can quote.
 *
 *   false — the broker is an aggregator whose own price is only as fresh as
 *           its last sync, so price instead comes from the same 30s Yahoo
 *           poll a manual portfolio uses, for every ticker Yahoo can quote —
 *           live regardless of how recently the brokerage login itself was
 *           resynced.
 */
export function useBrokerPortfolio(
  brokerAccountId: number | null,
  connectionId: string | null,
  providesPricing: boolean,
) {
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [transactions, setTransactions] = useState<BrokerTransaction[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedForRef = useRef<number | null | undefined>(undefined);
  const positionsRef = useRef<BrokerPosition[]>([]);
  positionsRef.current = positions;

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

  // Live refresh from the broker while this portfolio is on screen — detail
  // (shares, cost basis, cash, transactions) always comes from here,
  // regardless of provider.
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

  // Broker-quoted accounts (Alpaca): reference data only (company name,
  // asset type, dividend yield, ...) — price itself is always the broker's,
  // so this runs once per set of tickers rather than on a timer.
  useEffect(() => {
    if (!providesPricing) return;
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
  }, [providesPricing, positions, stocks]);

  // Aggregated accounts (SnapTrade): the live price feed itself, same timer
  // and source a manual portfolio uses — runs independently of the broker
  // sync above, so price stays live between (or regardless of) syncs.
  useEffect(() => {
    if (providesPricing) return;
    const tickers = [
      ...new Set(
        positions
          .map((p) => p.ticker)
          .filter((t): t is string => !!t && !isCusip(t)),
      ),
    ];
    if (tickers.length === 0) return;

    let cancelled = false;

    const fetchPrices = async () => {
      try {
        await fetchAndCachePrices(tickers);
        if (!cancelled) setStocks(await getCachedStocks());
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
  }, [providesPricing, positions]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      // Detail always comes from a fresh broker sync. For an aggregator,
      // also pull Yahoo immediately rather than waiting for its own timer,
      // so the button feels as responsive for price as a manual portfolio's.
      const tickers = providesPricing
        ? []
        : [
            ...new Set(
              positionsRef.current
                .map((p) => p.ticker)
                .filter((t): t is string => !!t && !isCusip(t)),
            ),
          ];
      await Promise.all([
        syncNow(),
        tickers.length > 0 ? fetchAndCachePrices(tickers) : Promise.resolve(),
      ]);
      if (tickers.length > 0) setStocks(await getCachedStocks());
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }, [providesPricing, syncNow]);

  const summaries: TickerSummary[] = buildFromPositions(
    positions,
    stocks,
    providesPricing,
  );

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
