import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

interface HeaderProps {
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function Header({ title, onRefresh, refreshing }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Refresh Prices"}
        </button>
      )}
    </header>
  );
}
