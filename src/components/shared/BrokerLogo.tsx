import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Brokerage icon, fetched by domain through the Rust backend and cached there.
 *
 * The domain comes from the provider's own descriptor, so adding a brokerage
 * means declaring `logo_domain` in Rust and nothing here changes.
 *
 * Falls back to a lettered chip when the brokerage has no icon, or before the
 * first fetch completes — never a broken image and never an empty gap that
 * shifts the layout when the real icon arrives.
 */

const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

async function loadBrand(domain: string): Promise<string | null> {
  const key = domain.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = invoke<{ ticker: string; data_uri: string | null }>(
    "fetch_brand_logo",
    { domain: key },
  )
    .then((r) => {
      cache.set(key, r.data_uri);
      return r.data_uri;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

interface BrokerLogoProps {
  /** e.g. "alpaca.markets". Null renders the lettered fallback. */
  domain?: string | null;
  /** Provider name, used for the fallback letter and the alt text. */
  name: string;
  className?: string;
}

export function BrokerLogo({ domain, name, className }: BrokerLogoProps) {
  const [dataUri, setDataUri] = useState<string | null>(() =>
    domain ? cache.get(domain.toLowerCase()) ?? null : null,
  );

  useEffect(() => {
    if (!domain) {
      setDataUri(null);
      return;
    }
    let cancelled = false;
    loadBrand(domain).then((uri) => {
      if (!cancelled) setDataUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const box = className ?? "w-8 h-8";

  if (!dataUri) {
    return (
      <div
        className={`${box} rounded-lg flex items-center justify-center bg-muted text-muted-foreground text-xs font-bold shrink-0 border border-border`}
        title={name}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={dataUri}
      alt={name}
      title={name}
      className={`${box} rounded-lg object-contain shrink-0 bg-white border border-border`}
    />
  );
}
