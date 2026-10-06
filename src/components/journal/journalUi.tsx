import { cn } from "../../lib/utils";
import type { JournalTrade } from "../../lib/journal";

export function shortDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function compactMoney(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function holdLabel(days: number): string {
  if (days === 0) return "Same day";
  return days === 1 ? "1 day" : `${days} days`;
}

export function pct(v: number, digits = 0): string {
  return `${v.toFixed(digits)}%`;
}

export function Stat({
  label,
  value,
  className,
  hint,
}: {
  label: string;
  value: string;
  className?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: JournalTrade["status"] }) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
        status === "win" && "bg-positive/15 text-positive",
        status === "loss" && "bg-negative/15 text-negative",
        status === "open" && "bg-warning/15 text-warning",
        status === "partial" && "bg-primary/15 text-primary",
      )}
    >
      {status === "partial" ? "partial exit" : status}
    </span>
  );
}
