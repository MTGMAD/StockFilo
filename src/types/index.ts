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
}

export interface QuoteResult {
  ticker: string;
  price: number | null;
  name: string | null;
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
}

export type View = 'purchases' | 'analysis' | 'settings';
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
