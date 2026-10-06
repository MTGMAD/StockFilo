import { cn } from "../../lib/utils";

interface AppLogoMarkProps {
  className?: string;
}

/**
 * The colours come from the --logo-* tokens in index.css, so the mark follows
 * the active theme (violet by default, green and parchment in the warm theme)
 * with no theme logic here.
 */
export function AppLogoMark({ className }: AppLogoMarkProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-[0.7rem] bg-linear-to-br from-(--logo-from) to-(--logo-to) shadow-sm ring-1 ring-black/8",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 46C11 42 17 43 24 39C31 35 36 32 43 28C50 24 55 21 60 17" style={{ stroke: "var(--logo-accent)" }} strokeOpacity="0.55" strokeWidth="1.25" strokeLinecap="round" />
        <circle cx="59" cy="18" r="2.4" style={{ fill: "var(--logo-accent)" }} fillOpacity="0.35" />
        <circle cx="59" cy="18" r="1.1" style={{ fill: "var(--logo-fg)" }} />
        <path d="M4 46C11 42 17 43 24 39C31 35 36 32 43 28C50 24 55 21 60 17V64H4V46Z" fill="url(#app-logo-fill)" opacity="0.16" />
        <text x="32" y="39" textAnchor="middle" fontSize="27" fontWeight="900" letterSpacing="-1.6" style={{ fill: "var(--logo-fg)" }} fontFamily="Arial, Helvetica, sans-serif">SF</text>
        <defs>
          <linearGradient id="app-logo-fill" x1="32" y1="18" x2="32" y2="64" gradientUnits="userSpaceOnUse">
            <stop style={{ stopColor: "var(--logo-accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--logo-accent)" }} stopOpacity="0.15" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
