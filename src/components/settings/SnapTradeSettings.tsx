import { useState, useEffect, useCallback } from "react";
import {
  KeyRound,
  Link2,
  RefreshCw,
  Trash2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { openUrl } from "../../lib/openUrl";
import type { BrokerConnectionInfo } from "../../types";
import {
  listBrokerConnections,
  syncBrokerConnection,
  deleteBrokerConnection,
  setBrokerAccountVisible,
} from "../../lib/brokers";
import {
  snapTradeAppKeysConfigured,
  saveSnapTradeAppKeys,
  connectSnapTrade,
  syncSnapTradeAuthorizations,
} from "../../lib/snaptrade";

function money(v: number | null | undefined, currency = "USD"): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

interface SnapTradeSettingsProps {
  /** Bumped when connections change, so the sidebar and portfolios reload. */
  onConnectionsChanged?: () => void;
}

/**
 * SnapTrade is an aggregator, not a single brokerage: one connect flow can
 * link many brokerages, each exposing several accounts, and a person picks
 * which of those accounts they actually want mirrored. That's a different
 * shape from `BrokerSettings`' one-credential-form-per-brokerage — hence its
 * own panel rather than folding into that one.
 */
export function SnapTradeSettings({ onConnectionsChanged }: SnapTradeSettingsProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);

  const [connections, setConnections] = useState<BrokerConnectionInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [isConfigured, all] = await Promise.all([
      snapTradeAppKeysConfigured(),
      listBrokerConnections(),
    ]);
    setConfigured(isConfigured);
    setConnections(all.filter((c) => c.provider === "snaptrade"));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleSaveKeys() {
    setSavingKeys(true);
    setMessage(null);
    try {
      await saveSnapTradeAppKeys(clientId.trim(), consumerKey.trim());
      setClientId("");
      setConsumerKey("");
      await reload();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setSavingKeys(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setMessage(null);
    try {
      const url = await connectSnapTrade();
      await openUrl(url, "browser");
      setMessage({
        ok: true,
        text: 'A browser window opened to link your brokerage. Once you’re done there, click "Check for New Accounts" below.',
      });
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setConnecting(false);
    }
  }

  async function handleCheckNew() {
    setChecking(true);
    setMessage(null);
    try {
      const found = await syncSnapTradeAuthorizations();
      await reload();
      onConnectionsChanged?.();
      setMessage({
        ok: true,
        text:
          found > 0
            ? `Found ${found} new brokerage${found === 1 ? "" : "s"} — pick which accounts to show below.`
            : "No new brokerages found.",
      });
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setChecking(false);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    setMessage(null);
    try {
      await syncBrokerConnection(id);
      await reload();
      onConnectionsChanged?.();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleToggleVisible(brokerAccountId: number, visible: boolean) {
    try {
      await setBrokerAccountVisible(brokerAccountId, visible);
      await reload();
      onConnectionsChanged?.();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    }
  }

  async function handleRemove(id: string, keepPortfolio: boolean) {
    try {
      await deleteBrokerConnection(id, keepPortfolio);
      setConfirmRemove(null);
      await reload();
      onConnectionsChanged?.();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    }
  }

  if (configured === null) return null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Link brokerages through SnapTrade — one connection can cover many
        brokerages and accounts. Stockfolio only ever reads: holdings sync in
        read-only, and you choose which accounts show up as portfolios below.
      </p>

      {!configured ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            SnapTrade requires your own developer keys — there is no shared
            Stockfolio key, since one bundled into the app would be exposed to
            everyone who installs it. Sign up for a free SnapTrade account to
            get a Client ID and Consumer Key.
          </p>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Client ID
            </label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Consumer Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={consumerKey}
                onChange={(e) => setConsumerKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-1.5 pr-8 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-2.5 flex gap-2">
            <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Keys are stored in your operating system's credential manager,
              never in the database — so they are not copied to your sync
              target.
            </p>
          </div>
          {message && !message.ok && (
            <div className="flex items-start gap-2 text-sm text-negative">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{message.text}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveKeys}
              disabled={!clientId.trim() || !consumerKey.trim() || savingKeys}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {savingKeys ? "Saving…" : "Save Keys"}
            </button>
            <button
              type="button"
              onClick={() => openUrl("https://snaptrade.com/", "browser")}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              Get SnapTrade keys <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <Link2 className="w-4 h-4" />
              {connecting ? "Opening…" : "Connect a Brokerage"}
            </button>
            <button
              type="button"
              onClick={handleCheckNew}
              disabled={checking}
              className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", checking && "animate-spin")} />
              {checking ? "Checking…" : "Check for New Accounts"}
            </button>
          </div>

          {message && (
            <div
              className={cn(
                "flex items-start gap-1.5 text-xs rounded-md border p-2",
                message.ok
                  ? "border-border bg-muted/40 text-muted-foreground"
                  : "border-negative/30 bg-negative/10 text-negative",
              )}
            >
              {message.ok ? (
                <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {connections.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No brokerages connected yet.
            </p>
          )}

          {connections.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground truncate">
                    {c.label}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.accounts.filter((a) => a.visible).length} of{" "}
                    {c.accounts.length} account
                    {c.accounts.length === 1 ? "" : "s"} shown
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSync(c.id)}
                    disabled={syncingId === c.id}
                    title="Sync now"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                  >
                    <RefreshCw
                      className={cn("w-4 h-4", syncingId === c.id && "animate-spin")}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(c.id)}
                    title="Disconnect"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-negative hover:bg-accent transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {c.accounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center justify-between gap-3 text-xs rounded-md bg-muted/40 px-2.5 py-1.5 cursor-pointer"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={a.visible}
                        onChange={(e) => handleToggleVisible(a.id, e.target.checked)}
                        className="shrink-0"
                      />
                      <span className="truncate text-muted-foreground">
                        {a.portfolio_name ?? a.account_mask ?? a.provider_account_id}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {money(a.equity, a.currency)}
                    </span>
                  </label>
                ))}
              </div>

              {confirmRemove === c.id && (
                <div className="rounded-md border border-negative/30 bg-negative/10 p-2.5 space-y-2">
                  <p className="text-xs text-foreground">
                    Disconnect {c.label}? Its keys are removed from this device
                    either way.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleRemove(c.id, true)}
                      className="btn-secondary text-xs"
                    >
                      Keep empty portfolios
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(c.id, false)}
                      className="px-2.5 py-1 rounded-md bg-negative text-white text-xs font-medium hover:opacity-90"
                    >
                      Remove portfolios too
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="btn-secondary text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
