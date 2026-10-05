import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LineChart,
  NotebookPen,
} from "lucide-react";
import type { JournalNote } from "../../types";
import { cn, formatCurrency, pnlColor } from "../../lib/utils";
import { listJournalNotes, setJournalNote } from "../../lib/db";
import {
  buildTrades,
  equityCurve,
  periodStats,
  summarizeDays,
  type Fill,
  type JournalTrade,
} from "../../lib/journal";

interface JournalViewProps {
  portfolioId: number;
  fills: Fill[];
  onViewChart: (ticker: string) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function shortDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function compactMoney(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function holdLabel(days: number): string {
  if (days === 0) return "Same day";
  return days === 1 ? "1 day" : `${days} days`;
}

export function JournalView({ portfolioId, fills, onViewChart }: JournalViewProps) {
  const trades = useMemo(() => buildTrades(fills), [fills]);
  const days = useMemo(() => summarizeDays(trades), [trades]);
  const curve = useMemo(() => equityCurve(days), [days]);

  const latest = useMemo(() => {
    const dates = [...days.keys()].sort();
    const last = dates[dates.length - 1];
    if (last) {
      const [y, m] = last.split("-").map(Number);
      return { y, m: m - 1 };
    }
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }, [days]);

  const [cursor, setCursor] = useState(latest);
  const [range, setRange] = useState<"month" | "all">("month");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Map<string, JournalNote>>(new Map());

  useEffect(() => {
    setCursor(latest);
    setSelectedDate(null);
    setSelectedKey(null);
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

  const selectedTrade = trades.find((t) => t.key === selectedKey) ?? null;

  const listTrades = useMemo(() => {
    const touches = (t: JournalTrade, pred: (d: string) => boolean) =>
      t.fills.some((f) => pred(f.date));
    if (selectedDate) return trades.filter((t) => touches(t, (d) => d === selectedDate));
    if (range === "all") return trades;
    return trades.filter((t) => touches(t, (d) => d >= monthFrom && d <= monthTo));
  }, [trades, selectedDate, range, monthFrom, monthTo]);

  function shiftMonth(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setSelectedDate(null);
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
          </div>
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
            onSaved={reloadNotes}
            onBack={() => setSelectedKey(null)}
            onViewChart={onViewChart}
          />
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">
                {selectedDate
                  ? `Trades on ${shortDate(selectedDate)}`
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

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: JournalTrade["status"] }) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
        status === "win" && "bg-positive/15 text-positive",
        status === "loss" && "bg-negative/15 text-negative",
        status === "open" && "bg-warning/15 text-warning",
        status === "partial" && "bg-primary/15 text-primary",
      )}
    >
      {status === "partial" ? "partial exit" : status}
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

function TradeDetail({
  trade, note, portfolioId, onSaved, onBack, onViewChart,
}: {
  trade: JournalTrade;
  note: JournalNote | undefined;
  portfolioId: number;
  onSaved: () => void;
  onBack: () => void;
  onViewChart: (ticker: string) => void;
}) {
  const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const exits = Object.keys(trade.exitPnl).length;
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
      </div>

      <button
        type="button"
        onClick={() => onViewChart(trade.ticker)}
        className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-primary hover:bg-muted/50"
      >
        <LineChart className="w-4 h-4" />
        View {trade.ticker} chart
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

function NoteBox({
  label, portfolioId, noteKey, note, onSaved, withLesson, withTags, className,
}: {
  label: string;
  portfolioId: number;
  noteKey: string;
  note: JournalNote | undefined;
  onSaved: () => void;
  withLesson?: boolean;
  withTags?: boolean;
  className?: string;
}) {
  const [reflection, setReflection] = useState(note?.reflection ?? "");
  const [lesson, setLesson] = useState(note?.lesson ?? "");
  const [tags, setTags] = useState(note?.tags ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    reflection !== (note?.reflection ?? "") ||
    lesson !== (note?.lesson ?? "") ||
    tags !== (note?.tags ?? "");

  // Latest values for the unmount flush, which can't see fresh state.
  const latest = useRef({ reflection, lesson, tags, dirty });
  latest.current = { reflection, lesson, tags, dirty };

  // Autosave shortly after typing stops, so a note is never lost to a
  // forgotten Save click.
  useEffect(() => {
    if (!dirty) return;
    setStatus("idle");
    const timer = setTimeout(async () => {
      setStatus("saving");
      setError(null);
      try {
        await setJournalNote(portfolioId, noteKey, reflection, lesson, tags);
        setStatus("saved");
        onSaved();
      } catch (e) {
        setStatus("idle");
        setError(String(e));
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflection, lesson, tags]);

  // Leaving the screen (or switching trade) inside the debounce window.
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.dirty) {
        void setJournalNote(portfolioId, noteKey, l.reflection, l.lesson, l.tags).then(
          onSaved,
          () => {},
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const area = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y min-h-[80px]";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
      <textarea
        className={area}
        placeholder={withLesson ? "What was the thesis? How did you execute?" : "How did the day go?"}
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
      />
      {withLesson && (
        <textarea
          className={area}
          placeholder="What would you do differently next time?"
          value={lesson}
          onChange={(e) => setLesson(e.target.value)}
        />
      )}
      {withTags && (
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Tags, comma separated (e.g. breakout, earnings, FOMO)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
      )}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {error ? (
            <span className="text-negative">Couldn't save: {error}</span>
          ) : status === "saving" ? (
            "Saving…"
          ) : dirty ? (
            "Unsaved changes…"
          ) : status === "saved" || note ? (
            "Saved"
          ) : (
            "Notes save automatically"
          )}
        </span>
      </div>
    </div>
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
