/**
 * accountTypes.ts — how brokerage account types are named and coloured.
 *
 * One place decides this, so a Margin account looks identical in the sidebar,
 * the settings panel and the connect form — and so adding Cash accounts later
 * means adding one entry here rather than hunting for chips.
 *
 * The colours are theme tokens (see index.css), aliased from the palette each
 * theme already tunes, so light, dark and warm all follow automatically:
 *
 *   margin → amber   (real money, on margin — worth a second look)
 *   paper  → blue    (practice money — informational, not a warning)
 *   cash   → green   (real money, settled cash — no borrowing)
 */

export type AccountKind = "margin" | "paper" | "cash" | "unknown";

interface AccountKindStyle {
  /** Small chip, as used beside a portfolio or connection name. */
  chip: string;
  /** Selectable button in the connect form, when chosen. */
  selected: string;
  /** Text-only, for inline labels. */
  text: string;
}

const STYLES: Record<AccountKind, AccountKindStyle> = {
  margin: {
    chip: "bg-account-margin/15 text-account-margin",
    selected: "border-account-margin bg-account-margin/10 text-account-margin",
    text: "text-account-margin",
  },
  paper: {
    chip: "bg-account-paper/15 text-account-paper",
    selected: "border-account-paper bg-account-paper/10 text-account-paper",
    text: "text-account-paper",
  },
  cash: {
    chip: "bg-account-cash/15 text-account-cash",
    selected: "border-account-cash bg-account-cash/10 text-account-cash",
    text: "text-account-cash",
  },
  // A provider declaring a kind this build doesn't know renders plainly rather
  // than borrowing a colour that might imply the wrong thing about real money.
  unknown: {
    chip: "bg-muted text-muted-foreground",
    selected: "border-primary bg-primary/10 text-primary",
    text: "text-muted-foreground",
  },
};

function normalize(kind: string | null | undefined): AccountKind {
  if (kind === "margin" || kind === "paper" || kind === "cash") return kind;
  return "unknown";
}

export function accountKindStyle(kind: string | null | undefined): AccountKindStyle {
  return STYLES[normalize(kind)];
}

/** True for account types that trade real money — margin and cash, not paper. */
export function isRealMoney(kind: string | null | undefined): boolean {
  const k = normalize(kind);
  return k === "margin" || k === "cash";
}
