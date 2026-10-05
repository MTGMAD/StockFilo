import { useState, useEffect, useCallback } from "react";
import type { WatchlistItem, Stock } from "../types";
import {
  listWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  setWatchlistWatchPrice,
  setWatchlistAddedAt,
  updateWatchlistNote,
  migrateLegacyWatchlistNotes,
  migrateLegacyWatchlistTargets,
  setWatchlistAlert,
  getCachedStocks,
  fetchAndCachePrices,
  fetchPriceOnDate,
} from "../lib/db";
import type { AlertDirection } from "../types";

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
      const notesMigrated = await migrateLegacyWatchlistNotes(watchlistId, w);
      const targetsMigrated = await migrateLegacyWatchlistTargets(watchlistId, w);
      setItems(notesMigrated > 0 || targetsMigrated > 0 ? await listWatchlist(watchlistId) : w);
      setStocks(s);
      // Fire a background price refresh so switching watchlists always shows current data
      const tickers = w.map((i) => i.ticker);
      if (tickers.length > 0) {
        fetchAndCachePrices(tickers)
          .then(() => getCachedStocks())
          .then((fresh) => setStocks(fresh))
          .catch(() => {});
      }
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

  /**
   * Persist a note and reflect it immediately in `items` — the caller (an
   * open note editor) has already been showing this exact text locally while
   * typing, so there's nothing to gain from a full `loadAll()` round trip
   * here, only a chance to visibly overwrite an in-progress edit with a
   * slightly-stale server response.
   */
  const setNote = useCallback(async (id: number, notes: string) => {
    await updateWatchlistNote(id, notes);
    const trimmed = notes.trim();
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              notes: trimmed || null,
              notes_updated_at: trimmed ? Math.floor(Date.now() / 1000) : null,
            }
          : item,
      ),
    );
  }, []);

  /**
   * Change a row's added date by hand. Looks up that date's close for
   * `ticker` first (so "since added" is never stale after a date edit),
   * persists date and price together, and reflects both locally — same
   * no-reload-needed reasoning as `setNote` above. Returns the looked-up
   * price (`null` if Yahoo had no session that day) so the caller can tell
   * the person their date was saved but the price is unknown.
   */
  const setAddedAt = useCallback(async (id: number, ticker: string, date: string) => {
    const addedAt = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
    const watchPrice = await fetchPriceOnDate(ticker, date);
    await setWatchlistAddedAt(id, addedAt, watchPrice);
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, created_at: addedAt, watch_price: watchPrice }
          : item,
      ),
    );
    return watchPrice;
  }, []);

  /**
   * Set or clear a row's price alert. Direction is inferred here from the
   * target vs. the ticker's last-known price (from `stocks`) rather than
   * exposed as a separate control — same automatic behavior the legacy
   * localStorage target migration uses. `price: null` clears the alert.
   */
  const setAlert = useCallback(
    async (id: number, ticker: string, price: number | null) => {
      if (price == null || isNaN(price) || price <= 0) {
        await setWatchlistAlert(id, null, null);
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  alert_target_price: null,
                  alert_direction: null,
                  alert_triggered_at: null,
                  alert_acknowledged_at: null,
                }
              : item,
          ),
        );
        return;
      }
      const referencePrice = stocks.find((s) => s.ticker === ticker)?.last_price ?? price;
      const direction: AlertDirection = price >= referencePrice ? "above" : "below";
      await setWatchlistAlert(id, price, direction);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                alert_target_price: price,
                alert_direction: direction,
                alert_triggered_at: null,
                alert_acknowledged_at: null,
              }
            : item,
        ),
      );
    },
    [stocks],
  );

  return { items, stocks, loading, error, add, remove, setNote, setAddedAt, setAlert, reload: loadAll };
}
