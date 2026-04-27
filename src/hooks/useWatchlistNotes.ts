import { useState, useEffect, useCallback } from "react";

const OLD_KEY = "stockfolio-watchlist-notes";

function storageKey(watchlistId: number | null): string | null {
  return watchlistId != null ? `stockfolio-watchlist-notes-${watchlistId}` : null;
}

function loadNotes(watchlistId: number | null): Record<string, string> {
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

export function useWatchlistNotes(watchlistId: number | null) {
  const [notes, setNotes] = useState<Record<string, string>>(() => loadNotes(watchlistId));

  useEffect(() => {
    setNotes(loadNotes(watchlistId));
  }, [watchlistId]);

  const setNote = useCallback((ticker: string, text: string) => {
    const key = storageKey(watchlistId);
    if (!key) return;
    setNotes((prev) => {
      const next = { ...prev };
      if (text.trim() === "") {
        delete next[ticker];
      } else {
        next[ticker] = text;
      }
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [watchlistId]);

  const getNote = useCallback(
    (ticker: string): string => notes[ticker] ?? "",
    [notes]
  );

  const hasNote = useCallback(
    (ticker: string): boolean => !!notes[ticker]?.trim(),
    [notes]
  );

  const replaceAll = useCallback((data: Record<string, string>) => {
    const key = storageKey(watchlistId);
    if (!key) return;
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v.trim()) filtered[k] = v;
    }
    localStorage.setItem(key, JSON.stringify(filtered));
    setNotes(filtered);
  }, [watchlistId]);

  const refresh = useCallback(() => {
    setNotes(loadNotes(watchlistId));
  }, [watchlistId]);

  return { notes, setNote, getNote, hasNote, replaceAll, refresh };
}
