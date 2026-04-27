import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatShares(value: number): string {
  return value % 1 === 0 ? value.toString() : value.toFixed(4);
}

export function pnlColor(value: number | null | undefined): string {
  if (value == null) return "";
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-muted-foreground";
}

/** Read a CSS custom property from :root as a color string usable in SVG fills. */
export function getCssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Returns true if the ticker looks like a CUSIP (9 alphanumeric chars).
 *  Used to identify bonds, CDs, and structured notes imported from Ameriprise. */
export function isCusip(ticker: string): boolean {
  return /^[A-Z0-9]{9}$/i.test(ticker);
}
