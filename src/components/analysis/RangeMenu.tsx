import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import type { ChartRange } from "../../types";
import { cn } from "../../lib/utils";

export interface RangeOption {
  label: string;
  value: ChartRange;
  interval: string;
}

/** Full names for the menu; the trigger keeps the short form. */
const LONG_NAMES: Record<ChartRange, string> = {
  "1d": "1 Day",
  "5d": "5 Days",
  "1mo": "1 Month",
  "6mo": "6 Months",
  ytd: "Year to Date",
  "1y": "1 Year",
  "5y": "5 Years",
  max: "All Time",
};

interface RangeMenuProps {
  ranges: RangeOption[];
  value: ChartRange;
  onChange: (r: ChartRange) => void;
}

/**
 * Time-range picker.
 *
 * The trigger shows the short code because that is how the range is thought
 * about once chosen, while the menu spells each one out in full.
 */
export function RangeMenu({ ranges, value, onChange }: RangeMenuProps) {
  const current = ranges.find((r) => r.value === value) ?? ranges[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Time range: ${LONG_NAMES[current.value]}`}
          className={cn(
            "flex items-center gap-1 h-7 pl-2 pr-1.5 rounded-md text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground hover:opacity-90",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          )}
        >
          {current.label}
          <ChevronDown className="w-3 h-3 opacity-80" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[150px] rounded-lg border border-border bg-background p-1 shadow-xl"
        >
          {ranges.map((r) => (
            <DropdownMenu.Item
              key={r.value}
              onSelect={() => onChange(r.value)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm outline-none cursor-pointer data-[highlighted]:bg-muted"
            >
              <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                {r.label}
              </span>
              <span className="flex-1 text-foreground">
                {LONG_NAMES[r.value]}
              </span>
              {r.value === value ? (
                <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
