import { Fragment, useEffect, useState } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type {
  BrokerTransaction,
  CashEvent,
  DividendInfo,
  Sale,
  TickerSummary,
  Purchase,
  Stock,
  LinkOpenMode,
} from "../../types";
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
  PiggyBank,
  BarChart2,
  List,
  Settings,
  Download,
  Upload,
  Landmark,
  Trophy,
  Lock,
  Layers,
  ClipboardList,
  GripVertical,
  ArrowUpDown,
} from "lucide-react";
import { PortfolioRankView } from "./PortfolioRankView";
import { MountainChart } from "../analysis/MountainChart";
import { TickerNews } from "../analysis/TickerNews";
import { PurchasesTable } from "./PurchasesTable";
import { CashEventsTable } from "./CashEventsTable";
import { BrokerTransactionsTable } from "./BrokerTransactionsTable";
import { BrokerOrdersView } from "./BrokerOrdersView";
import { ExtendedHoursTag } from "../shared/ExtendedHoursTag";
import { useFavorites } from "../../hooks/useFavorites";
import { usePositionOrder } from "../../hooks/usePositionOrder";
import { useDragReorder } from "../../hooks/useDragReorder";
import { openUrl } from "../../lib/openUrl";
import type { ImportResult } from "../../lib/db";
import {
  addEarningsCallToCalendar,
  addDividendToCalendar,
  fetchDividendInfo,
  fetchUpcomingEarnings,
  exportPurchasesCsv,
  importPurchasesCsv,
  exportPurchasesXlsx,
  importPurchasesXlsx,
  importAmeripriseCSV,
  clearPortfolioPurchases,
} from "../../lib/db";

type PortfolioTab =
  | "analysis"
  | "performance"
  | "purchases"
  | "orders"
  | "cash"
  | "settings";

/**
 * Comparator for the positions list, shared by the favorites group and every
 * asset-type section so switching sort mode behaves identically everywhere.
 *
 * `customIndex` looks up a ticker's position in whichever manual order
 * applies to the group being sorted (favorites use `favoriteTickers`,
 * everything else uses `position_order`) — only consulted in "custom" mode.
 * A ticker with no manual position yet (-1) sorts after ones that have one,
 * then alphabetically among themselves, so a newly bought position doesn't
 * land in a random spot.
 */
