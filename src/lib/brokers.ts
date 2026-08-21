/**
 * brokers.ts — Brokerage connections.
 *
 * Thin invoke wrappers, mirroring the style of db.ts. Nothing here is
 * provider-specific: the UI discovers what a provider needs from
 * listBrokerProviders(), so adding a brokerage is a Rust-only change.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  BrokerConnectionInfo,
  BrokerPosition,
  BrokerSyncResult,
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

/** Configured connections. Never includes credentials. */
export async function listBrokerConnections(): Promise<BrokerConnectionInfo[]> {
  return invoke<BrokerConnectionInfo[]>("broker_list_connections");
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
 * Disconnect. `keepPortfolio` converts the linked portfolio to an empty manual
 * one instead of deleting it; either way the keychain entry is removed.
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
  return invoke<BrokerSyncResult>("broker_sync_connection", { connectionId });
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

/** Dated transaction history for one account. */
export async function listBrokerTransactions(
  brokerAccountId: number,
): Promise<BrokerTransaction[]> {
  return invoke<BrokerTransaction[]>("broker_list_transactions", {
    brokerAccountId,
  });
}
