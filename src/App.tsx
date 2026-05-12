import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { View, AppConfig, SyncResult, SyncStatus } from "./types";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { PortfolioView } from "./components/portfolio/PortfolioView";
import { WatchList } from "./components/watchlist/WatchList";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { Dashboard } from "./components/dashboard/Dashboard";
import { usePortfolio } from "./hooks/usePortfolio";
import { usePortfolios } from "./hooks/usePortfolios";
import { useWatchlist } from "./hooks/useWatchlist";
import { useWatchlists } from "./hooks/useWatchlists";
import { useTheme } from "./hooks/useTheme";
import { useInvestorMode } from "./hooks/useInvestorMode";
import { useLinkOpenMode } from "./hooks/useLinkOpenMode";
import { useInfoTooltips } from "./hooks/useInfoTooltips";

const VIEW_TITLES: Partial<Record<View, string>> = {
  dashboard: "Dashboard",
  watchlist: "Watch List",
  settings: "Settings",
};

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { theme, setTheme } = useTheme();
  const { investorMode, setInvestorMode } = useInvestorMode();
  const { linkOpenMode, setLinkOpenMode } = useLinkOpenMode();
  const { showInfoTooltips, setShowInfoTooltips } = useInfoTooltips();

  // ── Sync state ────────────────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncTick, setSyncTick] = useState(0);
  const [configVersion, setConfigVersion] = useState(0);
  const [hasSyncTargets, setHasSyncTargets] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runAutoSync = useCallback(async () => {
    let config: AppConfig;
    try {
      config = await invoke<AppConfig>("get_config");
    } catch {
      return;
    }
    if (!config.sync_targets || config.sync_targets.length === 0) return;

    setSyncStatus("syncing");
    let anyFailed = false;
    let anyDownloaded = false;
    for (const target of config.sync_targets) {
      try {
        const result = await invoke<SyncResult>("sync_now", {
          targetId: target.id,
        });
        if (!result.success) anyFailed = true;
        if (result.downloaded) anyDownloaded = true;
      } catch {
        anyFailed = true;
      }
    }
    setSyncStatus(anyFailed ? "error" : "success");
    const now = new Date();
    setLastSyncedAt(now);
    // Notify StorageSettings to refresh its config so last_synced_at updates
    setSyncTick((n) => n + 1);
    // If any target downloaded a newer DB, reload the whole app so all hooks
    // re-fetch from the newly replaced database.
    if (anyDownloaded) {
      window.location.reload();
      return;
    }
    // Reset back to idle after 8 seconds
    setTimeout(() => setSyncStatus((s) => (s !== "syncing" ? "idle" : s)), 8000);
  }, []);

  // Re-set up the auto-sync interval whenever the user saves sync config
  useEffect(() => {
    async function setupTimer() {
      let config: AppConfig;
      try {
        config = await invoke<AppConfig>("get_config");
      } catch {
        return;
      }
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      setHasSyncTargets((config.sync_targets?.length ?? 0) > 0);
      // Seed last-synced time from the most-recent target timestamp on disk
      const latestTs = config.sync_targets
        ?.map((t) => t.last_synced_at ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);
      if (latestTs > 0) setLastSyncedAt(new Date(latestTs * 1000));
      const mins = config.auto_sync_minutes;
      if (mins && mins > 0) {
        syncTimerRef.current = setInterval(runAutoSync, mins * 60 * 1000);
      }
    }
    setupTimer();
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  // configVersion changes whenever the user saves sync settings, forcing timer restart
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAutoSync, configVersion]);

  const {
    portfolios,
    loading: portfoliosLoading,
    starredPortfolio,
    create,
    rename,
    remove,
    star,
    reorder,
  } = usePortfolios();

  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(
    null,
  );
  const [newPortfolioTrigger, setNewPortfolioTrigger] = useState(0);

  // Once portfolios are loaded, default to the starred one
  useEffect(() => {
    if (
      !portfoliosLoading &&
      activePortfolioId == null &&
      starredPortfolio != null
    ) {
      setActivePortfolioId(starredPortfolio.id);
    }
  }, [portfoliosLoading, activePortfolioId, starredPortfolio]);

  const resolvedPortfolioId = activePortfolioId ?? starredPortfolio?.id ?? null;
  const activePortfolio =
    portfolios.find((p) => p.id === resolvedPortfolioId) ?? null;

  const {
    purchases,
    stocks,
    summaries,
    loading,
    refreshing,
    error,
    refresh,
    reload,
    add,
    update,
    remove: deletePurchase,
  } = usePortfolio(resolvedPortfolioId);

  const {
    watchlists,
    loading: watchlistsLoading,
    create: createWatchlist,
    rename: renameWatchlist,
    remove: removeWatchlist,
    reload: reloadWatchlists,
  } = useWatchlists();
  const [activeWatchlistId, setActiveWatchlistId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (
      !watchlistsLoading &&
      activeWatchlistId == null &&
      watchlists.length > 0
    ) {
      setActiveWatchlistId(watchlists[0].id);
    }
  }, [watchlistsLoading, watchlists, activeWatchlistId]);

  const watchlist = useWatchlist(activeWatchlistId);

  const lastRefreshedAt = useMemo(() => {
    if (stocks.length === 0) return null;
    const max = stocks.reduce(
      (acc, s) => Math.max(acc, s.last_fetched_at ?? 0),
      0,
    );
    return max > 0 ? new Date(max * 1000) : null;
  }, [stocks]);

  const showRefresh = view === "portfolio" || view === "dashboard";

  const headerTitle =
    view === "portfolio" && activePortfolio
      ? activePortfolio.name
      : (VIEW_TITLES[view] ?? "");

  async function handleSelectPortfolio(id: number) {
    setActivePortfolioId(id);
    setView("portfolio");
  }

  async function handleCreatePortfolio(name: string): Promise<number> {
    return await create(name);
  }

  return (
    <div className="flex h-dvh w-dvw overflow-hidden">
      <Sidebar
        view={view}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        portfolios={portfolios}
        activePortfolioId={resolvedPortfolioId}
        onSelectPortfolio={handleSelectPortfolio}
        onCreatePortfolio={handleCreatePortfolio}
        onRenamePortfolio={rename}
        onDeletePortfolio={async (id) => {
          await remove(id);
          if (id === resolvedPortfolioId) {
            const remaining = portfolios.filter((p) => p.id !== id);
            if (remaining.length > 0) {
              setActivePortfolioId(remaining[0].id);
              setView("portfolio");
            } else {
              setActivePortfolioId(null);
              setView("dashboard");
              setSidebarCollapsed(false);
              setNewPortfolioTrigger((c) => c + 1);
            }
          }
        }}
        newPortfolioTrigger={newPortfolioTrigger}
        onStarPortfolio={star}
        onReorderPortfolios={reorder}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header
          title={headerTitle}
          onRefresh={showRefresh ? refresh : undefined}
          refreshing={refreshing}
          lastRefreshedAt={showRefresh ? lastRefreshedAt : undefined}
          syncStatus={syncStatus}
          onSyncNow={runAutoSync}
          hasSyncTargets={hasSyncTargets}
          lastSyncedAt={lastSyncedAt}
        />
        {error && (
          <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-sm text-red-600">
            {error}
          </div>
        )}
        <main className="flex-1 overflow-hidden">
          {loading || portfoliosLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Loading…
            </div>
          ) : view === "dashboard" ? (
            <Dashboard
              summaries={summaries}
              investorMode={investorMode}
              onModeChange={setInvestorMode}
              showInfoTooltips={showInfoTooltips}
              portfolios={portfolios}
              activePortfolioId={resolvedPortfolioId}
              onSelectPortfolio={(id) => {
                setActivePortfolioId(id);
              }}
            />
          ) : view === "portfolio" ? (
            <PortfolioView
              portfolioId={resolvedPortfolioId}
              portfolioName={activePortfolio?.name ?? ""}
              purchases={purchases}
              stocks={stocks}
              summaries={summaries}
              onAdd={add}
              onUpdate={update}
              onDelete={deletePurchase}
              onRefresh={reload}
              linkOpenMode={linkOpenMode}
              onDeletePortfolio={async (id) => {
                await remove(id);
                const remaining = portfolios.filter((p) => p.id !== id);
                if (remaining.length > 0) {
                  setActivePortfolioId(remaining[0].id);
                  setView("portfolio");
                } else {
                  setActivePortfolioId(null);
                  setView("dashboard");
                  setSidebarCollapsed(false);
                  setNewPortfolioTrigger((c) => c + 1);
                }
              }}
            />
          ) : view === "watchlist" ? (
            <WatchList
              watchlists={watchlists}
              activeWatchlistId={activeWatchlistId}
              onSelectWatchlist={setActiveWatchlistId}
              onCreateWatchlist={createWatchlist}
              onRenameWatchlist={renameWatchlist}
              onDeleteWatchlist={async (id) => {
                await removeWatchlist(id);
                const remaining = watchlists.filter((w) => w.id !== id);
                if (remaining.length > 0) {
                  setActiveWatchlistId(remaining[0].id);
                } else {
                  // Auto-create a replacement so the user always has at least one
                  const newId = await createWatchlist("My Watchlist");
                  setActiveWatchlistId(newId);
                }
              }}
              onReloadWatchlists={reloadWatchlists}
              items={watchlist.items}
              stocks={watchlist.stocks}
              linkOpenMode={linkOpenMode}
              onAdd={watchlist.add}
              onRemove={watchlist.remove}
              onReload={watchlist.reload}
              onPurchase={async (ticker, shares, price, date) => {
                await add(ticker, shares, price, date);
              }}
            />
          ) : (
            <SettingsPanel
              theme={theme}
              onThemeChange={setTheme}
              onDataChange={refresh}
              investorMode={investorMode}
              onInvestorModeChange={setInvestorMode}
              linkOpenMode={linkOpenMode}
              onLinkOpenModeChange={setLinkOpenMode}
              showInfoTooltips={showInfoTooltips}
              onShowInfoTooltipsChange={setShowInfoTooltips}
              syncTick={syncTick}
              onConfigSaved={() => setConfigVersion((v) => v + 1)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
