/**
 * timezones.ts — chart time zone handling.
 *
 * Charts default to the machine's own zone, so a 9:30 ET open reads as 9:30 for
 * someone in New York without them configuring anything. Traders following a
 * market they don't live in can pin a different zone.
 *
 * 12- versus 24-hour is deliberately never specified. Passing `hour12` would
 * override the convention the user's system already expresses through their
 * locale — a German locale renders 15:00 and a US one 3:00 PM, and that is the
 * correct behaviour in both cases.
 */

/** "local" follows the system zone; anything else is an IANA zone name. */
export type TimeZoneChoice = string;

export const LOCAL_ZONE: TimeZoneChoice = "local";

const STORAGE_KEY = "stockfolio-chart-timezone";

export interface ZoneOption {
  value: TimeZoneChoice;
  label: string;
  /** Grouping header in the menu. */
  group: string;
}

/**
 * Market-centric list rather than all ~400 IANA zones — a full list is a
 * scrolling wall, and a stock app's zones are the exchanges plus wherever the
 * user lives. Add entries here as needed; nothing else has to change.
 */
export const ZONE_OPTIONS: ZoneOption[] = [
  { value: LOCAL_ZONE, label: "Local time", group: "Default" },
  { value: "UTC", label: "UTC", group: "Default" },

  { value: "America/New_York", label: "New York", group: "Americas" },
  { value: "America/Chicago", label: "Chicago", group: "Americas" },
  { value: "America/Denver", label: "Denver", group: "Americas" },
  { value: "America/Los_Angeles", label: "Los Angeles", group: "Americas" },
  { value: "America/Toronto", label: "Toronto", group: "Americas" },
  { value: "America/Sao_Paulo", label: "São Paulo", group: "Americas" },

  { value: "Europe/London", label: "London", group: "Europe & Africa" },
  { value: "Europe/Frankfurt", label: "Frankfurt", group: "Europe & Africa" },
  { value: "Europe/Zurich", label: "Zurich", group: "Europe & Africa" },
  { value: "Europe/Moscow", label: "Moscow", group: "Europe & Africa" },
  { value: "Africa/Johannesburg", label: "Johannesburg", group: "Europe & Africa" },

  { value: "Asia/Dubai", label: "Dubai", group: "Asia & Pacific" },
  { value: "Asia/Kolkata", label: "Mumbai", group: "Asia & Pacific" },
  { value: "Asia/Hong_Kong", label: "Hong Kong", group: "Asia & Pacific" },
  { value: "Asia/Shanghai", label: "Shanghai", group: "Asia & Pacific" },
  { value: "Asia/Tokyo", label: "Tokyo", group: "Asia & Pacific" },
  { value: "Australia/Sydney", label: "Sydney", group: "Asia & Pacific" },
  { value: "Pacific/Auckland", label: "Auckland", group: "Asia & Pacific" },
];

/** Menu groups, in display order, without duplicating the list above. */
export function zoneGroups(): { group: string; options: ZoneOption[] }[] {
  const out: { group: string; options: ZoneOption[] }[] = [];
  for (const opt of ZONE_OPTIONS) {
    const existing = out.find((g) => g.group === opt.group);
    if (existing) existing.options.push(opt);
    else out.push({ group: opt.group, options: [opt] });
  }
  return out;
}

/**
 * Convert a choice into the `timeZone` option `Intl` expects.
 *
 * `undefined` means "let the platform use the system zone", which is not the
 * same as naming the system zone explicitly — it keeps working if the machine
 * moves or DST rules change underneath.
 */
export function resolveZone(choice: TimeZoneChoice): string | undefined {
  return choice === LOCAL_ZONE ? undefined : choice;
}

/** The system's IANA zone, for showing what "Local time" resolves to. */
export function systemZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * Short abbreviation for a zone at the current moment — "EDT", "GMT+1".
 *
 * Taken from a formatted date rather than a lookup table so it stays correct
 * across daylight-saving changes.
 */
export function zoneAbbreviation(choice: TimeZoneChoice, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: resolveZone(choice),
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Format a unix timestamp (seconds) in the chosen zone.
 *
 * Note the absence of `hour12`: omitting it is what lets the user's locale
 * decide between 15:00 and 3:00 PM.
 */
export function formatInZone(
  tsSeconds: number,
  choice: TimeZoneChoice,
  options: Intl.DateTimeFormatOptions,
): string {
  const zone = resolveZone(choice);
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone }).format(
      new Date(tsSeconds * 1000),
    );
  } catch {
    // An unknown zone should degrade to local time, not blank the axis.
    return new Intl.DateTimeFormat(undefined, options).format(new Date(tsSeconds * 1000));
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadZoneChoice(): TimeZoneChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return LOCAL_ZONE;
    // Only accept a zone this platform actually knows, so a stale or hand-edited
    // value cannot leave every chart axis blank.
    if (saved === LOCAL_ZONE) return LOCAL_ZONE;
    new Intl.DateTimeFormat(undefined, { timeZone: saved });
    return saved;
  } catch {
    return LOCAL_ZONE;
  }
}

export function saveZoneChoice(choice: TimeZoneChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private mode or blocked storage — the choice just won't persist.
  }
}
