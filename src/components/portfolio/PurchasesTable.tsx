import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { Purchase, Stock } from "../../types";
import { formatCurrency, formatPercent, formatShares, pnlColor, cn } from "../../lib/utils";
import { PurchaseDialog } from "./PurchaseDialog";
import { Pencil, Trash2, Plus, ExternalLink, Download } from "lucide-react";

interface PurchasesTableProps {
  purchases: Purchase[];
  stocks: Stock[];
  onAdd: (ticker: string, shares: number, price: number, date: string) => Promise<void>;
  onUpdate: (id: number, ticker: string, shares: number, price: number, date: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function PurchasesTable({
  purchases,
  stocks,
  onAdd,
  onUpdate,
  onDelete,
}: PurchasesTableProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const now = Math.floor(Date.now() / 1000);
  const STALE_THRESHOLD = 3600;

  async function openGoogleFinance(ticker: string) {
    await open(`https://www.google.com/finance/quote/${ticker}`);
  }

  async function exportCsv() {
    const header = ["Date", "Ticker", "Shares", "Price Paid", "Total Cost", "Current Price", "Market Value", "P&L $", "P&L %"];
    const rows = purchases.map((p) => {
      const stock = stockMap.get(p.ticker);
      const totalCost = p.shares * p.price_per_share;
      const currentPrice = stock?.last_price ?? null;
      const marketValue = currentPrice != null ? p.shares * currentPrice : null;
      const pnl = marketValue != null ? marketValue - totalCost : null;
      const pnlPct = pnl != null && totalCost > 0 ? (pnl / totalCost) * 100 : null;
      return [
        p.purchased_at,
        p.ticker,
        p.shares,
        p.price_per_share.toFixed(2),
        totalCost.toFixed(2),
        currentPrice != null ? currentPrice.toFixed(2) : "",
        marketValue != null ? marketValue.toFixed(2) : "",
        pnl != null ? pnl.toFixed(2) : "",
        pnlPct != null ? pnlPct.toFixed(2) : "",
      ].join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");

    const filePath = await save({
      defaultPath: `purchases_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (filePath) {
      try {
        await writeTextFile(filePath, csv);
      } catch (err) {
        console.error("CSV write failed:", err);
        alert(`Failed to save CSV: ${err}`);
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end px-6 py-3 border-b border-border gap-2">
        <button
          onClick={exportCsv}
          disabled={purchases.length === 0}
          className="btn-secondary flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
        <button
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Purchase
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {purchases.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">No purchases yet.</p>
            <button onClick={() => { setEditing(null); setDialogOpen(true); }} className="btn-primary text-sm">
              Add your first purchase
            </button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <Th>Date</Th>
                <Th>Ticker</Th>
                <Th align="right">Shares</Th>
                <Th align="right">Price Paid</Th>
                <Th align="right">Total Cost</Th>
                <Th align="right">Current Price</Th>
                <Th align="right">Market Value</Th>
                <Th align="right">P&L $</Th>
                <Th align="right">P&L %</Th>
                <Th align="center">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const stock = stockMap.get(p.ticker);
                const totalCost = p.shares * p.price_per_share;
                const currentPrice = stock?.last_price ?? null;
                const marketValue = currentPrice != null ? p.shares * currentPrice : null;
                const pnl = marketValue != null ? marketValue - totalCost : null;
                const pnlPct = pnl != null && totalCost > 0 ? (pnl / totalCost) * 100 : null;
                const isStale =
                  !stock?.last_fetched_at || now - stock.last_fetched_at > STALE_THRESHOLD;

                return (
                  <tr key={p.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <Td>{p.purchased_at}</Td>
                    <Td>
                      <button
                        onClick={() => openGoogleFinance(p.ticker)}
                        className="flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        {p.ticker}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </button>
                    </Td>
                    <Td align="right">{formatShares(p.shares)}</Td>
                    <Td align="right">{formatCurrency(p.price_per_share)}</Td>
                    <Td align="right">{formatCurrency(totalCost)}</Td>
                    <Td align="right">
                      <span className={cn(isStale && currentPrice != null ? "opacity-50" : "")}>
                        {currentPrice != null ? formatCurrency(currentPrice) : "—"}
                      </span>
                      {isStale && currentPrice != null && (
                        <span className="ml-1 text-xs text-amber-500">stale</span>
                      )}
                    </Td>
                    <Td align="right">{formatCurrency(marketValue)}</Td>
                    <Td align="right">
                      <span className={pnlColor(pnl)}>{formatCurrency(pnl)}</span>
                    </Td>
                    <Td align="right">
                      <span className={pnlColor(pnlPct)}>{formatPercent(pnlPct)}</span>
                    </Td>
                    <Td align="center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => { setEditing(p); setDialogOpen(true); }}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(p.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <PurchaseDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        onSave={async (ticker, shares, price, date) => {
          if (editing) {
            await onUpdate(editing.id, ticker, shares, price, date);
          } else {
            await onAdd(ticker, shares, price, date);
          }
        }}
      />

      {confirmDelete != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-80">
            <p className="text-sm text-foreground mb-4">Delete this purchase? This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
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

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th className={cn("px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap", {
      "text-left": align === "left",
      "text-right": align === "right",
      "text-center": align === "center",
    })}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <td className={cn("px-4 py-2.5 text-foreground whitespace-nowrap", {
      "text-left": align === "left",
      "text-right": align === "right",
      "text-center": align === "center",
    })}>
      {children}
    </td>
  );
}
