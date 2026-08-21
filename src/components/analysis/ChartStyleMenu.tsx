import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AreaChart, LineChart, CandlestickChart, Check } from "lucide-react";
import type { ChartStyle } from "../../types";
import { cn } from "../../lib/utils";

/**
 * Chart style picker.
 *
 * Collapsed it is just the current style's icon — the chart header is already
 * busy with eight range buttons, and the style rarely changes once chosen.
 * Opening it reveals the names, so the icons never have to be guessed at.
 */

interface StyleOption {
  value: ChartStyle;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const STYLES: StyleOption[] = [
  {
    value: "mountain",
    label: "Mountain",
    description: "Filled area under the price",
    Icon: AreaChart,
  },
  {
    value: "line",
    label: "Line",
    description: "Just the price line",
    Icon: LineChart,
  },
  {
    value: "candles",
    label: "Candles",
    description: "Open, high, low and close",
    Icon: CandlestickChart,
  },
];

interface ChartStyleMenuProps {
  value: ChartStyle;
  onChange: (s: ChartStyle) => void;
  /** Disables Candles and says why, when the data has no OHLC. */
  candlesUnavailableReason?: string | null;
}

export function ChartStyleMenu({
  value,
  onChange,
  candlesUnavailableReason,
}: ChartStyleMenuProps) {
  const current = STYLES.find((s) => s.value === value) ?? STYLES[0];
  const CurrentIcon = current.Icon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Chart style: ${current.label}`}
          title={`Chart style: ${current.label}`}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-md transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "data-[state=open]:bg-muted data-[state=open]:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          )}
        >
          <CurrentIcon className="w-4 h-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[190px] rounded-lg border border-border bg-background p-1 shadow-xl"
        >
          {STYLES.map(({ value: v, label, description, Icon }) => {
            const disabled = v === "candles" && !!candlesUnavailableReason;
            return (
              <DropdownMenu.Item
                key={v}
                disabled={disabled}
                onSelect={() => !disabled && onChange(v)}
                title={disabled ? candlesUnavailableReason! : undefined}
                className={cn(
                  "flex items-start gap-2 px-2 py-1.5 rounded-md text-sm outline-none transition-colors",
                  disabled
                    ? "opacity-40 cursor-not-allowed"
                    : "cursor-pointer data-[highlighted]:bg-muted",
                )}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground leading-tight">
                    {label}
                  </span>
                  <span className="block text-xs text-muted-foreground leading-snug">
                    {disabled ? candlesUnavailableReason : description}
                  </span>
                </span>
                {v === value && (
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
