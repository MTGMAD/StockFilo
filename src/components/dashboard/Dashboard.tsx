import { useState } from "react";
import type { TickerSummary, InvestorMode, Portfolio } from "../../types";
import { formatCurrency, formatPercent, pnlColor, getCssVar, cn } from "../../lib/utils";
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
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  DollarSign,
  Activity,
  BarChart2,
  GraduationCap,
  LineChart,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Info,
  Star,
} from "lucide-react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

interface DashboardProps {
  summaries: TickerSummary[];
  investorMode: InvestorMode;
  onModeChange: (m: InvestorMode) => void;
  showInfoTooltips: boolean;
  portfolios: Portfolio[];
  activePortfolioId: number | null;
  onSelectPortfolio: (id: number) => void;
}

// ── Mode toggle pill ──────────────────────────────────────────────────────────

function ModePill({
  mode,
  onChange,
}: {
  mode: InvestorMode;
  onChange: (m: InvestorMode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 text-xs font-medium">
      <button
        onClick={() => onChange("novice")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors",
          mode === "novice"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <GraduationCap className="w-3 h-3" />
        Novice
      </button>
      <button
        onClick={() => onChange("advanced")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors",
          mode === "advanced"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <LineChart className="w-3 h-3" />
        Advanced
      </button>
    </div>
  );
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  subColor,
  icon: Icon,
  accent,
  tooltip,
  showTooltip = true,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "positive" | "negative" | "none";
  tooltip?: string;
  showTooltip?: boolean;
}) {
  const borderClass =
    accent === "positive"
      ? "border-positive/40 bg-positive/5"
      : accent === "negative"
      ? "border-negative/40 bg-negative/5"
      : "border-border bg-background";

  const card = (
    <div className={cn("rounded-xl border p-5 flex flex-col gap-1.5", borderClass)}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
        {tooltip && showTooltip && <Info className="w-3 h-3 ml-auto cursor-help opacity-40 hover:opacity-100 transition-opacity" />}
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      {sub && (
        <div className={cn("text-sm font-medium tabular-nums", subColor)}>{sub}</div>
      )}
    </div>
  );

  if (!tooltip || !showTooltip) return card;

  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{card}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="bottom"
            sideOffset={8}
            className="z-50 max-w-[240px] rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-xl"
          >
            {tooltip}
            <RadixTooltip.Arrow className="fill-foreground" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
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

function HoldingsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: HoldingsRow }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1 min-w-[160px]">
      <div className="font-semibold text-foreground">
        {d.ticker}
        {d.name ? (
          <span className="font-normal text-muted-foreground"> · {d.name}</span>
        ) : null}
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

function DailyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DailyRow }[];
}) {
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

// ── Table sort helpers ────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";
type SortKey =
  | "ticker"
  | "totalShares"
  | "totalInvested"
  | "avgCostBasis"
  | "currentPrice"
  | "marketValue"
  | "pnlDollar"
  | "pnlPercent"
  | "dailyChangePct"
  | "portPct";

function SortIcon({
  colKey,
  sortKey,
  sortDir,
}: {
  colKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (colKey !== sortKey) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
  return sortDir === "asc" ? (
    <ChevronUp className="w-3 h-3" />
  ) : (
    <ChevronDown className="w-3 h-3" />
  );
}

function Th({
  children,
  align = "left",
  sortKey: colKey,
  activeSortKey,
  sortDir,
  onSort,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  sortKey?: SortKey;
  activeSortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (k: SortKey) => void;
}) {
  const isClickable = colKey && onSort;
  return (
    <th
      onClick={isClickable ? () => onSort(colKey) : undefined}
      className={cn(
        "px-5 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        isClickable && "cursor-pointer select-none hover:text-foreground transition-colors"
      )}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "justify-end w-full")}>
        {children}
        {colKey && activeSortKey !== undefined && sortDir !== undefined && (
          <SortIcon colKey={colKey} sortKey={activeSortKey} sortDir={sortDir} />
        )}
      </span>
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
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

// ── Portfolio Health (novice) ─────────────────────────────────────────────────

function PortfolioHealth({
  summaries,
  totalValue,
  hasPrices,
}: {
  summaries: TickerSummary[];
  totalValue: number;
  hasPrices: boolean;
}) {
  const maxPct =
    hasPrices && totalValue > 0
      ? Math.max(
          ...summaries
            .filter((s) => s.marketValue != null)
            .map((s) => (s.marketValue! / totalValue) * 100)
        )
      : null;

  const diversification =
    maxPct == null
      ? null
      : maxPct >= 50
      ? {
          label: "Concentrated",
          color: "text-negative",
          bg: "bg-negative/10 border-negative/30",
          desc: "One position makes up over half your portfolio.",
        }
      : maxPct >= 25
      ? {
          label: "Moderately Diversified",
          color: "text-warning",
          bg: "bg-warning/10 border-warning/30",
          desc: "One position holds a large share. Consider spreading out.",
        }
      : {
          label: "Well Diversified",
          color: "text-positive",
          bg: "bg-positive/10 border-positive/30",
          desc: "Your portfolio is spread across many positions.",
        };

  const priced = summaries.filter((s) => s.pnlDollar != null);
  const winners = priced.filter((s) => (s.pnlDollar ?? 0) > 0).length;
  const losers = priced.filter((s) => (s.pnlDollar ?? 0) < 0).length;
  const flat = priced.filter((s) => (s.pnlDollar ?? 0) === 0).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div
        className={cn(
          "rounded-xl border p-5",
          diversification ? diversification.bg : "border-border bg-background"
        )}
      >
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Portfolio Spread
        </div>
        {diversification ? (
          <>
            <div className={cn("text-lg font-bold", diversification.color)}>
              {diversification.label}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{diversification.desc}</p>
            {maxPct != null && (
              <div className="text-xs text-muted-foreground mt-1">
                Largest position:{" "}
                <span className="font-medium text-foreground">{maxPct.toFixed(1)}%</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground">No price data yet</div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Winners vs Losers
        </div>
        {priced.length === 0 ? (
          <div className="text-sm text-muted-foreground">No price data yet</div>
        ) : (
          <>
            <div className="flex items-center gap-3 mt-1">
              {winners > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-4 h-4 text-positive" />
                  <span className="text-lg font-bold text-positive">{winners}</span>
                  <span className="text-xs text-muted-foreground">up</span>
                </div>
              )}
              {losers > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingDown className="w-4 h-4 text-negative" />
                  <span className="text-lg font-bold text-negative">{losers}</span>
                  <span className="text-xs text-muted-foreground">down</span>
                </div>
              )}
              {flat > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-lg font-bold text-muted-foreground">{flat}</span>
                  <span className="text-xs text-muted-foreground">flat</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Based on total return since you bought each position.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Asset Type Allocation (advanced) ─────────────────────────────────────────

const QUOTE_TYPE_LABELS: Record<string, string> = {
  EQUITY: "Stocks",
  ETF: "ETFs",
  MUTUALFUND: "Mutual Funds",
  INDEX: "Indices",
  CRYPTOCURRENCY: "Crypto",
  CURRENCY: "Currency",
  FUTURE: "Futures",
};

function AssetAllocation({
  summaries,
  totalValue,
  totalInvested,
}: {
  summaries: TickerSummary[];
  totalValue: number;
  totalInvested: number;
}) {
  const base = totalValue > 0 ? totalValue : totalInvested;

  type Bucket = { label: string; value: number; count: number };
  const buckets = new Map<string, Bucket>();

  for (const s of summaries) {
    const raw = s.quoteType?.toUpperCase() ?? "EQUITY";
    const label = QUOTE_TYPE_LABELS[raw] ?? raw;
    const val = s.marketValue ?? s.totalInvested;
    const existing = buckets.get(label);
    if (existing) {
      existing.value += val;
      existing.count += 1;
    } else {
      buckets.set(label, { label, value: val, count: 1 });
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.value - a.value);
  const COLORS = [getCssVar("--primary"), getCssVar("--chart-2"), "#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#a78bfa"];

  return (
    <div className="bg-background border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-0.5">Asset Type Allocation</h3>
      <p className="text-xs text-muted-foreground mb-4">
        How your portfolio is split by security type
      </p>
      <div className="flex h-4 w-full rounded-full overflow-hidden mb-4 gap-px">
        {sorted.map((b, i) => (
          <div
            key={b.label}
            style={{
              width: `${(b.value / base) * 100}%`,
              backgroundColor: COLORS[i % COLORS.length],
            }}
            title={`${b.label}: ${((b.value / base) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {sorted.map((b, i) => (
          <div key={b.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-muted-foreground">{b.label}</span>
            <span className="font-medium text-foreground">
              {((b.value / base) * 100).toFixed(1)}%
            </span>
            <span className="text-muted-foreground">({b.count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Winners / Losers summary row (advanced) ───────────────────────────────────

function WinnersLosersBadge({ summaries }: { summaries: TickerSummary[] }) {
  const priced = summaries.filter((s) => s.pnlDollar != null);
  if (priced.length === 0) return null;

  const winners = priced.filter((s) => (s.pnlDollar ?? 0) > 0).length;
  const losers = priced.filter((s) => (s.pnlDollar ?? 0) < 0).length;
  const flat = priced.filter((s) => (s.pnlDollar ?? 0) === 0).length;

  const topGainer = [...priced].sort((a, b) => (b.pnlDollar ?? 0) - (a.pnlDollar ?? 0))[0];
  const topLoser = [...priced].sort((a, b) => (a.pnlDollar ?? 0) - (b.pnlDollar ?? 0))[0];

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-background border border-border rounded-xl text-sm">
      {winners > 0 && (
        <span className="flex items-center gap-1 text-positive font-medium">
          <TrendingUp className="w-3.5 h-3.5" />
          {winners} gainer{winners !== 1 ? "s" : ""}
        </span>
      )}
      {losers > 0 && (
        <span className="flex items-center gap-1 text-negative font-medium">
          <TrendingDown className="w-3.5 h-3.5" />
          {losers} loser{losers !== 1 ? "s" : ""}
        </span>
      )}
      {flat > 0 && (
        <span className="text-muted-foreground">{flat} flat</span>
      )}
      <span className="text-muted-foreground">·</span>
      {topGainer && (topGainer.pnlDollar ?? 0) > 0 && (
        <span className="text-xs text-muted-foreground">
          Best: <span className="font-semibold text-positive">{topGainer.ticker}</span>{" "}
          {formatCurrency(topGainer.pnlDollar!)}
        </span>
      )}
      {topLoser && (topLoser.pnlDollar ?? 0) < 0 && (
        <span className="text-xs text-muted-foreground">
          Worst: <span className="font-semibold text-negative">{topLoser.ticker}</span>{" "}
          {formatCurrency(topLoser.pnlDollar!)}
        </span>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

const TOP_N = 15;
const BAR_H = 44;

function dailyDollarChange(currentValue: number, dailyChangePct: number): number {
  const changeRatio = dailyChangePct / 100;
  if (changeRatio <= -1) return 0;
  const previousValue = currentValue / (1 + changeRatio);
  return currentValue - previousValue;
}

export function Dashboard({ summaries, investorMode, onModeChange, showInfoTooltips, portfolios, activePortfolioId, onSelectPortfolio }: DashboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const portfolioTabBar = portfolios.length > 1 ? (
    <div className="flex items-center gap-1 border-b border-border px-4 xl:px-6 overflow-x-auto shrink-0 bg-background">
      {portfolios.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelectPortfolio(p.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors shrink-0",
            activePortfolioId === p.id
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {p.is_starred === 1 && (
            <Star className="w-3 h-3 fill-yellow-500 text-yellow-500 shrink-0" />
          )}
          {p.name}
        </button>
      ))}
    </div>
  ) : null;

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {portfolioTabBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-6">
          <div className="text-muted-foreground text-sm">
            No purchases yet. Select this portfolio and use the Purchases tab to add some.
          </div>
          <ModePill mode={investorMode} onChange={onModeChange} />
        </div>
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
    (s, t) => s + dailyDollarChange(t.marketValue!, t.dailyChangePct!),
    0
  );
  const portfolioDailyPct =
    dailySummaries.length > 0 && totalValue > 0
      ? dailySummaries.reduce(
          (s, t) => s + (t.marketValue! / totalValue) * t.dailyChangePct!,
          0
        )
      : null;

  const hasPrices = pricedSummaries.length > 0;
  const hasDaily = dailySummaries.length > 0;

  const largestPositionPct =
    hasPrices && totalValue > 0
      ? Math.max(...pricedSummaries.map((s) => (s.marketValue! / totalValue) * 100))
      : null;

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
      change: dailyDollarChange(s.marketValue!, s.dailyChangePct!),
      pct: s.dailyChangePct!,
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, TOP_N);

  // ── Sort handler ────────────────────────────────────────────────────────────
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const tableData = [...summaries]
    .map((s) => {
      const portPct =
        hasPrices && totalValue > 0 && s.marketValue != null
          ? (s.marketValue / totalValue) * 100
          : null;
      return { ...s, portPct };
    })
    .sort((a, b) => {
      let av: number | null | string;
      let bv: number | null | string;
      if (sortKey === "portPct") {
        av = a.portPct;
        bv = b.portPct;
      } else if (sortKey === "ticker") {
        av = a.ticker;
        bv = b.ticker;
      } else {
        av = a[sortKey as keyof TickerSummary] as number | null;
        bv = b[sortKey as keyof TickerSummary] as number | null;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc"
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });

  // ── Shared charts ───────────────────────────────────────────────────────────
  const positiveColor = getCssVar("--positive");
  const negativeColor = getCssVar("--negative");
  const primaryColor = getCssVar("--primary");

  const chartsSection = (
    <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4">
      <div className="bg-background border border-border rounded-xl p-4 xl:p-5">
        <h3 className="text-sm font-semibold text-foreground mb-0.5">
          Holdings Breakdown
          {summaries.length > TOP_N ? (
            <span className="text-xs font-normal text-muted-foreground ml-2">
              (top {TOP_N})
            </span>
          ) : null}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Cost basis{" "}
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#94a3b8] align-text-bottom mx-0.5" />{" "}
          vs. market value (green = gain, red = loss)
        </p>
        <ResponsiveContainer width="100%" height={holdingsChartData.length * BAR_H + 8}>
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
            <Bar dataKey="invested" name="Invested" fill="#94a3b8" radius={[2, 2, 2, 2]} isAnimationActive={false} />
            <Bar dataKey="value" name="Value" radius={[2, 4, 4, 2]} isAnimationActive={false}>
              {holdingsChartData.map((d) => (
                <Cell
                  key={d.ticker}
                  fill={d.pnl == null ? primaryColor : d.pnl >= 0 ? positiveColor : negativeColor}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-background border border-border rounded-xl p-4 xl:p-5">
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
          <ResponsiveContainer width="100%" height={dailyChartData.length * BAR_H + 8}>
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
                  `${v >= 0 ? "+" : ""}$${
                    Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)
                  }`
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
                  <Cell key={d.ticker} fill={d.change >= 0 ? positiveColor : negativeColor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // NOVICE MODE
  // ════════════════════════════════════════════════════════════════════════════
  if (investorMode === "novice") {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {portfolioTabBar}
        <div className="flex-1 overflow-y-auto">
        <div className="p-4 xl:p-6 flex flex-col gap-4 xl:gap-5">
          <div className="flex items-center justify-end">
            <ModePill mode={investorMode} onChange={onModeChange} />
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4">
            <StatCard
              label="Money You Put In"
              value={formatCurrency(totalInvested)}
              sub={`${summaries.length} position${summaries.length === 1 ? "" : "s"}`}
              subColor="text-muted-foreground"
              icon={Wallet}
              accent="none"
              tooltip="The total amount of money you have invested across all your positions."
              showTooltip={showInfoTooltips}
            />
            <StatCard
              label="What It's Worth Now"
              value={hasPrices ? formatCurrency(totalValue) : "—"}
              icon={DollarSign}
              accent="none"
              tooltip="The current market value of your entire portfolio based on the latest prices."
              showTooltip={showInfoTooltips}
            />
            <StatCard
              label="Your Profit / Loss"
              value={hasPrices ? formatCurrency(totalPnlDollar) : "—"}
              sub={totalPnlPercent != null ? formatPercent(totalPnlPercent) : undefined}
              subColor={pnlColor(totalPnlDollar)}
              icon={hasPrices && totalPnlDollar < 0 ? TrendingDown : TrendingUp}
              accent={
                !hasPrices ? "none" : totalPnlDollar > 0 ? "positive" : totalPnlDollar < 0 ? "negative" : "none"
              }
              tooltip="The difference between what your portfolio is worth today versus what you paid. Positive means you are up, negative means you are down."
              showTooltip={showInfoTooltips}
            />
            <StatCard
              label="Change Since Yesterday"
              value={hasDaily ? formatCurrency(dailyChangeDollar) : "—"}
              sub={portfolioDailyPct != null ? formatPercent(portfolioDailyPct) : undefined}
              subColor={pnlColor(dailyChangeDollar)}
              icon={Activity}
              accent={
                !hasDaily ? "none" : dailyChangeDollar > 0 ? "positive" : dailyChangeDollar < 0 ? "negative" : "none"
              }
              tooltip="How much your total portfolio value changed since yesterday's market close."
              showTooltip={showInfoTooltips}
            />
          </div>

          <PortfolioHealth summaries={summaries} totalValue={totalValue} hasPrices={hasPrices} />

          {chartsSection}

          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Your Holdings</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-2.5 text-xs font-medium text-muted-foreground text-left">Stock</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-muted-foreground text-right">Current Value</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-muted-foreground text-right">Total Return</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-muted-foreground text-right">Today</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-muted-foreground text-right">Your Share</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summaries]
                    .sort(
                      (a, b) =>
                        (b.marketValue ?? b.totalInvested) - (a.marketValue ?? a.totalInvested)
                    )
                    .map((s) => {
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
                              <div className="text-xs text-muted-foreground max-w-[180px] truncate">
                                {s.name}
                              </div>
                            )}
                          </td>
                          <Td align="right">
                            {s.marketValue != null ? formatCurrency(s.marketValue) : "—"}
                          </Td>
                          <td className={cn("px-5 py-3 text-right font-medium", pnlColor(s.pnlPercent))}>
                            {s.pnlPercent != null ? formatPercent(s.pnlPercent) : "—"}
                          </td>
                          <td className={cn("px-5 py-3 text-right", pnlColor(s.dailyChangePct))}>
                            {s.dailyChangePct != null ? formatPercent(s.dailyChangePct) : "—"}
                          </td>
                          <Td align="right">
                            {portPct != null ? `${portPct.toFixed(1)}%` : "—"}
                          </Td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ADVANCED MODE
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {portfolioTabBar}
      <div className="flex-1 overflow-y-auto">
      <div className="p-4 xl:p-6 flex flex-col gap-4 xl:gap-5">
        <div className="flex items-center justify-end">
          <ModePill mode={investorMode} onChange={onModeChange} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 xl:gap-4">
          <StatCard
            label="Total Invested"
            value={formatCurrency(totalInvested)}
            sub={`${summaries.length} position${summaries.length === 1 ? "" : "s"}`}
            subColor="text-muted-foreground"
            icon={Wallet}
            accent="none"
            tooltip="The total amount of money you have invested across all your positions."
            showTooltip={showInfoTooltips}
          />
          <StatCard
            label="Portfolio Value"
            value={hasPrices ? formatCurrency(totalValue) : "—"}
            icon={DollarSign}
            accent="none"
            tooltip="The current market value of your entire portfolio based on the latest prices."
            showTooltip={showInfoTooltips}
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
            tooltip="Your total gain or loss in dollars and percentage across all positions since purchase."
            showTooltip={showInfoTooltips}
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
            tooltip="How much your total portfolio value changed since yesterday's market close."
            showTooltip={showInfoTooltips}
          />
          <StatCard
            label="Concentration"
            value={largestPositionPct != null ? `${largestPositionPct.toFixed(1)}%` : "—"}
            sub="Largest position"
            subColor={
              largestPositionPct == null
                ? undefined
                : largestPositionPct >= 50
                ? "text-negative"
                : largestPositionPct >= 25
                ? "text-warning"
                : "text-positive"
            }
            icon={BarChart2}
            accent="none"
            tooltip="The percentage of your portfolio held in your single largest position. High concentration increases risk."
            showTooltip={showInfoTooltips}
          />
        </div>

        <WinnersLosersBadge summaries={summaries} />

        {chartsSection}

        <AssetAllocation summaries={summaries} totalValue={totalValue} totalInvested={totalInvested} />

        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">All Holdings</h3>
            <span className="text-xs text-muted-foreground ml-1">— click a column to sort</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <Th sortKey="ticker" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Ticker</Th>
                  <Th align="right" sortKey="totalShares" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Shares</Th>
                  <Th align="right" sortKey="totalInvested" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Invested</Th>
                  <Th align="right" sortKey="avgCostBasis" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Avg Cost</Th>
                  <Th align="right" sortKey="currentPrice" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Current Price</Th>
                  <Th align="right" sortKey="marketValue" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Market Value</Th>
                  <Th align="right" sortKey="pnlDollar" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Return $</Th>
                  <Th align="right" sortKey="pnlPercent" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Return %</Th>
                  <Th align="right" sortKey="dailyChangePct" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Today %</Th>
                  <Th align="right" sortKey="portPct" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Portfolio %</Th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((s) => (
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
                      {s.totalShares % 1 === 0 ? s.totalShares.toString() : s.totalShares.toFixed(4)}
                    </Td>
                    <Td align="right">{formatCurrency(s.totalInvested)}</Td>
                    <Td align="right">{formatCurrency(s.avgCostBasis)}</Td>
                    <Td align="right">
                      {s.currentPrice != null ? formatCurrency(s.currentPrice) : "—"}
                    </Td>
                    <Td align="right">
                      {s.marketValue != null ? formatCurrency(s.marketValue) : "—"}
                    </Td>
                    <td className={cn("px-5 py-3 text-right font-medium", pnlColor(s.pnlDollar))}>
                      {s.pnlDollar != null ? formatCurrency(s.pnlDollar) : "—"}
                    </td>
                    <td className={cn("px-5 py-3 text-right font-medium", pnlColor(s.pnlPercent))}>
                      {s.pnlPercent != null ? formatPercent(s.pnlPercent) : "—"}
                    </td>
                    <td className={cn("px-5 py-3 text-right", pnlColor(s.dailyChangePct))}>
                      {s.dailyChangePct != null ? formatPercent(s.dailyChangePct) : "—"}
                    </td>
                    <Td align="right">
                      {s.portPct != null ? `${s.portPct.toFixed(1)}%` : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
              {hasPrices && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                    <td colSpan={2} className="px-5 py-3 text-foreground">Total</td>
                    <td className="px-5 py-3 text-right text-foreground">{formatCurrency(totalInvested)}</td>
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3 text-right text-foreground">{formatCurrency(totalValue)}</td>
                    <td className={cn("px-5 py-3 text-right font-bold", pnlColor(totalPnlDollar))}>
                      {formatCurrency(totalPnlDollar)}
                    </td>
                    <td className={cn("px-5 py-3 text-right font-bold", pnlColor(totalPnlPercent))}>
                      {totalPnlPercent != null ? formatPercent(totalPnlPercent) : "—"}
                    </td>
                    <td className={cn("px-5 py-3 text-right font-bold", pnlColor(dailyChangeDollar))}>
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
    </div>
  );
}
