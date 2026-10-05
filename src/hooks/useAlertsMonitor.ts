import { useState, useEffect, useCallback, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  listAllWatchlistItems,
  markAlertTriggered,
  acknowledgeAllAlerts,
  fetchAndCachePrices,
  getCachedStocks,
  type WatchlistItemFull,
} from "../lib/db";
import { useAlertSettings } from "./useAlertSettings";
import { playAlertSound } from "../lib/alertSounds";

const POLL_INTERVAL_MS = 30_000;

/** "Pending" = fired since it was last acknowledged — lets a re-armed alert
 *  (edited target) become pending again even if the old firing was seen. */
export function isAlertPending(item: WatchlistItemFull): boolean {
  return (
    item.alert_triggered_at != null &&
    (item.alert_acknowledged_at == null ||
      item.alert_acknowledged_at < item.alert_triggered_at)
  );
}

/**
 * Global, view-independent price-alert monitor — mounted once in App.tsx so
 * alerts fire no matter which screen is open, unlike the per-watchlist
 * polling in useWatchlist.ts which only runs while the Watch List view is
 * mounted. Fires a native OS notification plus the user's chosen sound the
 * moment an armed alert's price condition is met, then persists the firing
 * via db_mark_alert_triggered so it can't re-fire on the next tick.
 */
export function useAlertsMonitor() {
  const [items, setItems] = useState<WatchlistItemFull[]>([]);
  const { soundId, soundEnabled } = useAlertSettings();
  const settingsRef = useRef({ soundId, soundEnabled });
  settingsRef.current = { soundId, soundEnabled };

  const reload = useCallback(async () => {
    const all = await listAllWatchlistItems();
    setItems(all.filter((i) => i.alert_target_price != null));
  }, []);

  // Ask for OS notification permission once, up front, rather than at the
  // moment of the first firing — by then the user may be looking away.
  useEffect(() => {
    isPermissionGranted()
      .then((granted) => {
        if (!granted) return requestPermission();
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      let armed: WatchlistItemFull[];
      try {
        const all = await listAllWatchlistItems();
        armed = all.filter((i) => i.alert_target_price != null);
      } catch {
        return;
      }
      if (cancelled) return;
      setItems(armed);

      const unfired = armed.filter((i) => i.alert_triggered_at == null);
      if (unfired.length === 0) return;

      const tickers = [...new Set(unfired.map((i) => i.ticker))];
      try {
        await fetchAndCachePrices(tickers);
      } catch {
        return;
      }
      if (cancelled) return;

      const stocks = await getCachedStocks();
      const priceByTicker = new Map(stocks.map((s) => [s.ticker, s.last_price]));

      let anyFired = false;
      for (const item of unfired) {
        const price = priceByTicker.get(item.ticker);
        if (price == null || item.alert_target_price == null) continue;
        const hit =
          item.alert_direction === "above"
            ? price >= item.alert_target_price
            : price <= item.alert_target_price;
        if (!hit) continue;

        anyFired = true;
        await markAlertTriggered(item.id).catch(() => {});

        const granted = await isPermissionGranted().catch(() => false);
        if (granted) {
          try {
            sendNotification({
              title: `${item.ticker} hit your price target`,
              body: `Now $${price.toFixed(2)} — target was ${
                item.alert_direction === "above" ? "≥" : "≤"
              } $${item.alert_target_price.toFixed(2)}.`,
            });
          } catch {
            // Delivery is best-effort — never let a notification failure
            // stop the sound or the next alert in this batch from firing.
          }
        }

        if (settingsRef.current.soundEnabled) {
          playAlertSound(settingsRef.current.soundId);
        }
      }

      if (anyFired && !cancelled) await reload();
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [reload]);

  const unacknowledgedCount = items.filter(isAlertPending).length;

  const acknowledgeAll = useCallback(async () => {
    await acknowledgeAllAlerts();
    await reload();
  }, [reload]);

  return { items, unacknowledgedCount, reload, acknowledgeAll };
}
