import { formatCurrency, formatPercent, pnlColor } from "../../lib/utils";

type ExtendedHoursData = {
  market_state: string | null;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
};

interface ExtendedHoursTagProps {
  stock?: ExtendedHoursData;
  /** True where the price shown alongside this tag is already the
   *  session-aware one (see summaries.ts's sessionAwarePrice) — showing the
   *  extended-hours price again here would just repeat it, so this renders
   *  a plain session label ("Pre-Market" / "After Hours") instead. */
  labelOnly?: boolean;
}

export function ExtendedHoursTag({ stock, labelOnly }: ExtendedHoursTagProps) {
  if (!stock) return null;
  const { market_state, pre_market_price, pre_market_change_pct, post_market_price, post_market_change_pct } = stock;
  const state = market_state ?? "";

  // Only show extended-hours data outside of regular market hours
  if (state === "REGULAR" || state === "") return null;

  if (labelOnly) {
    if (state.startsWith("PRE") && pre_market_price != null) {
      return <span className="text-xs text-muted-foreground">Pre-Market</span>;
    }
    if (state.startsWith("POST") && post_market_price != null) {
      return <span className="text-xs text-muted-foreground">After Hours</span>;
    }
    return null;
  }

  // During PRE hours show pre-market; during POST or any other state prefer
  // post-market if available, then fall back to pre-market so the last known
  // extended-hours price is always visible.
  let label: string;
  let price: number;
  let changePct: number | null | undefined;

  if (state === "PRE" && pre_market_price != null) {
    label = "Pre";
    price = pre_market_price;
    changePct = pre_market_change_pct;
  } else if (state === "POST" && post_market_price != null) {
    label = "Post";
    price = post_market_price;
    changePct = post_market_change_pct;
  } else if (post_market_price != null) {
    label = "Post";
    price = post_market_price;
    changePct = post_market_change_pct;
  } else if (pre_market_price != null) {
    label = "Pre";
    price = pre_market_price;
    changePct = pre_market_change_pct;
  } else {
    return null;
  }

  return (
    <div className="flex items-baseline gap-1 text-xs text-muted-foreground">
      <span>{label}:</span>
      <span>{formatCurrency(price)}</span>
      {changePct != null && (
        <span className={pnlColor(changePct)}>{formatPercent(changePct)}</span>
      )}
    </div>
  );
}
