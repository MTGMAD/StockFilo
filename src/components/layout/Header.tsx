import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

interface HeaderProps {
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastRefreshedAt?: Date | null;
}

export function Header({
  title,
  onRefresh,
  refreshing,
  lastRefreshedAt,
}: HeaderProps) {
  const formattedTime = lastRefreshedAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(lastRefreshedAt)
    : null;

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {onRefresh && (
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={cn("w-4 h-4", refreshing && "animate-spin")}
            />
            {refreshing ? "Refreshing…" : "Refresh Prices"}
          </button>
          {formattedTime && (
            <span className="text-xs text-muted-foreground">
              Updated at {formattedTime}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
