import { useEffect, useState } from "react";
import type { TickerSummary, Purchase, Stock, LinkOpenMode } from "../../types";
import {
  formatCurrency,
  formatPercent,
  formatShares,
  pnlColor,
  cn,
  isCusip,
} from "../../lib/utils";
import {
  ExternalLink,
  Star,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  CalendarDays,
  BarChart2,
  List,
  Settings,
  Download,
  Upload,
  Landmark,
} from "lucide-react";
import { MountainChart } from "../analysis/MountainChart";
import { TickerNews } from "../analysis/TickerNews";
import { PurchasesTable } from "./PurchasesTable";
import { ExtendedHoursTag } from "../shared/ExtendedHoursTag";
import { useFavorites } from "../../hooks/useFavorites";
import { openUrl } from "../../lib/openUrl";
import {
  addEarningsCallToCalendar,
  fetchUpcomingEarnings,
  exportPurchasesCsv,
  importPurchasesCsv,
  exportPurchasesXlsx,
  importPurchasesXlsx,
  importAmeripriseCSV,
  clearPortfolioPurchases,
} from "../../lib/db";

type PortfolioTab = "analysis" | "purchases" | "settings";

interface PortfolioViewProps {
  portfolioId: number | null;
  portfolioName: string;
  purchases: Purchase[];
  stocks: Stock[];
  summaries: TickerSummary[];
  onAdd: (
    ticker: string,
    shares: number,
    price: number,
    date: string,
  ) => Promise<void>;
  onUpdate: (
    id: number,
    ticker: string,
    shares: number,
    price: number,
    date: string,
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onRefresh: () => void;
  linkOpenMode: LinkOpenMode;
  onDeletePortfolio: (id: number) => Promise<void>;
}

export function PortfolioView({
  portfolioId,
  portfolioName,
  purchases,
  stocks,
  summaries,
  onAdd,
  onUpdate,
  onDelete,
  onRefresh,
  linkOpenMode,
  onDeletePortfolio,
}: PortfolioViewProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTab>("analysis");

  // When portfolio changes, reset tab
  useEffect(() => {
    setActiveTab("analysis");
  }, [portfolioId]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const {
    favoriteTickers,
    loaded: favoritesLoaded,
    isFavorite,
    toggle,
    reorder,
  } = useFavorites(portfolioId);
  const [upcomingEarnings, setUpcomingEarnings] = useState<
    Record<string, number>
  >({});
  const [addingCalendarFor, setAddingCalendarFor] = useState<string | null>(
    null,
  );
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [dataOpStatus, setDataOpStatus] = useState<{
    kind: "success" | "error";
    msg: string;
  } | null>(null);
  const [confirmClearPortfolio, setConfirmClearPortfolio] = useState(false);
  const [clearingPortfolio, setClearingPortfolio] = useState(false);
  const [confirmDeletePortfolio, setConfirmDeletePortfolio] = useState(false);
  const [deletingPortfolio, setDeletingPortfolio] = useState(false);

  // Switch to Purchases tab automatically when portfolio is empty
  useEffect(() => {
    if (favoritesLoaded && summaries.length === 0) {
      setActiveTab("purchases");
    }
  }, [favoritesLoaded, summaries.length]);

  const isMutualFund = (qt: string | null) => {
    const q = qt?.toUpperCase() ?? "";
    return (
      q === "MUTUALFUND" ||
      q === "UIT" ||
      q === "MONEYMARKET" ||
      q === "MONEYMARKETS"
    );
  };

  const favorites = summaries
    .filter((s) => isFavorite(s.ticker))
    .sort(
      (a, b) =>
        favoriteTickers.indexOf(a.ticker) - favoriteTickers.indexOf(b.ticker),
    );

  const nonFavStocks = summaries
    .filter(
      (s) =>
        !isFavorite(s.ticker) &&
        !isMutualFund(s.quoteType) &&
        !isCusip(s.ticker),
    )
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const nonFavFunds = summaries
    .filter((s) => !isFavorite(s.ticker) && isMutualFund(s.quoteType))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const nonFavBonds = summaries
    .filter((s) => !isFavorite(s.ticker) && isCusip(s.ticker))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const ordered = [
    ...favorites,
    ...nonFavStocks,
    ...nonFavFunds,
    ...nonFavBonds,
  ];

  const selected =
    selectedTicker && ordered.some((s) => s.ticker === selectedTicker)
      ? selectedTicker
      : favoritesLoaded && ordered.length > 0
        ? ordered[0].ticker
        : null;

  useEffect(() => {
    if (selected !== null && selected !== selectedTicker) {
      setSelectedTicker(selected);
    }
  }, [selected, selectedTicker]);

  // Reset selected ticker when portfolio changes
  useEffect(() => {
    setSelectedTicker(null);
  }, [portfolioId]);

  const summary = ordered.find((s) => s.ticker === selected) ?? null;
  const selectedStock =
    selected != null ? stocks.find((s) => s.ticker === selected) : undefined;
  const tickerPurchases = purchases.filter((p) => p.ticker === selected);
  const selectedEarningsAt = summary
    ? upcomingEarnings[summary.ticker]
    : undefined;
  const orderedTickers = ordered.map((s) => s.ticker);
  const earningsKey = orderedTickers.join(",");

  useEffect(() => {
    if (orderedTickers.length === 0) {
      setUpcomingEarnings({});
      return;
    }
    const quotableTickers = orderedTickers.filter((t) => !isCusip(t));
    let cancelled = false;
    const loadUpcoming = async () => {
      try {
        const events = await fetchUpcomingEarnings(quotableTickers, 30);
        if (cancelled) return;
        const nextMap: Record<string, number> = {};
        for (const e of events) nextMap[e.ticker] = e.event_at;
        setUpcomingEarnings(nextMap);
      } catch {
        if (!cancelled) setUpcomingEarnings({});
      }
    };
    loadUpcoming();
    return () => {
      cancelled = true;
    };
  }, [earningsKey]);

  async function openYahooFinance(ticker: string) {
    await openUrl(
      `https://finance.yahoo.com/quote/${ticker}`,
      linkOpenMode,
      `${ticker} - Yahoo Finance`,
    );
  }

  async function moveFavorite(ticker: string, direction: "up" | "down") {
    const idx = favoriteTickers.indexOf(ticker);
    if (idx < 0) return;
    const newOrder = [...favoriteTickers];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    await reorder(newOrder);
  }

  async function handleAddEarningsCallToCalendar(
    ticker: string,
    eventAt: number,
  ) {
    try {
      setAddingCalendarFor(ticker);
      setCalendarError(null);
      await addEarningsCallToCalendar(ticker, eventAt);
    } catch (e) {
      setCalendarError(
        `Could not open calendar for ${ticker}. Please try again.`,
      );
      console.error("open_earnings_call_in_calendar failed", e);
    } finally {
      setAddingCalendarFor(null);
    }
  }

  function formatDateTime(unixSeconds: number): string {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(unixSeconds * 1000));
  }

  async function handleExportCsv() {
    if (portfolioId == null) return;
    try {
      const ok = await exportPurchasesCsv(portfolioId);
      if (ok)
        setDataOpStatus({ kind: "success", msg: "Exported successfully." });
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Export failed: ${e}` });
    }
  }

  async function handleExportXlsx() {
    if (portfolioId == null) return;
    try {
      const ok = await exportPurchasesXlsx(portfolioId);
      if (ok)
        setDataOpStatus({ kind: "success", msg: "Exported successfully." });
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Export failed: ${e}` });
    }
  }

  async function handleImportCsv() {
    if (portfolioId == null) return;
    try {
      const n = await importPurchasesCsv(portfolioId);
      setDataOpStatus({
        kind: "success",
        msg: `Imported ${n} purchase${n === 1 ? "" : "s"}.`,
      });
      onRefresh();
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Import failed: ${e}` });
    }
  }

  async function handleImportXlsx() {
    if (portfolioId == null) return;
    try {
      const n = await importPurchasesXlsx(portfolioId);
      setDataOpStatus({
        kind: "success",
        msg: `Imported ${n} purchase${n === 1 ? "" : "s"}.`,
      });
      onRefresh();
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Import failed: ${e}` });
    }
  }

  async function handleImportAmeriprise() {
    if (portfolioId == null) return;
    try {
      const n = await importAmeripriseCSV(portfolioId);
      setDataOpStatus({
        kind: "success",
        msg: `Imported ${n} transaction${n === 1 ? "" : "s"} from Ameriprise.`,
      });
      onRefresh();
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Ameriprise import failed: ${e}` });
    }
  }

  async function handleClearPortfolio() {
    if (portfolioId == null) return;
    setClearingPortfolio(true);
    try {
      await clearPortfolioPurchases(portfolioId);
      setDataOpStatus({ kind: "success", msg: "Portfolio data cleared." });
      onRefresh();
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Clear failed: ${e}` });
    } finally {
      setClearingPortfolio(false);
      setConfirmClearPortfolio(false);
    }
  }

  async function handleDeletePortfolio() {
    if (portfolioId == null) return;
    setDeletingPortfolio(true);
    try {
      await onDeletePortfolio(portfolioId);
    } catch (e) {
      setDeletingPortfolio(false);
      setConfirmDeletePortfolio(false);
      setDataOpStatus({ kind: "error", msg: `Delete failed: ${e}` });
    }
  }

  if (!favoritesLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  const isEmpty = summaries.length === 0;

  return (
    <div className="flex h-full gap-0">
      {/* Ticker selector — left panel (hidden when empty) */}
      {!isEmpty && (
        <div className="w-52 border-r border-border shrink-0 overflow-y-auto">
          {favorites.length > 0 && <SectionLabel label="Favorites" />}
          {favorites.map((s) => {
            const favIdx = favoriteTickers.indexOf(s.ticker);
            return (
              <TickerRow
                key={s.ticker}
                s={s}
                isSelected={selected === s.ticker}
                hasUpcomingEarnings={Boolean(upcomingEarnings[s.ticker])}
                isFav
                favIdx={favIdx}
                favCount={favoriteTickers.length}
                onSelect={setSelectedTicker}
                onToggleFav={toggle}
                onMoveFav={moveFavorite}
              />
            );
          })}
          <CollapsibleSection label="Stocks" items={nonFavStocks}>
            {nonFavStocks.map((s) => (
              <TickerRow
                key={s.ticker}
                s={s}
                isSelected={selected === s.ticker}
                hasUpcomingEarnings={Boolean(upcomingEarnings[s.ticker])}
                isFav={false}
                favIdx={-1}
                favCount={0}
                onSelect={setSelectedTicker}
                onToggleFav={toggle}
                onMoveFav={moveFavorite}
              />
            ))}
          </CollapsibleSection>
          <CollapsibleSection label="Mutual Funds & UITs" items={nonFavFunds}>
            {nonFavFunds.map((s) => (
              <TickerRow
                key={s.ticker}
                s={s}
                isSelected={selected === s.ticker}
                hasUpcomingEarnings={Boolean(upcomingEarnings[s.ticker])}
                isFav={false}
                favIdx={-1}
                favCount={0}
                onSelect={setSelectedTicker}
                onToggleFav={toggle}
                onMoveFav={moveFavorite}
              />
            ))}
          </CollapsibleSection>
          <CollapsibleSection label="Bonds & CDs" items={nonFavBonds}>
            {nonFavBonds.map((s) => (
              <TickerRow
                key={s.ticker}
                s={s}
                isSelected={selected === s.ticker}
                hasUpcomingEarnings={false}
                isFav={false}
                favIdx={-1}
                favCount={0}
                onSelect={setSelectedTicker}
                onToggleFav={toggle}
                onMoveFav={moveFavorite}
              />
            ))}
          </CollapsibleSection>
        </div>
      )}

      {/* Right panel with tabs */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border bg-background shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("analysis")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "analysis"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <BarChart2 className="w-4 h-4" />
            Analysis
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("purchases")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "purchases"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="w-4 h-4" />
            Purchases
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "settings"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>

        {/* Tab content */}
        {activeTab === "settings" ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-lg flex flex-col gap-8">
              {/* Portfolio info */}
              <div>
                <h2 className="text-base font-semibold text-foreground mb-1">
                  {portfolioName}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Portfolio settings and data management.
                </p>
              </div>

              {/* Data management */}
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-0.5">
                    Export Purchases
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Save all purchases in this portfolio to a file.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleExportXlsx}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Export XLSX
                    </button>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-foreground mb-0.5">
                    Import Purchases
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Add purchases from a CSV or Excel file into this portfolio.
                    Expected columns:{" "}
                    <code className="text-xs bg-muted px-1 rounded">
                      ticker, shares, price_per_share, purchased_at (YYYY-MM-DD)
                    </code>
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleImportCsv}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <Upload className="w-4 h-4" />
                      Import CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleImportXlsx}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <Upload className="w-4 h-4" />
                      Import XLSX
                    </button>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-foreground mb-0.5">
                    Import from Ameriprise
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Import BUY transactions and dividend reinvestments directly
                    from an Ameriprise account activity CSV export.
                  </p>
                  <button
                    type="button"
                    onClick={handleImportAmeriprise}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <Upload className="w-4 h-4" />
                    Import Ameriprise CSV
                  </button>
                </div>
              </div>

              {/* Status feedback */}
              {dataOpStatus && (
                <div
                  className={cn(
                    "text-sm px-4 py-3 rounded-lg border flex items-center justify-between gap-3",
                    dataOpStatus.kind === "success"
                      ? "bg-positive/10 border-positive/30 text-positive"
                      : "bg-negative/10 border-negative/30 text-negative",
                  )}
                >
                  <span>{dataOpStatus.msg}</span>
                  <button
                    type="button"
                    onClick={() => setDataOpStatus(null)}
                    className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Danger Zone */}
              <div className="border-t border-red-500/20 pt-6 flex flex-col gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-0.5">
                    Danger Zone
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    These actions are permanent and cannot be undone.
                  </p>
                </div>

                {/* Clear portfolio data */}
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Clear portfolio data
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Removes all purchases and favorites from this portfolio.
                      The portfolio itself is kept.
                    </p>
                  </div>
                  {!confirmClearPortfolio ? (
                    <button
                      type="button"
                      onClick={() => setConfirmClearPortfolio(true)}
                      disabled={clearingPortfolio || deletingPortfolio}
                      className="self-start flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Clear Data
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-red-600 font-medium">
                        Are you sure?
                      </span>
                      <button
                        type="button"
                        onClick={handleClearPortfolio}
                        disabled={clearingPortfolio}
                        className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {clearingPortfolio ? "Clearing…" : "Yes, clear data"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearPortfolio(false)}
                        disabled={clearingPortfolio}
                        className="px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Delete portfolio */}
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Delete portfolio
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permanently deletes this portfolio and all its data.
                    </p>
                  </div>
                  {!confirmDeletePortfolio ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeletePortfolio(true)}
                      disabled={clearingPortfolio || deletingPortfolio}
                      className="self-start flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete Portfolio
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-red-600 font-medium">
                        Are you sure? This cannot be undone.
                      </span>
                      <button
                        type="button"
                        onClick={handleDeletePortfolio}
                        disabled={deletingPortfolio}
                        className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {deletingPortfolio
                          ? "Deleting…"
                          : "Yes, delete portfolio"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeletePortfolio(false)}
                        disabled={deletingPortfolio}
                        className="px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "purchases" ? (
          <PurchasesTable
            purchases={purchases}
            stocks={stocks}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
            <p className="text-sm">No purchases yet.</p>
            <button
              type="button"
              onClick={() => setActiveTab("purchases")}
              className="btn-primary text-sm"
            >
              Go to Purchases tab
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
            {summary ? (
              <>
                {/* Ticker header */}
                <div className="flex items-center gap-3 flex-wrap">
                  {isCusip(summary.ticker) ? (
                    <>
                      <span className="text-2xl font-bold font-mono text-foreground">
                        {summary.ticker}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                        Fixed Income
                      </span>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openYahooFinance(summary.ticker)}
                      className="flex items-center gap-2 text-2xl font-bold text-primary hover:underline"
                    >
                      {summary.ticker}
                      <ExternalLink className="w-5 h-5 opacity-60" />
                    </button>
                  )}
                  {summary.name && (
                    <span className="text-muted-foreground">
                      {summary.name}
                    </span>
                  )}
                  {!isCusip(summary.ticker) && selectedEarningsAt && (
                    <button
                      type="button"
                      onClick={() =>
                        handleAddEarningsCallToCalendar(
                          summary.ticker,
                          selectedEarningsAt,
                        )
                      }
                      disabled={addingCalendarFor === summary.ticker}
                      className="btn-secondary text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                      title="Open your default calendar app and add an earnings-call invite"
                    >
                      <CalendarDays className="w-3.5 h-3.5" />
                      {addingCalendarFor === summary.ticker
                        ? "Opening Calendar..."
                        : `Add Earning Call to Calendar (${formatDateTime(selectedEarningsAt)})`}
                    </button>
                  )}
                  {calendarError && (
                    <span className="text-xs bg-red-500/10 text-red-600 px-2 py-0.5 rounded-full">
                      {calendarError}
                    </span>
                  )}
                  {!isCusip(summary.ticker) &&
                    summary.isStale &&
                    summary.currentPrice != null && (
                      <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
                        stale price
                      </span>
                    )}
                </div>

                {isCusip(summary.ticker) ? (
                  <>
                    {/* Fixed income stats */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <StatCard label="CUSIP" value={summary.ticker} />
                      <StatCard
                        label="Face Value"
                        value={formatCurrency(summary.totalInvested)}
                      />
                      <StatCard
                        label="Total Invested"
                        value={formatCurrency(summary.totalInvested)}
                      />
                    </div>

                    {/* Fixed income info notice */}
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
                      This is a fixed income position (bond or CD) identified by
                      CUSIP. Live price data is not available via Yahoo Finance
                      for CUSIP-identified securities — performance is tracked
                      by cost basis only.
                    </div>
                  </>
                ) : (
                  <>
                    {/* Stats grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <StatCard
                        label="Total Shares"
                        value={formatShares(summary.totalShares)}
                      />
                      <StatCard
                        label="Total Invested"
                        value={formatCurrency(summary.totalInvested)}
                      />
                      <StatCard
                        label="Avg Cost Basis"
                        value={formatCurrency(summary.avgCostBasis)}
                      />
                      <StatCard
                        label="Current Price"
                        value={
                          summary.currentPrice != null
                            ? formatCurrency(summary.currentPrice)
                            : "—"
                        }
                        extra={<ExtendedHoursTag stock={selectedStock} />}
                      />
                      <StatCard
                        label="Market Value"
                        value={formatCurrency(summary.marketValue)}
                      />
                      <StatCard
                        label="Total P&L"
                        value={
                          summary.pnlDollar != null
                            ? `${formatCurrency(summary.pnlDollar)} (${formatPercent(summary.pnlPercent)})`
                            : "—"
                        }
                        valueClass={pnlColor(summary.pnlDollar)}
                      />
                    </div>

                    {/* Chart */}
                    <MountainChart
                      ticker={summary.ticker}
                      quoteType={summary.quoteType}
                    />

                    {/* News */}
                    <TickerNews
                      ticker={summary.ticker}
                      linkOpenMode={linkOpenMode}
                    />
                  </>
                )}

                {/* Transaction history */}
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-3">
                    Transaction History
                  </h3>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">
                          Date
                        </th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">
                          {isCusip(summary.ticker) ? "Face Value" : "Shares"}
                        </th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">
                          Price Paid
                        </th>
                        <th className="text-right px-3 py-2 text-muted-foreground font-medium">
                          Total Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickerPurchases.map((p) => (
                        <tr key={p.id} className="border-b border-border/50">
                          <td className="px-3 py-2">{p.purchased_at}</td>
                          <td className="px-3 py-2 text-right">
                            {isCusip(summary.ticker)
                              ? formatCurrency(p.shares * p.price_per_share)
                              : formatShares(p.shares)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {isCusip(summary.ticker)
                              ? "at par"
                              : formatCurrency(p.price_per_share)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatCurrency(p.shares * p.price_per_share)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a ticker from the left panel.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  valueClass,
  extra,
}: {
  label: string;
  value: string;
  valueClass?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg px-4 py-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn("text-base font-semibold text-foreground", valueClass)}
        >
          {value}
        </span>
        {extra}
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 border-b border-border">
      {label}
    </div>
  );
}

function CollapsibleSection({
  label,
  items,
  children,
}: {
  label: string;
  items: unknown[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <>
      <div
        onDoubleClick={() => setCollapsed((c) => !c)}
        className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 border-b border-border flex items-center gap-1 cursor-pointer select-none hover:bg-muted/80 transition-colors"
        title="Double-click to collapse/expand"
      >
        <ChevronRight
          className={cn(
            "w-3 h-3 transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        {label}
      </div>
      {!collapsed && children}
    </>
  );
}

function TickerRow({
  s,
  isSelected,
  hasUpcomingEarnings,
  isFav,
  favIdx,
  favCount,
  onSelect,
  onToggleFav,
  onMoveFav,
}: {
  s: TickerSummary;
  isSelected: boolean;
  hasUpcomingEarnings: boolean;
  isFav: boolean;
  favIdx: number;
  favCount: number;
  onSelect: (ticker: string) => void;
  onToggleFav: (ticker: string) => void;
  onMoveFav: (ticker: string, dir: "up" | "down") => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center border-b border-border transition-colors group",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted",
      )}
    >
      {/* Star toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav(s.ticker);
        }}
        className={cn(
          "pl-2 pr-0 py-3 shrink-0 transition-colors",
          isFav
            ? isSelected
              ? "text-yellow-200"
              : "text-yellow-500"
            : isSelected
              ? "text-primary-foreground/40 hover:text-yellow-200"
              : "text-muted-foreground/40 hover:text-yellow-500",
        )}
        title={isFav ? "Remove from favorites" : "Add to favorites"}
      >
        <Star className={cn("w-3.5 h-3.5", isFav && "fill-current")} />
      </button>

      {/* Ticker name */}
      <button
        type="button"
        onClick={() => onSelect(s.ticker)}
        className="flex-1 text-left px-2 py-2 text-sm font-medium min-w-0"
      >
        <div className="truncate flex items-center gap-1.5">
          <span>{s.ticker}</span>
          {hasUpcomingEarnings && (
            <CalendarDays
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                isSelected ? "text-primary-foreground/85" : "text-primary",
              )}
            />
          )}
        </div>
        {s.name && <div className="text-xs opacity-70 truncate">{s.name}</div>}
      </button>

      {isCusip(s.ticker) ? (
        /* Fixed income icon */
        <span title="Fixed income (bond / CD)">
          <Landmark
            className={cn(
              "w-3.5 h-3.5 shrink-0 mr-2",
              isSelected ? "text-primary-foreground/60" : "text-blue-500/70",
            )}
          />
        </span>
      ) : (
        <>
          {/* P&L dot */}
          {s.pnlDollar != null && (
            <div
              className={cn(
                "w-2 h-2 rounded-full shrink-0 mr-1",
                s.pnlDollar > 0 ? "bg-positive" : "bg-negative",
              )}
              title={
                s.pnlDollar > 0
                  ? "Price is above your avg cost"
                  : "Price is below your avg cost"
              }
            />
          )}

          {/* Daily change */}
          {s.dailyChangePct != null && (
            <div
              className={cn(
                "flex items-center gap-0.5 pr-1 shrink-0 text-xs font-medium",
                s.dailyChangePct > 0
                  ? isSelected
                    ? "text-primary-foreground/80"
                    : "text-positive"
                  : s.dailyChangePct < 0
                    ? isSelected
                      ? "text-primary-foreground/70"
                      : "text-negative"
                    : isSelected
                      ? "text-primary-foreground/60"
                      : "text-muted-foreground",
              )}
            >
              {s.dailyChangePct > 0 ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : s.dailyChangePct < 0 ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : (
                <Minus className="w-3.5 h-3.5" />
              )}
              <span>
                {s.dailyChangePct >= 0 ? "+" : ""}
                {s.dailyChangePct.toFixed(2)}%
              </span>
            </div>
          )}
        </>
      )}

      {/* Move buttons for favorites */}
      {isFav && (
        <div className="flex flex-col pr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveFav(s.ticker, "up");
            }}
            disabled={favIdx === 0}
            className={cn(
              "p-0.5 rounded transition-colors",
              isSelected
                ? "hover:bg-primary-foreground/20 disabled:opacity-30"
                : "hover:bg-accent disabled:opacity-30",
            )}
            title="Move up"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveFav(s.ticker, "down");
            }}
            disabled={favIdx === favCount - 1}
            className={cn(
              "p-0.5 rounded transition-colors",
              isSelected
                ? "hover:bg-primary-foreground/20 disabled:opacity-30"
                : "hover:bg-accent disabled:opacity-30",
            )}
            title="Move down"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
