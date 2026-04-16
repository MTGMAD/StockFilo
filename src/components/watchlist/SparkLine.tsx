import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChartData } from "../../types";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { getCssVar } from "../../lib/utils";

interface SparkLineProps {
  ticker: string;
  quoteType?: string | null;
}

export function SparkLine({ ticker, quoteType }: SparkLineProps) {
  const [data, setData] = useState<{ v: number }[]>([]);
  const [trend, setTrend] = useState<"up" | "down" | "flat">("flat");

  useEffect(() => {
    let cancelled = false;
    const isFund = quoteType === "MUTUALFUND" || quoteType === "UIT";
    invoke<ChartData>("fetch_chart_command", {
      ticker,
      range: "1mo",
      interval: isFund ? "1d" : "1d",
    })
      .then((chart) => {
        if (cancelled || chart.points.length < 2) return;
        const points = chart.points.map((p) => ({ v: p.close }));
        const first = points[0].v;
        const last = points[points.length - 1].v;
        setTrend(last > first ? "up" : last < first ? "down" : "flat");
        setData(points);
      })
      .catch(() => {/* silently skip on error */});
    return () => { cancelled = true; };
  }, [ticker, quoteType]);

  if (data.length === 0) {
    return <div className="w-20 h-8 rounded bg-muted/50 animate-pulse" />;
  }

  const color =
    trend === "up" ? getCssVar("--positive") : trend === "down" ? getCssVar("--negative") : "#6b7280";

  return (
    <div className="w-20 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
