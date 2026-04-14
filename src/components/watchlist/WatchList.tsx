import { useState, useEffect, useRef } from "react";
import type { WatchlistItem, Stock, TickerSearchResult } from "../../types";
import { formatCurrency, cn } from "../../lib/utils";
import { searchTickers } from "../../lib/db";
import { PurchaseDialog } from "../portfolio/PurchaseDialog";
import { Plus, Trash2, ShoppingCart, Search, Loader2 } from "lucide-react";

interface WatchListProps {
  items: WatchlistItem[];
  stocks: Stock[];
  onAdd: (ticker: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onPurchase: (ticker: string, shares: number, price: number, date: string) => Promise<void>;
}

export function WatchList({ items, stocks, onAdd, onRemove, onPurchase }: WatchListProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [adding, setAdding] = useState(false);
  const [purchaseTicker, setPurchaseTicker] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const now = Math.floor(Date.now() / 1000);
  const STALE_THRESHOLD = 3600;

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
      await onAdd(symbol);
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
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Ticker</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Price</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const stock = stockMap.get(item.ticker);
                const currentPrice = stock?.last_price ?? null;
                const isStale =
                  !stock?.last_fetched_at || now - stock.last_fetched_at > STALE_THRESHOLD;

                return (
                  <tr
                    key={item.id}
                    className="border-b border-border hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-semibold text-foreground">{item.ticker}</td>
                    <td className="px-4 py-2.5 text-foreground">
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
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setPurchaseTicker(item.ticker)}
                          className="p-1.5 rounded hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition-colors"
                          title="Add Purchase"
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
