import { Fragment, useState, useEffect, useRef } from "react";
import type { WatchlistItem, Stock, TickerSearchResult, LinkOpenMode, Watchlist } from "../../types";
import { formatCurrency, formatPercent, pnlColor, cn } from "../../lib/utils";
import { searchTickers, exportAllWatchlistsBackup, importAllWatchlistsBackup } from "../../lib/db";
import { openUrl } from "../../lib/openUrl";
import { PurchaseDialog } from "../portfolio/PurchaseDialog";
import { SparkLine } from "./SparkLine";
import { TickerLogo } from "../shared/TickerLogo";
import { StockDetailModal } from "./StockDetailModal";
import { useWatchlistTargets } from "../../hooks/useWatchlistTargets";
import { useWatchlistNotes } from "../../hooks/useWatchlistNotes";
import {
  Plus, Trash2, ShoppingCart, Search, Loader2,
  TrendingUp, TrendingDown, Minus,
  Bell, MessageSquare, MessageSquareDiff, ExternalLink,
  Settings, Download, Upload, CheckCircle, AlertCircle, Check, X, Pencil,
} from "lucide-react";

type WatchListTab = "list" | "settings";

interface WatchListProps {
  watchlists: Watchlist[];
  activeWatchlistId: number | null;
  onSelectWatchlist: (id: number) => void;
  onCreateWatchlist: (name: string) => Promise<number>;
  onRenameWatchlist: (id: number, name: string) => Promise<void>;
  onDeleteWatchlist: (id: number) => Promise<void>;
  onReloadWatchlists: () => Promise<void>;
  items: WatchlistItem[];
  stocks: Stock[];
  linkOpenMode: LinkOpenMode;
  onAdd: (ticker: string, watchPrice: number | null) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onReload: () => Promise<void>;
  onPurchase: (ticker: string, shares: number, price: number, date: string) => Promise<void>;
}

