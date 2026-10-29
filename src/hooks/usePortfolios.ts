import { useState, useEffect, useCallback } from "react";
import type { Portfolio, PortfolioGroup } from "../types";
import {
  listPortfolios,
  createPortfolio as dbCreate,
  renamePortfolio as dbRename,
  deletePortfolio as dbDelete,
  starPortfolio as dbStar,
  reorderPortfolios as dbReorder,
  setPositionSortMode as dbSetPositionSortMode,
  listPortfolioGroups,
  createPortfolioGroup as dbCreateGroup,
  renamePortfolioGroup as dbRenameGroup,
  deletePortfolioGroup as dbDeleteGroup,
  setPortfolioGroup as dbSetGroup,
} from "../lib/db";

export function usePortfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [groups, setGroups] = useState<PortfolioGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, g] = await Promise.all([listPortfolios(), listPortfolioGroups()]);
      setPortfolios(p);
      setGroups(g);
    } catch (e) {
      console.error("Failed to load portfolios:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (name: string): Promise<number> => {
      const id = await dbCreate(name);
      await load();
      return id;
    },
    [load]
  );

  const rename = useCallback(
    async (id: number, name: string) => {
      await dbRename(id, name);
      await load();
    },
    [load]
  );

  const remove = useCallback(
    async (id: number) => {
      await dbDelete(id);
      await load();
    },
    [load]
  );

  const star = useCallback(
    async (id: number) => {
      await dbStar(id);
      await load();
    },
    [load]
  );

  const reorder = useCallback(
    async (ids: number[]) => {
      // Optimistic, so a dropped row doesn't snap back while the write runs;
      // the reload afterwards restores the real order if the write failed.
      setPortfolios((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        return ids.flatMap((id) => byId.get(id) ?? []);
      });
      try {
        await dbReorder(ids);
      } finally {
        await load();
      }
    },
    [load]
  );

  const setPositionSortMode = useCallback(
    async (id: number, mode: string) => {
      // Optimistic, so the dropdown reflects the choice immediately rather
      // than waiting a round trip.
      setPortfolios((prev) =>
        prev.map((p) => (p.id === id ? { ...p, position_sort_mode: mode } : p)),
      );
      await dbSetPositionSortMode(id, mode);
      await load();
    },
    [load]
  );

  /** Puts a portfolio in `groupId` (null = ungrouped) and applies the full
   *  order `ids`, which a drag across groups changes along with the group. */
  const move = useCallback(
    async (id: number, groupId: number | null, ids: number[]) => {
      setPortfolios((prev) => {
        const byId = new Map(
          prev.map((p) => [p.id, p.id === id ? { ...p, group_id: groupId } : p]),
        );
        return ids.flatMap((pid) => byId.get(pid) ?? []);
      });
      try {
        await dbSetGroup(id, groupId);
        await dbReorder(ids);
      } finally {
        await load();
      }
    },
    [load]
  );

  const createGroup = useCallback(
    async (name: string): Promise<number> => {
      const id = await dbCreateGroup(name);
      await load();
      return id;
    },
    [load]
  );

  const renameGroup = useCallback(
    async (id: number, name: string) => {
      await dbRenameGroup(id, name);
      await load();
    },
    [load]
  );

  const removeGroup = useCallback(
    async (id: number) => {
      await dbDeleteGroup(id);
      await load();
    },
    [load]
  );

  const starredPortfolio = portfolios.find((p) => p.is_starred === 1) ?? portfolios[0] ?? null;

  return {
    portfolios,
    groups,
    loading,
    starredPortfolio,
    create,
    rename,
    remove,
    star,
    reorder,
    setPositionSortMode,
    move,
    createGroup,
    renameGroup,
    removeGroup,
    reload: load,
  };
}
