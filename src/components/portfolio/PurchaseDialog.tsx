import { useState, useEffect } from "react";
import type { Purchase } from "../../types";
import { cn } from "../../lib/utils";
import { X } from "lucide-react";

interface PurchaseDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (ticker: string, shares: number, price: number, date: string) => Promise<void>;
  initial?: Purchase | null;
  defaultTicker?: string;
}

export function PurchaseDialog({ open, onClose, onSave, initial, defaultTicker }: PurchaseDialogProps) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setTicker(initial?.ticker ?? defaultTicker ?? "");
      setShares(initial ? String(initial.shares) : "");
      setTotalPrice(initial ? String((initial.shares * initial.price_per_share).toFixed(2)) : "");
      setDate(initial?.purchased_at ?? new Date().toISOString().slice(0, 10));
      setErrors({});
    }
  }, [open, initial, defaultTicker]);

  function validate() {
    const e: Record<string, string> = {};
    if (!ticker.trim()) e.ticker = "Ticker is required";
    const s = parseFloat(shares);
    if (isNaN(s) || s <= 0) e.shares = "Enter a positive number";
    const p = parseFloat(totalPrice);
    if (isNaN(p) || p <= 0) e.totalPrice = "Enter a positive amount";
    if (!date) e.date = "Date is required";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      const sharesNum = parseFloat(shares);
      const pricePerShare = parseFloat(totalPrice) / sharesNum;
      await onSave(ticker.trim().toUpperCase(), sharesNum, pricePerShare, date);
      onClose();
    } catch (err) {
      setErrors({ form: String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">
            {initial ? "Edit Purchase" : "Add Purchase"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Ticker" error={errors.ticker}>
            <input
              className={inputClass(!!errors.ticker)}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              disabled={!!initial || !!defaultTicker}
            />
          </Field>
          <Field label="Shares" error={errors.shares}>
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass(!!errors.shares)}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="10"
            />
          </Field>
          <Field label="Total Purchase Price ($)" error={errors.totalPrice}>
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass(!!errors.totalPrice)}
              value={totalPrice}
              onChange={(e) => setTotalPrice(e.target.value)}
              placeholder="1500.00"
            />
            {(() => {
              const s = parseFloat(shares);
              const t = parseFloat(totalPrice);
              if (s > 0 && t > 0) {
                return (
                  <p className="text-xs text-muted-foreground">
                    Price per share: ${(t / s).toFixed(4)}
                  </p>
                );
              }
              return null;
            })()}
          </Field>
          <Field label="Date" error={errors.date}>
            <input
              type="date"
              className={inputClass(!!errors.date)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          {errors.form && <p className="text-sm text-red-500">{errors.form}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : initial ? "Save Changes" : "Add Purchase"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return cn(
    "rounded-md border px-3 py-2 text-sm bg-background text-foreground outline-none transition-colors",
    hasError
      ? "border-red-500 focus:border-red-500"
      : "border-border focus:border-primary"
  );
}
