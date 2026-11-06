import { useEffect } from "react";
import { captureManualAccountValues } from "../lib/manualValues";

/** Often enough to catch a new day in an app left open. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Saves each manual portfolio's daily value on its own, so the history builds
 * whether or not anyone opens that portfolio's Journal.
 */
export function useManualAccountValues() {
  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await captureManualAccountValues();
      } catch {
        // Listing portfolios failed (e.g. DB busy); the next check retries.
      } finally {
        running = false;
      }
    };
    void run();
    const id = setInterval(run, CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, []);
}
