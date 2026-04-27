import { useState, useEffect } from "react";
import type { View } from "./types";
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

  const { portfolios, loading: portfoliosLoading, starredPortfolio, create, rename, remove, star, reorder } = usePortfolios();

  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null);
  const [newPortfolioTrigger, setNewPortfolioTrigger] = useState(0);

  // Once portfolios are loaded, default to the starred one
  useEffect(() => {
    if (!portfoliosLoading && activePortfolioId == null && starredPortfolio != null) {
      setActivePortfolioId(starredPortfolio.id);
    }
  }, [portfoliosLoading, activePortfolioId, starredPortfolio]);

  const resolvedPortfolioId = activePortfolioId ?? starredPortfolio?.id ?? null;
  const activePortfolio = portfolios.find((p) => p.id === resolvedPortfolioId) ?? null;

  const { purchases, stocks, summaries, loading, refreshing, error, refresh, reload, add, update, remove: deletePurchase } =
    usePortfolio(resolvedPortfolioId);

  const { watchlists, loading: watchlistsLoading, create: createWatchlist, rename: renameWatchlist, remove: removeWatchlist, reload: reloadWatchlists } = useWatchlists();
  const [activeWatchlistId, setActiveWatchlistId] = useState<number | null>(null);

  useEffect(() => {
    if (!watchlistsLoading && activeWatchlistId == null && watchlists.length > 0) {
      setActiveWatchlistId(watchlists[0].id);
    }
  }, [watchlistsLoading, watchlists, activeWatchlistId]);

  const watchlist = useWatchlist(activeWatchlistId);

  const showRefresh = view === "portfolio" || view === "dashboard";

  const headerTitle =
    view === "portfolio" && activePortfolio
      ? activePortfolio.name
      : VIEW_TITLES[view] ?? "";

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
            />
          )}
        </main>
      </div>
    </div>
  );
}

