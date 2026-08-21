import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Clock, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  LOCAL_ZONE,
  systemZoneName,
  zoneAbbreviation,
  zoneGroups,
  type TimeZoneChoice,
} from "../../lib/timezones";

interface TimeZoneMenuProps {
  value: TimeZoneChoice;
  onChange: (z: TimeZoneChoice) => void;
}

/**
 * Time zone picker for the price chart.
 *
 * Unlike the style menu this shows its current value rather than an icon alone:
 * which zone the axis is in changes how the data reads, so leaving it to be
 * inferred would be a good way to misread a session.
 */
export function TimeZoneMenu({ value, onChange }: TimeZoneMenuProps) {
  const abbreviation = zoneAbbreviation(value);
  const systemZone = systemZoneName();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Chart time zone: ${abbreviation || value}`}
          title={
            value === LOCAL_ZONE
              ? `Local time${systemZone ? ` — ${systemZone}` : ""}`
              : value
          }
          className={cn(
            "flex items-center gap-1 h-7 px-1.5 rounded-md transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "data-[state=open]:bg-muted data-[state=open]:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          )}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          {abbreviation && (
            <span className="text-[10px] font-medium tabular-nums">
              {abbreviation}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[210px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-xl"
        >
          {zoneGroups().map(({ group, options }, gi) => (
            <div key={group}>
              {gi > 0 && (
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
              )}
              <DropdownMenu.Label className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {group}
              </DropdownMenu.Label>
              {options.map((opt) => {
                const abbr = zoneAbbreviation(opt.value);
                return (
                  <DropdownMenu.Item
                    key={opt.value}
                    onSelect={() => onChange(opt.value)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm outline-none cursor-pointer data-[highlighted]:bg-muted"
                  >
                    <span className="flex-1 min-w-0 truncate text-foreground">
                      {opt.label}
                      {opt.value === LOCAL_ZONE && systemZone && (
                        <span className="text-muted-foreground"> · {systemZone}</span>
                      )}
                    </span>
                    {abbr && (
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {abbr}
                      </span>
                    )}
                    {opt.value === value ? (
                      <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                  </DropdownMenu.Item>
                );
              })}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
