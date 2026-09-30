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
 *   buildFromPositions — broker portfolios. Quantity, cost basis and every
 *                        other detail come straight from the brokerage
 *                        always. Price is the brokerage's own only when it
 *                        quotes the market live (see `providesPricing`
 *                        below); an aggregator's price is treated the same
 *                        way a manual portfolio's is, priced from Yahoo.
 */
import type { BrokerPosition, Purchase, Sale, Stock, TickerSummary } from "../types";

const STALE_THRESHOLD_SECONDS = 3600; // 1 hour

/**
 * The price for pre-market (PRE) or after-hours (POST, or Yahoo's own
 * further-extended POSTPOST) instead of always the last regular-hours
 * close. Matched by prefix, not an exact list, so any PRE- or POST-prefixed
 * state Yahoo reports is covered without enumerating them. Regular hours, a
 * closed market, or a missing extended-hours quote all fall back to the
 * last regular price.
 *
 * This does NOT cover true overnight trading (the ~8pm-4am ET session some
 * brokers offer via Blue Ocean ATS, shown on Yahoo's own website as an
 * "Overnight" badge) — confirmed by direct inspection that Yahoo's public
 * quote/chart endpoints simply stop updating at 8pm ET and freeze there
 * (`postMarketTime` lands at 19:59:55 ET even when checked hours later);
 * the website's overnight price comes from a different, undocumented feed
 * this app has no access to. POSTPOST is Yahoo's last tick before that
 * freeze, not a stand-in for the overnight session.
 */
function sessionAwarePrice(stock: Stock | undefined): number | null {
  if (!stock) return null;
  const state = stock.market_state ?? "";
  if (state.startsWith("PRE") && stock.pre_market_price != null) {
    return stock.pre_market_price;
  }
  if (state.startsWith("POST") && stock.post_market_price != null) {
    return stock.post_market_price;
  }
  return stock.last_price ?? null;
}

/** The % change paired with whatever `sessionAwarePrice` picked, so the two
 *  numbers always describe the same session instead of mixing an
 *  extended-hours price with a regular-session change. */
function sessionAwareChangePct(stock: Stock | undefined): number | null {
  if (!stock) return null;
  const state = stock.market_state ?? "";
  if (state.startsWith("PRE") && stock.pre_market_price != null) {
    return stock.pre_market_change_pct ?? null;
  }
  if (state.startsWith("POST") && stock.post_market_price != null) {
    return stock.post_market_change_pct ?? null;
  }
  return stock.daily_change_pct ?? null;
}

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
    const currentPrice = sessionAwarePrice(stock);
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
      dailyChangePct: sessionAwareChangePct(stock),
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
 * `providesPricing` (from the provider's descriptor, `false` for SnapTrade,
 * `true` for Alpaca) decides who owns price for this batch:
 *
 *   true  — the brokerage quotes the market live itself, so totals always
 *           match what it shows. Yahoo only rescues a position where the
 *           broker reports no price at all (seen with Alpaca outside market
 *           hours, or on certain data plans) — price *and* its percent
 *           change fall back together to the same Yahoo cache a manual
 *           portfolio uses, recomputed as one consistent pair rather than
 *           pairing a broker number with a Yahoo one for the same figure.
 *
 *   false — the provider is an aggregator (SnapTrade) whose own
 *           `current_price` is only as fresh as the last brokerage sync, so
 *           Yahoo's live feed is preferred whenever it can quote the ticker;
 *           the broker's price is used only for symbols Yahoo can't price
 *           (options, funds identified by CUSIP, etc). Everything else about
 *           the position — quantity, cost basis, cash, transactions — still
 *           comes from the broker either way.
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
  providesPricing: boolean,
): TickerSummary[] {
  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const now = Math.floor(Date.now() / 1000);

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

    // A live-quoting broker only gets second-guessed when it has nothing.
    // An aggregator's own number is the one being second-guessed instead,
    // whenever Yahoo actually has a quote for this ticker.
    const usingFallbackPrice = providesPricing
      ? p.current_price == null && stock?.last_price != null
      : stock?.last_price != null;
    const currentPrice = usingFallbackPrice
      ? sessionAwarePrice(stock)
      : (p.current_price ?? null);

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
    // Matched broadly (any non-"CLOSED" state) rather than an exact list —
    // Yahoo's further-extended POSTPOST is still a real completed session
    // with real data, same reasoning as sessionAwarePrice above.
    const isLiveSession =
      stock?.market_state != null &&
      stock.market_state !== "" &&
      stock.market_state !== "CLOSED";
    const brokerDailyChangePct =
      p.change_today != null ? p.change_today * 100 : null;
    const dailyChangePct = usingFallbackPrice
      ? sessionAwareChangePct(stock)
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
      // Freshness follows whichever source actually priced this row. When
      // the broker's own number is in play (a live-quoting broker, or a
      // symbol Yahoo can't price), the position snapshot is what's current;
      // when Yahoo priced it instead, its own fetch time is what's current —
      // using the broker's stale sync time there would flag a live price as
      // "stale".
      isStale: usingFallbackPrice
        ? stock?.last_fetched_at == null ||
          now - stock.last_fetched_at > STALE_THRESHOLD_SECONDS
        : now - p.snapshot_at > STALE_THRESHOLD_SECONDS,
      lastFetchedAt: usingFallbackPrice
        ? (stock?.last_fetched_at ?? p.snapshot_at)
        : p.snapshot_at,
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
