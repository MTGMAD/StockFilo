import { useEffect, useMemo, useState } from "react";
import type { Watchlist, AlertDirection } from "../../types";
import {
  type WatchlistItemFull,
  getCachedStocks,
  setWatchlistAlert,
  acknowledgeAlert,
} from "../../lib/db";
import { formatCurrency, cn } from "../../lib/utils";
import { isAlertPending } from "../../hooks/useAlertsMonitor";
import {
  Bell,
  TrendingUp,
  TrendingDown,
  Check,
  Trash2,
  Pencil,
  ArrowRight,
  CheckCheck,
} from "lucide-react";

interface AlertsViewProps {
  items: WatchlistItemFull[];
  watchlists: Watchlist[];
  onReload: () => Promise<void>;
  onAcknowledgeAll: () => Promise<void>;
  onJumpToWatchlist: (watchlistId: number) => void;
}

function relativeTime(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function AlertsView({
  items,
  watchlists,
  onReload,
  onAcknowledgeAll,
  onJumpToWatchlist,
}: AlertsViewProps) {
  const [priceByTicker, setPriceByTicker] = useState<Map<string, number | null>>(new Map());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    getCachedStocks().then((stocks) => {
      if (!cancelled) setPriceByTicker(new Map(stocks.map((s) => [s.ticker, s.last_price])));
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const watchlistNameById = useMemo(
    () => new Map(watchlists.map((w) => [w.id, w.name])),
    [watchlists],
  );

  const unacknowledgedCount = items.filter(isAlertPending).length;

  async function handleAcknowledge(id: number) {
    await acknowledgeAlert(id);
    await onReload();
  }

  async function handleRemove(id: number) {
    await setWatchlistAlert(id, null, null);
    await onReload();
  }

  function startEdit(item: WatchlistItemFull) {
    setEditingId(item.id);
    setDraft(item.alert_target_price != null ? String(item.alert_target_price) : "");
  }

  async function commitEdit(item: WatchlistItemFull) {
    const value = parseFloat(draft);
    if (!isNaN(value) && value > 0) {
      const referencePrice = priceByTicker.get(item.ticker) ?? item.watch_price ?? value;
      const direction: AlertDirection = value >= referencePrice ? "above" : "below";
      await setWatchlistAlert(item.id, value, direction);
      await onReload();
    }
    setEditingId(null);
  }

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
        <Bell className="w-10 h-10 text-muted-foreground/40" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">No price alerts yet</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Set one from any Watch List — click a row's Alert price to be
            notified when it's reached.
          </p>
        </div>
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => {
    const pendingDiff = Number(isAlertPending(b)) - Number(isAlertPending(a));
    if (pendingDiff !== 0) return pendingDiff;
    return (b.alert_triggered_at ?? b.created_at) - (a.alert_triggered_at ?? a.created_at);
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <p className="text-xs text-muted-foreground">
          {items.length} alert{items.length === 1 ? "" : "s"} across{" "}
          {watchlists.length} watch list{watchlists.length === 1 ? "" : "s"}
        </p>
        {unacknowledgedCount > 0 && (
          <button
            onClick={onAcknowledgeAll}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all as read
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b border-border">
            <tr>
              <th className="text-left px-6 py-2.5 font-medium text-muted-foreground">Ticker</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Watch List</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Current</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Alert</th>
              <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-center px-6 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const pending = isAlertPending(item);
              const price = priceByTicker.get(item.ticker) ?? null;
              const DirIcon = item.alert_direction === "above" ? TrendingUp : TrendingDown;
              return (
                <tr
                  key={item.id}
                  className={cn("border-b border-border/50", pending && "bg-amber-500/5")}
                >
                  <td className="px-6 py-2.5 font-semibold">{item.ticker}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => onJumpToWatchlist(item.watchlist_id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {watchlistNameById.get(item.watchlist_id) ?? "Watch List"}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {price != null ? formatCurrency(price) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {editingId === item.id ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitEdit(item)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-24 text-right rounded border border-primary bg-background px-2 py-0.5 text-sm outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(item)}
                        className="flex items-center gap-1 justify-end w-full tabular-nums hover:underline"
                      >
                        <DirIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                        {item.alert_target_price != null
                          ? formatCurrency(item.alert_target_price)
                          : "—"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.alert_triggered_at != null ? (
                      <span
                        className={cn(
                          "text-xs font-medium",
                          pending ? "text-amber-600" : "text-muted-foreground",
                        )}
                      >
                        Triggered {relativeTime(item.alert_triggered_at)}
                        {pending && " · unread"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Armed</span>
                    )}
                  </td>
                  <td className="px-6 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      {pending && (
                        <button
                          onClick={() => handleAcknowledge(item.id)}
                          title="Mark as read"
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(item)}
                        title="Edit alert price"
                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemove(item.id)}
                        title="Remove alert"
                        className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
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
      </div>
    </div>
  );
}
