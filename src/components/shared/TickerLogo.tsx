import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const LOGO_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
  "#14b8a6", "#06b6d4", "#84cc16", "#f59e0b",
];

interface TickerLogoProps {
  ticker: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Logos are fetched by the Rust backend and cached on disk there.
 *
 * The webview never requests them directly: the app's whole network surface
 * lives in Rust, and a webview can silently fail to reach a host the backend
 * reaches without trouble — which shows up as every logo falling back to
 * initials for no visible reason.
 *
 * This module-level cache exists because a portfolio table mounts dozens of
 * these at once; without it each row would issue its own command for the same
 * handful of symbols on every render pass.
 */
const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

async function loadLogo(ticker: string): Promise<string | null> {
  const key = ticker.toUpperCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = invoke<{ ticker: string; data_uri: string | null }>(
    "fetch_ticker_logo",
    { ticker: key },
  )
    .then((r) => {
      cache.set(key, r.data_uri);
      return r.data_uri;
    })
    .catch(() => {
      // Don't cache a failure: it may be a transient network problem, and the
      // initials fallback already covers the gap in the meantime.
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export function TickerLogo({ ticker, size = "md" }: TickerLogoProps) {
  const [dataUri, setDataUri] = useState<string | null>(
    () => cache.get(ticker.toUpperCase()) ?? null,
  );

  useEffect(() => {
    let cancelled = false;
    loadLogo(ticker).then((uri) => {
      if (!cancelled) setDataUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const color = LOGO_COLORS[ticker.charCodeAt(0) % LOGO_COLORS.length];
  const initials = ticker.slice(0, 2).toUpperCase();
  const cls =
    size === "sm"
      ? "w-6 h-6 text-[9px]"
      : size === "lg"
        ? "w-10 h-10 text-xs"
        : "w-8 h-8 text-[10px]";

  if (!dataUri) {
    return (
      <div
        className={`${cls} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={dataUri}
      alt={ticker}
      className={`${cls} rounded-full object-contain shrink-0 bg-white border border-border`}
    />
  );
}
