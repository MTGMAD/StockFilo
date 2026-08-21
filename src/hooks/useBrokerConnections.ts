import { useState, useEffect, useCallback } from "react";
import type { BrokerConnectionInfo } from "../types";
import { listBrokerConnections } from "../lib/brokers";

/**
 * Configured brokerage connections.
 *
 * Never carries credentials — `has_credentials` only reports whether the OS
 * keychain on *this* device holds them, which is false for connections that
 * arrived via database sync from another machine.
 */
export function useBrokerConnections() {
  const [connections, setConnections] = useState<BrokerConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setConnections(await listBrokerConnections());
      setError(null);
    } catch (e) {
      // A failure here must not blank the portfolio list, so keep the last
      // known connections and surface the problem separately.
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { connections, loading, error, reload };
}
