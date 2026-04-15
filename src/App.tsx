import { useState } from "react";
import type { View } from "./types";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { PurchasesTable } from "./components/portfolio/PurchasesTable";
import { AnalysisView } from "./components/analysis/AnalysisView";
import { WatchList } from "./components/watchlist/WatchList";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { Dashboard } from "./components/dashboard/Dashboard";
import { usePortfolio } from "./hooks/usePortfolio";
import { useWatchlist } from "./hooks/useWatchlist";
import { useTheme } from "./hooks/useTheme";
import { useInvestorMode } from "./hooks/useInvestorMode";
import { useLinkOpenMode } from "./hooks/useLinkOpenMode";

const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  purchases: "Purchases",
  analysis: "Analysis",
  watchlist: "Watch List",
  settings: "Settings",
};

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [analysisTicker, setAnalysisTicker] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { theme, setTheme } = useTheme();
  const { investorMode, setInvestorMode } = useInvestorMode();
  const { linkOpenMode, setLinkOpenMode } = useLinkOpenMode();
  const { purchases, stocks, summaries, loading, refreshing, error, refresh, add, update, remove } =
    usePortfolio();
  const watchlist = useWatchlist();

  const showRefresh = view === "purchases" || view === "analysis" || view === "dashboard";

  return (
    <div className="flex h-dvh w-dvw overflow-hidden">
      <Sidebar
        view={view}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header
          title={VIEW_TITLES[view]}
          onRefresh={showRefresh ? refresh : undefined}
          refreshing={refreshing}
        />
        {error && (
          <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-sm text-red-600">
            {error}
          </div>
        )}
        <main className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Loading…
            </div>
          ) : view === "dashboard" ? (
            <Dashboard summaries={summaries} investorMode={investorMode} onModeChange={setInvestorMode} />
          ) : view === "purchases" ? (
            <PurchasesTable
              purchases={purchases}
              stocks={stocks}
              onAdd={add}
              onUpdate={update}
              onDelete={remove}
            />
          ) : view === "analysis" ? (
            <AnalysisView
              summaries={summaries}
              purchases={purchases}
              selectedTicker={analysisTicker}
              onSelectTicker={setAnalysisTicker}
              linkOpenMode={linkOpenMode}
            />
          ) : view === "watchlist" ? (
            <WatchList
              items={watchlist.items}
              stocks={watchlist.stocks}
              onAdd={watchlist.add}
              onRemove={watchlist.remove}
              onPurchase={async (ticker, shares, price, date) => {
                await add(ticker, shares, price, date);
              }}
            />
          ) : (
            <SettingsPanel theme={theme} onThemeChange={setTheme} onDataChange={refresh} investorMode={investorMode} onInvestorModeChange={setInvestorMode} linkOpenMode={linkOpenMode} onLinkOpenModeChange={setLinkOpenMode} />
          )}
        </main>
      </div>
    </div>
  );
}
