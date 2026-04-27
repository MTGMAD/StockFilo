import { useState, useEffect, useCallback } from "react";
import type { Watchlist } from "../types";
import { listWatchlists, createWatchlist, renameWatchlist, deleteWatchlist } from "../lib/db";

export function useWatchlists() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const wls = await listWatchlists();
    setWatchlists(wls);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const create = useCallback(async (name: string): Promise<number> => {
    const id = await createWatchlist(name);
    await load();
    return id;
  }, [load]);

  const rename = useCallback(async (id: number, name: string): Promise<void> => {
    await renameWatchlist(id, name);
    await load();
  }, [load]);

  const remove = useCallback(async (id: number): Promise<void> => {
    await deleteWatchlist(id);
    await load();
  }, [load]);

  return { watchlists, loading, create, rename, remove, reload: load };
}
