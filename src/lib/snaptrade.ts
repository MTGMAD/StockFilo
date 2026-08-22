/**
 * snaptrade.ts — SnapTrade connect flow.
 *
 * Separate from brokers.ts: SnapTrade connects through a hosted browser
 * portal rather than a credential form, so it needs its own thin commands.
 * Once a brokerage is linked, though, it behaves like any other connection —
 * listBrokerConnections, syncBrokerConnection, setBrokerAccountVisible, and
 * deleteBrokerConnection (all in brokers.ts) work on it unchanged.
 */
import { invoke } from "@tauri-apps/api/core";

/** Store this app's SnapTrade developer keys (Client ID + Consumer Key) on this device. */
export async function saveSnapTradeAppKeys(
  clientId: string,
  consumerKey: string,
): Promise<void> {
  return invoke("snaptrade_save_app_keys", { clientId, consumerKey });
}

/** Whether SnapTrade developer keys have been saved on this device yet. */
export async function snapTradeAppKeysConfigured(): Promise<boolean> {
  return invoke<boolean>("snaptrade_app_keys_configured");
}

/**
 * Ensure a SnapTrade user is registered for this install, then return a fresh
 * Connection Portal URL to open in the browser.
 */
export async function connectSnapTrade(): Promise<string> {
  return invoke<string>("snaptrade_connect");
}

/**
 * Look for brokerage authorizations SnapTrade now reports that aren't
 * connected here yet, creating a connection for each. Returns how many new
 * ones were found; their accounts start hidden until chosen with
 * setBrokerAccountVisible.
 */
export async function syncSnapTradeAuthorizations(): Promise<number> {
  return invoke<number>("snaptrade_sync_authorizations");
}
