import { useState, useCallback } from "react";

const KEY = "stockfolio-watchlist-targets";

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useWatchlistTargets() {
  const [targets, setTargets] = useState<Record<string, number>>(load);

  const setTarget = useCallback((ticker: string, price: number | null) => {
    setTargets((prev) => {
      const next = { ...prev };
      if (price == null || isNaN(price)) {
        delete next[ticker];
      } else {
        next[ticker] = price;
      }
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

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
    localStorage.setItem(KEY, JSON.stringify(data));
    setTargets(data);
  }, []);

  return { targets, setTarget, getTarget, isTriggered, replaceAll };
}
