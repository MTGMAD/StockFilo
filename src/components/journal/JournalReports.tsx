import { useMemo, useState } from "react";
import type { JournalNote } from "../../types";
import { cn, formatCurrency, isCusip, pnlColor } from "../../lib/utils";
import {
  HOLD_ORDER,
  MISTAKE_TAGS,
  WEEKDAY_ORDER,
  computeExcursion,
  groupReport,
  holdBucket,
  mistakeCost,
  parseTags,
  periodStats,
  pnlBuckets,
  rangeCovering,
  realizedTrades,
  weekdayOf,
  type Excursion,
  type GroupRow,
  type JournalTrade,
} from "../../lib/journal";
import { getDailyBars } from "../../lib/journalHistory";
import { Stat, pct } from "./journalUi";

interface JournalReportsProps {
  trades: JournalTrade[];
  notes: Map<string, JournalNote>;
  onOpenTrade: (key: string) => void;
}

export function JournalReports({ trades, notes, onOpenTrade }: JournalReportsProps) {
  const realized = useMemo(() => realizedTrades(trades), [trades]);
  const stats = useMemo(() => periodStats(trades), [trades]);
  const expectancy = realized.length ? stats.pnl / realized.length : 0;
  const closed = realized.filter((t) => t.closeDate != null);
  const avgHold = closed.length ? closed.reduce((s, t) => s + t.holdDays, 0) / closed.length : 0;

  const byTag = useMemo(() => groupReport(trades, (t) => parseTags(notes.get(t.key)?.tags)), [trades, notes]);
  const byTicker = useMemo(() => groupReport(trades, (t) => [t.ticker]), [trades]);
  const byWeekday = useMemo(() => {
    const rows = groupReport(trades, (t) => [weekdayOf(t.lastExitDate!)]);
    return WEEKDAY_ORDER.map((d) => rows.find((r) => r.key === d)).filter(Boolean) as GroupRow[];
  }, [trades]);
  const byHold = useMemo(() => {
    const rows = groupReport(trades.filter((t) => t.closeDate), (t) => [holdBucket(t.holdDays)]);
    return HOLD_ORDER.map((d) => rows.find((r) => r.key === d)).filter(Boolean) as GroupRow[];
  }, [trades]);
  const mistakes = useMemo(() => mistakeCost(trades, notes), [trades, notes]);
  const buckets = useMemo(() => pnlBuckets(trades), [trades]);

  if (realized.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
        Reports appear once a trade has a sale. Nothing in the current filter has one yet.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 [&>*]:shrink-0">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 rounded-xl border border-border p-4">
        <Stat label="Trades with exits" value={String(realized.length)} />
        <Stat label="Win rate" value={stats.winRate == null ? "—" : pct(stats.winRate * 100)} />
        <Stat label="Expectancy" value={formatCurrency(expectancy)} className={pnlColor(expectancy)} hint="Average realized P&L per trade" />
        <Stat label="Profit factor" value={stats.profitFactor == null ? "∞" : stats.profitFactor.toFixed(2)} />
        <Stat label="Avg hold (closed)" value={closed.length ? `${avgHold.toFixed(avgHold < 10 ? 1 : 0)} days` : "—"} />
      </div>

      <section className="rounded-xl border border-border p-4">
        <h3 className="font-semibold mb-1">What mistakes cost you</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Trades you tagged {[...MISTAKE_TAGS].slice(0, 4).join(", ")}, … versus everything else.
        </p>
        {mistakes.mistakeTrades === 0 ? (
          <p className="text-sm text-muted-foreground">
            No trades tagged as a mistake yet. Tag a trade like "fomo" or "early exit" in its notes to see the cost here.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label={`Mistake trades (${mistakes.mistakeTrades})`}
              value={formatCurrency(mistakes.mistakePnl)}
              className={pnlColor(mistakes.mistakePnl)}
            />
            <Stat
              label={`Everything else (${mistakes.otherTrades})`}
              value={formatCurrency(mistakes.otherPnl)}
              className={pnlColor(mistakes.otherPnl)}
            />
          </div>
        )}
      </section>

      <GroupTable title="By tag" rows={byTag} empty="Tag your trades in their notes to see which setups work." flagMistakes />
      <GroupTable title="By ticker" rows={byTicker} />
      <GroupTable title="By day of week sold" rows={byWeekday} />
      <GroupTable title="By holding time (closed trades)" rows={byHold} />

      <section className="rounded-xl border border-border p-4">
        <h3 className="font-semibold mb-3">How big are your wins and losses?</h3>
        <Histogram buckets={buckets} />
      </section>

      <ExitAnalysis trades={trades} onOpenTrade={onOpenTrade} />
    </div>
  );
}

