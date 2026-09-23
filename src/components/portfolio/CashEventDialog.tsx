import { useState, useEffect } from "react";
import type { CashEvent } from "../../types";
import { cn } from "../../lib/utils";
import { X } from "lucide-react";

interface CashEventDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (
    kind: CashEvent["kind"],
    ticker: string | null,
    amount: number,
    date: string,
    note: string | null,
  ) => Promise<void>;
  initial?: CashEvent | null;
  tickers: string[];
}

export function CashEventDialog({
  open,
  onClose,
  onSave,
  initial,
  tickers,
}: CashEventDialogProps) {
  const [kind, setKind] = useState<CashEvent["kind"]>("dividend");
  const [ticker, setTicker] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setKind(initial?.kind ?? "dividend");
      setTicker(initial?.ticker ?? "");
      // Stored signed (fees negative) — the field always shows a positive amount.
      setAmount(initial ? String(Math.abs(initial.amount)) : "");
      setDate(initial?.occurred_at ?? new Date().toISOString().slice(0, 10));
      setNote(initial?.note ?? "");
      setErrors({});
    }
  }, [open, initial]);

  function validate() {
    const e: Record<string, string> = {};
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) e.amount = "Enter a positive amount";
    if (!date) e.date = "Date is required";
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    try {
      const magnitude = Math.abs(parseFloat(amount));
      const signed = kind === "fee" ? -magnitude : magnitude;
      const t = ticker.trim().toUpperCase();
      await onSave(kind, t || null, signed, date, note.trim() || null);
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
            {initial ? "Edit Cash Event" : "Add Cash Event"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Type">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKind("dividend")}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  kind === "dividend"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Dividend
              </button>
              <button
                type="button"
                onClick={() => setKind("fee")}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  kind === "fee"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Fee
              </button>
            </div>
          </Field>

          <Field
            label={kind === "dividend" ? "Ticker (optional)" : "Related ticker (optional)"}
          >
            <input
              className={inputClass(false)}
              list="cash-event-tickers"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder={kind === "dividend" ? "e.g. VTI" : "Account fee, no ticker"}
              autoComplete="off"
            />
            <datalist id="cash-event-tickers">
              {tickers.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>

          <Field label="Amount" error={errors.amount}>
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass(!!errors.amount)}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setErrors((p) => ({ ...p, amount: "" }));
              }}
              placeholder="25.00"
            />
          </Field>

          <Field label="Date" error={errors.date}>
            <input
              type="date"
              className={inputClass(!!errors.date)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>

          <Field label="Note (optional)">
            <input
              className={inputClass(false)}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Q3 advisory fee"
            />
          </Field>

          {errors.form && <p className="text-sm text-red-500">{errors.form}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : initial ? "Save Changes" : "Add Event"}
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
    "rounded-md border px-3 py-2 text-sm bg-background text-foreground outline-none transition-colors w-full",
    hasError
      ? "border-red-500 focus:border-red-500"
      : "border-border focus:border-primary",
  );
}
