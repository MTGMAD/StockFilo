import { useState, useEffect, useCallback } from "react";
import type { Favorite } from "../types";
import { listFavorites, addFavorite, removeFavorite, reorderFavorites } from "../lib/db";

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  const load = useCallback(async () => {
    const f = await listFavorites();
    setFavorites(f);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (ticker: string) => {
      const isFav = favorites.some((f) => f.ticker === ticker.toUpperCase());
      if (isFav) {
        await removeFavorite(ticker);
      } else {
        await addFavorite(ticker);
      }
      await load();
    },
    [favorites, load]
  );

  const reorder = useCallback(
    async (tickers: string[]) => {
      await reorderFavorites(tickers);
      await load();
    },
    [load]
  );

  const isFavorite = useCallback(
    (ticker: string) => favorites.some((f) => f.ticker === ticker.toUpperCase()),
    [favorites]
  );

  const favoriteTickers = favorites.map((f) => f.ticker);

  return { favorites, favoriteTickers, isFavorite, toggle, reorder };
}