function positionSortComparator(
  mode: string,
  customIndex: (ticker: string) => number,
) {
  return (a: TickerSummary, b: TickerSummary): number => {
    if (mode === "custom") {
      const ai = customIndex(a.ticker);
      const bi = customIndex(b.ticker);
      if (ai === -1 && bi === -1) return a.ticker.localeCompare(b.ticker);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    if (mode === "ticker") {
      return a.ticker.localeCompare(b.ticker);
    }
    if (mode === "pnl") {
      const av = a.pnlDollar ?? -Infinity;
      const bv = b.pnlDollar ?? -Infinity;
      return bv - av;
    }
    // "gainers" (default): today's % change, biggest first.
    const av = a.dailyChangePct ?? -Infinity;
    const bv = b.dailyChangePct ?? -Infinity;
    return bv - av;
  };
}

interface PortfolioViewProps {
  portfolioId: number | null;
  portfolioName: string;
  purchases: Purchase[];
  cashEvents: CashEvent[];
  sales: Sale[];
  /** When a spreadsheet/Ameriprise import last completed for this portfolio. */
  lastImportAt: number | null;
  /** How the positions list is ordered: "gainers" | "ticker" | "pnl" | "custom". */
  positionSortMode: string;
  onSetPositionSortMode: (mode: string) => Promise<void>;
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
  onAddCashEvent: (
    kind: CashEvent["kind"],
    ticker: string | null,
    amount: number,
    date: string,
    note: string | null,
  ) => Promise<void>;
  onUpdateCashEvent: (
    id: number,
    kind: CashEvent["kind"],
    ticker: string | null,
    amount: number,
    date: string,
    note: string | null,
  ) => Promise<void>;
  onDeleteCashEvent: (id: number) => Promise<void>;
  onAddSale: (
    ticker: string,
    shares: number,
    price: number,
    date: string,
  ) => Promise<void>;
  onUpdateSale: (
    id: number,
    ticker: string,
    shares: number,
    price: number,
    date: string,
  ) => Promise<void>;
  onDeleteSale: (id: number) => Promise<void>;
  onRefresh: () => void;
  linkOpenMode: LinkOpenMode;
  onDeletePortfolio: (id: number) => Promise<void>;
  /** True for broker-linked portfolios: holdings mirror the brokerage and
   *  cannot be edited by hand. */
  readOnly?: boolean;
  /** Dated transaction history from the broker, shown instead of purchases. */
  brokerTransactions?: BrokerTransaction[];
  /** Broker account to show live orders for; null hides the Orders tab
   *  (manual portfolios, and brokers that don't expose orders). */
  ordersAccountId?: number | null;
}

export function PortfolioView({
  portfolioId,
  portfolioName,
  purchases,
  cashEvents,
  sales,
  lastImportAt,
  positionSortMode,
  onSetPositionSortMode,
  stocks,
  summaries,
  onAdd,
  onUpdate,
  onDelete,
  onAddCashEvent,
  onUpdateCashEvent,
  onDeleteCashEvent,
  onAddSale,
  onUpdateSale,
  onDeleteSale,
  onRefresh,
  linkOpenMode,
  onDeletePortfolio,
  readOnly = false,
  brokerTransactions,
  ordersAccountId = null,
}: PortfolioViewProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTab>("analysis");

  // When portfolio changes, reset tab
  useEffect(() => {
    setActiveTab("analysis");
  }, [portfolioId]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  function selectTicker(ticker: string) {
    setSelectedTicker(ticker);
    setActiveTab("analysis");
  }

  const {
    favoriteTickers,
    loaded: favoritesLoaded,
    isFavorite,
    toggle,
    reorder,
  } = useFavorites(portfolioId);
  const { orderIndex: positionOrderIndex, reorder: reorderPositionsList } =
    usePositionOrder(portfolioId);
  const [pendingSortMode, setPendingSortMode] = useState<string | null>(null);

  /** Any drag is what enters 'custom' mode — there's no menu item for it. */
  async function enterCustomOrder() {
    if (positionSortMode !== "custom") await onSetPositionSortMode("custom");
  }

  async function chooseSortMode(mode: "gainers" | "ticker" | "pnl") {
    if (positionSortMode === "custom") {
      setPendingSortMode(mode);
      return;
    }
    await onSetPositionSortMode(mode);
  }

  async function confirmSortMode() {
    if (pendingSortMode) await onSetPositionSortMode(pendingSortMode);
    setPendingSortMode(null);
  }
  const [upcomingEarnings, setUpcomingEarnings] = useState<
    Record<string, number>
  >({});
  const [dividendInfoByTicker, setDividendInfoByTicker] = useState<
    Record<string, DividendInfo>
  >({});
  const [addingCalendarFor, setAddingCalendarFor] = useState<string | null>(
    null,
  );
  const [addingDividendCalendarFor, setAddingDividendCalendarFor] = useState<
    string | null
  >(null);
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

  // Favorites keep their own manual order (indexOf into favoriteTickers) as
  // the "custom" source; everything else uses the position_order table via
  // positionOrderIndex. Both feed the same comparator, so switching sort
  // mode behaves identically across every section.
  const favCmp = positionSortComparator(positionSortMode, (t) =>
    favoriteTickers.indexOf(t),
  );
  const restCmp = positionSortComparator(positionSortMode, positionOrderIndex);

  const favorites = summaries.filter((s) => isFavorite(s.ticker)).sort(favCmp);

  const nonFavStocks = summaries
    .filter(
      (s) =>
        !isFavorite(s.ticker) &&
        !isMutualFund(s.quoteType) &&
        !isCusip(s.ticker),
    )
    .sort(restCmp);

  const nonFavFunds = summaries
    .filter((s) => !isFavorite(s.ticker) && isMutualFund(s.quoteType))
    .sort(restCmp);

  const nonFavBonds = summaries
    .filter((s) => !isFavorite(s.ticker) && isCusip(s.ticker))
    .sort(restCmp);

  // One drag-reorder instance per section — dragging in any of them enters
  // "custom" sort mode, same as picking it would, since dragging *is* the
  // act of customizing.
  const favoriteIds = favorites.map((s) => s.ticker);
  const favDrag = useDragReorder(favoriteIds, async (next) => {
    await enterCustomOrder();
    await reorder(next);
  });
  const stockIds = nonFavStocks.map((s) => s.ticker);
  const stockDrag = useDragReorder(stockIds, async (next) => {
    await enterCustomOrder();
    await reorderPositionsList(next);
  });
  const fundIds = nonFavFunds.map((s) => s.ticker);
  const fundDrag = useDragReorder(fundIds, async (next) => {
    await enterCustomOrder();
    await reorderPositionsList(next);
  });
  const bondIds = nonFavBonds.map((s) => s.ticker);
  const bondDrag = useDragReorder(bondIds, async (next) => {
    await enterCustomOrder();
    await reorderPositionsList(next);
  });

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
  const tickerBuyTransactions = (brokerTransactions ?? []).filter(
    (t): t is BrokerTransaction & { qty: number } =>
      t.ticker === selected && t.side === "buy" && t.qty != null,
  );
  const purchaseLots = readOnly
    ? groupLotsByDate(
        tickerBuyTransactions.map((t) => ({ date: t.occurred_at, shares: t.qty })),
      )
    : groupLotsByDate(
        tickerPurchases.map((p) => ({ date: p.purchased_at, shares: p.shares })),
      );
  const selectedEarningsAt = summary
    ? upcomingEarnings[summary.ticker]
    : undefined;
  const selectedDividendInfo = selected
    ? dividendInfoByTicker[selected] ?? null
    : null;
  const selectedDividendDate = selectedDividendInfo?.dividend_date ?? null;
  const selectedDividendAmount =
    selectedDividendInfo?.dividend_amount_per_share ?? null;
  const selectedAnnualDividendRate =
    selectedDividendInfo?.annual_dividend_rate ?? null;
  const selectedPayoutFrequency =
    selectedDividendInfo?.payout_frequency ?? null;
  const selectedDividendPerShare = dividendPerShareAmount(
    selectedDividendAmount,
    selectedAnnualDividendRate,
    selectedPayoutFrequency,
  );
  const selectedDividendPayout = summary
    ? dividendPayoutTotal(
        summary.totalShares,
        selectedDividendAmount,
        selectedAnnualDividendRate,
        selectedPayoutFrequency,
      )
    : null;
  const hasSelectedDividend =
    !summary || isCusip(summary.ticker)
      ? false
      : hasTickerDividend(summary, selectedDividendInfo);
  const dividendDetails = [
    selectedDividendPayout != null
      ? `${formatDividendFrequency(selectedPayoutFrequency)} payout ${formatCurrency(selectedDividendPayout)}${selectedDividendPerShare != null ? ` (${formatCurrency(selectedDividendPerShare)}/share)` : ""}`
      : null,
    selectedDividendDate != null
      ? `${selectedDividendDate * 1000 >= Date.now() ? "Next" : "Last"} payout ${formatDate(selectedDividendDate)}`
      : null,
  ].filter(Boolean).join(" · ");
  const orderedTickers = ordered.map((s) => s.ticker);
  const earningsKey = orderedTickers.join(",");
  const dividendKey = earningsKey;

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

  useEffect(() => {
    if (orderedTickers.length === 0) {
      setDividendInfoByTicker({});
      return;
    }

    const quotableTickers = orderedTickers.filter((t) => !isCusip(t));
    const visible = new Set(quotableTickers);
    let cancelled = false;

    setDividendInfoByTicker((current) => {
      const next: Record<string, DividendInfo> = {};
      for (const ticker of quotableTickers) {
        if (current[ticker]) next[ticker] = current[ticker];
      }
      return next;
    });

    for (const ticker of quotableTickers) {
      fetchDividendInfo(ticker)
        .then((info) => {
          if (cancelled || !visible.has(ticker)) return;
          setDividendInfoByTicker((current) => {
            const next = { ...current };
            if (hasDividendInfo(info)) {
              next[ticker] = info;
            } else {
              delete next[ticker];
            }
            return next;
          });
        })
        .catch(() => {
          if (cancelled || !visible.has(ticker)) return;
          setDividendInfoByTicker((current) => {
            if (!current[ticker]) return current;
            const next = { ...current };
            delete next[ticker];
            return next;
          });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [dividendKey]);

  async function openYahooFinance(ticker: string) {
    await openUrl(
      `https://finance.yahoo.com/quote/${ticker}`,
      linkOpenMode,
      `${ticker} - Yahoo Finance`,
    );
  }

  async function moveFavorite(ticker: string, direction: "up" | "down") {
    // Based on what's actually on screen, not the raw favorites table order
    // — those only match once already in "custom" mode; a named sort mode
    // displays favorites in a different order the buttons need to respect.
    const newOrder = favorites.map((s) => s.ticker);
    const idx = newOrder.indexOf(ticker);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    await enterCustomOrder();
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

  async function handleAddDividendToCalendar(
    ticker: string,
    dividendDate: number,
  ) {
    try {
      setAddingDividendCalendarFor(ticker);
      setCalendarError(null);
      await addDividendToCalendar(ticker, dividendDate);
    } catch (e) {
      setCalendarError(`Could not open dividend calendar for ${ticker}.`);
      console.error("open_dividend_in_calendar failed", e);
    } finally {
      setAddingDividendCalendarFor(null);
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

  function formatDate(unixSeconds: number): string {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
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
      const result = await importPurchasesCsv(portfolioId);
      setDataOpStatus({
        kind: "success",
        msg: formatImportMessage(result, "purchase"),
      });
      onRefresh();
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Import failed: ${e}` });
    }
  }

  async function handleImportXlsx() {
    if (portfolioId == null) return;
    try {
      const result = await importPurchasesXlsx(portfolioId);
      setDataOpStatus({
        kind: "success",
        msg: formatImportMessage(result, "purchase"),
      });
      onRefresh();
    } catch (e) {
      setDataOpStatus({ kind: "error", msg: `Import failed: ${e}` });
    }
  }

  async function handleImportAmeriprise() {
    if (portfolioId == null) return;
    try {
      const result = await importAmeripriseCSV(portfolioId);
      setDataOpStatus({
        kind: "success",
        msg: formatImportMessage(result, "transaction", "from Ameriprise"),
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

  // Portfolio-wide dividend income, normalized to a monthly figure regardless
  // of whether any given holding actually pays monthly, quarterly or
  // annually — sums each ticker's full-year dividend, held shares included,
  // then divides by 12. Only counts tickers whose dividend data has already
  // loaded into dividendInfoByTicker; silently under-counts until it has,
  // rather than blocking on every ticker's fetch.
  let estMonthlyDividends: number | null = null;
  for (const s of summaries) {
    if (isCusip(s.ticker)) continue;
    const info = dividendInfoByTicker[s.ticker];
    if (!info) continue;
    const annual = annualDividendTotal(
      s.totalShares,
      info.dividend_amount_per_share,
      info.annual_dividend_rate,
      info.payout_frequency,
    );
    if (annual == null) continue;
    estMonthlyDividends = (estMonthlyDividends ?? 0) + annual / 12;
  }

  const dropLine = <div className="mx-2 my-0.5 h-0.5 rounded-full bg-primary" />;

  return (
    <div className="flex h-full gap-0">
      {/* Ticker selector — left panel (hidden when empty) */}
      {!isEmpty && (
        <div className="w-[15rem] border-r border-border shrink-0 flex flex-col">
          <div className="flex items-center justify-center border-b border-border bg-background shrink-0">
            <ArrowUpDown className="w-3 h-3 text-muted-foreground shrink-0 mx-1" />
            {(
              [
                { id: "gainers", label: "Gainers" },
                { id: "ticker", label: "Ticker" },
                { id: "pnl", label: "P/L" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseSortMode(id)}
                className={cn(
                  "px-1 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  positionSortMode === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            {positionSortMode === "custom" && (
              <span
                className="px-1 py-3 text-sm font-medium border-b-2 border-primary text-primary whitespace-nowrap"
                title="You've dragged rows into a custom order"
              >
                Custom
              </span>
            )}
          </div>
          {pendingSortMode && (
            <div className="px-2 py-2 border-b border-border bg-amber-500/10 flex flex-col gap-1.5">
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-tight">
                This replaces your custom order. Continue?
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={confirmSortMode}
                  className="flex-1 text-[11px] font-medium bg-amber-500 text-white rounded px-2 py-1 hover:opacity-90 transition-opacity"
                >
                  Yes, switch
                </button>
                <button
                  type="button"
                  onClick={() => setPendingSortMode(null)}
                  className="flex-1 text-[11px] font-medium bg-muted text-muted-foreground rounded px-2 py-1 hover:opacity-90 transition-opacity"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {estMonthlyDividends != null && estMonthlyDividends > 0 && (
            <div className="px-3 py-2.5 border-b border-border bg-[var(--dividend-bg)]/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Est. Monthly Dividends
              </div>
              <div className="text-sm font-semibold text-[var(--dividend-fg)]">
                {formatCurrency(estMonthlyDividends)}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
          {favorites.length > 0 && <SectionLabel label="Favorites" />}
          {favorites.map((s, idx) => {
            const favIdx = favoriteTickers.indexOf(s.ticker);
            return (
              <Fragment key={s.ticker}>
                {favDrag.showDropLine(idx) && dropLine}
                <TickerRow
                  s={s}
                  isSelected={selected === s.ticker}
                  hasUpcomingEarnings={Boolean(upcomingEarnings[s.ticker])}
                  hasDividend={hasTickerDividend(s, dividendInfoByTicker[s.ticker])}
                  isFav
                  favIdx={favIdx}
                  favCount={favoriteTickers.length}
                  onSelect={selectTicker}
                  onToggleFav={toggle}
                  onMoveFav={moveFavorite}
                  dragRowRef={(el) => {
                    if (el) favDrag.rowRefs.current.set(s.ticker, el);
                    else favDrag.rowRefs.current.delete(s.ticker);
                  }}
                  onRowPointerDown={(e) => favDrag.startRowPress(e, s.ticker)}
                  isDragging={favDrag.dragId === s.ticker}
                  suppressClickRef={favDrag.suppressClickRef}
                />
              </Fragment>
            );
          })}
          {favDrag.showDropLine(favorites.length) && dropLine}
          <CollapsibleSection label="Stocks" items={nonFavStocks}>
            {nonFavStocks.map((s, idx) => (
              <Fragment key={s.ticker}>
                {stockDrag.showDropLine(idx) && dropLine}
                <TickerRow
                  s={s}
                  isSelected={selected === s.ticker}
                  hasUpcomingEarnings={Boolean(upcomingEarnings[s.ticker])}
                  hasDividend={hasTickerDividend(s, dividendInfoByTicker[s.ticker])}
                  isFav={false}
                  favIdx={-1}
                  favCount={0}
                  onSelect={selectTicker}
                  onToggleFav={toggle}
                  onMoveFav={moveFavorite}
                  dragRowRef={(el) => {
                    if (el) stockDrag.rowRefs.current.set(s.ticker, el);
                    else stockDrag.rowRefs.current.delete(s.ticker);
                  }}
                  onRowPointerDown={(e) => stockDrag.startRowPress(e, s.ticker)}
                  isDragging={stockDrag.dragId === s.ticker}
                  suppressClickRef={stockDrag.suppressClickRef}
                />
              </Fragment>
            ))}
            {stockDrag.showDropLine(nonFavStocks.length) && dropLine}
          </CollapsibleSection>
          <CollapsibleSection label="Mutual Funds & UITs" items={nonFavFunds}>
            {nonFavFunds.map((s, idx) => (
              <Fragment key={s.ticker}>
                {fundDrag.showDropLine(idx) && dropLine}
                <TickerRow
                  s={s}
                  isSelected={selected === s.ticker}
                  hasUpcomingEarnings={Boolean(upcomingEarnings[s.ticker])}
                  hasDividend={hasTickerDividend(s, dividendInfoByTicker[s.ticker])}
                  isFav={false}
                  favIdx={-1}
                  favCount={0}
                  onSelect={selectTicker}
                  onToggleFav={toggle}
                  onMoveFav={moveFavorite}
                  dragRowRef={(el) => {
                    if (el) fundDrag.rowRefs.current.set(s.ticker, el);
                    else fundDrag.rowRefs.current.delete(s.ticker);
                  }}
                  onRowPointerDown={(e) => fundDrag.startRowPress(e, s.ticker)}
                  isDragging={fundDrag.dragId === s.ticker}
                  suppressClickRef={fundDrag.suppressClickRef}
                />
              </Fragment>
            ))}
            {fundDrag.showDropLine(nonFavFunds.length) && dropLine}
          </CollapsibleSection>
          <CollapsibleSection label="Bonds & CDs" items={nonFavBonds}>
            {nonFavBonds.map((s, idx) => (
              <Fragment key={s.ticker}>
                {bondDrag.showDropLine(idx) && dropLine}
                <TickerRow
                  s={s}
                  isSelected={selected === s.ticker}
                  hasUpcomingEarnings={false}
                  hasDividend={false}
                  isFav={false}
                  favIdx={-1}
                  favCount={0}
                  onSelect={selectTicker}
                  onToggleFav={toggle}
                  onMoveFav={moveFavorite}
                  dragRowRef={(el) => {
                    if (el) bondDrag.rowRefs.current.set(s.ticker, el);
                    else bondDrag.rowRefs.current.delete(s.ticker);
                  }}
                  onRowPointerDown={(e) => bondDrag.startRowPress(e, s.ticker)}
                  isDragging={bondDrag.dragId === s.ticker}
                  suppressClickRef={bondDrag.suppressClickRef}
                />
              </Fragment>
            ))}
            {bondDrag.showDropLine(nonFavBonds.length) && dropLine}
          </CollapsibleSection>
          </div>
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
            onClick={() => setActiveTab("performance")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "performance"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Trophy className="w-4 h-4" />
            Performance
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
          {ordersAccountId != null && (
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === "orders"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <ClipboardList className="w-4 h-4" />
              Orders
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setActiveTab("cash")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === "cash"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <PiggyBank className="w-4 h-4" />
              Cash
            </button>
          )}
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
        {activeTab === "orders" && ordersAccountId != null ? (
          <BrokerOrdersView brokerAccountId={ordersAccountId} />
        ) : activeTab === "performance" ? (
          isEmpty ? (
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
            <PortfolioRankView
              summaries={summaries}
              onSelectTicker={(ticker) => {
                setSelectedTicker(ticker);
                setActiveTab("analysis");
              }}
            />
          )
        ) : activeTab === "settings" ? (
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

              {/* A linked portfolio mirrors the brokerage. Import would write
                  rows that never display (holdings come from broker_positions,
                  not purchases), and export would emit an empty file — both
                  read as data loss. Show what governs it instead. */}
              {readOnly ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-lg border border-border bg-card p-4 flex gap-3">
                    <Lock className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground mb-0.5">
                        Managed by your brokerage
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Holdings, prices and profit for this portfolio come
                        directly from the broker, so purchases cannot be added,
                        imported or edited here. Your manual portfolios are
                        unaffected — nothing from this account is mixed into
                        them.
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                        To stop mirroring it, disconnect it under{" "}
                        <span className="text-foreground font-medium">
                          Settings → Brokerage Accounts
                        </span>
                        . That also removes the stored keys from this device.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
              <div className="flex flex-col gap-4">
                {lastImportAt != null && (
                  <p className="text-xs text-muted-foreground">
                    Last spreadsheet import:{" "}
                    <span className="text-foreground font-medium">
                      {formatDateTime(lastImportAt)}
                    </span>
                  </p>
                )}
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
                    Import buys, sells, dividends (reinvested or paid out in
                    cash) and fees directly from an Ameriprise account
                    activity CSV export. Pending (unsettled) rows are named in
                    the result but not imported.
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

              )}

              {/* Status feedback */}
              {!readOnly && dataOpStatus && (
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

              {/* Danger Zone — manual portfolios only. A linked one is removed
                  by disconnecting, which also clears its credentials. */}
              {!readOnly && (
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
              )}
            </div>
          </div>
        ) : activeTab === "purchases" ? (
          readOnly ? (
            <BrokerTransactionsTable transactions={brokerTransactions ?? []} />
          ) : (
            <PurchasesTable
              purchases={purchases}
              sales={sales}
              stocks={stocks}
              onAdd={onAdd}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAddSale={onAddSale}
              onUpdateSale={onUpdateSale}
              onDeleteSale={onDeleteSale}
            />
          )
        ) : activeTab === "cash" ? (
          <CashEventsTable
            cashEvents={cashEvents}
            tickers={[...new Set(purchases.map((p) => p.ticker))].sort()}
            onAdd={onAddCashEvent}
            onUpdate={onUpdateCashEvent}
            onDelete={onDeleteCashEvent}
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
                  {hasSelectedDividend && (
                    <div className="flex items-center gap-1.5">
                      <span
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--dividend-bg)] text-[var(--dividend-fg)] font-medium"
                        title="Dividend information"
                      >
                        <PiggyBank className="w-3.5 h-3.5" />
                        {dividendDetails || "Dividend"}
                      </span>
                      {selectedDividendDate != null && (
                        <button
                          type="button"
                          onClick={() =>
                            handleAddDividendToCalendar(
                              summary.ticker,
                              selectedDividendDate,
                            )
                          }
                          disabled={
                            addingDividendCalendarFor === summary.ticker
                          }
                          className="btn-secondary text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                          title="Add dividend payout date to your calendar"
                        >
                          <CalendarDays className="w-3.5 h-3.5" />
                          {addingDividendCalendarFor === summary.ticker
                            ? "Opening Calendar..."
                            : "Add Dividend to Calendar"}
                        </button>
                      )}
                    </div>
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
                        extra={<PurchaseLotsBadge lots={purchaseLots} />}
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
                        extra={<ExtendedHoursTag stock={selectedStock} labelOnly />}
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
                      {readOnly
                        ? tickerBuyTransactions.map((t) => (
                            <tr
                              key={t.id}
                              className="border-b border-border/50"
                            >
                              <td className="px-3 py-2">{t.occurred_at}</td>
                              <td className="px-3 py-2 text-right">
                                {formatShares(t.qty)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(t.price)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatCurrency(
                                  t.price != null ? t.qty * t.price : null,
                                )}
                              </td>
                            </tr>
                          ))
                        : tickerPurchases.map((p) => (
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
                  {readOnly && tickerBuyTransactions.length === 0 && (
                    <p className="text-sm text-muted-foreground px-3 py-4">
                      No dated buy transactions yet. Sync this connection from
                      Settings to pull them in.
                    </p>
                  )}
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

function formatImportMessage(
  { imported, skipped, unhandled }: ImportResult,
  noun: string,
  suffix?: string,
): string {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const tail = suffix ? ` ${suffix}` : "";

  let msg: string;
  if (imported === 0 && skipped > 0) {
    msg = `Nothing new to import — ${plural(skipped)} already in the system.`;
  } else if (skipped > 0) {
    msg = `Imported ${plural(imported)}${tail} (${skipped} already in the system, skipped).`;
  } else {
    msg = `Imported ${plural(imported)}${tail}.`;
  }

  if (unhandled && Object.keys(unhandled).length > 0) {
    const parts = Object.entries(unhandled).map(
      ([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`,
    );
    msg += ` Not imported — this app doesn't track these yet: ${parts.join(", ")}.`;
  }

  return msg;
}

function groupLotsByDate(
  lots: { date: string; shares: number }[],
): { date: string; shares: number }[] {
  const byDate = new Map<string, number>();
  for (const l of lots) {
    byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.shares);
  }
  return Array.from(byDate.entries())
    .map(([date, shares]) => ({ date, shares }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatPurchaseDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function PurchaseLotsBadge({
  lots,
}: {
  lots: { date: string; shares: number }[];
}) {
  if (lots.length === 0) return null;

  const label =
    lots.length === 1 ? formatPurchaseDate(lots[0].date) : `${lots.length} purchases`;

  return (
    <RadixTooltip.Provider delayDuration={150}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-help"
          >
            <Layers className="w-3 h-3" />
            {label}
          </button>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            sideOffset={8}
            className="z-50 rounded-lg bg-foreground px-3 py-2.5 text-xs font-medium text-background shadow-lg border border-foreground/20 backdrop-blur-sm"
          >
            <div className="flex flex-col gap-1">
              {lots.map((lot) => (
                <div
                  key={lot.date}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="opacity-80">
                    {formatPurchaseDate(lot.date)}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatShares(lot.shares)} sh
                  </span>
                </div>
              ))}
            </div>
            <RadixTooltip.Arrow className="fill-foreground" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
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

function hasDividendInfo(info: DividendInfo | null | undefined): boolean {
  return Boolean(
    info &&
      (info.dividend_date != null ||
        info.dividend_amount_per_share != null ||
        info.annual_dividend_rate != null),
  );
}

function hasTickerDividend(
  s: TickerSummary,
  info: DividendInfo | null | undefined,
): boolean {
  return Boolean(
    !isCusip(s.ticker) &&
      ((s.dividendYield != null && s.dividendYield > 0) ||
        hasDividendInfo(info)),
  );
}

function paymentsPerYear(frequency: string | null | undefined): number | null {
  switch (frequency) {
    case "monthly":
      return 12;
    case "bimonthly":
      return 6;
    case "quarterly":
      return 4;
    case "semiannual":
      return 2;
    case "annual":
      return 1;
    default:
      return null;
  }
}

function dividendPayoutTotal(
  shares: number,
  amountPerShare: number | null | undefined,
  annualRate: number | null | undefined,
  frequency: string | null | undefined,
): number | null {
  const perPeriodAmount =
    amountPerShare ??
    (annualRate != null
      ? annualRate / (paymentsPerYear(frequency) ?? 1)
      : null);

  return perPeriodAmount != null ? shares * perPeriodAmount : null;
}

/** Full-year dividend $ for the shares held, regardless of how often it's
 *  actually paid out. An unknown frequency is treated as one payment a
 *  year, matching the convention `dividendPayoutTotal` already uses. */
function annualDividendTotal(
  shares: number,
  amountPerShare: number | null | undefined,
  annualRate: number | null | undefined,
  frequency: string | null | undefined,
): number | null {
  if (annualRate != null) return shares * annualRate;
  if (amountPerShare != null) {
    return shares * amountPerShare * (paymentsPerYear(frequency) ?? 1);
  }
  return null;
}

function dividendPerShareAmount(
  amountPerShare: number | null | undefined,
  annualRate: number | null | undefined,
  frequency: string | null | undefined,
): number | null {
  return (
    amountPerShare ??
    (annualRate != null
      ? annualRate / (paymentsPerYear(frequency) ?? 1)
      : null)
  );
}

function formatDividendFrequency(frequency: string | null | undefined): string {
  switch (frequency) {
    case "monthly":
      return "Monthly";
    case "bimonthly":
      return "Bimonthly";
    case "quarterly":
      return "Quarterly";
    case "semiannual":
      return "Semiannual";
    case "annual":
      return "Annual";
    default:
      return "Dividend";
  }
}

function TickerRow({
  s,
  isSelected,
  hasUpcomingEarnings,
  hasDividend,
  isFav,
  favIdx,
  favCount,
  onSelect,
  onToggleFav,
  onMoveFav,
  dragRowRef,
  onRowPointerDown,
  isDragging,
  suppressClickRef,
}: {
  s: TickerSummary;
  isSelected: boolean;
  hasUpcomingEarnings: boolean;
  hasDividend: boolean;
  isFav: boolean;
  favIdx: number;
  favCount: number;
  onSelect: (ticker: string) => void;
  onToggleFav: (ticker: string) => void;
  onMoveFav: (ticker: string, dir: "up" | "down") => void;
  /** Drag-to-reorder — all four optional together, wired by whichever
   *  section's useDragReorder instance renders this row. */
  dragRowRef?: (el: HTMLDivElement | null) => void;
  onRowPointerDown?: (e: React.PointerEvent) => void;
  isDragging?: boolean;
  suppressClickRef?: React.MutableRefObject<boolean>;
}) {
  return (
    <div
      ref={dragRowRef}
      onPointerDown={onRowPointerDown}
      onClickCapture={(e) => {
        if (suppressClickRef?.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      className={cn(
        "flex items-center border-b border-border transition-colors group",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-muted",
        isDragging && "opacity-40",
      )}
    >
      {/* Drag handle */}
      <span
        className={cn(
          "pl-1 pr-0.5 py-3 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity",
          isSelected ? "text-primary-foreground/50" : "text-muted-foreground/50",
        )}
        title="Drag to reorder"
      >
        <GripVertical className="w-3 h-3" />
      </span>

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
          {hasDividend && (
            <PiggyBank
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                isSelected
                  ? "text-primary-foreground/85"
                  : "text-[var(--dividend-fg)]",
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
