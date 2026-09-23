import { useState } from "react";
import type { CashEvent } from "../../types";
import { formatCurrency, cn } from "../../lib/utils";
import { CashEventDialog } from "./CashEventDialog";
import { Pencil, Trash2, Plus, TrendingUp, TrendingDown, Lock } from "lucide-react";

interface CashEventsTableProps {
  cashEvents: CashEvent[];
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
  tickers,
  onAdd,
  onUpdate,
  onDelete,
}: CashEventsTableProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CashEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const total = cashEvents.reduce((sum, e) => sum + e.amount, 0);
  const dividends = cashEvents
    .filter((e) => e.kind === "dividend")
    .reduce((sum, e) => sum + e.amount, 0);
  const fees = cashEvents
    .filter((e) => e.kind === "fee")
    .reduce((sum, e) => sum + e.amount, 0);
  const saleProceeds = cashEvents
    .filter((e) => e.kind === "sale")
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border gap-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Dividends{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(dividends)}
            </span>
          </span>
          <span>
            Fees{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(fees)}
            </span>
          </span>
          {saleProceeds > 0 && (
            <span>
              Sale Proceeds{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(saleProceeds)}
              </span>
            </span>
          )}
          <span>
            Net{" "}
            <span
              className={cn(
                "font-semibold",
                total > 0
                  ? "text-positive"
                  : total < 0
                    ? "text-negative"
                    : "text-foreground",
              )}
            >
              {formatCurrency(total)}
            </span>
          </span>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Cash Event
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {cashEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">
              No dividends or fees recorded yet.
            </p>
            <p className="text-xs max-w-sm text-center">
              Reinvested dividends already show up as purchases automatically
              — log cash dividends (paid out, not reinvested) and account
              fees here.
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
              {cashEvents.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border hover:bg-muted/30 transition-colors"
                >
                  <Td>{e.occurred_at}</Td>
                  <Td>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                        e.kind === "fee"
                          ? "bg-red-500/10 text-red-600"
                          : e.kind === "sale"
                            ? "bg-positive/10 text-positive"
                            : "bg-[var(--dividend-bg)] text-[var(--dividend-fg)]",
                      )}
                    >
                      {e.kind === "fee" ? (
                        <TrendingDown className="w-3 h-3" />
                      ) : (
                        <TrendingUp className="w-3 h-3" />
                      )}
                      {e.kind === "dividend"
                        ? "Dividend"
                        : e.kind === "fee"
                          ? "Fee"
                          : "Sale"}
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
