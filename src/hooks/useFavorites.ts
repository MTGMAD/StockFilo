import { useState, useEffect, useCallback } from "react";
import type { Favorite } from "../types";
import { listFavorites, addFavorite, removeFavorite, reorderFavorites } from "../lib/db";

export function useFavorites(portfolioId: number | null) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (portfolioId == null) {
      setFavorites([]);
      setLoaded(true);
      return;
    }
    const f = await listFavorites(portfolioId);
    setFavorites(f);
    setLoaded(true);
  }, [portfolioId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (ticker: string) => {
      if (portfolioId == null) return;
      const isFav = favorites.some((f) => f.ticker === ticker.toUpperCase());
      if (isFav) {
        await removeFavorite(ticker, portfolioId);
      } else {
        await addFavorite(ticker, portfolioId);
      }
      await load();
    },
    [portfolioId, favorites, load]
  );

  const reorder = useCallback(
    async (tickers: string[]) => {
      if (portfolioId == null) return;
      await reorderFavorites(tickers, portfolioId);
      await load();
    },
    [portfolioId, load]
  );

  const isFavorite = useCallback(
    (ticker: string) => favorites.some((f) => f.ticker === ticker.toUpperCase()),
    [favorites]
  );

  const favoriteTickers = favorites.map((f) => f.ticker);

  return { favorites, favoriteTickers, loaded, isFavorite, toggle, reorder };
}
