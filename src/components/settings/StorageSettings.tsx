import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  HardDrive,
  Cloud,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  FolderOpen,
  Server,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { AppConfig, SyncResult, SyncTarget } from "../../types";

/** A new target before it has an id or sync timestamps assigned. */
type NewTarget = Omit<SyncTarget, "id" | "last_synced_at" | "last_sync_status">;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTs(ts: number | null | undefined): string {
  if (!ts) return "Never";
  return new Date(ts * 1000).toLocaleString();
}

// ── Add / Edit Sync Target form ────────────────────────────────────────────

interface TargetFormProps {
  onSave: (target: NewTarget) => void;
  onCancel: () => void;
}

function TargetForm({ onSave, onCancel }: TargetFormProps) {
  const [kind, setKind] = useState<"path" | "webdav">("path");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  function buildTarget(): NewTarget {
    if (kind === "path") {
      return { label: label || path, kind: "path", path };
    }
    return { label: label || url, kind: "webdav", url, username, password_enc: password };
  }

  function handleSave() {
    if (kind === "path" && !path.trim()) return;
    if (kind === "webdav" && (!url.trim() || !username.trim())) return;
    onSave(buildTarget());
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const testTarget: SyncTarget = { ...buildTarget(), id: "test", last_synced_at: null, last_sync_status: null };
      const ok = await invoke<boolean>("test_sync_connection", { target: testTarget });
      setTestResult(ok);
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Kind selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setKind("path")}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
            kind === "path"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50",
          )}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Local / Network Path
        </button>
        <button
          onClick={() => setKind("webdav")}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
            kind === "webdav"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50",
          )}
        >
          <Server className="w-3.5 h-3.5" />
          WebDAV / Cloud
        </button>
      </div>

      {/* Label */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind === "path" ? "e.g. My NAS" : "e.g. Nextcloud"}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {kind === "path" ? (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Folder Path
          </label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Users\you\OneDrive\Stockfolio"
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Can be a local folder, mapped drive, or a cloud-synced folder (OneDrive, Google Drive, etc.).
          </p>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              WebDAV URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your.server.com/dav/stockfolio/"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoComplete="off"
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-3 py-1.5 pr-8 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Test result */}
      {testResult !== null && (
        <div
          className={cn(
            "flex items-center gap-2 text-sm",
            testResult ? "text-green-600" : "text-red-500",
          )}
        >
          {testResult ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {testResult ? "Connection successful!" : "Connection failed"}
        </div>
      )}
      {testError && (
        <p className="text-xs text-red-500">{testError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={testing || (kind === "path" ? !path.trim() : !url.trim() || !username.trim())}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", testing && "animate-spin")} />
          Test
        </button>
        <button
          onClick={handleSave}
          disabled={kind === "path" ? !path.trim() : !url.trim() || !username.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Target
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main StorageSettings component ────────────────────────────────────────

interface StorageSettingsProps {
  /** Incremented by App.tsx after every background auto-sync completes so we re-fetch the config and show updated timestamps. */
  syncTick?: number;
  /** Called whenever we save config so App.tsx can restart the auto-sync timer immediately. */
  onConfigSaved?: () => void;
}

export function StorageSettings({ syncTick = 0, onConfigSaved }: StorageSettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [movingDb, setMovingDb] = useState(false);
  const [moveMessage, setMoveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null); // target id currently syncing
  const [syncMessages, setSyncMessages] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [autoSyncVal, setAutoSyncVal] = useState<string>("0");
  const [savingAutoSync, setSavingAutoSync] = useState(false);
  const [importPrompt, setImportPrompt] = useState<{ targetId: string; label: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  function fetchConfig() {
    invoke<AppConfig>("get_config")
      .then((c) => {
        setConfig(c);
        setAutoSyncVal(String(c.auto_sync_minutes ?? 0));
      })
      .catch((e) => setLoadError(String(e)));
  }

  // Initial load
  useEffect(() => { fetchConfig(); }, []);

  // Re-fetch whenever App.tsx's auto-sync completes so timestamps stay current
  useEffect(() => {
    if (syncTick > 0) fetchConfig();
  }, [syncTick]);

  async function handleMoveDb() {
    const folder = await openDialog({ directory: true, multiple: false, title: "Choose folder for database" });
    if (!folder) return; // user cancelled
    setMovingDb(true);
    setMoveMessage(null);
    try {
      const newPath = await invoke<string>("move_database", { newDir: folder as string });
      setMoveMessage({ type: "success", text: `Database moved to: ${newPath}` });
      const updated = await invoke<AppConfig>("get_config");
      setConfig(updated);
    } catch (e) {
      setMoveMessage({ type: "error", text: String(e) });
    } finally {
      setMovingDb(false);
    }
  }

  async function handleSyncNow(targetId: string) {
    setSyncing(targetId);
    setSyncMessages((m) => {
      const copy = { ...m };
      delete copy[targetId];
      return copy;
    });
    try {
      const result = await invoke<SyncResult>("sync_now", { targetId });
      setSyncMessages((m) => ({
        ...m,
        [targetId]: { ok: result.success, msg: result.message },
      }));
      if (result.success) {
        if (result.downloaded) {
          // Remote was newer — reload the whole app so all data refreshes
          window.location.reload();
          return;
        }
        const updated = await invoke<AppConfig>("get_config");
        setConfig(updated);
      }
    } catch (e) {
      setSyncMessages((m) => ({
        ...m,
        [targetId]: { ok: false, msg: String(e) },
      }));
    } finally {
      setSyncing(null);
    }
  }

  async function handleAddTarget(
    newTarget: NewTarget,
  ) {
    if (!config) return;

    // Encrypt password for WebDAV targets before saving
    let processedTarget: NewTarget = { ...newTarget };
    if (newTarget.kind === "webdav" && newTarget.password_enc) {
      try {
        const encrypted = await invoke<string>("encrypt_sync_password", {
          plain: newTarget.password_enc,
          deviceId: config.device_id,
        });
        processedTarget = {
          ...processedTarget,
          password_enc: encrypted,
        };
      } catch {
        // If encryption fails, save as-is
      }
    }

    const target: SyncTarget = {
      ...processedTarget,
      id: crypto.randomUUID(),
      last_synced_at: null,
      last_sync_status: null,
    } as SyncTarget;
    const updated: AppConfig = {
      ...config,
      sync_targets: [...config.sync_targets, target],
    };
    try {
      await invoke("save_config", { config: updated });
      setConfig(updated);
      setShowAddForm(false);
      onConfigSaved?.();

      // Check if a remote database already exists at this target
      try {
        const exists = await invoke<boolean>("check_remote_db_exists", { targetId: target.id });
        if (exists) {
          setImportPrompt({ targetId: target.id, label: target.label });
          setImportError(null);
        }
      } catch {
        // If check fails, silently skip — the user can sync manually
      }
    } catch (e) {
      alert(`Failed to save config: ${e}`);
    }
  }

  async function handleImportRemoteDb() {
    if (!importPrompt) return;
    setImporting(true);
    setImportError(null);
    try {
      await invoke("import_remote_db", { targetId: importPrompt.targetId });
      // Reload the app so all hooks re-fetch from the imported database
      window.location.reload();
    } catch (e) {
      setImportError(String(e));
      setImporting(false);
    }
  }

  async function handleRemoveTarget(id: string) {
    if (!config) return;
    const updated: AppConfig = {
      ...config,
      sync_targets: config.sync_targets.filter((t) => t.id !== id),
    };
    try {
      await invoke("save_config", { config: updated });
      setConfig(updated);
      onConfigSaved?.();
    } catch (e) {
      alert(`Failed to save config: ${e}`);
    }
  }

  async function handleSaveAutoSync() {
    if (!config) return;
    setSavingAutoSync(true);
    const mins = parseInt(autoSyncVal, 10);
    const updated: AppConfig = {
      ...config,
      auto_sync_minutes: isNaN(mins) || mins <= 0 ? null : mins,
    };
    try {
      await invoke("save_config", { config: updated });
      setConfig(updated);
      onConfigSaved?.();
    } catch (e) {
      alert(`Failed to save: ${e}`);
    } finally {
      setSavingAutoSync(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500 py-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Failed to load config: {loadError}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="text-sm text-muted-foreground py-4 animate-pulse">
        Loading storage settings…
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* ── Database Location ── */}
      <StorageRow
        icon={<HardDrive className="w-4 h-4" />}
        title="Database Location"
        description="Where your data is stored on this device."
        defaultOpen
      >
        <div className="space-y-2">
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-sm font-mono text-muted-foreground break-all">
            {config.db_path ?? "(default app data folder)"}
          </div>
          <button
            onClick={handleMoveDb}
            disabled={movingDb}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm font-medium text-foreground hover:border-primary/60 hover:bg-accent disabled:opacity-40 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            {movingDb ? "Moving…" : "Change Location…"}
          </button>
          {moveMessage && (
            <div
              className={cn(
                "flex items-start gap-2 text-sm",
                moveMessage.type === "success"
                  ? "text-green-600"
                  : "text-red-500",
              )}
            >
              {moveMessage.type === "success" ? (
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              {moveMessage.text}
            </div>
          )}
        </div>
      </StorageRow>

      {/* ── Sync Targets ── */}
      <StorageRow
        icon={<Cloud className="w-4 h-4" />}
        title="Sync Targets"
        description="Sync your database to a network share, NAS, or WebDAV server."
      >
        <div className="space-y-2">
          {config.sync_targets.length === 0 && !showAddForm && (
            <p className="text-sm text-muted-foreground">
              No sync targets configured. Add one below.
            </p>
          )}

          {config.sync_targets.map((target) => {
            const msg = syncMessages[target.id];
            return (
              <div
                key={target.id}
                className="rounded-lg border border-border bg-card p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {target.kind === "path" ? (
                        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">
                        {target.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate pl-5">
                      {target.kind === "path"
                        ? target.path
                        : target.url}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 pl-5">
                      Last synced:{" "}
                      {formatTs(target.last_synced_at)}
                      {target.last_sync_status &&
                        target.last_sync_status !== "ok" && (
                          <span className="ml-1 text-red-400">
                            ({target.last_sync_status})
                          </span>
                        )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleSyncNow(target.id)}
                      disabled={syncing === target.id}
                      title="Sync now"
                      className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary/50 disabled:opacity-40 transition-colors"
                    >
                      <RefreshCw
                        className={cn(
                          "w-3.5 h-3.5",
                          syncing === target.id && "animate-spin",
                        )}
                      />
                    </button>
                    <button
                      onClick={() => handleRemoveTarget(target.id)}
                      title="Remove target"
                      className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-red-500 hover:border-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {msg && (
                  <div
                    className={cn(
                      "flex items-center gap-2 text-xs pl-5",
                      msg.ok ? "text-green-600" : "text-red-500",
                    )}
                  >
                    {msg.ok ? (
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    )}
                    {msg.msg}
                  </div>
                )}
              </div>
            );
          })}

          {showAddForm ? (
            <TargetForm
              onSave={handleAddTarget}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              Add Sync Target
            </button>
          )}

          {/* Import prompt — shown after adding a target when a remote DB exists */}
          {importPrompt && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Database found at "{importPrompt.label}"
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    An existing Stockfolio database was found at this sync location.
                    Would you like to import it now? This will replace your current local data.
                  </p>
                </div>
              </div>
              {importError && (
                <div className="flex items-center gap-2 text-xs text-red-500">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {importError}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleImportRemoteDb}
                  disabled={importing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", importing && "animate-spin")} />
                  {importing ? "Importing…" : "Import Remote Database"}
                </button>
                <button
                  onClick={() => setImportPrompt(null)}
                  disabled={importing}
                  className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  Keep Local Data
                </button>
              </div>
            </div>
          )}
        </div>
      </StorageRow>

      {/* ── Auto Sync ── */}
      <StorageRow
        icon={<RefreshCw className="w-4 h-4" />}
        title="Auto-Sync"
        description="Automatically sync on a schedule while the app is open."
      >
        <div className="flex items-center gap-3">
          <select
            value={autoSyncVal}
            onChange={(e) => setAutoSyncVal(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="0">Disabled</option>
            <option value="5">Every 5 minutes</option>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
            <option value="60">Every hour</option>
          </select>
          <button
            onClick={handleSaveAutoSync}
            disabled={
              savingAutoSync ||
              autoSyncVal === String(config.auto_sync_minutes ?? 0)
            }
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {savingAutoSync ? "Saving…" : "Save"}
          </button>
        </div>
      </StorageRow>
    </div>
  );
}

// ── Collapsible row wrapper ────────────────────────────────────────────────

interface StorageRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function StorageRow({
  icon,
  title,
  description,
  defaultOpen = false,
  children,
}: StorageRowProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-8 py-5 text-left hover:bg-accent/30 -mx-0 px-0 transition-colors"
      >
        <div className="min-w-0 shrink-0 w-48 flex items-start gap-2">
          <span className="mt-0.5 text-muted-foreground">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="pt-1 text-muted-foreground">
          {open ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </button>
      {open && <div className="pb-5">{children}</div>}
    </div>
  );
}
