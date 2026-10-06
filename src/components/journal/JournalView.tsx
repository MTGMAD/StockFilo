import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  NotebookPen,
} from "lucide-react";
import type { JournalNote } from "../../types";
import { cn, formatCurrency, pnlColor } from "../../lib/utils";
import { listJournalNotes } from "../../lib/db";
import {
  EMPTY_FILTER,
  allTags,
  buildTrades,
  equityCurve,
  filterTrades,
  isFilterActive,
  needsReview,
  periodIncome,
  periodStats,
  summarizeDays,
  tradeIncome,
  tradesToCsv,
  type Fill,
  type IncomeEvent,
  type JournalTrade,
  type TradeFilter,
} from "../../lib/journal";
import { saveJournalCsv } from "../../lib/journalExport";
import { NoteBox } from "./NoteBox";
import { TradeDetail } from "./TradeDetail";
import { JournalFilters } from "./JournalFilters";
import { JournalReports } from "./JournalReports";
import { Stat, StatusBadge, compactMoney, shortDate } from "./journalUi";

interface JournalViewProps {
  portfolioId: number;
  fills: Fill[];
  /** Dividends, interest and fees. Pass null for accounts that don't record them
   *  (broker-linked accounts only sync buys and sells). */
  income: IncomeEvent[] | null;
  onViewChart: (ticker: string) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const isoDate = (d: Date) => iso(d.getFullYear(), d.getMonth(), d.getDate());

export function JournalView({ portfolioId, fills, income, onViewChart }: JournalViewProps) {
  const allTrades = useMemo(() => buildTrades(fills), [fills]);
  const [notes, setNotes] = useState<Map<string, JournalNote>>(new Map());
  const [filter, setFilter] = useState<TradeFilter>(EMPTY_FILTER);
  const [section, setSection] = useState<"trades" | "reports">("trades");
  const filterActive = isFilterActive(filter);

  const trades = useMemo(() => filterTrades(allTrades, filter, notes), [allTrades, filter, notes]);
  const days = useMemo(() => summarizeDays(trades), [trades]);
  const curve = useMemo(() => equityCurve(days), [days]);
  const tags = useMemo(() => allTags(notes), [notes]);

  const latest = useMemo(() => {
    const dates = [...summarizeDays(allTrades).keys()].sort();
    const last = dates[dates.length - 1];
    if (last) {
      const [y, m] = last.split("-").map(Number);
      return { y, m: m - 1 };
    }
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }, [allTrades]);

  const [cursor, setCursor] = useState(latest);
  const [range, setRange] = useState<"month" | "all">("month");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setCursor(latest);
    setSelectedDate(null);
    setSelectedKey(null);
    setFilter(EMPTY_FILTER);
    // Reset only when switching account, not each time fills refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  async function reloadNotes() {
    try {
      const rows = await listJournalNotes(portfolioId);
      setNotes(new Map(rows.map((n) => [n.trade_key, n])));
    } catch {
      setNotes(new Map());
    }
  }
  useEffect(() => {
    void reloadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  const monthFrom = iso(cursor.y, cursor.m, 1);
  const monthTo = iso(cursor.y, cursor.m, 31);
  const stats = useMemo(
    () =>
      range === "month"
        ? periodStats(trades, monthFrom, monthTo)
        : periodStats(trades),
    [trades, range, monthFrom, monthTo],
  );
  const periodDividends = income
    ? range === "month"
      ? periodIncome(income, monthFrom, monthTo)
      : periodIncome(income)
    : null;
  const incomeFor = (t: JournalTrade) => (income ? tradeIncome(t, income) : null);

  const selectedTrade = allTrades.find((t) => t.key === selectedKey) ?? null;

  const listTrades = useMemo(() => {
    const touches = (t: JournalTrade, pred: (d: string) => boolean) =>
      t.fills.some((f) => pred(f.date));
    if (selectedDate) return trades.filter((t) => touches(t, (d) => d === selectedDate));
    if (range === "all" || filterActive) return trades;
    return trades.filter((t) => touches(t, (d) => d >= monthFrom && d <= monthTo));
  }, [trades, selectedDate, range, filterActive, monthFrom, monthTo]);

  // Weekly review: what closed in the last 7 days, and what still needs words.
  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return isoDate(d);
  }, []);
  const recent = useMemo(
    () => allTrades.filter((t) => t.lastExitDate != null && t.lastExitDate >= weekAgo),
    [allTrades, weekAgo],
  );
  const recentUnreviewed = recent.filter((t) => needsReview(t, notes));
  const recentPnl = periodStats(allTrades, weekAgo).pnl;

  function shiftMonth(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setSelectedDate(null);
  }

  function openTrade(key: string) {
    setSection("trades");
    setSelectedKey(key);
  }

