import { useState } from "react";
import type { CashAnchor, CashEvent } from "../../types";
import type { CashBalance } from "../../lib/cash";
import { formatCurrency, cn } from "../../lib/utils";
import { CashEventDialog } from "./CashEventDialog";
import { Pencil, Trash2, Plus, TrendingUp, TrendingDown, Lock } from "lucide-react";

const KIND_STYLE: Record<
  CashEvent["kind"],
  { label: string; badgeClass: string; down: boolean }
> = {
  dividend: {
    label: "Dividend",
    badgeClass: "bg-[var(--dividend-bg)] text-[var(--dividend-fg)]",
    down: false,
  },
  interest: {
    label: "Interest",
    badgeClass: "bg-blue-500/10 text-blue-600",
    down: false,
  },
  sale: { label: "Sale", badgeClass: "bg-positive/10 text-positive", down: false },
  fee: { label: "Fee", badgeClass: "bg-red-500/10 text-red-600", down: true },
};

const FILTERS: { kind: "all" | CashEvent["kind"]; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "dividend", label: "Dividends" },
  { kind: "interest", label: "Interest" },
  { kind: "fee", label: "Fees" },
  { kind: "sale", label: "Sales" },
];

interface CashEventsTableProps {
  cashEvents: CashEvent[];
  cashAnchor: CashAnchor | null;
  cashBalance: CashBalance;
  tickers: string[];
  onAdd: (
    kind: CashEvent["kind"],
    ticker: string | null,
    amount: number,
    date: string,
    note: string | null,
  ) => Promise<void>;
  onUpdate: (
    id: number,
    kind: CashEvent["kind"],
    ticker: string | null,
    amount: number,
    date: string,
    note: string | null,
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function CashEventsTable({
  cashEvents,
  cashAnchor,
  cashBalance,
  tickers,
  onAdd,
  onUpdate,
  onDelete,
}: CashEventsTableProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CashEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | CashEvent["kind"]>("all");

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">CASH BALANCE</span>
          <span
            className={cn(
              "text-xl font-bold tabular-nums",
              cashBalance.balance != null && cashBalance.balance < 0 && "text-negative",
            )}
          >
            {cashBalance.balance == null ? "—" : formatCurrency(cashBalance.balance)}
          </span>
          <div className="ml-auto flex items-center gap-3 self-center">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="btn-primary flex items-center gap-1 px-2.5 py-1 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add cash event
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {cashBalance.mode === "anchored" && cashAnchor
            ? `Worked out from your imported activity file as of ${cashAnchor.as_of}. Anything dated after that adds to it, and purchases take from it. Importing a newer file updates it.`
            : cashBalance.mode === "events"
              ? "Not a real balance yet — it only adds up recorded dividends, fees and sale proceeds, and doesn't subtract what you bought. Import your latest account activity file (Settings tab) and it will be worked out for you."
              : "Import your account activity file (Settings tab) and the cash balance will be worked out for you."}
        </p>
      </div>
      {cashEvents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 border-b border-border">
          {FILTERS.filter(
            (f) => f.kind === "all" || cashEvents.some((e) => e.kind === f.kind),
          ).map((f) => {
            const rows = f.kind === "all" ? cashEvents : cashEvents.filter((e) => e.kind === f.kind);
            const sum = rows.reduce((s, e) => s + e.amount, 0);
            const active = typeFilter === f.kind;
            return (
              <button
                key={f.kind}
                type="button"
                onClick={() => setTypeFilter(f.kind)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <span className="font-medium">{f.label}</span>
                <span className={active ? "opacity-80" : ""}>
                  {/* "All" mixes inflows and fees; its sum isn't a balance, so show only the count. */}
                  {f.kind === "all" ? rows.length : `${rows.length} · ${formatCurrency(sum)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {cashEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">
              No dividends, interest or fees recorded yet.
            </p>
            <p className="text-xs max-w-sm text-center">
              Reinvested dividends already show up as purchases automatically
              — log cash dividends (paid out, not reinvested), cash-sweep
              interest and account fees here.
            </p>
            <button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="btn-primary text-sm mt-2"
            >
              Add your first cash event
            </button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted">
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Ticker</Th>
                <Th align="right">Amount</Th>
                <Th>Note</Th>
                <Th align="center">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {cashEvents
                .filter((e) => typeFilter === "all" || e.kind === typeFilter)
                .map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border hover:bg-muted/30 transition-colors"
                >
                  <Td>{e.occurred_at}</Td>
                  <Td>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                        KIND_STYLE[e.kind].badgeClass,
                      )}
                    >
                      {KIND_STYLE[e.kind].down ? (
                        <TrendingDown className="w-3 h-3" />
                      ) : (
                        <TrendingUp className="w-3 h-3" />
                      )}
                      {KIND_STYLE[e.kind].label}
                    </span>
                  </Td>
                  <Td>{e.ticker ?? "—"}</Td>
                  <Td align="right">
                    <span
                      className={
                        e.amount >= 0 ? "text-positive" : "text-negative"
                      }
                    >
                      {formatCurrency(e.amount)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-muted-foreground">
                      {e.note ?? "—"}
                    </span>
                  </Td>
                  <Td align="center">
                    {e.source_sale_id != null ? (
                      <span
                        className="inline-flex items-center justify-center p-1 text-muted-foreground/50"
                        title="Edit or delete this sale from the Purchases tab instead"
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditing(e);
                            setDialogOpen(true);
                          }}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(e.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CashEventDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        tickers={tickers}
        onSave={async (kind, ticker, amount, date, note) => {
          if (editing) {
            await onUpdate(editing.id, kind, ticker, amount, date, note);
          } else {
            await onAdd(kind, ticker, amount, date, note);
          }
        }}
      />

      {confirmDelete != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-80">
            <p className="text-sm text-foreground mb-4">
              Delete this cash event? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onDelete(confirmDelete);
                  setConfirmDelete(null);
                }}
                className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap",
        {
          "text-left": align === "left",
          "text-right": align === "right",
          "text-center": align === "center",
        },
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={cn("px-4 py-2.5 text-foreground whitespace-nowrap", {
        "text-left": align === "left",
        "text-right": align === "right",
        "text-center": align === "center",
      })}
    >
      {children}
    </td>
  );
}
