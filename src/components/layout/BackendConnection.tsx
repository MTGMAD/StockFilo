import { useCallback, useEffect, useState, type ReactNode } from "react";
import { isDesktop } from "../../lib/platform";

/** Do not mount data hooks until the local browser backend is available. */
export function BackendConnection({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(isDesktop);
  const [checking, setChecking] = useState(true);
  const connect = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/health");
      const health = await response.json();
      setConnected(response.ok && health.status === "ok");
    } catch { setConnected(false); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { if (!isDesktop()) void connect(); }, [connect]);
  if (connected) return children;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background text-foreground p-8">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Stockfolio</h1>
        <p>{checking ? "Connecting to Stockfolio…" : "Start Stockfolio on this computer to connect to your portfolios and sync settings."}</p>
        <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50" disabled={checking} onClick={() => void connect()}>
          {checking ? "Connecting…" : "Reconnect"}
        </button>
      </div>
    </main>
  );
}
