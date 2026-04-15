import type { TickerSummary } from "../../types";
import { formatCurrency, formatPercent, pnlColor, cn } from "../../lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Wallet, DollarSign, Activity, BarChart2 } from "lucide-react";

interface DashboardProps {
  summaries: TickerSummary[];
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  subColor,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "positive" | "negative" | "none";
}) {
  const borderClass =
    accent === "positive"
      ? "border-green-500/40 bg-green-500/5"
      : accent === "negative"
      ? "border-red-500/40 bg-red-500/5"
      : "border-border bg-background";

  return (
    <div className={cn("rounded-xl border p-5 flex flex-col gap-1.5", borderClass)}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      {sub && (
        <div className={cn("text-sm font-medium tabular-nums", subColor)}>{sub}</div>
      )}
    </div>
  );
}

// ── Recharts custom tooltips ─────────────────────────────────────────────────

type HoldingsRow = {
  ticker: string;
  name: string | null;
  invested: number;
  value?: number;
  pnl: number | null;
};

function HoldingsTooltip({ active, payload }: { active?: boolean; payload?: { payload: HoldingsRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1 min-w-[160px]">
      <div className="font-semibold text-foreground">
        {d.ticker}
        {d.name ? <span className="font-normal text-muted-foreground"> · {d.name}</span> : null}
      </div>
      <div className="text-muted-foreground">
        Invested: <span className="text-foreground">{formatCurrency(d.invested)}</span>
      </div>
      {d.value != null && (
        <div className="text-muted-foreground">
          Value: <span className="text-foreground">{formatCurrency(d.value)}</span>
        </div>
      )}
      {d.pnl != null && (
        <div className={cn("font-medium", pnlColor(d.pnl))}>
          Return: {formatCurrency(d.pnl)}
        </div>
      )}
    </div>
  );
}

type DailyRow = { ticker: string; change: number; pct: number };

function DailyTooltip({ active, payload }: { active?: boolean; payload?: { payload: DailyRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1">
      <div className="font-semibold text-foreground">{d.ticker}</div>
      <div className={cn("font-medium", pnlColor(d.change))}>
        {d.change >= 0 ? "+" : ""}
        {formatCurrency(d.change)}
      </div>
      <div className={cn(pnlColor(d.pct))}>{formatPercent(d.pct)} today</div>
    </div>
  );
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "px-5 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td
      className={cn(
        "px-5 py-3 text-foreground whitespace-nowrap",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </td>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

const TOP_N = 15;
const BAR_H = 44;

export function Dashboard({ summaries }: DashboardProps) {
  if (summaries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No purchases yet. Add some in the Purchases view.
      </div>
    );
  }

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const totalInvested = summaries.reduce((s, t) => s + t.totalInvested, 0);
  const pricedSummaries = summaries.filter((s) => s.marketValue != null);
  const totalValue = pricedSummaries.reduce((s, t) => s + t.marketValue!, 0);
  const totalPnlDollar = pricedSummaries.reduce((s, t) => s + (t.pnlDollar ?? 0), 0);
  const totalPnlPercent =
    totalInvested > 0 ? (totalPnlDollar / totalInvested) * 100 : null;

  const dailySummaries = summaries.filter(
    (s) => s.marketValue != null && s.dailyChangePct != null
  );
  const dailyChangeDollar = dailySummaries.reduce(
    (s, t) => s + (t.marketValue! * t.dailyChangePct!) / 100,
    0
  );
  // Weighted-average daily % across portfolio
  const portfolioDailyPct =
    dailySummaries.length > 0 && totalValue > 0
      ? dailySummaries.reduce(
          (s, t) => s + (t.marketValue! / totalValue) * t.dailyChangePct!,
          0
        )
      : null;

  const hasPrices = pricedSummaries.length > 0;
  const hasDaily = dailySummaries.length > 0;

  // ── Chart data ──────────────────────────────────────────────────────────────
  const holdingsChartData: HoldingsRow[] = [...summaries]
    .sort(
      (a, b) =>
        (b.marketValue ?? b.totalInvested) - (a.marketValue ?? a.totalInvested)
    )
    .slice(0, TOP_N)
    .map((s) => ({
      ticker: s.ticker,
      name: s.name,
      invested: s.totalInvested,
      value: s.marketValue ?? undefined,
      pnl: s.pnlDollar,
    }));

  const dailyChartData: DailyRow[] = [...dailySummaries]
    .map((s) => ({
      ticker: s.ticker,
      change: (s.marketValue! * s.dailyChangePct!) / 100,
      pct: s.dailyChangePct!,
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, TOP_N);

  const tableData = [...summaries].sort(
    (a, b) =>
      (b.marketValue ?? b.totalInvested) - (a.marketValue ?? a.totalInvested)
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 flex flex-col gap-5">

        {/* ── Stat Cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Total Invested"
            value={formatCurrency(totalInvested)}
            sub={`${summaries.length} position${summaries.length === 1 ? "" : "s"}`}
            subColor="text-muted-foreground"
            icon={Wallet}
            accent="none"
          />
          <StatCard
            label="Portfolio Value"
            value={hasPrices ? formatCurrency(totalValue) : "—"}
            icon={DollarSign}
            accent="none"
          />
          <StatCard
            label="Total Return"
            value={hasPrices ? formatCurrency(totalPnlDollar) : "—"}
            sub={totalPnlPercent != null ? formatPercent(totalPnlPercent) : undefined}
            subColor={pnlColor(totalPnlDollar)}
            icon={hasPrices && totalPnlDollar < 0 ? TrendingDown : TrendingUp}
            accent={
              !hasPrices ? "none" : totalPnlDollar > 0 ? "positive" : totalPnlDollar < 0 ? "negative" : "none"
            }
          />
          <StatCard
            label="Today's Net Change"
            value={hasDaily ? formatCurrency(dailyChangeDollar) : "—"}
            sub={portfolioDailyPct != null ? formatPercent(portfolioDailyPct) : undefined}
            subColor={pnlColor(dailyChangeDollar)}
            icon={Activity}
            accent={
              !hasDaily ? "none" : dailyChangeDollar > 0 ? "positive" : dailyChangeDollar < 0 ? "negative" : "none"
            }
          />
        </div>

        {/* ── Charts ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Holdings breakdown — cost basis vs market value */}
          <div className="bg-background border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-0.5">
              Holdings Breakdown
              {summaries.length > TOP_N
                ? <span className="text-xs font-normal text-muted-foreground ml-2">(top {TOP_N})</span>
                : null}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Cost basis <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#94a3b8] align-text-bottom mx-0.5" /> vs. market value (green = gain, red = loss)
            </p>
            <ResponsiveContainer
              width="100%"
              height={holdingsChartData.length * BAR_H + 8}
            >
              <BarChart
                data={holdingsChartData}
                layout="vertical"
                margin={{ top: 0, right: 8, bottom: 0, left: 16 }}
                barCategoryGap={8}
                barSize={13}
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
                  }
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="ticker"
                  tick={{ fontSize: 12, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  content={(props: any) => <HoldingsTooltip {...props} />}
                  cursor={{ fill: "#94a3b815" }}
                />
                <Bar
                  dataKey="invested"
                  name="Invested"
                  fill="#94a3b8"
                  radius={[2, 2, 2, 2]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="value"
                  name="Value"
                  radius={[2, 4, 4, 2]}
                  isAnimationActive={false}
                >
                  {holdingsChartData.map((d) => (
                    <Cell
                      key={d.ticker}
                      fill={
                        d.pnl == null
                          ? "#7c3aed"
                          : d.pnl >= 0
                          ? "#22c55e"
                          : "#ef4444"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Daily movers */}
          <div className="bg-background border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-0.5">
              Today's Change by Position
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Dollar impact on your net worth today
            </p>
            {!hasDaily ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No price data available yet
              </div>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={dailyChartData.length * BAR_H + 8}
              >
                <BarChart
                  data={dailyChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 8, bottom: 0, left: 16 }}
                  barCategoryGap={8}
                  barSize={18}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      `${v >= 0 ? "+" : ""}$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`
                    }
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="ticker"
                    tick={{ fontSize: 12, fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <ReferenceLine x={0} stroke="#e2e8f0" strokeWidth={1} />
                  <Tooltip
                    content={(props: any) => <DailyTooltip {...props} />}
                    cursor={{ fill: "#94a3b815" }}
                  />
                  <Bar dataKey="change" radius={4} isAnimationActive={false}>
                    {dailyChartData.map((d) => (
                      <Cell
                        key={d.ticker}
                        fill={d.change >= 0 ? "#22c55e" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Holdings Table ───────────────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">All Holdings</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <Th>Ticker</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Invested</Th>
                  <Th align="right">Avg Cost</Th>
                  <Th align="right">Current Price</Th>
                  <Th align="right">Market Value</Th>
                  <Th align="right">Return $</Th>
                  <Th align="right">Return %</Th>
                  <Th align="right">Today %</Th>
                  <Th align="right">Portfolio %</Th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((s) => {
                  const portPct =
                    hasPrices && totalValue > 0 && s.marketValue != null
                      ? (s.marketValue / totalValue) * 100
                      : null;
                  return (
                    <tr
                      key={s.ticker}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold text-foreground">{s.ticker}</div>
                        {s.name && (
                          <div className="text-xs text-muted-foreground max-w-[160px] truncate">
                            {s.name}
                          </div>
                        )}
                      </td>
                      <Td align="right">
                        {s.totalShares % 1 === 0
                          ? s.totalShares.toString()
                          : s.totalShares.toFixed(4)}
                      </Td>
                      <Td align="right">{formatCurrency(s.totalInvested)}</Td>
                      <Td align="right">{formatCurrency(s.avgCostBasis)}</Td>
                      <Td align="right">
                        {s.currentPrice != null ? formatCurrency(s.currentPrice) : "—"}
                      </Td>
                      <Td align="right">
                        {s.marketValue != null ? formatCurrency(s.marketValue) : "—"}
                      </Td>
                      <td
                        className={cn(
                          "px-5 py-3 text-right font-medium",
                          pnlColor(s.pnlDollar)
                        )}
                      >
                        {s.pnlDollar != null ? formatCurrency(s.pnlDollar) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-5 py-3 text-right font-medium",
                          pnlColor(s.pnlPercent)
                        )}
                      >
                        {s.pnlPercent != null ? formatPercent(s.pnlPercent) : "—"}
                      </td>
                      <td
                        className={cn("px-5 py-3 text-right", pnlColor(s.dailyChangePct))}
                      >
                        {s.dailyChangePct != null ? formatPercent(s.dailyChangePct) : "—"}
                      </td>
                      <Td align="right">
                        {portPct != null ? `${portPct.toFixed(1)}%` : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              {hasPrices && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                    <td colSpan={2} className="px-5 py-3 text-foreground">
                      Total
                    </td>
                    <td className="px-5 py-3 text-right text-foreground">
                      {formatCurrency(totalInvested)}
                    </td>
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3 text-right text-foreground">
                      {formatCurrency(totalValue)}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3 text-right font-bold",
                        pnlColor(totalPnlDollar)
                      )}
                    >
                      {formatCurrency(totalPnlDollar)}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3 text-right font-bold",
                        pnlColor(totalPnlPercent)
                      )}
                    >
                      {totalPnlPercent != null ? formatPercent(totalPnlPercent) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3 text-right font-bold",
                        pnlColor(dailyChangeDollar)
                      )}
                    >
                      {hasDaily ? formatCurrency(dailyChangeDollar) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
