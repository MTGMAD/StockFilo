import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, RefreshCw, CornerDownRight } from "lucide-react";
import type { BrokerOrder, OrderStatusConfig } from "../../types";
import { listBrokerOrders } from "../../lib/brokers";
import { cn } from "../../lib/utils";

type Filter = "working" | "all" | string;

function label(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const FILLED = new Set(["filled", "executed", "partially_filled", "partial"]);
const FAILED = new Set(["rejected", "failed", "suspended"]);

function statusTone(status: string, terminal: Set<string>): string {
  if (FILLED.has(status)) return "bg-positive/10 text-positive";
  if (FAILED.has(status)) return "bg-negative/10 text-negative";
  if (terminal.has(status)) return "bg-muted text-muted-foreground";
  return "bg-primary/10 text-primary";
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
}

function num(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function when(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function priceCell(o: BrokerOrder): string {
  const parts: string[] = [];
  if (o.limit_price != null) parts.push(`L ${money(o.limit_price)}`);
  if (o.stop_price != null) parts.push(`S ${money(o.stop_price)}`);
  if (o.trail_percent != null) parts.push(`Trail ${o.trail_percent}%`);
  else if (o.trail_price != null) parts.push(`Trail ${money(o.trail_price)}`);
  return parts.length ? parts.join(" · ") : o.order_type === "market" ? "Market" : "—";
}

function quantityCell(o: BrokerOrder): string {
  if (o.qty == null) {
    // Notional (dollar-amount) orders have no share quantity until they fill.
    return o.notional != null ? `${money(o.notional)} notional` : "—";
  }
  if (o.filled_qty && o.filled_qty > 0 && o.filled_qty !== o.qty) {
    return `${num(o.filled_qty)} / ${num(o.qty)}`;
  }
  return num(o.qty);
}

/** The most relevant "what happened last" timestamp for the order's state. */
function lastEvent(o: BrokerOrder): string | null {
  return o.filled_at ?? o.canceled_at ?? o.expired_at ?? o.updated_at;
}

/**
 * Orders for a broker-linked portfolio, fetched live from the brokerage every
 * time the tab opens (and on Refresh). Read-only: nothing here can place,
 * change, or cancel an order.
 *
 * Status tabs come from the broker (see `OrderStatusConfig`) — Alpaca says
 * "filled", SnapTrade says "executed", and each has statuses the other lacks.
 */
export function BrokerOrdersView({ brokerAccountId }: { brokerAccountId: number }) {
  const [orders, setOrders] = useState<BrokerOrder[] | null>(null);
  const [config, setConfig] = useState<OrderStatusConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<Filter>("working");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listBrokerOrders(brokerAccountId);
      setOrders(r.orders);
      setConfig(r.statuses);
      setFetchedAt(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [brokerAccountId]);

  useEffect(() => {
    setOrders(null);
    setFilter("working");
    void load();
  }, [load]);

  const terminal = useMemo(() => new Set(config?.terminal ?? []), [config]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let working = 0;
    for (const o of orders ?? []) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      if (!terminal.has(o.status)) working++;
    }
    return { byStatus, working, all: orders?.length ?? 0 };
  }, [orders, terminal]);

  // The broker's documented statuses (pinned ones first), then any status it
  // returned that isn't on its documented list, so nothing is ever hidden.
  const statusTabs = useMemo(() => {
    const all = config?.all ?? [];
    const pinned = config?.pinned ?? [];
    const rest = all.filter((s) => !pinned.includes(s));
    const unknown = Object.keys(counts.byStatus).filter((s) => !all.includes(s));
    return { pinned, rest: [...rest, ...unknown] };
  }, [config, counts]);

  const visible = useMemo(() => {
    const list = orders ?? [];
    if (filter === "all") return list;
    if (filter === "working") return list.filter((o) => !terminal.has(o.status));
    return list.filter((o) => o.status === filter);
  }, [orders, filter, terminal]);

  function tab(id: Filter, text: string, count: number) {
    const active = filter === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        className={cn(
          "shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
          active
            ? "bg-primary text-primary-foreground"
            : count > 0
              ? "bg-muted text-foreground hover:bg-accent"
              : "text-muted-foreground/60 hover:bg-muted",
        )}
      >
        {text}
        <span
          className={cn(
            "tabular-nums rounded-full px-1.5 text-[10px]",
            active ? "bg-primary-foreground/20" : "bg-background/60",
          )}
        >
          {count}
        </span>
      </button>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-3 flex items-center gap-2 text-xs text-muted-foreground border-b border-border">
        <Lock className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1">
          Live from your broker — read-only. Stockfolio cannot place, change, or
          cancel orders.
          {config?.history_days != null &&
            ` This broker reports the last ${config.history_days} days.`}
        </span>
        {fetchedAt && (
          <span className="tabular-nums">
            Updated {fetchedAt.toLocaleTimeString()}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="px-6 py-2.5 flex items-center gap-1.5 overflow-x-auto border-b border-border">
        {tab("working", "Working", counts.working)}
        {statusTabs.pinned.map((s) => tab(s, label(s), counts.byStatus[s] ?? 0))}
        {tab("all", "All", counts.all)}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {statusTabs.rest.map((s) => tab(s, label(s), counts.byStatus[s] ?? 0))}
      </div>

      {error ? (
        <div className="m-6 rounded-md border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : orders == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading orders…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {filter === "working"
            ? "No working orders."
            : filter === "all"
              ? "No orders on this account."
              : `No ${label(filter).toLowerCase()} orders.`}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-6 py-2">Submitted</th>
                <th className="text-left font-medium px-3 py-2">Symbol</th>
                <th className="text-left font-medium px-3 py-2">Side</th>
                <th className="text-left font-medium px-3 py-2">Type</th>
                <th className="text-right font-medium px-3 py-2">Qty</th>
                <th className="text-right font-medium px-3 py-2">Price</th>
                <th className="text-right font-medium px-3 py-2">Avg Fill</th>
                <th className="text-left font-medium px-3 py-2">TIF</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-6 py-2">Last Update</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-border/60 hover:bg-accent/40 transition-colors"
                >
                  <td className="px-6 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {when(o.submitted_at)}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      {o.parent_id && (
                        <CornerDownRight
                          className="w-3.5 h-3.5 text-muted-foreground"
                          aria-label="Leg of a multi-part order"
                        />
                      )}
                      {o.provider_symbol}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {o.side ? (
                      <span
                        className={cn(
                          "text-xs font-medium uppercase",
                          o.side === "buy" ? "text-positive" : "text-negative",
                        )}
                      >
                        {o.side}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.order_type ? label(o.order_type) : "—"}
                    {o.order_class && o.order_class !== "simple" && (
                      <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                        {o.order_class}
                      </span>
                    )}
                    {o.extended_hours && (
                      <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                        ext
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {quantityCell(o)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {priceCell(o)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(o.filled_avg_price)}
                  </td>
                  <td className="px-3 py-2 uppercase text-xs text-muted-foreground">
                    {o.time_in_force ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                        statusTone(o.status, terminal),
                      )}
                    >
                      {label(o.status)}
                    </span>
                  </td>
                  <td className="px-6 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {when(lastEvent(o))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
