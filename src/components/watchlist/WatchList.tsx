import { Fragment, useState, useEffect, useRef } from "react";
import type { WatchlistItem, Stock, TickerSearchResult, LinkOpenMode } from "../../types";
import { formatCurrency, formatPercent, pnlColor, cn } from "../../lib/utils";
import { searchTickers } from "../../lib/db";
import { openUrl } from "../../lib/openUrl";
import { PurchaseDialog } from "../portfolio/PurchaseDialog";
import { SparkLine } from "./SparkLine";
import { TickerLogo } from "../shared/TickerLogo";
import { useWatchlistTargets } from "../../hooks/useWatchlistTargets";
import { useWatchlistNotes } from "../../hooks/useWatchlistNotes";
import {
  Plus, Trash2, ShoppingCart, Search, Loader2,
  TrendingUp, TrendingDown, Minus,
  Bell, MessageSquare, MessageSquareDiff, ExternalLink,
} from "lucide-react";

interface WatchListProps {
  items: WatchlistItem[];
  stocks: Stock[];
  linkOpenMode: LinkOpenMode;
  onAdd: (ticker: string, watchPrice: number | null) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onPurchase: (ticker: string, shares: number, price: number, date: string) => Promise<void>;
}

export function WatchList({ items, stocks, linkOpenMode, onAdd, onRemove, onPurchase }: WatchListProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [adding, setAdding] = useState(false);
  const [purchaseTicker, setPurchaseTicker] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // Target price editing state: ticker -> draft string while editing
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState("");
  // Note expansion state: set of tickers with open note areas
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { getTarget, setTarget, isTriggered } = useWatchlistTargets();
  const { getNote, setNote, hasNote } = useWatchlistNotes();

  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const now = Math.floor(Date.now() / 1000);
  const STALE_THRESHOLD = 3600;

  function sinceAddedPct(item: WatchlistItem): number | null {
    const stock = stockMap.get(item.ticker);
    const currentPrice = stock?.last_price ?? null;
    const watchPrice = item.watch_price;
    if (watchPrice == null || currentPrice == null || watchPrice <= 0) return null;
    return ((currentPrice - watchPrice) / watchPrice) * 100;
  }

  function liveRank(item: WatchlistItem): number {
    const stock = stockMap.get(item.ticker);
    return stock?.daily_change_pct ?? sinceAddedPct(item) ?? Number.NEGATIVE_INFINITY;
  }

  const rankedItems = [...items].sort((a, b) => {
    const rankDelta = liveRank(b) - liveRank(a);
    if (rankDelta !== 0) return rankDelta;
    return a.ticker.localeCompare(b.ticker);
  });

  function formatAddedDate(unixSeconds: number): string {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(unixSeconds * 1000));
  }

  async function openTickerPage(ticker: string) {
    await openUrl(`https://finance.yahoo.com/quote/${ticker}`, linkOpenMode, `${ticker} - Yahoo Finance`);
  }

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchTickers(trimmed);
        setResults(res);
        setShowDropdown(res.length > 0);
        setSelectedIndex(-1);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function addTicker(symbol: string) {
    setAdding(true);
    try {
      // Capture the current price at the moment of adding (upgrade 5)
      const watchPrice = stockMap.get(symbol.toUpperCase())?.last_price ?? null;
      await onAdd(symbol, watchPrice);
      setQuery("");
      setResults([]);
      setShowDropdown(false);
    } finally {
      setAdding(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIndex >= 0 && selectedIndex < results.length) {
      await addTicker(results[selectedIndex].symbol);
    } else {
      const t = query.trim().toUpperCase();
      if (!t) return;
      await addTicker(t);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search & add ticker */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-6 py-3 border-b border-border"
      >
        <div className="relative flex-1 max-w-md" ref={dropdownRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              className="w-full rounded-md border border-border pl-9 pr-8 py-1.5 text-sm bg-background text-foreground outline-none focus:border-primary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setShowDropdown(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search by ticker or company name…"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
            )}
          </div>

          {showDropdown && results.length > 0 && (
            <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
              {results.map((r, i) => (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => addTicker(r.symbol)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors",
                    i === selectedIndex
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold">{r.symbol}</span>
                    {r.name && (
                      <span className={cn("text-xs truncate", i === selectedIndex ? "opacity-80" : "text-muted-foreground")}>
                        {r.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.exchange && (
                      <span className={cn("text-xs", i === selectedIndex ? "opacity-70" : "text-muted-foreground")}>
                        {r.exchange}
                      </span>
                    )}
                    {r.type_disp && (
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", i === selectedIndex ? "bg-primary-foreground/20" : "bg-muted")}>
                        {r.type_disp}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={adding || !query.trim()}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add to Watchlist
        </button>
      </form>

      {/* Watchlist table */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">Your watchlist is empty.</p>
            <p className="text-xs">Add tickers above to start watching.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Ticker</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Price</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">1Y Target</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Today</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">1M Trend</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Added</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Since Add %</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Target</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rankedItems.map((item) => {
                const stock = stockMap.get(item.ticker);
                const currentPrice = stock?.last_price ?? null;
                const targetMeanPrice = stock?.target_mean_price ?? null;
                const dailyChangePct = stock?.daily_change_pct ?? null;
                const isStale = !stock?.last_fetched_at || now - stock.last_fetched_at > STALE_THRESHOLD;
                const triggered = isTriggered(item.ticker, currentPrice);
                const target = getTarget(item.ticker);
                const note = getNote(item.ticker);
                const noteOpen = openNotes.has(item.ticker);

                // Upgrade 5: watch-since calculation
                const watchPrice = item.watch_price;
                const sinceChangePct = sinceAddedPct(item);

                const targetUpsidePct =
                  targetMeanPrice != null && currentPrice != null && currentPrice > 0
                    ? ((targetMeanPrice - currentPrice) / currentPrice) * 100
                    : null;

                // Upgrade 1: daily change icon
                const DailyIcon =
                  dailyChangePct == null ? null
                  : dailyChangePct > 0 ? TrendingUp
                  : dailyChangePct < 0 ? TrendingDown
                  : Minus;

                return (
                  <Fragment key={item.id}>
                    <tr
                      className={cn(
                        "border-b border-border transition-colors",
                        triggered
                          ? "bg-amber-500/10 hover:bg-amber-500/15"
                          : "hover:bg-muted/30"
                      )}
                    >
                      {/* Ticker */}
                      <td className="px-4 py-2.5 font-semibold text-foreground">
                        <div className="flex items-center gap-2">
                          <TickerLogo ticker={item.ticker} />
                          <button
                            type="button"
                            onClick={() => openTickerPage(item.ticker)}
                            className="group flex items-center gap-1.5 text-left transition-colors hover:text-primary"
                            title={`Open ${item.ticker} on Yahoo Finance`}
                          >
                            {triggered && <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                            {item.ticker}
                            <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        </div>
                      </td>

                      {/* Name */}
                      <td className="px-4 py-2.5 text-foreground max-w-[220px] truncate">
                        {stock?.name ?? <span className="text-muted-foreground">—</span>}
                      </td>

                      {/* Price (Upgrade 1 stale indicator kept) */}
                      <td className="px-4 py-2.5 text-right text-foreground">
                        <span className={cn(isStale && currentPrice != null ? "opacity-50" : "")}>
                          {currentPrice != null ? formatCurrency(currentPrice) : "—"}
                        </span>
                        {isStale && currentPrice != null && (
                          <span className="ml-1 text-xs text-amber-500">stale</span>
                        )}
                      </td>

                      {/* Analyst 1-year target estimate */}
                      <td className="px-4 py-2.5 text-right">
                        {targetMeanPrice != null ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-foreground">{formatCurrency(targetMeanPrice)}</span>
                            {targetUpsidePct != null && (
                              <span className={cn("text-xs font-medium", pnlColor(targetUpsidePct))}>
                                {formatPercent(targetUpsidePct)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Upgrade 1: daily change */}
                      <td className="px-4 py-2.5 text-right">
                        {DailyIcon && dailyChangePct != null ? (
                          <span className={cn("flex items-center justify-end gap-1", pnlColor(dailyChangePct))}>
                            <DailyIcon className="w-3.5 h-3.5" />
                            {formatPercent(dailyChangePct)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Upgrade 3: sparkline */}
                      <td className="px-4 py-2.5">
                        <div className="flex justify-center">
                          <SparkLine ticker={item.ticker} quoteType={stock?.quote_type} />
                        </div>
                      </td>

                      {/* Added date */}
                      <td className="px-4 py-2.5 text-right text-foreground">
                        <span className="text-xs">{formatAddedDate(item.created_at)}</span>
                      </td>

                      {/* Upgrade 5: since-added return */}
                      <td className="px-4 py-2.5 text-right">
                        {watchPrice != null && currentPrice != null ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-xs text-muted-foreground">{formatCurrency(watchPrice)}</span>
                            <span className={cn("font-medium", pnlColor(sinceChangePct))}>
                              {formatPercent(sinceChangePct)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Tracking from next quote</span>
                        )}
                      </td>

                      {/* Upgrade 2: target price */}
                      <td className="px-4 py-2.5 text-right">
                        {editingTarget === item.ticker ? (
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            min="0"
                            value={targetDraft}
                            onChange={(e) => setTargetDraft(e.target.value)}
                            onBlur={() => {
                              const val = parseFloat(targetDraft);
                              setTarget(item.ticker, isNaN(val) || val <= 0 ? null : val);
                              setEditingTarget(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") { setEditingTarget(null); }
                            }}
                            className="w-24 text-right rounded border border-primary bg-background px-2 py-0.5 text-sm outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => {
                              setEditingTarget(item.ticker);
                              setTargetDraft(target != null ? String(target) : "");
                            }}
                            className={cn(
                              "text-sm rounded px-1.5 py-0.5 transition-colors",
                              target != null
                                ? triggered
                                  ? "text-amber-500 font-semibold"
                                  : "text-primary"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Click to set buy target"
                          >
                            {target != null ? formatCurrency(target) : "Set target"}
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          {/* Upgrade 4: notes toggle */}
                          <button
                            onClick={() => setOpenNotes((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.ticker)) next.delete(item.ticker);
                              else next.add(item.ticker);
                              return next;
                            })}
                            className={cn(
                              "p-1.5 rounded transition-colors",
                              hasNote(item.ticker)
                                ? "text-primary hover:bg-primary/10"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                            title={noteOpen ? "Hide notes" : "Add / view notes"}
                          >
                            {hasNote(item.ticker)
                              ? <MessageSquare className="w-3.5 h-3.5" />
                              : <MessageSquareDiff className="w-3.5 h-3.5" />
                            }
                          </button>
                          <button
                            onClick={() => setPurchaseTicker(item.ticker)}
                            className="p-1.5 rounded hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition-colors"
                            title="Buy — add to portfolio"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(item.id)}
                            className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                            title="Remove from Watchlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Upgrade 4: inline note row */}
                    {noteOpen && (
                      <tr key={`${item.id}-note`} className="border-b border-border bg-muted/20">
                        <td colSpan={10} className="px-6 py-2">
                          <textarea
                            autoFocus
                            rows={2}
                            value={note}
                            onChange={(e) => setNote(item.ticker, e.target.value)}
                            placeholder="Add your investment thesis, price targets, catalysts to watch…"
                            className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Purchase dialog triggered from watchlist */}
      <PurchaseDialog
        open={purchaseTicker != null}
        onClose={() => setPurchaseTicker(null)}
        onSave={async (t, shares, price, date) => {
          await onPurchase(t, shares, price, date);
          setPurchaseTicker(null);
        }}
        defaultTicker={purchaseTicker ?? undefined}
      />

      {/* Delete confirmation */}
      {confirmDelete != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-80">
            <p className="text-sm text-foreground mb-4">
              Remove this ticker from your watchlist?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onRemove(confirmDelete);
                  setConfirmDelete(null);
                }}
                className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
