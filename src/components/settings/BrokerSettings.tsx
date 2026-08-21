import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Link2,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { openUrl } from "../../lib/openUrl";
import { accountKindStyle, isRealMoney } from "../../lib/accountTypes";
import type {
  BrokerConnectionInfo,
  ProviderDescriptor,
  RemoteAccount,
} from "../../types";
import {
  listBrokerProviders,
  listBrokerConnections,
  testBrokerConnection,
  saveBrokerConnection,
  deleteBrokerConnection,
  syncBrokerConnection,
} from "../../lib/brokers";

function formatTs(ts: number | null | undefined): string {
  if (!ts) return "Never";
  return new Date(ts * 1000).toLocaleString();
}

function money(v: number | null | undefined, currency = "USD"): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

// ── Connect form ───────────────────────────────────────────────────────────

interface ConnectFormProps {
  providers: ProviderDescriptor[];
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * The form renders itself from the provider descriptor — field labels, which
 * inputs are secrets, which environments exist. A future brokerage needing
 * four fields gets four with no change here.
 */
function ConnectForm({ providers, onSaved, onCancel }: ConnectFormProps) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];

  const [environment, setEnvironment] = useState(
    provider?.account_types[0]?.id ?? "live",
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [label, setLabel] = useState("");

  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<RemoteAccount[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching provider invalidates anything already typed or verified.
  useEffect(() => {
    setValues({});
    setTested(null);
    setError(null);
    setEnvironment(provider?.account_types[0]?.id ?? "live");
  }, [providerId, provider]);

  // Editing credentials invalidates a previous successful test.
  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setTested(null);
  }

  const selectedType = provider?.account_types.find((t) => t.id === environment);

  const complete =
    provider?.credential_fields.every((f) => (values[f.key] ?? "").trim()) ??
    false;

  async function handleTest() {
    if (!provider) return;
    setTesting(true);
    setError(null);
    setTested(null);
    try {
      setTested(await testBrokerConnection(provider.id, environment, values));
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!provider) return;
    setSaving(true);
    setError(null);
    try {
      await saveBrokerConnection(
        provider.id,
        environment,
        label.trim() || null,
        values,
      );
      onSaved();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  if (!provider) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Provider */}
      {providers.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProviderId(p.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                p.id === providerId
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Account type — labels and colours come from the provider */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Account Type
        </label>
        <div className="flex gap-2 flex-wrap">
          {provider.account_types.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setEnvironment(t.id);
                setTested(null);
              }}
              title={t.description ?? undefined}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                t.id === environment
                  ? accountKindStyle(t.kind).selected
                  : "border-border text-muted-foreground hover:border-primary/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {selectedType?.description && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {selectedType.description}
          </p>
        )}
      </div>

      {/* Credential fields, straight from the descriptor */}
      {provider.credential_fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {f.label}
          </label>
          <div className="relative">
            <input
              type={f.secret && !shown[f.key] ? "password" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder ?? ""}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-1.5 pr-8 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {f.secret && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() =>
                  setShown((s) => ({ ...s, [f.key]: !s[f.key] }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {shown[f.key] ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
          {f.help && (
            <p className="text-xs text-muted-foreground mt-1">{f.help}</p>
          )}
        </div>
      ))}

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`${provider.name} — ${selectedType?.label ?? environment}`}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {isRealMoney(selectedType?.kind) && (
        <div className="rounded-md border border-account-margin/30 bg-account-margin/10 p-2.5 flex gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-account-margin" />
          <p className="text-xs text-foreground leading-relaxed">
            This is a real-money account. Stockfolio will read its holdings and
            show them as a portfolio — it never places or cancels orders.
          </p>
        </div>
      )}

      <div className="rounded-md border border-border bg-muted/40 p-2.5 flex gap-2">
        <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Keys are stored in your operating system's credential manager, never
          in the database — so they are not copied to your sync target.
          Stockfolio only ever reads from {provider.name}; it cannot place or
          cancel orders.
        </p>
      </div>

      {tested && (
        <div className="rounded-md border border-positive/30 bg-positive/10 p-2.5">
          <div className="flex items-center gap-2 text-sm text-positive font-medium">
            <CheckCircle className="w-4 h-4 shrink-0" />
            Connected — {tested.length} account
            {tested.length === 1 ? "" : "s"} found
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {tested.map((a) => (
              <li key={a.id} className="text-xs text-muted-foreground">
                {a.mask ?? a.id} · {money(a.equity, a.currency)} equity ·{" "}
                {money(a.cash, a.currency)} cash
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-negative">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleTest}
          disabled={!complete || testing}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test Connection"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!tested || saving}
          className="btn-primary text-sm disabled:opacity-50"
          title={!tested ? "Test the connection first" : undefined}
        >
          {saving ? "Connecting…" : "Connect"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-sm">
          Cancel
        </button>
        {provider.docs_url && (
          <button
            type="button"
            onClick={() => openUrl(provider.docs_url!, "browser")}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Where do I find my keys? <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

interface BrokerSettingsProps {
  /** Bumped when connections change, so the sidebar and portfolios reload. */
  onConnectionsChanged?: () => void;
  /** Bumped to open the connect form directly, e.g. from the sidebar's
   *  "New portfolio → Brokerage" route. */
  openFormTrigger?: number;
}

export function BrokerSettings({
  onConnectionsChanged,
  openFormTrigger,
}: BrokerSettingsProps) {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [connections, setConnections] = useState<BrokerConnectionInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        listBrokerProviders(),
        listBrokerConnections(),
      ]);
      setProviders(p);
      setConnections(c);
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (openFormTrigger && openFormTrigger > 0) setShowForm(true);
  }, [openFormTrigger]);

  async function handleSync(id: string) {
    setSyncing(id);
    setMessages((m) => ({ ...m, [id]: { ok: true, text: "Syncing…" } }));
    try {
      const r = await syncBrokerConnection(id);
      setMessages((m) => ({ ...m, [id]: { ok: true, text: r.message } }));
      await reload();
      onConnectionsChanged?.();
    } catch (e) {
      setMessages((m) => ({ ...m, [id]: { ok: false, text: String(e) } }));
    } finally {
      setSyncing(null);
    }
  }

  async function handleRemove(id: string, keepPortfolio: boolean) {
    try {
      await deleteBrokerConnection(id, keepPortfolio);
      setConfirmRemove(null);
      await reload();
      onConnectionsChanged?.();
    } catch (e) {
      setMessages((m) => ({ ...m, [id]: { ok: false, text: String(e) } }));
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-negative py-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Failed to load brokerages: {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {connections.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">
          Connect a brokerage to mirror its accounts as read-only portfolios.
          Holdings, prices and profit come straight from the broker, so the
          numbers always match what they show you. Your hand-entered portfolios
          are untouched.
        </p>
      )}

      {connections.map((c) => {
        const msg = messages[c.id];
        return (
          <div
            key={c.id}
            className="rounded-lg border border-border bg-card p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground truncate">
                    {c.label}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide",
                      accountKindStyle(c.environment_kind).chip,
                    )}
                  >
                    {c.environment_label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last synced: {formatTs(c.last_synced_at)}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleSync(c.id)}
                  disabled={syncing === c.id || !c.has_credentials}
                  title={
                    c.has_credentials
                      ? "Sync now"
                      : "Credentials are not stored on this device"
                  }
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                >
                  <RefreshCw
                    className={cn(
                      "w-4 h-4",
                      syncing === c.id && "animate-spin",
                    )}
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

            {/* A synced database carries connections whose keys live on another
                machine. That is expected, not an error. */}
            {!c.has_credentials && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md border border-border bg-muted/40 p-2">
                <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Connected on another device. Its portfolios are visible but
                  cannot refresh here until you add the keys on this machine.
                </span>
              </div>
            )}

            {c.accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 text-xs rounded-md bg-muted/40 px-2.5 py-1.5"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                  <Link2 className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {a.portfolio_name ?? a.account_mask ?? a.provider_account_id}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {money(a.equity, a.currency)}
                </span>
              </div>
            ))}

            {msg && (
              <div
                className={cn(
                  "flex items-start gap-1.5 text-xs",
                  msg.ok ? "text-muted-foreground" : "text-negative",
                )}
              >
                {msg.ok ? (
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                )}
                <span>{msg.text}</span>
              </div>
            )}

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
                    Keep empty portfolio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(c.id, false)}
                    className="px-2.5 py-1 rounded-md bg-negative text-white text-xs font-medium hover:opacity-90"
                  >
                    Remove portfolio too
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
        );
      })}

      {showForm ? (
        <ConnectForm
          providers={providers}
          onSaved={async () => {
            setShowForm(false);
            await reload();
            onConnectionsChanged?.();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          disabled={providers.length === 0}
          className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Add Brokerage Account
        </button>
      )}
    </div>
  );
}
