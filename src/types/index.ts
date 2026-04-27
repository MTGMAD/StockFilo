export interface Purchase {
  id: number;
  ticker: string;
  shares: number;
  price_per_share: number;
  purchased_at: string; // ISO date string YYYY-MM-DD
  created_at: number;   // unix timestamp
  portfolio_id: number;
}

export interface Stock {
  ticker: string;
  name: string | null;
  last_price: number | null;
  last_fetched_at: number | null;
  quote_type: string | null;
  daily_change_pct: number | null;
  target_mean_price: number | null;
}

export interface QuoteResult {
  ticker: string;
  price: number | null;
  name: string | null;
  quote_type: string | null;
  daily_change_pct: number | null;
  target_mean_price: number | null;
}

export interface TickerSummary {
  ticker: string;
  name: string | null;
  totalShares: number;
  totalInvested: number;
  avgCostBasis: number;
  currentPrice: number | null;
  marketValue: number | null;
  pnlDollar: number | null;
  pnlPercent: number | null;
  isStale: boolean;
  lastFetchedAt: number | null;
  quoteType: string | null;
  dailyChangePct: number | null;
}

export interface WatchlistItem {
  id: number;
  ticker: string;
  watch_price: number | null;
  created_at: number;
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
}

export interface Watchlist {
  id: number;
  name: string;
  sort_order: number;
  created_at: number;
}

export type View = 'dashboard' | 'portfolio' | 'watchlist' | 'settings';
export type Theme = 'system' | 'light' | 'dark' | 'warm';
export type InvestorMode = 'novice' | 'advanced';
export type LinkOpenMode = 'browser' | 'inapp';

export interface ChartPoint {
  timestamp: number;
  close: number;
}

export interface ChartData {
  points: ChartPoint[];
  previous_close: number | null;
  current_price: number | null;
}

export type ChartRange = '1d' | '5d' | '1mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max';

export interface NewsArticle {
  title: string;
  url: string;
  publisher: string | null;
  image_url: string | null;
}

export interface UpcomingEarningsEvent {
  ticker: string;
  event_at: number;
}
