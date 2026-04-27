import { useState, useCallback } from "react";

const KEY = "stockfolio-watchlist-notes";

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useWatchlistNotes() {
  const [notes, setNotes] = useState<Record<string, string>>(load);

  const setNote = useCallback((ticker: string, text: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (text.trim() === "") {
        delete next[ticker];
      } else {
        next[ticker] = text;
      }
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const getNote = useCallback(
    (ticker: string): string => notes[ticker] ?? "",
    [notes]
  );

  const hasNote = useCallback(
    (ticker: string): boolean => !!notes[ticker]?.trim(),
    [notes]
  );

  const replaceAll = useCallback((data: Record<string, string>) => {
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v.trim()) filtered[k] = v;
    }
    localStorage.setItem(KEY, JSON.stringify(filtered));
    setNotes(filtered);
  }, []);

  return { notes, setNote, getNote, hasNote, replaceAll };
}
