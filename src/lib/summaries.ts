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
 *                        (and sale) rows and prices them from the Yahoo
 *                        cache. This is the original logic from
 *                        usePortfolio.ts, moved here unchanged so both
 *                        callers can share it.
 *
 *   buildFromPositions — broker portfolios. Every money figure comes straight
 *                        from the brokerage. Nothing is recomputed, and a
 *                        value the broker omits stays null rather than being
 *                        inferred.
 */
import type { BrokerPosition, Purchase, Sale, Stock, TickerSummary } from "../types";

const STALE_THRESHOLD_SECONDS = 3600; // 1 hour

/**
 * Aggregate manual purchase (and sale) rows into per-ticker summaries.
 *
 * A ticker's position is `purchased shares - sold shares`. Cost basis on
 * what remains uses the blended-average method: the average cost of every
 * share ever bought, applied to however many are left. This is
 * order-independent (it doesn't matter which specific lot a sale is thought
 * of as coming from), consistent with the fact that this app has never done
 * FIFO/LIFO lot selection for buys either. A ticker fully sold off (or
 * oversold, shares <= 0) drops out of the list entirely — "remove the
 * position" rather than show a lingering zero-share row.
 */
export function buildFromPurchases(
  purchases: Purchase[],
  sales: Sale[],
  stocks: Stock[],
): TickerSummary[] {
  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const now = Math.floor(Date.now() / 1000);
  const summaries: TickerSummary[] = [];

  for (const ticker of new Set(purchases.map((p) => p.ticker))) {
    const tickerPurchases = purchases.filter((p) => p.ticker === ticker);
    const purchasedShares = tickerPurchases.reduce((s, p) => s + p.shares, 0);
    const purchasedInvested = tickerPurchases.reduce(
      (s, p) => s + p.shares * p.price_per_share,
      0,
    );
    const avgCost = purchasedShares > 0 ? purchasedInvested / purchasedShares : 0;

    const soldShares = sales
      .filter((s) => s.ticker === ticker)
      .reduce((s, sale) => s + sale.shares, 0);

    const totalShares = purchasedShares - soldShares;
    if (totalShares <= 0) continue;

    const totalInvested = totalShares * avgCost;
    const avgCostBasis = avgCost;
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

    summaries.push({
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
    });
  }

  return summaries;
}

/**
 * Turn broker-reported positions into summaries.
 *
 * Ownership of each field is deliberate: the brokerage owns everything about
 * the position and its price, so totals always match what the broker shows —
 * whenever the broker actually reports a price. Some brokers (seen with
 * Alpaca outside market hours, or on certain data plans) omit `current_price`
 * entirely while still reporting `change_today`; leaving the row blank in
 * that case is strictly worse than the one case this file otherwise avoids —
 * so when, and only when, the broker gives no price at all, price *and* its
 * percent change fall back together to the same Yahoo cache a manual
 * portfolio already uses, recomputed as one consistent pair rather than
 * pairing a broker number with a Yahoo one for the same figure. The broker's
 * own numbers are used exactly as reported the moment it reports any.
 *
 * Yahoo also supplies reference data no broker publishes — company name,
 * asset type, analyst target, dividend yield — read from the same `stocks`
 * cache regardless of which price source is in play.
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

    // Null (not 0) when the broker reports neither — some accounts, seen with
    // a 401k synced through SnapTrade, report positions with no cost-basis
    // data at all. Defaulting to 0 there would print "$0.00" and imply a
    // free position instead of "not reported".
    const totalInvested =
      p.cost_basis ??
      (p.avg_entry_price != null ? p.avg_entry_price * p.qty : null);

    // Only when the broker has nothing — never to second-guess a price it did
    // report.
    const usingFallbackPrice = p.current_price == null && stock?.last_price != null;
    const currentPrice = p.current_price ?? stock?.last_price ?? null;

    const marketValue = usingFallbackPrice
      ? (currentPrice != null ? currentPrice * p.qty : null)
      : p.market_value;
    const pnlDollar = usingFallbackPrice
      ? (marketValue != null && totalInvested != null ? marketValue - totalInvested : null)
      : p.unrealized_pl;
    const pnlPercent = usingFallbackPrice
      ? pnlDollar != null && totalInvested != null && totalInvested > 0
        ? (pnlDollar / totalInvested) * 100
        : null
      : // The broker reports fractions; the app displays percent.
        p.unrealized_plpc != null
        ? p.unrealized_plpc * 100
        : null;
    // Outside a live session (weekend, holiday, or simply before Yahoo's
    // cache has been asked in a while) brokers seen in the wild — Alpaca
    // among them — keep reporting the position at Friday's closing price but
    // report `change_today` as a flat 0 rather than omitting it, since
    // nothing has traded "today" yet. Taken at face value that renders every
    // holding as unchanged all weekend, which is wrong: the position is
    // exactly as up or down as it was at Friday's close. Yahoo's cache
    // doesn't have this problem — `regularMarketChangePercent` keeps
    // reflecting the last completed session until a new one starts — so once
    // the broker's number looks like "no session happened" (null, or a
    // suspiciously exact 0) fall back to it instead of a broker figure that
    // was never really about today.
    const isLiveSession =
      stock?.market_state === "PRE" ||
      stock?.market_state === "REGULAR" ||
      stock?.market_state === "POST";
    const brokerDailyChangePct =
      p.change_today != null ? p.change_today * 100 : null;
    const dailyChangePct = usingFallbackPrice
      ? stock?.daily_change_pct ?? null
      : !isLiveSession && (brokerDailyChangePct == null || brokerDailyChangePct === 0)
        ? stock?.daily_change_pct ?? brokerDailyChangePct
        : brokerDailyChangePct;

    return {
      ticker: displayTicker,
      name: stock?.name ?? null,
      totalShares: p.qty,
      totalInvested,
      avgCostBasis: p.avg_entry_price ?? null,
      currentPrice,
      marketValue,
      pnlDollar,
      pnlPercent,
      // Freshness is the position snapshot, not the Yahoo reference fetch —
      // using stocks.last_fetched_at here would show "stale" while prices are
      // in fact current to the second.
      isStale:
        Math.floor(Date.now() / 1000) - p.snapshot_at > STALE_THRESHOLD_SECONDS,
      lastFetchedAt: p.snapshot_at,
      quoteType: stock?.quote_type ?? assetClassToQuoteType(p.asset_class),
      dailyChangePct,
      // Sourced from Yahoo even for broker positions now, so the extended-
      // hours tag and the fallback above both know when the market's closed.
      market_state: stock?.market_state ?? null,
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