function GroupTable({
  title, rows, empty, flagMistakes,
}: {
  title: string;
  rows: GroupRow[];
  empty?: string;
  flagMistakes?: boolean;
}) {
  return (
    <section className="rounded-xl border border-border overflow-hidden">
      <h3 className="font-semibold px-4 py-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{empty ?? "Nothing to show."}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-y border-border bg-muted/40">
            <tr>
              <th className="text-left font-medium px-4 py-1.5">Group</th>
              <th className="text-right font-medium px-2 py-1.5">Trades</th>
              <th className="text-right font-medium px-2 py-1.5">Win rate</th>
              <th className="text-right font-medium px-2 py-1.5">Avg win</th>
              <th className="text-right font-medium px-2 py-1.5">Avg loss</th>
              <th className="text-right font-medium px-2 py-1.5">Expectancy</th>
              <th className="text-right font-medium px-4 py-1.5">Total P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="px-4 py-1.5 font-medium">
                  {r.key}
                  {flagMistakes && MISTAKE_TAGS.has(r.key) && (
                    <span className="ml-2 text-[10px] uppercase text-negative">mistake</span>
                  )}
                </td>
                <td className="text-right px-2 tabular-nums">{r.trades}</td>
                <td className="text-right px-2 tabular-nums">{pct(r.winRate * 100)}</td>
                <td className="text-right px-2 tabular-nums text-positive">{r.wins ? formatCurrency(r.avgWin) : "—"}</td>
                <td className="text-right px-2 tabular-nums text-negative">{r.trades - r.wins ? formatCurrency(r.avgLoss) : "—"}</td>
                <td className={cn("text-right px-2 tabular-nums", pnlColor(r.expectancy))}>{formatCurrency(r.expectancy)}</td>
                <td className={cn("text-right px-4 tabular-nums font-semibold", pnlColor(r.pnl))}>{formatCurrency(r.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Histogram({ buckets }: { buckets: { lo: number; hi: number; n: number }[] }) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.n));
  const W = 400, H = 110, gap = 4;
  const bw = (W - gap * (buckets.length - 1)) / buckets.length;
  const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-44" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Distribution of trade results">
        {buckets.map((b, i) => {
          const h = max ? (b.n / max) * (H - 16) : 0;
          const mid = (b.lo + b.hi) / 2;
          return (
            <g key={i}>
              <rect
                x={i * (bw + gap)}
                y={H - h}
                width={bw}
                height={h}
                rx={2}
                className={mid >= 0 ? "fill-positive" : "fill-negative"}
                opacity={0.85}
              >
                <title>{`${money(b.lo)} to ${money(b.hi)}: ${b.n} trade${b.n === 1 ? "" : "s"}`}</title>
              </rect>
              {b.n > 0 && (
                <text x={i * (bw + gap) + bw / 2} y={H - h - 3} textAnchor="middle" fontSize={9} className="fill-muted-foreground">
                  {b.n}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{money(buckets[0].lo)}</span>
        <span>{money(buckets[buckets.length - 1].hi)}</span>
      </div>
    </div>
  );
}

// ── Exit analysis ────────────────────────────────────────────────────────

interface ExitRow {
  trade: JournalTrade;
  ex: Excursion;
}

function ExitAnalysis({
  trades, onOpenTrade,
}: {
  trades: JournalTrade[];
  onOpenTrade: (key: string) => void;
}) {
  const candidates = useMemo(
    () => trades.filter((t) => t.closeDate && t.holdDays > 0 && t.avgExit != null && !isCusip(t.ticker)),
    [trades],
  );
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<ExitRow[]>([]);
  const [failed, setFailed] = useState(0);

  async function run() {
    setState("running");
    setRows([]);
    setFailed(0);
    // One history request per ticker, wide enough for its oldest trade.
    const byTicker = new Map<string, JournalTrade[]>();
    for (const t of candidates) byTicker.set(t.ticker, [...(byTicker.get(t.ticker) ?? []), t]);
    const tickers = [...byTicker.keys()];
    setProgress({ done: 0, total: tickers.length });
    const out: ExitRow[] = [];
    let bad = 0;
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < tickers.length) {
        const ticker = tickers[next++];
        const list = byTicker.get(ticker)!;
        const oldest = list.reduce((m, t) => (t.openDate < m ? t.openDate : m), list[0].openDate);
        try {
          const bars = await getDailyBars(ticker, rangeCovering(oldest));
          for (const t of list) {
            const ex = computeExcursion(t, bars);
            if (ex) out.push({ trade: t, ex });
            else bad += 1;
          }
        } catch {
          bad += list.length;
        }
        done += 1;
        setProgress({ done, total: tickers.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRows(out);
    setFailed(bad);
    setState("done");
  }

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const eff = rows.map((r) => r.ex.exitEfficiency).filter((x): x is number => x != null);
    return {
      mfe: avg(rows.map((r) => r.ex.mfePct)),
      mae: avg(rows.map((r) => r.ex.maePct)),
      eff: eff.length ? avg(eff) : null,
      gaveBack: rows.reduce((s, r) => s + r.ex.gaveBack, 0),
      top: [...rows].sort((a, b) => b.ex.gaveBack - a.ex.gaveBack).slice(0, 5),
    };
  }, [rows]);

  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="font-semibold mb-1">How well do you sell?</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Compares each closed trade's exit with the highest and lowest prices during the hold. Uses daily price
        history, so same-day trades are skipped.
      </p>
      {state === "idle" && (
        <button type="button" className="btn-primary text-sm" disabled={candidates.length === 0} onClick={run}>
          {candidates.length === 0 ? "No closed multi-day trades" : `Analyze ${candidates.length} trades`}
        </button>
      )}
      {state === "running" && (
        <p className="text-sm text-muted-foreground">
          Loading price history… {progress.done} of {progress.total} tickers
        </p>
      )}
      {state === "done" && !summary && (
        <p className="text-sm text-muted-foreground">Price history wasn't available for these trades.</p>
      )}
      {state === "done" && summary && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Avg exit efficiency" value={summary.eff == null ? "—" : pct(summary.eff * 100)} hint="Share of the peak gain captured when selling" />
            <Stat label="Avg peak gain" value={`+${pct(summary.mfe, 1)}`} className="text-positive" />
            <Stat label="Avg max drawdown" value={pct(summary.mae, 1)} className="text-negative" />
            <Stat label="Total gave back" value={formatCurrency(summary.gaveBack)} hint="Gains between your exits and each trade's peak" />
          </div>
          {summary.eff != null && (
            <p className="text-sm">
              On average you sold at <strong>{pct(summary.eff * 100)}</strong> of each trade's peak gain.
              {summary.eff < 0.5 ? " That suggests selling earlier than the highs more often than not — worth a look at trailing exits." : ""}
            </p>
          )}
          <div>
            <div className="text-xs font-semibold tracking-wide text-muted-foreground mb-2">GAVE BACK THE MOST</div>
            <div className="flex flex-col gap-1">
              {summary.top.map(({ trade, ex }) => (
                <button
                  key={trade.key}
                  type="button"
                  onClick={() => onOpenTrade(trade.key)}
                  className="flex items-center gap-3 text-left rounded-md px-3 py-2 hover:bg-muted/50 text-sm"
                >
                  <span className="font-semibold w-16">{trade.ticker}</span>
                  <span className="flex-1 text-xs text-muted-foreground">
                    peak +{pct(ex.mfePct, 1)} · exit {ex.exitEfficiency == null ? "—" : pct(ex.exitEfficiency * 100)} of peak
                  </span>
                  <span className="tabular-nums font-medium">{formatCurrency(ex.gaveBack)}</span>
                </button>
              ))}
            </div>
          </div>
          {failed > 0 && (
            <p className="text-xs text-muted-foreground">{failed} trade{failed === 1 ? "" : "s"} skipped (no price history).</p>
          )}
          <button type="button" className="text-xs text-primary hover:underline self-start" onClick={run}>
            Re-run
          </button>
        </div>
      )}
    </section>
  );
}
