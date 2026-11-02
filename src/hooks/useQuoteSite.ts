import { useState, useCallback } from "react";
import { QUOTE_SITES, type QuoteSite } from "../lib/quoteSites";

const QUOTE_SITE_KEY = "stockfolio-quote-site";

export function useQuoteSite() {
  const [quoteSite, setSiteState] = useState<QuoteSite>(() => {
    const saved = localStorage.getItem(QUOTE_SITE_KEY);
    return QUOTE_SITES.some((s) => s.id === saved) ? (saved as QuoteSite) : "yahoo";
  });

  const setQuoteSite = useCallback((s: QuoteSite) => {
    localStorage.setItem(QUOTE_SITE_KEY, s);
    setSiteState(s);
  }, []);

  return { quoteSite, setQuoteSite };
}
