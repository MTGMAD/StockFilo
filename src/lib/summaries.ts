/**
 * summaries.ts — building TickerSummary[], the shape every view consumes.
 *
 * The Dashboard, rank view, charts and tables all read TickerSummary objects
 * and never touch the underlying tables, which is what lets a broker portfolio
 * and a manual one render through identical components.
 *
 * Two producers:
 *
 *   buildFromPurchases — manual portfolios. Aggregates the user's purchase
 *                        rows and prices them from the Yahoo cache. This is
 *                        the original logic from usePortfolio.ts, moved here
 *                        unchanged so both callers can share it.
 *
 *   buildFromPositions — broker portfolios. Every money figure comes straight
 *                        from the brokerage. Nothing is recomputed, and a
 *                        value the broker omits stays null rather than being
 *                        inferred.
 */
import type { BrokerPosition, Purchase, Stock, TickerSummary } from "../types";

const STALE_THRESHOLD_SECONDS = 3600; // 1 hour

/** Aggregate manual purchase rows into per-ticker summaries. */
export function buildFromPurchases(
  purchases: Purchase[],
  stocks: Stock[],
): TickerSummary[] {
  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const now = Math.floor(Date.now() / 1000);

  return [...new Set(purchases.map((p) => p.ticker))].map((ticker) => {
    const tickerPurchases = purchases.filter((p) => p.ticker === ticker);
    const totalShares = tickerPurchases.reduce((s, p) => s + p.shares, 0);
    const totalInvested = tickerPurchases.reduce(
      (s, p) => s + p.shares * p.price_per_share,
      0,
    );
    const avgCostBasis = totalShares > 0 ? totalInvested / totalShares : 0;
    const stock = stockMap.get(ticker);
    const currentPrice = stock?.last_price ?? null;
    const marketValue = currentPrice != null ? totalShares * currentPrice : null;
    const pnlDollar = marketValue != null ? marketValue - totalInvested : null;
    const pnlPercent =
      pnlDollar != null && totalInvested > 0
        ? (pnlDollar / totalInvested) * 100
        : null;
    const lastFetchedAt = stock?.last_fetched_at ?? null;
    const isStale =
      lastFetchedAt == null || now - lastFetchedAt > STALE_THRESHOLD_SECONDS;

    return {
      ticker,
      name: stock?.name ?? null,
      totalShares,
      totalInvested,
      avgCostBasis,
      currentPrice,
      marketValue,
      pnlDollar,
      pnlPercent,
      isStale,
      lastFetchedAt,
      quoteType: stock?.quote_type ?? null,
      dailyChangePct: stock?.daily_change_pct ?? null,
      market_state: stock?.market_state ?? null,
      pre_market_price: stock?.pre_market_price ?? null,
      pre_market_change_pct: stock?.pre_market_change_pct ?? null,
      post_market_price: stock?.post_market_price ?? null,
      post_market_change_pct: stock?.post_market_change_pct ?? null,
      dividendYield: stock?.dividend_yield ?? null,
    };
  });
}

/**
 * Turn broker-reported positions into summaries.
 *
 * Ownership of each field is deliberate: the brokerage owns everything about
 * the position and its price, so totals always match what the broker shows.
 * Yahoo supplies only reference data no broker publishes — company name, asset
 * type, analyst target, dividend yield — read from the same `stocks` cache the
 * rest of the app uses.
 *
 * Extended-hours fields are left null: a positions payload carries no pre- or
 * post-market quote, and filling them from Yahoo would mix two sources inside
 * a single price display.
 */
export function buildFromPositions(
  positions: BrokerPosition[],
  stocks: Stock[],
): TickerSummary[] {
  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));

  return positions.map((p) => {
    // Options and some crypto have no Yahoo row; fall back to the broker's own
    // symbol so the row is never nameless.
    const displayTicker = p.ticker ?? p.provider_symbol;
    const stock = p.ticker ? stockMap.get(p.ticker) : undefined;

    const totalInvested =
      p.cost_basis ??
      (p.avg_entry_price != null ? p.avg_entry_price * p.qty : 0);

    return {
      ticker: displayTicker,
      name: stock?.name ?? null,
      totalShares: p.qty,
      totalInvested,
      avgCostBasis: p.avg_entry_price ?? 0,
      currentPrice: p.current_price,
      marketValue: p.market_value,
      pnlDollar: p.unrealized_pl,
      // The broker reports fractions; the app displays percent.
      pnlPercent: p.unrealized_plpc != null ? p.unrealized_plpc * 100 : null,
      // Freshness is the position snapshot, not the Yahoo reference fetch —
      // using stocks.last_fetched_at here would show "stale" while prices are
      // in fact current to the second.
      isStale:
        Math.floor(Date.now() / 1000) - p.snapshot_at > STALE_THRESHOLD_SECONDS,
      lastFetchedAt: p.snapshot_at,
      quoteType: stock?.quote_type ?? assetClassToQuoteType(p.asset_class),
      dailyChangePct: p.change_today != null ? p.change_today * 100 : null,
      market_state: null,
      pre_market_price: null,
      pre_market_change_pct: null,
      post_market_price: null,
      post_market_change_pct: null,
      dividendYield: stock?.dividend_yield ?? null,
    };
  });
}

/**
 * Fallback asset type for holdings Yahoo has no row for.
 *
 * A broker's asset class is coarser than Yahoo's quote type — it cannot tell an
 * ETF from a common stock — so this is only used when the Yahoo value is
 * missing, which keeps the Dashboard's allocation breakdown from bucketing a
 * holding as "undefined".
 */
function assetClassToQuoteType(assetClass: string | null): string | null {
  if (!assetClass) return null;
  const c = assetClass.toLowerCase();
  if (c.includes("crypto")) return "CRYPTOCURRENCY";
  if (c.includes("option")) return "OPTION";
  if (c.includes("equity")) return "EQUITY";
  return null;
}
