import { useState, useEffect, useRef } from "react";
import type { Purchase, TickerSearchResult } from "../../types";
import { cn, formatCurrency } from "../../lib/utils";
import { searchTickers, fetchAndCachePrices } from "../../lib/db";
import { X, Loader2 } from "lucide-react";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface PurchaseDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (ticker: string, shares: number, price: number, date: string) => Promise<void>;
  initial?: Purchase | null;
  defaultTicker?: string;
}

export function PurchaseDialog({ open, onClose, onSave, initial, defaultTicker }: PurchaseDialogProps) {
  const [tickerInput, setTickerInput] = useState("");
  const [confirmedTicker, setConfirmedTicker] = useState("");
  const [suggestions, setSuggestions] = useState<TickerSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const [shares, setShares] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [totalPriceFocused, setTotalPriceFocused] = useState(false);

  const debouncedTickerInput = useDebounce(tickerInput, 300);
  const debouncedTotalPrice = useDebounce(totalPrice, 500);
  const tickerDisabled = !!initial || !!defaultTicker;

  // True only when the user typed into the total price field (not auto-filled)
  const priceTypedByUser = useRef(false);

  // refs so async callbacks (price fetch) see current field values
  const sharesRef = useRef(shares);
  const totalPriceRef = useRef(totalPrice);
  sharesRef.current = shares;
  totalPriceRef.current = totalPrice;

  useEffect(() => {
    if (open) {
      const t = initial?.ticker ?? defaultTicker ?? "";
      setTickerInput(t);
      setConfirmedTicker(t);
      setShares(initial ? String(initial.shares) : "");
      setTotalPrice(initial ? String((initial.shares * initial.price_per_share).toFixed(2)) : "");
      setDate(initial?.purchased_at ?? new Date().toISOString().slice(0, 10));
      setErrors({});
      setMarketPrice(null);
      setSuggestions([]);
      setShowSuggestions(false);
      priceTypedByUser.current = false;
    }
  }, [open, initial, defaultTicker]);

  // Ticker autocomplete search
  useEffect(() => {
    if (tickerDisabled || !debouncedTickerInput || debouncedTickerInput === confirmedTicker) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSearchLoading(true);
    searchTickers(debouncedTickerInput)
      .then((results) => {
        setSuggestions(results.slice(0, 6));
        setShowSuggestions(results.length > 0);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setSearchLoading(false));
  }, [debouncedTickerInput, confirmedTicker, tickerDisabled]);

  // Price → shares: fires 500ms after user stops typing in total price
  useEffect(() => {
    if (!priceTypedByUser.current || marketPrice == null) return;
    const t = parseFloat(debouncedTotalPrice);
    if (t > 0) {
      const fullShares = Math.floor(t / marketPrice);
      if (fullShares > 0) {
        priceTypedByUser.current = false;
        setShares(String(fullShares));
        setTotalPrice((fullShares * marketPrice).toFixed(2));
        setErrors((p) => ({ ...p, shares: "", totalPrice: "" }));
      }
    }
  }, [debouncedTotalPrice, marketPrice]);

  async function loadMarketPrice(symbol: string): Promise<number | null> {
    if (!symbol) return null;
    setPriceLoading(true);
    setMarketPrice(null);
    try {
      const results = await fetchAndCachePrices([symbol]);
      const price = results[0]?.price ?? null;
      setMarketPrice(price);
      return price;
    } catch {
      return null;
    } finally {
      setPriceLoading(false);
    }
  }

  function applyAutoCalc(price: number) {
    const s = parseFloat(sharesRef.current);
    const t = parseFloat(totalPriceRef.current);
    if (s > 0) {
      priceTypedByUser.current = false;
      setTotalPrice((s * price).toFixed(2));
    } else if (t > 0) {
      const fullShares = Math.floor(t / price);
      if (fullShares > 0) {
        priceTypedByUser.current = false;
        setShares(String(fullShares));
        setTotalPrice((fullShares * price).toFixed(2));
      }
    }
  }

  function selectSuggestion(result: TickerSearchResult) {
    setTickerInput(result.symbol);
    setConfirmedTicker(result.symbol);
    setSuggestions([]);
    setShowSuggestions(false);
    loadMarketPrice(result.symbol).then((price) => {
      if (price != null) applyAutoCalc(price);
    });
  }

  function handleTickerBlur() {
    setTimeout(() => {
      setShowSuggestions(false);
      const sym = tickerInput.trim().toUpperCase();
      if (sym && sym !== confirmedTicker) {
        setTickerInput(sym);
        setConfirmedTicker(sym);
        loadMarketPrice(sym).then((price) => {
          if (price != null) applyAutoCalc(price);
        });
      }
    }, 150);
  }

  function handleSharesChange(value: string) {
    setShares(value);
    priceTypedByUser.current = false;
    setErrors((prev) => ({ ...prev, shares: "" }));
    if (marketPrice != null) {
      const s = parseFloat(value);
      if (s > 0) setTotalPrice((s * marketPrice).toFixed(2));
    }
  }

  function handleTotalPriceChange(value: string) {
    setTotalPrice(value);
    priceTypedByUser.current = true;
    setErrors((p) => ({ ...p, totalPrice: "" }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!confirmedTicker.trim()) e.ticker = "Ticker is required";
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
      await onSave(confirmedTicker.trim().toUpperCase(), sharesNum, pricePerShare, date);
      onClose();
    } catch (err) {
      setErrors({ form: String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const sharesNum = parseFloat(shares);
  const totalNum = parseFloat(totalPrice);
  const pricePerShare = sharesNum > 0 && totalNum > 0 ? totalNum / sharesNum : null;

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
            <div className="relative">
              <div className="relative">
                <input
                  className={cn(inputClass(!!errors.ticker), "pr-8")}
                  value={tickerInput}
                  onChange={(e) => { setTickerInput(e.target.value.toUpperCase()); setErrors((p) => ({ ...p, ticker: "" })); }}
                  onBlur={handleTickerBlur}
                  placeholder="AAPL or Apple Inc."
                  disabled={tickerDisabled}
                  autoComplete="off"
                />
                {(searchLoading || priceLoading) && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin pointer-events-none" />
                )}
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-1 w-full z-20 bg-background border border-border rounded-md shadow-lg overflow-hidden">
                  {suggestions.map((s) => (
                    <button
                      key={s.symbol}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(s)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                    >
                      <span className="font-medium text-foreground w-16 shrink-0">{s.symbol}</span>
                      <span className="text-muted-foreground truncate flex-1">{s.name}</span>
                      {s.exchange && (
                        <span className="text-xs text-muted-foreground shrink-0">{s.exchange}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {marketPrice != null && (
              <p className="text-xs text-muted-foreground">
                Market price: <span className="text-foreground font-medium">${marketPrice.toFixed(2)}</span>
              </p>
            )}
          </Field>

          <Field label="Shares" error={errors.shares}>
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass(!!errors.shares)}
              value={shares}
              onChange={(e) => handleSharesChange(e.target.value)}
              placeholder="10"
            />
            {marketPrice != null && !shares && (
              <p className="text-xs text-muted-foreground">Enter shares to auto-fill total cost</p>
            )}
          </Field>

          <Field label="Total Purchase Price" error={errors.totalPrice}>
            <input
              type="text"
              inputMode="decimal"
              className={inputClass(!!errors.totalPrice)}
              value={totalPriceFocused ? totalPrice : (totalPrice ? formatCurrency(parseFloat(totalPrice)) : "")}
              onChange={(e) => handleTotalPriceChange(e.target.value)}
              onFocus={() => setTotalPriceFocused(true)}
              onBlur={() => setTotalPriceFocused(false)}
              placeholder="$1,500.00"
            />
            <div className="flex justify-between">
              {pricePerShare != null ? (
                <p className="text-xs text-muted-foreground">
                  Price per share: {formatCurrency(pricePerShare)}
                </p>
              ) : <span />}
              {marketPrice != null && !shares && (
                <p className="text-xs text-muted-foreground">Enter amount to auto-calc shares</p>
              )}
            </div>
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

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
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
    hasError ? "border-red-500 focus:border-red-500" : "border-border focus:border-primary",
  );
}
