import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { EMPTY_FILTER, isFilterActive, type TradeFilter } from "../../lib/journal";

interface JournalFiltersProps {
  filter: TradeFilter;
  onChange: (f: TradeFilter) => void;
  tags: string[];
  shown: number;
  total: number;
}

const field = "rounded-md border border-border bg-background px-2 py-1 text-sm";

export function JournalFilters({ filter, onChange, tags, shown, total }: JournalFiltersProps) {
  const set = (patch: Partial<TradeFilter>) => onChange({ ...filter, ...patch });
  const active = isFilterActive(filter);
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-border text-sm">
      <input
        className={cn(field, "w-24")}
        placeholder="Ticker"
        value={filter.ticker}
        onChange={(e) => set({ ticker: e.target.value })}
      />
      <select className={field} value={filter.status} onChange={(e) => set({ status: e.target.value as TradeFilter["status"] })}>
        <option value="all">All results</option>
        <option value="win">Wins</option>
        <option value="loss">Losses</option>
        <option value="partial">Partial exits</option>
        <option value="open">Open</option>
      </select>
      <select className={field} value={filter.tag} onChange={(e) => set({ tag: e.target.value })} disabled={tags.length === 0}>
        <option value="">{tags.length ? "Any tag" : "No tags yet"}</option>
        {tags.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        From
        <input type="date" className={field} value={filter.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        To
        <input type="date" className={field} value={filter.to} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={filter.unreviewedOnly}
          onChange={(e) => set({ unreviewedOnly: e.target.checked })}
        />
        Needs review
      </label>
      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      )}
      {active && (
        <span className="ml-auto text-xs text-muted-foreground">
          {shown} of {total} trades
        </span>
      )}
    </div>
  );
}