  async function exportCsv() {
    try {
      await saveJournalCsv(tradesToCsv(trades, notes, incomeFor));
    } catch (e) {
      window.alert(`Couldn't export the journal: ${e}`);
    }
  }

  if (fills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground p-8 text-center">
        <NotebookPen className="w-5 h-5" />
        <p className="text-sm font-medium text-foreground">No trades to journal yet</p>
        <p className="text-xs max-w-sm">
          The journal is built from your buys and sells. Record a purchase and a
          sale (or sync a brokerage connection) and your round-trip trades show
          up here with wins, losses and room for notes.
        </p>
      </div>
    );
  }

  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border">
        <div className="inline-flex rounded-md border border-border text-sm overflow-hidden">
          {(["trades", "reports"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={cn("px-4 py-1 capitalize", section === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          title="Export the trades currently shown, with notes, to CSV"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      <JournalFilters
        filter={filter}
        onChange={(f) => { setFilter(f); setSelectedDate(null); }}
        tags={tags}
        shown={trades.length}
        total={allTrades.length}
      />

      {section === "reports" ? (
        <JournalReports trades={trades} notes={notes} onOpenTrade={openTrade} />
      ) : (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left: calendar + stats */}
      <div className="w-[440px] shrink-0 border-r border-border overflow-y-auto p-5 flex flex-col gap-5">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={() => shiftMonth(-1)} className="p-1.5 rounded-full hover:bg-muted" aria-label="Previous month">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center">
              <div className="font-semibold">{MONTHS[cursor.m]} {cursor.y}</div>
              <div className="text-xs text-muted-foreground">Click a day to review its trades</div>
            </div>
            <button type="button" onClick={() => shiftMonth(1)} className="p-1.5 rounded-full hover:bg-muted" aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="text-xs font-semibold text-muted-foreground py-1">{w}</div>
            ))}
            {cells.map((day, i) => {
              if (day == null) return <div key={`e${i}`} />;
              const date = iso(cursor.y, cursor.m, day);
              const s = days.get(date);
              const selected = selectedDate === date;
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!s}
                  onClick={() => {
                    setSelectedDate(selected ? null : date);
                    setSelectedKey(null);
                  }}
                  className={cn(
                    "aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-colors border",
                    !s && "bg-muted/40 text-muted-foreground border-transparent cursor-default",
                    s && s.exits > 0 && s.pnl >= 0 && "bg-positive/15 text-positive border-transparent hover:bg-positive/25",
                    s && s.exits > 0 && s.pnl < 0 && "bg-negative/15 text-negative border-transparent hover:bg-negative/25",
                    s && s.exits === 0 && "bg-warning/15 text-warning border-transparent hover:bg-warning/25",
                    selected && "ring-2 ring-primary",
                  )}
                >
                  <span className="font-semibold leading-none">{day}</span>
                  <span className="text-[10px] mt-1 font-medium leading-none">
                    {!s ? "—" : s.exits > 0 ? compactMoney(s.pnl) : `${s.fills} fill${s.fills === 1 ? "" : "s"}`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <Legend color="bg-positive" label="Profit" />
            <Legend color="bg-negative" label="Loss" />
            <Legend color="bg-warning" label="Fills only" />
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                {range === "month" ? "MONTHLY" : "ALL-TIME"} REALIZED P&L
              </div>
              <div className={cn("text-3xl font-bold tabular-nums mt-1", pnlColor(stats.pnl))}>
                {formatCurrency(stats.pnl)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">WIN RATE</div>
              <div className="text-2xl font-bold tabular-nums mt-1">
                {stats.winRate == null ? "—" : `${Math.round(stats.winRate * 100)}%`}
              </div>
            </div>
          </div>
          <div className="inline-flex rounded-md border border-border mt-3 text-xs overflow-hidden">
            {(["month", "all"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => { setRange(r); setSelectedDate(null); }}
                className={cn("px-3 py-1", range === r ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {r === "month" ? "This month" : "All time"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-border">
            <Stat label="Trades with exits" value={String(stats.trades)} />
            <Stat label="Average win" value={formatCurrency(stats.avgWin)} className="text-positive" />
            <Stat label="Average loss" value={formatCurrency(stats.avgLoss)} className={stats.avgLoss < 0 ? "text-negative" : ""} />
            <Stat label="Profit factor" value={stats.profitFactor == null ? "∞" : stats.profitFactor.toFixed(2)} />
            <Stat label="Best trade" value={stats.best == null ? "—" : formatCurrency(stats.best)} className={pnlColor(stats.best)} />
            <Stat label="Worst trade" value={stats.worst == null ? "—" : formatCurrency(stats.worst)} className={pnlColor(stats.worst)} />
            {periodDividends != null && (
              <>
                <Stat label="Dividends & fees" value={formatCurrency(periodDividends)} className={pnlColor(periodDividends)} />
                <Stat
                  label="Total return"
                  value={formatCurrency(stats.pnl + periodDividends)}
                  className={pnlColor(stats.pnl + periodDividends)}
                  hint="Realized P&L plus dividends, interest and fees in the same period"
                />
              </>
            )}
          </div>
          {income == null && (
            <p className="text-[10px] text-muted-foreground mt-3">
              Trades only — dividends and fees aren't synced from brokerage accounts.
            </p>
          )}
        </div>

        <EquityCurve points={curve} />
      </div>

      {/* Right: trade list / detail */}
      <div className="flex-1 min-w-0 overflow-y-auto p-5">
        {selectedTrade ? (
          <TradeDetail
            trade={selectedTrade}
            note={notes.get(selectedTrade.key)}
            portfolioId={portfolioId}
            income={incomeFor(selectedTrade)}
            onSaved={reloadNotes}
            onBack={() => setSelectedKey(null)}
            onViewChart={onViewChart}
          />
        ) : (
          <>
            {recent.length > 0 && !selectedDate && !filter.unreviewedOnly && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 mb-4 text-sm">
                <div className="flex-1">
                  <span className="font-medium">Weekly review</span>
                  <span className="text-muted-foreground">
                    {" "}· {recent.length} trade{recent.length === 1 ? "" : "s"} with exits in the last 7 days,{" "}
                  </span>
                  <span className={cn("font-medium", pnlColor(recentPnl))}>{formatCurrency(recentPnl)}</span>
                  <span className="text-muted-foreground">
                    {recentUnreviewed.length > 0
                      ? ` · ${recentUnreviewed.length} still need notes`
                      : " · all reviewed ✓"}
                  </span>
                </div>
                {recentUnreviewed.length > 0 && (
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => {
                      setFilter({ ...EMPTY_FILTER, unreviewedOnly: true, from: weekAgo });
                      setRange("all");
                    }}
                  >
                    Review them
                  </button>
                )}
              </div>
            )}
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">
                {selectedDate
                  ? `Trades on ${shortDate(selectedDate)}`
                  : filterActive
                    ? "Filtered trades"
                    : range === "month"
                      ? `Trades in ${MONTHS[cursor.m]} ${cursor.y}`
                      : "All trades"}
              </h2>
              <span className="text-xs text-muted-foreground">{listTrades.length} trade{listTrades.length === 1 ? "" : "s"}</span>
            </div>
            {selectedDate && (
              <NoteBox
                key={`day:${selectedDate}`}
                label="Day notes"
                portfolioId={portfolioId}
                noteKey={`day:${selectedDate}`}
                note={notes.get(`day:${selectedDate}`)}
                onSaved={reloadNotes}
                className="mb-4"
              />
            )}
            {listTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trades in this period.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {listTrades.map((t) => (
                  <TradeRow key={t.key} trade={t} hasNote={notes.has(t.key)} onClick={() => setSelectedKey(t.key)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-full", color)} />
      {label}
    </span>
  );
}

function TradeRow({ trade, hasNote, onClick }: { trade: JournalTrade; hasNote: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 text-left rounded-lg border border-border px-4 py-3 hover:bg-muted/50 transition-colors"
    >
      <span className="font-semibold w-16 shrink-0">{trade.ticker}</span>
      <StatusBadge status={trade.status} />
      <span className="text-xs text-muted-foreground flex-1 truncate">
        {shortDate(trade.openDate)}
        {trade.closeDate && trade.closeDate !== trade.openDate ? ` → ${shortDate(trade.closeDate)}` : ""}
        {" · "}
        {trade.totalBought.toLocaleString(undefined, { maximumFractionDigits: 4 })} sh
      </span>
      {hasNote && <NotebookPen className="w-3.5 h-3.5 text-positive" />}
      <span className={cn("font-semibold tabular-nums", pnlColor(trade.status === "open" ? null : trade.realizedPnl))}>
        {trade.status === "open" ? "—" : formatCurrency(trade.realizedPnl)}
      </span>
    </button>
  );
}

function EquityCurve({ points }: { points: { date: string; cum: number }[] }) {
  if (points.length < 2) return null;
  const W = 400, H = 120, P = 6;
  const vals = points.map((p) => p.cum);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (points.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - min) / span) * (H - 2 * P);
  const last = vals[vals.length - 1];
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground">CUMULATIVE REALIZED P&L</div>
        <div className={cn("text-sm font-semibold tabular-nums", pnlColor(last))}>{formatCurrency(last)}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Cumulative realized profit and loss">
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} className="stroke-border" strokeDasharray="3 3" />
        <polyline
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className={last >= 0 ? "stroke-positive" : "stroke-negative"}
          points={points.map((p, i) => `${x(i)},${y(p.cum)}`).join(" ")}
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{shortDate(points[0].date)}</span>
        <span>{shortDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}
