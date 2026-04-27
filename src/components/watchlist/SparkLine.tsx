import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChartData } from "../../types";
import { LineChart, Line, Tooltip, ResponsiveContainer } from "recharts";
import { getCssVar, formatCurrency } from "../../lib/utils";

interface SparkLineProps {
  ticker: string;
  quoteType?: string | null;
}

interface SparkPoint {
  v: number;
  t: number; // unix seconds
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function tsToDateStr(rawT: unknown): string {
  // Coerce to number — handles any serialization quirks from Tauri IPC
  const t = Number(rawT);
  if (!Number.isFinite(t) || t <= 0) return "—";
  // Yahoo chart timestamps are Unix seconds (~10 digits). Handle ms just in case.
  const ms = t > 9_999_999_999 ? t : t * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${y}`;
}

function SparkTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SparkPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const dateStr = tsToDateStr(point.t);
  return (
    <div className="bg-popover border border-border rounded-md shadow-lg px-2.5 py-1.5 text-xs leading-tight pointer-events-none whitespace-nowrap">
      <div className="font-bold text-foreground text-sm">{formatCurrency(point.v)}</div>
      <div className="text-muted-foreground mt-0.5">{dateStr || "—"}</div>
    </div>
  );
}

export function SparkLine({ ticker, quoteType }: SparkLineProps) {
  const [data, setData] = useState<SparkPoint[]>([]);
  const [trend, setTrend] = useState<"up" | "down" | "flat">("flat");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData([]);
    setLoaded(false);
    invoke<ChartData>("fetch_chart_command", {
      ticker,
      range: "1mo",
      interval: "1d",
    })
      .then((chart) => {
        if (cancelled) return;
        if (chart.points.length < 2) {
          setLoaded(true);
          return;
        }
        const points = chart.points.map((p) => ({ v: p.close, t: p.timestamp }));
        const first = points[0].v;
        const last = points[points.length - 1].v;
        setTrend(last > first ? "up" : last < first ? "down" : "flat");
        setData(points);
      })
      .catch(() => {/* silently skip on error */})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [ticker, quoteType]);

  if (data.length === 0) {
    if (loaded) {
      return (
        <div className="flex h-8 w-20 items-center justify-center text-xs text-muted-foreground">
          —
        </div>
      );
    }
    return <div className="w-20 h-8 rounded bg-muted/50 animate-pulse" />;
  }

  const color =
    trend === "up" ? getCssVar("--positive") : trend === "down" ? getCssVar("--negative") : "#6b7280";

  return (
    // overflow: visible lets the tooltip float above without a negative-margin hack
    <div className="w-20 h-8" style={{ overflow: "visible" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Tooltip
            content={<SparkTooltip />}
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
            position={{ y: -52 }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 50 }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
