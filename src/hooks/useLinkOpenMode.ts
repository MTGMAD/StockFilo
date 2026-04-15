import { useState, useCallback } from "react";
import type { LinkOpenMode } from "../types";

const LINK_OPEN_MODE_KEY = "stockfilo-link-open-mode";

export function useLinkOpenMode() {
  const [linkOpenMode, setModeState] = useState<LinkOpenMode>(
    () => (localStorage.getItem(LINK_OPEN_MODE_KEY) as LinkOpenMode) ?? "browser"
  );

  const setLinkOpenMode = useCallback((m: LinkOpenMode) => {
    localStorage.setItem(LINK_OPEN_MODE_KEY, m);
    setModeState(m);
  }, []);

  return { linkOpenMode, setLinkOpenMode };
}
