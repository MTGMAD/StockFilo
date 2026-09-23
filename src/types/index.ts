export interface Purchase {
  id: number;
  ticker: string;
  shares: number;
  price_per_share: number;
  purchased_at: string; // ISO date string YYYY-MM-DD
  created_at: number; // unix timestamp
  portfolio_id: number;
}

/** A cash event on a manual portfolio — a dividend paid out (not reinvested),
 *  a fee charged against the account, or the proceeds of a sale.
 *
 *  `amount` is signed: dividends and sale proceeds positive, fees negative. A
 *  portfolio's cash balance is just the sum of these rows — see the V18
 *  migration for why dividends/fees are kept independent of `purchases`
 *  rather than reconciled against it. Sales are the one exception: selling
 *  shares does credit cash (see V19), via a `'sale'` row whose
 *  `source_sale_id` points back at the `Sale` that created it. */
export interface CashEvent {
  id: number;
  portfolio_id: number;
  kind: "dividend" | "fee" | "sale";
  ticker: string | null;
  amount: number;
  occurred_at: string; // ISO date string YYYY-MM-DD
  note: string | null;
  created_at: number; // unix timestamp
  source_sale_id: number | null;
}

/** Shares sold from a manual portfolio's position. Combined with `Purchase`,
 *  a ticker's current position is `SUM(purchases.shares) - SUM(sales.shares)`.
 *  Every sale credits its proceeds to cash as a linked `CashEvent`. */
export interface Sale {
  id: number;
  portfolio_id: number;
  ticker: string;
  shares: number;
  price_per_share: number;
  sold_at: string; // ISO date string YYYY-MM-DD
  created_at: number; // unix timestamp
}

export interface Stock {
  ticker: string;
  name: string | null;
  last_price: number | null;
  last_fetched_at: number | null;
  quote_type: string | null;
  daily_change_pct: number | null;
  target_mean_price: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  market_state: string | null;
  dividend_yield: number | null;
}

export interface QuoteResult {
  ticker: string;
  price: number | null;
  name: string | null;
  quote_type: string | null;
  daily_change_pct: number | null;
  target_mean_price: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  market_state: string | null;
  dividend_yield: number | null;
}

export interface TickerSummary {
  ticker: string;
  name: string | null;
  totalShares: number;
  /** Null when the source reports neither a cost basis nor an average entry
   *  price for this position — "not reported", not "free". Seen with some
   *  broker-synced retirement accounts (e.g. a 401k via SnapTrade). */
  totalInvested: number | null;
  avgCostBasis: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  pnlDollar: number | null;
  pnlPercent: number | null;
  isStale: boolean;
  lastFetchedAt: number | null;
  quoteType: string | null;
  dailyChangePct: number | null;
  market_state: string | null;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
  dividendYield: number | null;
}

export interface WatchlistItem {
  id: number;
  ticker: string;
  watch_price: number | null;
  created_at: number;
  notes: string | null;
  notes_updated_at: number | null;
}

export interface TickerSearchResult {
  symbol: string;
  name: string | null;
  exchange: string | null;
  type_disp: string | null;
}

export interface Favorite {
  id: number;
  ticker: string;
  sort_order: number;
  portfolio_id: number;
}

export interface Portfolio {
  id: number;
  name: string;
  sort_order: number;
  is_starred: number; // 0 or 1
  created_at: number;
  /** "manual" for hand-maintained portfolios, otherwise the provider id. */
  source: string;
  /** Set only for broker-linked portfolios. */
  broker_account_id: number | null;
  /** When a spreadsheet/Ameriprise import last completed for this portfolio.
   *  Null until the first one runs. */
  last_import_at: number | null;
}

/** True when this portfolio mirrors a brokerage account and is read-only. */
export function isBrokerPortfolio(p: Portfolio | null | undefined): boolean {
  return !!p && p.source !== "manual" && p.broker_account_id != null;
}

export interface Watchlist {
  id: number;
  name: string;
  sort_order: number;
  created_at: number;
}

export type View = "dashboard" | "portfolio" | "watchlist" | "settings";
export type Theme = "system" | "light" | "dark" | "warm";
export type InvestorMode = "novice" | "advanced";
export type LinkOpenMode = "browser" | "inapp";

/** Rich preview for a URL pasted into a note — see `fetch_link_preview`. */
export interface LinkPreview {
  url: string;
  title: string | null;
  site_name: string | null;
  description: string | null;
  /** `data:image/...;base64,…`, or null when no thumbnail could be found. */
  thumbnail_data_uri: string | null;
  /** Set only for a recognized video provider (currently YouTube). */
  embed_url: string | null;
}

export interface DividendInfo {
  dividend_date: number | null; // Unix timestamp of next payout/ex-dividend date
  dividend_amount_per_share: number | null; // Most recent dividend payment amount per share
  annual_dividend_rate: number | null; // Trailing annual dividend amount per share
  payout_frequency: string | null; // Inferred cadence: monthly, quarterly, annual, etc.
}

