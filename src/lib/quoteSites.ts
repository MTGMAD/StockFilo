import { createContext } from "react";

/** Where clicking a ticker opens its quote page. */
export type QuoteSite = "yahoo" | "stockanalysis" | "tradingview" | "fidelity";

export const QUOTE_SITES: { id: QuoteSite; label: string; description: string }[] = [
  { id: "yahoo", label: "Yahoo Finance", description: "finance.yahoo.com" },
  { id: "stockanalysis", label: "Stock Analysis", description: "stockanalysis.com" },
  { id: "tradingview", label: "TradingView", description: "tradingview.com" },
  { id: "fidelity", label: "Fidelity", description: "fidelity.com research" },
];

export function quoteSiteLabel(site: QuoteSite): string {
  return QUOTE_SITES.find((s) => s.id === site)?.label ?? "Yahoo Finance";
}

/**
 * Quote page for `ticker` on `site`. Tickers are stored in Yahoo's form, which
 * writes share classes with a dash (BRK-B); the other sites use a dot (BRK.B).
 * None of them need the exchange: TradingView resolves a bare symbol to its
 * primary listing, and Stock Analysis redirects ETFs from /stocks/ to /etf/.
 */
export function quoteSiteUrl(site: QuoteSite, ticker: string): string {
  const dotted = ticker.replace(/-/g, ".");
  switch (site) {
    case "stockanalysis":
      return `https://stockanalysis.com/stocks/${encodeURIComponent(dotted.toLowerCase())}/`;
    case "tradingview":
      return `https://www.tradingview.com/symbols/${encodeURIComponent(dotted)}/`;
    case "fidelity":
      return `https://digital.fidelity.com/prgw/digital/research/quote/dashboard/summary?symbol=${encodeURIComponent(dotted)}`;
    default:
      return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
  }
}

/** Provided once in App so every ticker link follows the Settings choice
 *  without threading it through each view as a prop. */
export const QuoteSiteContext = createContext<QuoteSite>("yahoo");