export function WatchList({
  watchlists,
  activeWatchlistId,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onReloadWatchlists,
  items,
  stocks,
  linkOpenMode,
  onAdd,
  onRemove,
  onReload,
  onPurchase,
}: WatchListProps) {
  const [activeTab, setActiveTab] = useState<WatchListTab>("list");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [adding, setAdding] = useState(false);
  const [purchaseTicker, setPurchaseTicker] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [detailTicker, setDetailTicker] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState("");
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // New watchlist creation inline in tab bar
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");

  // Rename in settings
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete in settings
  const [confirmDeleteWatchlist, setConfirmDeleteWatchlist] = useState(false);
  const [deletingWatchlist, setDeletingWatchlist] = useState(false);

  // Backup status
  const [backupStatus, setBackupStatus] = useState<{ kind: "success" | "error"; msg: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const { getTarget, setTarget, isTriggered, refresh: refreshTargets } = useWatchlistTargets(activeWatchlistId);
  const { getNote, setNote, hasNote, refresh: refreshNotes } = useWatchlistNotes(activeWatchlistId);

  // Sync rename draft when watchlist changes or settings opens
  useEffect(() => {
    const active = watchlists.find((w) => w.id === activeWatchlistId);
    setRenameDraft(active?.name ?? "");
    setConfirmDeleteWatchlist(false);
    setBackupStatus(null);
  }, [activeWatchlistId, watchlists]);

  // Reset settings state when switching tabs
  useEffect(() => {
    if (activeTab === "list") {
      setConfirmDeleteWatchlist(false);
      setBackupStatus(null);
    }
  }, [activeTab]);

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

  async function commitNewWatchlist() {
    const trimmed = newName.trim();
    if (trimmed) {
      const id = await onCreateWatchlist(trimmed);
      onSelectWatchlist(id);
    }
    setCreatingNew(false);
    setNewName("");
  }

  async function handleRename() {
    const trimmed = renameDraft.trim();
    if (!trimmed || activeWatchlistId == null) return;
    setRenaming(true);
    try {
      await onRenameWatchlist(activeWatchlistId, trimmed);
    } finally {
      setRenaming(false);
    }
  }

  async function handleDeleteWatchlist() {
    if (activeWatchlistId == null) return;
    setDeletingWatchlist(true);
    try {
      await onDeleteWatchlist(activeWatchlistId);
      setActiveTab("list");
    } catch {
      setDeletingWatchlist(false);
      setConfirmDeleteWatchlist(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setBackupStatus(null);
    try {
      const ok = await exportAllWatchlistsBackup();
      if (ok) setBackupStatus({ kind: "success", msg: "All watchlists exported successfully." });
    } catch (e) {
      setBackupStatus({ kind: "error", msg: `Export failed: ${e}` });
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setBackupStatus(null);
    try {
      const result = await importAllWatchlistsBackup();
      if (result == null) return;
      await onReloadWatchlists();
      await onReload();
      refreshTargets();
      refreshNotes();
      setBackupStatus({
        kind: "success",
        msg: `Restored ${result.watchlistsImported} watchlist${result.watchlistsImported === 1 ? "" : "s"}, ${result.tickersImported} new ticker${result.tickersImported === 1 ? "" : "s"}.`,
      });
    } catch (e) {
      setBackupStatus({ kind: "error", msg: `Import failed: ${e}` });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Watchlist tab bar */}
      <div className="flex items-center border-b border-border bg-background shrink-0 overflow-x-auto">
        {watchlists.map((wl) => (
          <button
            key={wl.id}
            type="button"
            onClick={() => { onSelectWatchlist(wl.id); setActiveTab("list"); }}
            className={cn(
              "shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeWatchlistId === wl.id && activeTab === "list"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {wl.name}
          </button>
        ))}

        {/* Inline new watchlist input or + button */}
        {creatingNew ? (
          <div className="flex items-center gap-1 px-2 shrink-0">
            <input
              autoFocus
              placeholder="Watchlist name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewWatchlist();
                if (e.key === "Escape") { setCreatingNew(false); setNewName(""); }
              }}
              className="w-32 bg-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
            <button onClick={commitNewWatchlist} className="text-positive hover:opacity-80 shrink-0" title="Create">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setCreatingNew(false); setNewName(""); }} className="text-muted-foreground hover:opacity-80 shrink-0" title="Cancel">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingNew(true)}
            title="New watchlist"
            className="shrink-0 px-3 py-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        {/* Settings gear — far right */}
        <button
          type="button"
          onClick={() => setActiveTab(activeTab === "settings" ? "list" : "settings")}
          title={activeTab === "settings" ? "Back to Watch List" : "Watchlist Settings"}
          className={cn(
            "ml-auto shrink-0 p-2 mr-1 rounded-md transition-colors",
            activeTab === "settings"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {activeTab === "settings" ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-lg flex flex-col gap-8">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Watchlist Settings</h2>
              <p className="text-xs text-muted-foreground">
                Manage this watchlist or back up all watchlists.
              </p>
            </div>

            {/* Rename */}
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">Rename</h3>
              <div className="flex gap-2">
                <input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
                  className="flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Watchlist name…"
                />
                <button
                  type="button"
                  onClick={handleRename}
                  disabled={renaming || !renameDraft.trim()}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil className="w-4 h-4" />
                  {renaming ? "Saving…" : "Rename"}
                </button>
              </div>
            </div>

            {/* Backup */}
            <div className="flex flex-col gap-4 border-t border-border pt-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-0.5">Backup All Watchlists</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Export every watchlist — tickers, buy targets, and notes — to a single JSON file.
                </p>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || importing}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  {exporting ? "Exporting…" : "Export Backup"}
                </button>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-foreground mb-0.5">Restore from Backup</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Import a previously exported backup. Existing watchlists are matched by name and merged —
                  new tickers are added and missing targets/notes are filled in, but nothing is overwritten.
                </p>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={exporting || importing}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload className="w-4 h-4" />
                  {importing ? "Importing…" : "Import Backup"}
                </button>
              </div>

              {backupStatus && (
                <div
                  className={cn(
                    "text-sm px-4 py-3 rounded-lg border flex items-center justify-between gap-3",
                    backupStatus.kind === "success"
                      ? "bg-positive/10 border-positive/30 text-positive"
                      : "bg-negative/10 border-negative/30 text-negative"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {backupStatus.kind === "success"
                      ? <CheckCircle className="w-4 h-4 shrink-0" />
                      : <AlertCircle className="w-4 h-4 shrink-0" />
                    }
                    <span>{backupStatus.msg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBackupStatus(null)}
                    className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Danger zone */}
            <div className="border-t border-red-500/20 pt-6 flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-0.5">Danger Zone</h3>
                <p className="text-xs text-muted-foreground">These actions are permanent and cannot be undone.</p>
              </div>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Delete this watchlist</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently removes this watchlist and all its tickers. A new watchlist is created automatically if this is the last one.
                  </p>
                </div>
                {!confirmDeleteWatchlist ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteWatchlist(true)}
                    disabled={deletingWatchlist}
                    className="self-start flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Watchlist
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-red-600 font-medium">Are you sure?</span>
                    <button
                      type="button"
                      onClick={handleDeleteWatchlist}
                      disabled={deletingWatchlist}
                      className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      {deletingWatchlist ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteWatchlist(false)}
                      disabled={deletingWatchlist}
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
      ) : (
        <>
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
                <p className="text-sm">This watchlist is empty.</p>
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

                    const watchPrice = item.watch_price;
                    const sinceChangePct = sinceAddedPct(item);

                    const targetUpsidePct =
                      targetMeanPrice != null && currentPrice != null && currentPrice > 0
                        ? ((targetMeanPrice - currentPrice) / currentPrice) * 100
                        : null;

                    const DailyIcon =
                      dailyChangePct == null ? null
                      : dailyChangePct > 0 ? TrendingUp
                      : dailyChangePct < 0 ? TrendingDown
                      : Minus;

                    return (
                      <Fragment key={item.id}>
                        <tr
                          className={cn(
                            "border-b border-border transition-colors cursor-pointer",
                            triggered
                              ? "bg-amber-500/10 hover:bg-amber-500/15"
                              : "hover:bg-muted/30"
                          )}
                          onDoubleClick={() => setDetailTicker(item.ticker)}
                          title="Double-click for detailed analysis"
                        >
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
                          <td className="px-4 py-2.5 text-foreground max-w-[220px] truncate">
                            {stock?.name ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-foreground">
                            <span className={cn(isStale && currentPrice != null ? "opacity-50" : "")}>
                              {currentPrice != null ? formatCurrency(currentPrice) : "—"}
                            </span>
                            {isStale && currentPrice != null && (
                              <span className="ml-1 text-xs text-amber-500">stale</span>
                            )}
                          </td>
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
                          <td className="px-4 py-2.5">
                            <div className="flex justify-center">
                              <SparkLine ticker={item.ticker} quoteType={stock?.quote_type} />
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-foreground">
                            <span className="text-xs">{formatAddedDate(item.created_at)}</span>
                          </td>
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
                                  if (e.key === "Escape") setEditingTarget(null);
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
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-center gap-1">
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

          {/* Stock detail modal */}
          {detailTicker != null && (
            <StockDetailModal
              ticker={detailTicker}
              stock={stockMap.get(detailTicker)}
              watchPrice={items.find((i) => i.ticker === detailTicker)?.watch_price ?? null}
              linkOpenMode={linkOpenMode}
              onClose={() => setDetailTicker(null)}
              onBuy={(ticker) => {
                setDetailTicker(null);
                setPurchaseTicker(ticker);
              }}
            />
          )}

          {/* Purchase dialog */}
          <PurchaseDialog
            open={purchaseTicker != null}
            onClose={() => setPurchaseTicker(null)}
            onSave={async (t, shares, price, date) => {
              await onPurchase(t, shares, price, date);
              setPurchaseTicker(null);
            }}
            defaultTicker={purchaseTicker ?? undefined}
          />

          {/* Delete item confirmation */}
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
        </>
      )}
    </div>
  );
}
