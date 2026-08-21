import { RefreshCw, Cloud, CheckCircle, AlertCircle, Loader2, Layers } from "lucide-react";
import { cn, formatCurrency } from "../../lib/utils";
import type { SyncStatus } from "../../types";
import { BrokerLogo } from "../shared/BrokerLogo";

/**
 * Figures shown beneath the portfolio name.
 *
 * A brokerage reports equity, cash and buying power; a hand-maintained
 * portfolio has none of those, so it shows the computed equivalents instead.
 * Two shapes rather than one with optional fields, so a manual portfolio can
 * never accidentally render an empty "Buying Power" it has no concept of.
 */
export type HeaderFigures =
  | {
      kind: "broker";
      equity: number | null;
      cash: number | null;
      buyingPower: number | null;
      gain: number | null;
    }
  | { kind: "manual"; value: number | null; cost: number | null; gain: number | null };

interface HeaderProps {
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastRefreshedAt?: Date | null;
  syncStatus?: SyncStatus;
  onSyncNow?: () => void;
  hasSyncTargets?: boolean;
  lastSyncedAt?: Date | null;
  /** Holdings count for the stat cell. Omitted outside a portfolio. */
  positionsCount?: number | null;
  /** Figures under the name. Omitted outside a portfolio. */
  figures?: HeaderFigures | null;
  /** Brokerage identity, for the icon beside the name. Absent on manual
   *  portfolios, which belong to no brokerage. */
  brokerName?: string | null;
  brokerLogoDomain?: string | null;
}

export function Header({
  title,
  onRefresh,
  refreshing,
  lastRefreshedAt,
  syncStatus,
  onSyncNow,
  hasSyncTargets,
  lastSyncedAt,
  positionsCount,
  figures,
  brokerName,
  brokerLogoDomain,
}: HeaderProps) {
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const formattedTime = lastRefreshedAt ? clock.format(lastRefreshedAt) : null;
  const formattedSyncTime = lastSyncedAt ? clock.format(lastSyncedAt) : null;

  const showSync = hasSyncTargets || (syncStatus && syncStatus !== "idle");

  return (
    <header className="flex items-stretch h-16 border-b border-border bg-background">
      {/* Stat cell. Width matches the holdings column in PortfolioView
          (w-[15rem]) so the divider continues the one below it rather than
          cutting across at a different point. */}
      {positionsCount != null && (
        <div className="w-[15rem] shrink-0 border-r border-border flex items-center justify-between px-4">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers className="w-3.5 h-3.5 shrink-0 opacity-70" />
            Positions
          </span>
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {positionsCount}
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0 flex items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-3 min-w-0">
          {brokerName && (
            <BrokerLogo
              domain={brokerLogoDomain}
              name={brokerName}
              className="w-9 h-9"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate">
              {title}
            </h1>
            {figures && (
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {figures.kind === "broker" ? (
                  <>
                    <Figure label="Equity" value={figures.equity} />
                    <Figure label="Cash" value={figures.cash} separator />
                    <Figure
                      label="Buying Power"
                      value={figures.buyingPower}
                      separator
                    />
                    <GainFigure gain={figures.gain} />
                  </>
                ) : (
                  <>
                    <Figure label="Value" value={figures.value} />
                    <Figure label="Cost" value={figures.cost} separator />
                    <GainFigure gain={figures.gain} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {(showSync || onRefresh) && (
        <div className="flex items-center rounded-lg border border-border bg-muted/20 p-1 gap-0.5">

          {/* Sync */}
          {showSync && (
            <button
              onClick={onSyncNow}
              disabled={syncStatus === "syncing"}
              title={
                syncStatus === "syncing"
                  ? "Syncing database…"
                  : syncStatus === "error"
                    ? "Last sync failed — click to retry"
                    : "Sync database now"
              }
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-accent",
                syncStatus === "syncing" && "cursor-default opacity-70",
                syncStatus === "error" && "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40",
              )}
            >
              {syncStatus === "syncing" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : syncStatus === "error" ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              ) : syncStatus === "success" ? (
                <CheckCircle className="w-3.5 h-3.5 shrink-0 text-green-500" />
              ) : (
                <Cloud className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{syncStatus === "syncing" ? "Syncing…" : "Sync"}</span>
              {formattedSyncTime && (
                <span className="text-xs font-normal text-muted-foreground/70">
                  {formattedSyncTime}
                </span>
              )}
            </button>
          )}

          {/* Divider */}
          {showSync && onRefresh && (
            <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
          )}

          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-accent",
                refreshing && "cursor-default opacity-70",
              )}
            >
              <RefreshCw className={cn("w-3.5 h-3.5 shrink-0", refreshing && "animate-spin")} />
              <span>{refreshing ? "Refreshing…" : "Refresh Prices"}</span>
              {formattedTime && (
                <span className="text-xs font-normal text-muted-foreground/70">
                  {formattedTime}
                </span>
              )}
            </button>
          )}

          </div>
        )}
      </div>
    </header>
  );
}

/**
 * Gain or loss, named for what it actually is.
 *
 * The label follows the sign and the amount is shown unsigned: "Loss $523.10"
 * rather than "Gain -$523.10", which makes the reader do the work twice.
 */
function GainFigure({ gain }: { gain: number | null }) {
  if (gain == null) return null;
  const isGain = gain >= 0;
  return (
    <Figure
      label={isGain ? "Gain" : "Loss"}
      value={Math.abs(gain)}
      separator
      tone={isGain ? "text-positive" : "text-negative"}
    />
  );
}

/**
 * One labelled figure. Renders nothing at all when the value is absent, rather
 * than printing a dash — an omitted figure and a zero are different facts.
 */
function Figure({
  label,
  value,
  separator,
  tone,
}: {
  label: string;
  value: number | null;
  separator?: boolean;
  tone?: string;
}) {
  if (value == null) return null;
  return (
    <>
      {separator && <span className="mx-1.5 text-muted-foreground/50">·</span>}
      {label}{" "}
      <span className={cn("font-semibold text-foreground", tone)}>
        {formatCurrency(value)}
      </span>
    </>
  );
}
