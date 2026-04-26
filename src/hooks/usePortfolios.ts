import { useState, useEffect, useCallback } from "react";
import type { Portfolio } from "../types";
import {
  listPortfolios,
  createPortfolio as dbCreate,
  renamePortfolio as dbRename,
  deletePortfolio as dbDelete,
  starPortfolio as dbStar,
  reorderPortfolios as dbReorder,
} from "../lib/db";

export function usePortfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const p = await listPortfolios();
    setPortfolios(p);
    setLoading(false);
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
      await dbReorder(ids);
      await load();
    },
    [load]
  );

  const starredPortfolio = portfolios.find((p) => p.is_starred === 1) ?? portfolios[0] ?? null;

  return { portfolios, loading, starredPortfolio, create, rename, remove, star, reorder };
}
