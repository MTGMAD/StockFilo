import { useState } from "react";
import type { Theme } from "../../types";
import { cn } from "../../lib/utils";
import { Monitor, Sun, Moon, Download, Upload, CheckCircle, AlertCircle, Trash2 } from "lucide-react";
import { exportPurchasesCsv, importPurchasesCsv, clearAllPurchases } from "../../lib/db";

interface SettingsPanelProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onDataChange: () => void;
}

const themes: { id: Theme; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

export function SettingsPanel({ theme, onThemeChange, onDataChange }: SettingsPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleExport() {
    setExporting(true);
    setMessage(null);
    try {
      const saved = await exportPurchasesCsv();
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
    setImporting(true);
    setMessage(null);
    try {
      const count = await importPurchasesCsv();
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
    <div className="p-6 max-w-md">
      <h2 className="text-base font-semibold text-foreground mb-1">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Choose how StockFilo looks. "System" follows your OS preference.
      </p>
      <div className="flex gap-3">
        {themes.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onThemeChange(id)}
            className={cn(
              "flex flex-col items-center gap-2 px-5 py-4 rounded-lg border text-sm font-medium transition-colors",
              theme === id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            )}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-8 pt-8 border-t border-border">
        <h2 className="text-base font-semibold text-foreground mb-1">Data</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Export your purchases to a CSV file or import from one. This makes it easy to move your data to a new machine.
        </p>

        <div className="flex gap-3">
          <button
            onClick={handleExport}
            disabled={exporting || importing || clearing}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors",
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
              "flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors",
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
                "flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors",
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
          CSV format: <code className="text-xs bg-muted px-1 rounded">ticker,shares,price_per_share,purchased_at</code>
          <br />
          Date format: <code className="text-xs bg-muted px-1 rounded">YYYY-MM-DD</code>
        </p>
      </div>

      <div className="mt-8 pt-8 border-t border-border">
        <h2 className="text-base font-semibold text-foreground mb-1">About</h2>
        <p className="text-sm text-muted-foreground">StockFilo v0.1.0 — Personal stock portfolio tracker.</p>
      </div>
    </div>
  );
}
