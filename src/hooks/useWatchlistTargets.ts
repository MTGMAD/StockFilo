import { useState, useEffect, useCallback } from "react";

const OLD_KEY = "stockfolio-watchlist-targets";

function storageKey(watchlistId: number | null): string | null {
  return watchlistId != null ? `stockfolio-watchlist-targets-${watchlistId}` : null;
}

function loadTargets(watchlistId: number | null): Record<string, number> {
  const key = storageKey(watchlistId);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
    // One-time migration from old global key for the first watchlist
    if (watchlistId === 1) {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        localStorage.setItem(key, old);
        localStorage.removeItem(OLD_KEY);
        return JSON.parse(old);
      }
    }
    return {};
  } catch {
    return {};
  }
}

export function useWatchlistTargets(watchlistId: number | null) {
  const [targets, setTargets] = useState<Record<string, number>>(() => loadTargets(watchlistId));

  useEffect(() => {
    setTargets(loadTargets(watchlistId));
  }, [watchlistId]);

  const setTarget = useCallback((ticker: string, price: number | null) => {
    const key = storageKey(watchlistId);
    if (!key) return;
    setTargets((prev) => {
      const next = { ...prev };
      if (price == null || isNaN(price)) {
        delete next[ticker];
      } else {
        next[ticker] = price;
      }
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [watchlistId]);

  const getTarget = useCallback(
    (ticker: string): number | null => targets[ticker] ?? null,
    [targets]
  );

  const isTriggered = useCallback(
    (ticker: string, currentPrice: number | null): boolean => {
      const t = targets[ticker];
      if (t == null || currentPrice == null) return false;
      return currentPrice <= t;
    },
    [targets]
  );

  const replaceAll = useCallback((data: Record<string, number>) => {
    const key = storageKey(watchlistId);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(data));
    setTargets(data);
  }, [watchlistId]);

  const refresh = useCallback(() => {
    setTargets(loadTargets(watchlistId));
  }, [watchlistId]);

  return { targets, setTarget, getTarget, isTriggered, replaceAll, refresh };
}