export interface ChartPoint {
  timestamp: number;
  close: number;
  /** Present when the provider supplies OHLC; needed for candlesticks.
   *  Null for instruments or intervals Yahoo does not publish them for. */
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

/** How the price chart is drawn. */
export type ChartStyle = "mountain" | "line" | "candles";

export interface ChartData {
  points: ChartPoint[];
  previous_close: number | null;
  current_price: number | null;
}

export type ChartRange =
  | "1d"
  | "5d"
  | "1mo"
  | "6mo"
  | "ytd"
  | "1y"
  | "5y"
  | "max";

export interface NewsArticle {
  title: string;
  url: string;
  source: string | null;
  publisher: string | null;
  published_at: number | null;
  image_url: string | null;
}

export interface UpcomingEarningsEvent {
  ticker: string;
  event_at: number;
}

export interface ComparisonStats {
  ticker: string;
  price: number | null;
  name: string | null;
  daily_change_pct: number | null;
  target_mean_price: number | null;
  post_market_price: number | null;
  post_market_change_pct: number | null;
  pre_market_price: number | null;
  pre_market_change_pct: number | null;
  market_state: string | null;
  market_cap: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  price_to_book: number | null;
  beta: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  dividend_yield: number | null;
  eps_trailing: number | null;
  recommendation_key: string | null;
  number_of_analyst_opinions: number | null;
  gross_margins: number | null;
  operating_margins: number | null;
  profit_margins: number | null;
  revenue_growth: number | null;
}

// ── Sync / Config types ────────────────────────────────────────────────────

/** Flat struct mirroring Rust's SyncTarget — avoids the serde flatten+internally-tagged-enum bug. */
export interface SyncTarget {
  id: string;
  label: string;
  /** Discriminant: "path" or "webdav" */
  kind: "path" | "webdav";
  // path target fields
  path?: string | null;
  // webdav target fields
  url?: string | null;
  username?: string | null;
  password_enc?: string | null;
  last_synced_at?: number | null;
  last_sync_status?: string | null;
}

export interface AppConfig {
  device_id: string;
  db_path?: string | null;
  sync_targets: SyncTarget[];
  auto_sync_minutes?: number | null;
}

export interface SyncResult {
  success: boolean;
  message: string;
  synced_at: number;
  downloaded: boolean;
}

export type SyncStatus = "idle" | "syncing" | "success" | "error";

// ── Brokerage types ────────────────────────────────────────────────────────
// Flat structs mirroring src-tauri/src/brokers/types.rs — same convention as
// SyncTarget, avoiding the serde flatten + tagged-enum bridge bug.

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string | null;
  help: string | null;
}

/** One kind of account a provider offers. */
export interface AccountType {
  /** Stored value; also selects the API environment. */
  id: string;
  /** What the user sees, e.g. "Margin", "Paper", "Cash". */
  label: string;
  /** "margin" | "paper" | "cash" — maps to a colour via lib/accountTypes.ts */
  kind: string;
  description: string | null;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  auth_kind: string; // "fields" | "oauth"
  account_types: AccountType[];
  credential_fields: CredentialField[];
  supports_positions: boolean;
  supports_activities: boolean;
  /** When true the broker prices its own holdings and Yahoo supplies only
   *  reference data (name, asset type, analyst target, dividend yield). */
  provides_pricing: boolean;
  docs_url: string | null;
  logo_domain: string | null;
}

export interface RemoteAccount {
  id: string;
  mask: string | null;
  currency: string;
  equity: number | null;
  cash: number | null;
  buying_power: number | null;
}

export interface BrokerAccountInfo {
  id: number;
  provider_account_id: string;
  account_mask: string | null;
  currency: string;
  equity: number | null;
  cash: number | null;
  /** Brokerage figure only; null for providers that do not report it. */
  buying_power: number | null;
  snapshot_at: number | null;
  portfolio_id: number | null;
  portfolio_name: string | null;
  /** False for a candidate account not yet opted into (e.g. an unselected
   *  SnapTrade account). Always true for a single-account-per-key provider. */
  visible: boolean;
}

export interface BrokerConnectionInfo {
  id: string;
  provider: string;
  provider_name: string;
  /** Domain for the brokerage icon, declared by the provider. */
  provider_logo_domain: string | null;
  environment: string;
  /** Display label for the account type, e.g. "Margin". */
  environment_label: string;
  /** "margin" | "paper" | "cash" — drives the chip colour. */
  environment_kind: string;
  label: string;
  created_at: number;
  last_synced_at: number | null;
  last_sync_status: string | null;
  disabled: boolean;
  /** False when the database came from another device and the keychain here
   *  holds nothing. Surface as "add credentials here", never as an error. */
  has_credentials: boolean;
  device_id: string | null;
  accounts: BrokerAccountInfo[];
}

export interface BrokerSyncResult {
  connection_id: string;
  success: boolean;
  message: string;
  synced_at: number;
  positions: number;
  new_transactions: number;
}

/** A holding exactly as the broker reports it. Nothing here is computed. */
export interface BrokerPosition {
  broker_account_id: number;
  provider_symbol: string;
  /** Yahoo ticker, or null for instruments Yahoo cannot quote (e.g. options).
   *  Null affects reference data only — price and P&L still come from the broker. */
  ticker: string | null;
  asset_class: string | null;
  qty: number;
  avg_entry_price: number | null;
  cost_basis: number | null;
  current_price: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
  /** Fraction, not percent. */
  unrealized_plpc: number | null;
  /** Fraction, not percent. */
  change_today: number | null;
  snapshot_at: number;
}

export interface BrokerTransaction {
  id: number;
  broker_account_id: number;
  external_id: string;
  kind: string;
  side: string | null;
  provider_symbol: string;
  ticker: string | null;
  qty: number | null;
  price: number | null;
  occurred_at: string; // YYYY-MM-DD
}
