import { useState } from "react";

const LOGO_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
  "#14b8a6", "#06b6d4", "#84cc16", "#f59e0b",
];

interface TickerLogoProps {
  ticker: string;
  size?: "sm" | "md";
}

export function TickerLogo({ ticker, size = "md" }: TickerLogoProps) {
  const [failed, setFailed] = useState(false);
  const color = LOGO_COLORS[ticker.charCodeAt(0) % LOGO_COLORS.length];
  const initials = ticker.slice(0, 2).toUpperCase();
  const cls = size === "sm"
    ? "w-6 h-6 text-[9px]"
    : "w-8 h-8 text-[10px]";

  if (failed) {
    return (
      <div
        className={`${cls} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={`https://assets.parqet.com/logos/symbol/${ticker}?format=png`}
      alt={ticker}
      className={`${cls} rounded-full object-contain shrink-0 bg-white border border-border`}
      onError={() => setFailed(true)}
    />
  );
}
