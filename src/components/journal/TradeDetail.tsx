import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LineChart } from "lucide-react";
import type { JournalNote } from "../../types";
import { cn, formatCurrency, isCusip, pnlColor } from "../../lib/utils";
import {
  computeExcursion,
  rangeCovering,
  type DailyBar,
  type JournalTrade,
} from "../../lib/journal";
import { getDailyBars } from "../../lib/journalHistory";
import { NoteBox } from "./NoteBox";
import { TradeChart } from "./TradeChart";
import { Stat, StatusBadge, holdLabel, pct, shortDate } from "./journalUi";

interface TradeDetailProps {
  trade: JournalTrade;
  note: JournalNote | undefined;
  portfolioId: number;
  /** Dividends/interest/fees while held; null when this account type has none to show. */
  income: number | null;
  onSaved: () => void;
  onBack: () => void;
  onViewChart: (ticker: string) => void;
}

export function TradeDetail({
  trade, note, portfolioId, income, onSaved, onBack, onViewChart,
}: TradeDetailProps) {
  const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const exits = Object.keys(trade.exitPnl).length;

  const [bars, setBars] = useState<DailyBar[] | null>(null);
  const [barsError, setBarsError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setBars(null);
    setBarsError(null);
    if (isCusip(trade.ticker)) {
      setBarsError("Bonds and CDs have no price chart.");
      return;
    }
    getDailyBars(trade.ticker, rangeCovering(trade.openDate)).then(
      (b) => alive && setBars(b),
      (e) => alive && setBarsError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [trade.key, trade.ticker, trade.openDate]);

  const excursion = useMemo(() => (bars ? computeExcursion(trade, bars) : null), [bars, trade]);

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="p-1.5 rounded-full hover:bg-muted" aria-label="Back to trades">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-xl font-bold">{trade.ticker}</h2>
        <StatusBadge status={trade.status} />
        <span className={cn("ml-auto text-xl font-bold tabular-nums", pnlColor(trade.realizedPnl))}>
          {formatCurrency(trade.realizedPnl)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-muted/50 p-4">
        <Stat label="Average entry" value={formatCurrency(trade.avgEntry)} />
        <Stat label="Average exit" value={trade.avgExit == null ? "—" : formatCurrency(trade.avgExit)} />
        <Stat label="Quantity" value={fmtQty(trade.totalBought)} />
        <Stat label="Holding time" value={holdLabel(trade.holdDays)} />
        <Stat label="Position" value={trade.openQty > 0 ? `Long · ${fmtQty(trade.openQty)} still held` : "Long"} />
        <Stat label="Realized exits" value={String(exits)} />
        {income != null && (
          <>
            <Stat label="Dividends & fees" value={formatCurrency(income)} className={pnlColor(income)} />
            <Stat
              label="Total return"
              value={formatCurrency(trade.realizedPnl + income)}
              className={pnlColor(trade.realizedPnl + income)}
            />
          </>
        )}
      </div>

      {bars ? (
        <TradeChart trade={trade} bars={bars} />
      ) : (
        <div className="h-24 rounded-xl border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
          {barsError ? `Price chart unavailable — ${barsError}` : "Loading price history…"}
        </div>
      )}

      {excursion && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 rounded-xl border border-border p-4">
          <Stat
            label="Peak gain"
            value={`+${pct(excursion.mfePct, 1)}`}
            className="text-positive"
            hint="Highest daily price during the hold, relative to your average entry"
          />
          <Stat
            label="Max drawdown"
            value={pct(excursion.maePct, 1)}
            className={excursion.maePct < 0 ? "text-negative" : ""}
            hint="Lowest daily price during the hold, relative to your average entry"
          />
          <Stat
            label="Exit efficiency"
            value={excursion.exitEfficiency == null ? "—" : pct(excursion.exitEfficiency * 100)}
            hint="Share of the peak gain you actually captured when you sold"
          />
          <Stat
            label="Gave back"
            value={formatCurrency(excursion.gaveBack)}
            hint="Gain between your average exit and the peak, on the shares sold"
          />
          <p className="col-span-full text-[10px] text-muted-foreground -mt-1">
            Based on daily highs and lows, which can fall before your buy or after your sell on those days.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => onViewChart(trade.ticker)}
        className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-primary hover:bg-muted/50"
      >
        <LineChart className="w-4 h-4" />
        Open {trade.ticker} in Analysis
      </button>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground mb-3">EXECUTIONS</h3>
        <ol className="flex flex-col">
          {trade.fills.map((f) => {
            const pnl = trade.exitPnl[f.id];
            return (
              <li key={f.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn("w-2.5 h-2.5 rounded-full mt-1.5", f.side === "buy" ? "bg-positive" : "bg-negative")} />
                  <span className="flex-1 w-px bg-border" />
                </div>
                <div className="flex-1 pb-4 flex justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {f.drip ? "Dividend reinvestment" : f.side === "buy" ? "Entry" : "Exit"} · {f.side.toUpperCase()} {fmtQty(f.qty)} shares
                    </div>
                    <div className="text-xs text-muted-foreground">{shortDate(f.date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium tabular-nums">{formatCurrency(f.price)}</div>
                    {pnl != null && (
                      <div className={cn("text-xs tabular-nums", pnlColor(pnl))}>{formatCurrency(pnl)}</div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <NoteBox
        key={trade.key}
        label="Reflection & learning"
        portfolioId={portfolioId}
        noteKey={trade.key}
        note={note}
        onSaved={onSaved}
        withLesson
        withTags
      />
    </div>
  );
}
