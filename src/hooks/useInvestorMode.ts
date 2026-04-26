import { useState, useCallback } from "react";
import type { InvestorMode } from "../types";

const MODE_KEY = "stockfolio-investor-mode";

export function useInvestorMode() {
  const [investorMode, setModeState] = useState<InvestorMode>(
    () => (localStorage.getItem(MODE_KEY) as InvestorMode) ?? "novice"
  );

  const setInvestorMode = useCallback((m: InvestorMode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  }, []);

  return { investorMode, setInvestorMode };
}
