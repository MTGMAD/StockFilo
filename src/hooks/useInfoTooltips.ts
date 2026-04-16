import { useState, useCallback } from "react";

const KEY = "stockfilo-info-tooltips";

export function useInfoTooltips() {
  const [showInfoTooltips, setShowState] = useState<boolean>(
    () => (localStorage.getItem(KEY) ?? "true") === "true"
  );

  const setShowInfoTooltips = useCallback((v: boolean) => {
    localStorage.setItem(KEY, String(v));
    setShowState(v);
  }, []);

  return { showInfoTooltips, setShowInfoTooltips };
}
