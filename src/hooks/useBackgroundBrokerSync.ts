import { useEffect, useRef } from "react";
import { listBrokerConnections, syncBrokerConnection } from "../lib/brokers";

/** How stale a connection may get before the background pass refreshes it. */
const REFRESH_AFTER_SECS = 120;
/** How often to check for due connections. Cheap — it only reads the local DB. */
const CHECK_EVERY_MS = 30_000;

/**
 * Keeps every broker connection fresh, not just the portfolio on screen —
 * without this, the other accounts' figures (sidebar, header, dashboard) only
 * moved when you opened them.
 *
 * Each pass re-reads `last_synced_at` from the database, so a connection the
 * open portfolio has just synced (it polls every 30s on its own) isn't synced
 * again here. Connections run one after another, never in parallel, and the
 * brokerage rate limits are enforced in Rust (see the SnapTrade client's
 * `AccountLimiter`), so an overlapping sync is throttled there rather than
 * sent.
 *
 * Also runs when the window regains focus, so coming back to the app shows
 * current numbers without waiting for the next tick.
 */
export function useBackgroundBrokerSync(onSynced: () => Promise<void> | void) {
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    let running = false;
    let cancelled = false;

    async function pass() {
      if (running || cancelled) return;
      running = true;
      try {
        const now = Date.now() / 1000;
        const due = (await listBrokerConnections()).filter(
          (c) =>
            !c.disabled &&
            c.has_credentials &&
            c.accounts.some((a) => a.visible) &&
            (c.last_synced_at == null ||
              now - c.last_synced_at >= REFRESH_AFTER_SECS),
        );
        let synced = false;
        for (const c of due) {
          if (cancelled) return;
          try {
            await syncBrokerConnection(c.id);
            synced = true;
          } catch {
            // Recorded on the connection as last_sync_status; the Settings
            // card shows it. Nothing to interrupt the person with here.
          }
        }
        if (synced && !cancelled) await onSyncedRef.current();
      } catch {
        // Listing connections failed (e.g. DB busy) — next tick retries.
      } finally {
        running = false;
      }
    }

    void pass();
    const id = setInterval(pass, CHECK_EVERY_MS);
    const onFocus = () => void pass();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
