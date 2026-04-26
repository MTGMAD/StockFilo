import { useState } from "react";
import type { Theme, InvestorMode, LinkOpenMode } from "../../types";
import { cn } from "../../lib/utils";
import { Monitor, Sun, Moon, Leaf, Download, Upload, CheckCircle, AlertCircle, Trash2, GraduationCap, LineChart, Globe, AppWindow, Info } from "lucide-react";
import { exportPurchasesCsv, importPurchasesCsv, clearAllPurchases } from "../../lib/db";

interface SettingsPanelProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onDataChange: () => void;
  investorMode: InvestorMode;
  onInvestorModeChange: (m: InvestorMode) => void;
  linkOpenMode: LinkOpenMode;
  onLinkOpenModeChange: (m: LinkOpenMode) => void;
  showInfoTooltips: boolean;
  onShowInfoTooltipsChange: (v: boolean) => void;
  activePortfolioId: number | null;
}

const linkOpenModes: { id: LinkOpenMode; label: string; description: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "browser", label: "Default Browser", description: "Opens links in your system's default web browser", Icon: Globe },
  { id: "inapp", label: "In-App Window", description: "Opens in your browser's app mode — no tabs or address bar, with your existing login state", Icon: AppWindow },
];

const investorModes: { id: InvestorMode; label: string; description: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "novice", label: "Novice", description: "Simplified view with plain-English labels and helpful context", Icon: GraduationCap },
  { id: "advanced", label: "Advanced", description: "Full metrics, sortable table, asset breakdown, and concentration data", Icon: LineChart },
];

const themes: { id: Theme; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "warm", label: "Warm", Icon: Leaf },
];

export function SettingsPanel({ theme, onThemeChange, onDataChange, investorMode, onInvestorModeChange, linkOpenMode, onLinkOpenModeChange, showInfoTooltips, onShowInfoTooltipsChange, activePortfolioId }: SettingsPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleExport() {
    if (activePortfolioId == null) return;
    setExporting(true);
    setMessage(null);
    try {
      const saved = await exportPurchasesCsv(activePortfolioId);
      if (saved) {
        setMessage({ type: "success", text: "Purchases exported successfully." });
      }
    } catch (e) {
      setMessage({ type: "error", text: `Export failed: ${e}` });
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    if (activePortfolioId == null) return;
    setImporting(true);
    setMessage(null);
    try {
      const count = await importPurchasesCsv(activePortfolioId);
      if (count > 0) {
        setMessage({ type: "success", text: `Imported ${count} purchase${count === 1 ? "" : "s"} successfully.` });
        onDataChange();
      } else if (count === 0) {
        // User may have cancelled the dialog — don't show error
      }
    } catch (e) {
      setMessage({ type: "error", text: `Import failed: ${e}` });
    } finally {
      setImporting(false);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    setMessage(null);
    try {
      await clearAllPurchases();
      setMessage({ type: "success", text: "All purchases cleared." });
      onDataChange();
    } catch (e) {
      setMessage({ type: "error", text: `Clear failed: ${e}` });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl space-y-0">

        {/* Appearance */}
        <div className="flex items-start justify-between gap-8 py-5 border-b border-border">
          <div className="min-w-0 shrink-0 w-48">
            <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choose how Stockfolio looks.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {themes.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => onThemeChange(id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                  theme === id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Dashboard Mode */}
        <div className="flex items-start justify-between gap-8 py-5 border-b border-border">
          <div className="min-w-0 shrink-0 w-48">
            <h2 className="text-sm font-semibold text-foreground">Dashboard Mode</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choose a view that matches your experience level.</p>
          </div>
          <div className="flex flex-col gap-2 flex-1">
            {investorModes.map(({ id, label, description, Icon }) => (
              <button
                key={id}
                onClick={() => onInvestorModeChange(id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                  investorMode === id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <div>
                  <div className="text-sm font-medium leading-tight">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Link Behavior */}
        <div className="flex items-start justify-between gap-8 py-5 border-b border-border">
          <div className="min-w-0 shrink-0 w-48">
            <h2 className="text-sm font-semibold text-foreground">Link Behavior</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choose how ticker and news links open.</p>
          </div>
          <div className="flex flex-col gap-2 flex-1">
            {linkOpenModes.map(({ id, label, description, Icon }) => (
              <button
                key={id}
                onClick={() => onLinkOpenModeChange(id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                  linkOpenMode === id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <div>
                  <div className="text-sm font-medium leading-tight">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Info Tooltips */}
        <div className="flex items-center justify-between gap-8 py-5 border-b border-border">
          <div className="min-w-0 shrink-0 w-48">
            <h2 className="text-sm font-semibold text-foreground">Info Tooltips</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Show explanations on dashboard cards.</p>
          </div>
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={() => onShowInfoTooltipsChange(!showInfoTooltips)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                showInfoTooltips ? "bg-primary" : "bg-muted-foreground/30"
              )}
              role="switch"
              aria-checked={showInfoTooltips}
            >
              <span
                className={cn(
                  "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
                  showInfoTooltips ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </button>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Info className="w-3.5 h-3.5" />
              {showInfoTooltips ? "Tooltips enabled" : "Tooltips hidden"}
            </div>
          </div>
        </div>

        {/* Data Management */}
        <div className="flex items-start justify-between gap-8 py-5 border-b border-border">
          <div className="min-w-0 shrink-0 w-48">
            <h2 className="text-sm font-semibold text-foreground">Data Management</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Export or import purchases as CSV.</p>
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleExport}
                disabled={exporting || importing || clearing}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                  "border-border text-foreground hover:border-primary/50 hover:text-primary",
                  (exporting || importing || clearing) && "opacity-50 cursor-not-allowed"
                )}
              >
                <Download className="w-4 h-4" />
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
              <button
                onClick={handleImport}
                disabled={exporting || importing || clearing}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                  "border-border text-foreground hover:border-primary/50 hover:text-primary",
                  (exporting || importing || clearing) && "opacity-50 cursor-not-allowed"
                )}
              >
                <Upload className="w-4 h-4" />
                {importing ? "Importing…" : "Import CSV"}
              </button>
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  disabled={exporting || importing || clearing}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                    "border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950",
                    (exporting || importing || clearing) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <Trash2 className="w-4 h-4" />
                  Clear All
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600 font-medium">Are you sure?</span>
                  <button
                    onClick={handleClearAll}
                    disabled={clearing}
                    className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {clearing ? "Clearing…" : "Yes, delete all"}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    disabled={clearing}
                    className="px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {message && (
              <div
                className={cn(
                  "flex items-center gap-2 mt-3 text-sm",
                  message.type === "success" ? "text-green-600" : "text-red-600"
                )}
              >
                {message.type === "success" ? (
                  <CheckCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                {message.text}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Format: <code className="bg-muted px-1 rounded">ticker,shares,price_per_share,purchased_at</code>
              {" · "}
              Date: <code className="bg-muted px-1 rounded">YYYY-MM-DD</code>
            </p>
          </div>
        </div>

        {/* About */}
        <div className="flex items-start justify-between gap-8 py-5">
          <div className="min-w-0 shrink-0 w-48">
            <h2 className="text-sm font-semibold text-foreground">About</h2>
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Stockfolio v0.1.0 — Personal stock portfolio tracker.</p>
          </div>
        </div>

      </div>
    </div>
  );
}
