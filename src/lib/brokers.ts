/**
 * brokers.ts — Brokerage connections.
 *
 * Thin invoke wrappers, mirroring the style of db.ts. Nothing here is
 * provider-specific: the UI discovers what a provider needs from
 * listBrokerProviders(), so adding a brokerage is a Rust-only change.
 */
import { invoke } from "./platform";
import type {
  BrokerConnectionInfo,
  BrokerOrders,
  BrokerPosition,
  BrokerSyncResult,
  BrokerAccountSnapshot,
  BrokerTransaction,
  ProviderDescriptor,
  RemoteAccount,
} from "../types";

/** Providers the app can connect to, with the fields each one needs. */
export async function listBrokerProviders(): Promise<ProviderDescriptor[]> {
  return invoke<ProviderDescriptor[]>("broker_list_providers");
}

/**
 * Verify credentials without saving anything.
 * Returns the accounts they unlock, so the user can confirm before committing.
 */
export async function testBrokerConnection(
  provider: string,
  environment: string,
  credentials: Record<string, string>,
): Promise<RemoteAccount[]> {
  return invoke<RemoteAccount[]>("broker_test_connection", {
    provider,
    environment,
    credentials,
  });
}

/**
 * Verify, store the secret in the OS keychain, and create the connection
 * plus a linked portfolio per account. Returns the connection id.
 */
export async function saveBrokerConnection(
  provider: string,
  environment: string,
  label: string | null,
  credentials: Record<string, string>,
): Promise<string> {
  return invoke<string>("broker_save_connection", {
    provider,
    environment,
    label,
    credentials,
  });
}

/**
 * Attach credentials to an existing connection that has none on this device —
 * e.g. one that arrived via a database sync from another machine. Verifies
 * against the brokerage before storing, and returns the accounts it unlocks.
 */
export async function addBrokerCredentials(
  id: string,
  credentials: Record<string, string>,
): Promise<RemoteAccount[]> {
  return invoke<RemoteAccount[]>("broker_add_credentials", { id, credentials });
}

/** Configured connections. Never includes credentials. */
export async function listBrokerConnections(): Promise<BrokerConnectionInfo[]> {
  return invoke<BrokerConnectionInfo[]>("broker_list_connections");
}

/**
 * Show or hide one account. Hiding removes its portfolio without forgetting
 * the account — re-showing it needs no resync. For aggregator connections
 * (SnapTrade) where one login can expose more accounts than should be
 * mirrored; direct providers never need this.
 */
export async function setBrokerAccountVisible(
  brokerAccountId: number,
  visible: boolean,
): Promise<void> {
  return invoke("broker_set_account_visible", {
    brokerAccountId,
    visible,
  });
}

export async function updateBrokerConnection(
  id: string,
  changes: { label?: string; disabled?: boolean; autoSyncMinutes?: number },
): Promise<void> {
  return invoke("broker_update_connection", {
    id,
    label: changes.label ?? null,
    disabled: changes.disabled ?? null,
    autoSyncMinutes: changes.autoSyncMinutes ?? null,
  });
}

/**
 * Disconnect without losing anything: keys are removed and syncing stops, but
 * the portfolio, its holdings and its full transaction history stay.
 */
export async function archiveBrokerConnection(id: string): Promise<void> {
  return invoke("broker_archive_connection", { id });
}

/**
 * Permanently delete a connection and everything it synced. `keepPortfolio`
 * converts the linked portfolio to an empty manual one instead of deleting
 * it; either way the keychain entry is removed.
 */
export async function deleteBrokerConnection(
  id: string,
  keepPortfolio: boolean,
): Promise<void> {
  return invoke("broker_delete_connection", { id, keepPortfolio });
}

/** Refresh one connection: positions, and activity history where supported. */
export async function syncBrokerConnection(
  connectionId: string,
): Promise<BrokerSyncResult> {
  if (syncHolds > 0) {
    return {
      connection_id: connectionId,
      success: true,
      message: "Paused while a database sync is being reviewed",
      synced_at: 0,
      positions: 0,
      new_transactions: 0,
    };
  }
  return invoke<BrokerSyncResult>("broker_sync_connection", { connectionId });
}

let syncHolds = 0;

/**
 * Pause broker syncing until the returned release is called. A database
 * sync review is approved against an exact fingerprint of the local
 * database, and every broker sync rewrites positions and timestamps — with
 * several connections polling, the review would almost never survive long
 * enough to be confirmed. Skipped syncs simply run on the next tick.
 */
export function holdBrokerSync(): () => void {
  syncHolds += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      syncHolds -= 1;
    }
  };
}

/** Refresh every enabled connection that has credentials on this device. */
export async function syncAllBrokers(): Promise<BrokerSyncResult[]> {
  return invoke<BrokerSyncResult[]>("broker_sync_all");
}

/** Current holdings for one account, as the broker last reported them. */
export async function listBrokerPositions(
  brokerAccountId: number,
): Promise<BrokerPosition[]> {
  return invoke<BrokerPosition[]>("broker_list_positions", { brokerAccountId });
}

/** Every order on one broker account, fetched live, plus the broker's status list. */
export async function listBrokerOrders(
  brokerAccountId: number,
): Promise<BrokerOrders> {
  return invoke<BrokerOrders>("broker_list_orders", { brokerAccountId });
}

/** Dated transaction history for one account. */
export async function listBrokerTransactions(
  brokerAccountId: number,
): Promise<BrokerTransaction[]> {
  return invoke<BrokerTransaction[]>("broker_list_transactions", {
    brokerAccountId,
  });
}

/** One account's daily value history, oldest first. */
export async function listBrokerSnapshots(
  brokerAccountId: number,
): Promise<BrokerAccountSnapshot[]> {
  return invoke<BrokerAccountSnapshot[]>("broker_list_snapshots", {
    brokerAccountId,
  });
}
