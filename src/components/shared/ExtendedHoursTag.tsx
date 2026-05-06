import type { Stock } from "../../types";
import { formatCurrency, formatPercent, pnlColor } from "../../lib/utils";

interface ExtendedHoursTagProps {
  stock: Stock;
}

export function ExtendedHoursTag({ stock }: ExtendedHoursTagProps) {
  const { market_state, pre_market_price, pre_market_change_pct, post_market_price, post_market_change_pct } = stock;

  const isPre = market_state === "PRE" && pre_market_price != null;
  const isPost = market_state === "POST" && post_market_price != null;

  if (!isPre && !isPost) return null;

  const label = isPre ? "Pre" : "Post";
  const price = isPre ? pre_market_price! : post_market_price!;
  const changePct = isPre ? pre_market_change_pct : post_market_change_pct;

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span>{formatCurrency(price)}</span>
      {changePct != null && (
        <span className={pnlColor(changePct)}>{formatPercent(changePct)}</span>
      )}
    </div>
  );
}
