export interface Purchase {
  id: number;
  ticker: string;
  shares: number;
  price_per_share: number;
  purchased_at: string; // ISO date string YYYY-MM-DD
  created_at: number;   // unix timestamp
}

export interface Stock {
  ticker: string;
  name: string | null;
  last_price: number | null;
  last_fetched_at: number | null;
  quote_type: string | null;
}

export interface QuoteResult {
  ticker: string;
  price: number | null;
  name: string | null;
  quote_type: string | null;
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
}

export interface WatchlistItem {
  id: number;
  ticker: string;
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
}

export type View = 'purchases' | 'analysis' | 'watchlist' | 'settings';
export type Theme = 'system' | 'light' | 'dark';

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
