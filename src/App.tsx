import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { addPurchase } from "./lib/db";
import type { View, AppConfig, SyncResult, SyncStatus } from "./types";
import { isBrokerPortfolio } from "./types";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import type { HeaderFigures } from "./components/layout/Header";
import { PortfolioView } from "./components/portfolio/PortfolioView";
import { WatchList } from "./components/watchlist/WatchList";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { Dashboard } from "./components/dashboard/Dashboard";
import { usePortfolio } from "./hooks/usePortfolio";
import { useBrokerPortfolio } from "./hooks/useBrokerPortfolio";
import { useBrokerConnections } from "./hooks/useBrokerConnections";
import { useBackgroundBrokerSync } from "./hooks/useBackgroundBrokerSync";
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
    reload: reloadPortfolios,
  } = usePortfolios();

  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(
    null,
  );
  const [newPortfolioTrigger, setNewPortfolioTrigger] = useState(0);
  const [openBrokerFormTrigger, setOpenBrokerFormTrigger] = useState(0);

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

  const isBroker = isBrokerPortfolio(activePortfolio);

  // Both hooks always run — hooks cannot be conditional — but each is inert
  // when its id is null, so only the active portfolio's kind does any work.
  const manual = usePortfolio(isBroker ? null : resolvedPortfolioId);

  const { connections, reload: reloadBrokers } = useBrokerConnections();
  useBackgroundBrokerSync(reloadBrokers);
  const brokerConnection =
    connections.find((c) =>
      c.accounts.some((a) => a.id === activePortfolio?.broker_account_id),
    ) ?? null;
  const brokerConnectionId = brokerConnection?.id ?? null;
  const broker = useBrokerPortfolio(
    isBroker ? (activePortfolio?.broker_account_id ?? null) : null,
    isBroker ? brokerConnectionId : null,
  );

  // From here down the views cannot tell the two apart: both produce
  // TickerSummary[] and the same loading/refresh surface.
  const purchases = manual.purchases;
  const stocks = isBroker ? broker.stocks : manual.stocks;
  const summaries = isBroker ? broker.summaries : manual.summaries;
  const loading = isBroker ? broker.loading : manual.loading;
  const refreshing = isBroker ? broker.refreshing : manual.refreshing;
  const error = isBroker ? broker.error : manual.error;
  const refresh = isBroker ? broker.refresh : manual.refresh;
  // Manual reload also refreshes the portfolios list — this is the only path
  // (import/clear) that can change last_import_at, which lives there rather
  // than in usePortfolio's per-portfolio data.
  const reload = useCallback(async () => {
    if (isBroker) {
      await broker.reload();
    } else {
      await manual.reload();
      await reloadPortfolios();
    }
  }, [isBroker, broker.reload, manual.reload, reloadPortfolios]);
  const { add, update, remove: deletePurchase } = manual;
  const {
    cashEvents,
    cashTotal,
    addCashEvent,
    updateCashEvent,
    removeCashEvent,
    sales,
    addSale,
    updateSale,
    removeSale,
  } = manual;

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

  // Account-type chips for the sidebar, resolved from the live connection list.
  const brokerBadges = useMemo(() => {
    const map: Record<number, { label: string; kind: string }> = {};
    for (const c of connections) {
      for (const a of c.accounts) {
        map[a.id] = {
          label: c.environment_label,
          kind: c.environment_kind,
        };
      }
    }
    return map;
  }, [connections]);

  const lastRefreshedAt = useMemo(() => {
    if (stocks.length === 0) return null;
    const max = stocks.reduce(
      (acc, s) => Math.max(acc, s.last_fetched_at ?? 0),
      0,
    );
    return max > 0 ? new Date(max * 1000) : null;
  }, [stocks]);

  const showRefresh = view === "portfolio" || view === "dashboard";

  // The sectioned header belongs to the portfolio view only — the dashboard
  // keeps its own layout untouched.
  const inPortfolio = view === "portfolio" && activePortfolio != null;

  // Which brokerage this portfolio belongs to, for the header icon. Null on
  // manual portfolios, which belong to none.
  const headerBroker = useMemo(() => {
    if (!inPortfolio || !isBroker) return null;
    const conn = connections.find((c) =>
      c.accounts.some((a) => a.id === activePortfolio?.broker_account_id),
    );
    return conn
      ? {
          name: conn.provider_name,
          domain: conn.provider_logo_domain,
          badgeLabel: conn.environment_label,
          badgeKind: conn.environment_kind,
        }
      : null;
  }, [inPortfolio, isBroker, connections, activePortfolio]);

  const headerFigures: HeaderFigures | null = useMemo(() => {
    if (!inPortfolio) return null;

    if (isBroker) {
      // Straight from the brokerage. Buying power is theirs alone — a manual
      // portfolio has no such concept, which is why the shapes differ.
      const acct = connections
        .flatMap((c) => c.accounts)
        .find((a) => a.id === activePortfolio?.broker_account_id);
      // Unrealized P&L summed from the broker's own per-position figures, so
      // the total is theirs rather than something recomputed from prices.
      let pl = 0;
      let reported = false;
      for (const s of summaries) {
        if (s.pnlDollar != null) {
          pl += s.pnlDollar;
          reported = true;
        }
      }

      return {
        kind: "broker",
        equity: acct?.equity ?? null,
        cash: acct?.cash ?? null,
        buyingPower: acct?.buying_power ?? null,
        gain: reported ? pl : null,
      };
    }

    let value = 0;
    let cost = 0;
    let priced = false;
    for (const s of summaries) {
      // Manual portfolios (the only source here) always report a real
      // totalInvested — this guard is for TypeScript, not a real case.
      cost += s.totalInvested ?? 0;
      if (s.marketValue != null) {
        value += s.marketValue;
        priced = true;
      }
    }
    return {
      kind: "manual",
      // Until a price arrives there is no market value; showing cost basis
      // under a "Value" label would be a different number wearing that name.
      value: priced ? value : null,
      cost,
      gain: priced ? value - cost : null,
      cash: cashTotal,
    };
  }, [inPortfolio, isBroker, connections, activePortfolio, summaries, cashTotal]);

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
        brokerBadges={brokerBadges}
        onAddBrokerage={() => {
          setView("settings");
          setOpenBrokerFormTrigger((n) => n + 1);
        }}
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
          positionsCount={inPortfolio ? summaries.length : null}
          figures={headerFigures}
          brokerName={headerBroker?.name ?? null}
          brokerLogoDomain={headerBroker?.domain ?? null}
          brokerBadgeLabel={headerBroker?.badgeLabel ?? null}
          brokerBadgeKind={headerBroker?.badgeKind ?? null}
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
              readOnly={isBroker}
              brokerTransactions={isBroker ? broker.transactions : undefined}
              ordersAccountId={
                isBroker && brokerConnection?.supports_orders
                  ? (activePortfolio?.broker_account_id ?? null)
                  : null
              }
              purchases={purchases}
              cashEvents={cashEvents}
              sales={sales}
              lastImportAt={activePortfolio?.last_import_at ?? null}
              stocks={stocks}
              summaries={summaries}
              onAdd={add}
              onUpdate={update}
              onDelete={deletePurchase}
              onAddCashEvent={addCashEvent}
              onUpdateCashEvent={updateCashEvent}
              onDeleteCashEvent={removeCashEvent}
              onAddSale={addSale}
              onUpdateSale={updateSale}
              onDeleteSale={removeSale}
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
              onSetNote={watchlist.setNote}
              onPurchase={async (ticker, shares, price, date) => {
                // Buying from the watch list is a hand-entered action, so it
                // always lands in a manual portfolio — never in a broker
                // mirror, where the row would be stored but never displayed.
                const target =
                  (activePortfolio && !isBrokerPortfolio(activePortfolio)
                    ? activePortfolio
                    : null) ??
                  (starredPortfolio && !isBrokerPortfolio(starredPortfolio)
                    ? starredPortfolio
                    : null) ??
                  portfolios.find((p) => !isBrokerPortfolio(p)) ??
                  null;

                if (!target) {
                  alert(
                    "Create a manual portfolio first — purchases cannot be added to a brokerage-linked portfolio.",
                  );
                  return;
                }

                await addPurchase(target.id, ticker, shares, price, date);

                if (target.id === resolvedPortfolioId) {
                  await reload();
                } else {
                  alert(
                    `Added ${ticker} to "${target.name}". Brokerage portfolios mirror your broker, so hand-entered purchases go to a manual portfolio.`,
                  );
                  await reloadPortfolios();
                }
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
              onBrokersChanged={async () => {
                await Promise.all([reloadPortfolios(), reloadBrokers()]);
              }}
              openBrokerFormTrigger={openBrokerFormTrigger}
            />
          )}
        </main>
      </div>
    </div>
  );
}
