import { RefreshCw, Cloud, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { SyncStatus } from "../../types";

interface HeaderProps {
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastRefreshedAt?: Date | null;
  syncStatus?: SyncStatus;
  onSyncNow?: () => void;
  hasSyncTargets?: boolean;
  lastSyncedAt?: Date | null;
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
}: HeaderProps) {
  const formattedTime = lastRefreshedAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(lastRefreshedAt)
    : null;

  const formattedSyncTime = lastSyncedAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(lastSyncedAt)
    : null;

  const showSync = hasSyncTargets || (syncStatus && syncStatus !== "idle");

  return (
    <header className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-background">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>

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
    </header>
  );
}
